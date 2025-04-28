/**
 * @fileoverview API común para integraciones bancarias en FactuSystem
 * Este archivo sirve como interfaz unificada para todas las APIs bancarias
 * soportadas por el sistema, proporcionando métodos consistentes para
 * autenticación, consulta de saldos, transacciones y procesamiento de pagos.
 * 
 * @version 1.0.0
 * @author FactuSystem
 */

const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');
const axios = require('axios');
const { EventEmitter } = require('events');

// Importamos los módulos específicos de cada banco
const galiciaAPI = require('./galicia');
const getnetAPI = require('./getnet');
const bbvaAPI = require('./bbva');
const paywayAPI = require('./payway');

// Logger para auditoría
const logger = require('../../services/audit/logger');

// Clase para manejar errores específicos de la API bancaria
class BankAPIError extends Error {
  constructor(message, bankName, errorCode, originalError = null) {
    super(message);
    this.name = 'BankAPIError';
    this.bankName = bankName;
    this.errorCode = errorCode;
    this.originalError = originalError;
  }
}

/**
 * Clase principal que proporciona una interfaz común para todas las APIs bancarias
 */
class BankAPI extends EventEmitter {
  constructor() {
    super();
    this.supportedBanks = {
      'galicia': galiciaAPI,
      'getnet': getnetAPI,
      'bbva': bbvaAPI,
      'payway': paywayAPI
    };
    
    // Estado de conexión con cada banco
    this.connectionStatus = {
      'galicia': false,
      'getnet': false,
      'bbva': false,
      'payway': false
    };
    
    // Tokens y datos de autenticación
    this.authTokens = {};
    
    // Cache para reducir llamadas innecesarias
    this.cache = {
      balances: {},
      transactions: {}
    };
    
    // Configurar los listeners de IPC para comunicación con el renderer
    this._setupIPCListeners();
  }
  
  /**
   * Configura los listeners para eventos IPC desde la interfaz de usuario
   * @private
   */
  _setupIPCListeners() {
    ipcMain.handle('bank-authenticate', async (event, bankName, credentials) => {
      try {
        return await this.authenticate(bankName, credentials);
      } catch (error) {
        logger.error(`Error en autenticación con ${bankName}`, { error: error.message });
        return { success: false, error: error.message };
      }
    });
    
    ipcMain.handle('bank-get-balance', async (event, bankName, accountInfo) => {
      try {
        return await this.getBalance(bankName, accountInfo);
      } catch (error) {
        logger.error(`Error al obtener saldo de ${bankName}`, { error: error.message });
        return { success: false, error: error.message };
      }
    });
    
    ipcMain.handle('bank-get-transactions', async (event, bankName, accountInfo, dateRange) => {
      try {
        return await this.getTransactions(bankName, accountInfo, dateRange);
      } catch (error) {
        logger.error(`Error al obtener transacciones de ${bankName}`, { error: error.message });
        return { success: false, error: error.message };
      }
    });
    
    ipcMain.handle('bank-process-payment', async (event, bankName, paymentData) => {
      try {
        return await this.processPayment(bankName, paymentData);
      } catch (error) {
        logger.error(`Error al procesar pago con ${bankName}`, { error: error.message });
        return { success: false, error: error.message };
      }
    });
    
    ipcMain.handle('bank-check-payment-status', async (event, bankName, paymentId) => {
      try {
        return await this.checkPaymentStatus(bankName, paymentId);
      } catch (error) {
        logger.error(`Error al verificar estado del pago con ${bankName}`, { error: error.message });
        return { success: false, error: error.message };
      }
    });
    
    ipcMain.handle('bank-get-connection-status', (event) => {
      return this.connectionStatus;
    });
  }
  
  /**
   * Valida si un banco es soportado por el sistema
   * @param {string} bankName - Nombre del banco
   * @throws {BankAPIError} Si el banco no está soportado
   * @private
   */
  _validateBank(bankName) {
    if (!this.supportedBanks[bankName]) {
      throw new BankAPIError(
        `El banco ${bankName} no está soportado por el sistema`,
        bankName,
        'BANK_NOT_SUPPORTED'
      );
    }
  }
  
  /**
   * Carga la configuración guardada para un banco específico
   * @param {string} bankName - Nombre del banco
   * @returns {Object} Configuración del banco
   * @private
   */
  _loadBankConfig(bankName) {
    try {
      const configPath = path.join(__dirname, '..', '..', 'app', 'assets', 'js', 'modules', 'configuraciones', 'integraciones', 'bancos', `${bankName}.config.json`);
      
      if (!fs.existsSync(configPath)) {
        return null;
      }
      
      const configData = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(configData);
    } catch (error) {
      logger.error(`Error al cargar configuración de ${bankName}`, { error: error.message });
      return null;
    }
  }
  
  /**
   * Guarda la configuración actualizada para un banco específico
   * @param {string} bankName - Nombre del banco
   * @param {Object} config - Configuración a guardar
   * @private
   */
  _saveBankConfig(bankName, config) {
    try {
      const configDir = path.join(__dirname, '..', '..', 'app', 'assets', 'js', 'modules', 'configuraciones', 'integraciones', 'bancos');
      
      // Asegurarse de que exista el directorio
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      
      const configPath = path.join(configDir, `${bankName}.config.json`);
      
      // Eliminar datos sensibles antes de guardar
      const safeConfig = { ...config };
      delete safeConfig.password;
      delete safeConfig.rawCredentials;
      
      fs.writeFileSync(configPath, JSON.stringify(safeConfig, null, 2), 'utf8');
    } catch (error) {
      logger.error(`Error al guardar configuración de ${bankName}`, { error: error.message });
    }
  }
  
  /**
   * Realiza autenticación con el banco seleccionado
   * @param {string} bankName - Nombre del banco (galicia, getnet, bbva, payway)
   * @param {Object} credentials - Credenciales de autenticación
   * @returns {Promise<Object>} Resultado de la autenticación
   */
  async authenticate(bankName, credentials) {
    this._validateBank(bankName);
    
    try {
      logger.info(`Iniciando autenticación con ${bankName}`);
      
      // Obtener token de autenticación usando la API específica del banco
      const result = await this.supportedBanks[bankName].authenticate(credentials);
      
      if (result.success) {
        this.connectionStatus[bankName] = true;
        this.authTokens[bankName] = result.token;
        
        // Guardar información de conexión
        const config = this._loadBankConfig(bankName) || {};
        config.lastAuthentication = new Date().toISOString();
        config.tokenExpiration = result.expiresAt;
        config.merchantId = result.merchantId;
        this._saveBankConfig(bankName, config);
        
        logger.info(`Autenticación exitosa con ${bankName}`);
        this.emit('bank-connected', bankName);
      } else {
        this.connectionStatus[bankName] = false;
        logger.error(`Fallo en autenticación con ${bankName}: ${result.error}`);
      }
      
      return result;
    } catch (error) {
      this.connectionStatus[bankName] = false;
      logger.error(`Error en autenticación con ${bankName}`, { error: error.message });
      
      throw new BankAPIError(
        `Error al autenticar con ${bankName}: ${error.message}`,
        bankName,
        'AUTH_ERROR',
        error
      );
    }
  }
  
  /**
   * Verifica si la autenticación actual sigue siendo válida
   * @param {string} bankName - Nombre del banco
   * @returns {Promise<boolean>} Estado de la autenticación
   */
  async checkAuthentication(bankName) {
    this._validateBank(bankName);
    
    // Si no hay token, no estamos autenticados
    if (!this.authTokens[bankName]) {
      this.connectionStatus[bankName] = false;
      return false;
    }
    
    // Cargamos la configuración para verificar expiración
    const config = this._loadBankConfig(bankName);
    if (!config || !config.tokenExpiration) {
      this.connectionStatus[bankName] = false;
      return false;
    }
    
    // Verificar si el token ha expirado
    const expirationDate = new Date(config.tokenExpiration);
    if (expirationDate <= new Date()) {
      this.connectionStatus[bankName] = false;
      return false;
    }
    
    try {
      // Realizar una verificación con la API del banco
      const isValid = await this.supportedBanks[bankName].verifyToken(this.authTokens[bankName]);
      this.connectionStatus[bankName] = isValid;
      return isValid;
    } catch (error) {
      logger.error(`Error al verificar autenticación con ${bankName}`, { error: error.message });
      this.connectionStatus[bankName] = false;
      return false;
    }
  }
  
  /**
   * Obtiene el saldo de una cuenta bancaria
   * @param {string} bankName - Nombre del banco
   * @param {Object} accountInfo - Información de la cuenta
   * @returns {Promise<Object>} Saldo y detalles de la cuenta
   */
  async getBalance(bankName, accountInfo) {
    this._validateBank(bankName);
    
    // Verificar autenticación
    if (!await this.checkAuthentication(bankName)) {
      throw new BankAPIError(
        `No hay una sesión válida para ${bankName}`,
        bankName,
        'INVALID_SESSION'
      );
    }
    
    try {
      logger.info(`Consultando saldo en ${bankName}`);
      
      // Usar caché si está disponible y es reciente (5 minutos)
      const cacheKey = `${bankName}_${accountInfo.accountId || 'default'}`;
      const cachedData = this.cache.balances[cacheKey];
      
      if (cachedData && (new Date() - cachedData.timestamp) < 5 * 60 * 1000) {
        return cachedData.data;
      }
      
      // Obtener saldo usando la API específica del banco
      const result = await this.supportedBanks[bankName].getBalance(
        this.authTokens[bankName],
        accountInfo
      );
      
      // Actualizar caché
      if (result.success) {
        this.cache.balances[cacheKey] = {
          timestamp: new Date(),
          data: result
        };
      }
      
      return result;
    } catch (error) {
      logger.error(`Error al consultar saldo en ${bankName}`, { error: error.message });
      
      throw new BankAPIError(
        `Error al consultar saldo en ${bankName}: ${error.message}`,
        bankName,
        'BALANCE_ERROR',
        error
      );
    }
  }
  
  /**
   * Obtiene las transacciones de una cuenta bancaria en un rango de fechas
   * @param {string} bankName - Nombre del banco
   * @param {Object} accountInfo - Información de la cuenta
   * @param {Object} dateRange - Rango de fechas para filtrar transacciones
   * @returns {Promise<Object>} Lista de transacciones
   */
  async getTransactions(bankName, accountInfo, dateRange) {
    this._validateBank(bankName);
    
    // Verificar autenticación
    if (!await this.checkAuthentication(bankName)) {
      throw new BankAPIError(
        `No hay una sesión válida para ${bankName}`,
        bankName,
        'INVALID_SESSION'
      );
    }
    
    try {
      logger.info(`Consultando transacciones en ${bankName}`);
      
      // Generar clave de caché única
      const from = dateRange.from.toISOString().split('T')[0];
      const to = dateRange.to.toISOString().split('T')[0];
      const cacheKey = `${bankName}_${accountInfo.accountId || 'default'}_${from}_${to}`;
      
      // Usar caché si está disponible y es del mismo día
      const cachedData = this.cache.transactions[cacheKey];
      const today = new Date().toISOString().split('T')[0];
      
      if (cachedData && cachedData.timestamp.toISOString().split('T')[0] === today) {
        return cachedData.data;
      }
      
      // Obtener transacciones usando la API específica del banco
      const result = await this.supportedBanks[bankName].getTransactions(
        this.authTokens[bankName],
        accountInfo,
        dateRange
      );
      
      // Actualizar caché
      if (result.success) {
        this.cache.transactions[cacheKey] = {
          timestamp: new Date(),
          data: result
        };
      }
      
      return result;
    } catch (error) {
      logger.error(`Error al consultar transacciones en ${bankName}`, { error: error.message });
      
      throw new BankAPIError(
        `Error al consultar transacciones en ${bankName}: ${error.message}`,
        bankName,
        'TRANSACTIONS_ERROR',
        error
      );
    }
  }
  
  /**
   * Procesa un pago a través del banco seleccionado
   * @param {string} bankName - Nombre del banco
   * @param {Object} paymentData - Datos del pago a procesar
   * @returns {Promise<Object>} Resultado del procesamiento del pago
   */
  async processPayment(bankName, paymentData) {
    this._validateBank(bankName);
    
    // Verificar autenticación
    if (!await this.checkAuthentication(bankName)) {
      throw new BankAPIError(
        `No hay una sesión válida para ${bankName}`,
        bankName,
        'INVALID_SESSION'
      );
    }
    
    try {
      logger.info(`Procesando pago a través de ${bankName}`);
      
      // Validar datos del pago
      if (!paymentData.amount || paymentData.amount <= 0) {
        throw new BankAPIError(
          'El monto del pago debe ser mayor a cero',
          bankName,
          'INVALID_AMOUNT'
        );
      }
      
      // Procesar pago usando la API específica del banco
      const result = await this.supportedBanks[bankName].processPayment(
        this.authTokens[bankName],
        paymentData
      );
      
      if (result.success) {
        logger.info(`Pago procesado exitosamente en ${bankName} con ID: ${result.paymentId}`);
        this.emit('payment-processed', { bankName, paymentId: result.paymentId });
      } else {
        logger.error(`Fallo al procesar pago en ${bankName}: ${result.error}`);
      }
      
      return result;
    } catch (error) {
      logger.error(`Error al procesar pago en ${bankName}`, { error: error.message });
      
      throw new BankAPIError(
        `Error al procesar pago en ${bankName}: ${error.message}`,
        bankName,
        'PAYMENT_ERROR',
        error
      );
    }
  }
  
  /**
   * Verifica el estado de un pago previamente procesado
   * @param {string} bankName - Nombre del banco
   * @param {string} paymentId - ID del pago a verificar
   * @returns {Promise<Object>} Estado actual del pago
   */
  async checkPaymentStatus(bankName, paymentId) {
    this._validateBank(bankName);
    
    // Verificar autenticación
    if (!await this.checkAuthentication(bankName)) {
      throw new BankAPIError(
        `No hay una sesión válida para ${bankName}`,
        bankName,
        'INVALID_SESSION'
      );
    }
    
    try {
      logger.info(`Verificando estado del pago ${paymentId} en ${bankName}`);
      
      // Verificar estado usando la API específica del banco
      const result = await this.supportedBanks[bankName].checkPaymentStatus(
        this.authTokens[bankName],
        paymentId
      );
      
      if (result.success && result.status === 'completed') {
        this.emit('payment-completed', { bankName, paymentId, details: result });
      }
      
      return result;
    } catch (error) {
      logger.error(`Error al verificar estado del pago en ${bankName}`, { error: error.message });
      
      throw new BankAPIError(
        `Error al verificar estado del pago en ${bankName}: ${error.message}`,
        bankName,
        'PAYMENT_STATUS_ERROR',
        error
      );
    }
  }
  
  /**
   * Genera un link de pago para compartir con clientes
   * @param {string} bankName - Nombre del banco
   * @param {Object} paymentData - Datos del pago
   * @returns {Promise<Object>} Link de pago generado
   */
  async generatePaymentLink(bankName, paymentData) {
    this._validateBank(bankName);
    
    // Verificar si el banco soporta links de pago
    if (!this.supportedBanks[bankName].supportsPaymentLinks) {
      throw new BankAPIError(
        `El banco ${bankName} no soporta generación de links de pago`,
        bankName,
        'FEATURE_NOT_SUPPORTED'
      );
    }
    
    // Verificar autenticación
    if (!await this.checkAuthentication(bankName)) {
      throw new BankAPIError(
        `No hay una sesión válida para ${bankName}`,
        bankName,
        'INVALID_SESSION'
      );
    }
    
    try {
      logger.info(`Generando link de pago con ${bankName}`);
      
      // Validar datos del pago
      if (!paymentData.amount || paymentData.amount <= 0) {
        throw new BankAPIError(
          'El monto del pago debe ser mayor a cero',
          bankName,
          'INVALID_AMOUNT'
        );
      }
      
      if (!paymentData.description) {
        paymentData.description = `Pago FactuSystem - ${new Date().toISOString()}`;
      }
      
      // Generar link usando la API específica del banco
      const result = await this.supportedBanks[bankName].generatePaymentLink(
        this.authTokens[bankName],
        paymentData
      );
      
      if (result.success) {
        logger.info(`Link de pago generado exitosamente en ${bankName}: ${result.paymentUrl}`);
      } else {
        logger.error(`Fallo al generar link de pago en ${bankName}: ${result.error}`);
      }
      
      return result;
    } catch (error) {
      logger.error(`Error al generar link de pago en ${bankName}`, { error: error.message });
      
      throw new BankAPIError(
        `Error al generar link de pago en ${bankName}: ${error.message}`,
        bankName,
        'PAYMENT_LINK_ERROR',
        error
      );
    }
  }
  
  /**
   * Registra una transferencia bancaria recibida manualmente
   * @param {string} bankName - Nombre del banco
   * @param {Object} transferData - Datos de la transferencia
   * @returns {Promise<Object>} Resultado del registro
   */
  async registerTransfer(bankName, transferData) {
    this._validateBank(bankName);
    
    try {
      logger.info(`Registrando transferencia manual de ${bankName}`);
      
      // Validar datos de la transferencia
      if (!transferData.amount || transferData.amount <= 0) {
        throw new BankAPIError(
          'El monto de la transferencia debe ser mayor a cero',
          bankName,
          'INVALID_AMOUNT'
        );
      }
      
      if (!transferData.reference) {
        throw new BankAPIError(
          'Debe proporcionar una referencia para la transferencia',
          bankName,
          'MISSING_REFERENCE'
        );
      }
      
      // Guardar en base de datos local usando función específica del banco
      const result = await this.supportedBanks[bankName].registerTransfer(transferData);
      
      if (result.success) {
        logger.info(`Transferencia registrada exitosamente con ID: ${result.transferId}`);
        this.emit('transfer-registered', { bankName, transferId: result.transferId });
      } else {
        logger.error(`Fallo al registrar transferencia: ${result.error}`);
      }
      
      return result;
    } catch (error) {
      logger.error(`Error al registrar transferencia de ${bankName}`, { error: error.message });
      
      throw new BankAPIError(
        `Error al registrar transferencia de ${bankName}: ${error.message}`,
        bankName,
        'TRANSFER_REGISTER_ERROR',
        error
      );
    }
  }
  
  /**
   * Concilia transacciones automáticamente comparando registros del banco con registros locales
   * @param {string} bankName - Nombre del banco
   * @param {Object} dateRange - Rango de fechas para conciliar
   * @returns {Promise<Object>} Resultado de la conciliación
   */
  async reconcileTransactions(bankName, dateRange) {
    this._validateBank(bankName);
    
    // Verificar autenticación
    if (!await this.checkAuthentication(bankName)) {
      throw new BankAPIError(
        `No hay una sesión válida para ${bankName}`,
        bankName,
        'INVALID_SESSION'
      );
    }
    
    try {
      logger.info(`Iniciando conciliación de transacciones con ${bankName}`);
      
      // Obtener transacciones del banco
      const bankTransactions = await this.getTransactions(bankName, {}, dateRange);
      
      if (!bankTransactions.success) {
        throw new BankAPIError(
          `No se pudieron obtener las transacciones de ${bankName}`,
          bankName,
          'TRANSACTIONS_ERROR'
        );
      }
      
      // Realizar conciliación usando la API específica del banco
      const result = await this.supportedBanks[bankName].reconcileTransactions(
        this.authTokens[bankName],
        bankTransactions.transactions,
        dateRange
      );
      
      if (result.success) {
        logger.info(`Conciliación completada con ${bankName}: ${result.matched} coincidencias, ${result.unmatched} sin coincidencia`);
      } else {
        logger.error(`Fallo en conciliación con ${bankName}: ${result.error}`);
      }
      
      return result;
    } catch (error) {
      logger.error(`Error en conciliación con ${bankName}`, { error: error.message });
      
      throw new BankAPIError(
        `Error en conciliación con ${bankName}: ${error.message}`,
        bankName,
        'RECONCILIATION_ERROR',
        error
      );
    }
  }
  
  /**
   * Obtiene los reportes disponibles del banco
   * @param {string} bankName - Nombre del banco
   * @param {string} reportType - Tipo de reporte (opcional)
   * @param {Object} dateRange - Rango de fechas (opcional)
   * @returns {Promise<Object>} Reportes disponibles
   */
  async getReports(bankName, reportType = null, dateRange = null) {
    this._validateBank(bankName);
    
    // Verificar si el banco soporta reportes
    if (!this.supportedBanks[bankName].supportsReports) {
      throw new BankAPIError(
        `El banco ${bankName} no soporta la generación de reportes`,
        bankName,
        'FEATURE_NOT_SUPPORTED'
      );
    }
    
    // Verificar autenticación
    if (!await this.checkAuthentication(bankName)) {
      throw new BankAPIError(
        `No hay una sesión válida para ${bankName}`,
        bankName,
        'INVALID_SESSION'
      );
    }
    
    try {
      logger.info(`Obteniendo reportes de ${bankName}`);
      
      // Obtener reportes usando la API específica del banco
      const result = await this.supportedBanks[bankName].getReports(
        this.authTokens[bankName],
        reportType,
        dateRange
      );
      
      return result;
    } catch (error) {
      logger.error(`Error al obtener reportes de ${bankName}`, { error: error.message });
      
      throw new BankAPIError(
        `Error al obtener reportes de ${bankName}: ${error.message}`,
        bankName,
        'REPORTS_ERROR',
        error
      );
    }
  }
  
  /**
   * Cierra la sesión con un banco específico
   * @param {string} bankName - Nombre del banco
   * @returns {Promise<Object>} Resultado del cierre de sesión
   */
  async logout(bankName) {
    this._validateBank(bankName);
    
    if (!this.authTokens[bankName]) {
      return { success: true, message: 'No hay sesión activa' };
    }
    
    try {
      logger.info(`Cerrando sesión con ${bankName}`);
      
      // Cerrar sesión usando la API específica del banco
      const result = await this.supportedBanks[bankName].logout(this.authTokens[bankName]);
      
      // Limpiar datos de autenticación
      delete this.authTokens[bankName];
      this.connectionStatus[bankName] = false;
      
      // Limpiar caché relacionada con este banco
      Object.keys(this.cache.balances).forEach(key => {
        if (key.startsWith(bankName)) {
          delete this.cache.balances[key];
        }
      });
      
      Object.keys(this.cache.transactions).forEach(key => {
        if (key.startsWith(bankName)) {
          delete this.cache.transactions[key];
        }
      });
      
      this.emit('bank-disconnected', bankName);
      
      return result;
    } catch (error) {
      logger.error(`Error al cerrar sesión con ${bankName}`, { error: error.message });
      
      // Aún así, limpiamos los datos locales
      delete this.authTokens[bankName];
      this.connectionStatus[bankName] = false;
      
      throw new BankAPIError(
        `Error al cerrar sesión con ${bankName}: ${error.message}`,
        bankName,
        'LOGOUT_ERROR',
        error
      );
    }
  }
  
  /**
   * Retorna la lista de bancos soportados y su estado de conexión
   * @returns {Object} Lista de bancos y estado
   */
  getSupportedBanks() {
    const banks = {};
    
    Object.keys(this.supportedBanks).forEach(bankName => {
      banks[bankName] = {
        name: bankName,
        connected: this.connectionStatus[bankName],
        features: {
          paymentLinks: !!this.supportedBanks[bankName].supportsPaymentLinks,
          reports: !!this.supportedBanks[bankName].supportsReports,
          reconciliation: !!this.supportedBanks[bankName].supportsReconciliation
        }
      };
    });
    
    return banks;
  }
  
  /**
   * Verifica si un comprobante de pago es válido
   * @param {string} bankName - Nombre del banco
   * @param {Object} receiptData - Datos del comprobante
   * @returns {Promise<Object>} Resultado de la verificación
   */
  async validateReceipt(bankName, receiptData) {
    this._validateBank(bankName);
    
    // Verificar si el banco soporta validación de comprobantes
    if (!this.supportedBanks[bankName].supportsReceiptValidation) {
      throw new BankAPIError(
        `El banco ${bankName} no soporta validación de comprobantes`,
        bankName,
        'FEATURE_NOT_SUPPORTED'
      );
    }
    
    try {
      logger.info(`Validando comprobante de ${bankName}`);
      
      // Validar comprobante usando la API específica del banco
      const result = await this.supportedBanks[bankName].validateReceipt(receiptData);
      
      if (result.success) {
        logger.info(`Comprobante validado exitosamente: ${result.isValid ? 'Válido' : 'Inválido'}`);
      } else {
        logger.error(`Fallo al validar comprobante: ${result.error}`);
      }
      
      return result;
    } catch (error) {
      logger.error(`Error al validar comprobante de ${bankName}`, { error: error.message });
      
      throw new BankAPIError(
        `Error al validar comprobante de ${bankName}: ${error.message}`,
        bankName,
        'RECEIPT_VALIDATION_ERROR',
        error
      );
    }
  }
  
  /**
   * Procesa pagos con tarjeta de crédito o débito
   * @param {string} bankName - Nombre del banco
   * @param {Object} cardData - Datos de la tarjeta y transacción
   * @returns {Promise<Object>} Resultado del procesamiento
   */
  async processCardPayment(bankName, cardData) {
    this._validateBank(bankName);
    
    // Verificar si el banco soporta pagos con tarjeta
    if (!this.supportedBanks[bankName].supportsCardPayments) {
      throw new BankAPIError(
        `El banco ${bankName} no soporta procesamiento de pagos con tarjeta`,
        bankName,
        'FEATURE_NOT_SUPPORTED'
      );
    }
    
    // Verificar autenticación
    if (!await this.checkAuthentication(bankName)) {
      throw new BankAPIError(
        `No hay una sesión válida para ${bankName}`,
        bankName,
        'INVALID_SESSION'
      );
    }
    
    try {
      logger.info(`Procesando pago con tarjeta a través de ${bankName}`);
      
      // Validar datos de la tarjeta (sin guardar información sensible en logs)
      if (!cardData.amount || cardData.amount <= 0) {
        throw new BankAPIError(
          'El monto del pago debe ser mayor a cero',
          bankName,
          'INVALID_AMOUNT'
        );
      }
      
      if (!cardData.cardNumber || !cardData.cardholderName || !cardData.expiryDate || !cardData.cvv) {
        throw new BankAPIError(
          'Datos de tarjeta incompletos',
          bankName,
          'INCOMPLETE_CARD_DATA'
        );
      }
      
      // Procesar pago usando la API específica del banco
      const result = await this.supportedBanks[bankName].processCardPayment(
        this.authTokens[bankName],
        cardData
      );
      
      if (result.success) {
        logger.info(`Pago con tarjeta procesado exitosamente en ${bankName} con ID: ${result.paymentId}`);
        this.emit('card-payment-processed', { bankName, paymentId: result.paymentId });
      } else {
        logger.error(`Fallo al procesar pago con tarjeta en ${bankName}: ${result.error}`);
      }
      
      return result;
    } catch (error) {
      logger.error(`Error al procesar pago con tarjeta en ${bankName}`, { error: error.message });
      
      throw new BankAPIError(
        `Error al procesar pago con tarjeta en ${bankName}: ${error.message}`,
        bankName,
        'CARD_PAYMENT_ERROR',
        error
      );
    }
  }
  
  /**
   * Calcula intereses para pagos en cuotas con tarjeta según el banco, tarjeta y cantidad de cuotas
   * @param {string} bankName - Nombre del banco
   * @param {Object} installmentData - Datos para cálculo de cuotas
   * @returns {Promise<Object>} Detalle de cuotas e intereses
   */
  async calculateInstallments(bankName, installmentData) {
    this._validateBank(bankName);
    
    try {
      logger.info(`Calculando cuotas para ${bankName}`);
      
      // Validar datos para cálculo
      if (!installmentData.amount || installmentData.amount <= 0) {
        throw new BankAPIError(
          'El monto debe ser mayor a cero',
          bankName,
          'INVALID_AMOUNT'
        );
      }
      
      if (!installmentData.installments || installmentData.installments < 1) {
        throw new BankAPIError(
          'La cantidad de cuotas debe ser al menos 1',
          bankName,
          'INVALID_INSTALLMENTS'
        );
      }
      
      if (!installmentData.cardType) {
        throw new BankAPIError(
          'Debe especificar el tipo de tarjeta',
          bankName,
          'MISSING_CARD_TYPE'
        );
      }
      
      // Calcular cuotas usando la API específica del banco
      const result = await this.supportedBanks[bankName].calculateInstallments(installmentData);
      
      return result;
    } catch (error) {
      logger.error(`Error al calcular cuotas con ${bankName}`, { error: error.message });
      
      throw new BankAPIError(
        `Error al calcular cuotas con ${bankName}: ${error.message}`,
        bankName,
        'INSTALLMENT_CALCULATION_ERROR',
        error
      );
    }
  }
  
  /**
   * Obtiene las tasas de interés actuales para diferentes tarjetas y cantidades de cuotas
   * @param {string} bankName - Nombre del banco
   * @returns {Promise<Object>} Tasas de interés por tarjeta y cuotas
   */
  async getInterestRates(bankName) {
    this._validateBank(bankName);
    
    // Verificar autenticación si es necesaria
    const needsAuth = this.supportedBanks[bankName].needsAuthForRates;
    if (needsAuth && !await this.checkAuthentication(bankName)) {
      throw new BankAPIError(
        `No hay una sesión válida para ${bankName}`,
        bankName,
        'INVALID_SESSION'
      );
    }
    
    try {
      logger.info(`Obteniendo tasas de interés de ${bankName}`);
      
      // Obtener tasas usando la API específica del banco
      const result = needsAuth 
        ? await this.supportedBanks[bankName].getInterestRates(this.authTokens[bankName])
        : await this.supportedBanks[bankName].getInterestRates();
      
      return result;
    } catch (error) {
      logger.error(`Error al obtener tasas de interés de ${bankName}`, { error: error.message });
      
      throw new BankAPIError(
        `Error al obtener tasas de interés de ${bankName}: ${error.message}`,
        bankName,
        'INTEREST_RATES_ERROR',
        error
      );
    }
  }
  
  /**
   * Actualiza la configuración de integración con un banco
   * @param {string} bankName - Nombre del banco
   * @param {Object} config - Nueva configuración
   * @returns {Promise<Object>} Resultado de la actualización
   */
  async updateConfiguration(bankName, config) {
    this._validateBank(bankName);
    
    try {
      logger.info(`Actualizando configuración de ${bankName}`);
      
      // Validar configuración básica
      if (!config.merchantId) {
        throw new BankAPIError(
          'Falta el ID de comercio en la configuración',
          bankName,
          'MISSING_MERCHANT_ID'
        );
      }
      
      // Cargar configuración actual y combinarla con la nueva
      const currentConfig = this._loadBankConfig(bankName) || {};
      const updatedConfig = { ...currentConfig, ...config };
      
      // Actualizar configuración en la API específica del banco
      const result = await this.supportedBanks[bankName].updateConfiguration(updatedConfig);
      
      if (result.success) {
        // Guardar configuración actualizada
        this._saveBankConfig(bankName, updatedConfig);
        logger.info(`Configuración de ${bankName} actualizada exitosamente`);
      } else {
        logger.error(`Fallo al actualizar configuración de ${bankName}: ${result.error}`);
      }
      
      return result;
    } catch (error) {
      logger.error(`Error al actualizar configuración de ${bankName}`, { error: error.message });
      
      throw new BankAPIError(
        `Error al actualizar configuración de ${bankName}: ${error.message}`,
        bankName,
        'CONFIG_UPDATE_ERROR',
        error
      );
    }
  }
  
  /**
   * Obtiene los detalles de la configuración actual para un banco
   * @param {string} bankName - Nombre del banco
   * @returns {Object} Configuración actual
   */
  getConfiguration(bankName) {
    this._validateBank(bankName);
    
    const config = this._loadBankConfig(bankName) || {};
    
    // Eliminar información sensible
    const safeConfig = { ...config };
    delete safeConfig.apiKey;
    delete safeConfig.apiSecret;
    delete safeConfig.privateKey;
    delete safeConfig.password;
    
    return {
      success: true,
      config: safeConfig,
      connectionStatus: this.connectionStatus[bankName]
    };
  }
  
  /**
   * Verifica si los servicios del banco están operativos
   * @param {string} bankName - Nombre del banco
   * @returns {Promise<Object>} Estado de los servicios
   */
  async checkServiceStatus(bankName) {
    this._validateBank(bankName);
    
    try {
      logger.info(`Verificando estado de servicios de ${bankName}`);
      
      // Verificar estado usando la API específica del banco
      const result = await this.supportedBanks[bankName].checkServiceStatus();
      
      return result;
    } catch (error) {
      logger.error(`Error al verificar estado de servicios de ${bankName}`, { error: error.message });
      
      return {
        success: false,
        online: false,
        error: error.message
      };
    }
  }
  
  /**
   * Obtiene las operaciones y capacidades disponibles para el comercio autenticado
   * @param {string} bankName - Nombre del banco
   * @returns {Promise<Object>} Capacidades disponibles
   */
  async getCapabilities(bankName) {
    this._validateBank(bankName);
    
    // Verificar autenticación
    if (!await this.checkAuthentication(bankName)) {
      throw new BankAPIError(
        `No hay una sesión válida para ${bankName}`,
        bankName,
        'INVALID_SESSION'
      );
    }
    
    try {
      logger.info(`Obteniendo capacidades para ${bankName}`);
      
      // Obtener capacidades usando la API específica del banco
      const result = await this.supportedBanks[bankName].getCapabilities(this.authTokens[bankName]);
      
      return result;
    } catch (error) {
      logger.error(`Error al obtener capacidades de ${bankName}`, { error: error.message });
      
      throw new BankAPIError(
        `Error al obtener capacidades de ${bankName}: ${error.message}`,
        bankName,
        'CAPABILITIES_ERROR',
        error
      );
    }
  }
  
  /**
   * Maneja webhooks o notificaciones entrantes desde el banco
   * @param {string} bankName - Nombre del banco
   * @param {Object} notification - Datos de la notificación
   * @returns {Promise<Object>} Resultado del procesamiento
   */
  async handleNotification(bankName, notification) {
    this._validateBank(bankName);
    
    try {
      logger.info(`Procesando notificación de ${bankName}`);
      
      // Procesar notificación usando la API específica del banco
      const result = await this.supportedBanks[bankName].handleNotification(notification);
      
      if (result.success) {
        // Emitir evento según el tipo de notificación
        if (result.notificationType === 'payment') {
          this.emit('payment-notification', { bankName, paymentId: result.paymentId, status: result.status });
        } else if (result.notificationType === 'refund') {
          this.emit('refund-notification', { bankName, refundId: result.refundId, status: result.status });
        } else {
          this.emit('bank-notification', { bankName, type: result.notificationType, data: result });
        }
        
        logger.info(`Notificación de ${bankName} procesada exitosamente: ${result.notificationType}`);
      } else {
        logger.error(`Fallo al procesar notificación de ${bankName}: ${result.error}`);
      }
      
      return result;
    } catch (error) {
      logger.error(`Error al procesar notificación de ${bankName}`, { error: error.message });
      
      throw new BankAPIError(
        `Error al procesar notificación de ${bankName}: ${error.message}`,
        bankName,
        'NOTIFICATION_ERROR',
        error
      );
    }
  }
  
  /**
   * Procesa una devolución o reembolso
   * @param {string} bankName - Nombre del banco
   * @param {Object} refundData - Datos del reembolso
   * @returns {Promise<Object>} Resultado del procesamiento
   */
  async processRefund(bankName, refundData) {
    this._validateBank(bankName);
    
    // Verificar autenticación
    if (!await this.checkAuthentication(bankName)) {
      throw new BankAPIError(
        `No hay una sesión válida para ${bankName}`,
        bankName,
        'INVALID_SESSION'
      );
    }
    
    try {
      logger.info(`Procesando reembolso en ${bankName}`);
      
      // Validar datos del reembolso
      if (!refundData.paymentId) {
        throw new BankAPIError(
          'Debe proporcionar el ID del pago original',
          bankName,
          'MISSING_PAYMENT_ID'
        );
      }
      
      if (!refundData.amount || refundData.amount <= 0) {
        throw new BankAPIError(
          'El monto del reembolso debe ser mayor a cero',
          bankName,
          'INVALID_AMOUNT'
        );
      }
      
      // Procesar reembolso usando la API específica del banco
      const result = await this.supportedBanks[bankName].processRefund(
        this.authTokens[bankName],
        refundData
      );
      
      if (result.success) {
        logger.info(`Reembolso procesado exitosamente en ${bankName} con ID: ${result.refundId}`);
        this.emit('refund-processed', { bankName, refundId: result.refundId, paymentId: refundData.paymentId });
      } else {
        logger.error(`Fallo al procesar reembolso en ${bankName}: ${result.error}`);
      }
      
      return result;
    } catch (error) {
      logger.error(`Error al procesar reembolso en ${bankName}`, { error: error.message });
      
      throw new BankAPIError(
        `Error al procesar reembolso en ${bankName}: ${error.message}`,
        bankName,
        'REFUND_ERROR',
        error
      );
    }
  }
}

// Exportamos una instancia única de la API bancaria
const bankAPI = new BankAPI();
module.exports = bankAPI;