/**
 * @file getnet.js
 * @description Integración con Getnet para procesamiento de pagos
 * @module integrations/bancos/getnet
 */

const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');
const logger = require('../../services/audit/logger.js');

// Configuración base para la API de Getnet
class GetnetAPI {
  constructor() {
    this.config = {
      sandbox: true, // true para ambiente de pruebas, false para producción
      apiUrl: '',
      apiKey: '',
      merchantId: '',
      terminalId: '',
      secretKey: '',
      tokenExpiration: 3600 * 1000, // 1 hora en milisegundos
      timeout: 30000 // 30 segundos de timeout para las peticiones
    };
    this.token = null;
    this.tokenTimestamp = 0;
    this.initialized = false;
  }

  /**
   * Inicializa la configuración de Getnet desde el archivo de configuración
   * @param {Object} userConfig - Configuración provista por el usuario
   * @returns {Promise<boolean>} - True si la inicialización fue exitosa
   */
  async initialize(userConfig = null) {
    try {
      // Si se proporcionan configuraciones, las utilizamos
      if (userConfig) {
        this.config = { ...this.config, ...userConfig };
      } else {
        // Sino, intentamos cargar de un archivo de configuración
        const configPath = path.join(process.cwd(), 'config', 'getnet.json');
        if (fs.existsSync(configPath)) {
          const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          this.config = { ...this.config, ...fileConfig };
        }
      }

      // Configuramos la URL base según el entorno
      this.config.apiUrl = this.config.sandbox 
        ? 'https://api.getnetpagos.com.ar/sandbox/v1'
        : 'https://api.getnetpagos.com.ar/v1';

      // Validamos que tengamos las credenciales necesarias
      if (!this.config.apiKey || !this.config.merchantId || !this.config.secretKey) {
        logger.error('Getnet: Faltan credenciales para la integración');
        return false;
      }

      // Obtenemos un token para verificar la autenticación
      const tokenResult = await this.getAuthToken();
      if (!tokenResult) {
        logger.error('Getnet: No se pudo obtener el token de autenticación');
        return false;
      }

      logger.info('Getnet: Integración inicializada correctamente');
      this.initialized = true;
      return true;
    } catch (error) {
      logger.error(`Getnet: Error al inicializar la integración: ${error.message}`);
      return false;
    }
  }

  /**
   * Obtiene o refresca el token de autenticación
   * @returns {Promise<string|null>} - El token de autenticación o null si hay error
   */
  async getAuthToken() {
    try {
      // Verificamos si el token actual todavía es válido
      const now = Date.now();
      if (this.token && now - this.tokenTimestamp < this.config.tokenExpiration) {
        return this.token;
      }

      // Solicitamos un nuevo token
      const authEndpoint = `${this.config.apiUrl}/auth/token`;
      const authData = {
        apiKey: this.config.apiKey,
        merchantId: this.config.merchantId
      };

      const signature = this._generateSignature(authData);
      
      const response = await axios.post(authEndpoint, authData, {
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': this.config.apiKey,
          'X-MERCHANT-ID': this.config.merchantId,
          'X-SIGNATURE': signature
        },
        timeout: this.config.timeout
      });

      if (response.data && response.data.token) {
        this.token = response.data.token;
        this.tokenTimestamp = now;
        return this.token;
      } else {
        logger.error('Getnet: Formato de respuesta de token inválido');
        return null;
      }
    } catch (error) {
      logger.error(`Getnet: Error al obtener token: ${error.message}`);
      return null;
    }
  }

  /**
   * Genera una firma para autenticar las peticiones
   * @param {Object} data - Datos para generar la firma
   * @returns {string} - Firma generada
   */
  _generateSignature(data) {
    const payload = JSON.stringify(data);
    const hmac = crypto.createHmac('sha256', this.config.secretKey);
    return hmac.update(payload).digest('hex');
  }

  /**
   * Realiza una petición autenticada a la API de Getnet
   * @param {string} endpoint - Endpoint de la API
   * @param {string} method - Método HTTP (GET, POST, etc.)
   * @param {Object} data - Datos para enviar en la petición
   * @returns {Promise<Object|null>} - Respuesta de la API o null si hay error
   */
  async _makeRequest(endpoint, method = 'GET', data = null) {
    try {
      if (!this.initialized) {
        throw new Error('La integración con Getnet no ha sido inicializada');
      }

      const token = await this.getAuthToken();
      if (!token) {
        throw new Error('No se pudo obtener un token válido');
      }

      const url = `${this.config.apiUrl}${endpoint}`;
      const signature = data ? this._generateSignature(data) : '';
      
      const requestConfig = {
        method,
        url,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-API-KEY': this.config.apiKey,
          'X-MERCHANT-ID': this.config.merchantId
        },
        timeout: this.config.timeout
      };

      if (data) {
        requestConfig.data = data;
        requestConfig.headers['X-SIGNATURE'] = signature;
      }

      const response = await axios(requestConfig);
      return response.data;
    } catch (error) {
      if (error.response) {
        logger.error(`Getnet API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      } else {
        logger.error(`Getnet Request Error: ${error.message}`);
      }
      return null;
    }
  }

  /**
   * Procesa un pago con tarjeta de débito o crédito
   * @param {Object} paymentData - Datos del pago
   * @returns {Promise<Object|null>} - Resultado del pago o null si hay error
   */
  async processCardPayment(paymentData) {
    try {
      // Validamos los datos mínimos requeridos
      const requiredFields = ['amount', 'cardNumber', 'cardHolder', 'expirationMonth', 'expirationYear', 'securityCode'];
      for (const field of requiredFields) {
        if (!paymentData[field]) {
          throw new Error(`El campo ${field} es obligatorio para procesar un pago con tarjeta`);
        }
      }

      // Creamos el objeto de pago según el formato de Getnet
      const paymentRequest = {
        transaction: {
          id: paymentData.transactionId || `FACTUSYS-${Date.now()}`,
          amount: parseFloat(paymentData.amount).toFixed(2),
          currency: paymentData.currency || 'ARS',
          description: paymentData.description || 'Pago FactuSystem'
        },
        card: {
          number: paymentData.cardNumber.replace(/\s/g, ''),
          holder: {
            name: paymentData.cardHolder
          },
          expiration: {
            month: paymentData.expirationMonth,
            year: paymentData.expirationYear
          },
          securityCode: paymentData.securityCode
        },
        customer: {
          id: paymentData.customerId || 'GUEST',
          email: paymentData.email || null,
          identification: {
            type: paymentData.idType || 'DNI',
            number: paymentData.idNumber || ''
          }
        },
        installments: paymentData.installments || 1,
        capture: true,
        softDescriptor: 'FACTUSYSTEM'
      };

      // Agregamos datos adicionales si están disponibles
      if (paymentData.installments > 1) {
        paymentRequest.installmentsDetails = {
          type: paymentData.installmentType || 'regular'
        };
      }

      // Enviar la solicitud de pago
      const response = await this._makeRequest('/payments', 'POST', paymentRequest);
      if (response) {
        logger.info(`Getnet: Pago procesado exitosamente - ID: ${response.id}`);
      }
      return response;
    } catch (error) {
      logger.error(`Getnet: Error al procesar pago: ${error.message}`);
      return null;
    }
  }

  /**
   * Realiza un pago QR
   * @param {Object} qrPaymentData - Datos para el pago QR
   * @returns {Promise<Object|null>} - Resultado del pago o null si hay error
   */
  async generateQRPayment(qrPaymentData) {
    try {
      // Validamos datos mínimos requeridos
      if (!qrPaymentData.amount) {
        throw new Error('El monto es obligatorio para generar un pago QR');
      }

      const qrRequest = {
        transaction: {
          id: qrPaymentData.transactionId || `FACTUSYS-QR-${Date.now()}`,
          amount: parseFloat(qrPaymentData.amount).toFixed(2),
          currency: qrPaymentData.currency || 'ARS',
          description: qrPaymentData.description || 'Pago QR FactuSystem'
        },
        callbackUrl: qrPaymentData.callbackUrl || null,
        expirationTime: qrPaymentData.expirationMinutes || 30 // Tiempo en minutos
      };

      const response = await this._makeRequest('/qr/generate', 'POST', qrRequest);
      if (response && response.qrCode) {
        logger.info(`Getnet: QR generado exitosamente - ID: ${response.id}`);
      }
      return response;
    } catch (error) {
      logger.error(`Getnet: Error al generar QR: ${error.message}`);
      return null;
    }
  }

  /**
   * Consulta el estado de un pago
   * @param {string} paymentId - ID del pago a consultar
   * @returns {Promise<Object|null>} - Estado del pago o null si hay error
   */
  async getPaymentStatus(paymentId) {
    try {
      if (!paymentId) {
        throw new Error('El ID del pago es obligatorio para consultar su estado');
      }

      const response = await this._makeRequest(`/payments/${paymentId}`, 'GET');
      return response;
    } catch (error) {
      logger.error(`Getnet: Error al consultar estado de pago: ${error.message}`);
      return null;
    }
  }

  /**
   * Consulta el estado de un pago QR
   * @param {string} qrId - ID del pago QR a consultar
   * @returns {Promise<Object|null>} - Estado del pago QR o null si hay error
   */
  async getQRPaymentStatus(qrId) {
    try {
      if (!qrId) {
        throw new Error('El ID del QR es obligatorio para consultar su estado');
      }

      const response = await this._makeRequest(`/qr/${qrId}/status`, 'GET');
      return response;
    } catch (error) {
      logger.error(`Getnet: Error al consultar estado de QR: ${error.message}`);
      return null;
    }
  }

  /**
   * Cancela un pago pendiente
   * @param {string} paymentId - ID del pago a cancelar
   * @returns {Promise<Object|null>} - Resultado de la cancelación o null si hay error
   */
  async cancelPayment(paymentId) {
    try {
      if (!paymentId) {
        throw new Error('El ID del pago es obligatorio para cancelarlo');
      }

      const response = await this._makeRequest(`/payments/${paymentId}/cancel`, 'POST');
      if (response) {
        logger.info(`Getnet: Pago cancelado exitosamente - ID: ${paymentId}`);
      }
      return response;
    } catch (error) {
      logger.error(`Getnet: Error al cancelar pago: ${error.message}`);
      return null;
    }
  }

  /**
   * Realiza una devolución total o parcial de un pago
   * @param {string} paymentId - ID del pago a reembolsar
   * @param {number} amount - Monto a reembolsar (opcional, si no se indica se devuelve el total)
   * @returns {Promise<Object|null>} - Resultado de la devolución o null si hay error
   */
  async refundPayment(paymentId, amount = null) {
    try {
      if (!paymentId) {
        throw new Error('El ID del pago es obligatorio para realizar una devolución');
      }

      const refundData = amount ? { amount: parseFloat(amount).toFixed(2) } : {};
      const refundEndpoint = `/payments/${paymentId}/refund`;
      
      const response = await this._makeRequest(refundEndpoint, 'POST', refundData);
      if (response) {
        logger.info(`Getnet: Devolución procesada exitosamente - ID: ${paymentId}`);
      }
      return response;
    } catch (error) {
      logger.error(`Getnet: Error al procesar devolución: ${error.message}`);
      return null;
    }
  }

  /**
   * Obtiene el historial de transacciones
   * @param {Object} filters - Filtros para la consulta
   * @returns {Promise<Object|null>} - Listado de transacciones o null si hay error
   */
  async getTransactionHistory(filters = {}) {
    try {
      const queryParams = new URLSearchParams();
      
      // Agregar filtros a la consulta
      if (filters.startDate) queryParams.append('startDate', filters.startDate);
      if (filters.endDate) queryParams.append('endDate', filters.endDate);
      if (filters.status) queryParams.append('status', filters.status);
      if (filters.page) queryParams.append('page', filters.page);
      if (filters.limit) queryParams.append('limit', filters.limit);
      
      const endpoint = `/transactions?${queryParams.toString()}`;
      return await this._makeRequest(endpoint, 'GET');
    } catch (error) {
      logger.error(`Getnet: Error al obtener historial de transacciones: ${error.message}`);
      return null;
    }
  }

  /**
   * Valida si una tarjeta es válida (tokenización)
   * @param {Object} cardData - Datos de la tarjeta a validar
   * @returns {Promise<Object|null>} - Resultado de la validación o null si hay error
   */
  async validateCardToken(cardData) {
    try {
      // Validamos datos mínimos requeridos
      const requiredFields = ['cardNumber', 'cardHolder', 'expirationMonth', 'expirationYear'];
      for (const field of requiredFields) {
        if (!cardData[field]) {
          throw new Error(`El campo ${field} es obligatorio para validar una tarjeta`);
        }
      }

      const tokenRequest = {
        card: {
          number: cardData.cardNumber.replace(/\s/g, ''),
          holder: {
            name: cardData.cardHolder
          },
          expiration: {
            month: cardData.expirationMonth,
            year: cardData.expirationYear
          }
        }
      };

      const response = await this._makeRequest('/cards/tokenize', 'POST', tokenRequest);
      if (response && response.token) {
        logger.info('Getnet: Tarjeta validada y tokenizada correctamente');
      }
      return response;
    } catch (error) {
      logger.error(`Getnet: Error al validar tarjeta: ${error.message}`);
      return null;
    }
  }
}

// Instancia única de la API de Getnet
const getnetAPI = new GetnetAPI();

// Configuración de manejadores IPC para comunicación con el renderer
if (ipcMain) {
  // Inicializar configuración
  ipcMain.handle('getnet:initialize', async (event, config) => {
    return await getnetAPI.initialize(config);
  });

  // Procesar pago con tarjeta
  ipcMain.handle('getnet:processCardPayment', async (event, paymentData) => {
    return await getnetAPI.processCardPayment(paymentData);
  });

  // Generar código QR para pago
  ipcMain.handle('getnet:generateQRPayment', async (event, qrPaymentData) => {
    return await getnetAPI.generateQRPayment(qrPaymentData);
  });

  // Consultar estado de un pago
  ipcMain.handle('getnet:getPaymentStatus', async (event, paymentId) => {
    return await getnetAPI.getPaymentStatus(paymentId);
  });

  // Consultar estado de un pago QR
  ipcMain.handle('getnet:getQRPaymentStatus', async (event, qrId) => {
    return await getnetAPI.getQRPaymentStatus(qrId);
  });

  // Cancelar un pago
  ipcMain.handle('getnet:cancelPayment', async (event, paymentId) => {
    return await getnetAPI.cancelPayment(paymentId);
  });

  // Reembolsar un pago
  ipcMain.handle('getnet:refundPayment', async (event, { paymentId, amount }) => {
    return await getnetAPI.refundPayment(paymentId, amount);
  });

  // Obtener historial de transacciones
  ipcMain.handle('getnet:getTransactionHistory', async (event, filters) => {
    return await getnetAPI.getTransactionHistory(filters);
  });

  // Validar tarjeta (tokenización)
  ipcMain.handle('getnet:validateCardToken', async (event, cardData) => {
    return await getnetAPI.validateCardToken(cardData);
  });
}

/**
 * Funciones exportadas para uso en el resto de la aplicación
 */
module.exports = {
  /**
   * Inicializa la integración con Getnet
   * @param {Object} config - Configuración para la integración
   * @returns {Promise<boolean>} - True si la inicialización fue exitosa
   */
  initialize: async (config) => {
    return await getnetAPI.initialize(config);
  },

  /**
   * Procesa un pago con tarjeta de débito o crédito
   * @param {Object} paymentData - Datos del pago
   * @returns {Promise<Object|null>} - Resultado del pago o null si hay error
   */
  processCardPayment: async (paymentData) => {
    return await getnetAPI.processCardPayment(paymentData);
  },

  /**
   * Genera un código QR para realizar un pago
   * @param {Object} qrPaymentData - Datos para el pago QR
   * @returns {Promise<Object|null>} - Resultado con el código QR o null si hay error
   */
  generateQRPayment: async (qrPaymentData) => {
    return await getnetAPI.generateQRPayment(qrPaymentData);
  },

  /**
   * Consulta el estado de un pago
   * @param {string} paymentId - ID del pago a consultar
   * @returns {Promise<Object|null>} - Estado del pago o null si hay error
   */
  getPaymentStatus: async (paymentId) => {
    return await getnetAPI.getPaymentStatus(paymentId);
  },

  /**
   * Consulta el estado de un pago QR
   * @param {string} qrId - ID del pago QR a consultar
   * @returns {Promise<Object|null>} - Estado del pago QR o null si hay error
   */
  getQRPaymentStatus: async (qrId) => {
    return await getnetAPI.getQRPaymentStatus(qrId);
  },

  /**
   * Cancela un pago pendiente
   * @param {string} paymentId - ID del pago a cancelar
   * @returns {Promise<Object|null>} - Resultado de la cancelación o null si hay error
   */
  cancelPayment: async (paymentId) => {
    return await getnetAPI.cancelPayment(paymentId);
  },

  /**
   * Realiza una devolución total o parcial de un pago
   * @param {string} paymentId - ID del pago a reembolsar
   * @param {number} amount - Monto a reembolsar (opcional, si no se indica se devuelve el total)
   * @returns {Promise<Object|null>} - Resultado de la devolución o null si hay error
   */
  refundPayment: async (paymentId, amount = null) => {
    return await getnetAPI.refundPayment(paymentId, amount);
  },

  /**
   * Obtiene el historial de transacciones
   * @param {Object} filters - Filtros para la consulta
   * @returns {Promise<Object|null>} - Listado de transacciones o null si hay error
   */
  getTransactionHistory: async (filters = {}) => {
    return await getnetAPI.getTransactionHistory(filters);
  },

  /**
   * Valida si una tarjeta es válida (tokenización)
   * @param {Object} cardData - Datos de la tarjeta a validar
   * @returns {Promise<Object|null>} - Resultado de la validación o null si hay error
   */
  validateCardToken: async (cardData) => {
    return await getnetAPI.validateCardToken(cardData);
  }
};