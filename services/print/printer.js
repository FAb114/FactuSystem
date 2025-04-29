/**
 * services/print/printer.js
 * Servicio principal de impresión para FactuSystem
 * Maneja la impresión de documentos en diferentes formatos (A4, ticket)
 * y tipos (facturas, remitos, notas de crédito/débito, reportes)
 */

const { BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { ipcMain } = require('electron');
const PDFDocument = require('pdfkit');
const escpos = require('escpos');
// Registrar adaptadores de impresoras
escpos.USB = require('escpos-usb');
escpos.Network = require('escpos-network');
escpos.Serial = require('escpos-serialport');

// Importar servicios relacionados
const pdfService = require('./pdf.js');
const ticketService = require('./ticket.js');
const logger = require('../audit/logger.js');

// Configuración de rutas
const TEMPLATES_DIR = path.join(__dirname, '../../app/templates');

class PrinterService {
  constructor() {
    this.printerConfig = null;
    this.defaultConfig = {
      ticket: {
        enabled: true,
        width: 80, // 58mm o 80mm
        driver: 'default', // 'default', 'usb', 'network', 'serial'
        options: {}
      },
      a4: {
        enabled: true,
        defaultPrinter: '', // Nombre de la impresora predeterminada
        silent: false, // Imprimir sin diálogo
        copies: 1
      },
      previewBeforePrint: true,
      savePdfCopy: true,
      pdfDirectory: path.join(os.homedir(), 'FactuSystem', 'pdf')
    };
    
    // Registro de event listeners
    this.registerEventListeners();
  }

  /**
   * Inicializa el servicio de impresión cargando la configuración
   * @param {Object} config - Configuración guardada en la base de datos
   */
  initialize(config = null) {
    try {
      this.printerConfig = config || this.loadConfigFromDisk() || this.defaultConfig;
      
      // Crear directorio de PDFs si no existe
      if (this.printerConfig.savePdfCopy && this.printerConfig.pdfDirectory) {
        fs.mkdirSync(this.printerConfig.pdfDirectory, { recursive: true });
      }
      
      logger.info('Servicio de impresión inicializado correctamente');
      return true;
    } catch (error) {
      logger.error('Error al inicializar el servicio de impresión', error);
      this.printerConfig = this.defaultConfig;
      return false;
    }
  }

  /**
   * Carga la configuración de impresión desde el disco
   * @returns {Object|null} Configuración de impresión o null si no se encuentra
   */
  loadConfigFromDisk() {
    try {
      const configPath = path.join(__dirname, '../../db/printer-config.json');
      if (fs.existsSync(configPath)) {
        const configData = fs.readFileSync(configPath, 'utf8');
        return JSON.parse(configData);
      }
      return null;
    } catch (error) {
      logger.error('Error al cargar configuración de impresora desde disco', error);
      return null;
    }
  }

  /**
   * Guarda la configuración de impresión en el disco
   * @param {Object} config - Configuración a guardar
   */
  saveConfigToDisk(config) {
    try {
      const configPath = path.join(__dirname, '../../db/printer-config.json');
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
      logger.info('Configuración de impresora guardada correctamente');
      return true;
    } catch (error) {
      logger.error('Error al guardar configuración de impresora', error);
      return false;
    }
  }

  /**
   * Actualiza la configuración de impresión
   * @param {Object} newConfig - Nueva configuración
   */
  updateConfig(newConfig) {
    this.printerConfig = { ...this.printerConfig, ...newConfig };
    this.saveConfigToDisk(this.printerConfig);
    return this.printerConfig;
  }

  /**
   * Registra los event listeners para la comunicación IPC
   */
  registerEventListeners() {
    ipcMain.handle('printer:print', async (event, args) => {
      return await this.printDocument(args.type, args.format, args.data, args.options);
    });
    
    ipcMain.handle('printer:getConfig', () => {
      return this.printerConfig;
    });
    
    ipcMain.handle('printer:updateConfig', (event, config) => {
      return this.updateConfig(config);
    });
    
    ipcMain.handle('printer:getAvailablePrinters', async () => {
      return await this.getAvailablePrinters();
    });
  }

  /**
   * Obtiene la lista de impresoras disponibles en el sistema
   * @returns {Array} Lista de impresoras
   */
  async getAvailablePrinters() {
    try {
      // Para impresoras térmicas/tickets
      const thermalPrinters = await this.getTicketPrinters();
      
      // Para impresoras convencionales (para documentos A4)
      const win = new BrowserWindow({ show: false });
      const systemPrinters = win.webContents.getPrinters();
      win.destroy();
      
      return {
        thermal: thermalPrinters,
        system: systemPrinters
      };
    } catch (error) {
      logger.error('Error al obtener lista de impresoras', error);
      return { thermal: [], system: [] };
    }
  }

  /**
   * Obtiene las impresoras térmicas disponibles
   * @returns {Array} Lista de impresoras térmicas
   */
  async getTicketPrinters() {
    try {
      const printers = [];
      
      // Buscar impresoras USB
      try {
        const usbPrinters = escpos.USB.findPrinter();
        usbPrinters.forEach(printer => {
          printers.push({
            type: 'usb',
            name: `USB: ${printer.deviceDescriptor.iProduct || 'Unknown'}`,
            vendorId: printer.deviceDescriptor.idVendor,
            productId: printer.deviceDescriptor.idProduct
          });
        });
      } catch (err) {
        logger.warn('Error al buscar impresoras USB', err);
      }
      
      // Buscar impresoras de red en IPs comunes
      const networkPrinters = ['192.168.1.100', '192.168.1.101', '192.168.0.100'];
      networkPrinters.forEach(ip => {
        printers.push({
          type: 'network',
          name: `Network: ${ip}`,
          address: ip,
          port: 9100
        });
      });
      
      // Buscar puertos seriales
      if (os.platform() === 'win32') {
        try {
          const { execSync } = require('child_process');
          const output = execSync('wmic path Win32_PnPEntity WHERE "Caption LIKE \'%(COM%\'" GET Caption,DeviceID /FORMAT:CSV').toString();
          const lines = output.split('\n').filter(Boolean);
          if (lines.length > 1) {
            for (let i = 1; i < lines.length; i++) {
              const parts = lines[i].split(',');
              if (parts.length >= 2) {
                const caption = parts[1].trim();
                const match = caption.match(/\(COM(\d+)\)/);
                if (match) {
                  const port = `COM${match[1]}`;
                  printers.push({
                    type: 'serial',
                    name: `Serial: ${caption}`,
                    port: port,
                    baudRate: 9600
                  });
                }
              }
            }
          }
        } catch (err) {
          logger.warn('Error al buscar puertos seriales', err);
        }
      }
      
      return printers;
    } catch (error) {
      logger.error('Error al buscar impresoras térmicas', error);
      return [];
    }
  }

  /**
   * Método principal para imprimir documentos
   * @param {string} type - Tipo de documento (factura, remito, nota, reporte)
   * @param {string} format - Formato (a4, ticket)
   * @param {Object} data - Datos para el documento
   * @param {Object} options - Opciones de impresión
   * @returns {Object} Resultado de la operación
   */
  async printDocument(type, format, data, options = {}) {
    try {
      logger.info(`Iniciando impresión de ${type} en formato ${format}`);
      
      // Combinar opciones con configuración predeterminada
      const mergedOptions = {
        ...this.printerConfig[format],
        ...options
      };
      
      // Validar que la impresión en este formato esté habilitada
      if (!this.printerConfig[format].enabled) {
        throw new Error(`La impresión en formato ${format} está deshabilitada`);
      }
      
      // Generar documento según tipo y formato
      let documentPath = null;
      let documentContent = null;
      
      if (format === 'a4') {
        documentPath = await this.generateA4Document(type, data);
      } else if (format === 'ticket') {
        documentContent = await this.generateTicketDocument(type, data);
      } else {
        throw new Error(`Formato de impresión no soportado: ${format}`);
      }
      
      // Imprimir el documento
      let result = null;
      if (format === 'a4') {
        result = await this.printA4Document(documentPath, mergedOptions);
      } else {
        result = await this.printTicketDocument(documentContent, mergedOptions);
      }
      
      // Registrar el evento de impresión
      logger.info(`Impresión completada: ${type} - ${format}`, {
        documentType: type,
        format,
        success: true,
        documentId: data.id || null
      });
      
      return {
        success: true,
        message: `Documento ${type} impreso correctamente en formato ${format}`,
        documentPath: documentPath
      };
    } catch (error) {
      logger.error(`Error al imprimir documento ${type} en formato ${format}`, error);
      return {
        success: false,
        message: `Error al imprimir: ${error.message}`,
        error: error.message
      };
    }
  }

  /**
   * Genera un documento A4 basado en el tipo y los datos
   * @param {string} type - Tipo de documento
   * @param {Object} data - Datos para el documento
   * @returns {string} Ruta al PDF generado
   */
  async generateA4Document(type, data) {
    try {
      // Determinar la plantilla HTML según el tipo de documento
      let templatePath = '';
      switch (type) {
        case 'factura':
          templatePath = path.join(TEMPLATES_DIR, 'facturas', 'a4.html');
          break;
        case 'remito':
          templatePath = path.join(TEMPLATES_DIR, 'remitos', 'template.html');
          break;
        case 'notaCredito':
          templatePath = path.join(TEMPLATES_DIR, 'notas', 'credito.html');
          break;
        case 'notaDebito':
          templatePath = path.join(TEMPLATES_DIR, 'notas', 'debito.html');
          break;
        case 'reporte':
          templatePath = path.join(TEMPLATES_DIR, 'reportes', `${data.reportType || 'ventas'}.html`);
          break;
        default:
          throw new Error(`Tipo de documento no soportado: ${type}`);
      }
      
      // Verificar si la plantilla existe
      if (!fs.existsSync(templatePath)) {
        throw new Error(`Plantilla no encontrada: ${templatePath}`);
      }
      
      // Generar el PDF con el servicio PDF
      const fileName = `${type}_${data.id || Date.now()}.pdf`;
      const outputPath = path.join(this.printerConfig.pdfDirectory, fileName);
      
      await pdfService.generateFromTemplate(templatePath, data, outputPath);
      return outputPath;
    } catch (error) {
      logger.error(`Error al generar documento A4 de tipo ${type}`, error);
      throw error;
    }
  }

  /**
   * Genera un documento de ticket basado en el tipo y los datos
   * @param {string} type - Tipo de documento
   * @param {Object} data - Datos para el documento
   * @returns {string} Contenido del ticket en formato ESC/POS
   */
  async generateTicketDocument(type, data) {
    try {
      // Utilizar el servicio de tickets para generar el contenido
      const ticketData = await ticketService.generateTicket(type, data);
      return ticketData;
    } catch (error) {
      logger.error(`Error al generar ticket de tipo ${type}`, error);
      throw error;
    }
  }

  /**
   * Imprime un documento A4 (PDF)
   * @param {string} documentPath - Ruta al PDF
   * @param {Object} options - Opciones de impresión
   * @returns {Object} Resultado de la impresión
   */
  async printA4Document(documentPath, options) {
    return new Promise((resolve, reject) => {
      try {
        // Verificar que el archivo exista
        if (!fs.existsSync(documentPath)) {
          throw new Error(`Archivo no encontrado: ${documentPath}`);
        }
        
        // Si se requiere mostrar vista previa
        if (options.previewBeforePrint || this.printerConfig.previewBeforePrint) {
          this.showPdfPreview(documentPath)
            .then(result => resolve(result))
            .catch(err => reject(err));
          return;
        }
        
        // Impresión silenciosa directa
        const win = new BrowserWindow({
          show: false,
          webPreferences: {
            nodeIntegration: false
          }
        });
        
        win.loadURL(`file://${documentPath}`);
        
        win.webContents.on('did-finish-load', () => {
          const printerName = options.defaultPrinter || '';
          const silent = options.silent !== undefined ? options.silent : this.printerConfig.a4.silent;
          const copies = options.copies || this.printerConfig.a4.copies || 1;
          
          win.webContents.print({
            silent: silent,
            printBackground: true,
            deviceName: printerName,
            copies: copies,
            margins: {
              marginType: 'custom',
              top: 0,
              bottom: 0,
              left: 0,
              right: 0
            }
          }, (success, errorType) => {
            // Cerrar la ventana oculta
            win.destroy();
            
            if (success) {
              resolve({ success: true });
            } else {
              reject(new Error(`Error de impresión: ${errorType}`));
            }
          });
        });
        
        win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
          win.destroy();
          reject(new Error(`Error al cargar PDF: ${errorDescription}`));
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Imprime un documento de ticket usando una impresora térmica
   * @param {string} content - Contenido del ticket en formato ESC/POS
   * @param {Object} options - Opciones de impresión
   * @returns {Object} Resultado de la impresión
   */
  async printTicketDocument(content, options) {
    return new Promise((resolve, reject) => {
      try {
        const driverType = options.driver || this.printerConfig.ticket.driver;
        let device;
        
        // Configurar el dispositivo según el tipo de conexión
        switch (driverType) {
          case 'usb':
            device = new escpos.USB(
              options.vendorId || this.printerConfig.ticket.options.vendorId,
              options.productId || this.printerConfig.ticket.options.productId
            );
            break;
          case 'network':
            device = new escpos.Network(
              options.address || this.printerConfig.ticket.options.address,
              options.port || this.printerConfig.ticket.options.port
            );
            break;
          case 'serial':
            device = new escpos.Serial(
              options.port || this.printerConfig.ticket.options.port,
              {
                baudRate: options.baudRate || this.printerConfig.ticket.options.baudRate
              }
            );
            break;
          case 'default':
          default:
            // Si no hay una impresora configurada, mostrar el contenido en una ventana
            this.showTicketPreview(content)
              .then(result => resolve(result))
              .catch(err => reject(err));
            return;
        }
        
        // Crear impresora y enviar el contenido
        const printer = new escpos.Printer(device);
        
        device.open(err => {
          if (err) {
            reject(new Error(`Error al conectar con la impresora: ${err.message}`));
            return;
          }
          
          try {
            // Imprimir el contenido
            printer
              .align('ct')
              .raw(content)
              .cut()
              .close(() => {
                resolve({ success: true });
              });
          } catch (printError) {
            device.close();
            reject(new Error(`Error al imprimir ticket: ${printError.message}`));
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Muestra una vista previa del PDF
   * @param {string} pdfPath - Ruta al PDF
   * @returns {Promise} Resolución de la impresión
   */
  showPdfPreview(pdfPath) {
    return new Promise((resolve, reject) => {
      try {
        const win = new BrowserWindow({
          width: 800,
          height: 1000,
          title: 'Vista previa de impresión',
          webPreferences: {
            nodeIntegration: false
          }
        });
        
        win.loadURL(`file://${pdfPath}`);
        
        const printMenuTemplate = [
          {
            label: 'Archivo',
            submenu: [
              {
                label: 'Imprimir',
                accelerator: 'CmdOrCtrl+P',
                click: () => {
                  win.webContents.print({}, (success, errorType) => {
                    if (success) {
                      win.close();
                      resolve({ success: true });
                    } else {
                      reject(new Error(`Error de impresión: ${errorType}`));
                    }
                  });
                }
              },
              {
                label: 'Cerrar',
                accelerator: 'CmdOrCtrl+W',
                click: () => {
                  win.close();
                  resolve({ success: false, cancelled: true });
                }
              }
            ]
          }
        ];
        
        const printMenu = require('electron').Menu.buildFromTemplate(printMenuTemplate);
        win.setMenu(printMenu);
        
        win.on('closed', () => {
          resolve({ success: false, cancelled: true });
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Muestra una vista previa del ticket
   * @param {string} content - Contenido del ticket
   * @returns {Promise} Resolución de la previsualización
   */
  showTicketPreview(content) {
    return new Promise((resolve, reject) => {
      try {
        // Crear HTML para mostrar el contenido del ticket
        const ticketHtml = `
          <!DOCTYPE html>
          <html>
          <head>
            <title>Vista previa de ticket</title>
            <style>
              body {
                font-family: monospace;
                background-color: #f0f0f0;
                display: flex;
                justify-content: center;
                padding: 20px;
              }
              .ticket {
                width: 302px; /* 80mm a ~96dpi */
                background-color: white;
                padding: 10px;
                box-shadow: 0 2px 5px rgba(0,0,0,0.2);
                white-space: pre;
                font-size: 9pt;
              }
              .buttons {
                text-align: center;
                margin-top: 20px;
              }
              button {
                padding: 8px 15px;
                margin: 0 10px;
                cursor: pointer;
              }
            </style>
          </head>
          <body>
            <div>
              <div class="ticket">${content.replace(/\n/g, '<br>').replace(/ /g, '&nbsp;')}</div>
              <div class="buttons">
                <button id="print">Imprimir</button>
                <button id="cancel">Cancelar</button>
              </div>
            </div>
            <script>
              document.getElementById('print').addEventListener('click', () => {
                window.print();
                window.close();
              });
              document.getElementById('cancel').addEventListener('click', () => {
                window.close();
              });
            </script>
          </body>
          </html>
        `;
        
        // Guardar HTML temporalmente
        const tempHtmlPath = path.join(os.tmpdir(), `ticket_${Date.now()}.html`);
        fs.writeFileSync(tempHtmlPath, ticketHtml, 'utf8');
        
        // Mostrar ventana con vista previa
        const win = new BrowserWindow({
          width: 400,
          height: 600,
          title: 'Vista previa de ticket',
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
          }
        });
        
        win.loadURL(`file://${tempHtmlPath}`);
        win.setMenu(null);
        
        win.on('closed', () => {
          // Eliminar el archivo temporal
          try {
            fs.unlinkSync(tempHtmlPath);
          } catch (e) {
            logger.warn('No se pudo eliminar el archivo temporal', e);
          }
          resolve({ success: false, cancelled: true });
        });
        
        // Manejar la impresión
        win.webContents.on('did-finish-load', () => {
          win.webContents.on('will-print', () => {
            win.webContents.insertCSS(`
              @media print {
                body { margin: 0; padding: 0; }
                .ticket { box-shadow: none; width: 100%; }
                .buttons { display: none; }
              }
            `);
          });
          
          win.webContents.on('did-print', () => {
            setTimeout(() => {
              win.close();
              resolve({ success: true });
            }, 1000);
          });
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Verifica el estado de las impresoras configuradas
   * @returns {Object} Estado de las impresoras
   */
  async checkPrinterStatus() {
    try {
      const status = {
        a4: { ready: false, message: '' },
        ticket: { ready: false, message: '' }
      };
      
      // Verificar impresora A4
      if (this.printerConfig.a4.enabled) {
        const win = new BrowserWindow({ show: false });
        const printers = win.webContents.getPrinters();
        win.destroy();
        
        const defaultPrinter = this.printerConfig.a4.defaultPrinter;
        if (!defaultPrinter) {
          status.a4 = { ready: true, message: 'Se usará la impresora predeterminada del sistema' };
        } else {
          const printerFound = printers.find(p => p.name === defaultPrinter);
          if (printerFound) {
            status.a4 = { ready: true, message: `Impresora "${defaultPrinter}" encontrada` };
          } else {
            status.a4 = { ready: false, message: `Impresora "${defaultPrinter}" no encontrada` };
          }
        }
      } else {
        status.a4 = { ready: false, message: 'Impresión A4 deshabilitada' };
      }
      
      // Verificar impresora de tickets
      if (this.printerConfig.ticket.enabled) {
        const driverType = this.printerConfig.ticket.driver;
        
        if (driverType === 'default') {
          status.ticket = { ready: true, message: 'Modo vista previa activo para tickets' };
        } else {
          try {
            // Intentar verificar la conexión con la impresora de tickets
            let connected = false;
            let message = '';
            
            switch (driverType) {
              case 'usb':
                const usbPrinters = escpos.USB.findPrinter();
                const vendorId = this.printerConfig.ticket.options.vendorId;
                const productId = this.printerConfig.ticket.options.productId;
                connected = usbPrinters.some(p => 
                  p.deviceDescriptor.idVendor === vendorId && 
                  p.deviceDescriptor.idProduct === productId
                );
                message = connected ? 
                  `Impresora USB detectada (VID:${vendorId}, PID:${productId})` : 
                  `Impresora USB no encontrada (VID:${vendorId}, PID:${productId})`;
                break;
              
              case 'network':
                const { address, port } = this.printerConfig.ticket.options;
                const net = require('net');
                const socket = new net.Socket();
                
                connected = await new Promise(resolve => {
                  socket.setTimeout(2000);
                  socket.on('connect', () => {
                    socket.destroy();
                    resolve(true);
                  });
                  socket.on('error', () => resolve(false));
                  socket.on('timeout', () => resolve(false));
                  socket.connect(port, address);
                });
                
                message = connected ? 
                  `Impresora de red conectada (${address}:${port})` : 
                  `No se puede conectar a la impresora de red (${address}:${port})`;
                break;
              
              case 'serial':
                message = `Puerto serial configurado (${this.printerConfig.ticket.options.port})`;
                connected = true;  // No podemos verificar fácilmente la conexión serial
                break;
            }
            
            status.ticket = { ready: connected, message };
          } catch (error) {
            status.ticket = { ready: false, message: `Error al verificar impresora: ${error.message}` };
          }
        }
      } else {
        status.ticket = { ready: false, message: 'Impresión de tickets deshabilitada' };
      }
      
      return status;
    } catch (error) {
      logger.error('Error al verificar estado de impresoras', error);
      return {
        a4: { ready: false, message: `Error: ${error.message}` },
        ticket: { ready: false, message: `Error: ${error.message}` }
      };
    }
  }
}

// Exportar instancia singleton
const printerService = new PrinterService();
module.exports = printerService;