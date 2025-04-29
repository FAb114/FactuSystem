/**
 * @file empresa.js
 * @description Módulo para la gestión de configuración de datos de empresa en FactuSystem
 * @requires utils/database.js
 * @requires utils/validation.js
 * @requires utils/logger.js
 * @requires integrations/arca/api.js
 */

// Importaciones
const { ipcRenderer } = require('electron');
const database = require('../../utils/database.js');
const validation = require('../../utils/validation.js');
const logger = require('../../utils/logger.js');
const arcaAPI = require('../../../../../integrations/arca/api.js');

// Variables globales del módulo
let currentConfig = null;
let certificadoFile = null;
let logoFile = null;
let isEditMode = false;

/**
 * Inicializa el módulo de configuración de empresa
 */
const initEmpresaModule = async () => {
    try {
        // Cargar configuración actual desde la base de datos
        await loadEmpresaConfig();
        
        // Configurar listeners de eventos
        setupEventListeners();
        
        // Inicializar estado de la interfaz
        updateUIState();
        
        logger.info('Módulo de configuración de empresa inicializado correctamente');
    } catch (error) {
        logger.error('Error al inicializar módulo de configuración de empresa', error);
        showNotification('error', 'Error al cargar configuración de empresa');
    }
};

/**
 * Carga la configuración de la empresa desde la base de datos
 */
const loadEmpresaConfig = async () => {
    try {
        // Obtener configuración de la base de datos
        currentConfig = await database.getEmpresaConfig();
        
        if (currentConfig) {
            // Llenar formulario con la configuración existente
            document.getElementById('empresa-razon-social').value = currentConfig.razonSocial || '';
            document.getElementById('empresa-nombre-fantasia').value = currentConfig.nombreFantasia || '';
            document.getElementById('empresa-cuit').value = currentConfig.cuit || '';
            document.getElementById('empresa-direccion').value = currentConfig.direccion || '';
            document.getElementById('empresa-localidad').value = currentConfig.localidad || '';
            document.getElementById('empresa-provincia').value = currentConfig.provincia || '';
            document.getElementById('empresa-codigo-postal').value = currentConfig.codigoPostal || '';
            document.getElementById('empresa-telefono').value = currentConfig.telefono || '';
            document.getElementById('empresa-email').value = currentConfig.email || '';
            document.getElementById('empresa-sitio-web').value = currentConfig.sitioWeb || '';
            
            // Configuración fiscal
            document.getElementById('empresa-condicion-iva').value = currentConfig.condicionIVA || '';
            document.getElementById('empresa-ingresos-brutos').value = currentConfig.ingresosBrutos || '';
            document.getElementById('empresa-inicio-actividades').value = currentConfig.inicioActividades || '';
            
            // Configuración AFIP/ARCA
            document.getElementById('empresa-punto-venta').value = currentConfig.puntoVenta || '';
            document.getElementById('empresa-clave-fiscal').value = currentConfig.claveFiscal ? '••••••••' : '';
            document.getElementById('empresa-homologacion').checked = currentConfig.modoHomologacion || false;
            
            // Configuración avanzada
            document.getElementById('empresa-certificado-password').value = currentConfig.certificadoPassword ? '••••••••' : '';
            
            // Mostrar logo si existe
            if (currentConfig.logoBase64) {
                document.getElementById('empresa-logo-preview').src = currentConfig.logoBase64;
                document.getElementById('empresa-logo-preview').classList.remove('hidden');
            }
            
            // Mostrar estado de certificado si existe
            if (currentConfig.certificadoFiscal) {
                document.getElementById('certificado-status').textContent = 'Certificado cargado';
                document.getElementById('certificado-status').classList.add('text-success');
                document.getElementById('certificado-status').classList.remove('text-danger');
            } else {
                document.getElementById('certificado-status').textContent = 'Sin certificado';
                document.getElementById('certificado-status').classList.add('text-danger');
                document.getElementById('certificado-status').classList.remove('text-success');
            }
            
            // Verificar estado de conexión con AFIP/ARCA
            checkArcaStatus();
        } else {
            // No hay configuración previa, inicializar formulario vacío
            resetForm();
        }
    } catch (error) {
        logger.error('Error al cargar configuración de empresa', error);
        throw error;
    }
};

/**
 * Configura los listeners para eventos de UI
 */
const setupEventListeners = () => {
    // Botón guardar configuración
    document.getElementById('empresa-save-btn').addEventListener('click', saveEmpresaConfig);
    
    // Botón editar configuración
    document.getElementById('empresa-edit-btn').addEventListener('click', () => {
        isEditMode = true;
        updateUIState();
    });

    // Botón cancelar edición
    document.getElementById('empresa-cancel-btn').addEventListener('click', () => {
        isEditMode = false;
        loadEmpresaConfig(); // Recargar datos originales
        updateUIState();
    });
    
    // Selector de logo
    document.getElementById('empresa-logo-selector').addEventListener('change', handleLogoSelection);
    
    // Selector de certificado fiscal
    document.getElementById('empresa-certificado-selector').addEventListener('change', handleCertificadoSelection);
    
    // Botón para verificar conexión con AFIP/ARCA
    document.getElementById('verificar-arca-btn').addEventListener('click', verificarConexionArca);
    
    // Botón para verificar punto de venta
    document.getElementById('verificar-punto-venta-btn').addEventListener('click', verificarPuntoVenta);

    // Botón para generar certificado (en caso de tener esta opción)
    if (document.getElementById('generar-certificado-btn')) {
        document.getElementById('generar-certificado-btn').addEventListener('click', generarSolicitudCertificado);
    }

    // Botones para mostrar/ocultar contraseñas
    document.querySelectorAll('.toggle-password').forEach(button => {
        button.addEventListener('click', togglePasswordVisibility);
    });
};

/**
 * Actualiza el estado de la interfaz según el modo (edición o visualización)
 */
const updateUIState = () => {
    const formInputs = document.querySelectorAll('#empresa-form input, #empresa-form select, #empresa-form textarea');
    const editBtn = document.getElementById('empresa-edit-btn');
    const saveBtn = document.getElementById('empresa-save-btn');
    const cancelBtn = document.getElementById('empresa-cancel-btn');
    
    // Habilitar/deshabilitar campos según el modo
    formInputs.forEach(input => {
        input.disabled = !isEditMode;
    });
    
    // Mostrar/ocultar botones según el modo
    if (isEditMode) {
        editBtn.classList.add('hidden');
        saveBtn.classList.remove('hidden');
        cancelBtn.classList.remove('hidden');
    } else {
        editBtn.classList.remove('hidden');
        saveBtn.classList.add('hidden');
        cancelBtn.classList.add('hidden');
    }
    
    // Actualizar clases para reflejar el estado de edición
    const formContainer = document.getElementById('empresa-form-container');
    if (isEditMode) {
        formContainer.classList.add('edit-mode');
    } else {
        formContainer.classList.remove('edit-mode');
    }
};

/**
 * Maneja la selección de un archivo de logo
 * @param {Event} event - Evento de cambio en el input file
 */
const handleLogoSelection = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    
    // Validar que sea una imagen
    if (!file.type.match('image.*')) {
        showNotification('error', 'El archivo seleccionado no es una imagen válida');
        return;
    }
    
    // Almacenar archivo para procesamiento posterior
    logoFile = file;
    
    // Mostrar preview de la imagen
    const reader = new FileReader();
    reader.onload = (e) => {
        document.getElementById('empresa-logo-preview').src = e.target.result;
        document.getElementById('empresa-logo-preview').classList.remove('hidden');
    };
    reader.readAsDataURL(file);
};

/**
 * Maneja la selección de un archivo de certificado fiscal
 * @param {Event} event - Evento de cambio en el input file
 */
const handleCertificadoSelection = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    
    // Validar que sea un certificado .pfx o .p12
    if (!file.name.match(/\.(pfx|p12)$/i)) {
        showNotification('error', 'El archivo seleccionado no es un certificado válido (.pfx o .p12)');
        return;
    }
    
    // Almacenar archivo para procesamiento posterior
    certificadoFile = file;
    
    // Actualizar status del certificado
    document.getElementById('certificado-status').textContent = `Certificado seleccionado: ${file.name}`;
    document.getElementById('certificado-status').classList.add('text-success');
    document.getElementById('certificado-status').classList.remove('text-danger');
};

/**
 * Guarda la configuración de la empresa
 */
const saveEmpresaConfig = async () => {
    try {
        // Validar formulario
        if (!validateEmpresaForm()) {
            return;
        }
        
        // Mostrar indicador de carga
        showLoading(true);
        
        // Recopilar datos del formulario
        const configData = {
            razonSocial: document.getElementById('empresa-razon-social').value,
            nombreFantasia: document.getElementById('empresa-nombre-fantasia').value,
            cuit: document.getElementById('empresa-cuit').value,
            direccion: document.getElementById('empresa-direccion').value,
            localidad: document.getElementById('empresa-localidad').value,
            provincia: document.getElementById('empresa-provincia').value,
            codigoPostal: document.getElementById('empresa-codigo-postal').value,
            telefono: document.getElementById('empresa-telefono').value,
            email: document.getElementById('empresa-email').value,
            sitioWeb: document.getElementById('empresa-sitio-web').value,
            
            // Datos fiscales
            condicionIVA: document.getElementById('empresa-condicion-iva').value,
            ingresosBrutos: document.getElementById('empresa-ingresos-brutos').value,
            inicioActividades: document.getElementById('empresa-inicio-actividades').value,
            
            // Configuración AFIP/ARCA
            puntoVenta: document.getElementById('empresa-punto-venta').value,
            modoHomologacion: document.getElementById('empresa-homologacion').checked,
        };
        
        // Procesar contraseña del certificado (si se cambió)
        const certificadoPassword = document.getElementById('empresa-certificado-password').value;
        if (certificadoPassword && certificadoPassword !== '••••••••') {
            configData.certificadoPassword = certificadoPassword;
        } else if (currentConfig && currentConfig.certificadoPassword) {
            configData.certificadoPassword = currentConfig.certificadoPassword;
        }
        
        // Procesar clave fiscal (si se cambió)
        const claveFiscal = document.getElementById('empresa-clave-fiscal').value;
        if (claveFiscal && claveFiscal !== '••••••••') {
            configData.claveFiscal = claveFiscal;
        } else if (currentConfig && currentConfig.claveFiscal) {
            configData.claveFiscal = currentConfig.claveFiscal;
        }
        
        // Procesar logo (si se seleccionó uno nuevo)
        if (logoFile) {
            configData.logoBase64 = await fileToBase64(logoFile);
        } else if (currentConfig && currentConfig.logoBase64) {
            configData.logoBase64 = currentConfig.logoBase64;
        }
        
        // Procesar certificado (si se seleccionó uno nuevo)
        if (certificadoFile) {
            configData.certificadoFiscal = await fileToBase64(certificadoFile);
            
            // Verificar que el certificado sea válido con la contraseña proporcionada
            try {
                await arcaAPI.verificarCertificado(
                    configData.certificadoFiscal, 
                    configData.certificadoPassword
                );
            } catch (certError) {
                showLoading(false);
                showNotification('error', 'La contraseña del certificado no es válida o el certificado está dañado');
                return;
            }
        } else if (currentConfig && currentConfig.certificadoFiscal) {
            configData.certificadoFiscal = currentConfig.certificadoFiscal;
        }
        
        // Guardar en la base de datos
        await database.saveEmpresaConfig(configData);
        
        // Actualizar configuración actual
        currentConfig = configData;
        
        // Configurar integración con ARCA
        await configurarArca(configData);
        
        // Actualizar UI
        isEditMode = false;
        updateUIState();
        
        // Mostrar notificación de éxito
        showNotification('success', 'Configuración de empresa guardada correctamente');
        
        // Registrar en el log
        logger.info('Configuración de empresa actualizada', { usuario: getCurrentUser() });
    } catch (error) {
        logger.error('Error al guardar configuración de empresa', error);
        showNotification('error', 'Error al guardar la configuración de empresa');
    } finally {
        showLoading(false);
    }
};

/**
 * Valida el formulario de configuración de empresa
 * @returns {boolean} - True si el formulario es válido, false en caso contrario
 */
const validateEmpresaForm = () => {
    // Validar campos obligatorios
    const requiredFields = [
        'empresa-razon-social',
        'empresa-cuit',
        'empresa-direccion',
        'empresa-localidad',
        'empresa-provincia',
        'empresa-condicion-iva'
    ];
    
    let isValid = true;
    
    requiredFields.forEach(fieldId => {
        const field = document.getElementById(fieldId);
        if (!field.value.trim()) {
            field.classList.add('is-invalid');
            isValid = false;
        } else {
            field.classList.remove('is-invalid');
        }
    });
    
    // Validar formato de CUIT
    const cuitField = document.getElementById('empresa-cuit');
    if (cuitField.value && !validation.validateCUIT(cuitField.value)) {
        cuitField.classList.add('is-invalid');
        document.getElementById('cuit-error').textContent = 'CUIT inválido';
        isValid = false;
    }
    
    // Validar formato de email
    const emailField = document.getElementById('empresa-email');
    if (emailField.value && !validation.validateEmail(emailField.value)) {
        emailField.classList.add('is-invalid');
        document.getElementById('email-error').textContent = 'Email inválido';
        isValid = false;
    }
    
    // Validar certificado si se está configurando AFIP/ARCA
    if (document.getElementById('empresa-punto-venta').value) {
        // Si hay punto de venta configurado pero no hay certificado ni se está subiendo uno nuevo
        if (!certificadoFile && (!currentConfig || !currentConfig.certificadoFiscal)) {
            showNotification('error', 'Debe cargar un certificado fiscal para usar facturación electrónica');
            isValid = false;
        }
        
        // Si hay certificado nuevo pero no contraseña
        if (certificadoFile && !document.getElementById('empresa-certificado-password').value) {
            document.getElementById('empresa-certificado-password').classList.add('is-invalid');
            isValid = false;
        }
    }
    
    if (!isValid) {
        showNotification('error', 'Por favor, complete correctamente todos los campos requeridos');
    }
    
    return isValid;
};

/**
 * Configura la integración con ARCA (AFIP)
 * @param {Object} configData - Configuración de la empresa
 */
const configurarArca = async (configData) => {
    try {
        // Solo configurar si hay punto de venta y certificado
        if (configData.puntoVenta && configData.certificadoFiscal && configData.certificadoPassword) {
            await arcaAPI.configurar({
                cuit: configData.cuit,
                razonSocial: configData.razonSocial,
                puntoVenta: configData.puntoVenta,
                certificado: configData.certificadoFiscal,
                certificadoPassword: configData.certificadoPassword,
                claveFiscal: configData.claveFiscal || null,
                modoHomologacion: configData.modoHomologacion,
                direccion: configData.direccion,
                localidad: configData.localidad,
                provincia: configData.provincia,
                codigoPostal: configData.codigoPostal,
                ingresosBrutos: configData.ingresosBrutos,
                inicioActividades: configData.inicioActividades,
                condicionIVA: configData.condicionIVA
            });
            
            logger.info('Integración con ARCA configurada correctamente');
        }
    } catch (error) {
        logger.error('Error al configurar integración con ARCA', error);
        showNotification('warning', 'La configuración se guardó pero hubo un problema al configurar ARCA (AFIP)');
    }
};

/**
 * Verifica la conexión con AFIP a través de ARCA
 */
const verificarConexionArca = async () => {
    try {
        showLoading(true);
        
        // Verificar que haya configuración básica
        if (!currentConfig || !currentConfig.cuit || !currentConfig.certificadoFiscal) {
            showNotification('error', 'Debe guardar la configuración con certificado antes de verificar la conexión');
            showLoading(false);
            return;
        }
        
        // Intentar conexión con ARCA/AFIP
        const estado = await arcaAPI.verificarConexion();
        
        if (estado.conectado) {
            showNotification('success', `Conexión exitosa con ${currentConfig.modoHomologacion ? 'AFIP Homologación' : 'AFIP Producción'}`);
            document.getElementById('arca-status').textContent = 'Conectado';
            document.getElementById('arca-status').classList.add('text-success');
            document.getElementById('arca-status').classList.remove('text-danger');
        } else {
            showNotification('error', `Error al conectar con AFIP: ${estado.mensaje}`);
            document.getElementById('arca-status').textContent = 'No conectado';
            document.getElementById('arca-status').classList.add('text-danger');
            document.getElementById('arca-status').classList.remove('text-success');
        }
    } catch (error) {
        logger.error('Error al verificar conexión con ARCA', error);
        showNotification('error', 'Error al verificar conexión con AFIP');
        
        document.getElementById('arca-status').textContent = 'Error';
        document.getElementById('arca-status').classList.add('text-danger');
        document.getElementById('arca-status').classList.remove('text-success');
    } finally {
        showLoading(false);
    }
};

/**
 * Verifica el punto de venta con AFIP
 */
const verificarPuntoVenta = async () => {
    try {
        const puntoVenta = document.getElementById('empresa-punto-venta').value;
        
        if (!puntoVenta) {
            showNotification('error', 'Ingrese un número de punto de venta');
            return;
        }
        
        showLoading(true);
        
        // Verificar punto de venta con ARCA/AFIP
        const resultado = await arcaAPI.verificarPuntoVenta(puntoVenta);
        
        if (resultado.existe) {
            showNotification('success', `Punto de venta ${puntoVenta} verificado correctamente`);
            document.getElementById('punto-venta-status').textContent = 'Verificado';
            document.getElementById('punto-venta-status').classList.add('text-success');
            document.getElementById('punto-venta-status').classList.remove('text-danger');
        } else {
            showNotification('error', `El punto de venta ${puntoVenta} no existe o no está habilitado`);
            document.getElementById('punto-venta-status').textContent = 'No verificado';
            document.getElementById('punto-venta-status').classList.add('text-danger');
            document.getElementById('punto-venta-status').classList.remove('text-success');
        }
    } catch (error) {
        logger.error('Error al verificar punto de venta', error);
        showNotification('error', 'Error al verificar punto de venta con AFIP');
    } finally {
        showLoading(false);
    }
};

/**
 * Genera una solicitud de certificado digital para AFIP
 * Esto solo se usaría si la aplicación tuviera la capacidad de generar CSRs
 */
const generarSolicitudCertificado = async () => {
    try {
        const cuit = document.getElementById('empresa-cuit').value;
        const razonSocial = document.getElementById('empresa-razon-social').value;
        
        if (!cuit || !razonSocial) {
            showNotification('error', 'Debe completar CUIT y Razón Social para generar un certificado');
            return;
        }
        
        showLoading(true);
        
        // Generar CSR usando ARCA API
        const resultado = await arcaAPI.generarCSR({
            cuit: cuit,
            razonSocial: razonSocial,
            pais: 'AR',
            provincia: document.getElementById('empresa-provincia').value,
            localidad: document.getElementById('empresa-localidad').value
        });
        
        // Ofrecer descarga del CSR
        if (resultado.csr) {
            // Usar ipcRenderer para solicitar guardado de archivo
            ipcRenderer.invoke('save-file', {
                defaultPath: `CSR-${cuit}.csr`,
                data: resultado.csr
            }).then(saved => {
                if (saved) {
                    showNotification('success', 'Solicitud de certificado generada correctamente');
                    
                    // Mostrar modal con instrucciones para el siguiente paso en AFIP
                    showCertificadoInstrucciones();
                }
            });
        } else {
            showNotification('error', 'Error al generar solicitud de certificado');
        }
    } catch (error) {
        logger.error('Error al generar solicitud de certificado', error);
        showNotification('error', 'Error al generar solicitud de certificado');
    } finally {
        showLoading(false);
    }
};

/**
 * Muestra instrucciones para completar el proceso de certificado en AFIP
 */
const showCertificadoInstrucciones = () => {
    // Implementar según necesidad (modal, etc.)
    const modal = document.getElementById('certificado-instrucciones-modal');
    if (modal) {
        // Si hay un modal ya definido en el HTML, mostrarlo
        modal.classList.remove('hidden');
    } else {
        // Si no hay modal, mostrar notificación con enlace
        showNotification('info', 'Acceda a la web de AFIP para completar el proceso con el CSR generado', 10000);
    }
};

/**
 * Verifica el estado de conexión con ARCA al cargar la página
 */
const checkArcaStatus = async () => {
    try {
        // Solo verificar si hay configuración de ARCA
        if (currentConfig && currentConfig.certificadoFiscal && currentConfig.puntoVenta) {
            const estado = await arcaAPI.verificarConexion();
            
            const arcaStatusElement = document.getElementById('arca-status');
            const puntoVentaStatusElement = document.getElementById('punto-venta-status');
            
            if (estado.conectado) {
                arcaStatusElement.textContent = 'Conectado';
                arcaStatusElement.classList.add('text-success');
                arcaStatusElement.classList.remove('text-danger');
                
                // También verificar punto de venta
                const pvResult = await arcaAPI.verificarPuntoVenta(currentConfig.puntoVenta);
                if (pvResult.existe) {
                    puntoVentaStatusElement.textContent = 'Verificado';
                    puntoVentaStatusElement.classList.add('text-success');
                    puntoVentaStatusElement.classList.remove('text-danger');
                } else {
                    puntoVentaStatusElement.textContent = 'No verificado';
                    puntoVentaStatusElement.classList.add('text-danger');
                    puntoVentaStatusElement.classList.remove('text-success');
                }
            } else {
                arcaStatusElement.textContent = 'No conectado';
                arcaStatusElement.classList.add('text-danger');
                arcaStatusElement.classList.remove('text-success');
                
                puntoVentaStatusElement.textContent = 'No verificado';
                puntoVentaStatusElement.classList.add('text-danger');
                puntoVentaStatusElement.classList.remove('text-success');
            }
        }
    } catch (error) {
        logger.error('Error al verificar estado de ARCA', error);
        // No mostrar notificación para no molestar al usuario al cargar
    }
};

/**
 * Alterna la visibilidad de un campo de contraseña
 * @param {Event} event - Evento de clic
 */
const togglePasswordVisibility = (event) => {
    const button = event.currentTarget;
    const inputId = button.getAttribute('data-target');
    const input = document.getElementById(inputId);
    
    if (input.type === 'password') {
        input.type = 'text';
        button.innerHTML = '<i class="fa fa-eye-slash"></i>';
    } else {
        input.type = 'password';
        button.innerHTML = '<i class="fa fa-eye"></i>';
    }
};

/**
 * Convierte un archivo a base64
 * @param {File} file - El archivo a convertir
 * @returns {Promise<string>} - Cadena en formato base64
 */
const fileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = (error) => reject(error);
    });
};

/**
 * Muestra u oculta el indicador de carga
 * @param {boolean} show - Indica si se debe mostrar el indicador
 */
const showLoading = (show) => {
    const loadingIndicator = document.getElementById('loading-indicator');
    if (loadingIndicator) {
        if (show) {
            loadingIndicator.classList.remove('hidden');
        } else {
            loadingIndicator.classList.add('hidden');
        }
    }
    
    // También deshabilitar/habilitar botones según corresponda
    const buttons = document.querySelectorAll('button');
    buttons.forEach(button => {
        button.disabled = show;
    });
};

/**
 * Muestra una notificación al usuario
 * @param {string} type - Tipo de notificación (success, error, warning, info)
 * @param {string} message - Mensaje a mostrar
 * @param {number} duration - Duración en ms (por defecto 5000)
 */
const showNotification = (type, message, duration = 5000) => {
    // Si hay un sistema de notificaciones global, usarlo
    if (window.notifications && typeof window.notifications.show === 'function') {
        window.notifications.show(type, message, duration);
        return;
    }
    
    // Si no hay sistema global, crear notificación local
    const notifContainer = document.getElementById('notifications-container');
    if (!notifContainer) return;
    
    const notifElement = document.createElement('div');
    notifElement.className = `notification notification-${type}`;
    notifElement.innerHTML = `
        <div class="notification-icon">
            <i class="fa fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : type === 'warning' ? 'exclamation-triangle' : 'info-circle'}"></i>
        </div>
        <div class="notification-content">${message}</div>
        <div class="notification-close">
            <i class="fa fa-times"></i>
        </div>
    `;
    
    notifContainer.appendChild(notifElement);
    
    // Efecto de entrada
    setTimeout(() => {
        notifElement.classList.add('show');
    }, 10);
    
    // Configurar cierre automático
    const closeTimeout = setTimeout(() => {
        closeNotification(notifElement);
    }, duration);
    
    // Configurar cierre manual
    const closeBtn = notifElement.querySelector('.notification-close');
    closeBtn.addEventListener('click', () => {
        clearTimeout(closeTimeout);
        closeNotification(notifElement);
    });
};

/**
 * Cierra una notificación con animación
 * @param {HTMLElement} notifElement - Elemento de notificación a cerrar
 */
const closeNotification = (notifElement) => {
    notifElement.classList.remove('show');
    notifElement.classList.add('hide');
    
    setTimeout(() => {
        if (notifElement.parentNode) {
            notifElement.parentNode.removeChild(notifElement);
        }
    }, 300); // Tiempo de la animación de salida
};

/**
 * Obtiene el usuario actual del sistema
 * @returns {string} - ID o nombre del usuario actual
 */
const getCurrentUser = () => {
    // Implementar según cómo se maneje la sesión en la aplicación
    return sessionStorage.getItem('currentUser') || 'unknown';
};

/**
 * Reinicia el formulario a valores vacíos
 */
const resetForm = () => {
    // Limpiar todos los campos del formulario
    document.getElementById('empresa-razon-social').value = '';
    document.getElementById('empresa-nombre-fantasia').value = '';
    document.getElementById('empresa-cuit').value = '';
    document.getElementById('empresa-direccion').value = '';
    document.getElementById('empresa-localidad').value = '';
    document.getElementById('empresa-provincia').value = '';
    document.getElementById('empresa-codigo-postal').value = '';
    document.getElementById('empresa-telefono').value = '';
    document.getElementById('empresa-email').value = '';
    document.getElementById('empresa-sitio-web').value = '';
    
    // Configuración fiscal
    document.getElementById('empresa-condicion-iva').value = '';
    document.getElementById('empresa-ingresos-brutos').value = '';
    document.getElementById('empresa-inicio-actividades').value = '';
    
    // Configuración AFIP/ARCA
    document.getElementById('empresa-punto-venta').value = '';
    document.getElementById('empresa-clave-fiscal').value = '';
    document.getElementById('empresa-homologacion').checked = true; // Por defecto en modo homologación
    
    // Configuración avanzada
    document.getElementById('empresa-certificado-password').value = '';
    
    // Limpiar logo si existe
    document.getElementById('empresa-logo-preview').src = '';
    document.getElementById('empresa-logo-preview').classList.add('hidden');
    
    // Limpiar estado de certificado
    document.getElementById('certificado-status').textContent = 'Sin certificado';
    document.getElementById('certificado-status').classList.add('text-danger');
    document.getElementById('certificado-status').classList.remove('text-success');
    
    // Reset de archivos
    certificadoFile = null;
    logoFile = null;
    
    // Reset de variables de estado
    isEditMode = true; // Poner en modo edición ya que es configuración inicial
    updateUIState();
};

/**
 * Exporta la configuración de la empresa como un archivo JSON
 */
const exportarConfiguracion = async () => {
    try {
        if (!currentConfig) {
            showNotification('error', 'No hay configuración para exportar');
            return;
        }
        
        showLoading(true);
        
        // Crear una copia segura de la configuración (sin passwords)
        const configToExport = { ...currentConfig };
        
        // Eliminar datos sensibles
        delete configToExport.claveFiscal;
        delete configToExport.certificadoPassword;
        
        // Solicitar al proceso principal que guarde el archivo
        const saved = await ipcRenderer.invoke('save-file', {
            defaultPath: `FactuSystem-Empresa-${configToExport.cuit}.json`,
            data: JSON.stringify(configToExport, null, 2),
            filters: [{ name: 'Archivos JSON', extensions: ['json'] }]
        });
        
        if (saved) {
            showNotification('success', 'Configuración exportada correctamente');
            logger.info('Configuración de empresa exportada', { usuario: getCurrentUser() });
        }
    } catch (error) {
        logger.error('Error al exportar configuración', error);
        showNotification('error', 'Error al exportar la configuración');
    } finally {
        showLoading(false);
    }
};

/**
 * Importa la configuración de empresa desde un archivo JSON
 */
const importarConfiguracion = async () => {
    try {
        showLoading(true);
        
        // Solicitar al proceso principal que abra un selector de archivos
        const result = await ipcRenderer.invoke('open-file', {
            filters: [{ name: 'Archivos JSON', extensions: ['json'] }]
        });
        
        if (!result || !result.data) {
            showLoading(false);
            return;
        }
        
        // Parsear el archivo JSON
        let importedConfig;
        try {
            importedConfig = JSON.parse(result.data);
        } catch (parseError) {
            showNotification('error', 'El archivo seleccionado no es un JSON válido');
            showLoading(false);
            return;
        }
        
        // Validar que sea una configuración de empresa válida
        if (!importedConfig.razonSocial || !importedConfig.cuit) {
            showNotification('error', 'El archivo no contiene una configuración de empresa válida');
            showLoading(false);
            return;
        }
        
        // Pedir confirmación antes de sobrescribir
        if (currentConfig) {
            if (!confirm('¿Está seguro de que desea sobrescribir la configuración actual?')) {
                showLoading(false);
                return;
            }
        }
        
        // Conservar datos sensibles si existen en la configuración actual
        if (currentConfig) {
            if (currentConfig.claveFiscal && !importedConfig.claveFiscal) {
                importedConfig.claveFiscal = currentConfig.claveFiscal;
            }
            
            if (currentConfig.certificadoPassword && !importedConfig.certificadoPassword) {
                importedConfig.certificadoPassword = currentConfig.certificadoPassword;
            }
            
            if (currentConfig.certificadoFiscal && !importedConfig.certificadoFiscal) {
                importedConfig.certificadoFiscal = currentConfig.certificadoFiscal;
            }
        }
        
        // Guardar la configuración importada
        await database.saveEmpresaConfig(importedConfig);
        
        // Actualizar configuración actual
        currentConfig = importedConfig;
        
        // Recargar el formulario
        await loadEmpresaConfig();
        
        // Configurar integración con ARCA si corresponde
        if (importedConfig.certificadoFiscal && importedConfig.puntoVenta) {
            await configurarArca(importedConfig);
        }
        
        showNotification('success', 'Configuración importada correctamente');
        logger.info('Configuración de empresa importada', { usuario: getCurrentUser() });
    } catch (error) {
        logger.error('Error al importar configuración', error);
        showNotification('error', 'Error al importar la configuración');
    } finally {
        showLoading(false);
    }
};

/**
 * Realiza una prueba completa de facturación electrónica
 */
const testFacturacionElectronica = async () => {
    try {
        if (!currentConfig || !currentConfig.certificadoFiscal || !currentConfig.puntoVenta) {
            showNotification('error', 'Debe configurar certificado y punto de venta para realizar la prueba');
            return;
        }
        
        showLoading(true);
        
        // Verificar conexión con AFIP
        const estadoConexion = await arcaAPI.verificarConexion();
        if (!estadoConexion.conectado) {
            showNotification('error', `No se pudo conectar con AFIP: ${estadoConexion.mensaje}`);
            showLoading(false);
            return;
        }
        
        // Crear una factura de prueba
        const facturaTest = {
            tipo: 'FACTURA_B', // o el que corresponda según configuración
            puntoVenta: currentConfig.puntoVenta,
            concepto: 'PRODUCTOS',
            tipoDocumento: 'CUIT',
            numeroDocumento: currentConfig.modoHomologacion ? '20000000000' : currentConfig.cuit, // En homologación usar CUIT de prueba
            fechaEmision: new Date().toISOString().split('T')[0],
            importeTotal: 121,
            importeNeto: 100,
            importeIVA: 21,
            cliente: {
                razonSocial: 'CLIENTE DE PRUEBA',
                domicilio: 'DOMICILIO DE PRUEBA',
                condicionIVA: 'CONSUMIDOR_FINAL'
            },
            items: [
                {
                    descripcion: 'Producto de prueba',
                    cantidad: 1,
                    precioUnitario: 100,
                    alicuotaIVA: 21,
                    importeItem: 121
                }
            ]
        };
        
        // Generar factura electrónica
        const resultado = await arcaAPI.generarFactura(facturaTest);
        
        if (resultado.success) {
            showNotification('success', `Prueba exitosa: CAE ${resultado.cae} (Vto: ${resultado.fechaVencimientoCAE})`);
            
            // Mostrar modal con detalles
            const modalContent = `
                <h3>Prueba de Facturación Exitosa</h3>
                <p><strong>CAE obtenido:</strong> ${resultado.cae}</p>
                <p><strong>Vencimiento CAE:</strong> ${resultado.fechaVencimientoCAE}</p>
                <p><strong>Número:</strong> ${resultado.numeroComprobante}</p>
                <p><strong>Ambiente:</strong> ${currentConfig.modoHomologacion ? 'Homologación' : 'Producción'}</p>
                <p class="text-success"><i class="fa fa-check-circle"></i> La configuración de facturación electrónica es correcta</p>
            `;
            
            // Mostrar modal (implementar según necesidad)
            showTestResultModal(modalContent);
            
            logger.info('Prueba de facturación electrónica exitosa', {
                usuario: getCurrentUser(),
                cae: resultado.cae
            });
        } else {
            showNotification('error', `Error en la prueba: ${resultado.error}`);
            
            // Mostrar modal con detalles del error
            const modalContent = `
                <h3>Error en Prueba de Facturación</h3>
                <p class="text-danger"><strong>Error:</strong> ${resultado.error}</p>
                <p><strong>Detalle:</strong> ${resultado.errorDetalle || 'No disponible'}</p>
                <p><strong>Ambiente:</strong> ${currentConfig.modoHomologacion ? 'Homologación' : 'Producción'}</p>
                <p>Se recomienda verificar la configuración de AFIP y el certificado digital.</p>
            `;
            
            // Mostrar modal (implementar según necesidad)
            showTestResultModal(modalContent);
            
            logger.error('Error en prueba de facturación electrónica', {
                usuario: getCurrentUser(),
                error: resultado.error,
                detalle: resultado.errorDetalle
            });
        }
    } catch (error) {
        logger.error('Error al realizar prueba de facturación', error);
        showNotification('error', 'Error al realizar la prueba de facturación');
    } finally {
        showLoading(false);
    }
};

/**
 * Muestra un modal con el resultado de la prueba de facturación
 * @param {string} content - Contenido HTML para mostrar en el modal
 */
const showTestResultModal = (content) => {
    // Implementar según el sistema de modales de la aplicación
    const modal = document.getElementById('test-facturacion-modal');
    const modalContent = document.getElementById('test-facturacion-content');
    
    if (modal && modalContent) {
        modalContent.innerHTML = content;
        modal.classList.remove('hidden');
        
        // Configurar cierre del modal
        const closeButtons = modal.querySelectorAll('.close-modal');
        closeButtons.forEach(button => {
            button.addEventListener('click', () => {
                modal.classList.add('hidden');
            });
        });
    } else {
        // Si no hay modal, mostrar como notificación
        showNotification('info', 'Vea la consola para detalles de la prueba', 10000);
        console.info('Resultado de prueba de facturación:', content);
    }
};

/**
 * Obtiene datos de la empresa para uso en otras partes de la aplicación
 * @returns {Promise<Object>} - Datos de la empresa
 */
const getDatosEmpresa = async () => {
    try {
        // Si ya hay datos cargados, devolverlos
        if (currentConfig) {
            return currentConfig;
        }
        
        // Si no hay datos cargados, cargarlos desde la base de datos
        const config = await database.getEmpresaConfig();
        currentConfig = config;
        return config;
    } catch (error) {
        logger.error('Error al obtener datos de empresa', error);
        throw error;
    }
};

/**
 * Inicializa listeners para los botones adicionales
 */
const setupAdditionalButtons = () => {
    // Botón para exportar configuración
    const exportarBtn = document.getElementById('exportar-config-btn');
    if (exportarBtn) {
        exportarBtn.addEventListener('click', exportarConfiguracion);
    }
    
    // Botón para importar configuración
    const importarBtn = document.getElementById('importar-config-btn');
    if (importarBtn) {
        importarBtn.addEventListener('click', importarConfiguracion);
    }
    
    // Botón para probar facturación electrónica
    const testFacturaBtn = document.getElementById('test-facturacion-btn');
    if (testFacturaBtn) {
        testFacturaBtn.addEventListener('click', testFacturacionElectronica);
    }
};

// Inicializar al cargar la página
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    // Inicializar al cargar la página (solo en el contexto del renderer)
    document.addEventListener('DOMContentLoaded', () => {
        initEmpresaModule();
        setupAdditionalButtons();
    });
} else {
    // Estamos en el proceso principal u otro entorno sin DOM
    console.log('Módulo empresa.js cargado en un entorno sin DOM (main process)');
    // Aquí puedes exportar solo las funciones que no dependan del DOM
}

// Exportar funciones públicas del módulo
module.exports = {
    initEmpresaModule,
    getDatosEmpresa,
    exportarConfiguracion,
    importarConfiguracion,
    verificarConexionArca,
    testFacturacionElectronica
};