/**
 * FactuSystem - Servicio de impresión de tickets
 * Archivo: services/print/ticket.js
 * 
 * Este servicio maneja la generación e impresión de tickets de venta
 * para impresoras térmicas de 58mm o similar.
 */

const { BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { ipcMain } = require('electron');

// Importaciones de servicios y utilidades
const database = require('../../app/assets/js/utils/database.js');
const logger = require('../../app/assets/js/utils/logger.js');
const { getEmpresaInfo } = require('../../app/assets/js/modules/configuraciones/empresa.js');

class TicketPrinter {
  constructor() {
    this.printerWindow = null;
    this.tempDir = path.join(os.tmpdir(), 'factusystem-tickets');
    this.setupTempDirectory();
    this.setupIpcListeners();
  }

  /**
   * Configura el directorio temporal para almacenar los tickets generados
   */
  setupTempDirectory() {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * Configura los listeners para comunicación entre procesos
   */
  setupIpcListeners() {
    ipcMain.handle('print-ticket', async (event, ticketData) => {
      try {
        const result = await this.printTicket(ticketData);
        return { success: true, message: 'Ticket impreso correctamente', result };
      } catch (error) {
        logger.error('Error al imprimir ticket', { error: error.message, ticketData });
        return { success: false, message: `Error al imprimir: ${error.message}` };
      }
    });

    ipcMain.handle('preview-ticket', async (event, ticketData) => {
      try {
        const ticketHtml = await this.generateTicketHtml(ticketData);
        const previewPath = path.join(this.tempDir, `preview_${Date.now()}.html`);
        fs.writeFileSync(previewPath, ticketHtml);
        return { success: true, previewPath };
      } catch (error) {
        logger.error('Error al generar vista previa del ticket', { error: error.message });
        return { success: false, message: `Error en vista previa: ${error.message}` };
      }
    });
  }

  /**
   * Genera el HTML para un ticket de venta
   * @param {Object} ticketData Datos del ticket a imprimir
   * @returns {Promise<String>} HTML del ticket
   */
  async generateTicketHtml(ticketData) {
    try {
      const empresa = await getEmpresaInfo();
      const templatePath = path.join(__dirname, '../../app/templates/facturas/ticket.html');
      let ticketTemplate = fs.readFileSync(templatePath, 'utf8');

      // Reemplazar variables en la plantilla
      ticketTemplate = ticketTemplate
        .replace(/{{empresa_nombre}}/g, empresa.nombre)
        .replace(/{{empresa_direccion}}/g, empresa.direccion)
        .replace(/{{empresa_cuit}}/g, empresa.cuit)
        .replace(/{{empresa_iva}}/g, empresa.condicionIva)
        .replace(/{{empresa_telefono}}/g, empresa.telefono)
        .replace(/{{sucursal_nombre}}/g, ticketData.sucursal?.nombre || 'Central')
        .replace(/{{comprobante_tipo}}/g, ticketData.tipoComprobante)
        .replace(/{{comprobante_numero}}/g, ticketData.numeroComprobante)
        .replace(/{{fecha}}/g, this.formatDate(ticketData.fecha))
        .replace(/{{hora}}/g, this.formatTime(ticketData.fecha))
        .replace(/{{cliente_nombre}}/g, ticketData.cliente?.nombre || 'Consumidor Final')
        .replace(/{{cliente_documento}}/g, ticketData.cliente?.documento || '')
        .replace(/{{vendedor}}/g, ticketData.usuario?.nombre || 'Sistema');

      // Generar las filas de productos
      let productosHtml = '';
      ticketData.items.forEach(item => {
        productosHtml += `
          <tr>
            <td colspan="3">${item.nombre}</td>
          </tr>
          <tr>
            <td>${item.cantidad} x ${this.formatCurrency(item.precioUnitario)}</td>
            <td></td>
            <td class="text-right">${this.formatCurrency(item.subtotal)}</td>
          </tr>
        `;
      });
      ticketTemplate = ticketTemplate.replace('{{productos}}', productosHtml);

      // Totales
      ticketTemplate = ticketTemplate
        .replace(/{{subtotal}}/g, this.formatCurrency(ticketData.subtotal))
        .replace(/{{descuento_valor}}/g, this.formatCurrency(ticketData.descuento || 0))
        .replace(/{{descuento_porcentaje}}/g, ticketData.descuentoPorcentaje ? `(${ticketData.descuentoPorcentaje}%)` : '')
        .replace(/{{iva_valor}}/g, this.formatCurrency(ticketData.iva || 0))
        .replace(/{{total}}/g, this.formatCurrency(ticketData.total));
      
      // Método de pago
      let metodoPagoInfo = '';
      if (ticketData.metodoPago) {
        metodoPagoInfo = `<p>Forma de pago: ${ticketData.metodoPago.tipo}`;
        if (ticketData.metodoPago.detalles) {
          metodoPagoInfo += ` - ${ticketData.metodoPago.detalles}`;
        }
        metodoPagoInfo += '</p>';
      }
      ticketTemplate = ticketTemplate.replace('{{metodo_pago}}', metodoPagoInfo);

      // Pie del ticket
      if (empresa.mensajeTicket) {
        ticketTemplate = ticketTemplate.replace('{{mensaje_pie}}', `<p>${empresa.mensajeTicket}</p>`);
      } else {
        ticketTemplate = ticketTemplate.replace('{{mensaje_pie}}', '<p>¡Gracias por su compra!</p>');
      }

      // Agregar código QR si es factura electrónica
      if (ticketData.afipData && ticketData.afipData.cae) {
        const qrData = {
          ver: 1,
          fecha: this.formatDateForQR(ticketData.fecha),
          cuit: empresa.cuit.replace(/\D/g, ''),
          ptoVta: ticketData.puntoVenta,
          tipoCmp: this.getTipoComprobanteAFIP(ticketData.tipoComprobante),
          nroCmp: ticketData.numeroComprobante,
          importe: ticketData.total,
          moneda: "PES",
          ctz: 1,
          tipoDocRec: ticketData.cliente?.tipoDocumento || 99,
          nroDocRec: ticketData.cliente?.documento?.replace(/\D/g, '') || 0,
          tipoCodAut: "E",
          codAut: ticketData.afipData.cae
        };
        
        const qrUrl = `https://www.afip.gob.ar/fe/qr/?p=${Buffer.from(JSON.stringify(qrData)).toString('base64')}`;
        ticketTemplate = ticketTemplate.replace('{{qr_afip}}', `
          <div class="qr-container">
            <img src="${qrUrl}" alt="QR AFIP" class="qr-code">
            <p>CAE: ${ticketData.afipData.cae}</p>
            <p>Vencimiento: ${this.formatDate(ticketData.afipData.vencimientoCae)}</p>
          </div>
        `);
      } else {
        ticketTemplate = ticketTemplate.replace('{{qr_afip}}', '');
      }

      return ticketTemplate;
    } catch (error) {
      logger.error('Error generando HTML del ticket', { error: error.message });
      throw new Error(`Error al generar HTML del ticket: ${error.message}`);
    }
  }

  /**
   * Imprime un ticket
   * @param {Object} ticketData Datos del ticket a imprimir
   * @returns {Promise<Object>} Resultado de la impresión
   */
  async printTicket(ticketData) {
    try {
      // Generar el HTML del ticket
      const ticketHtml = await this.generateTicketHtml(ticketData);
      
      // Guardar el HTML en un archivo temporal
      const tempFilePath = path.join(this.tempDir, `ticket_${Date.now()}.html`);
      fs.writeFileSync(tempFilePath, ticketHtml);

      // Crear una ventana oculta para imprimir
      if (this.printerWindow) {
        this.printerWindow.close();
      }

      this.printerWindow = new BrowserWindow({
        width: 300,
        height: 600,
        show: false,
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false
        }
      });

      // Cargar el archivo HTML del ticket
      await this.printerWindow.loadFile(tempFilePath);

      // Obtener las opciones de impresión desde la configuración
      const printerOptions = await this.getPrinterOptions();

      // Imprimir el ticket
      const result = await this.printerWindow.webContents.print(printerOptions, (success, errorType) => {
        if (!success) {
          logger.error('Error en la impresión del ticket', { errorType });
          throw new Error(`Error de impresión: ${errorType}`);
        }
      });

      // Registrar en el log la impresión exitosa
      logger.info('Ticket impreso correctamente', { 
        comprobante: ticketData.numeroComprobante,
        cliente: ticketData.cliente?.nombre || 'Consumidor Final',
        total: ticketData.total
      });

      // Cerrar la ventana de impresión
      if (this.printerWindow) {
        this.printerWindow.close();
        this.printerWindow = null;
      }

      return { success: true, filePath: tempFilePath };
    } catch (error) {
      logger.error('Error al imprimir ticket', { error: error.message });
      throw new Error(`Error al imprimir ticket: ${error.message}`);
    }
  }

  /**
   * Obtiene las opciones de impresión desde la configuración
   * @returns {Promise<Object>} Opciones de impresión
   */
  async getPrinterOptions() {
    try {
      // Obtener configuración de impresora desde la base de datos
      const db = await database.getConnection();
      const configQuery = await db.get(
        "SELECT valor FROM configuraciones WHERE clave = 'impresora_ticket'"
      );
      
      let printerConfig = {};
      if (configQuery?.valor) {
        printerConfig = JSON.parse(configQuery.valor);
      }

      // Opciones por defecto para tickets de 58mm
      const defaultOptions = {
        silent: true,
        printBackground: true,
        deviceName: printerConfig.nombre || '',
        color: false,
        margin: {
          marginType: 'custom',
          top: 0,
          bottom: 0,
          left: 0,
          right: 0
        },
        landscape: false,
        scaleFactor: 1.0,
        pagesPerSheet: 1,
        collate: false,
        copies: 1,
        pageSize: { width: 58000, height: 'auto' }, // Ancho en micrones (58mm)
        duplexMode: 'simplex',
        dpi: { horizontal: 203, vertical: 203 } // Resolución común para impresoras térmicas
      };

      // Sobreescribir con configuraciones personalizadas
      return {
        ...defaultOptions,
        ...(printerConfig.opciones || {})
      };
    } catch (error) {
      logger.error('Error al obtener opciones de impresora', { error: error.message });
      // Si hay un error, devolver opciones por defecto
      return {
        silent: true,
        printBackground: true,
        color: false,
        margin: {
          marginType: 'custom',
          top: 0,
          bottom: 0,
          left: 0,
          right: 0
        },
        pageSize: { width: 58000, height: 'auto' }
      };
    }
  }

  /**
   * Devuelve el código AFIP del tipo de comprobante
   * @param {String} tipoComprobante Tipo de comprobante (Factura A, B, C, etc)
   * @returns {Number} Código AFIP del tipo de comprobante
   */
  getTipoComprobanteAFIP(tipoComprobante) {
    const tipos = {
      'Factura A': 1,
      'Factura B': 6,
      'Factura C': 11,
      'Nota de Crédito A': 3,
      'Nota de Crédito B': 8,
      'Nota de Crédito C': 13,
      'Nota de Débito A': 2,
      'Nota de Débito B': 7,
      'Nota de Débito C': 12
    };
    return tipos[tipoComprobante] || 0;
  }

  /**
   * Formatea un valor monetario para mostrarlo en el ticket
   * @param {Number} amount Monto a formatear
   * @returns {String} Monto formateado
   */
  formatCurrency(amount) {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      minimumFractionDigits: 2
    }).format(amount || 0);
  }

  /**
   * Formatea una fecha para mostrarla en el ticket
   * @param {Date|String} date Fecha a formatear
   * @returns {String} Fecha formateada (DD/MM/YYYY)
   */
  formatDate(date) {
    const d = new Date(date);
    return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
  }

  /**
   * Formatea la hora para mostrarla en el ticket
   * @param {Date|String} date Fecha/hora a formatear
   * @returns {String} Hora formateada (HH:MM)
   */
  formatTime(date) {
    const d = new Date(date);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  }

  /**
   * Formatea la fecha para el código QR de AFIP
   * @param {Date|String} date Fecha a formatear
   * @returns {String} Fecha formateada (YYYYMMDD)
   */
  formatDateForQR(date) {
    const d = new Date(date);
    return `${d.getFullYear()}${(d.getMonth() + 1).toString().padStart(2, '0')}${d.getDate().toString().padStart(2, '0')}`;
  }

  /**
   * Limpia el directorio temporal
   * Borra archivos temporales con más de un día de antigüedad
   */
  cleanupTempFiles() {
    try {
      const files = fs.readdirSync(this.tempDir);
      const now = new Date().getTime();
      const oneDayMs = 24 * 60 * 60 * 1000; // 24 horas en milisegundos
      
      files.forEach(file => {
        const filePath = path.join(this.tempDir, file);
        const stats = fs.statSync(filePath);
        const fileAge = now - stats.mtime.getTime();
        
        if (fileAge > oneDayMs) {
          fs.unlinkSync(filePath);
          logger.debug('Archivo temporal eliminado', { file: filePath });
        }
      });
    } catch (error) {
      logger.error('Error al limpiar archivos temporales', { error: error.message });
    }
  }
}

// Crear una instancia única del servicio de impresión de tickets
const ticketPrinter = new TicketPrinter();

// Configurar limpieza automática de archivos temporales (cada 24 horas)
setInterval(() => {
  ticketPrinter.cleanupTempFiles();
}, 24 * 60 * 60 * 1000);

module.exports = ticketPrinter;