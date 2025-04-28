/**
 * auth.js - Módulo de autenticación y seguridad para FactuSystem
 * 
 * Este módulo gestiona todas las funcionalidades relacionadas con la autenticación,
 * control de acceso basado en roles, y seguridad general del sistema.
 */

// Importaciones
const { ipcRenderer } = require('electron');
const database = require('./database.js');
const logger = require('./logger.js');
const backup = require('./backup.js');

// Servicios de autenticación específicos que están en /services/auth/
const twoFactorService = require('../../../services/auth/twoFactor.js');
const permissionsService = require('../../../services/auth/permissions.js');

// Variables globales
let currentUser = null;
let userPermissions = [];
let userRole = null;
let sessionToken = null;
let sessionTimeout = null;
const SESSION_DURATION = 8 * 60 * 60 * 1000; // 8 horas en milisegundos
const INACTIVITY_TIMEOUT = 30 * 60 * 1000; // 30 minutos en milisegundos
let lastActivity = Date.now();
let inactivityTimer = null;

/**
 * Inicializa el módulo de autenticación
 */
function initialize() {
    // Cargar la configuración de seguridad desde la base de datos
    database.getSecuritySettings()
        .then(settings => {
            // Configurar variables según las configuraciones guardadas
            if (settings) {
                if (settings.sessionDuration) {
                    SESSION_DURATION = settings.sessionDuration * 60 * 1000; // Convertir minutos a ms
                }
                if (settings.inactivityTimeout) {
                    INACTIVITY_TIMEOUT = settings.inactivityTimeout * 60 * 1000; // Convertir minutos a ms
                }
            }
        })
        .catch(error => {
            logger.error('Error al cargar configuración de seguridad', error);
        });

    // Configurar listener para resetear el contador de inactividad
    document.addEventListener('click', resetInactivityTimer);
    document.addEventListener('keypress', resetInactivityTimer);
    
    // Revisar si hay una sesión activa (por ejemplo, si se recarga la página)
    checkExistingSession();
    
    // Configurar IPC para recibir comandos desde el proceso principal
    setupIpcListeners();
}

/**
 * Verifica las credenciales del usuario
 * @param {string} username - Nombre de usuario
 * @param {string} password - Contraseña
 * @returns {Promise} - Promesa que resuelve con los datos del usuario o rechaza con error
 */
function login(username, password) {
    return new Promise((resolve, reject) => {
        // Registrar intento de login
        logger.info(`Intento de login: ${username}`);
        
        // Verificar credenciales contra la base de datos
        database.getUserByUsername(username)
            .then(user => {
                if (!user) {
                    logger.warning(`Intento de login fallido: usuario no encontrado (${username})`);
                    reject(new Error('Usuario no encontrado'));
                    return;
                }

                // Verificar si la cuenta está bloqueada
                if (user.locked) {
                    logger.warning(`Intento de login a cuenta bloqueada: ${username}`);
                    reject(new Error('Esta cuenta está bloqueada. Contacte al administrador.'));
                    return;
                }

                // Verificar la contraseña
                return verifyPassword(password, user.password)
                    .then(isValid => {
                        if (!isValid) {
                            // Incrementar contador de intentos fallidos
                            return handleFailedLoginAttempt(user)
                                .then(() => {
                                    reject(new Error('Contraseña incorrecta'));
                                });
                        }
                        
                        // Resetear contador de intentos fallidos
                        return resetFailedLoginAttempts(user)
                            .then(() => {
                                // Verificar si se requiere 2FA
                                if (user.twoFactorEnabled) {
                                    return twoFactorService.generateChallenge(user.id)
                                        .then(challenge => {
                                            resolve({
                                                requiresTwoFactor: true,
                                                userId: user.id,
                                                challenge
                                            });
                                        });
                                }
                                
                                // Si no requiere 2FA, completar el login
                                return completeLogin(user);
                            })
                            .then(result => {
                                resolve(result);
                            });
                    });
            })
            .catch(error => {
                logger.error('Error en proceso de login', error);
                reject(error);
            });
    });
}

/**
 * Verifica el código de autenticación de dos factores
 * @param {number} userId - ID del usuario
 * @param {string} code - Código de verificación
 * @returns {Promise} - Promesa que resuelve con los datos del usuario
 */
function verifyTwoFactor(userId, code) {
    return new Promise((resolve, reject) => {
        twoFactorService.verifyCode(userId, code)
            .then(isValid => {
                if (!isValid) {
                    logger.warning(`Verificación 2FA fallida para usuario ID: ${userId}`);
                    reject(new Error('Código de verificación inválido'));
                    return;
                }
                
                // Buscar información del usuario
                return database.getUserById(userId);
            })
            .then(user => {
                // Completar el login
                return completeLogin(user);
            })
            .then(result => {
                resolve(result);
            })
            .catch(error => {
                logger.error('Error en verificación 2FA', error);
                reject(error);
            });
    });
}

/**
 * Completa el proceso de login configurando la sesión
 * @param {Object} user - Datos del usuario
 * @returns {Promise} - Promesa que resuelve con los datos de sesión
 */
function completeLogin(user) {
    return new Promise((resolve, reject) => {
        // Generar token de sesión
        const token = generateSessionToken();
        const now = Date.now();
        
        // Configurar datos de sesión
        currentUser = {
            id: user.id,
            username: user.username,
            nombre: user.nombre,
            apellido: user.apellido,
            email: user.email,
            sucursal: user.sucursal
        };
        
        sessionToken = token;
        lastActivity = now;
        
        // Obtener rol y permisos del usuario
        return permissionsService.getUserRole(user.id)
            .then(role => {
                userRole = role;
                return permissionsService.getUserPermissions(user.id);
            })
            .then(permissions => {
                userPermissions = permissions;
                
                // Guardar datos de sesión en localStorage para recuperación
                saveSessionData(token, user.id, now);
                
                // Iniciar temporizadores
                startSessionTimers();
                
                // Registrar inicio de sesión exitoso
                logger.info(`Login exitoso: ${user.username} (ID: ${user.id})`);
                
                // Notificar al proceso principal sobre el login
                ipcRenderer.send('user-logged-in', { 
                    userId: user.id, 
                    username: user.username,
                    role: userRole
                });
                
                // Devolver datos relevantes
                resolve({
                    user: currentUser,
                    token: sessionToken,
                    role: userRole,
                    permissions: userPermissions
                });
            })
            .catch(error => {
                logger.error('Error al completar login', error);
                reject(error);
            });
    });
}

/**
 * Cierra la sesión del usuario actual
 * @param {boolean} expired - Indica si la sesión expiró (true) o si fue logout manual (false)
 * @returns {Promise} - Promesa que resuelve cuando se completa el logout
 */
function logout(expired = false) {
    return new Promise((resolve) => {
        if (!currentUser) {
            resolve();
            return;
        }
        
        const userId = currentUser.id;
        const username = currentUser.username;
        
        // Limpiar los datos de sesión
        clearSessionData();
        
        // Detener temporizadores
        clearTimeout(sessionTimeout);
        clearTimeout(inactivityTimer);
        
        // Registrar logout
        if (expired) {
            logger.info(`Sesión expirada: ${username} (ID: ${userId})`);
        } else {
            logger.info(`Logout: ${username} (ID: ${userId})`);
        }
        
        // Notificar al proceso principal
        ipcRenderer.send('user-logged-out', { 
            userId, 
            username,
            expired 
        });
        
        // Redireccionar a la página de login
        window.location.href = '../../../views/login.html';
        
        resolve();
    });
}

/**
 * Verifica si un usuario tiene un permiso específico
 * @param {string} permission - Permiso a verificar
 * @returns {boolean} - True si tiene el permiso, False si no
 */
function hasPermission(permission) {
    if (!currentUser || !userPermissions) {
        return false;
    }
    
    // Los administradores tienen todos los permisos
    if (userRole === 'admin') {
        return true;
    }
    
    return userPermissions.includes(permission);
}

/**
 * Obtiene todos los permisos del usuario actual
 * @returns {Array} - Lista de permisos
 */
function getUserPermissions() {
    return userPermissions || [];
}

/**
 * Obtiene el rol del usuario actual
 * @returns {string} - Nombre del rol
 */
function getUserRole() {
    return userRole;
}

/**
 * Obtiene los datos del usuario actual
 * @returns {Object} - Datos del usuario o null si no hay sesión
 */
function getCurrentUser() {
    return currentUser;
}

/**
 * Verifica si hay un usuario autenticado
 * @returns {boolean} - True si hay sesión activa
 */
function isAuthenticated() {
    return !!currentUser && !!sessionToken;
}

/**
 * Actualiza los datos del usuario actual
 * @param {Object} userData - Nuevos datos de usuario
 * @returns {Promise} - Promesa que resuelve cuando se actualizan los datos
 */
function updateUserData(userData) {
    return new Promise((resolve, reject) => {
        if (!currentUser) {
            reject(new Error('No hay sesión activa'));
            return;
        }
        
        // Actualizar en la base de datos
        database.updateUser(currentUser.id, userData)
            .then(() => {
                // Actualizar el objeto currentUser
                Object.assign(currentUser, userData);
                
                logger.info(`Datos de usuario actualizados: ${currentUser.username} (ID: ${currentUser.id})`);
                resolve(currentUser);
            })
            .catch(error => {
                logger.error('Error al actualizar datos de usuario', error);
                reject(error);
            });
    });
}

/**
 * Cambia la contraseña del usuario actual
 * @param {string} currentPassword - Contraseña actual
 * @param {string} newPassword - Nueva contraseña
 * @returns {Promise} - Promesa que resuelve cuando se cambia la contraseña
 */
function changePassword(currentPassword, newPassword) {
    return new Promise((resolve, reject) => {
        if (!currentUser) {
            reject(new Error('No hay sesión activa'));
            return;
        }
        
        // Verificar la contraseña actual
        database.getUserById(currentUser.id)
            .then(user => {
                return verifyPassword(currentPassword, user.password);
            })
            .then(isValid => {
                if (!isValid) {
                    reject(new Error('La contraseña actual es incorrecta'));
                    return;
                }
                
                // Cifrar la nueva contraseña
                return hashPassword(newPassword);
            })
            .then(hashedPassword => {
                // Actualizar en la base de datos
                return database.updateUserPassword(currentUser.id, hashedPassword);
            })
            .then(() => {
                logger.info(`Contraseña cambiada: ${currentUser.username} (ID: ${currentUser.id})`);
                
                // Opcional: crear un respaldo después de cambiar la contraseña
                backup.createBackup(`Respaldo automático después de cambio de contraseña (${currentUser.username})`)
                    .catch(error => {
                        logger.warning('Error al crear respaldo después de cambio de contraseña', error);
                    });
                
                resolve();
            })
            .catch(error => {
                logger.error('Error al cambiar contraseña', error);
                reject(error);
            });
    });
}

/**
 * Configura o desactiva la autenticación de dos factores
 * @param {boolean} enable - True para activar, False para desactivar
 * @param {string} password - Contraseña para confirmar la acción
 * @returns {Promise} - Promesa que resuelve con datos de configuración 2FA
 */
function configureTwoFactor(enable, password) {
    return new Promise((resolve, reject) => {
        if (!currentUser) {
            reject(new Error('No hay sesión activa'));
            return;
        }
        
        // Verificar la contraseña
        database.getUserById(currentUser.id)
            .then(user => {
                return verifyPassword(password, user.password);
            })
            .then(isValid => {
                if (!isValid) {
                    reject(new Error('Contraseña incorrecta'));
                    return;
                }
                
                if (enable) {
                    // Activar 2FA
                    return twoFactorService.setupTwoFactor(currentUser.id);
                } else {
                    // Desactivar 2FA
                    return twoFactorService.disableTwoFactor(currentUser.id);
                }
            })
            .then(result => {
                logger.info(`2FA ${enable ? 'activado' : 'desactivado'}: ${currentUser.username} (ID: ${currentUser.id})`);
                resolve(result);
            })
            .catch(error => {
                logger.error(`Error al ${enable ? 'activar' : 'desactivar'} 2FA`, error);
                reject(error);
            });
    });
}

/**
 * Recupera contraseña mediante correo electrónico
 * @param {string} email - Correo electrónico del usuario
 * @returns {Promise} - Promesa que resuelve cuando se envía el correo
 */
function recoverPassword(email) {
    return new Promise((resolve, reject) => {
        // Verificar si el correo electrónico existe
        database.getUserByEmail(email)
            .then(user => {
                if (!user) {
                    reject(new Error('No existe una cuenta con este correo electrónico'));
                    return;
                }
                
                // Generar token de recuperación (válido por 1 hora)
                const token = generateRecoveryToken();
                const expiry = Date.now() + 60 * 60 * 1000; // 1 hora
                
                // Guardar el token en la base de datos
                return database.saveRecoveryToken(user.id, token, expiry);
            })
            .then(userId => {
                // Importar el servicio de correo
                const emailService = require('../../../integrations/email/sender.js');
                
                // Enviar correo con instrucciones
                return emailService.sendPasswordRecovery(email, token);
            })
            .then(() => {
                logger.info(`Solicitud de recuperación de contraseña enviada a: ${email}`);
                resolve();
            })
            .catch(error => {
                logger.error('Error en recuperación de contraseña', error);
                reject(error);
            });
    });
}

/**
 * Resetea la contraseña usando un token de recuperación
 * @param {string} token - Token de recuperación
 * @param {string} newPassword - Nueva contraseña
 * @returns {Promise} - Promesa que resuelve cuando se cambia la contraseña
 */
function resetPassword(token, newPassword) {
    return new Promise((resolve, reject) => {
        // Verificar el token
        database.verifyRecoveryToken(token)
            .then(result => {
                if (!result || !result.valid) {
                    reject(new Error('Token inválido o expirado'));
                    return;
                }
                
                // Cifrar la nueva contraseña
                return hashPassword(newPassword)
                    .then(hashedPassword => {
                        // Actualizar la contraseña
                        return database.updateUserPassword(result.userId, hashedPassword);
                    })
                    .then(() => {
                        // Invalidar el token
                        return database.invalidateRecoveryToken(token);
                    });
            })
            .then(() => {
                logger.info(`Contraseña restablecida mediante token`);
                resolve();
            })
            .catch(error => {
                logger.error('Error al restablecer contraseña', error);
                reject(error);
            });
    });
}

/**
 * Crea un nuevo usuario en el sistema
 * @param {Object} userData - Datos del nuevo usuario
 * @param {Array} permissions - Permisos a asignar
 * @returns {Promise} - Promesa que resuelve con los datos del usuario creado
 */
function createUser(userData, permissions) {
    return new Promise((resolve, reject) => {
        // Verificar si el usuario actual tiene permisos para crear usuarios
        if (!hasPermission('usuarios.crear')) {
            reject(new Error('No tiene permisos para crear usuarios'));
            return;
        }
        
        // Verificar si el nombre de usuario ya existe
        database.getUserByUsername(userData.username)
            .then(existingUser => {
                if (existingUser) {
                    reject(new Error('Este nombre de usuario ya está registrado'));
                    return;
                }
                
                // Cifrar la contraseña
                return hashPassword(userData.password);
            })
            .then(hashedPassword => {
                // Reemplazar la contraseña en texto plano
                userData.password = hashedPassword;
                
                // Crear el usuario en la base de datos
                return database.createUser(userData);
            })
            .then(userId => {
                // Asignar permisos al usuario
                return permissionsService.assignPermissions(userId, permissions)
                    .then(() => userId);
            })
            .then(userId => {
                logger.info(`Usuario creado: ${userData.username} (ID: ${userId}) por ${currentUser.username}`);
                
                // Obtener los datos completos del usuario creado
                return database.getUserById(userId);
            })
            .then(user => {
                // No devolver la contraseña
                delete user.password;
                resolve(user);
            })
            .catch(error => {
                logger.error('Error al crear usuario', error);
                reject(error);
            });
    });
}

/**
 * Bloquea o desbloquea una cuenta de usuario
 * @param {number} userId - ID del usuario
 * @param {boolean} lock - True para bloquear, False para desbloquear
 * @returns {Promise} - Promesa que resuelve cuando se cambia el estado
 */
function lockUnlockUser(userId, lock) {
    return new Promise((resolve, reject) => {
        // Verificar permisos
        if (!hasPermission('usuarios.editar')) {
            reject(new Error('No tiene permisos para modificar usuarios'));
            return;
        }
        
        // No permitir que un usuario se bloquee a sí mismo
        if (currentUser && userId === currentUser.id) {
            reject(new Error('No puede bloquear su propia cuenta'));
            return;
        }
        
        // Actualizar el estado en la base de datos
        database.updateUserLockStatus(userId, lock)
            .then(() => {
                logger.info(`Usuario ${lock ? 'bloqueado' : 'desbloqueado'}: ID ${userId} por ${currentUser.username}`);
                resolve();
            })
            .catch(error => {
                logger.error(`Error al ${lock ? 'bloquear' : 'desbloquear'} usuario`, error);
                reject(error);
            });
    });
}

// -------------------- Funciones auxiliares internas --------------------

/**
 * Genera un hash de la contraseña
 * @param {string} password - Contraseña en texto plano
 * @returns {Promise} - Promesa que resuelve con el hash
 */
function hashPassword(password) {
    return new Promise((resolve, reject) => {
        // En producción, usar bcrypt o similar
        // Aquí simulamos la función para mantener la estructura
        try {
            // Implementación real usaría bcrypt:
            // const bcrypt = require('bcrypt');
            // const saltRounds = 10;
            // bcrypt.hash(password, saltRounds, (err, hash) => {
            //     if (err) reject(err);
            //     else resolve(hash);
            // });
            
            // Simulación simple (NO USAR EN PRODUCCIÓN):
            const crypto = require('crypto');
            const salt = crypto.randomBytes(16).toString('hex');
            const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
            resolve(`${salt}:${hash}`);
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * Verifica si una contraseña coincide con su hash
 * @param {string} password - Contraseña en texto plano
 * @param {string} storedHash - Hash almacenado
 * @returns {Promise} - Promesa que resuelve con booleano
 */
function verifyPassword(password, storedHash) {
    return new Promise((resolve, reject) => {
        try {
            // En producción, usar bcrypt o similar
            // Aquí simulamos la verificación
            
            // Implementación real usaría bcrypt:
            // const bcrypt = require('bcrypt');
            // bcrypt.compare(password, storedHash, (err, result) => {
            //     if (err) reject(err);
            //     else resolve(result);
            // });
            
            // Simulación simple (corresponde a la implementación de hashPassword):
            const crypto = require('crypto');
            const [salt, hash] = storedHash.split(':');
            const calculatedHash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
            resolve(hash === calculatedHash);
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * Maneja intentos fallidos de login
 * @param {Object} user - Datos del usuario
 * @returns {Promise} - Promesa que resuelve cuando se actualiza el contador
 */
function handleFailedLoginAttempt(user) {
    return new Promise((resolve, reject) => {
        const attempts = (user.failedAttempts || 0) + 1;
        const shouldLock = attempts >= 5; // Bloquear después de 5 intentos fallidos
        
        database.updateFailedLoginAttempts(user.id, attempts, shouldLock)
            .then(() => {
                if (shouldLock) {
                    logger.warning(`Cuenta bloqueada por múltiples intentos fallidos: ${user.username}`);
                }
                resolve();
            })
            .catch(error => {
                logger.error('Error al actualizar intentos fallidos', error);
                reject(error);
            });
    });
}

/**
 * Resetea el contador de intentos fallidos
 * @param {Object} user - Datos del usuario
 * @returns {Promise} - Promesa que resuelve cuando se resetea el contador
 */
function resetFailedLoginAttempts(user) {
    return database.updateFailedLoginAttempts(user.id, 0, false);
}

/**
 * Genera un token de sesión
 * @returns {string} - Token generado
 */
function generateSessionToken() {
    const crypto = require('crypto');
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Genera un token de recuperación
 * @returns {string} - Token generado
 */
function generateRecoveryToken() {
    const crypto = require('crypto');
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Guarda los datos de sesión en localStorage
 * @param {string} token - Token de sesión
 * @param {number} userId - ID del usuario
 * @param {number} timestamp - Marca de tiempo
 */
function saveSessionData(token, userId, timestamp) {
    localStorage.setItem('sessionToken', token);
    localStorage.setItem('userId', userId);
    localStorage.setItem('sessionStart', timestamp);
    localStorage.setItem('lastActivity', timestamp);
}

/**
 * Limpia los datos de sesión
 */
function clearSessionData() {
    localStorage.removeItem('sessionToken');
    localStorage.removeItem('userId');
    localStorage.removeItem('sessionStart');
    localStorage.removeItem('lastActivity');
    
    currentUser = null;
    userPermissions = [];
    userRole = null;
    sessionToken = null;
}

/**
 * Verifica si hay una sesión existente
 */
function checkExistingSession() {
    const token = localStorage.getItem('sessionToken');
    const userId = localStorage.getItem('userId');
    const sessionStart = localStorage.getItem('sessionStart');
    const storedLastActivity = localStorage.getItem('lastActivity');
    
    if (!token || !userId || !sessionStart || !storedLastActivity) {
        return;
    }
    
    const now = Date.now();
    const sessionAge = now - parseInt(sessionStart);
    const inactivityTime = now - parseInt(storedLastActivity);
    
    // Verificar si la sesión ha expirado
    if (sessionAge > SESSION_DURATION || inactivityTime > INACTIVITY_TIMEOUT) {
        clearSessionData();
        // Si estamos en una página protegida, redirigir al login
        if (!window.location.href.includes('login.html')) {
            window.location.href = '../../../views/login.html?expired=true';
        }
        return;
    }
    
    // Recargar los datos del usuario
    database.getUserById(parseInt(userId))
        .then(user => {
            if (!user) {
                clearSessionData();
                return;
            }
            
            // Completar la restauración de la sesión
            currentUser = {
                id: user.id,
                username: user.username,
                nombre: user.nombre,
                apellido: user.apellido,
                email: user.email,
                sucursal: user.sucursal
            };
            
            sessionToken = token;
            lastActivity = parseInt(storedLastActivity);
            
            // Cargar rol y permisos
            return permissionsService.getUserRole(user.id)
                .then(role => {
                    userRole = role;
                    return permissionsService.getUserPermissions(user.id);
                })
                .then(permissions => {
                    userPermissions = permissions;
                    
                    // Iniciar temporizadores
                    startSessionTimers();
                    
                    // Notificar que la sesión se ha restaurado
                    const event = new CustomEvent('sessionRestored', {
                        detail: {
                            user: currentUser,
                            role: userRole,
                            permissions: userPermissions
                        }
                    });
                    document.dispatchEvent(event);
                });
        })
        .catch(error => {
            logger.error('Error al restaurar sesión', error);
            clearSessionData();
        });
}

/**
 * Inicia los temporizadores de sesión
 */
function startSessionTimers() {
    // Limpiar temporizadores existentes
    clearTimeout(sessionTimeout);
    clearTimeout(inactivityTimer);
    
    // Configurar temporizador de expiración de sesión
    sessionTimeout = setTimeout(() => {
        logout(true);
    }, SESSION_DURATION);
    
    // Configurar temporizador de inactividad
    resetInactivityTimer();
}

/**
 * Resetea el temporizador de inactividad
 */
function resetInactivityTimer() {
    clearTimeout(inactivityTimer);
    
    lastActivity = Date.now();
    localStorage.setItem('lastActivity', lastActivity);
    
    inactivityTimer = setTimeout(() => {
        logout(true);
    }, INACTIVITY_TIMEOUT);
}

/**
 * Configura listeners IPC para comunicación con el proceso principal
 */
function setupIpcListeners() {
    // Responder a solicitudes de verificación de autenticación
    ipcRenderer.on('check-auth-status', (event) => {
        ipcRenderer.send('auth-status-response', {
            authenticated: isAuthenticated(),
            user: currentUser,
            role: userRole
        });
    });
    
    // Forzar cierre de sesión (desde el proceso principal)
    ipcRenderer.on('force-logout', (event) => {
        logout(true);
    });
}

/**
 * Verifica si el usuario actual es administrador
 * @returns {boolean} - True si es administrador
 */
function isAdmin() {
    return userRole === 'admin';
}

/**
 * Verifica si un módulo está disponible para el usuario actual
 * @param {string} moduleName - Nombre del módulo
 * @returns {boolean} - True si tiene acceso al módulo
 */
function canAccessModule(moduleName) {
    if (!isAuthenticated()) {
        return false;
    }
    
    // Los administradores tienen acceso a todos los módulos
    if (isAdmin()) {
        return true;
    }
    
    // Verificar permiso específico para el módulo
    return hasPermission(`modulo.${moduleName}`);
}

/**
 * Obtiene la lista de módulos a los que tiene acceso el usuario
 * @returns {Promise} - Promesa que resuelve con la lista de módulos
 */
function getAccessibleModules() {
    return new Promise((resolve, reject) => {
        if (!isAuthenticated()) {
            resolve([]);
            return;
        }
        
        // Obtener todos los módulos
        database.getAllModules()
            .then(modules => {
                // Filtrar según permisos
                if (isAdmin()) {
                    resolve(modules);
                } else {
                    const accessible = modules.filter(module => 
                        hasPermission(`modulo.${module.nombre}`)
                    );
                    resolve(accessible);
                }
            })

            .catch(error => {
                logger.error('Error al obtener módulos accesibles', error);
                reject(error);
            });
    });
}

/**
 * Verifica si el usuario tiene permiso para realizar una acción específica en un módulo
 * @param {string} moduleName - Nombre del módulo
 * @param {string} action - Acción a realizar (crear, editar, eliminar, etc.)
 * @returns {boolean} - True si tiene permiso
 */
function canPerformAction(moduleName, action) {
    return hasPermission(`${moduleName}.${action}`);
}

/**
 * Registra actividad del usuario para auditoría
 * @param {string} action - Acción realizada
 * @param {string} module - Módulo donde se realizó
 * @param {Object} details - Detalles adicionales
 * @returns {Promise} - Promesa que resuelve cuando se registra la actividad
 */
function logUserActivity(action, module, details = {}) {
    if (!isAuthenticated()) {
        return Promise.reject(new Error('No hay sesión activa'));
    }
    
    const activityData = {
        userId: currentUser.id,
        username: currentUser.username,
        action,
        module,
        details,
        timestamp: new Date(),
        ip: null, // Se asignará en el servidor
        sucursal: currentUser.sucursal
    };
    
    return logger.activity(activityData);
}

/**
 * Valida requisitos de seguridad para contraseñas
 * @param {string} password - Contraseña a validar
 * @returns {Object} - Resultado de validación {valid, errors}
 */
function validatePasswordSecurity(password) {
    const result = {
        valid: true,
        errors: []
    };
    
    // Longitud mínima
    if (password.length < 8) {
        result.valid = false;
        result.errors.push('La contraseña debe tener al menos 8 caracteres');
    }
    
    // Debe contener al menos un número
    if (!/\d/.test(password)) {
        result.valid = false;
        result.errors.push('La contraseña debe contener al menos un número');
    }
    
    // Debe contener al menos una letra mayúscula
    if (!/[A-Z]/.test(password)) {
        result.valid = false;
        result.errors.push('La contraseña debe contener al menos una letra mayúscula');
    }
    
    // Debe contener al menos una letra minúscula
    if (!/[a-z]/.test(password)) {
        result.valid = false;
        result.errors.push('La contraseña debe contener al menos una letra minúscula');
    }
    
    // Debe contener al menos un caracter especial
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
        result.valid = false;
        result.errors.push('La contraseña debe contener al menos un caracter especial');
    }
    
    return result;
}

/**
 * Obtiene el historial de actividad del usuario actual
 * @param {Object} options - Opciones de filtrado y paginación
 * @returns {Promise} - Promesa que resuelve con el historial
 */
function getUserActivityHistory(options = {}) {
    if (!isAuthenticated()) {
        return Promise.reject(new Error('No hay sesión activa'));
    }
    
    // Configurar opciones por defecto
    const defaultOptions = {
        page: 1,
        limit: 50,
        userId: currentUser.id,
        fromDate: null,
        toDate: null,
        module: null,
        action: null
    };
    
    const queryOptions = { ...defaultOptions, ...options };
    
    return logger.getActivityLogs(queryOptions);
}

/**
 * Verifica si la sesión actual es válida y la renueva
 * @returns {Promise} - Promesa que resuelve con estado de la sesión
 */
function validateAndRenewSession() {
    return new Promise((resolve, reject) => {
        if (!isAuthenticated()) {
            reject(new Error('No hay sesión activa'));
            return;
        }
        
        // Actualizar la marca de tiempo de última actividad
        lastActivity = Date.now();
        localStorage.setItem('lastActivity', lastActivity);
        
        // Resetear temporizador de inactividad
        resetInactivityTimer();
        
        // Devolver estado de la sesión
        resolve({
            valid: true,
            user: currentUser,
            role: userRole,
            permissions: userPermissions
        });
    });
}

/**
 * Sincroniza los permisos en un entorno multi-sucursal
 * @returns {Promise} - Promesa que resuelve cuando se sincronizan los permisos
 */
function syncPermissions() {
    return new Promise((resolve, reject) => {
        if (!isAuthenticated()) {
            reject(new Error('No hay sesión activa'));
            return;
        }
        
        // Importar servicio de sincronización
        const syncService = require('../utils/sync.js');
        
        syncService.syncUserPermissions(currentUser.id)
            .then(() => {
                // Recargar permisos
                return permissionsService.getUserPermissions(currentUser.id);
            })
            .then(permissions => {
                userPermissions = permissions;
                resolve(permissions);
            })
            .catch(error => {
                logger.error('Error al sincronizar permisos', error);
                reject(error);
            });
    });
}

/**
 * Verifica la integridad de los datos del usuario
 * Útil después de una sincronización
 * @returns {Promise} - Promesa que resuelve con el resultado de la verificación
 */
function verifyUserDataIntegrity() {
    return new Promise((resolve, reject) => {
        if (!isAuthenticated()) {
            reject(new Error('No hay sesión activa'));
            return;
        }
        
        database.getUserById(currentUser.id)
            .then(user => {
                if (!user) {
                    reject(new Error('Usuario no encontrado en la base de datos local'));
                    return;
                }
                
                // Verificar si los datos coinciden
                const integrityCheck = {
                    passed: true,
                    differences: []
                };
                
                // Verificar campos críticos
                if (user.username !== currentUser.username) {
                    integrityCheck.passed = false;
                    integrityCheck.differences.push('username');
                }
                
                if (user.sucursal !== currentUser.sucursal) {
                    integrityCheck.passed = false;
                    integrityCheck.differences.push('sucursal');
                }
                
                // Si hay problemas de integridad
                if (!integrityCheck.passed) {
                    logger.warning(`Problemas de integridad detectados en datos de usuario: ${currentUser.username}`, {
                        differences: integrityCheck.differences
                    });
                    
                    // Actualizar datos en memoria
                    currentUser = {
                        id: user.id,
                        username: user.username,
                        nombre: user.nombre,
                        apellido: user.apellido,
                        email: user.email,
                        sucursal: user.sucursal
                    };
                }
                
                resolve(integrityCheck);
            })
            .catch(error => {
                logger.error('Error al verificar integridad de datos', error);
                reject(error);
            });
    });
}

/**
 * Verifica si la cuenta actual es temporal
 * @returns {Promise<boolean>} - Promesa que resuelve con True si la cuenta es temporal
 */
function isTemporaryAccount() {
    return new Promise((resolve, reject) => {
        if (!isAuthenticated()) {
            reject(new Error('No hay sesión activa'));
            return;
        }
        
        database.getUserById(currentUser.id)
            .then(user => {
                resolve(!!user.temporary);
            })
            .catch(error => {
                logger.error('Error al verificar estado de cuenta temporal', error);
                reject(error);
            });
    });
}

/**
 * Exporta todos los datos de un usuario (para cumplimiento de regulaciones de privacidad)
 * @param {number} userId - ID del usuario (solo admins pueden especificar otro usuario)
 * @returns {Promise} - Promesa que resuelve con los datos
 */
function exportUserData(userId = null) {
    return new Promise((resolve, reject) => {
        if (!isAuthenticated()) {
            reject(new Error('No hay sesión activa'));
            return;
        }
        
        // Si no se especifica un ID, usar el del usuario actual
        const targetUserId = userId || currentUser.id;
        
        // Si se especifica otro usuario, verificar permisos de administrador
        if (targetUserId !== currentUser.id && !isAdmin()) {
            reject(new Error('No tiene permisos para exportar datos de otros usuarios'));
            return;
        }
        
        // Recopilar todos los datos
        const userData = {};
        
        // Información básica del usuario
        database.getUserById(targetUserId)
            .then(user => {
                if (!user) {
                    reject(new Error('Usuario no encontrado'));
                    return;
                }
                
                // Eliminar datos sensibles
                delete user.password;
                userData.basic = user;
                
                // Obtener actividad del usuario
                return logger.getActivityLogs({ 
                    userId: targetUserId,
                    limit: 1000  // Limitar a 1000 registros 
                });
            })
            .then(activityLogs => {
                userData.activity = activityLogs;
                
                // Obtener historial de ventas
                return database.getUserSales(targetUserId);
            })
            .then(sales => {
                userData.sales = sales;
                
                // Obtener configuraciones personalizadas
                return database.getUserSettings(targetUserId);
            })
            .then(settings => {
                userData.settings = settings;
                
                // Obtener permisos
                return permissionsService.getUserPermissions(targetUserId);
            })
            .then(permissions => {
                userData.permissions = permissions;
                
                // Registrar la exportación
                logger.info(`Datos de usuario exportados: ID ${targetUserId} por ${currentUser.username}`);
                
                resolve(userData);
            })
            .catch(error => {
                logger.error('Error al exportar datos de usuario', error);
                reject(error);
            });
    });
}

/**
 * Actualiza el perfil del usuario con un objeto de datos
 * @param {Object} profileData - Datos del perfil a actualizar
 * @returns {Promise} - Promesa que resuelve cuando se actualiza el perfil
 */
function updateProfile(profileData) {
    return new Promise((resolve, reject) => {
        if (!isAuthenticated()) {
            reject(new Error('No hay sesión activa'));
            return;
        }
        
        // Validar datos del perfil
        const allowedFields = ['nombre', 'apellido', 'email', 'telefono', 'preferencias'];
        const updateData = {};
        
        // Filtrar solo los campos permitidos
        Object.keys(profileData).forEach(key => {
            if (allowedFields.includes(key)) {
                updateData[key] = profileData[key];
            }
        });
        
        // Verificar si hay datos para actualizar
        if (Object.keys(updateData).length === 0) {
            reject(new Error('No hay datos válidos para actualizar'));
            return;
        }
        
        // Actualizar en la base de datos
        database.updateUserProfile(currentUser.id, updateData)
            .then(() => {
                // Actualizar el objeto currentUser
                Object.assign(currentUser, updateData);
                
                logger.info(`Perfil actualizado: ${currentUser.username}`);
                resolve(currentUser);
            })
            .catch(error => {
                logger.error('Error al actualizar perfil', error);
                reject(error);
            });
    });
}

/**
 * Verifica si un usuario tiene acceso a una sucursal específica
 * @param {number} branchId - ID de la sucursal
 * @returns {Promise<boolean>} - Promesa que resuelve con True si tiene acceso
 */
function canAccessBranch(branchId) {
    return new Promise((resolve, reject) => {
        if (!isAuthenticated()) {
            reject(new Error('No hay sesión activa'));
            return;
        }
        
        // Los administradores tienen acceso a todas las sucursales
        if (isAdmin()) {
            resolve(true);
            return;
        }
        
        // Obtener las sucursales asignadas al usuario
        database.getUserBranches(currentUser.id)
            .then(branches => {
                const hasAccess = branches.some(branch => branch.id === branchId);
                resolve(hasAccess);
            })
            .catch(error => {
                logger.error('Error al verificar acceso a sucursal', error);
                reject(error);
            });
    });
}

// Exportación de funciones públicas
module.exports = {
    // Inicialización
    initialize,
    
    // Gestión de sesiones
    login,
    logout,
    verifyTwoFactor,
    isAuthenticated,
    getCurrentUser,
    getUserRole,
    validateAndRenewSession,
    
    // Control de acceso
    hasPermission,
    getUserPermissions,
    canAccessModule,
    canPerformAction,
    isAdmin,
    getAccessibleModules,
    canAccessBranch,
    
    // Gestión de usuarios
    createUser,
    updateUserData,
    updateProfile,
    lockUnlockUser,
    
    // Seguridad
    changePassword,
    recoverPassword,
    resetPassword,
    configureTwoFactor,
    validatePasswordSecurity,
    
    // Auditoría y registro
    logUserActivity,
    getUserActivityHistory,
    
    // Sincronización y mantenimiento
    syncPermissions,
    verifyUserDataIntegrity,
    isTemporaryAccount,
    exportUserData
};