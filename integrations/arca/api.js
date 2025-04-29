/**
 * integrations/arca/api.js
 * 
 * API para la integración con ARCA (AFIP)
 * Maneja la autenticación, envío y recepción de comprobantes electrónicos
 * 
 * FactuSystem - Sistema de Facturación y Gestión Comercial Multisucursal
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');
const logger = require('../../services/audit/logger.js');
const database = require('../../app/assets/js/utils/database.js');

// Configuraciones y endpoints
const ARCA_CONFIG = {
  production: {
    baseUrl: 'https://public-api.arca.com.ar/v1',
    authUrl: 'https://api.auth.arca.com.ar/oauth/token',
  },
  testing: {
    baseUrl: 'https://public-api.arca.com.ar/v1/test',
    authUrl: 'https://api.auth.arca.com.ar/oauth/token/test',
  }
};

// Clase principal para manejo de ARCA
class ArcaAPI {
  constructor() {
    this.token = null;
    this.tokenExpiration = null;
    this.environment = 'testing'; // Por defecto en testing, cambiar a production en configuración
    this.credentials = {
      clientId: '',
      clientSecret: '',
      certificadoPath: '',
      clavePrivadaPath: '',
      cuit: '',
      puntoVenta: 1
    };
    this.configFilePath = path.join(__dirname, '../../app/assets/js/utils/config.json');

    // Inicialización
    this.loadCredentials();
    this.setupIPCListeners();
  }

  /**
   * Carga las credenciales desde la configuración
   */
  loadCredentials() {
    try {
      if (fs.existsSync(this.configFilePath)) {
        const config = JSON.parse(fs.readFileSync(this.configFilePath));
        
        if (config.arca) {
          this.credentials = {
            clientId: config.arca.clientId || '',
            clientSecret: config.arca.clientSecret || '',
            certificadoPath: config.arca.certificadoPath || '',
            clavePrivadaPath: config.arca.clavePrivadaPath || '',
            cuit: config.arca.cuit || '',
            puntoVenta: config.arca.puntoVenta || 1
          };
          
          this.environment = config.arca.environment || 'testing';
        }
      }
    } catch (error) {
      logger.error('Error al cargar credenciales de ARCA', error);
    }
  }

  /**
   * Configura los listeners para eventos IPC
   */
  setupIPCListeners() {
    ipcMain.handle('arca:authenticate', async () => {
      try {
        await this.authenticate();
        return { success: true, message: 'Autenticación exitosa con ARCA' };
      } catch (error) {
        logger.error('Error en autenticación ARCA', error);
        return { success: false, message: error.message };
      }
    });

    ipcMain.handle('arca:check-status', async () => {
      return this.checkConnectionStatus();
    });

    ipcMain.handle('arca:update-credentials', async (event, credentials) => {
      return this.updateCredentials(credentials);
    });

    ipcMain.handle('arca:generate-invoice', async (event, invoiceData) => {
      try {
        const result = await this.generateInvoice(invoiceData);
        return { success: true, data: result };
      } catch (error) {
        logger.error('Error al generar factura en ARCA', error);
        return { success: false, message: error.message };
      }
    });

    ipcMain.handle('arca:get-points-of-sale', async () => {
      try {
        const result = await this.getPointsOfSale();
        return { success: true, data: result };
      } catch (error) {
        logger.error('Error al obtener puntos de venta de ARCA', error);
        return { success: false, message: error.message };
      }
    });

    ipcMain.handle('arca:get-invoice-types', async () => {
      try {
        const result = await this.getInvoiceTypes();
        return { success: true, data: result };
      } catch (error) {
        logger.error('Error al obtener tipos de comprobantes de ARCA', error);
        return { success: false, message: error.message };
      }
    });

    ipcMain.handle('arca:get-invoice-status', async (event, invoiceId) => {
      try {
        const result = await this.getInvoiceStatus(invoiceId);
        return { success: true, data: result };
      } catch (error) {
        logger.error('Error al obtener estado de comprobante de ARCA', error);
        return { success: false, message: error.message };
      }
    });

    ipcMain.handle('arca:get-last-invoice-number', async (event, { pointOfSale, invoiceType }) => {
      try {
        const result = await this.getLastInvoiceNumber(pointOfSale, invoiceType);
        return { success: true, data: result };
      } catch (error) {
        logger.error('Error al obtener último número de comprobante de ARCA', error);
        return { success: false, message: error.message };
      }
    });

    ipcMain.handle('arca:verify-tax-id', async (event, taxId) => {
      try {
        const result = await this.verifyTaxId(taxId);
        return { success: true, data: result };
      } catch (error) {
        logger.error('Error al verificar CUIT/CUIL en ARCA', error);
        return { success: false, message: error.message };
      }
    });

    ipcMain.handle('arca:get-tax-categories', async () => {
      try {
        const result = await this.getTaxCategories();
        return { success: true, data: result };
      } catch (error) {
        logger.error('Error al obtener categorías impositivas de ARCA', error);
        return { success: false, message: error.message };
      }
    });

    ipcMain.handle('arca:create-credit-note', async (event, creditNoteData) => {
      try {
        const result = await this.createCreditNote(creditNoteData);
        return { success: true, data: result };
      } catch (error) {
        logger.error('Error al generar nota de crédito en ARCA', error);
        return { success: false, message: error.message };
      }
    });

    ipcMain.handle('arca:create-debit-note', async (event, debitNoteData) => {
      try {
        const result = await this.createDebitNote(debitNoteData);
        return { success: true, data: result };
      } catch (error) {
        logger.error('Error al generar nota de débito en ARCA', error);
        return { success: false, message: error.message };
      }
    });
  }

  /**
   * Verifica si se necesita refrescar el token
   */
  async ensureAuthenticated() {
    if (!this.token || !this.tokenExpiration || new Date() >= this.tokenExpiration) {
      await this.authenticate();
    }
  }

  /**
   * Realiza la autenticación con ARCA
   */
  async authenticate() {
    try {
      // Verificar que las credenciales estén configuradas
      if (!this.credentials.clientId || !this.credentials.clientSecret) {
        throw new Error('Credenciales de ARCA no configuradas');
      }

      // Preparar los datos de autenticación
      const authData = {
        grant_type: 'client_credentials',
        client_id: this.credentials.clientId,
        client_secret: this.credentials.clientSecret,
        scope: 'invoice'
      };

      // Realizar la solicitud de autenticación
      const response = await axios.post(
        ARCA_CONFIG[this.environment].authUrl,
        authData,
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      // Guardar el token y su expiración
      this.token = response.data.access_token;
      // Configurar la expiración para 5 minutos antes del tiempo real para evitar problemas
      this.tokenExpiration = new Date(new Date().getTime() + (response.data.expires_in * 1000) - 300000);
      
      logger.info('Autenticación exitosa con ARCA');
      return true;
    } catch (error) {
      logger.error('Error en autenticación con ARCA', error);
      throw new Error(`Error de autenticación: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Verifica el estado de conexión con ARCA
   */
  async checkConnectionStatus() {
    try {
      await this.ensureAuthenticated();
      
      const response = await axios.get(`${ARCA_CONFIG[this.environment].baseUrl}/status`, {
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });
      
      return {
        connected: true,
        status: response.data
      };
    } catch (error) {
      logger.error('Error al verificar estado de conexión con ARCA', error);
      return {
        connected: false,
        error: error.message
      };
    }
  }

  /**
   * Actualiza las credenciales de ARCA
   */
  async updateCredentials(credentials) {
    try {
      // Actualizar credenciales en memoria
      this.credentials = {
        ...this.credentials,
        ...credentials
      };
      
      // Guardar en archivo de configuración
      let config = {};
      if (fs.existsSync(this.configFilePath)) {
        config = JSON.parse(fs.readFileSync(this.configFilePath));
      }
      
      config.arca = {
        ...config.arca,
        ...credentials
      };
      
      fs.writeFileSync(this.configFilePath, JSON.stringify(config, null, 2));
      
      // Actualizar entorno si se proporciona
      if (credentials.environment) {
        this.environment = credentials.environment;
      }
      
      // Forzar una nueva autenticación con las nuevas credenciales
      this.token = null;
      this.tokenExpiration = null;
      
      return { success: true, message: 'Credenciales actualizadas correctamente' };
    } catch (error) {
      logger.error('Error al actualizar credenciales de ARCA', error);
      return { success: false, message: error.message };
    }
  }

  /**
   * Genera una factura electrónica
   * @param {Object} invoiceData - Datos de la factura
   */
  async generateInvoice(invoiceData) {
    try {
      await this.ensureAuthenticated();
      
      // Formatear los datos de acuerdo a la especificación de ARCA
      const formattedInvoice = this.formatInvoiceData(invoiceData);
      
      // Enviar solicitud a ARCA
      const response = await axios.post(
        `${ARCA_CONFIG[this.environment].baseUrl}/invoices`,
        formattedInvoice,
        {
          headers: {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      // Registrar en la base de datos local
      await this.storeInvoiceRecord(invoiceData, response.data);
      
      // Registrar en el log
      logger.info('Factura generada exitosamente en ARCA', {
        invoiceId: response.data.id,
        invoiceNumber: response.data.number,
        cae: response.data.cae
      });
      
      return response.data;
    } catch (error) {
      logger.error('Error al generar factura en ARCA', error);
      throw new Error(`Error al generar factura: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Formatea los datos de la factura para ARCA
   */
  formatInvoiceData(invoiceData) {
    // Tipo de comprobante (factura A, B, C, etc.)
    const invoiceTypeMap = {
      'A': 1,
      'B': 6,
      'C': 11,
      'X': 999  // Comprobante interno no fiscal
    };

    // Tipo de documento del receptor
    const documentTypeMap = {
      'CUIT': 80,
      'CUIL': 86,
      'DNI': 96,
      'PASAPORTE': 94,
      'CONSUMIDOR_FINAL': 99
    };
    
    // Formatear los artículos
    const items = invoiceData.items.map(item => ({
      description: item.description,
      quantity: item.quantity,
      unit_price: {
        amount: item.unitPrice,
        currency: "ARS"
      },
      vat_type: item.vatType || 5, // 5 = 21%
      vat_amount: {
        amount: item.vatAmount,
        currency: "ARS"
      },
      discount_amount: {
        amount: item.discountAmount || 0,
        currency: "ARS"
      },
      subtotal: {
        amount: item.subtotal,
        currency: "ARS"
      }
    }));
    
    // Formatear los datos de factura para ARCA
    return {
      invoice_type: invoiceTypeMap[invoiceData.invoiceType] || 6, // 6 = Factura B por defecto
      point_of_sale: this.credentials.puntoVenta,
      concept: 1, // 1 = Productos, 2 = Servicios, 3 = Productos y Servicios
      
      // Datos del emisor (la empresa)
      issuer: {
        tax_id: this.credentials.cuit.replace(/-/g, ''),
        tax_category: invoiceData.issuerTaxCategory || 'RESPONSABLE_INSCRIPTO', // Categoría fiscal de la empresa
        name: invoiceData.issuerName,
        address: {
          street: invoiceData.issuerStreet,
          number: invoiceData.issuerNumber,
          postal_code: invoiceData.issuerPostalCode,
          city: invoiceData.issuerCity,
          state: invoiceData.issuerState,
          country: 'AR'
        }
      },
      
      // Datos del receptor (cliente)
      receiver: {
        document_type: documentTypeMap[invoiceData.receiverDocumentType] || 99, // 99 = Consumidor Final por defecto
        document_number: invoiceData.receiverDocumentNumber || '00000000',
        name: invoiceData.receiverName || 'Consumidor Final',
        tax_category: invoiceData.receiverTaxCategory || 'CONSUMIDOR_FINAL',
        address: invoiceData.receiverAddress ? {
          street: invoiceData.receiverAddress.street || '',
          number: invoiceData.receiverAddress.number || '',
          postal_code: invoiceData.receiverAddress.postalCode || '',
          city: invoiceData.receiverAddress.city || '',
          state: invoiceData.receiverAddress.state || '',
          country: 'AR'
        } : undefined
      },
      
      // Artículos de la factura
      items: items,
      
      // Totales
      amounts: {
        subtotal: {
          amount: invoiceData.subtotal,
          currency: "ARS"
        },
        vat: {
          amount: invoiceData.vatAmount,
          currency: "ARS"
        },
        discount: {
          amount: invoiceData.discountAmount || 0,
          currency: "ARS"
        },
        total: {
          amount: invoiceData.total,
          currency: "ARS"
        }
      },
      
      // Formas de pago
      payment_methods: invoiceData.paymentMethods.map(method => ({
        type: method.type, // 'EFECTIVO', 'TARJETA', 'TRANSFERENCIA', 'QR'
        amount: {
          amount: method.amount,
          currency: "ARS"
        },
        card_info: method.type === 'TARJETA' ? {
          type: method.cardInfo?.type, // 'CREDITO', 'DEBITO'
          brand: method.cardInfo?.brand, // 'VISA', 'MASTERCARD', etc.
          last_digits: method.cardInfo?.lastDigits,
          installments: method.cardInfo?.installments || 1
        } : undefined
      })),
      
      // Información adicional
      observation: invoiceData.observation || '',
      related_documents: invoiceData.relatedDocuments || []
    };
  }

  /**
   * Almacena el registro de factura en la base de datos local
   */
  async storeInvoiceRecord(originalData, arcaResponse) {
    try {
      // Acceder a la base de datos
      const db = await database.getConnection();
      
      // Guardar la información en la tabla correspondiente
      await db.run(`
        INSERT INTO facturas_afip (
          id_factura,
          tipo_comprobante,
          punto_venta,
          numero_comprobante,
          cae,
          vencimiento_cae,
          fecha_emision,
          importe_total,
          id_cliente,
          respuesta_completa,
          fecha_creacion
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
      `, [
        originalData.invoiceId, // ID interno de la factura
        arcaResponse.invoice_type,
        arcaResponse.point_of_sale,
        arcaResponse.number,
        arcaResponse.cae,
        arcaResponse.cae_expiration,
        arcaResponse.date,
        arcaResponse.amounts.total.amount,
        originalData.clientId,
        JSON.stringify(arcaResponse),
      ]);
      
    } catch (error) {
      logger.error('Error al guardar registro de factura AFIP', error);
      // Continuar a pesar del error para no interferir con el proceso principal
    }
  }

  /**
   * Obtiene los puntos de venta habilitados
   */
  async getPointsOfSale() {
    try {
      await this.ensureAuthenticated();
      
      const response = await axios.get(
        `${ARCA_CONFIG[this.environment].baseUrl}/points-of-sale`,
        {
          headers: {
            'Authorization': `Bearer ${this.token}`
          }
        }
      );
      
      return response.data;
    } catch (error) {
      logger.error('Error al obtener puntos de venta de ARCA', error);
      throw new Error(`Error al obtener puntos de venta: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Obtiene los tipos de comprobantes disponibles
   */
  async getInvoiceTypes() {
    try {
      await this.ensureAuthenticated();
      
      const response = await axios.get(
        `${ARCA_CONFIG[this.environment].baseUrl}/invoice-types`,
        {
          headers: {
            'Authorization': `Bearer ${this.token}`
          }
        }
      );
      
      return response.data;
    } catch (error) {
      logger.error('Error al obtener tipos de comprobantes de ARCA', error);
      throw new Error(`Error al obtener tipos de comprobantes: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Obtiene el estado de un comprobante específico
   */
  async getInvoiceStatus(invoiceId) {
    try {
      await this.ensureAuthenticated();
      
      const response = await axios.get(
        `${ARCA_CONFIG[this.environment].baseUrl}/invoices/${invoiceId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.token}`
          }
        }
      );
      
      return response.data;
    } catch (error) {
      logger.error('Error al obtener estado de comprobante de ARCA', error);
      throw new Error(`Error al obtener estado de comprobante: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Obtiene el último número de comprobante para un punto de venta y tipo
   */
  async getLastInvoiceNumber(pointOfSale, invoiceType) {
    try {
      await this.ensureAuthenticated();
      
      const response = await axios.get(
        `${ARCA_CONFIG[this.environment].baseUrl}/last-invoice-number?point_of_sale=${pointOfSale}&invoice_type=${invoiceType}`,
        {
          headers: {
            'Authorization': `Bearer ${this.token}`
          }
        }
      );
      
      return response.data;
    } catch (error) {
      logger.error('Error al obtener último número de comprobante de ARCA', error);
      throw new Error(`Error al obtener último número de comprobante: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Verifica un CUIT/CUIL en AFIP
   */
  async verifyTaxId(taxId) {
    try {
      await this.ensureAuthenticated();
      
      const response = await axios.get(
        `${ARCA_CONFIG[this.environment].baseUrl}/taxpayers/${taxId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.token}`
          }
        }
      );
      
      return response.data;
    } catch (error) {
      logger.error('Error al verificar CUIT/CUIL en ARCA', error);
      throw new Error(`Error al verificar CUIT/CUIL: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Obtiene las categorías impositivas disponibles
   */
  async getTaxCategories() {
    try {
      await this.ensureAuthenticated();
      
      const response = await axios.get(
        `${ARCA_CONFIG[this.environment].baseUrl}/tax-categories`,
        {
          headers: {
            'Authorization': `Bearer ${this.token}`
          }
        }
      );
      
      return response.data;
    } catch (error) {
      logger.error('Error al obtener categorías impositivas de ARCA', error);
      throw new Error(`Error al obtener categorías impositivas: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Crea una nota de crédito
   */
  async createCreditNote(creditNoteData) {
    try {
      await this.ensureAuthenticated();
      
      // Formatear los datos según especificación de ARCA
      const formattedCreditNote = this.formatCreditNoteData(creditNoteData);
      
      // Enviar solicitud a ARCA
      const response = await axios.post(
        `${ARCA_CONFIG[this.environment].baseUrl}/credit-notes`,
        formattedCreditNote,
        {
          headers: {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      // Registrar en la base de datos local
      await this.storeNoteRecord('CREDIT', creditNoteData, response.data);
      
      // Registrar en el log
      logger.info('Nota de crédito generada exitosamente en ARCA', {
        noteId: response.data.id,
        noteNumber: response.data.number,
        cae: response.data.cae
      });
      
      return response.data;
    } catch (error) {
      logger.error('Error al generar nota de crédito en ARCA', error);
      throw new Error(`Error al generar nota de crédito: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Formatea los datos de nota de crédito para ARCA
   */
  formatCreditNoteData(creditNoteData) {
    // Utilizar la misma lógica de formatInvoiceData pero adaptada para notas de crédito
    const formattedData = this.formatInvoiceData(creditNoteData);
    
    // Agregar referencias a la factura original
    formattedData.related_documents = [{
      type: 'INVOICE',
      invoice_type: creditNoteData.originalInvoiceType,
      point_of_sale: creditNoteData.originalPointOfSale,
      number: creditNoteData.originalInvoiceNumber
    }];
    
    return formattedData;
  }

  /**
   * Crea una nota de débito
   */
  async createDebitNote(debitNoteData) {
    try {
      await this.ensureAuthenticated();
      
      // Formatear los datos según especificación de ARCA
      const formattedDebitNote = this.formatDebitNoteData(debitNoteData);
      
      // Enviar solicitud a ARCA
      const response = await axios.post(
        `${ARCA_CONFIG[this.environment].baseUrl}/debit-notes`,
        formattedDebitNote,
        {
          headers: {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      // Registrar en la base de datos local
      await this.storeNoteRecord('DEBIT', debitNoteData, response.data);
      
      // Registrar en el log
      logger.info('Nota de débito generada exitosamente en ARCA', {
        noteId: response.data.id,
        noteNumber: response.data.number,
        cae: response.data.cae
      });
      
      return response.data;
    } catch (error) {
      logger.error('Error al generar nota de débito en ARCA', error);
      throw new Error(`Error al generar nota de débito: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Formatea los datos de nota de débito para ARCA
   */
  formatDebitNoteData(debitNoteData) {
    // Utilizar la misma lógica de formatInvoiceData pero adaptada para notas de débito
    const formattedData = this.formatInvoiceData(debitNoteData);
    
    // Agregar referencias a la factura original
    formattedData.related_documents = [{
      type: 'INVOICE',
      invoice_type: debitNoteData.originalInvoiceType,
      point_of_sale: debitNoteData.originalPointOfSale,
      number: debitNoteData.originalInvoiceNumber
    }];
    
    return formattedData;
  }

  /**
   * Almacena el registro de nota (crédito o débito) en la base de datos local
   */
  async storeNoteRecord(noteType, originalData, arcaResponse) {
    try {
      // Acceder a la base de datos
      const db = await database.getConnection();
      
      // Guardar la información en la tabla correspondiente
      await db.run(`
        INSERT INTO notas_afip (
          id_nota,
          tipo_nota,
          tipo_comprobante,
          punto_venta,
          numero_comprobante,
          cae,
          vencimiento_cae,
          fecha_emision,
          importe_total,
          id_cliente,
          id_factura_original,
          respuesta_completa,
          fecha_creacion
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
      `, [
        originalData.noteId, // ID interno de la nota
        noteType, // 'CREDIT' o 'DEBIT'
        arcaResponse.invoice_type,
        arcaResponse.point_of_sale,
        arcaResponse.number,
        arcaResponse.cae,
        arcaResponse.cae_expiration,
        arcaResponse.date,
        arcaResponse.amounts.total.amount,
        originalData.clientId,
        originalData.originalInvoiceId,
        JSON.stringify(arcaResponse),
      ]);
      
    } catch (error) {
      logger.error('Error al guardar registro de nota AFIP', error);
      // Continuar a pesar del error para no interferir con el proceso principal
    }
  }
}

// Exportar una instancia de la API
const arcaAPI = new ArcaAPI();
module.exports = arcaAPI;