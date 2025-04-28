/**
 * sender.js - Servicio de envío de emails para FactuSystem
 * 
 * Este módulo maneja todas las funcionalidades de envío de correos electrónicos,
 * incluyendo el uso de plantillas, adjuntos (facturas, remitos, etc.) y
 * conexión con varios proveedores de servicios SMTP.
 */

const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const handlebars = require('handlebars');
const { convertHtmlToPdf } = require('../../services/print/pdf');
const { ipcMain } = require('electron');
const logger = require('../../services/audit/logger');
const { getCompanyInfo } = require('../../app/assets/js/utils/database');
const { encryptPassword, decryptPassword } = require('../../services/auth/twoFactor');
const os = require('os');

class EmailSender {
  constructor() {
    this.transporter = null;
    this.emailConfig = null;
    this.templateCache = {};
    this.companyInfo = null;
    this.initialized = false;
  }

  /**
   * Inicializa el servicio de correo con la configuración guardada
   * @returns {Promise<boolean>} - True si se inicializó correctamente
   */
  async initialize() {
    try {
      const configPath = path.join(os.homedir(), '.factusystem', 'config', 'email.json');
      
      // Verificar si existe el archivo de configuración
      if (fs.existsSync(configPath)) {
        const encryptedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        this.emailConfig = {
          ...encryptedConfig,
          password: encryptedConfig.password ? 
                    await decryptPassword(encryptedConfig.password) : 
                    null
        };
      } else {
        logger.warn('Email config file not found. Email service not initialized.');
        return false;
      }

      // Obtener información de la empresa
      this.companyInfo = await getCompanyInfo();
      
      // Crear el transporter si tenemos configuración
      if (this.emailConfig && this.emailConfig.host && this.emailConfig.user && this.emailConfig.password) {
        this.createTransporter();
        this.initialized = true;
        logger.info('Email service initialized successfully');
        return true;
      } else {
        logger.warn('Incomplete email configuration. Email service not fully initialized.');
        return false;
      }
    } catch (error) {
      logger.error('Error initializing email service:', error);
      return false;
    }
  }

  /**
   * Crea el transporter de Nodemailer con la configuración actual
   */
  createTransporter() {
    if (!this.emailConfig) return;

    const config = {
      host: this.emailConfig.host,
      port: this.emailConfig.port || 587,
      secure: this.emailConfig.secure || false,
      auth: {
        user: this.emailConfig.user,
        pass: this.emailConfig.password
      },
      tls: {
        rejectUnauthorized: this.emailConfig.rejectUnauthorized !== false
      }
    };

    this.transporter = nodemailer.createTransport(config);
  }

  /**
   * Guarda la configuración de email
   * @param {Object} config - Configuración de email
   * @returns {Promise<boolean>} - True si se guardó correctamente
   */
  async saveConfig(config) {
    try {
      // Crear carpeta de configuración si no existe
      const configDir = path.join(os.homedir(), '.factusystem', 'config');
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      // Encriptar la contraseña
      const encryptedConfig = {
        ...config,
        password: await encryptPassword(config.password)
      };

      // Guardar la configuración
      fs.writeFileSync(
        path.join(configDir, 'email.json'),
        JSON.stringify(encryptedConfig, null, 2)
      );

      // Actualizar la configuración actual
      this.emailConfig = config;
      this.createTransporter();
      this.initialized = true;
      logger.info('Email configuration saved successfully');
      return true;
    } catch (error) {
      logger.error('Error saving email configuration:', error);
      return false;
    }
  }

  /**
   * Verifica la conexión con el servidor SMTP
   * @param {Object} config - Configuración para probar
   * @returns {Promise<Object>} - Resultado de la verificación
   */
  async verifyConnection(config = null) {
    try {
      const testConfig = config || this.emailConfig;
      
      if (!testConfig || !testConfig.host || !testConfig.user || !testConfig.password) {
        return { success: false, message: 'Configuración incompleta' };
      }

      const testTransporter = nodemailer.createTransport({
        host: testConfig.host,
        port: testConfig.port || 587,
        secure: testConfig.secure || false,
        auth: {
          user: testConfig.user,
          pass: testConfig.password
        },
        tls: {
          rejectUnauthorized: testConfig.rejectUnauthorized !== false
        }
      });

      const verification = await testTransporter.verify();
      logger.info('Email connection verified successfully');
      return { success: true, message: 'Conexión exitosa' };
    } catch (error) {
      logger.error('Email connection verification failed:', error);
      return { 
        success: false, 
        message: `Error: ${error.message}`,
        error
      };
    }
  }

  /**
   * Carga una plantilla desde el sistema de archivos
   * @param {string} templateName - Nombre de la plantilla
   * @returns {Promise<Function>} - Función compilada de Handlebars
   */
  async getTemplate(templateName) {
    try {
      // Verificar si ya está en caché
      if (this.templateCache[templateName]) {
        return this.templateCache[templateName];
      }

      // Cargar desde el archivo
      const templatePath = path.join(__dirname, 'templates', `${templateName}.html`);
      const templateContent = fs.readFileSync(templatePath, 'utf8');
      
      // Compilar y guardar en caché
      const compiledTemplate = handlebars.compile(templateContent);
      this.templateCache[templateName] = compiledTemplate;
      
      return compiledTemplate;
    } catch (error) {
      logger.error(`Error loading email template ${templateName}:`, error);
      throw error;
    }
  }

  /**
   * Envía un email utilizando una plantilla
   * @param {Object} options - Opciones para el envío
   * @param {string} options.to - Destinatario
   * @param {string} options.subject - Asunto
   * @param {string} options.templateName - Nombre de la plantilla
   * @param {Object} options.templateData - Datos para la plantilla
   * @param {Array} options.attachments - Archivos adjuntos
   * @returns {Promise<Object>} - Resultado del envío
   */
  async sendTemplateEmail({ to, subject, templateName, templateData, attachments = [] }) {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      if (!this.transporter) {
        return { 
          success: false, 
          message: 'Servicio de email no inicializado correctamente' 
        };
      }

      // Cargar y compilar la plantilla
      const template = await this.getTemplate(templateName);
      const html = template({
        ...templateData,
        companyInfo: this.companyInfo
      });

      // Configurar opciones de email
      const mailOptions = {
        from: `"${this.companyInfo.nombre}" <${this.emailConfig.user}>`,
        to,
        subject,
        html,
        attachments
      };

      // Enviar el email
      const info = await this.transporter.sendMail(mailOptions);
      logger.info(`Email sent successfully to ${to}`, { messageId: info.messageId });
      
      return { 
        success: true, 
        message: 'Email enviado correctamente',
        messageId: info.messageId
      };
    } catch (error) {
      logger.error('Error sending template email:', error);
      return { 
        success: false, 
        message: `Error al enviar email: ${error.message}`,
        error
      };
    }
  }

  /**
   * Envía una factura por email
   * @param {Object} options - Opciones para el envío
   * @param {string} options.to - Email del destinatario
   * @param {Object} options.factura - Datos de la factura
   * @param {string} options.format - Formato ('a4' o 'ticket')
   * @returns {Promise<Object>} - Resultado del envío
   */
  async sendFactura({ to, factura, format = 'a4' }) {
    try {
      if (!to || !factura) {
        return { success: false, message: 'Datos incompletos' };
      }

      // Generar PDF de la factura
      const templatePath = path.join(
        __dirname, 
        '..', 
        '..',
        'app',
        'templates',
        'facturas',
        `${format}.html`
      );
      
      const pdfBuffer = await convertHtmlToPdf(templatePath, factura);
      const nombreArchivo = `${factura.tipoComprobante}_${factura.numeroComprobante}.pdf`;
      
      // Preparar plantilla para el email
      const templateData = {
        clienteNombre: factura.cliente.nombre,
        facturaTipo: factura.tipoComprobante,
        facturaNumero: factura.numeroComprobante,
        facturaFecha: factura.fecha,
        facturaTotal: factura.total,
        facturaMoneda: factura.moneda || '$'
      };

      // Adjuntos
      const attachments = [
        {
          filename: nombreArchivo,
          content: pdfBuffer,
          contentType: 'application/pdf'
        }
      ];

      // Enviar email
      return await this.sendTemplateEmail({
        to,
        subject: `${this.companyInfo.nombre} - ${factura.tipoComprobante} ${factura.numeroComprobante}`,
        templateName: 'factura',
        templateData,
        attachments
      });
    } catch (error) {
      logger.error('Error sending factura email:', error);
      return { 
        success: false, 
        message: `Error al enviar factura: ${error.message}`,
        error
      };
    }
  }

  /**
   * Envía un remito por email
   * @param {Object} options - Opciones para el envío
   * @param {string} options.to - Email del destinatario
   * @param {Object} options.remito - Datos del remito
   * @returns {Promise<Object>} - Resultado del envío
   */
  async sendRemito({ to, remito }) {
    try {
      if (!to || !remito) {
        return { success: false, message: 'Datos incompletos' };
      }

      // Generar PDF del remito
      const templatePath = path.join(
        __dirname, 
        '..', 
        '..',
        'app',
        'templates',
        'remitos',
        'template.html'
      );
      
      const pdfBuffer = await convertHtmlToPdf(templatePath, remito);
      const nombreArchivo = `Remito_${remito.numeroRemito}.pdf`;
      
      // Preparar plantilla para el email
      const templateData = {
        clienteNombre: remito.cliente.nombre,
        remitoNumero: remito.numeroRemito,
        remitoFecha: remito.fecha
      };

      // Adjuntos
      const attachments = [
        {
          filename: nombreArchivo,
          content: pdfBuffer,
          contentType: 'application/pdf'
        }
      ];

      // Enviar email
      return await this.sendTemplateEmail({
        to,
        subject: `${this.companyInfo.nombre} - Remito ${remito.numeroRemito}`,
        templateName: 'remito',
        templateData,
        attachments
      });
    } catch (error) {
      logger.error('Error sending remito email:', error);
      return { 
        success: false, 
        message: `Error al enviar remito: ${error.message}`,
        error
      };
    }
  }

  /**
   * Envía una nota de crédito/débito por email
   * @param {Object} options - Opciones para el envío
   * @param {string} options.to - Email del destinatario
   * @param {Object} options.nota - Datos de la nota
   * @param {string} options.tipo - 'credito' o 'debito'
   * @returns {Promise<Object>} - Resultado del envío
   */
  async sendNota({ to, nota, tipo }) {
    try {
      if (!to || !nota || !tipo) {
        return { success: false, message: 'Datos incompletos' };
      }

      // Validar el tipo
      if (tipo !== 'credito' && tipo !== 'debito') {
        return { success: false, message: 'Tipo de nota inválido' };
      }

      // Generar PDF de la nota
      const templatePath = path.join(
        __dirname, 
        '..', 
        '..',
        'app',
        'templates',
        'notas',
        `${tipo}.html`
      );
      
      const pdfBuffer = await convertHtmlToPdf(templatePath, nota);
      const tipoTexto = tipo === 'credito' ? 'Crédito' : 'Débito';
      const nombreArchivo = `Nota_${tipoTexto}_${nota.numeroNota}.pdf`;
      
      // Preparar plantilla para el email
      const templateData = {
        clienteNombre: nota.cliente.nombre,
        notaTipo: tipoTexto,
        notaNumero: nota.numeroNota,
        notaFecha: nota.fecha,
        notaTotal: nota.total,
        facturaReferencia: nota.facturaReferencia
      };

      // Adjuntos
      const attachments = [
        {
          filename: nombreArchivo,
          content: pdfBuffer,
          contentType: 'application/pdf'
        }
      ];

      // Enviar email
      return await this.sendTemplateEmail({
        to,
        subject: `${this.companyInfo.nombre} - Nota de ${tipoTexto} ${nota.numeroNota}`,
        templateName: 'nota',
        templateData,
        attachments
      });
    } catch (error) {
      logger.error('Error sending nota email:', error);
      return { 
        success: false, 
        message: `Error al enviar nota: ${error.message}`,
        error
      };
    }
  }

  /**
   * Envía un reporte por email
   * @param {Object} options - Opciones para el envío
   * @param {string} options.to - Email del destinatario
   * @param {string} options.reportType - Tipo de reporte ('ventas', 'caja', 'stock', etc.)
   * @param {Object} options.reportData - Datos del reporte
   * @param {string} options.subject - Asunto personalizado (opcional)
   * @returns {Promise<Object>} - Resultado del envío
   */
  async sendReport({ to, reportType, reportData, subject }) {
    try {
      if (!to || !reportType || !reportData) {
        return { success: false, message: 'Datos incompletos' };
      }

      // Validar tipo de reporte
      const validReportTypes = ['ventas', 'caja', 'stock', 'compras', 'fiscales'];
      if (!validReportTypes.includes(reportType)) {
        return { success: false, message: 'Tipo de reporte inválido' };
      }

      // Generar PDF del reporte
      const templatePath = path.join(
        __dirname, 
        '..', 
        '..',
        'app',
        'templates',
        'reportes',
        `${reportType}.html`
      );
      
      const pdfBuffer = await convertHtmlToPdf(templatePath, reportData);
      const nombreArchivo = `Reporte_${reportType}_${new Date().toISOString().split('T')[0]}.pdf`;
      
      // Título del reporte para la plantilla
      const reportTitles = {
        ventas: 'Reporte de Ventas',
        caja: 'Reporte de Caja',
        stock: 'Reporte de Stock',
        compras: 'Reporte de Compras',
        fiscales: 'Reporte Fiscal'
      };

      // Preparar plantilla para el email
      const templateData = {
        reporteTitulo: reportTitles[reportType],
        reportePeriodo: reportData.periodo || 'No especificado',
        reporteFecha: new Date().toLocaleDateString()
      };

      // Adjuntos
      const attachments = [
        {
          filename: nombreArchivo,
          content: pdfBuffer,
          contentType: 'application/pdf'
        }
      ];

      // Enviar email
      return await this.sendTemplateEmail({
        to,
        subject: subject || `${this.companyInfo.nombre} - ${reportTitles[reportType]}`,
        templateName: 'reporte',
        templateData,
        attachments
      });
    } catch (error) {
      logger.error('Error sending report email:', error);
      return { 
        success: false, 
        message: `Error al enviar reporte: ${error.message}`,
        error
      };
    }
  }

  /**
   * Envía una notificación personalizada
   * @param {Object} options - Opciones para el envío
   * @param {string} options.to - Email del destinatario
   * @param {string} options.subject - Asunto
   * @param {string} options.message - Mensaje en formato HTML
   * @param {Array} options.attachments - Archivos adjuntos (opcional)
   * @returns {Promise<Object>} - Resultado del envío
   */
  async sendNotification({ to, subject, message, attachments = [] }) {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      if (!this.transporter) {
        return { 
          success: false, 
          message: 'Servicio de email no inicializado correctamente' 
        };
      }

      if (!to || !subject || !message) {
        return { success: false, message: 'Datos incompletos' };
      }

      // Configurar opciones de email
      const mailOptions = {
        from: `"${this.companyInfo.nombre}" <${this.emailConfig.user}>`,
        to,
        subject,
        html: message,
        attachments
      };

      // Enviar el email
      const info = await this.transporter.sendMail(mailOptions);
      logger.info(`Notification email sent successfully to ${to}`, { messageId: info.messageId });
      
      return { 
        success: true, 
        message: 'Notificación enviada correctamente',
        messageId: info.messageId
      };
    } catch (error) {
      logger.error('Error sending notification email:', error);
      return { 
        success: false, 
        message: `Error al enviar notificación: ${error.message}`,
        error
      };
    }
  }
}

// Instancia única para toda la aplicación
const emailSender = new EmailSender();

// Configurar manejadores de eventos IPC para comunicación con el proceso de renderizado
ipcMain.handle('email:initialize', async () => {
  return await emailSender.initialize();
});

ipcMain.handle('email:save-config', async (event, config) => {
  return await emailSender.saveConfig(config);
});

ipcMain.handle('email:verify-connection', async (event, config) => {
  return await emailSender.verifyConnection(config);
});

ipcMain.handle('email:send-factura', async (event, options) => {
  return await emailSender.sendFactura(options);
});

ipcMain.handle('email:send-remito', async (event, options) => {
  return await emailSender.sendRemito(options);
});

ipcMain.handle('email:send-nota', async (event, options) => {
  return await emailSender.sendNota(options);
});

ipcMain.handle('email:send-report', async (event, options) => {
  return await emailSender.sendReport(options);
});

ipcMain.handle('email:send-notification', async (event, options) => {
  return await emailSender.sendNotification(options);
});

// Exportar la instancia
module.exports = emailSender;