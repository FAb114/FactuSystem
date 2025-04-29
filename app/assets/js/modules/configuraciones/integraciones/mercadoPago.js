/**
 * @file mercadoPago.js
 * @description Módulo para la integración y configuración de Mercado Pago en FactuSystem
 * @module app/assets/js/modules/configuraciones/integraciones/mercadoPago
 */

// Importaciones necesarias
const { ipcRenderer } = require('electron');
const database = require('../../../../utils/database.js');
const validation = require('../../../../utils/validation.js');
const notifications = require('../../../../components/notifications.js');
const logger = require('../../../../utils/logger.js');
const qrGenerator = require('../../../../../../integrations/mercadoPago/qr.js');

/**
 * Clase principal para la gestión de la integración con Mercado Pago
 */
class MercadoPagoIntegration {
  constructor() {
    this.config = {
      accessToken: '',
      publicKey: '',
      clientId: '',
      clientSecret: '',
      userID: '',
      externalPosID: '',
      qrImagePath: '',
      notificationUrl: '',
      refreshInterval: 10, // segundos para verificar pagos recibidos
      notificationsEnabled: true,
      autoReconciliation: false,
      testMode: false
    };
    
    this.initialized = false;
    this.statusElement = null;
    this.connectionStatus = false;
    this.qrPreviewElement = null;
    this.currentSucursal = null;
    
    // Objetos para cachear temporalmente pagos procesados y evitar duplicados
    this.processedPayments = new Set();
    
    // Referencia al intervalo de actualización
    this.refreshIntervalId = null;
  }

  /**
   * Inicializa el módulo de configuración de Mercado Pago
   * @param {string} sucursalId - ID de la sucursal actual
   */
  async init(sucursalId) {
    try {
      if (this.initialized) return;
      
      this.currentSucursal = sucursalId;
      
      // Carga la configuración desde la base de datos
      await this.loadConfig();
      
      // Inicializa los elementos de la interfaz
      this.initElements();
      
      // Configura los listeners de eventos
      this.setupEventListeners();
      
      // Muestra la configuración actual
      this.displayConfig();
      
      // Verifica el estado de la conexión con Mercado Pago
      await this.checkConnectionStatus();
      
      this.initialized = true;
      
      // Si está habilitada la reconciliación automática, inicia el proceso
      if (this.config.autoReconciliation) {
        this.startPaymentRefresh();
      }
      
      logger.info('Módulo de configuración de Mercado Pago inicializado correctamente');
    } catch (error) {
      logger.error('Error al inicializar el módulo de Mercado Pago', error);
      notifications.show('error', 'Error al inicializar la configuración de Mercado Pago', error.message);
    }
  }

  /**
   * Carga la configuración de Mercado Pago desde la base de datos
   */
  async loadConfig() {
    try {
      const config = await database.getConfig('mercadoPago', this.currentSucursal);
      
      if (config) {
        this.config = { ...this.config, ...config };
        logger.info('Configuración de Mercado Pago cargada correctamente');
      } else {
        logger.info('No se encontró configuración previa de Mercado Pago');
      }
    } catch (error) {
      logger.error('Error al cargar la configuración de Mercado Pago', error);
      throw new Error('No se pudo cargar la configuración de Mercado Pago');
    }
  }

  /**
   * Inicializa los elementos de la interfaz de usuario
   */
  initElements() {
    // Status de la conexión
    this.statusElement = document.getElementById('mp-connection-status');
    
    // Vista previa del QR
    this.qrPreviewElement = document.getElementById('mp-qr-preview');
    
    // Input fields
    this.formElements = {
      accessToken: document.getElementById('mp-access-token'),
      publicKey: document.getElementById('mp-public-key'),
      clientId: document.getElementById('mp-client-id'),
      clientSecret: document.getElementById('mp-client-secret'),
      userID: document.getElementById('mp-user-id'),
      externalPosID: document.getElementById('mp-pos-id'),
      notificationUrl: document.getElementById('mp-notification-url'),
      refreshInterval: document.getElementById('mp-refresh-interval'),
      notificationsEnabled: document.getElementById('mp-notifications-enabled'),
      autoReconciliation: document.getElementById('mp-auto-reconciliation'),
      testMode: document.getElementById('mp-test-mode')
    };
  }

  /**
   * Configura los listeners de eventos para los botones y formularios
   */
  setupEventListeners() {
    // Form submit para guardar configuración
    document.getElementById('mp-config-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveConfig();
    });
    
    // Botón para probar la conexión
    document.getElementById('mp-test-connection').addEventListener('click', () => {
      this.testConnection();
    });
    
    // Botón para generar nuevo QR
    document.getElementById('mp-generate-qr').addEventListener('click', () => {
      this.generateQR();
    });
    
    // Botón para subir imagen de QR existente
    document.getElementById('mp-upload-qr').addEventListener('click', () => {
      this.uploadQRImage();
    });
    
    // Botón para sincronizar transacciones manualmente
    document.getElementById('mp-sync-transactions').addEventListener('click', () => {
      this.syncTransactions();
    });
    
    // Cambio en el intervalo de actualización
    this.formElements.refreshInterval.addEventListener('change', () => {
      // Validar que sea un número entre 5 y 60
      const value = parseInt(this.formElements.refreshInterval.value);
      if (value < 5) this.formElements.refreshInterval.value = 5;
      if (value > 60) this.formElements.refreshInterval.value = 60;
    });
    
    // Cambio en checkbox de auto reconciliación
    this.formElements.autoReconciliation.addEventListener('change', (e) => {
      if (e.target.checked) {
        this.startPaymentRefresh();
      } else {
        this.stopPaymentRefresh();
      }
    });
  }

  /**
   * Muestra la configuración actual en el formulario
   */
  displayConfig() {
    // Actualiza los valores del formulario con la configuración actual
    Object.keys(this.formElements).forEach(key => {
      if (key === 'notificationsEnabled' || key === 'autoReconciliation' || key === 'testMode') {
        this.formElements[key].checked = this.config[key];
      } else {
        this.formElements[key].value = this.config[key];
      }
    });
    
    // Muestra la vista previa del QR si existe
    if (this.config.qrImagePath) {
      this.displayQRPreview(this.config.qrImagePath);
    }
  }

  /**
   * Guarda la configuración en la base de datos
   */
  async saveConfig() {
    try {
      // Recopila los valores del formulario
      const formData = {
        accessToken: this.formElements.accessToken.value.trim(),
        publicKey: this.formElements.publicKey.value.trim(),
        clientId: this.formElements.clientId.value.trim(),
        clientSecret: this.formElements.clientSecret.value.trim(),
        userID: this.formElements.userID.value.trim(),
        externalPosID: this.formElements.externalPosID.value.trim(),
        notificationUrl: this.formElements.notificationUrl.value.trim(),
        refreshInterval: parseInt(this.formElements.refreshInterval.value),
        notificationsEnabled: this.formElements.notificationsEnabled.checked,
        autoReconciliation: this.formElements.autoReconciliation.checked,
        testMode: this.formElements.testMode.checked,
        qrImagePath: this.config.qrImagePath // Mantiene la ruta actual del QR
      };
      
      // Validación básica de campos requeridos
      if (!formData.accessToken) {
        throw new Error('El Access Token es obligatorio para integrar con Mercado Pago');
      }
      
      // Actualiza la configuración en memoria
      this.config = { ...this.config, ...formData };
      
      // Guarda en la base de datos
      await database.saveConfig('mercadoPago', this.config, this.currentSucursal);
      
      // Actualiza el estado de la conexión
      await this.checkConnectionStatus();
      
      // Si cambió el estado de la reconciliación automática, actualiza el intervalo
      if (this.config.autoReconciliation) {
        this.startPaymentRefresh();
      } else {
        this.stopPaymentRefresh();
      }
      
      notifications.show('success', 'Configuración guardada', 'La configuración de Mercado Pago se guardó correctamente');
      logger.info('Configuración de Mercado Pago guardada correctamente');
    } catch (error) {
      logger.error('Error al guardar la configuración de Mercado Pago', error);
      notifications.show('error', 'Error al guardar', error.message);
    }
  }

  /**
   * Comprueba el estado de la conexión con Mercado Pago
   */
  async checkConnectionStatus() {
    try {
      if (!this.config.accessToken) {
        this.updateConnectionStatus(false, 'No configurado');
        return false;
      }
      
      // Solicita verificación de conexión al proceso principal
      const result = await ipcRenderer.invoke('mercadoPago:checkConnection', this.config);
      
      this.updateConnectionStatus(result.success, result.message);
      return result.success;
    } catch (error) {
      logger.error('Error al verificar la conexión con Mercado Pago', error);
      this.updateConnectionStatus(false, 'Error de conexión');
      return false;
    }
  }

  /**
   * Actualiza el indicador visual del estado de la conexión
   * @param {boolean} isConnected - Estado de la conexión
   * @param {string} message - Mensaje descriptivo del estado
   */
  updateConnectionStatus(isConnected, message) {
    this.connectionStatus = isConnected;
    
    if (this.statusElement) {
      this.statusElement.className = isConnected ? 'status-connected' : 'status-disconnected';
      this.statusElement.textContent = isConnected ? 'Conectado' : message || 'Desconectado';
    }
  }

  /**
   * Prueba la conexión con Mercado Pago usando las credenciales actuales
   */
  async testConnection() {
    try {
      notifications.show('info', 'Probando conexión', 'Verificando credenciales de Mercado Pago...');
      
      // Recopila las credenciales actuales del formulario
      const credentials = {
        accessToken: this.formElements.accessToken.value.trim(),
        publicKey: this.formElements.publicKey.value.trim()
      };
      
      if (!credentials.accessToken) {
        throw new Error('El Access Token es obligatorio para probar la conexión');
      }
      
      // Solicita verificación de conexión al proceso principal
      const result = await ipcRenderer.invoke('mercadoPago:testConnection', credentials);
      
      if (result.success) {
        notifications.show('success', 'Conexión exitosa', 'Las credenciales de Mercado Pago son válidas');
        this.updateConnectionStatus(true, 'Conectado');
      } else {
        notifications.show('error', 'Error de conexión', result.message || 'No se pudo establecer conexión con Mercado Pago');
        this.updateConnectionStatus(false, 'Credenciales inválidas');
      }
    } catch (error) {
      logger.error('Error al probar la conexión con Mercado Pago', error);
      notifications.show('error', 'Error de conexión', error.message);
      this.updateConnectionStatus(false, 'Error');
    }
  }

  /**
   * Genera un nuevo código QR estático para Mercado Pago
   */
  async generateQR() {
    try {
      if (!this.config.accessToken) {
        throw new Error('Se requiere un Access Token válido para generar el QR');
      }
      
      notifications.show('info', 'Generando QR', 'Creando nuevo código QR estático...');
      
      // Obtiene el nombre o razón social de la empresa desde la configuración
      const empresaConfig = await database.getConfig('empresa', this.currentSucursal);
      const storeName = empresaConfig?.razonSocial || 'FactuSystem';
      
      // Solicita la generación del QR al proceso principal
      const result = await ipcRenderer.invoke('mercadoPago:generateQR', {
        accessToken: this.config.accessToken,
        storeName: storeName,
        externalPosId: this.config.externalPosID || `pos-${this.currentSucursal}`,
        sucursalId: this.currentSucursal,
        testMode: this.config.testMode
      });
      
      if (result.success) {
        // Actualiza la configuración con la nueva ruta del QR
        this.config.qrImagePath = result.qrImagePath;
        
        // Guarda la nueva configuración
        await database.saveConfig('mercadoPago', this.config, this.currentSucursal);
        
        // Muestra la vista previa del QR
        this.displayQRPreview(result.qrImagePath);
        
        notifications.show('success', 'QR generado', 'El código QR se generó correctamente');
        logger.info('QR de Mercado Pago generado correctamente');
      } else {
        throw new Error(result.message || 'No se pudo generar el código QR');
      }
    } catch (error) {
      logger.error('Error al generar QR de Mercado Pago', error);
      notifications.show('error', 'Error al generar QR', error.message);
    }
  }

  /**
   * Permite subir una imagen de QR existente
   */
  async uploadQRImage() {
    try {
      // Solicita abrir diálogo para seleccionar imagen
      const result = await ipcRenderer.invoke('dialog:openFile', {
        title: 'Seleccionar imagen de QR',
        filters: [
          { name: 'Imágenes', extensions: ['jpg', 'png', 'jpeg'] }
        ],
        properties: ['openFile']
      });
      
      if (result.canceled || !result.filePaths.length) {
        return;
      }
      
      const filePath = result.filePaths[0];
      
      // Copia el archivo a la carpeta de la aplicación
      const savedPath = await ipcRenderer.invoke('file:copyToAppData', {
        sourcePath: filePath,
        destinationFolder: `sucursal-${this.currentSucursal}/mercadopago`,
        newFileName: `qr-custom-${Date.now()}.png`
      });
      
      if (savedPath) {
        // Actualiza la configuración con la nueva ruta
        this.config.qrImagePath = savedPath;
        
        // Guarda la configuración actualizada
        await database.saveConfig('mercadoPago', this.config, this.currentSucursal);
        
        // Muestra la vista previa
        this.displayQRPreview(savedPath);
        
        notifications.show('success', 'QR cargado', 'La imagen del QR se cargó correctamente');
        logger.info('Imagen de QR de Mercado Pago cargada manualmente');
      }
    } catch (error) {
      logger.error('Error al cargar imagen de QR', error);
      notifications.show('error', 'Error al cargar QR', error.message);
    }
  }

  /**
   * Muestra la vista previa del código QR
   * @param {string} imagePath - Ruta a la imagen del QR
   */
  displayQRPreview(imagePath) {
    if (!this.qrPreviewElement || !imagePath) return;
    
    // Para mostrar imágenes locales en Electron necesitamos un protocolo especial
    // o convertir la ruta a una URL de archivo
    this.qrPreviewElement.src = `file://${imagePath}`;
    this.qrPreviewElement.classList.remove('hidden');
    
    // También actualizamos el campo oculto que guarda la ruta
    const hiddenInput = document.getElementById('mp-qr-path');
    if (hiddenInput) {
      hiddenInput.value = imagePath;
    }
  }

  /**
   * Sincroniza manualmente las transacciones recientes de Mercado Pago
   */
  async syncTransactions() {
    try {
      if (!this.config.accessToken) {
        throw new Error('Se requiere un Access Token válido para sincronizar transacciones');
      }
      
      notifications.show('info', 'Sincronizando', 'Obteniendo transacciones recientes...');
      
      // Solicita sincronización al proceso principal
      const result = await ipcRenderer.invoke('mercadoPago:syncTransactions', {
        accessToken: this.config.accessToken,
        sucursalId: this.currentSucursal,
        posId: this.config.externalPosID || `pos-${this.currentSucursal}`
      });
      
      if (result.success) {
        notifications.show('success', 'Sincronización completada', 
          `Se encontraron ${result.transactions.length} transacciones recientes`);
        
        // Procesa las transacciones recibidas
        this.processReceivedTransactions(result.transactions);
        
        logger.info(`Sincronización manual completada: ${result.transactions.length} transacciones`);
      } else {
        throw new Error(result.message || 'No se pudieron sincronizar las transacciones');
      }
    } catch (error) {
      logger.error('Error al sincronizar transacciones de Mercado Pago', error);
      notifications.show('error', 'Error de sincronización', error.message);
    }
  }

  /**
   * Inicia el intervalo para verificar pagos automáticamente
   */
  startPaymentRefresh() {
    // Detiene el intervalo anterior si existe
    this.stopPaymentRefresh();
    
    // Establece el nuevo intervalo según la configuración
    const intervalSeconds = this.config.refreshInterval || 10;
    
    this.refreshIntervalId = setInterval(() => {
      this.checkNewPayments();
    }, intervalSeconds * 1000);
    
    logger.info(`Verificación automática de pagos iniciada (cada ${intervalSeconds} segundos)`);
  }

  /**
   * Detiene el intervalo de verificación automática
   */
  stopPaymentRefresh() {
    if (this.refreshIntervalId) {
      clearInterval(this.refreshIntervalId);
      this.refreshIntervalId = null;
      logger.info('Verificación automática de pagos detenida');
    }
  }

  /**
   * Verifica si hay nuevos pagos en Mercado Pago
   */
  async checkNewPayments() {
    try {
      if (!this.config.accessToken || !this.connectionStatus) {
        return;
      }
      
      // Solicita los pagos recientes al proceso principal
      const result = await ipcRenderer.invoke('mercadoPago:checkPayments', {
        accessToken: this.config.accessToken,
        sucursalId: this.currentSucursal,
        posId: this.config.externalPosID || `pos-${this.currentSucursal}`
      });
      
      if (result.success && result.payments.length > 0) {
        logger.info(`Se encontraron ${result.payments.length} pagos nuevos en Mercado Pago`);
        
        // Procesa los pagos recibidos
        this.processReceivedPayments(result.payments);
      }
    } catch (error) {
      logger.error('Error al verificar pagos de Mercado Pago', error);
    }
  }

  /**
   * Procesa las transacciones recibidas durante la sincronización
   * @param {Array} transactions - Lista de transacciones de Mercado Pago
   */
  async processReceivedTransactions(transactions) {
    if (!transactions || !transactions.length) return;
    
    try {
      // Filtrar transacciones ya procesadas
      const newTransactions = transactions.filter(tx => !this.processedPayments.has(tx.id));
      
      if (!newTransactions.length) return;
      
      // Registrar las transacciones en la base de datos
      await database.saveTransactions('mercadoPago', newTransactions, this.currentSucursal);
      
      // Marcar como procesadas
      newTransactions.forEach(tx => {
        this.processedPayments.add(tx.id);
      });
      
      // Limita el tamaño del set para evitar uso excesivo de memoria
      if (this.processedPayments.size > 1000) {
        // Mantener solo los últimos 500 pagos
        this.processedPayments = new Set(
          Array.from(this.processedPayments).slice(-500)
        );
      }
    } catch (error) {
      logger.error('Error al procesar transacciones recibidas', error);
    }
  }

  /**
   * Procesa los pagos recibidos durante la verificación automática
   * @param {Array} payments - Lista de pagos recibidos
   */
  async processReceivedPayments(payments) {
    if (!payments || !payments.length) return;
    
    try {
      // Filtra pagos ya procesados
      const newPayments = payments.filter(p => !this.processedPayments.has(p.id));
      
      if (!newPayments.length) return;
      
      // Para cada pago nuevo
      for (const payment of newPayments) {
        // Marca como procesado
        this.processedPayments.add(payment.id);
        
        // Registra el pago en la base de datos
        await database.savePayment('mercadoPago', payment, this.currentSucursal);
        
        // Emite evento para que el facturador pueda procesarlo
        document.dispatchEvent(new CustomEvent('mercadoPago:paymentReceived', { 
          detail: payment 
        }));
        
        // Muestra notificación si están habilitadas
        if (this.config.notificationsEnabled) {
          notifications.show(
            'success', 
            'Pago recibido', 
            `Pago de $${payment.transaction_amount} recibido por Mercado Pago`,
            { duration: 5000 }
          );
        }
      }
      
      // Limita el tamaño del set para evitar uso excesivo de memoria
      if (this.processedPayments.size > 1000) {
        // Mantener solo los últimos 500 pagos
        this.processedPayments = new Set(
          Array.from(this.processedPayments).slice(-500)
        );
      }
    } catch (error) {
      logger.error('Error al procesar pagos recibidos', error);
    }
  }

  /**
   * Limpiar recursos al cerrar el módulo
   */
  dispose() {
    this.stopPaymentRefresh();
    this.initialized = false;
  }
}

/**
 * Crea una instancia única del módulo de integración con Mercado Pago
 */
const mercadoPagoIntegration = new MercadoPagoIntegration();

/**
 * Exporta la clase y la instancia por defecto
 */
module.exports = {
  MercadoPagoIntegration,
  default: mercadoPagoIntegration
};