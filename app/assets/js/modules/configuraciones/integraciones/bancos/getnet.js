/**
 * Módulo de configuración e integración con Getnet
 * Este archivo maneja la configuración y funcionalidades relacionadas con
 * la integración del sistema FactuSystem con la plataforma de pagos Getnet.
 */

// Importaciones necesarias
const { ipcRenderer } = require('electron');
const database = require('../../../../utils/database.js');
const validation = require('../../../../utils/validation.js');
const logger = require('../../../../utils/logger.js');
const notificaciones = require('../../../../components/notifications.js');

// Clase principal para la integración con Getnet
class GetnetIntegration {
    constructor() {
        this.config = null;
        this.isConnected = false;
        this.lastTransaction = null;
        this.elementsInitialized = false;
        
        // Inicializar al crear la instancia
        this.init();
    }

    /**
     * Inicializa la integración con Getnet
     */
    async init() {
        try {
            // Cargar configuración desde la base de datos
            this.config = await this.loadConfiguration();
            
            // Verificar si existe configuración válida
            if (this.config && this.config.apiKey && this.config.merchantId) {
                // Intentar establecer conexión con Getnet
                await this.testConnection();
            }
            
            // Inicializar elementos de UI al cargar la página
            document.addEventListener('DOMContentLoaded', () => {
                this.initializeElements();
            });
            
            logger.info('Módulo Getnet inicializado correctamente');
        } catch (error) {
            logger.error('Error al inicializar el módulo Getnet', error);
        }
    }

    /**
     * Carga la configuración de Getnet desde la base de datos
     */
    async loadConfiguration() {
        try {
            const result = await database.query('SELECT * FROM configuracion_bancos WHERE tipo = ?', ['getnet']);
            
            if (result && result.length > 0) {
                return {
                    apiKey: result[0].api_key,
                    merchantId: result[0].merchant_id,
                    terminal: result[0].terminal_id,
                    environment: result[0].environment || 'sandbox',
                    callbackUrl: result[0].callback_url,
                    webhookUrl: result[0].webhook_url,
                    additionalConfig: result[0].config_adicional ? JSON.parse(result[0].config_adicional) : {},
                    active: result[0].activo === 1
                };
            }
            
            return {
                apiKey: '',
                merchantId: '',
                terminal: '',
                environment: 'sandbox',
                callbackUrl: '',
                webhookUrl: '',
                additionalConfig: {},
                active: false
            };
        } catch (error) {
            logger.error('Error al cargar configuración de Getnet', error);
            throw error;
        }
    }

    /**
     * Guarda la configuración de Getnet en la base de datos
     */
    async saveConfiguration(config) {
        try {
            // Validar campos obligatorios
            if (!config.apiKey || !config.merchantId) {
                throw new Error('API Key y Merchant ID son obligatorios');
            }

            // Preparar datos para guardar
            const configData = {
                api_key: config.apiKey,
                merchant_id: config.merchantId,
                terminal_id: config.terminal,
                environment: config.environment,
                callback_url: config.callbackUrl,
                webhook_url: config.webhookUrl,
                config_adicional: JSON.stringify(config.additionalConfig || {}),
                activo: config.active ? 1 : 0
            };

            // Verificar si ya existe configuración
            const exists = await database.query('SELECT id FROM configuracion_bancos WHERE tipo = ?', ['getnet']);
            
            if (exists && exists.length > 0) {
                // Actualizar configuración existente
                await database.query(
                    'UPDATE configuracion_bancos SET api_key = ?, merchant_id = ?, terminal_id = ?, environment = ?, callback_url = ?, webhook_url = ?, config_adicional = ?, activo = ? WHERE tipo = ?',
                    [
                        configData.api_key,
                        configData.merchant_id,
                        configData.terminal_id,
                        configData.environment,
                        configData.callback_url,
                        configData.webhook_url,
                        configData.config_adicional,
                        configData.activo,
                        'getnet'
                    ]
                );
            } else {
                // Insertar nueva configuración
                await database.query(
                    'INSERT INTO configuracion_bancos (tipo, api_key, merchant_id, terminal_id, environment, callback_url, webhook_url, config_adicional, activo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [
                        'getnet',
                        configData.api_key,
                        configData.merchant_id,
                        configData.terminal_id,
                        configData.environment,
                        configData.callback_url,
                        configData.webhook_url,
                        configData.config_adicional,
                        configData.activo
                    ]
                );
            }

            // Actualizar la configuración actual
            this.config = config;
            
            // Verificar conexión con las nuevas credenciales
            await this.testConnection();
            
            logger.info('Configuración de Getnet guardada correctamente');
            return true;
        } catch (error) {
            logger.error('Error al guardar configuración de Getnet', error);
            throw error;
        }
    }

    /**
     * Prueba la conexión con la API de Getnet
     */
    async testConnection() {
        try {
            if (!this.config || !this.config.apiKey || !this.config.merchantId) {
                this.isConnected = false;
                return false;
            }

            // Preparar headers
            const headers = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.config.apiKey}`,
                'x-terminal-id': this.config.terminal
            };

            // Endpoint para probar la conexión (varía según documentación de Getnet)
            const endpoint = this.config.environment === 'production'
                ? 'https://api.getnet.com.ar/v1/status'
                : 'https://api.sandbox.getnet.com.ar/v1/status';

            // Realizar solicitud a través del proceso principal (Electron)
            const response = await ipcRenderer.invoke('http-request', {
                method: 'GET',
                url: endpoint,
                headers: headers
            });

            // Verificar respuesta
            if (response && response.status === 'ok') {
                this.isConnected = true;
                logger.info('Conexión exitosa con Getnet');
                return true;
            } else {
                this.isConnected = false;
                logger.warn('No se pudo conectar con Getnet', response);
                return false;
            }
        } catch (error) {
            this.isConnected = false;
            logger.error('Error al probar conexión con Getnet', error);
            return false;
        }
    }

    /**
     * Inicializa los elementos de la interfaz de usuario
     */
    initializeElements() {
        // Evitar inicialización múltiple
        if (this.elementsInitialized) return;
        
        // Verificar si estamos en la página de configuración correcta
        const configContainer = document.getElementById('getnet-config-container');
        if (!configContainer) return;
        
        // Inicializar elementos de formulario
        this.initFormElements();
        
        // Inicializar botones y eventos
        this.initButtonEvents();
        
        this.elementsInitialized = true;
    }

    /**
     * Inicializa los elementos del formulario
     */
    initFormElements() {
        // Obtener referencias a elementos del formulario
        const apiKeyInput = document.getElementById('getnet-api-key');
        const merchantIdInput = document.getElementById('getnet-merchant-id');
        const terminalInput = document.getElementById('getnet-terminal');
        const environmentSelect = document.getElementById('getnet-environment');
        const callbackUrlInput = document.getElementById('getnet-callback-url');
        const webhookUrlInput = document.getElementById('getnet-webhook-url');
        const activeCheckbox = document.getElementById('getnet-active');
        
        // Cargar valores actuales en el formulario
        if (this.config) {
            apiKeyInput.value = this.config.apiKey || '';
            merchantIdInput.value = this.config.merchantId || '';
            terminalInput.value = this.config.terminal || '';
            environmentSelect.value = this.config.environment || 'sandbox';
            callbackUrlInput.value = this.config.callbackUrl || '';
            webhookUrlInput.value = this.config.webhookUrl || '';
            activeCheckbox.checked = this.config.active || false;
        }
        
        // Mostrar estado de conexión
        this.updateConnectionStatus();
    }

    /**
     * Inicializa eventos de botones
     */
    initButtonEvents() {
        // Botón guardar configuración
        const saveButton = document.getElementById('getnet-save-config');
        if (saveButton) {
            saveButton.addEventListener('click', async () => {
                try {
                    // Recopilar datos del formulario
                    const config = {
                        apiKey: document.getElementById('getnet-api-key').value,
                        merchantId: document.getElementById('getnet-merchant-id').value,
                        terminal: document.getElementById('getnet-terminal').value,
                        environment: document.getElementById('getnet-environment').value,
                        callbackUrl: document.getElementById('getnet-callback-url').value,
                        webhookUrl: document.getElementById('getnet-webhook-url').value,
                        active: document.getElementById('getnet-active').checked,
                        additionalConfig: this.config?.additionalConfig || {}
                    };
                    
                    // Validar campos
                    if (!validation.isNotEmpty(config.apiKey)) {
                        notificaciones.mostrarError('La API Key es obligatoria');
                        return;
                    }
                    
                    if (!validation.isNotEmpty(config.merchantId)) {
                        notificaciones.mostrarError('El Merchant ID es obligatorio');
                        return;
                    }
                    
                    // Guardar configuración
                    await this.saveConfiguration(config);
                    
                    // Actualizar estado de conexión
                    this.updateConnectionStatus();
                    
                    notificaciones.mostrarExito('Configuración de Getnet guardada correctamente');
                } catch (error) {
                    notificaciones.mostrarError(`Error al guardar configuración: ${error.message}`);
                    logger.error('Error al guardar configuración de Getnet', error);
                }
            });
        }
        
        // Botón probar conexión
        const testButton = document.getElementById('getnet-test-connection');
        if (testButton) {
            testButton.addEventListener('click', async () => {
                try {
                    // Mostrar indicador de carga
                    testButton.disabled = true;
                    testButton.innerHTML = 'Probando conexión...';
                    
                    // Probar conexión
                    const result = await this.testConnection();
                    
                    // Mostrar resultado
                    if (result) {
                        notificaciones.mostrarExito('Conexión exitosa con Getnet');
                    } else {
                        notificaciones.mostrarError('No se pudo conectar con Getnet. Verifique las credenciales e intente nuevamente.');
                    }
                    
                    // Actualizar estado de conexión
                    this.updateConnectionStatus();
                } catch (error) {
                    notificaciones.mostrarError(`Error al probar conexión: ${error.message}`);
                    logger.error('Error al probar conexión con Getnet', error);
                } finally {
                    // Restaurar botón
                    testButton.disabled = false;
                    testButton.innerHTML = 'Probar Conexión';
                }
            });
        }
    }

    /**
     * Actualiza el indicador visual del estado de conexión
     */
    updateConnectionStatus() {
        const statusIndicator = document.getElementById('getnet-connection-status');
        if (!statusIndicator) return;
        
        if (this.isConnected) {
            statusIndicator.className = 'connection-status connected';
            statusIndicator.innerHTML = 'Conectado';
        } else {
            statusIndicator.className = 'connection-status disconnected';
            statusIndicator.innerHTML = 'Desconectado';
        }
    }

    /**
     * Procesa un pago a través de Getnet
     * @param {Object} paymentData - Datos del pago
     * @param {number} paymentData.amount - Monto a pagar
     * @param {string} paymentData.description - Descripción del pago
     * @param {string} paymentData.orderNumber - Número de orden/factura
     * @param {Object} paymentData.customer - Información del cliente
     * @returns {Promise<Object>} - Resultado del procesamiento del pago
     */
    async processPayment(paymentData) {
        try {
            if (!this.isConnected || !this.config.active) {
                throw new Error('La integración con Getnet no está activa o configurada correctamente');
            }
            
            // Validar datos mínimos requeridos
            if (!paymentData.amount || paymentData.amount <= 0) {
                throw new Error('El monto del pago debe ser mayor a cero');
            }
            
            if (!paymentData.orderNumber) {
                throw new Error('El número de orden/factura es obligatorio');
            }
            
            // Preparar datos para la solicitud
            const requestData = {
                merchant_id: this.config.merchantId,
                terminal_id: this.config.terminal,
                amount: {
                    total: parseFloat(paymentData.amount).toFixed(2),
                    currency: 'ARS'
                },
                order: {
                    order_id: paymentData.orderNumber,
                    description: paymentData.description || `Pago FactuSystem #${paymentData.orderNumber}`
                },
                customer: paymentData.customer || {}
            };
            
            // Endpoint según ambiente
            const endpoint = this.config.environment === 'production'
                ? 'https://api.getnet.com.ar/v1/payments'
                : 'https://api.sandbox.getnet.com.ar/v1/payments';
            
            // Headers
            const headers = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.config.apiKey}`,
                'x-terminal-id': this.config.terminal
            };
            
            // Enviar solicitud a través del proceso principal (Electron)
            const response = await ipcRenderer.invoke('http-request', {
                method: 'POST',
                url: endpoint,
                headers: headers,
                data: requestData
            });
            
            // Guardar última transacción
            this.lastTransaction = response;
            
            // Registrar transacción en la base de datos
            await this.saveTransaction(paymentData, response);
            
            logger.info(`Pago procesado con Getnet. ID: ${response.payment_id || 'N/A'}`, response);
            return response;
        } catch (error) {
            logger.error('Error al procesar pago con Getnet', error);
            throw error;
        }
    }

    /**
     * Guarda una transacción en la base de datos
     * @param {Object} paymentData - Datos del pago
     * @param {Object} response - Respuesta de Getnet
     */
    async saveTransaction(paymentData, response) {
        try {
            await database.query(
                'INSERT INTO transacciones_bancos (tipo_banco, orden_id, monto, descripcion, cliente_id, respuesta, estado, fecha) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
                [
                    'getnet',
                    paymentData.orderNumber,
                    paymentData.amount,
                    paymentData.description || '',
                    paymentData.customer?.id || null,
                    JSON.stringify(response),
                    response.status || 'pending'
                ]
            );
        } catch (error) {
            logger.error('Error al guardar transacción Getnet en la base de datos', error);
        }
    }

    /**
     * Verifica el estado de una transacción
     * @param {string} transactionId - ID de la transacción a verificar
     * @returns {Promise<Object>} - Estado de la transacción
     */
    async checkTransactionStatus(transactionId) {
        try {
            if (!this.isConnected || !this.config.active) {
                throw new Error('La integración con Getnet no está activa o configurada correctamente');
            }
            
            // Endpoint según ambiente
            const endpoint = this.config.environment === 'production'
                ? `https://api.getnet.com.ar/v1/payments/${transactionId}`
                : `https://api.sandbox.getnet.com.ar/v1/payments/${transactionId}`;
            
            // Headers
            const headers = {
                'Authorization': `Bearer ${this.config.apiKey}`,
                'x-terminal-id': this.config.terminal
            };
            
            // Enviar solicitud a través del proceso principal (Electron)
            const response = await ipcRenderer.invoke('http-request', {
                method: 'GET',
                url: endpoint,
                headers: headers
            });
            
            // Actualizar estado en la base de datos
            if (response && response.payment_id) {
                await database.query(
                    'UPDATE transacciones_bancos SET estado = ?, respuesta = ? WHERE respuesta LIKE ?',
                    [
                        response.status || 'unknown',
                        JSON.stringify(response),
                        `%"payment_id":"${response.payment_id}"%`
                    ]
                );
            }
            
            return response;
        } catch (error) {
            logger.error('Error al verificar estado de transacción Getnet', error);
            throw error;
        }
    }

    /**
     * Cancela una transacción/pago
     * @param {string} transactionId - ID de la transacción a cancelar
     * @returns {Promise<Object>} - Resultado de la cancelación
     */
    async cancelTransaction(transactionId) {
        try {
            if (!this.isConnected || !this.config.active) {
                throw new Error('La integración con Getnet no está activa o configurada correctamente');
            }
            
            // Endpoint según ambiente
            const endpoint = this.config.environment === 'production'
                ? `https://api.getnet.com.ar/v1/payments/${transactionId}/cancel`
                : `https://api.sandbox.getnet.com.ar/v1/payments/${transactionId}/cancel`;
            
            // Headers
            const headers = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.config.apiKey}`,
                'x-terminal-id': this.config.terminal
            };
            
            // Enviar solicitud a través del proceso principal (Electron)
            const response = await ipcRenderer.invoke('http-request', {
                method: 'POST',
                url: endpoint,
                headers: headers,
                data: {}
            });
            
            // Actualizar estado en la base de datos
            if (response && response.payment_id) {
                await database.query(
                    'UPDATE transacciones_bancos SET estado = ?, respuesta = ? WHERE respuesta LIKE ?',
                    [
                        'cancelled',
                        JSON.stringify(response),
                        `%"payment_id":"${response.payment_id}"%`
                    ]
                );
            }
            
            logger.info(`Transacción Getnet cancelada. ID: ${transactionId}`, response);
            return response;
        } catch (error) {
            logger.error('Error al cancelar transacción Getnet', error);
            throw error;
        }
    }

    /**
     * Procesa el webhook/notificación de Getnet
     * @param {Object} notification - Datos de la notificación
     * @returns {Promise<boolean>} - Resultado del procesamiento
     */
    async processWebhook(notification) {
        try {
            if (!notification || !notification.payment_id) {
                logger.warn('Webhook de Getnet inválido', notification);
                return false;
            }
            
            // Verificar si la transacción existe en la base de datos
            const transactions = await database.query(
                'SELECT * FROM transacciones_bancos WHERE respuesta LIKE ? AND tipo_banco = ?',
                [`%"payment_id":"${notification.payment_id}"%`, 'getnet']
            );
            
            if (transactions && transactions.length > 0) {
                // Actualizar estado
                await database.query(
                    'UPDATE transacciones_bancos SET estado = ?, respuesta = ? WHERE id = ?',
                    [
                        notification.status || 'updated',
                        JSON.stringify(notification),
                        transactions[0].id
                    ]
                );
                
                // Emitir evento de actualización
                if (typeof window !== 'undefined') {
                    const event = new CustomEvent('getnet-payment-update', { 
                        detail: { 
                            paymentId: notification.payment_id, 
                            status: notification.status,
                            orderId: transactions[0].orden_id
                        } 
                    });
                    window.dispatchEvent(event);
                }
                
                logger.info(`Webhook de Getnet procesado. ID: ${notification.payment_id}, Estado: ${notification.status}`);
                return true;
            } else {
                // Transacción no encontrada, podría ser una nueva
                logger.warn(`Transacción Getnet no encontrada en la BD. ID: ${notification.payment_id}`);
                
                // Guardar como nueva transacción si tiene suficientes datos
                if (notification.amount && notification.order_id) {
                    await database.query(
                        'INSERT INTO transacciones_bancos (tipo_banco, orden_id, monto, descripcion, respuesta, estado, fecha) VALUES (?, ?, ?, ?, ?, ?, NOW())',
                        [
                            'getnet',
                            notification.order_id,
                            notification.amount.total || 0,
                            notification.description || '',
                            JSON.stringify(notification),
                            notification.status || 'received'
                        ]
                    );
                    
                    logger.info(`Nueva transacción Getnet registrada desde webhook. ID: ${notification.payment_id}`);
                    return true;
                }
                
                return false;
            }
        } catch (error) {
            logger.error('Error al procesar webhook de Getnet', error);
            return false;
        }
    }

    /**
     * Genera un reporte de transacciones
     * @param {Object} filters - Filtros para el reporte
     * @returns {Promise<Array>} - Transacciones
     */
    async generateTransactionsReport(filters = {}) {
        try {
            let query = 'SELECT * FROM transacciones_bancos WHERE tipo_banco = ?';
            const params = ['getnet'];
            
            // Aplicar filtros
            if (filters.dateFrom) {
                query += ' AND DATE(fecha) >= ?';
                params.push(filters.dateFrom);
            }
            
            if (filters.dateTo) {
                query += ' AND DATE(fecha) <= ?';
                params.push(filters.dateTo);
            }
            
            if (filters.status) {
                query += ' AND estado = ?';
                params.push(filters.status);
            }
            
            // Ordenar
            query += ' ORDER BY fecha DESC';
            
            // Ejecutar consulta
            const transactions = await database.query(query, params);
            
            // Procesar resultados
            return transactions.map(t => {
                // Parsear respuesta JSON
                try {
                    t.respuesta = JSON.parse(t.respuesta);
                } catch (e) {
                    t.respuesta = {};
                }
                return t;
            });
        } catch (error) {
            logger.error('Error al generar reporte de transacciones Getnet', error);
            throw error;
        }
    }
}

// Crear instancia única del módulo
const getnetIntegration = new GetnetIntegration();

// Exportar la instancia
module.exports = getnetIntegration;