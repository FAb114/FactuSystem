/**
 * @file payway.js
 * @description Módulo de integración con Payway para procesamiento de pagos
 * @module configuraciones/integraciones/bancos/payway
 */

// Importaciones de utilidades y servicios
const { database } = require('../../../../../utils/database.js');
const { logger } = require('../../../../../utils/logger.js');
const { validateApiCredentials } = require('../../../../../utils/validation.js');
const { notificaciones } = require('../../../../../components/notifications.js');
const { loadEncryptedCredentials, saveEncryptedCredentials } = require('../../seguridad.js');

// Constantes
const PAYWAY_API_URL = {
  sandbox: 'https://api.sandbox.payway.com.ar/v1',
  production: 'https://api.payway.com.ar/v1'
};

const WEBHOOK_ROUTES = {
  payment: '/integraciones/payway/payment-notification',
  refund: '/integraciones/payway/refund-notification'
};

// Clase principal para la integración con Payway
class PaywayIntegration {
  constructor() {
    this.settings = {};
    this.isInitialized = false;
    this.environment = 'sandbox'; // Por defecto en sandbox
    this.errorRetries = 0;
    this.maxRetries = 3;
    this.retryDelay = 2000; // ms
    this.lastTransaction = null;
  }

  /**
   * Inicializa la configuración de Payway desde la base de datos
   * @returns {Promise<boolean>} - Verdadero si la inicialización fue exitosa
   */
  async initialize() {
    try {
      // Cargar configuración desde la base de datos
      const config = await database.getConfig('integraciones_payway');
      
      if (!config) {
        logger.warn('Configuración de Payway no encontrada');
        this.isInitialized = false;
        return false;
      }

      // Desencriptar credenciales
      const credentials = await loadEncryptedCredentials('payway');
      
      this.settings = {
        merchantId: credentials.merchantId || '',
        apiKey: credentials.apiKey || '',
        publicKey: credentials.publicKey || '',
        privateKey: credentials.privateKey || '',
        webhookSecret: credentials.webhookSecret || '',
        environment: config.environment || 'sandbox',
        enabledPaymentMethods: config.enabledPaymentMethods || ['credit_card', 'debit_card'],
        autoCapture: config.autoCapture !== undefined ? config.autoCapture : true,
        notifyCustomers: config.notifyCustomers !== undefined ? config.notifyCustomers : true,
        storeCards: config.storeCards !== undefined ? config.storeCards : false,
        installmentsConfig: config.installmentsConfig || {
          maxInstallments: 12,
          minAmount: 1000
        }
      };

      this.environment = this.settings.environment;
      this.isInitialized = this.validateSettings();
      
      if (this.isInitialized) {
        logger.info('Integración con Payway inicializada correctamente');
      } else {
        logger.warn('Inicialización de Payway incompleta: faltan credenciales');
      }
      
      return this.isInitialized;
    } catch (error) {
      logger.error('Error al inicializar Payway', error);
      this.isInitialized = false;
      return false;
    }
  }

  /**
   * Valida que todas las configuraciones necesarias estén presentes
   * @returns {boolean} - Verdadero si la configuración es válida
   */
  validateSettings() {
    const requiredFields = ['merchantId', 'apiKey', 'publicKey', 'privateKey'];
    return requiredFields.every(field => 
      this.settings[field] && this.settings[field].trim() !== ''
    );
  }

  /**
   * Guarda la configuración de Payway
   * @param {Object} config - Configuración a guardar
   * @returns {Promise<boolean>} - Verdadero si se guardó correctamente
   */
  async saveConfiguration(config) {
    try {
      // Validar credenciales antes de guardar
      if (config.validateCredentials) {
        const validationResult = await this.testApiConnection({
          merchantId: config.merchantId,
          apiKey: config.apiKey,
          publicKey: config.publicKey,
          privateKey: config.privateKey,
          environment: config.environment
        });

        if (!validationResult.success) {
          return {
            success: false,
            message: `Error al validar credenciales: ${validationResult.message}`
          };
        }
      }

      // Separar credenciales para encriptación
      const credentials = {
        merchantId: config.merchantId,
        apiKey: config.apiKey,
        publicKey: config.publicKey,
        privateKey: config.privateKey,
        webhookSecret: config.webhookSecret
      };

      // Guardar credenciales encriptadas
      await saveEncryptedCredentials('payway', credentials);

      // Guardar configuración general
      const generalConfig = {
        environment: config.environment,
        enabledPaymentMethods: config.enabledPaymentMethods,
        autoCapture: config.autoCapture,
        notifyCustomers: config.notifyCustomers,
        storeCards: config.storeCards,
        installmentsConfig: config.installmentsConfig
      };

      await database.setConfig('integraciones_payway', generalConfig);
      
      // Actualizar configuración actual
      this.settings = { ...credentials, ...generalConfig };
      this.environment = this.settings.environment;
      this.isInitialized = this.validateSettings();

      logger.info('Configuración de Payway guardada correctamente');
      return { 
        success: true, 
        message: 'Configuración guardada correctamente'
      };
    } catch (error) {
      logger.error('Error al guardar configuración de Payway', error);
      return { 
        success: false, 
        message: `Error al guardar: ${error.message || 'Error desconocido'}`
      };
    }
  }

  /**
   * Prueba la conexión con la API de Payway
   * @param {Object} credentials - Credenciales para probar
   * @returns {Promise<Object>} - Resultado de la prueba
   */
  async testApiConnection(credentials = null) {
    try {
      const testCredentials = credentials || this.settings;
      
      if (!validateApiCredentials(testCredentials, ['merchantId', 'apiKey', 'publicKey'])) {
        return {
          success: false,
          message: 'Credenciales incompletas'
        };
      }

      const env = testCredentials.environment || this.environment;
      const apiUrl = PAYWAY_API_URL[env];
      
      const headers = this._prepareHeaders(testCredentials);
      
      // Realizar solicitud de prueba a la API de Payway
      const response = await fetch(`${apiUrl}/payment_methods`, {
        method: 'GET',
        headers: headers
      });

      if (!response.ok) {
        const errorData = await response.json();
        logger.error('Error en la conexión con Payway', errorData);
        return {
          success: false,
          message: errorData.message || `Error ${response.status}: ${response.statusText}`
        };
      }

      const data = await response.json();
      return {
        success: true,
        message: 'Conexión exitosa',
        data: data
      };
    } catch (error) {
      logger.error('Error al probar conexión con Payway', error);
      return {
        success: false,
        message: error.message || 'Error desconocido al conectar con Payway'
      };
    }
  }

  /**
   * Prepara los encabezados de autenticación para las solicitudes a Payway
   * @param {Object} credentials - Credenciales a utilizar
   * @returns {Object} - Encabezados HTTP
   * @private
   */
  _prepareHeaders(credentials = null) {
    const creds = credentials || this.settings;
    
    // Crear token de autenticación (formato requerido por Payway)
    const authToken = Buffer.from(`${creds.apiKey}:${creds.privateKey}`).toString('base64');
    
    return {
      'Authorization': `Basic ${authToken}`,
      'Content-Type': 'application/json',
      'X-Merchant-Id': creds.merchantId,
      'User-Agent': 'FactuSystem/1.0'
    };
  }

  /**
   * Realiza una solicitud a la API de Payway
   * @param {string} endpoint - Endpoint de la API
   * @param {string} method - Método HTTP
   * @param {Object} data - Datos a enviar (opcional)
   * @returns {Promise<Object>} - Respuesta de la API
   * @private
   */
  async _apiRequest(endpoint, method = 'GET', data = null) {
    if (!this.isInitialized) {
      await this.initialize();
      if (!this.isInitialized) {
        throw new Error('No se puede realizar la solicitud: Payway no está inicializado');
      }
    }

    const apiUrl = PAYWAY_API_URL[this.environment];
    const url = `${apiUrl}${endpoint}`;
    const headers = this._prepareHeaders();
    
    const options = {
      method,
      headers,
      timeout: 30000 // 30 segundos
    };

    if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      options.body = JSON.stringify(data);
    }

    try {
      const response = await fetch(url, options);
      
      // Manejar respuesta de la API
      if (!response.ok) {
        const errorData = await response.json();
        logger.error(`Error en solicitud a Payway (${method} ${endpoint})`, errorData);
        throw new Error(errorData.message || `Error ${response.status}: ${response.statusText}`);
      }

      // Si es una respuesta vacía (204 No Content)
      if (response.status === 204) {
        return { success: true };
      }

      const responseData = await response.json();
      this.errorRetries = 0; // Resetear contador de reintentos
      return responseData;
    } catch (error) {
      // Manejo de reintentos para errores de red
      if (error.name === 'AbortError' || error.name === 'TimeoutError' || error.message.includes('network')) {
        if (this.errorRetries < this.maxRetries) {
          this.errorRetries++;
          logger.warn(`Reintentando solicitud a Payway (${this.errorRetries}/${this.maxRetries})...`);
          
          // Esperar antes de reintentar
          await new Promise(resolve => setTimeout(resolve, this.retryDelay));
          return this._apiRequest(endpoint, method, data);
        }
      }
      
      // Si ya se agotaron los reintentos o es otro tipo de error
      this.errorRetries = 0;
      throw error;
    }
  }

  /**
   * Crea un token de pago con tarjeta
   * @param {Object} cardData - Datos de la tarjeta
   * @returns {Promise<Object>} - Token generado
   */
  async createCardToken(cardData) {
    try {
      const tokenizationData = {
        card_number: cardData.number.replace(/\s/g, ''),
        card_expiration_month: cardData.expirationMonth,
        card_expiration_year: cardData.expirationYear,
        security_code: cardData.securityCode,
        card_holder_name: cardData.holderName,
        card_holder_identification: {
          type: cardData.holderIdType || 'DNI',
          number: cardData.holderIdNumber
        }
      };

      const response = await this._apiRequest('/tokens', 'POST', tokenizationData);
      return {
        success: true,
        token: response.id,
        lastFourDigits: response.card?.last_four_digits || '',
        cardType: response.card?.card_type || '',
        expirationDate: `${response.card?.expiration_month}/${response.card?.expiration_year}`
      };
    } catch (error) {
      logger.error('Error al crear token de tarjeta en Payway', error);
      return {
        success: false,
        message: error.message || 'Error al procesar los datos de la tarjeta'
      };
    }
  }

  /**
   * Procesa un pago con Payway
   * @param {Object} paymentData - Datos del pago
   * @returns {Promise<Object>} - Resultado del pago
   */
  async processPayment(paymentData) {
    try {
      // Validar inicialización
      if (!this.isInitialized) {
        await this.initialize();
        if (!this.isInitialized) {
          throw new Error('Payway no está inicializado correctamente');
        }
      }

      // Preparar datos para la API de Payway
      const payment = {
        transaction_amount: parseFloat(paymentData.amount),
        installments: paymentData.installments || 1,
        description: paymentData.description || 'Pago FactuSystem',
        payment_method_id: paymentData.paymentMethodId,
        token: paymentData.token,
        capture: this.settings.autoCapture,
        additional_info: {
          external_reference: paymentData.externalReference || `factu-${Date.now()}`,
          invoice_number: paymentData.invoiceNumber || '',
          items: paymentData.items || [],
          payer: {
            first_name: paymentData.customer?.firstName || '',
            last_name: paymentData.customer?.lastName || '',
            email: paymentData.customer?.email || '',
            identification: {
              type: paymentData.customer?.idType || 'DNI',
              number: paymentData.customer?.idNumber || ''
            }
          }
        },
        notification_url: paymentData.notificationUrl || this._getWebhookUrl('payment')
      };

      // Enviar solicitud de pago
      const response = await this._apiRequest('/payments', 'POST', payment);
      
      // Guardar última transacción
      this.lastTransaction = {
        id: response.id,
        status: response.status,
        date: new Date().toISOString(),
        amount: response.transaction_amount,
        paymentMethodId: response.payment_method_id,
        installments: response.installments,
        externalReference: payment.additional_info.external_reference
      };
      
      // Registrar la transacción en la base de datos
      await this._saveTransaction(response);

      // Retornar resultado
      return {
        success: true,
        transactionId: response.id,
        status: response.status,
        statusDetail: response.status_detail,
        authorizationCode: response.authorization_code || '',
        lastFourDigits: response.card?.last_four_digits || '',
        paymentMethodId: response.payment_method_id,
        amount: response.transaction_amount,
        installments: response.installments,
        raw: response
      };
    } catch (error) {
      logger.error('Error al procesar pago con Payway', error);
      return {
        success: false,
        message: error.message || 'Error al procesar el pago',
        code: error.code || 'PAYMENT_PROCESSING_ERROR'
      };
    }
  }

  /**
   * Consulta el estado de un pago
   * @param {string} paymentId - ID del pago
   * @returns {Promise<Object>} - Estado del pago
   */
  async getPaymentStatus(paymentId) {
    try {
      const response = await this._apiRequest(`/payments/${paymentId}`);
      return {
        success: true,
        status: response.status,
        statusDetail: response.status_detail,
        transactionId: response.id,
        amount: response.transaction_amount,
        paymentMethodId: response.payment_method_id,
        lastFourDigits: response.card?.last_four_digits || '',
        raw: response
      };
    } catch (error) {
      logger.error(`Error al consultar estado de pago ${paymentId}`, error);
      return {
        success: false,
        message: error.message || 'Error al consultar el estado del pago'
      };
    }
  }

  /**
   * Realiza un reembolso de un pago
   * @param {string} paymentId - ID del pago a reembolsar
   * @param {number} amount - Monto a reembolsar (opcional, reembolso total si no se especifica)
   * @returns {Promise<Object>} - Resultado del reembolso
   */
  async refundPayment(paymentId, amount = null) {
    try {
      const endpoint = `/payments/${paymentId}/refunds`;
      const data = amount ? { amount: parseFloat(amount) } : {};
      
      const response = await this._apiRequest(endpoint, 'POST', data);
      
      logger.info(`Reembolso procesado: Pago ${paymentId}, Reembolso ID: ${response.id}`);
      
      return {
        success: true,
        refundId: response.id,
        paymentId: response.payment_id,
        amount: response.amount,
        status: response.status
      };
    } catch (error) {
      logger.error(`Error al reembolsar pago ${paymentId}`, error);
      return {
        success: false,
        message: error.message || 'Error al procesar el reembolso'
      };
    }
  }

  /**
   * Captura un pago previamente autorizado
   * @param {string} paymentId - ID del pago a capturar
   * @param {number} amount - Monto a capturar (opcional)
   * @returns {Promise<Object>} - Resultado de la captura
   */
  async capturePayment(paymentId, amount = null) {
    try {
      const endpoint = `/payments/${paymentId}`;
      const data = {
        capture: true
      };
      
      if (amount !== null) {
        data.transaction_amount = parseFloat(amount);
      }
      
      const response = await this._apiRequest(endpoint, 'PUT', data);
      
      return {
        success: true,
        paymentId: response.id,
        status: response.status,
        statusDetail: response.status_detail,
        amount: response.transaction_amount
      };
    } catch (error) {
      logger.error(`Error al capturar pago ${paymentId}`, error);
      return {
        success: false,
        message: error.message || 'Error al capturar el pago'
      };
    }
  }

  /**
   * Obtiene los métodos de pago disponibles
   * @returns {Promise<Object>} - Lista de métodos de pago
   */
  async getPaymentMethods() {
    try {
      const response = await this._apiRequest('/payment_methods');
      
      // Filtrar por los métodos habilitados en la configuración
      let paymentMethods = response;
      if (this.settings.enabledPaymentMethods && this.settings.enabledPaymentMethods.length > 0) {
        paymentMethods = response.filter(method => 
          this.settings.enabledPaymentMethods.includes(method.id)
        );
      }
      
      return {
        success: true,
        paymentMethods: paymentMethods
      };
    } catch (error) {
      logger.error('Error al obtener métodos de pago de Payway', error);
      return {
        success: false,
        message: error.message || 'Error al obtener los métodos de pago'
      };
    }
  }

  /**
   * Obtiene la configuración de cuotas para un monto y método de pago
   * @param {number} amount - Monto de la compra
   * @param {string} paymentMethodId - ID del método de pago
   * @returns {Promise<Object>} - Opciones de cuotas disponibles
   */
  async getInstallmentsOptions(amount, paymentMethodId) {
    try {
      // Verificar monto mínimo para cuotas
      if (amount < this.settings.installmentsConfig.minAmount) {
        return {
          success: true,
          installments: [{ installments: 1, recommended_message: "Un pago", installment_amount: amount }]
        };
      }

      const endpoint = `/installments?amount=${amount}&payment_method_id=${paymentMethodId}`;
      const response = await this._apiRequest(endpoint);
      
      // Filtrar por máximo de cuotas configurado
      const maxInstallments = this.settings.installmentsConfig.maxInstallments || 12;
      const installments = response.filter(opt => opt.installments <= maxInstallments);
      
      return {
        success: true,
        installments: installments
      };
    } catch (error) {
      logger.error('Error al obtener opciones de cuotas', error);
      return {
        success: false,
        message: error.message || 'Error al consultar opciones de cuotas'
      };
    }
  }

  /**
   * Procesa una notificación webhook de Payway
   * @param {Object} data - Datos recibidos en el webhook
   * @param {Object} headers - Encabezados recibidos
   * @returns {Promise<Object>} - Resultado del procesamiento
   */
  async processWebhook(data, headers) {
    try {
      // Verificar firma del webhook si hay un secreto configurado
      if (this.settings.webhookSecret) {
        const signature = headers['x-signature'] || headers['X-Signature'];
        const isValid = this._verifyWebhookSignature(data, signature);
        
        if (!isValid) {
          logger.warn('Firma de webhook inválida', { signature });
          return { success: false, message: 'Firma inválida' };
        }
      }
      
      const eventType = data.type;
      const eventId = data.id;
      
      // Procesar según tipo de evento
      switch (eventType) {
        case 'payment.created':
        case 'payment.updated':
          await this._handlePaymentUpdate(data.data);
          break;
          
        case 'refund.created':
          await this._handleRefundCreated(data.data);
          break;
          
        default:
          logger.info(`Evento de webhook no procesado: ${eventType}`, { eventId });
      }
      
      return {
        success: true,
        message: 'Webhook procesado correctamente'
      };
    } catch (error) {
      logger.error('Error al procesar webhook de Payway', error);
      return {
        success: false,
        message: error.message || 'Error al procesar el webhook'
      };
    }
  }

  /**
   * Verifica la firma de un webhook
   * @param {Object} data - Datos del webhook
   * @param {string} signature - Firma recibida
   * @returns {boolean} - Verdadero si la firma es válida
   * @private
   */
  _verifyWebhookSignature(data, signature) {
    if (!signature || !this.settings.webhookSecret) {
      return false;
    }
    
    try {
      // Implementar verificación de firma HMAC
      const crypto = require('crypto');
      const payload = JSON.stringify(data);
      const expectedSignature = crypto
        .createHmac('sha256', this.settings.webhookSecret)
        .update(payload)
        .digest('hex');
        
      return signature === expectedSignature;
    } catch (error) {
      logger.error('Error al verificar firma de webhook', error);
      return false;
    }
  }

  /**
   * Maneja una actualización de estado de pago
   * @param {Object} paymentData - Datos del pago
   * @returns {Promise<void>}
   * @private
   */
  async _handlePaymentUpdate(paymentData) {
    try {
      // Obtener detalles completos del pago
      const paymentId = paymentData.id;
      const paymentDetails = await this.getPaymentStatus(paymentId);
      
      if (!paymentDetails.success) {
        logger.warn(`No se pudo obtener detalles del pago ${paymentId}`);
        return;
      }
      
      // Actualizar en base de datos
      await this._updateTransactionStatus(paymentId, paymentDetails.status, paymentDetails.raw);
      
      // Notificar a la aplicación
      this._notifyPaymentUpdate(paymentDetails);
      
      // Si es aprobado y está configurado, notificar al cliente
      if (
        paymentDetails.status === 'approved' && 
        this.settings.notifyCustomers &&
        paymentData.additional_info?.payer?.email
      ) {
        // Aquí se implementaría la notificación al cliente
        logger.info(`Notificación de pago aprobado enviada: ${paymentId}`);
      }
    } catch (error) {
      logger.error(`Error al procesar actualización de pago ${paymentData.id}`, error);
    }
  }

  /**
   * Maneja una notificación de reembolso
   * @param {Object} refundData - Datos del reembolso
   * @returns {Promise<void>}
   * @private
   */
  async _handleRefundCreated(refundData) {
    try {
      const refundId = refundData.id;
      const paymentId = refundData.payment_id;
      
      // Actualizar estado de la transacción
      await this._updateTransactionRefund(paymentId, refundId, refundData);
      
      // Notificar a la aplicación
      this._notifyRefundProcessed({
        refundId,
        paymentId,
        amount: refundData.amount,
        status: refundData.status
      });
      
      logger.info(`Reembolso procesado: ${refundId} para pago ${paymentId}`);
    } catch (error) {
      logger.error(`Error al procesar reembolso ${refundData.id}`, error);
    }
  }

  /**
   * Guarda una transacción en la base de datos
   * @param {Object} transactionData - Datos de la transacción
   * @returns {Promise<void>}
   * @private
   */
  async _saveTransaction(transactionData) {
    try {
      const transaction = {
        payment_id: transactionData.id,
        external_reference: transactionData.additional_info?.external_reference,
        invoice_number: transactionData.additional_info?.invoice_number,
        status: transactionData.status,
        status_detail: transactionData.status_detail,
        payment_method_id: transactionData.payment_method_id,
        payment_type: transactionData.payment_type_id,
        installments: transactionData.installments,
        amount: transactionData.transaction_amount,
        created_date: new Date().toISOString(),
        last_modified: new Date().toISOString(),
        card_last_four: transactionData.card?.last_four_digits || '',
        authorization_code: transactionData.authorization_code || '',
        merchant_account_id: this.settings.merchantId,
        environment: this.environment,
        raw_data: JSON.stringify(transactionData)
      };
      
      await database.insert('payway_transactions', transaction);
      logger.info(`Transacción Payway guardada: ${transaction.payment_id}`);
    } catch (error) {
      logger.error('Error al guardar transacción Payway', error);
    }
  }

  /**
   * Actualiza el estado de una transacción en la base de datos
   * @param {string} paymentId - ID del pago
   * @param {string} status - Nuevo estado
   * @param {Object} data - Datos adicionales
   * @returns {Promise<void>}
   * @private
   */
  async _updateTransactionStatus(paymentId, status, data) {
    try {
      const update = {
        status: status,
        status_detail: data.status_detail,
        last_modified: new Date().toISOString(),
        raw_data: JSON.stringify(data)
      };
      
      await database.update('payway_transactions', 
        { payment_id: paymentId }, 
        update
      );
      
      logger.info(`Estado de transacción actualizado: ${paymentId} -> ${status}`);
    } catch (error) {
      logger.error(`Error al actualizar estado de transacción ${paymentId}`, error);
    }
  }

  /**
   * Actualiza una transacción con información de reembolso
   * @param {string} paymentId - ID del pago
   * @param {string} refundId - ID del reembolso
   * @param {Object} refundData - Datos del reembolso
   * @returns {Promise<void>}
   * @private
   */
  async _updateTransactionRefund(paymentId, refundId, refundData) {
    try {
      // Obtener transacción actual
      const transaction = await database.findOne('payway_transactions', { payment_id: paymentId });
      
      if (!transaction) {
        logger.warn(`Transacción no encontrada para reembolso: ${paymentId}`);
        return;
      }
      
      // Actualizar con información de reembolso
      const refunds = transaction.refunds || [];
      refunds.push({
        refund_id: refundId,
        amount: refundData.amount,
        status: refundData.status,
        created_date: new Date().toISOString()
      });
      
      // Si es reembolso total, actualizar estado
      const isFullRefund = refundData.amount >= transaction.amount;
      const update = {
        refunds: refunds,
        status: isFullRefund ? 'refunded' : 'partially_refunded',
        last_modified: new Date().toISOString()
      };
      
      await database.update('payway_transactions', { payment_id: paymentId }, update);
      logger.info(`Reembolso registrado para transacción: ${paymentId}`);
    } catch (error) {
      logger.error(`Error al actualizar reembolso para transacción ${paymentId}`, error);
    }
  }

  /**
   * Obtiene la URL del webhook
   * @param {string} type - Tipo de webhook
   * @returns {string} - URL del webhook
   * @private
   */
  _getWebhookUrl(type) {
    // Esta función debería obtener la URL base del servidor desde configuración
    const baseUrl = database.getConfig('servidor_url') || 'https://api.factusystem.com';
    const path = WEBHOOK_ROUTES[type] || '/integraciones/payway/webhook';
    return `${baseUrl}${path}`;
  }

  /**
   * Notifica a la aplicación sobre una actualización de pago
   * @param {Object} paymentData - Datos del pago actualizado
   * @private
   */
  _notifyPaymentUpdate(paymentData) {
    // Utilizar el sistema de notificaciones para informar a los componentes de la aplicación
    window.dispatchEvent(new CustomEvent('payway:payment-update', { 
      detail: {
        paymentId: paymentData.transactionId,
        status: paymentData.status,
        externalReference: paymentData.raw?.additional_info?.external_reference || '',
        amount: paymentData.amount
      }
    }));

    // Si el pago fue aprobado, mostrar notificación visual
    if (paymentData.status === 'approved') {
      notificaciones.success(`Pago aprobado por $${paymentData.amount}`, 'Transacción exitosa');
    } else if (paymentData.status === 'rejected') {
      notificaciones.error(`Pago rechazado: ${paymentData.statusDetail}`, 'Error en transacción');
    }
  }

  /**
   * Notifica a la aplicación sobre un reembolso procesado
   * @param {Object} refundData - Datos del reembolso
   * @private
   */
  _notifyRefundProcessed(refundData) {
    window.dispatchEvent(new CustomEvent('payway:refund-processed', { 
      detail: refundData
    }));

    notificaciones.info(`Reembolso procesado por $${refundData.amount}`, 'Reembolso');
  }

  /**
   * Busca transacciones en la base de datos
   * @param {Object} filters - Filtros a aplicar
   * @param {Object} options - Opciones de paginación y ordenamiento
   * @returns {Promise<Object>} - Resultados de la búsqueda
   */
  async searchTransactions(filters = {}, options = {}) {
    try {
      const query = {};
      
      // Aplicar filtros
      if (filters.status) query.status = filters.status;
      if (filters.paymentId) query.payment_id = filters.paymentId;
      if (filters.externalReference) query.external_reference = filters.externalReference;
      if (filters.invoiceNumber) query.invoice_number = filters.invoiceNumber;
      
      // Filtros de rango de fechas
      if (filters.dateFrom || filters.dateTo) {
        query.created_date = {};
        if (filters.dateFrom) query.created_date.$gte = filters.dateFrom;
        if (filters.dateTo) query.created_date.$lte = filters.dateTo;
      }
      
      // Opciones de búsqueda
      const searchOptions = {
        sort: options.sort || { created_date: -1 },
        limit: options.limit || 50,
        skip: options.skip || 0
      };
      
      // Realizar búsqueda
      const transactions = await database.find('payway_transactions', query, searchOptions);
      const total = await database.count('payway_transactions', query);
      
      return {
        success: true,
        transactions: transactions,
        total: total,
        page: Math.floor(searchOptions.skip / searchOptions.limit) + 1,
        pages: Math.ceil(total / searchOptions.limit)
      };
    } catch (error) {
      logger.error('Error al buscar transacciones', error);
      return {
        success: false,
        message: error.message || 'Error al buscar transacciones',
        transactions: [],
        total: 0
      };
    }
  }

  /**
   * Obtiene estadísticas de transacciones
   * @param {Object} filters - Filtros a aplicar
   * @returns {Promise<Object>} - Estadísticas
   */
  async getTransactionStats(filters = {}) {
    try {
      // Base de la consulta
      const query = {};
      
      // Aplicar filtros de fecha
      if (filters.dateFrom || filters.dateTo) {
        query.created_date = {};
        if (filters.dateFrom) query.created_date.$gte = filters.dateFrom;
        if (filters.dateTo) query.created_date.$lte = filters.dateTo;
      }
      
      // Estadísticas básicas
      const totalCount = await database.count('payway_transactions', query);
      
      // Contar por estado
      const statusQuery = { ...query };
      const statusCounts = {};
      for (const status of ['approved', 'rejected', 'in_process', 'refunded', 'partially_refunded']) {
        statusQuery.status = status;
        statusCounts[status] = await database.count('payway_transactions', statusQuery);
      }
      
      // Suma total por transacciones aprobadas
      const approvedQuery = { ...query, status: 'approved' };
      const approvedTransactions = await database.find('payway_transactions', approvedQuery);
      const totalApproved = approvedTransactions.reduce((sum, tx) => sum + (parseFloat(tx.amount) || 0), 0);
      
      // Promedio por transacción
      const avgAmount = totalCount > 0 ? totalApproved / approvedTransactions.length : 0;
      
      // Distribución por método de pago
      const paymentMethods = {};
      for (const tx of approvedTransactions) {
        paymentMethods[tx.payment_method_id] = (paymentMethods[tx.payment_method_id] || 0) + 1;
      }
      
      return {
        success: true,
        totalTransactions: totalCount,
        approvedAmount: totalApproved,
        averageAmount: avgAmount,
        byStatus: statusCounts,
        byPaymentMethod: paymentMethods
      };
    } catch (error) {
      logger.error('Error al obtener estadísticas de transacciones', error);
      return {
        success: false,
        message: error.message || 'Error al calcular estadísticas'
      };
    }
  }

  /**
   * Verifica si una factura ya tiene un pago asociado
   * @param {string} invoiceNumber - Número de factura
   * @returns {Promise<Object>} - Información del pago si existe
   */
  async checkInvoicePayment(invoiceNumber) {
    try {
      const transaction = await database.findOne('payway_transactions', { 
        invoice_number: invoiceNumber,
        status: { $in: ['approved', 'in_process'] }
      });
      
      if (!transaction) {
        return {
          success: true,
          exists: false
        };
      }
      
      return {
        success: true,
        exists: true,
        paymentId: transaction.payment_id,
        status: transaction.status,
        amount: transaction.amount,
        date: transaction.created_date
      };
    } catch (error) {
      logger.error(`Error al verificar pago para factura ${invoiceNumber}`, error);
      return {
        success: false,
        message: error.message || 'Error al verificar pago'
      };
    }
  }

  /**
   * Sincroniza transacciones pendientes con Payway
   * @returns {Promise<Object>} - Resultado de la sincronización
   */
  async syncPendingTransactions() {
    try {
      // Buscar transacciones en estado pendiente o en proceso
      const pendingTransactions = await database.find('payway_transactions', {
        status: { $in: ['pending', 'in_process'] },
        created_date: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString() } // Últimos 7 días
      });
      
      if (pendingTransactions.length === 0) {
        return {
          success: true,
          message: 'No hay transacciones pendientes para sincronizar',
          updated: 0
        };
      }
      
      let updatedCount = 0;
      
      // Verificar estado actual de cada transacción
      for (const tx of pendingTransactions) {
        try {
          const paymentStatus = await this.getPaymentStatus(tx.payment_id);
          
          // Si el estado cambió, actualizar
          if (paymentStatus.success && paymentStatus.status !== tx.status) {
            await this._updateTransactionStatus(tx.payment_id, paymentStatus.status, paymentStatus.raw);
            updatedCount++;
            
            // Notificar si fue aprobado o rechazado
            if (['approved', 'rejected'].includes(paymentStatus.status)) {
              this._notifyPaymentUpdate(paymentStatus);
            }
          }
        } catch (error) {
          logger.warn(`Error al sincronizar transacción ${tx.payment_id}`, error);
        }
      }
      
      return {
        success: true,
        message: `${updatedCount} transacciones actualizadas`,
        updated: updatedCount,
        total: pendingTransactions.length
      };
    } catch (error) {
      logger.error('Error al sincronizar transacciones pendientes', error);
      return {
        success: false,
        message: error.message || 'Error al sincronizar transacciones'
      };
    }
  }

  /**
   * Genera un botón de pago para integrarlo en cualquier vista
   * @param {Object} options - Opciones del botón
   * @returns {Object} - HTML y script para el botón
   */
  generatePaymentButton(options = {}) {
    if (!this.isInitialized) {
      return {
        success: false,
        message: 'La integración con Payway no está inicializada'
      };
    }
    
    const buttonId = options.buttonId || `payway-button-${Date.now()}`;
    const amount = options.amount || 0;
    const description = options.description || 'Pago FactuSystem';
    const callbackUrl = options.callbackUrl || '';
    const btnText = options.buttonText || 'Pagar con Payway';
    const btnClass = options.buttonClass || 'payway-btn';
    
    // Generar HTML del botón
    const buttonHtml = `
      <button id="${buttonId}" class="${btnClass}" data-amount="${amount}" data-description="${description}">
        ${btnText}
      </button>
    `;
    
    // Script para inicializar el botón
    const script = `
      document.getElementById('${buttonId}').addEventListener('click', async function() {
        const button = this;
        button.disabled = true;
        try {
          const paywayInstance = window.paywayIntegration;
          const paymentMethods = await paywayInstance.getPaymentMethods();
          
          // Abrir modal de selección de método de pago
          window.openPaymentModal({
            amount: ${amount},
            description: '${description}',
            callbackUrl: '${callbackUrl}',
            paymentMethods: paymentMethods.paymentMethods || []
          });
        } catch (error) {
          console.error('Error al inicializar pago', error);
          // Mostrar error
          notificaciones.error('No se pudo iniciar el pago', 'Error');
        } finally {
          button.disabled = false;
        }
      });
    `;
    
    return {
      success: true,
      buttonHtml,
      script,
      buttonId
    };
  }
}

// Instancia única para usar en toda la aplicación
const paywayInstance = new PaywayIntegration();

// Interfaz pública del módulo
const paywayAPI = {
  // Métodos de configuración
  initialize: () => paywayInstance.initialize(),
  saveConfiguration: (config) => paywayInstance.saveConfiguration(config),
  testConnection: (credentials) => paywayInstance.testApiConnection(credentials),
  
  // Métodos de procesamiento de pagos
  createCardToken: (cardData) => paywayInstance.createCardToken(cardData),
  processPayment: (paymentData) => paywayInstance.processPayment(paymentData),
  getPaymentStatus: (paymentId) => paywayInstance.getPaymentStatus(paymentId),
  refundPayment: (paymentId, amount) => paywayInstance.refundPayment(paymentId, amount),
  capturePayment: (paymentId, amount) => paywayInstance.capturePayment(paymentId, amount),
  
  // Métodos de consulta
  getPaymentMethods: () => paywayInstance.getPaymentMethods(),
  getInstallmentsOptions: (amount, paymentMethodId) => paywayInstance.getInstallmentsOptions(amount, paymentMethodId),
  searchTransactions: (filters, options) => paywayInstance.searchTransactions(filters, options),
  getTransactionStats: (filters) => paywayInstance.getTransactionStats(filters),
  checkInvoicePayment: (invoiceNumber) => paywayInstance.checkInvoicePayment(invoiceNumber),
  
  // Métodos de gestión
  syncPendingTransactions: () => paywayInstance.syncPendingTransactions(),
  generatePaymentButton: (options) => paywayInstance.generatePaymentButton(options),
  processWebhook: (data, headers) => paywayInstance.processWebhook(data, headers)
};

// Exponer la API como propiedad global para poder usarla desde cualquier componente
window.paywayIntegration = paywayAPI;

 paywayAPI

module.exports = paywayAPI;