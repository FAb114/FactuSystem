/**
 * BBVA Integration Module for FactuSystem
 * 
 * Este módulo maneja la integración con la API de BBVA para procesar pagos,
 * verificar transferencias y gestionar la configuración de la integración.
 * 
 * @module configuraciones/integraciones/bancos/bbva
 */

// Importaciones necesarias
const { ipcRenderer } = require('electron');
const apiCommon = require('../../../../../integrations/bancos/api');
const apiSpecific = require('../../../../../integrations/bancos/bbva');
const database = require('../../../../utils/database');
const logger = require('../../../../utils/logger');
const validation = require('../../../../utils/validation');
const notification = require('../../../../components/notifications');

/**
 * Clase que maneja la configuración e integración con BBVA
 */
class BBVAIntegration {
    constructor() {
        this.configData = null;
        this.isConfigured = false;
        this.testMode = true;
        this.statusInterval = null;
        this.lastConnectionCheck = null;
        this.connectionStatus = 'disconnected';
        
        // Elementos DOM que serán inicializados luego con initElements()
        this.elements = {
            form: null,
            clientIdInput: null,
            clientSecretInput: null,
            merchantIdInput: null,
            terminalIdInput: null,
            testModeToggle: null,
            webhookUrlInput: null,
            saveBtn: null,
            testConnectionBtn: null,
            statusIndicator: null,
            connectionTimestamp: null,
            resetBtn: null,
            apiDocsLink: null,
            accountInput: null,
            apiKeyInput: null
        };
        
        // Valores por defecto para entorno de pruebas
        this.defaultTestValues = {
            clientId: 'app.bbva.test.FactuSystem',
            clientSecret: 'test_secret_bbva_key',
            merchantId: 'TEST_MERCHANT',
            terminalId: 'TERM001',
            apiKey: 'bbva_test_api_key_xxxxx',
            account: '1234567890'
        };
    }

    /**
     * Inicializa el módulo de integración con BBVA
     */
    async init() {
        try {
            this.initElements();
            this.attachEventListeners();
            await this.loadConfiguration();
            this.updateUIWithConfig();
            this.initConnectionMonitor();
            
            logger.info('Módulo de integración con BBVA inicializado correctamente');
        } catch (error) {
            logger.error('Error al inicializar el módulo de BBVA:', error);
            notification.show('error', 'Error al inicializar la configuración de BBVA', error.message);
        }
    }

    /**
     * Inicializa las referencias a elementos del DOM
     */
    initElements() {
        this.elements.form = document.getElementById('bbva-config-form');
        this.elements.clientIdInput = document.getElementById('bbva-client-id');
        this.elements.clientSecretInput = document.getElementById('bbva-client-secret');
        this.elements.merchantIdInput = document.getElementById('bbva-merchant-id');
        this.elements.terminalIdInput = document.getElementById('bbva-terminal-id');
        this.elements.testModeToggle = document.getElementById('bbva-test-mode');
        this.elements.webhookUrlInput = document.getElementById('bbva-webhook-url');
        this.elements.saveBtn = document.getElementById('bbva-save-config');
        this.elements.testConnectionBtn = document.getElementById('bbva-test-connection');
        this.elements.statusIndicator = document.getElementById('bbva-connection-status');
        this.elements.connectionTimestamp = document.getElementById('bbva-last-connection');
        this.elements.resetBtn = document.getElementById('bbva-reset-config');
        this.elements.apiDocsLink = document.getElementById('bbva-api-docs');
        this.elements.accountInput = document.getElementById('bbva-account-number');
        this.elements.apiKeyInput = document.getElementById('bbva-api-key');
    }

    /**
     * Asocia eventos a los elementos del formulario
     */
    attachEventListeners() {
        if (this.elements.form) {
            this.elements.form.addEventListener('submit', (e) => {
                e.preventDefault();
                this.saveConfiguration();
            });
        }

        if (this.elements.testModeToggle) {
            this.elements.testModeToggle.addEventListener('change', () => {
                this.toggleTestMode();
            });
        }

        if (this.elements.testConnectionBtn) {
            this.elements.testConnectionBtn.addEventListener('click', () => {
                this.testConnection();
            });
        }

        if (this.elements.resetBtn) {
            this.elements.resetBtn.addEventListener('click', () => {
                this.resetConfiguration();
            });
        }
        
        // Generar webhook URL cuando cambie el ID del comerciante
        if (this.elements.merchantIdInput) {
            this.elements.merchantIdInput.addEventListener('change', () => {
                this.updateWebhookUrl();
            });
        }
    }

    /**
     * Carga la configuración actual desde la base de datos
     */
    async loadConfiguration() {
        try {
            const config = await database.getConfig('integraciones.bancos.bbva');
            
            if (config && Object.keys(config).length > 0) {
                this.configData = config;
                this.isConfigured = true;
                this.testMode = config.testMode || false;
                
                // Actualizar configuración en el módulo de API
                apiSpecific.updateConfig(this.configData);
                
                logger.info('Configuración de BBVA cargada correctamente');
            } else {
                // Crear estructura de configuración inicial
                this.configData = {
                    clientId: '',
                    clientSecret: '',
                    merchantId: '',
                    terminalId: '',
                    apiKey: '',
                    account: '',
                    testMode: true,
                    webhookUrl: this.generateWebhookUrl(''),
                    configured: false,
                    lastConnectionStatus: null,
                    lastConnectionTime: null
                };
                
                logger.info('No se encontró configuración previa de BBVA, se utilizará la configuración por defecto');
            }
        } catch (error) {
            logger.error('Error al cargar la configuración de BBVA:', error);
            notification.show('error', 'Error al cargar la configuración de BBVA', error.message);
        }
    }

    /**
     * Actualiza la interfaz de usuario con la configuración cargada
     */
    updateUIWithConfig() {
        if (!this.configData) return;
        
        if (this.elements.clientIdInput) {
            this.elements.clientIdInput.value = this.configData.clientId || '';
        }
        
        if (this.elements.clientSecretInput) {
            this.elements.clientSecretInput.value = this.configData.clientSecret || '';
        }
        
        if (this.elements.merchantIdInput) {
            this.elements.merchantIdInput.value = this.configData.merchantId || '';
        }
        
        if (this.elements.terminalIdInput) {
            this.elements.terminalIdInput.value = this.configData.terminalId || '';
        }
        
        if (this.elements.testModeToggle) {
            this.elements.testModeToggle.checked = this.configData.testMode || false;
        }
        
        if (this.elements.webhookUrlInput) {
            this.elements.webhookUrlInput.value = this.configData.webhookUrl || this.generateWebhookUrl(this.configData.merchantId || '');
        }
        
        if (this.elements.accountInput) {
            this.elements.accountInput.value = this.configData.account || '';
        }
        
        if (this.elements.apiKeyInput) {
            this.elements.apiKeyInput.value = this.configData.apiKey || '';
        }
        
        // Actualizar el estado de la conexión en la UI
        this.updateConnectionStatus(this.configData.lastConnectionStatus, this.configData.lastConnectionTime);
        
        // Actualizar visibilidad de elementos según configuración
        this.updateFormState();
    }

    /**
     * Actualiza el estado visual del formulario basado en la configuración
     */
    updateFormState() {
        const isConfigured = this.isConfigured;
        
        if (this.elements.testConnectionBtn) {
            this.elements.testConnectionBtn.disabled = !isConfigured;
        }
        
        const testMode = this.testMode;
        // Aplicar clases visuales al modo de prueba
        if (this.elements.form) {
            if (testMode) {
                this.elements.form.classList.add('test-mode-active');
            } else {
                this.elements.form.classList.remove('test-mode-active');
            }
        }
    }

    /**
     * Cambia entre modo de prueba y producción
     */
    toggleTestMode() {
        this.testMode = this.elements.testModeToggle.checked;
        
        if (this.testMode) {
            // Si se activa el modo de prueba, ofrecer usar valores por defecto
            if (!this.configData.clientId && !this.configData.clientSecret) {
                const useDefaults = confirm('¿Desea utilizar valores de prueba predeterminados para BBVA?');
                if (useDefaults) {
                    this.applyTestDefaults();
                }
            }
        }
        
        this.updateFormState();
    }

    /**
     * Aplica valores por defecto de prueba
     */
    applyTestDefaults() {
        if (this.elements.clientIdInput) {
            this.elements.clientIdInput.value = this.defaultTestValues.clientId;
        }
        
        if (this.elements.clientSecretInput) {
            this.elements.clientSecretInput.value = this.defaultTestValues.clientSecret;
        }
        
        if (this.elements.merchantIdInput) {
            this.elements.merchantIdInput.value = this.defaultTestValues.merchantId;
            this.updateWebhookUrl();
        }
        
        if (this.elements.terminalIdInput) {
            this.elements.terminalIdInput.value = this.defaultTestValues.terminalId;
        }
        
        if (this.elements.apiKeyInput) {
            this.elements.apiKeyInput.value = this.defaultTestValues.apiKey;
        }
        
        if (this.elements.accountInput) {
            this.elements.accountInput.value = this.defaultTestValues.account;
        }
    }

    /**
     * Genera la URL del webhook para notificaciones
     */
    generateWebhookUrl(merchantId) {
        // Generate a webhook URL for BBVA integration
        const baseUrl = window.location.origin || 'https://app.factusystem.com';
        return `${baseUrl}/api/webhooks/bbva/${merchantId || 'MERCHANT_ID'}`;
    }

    /**
     * Actualiza la URL del webhook cuando cambia el ID del comerciante
     */
    updateWebhookUrl() {
        if (this.elements.merchantIdInput && this.elements.webhookUrlInput) {
            const merchantId = this.elements.merchantIdInput.value.trim();
            this.elements.webhookUrlInput.value = this.generateWebhookUrl(merchantId);
        }
    }

    /**
     * Valida el formulario de configuración
     */
    validateForm() {
        const requiredFields = this.testMode ? 
            ['clientId', 'merchantId'] : 
            ['clientId', 'clientSecret', 'merchantId', 'terminalId', 'apiKey', 'account'];
            
        const formData = this.getFormData();
        
        // Validar campos requeridos
        for (const field of requiredFields) {
            if (!formData[field] || formData[field].trim() === '') {
                const fieldName = this.getFieldName(field);
                notification.show('warning', 'Validación de formulario', `El campo "${fieldName}" es obligatorio.`);
                return false;
            }
        }
        
        // Validaciones específicas
        if (!this.testMode) {
            // Validar formato de API Key
            if (!/^bbva_([a-z0-9_]+)_([a-zA-Z0-9]+)$/.test(formData.apiKey)) {
                notification.show('warning', 'Validación de API Key', 'El formato de la API Key no es válido. Debe comenzar con "bbva_" seguido del tipo y una cadena alfanumérica.');
                return false;
            }
            
            // Validar número de cuenta
            if (!/^\d{10}$/.test(formData.account)) {
                notification.show('warning', 'Validación de cuenta', 'El número de cuenta debe tener 10 dígitos.');
                return false;
            }
        }
        
        return true;
    }

    /**
     * Obtiene los nombres descriptivos de los campos
     */
    getFieldName(field) {
        const fieldNames = {
            clientId: 'ID de Cliente',
            clientSecret: 'Clave Secreta',
            merchantId: 'ID de Comercio',
            terminalId: 'ID de Terminal',
            apiKey: 'API Key',
            account: 'Número de Cuenta'
        };
        
        return fieldNames[field] || field;
    }

    /**
     * Obtiene los datos del formulario
     */
    getFormData() {
        return {
            clientId: this.elements.clientIdInput ? this.elements.clientIdInput.value.trim() : '',
            clientSecret: this.elements.clientSecretInput ? this.elements.clientSecretInput.value.trim() : '',
            merchantId: this.elements.merchantIdInput ? this.elements.merchantIdInput.value.trim() : '',
            terminalId: this.elements.terminalIdInput ? this.elements.terminalIdInput.value.trim() : '',
            apiKey: this.elements.apiKeyInput ? this.elements.apiKeyInput.value.trim() : '',
            account: this.elements.accountInput ? this.elements.accountInput.value.trim() : '',
            testMode: this.elements.testModeToggle ? this.elements.testModeToggle.checked : false,
            webhookUrl: this.elements.webhookUrlInput ? this.elements.webhookUrlInput.value.trim() : ''
        };
    }

    /**
     * Guarda la configuración en la base de datos
     */
    async saveConfiguration() {
        try {
            if (!this.validateForm()) {
                return;
            }
            
            const formData = this.getFormData();
            
            // Combinar con configuración existente
            this.configData = {
                ...this.configData,
                ...formData,
                configured: true,
                lastSaved: new Date().toISOString()
            };
            
            // Guardar en la base de datos
            await database.setConfig('integraciones.bancos.bbva', this.configData);
            
            // Actualizar configuración en el módulo de API
            apiSpecific.updateConfig(this.configData);
            
            this.isConfigured = true;
            this.updateFormState();
            
            notification.show('success', 'Configuración guardada', 'La configuración de BBVA se ha guardado correctamente.');
            
            // Registrar evento en log
            logger.info('Configuración de BBVA actualizada', { testMode: this.configData.testMode });
            
            // Si es la primera configuración, probar conexión automáticamente
            if (this.configData.lastConnectionStatus === null) {
                setTimeout(() => this.testConnection(), 1000);
            }
        } catch (error) {
            logger.error('Error al guardar la configuración de BBVA:', error);
            notification.show('error', 'Error al guardar', `No se pudo guardar la configuración: ${error.message}`);
        }
    }

    /**
     * Prueba la conexión con la API de BBVA
     */
    async testConnection() {
        if (!this.isConfigured) {
            notification.show('warning', 'Configuración incompleta', 'Complete y guarde la configuración antes de probar la conexión.');
            return;
        }
        
        try {
            if (this.elements.testConnectionBtn) {
                this.elements.testConnectionBtn.disabled = true;
                this.elements.testConnectionBtn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Probando...';
            }
            
            this.updateConnectionStatus('connecting');
            
            // Usar la API específica para BBVA
            const result = await apiSpecific.testConnection(this.configData);
            
            // Actualizar timestamp de la prueba
            const now = new Date();
            this.lastConnectionCheck = now;
            this.configData.lastConnectionTime = now.toISOString();
            
            if (result.success) {
                this.configData.lastConnectionStatus = 'connected';
                this.connectionStatus = 'connected';
                
                notification.show('success', 'Conexión exitosa', 'La conexión con BBVA se ha establecido correctamente.');
                logger.info('Prueba de conexión con BBVA exitosa', result.data);
                
                // Guardar información adicional que pudo haber retornado la API
                if (result.data && result.data.merchantInfo) {
                    this.configData.merchantInfo = result.data.merchantInfo;
                }
            } else {
                this.configData.lastConnectionStatus = 'error';
                this.connectionStatus = 'error';
                
                notification.show('error', 'Error de conexión', `No se pudo conectar con BBVA: ${result.message}`);
                logger.error('Error en prueba de conexión con BBVA', { error: result.message, code: result.code });
            }
            
            // Guardar el estado de la conexión
            await database.setConfig('integraciones.bancos.bbva', this.configData);
            
            // Actualizar UI
            this.updateConnectionStatus(this.configData.lastConnectionStatus, this.configData.lastConnectionTime);
        } catch (error) {
            this.configData.lastConnectionStatus = 'error';
            this.connectionStatus = 'error';
            this.configData.lastConnectionTime = new Date().toISOString();
            
            notification.show('error', 'Error de conexión', `Error al conectar con BBVA: ${error.message}`);
            logger.error('Excepción al probar conexión con BBVA:', error);
            
            // Guardar el estado de error
            await database.setConfig('integraciones.bancos.bbva', this.configData);
            
            // Actualizar UI
            this.updateConnectionStatus('error', this.configData.lastConnectionTime);
        } finally {
            if (this.elements.testConnectionBtn) {
                this.elements.testConnectionBtn.disabled = false;
                this.elements.testConnectionBtn.innerHTML = '<i class="fa fa-plug"></i> Probar Conexión';
            }
        }
    }

    /**
     * Actualiza el indicador visual del estado de la conexión
     */
    updateConnectionStatus(status, timestamp = null) {
        const statusElement = this.elements.statusIndicator;
        const timeElement = this.elements.connectionTimestamp;
        
        if (!statusElement) return;
        
        // Limpiar clases anteriores
        statusElement.classList.remove('status-connected', 'status-error', 'status-connecting', 'status-disconnected');
        
        // Establecer nueva clase según estado
        let statusText = '';
        let statusClass = '';
        
        switch (status) {
            case 'connected':
                statusText = 'Conectado';
                statusClass = 'status-connected';
                break;
            case 'error':
                statusText = 'Error de Conexión';
                statusClass = 'status-error';
                break;
            case 'connecting':
                statusText = 'Conectando...';
                statusClass = 'status-connecting';
                break;
            default:
                statusText = 'No Configurado';
                statusClass = 'status-disconnected';
        }
        
        statusElement.innerText = statusText;
        statusElement.classList.add(statusClass);
        
        // Actualizar timestamp si está disponible
        if (timeElement && timestamp) {
            const date = new Date(timestamp);
            timeElement.innerText = `Última verificación: ${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
        } else if (timeElement) {
            timeElement.innerText = 'Sin verificación reciente';
        }
    }

    /**
     * Inicializa el monitor de conexión para verificar periódicamente
     */
    initConnectionMonitor() {
        // Verificar la conexión cada 30 minutos si está configurado
        this.stopConnectionMonitor();
        
        this.statusInterval = setInterval(() => {
            if (this.isConfigured && this.configData && this.configData.configured) {
                const now = new Date();
                const lastCheck = this.lastConnectionCheck || new Date(this.configData.lastConnectionTime || 0);
                
                // Verificar si han pasado más de 30 minutos desde la última verificación
                const timeDiff = now - lastCheck;
                if (timeDiff > 30 * 60 * 1000) { // 30 minutos
                    this.testConnection();
                }
            }
        }, 5 * 60 * 1000); // Revisar cada 5 minutos
    }

    /**
     * Detiene el monitor de conexión
     */
    stopConnectionMonitor() {
        if (this.statusInterval) {
            clearInterval(this.statusInterval);
            this.statusInterval = null;
        }
    }

    /**
     * Reinicia la configuración a valores por defecto
     */
    resetConfiguration() {
        const confirmReset = confirm('¿Está seguro de que desea restablecer la configuración de BBVA? Esta acción no se puede deshacer.');
        
        if (confirmReset) {
            this.configData = {
                clientId: '',
                clientSecret: '',
                merchantId: '',
                terminalId: '',
                apiKey: '',
                account: '',
                testMode: true,
                webhookUrl: this.generateWebhookUrl(''),
                configured: false,
                lastConnectionStatus: null,
                lastConnectionTime: null
            };
            
            // Actualizar la UI
            this.updateUIWithConfig();
            
            // Guardar configuración vacía
            database.setConfig('integraciones.bancos.bbva', this.configData)
                .then(() => {
                    this.isConfigured = false;
                    this.updateFormState();
                    notification.show('info', 'Configuración restablecida', 'La configuración de BBVA ha sido restablecida.');
                    logger.info('Configuración de BBVA restablecida');
                })
                .catch(error => {
                    logger.error('Error al restablecer configuración de BBVA:', error);
                    notification.show('error', 'Error al restablecer', `No se pudo restablecer la configuración: ${error.message}`);
                });
        }
    }

    /**
     * Verifica el estado de una transferencia por ID
     * @param {string} transactionId - ID de la transacción a verificar
     * @returns {Promise<Object>} - Estado de la transacción
     */
    async checkTransactionStatus(transactionId) {
        try {
            if (!this.isConfigured) {
                throw new Error('El módulo BBVA no está configurado correctamente');
            }
            
            return await apiSpecific.getTransactionStatus(transactionId);
        } catch (error) {
            logger.error('Error al verificar estado de transacción BBVA:', error);
            throw error;
        }
    }

    /**
     * Verifica las transferencias recibidas en un periodo
     * @param {Date} startDate - Fecha inicial
     * @param {Date} endDate - Fecha final
     * @returns {Promise<Array>} - Lista de transferencias
     */
    async getTransactions(startDate, endDate) {
        try {
            if (!this.isConfigured) {
                throw new Error('El módulo BBVA no está configurado correctamente');
            }
            
            return await apiSpecific.getTransactions(startDate, endDate);
        } catch (error) {
            logger.error('Error al obtener transacciones de BBVA:', error);
            throw error;
        }
    }

    /**
     * Procesa una notificación de webhook desde BBVA
     * @param {Object} data - Datos de la notificación
     * @returns {Promise<Object>} - Resultado del procesamiento
     */
    async processWebhookNotification(data) {
        try {
            return await apiSpecific.processWebhook(data);
        } catch (error) {
            logger.error('Error al procesar webhook de BBVA:', error);
            throw error;
        }
    }

    /**
     * Crea un enlace de pago para compartir
     * @param {number} amount - Monto a cobrar
     * @param {string} concept - Concepto del pago
     * @param {string} reference - Referencia interna
     * @returns {Promise<Object>} - URL y detalles del pago
     */
    async createPaymentLink(amount, concept, reference) {
        try {
            if (!this.isConfigured) {
                throw new Error('El módulo BBVA no está configurado correctamente');
            }
            
            return await apiSpecific.createPaymentLink({
                amount,
                concept,
                reference,
                callbackUrl: `${window.location.origin}/api/callback/bbva`
            });
        } catch (error) {
            logger.error('Error al crear enlace de pago BBVA:', error);
            throw error;
        }
    }

    /**
     * Limpia recursos cuando se desmonta el componente
     */
    destroy() {
        this.stopConnectionMonitor();
        
        // Remover event listeners si es necesario
        if (this.elements.form) {
            // Usar clones para eliminar event listeners
            const oldElement = this.elements.form;
            const newElement = oldElement.cloneNode(true);
            oldElement.parentNode.replaceChild(newElement, oldElement);
        }
        
        logger.info('Módulo de BBVA destruido');
    }
}

// Exportar una instancia única del módulo
const bbvaIntegration = new BBVAIntegration();

// Exportar métodos públicos
module.exports = {
    /**
     * Inicializa el módulo de integración con BBVA
     */
    init: () => bbvaIntegration.init(),
    
    /**
     * Verifica si la integración está configurada correctamente
     * @returns {boolean} - Estado de configuración
     */
    isConfigured: () => bbvaIntegration.isConfigured,
    
    /**
     * Obtiene la configuración actual
     * @returns {Object} - Configuración actual
     */
    getConfig: () => bbvaIntegration.configData,
    
    /**
     * Verifica el estado de una transacción
     * @param {string} transactionId - ID de la transacción
     * @returns {Promise<Object>} - Estado de la transacción
     */
    checkTransactionStatus: (transactionId) => bbvaIntegration.checkTransactionStatus(transactionId),
    
    /**
     * Obtiene las transacciones en un periodo
     * @param {Date} startDate - Fecha de inicio
     * @param {Date} endDate - Fecha final
     * @returns {Promise<Array>} - Lista de transacciones
     */
    getTransactions: (startDate, endDate) => bbvaIntegration.getTransactions(startDate, endDate),
    
    /**
     * Procesa una notificación de webhook
     * @param {Object} data - Datos recibidos
     * @returns {Promise<Object>} - Resultado del procesamiento
     */
    processWebhookNotification: (data) => bbvaIntegration.processWebhookNotification(data),
    
    /**
     * Crea un enlace de pago para compartir
     * @param {number} amount - Monto
     * @param {string} concept - Concepto
     * @param {string} reference - Referencia interna
     * @returns {Promise<Object>} - Detalles del enlace de pago
     */
    createPaymentLink: (amount, concept, reference) => bbvaIntegration.createPaymentLink(amount, concept, reference),
    
    /**
     * Limpia recursos del módulo
     */
    destroy: () => bbvaIntegration.destroy()
};