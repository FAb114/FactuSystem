/**
 * @file integrations/mercadoPago/qr.js
 * @description Gestión de QR estático de Mercado Pago para FactuSystem
 * Permite generar, actualizar y verificar pagos mediante QR estático de Mercado Pago
 */

const { ipcMain } = require('electron');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const logger = require('../../services/audit/logger.js');
const database = require('../../app/assets/js/utils/database.js');
const qrcode = require('qrcode');
const EventEmitter = require('events');

// Emisor de eventos para notificar pagos recibidos
const paymentEvents = new EventEmitter();

class MercadoPagoQR {
  constructor() {
    this.accessToken = null;
    this.posId = null;
    this.userId = null;
    this.storeId = null;
    this.externalStoreId = null;
    this.qrBase64 = null;
    this.qrImagePath = null;
    this.checkInterval = 10000; // 10 segundos por defecto
    this.checkIntervalId = null;
    this.initialized = false;
    this.pendingPayments = new Map(); // Para llevar registro de pagos esperados
    
    // Inicializar los listeners de IPC
    this._initIpcListeners();
  }

  /**
   * Inicializa los listeners para comunicación con el renderer process
   * @private
   */
  _initIpcListeners() {
    // Configuración del QR
    ipcMain.handle('mp-qr:init', async (event, config) => {
      return await this.initialize(config);
    });

    // Generar un nuevo QR estático
    ipcMain.handle('mp-qr:generate', async (event, amount, description, externalReference) => {
      return await this.generateQR(amount, description, externalReference);
    });

    // Verificar si un pago fue recibido
    ipcMain.handle('mp-qr:check-payment', async (event, externalReference) => {
      return await this.checkPayment(externalReference);
    });

    // Actualizar configuración
    ipcMain.handle('mp-qr:update-config', async (event, config) => {
      return await this.updateConfig(config);
    });

    // Obtener la imagen del QR actual
    ipcMain.handle('mp-qr:get-image', (event) => {
      return this.getQRImage();
    });

    // Configurar el intervalo de verificación automática
    ipcMain.handle('mp-qr:set-check-interval', (event, interval) => {
      return this.setCheckInterval(interval);
    });

    // Iniciar verificación automática
    ipcMain.handle('mp-qr:start-auto-check', (event) => {
      return this.startAutoCheck();
    });

    // Detener verificación automática
    ipcMain.handle('mp-qr:stop-auto-check', (event) => {
      return this.stopAutoCheck();
    });
  }

  /**
   * Inicializa la configuración de Mercado Pago QR
   * @param {Object} config - Configuración de Mercado Pago
   * @returns {Object} Estado de la inicialización
   */
  async initialize(config) {
    try {
      this.accessToken = config.accessToken;
      this.userId = config.userId;
      this.posId = config.posId || `POS_${uuidv4().substring(0, 8)}`;
      this.storeId = config.storeId;
      this.externalStoreId = config.externalStoreId || `STORE_${uuidv4().substring(0, 8)}`;
      this.qrImagePath = config.qrImagePath || path.join(process.cwd(), 'data', 'qr', 'mp_qr.png');
      this.checkInterval = config.checkInterval || 10000;
      
      // Crear directorio para QR si no existe
      const qrDir = path.dirname(this.qrImagePath);
      if (!fs.existsSync(qrDir)) {
        fs.mkdirSync(qrDir, { recursive: true });
      }

      // Verificar credenciales
      const isValid = await this.verifyCredentials();
      if (!isValid) {
        logger.error('MP QR: Credenciales inválidas');
        return { success: false, error: 'Credenciales inválidas' };
      }

      // Si es la primera inicialización, crear QR base
      if (!this.initialized) {
        await this.createBaseQR();
      }

      this.initialized = true;
      logger.info('MP QR: Inicializado correctamente');
      
      // Guardar configuración en la base de datos
      await this._saveConfigToDb(config);
      
      return { success: true };
    } catch (error) {
      logger.error(`MP QR: Error en inicialización: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Guarda la configuración en la base de datos
   * @param {Object} config - Configuración a guardar
   * @private
   */
  async _saveConfigToDb(config) {
    try {
      // Eliminar datos sensibles antes de guardar
      const safeConfig = { ...config };
      // Ocultar parte del token para seguridad
      if (safeConfig.accessToken) {
        safeConfig.accessToken = `${safeConfig.accessToken.substring(0, 8)}...${safeConfig.accessToken.substring(safeConfig.accessToken.length - 4)}`;
      }
      
      await database.run(`
        INSERT OR REPLACE INTO configuraciones (clave, valor, sucursal_id, actualizado_por, fecha_actualizacion)
        VALUES ('mercadopago_qr', ?, ?, ?, datetime('now'))
      `, [JSON.stringify(safeConfig), config.sucursalId || 1, config.usuarioId || 1]);
      
      logger.info('MP QR: Configuración guardada en base de datos');
    } catch (error) {
      logger.error(`MP QR: Error al guardar configuración: ${error.message}`);
    }
  }

  /**
   * Verifica si las credenciales de Mercado Pago son válidas
   * @returns {Boolean} True si las credenciales son válidas
   */
  async verifyCredentials() {
    try {
      if (!this.accessToken) return false;

      const response = await axios.get('https://api.mercadopago.com/v1/users/me', {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`
        }
      });

      // Actualizar userId si no estaba configurado
      if (response.data && response.data.id && !this.userId) {
        this.userId = response.data.id.toString();
      }

      return response.status === 200;
    } catch (error) {
      logger.error(`MP QR: Error al verificar credenciales: ${error.message}`);
      return false;
    }
  }

  /**
   * Crea un QR base (sin monto) que luego puede ser actualizado
   * @returns {Object} Resultado de la creación del QR
   */
  async createBaseQR() {
    try {
      if (!this.accessToken || !this.userId) {
        throw new Error('Configuración incompleta');
      }

      // 1. Crear o verificar store si no existe
      let storeResponse;
      if (!this.storeId) {
        // Crear tienda si no existe
        storeResponse = await axios.post('https://api.mercadopago.com/users/me/stores', {
          name: 'FactuSystem Store',
          external_id: this.externalStoreId
        }, {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          }
        });
        
        this.storeId = storeResponse.data.id.toString();
        logger.info(`MP QR: Tienda creada con ID: ${this.storeId}`);
      }

      // 2. Crear o verificar POS si no existe
      let posResponse;
      if (!this.posId) {
        // Crear POS si no existe
        posResponse = await axios.post(`https://api.mercadopago.com/pos`, {
          name: 'FactuSystem POS',
          external_store_id: this.externalStoreId,
          store_id: this.storeId,
          external_id: this.posId,
          fixed_amount: false
        }, {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          }
        });
        
        this.posId = posResponse.data.id.toString();
        logger.info(`MP QR: POS creado con ID: ${this.posId}`);
      }

      // 3. Obtener código QR
      const qrResponse = await axios.get(`https://api.mercadopago.com/pos/${this.posId}/qrs`, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`
        }
      });

      if (qrResponse.data && qrResponse.data.qr_data) {
        // Guardar el QR en base64
        this.qrBase64 = await qrcode.toDataURL(qrResponse.data.qr_data);
        // Y también como archivo
        await qrcode.toFile(this.qrImagePath, qrResponse.data.qr_data);
        
        logger.info('MP QR: QR base generado correctamente');
        return { success: true, qrBase64: this.qrBase64 };
      } else {
        throw new Error('No se pudo obtener datos del QR');
      }
    } catch (error) {
      logger.error(`MP QR: Error al crear QR base: ${error.message}`);
      if (error.response) {
        logger.error(`MP QR: Respuesta de API: ${JSON.stringify(error.response.data)}`);
      }
      return { success: false, error: error.message };
    }
  }

  /**
   * Genera un QR para un monto específico
   * @param {Number} amount - Monto a cobrar
   * @param {String} description - Descripción del pago
   * @param {String} externalReference - Referencia externa (ej: ID de factura)
   * @returns {Object} Información del QR generado
   */
  async generateQR(amount, description, externalReference) {
    try {
      if (!this.initialized) {
        throw new Error('El sistema QR no está inicializado');
      }

      if (!amount || amount <= 0) {
        throw new Error('El monto debe ser mayor a cero');
      }

      // Crear orden de pago
      const orderResponse = await axios.post(`https://api.mercadopago.com/instore/orders/qr/seller/collectors/${this.userId}/pos/${this.posId}/qrs`, {
        external_reference: externalReference,
        title: description || 'Pago FactuSystem',
        description: description || 'Pago de productos/servicios',
        notification_url: `https://webhook.site/mp-notif-${uuidv4().substring(0, 8)}`, // Ejemplo - reemplazar con webhook real
        total_amount: amount,
        items: [
          {
            sku_number: "sku-fs-" + uuidv4().substring(0, 8),
            category: "factusystem",
            title: description || 'Pago FactuSystem',
            description: description || 'Pago de productos/servicios',
            unit_price: amount,
            quantity: 1,
            unit_measure: "unit",
            total_amount: amount
          }
        ]
      }, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      // Registrar que esperamos un pago para esta referencia
      this.pendingPayments.set(externalReference, {
        amount,
        timestamp: Date.now(),
        description,
        status: 'pending'
      });

      logger.info(`MP QR: Orden generada para ${amount} - Ref: ${externalReference}`);
      
      // Guardar registro de la solicitud en la base de datos
      await this._saveQRRequestToDb(amount, description, externalReference);

      return {
        success: true,
        qrBase64: this.qrBase64,
        externalReference,
        amount
      };
    } catch (error) {
      logger.error(`MP QR: Error al generar QR para pago: ${error.message}`);
      if (error.response) {
        logger.error(`MP QR: Respuesta de API: ${JSON.stringify(error.response.data)}`);
      }
      return { success: false, error: error.message };
    }
  }

  /**
   * Guarda el registro de la solicitud de pago en la base de datos
   * @param {Number} amount - Monto solicitado
   * @param {String} description - Descripción
   * @param {String} externalReference - Referencia externa
   * @private
   */
  async _saveQRRequestToDb(amount, description, externalReference) {
    try {
      await database.run(`
        INSERT INTO mp_pagos_qr (
          referencia_externa, 
          monto, 
          descripcion, 
          fecha_creacion, 
          estado
        ) VALUES (?, ?, ?, datetime('now'), 'pendiente')
      `, [externalReference, amount, description]);
    } catch (error) {
      logger.error(`MP QR: Error al guardar solicitud en DB: ${error.message}`);
    }
  }

  /**
   * Verifica si un pago específico fue recibido
   * @param {String} externalReference - Referencia externa del pago a verificar
   * @returns {Object} Estado del pago
   */
  async checkPayment(externalReference) {
    try {
      if (!this.initialized) {
        throw new Error('El sistema QR no está inicializado');
      }

      if (!externalReference) {
        throw new Error('Referencia externa no proporcionada');
      }

      // Buscar pagos para esa referencia
      const response = await axios.get(`https://api.mercadopago.com/v1/payments/search`, {
        params: {
          external_reference: externalReference,
          sort: 'date_created',
          criteria: 'desc'
        },
        headers: {
          'Authorization': `Bearer ${this.accessToken}`
        }
      });

      // Procesar resultados
      if (response.data && response.data.results && response.data.results.length > 0) {
        const payment = response.data.results[0]; // El más reciente
        
        // Verificar el estado del pago
        let status = 'pending';
        let approved = false;
        
        if (payment.status === 'approved') {
          status = 'approved';
          approved = true;
          
          // Registrar el pago como completado
          if (this.pendingPayments.has(externalReference)) {
            this.pendingPayments.set(externalReference, {
              ...this.pendingPayments.get(externalReference),
              status: 'approved',
              paymentId: payment.id
            });
          }
          
          // Actualizar en la base de datos
          await this._updatePaymentStatusInDb(externalReference, 'aprobado', payment.id);
          
          // Emitir evento de pago recibido
          paymentEvents.emit('payment_received', {
            externalReference,
            paymentId: payment.id,
            amount: payment.transaction_amount,
            paymentMethod: payment.payment_method_id,
            paymentTypeId: payment.payment_type_id,
            status: payment.status,
            statusDetail: payment.status_detail,
            date: payment.date_approved || payment.date_created
          });
          
          logger.info(`MP QR: Pago aprobado para referencia ${externalReference}`);
        } else if (payment.status === 'rejected') {
          status = 'rejected';
          await this._updatePaymentStatusInDb(externalReference, 'rechazado', payment.id);
          logger.warn(`MP QR: Pago rechazado para referencia ${externalReference}`);
        } else if (payment.status === 'in_process') {
          status = 'in_process';
          await this._updatePaymentStatusInDb(externalReference, 'en_proceso', payment.id);
          logger.info(`MP QR: Pago en proceso para referencia ${externalReference}`);
        }
        
        return {
          success: true,
          exists: true,
          approved,
          status,
          paymentDetails: {
            id: payment.id,
            status: payment.status,
            status_detail: payment.status_detail,
            date_created: payment.date_created,
            date_approved: payment.date_approved,
            payment_method_id: payment.payment_method_id,
            amount: payment.transaction_amount
          }
        };
      } else {
        // No se encontró ningún pago
        return {
          success: true,
          exists: false,
          approved: false,
          status: 'not_found'
        };
      }
    } catch (error) {
      logger.error(`MP QR: Error al verificar pago: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Actualiza el estado del pago en la base de datos
   * @param {String} externalReference - Referencia externa
   * @param {String} status - Estado del pago
   * @param {String} paymentId - ID del pago en Mercado Pago
   * @private
   */
  async _updatePaymentStatusInDb(externalReference, status, paymentId) {
    try {
      await database.run(`
        UPDATE mp_pagos_qr 
        SET estado = ?, 
            id_pago = ?, 
            fecha_actualizacion = datetime('now') 
        WHERE referencia_externa = ?
      `, [status, paymentId, externalReference]);
    } catch (error) {
      logger.error(`MP QR: Error al actualizar estado en DB: ${error.message}`);
    }
  }

  /**
   * Actualiza la configuración del QR
   * @param {Object} config - Nueva configuración
   * @returns {Object} Estado de la actualización
   */
  async updateConfig(config) {
    try {
      // Detener cualquier verificación automática en curso
      this.stopAutoCheck();
      
      const currentConfig = {
        accessToken: this.accessToken,
        userId: this.userId,
        posId: this.posId,
        storeId: this.storeId,
        externalStoreId: this.externalStoreId,
        qrImagePath: this.qrImagePath,
        checkInterval: this.checkInterval
      };
      
      // Actualizar solo los campos proporcionados
      const newConfig = { ...currentConfig, ...config };
      
      // Si el token cambió, necesitamos reinicializar
      const tokenChanged = newConfig.accessToken !== currentConfig.accessToken;
      
      // Inicializar con la nueva configuración
      const result = await this.initialize(newConfig);
      
      // Si el token cambió y la inicialización fue exitosa, regenerar el QR base
      if (tokenChanged && result.success) {
        await this.createBaseQR();
      }
      
      return result;
    } catch (error) {
      logger.error(`MP QR: Error al actualizar configuración: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Obtiene la imagen actual del QR
   * @returns {Object} Base64 de la imagen del QR
   */
  getQRImage() {
    if (!this.qrBase64) {
      return { success: false, error: 'QR no generado' };
    }
    return { success: true, qrBase64: this.qrBase64 };
  }

  /**
   * Configura el intervalo de tiempo para la verificación automática
   * @param {Number} interval - Intervalo en milisegundos
   * @returns {Object} Estado de la configuración
   */
  setCheckInterval(interval) {
    try {
      if (!interval || interval < 5000) {
        throw new Error('El intervalo mínimo es de 5000ms (5 segundos)');
      }
      
      this.checkInterval = interval;
      
      // Si hay una verificación automática en curso, reiniciarla con el nuevo intervalo
      if (this.checkIntervalId) {
        this.stopAutoCheck();
        this.startAutoCheck();
      }
      
      logger.info(`MP QR: Intervalo de verificación configurado a ${interval}ms`);
      return { success: true };
    } catch (error) {
      logger.error(`MP QR: Error al configurar intervalo: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Inicia la verificación automática de pagos pendientes
   * @returns {Object} Estado del inicio
   */
  startAutoCheck() {
    try {
      if (this.checkIntervalId) {
        clearInterval(this.checkIntervalId);
      }
      
      this.checkIntervalId = setInterval(async () => {
        await this._checkPendingPayments();
      }, this.checkInterval);
      
      logger.info(`MP QR: Verificación automática iniciada (intervalo: ${this.checkInterval}ms)`);
      return { success: true };
    } catch (error) {
      logger.error(`MP QR: Error al iniciar verificación automática: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Detiene la verificación automática de pagos
   * @returns {Object} Estado de la detención
   */
  stopAutoCheck() {
    try {
      if (this.checkIntervalId) {
        clearInterval(this.checkIntervalId);
        this.checkIntervalId = null;
        logger.info('MP QR: Verificación automática detenida');
      }
      return { success: true };
    } catch (error) {
      logger.error(`MP QR: Error al detener verificación automática: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Verifica todos los pagos pendientes registrados
   * @private
   */
  async _checkPendingPayments() {
    try {
      // Solo verificar pagos con estado pendiente y que no sean muy antiguos (máx 24 horas)
      const maxAge = 24 * 60 * 60 * 1000; // 24 horas en milisegundos
      const now = Date.now();
      
      for (const [externalReference, data] of this.pendingPayments.entries()) {
        // Saltar pagos ya aprobados o muy antiguos
        if (data.status !== 'pending' || (now - data.timestamp) > maxAge) {
          continue;
        }
        
        // Verificar el estado del pago
        const result = await this.checkPayment(externalReference);
        
        if (result.success && result.approved) {
          logger.info(`MP QR: Pago automático detectado para referencia ${externalReference}`);
          
          // El evento ya se emite dentro de checkPayment
        }
      }
    } catch (error) {
      logger.error(`MP QR: Error en verificación automática: ${error.message}`);
    }
  }

  /**
   * Registra un callback para eventos de pago
   * @param {Function} callback - Función a llamar cuando se recibe un pago
   * @returns {Function} Función para eliminar el listener
   */
  onPaymentReceived(callback) {
    if (typeof callback !== 'function') {
      throw new Error('El callback debe ser una función');
    }
    
    paymentEvents.on('payment_received', callback);
    
    // Devolver función para remover el listener
    return () => {
      paymentEvents.off('payment_received', callback);
    };
  }
}

// Instancia única para toda la aplicación
const mpQR = new MercadoPagoQR();

module.exports = mpQR;