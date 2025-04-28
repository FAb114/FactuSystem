/**
 * services/auth/login.js
 * Servicio de autenticación para FactuSystem
 * 
 * Este servicio maneja el login de usuarios, validación de credenciales,
 * gestión de sesiones y conexión con el sistema de permisos
 */

const { ipcMain } = require('electron');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// Importar utilidades de base de datos
const database = require('../../app/assets/js/utils/database');
const logger = require('../audit/logger');
const permissionsService = require('./permissions');
const twoFactorService = require('./twoFactor');
const { getOfflineUsers } = require('../sync/offline');

// Clave secreta para JWT - en producción esto debería estar en variables de entorno
const JWT_SECRET = process.env.JWT_SECRET || 'factusystem-secret-key-change-in-production';
// Tiempo de expiración del token (en segundos) - 8 horas por defecto
const TOKEN_EXPIRATION = process.env.TOKEN_EXPIRATION || 28800;

/**
 * Inicializa los manejadores de eventos para autenticación
 * @param {Electron.BrowserWindow} mainWindow - Ventana principal de la aplicación
 */
function initializeAuthHandlers(mainWindow) {
  // Maneja la solicitud de login
  ipcMain.handle('auth:login', async (event, credentials) => {
    try {
      const result = await authenticateUser(credentials);
      
      if (result.success) {
        // Registrar evento de login exitoso
        logger.logEvent('auth', 'login_success', {
          userId: result.user.id,
          username: result.user.username,
          timestamp: new Date(),
          ipAddress: result.ipAddress || 'local'
        });
        
        // Si el usuario tiene habilitada la autenticación de dos factores
        if (result.user.twoFactorEnabled) {
          return {
            requireTwoFactor: true,
            userId: result.user.id,
            tempToken: generateTemporaryToken(result.user)
          };
        }
        
        // Login completo exitoso
        return {
          success: true,
          token: result.token,
          user: {
            id: result.user.id,
            username: result.user.username,
            name: result.user.name,
            role: result.user.role,
            sucursalId: result.user.sucursalId,
            hasManyBranches: result.hasManyBranches,
            permissions: result.permissions
          }
        };
      } else {
        // Registrar intento fallido de login
        logger.logEvent('auth', 'login_failed', {
          username: credentials.username,
          timestamp: new Date(),
          reason: result.message || 'Credenciales inválidas',
          ipAddress: result.ipAddress || 'local'
        });
        
        return {
          success: false,
          message: result.message || 'Credenciales inválidas'
        };
      }
    } catch (error) {
      logger.logError('auth', 'login_error', {
        error: error.message,
        stack: error.stack,
        timestamp: new Date()
      });
      
      return {
        success: false,
        message: 'Error en el servidor de autenticación'
      };
    }
  });

  // Maneja la validación de 2FA
  ipcMain.handle('auth:verify-2fa', async (event, { tempToken, code }) => {
    try {
      // Verificar token temporal
      const decoded = jwt.verify(tempToken, JWT_SECRET);
      
      // Verificar código 2FA
      const isValid = await twoFactorService.verifyCode(decoded.id, code);
      
      if (isValid) {
        // Obtener datos de usuario
        const db = await database.getConnection();
        const user = await db.get('SELECT * FROM users WHERE id = ?', [decoded.id]);
        
        // Obtener permisos
        const permissions = await permissionsService.getUserPermissions(user.id, user.role);
        
        // Verificar si el usuario tiene acceso a múltiples sucursales
        const sucursales = await db.all('SELECT id FROM user_branches WHERE userId = ?', [user.id]);
        const hasManyBranches = sucursales.length > 1;
        
        // Crear token de sesión
        const token = generateToken(user);
        
        // Registrar evento de 2FA exitoso
        logger.logEvent('auth', '2fa_success', {
          userId: user.id,
          username: user.username,
          timestamp: new Date()
        });
        
        return {
          success: true,
          token,
          user: {
            id: user.id,
            username: user.username,
            name: user.name,
            role: user.role,
            sucursalId: user.sucursalId,
            hasManyBranches,
            permissions
          }
        };
      } else {
        // Registrar evento de 2FA fallido
        logger.logEvent('auth', '2fa_failed', {
          userId: decoded.id,
          timestamp: new Date()
        });
        
        return {
          success: false,
          message: 'Código de verificación inválido'
        };
      }
    } catch (error) {
      logger.logError('auth', '2fa_error', {
        error: error.message,
        stack: error.stack,
        timestamp: new Date()
      });
      
      return {
        success: false,
        message: 'Error en la verificación de dos factores'
      };
    }
  });

  // Maneja la selección de sucursal
  ipcMain.handle('auth:select-branch', async (event, { token, sucursalId }) => {
    try {
      // Verificar token
      const decoded = jwt.verify(token, JWT_SECRET);
      
      // Verificar que el usuario tenga acceso a la sucursal
      const db = await database.getConnection();
      const hasAccess = await db.get(
        'SELECT 1 FROM user_branches WHERE userId = ? AND branchId = ?',
        [decoded.id, sucursalId]
      );
      
      if (!hasAccess) {
        return {
          success: false,
          message: 'No tienes acceso a esta sucursal'
        };
      }
      
      // Actualizar sucursal preferida del usuario
      await db.run(
        'UPDATE users SET sucursalId = ? WHERE id = ?',
        [sucursalId, decoded.id]
      );
      
      // Registrar cambio de sucursal
      logger.logEvent('auth', 'branch_change', {
        userId: decoded.id,
        username: decoded.username,
        sucursalId,
        timestamp: new Date()
      });
      
      // Generar nuevo token con la sucursal actualizada
      const user = await db.get('SELECT * FROM users WHERE id = ?', [decoded.id]);
      const newToken = generateToken(user);
      
      return {
        success: true,
        token: newToken,
        sucursalId
      };
    } catch (error) {
      logger.logError('auth', 'branch_selection_error', {
        error: error.message,
        stack: error.stack,
        timestamp: new Date()
      });
      
      return {
        success: false,
        message: 'Error al seleccionar sucursal'
      };
    }
  });

  // Maneja el cierre de sesión
  ipcMain.handle('auth:logout', async (event, { token }) => {
    try {
      // Verificar token para obtener datos del usuario
      const decoded = jwt.verify(token, JWT_SECRET);
      
      // Registrar evento de logout
      logger.logEvent('auth', 'logout', {
        userId: decoded.id,
        username: decoded.username,
        timestamp: new Date()
      });
      
      // Verificar si hay cajas abiertas por este usuario
      const db = await database.getConnection();
      const openCashRegister = await db.get(
        'SELECT id FROM cash_registers WHERE userId = ? AND closeDate IS NULL',
        [decoded.id]
      );
      
      if (openCashRegister) {
        return {
          success: false,
          message: 'Debes cerrar la caja antes de cerrar sesión',
          requireCloseCashRegister: true
        };
      }
      
      return {
        success: true
      };
    } catch (error) {
      logger.logError('auth', 'logout_error', {
        error: error.message,
        stack: error.stack,
        timestamp: new Date()
      });
      
      // Si hay error, permitir el logout de todas formas
      return {
        success: true
      };
    }
  });

  // Maneja la verificación de token
  ipcMain.handle('auth:verify-token', async (event, token) => {
    try {
      // Verificar token
      const decoded = jwt.verify(token, JWT_SECRET);
      
      // Verificar que el usuario exista en la base de datos
      const db = await database.getConnection();
      const user = await db.get('SELECT * FROM users WHERE id = ?', [decoded.id]);
      
      if (!user) {
        return {
          valid: false,
          message: 'Usuario no encontrado'
        };
      }
      
      // Verificar si el token fue emitido antes de cambio de contraseña
      if (user.passwordChangedAt && new Date(user.passwordChangedAt) > new Date(decoded.iat * 1000)) {
        return {
          valid: false,
          message: 'La contraseña ha sido cambiada. Por favor inicie sesión nuevamente'
        };
      }
      
      // Obtener permisos actualizados
      const permissions = await permissionsService.getUserPermissions(user.id, user.role);
      
      return {
        valid: true,
        user: {
          id: user.id,
          username: user.username,
          name: user.name,
          role: user.role,
          sucursalId: user.sucursalId
        },
        permissions
      };
    } catch (error) {
      return {
        valid: false,
        message: 'Token inválido o expirado'
      };
    }
  });
}

/**
 * Autenticar usuario con nombre de usuario y contraseña
 * @param {Object} credentials - Credenciales del usuario
 * @param {string} credentials.username - Nombre de usuario
 * @param {string} credentials.password - Contraseña
 * @param {string} [credentials.ip] - Dirección IP del cliente (opcional)
 * @returns {Promise<Object>} Resultado de la autenticación
 */
async function authenticateUser(credentials) {
  const { username, password, ip } = credentials;
  
  try {
    // Comprobar si estamos en modo offline
    const isOnline = await database.isConnectedToServer();
    
    if (!isOnline) {
      // En modo offline, usamos caché local de usuarios
      return await authenticateOffline(username, password);
    }
    
    // En modo online, usamos la base de datos normal
    const db = await database.getConnection();
    
    // Buscar usuario
    const user = await db.get('SELECT * FROM users WHERE username = ? AND active = 1', [username]);
    
    // Si no existe el usuario
    if (!user) {
      return {
        success: false,
        message: 'Usuario no encontrado o inactivo'
      };
    }
    
    // Comprobar intentos fallidos de login
    if (user.failedLoginAttempts >= 5 && user.lockUntil && new Date(user.lockUntil) > new Date()) {
      return {
        success: false,
        message: `Cuenta bloqueada por múltiples intentos fallidos. Intente nuevamente después de ${new Date(user.lockUntil).toLocaleTimeString()}`
      };
    }
    
    // Verificar contraseña
    const passwordMatch = await bcrypt.compare(password, user.password);
    
    if (!passwordMatch) {
      // Incrementar contador de intentos fallidos
      const failedAttempts = (user.failedLoginAttempts || 0) + 1;
      
      // Si hay demasiados intentos, bloquear temporalmente
      let lockUntil = null;
      if (failedAttempts >= 5) {
        // Bloquear por 15 minutos
        lockUntil = new Date(Date.now() + 15 * 60 * 1000);
      }
      
      await db.run(
        'UPDATE users SET failedLoginAttempts = ?, lockUntil = ? WHERE id = ?',
        [failedAttempts, lockUntil, user.id]
      );
      
      return {
        success: false,
        message: 'Contraseña incorrecta',
        ipAddress: ip
      };
    }
    
    // Resetear contador de intentos fallidos
    if (user.failedLoginAttempts > 0 || user.lockUntil) {
      await db.run(
        'UPDATE users SET failedLoginAttempts = 0, lockUntil = NULL WHERE id = ?',
        [user.id]
      );
    }
    
    // Verificar si el usuario tiene acceso a múltiples sucursales
    const sucursales = await db.all('SELECT id FROM user_branches WHERE userId = ?', [user.id]);
    const hasManyBranches = sucursales.length > 1;
    
    // Obtener permisos
    const permissions = await permissionsService.getUserPermissions(user.id, user.role);
    
    // Generar token
    const token = generateToken(user);
    
    // Actualizar último login
    await db.run(
      'UPDATE users SET lastLoginAt = ? WHERE id = ?',
      [new Date().toISOString(), user.id]
    );
    
    // Guardar credenciales para uso offline
    await cacheUserCredentials(user);
    
    return {
      success: true,
      user,
      token,
      hasManyBranches,
      permissions,
      ipAddress: ip
    };
  } catch (error) {
    logger.logError('auth', 'authentication_error', {
      username,
      error: error.message,
      stack: error.stack,
      timestamp: new Date()
    });
    
    return {
      success: false,
      message: 'Error en el servidor de autenticación',
      error: error.message
    };
  }
}

/**
 * Autenticar usuario en modo offline
 * @param {string} username - Nombre de usuario
 * @param {string} password - Contraseña
 * @returns {Promise<Object>} Resultado de la autenticación
 */
async function authenticateOffline(username, password) {
  try {
    // Obtener usuarios almacenados localmente
    const offlineUsers = await getOfflineUsers();
    
    // Buscar usuario
    const user = offlineUsers.find(u => u.username === username);
    
    if (!user) {
      return {
        success: false,
        message: 'Usuario no encontrado en caché offline'
      };
    }
    
    // Verificar contraseña
    const passwordMatch = await bcrypt.compare(password, user.password);
    
    if (!passwordMatch) {
      return {
        success: false,
        message: 'Contraseña incorrecta en modo offline'
      };
    }
    
    // Generar token
    const token = generateToken(user);
    
    // Obtener permisos del caché
    const permissions = user.cachedPermissions || [];
    
    // Determinar si tiene múltiples sucursales desde el caché
    const hasManyBranches = user.branches && user.branches.length > 1;
    
    return {
      success: true,
      user,
      token,
      permissions,
      hasManyBranches,
      isOfflineLogin: true
    };
  } catch (error) {
    logger.logError('auth', 'offline_authentication_error', {
      username,
      error: error.message,
      stack: error.stack,
      timestamp: new Date()
    });
    
    return {
      success: false,
      message: 'Error en la autenticación offline',
      error: error.message
    };
  }
}

/**
 * Almacena credenciales de usuario para uso offline
 * @param {Object} user - Datos del usuario
 */
async function cacheUserCredentials(user) {
  try {
    // Obtener permisos para guardar en caché
    const permissions = await permissionsService.getUserPermissions(user.id, user.role);
    
    // Obtener sucursales asociadas al usuario
    const db = await database.getConnection();
    const branches = await db.all('SELECT branchId FROM user_branches WHERE userId = ?', [user.id]);
    
    // Crear objeto de usuario para caché offline
    const offlineUser = {
      id: user.id,
      username: user.username,
      password: user.password, // Ya está hasheada
      name: user.name,
      role: user.role,
      sucursalId: user.sucursalId,
      cachedPermissions: permissions,
      branches: branches.map(b => b.branchId),
      cachedAt: new Date().toISOString()
    };
    
    // Obtener usuarios ya almacenados
    const offlineUsers = await getOfflineUsers();
    
    // Eliminar usuario si ya existía
    const filteredUsers = offlineUsers.filter(u => u.id !== user.id);
    
    // Agregar nueva versión
    filteredUsers.push(offlineUser);
    
    // Guardar en archivo
    const offlineDir = path.join(process.env.APPDATA || process.env.HOME, '.factusystem');
    if (!fs.existsSync(offlineDir)) {
      fs.mkdirSync(offlineDir, { recursive: true });
    }
    
    const filePath = path.join(offlineDir, 'offline-users.json');
    const encryptedData = encryptData(JSON.stringify(filteredUsers));
    
    fs.writeFileSync(filePath, encryptedData);
  } catch (error) {
    logger.logError('auth', 'cache_credentials_error', {
      userId: user.id,
      error: error.message,
      stack: error.stack,
      timestamp: new Date()
    });
  }
}

/**
 * Generar token JWT para autenticación
 * @param {Object} user - Datos del usuario
 * @returns {string} Token JWT
 */
function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      sucursalId: user.sucursalId
    },
    JWT_SECRET,
    {
      expiresIn: TOKEN_EXPIRATION
    }
  );
}

/**
 * Generar token temporal para proceso de 2FA
 * @param {Object} user - Datos del usuario
 * @returns {string} Token temporal
 */
function generateTemporaryToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      tempToken: true
    },
    JWT_SECRET,
    {
      expiresIn: '5m' // 5 minutos
    }
  );
}

/**
 * Cifrar datos para almacenamiento seguro
 * @param {string} data - Datos a cifrar
 * @returns {string} Datos cifrados en formato hexadecimal
 */
function encryptData(data) {
  // Clave derivada del nombre de la máquina y usuario para mayor seguridad
  const machineKey = require('os').hostname() + require('os').userInfo().username;
  const key = crypto.createHash('sha256').update(machineKey).digest('hex').substring(0, 32);
  
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key), iv);
  
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  return iv.toString('hex') + ':' + encrypted;
}

/**
 * Descifrar datos almacenados
 * @param {string} encryptedData - Datos cifrados
 * @returns {string} Datos descifrados
 */
function decryptData(encryptedData) {
  const machineKey = require('os').hostname() + require('os').userInfo().username;
  const key = crypto.createHash('sha256').update(machineKey).digest('hex').substring(0, 32);
  
  const parts = encryptedData.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];
  
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key), iv);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

module.exports = {
  initializeAuthHandlers,
  authenticateUser,
  generateToken,
  encryptData,
  decryptData
};