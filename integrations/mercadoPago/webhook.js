/**
 * webhook.js - Procesador de webhooks de Mercado Pago para FactuSystem
 * 
 * Este módulo gestiona la recepción y procesamiento de notificaciones desde Mercado Pago,
 * permitiendo actualizar automáticamente el estado de pagos en el sistema.
 */

const axios = require('axios');
const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const logger = require('../../services/audit/logger');
const database = require('../../app/assets/js/utils/database');
const notificaciones = require('../../app/assets/js/components/notifications');
const configHandler = require('../../app/assets/js/modules/configuraciones/integraciones/mercadoPago');

// Constantes para estados de pagos
const PAYMENT_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  AUTHORIZED: 'authorized',
  IN_PROCESS: 'in_process',
  IN_MEDIATION: 'in_mediation',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
  CHARGED_BACK: 'charged_back'
};

class MercadoPagoWebhook {
  constructor() {
    this.config = null;
    this.notificationQueue = [];
    this.processing = false;
    this.logFilePath = path.join(process.env.APPDATA || (process.platform === 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + '/.local/share'), 'FactuSystem', 'mp_webhook_logs.json');
    
    // Crear directorio de logs si no existe
    const logDir = path.dirname(this.logFilePath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    // Iniciar el procesamiento de webhooks cada 5 segundos
    this.webhookProcessor = setInterval(() => this.processQueue(), 5000);
    
    // Inicializar listeners de IPC
    this.setupIPCListeners();
  }

  /**
   * Inicializa los listeners de IPC para comunicación con el renderer
   */
  setupIPCListeners() {
    // Recibir notificaciones de pago desde la ventana del renderer
    ipcMain.on('mercadopago:notification', (event, notification) => {
      this.handleNotification(notification);
    });

    // Configurar webhook
    ipcMain.on('mercadopago:webhook-config', (event, config) => {
      this.config = config;
      logger.info('Configuración de webhook de Mercado Pago actualizada', { userId: config.userId });
    });

    // Verificar estado de un pago específico
    ipcMain.handle('mercadopago:check-payment', async (event, paymentId) => {
      return await this.checkPaymentStatus(paymentId);
    });
  }

  /**
   * Carga la configuración de Mercado Pago
   */
  async loadConfig() {
    if (!this.config) {
      try {
        this.config = await configHandler.getConfig();
      } catch (error) {
        logger.error('Error al cargar configuración de Mercado Pago', { error: error.message });
        return false;
      }
    }
    return true;
  }

  /**
   * Maneja notificaciones entrantes de Mercado Pago
   * @param {Object} notification Objeto de notificación de Mercado Pago
   */
  async handleNotification(notification) {
    try {
      // Verificar y registrar la notificación recibida
      logger.info('Notificación de Mercado Pago recibida', {
        id: notification.id,
        topic: notification.topic,
        type: notification.type
      });

      // Guardar la notificación para procesamiento
      this.notificationQueue.push({
        notification,
        attempts: 0,
        timestamp: Date.now()
      });

      // Si hay una ventana activa, notificar sobre la recepción
      ipcMain.emit('mercadopago:notification-received', notification);

      // Intentar procesar inmediatamente si no hay procesamiento en curso
      if (!this.processing) {
        this.processQueue();
      }
    } catch (error) {
      logger.error('Error al manejar notificación de Mercado Pago', {
        error: error.message,
        notification
      });
    }
  }

  /**
   * Procesa la cola de notificaciones
   */
  async processQueue() {
    if (this.processing || this.notificationQueue.length === 0) return;

    this.processing = true;
    
    try {
      const item = this.notificationQueue.shift();
      const { notification, attempts } = item;

      // Limitar reintentos a un máximo de 5
      if (attempts >= 5) {
        logger.warn('Máximo de intentos alcanzado para notificación de Mercado Pago', {
          notification: notification.id
        });
        this.logFailedNotification(item);
        this.processing = false;
        return;
      }

      // Procesar según el tipo de notificación
      if (notification.topic === 'payment') {
        await this.processPaymentNotification(notification);
      } else if (notification.topic === 'merchant_order') {
        await this.processMerchantOrderNotification(notification);
      } else {
        logger.info('Notificación de tipo no procesable', { topic: notification.topic });
      }
    } catch (error) {
      logger.error('Error al procesar notificación de Mercado Pago', {
        error: error.message
      });
      
      // Reintentar la notificación
      const failedItem = this.notificationQueue.shift();
      failedItem.attempts += 1;
      this.notificationQueue.push(failedItem);
    } finally {
      this.processing = false;
      
      // Si hay más elementos en la cola, continuar procesando
      if (this.notificationQueue.length > 0) {
        setTimeout(() => this.processQueue(), 1000);
      }
    }
  }

  /**
   * Procesa una notificación de pago
   * @param {Object} notification Notificación de pago
   */
  async processPaymentNotification(notification) {
    const paymentId = notification.id || notification.data?.id;
    
    if (!paymentId) {
      logger.error('ID de pago no encontrado en notificación', { notification });
      return;
    }

    try {
      // Cargar configuración si es necesario
      if (!await this.loadConfig()) return;

      // Consultar detalles del pago a la API de Mercado Pago
      const paymentInfo = await this.getPaymentInfo(paymentId);
      
      if (!paymentInfo) {
        logger.error('No se pudo obtener información del pago', { paymentId });
        return;
      }

      logger.info('Información de pago obtenida', {
        id: paymentInfo.id,
        status: paymentInfo.status,
        amount: paymentInfo.transaction_amount
      });

      // Actualizar el pago en la base de datos
      await this.updatePaymentInDatabase(paymentInfo);

      // Si el pago está aprobado, verificar si hay facturas pendientes asociadas
      if (paymentInfo.status === PAYMENT_STATUS.APPROVED) {
        await this.reconcilePaymentWithInvoice(paymentInfo);
      }

      // Notificar al frontend sobre el cambio de estado
      this.notifyPaymentStatusChange(paymentInfo);
    } catch (error) {
      logger.error('Error al procesar notificación de pago', {
        error: error.message,
        paymentId
      });
      throw error; // Re-lanzar para reintentar
    }
  }

  /**
   * Procesa una notificación de orden de comerciante
   * @param {Object} notification Notificación de orden
   */
  async processMerchantOrderNotification(notification) {
    const orderId = notification.id || notification.data?.id;
    
    if (!orderId) {
      logger.error('ID de orden no encontrado en notificación', { notification });
      return;
    }

    try {
      // Cargar configuración si es necesario
      if (!await this.loadConfig()) return;

      // Consultar detalles de la orden a la API de Mercado Pago
      const orderInfo = await this.getMerchantOrderInfo(orderId);
      
      if (!orderInfo) {
        logger.error('No se pudo obtener información de la orden', { orderId });
        return;
      }

      logger.info('Información de orden obtenida', {
        id: orderInfo.id,
        status: orderInfo.status,
        totalAmount: orderInfo.total_amount
      });

      // Procesar pagos asociados a la orden
      if (orderInfo.payments && orderInfo.payments.length > 0) {
        for (const payment of orderInfo.payments) {
          await this.processPaymentNotification({ id: payment.id });
        }
      }
    } catch (error) {
      logger.error('Error al procesar notificación de orden', {
        error: error.message,
        orderId
      });
      throw error; // Re-lanzar para reintentar
    }
  }

  /**
   * Obtiene información de un pago desde la API de Mercado Pago
   * @param {string} paymentId ID del pago
   * @returns {Object} Información del pago
   */
  async getPaymentInfo(paymentId) {
    try {
      // Cargar configuración si es necesario
      if (!await this.loadConfig()) return null;

      const response = await axios.get(
        `https://api.mercadopago.com/v1/payments/${paymentId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.config.accessToken}`
          }
        }
      );

      return response.data;
    } catch (error) {
      logger.error('Error al obtener información del pago de Mercado Pago', {
        error: error.message,
        paymentId
      });
      return null;
    }
  }

  /**
   * Obtiene información de una orden desde la API de Mercado Pago
   * @param {string} orderId ID de la orden
   * @returns {Object} Información de la orden
   */
  async getMerchantOrderInfo(orderId) {
    try {
      // Cargar configuración si es necesario
      if (!await this.loadConfig()) return null;

      const response = await axios.get(
        `https://api.mercadopago.com/merchant_orders/${orderId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.config.accessToken}`
          }
        }
      );

      return response.data;
    } catch (error) {
      logger.error('Error al obtener información de la orden de Mercado Pago', {
        error: error.message,
        orderId
      });
      return null;
    }
  }

  /**
   * Actualiza la información del pago en la base de datos
   * @param {Object} paymentInfo Información del pago
   */
  async updatePaymentInDatabase(paymentInfo) {
    try {
      const db = await database.getConnection();
      
      // Verificar si el pago ya existe en la base de datos
      const existingPayment = await db.get(
        'SELECT * FROM mercadopago_payments WHERE payment_id = ?',
        [paymentInfo.id]
      );

      const paymentData = {
        payment_id: paymentInfo.id,
        status: paymentInfo.status,
        status_detail: paymentInfo.status_detail,
        amount: paymentInfo.transaction_amount,
        currency_id: paymentInfo.currency_id,
        description: paymentInfo.description,
        payment_method_id: paymentInfo.payment_method_id,
        payment_type_id: paymentInfo.payment_type_id,
        external_reference: paymentInfo.external_reference,
        payer_email: paymentInfo.payer?.email,
        payer_id: paymentInfo.payer?.id,
        merchant_order_id: paymentInfo.order?.id,
        raw_data: JSON.stringify(paymentInfo),
        updated_at: new Date().toISOString()
      };

      if (existingPayment) {
        // Actualizar pago existente
        await db.run(
          `UPDATE mercadopago_payments SET 
            status = ?, 
            status_detail = ?, 
            merchant_order_id = ?, 
            raw_data = ?, 
            updated_at = ?
          WHERE payment_id = ?`,
          [
            paymentData.status,
            paymentData.status_detail,
            paymentData.merchant_order_id,
            paymentData.raw_data,
            paymentData.updated_at,
            paymentData.payment_id
          ]
        );

        logger.info('Pago de Mercado Pago actualizado en la base de datos', {
          paymentId: paymentData.payment_id,
          status: paymentData.status
        });
      } else {
        // Insertar nuevo pago
        paymentData.created_at = new Date().toISOString();
        
        await db.run(
          `INSERT INTO mercadopago_payments (
            payment_id, status, status_detail, amount, currency_id, 
            description, payment_method_id, payment_type_id, 
            external_reference, payer_email, payer_id, 
            merchant_order_id, raw_data, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            paymentData.payment_id,
            paymentData.status,
            paymentData.status_detail,
            paymentData.amount,
            paymentData.currency_id,
            paymentData.description,
            paymentData.payment_method_id,
            paymentData.payment_type_id,
            paymentData.external_reference,
            paymentData.payer_email,
            paymentData.payer_id,
            paymentData.merchant_order_id,
            paymentData.raw_data,
            paymentData.created_at,
            paymentData.updated_at
          ]
        );

        logger.info('Nuevo pago de Mercado Pago registrado en la base de datos', {
          paymentId: paymentData.payment_id,
          status: paymentData.status
        });
      }

      return true;
    } catch (error) {
      logger.error('Error al actualizar pago en la base de datos', {
        error: error.message,
        paymentId: paymentInfo.id
      });
      throw error;
    }
  }

  /**
   * Reconcilia un pago con una factura pendiente
   * @param {Object} paymentInfo Información del pago
   */
  async reconcilePaymentWithInvoice(paymentInfo) {
    try {
      // El external_reference debería contener el ID de la factura
      const invoiceId = paymentInfo.external_reference;
      
      if (!invoiceId) {
        logger.warn('No se encontró referencia externa para reconciliación', {
          paymentId: paymentInfo.id
        });
        return;
      }

      const db = await database.getConnection();
      
      // Buscar la factura con ese ID
      const invoice = await db.get(
        'SELECT * FROM facturas WHERE id = ? AND estado_pago = "pendiente"',
        [invoiceId]
      );

      if (!invoice) {
        logger.warn('No se encontró factura pendiente para reconciliar', {
          invoiceId,
          paymentId: paymentInfo.id
        });
        return;
      }

      // Actualizar estado de pago de la factura
      await db.run(
        'UPDATE facturas SET estado_pago = "pagado", fecha_pago = ?, metodo_pago_id = ?, pago_referencia = ? WHERE id = ?',
        [
          new Date().toISOString(),
          'mercadopago_qr',
          paymentInfo.id,
          invoiceId
        ]
      );

      // Registrar en la tabla de pagos
      await db.run(
        `INSERT INTO pagos (
          factura_id, 
          monto, 
          fecha, 
          metodo_pago, 
          referencia, 
          estado, 
          detalles
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          invoiceId,
          paymentInfo.transaction_amount,
          new Date().toISOString(),
          'mercadopago_qr',
          paymentInfo.id,
          'completado',
          JSON.stringify({
            payment_id: paymentInfo.id,
            payment_status: paymentInfo.status,
            payment_method: paymentInfo.payment_method_id
          })
        ]
      );

      logger.info('Pago reconciliado con factura exitosamente', {
        invoiceId,
        paymentId: paymentInfo.id,
        amount: paymentInfo.transaction_amount
      });

      // Notificar sobre la reconciliación exitosa
      this.notifyInvoicePaid(invoice, paymentInfo);
    } catch (error) {
      logger.error('Error al reconciliar pago con factura', {
        error: error.message,
        paymentId: paymentInfo.id,
        externalReference: paymentInfo.external_reference
      });
    }
  }

  /**
   * Notifica al frontend sobre un cambio en el estado del pago
   * @param {Object} paymentInfo Información del pago
   */
  notifyPaymentStatusChange(paymentInfo) {
    ipcMain.emit('mercadopago:payment-status-change', null, {
      paymentId: paymentInfo.id,
      status: paymentInfo.status,
      statusDetail: paymentInfo.status_detail,
      amount: paymentInfo.transaction_amount,
      externalReference: paymentInfo.external_reference
    });

    // Si el pago está aprobado, enviar notificación de sistema
    if (paymentInfo.status === PAYMENT_STATUS.APPROVED) {
      notificaciones.mostrar({
        titulo: 'Pago recibido',
        mensaje: `Se recibió un pago por $${paymentInfo.transaction_amount} a través de Mercado Pago`,
        tipo: 'success',
        duracion: 5000
      });
    } else if (paymentInfo.status === PAYMENT_STATUS.REJECTED) {
      notificaciones.mostrar({
        titulo: 'Pago rechazado',
        mensaje: `El pago ${paymentInfo.id} fue rechazado: ${paymentInfo.status_detail}`,
        tipo: 'error',
        duracion: 5000
      });
    }
  }

  /**
   * Notifica al frontend sobre una factura pagada
   * @param {Object} invoice Información de la factura
   * @param {Object} paymentInfo Información del pago
   */
  notifyInvoicePaid(invoice, paymentInfo) {
    ipcMain.emit('factura:pagada', null, {
      facturaId: invoice.id,
      monto: paymentInfo.transaction_amount,
      metodoPago: 'Mercado Pago QR',
      referenciaPago: paymentInfo.id
    });

    notificaciones.mostrar({
      titulo: 'Factura pagada',
      mensaje: `La factura ${invoice.numero} ha sido pagada vía Mercado Pago`,
      tipo: 'success',
      duracion: 5000
    });
  }

  /**
   * Verifica el estado de un pago específico
   * @param {string} paymentId ID del pago a verificar
   * @returns {Object} Estado del pago o null si no se encuentra
   */
  async checkPaymentStatus(paymentId) {
    try {
      const paymentInfo = await this.getPaymentInfo(paymentId);
      
      if (!paymentInfo) {
        return {
          found: false,
          message: 'No se pudo obtener información del pago'
        };
      }

      // Actualizar en la base de datos
      await this.updatePaymentInDatabase(paymentInfo);

      return {
        found: true,
        status: paymentInfo.status,
        statusDetail: paymentInfo.status_detail,
        amount: paymentInfo.transaction_amount,
        date: paymentInfo.date_approved || paymentInfo.date_created
      };
    } catch (error) {
      logger.error('Error al verificar estado de pago', {
        error: error.message,
        paymentId
      });
      
      return {
        found: false,
        error: error.message
      };
    }
  }

  /**
   * Registra una notificación fallida en el archivo de log
   * @param {Object} item Item de notificación que falló
   */
  logFailedNotification(item) {
    try {
      let logs = [];
      
      // Leer logs existentes si existen
      if (fs.existsSync(this.logFilePath)) {
        try {
          const fileContent = fs.readFileSync(this.logFilePath, 'utf8');
          logs = JSON.parse(fileContent);
        } catch (e) {
          // Si hay error al parsear, comenzar con array vacío
          logs = [];
        }
      }
      
      // Agregar nuevo log fallido
      logs.push({
        timestamp: new Date().toISOString(),
        notification: item.notification,
        attempts: item.attempts,
        error: 'Máximo de intentos alcanzado'
      });
      
      // Mantener solo los últimos 100 logs
      if (logs.length > 100) {
        logs = logs.slice(-100);
      }
      
      // Guardar logs
      fs.writeFileSync(this.logFilePath, JSON.stringify(logs, null, 2));
    } catch (error) {
      logger.error('Error al registrar notificación fallida', {
        error: error.message
      });
    }
  }

  /**
   * Detiene el procesador de webhooks
   */
  stopProcessor() {
    if (this.webhookProcessor) {
      clearInterval(this.webhookProcessor);
    }
    logger.info('Procesador de webhooks de Mercado Pago detenido');
  }
}

// Crear y exportar una instancia única
const webhookHandler = new MercadoPagoWebhook();

module.exports = webhookHandler;