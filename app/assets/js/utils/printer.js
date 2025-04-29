/**
 * printer.js - Sistema de impresión para FactuSystem
 * 
 * Este módulo gestiona todas las funcionalidades relacionadas con la impresión
 * de documentos como facturas, remitos, notas de crédito/débito, reportes, etc.
 * Se integra con el sistema de templates, gestión de impresoras y generación de PDFs.
 */

// Importaciones necesarias
const { ipcRenderer } = require('electron');
const database = require('./database.js');
const logger = require('./logger.js');
const auth = require('./auth.js');

// Importar servicios de impresión del proceso principal
const printerService = window.electronAPI.printerService;

class PrinterManager {
    constructor() {
        this.printers = [];
        this.defaultPrinter = null;
        this.settings = null;
        this.templates = {
            facturas: {
                a4: null,
                ticket: null
            },
            remitos: {
                default: null
            },
            notas: {
                credito: null,
                debito: null
            },
            reportes: {
                ventas: null,
                caja: null,
                stock: null
            }
        };
        
        this.init();
    }

    /**
     * Inicializa el sistema de impresión
     */
    async init() {
        try {
            // Cargar lista de impresoras disponibles
            this.printers = await printerService.getPrinters();
            
            // Cargar configuraciones de impresión
            this.settings = await this.loadPrinterSettings();
            
            // Establecer impresora predeterminada
            this.defaultPrinter = this.settings.defaultPrinter || (this.printers.length > 0 ? this.printers[0].name : null);
            
            // Cargar templates
            await this.loadTemplates();
            
            logger.info('PrinterManager: Sistema de impresión inicializado correctamente');
        } catch (error) {
            logger.error('PrinterManager: Error al inicializar el sistema de impresión', error);
            throw new Error('No se pudo inicializar el sistema de impresión');
        }
    }

    /**
     * Carga las configuraciones de impresión desde la base de datos
     */
    async loadPrinterSettings() {
        try {
            const settings = await database.get('configuraciones', 'impresion');
            return settings || {
                defaultPrinter: null,
                ticketPrinter: null,
                a4Printer: null,
                autoprint: true,
                copies: {
                    facturaA: 2,
                    facturaB: 2,
                    facturaC: 2,
                    remito: 1,
                    notaCredito: 1,
                    notaDebito: 1
                },
                margins: {
                    top: 10,
                    right: 10,
                    bottom: 10,
                    left: 10
                },
                paperSize: 'A4',
                defaultFormat: 'A4', // 'A4' o 'ticket'
                showPrintDialog: false,
                logoEnabled: true
            };
        } catch (error) {
            logger.error('PrinterManager: Error al cargar configuraciones de impresión', error);
            return {
                defaultPrinter: null,
                ticketPrinter: null,
                a4Printer: null,
                autoprint: true,
                copies: {
                    facturaA: 2,
                    facturaB: 2,
                    facturaC: 2,
                    remito: 1,
                    notaCredito: 1,
                    notaDebito: 1
                },
                margins: {
                    top: 10,
                    right: 10,
                    bottom: 10,
                    left: 10
                },
                paperSize: 'A4',
                defaultFormat: 'A4',
                showPrintDialog: false,
                logoEnabled: true
            };
        }
    }

    /**
     * Carga todas las plantillas HTML desde los archivos
     */
    async loadTemplates() {
        try {
            // Cargar plantillas de facturas
            this.templates.facturas.a4 = await fetch('/templates/facturas/a4.html').then(res => res.text());
            this.templates.facturas.ticket = await fetch('/templates/facturas/ticket.html').then(res => res.text());
            
            // Cargar plantillas de remitos
            this.templates.remitos.default = await fetch('/templates/remitos/template.html').then(res => res.text());
            
            // Cargar plantillas de notas de crédito/débito
            this.templates.notas.credito = await fetch('/templates/notas/credito.html').then(res => res.text());
            this.templates.notas.debito = await fetch('/templates/notas/debito.html').then(res => res.text());
            
            // Cargar plantillas de reportes
            this.templates.reportes.ventas = await fetch('/templates/reportes/ventas.html').then(res => res.text());
            this.templates.reportes.caja = await fetch('/templates/reportes/caja.html').then(res => res.text());
            this.templates.reportes.stock = await fetch('/templates/reportes/stock.html').then(res => res.text());
            
            logger.info('PrinterManager: Plantillas cargadas correctamente');
        } catch (error) {
            logger.error('PrinterManager: Error al cargar plantillas', error);
            throw new Error('No se pudieron cargar las plantillas de impresión');
        }
    }

    /**
     * Guarda las configuraciones de impresión en la base de datos
     * @param {Object} settings - Configuraciones a guardar
     */
    async saveSettings(settings) {
        try {
            this.settings = {...this.settings, ...settings};
            await database.update('configuraciones', 'impresion', this.settings);
            logger.info('PrinterManager: Configuraciones de impresión actualizadas');
            return true;
        } catch (error) {
            logger.error('PrinterManager: Error al guardar configuraciones de impresión', error);
            throw new Error('No se pudieron guardar las configuraciones de impresión');
        }
    }

    /**
     * Obtiene la lista de impresoras disponibles
     * @returns {Array} Lista de impresoras
     */
    getPrinters() {
        return this.printers;
    }

    /**
     * Configura la impresora predeterminada
     * @param {string} printerName - Nombre de la impresora
     */
    async setDefaultPrinter(printerName) {
        if (!this.printers.some(p => p.name === printerName)) {
            throw new Error(`La impresora "${printerName}" no está disponible`);
        }
        
        this.defaultPrinter = printerName;
        this.settings.defaultPrinter = printerName;
        await this.saveSettings(this.settings);
    }

    /**
     * Configura la impresora para tickets
     * @param {string} printerName - Nombre de la impresora
     */
    async setTicketPrinter(printerName) {
        if (!this.printers.some(p => p.name === printerName)) {
            throw new Error(`La impresora "${printerName}" no está disponible`);
        }
        
        this.settings.ticketPrinter = printerName;
        await this.saveSettings(this.settings);
    }

    /**
     * Configura la impresora para documentos A4
     * @param {string} printerName - Nombre de la impresora
     */
    async setA4Printer(printerName) {
        if (!this.printers.some(p => p.name === printerName)) {
            throw new Error(`La impresora "${printerName}" no está disponible`);
        }
        
        this.settings.a4Printer = printerName;
        await this.saveSettings(this.settings);
    }

    /**
     * Compila una plantilla con los datos proporcionados
     * @param {string} template - Plantilla HTML
     * @param {Object} data - Datos para rellenar la plantilla
     * @returns {string} HTML compilado
     */
    compileTemplate(template, data) {
        if (!template) {
            throw new Error('La plantilla no está disponible');
        }
        
        let compiledTemplate = template;
        
        // Reemplazar variables simples
        for (const key in data) {
            if (typeof data[key] === 'string' || typeof data[key] === 'number') {
                const regex = new RegExp(`{{${key}}}`, 'g');
                compiledTemplate = compiledTemplate.replace(regex, data[key]);
            }
        }
        
        // Procesar información de empresa
        if (data.empresa) {
            for (const key in data.empresa) {
                const regex = new RegExp(`{{empresa.${key}}}`, 'g');
                compiledTemplate = compiledTemplate.replace(regex, data.empresa[key]);
            }
        }
        
        // Procesar información de cliente
        if (data.cliente) {
            for (const key in data.cliente) {
                const regex = new RegExp(`{{cliente.${key}}}`, 'g');
                compiledTemplate = compiledTemplate.replace(regex, data.cliente[key]);
            }
        }
        
        // Procesar array de productos
        if (data.productos && Array.isArray(data.productos)) {
            let productosHTML = '';
            const productoStartRegex = /<!--PRODUCTO_START-->([\s\S]*?)<!--PRODUCTO_END-->/;
            const productoMatch = productoStartRegex.exec(compiledTemplate);
            
            if (productoMatch && productoMatch[1]) {
                const productoTemplate = productoMatch[1];
                
                data.productos.forEach(producto => {
                    let productoHTML = productoTemplate;
                    for (const key in producto) {
                        const regex = new RegExp(`{{producto.${key}}}`, 'g');
                        productoHTML = productoHTML.replace(regex, producto[key]);
                    }
                    productosHTML += productoHTML;
                });
                
                compiledTemplate = compiledTemplate.replace(
                    /<!--PRODUCTO_START-->[\s\S]*?<!--PRODUCTO_END-->/g,
                    productosHTML
                );
            }
        }
        
        // Incluir logo si está habilitado
        if (this.settings.logoEnabled && data.empresa && data.empresa.logoPath) {
            const logoRegex = /{{logoEmpresa}}/g;
            compiledTemplate = compiledTemplate.replace(logoRegex, `<img src="${data.empresa.logoPath}" class="logo" alt="Logo">`);
        } else {
            const logoRegex = /{{logoEmpresa}}/g;
            compiledTemplate = compiledTemplate.replace(logoRegex, '');
        }
        
        return compiledTemplate;
    }

    /**
     * Imprime una factura
     * @param {Object} factura - Datos de la factura
     * @param {Object} options - Opciones de impresión
     * @returns {Promise<boolean>} Éxito de la operación
     */
    async printFactura(factura, options = {}) {
        try {
            const currentUser = auth.getCurrentUser();
            if (!currentUser) {
                throw new Error('Usuario no autenticado');
            }
            
            // Obtener datos de la empresa
            const empresa = await database.get('configuraciones', 'empresa');
            if (!empresa) {
                throw new Error('Datos de empresa no configurados');
            }
            
            // Formato de impresión (A4 o ticket)
            const formato = options.formato || this.settings.defaultFormat;
            
            // Seleccionar plantilla según formato
            const template = formato === 'ticket' ? this.templates.facturas.ticket : this.templates.facturas.a4;
            
            // Determinar cantidad de copias según tipo de factura
            const copias = options.copies || this.settings.copies[`factura${factura.tipo}`] || 1;
            
            // Compilar la plantilla con los datos
            const htmlContent = this.compileTemplate(template, {
                ...factura,
                empresa,
                fechaImpresion: new Date().toLocaleString(),
                usuario: currentUser.nombre
            });
            
            // Configurar opciones de impresión
            const printerOptions = {
                printer: options.printer || (formato === 'ticket' ? this.settings.ticketPrinter : this.settings.a4Printer) || this.defaultPrinter,
                copies: copias,
                silent: !this.settings.showPrintDialog,
                margins: this.settings.margins,
                paperSize: formato === 'ticket' ? 'ROLL80' : this.settings.paperSize
            };
            
            // Imprimir documento
            const result = await printerService.print(htmlContent, printerOptions);
            
            // Registrar actividad
            logger.info(`PrinterManager: Factura ${factura.tipo}${factura.numero} impresa por ${currentUser.nombre}`);
            
            // Actualizar estado de impresión en la factura
            await database.update('facturas', factura.id, { 
                impreso: true, 
                fechaImpresion: new Date(), 
                usuarioImpresion: currentUser.id 
            });
            
            return result;
        } catch (error) {
            logger.error('PrinterManager: Error al imprimir factura', error);
            throw new Error(`Error al imprimir factura: ${error.message}`);
        }
    }

    /**
     * Imprime un remito
     * @param {Object} remito - Datos del remito
     * @param {Object} options - Opciones de impresión
     * @returns {Promise<boolean>} Éxito de la operación
     */
    async printRemito(remito, options = {}) {
        try {
            const currentUser = auth.getCurrentUser();
            if (!currentUser) {
                throw new Error('Usuario no autenticado');
            }
            
            // Obtener datos de la empresa
            const empresa = await database.get('configuraciones', 'empresa');
            if (!empresa) {
                throw new Error('Datos de empresa no configurados');
            }
            
            // Compilar la plantilla con los datos
            const htmlContent = this.compileTemplate(this.templates.remitos.default, {
                ...remito,
                empresa,
                fechaImpresion: new Date().toLocaleString(),
                usuario: currentUser.nombre
            });
            
            // Configurar opciones de impresión
            const printerOptions = {
                printer: options.printer || this.settings.a4Printer || this.defaultPrinter,
                copies: options.copies || this.settings.copies.remito || 1,
                silent: !this.settings.showPrintDialog,
                margins: this.settings.margins,
                paperSize: this.settings.paperSize
            };
            
            // Imprimir documento
            const result = await printerService.print(htmlContent, printerOptions);
            
            // Registrar actividad
            logger.info(`PrinterManager: Remito ${remito.numero} impreso por ${currentUser.nombre}`);
            
            // Actualizar estado de impresión en el remito
            await database.update('remitos', remito.id, { 
                impreso: true, 
                fechaImpresion: new Date(), 
                usuarioImpresion: currentUser.id 
            });
            
            return result;
        } catch (error) {
            logger.error('PrinterManager: Error al imprimir remito', error);
            throw new Error(`Error al imprimir remito: ${error.message}`);
        }
    }

    /**
     * Imprime una nota de crédito o débito
     * @param {Object} nota - Datos de la nota
     * @param {string} tipo - 'credito' o 'debito'
     * @param {Object} options - Opciones de impresión
     * @returns {Promise<boolean>} Éxito de la operación
     */
    async printNota(nota, tipo, options = {}) {
        try {
            if (tipo !== 'credito' && tipo !== 'debito') {
                throw new Error('Tipo de nota inválido. Debe ser "credito" o "debito"');
            }
            
            const currentUser = auth.getCurrentUser();
            if (!currentUser) {
                throw new Error('Usuario no autenticado');
            }
            
            // Obtener datos de la empresa
            const empresa = await database.get('configuraciones', 'empresa');
            if (!empresa) {
                throw new Error('Datos de empresa no configurados');
            }
            
            // Seleccionar plantilla según tipo de nota
            const template = this.templates.notas[tipo];
            
            // Compilar la plantilla con los datos
            const htmlContent = this.compileTemplate(template, {
                ...nota,
                empresa,
                fechaImpresion: new Date().toLocaleString(),
                usuario: currentUser.nombre,
                tipoNota: tipo === 'credito' ? 'Crédito' : 'Débito'
            });
            
            // Configurar opciones de impresión
            const printerOptions = {
                printer: options.printer || this.settings.a4Printer || this.defaultPrinter,
                copies: options.copies || this.settings.copies[`nota${tipo.charAt(0).toUpperCase() + tipo.slice(1)}`] || 1,
                silent: !this.settings.showPrintDialog,
                margins: this.settings.margins,
                paperSize: this.settings.paperSize
            };
            
            // Imprimir documento
            const result = await printerService.print(htmlContent, printerOptions);
            
            // Registrar actividad
            logger.info(`PrinterManager: Nota de ${tipo} ${nota.numero} impresa por ${currentUser.nombre}`);
            
            // Actualizar estado de impresión en la nota
            await database.update('notas', nota.id, { 
                impreso: true, 
                fechaImpresion: new Date(), 
                usuarioImpresion: currentUser.id 
            });
            
            return result;
        } catch (error) {
            logger.error(`PrinterManager: Error al imprimir nota de ${tipo}`, error);
            throw new Error(`Error al imprimir nota de ${tipo}: ${error.message}`);
        }
    }

    /**
     * Imprime un reporte
     * @param {string} tipoReporte - Tipo de reporte (ventas, caja, stock)
     * @param {Object} datos - Datos del reporte
     * @param {Object} options - Opciones de impresión
     * @returns {Promise<boolean>} Éxito de la operación
     */
    async printReporte(tipoReporte, datos, options = {}) {
        try {
            if (!this.templates.reportes[tipoReporte]) {
                throw new Error(`Tipo de reporte "${tipoReporte}" no soportado`);
            }
            
            const currentUser = auth.getCurrentUser();
            if (!currentUser) {
                throw new Error('Usuario no autenticado');
            }
            
            // Obtener datos de la empresa
            const empresa = await database.get('configuraciones', 'empresa');
            if (!empresa) {
                throw new Error('Datos de empresa no configurados');
            }
            
            // Compilar la plantilla con los datos
            const htmlContent = this.compileTemplate(this.templates.reportes[tipoReporte], {
                ...datos,
                empresa,
                fechaImpresion: new Date().toLocaleString(),
                usuario: currentUser.nombre
            });
            
            // Configurar opciones de impresión
            const printerOptions = {
                printer: options.printer || this.settings.a4Printer || this.defaultPrinter,
                copies: options.copies || 1,
                silent: !this.settings.showPrintDialog,
                margins: this.settings.margins,
                paperSize: this.settings.paperSize
            };
            
            // Imprimir documento
            const result = await printerService.print(htmlContent, printerOptions);
            
            // Registrar actividad
            logger.info(`PrinterManager: Reporte de ${tipoReporte} impreso por ${currentUser.nombre}`);
            
            return result;
        } catch (error) {
            logger.error(`PrinterManager: Error al imprimir reporte de ${tipoReporte}`, error);
            throw new Error(`Error al imprimir reporte de ${tipoReporte}: ${error.message}`);
        }
    }

    /**
     * Genera un PDF a partir de un documento
     * @param {string} tipoDocumento - Tipo de documento (factura, remito, nota, reporte)
     * @param {Object} datos - Datos del documento
     * @param {Object} options - Opciones adicionales
     * @returns {Promise<Buffer>} Buffer con el PDF generado
     */
    async generatePDF(tipoDocumento, datos, options = {}) {
        try {
            const currentUser = auth.getCurrentUser();
            if (!currentUser) {
                throw new Error('Usuario no autenticado');
            }
            
            // Obtener datos de la empresa
            const empresa = await database.get('configuraciones', 'empresa');
            if (!empresa) {
                throw new Error('Datos de empresa no configurados');
            }
            
            let template;
            let documentData;
            
            // Seleccionar plantilla según tipo de documento
            switch (tipoDocumento) {
                case 'factura':
                    const formato = options.formato || this.settings.defaultFormat;
                    template = formato === 'ticket' ? this.templates.facturas.ticket : this.templates.facturas.a4;
                    documentData = {
                        ...datos,
                        empresa,
                        fechaImpresion: new Date().toLocaleString(),
                        usuario: currentUser.nombre
                    };
                    break;
                case 'remito':
                    template = this.templates.remitos.default;
                    documentData = {
                        ...datos,
                        empresa,
                        fechaImpresion: new Date().toLocaleString(),
                        usuario: currentUser.nombre
                    };
                    break;
                case 'notaCredito':
                    template = this.templates.notas.credito;
                    documentData = {
                        ...datos,
                        empresa,
                        fechaImpresion: new Date().toLocaleString(),
                        usuario: currentUser.nombre,
                        tipoNota: 'Crédito'
                    };
                    break;
                case 'notaDebito':
                    template = this.templates.notas.debito;
                    documentData = {
                        ...datos,
                        empresa,
                        fechaImpresion: new Date().toLocaleString(),
                        usuario: currentUser.nombre,
                        tipoNota: 'Débito'
                    };
                    break;
                case 'reporteVentas':
                    template = this.templates.reportes.ventas;
                    documentData = {
                        ...datos,
                        empresa,
                        fechaImpresion: new Date().toLocaleString(),
                        usuario: currentUser.nombre
                    };
                    break;
                case 'reporteCaja':
                    template = this.templates.reportes.caja;
                    documentData = {
                        ...datos,
                        empresa,
                        fechaImpresion: new Date().toLocaleString(),
                        usuario: currentUser.nombre
                    };
                    break;
                case 'reporteStock':
                    template = this.templates.reportes.stock;
                    documentData = {
                        ...datos,
                        empresa,
                        fechaImpresion: new Date().toLocaleString(),
                        usuario: currentUser.nombre
                    };
                    break;
                default:
                    throw new Error(`Tipo de documento "${tipoDocumento}" no soportado`);
            }
            
            // Compilar la plantilla con los datos
            const htmlContent = this.compileTemplate(template, documentData);
            
            // Configurar opciones del PDF
            const pdfOptions = {
                format: options.formato === 'ticket' ? 'Roll80' : 'A4',
                margin: this.settings.margins,
                printBackground: true,
                landscape: options.landscape || false,
                header: options.header,
                footer: options.footer
            };
            
            // Generar PDF
            const pdfBuffer = await printerService.generatePDF(htmlContent, pdfOptions);
            
            // Registrar actividad
            logger.info(`PrinterManager: PDF de ${tipoDocumento} generado por ${currentUser.nombre}`);
            
            return pdfBuffer;
        } catch (error) {
            logger.error(`PrinterManager: Error al generar PDF de ${tipoDocumento}`, error);
            throw new Error(`Error al generar PDF de ${tipoDocumento}: ${error.message}`);
        }
    }

    /**
     * Guarda un PDF en el sistema de archivos
     * @param {Buffer} pdfBuffer - Buffer del PDF
     * @param {string} filePath - Ruta donde guardar el archivo
     * @returns {Promise<string>} Ruta del archivo guardado
     */
    async savePDF(pdfBuffer, filePath) {
        try {
            const savedPath = await printerService.savePDF(pdfBuffer, filePath);
            logger.info(`PrinterManager: PDF guardado en ${savedPath}`);
            return savedPath;
        } catch (error) {
            logger.error('PrinterManager: Error al guardar PDF', error);
            throw new Error(`Error al guardar PDF: ${error.message}`);
        }
    }

    /**
     * Envía un documento por correo electrónico
     * @param {string} tipoDocumento - Tipo de documento
     * @param {Object} datos - Datos del documento
     * @param {string} email - Correo electrónico destinatario
     * @param {Object} options - Opciones adicionales
     * @returns {Promise<boolean>} Éxito de la operación
     */
    async sendDocumentByEmail(tipoDocumento, datos, email, options = {}) {
        try {
            // Genera el PDF
            const pdfBuffer = await this.generatePDF(tipoDocumento, datos, options);
            
            // Obtener el servicio de email
            const emailService = window.electronAPI.emailService;
            
            // Obtener datos de la empresa
            const empresa = await database.get('configuraciones', 'empresa');
            
            // Configurar opciones de correo
            let subject, templateName;
            switch (tipoDocumento) {
                case 'factura':
                    subject = `Factura ${datos.tipo}${datos.numero} - ${empresa.nombre}`;
                    templateName = 'facturaEmail';
                    break;
                case 'remito':
                    subject = `Remito ${datos.numero} - ${empresa.nombre}`;
                    templateName = 'remitoEmail';
                    break;
                case 'notaCredito':
                    subject = `Nota de Crédito ${datos.numero} - ${empresa.nombre}`;
                    templateName = 'notaCreditoEmail';
                    break;
                case 'notaDebito':
                    subject = `Nota de Débito ${datos.numero} - ${empresa.nombre}`;
                    templateName = 'notaDebitoEmail';
                    break;
                default:
                    subject = `Documento ${tipoDocumento} - ${empresa.nombre}`;
                    templateName = 'documentoEmail';
            }
            
            // Enviar correo
            const emailOptions = {
                to: email,
                subject: options.subject || subject,
                template: options.template || templateName,
                templateData: {
                    nombreCliente: datos.cliente ? datos.cliente.nombre : 'Cliente',
                    numeroDocumento: datos.tipo ? `${datos.tipo}${datos.numero}` : datos.numero,
                    fechaEmision: datos.fecha,
                    montoTotal: datos.total,
                    empresa: empresa
                },
                attachments: [
                    {
                        filename: `${tipoDocumento}_${datos.numero}.pdf`,
                        content: pdfBuffer
                    }
                ]
            };
            
            const result = await emailService.sendEmail(emailOptions);
            
            // Registrar actividad
            const currentUser = auth.getCurrentUser();
            logger.info(`PrinterManager: ${tipoDocumento} ${datos.numero} enviado por email a ${email} por ${currentUser.nombre}`);
            
            // Registrar en la base de datos el envío del email
            await database.insert('emailsEnviados', {
                tipoDocumento,
                idDocumento: datos.id,
                destinatario: email,
                fecha: new Date(),
                usuario: currentUser.id,
                exito: result
            });
            
            return result;
        } catch (error) {
            logger.error(`PrinterManager: Error al enviar ${tipoDocumento} por email`, error);
            throw new Error(`Error al enviar ${tipoDocumento} por email: ${error.message}`);
        }
    }

    /**
     * Envía un documento por WhatsApp
     * @param {string} tipoDocumento - Tipo de documento
     * @param {Object} datos - Datos del documento
     * @param {string} telefono - Número de teléfono destinatario
     * @param {Object} options - Opciones adicionales
     * @returns {Promise<boolean>} Éxito de la operación
     */
    async sendDocumentByWhatsApp(tipoDocumento, datos, telefono, options = {}) {
        try {
            // Genera el PDF
            const pdfBuffer = await this.generatePDF(tipoDocumento, datos, options);
            
            // Obtener el servicio de WhatsApp
            const whatsappService = window.electronAPI.whatsappService;
            
            // Obtener datos de la empresa
            const empresa = await database.get('configuraciones', 'empresa');
            
            // Generar mensaje
            let mensaje;
            switch (tipoDocumento) {
                case 'factura':
                    mensaje = `*${empresa.nombre}*\n\nFactura ${datos.tipo}${datos.numero}\nFecha: ${datos.fecha}\nTotal: $${datos.total}\n\nGracias por su compra.`;
                    break;
                case 'remito':
                    mensaje = `*${empresa.nombre}*\n\nRemito ${datos.numero}\nFecha: ${datos.fecha}\n\nGracias por su compra.`;
                    break;
                case 'notaCredito':
                    mensaje = `*${empresa.nombre}*\n\nNota de Crédito ${datos.numero}\nFecha: ${datos.fecha}\nTotal: $${datos.total}\n\nGracias por su atención.`;
                    break;
                case 'notaDebito':
                    mensaje = `*${empresa.nombre}*\n\nNota de Débito ${datos.numero}\nFecha: ${datos.fecha}\nTotal: $${datos.total}\n\nGracias por su atención.`;
                    break;
                default:
                    mensaje = `*${empresa.nombre}*\n\nDocumento ${tipoDocumento} ${datos.numero}\nFecha: ${datos.fecha}\n\nGracias por su atención.`;
            }
            
            // Preparar opciones de envío
            const whatsappOptions = {
                to: telefono,
                message: options.mensaje || mensaje,
                attachment: {
                    filename: `${tipoDocumento}_${datos.numero}.pdf`,
                    buffer: pdfBuffer
                }
            };
            
            // Enviar mensaje
            const result = await whatsappService.sendMessage(whatsappOptions);
            
            // Registrar actividad
            const currentUser = auth.getCurrentUser();
            logger.info(`PrinterManager: ${tipoDocumento} ${datos.numero} enviado por WhatsApp a ${telefono} por ${currentUser.nombre}`);
            
            // Registrar en la base de datos el envío del WhatsApp
            await database.insert('whatsappEnviados', {
                tipoDocumento,
                idDocumento: datos.id,
                destinatario: telefono,
                fecha: new Date(),
                usuario: currentUser.id,
                exito: result
            });
            
            return result;
        } catch (error) {
            logger.error(`PrinterManager: Error al enviar ${tipoDocumento} por WhatsApp`, error);
            throw new Error(`Error al enviar ${tipoDocumento} por WhatsApp: ${error.message}`);
        }
    }

    /**
     * Previsualiza un documento antes de imprimir
     * @param {string} tipoDocumento - Tipo de documento
     * @param {Object} datos - Datos del documento
     * @param {Object} options - Opciones adicionales
     * @returns {Promise<string>} HTML del documento
     */
    async previewDocument(tipoDocumento, datos, options = {}) {
        try {
            const currentUser = auth.getCurrentUser();
            if (!currentUser) {
                throw new Error('Usuario no autenticado');
            }
            
            // Obtener datos de la empresa
            const empresa = await database.get('configuraciones', 'empresa');
            if (!empresa) {
                throw new Error('Datos de empresa no configurados');
            }
            
            let template;
            let documentData;
            
            // Seleccionar plantilla según tipo de documento
            switch (tipoDocumento) {
                case 'factura':
                    const formato = options.formato || this.settings.defaultFormat;
                    template = formato === 'ticket' ? this.templates.facturas.ticket : this.templates.facturas.a4;
                    documentData = {
                        ...datos,
                        empresa,
                        fechaImpresion: new Date().toLocaleString(),
                        usuario: currentUser.nombre
                    };
                    break;
                case 'remito':
                    template = this.templates.remitos.default;
                    documentData = {
                        ...datos,
                        empresa,
                        fechaImpresion: new Date().toLocaleString(),
                        usuario: currentUser.nombre
                    };
                    break;
                case 'notaCredito':
                    template = this.templates.notas.credito;
                    documentData = {
                        ...datos,
                        empresa,
                        fechaImpresion: new Date().toLocaleString(),
                        usuario: currentUser.nombre,
                        tipoNota: 'Crédito'
                    };
                    break;
                case 'notaDebito':
                    template = this.templates.notas.debito;
                    documentData = {
                        ...datos,
                        empresa,
                        fechaImpresion: new Date().toLocaleString(),
                        usuario: currentUser.nombre,
                        tipoNota: 'Débito'
                    };
                    break;
                case 'reporteVentas':
                    template = this.templates.reportes.ventas;
                    documentData = {
                        ...datos,
                        empresa,
                        fechaImpresion: new Date().toLocaleString(),
                        usuario: currentUser.nombre
                    };
                    break;
                case 'reporteCaja':
                    template = this.templates.reportes.caja;
                    documentData = {
                        ...datos,
                        empresa,
                        fechaImpresion: new Date().toLocaleString(),
                        usuario: currentUser.nombre
                    };
                    break;
                case 'reporteStock':
                    template = this.templates.reportes.stock;
                    documentData = {
                        ...datos,
                        empresa,
                        fechaImpresion: new Date().toLocaleString(),
                        usuario: currentUser.nombre
                    };
                    break;
                default:
                    throw new Error(`Tipo de documento "${tipoDocumento}" no soportado`);
            }
            
            // Compilar la plantilla con los datos
            const htmlContent = this.compileTemplate(template, documentData);
            
            // Agregar estilos de previsualización
            const styleTag = `
                <style>
                    @media screen {
                        body {
                            background-color: #f0f0f0;
                            margin: 0;
                            padding: 20px;
                            font-family: Arial, sans-serif;
                        }
                        .preview-container {
                            background-color: white;
                            box-shadow: 0 0 10px rgba(0,0,0,0.3);
                            margin: 0 auto;
                            max-width: ${options.formato === 'ticket' ? '380px' : '800px'};
                            padding: 20px;
                        }
                        .preview-watermark {
                            position: fixed;
                            top: 50%;
                            left: 50%;
                            transform: translate(-50%, -50%) rotate(-45deg);
                            font-size: 100px;
                            color: rgba(200, 200, 200, 0.3);
                            pointer-events: none;
                            z-index: 1000;
                        }
                    }
                </style>
                <div class="preview-watermark">VISTA PREVIA</div>
                <div class="preview-container">
            `;
            
            const closingDiv = `</div>`;
            
            // Registrar actividad
            logger.info(`PrinterManager: Previsualización de ${tipoDocumento} generada por ${currentUser.nombre}`);
            
            // Insertar estilo en el contenido HTML
            const htmlWithStyles = htmlContent.replace('</head>', `${styleTag}</head>`);
            const finalHtml = htmlWithStyles.replace('</body>', `${closingDiv}</body>`);
            
            return finalHtml;
        } catch (error) {
            logger.error(`PrinterManager: Error al generar previsualización de ${tipoDocumento}`, error);
            throw new Error(`Error al generar previsualización de ${tipoDocumento}: ${error.message}`);
        }
    }
    
    /**
     * Actualiza una plantilla específica
     * @param {string} tipoDocumento - Tipo de documento
     * @param {string} formato - Formato de la plantilla
     * @param {string} htmlTemplate - Contenido HTML de la plantilla
     * @returns {Promise<boolean>} Éxito de la operación
     */
    async updateTemplate(tipoDocumento, formato, htmlTemplate) {
        try {
            // Verificar permisos del usuario
            const currentUser = auth.getCurrentUser();
            if (!currentUser || !currentUser.permisos.includes('ADMIN_SISTEMA')) {
                throw new Error('No tiene permisos para actualizar plantillas');
            }
            
            // Seleccionar destino de plantilla
            switch (tipoDocumento) {
                case 'factura':
                    if (formato !== 'a4' && formato !== 'ticket') {
                        throw new Error('Formato de factura inválido. Debe ser "a4" o "ticket"');
                    }
                    this.templates.facturas[formato] = htmlTemplate;
                    // También guardar en el sistema de archivos para persistencia
                    await printerService.saveTemplate(`/templates/facturas/${formato}.html`, htmlTemplate);
                    break;
                case 'remito':
                    this.templates.remitos.default = htmlTemplate;
                    await printerService.saveTemplate('/templates/remitos/template.html', htmlTemplate);
                    break;
                case 'notaCredito':
                    this.templates.notas.credito = htmlTemplate;
                    await printerService.saveTemplate('/templates/notas/credito.html', htmlTemplate);
                    break;
                case 'notaDebito':
                    this.templates.notas.debito = htmlTemplate;
                    await printerService.saveTemplate('/templates/notas/debito.html', htmlTemplate);
                    break;
                case 'reporteVentas':
                    this.templates.reportes.ventas = htmlTemplate;
                    await printerService.saveTemplate('/templates/reportes/ventas.html', htmlTemplate);
                    break;
                case 'reporteCaja':
                    this.templates.reportes.caja = htmlTemplate;
                    await printerService.saveTemplate('/templates/reportes/caja.html', htmlTemplate);
                    break;
                case 'reporteStock':
                    this.templates.reportes.stock = htmlTemplate;
                    await printerService.saveTemplate('/templates/reportes/stock.html', htmlTemplate);
                    break;
                default:
                    throw new Error(`Tipo de documento "${tipoDocumento}" no soportado`);
            }
            
            // Registrar actividad
            logger.info(`PrinterManager: Plantilla de ${tipoDocumento} (${formato || 'default'}) actualizada por ${currentUser.nombre}`);
            
            return true;
        } catch (error) {
            logger.error(`PrinterManager: Error al actualizar plantilla de ${tipoDocumento}`, error);
            throw new Error(`Error al actualizar plantilla de ${tipoDocumento}: ${error.message}`);
        }
    }
    
    /**
     * Verifica el estado de la impresora
     * @param {string} printerName - Nombre de la impresora
     * @returns {Promise<Object>} Estado de la impresora
     */
    async getPrinterStatus(printerName) {
        try {
            const printerToCheck = printerName || this.defaultPrinter;
            if (!printerToCheck) {
                throw new Error('No se ha especificado una impresora');
            }
            
            const status = await printerService.getPrinterStatus(printerToCheck);
            logger.info(`PrinterManager: Estado de impresora ${printerToCheck} verificado`);
            return status;
        } catch (error) {
            logger.error(`PrinterManager: Error al verificar estado de impresora`, error);
            throw new Error(`Error al verificar estado de impresora: ${error.message}`);
        }
    }
    
    /**
     * Imprime una página de prueba
     * @param {string} printerName - Nombre de la impresora
     * @returns {Promise<boolean>} Éxito de la operación
     */
    async printTestPage(printerName) {
        try {
            const printer = printerName || this.defaultPrinter;
            if (!printer) {
                throw new Error('No se ha especificado una impresora');
            }
            
            const currentUser = auth.getCurrentUser();
            
            // Obtener datos de la empresa
            const empresa = await database.get('configuraciones', 'empresa');
            
            // Crear HTML para página de prueba
            const htmlContent = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <title>Página de Prueba</title>
                    <style>
                        body {
                            font-family: Arial, sans-serif;
                            margin: 0;
                            padding: 20px;
                        }
                        .container {
                            max-width: 600px;
                            margin: 0 auto;
                            border: 1px solid #ccc;
                            padding: 20px;
                        }
                        .header {
                            text-align: center;
                            margin-bottom: 20px;
                        }
                        .content {
                            margin-bottom: 20px;
                        }
                        .footer {
                            text-align: center;
                            font-size: 12px;
                            color: #666;
                            margin-top: 20px;
                        }
                        table {
                            width: 100%;
                            border-collapse: collapse;
                        }
                        th, td {
                            border: 1px solid #ccc;
                            padding: 8px;
                        }
                        th {
                            background-color: #f0f0f0;
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="header">
                            <h1>Página de Prueba de Impresión</h1>
                            <h2>${empresa ? empresa.nombre : 'FactuSystem'}</h2>
                        </div>
                        
                        <div class="content">
                            <p>Esta es una página de prueba para verificar el correcto funcionamiento de su impresora.</p>
                            
                            <h3>Información de Impresión:</h3>
                            <table>
                                <tr>
                                    <th>Dato</th>
                                    <th>Valor</th>
                                </tr>
                                <tr>
                                    <td>Fecha y hora</td>
                                    <td>${new Date().toLocaleString()}</td>
                                </tr>
                                <tr>
                                    <td>Impresora</td>
                                    <td>${printer}</td>
                                </tr>
                                <tr>
                                    <td>Usuario</td>
                                    <td>${currentUser ? currentUser.nombre : 'No identificado'}</td>
                                </tr>
                                <tr>
                                    <td>Sistema</td>
                                    <td>FactuSystem ${process.env.APP_VERSION || 'v1.0'}</td>
                                </tr>
                            </table>
                            
                            <h3>Tabla de Prueba:</h3>
                            <table>
                                <tr>
                                    <th>#</th>
                                    <th>Producto</th>
                                    <th>Cantidad</th>
                                    <th>Precio</th>
                                    <th>Total</th>
                                </tr>
                                <tr>
                                    <td>1</td>
                                    <td>Producto de prueba A</td>
                                    <td>2</td>
                                    <td>$100.00</td>
                                    <td>$200.00</td>
                                </tr>
                                <tr>
                                    <td>2</td>
                                    <td>Producto de prueba B</td>
                                    <td>1</td>
                                    <td>$150.00</td>
                                    <td>$150.00</td>
                                </tr>
                                <tr>
                                    <td>3</td>
                                    <td>Producto de prueba C</td>
                                    <td>3</td>
                                    <td>$75.00</td>
                                    <td>$225.00</td>
                                </tr>
                                <tr>
                                    <td colspan="4" style="text-align: right;"><strong>Total</strong></td>
                                    <td><strong>$575.00</strong></td>
                                </tr>
                            </table>
                        </div>
                        
                        <div class="footer">
                            <p>Si esta página se imprimió correctamente, su impresora está configurada correctamente.</p>
                            <p>FactuSystem - Sistema de Facturación e Inventario</p>
                        </div>
                    </div>
                </body>
                </html>
            `;
            
            // Imprimir página de prueba
            const result = await printerService.print(htmlContent, {
                printer: printer,
                silent: true,
                copies: 1
            });
            
            // Registrar actividad
            logger.info(`PrinterManager: Página de prueba enviada a impresora ${printer} por ${currentUser ? currentUser.nombre : 'usuario no identificado'}`);
            
            return result;
        } catch (error) {
            logger.error('PrinterManager: Error al imprimir página de prueba', error);
            throw new Error(`Error al imprimir página de prueba: ${error.message}`);
        }
    }
}

// Exportar la clase PrinterManager
module.exports = new PrinterManager();