/**
 * @file index.js
 * @description Módulo principal para la configuración de integraciones bancarias en FactuSystem
 * @module configuraciones/integraciones/bancos
 */

// Importamos las integraciones específicas de cada banco
const galiciaIntegration = require('./galicia.js');
const getnetIntegration = require('./getnet.js');
const bbvaIntegration = require('./bbva.js');
const paywayIntegration = require('./payway.js');
const { ipcRenderer } = require('electron');
const dbManager = require('../../../../utils/database.js');
const logger = require('../../../../utils/logger.js');
const notification = require('../../../../components/notifications.js');

// Mapa de integraciones disponibles
const bankIntegrations = {
  galicia: galiciaIntegration,
  getnet: getnetIntegration, 
  bbva: bbvaIntegration,
  payway: paywayIntegration
};

/**
 * Clase que gestiona la configuración de todas las integraciones bancarias
 */
class BankIntegrationsManager {
  constructor() {
    this.db = null;
    this.currentBranchId = null;
    this.activeIntegrations = {};
    this.bankConfigs = {};
  }

  /**
   * Inicializa el gestor de integraciones bancarias
   * @param {number} branchId - ID de la sucursal actual
   * @returns {Promise<void>}
   */
  async initialize(branchId) {
    try {
      this.db = await dbManager.getConnection();
      this.currentBranchId = branchId;
      await this.loadBankConfigurations();
      logger.info('BankIntegrationsManager inicializado correctamente', { branchId });
    } catch (error) {
      logger.error('Error al inicializar BankIntegrationsManager', { error: error.message });
      notification.show('error', 'Error al cargar configuraciones bancarias', error.message);
    }
  }

  /**
   * Carga las configuraciones de los bancos desde la base de datos
   * @returns {Promise<void>}
   */
  async loadBankConfigurations() {
    try {
      const query = `
        SELECT bank_name, config, is_active 
        FROM bank_integrations 
        WHERE branch_id = ?
      `;
      
      const results = await this.db.all(query, [this.currentBranchId]);
      
      // Reiniciamos las configuraciones
      this.activeIntegrations = {};
      this.bankConfigs = {};
      
      // Procesamos los resultados
      for (const row of results) {
        const bankName = row.bank_name;
        const config = JSON.parse(row.config);
        const isActive = row.is_active === 1;
        
        this.bankConfigs[bankName] = config;
        
        if (isActive && bankIntegrations[bankName]) {
          // Inicializamos la integración si está activa
          this.activeIntegrations[bankName] = bankIntegrations[bankName];
          await this.activeIntegrations[bankName].initialize(config);
        }
      }
      
      logger.info('Configuraciones bancarias cargadas correctamente', { 
        count: results.length,
        active: Object.keys(this.activeIntegrations).length 
      });
    } catch (error) {
      logger.error('Error al cargar configuraciones bancarias', { error: error.message });
      throw new Error(`Error al cargar configuraciones bancarias: ${error.message}`);
    }
  }

  /**
   * Obtiene la configuración de un banco específico
   * @param {string} bankName - Nombre del banco
   * @returns {Object|null} - Configuración del banco o null si no existe
   */
  getBankConfig(bankName) {
    return this.bankConfigs[bankName] || null;
  }

  /**
   * Verifica si una integración bancaria está activa
   * @param {string} bankName - Nombre del banco
   * @returns {boolean} - true si está activa, false en caso contrario
   */
  isIntegrationActive(bankName) {
    return !!this.activeIntegrations[bankName];
  }

  /**
   * Actualiza la configuración de un banco
   * @param {string} bankName - Nombre del banco
   * @param {Object} config - Nueva configuración del banco
   * @param {boolean} isActive - Estado de activación
   * @returns {Promise<boolean>} - Resultado de la operación
   */
  async updateBankConfig(bankName, config, isActive) {
    try {
      if (!bankIntegrations[bankName]) {
        throw new Error(`La integración bancaria "${bankName}" no está disponible`);
      }

      // Validamos la configuración con el módulo específico del banco
      const validationResult = bankIntegrations[bankName].validateConfig(config);
      if (!validationResult.valid) {
        throw new Error(`Configuración inválida: ${validationResult.message}`);
      }

      // Convertimos la configuración a JSON para almacenarla
      const configJson = JSON.stringify(config);
      
      // Verificamos si ya existe la configuración para actualizarla o crearla
      const checkQuery = `
        SELECT id FROM bank_integrations 
        WHERE branch_id = ? AND bank_name = ?
      `;
      
      const existingConfig = await this.db.get(checkQuery, [this.currentBranchId, bankName]);
      
      if (existingConfig) {
        // Actualizamos la configuración existente
        const updateQuery = `
          UPDATE bank_integrations 
          SET config = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP 
          WHERE branch_id = ? AND bank_name = ?
        `;
        
        await this.db.run(updateQuery, [configJson, isActive ? 1 : 0, this.currentBranchId, bankName]);
      } else {
        // Creamos una nueva configuración
        const insertQuery = `
          INSERT INTO bank_integrations 
          (branch_id, bank_name, config, is_active, created_at, updated_at) 
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `;
        
        await this.db.run(insertQuery, [this.currentBranchId, bankName, configJson, isActive ? 1 : 0]);
      }
      
      // Actualizamos las configuraciones en memoria
      this.bankConfigs[bankName] = config;
      
      // Si está activa, inicializamos la integración
      if (isActive) {
        this.activeIntegrations[bankName] = bankIntegrations[bankName];
        await this.activeIntegrations[bankName].initialize(config);
      } else {
        // Si se desactiva, eliminamos la integración activa
        if (this.activeIntegrations[bankName]) {
          await this.activeIntegrations[bankName].shutdown();
          delete this.activeIntegrations[bankName];
        }
      }
      
      logger.info(`Configuración de ${bankName} actualizada correctamente`, { 
        isActive,
        branchId: this.currentBranchId 
      });
      
      notification.show('success', 'Configuración bancaria actualizada', 
        `La configuración de ${bankName} ha sido actualizada exitosamente`);
      
      // Notificamos al proceso principal que la configuración ha cambiado
      ipcRenderer.send('bank-config-updated', { bankName, isActive });
      
      return true;
    } catch (error) {
      logger.error(`Error al actualizar configuración de ${bankName}`, { 
        error: error.message,
        config 
      });
      
      notification.show('error', 'Error en configuración bancaria', 
        `No se pudo actualizar la configuración de ${bankName}: ${error.message}`);
      
      return false;
    }
  }

  /**
   * Elimina la configuración de un banco
   * @param {string} bankName - Nombre del banco
   * @returns {Promise<boolean>} - Resultado de la operación
   */
  async deleteBankConfig(bankName) {
    try {
      // Primero verificamos si la integración está activa para desactivarla
      if (this.activeIntegrations[bankName]) {
        await this.activeIntegrations[bankName].shutdown();
        delete this.activeIntegrations[bankName];
      }
      
      // Eliminamos la configuración de la base de datos
      const deleteQuery = `
        DELETE FROM bank_integrations 
        WHERE branch_id = ? AND bank_name = ?
      `;
      
      await this.db.run(deleteQuery, [this.currentBranchId, bankName]);
      
      // Eliminamos la configuración de la memoria
      delete this.bankConfigs[bankName];
      
      logger.info(`Configuración de ${bankName} eliminada correctamente`, { 
        branchId: this.currentBranchId 
      });
      
      notification.show('success', 'Configuración eliminada', 
        `La configuración de ${bankName} ha sido eliminada exitosamente`);
      
      // Notificamos al proceso principal que la configuración ha sido eliminada
      ipcRenderer.send('bank-config-deleted', { bankName });
      
      return true;
    } catch (error) {
      logger.error(`Error al eliminar configuración de ${bankName}`, { 
        error: error.message 
      });
      
      notification.show('error', 'Error al eliminar configuración', 
        `No se pudo eliminar la configuración de ${bankName}: ${error.message}`);
      
      return false;
    }
  }

  /**
   * Procesa un pago usando la integración bancaria especificada
   * @param {string} bankName - Nombre del banco
   * @param {Object} paymentData - Datos del pago
   * @returns {Promise<Object>} - Resultado del procesamiento del pago
   */
  async processPayment(bankName, paymentData) {
    try {
      if (!this.activeIntegrations[bankName]) {
        throw new Error(`La integración con ${bankName} no está activa o configurada`);
      }
      
      // Delegamos el procesamiento al módulo específico del banco
      const result = await this.activeIntegrations[bankName].processPayment(paymentData);
      
      logger.info(`Pago procesado correctamente con ${bankName}`, { 
        transactionId: result.transactionId,
        amount: paymentData.amount
      });
      
      return {
        success: true,
        transactionId: result.transactionId,
        details: result.details,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error(`Error al procesar pago con ${bankName}`, { 
        error: error.message,
        paymentData 
      });
      
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Verifica el estado de un pago previo
   * @param {string} bankName - Nombre del banco
   * @param {string} transactionId - ID de la transacción
   * @returns {Promise<Object>} - Estado actual del pago
   */
  async checkPaymentStatus(bankName, transactionId) {
    try {
      if (!this.activeIntegrations[bankName]) {
        throw new Error(`La integración con ${bankName} no está activa o configurada`);
      }
      
      // Delegamos la verificación al módulo específico del banco
      const status = await this.activeIntegrations[bankName].checkPaymentStatus(transactionId);
      
      logger.info(`Estado de pago verificado con ${bankName}`, { 
        transactionId,
        status: status.status
      });
      
      return {
        success: true,
        transactionId,
        status: status.status,
        details: status.details,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error(`Error al verificar estado de pago con ${bankName}`, { 
        error: error.message,
        transactionId 
      });
      
      return {
        success: false,
        transactionId,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Obtiene todos los bancos disponibles y su estado de configuración
   * @returns {Array<Object>} - Lista de bancos y su estado
   */
  getAllBanksStatus() {
    const banks = Object.keys(bankIntegrations);
    const result = banks.map(bankName => {
      const isConfigured = !!this.bankConfigs[bankName];
      const isActive = !!this.activeIntegrations[bankName];
      
      return {
        name: bankName,
        displayName: this.getBankDisplayName(bankName),
        isConfigured,
        isActive,
        // Solo incluimos información básica de la configuración (sin credenciales sensibles)
        configSummary: isConfigured ? this.getSafeConfigSummary(bankName) : null
      };
    });
    
    return result;
  }

  /**
   * Obtiene el nombre de visualización de un banco
   * @param {string} bankName - Identificador del banco
   * @returns {string} - Nombre de visualización
   */
  getBankDisplayName(bankName) {
    const displayNames = {
      galicia: 'Banco Galicia',
      getnet: 'GetNet',
      bbva: 'BBVA',
      payway: 'PayWay'
    };
    
    return displayNames[bankName] || bankName;
  }

  /**
   * Obtiene un resumen seguro de la configuración (sin datos sensibles)
   * @param {string} bankName - Nombre del banco
   * @returns {Object} - Resumen seguro de la configuración
   */
  getSafeConfigSummary(bankName) {
    const config = this.bankConfigs[bankName] || {};
    
    // Creamos un resumen seguro sin exponer credenciales
    const summary = {};
    
    // Procesamos según el tipo de banco
    switch (bankName) {
      case 'galicia':
        summary.merchantId = config.merchantId ? '****' + config.merchantId.slice(-4) : null;
        summary.terminalType = config.terminalType || null;
        summary.environment = config.environment || 'test';
        break;
      case 'getnet':
        summary.merchantId = config.merchantId ? '****' + config.merchantId.slice(-4) : null;
        summary.terminalId = config.terminalId ? '****' + config.terminalId.slice(-4) : null;
        summary.environment = config.environment || 'test';
        break;
      case 'bbva':
        summary.merchantCode = config.merchantCode ? '****' + config.merchantCode.slice(-4) : null;
        summary.environment = config.environment || 'test';
        break;
      case 'payway':
        summary.siteId = config.siteId ? '****' + config.siteId.slice(-4) : null;
        summary.environment = config.environment || 'test';
        break;
      default:
        // Para cualquier otro banco, solo mostramos si tiene credenciales configuradas
        summary.hasCredentials = !!(config.apiKey || config.clientId || config.merchantId);
        summary.environment = config.environment || 'test';
    }
    
    return summary;
  }

  /**
   * Obtiene el formulario de configuración para un banco específico
   * @param {string} bankName - Nombre del banco
   * @returns {Object|null} - Estructura del formulario de configuración
   */
  getBankConfigForm(bankName) {
    if (!bankIntegrations[bankName]) {
      return null;
    }
    
    // Delegamos al módulo específico del banco
    return bankIntegrations[bankName].getConfigForm();
  }

  /**
   * Prueba la conexión con un banco usando la configuración proporcionada
   * @param {string} bankName - Nombre del banco
   * @param {Object} testConfig - Configuración de prueba
   * @returns {Promise<Object>} - Resultado de la prueba
   */
  async testBankConnection(bankName, testConfig) {
    try {
      if (!bankIntegrations[bankName]) {
        throw new Error(`La integración bancaria "${bankName}" no está disponible`);
      }
      
      // Validamos primero la configuración
      const validationResult = bankIntegrations[bankName].validateConfig(testConfig);
      if (!validationResult.valid) {
        throw new Error(`Configuración inválida: ${validationResult.message}`);
      }
      
      // Realizamos la prueba de conexión
      const testResult = await bankIntegrations[bankName].testConnection(testConfig);
      
      logger.info(`Prueba de conexión con ${bankName} exitosa`, {
        testResult
      });
      
      return {
        success: true,
        message: `Conexión exitosa con ${this.getBankDisplayName(bankName)}`,
        details: testResult
      };
    } catch (error) {
      logger.error(`Error en prueba de conexión con ${bankName}`, { 
        error: error.message
      });
      
      return {
        success: false,
        message: `Error al conectar con ${this.getBankDisplayName(bankName)}: ${error.message}`,
        error: error.message
      };
    }
  }

  /**
   * Genera un reporte de actividad de las integraciones bancarias
   * @param {Object} options - Opciones para el reporte
   * @returns {Promise<Object>} - Datos del reporte
   */
  async generateActivityReport(options = {}) {
    try {
      const { startDate, endDate, bankName } = options;
      
      // Consulta base para obtener actividad de las transacciones
      let query = `
        SELECT 
          t.id, t.bank_name, t.transaction_id, t.amount, t.status,
          t.payment_method, t.created_at, t.updated_at
        FROM bank_transactions t
        WHERE t.branch_id = ?
      `;
      
      const queryParams = [this.currentBranchId];
      
      // Aplicamos filtros adicionales si se proporcionan
      if (startDate) {
        query += ' AND t.created_at >= ?';
        queryParams.push(startDate);
      }
      
      if (endDate) {
        query += ' AND t.created_at <= ?';
        queryParams.push(endDate);
      }
      
      if (bankName) {
        query += ' AND t.bank_name = ?';
        queryParams.push(bankName);
      }
      
      // Ordenamos por fecha más reciente primero
      query += ' ORDER BY t.created_at DESC';
      
      // Ejecutamos la consulta
      const transactions = await this.db.all(query, queryParams);
      
      // Calculamos estadísticas básicas
      const stats = {
        totalTransactions: transactions.length,
        totalAmount: transactions.reduce((sum, t) => sum + parseFloat(t.amount), 0),
        successfulTransactions: transactions.filter(t => t.status === 'success').length,
        failedTransactions: transactions.filter(t => t.status === 'failed').length,
        pendingTransactions: transactions.filter(t => t.status === 'pending').length,
        byBank: {}
      };
      
      // Agrupamos estadísticas por banco
      for (const t of transactions) {
        if (!stats.byBank[t.bank_name]) {
          stats.byBank[t.bank_name] = {
            count: 0,
            amount: 0,
            successful: 0,
            failed: 0,
            pending: 0
          };
        }
        
        stats.byBank[t.bank_name].count++;
        stats.byBank[t.bank_name].amount += parseFloat(t.amount);
        
        if (t.status === 'success') {
          stats.byBank[t.bank_name].successful++;
        } else if (t.status === 'failed') {
          stats.byBank[t.bank_name].failed++;
        } else if (t.status === 'pending') {
          stats.byBank[t.bank_name].pending++;
        }
      }
      
      return {
        transactions,
        stats,
        filters: {
          branchId: this.currentBranchId,
          startDate,
          endDate,
          bankName
        },
        generatedAt: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Error al generar reporte de actividad bancaria', { 
        error: error.message,
        options 
      });
      
      throw new Error(`Error al generar reporte: ${error.message}`);
    }
  }

  /**
   * Realiza un reembolso para una transacción específica
   * @param {string} bankName - Nombre del banco
   * @param {string} transactionId - ID de la transacción
   * @param {Object} refundData - Datos del reembolso
   * @returns {Promise<Object>} - Resultado del reembolso
   */
  async processRefund(bankName, transactionId, refundData) {
    try {
      if (!this.activeIntegrations[bankName]) {
        throw new Error(`La integración con ${bankName} no está activa o configurada`);
      }
      
      // Verificamos si la transacción existe y está en estado correcto
      const transactionQuery = `
        SELECT * FROM bank_transactions 
        WHERE transaction_id = ? AND bank_name = ? AND branch_id = ?
      `;
      
      const transaction = await this.db.get(transactionQuery, [
        transactionId, bankName, this.currentBranchId
      ]);
      
      if (!transaction) {
        throw new Error('Transacción no encontrada');
      }
      
      if (transaction.status !== 'success') {
        throw new Error(`La transacción no puede ser reembolsada (estado: ${transaction.status})`);
      }
      
      // Delegamos el reembolso al módulo específico del banco
      const refundResult = await this.activeIntegrations[bankName].processRefund(
        transactionId, refundData
      );
      
      // Registramos el reembolso en la base de datos
      const insertQuery = `
        INSERT INTO bank_refunds
        (branch_id, bank_name, transaction_id, refund_id, amount, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `;
      
      await this.db.run(insertQuery, [
        this.currentBranchId,
        bankName,
        transactionId,
        refundResult.refundId,
        refundData.amount || transaction.amount,
        refundResult.status || 'success'
      ]);
      
      // Actualizamos el estado de la transacción original si es un reembolso completo
      if (!refundData.amount || refundData.amount >= transaction.amount) {
        const updateQuery = `
          UPDATE bank_transactions
          SET status = 'refunded', updated_at = CURRENT_TIMESTAMP
          WHERE transaction_id = ? AND bank_name = ? AND branch_id = ?
        `;
        
        await this.db.run(updateQuery, [transactionId, bankName, this.currentBranchId]);
      }
      
      logger.info(`Reembolso procesado correctamente con ${bankName}`, { 
        transactionId,
        refundId: refundResult.refundId,
        amount: refundData.amount || transaction.amount
      });
      
      return {
        success: true,
        transactionId,
        refundId: refundResult.refundId,
        amount: refundData.amount || transaction.amount,
        status: refundResult.status || 'success',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error(`Error al procesar reembolso con ${bankName}`, { 
        error: error.message,
        transactionId,
        refundData 
      });
      
      return {
        success: false,
        transactionId,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

// Instancia única del gestor de integraciones bancarias
const bankIntegrationsManager = new BankIntegrationsManager();

// Exportación del módulo
module.exports = bankIntegrationsManager;