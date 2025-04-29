/**
 * pdf.js - Servicio para generación de documentos PDF en FactuSystem
 * 
 * Este módulo proporciona funciones para generar documentos PDF a partir de plantillas HTML
 * para facturas, remitos, notas de crédito/débito y reportes.
 * 
 * @author FactuSystem
 * @version 1.0.0
 */

const { BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const PDFDocument = require('pdfkit');
const bwipjs = require('bwip-js');
const QRCode = require('qrcode');
const logger = require('../audit/logger.js');
const { formatCurrency, formatDate } = require('../../app/assets/js/utils/formatter.js');

// Configuración de rutas para las plantillas
const TEMPLATES_DIR = path.join(__dirname, '../../app/templates');

/**
 * Genera un PDF a partir de una plantilla HTML con datos
 * @param {string} templatePath - Ruta a la plantilla HTML
 * @param {Object} data - Datos para renderizar la plantilla
 * @param {string} outputPath - Ruta donde guardar el PDF (opcional)
 * @returns {Promise<Buffer|string>} - Buffer del PDF o ruta del archivo guardado
 */
async function generatePDFFromTemplate(templatePath, data, outputPath = null) {
    try {
        // Leer plantilla HTML
        let templateContent = fs.readFileSync(templatePath, 'utf8');
        
        // Reemplazar variables en la plantilla
        templateContent = renderTemplate(templateContent, data);
        
        // Crear ventana oculta de Electron para renderizar HTML
        const win = new BrowserWindow({
            width: 800,
            height: 1200,
            show: false,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true
            }
        });
        
        // Cargar el HTML en la ventana
        await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(templateContent)}`);
        
        // Esperar a que termine de renderizar
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Generar PDF
        const pdfData = await win.webContents.printToPDF({
            printBackground: true,
            pageSize: 'A4',
            margins: {
                top: 10,
                bottom: 10,
                left: 10,
                right: 10
            }
        });
        
        // Cerrar la ventana
        win.close();
        
        // Guardar PDF si se especificó una ruta
        if (outputPath) {
            fs.writeFileSync(outputPath, pdfData);
            logger.info(`PDF guardado en: ${outputPath}`);
            return outputPath;
        }
        
        return pdfData;
    } catch (error) {
        logger.error(`Error al generar PDF: ${error.message}`, error);
        throw new Error(`Error al generar PDF: ${error.message}`);
    }
}

/**
 * Reemplaza variables en una plantilla
 * @param {string} template - Plantilla HTML con variables en formato {{variable}}
 * @param {Object} data - Datos para reemplazar en la plantilla
 * @returns {string} - HTML con variables reemplazadas
 */
function renderTemplate(template, data) {
    // Reemplazar variables simples
    Object.entries(data).forEach(([key, value]) => {
        const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
        template = template.replace(regex, value);
    });
    
    // Procesar condicionales {{#if condición}}contenido{{/if}}
    template = processConditionals(template, data);
    
    // Procesar bucles {{#each items}}{{nombre}}{{/each}}
    template = processLoops(template, data);
    
    return template;
}

/**
 * Procesa condicionales en la plantilla
 * @param {string} template - Plantilla HTML
 * @param {Object} data - Datos para evaluación de condiciones
 * @returns {string} - HTML procesado
 */
function processConditionals(template, data) {
    const conditionalRegex = /{{#if\s+([^}]+)}}\s*([\s\S]*?)\s*{{\/if}}/g;
    let match;
    
    while ((match = conditionalRegex.exec(template)) !== null) {
        const condition = match[1].trim();
        const content = match[2];
        const fullMatch = match[0];
        
        // Evaluar condición
        let result = false;
        try {
            // Evaluar con seguridad usando una función específica de evaluación
            const evalCondition = new Function(...Object.keys(data), `return ${condition};`);
            result = evalCondition(...Object.values(data));
        } catch (error) {
            logger.warn(`Error al evaluar condición: ${condition}`, error);
        }
        
        template = template.replace(fullMatch, result ? content : '');
    }
    
    return template;
}

/**
 * Procesa bucles en la plantilla
 * @param {string} template - Plantilla HTML
 * @param {Object} data - Datos para los bucles
 * @returns {string} - HTML procesado
 */
function processLoops(template, data) {
    const loopRegex = /{{#each\s+([^}]+)}}\s*([\s\S]*?)\s*{{\/each}}/g;
    let match;
    
    while ((match = loopRegex.exec(template)) !== null) {
        const arrayName = match[1].trim();
        const itemTemplate = match[2];
        const fullMatch = match[0];
        
        if (!data[arrayName] || !Array.isArray(data[arrayName])) {
            template = template.replace(fullMatch, '');
            continue;
        }
        
        let replacement = '';
        data[arrayName].forEach((item, index) => {
            // Añadir index al item para poder usarlo en la plantilla
            if (typeof item === 'object') {
                item._index = index;
                item._isFirst = index === 0;
                item._isLast = index === data[arrayName].length - 1;
            }
            
            let itemHtml = itemTemplate;
            
            // Reemplazar variables del item
            if (typeof item === 'object') {
                Object.entries(item).forEach(([key, value]) => {
                    const itemRegex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
                    itemHtml = itemHtml.replace(itemRegex, value);
                });
            } else {
                // Si el item es un valor simple
                itemHtml = itemHtml.replace(/{{this}}/g, item);
            }
            
            replacement += itemHtml;
        });
        
        template = template.replace(fullMatch, replacement);
    }
    
    return template;
}

/**
 * Genera un código QR como imagen para incluir en los PDFs
 * @param {string} data - Datos para codificar en el QR
 * @returns {Promise<string>} - Data URL de la imagen del QR
 */
async function generateQRCode(data) {
    try {
        return await QRCode.toDataURL(data, {
            errorCorrectionLevel: 'H',
            margin: 1,
            width: 150
        });
    } catch (error) {
        logger.error(`Error al generar código QR: ${error.message}`, error);
        throw new Error(`Error al generar código QR: ${error.message}`);
    }
}

/**
 * Genera un código de barras como imagen para incluir en los PDFs
 * @param {string} data - Datos para codificar en el código de barras
 * @param {string} format - Formato (code128, ean13, etc.)
 * @returns {Promise<string>} - Data URL de la imagen del código de barras
 */
async function generateBarcode(data, format = 'code128') {
    try {
        const png = await bwipjs.toBuffer({
            bcid: format,
            text: data,
            scale: 3,
            height: 10,
            includetext: true,
            textxalign: 'center'
        });
        
        return `data:image/png;base64,${png.toString('base64')}`;
    } catch (error) {
        logger.error(`Error al generar código de barras: ${error.message}`, error);
        throw new Error(`Error al generar código de barras: ${error.message}`);
    }
}

/**
 * Genera una factura en formato PDF
 * @param {Object} facturaData - Datos de la factura
 * @param {string} formato - Formato de salida ('a4' o 'ticket')
 * @param {string} outputPath - Ruta donde guardar el PDF (opcional)
 * @returns {Promise<Buffer|string>} - Buffer del PDF o ruta del archivo guardado
 */
async function generarFacturaPDF(facturaData, formato = 'a4', outputPath = null) {
    try {
        // Validar el formato
        if (!['a4', 'ticket'].includes(formato)) {
            throw new Error(`Formato no válido: ${formato}. Use 'a4' o 'ticket'`);
        }
        
        // Determinar la plantilla a usar
        const templatePath = path.join(TEMPLATES_DIR, 'facturas', `${formato}.html`);
        
        // Verificar que existe la plantilla
        if (!fs.existsSync(templatePath)) {
            throw new Error(`Plantilla no encontrada: ${templatePath}`);
        }
        
        // Preparar datos adicionales para la factura
        const dataEnriquecida = {
            ...facturaData,
            fechaFormateada: formatDate(facturaData.fecha || new Date()),
            montoTotal: formatCurrency(facturaData.total || 0),
            fechaEmision: formatDate(new Date()),
            // Calcular totales si no están presentes
            subtotal: facturaData.subtotal || 
                      (facturaData.items ? 
                        facturaData.items.reduce((sum, item) => sum + (item.cantidad * item.precioUnitario), 0) : 0),
            iva: facturaData.iva || 
                (facturaData.items && facturaData.aplicaIVA ? 
                    facturaData.items.reduce((sum, item) => sum + (item.cantidad * item.precioUnitario * 0.21), 0) : 0)
        };
        
        // Generar código QR si es una factura electrónica
        if (facturaData.esElectronica) {
            try {
                // Generar datos para el QR según especificación AFIP
                const qrData = JSON.stringify({
                    ver: 1,
                    fecha: dataEnriquecida.fechaFormateada,
                    cuit: facturaData.cuitEmisor,
                    ptoVta: facturaData.puntoVenta,
                    tipoCmp: facturaData.tipoComprobante,
                    nroCmp: facturaData.numeroComprobante,
                    importe: facturaData.total,
                    moneda: 'PES', // Peso argentino
                    ctz: 1, // Cotización
                    tipoDocRec: facturaData.tipoDocReceptor || 99, // 99 = Consumidor final
                    nroDocRec: facturaData.nroDocReceptor || 0,
                    tipoCodAut: 'E', // Tipo de código de autorización
                    codAut: facturaData.cae // CAE
                });
                
                dataEnriquecida.qrCode = await generateQRCode(qrData);
            } catch (error) {
                logger.warn(`No se pudo generar el código QR: ${error.message}`, error);
                // Continuar sin QR
            }
        }
        
        // Formatear items para la factura
        if (dataEnriquecida.items && Array.isArray(dataEnriquecida.items)) {
            dataEnriquecida.items = dataEnriquecida.items.map(item => ({
                ...item,
                subtotalItem: formatCurrency(item.cantidad * item.precioUnitario),
                precioFormateado: formatCurrency(item.precioUnitario)
            }));
        }
        
        // Generar PDF
        return await generatePDFFromTemplate(templatePath, dataEnriquecida, outputPath);
    } catch (error) {
        logger.error(`Error al generar factura PDF: ${error.message}`, error);
        throw new Error(`Error al generar factura PDF: ${error.message}`);
    }
}

/**
 * Genera un remito en formato PDF
 * @param {Object} remitoData - Datos del remito
 * @param {string} outputPath - Ruta donde guardar el PDF (opcional)
 * @returns {Promise<Buffer|string>} - Buffer del PDF o ruta del archivo guardado
 */
async function generarRemitoPDF(remitoData, outputPath = null) {
    try {
        const templatePath = path.join(TEMPLATES_DIR, 'remitos', 'template.html');
        
        // Verificar que existe la plantilla
        if (!fs.existsSync(templatePath)) {
            throw new Error(`Plantilla no encontrada: ${templatePath}`);
        }
        
        // Preparar datos adicionales para el remito
        const dataEnriquecida = {
            ...remitoData,
            fechaFormateada: formatDate(remitoData.fecha || new Date()),
            fechaEmision: formatDate(new Date())
        };
        
        // Formatear items para el remito
        if (dataEnriquecida.items && Array.isArray(dataEnriquecida.items)) {
            dataEnriquecida.items = dataEnriquecida.items.map(item => ({
                ...item,
                subtotalItem: item.cantidad * item.precioUnitario,
                precioFormateado: formatCurrency(item.precioUnitario)
            }));
        }
        
        // Generar PDF
        return await generatePDFFromTemplate(templatePath, dataEnriquecida, outputPath);
    } catch (error) {
        logger.error(`Error al generar remito PDF: ${error.message}`, error);
        throw new Error(`Error al generar remito PDF: ${error.message}`);
    }
}

/**
 * Genera una nota de crédito o débito en formato PDF
 * @param {Object} notaData - Datos de la nota
 * @param {string} tipo - Tipo de nota ('credito' o 'debito')
 * @param {string} outputPath - Ruta donde guardar el PDF (opcional)
 * @returns {Promise<Buffer|string>} - Buffer del PDF o ruta del archivo guardado
 */
async function generarNotaPDF(notaData, tipo = 'credito', outputPath = null) {
    try {
        // Validar el tipo
        if (!['credito', 'debito'].includes(tipo)) {
            throw new Error(`Tipo de nota no válido: ${tipo}. Use 'credito' o 'debito'`);
        }
        
        const templatePath = path.join(TEMPLATES_DIR, 'notas', `${tipo}.html`);
        
        // Verificar que existe la plantilla
        if (!fs.existsSync(templatePath)) {
            throw new Error(`Plantilla no encontrada: ${templatePath}`);
        }
        
        // Preparar datos adicionales para la nota
        const dataEnriquecida = {
            ...notaData,
            fechaFormateada: formatDate(notaData.fecha || new Date()),
            tipoNota: tipo === 'credito' ? 'NOTA DE CRÉDITO' : 'NOTA DE DÉBITO',
            montoTotal: formatCurrency(notaData.total || 0),
            fechaEmision: formatDate(new Date())
        };
        
        // Generar código QR si es una nota electrónica
        if (notaData.esElectronica) {
            try {
                const qrData = JSON.stringify({
                    ver: 1,
                    fecha: dataEnriquecida.fechaFormateada,
                    cuit: notaData.cuitEmisor,
                    ptoVta: notaData.puntoVenta,
                    tipoCmp: notaData.tipoComprobante,
                    nroCmp: notaData.numeroComprobante,
                    importe: notaData.total,
                    moneda: 'PES',
                    ctz: 1,
                    tipoDocRec: notaData.tipoDocReceptor || 99,
                    nroDocRec: notaData.nroDocReceptor || 0,
                    tipoCodAut: 'E',
                    codAut: notaData.cae
                });
                
                dataEnriquecida.qrCode = await generateQRCode(qrData);
            } catch (error) {
                logger.warn(`No se pudo generar el código QR: ${error.message}`, error);
            }
        }
        
        // Formatear items para la nota
        if (dataEnriquecida.items && Array.isArray(dataEnriquecida.items)) {
            dataEnriquecida.items = dataEnriquecida.items.map(item => ({
                ...item,
                subtotalItem: formatCurrency(item.cantidad * item.precioUnitario),
                precioFormateado: formatCurrency(item.precioUnitario)
            }));
        }
        
        // Generar PDF
        return await generatePDFFromTemplate(templatePath, dataEnriquecida, outputPath);
    } catch (error) {
        logger.error(`Error al generar nota PDF: ${error.message}`, error);
        throw new Error(`Error al generar nota PDF: ${error.message}`);
    }
}

/**
 * Genera un reporte en formato PDF
 * @param {string} tipoReporte - Tipo de reporte ('ventas', 'caja', 'stock', etc.)
 * @param {Object} reporteData - Datos del reporte
 * @param {string} outputPath - Ruta donde guardar el PDF (opcional)
 * @returns {Promise<Buffer|string>} - Buffer del PDF o ruta del archivo guardado
 */
async function generarReportePDF(tipoReporte, reporteData, outputPath = null) {
    try {
        // Validar el tipo de reporte
        const tiposReporteValidos = ['ventas', 'caja', 'stock', 'compras', 'fiscales'];
        if (!tiposReporteValidos.includes(tipoReporte)) {
            throw new Error(`Tipo de reporte no válido: ${tipoReporte}. Tipos válidos: ${tiposReporteValidos.join(', ')}`);
        }
        
        const templatePath = path.join(TEMPLATES_DIR, 'reportes', `${tipoReporte}.html`);
        
        // Verificar que existe la plantilla
        if (!fs.existsSync(templatePath)) {
            throw new Error(`Plantilla no encontrada: ${templatePath}`);
        }
        
        // Preparar datos adicionales para el reporte
        const dataEnriquecida = {
            ...reporteData,
            fechaGeneracion: formatDate(new Date()),
            tituloReporte: `Reporte de ${tipoReporte.charAt(0).toUpperCase() + tipoReporte.slice(1)}`,
            periodo: reporteData.periodo || `${formatDate(reporteData.fechaDesde)} - ${formatDate(reporteData.fechaHasta)}`
        };
        
        // Formatear datos específicos según el tipo de reporte
        switch (tipoReporte) {
            case 'ventas':
                if (dataEnriquecida.ventas && Array.isArray(dataEnriquecida.ventas)) {
                    dataEnriquecida.ventas = dataEnriquecida.ventas.map(venta => ({
                        ...venta,
                        totalFormateado: formatCurrency(venta.total || 0),
                        fechaFormateada: formatDate(venta.fecha)
                    }));
                }
                dataEnriquecida.totalVentas = formatCurrency(
                    dataEnriquecida.ventas?.reduce((sum, venta) => sum + (venta.total || 0), 0) || 0
                );
                break;
                
            case 'caja':
                if (dataEnriquecida.movimientos && Array.isArray(dataEnriquecida.movimientos)) {
                    dataEnriquecida.movimientos = dataEnriquecida.movimientos.map(mov => ({
                        ...mov,
                        montoFormateado: formatCurrency(mov.monto || 0),
                        fechaFormateada: formatDate(mov.fecha)
                    }));
                }
                dataEnriquecida.totalIngresos = formatCurrency(
                    dataEnriquecida.movimientos?.filter(m => m.tipo === 'ingreso')
                        .reduce((sum, mov) => sum + (mov.monto || 0), 0) || 0
                );
                dataEnriquecida.totalEgresos = formatCurrency(
                    dataEnriquecida.movimientos?.filter(m => m.tipo === 'egreso')
                        .reduce((sum, mov) => sum + (mov.monto || 0), 0) || 0
                );
                break;
                
            case 'stock':
                if (dataEnriquecida.productos && Array.isArray(dataEnriquecida.productos)) {
                    dataEnriquecida.productos = dataEnriquecida.productos.map(prod => ({
                        ...prod,
                        valorFormateado: formatCurrency(prod.precio * prod.cantidad || 0)
                    }));
                }
                break;
                
            case 'compras':
                if (dataEnriquecida.compras && Array.isArray(dataEnriquecida.compras)) {
                    dataEnriquecida.compras = dataEnriquecida.compras.map(compra => ({
                        ...compra,
                        totalFormateado: formatCurrency(compra.total || 0),
                        fechaFormateada: formatDate(compra.fecha)
                    }));
                }
                dataEnriquecida.totalCompras = formatCurrency(
                    dataEnriquecida.compras?.reduce((sum, compra) => sum + (compra.total || 0), 0) || 0
                );
                break;
                
            case 'fiscales':
                // Formatear datos específicos para reportes fiscales
                if (dataEnriquecida.comprobantes && Array.isArray(dataEnriquecida.comprobantes)) {
                    dataEnriquecida.comprobantes = dataEnriquecida.comprobantes.map(comp => ({
                        ...comp,
                        importeFormateado: formatCurrency(comp.importe || 0),
                        fechaFormateada: formatDate(comp.fecha)
                    }));
                }
                break;
        }
        
        // Generar PDF
        return await generatePDFFromTemplate(templatePath, dataEnriquecida, outputPath);
    } catch (error) {
        logger.error(`Error al generar reporte PDF: ${error.message}`, error);
        throw new Error(`Error al generar reporte PDF: ${error.message}`);
    }
}

/**
 * Genera un PDF genérico a partir de contenido HTML
 * @param {string} htmlContent - Contenido HTML completo
 * @param {string} outputPath - Ruta donde guardar el PDF (opcional)
 * @returns {Promise<Buffer|string>} - Buffer del PDF o ruta del archivo guardado
 */
async function generarPDFDesdeHTML(htmlContent, outputPath = null) {
    try {
        // Crear archivo temporal
        const tempFilePath = path.join(os.tmpdir(), `temp-${Date.now()}.html`);
        
        // Escribir HTML en archivo temporal
        fs.writeFileSync(tempFilePath, htmlContent, 'utf8');
        
        // Generar PDF
        const result = await generatePDFFromTemplate(tempFilePath, {}, outputPath);
        
        // Eliminar archivo temporal
        fs.unlinkSync(tempFilePath);
        
        return result;
    } catch (error) {
        logger.error(`Error al generar PDF desde HTML: ${error.message}`, error);
        throw new Error(`Error al generar PDF desde HTML: ${error.message}`);
    }
}

/**
 * Genera un certificado o documento formal en PDF
 * @param {Object} data - Datos para el certificado
 * @param {string} tipo - Tipo de certificado
 * @param {string} outputPath - Ruta donde guardar el PDF (opcional)
 * @returns {Promise<Buffer|string>} - Buffer del PDF o ruta del archivo guardado
 */
async function generarCertificadoPDF(data, tipo, outputPath = null) {
    try {
        // Crear un nuevo documento PDF
        const doc = new PDFDocument({
            size: 'A4',
            margin: 50,
            info: {
                Title: `Certificado de ${tipo}`,
                Author: data.empresa || 'FactuSystem',
                Subject: `Certificado de ${tipo} para ${data.destinatario || ''}`
            }
        });
        
        // Si hay ruta de salida, crear stream de escritura
        let finalCallback;
        if (outputPath) {
            const stream = fs.createWriteStream(outputPath);
            doc.pipe(stream);
            finalCallback = () => {
                stream.end();
                logger.info(`Certificado guardado en: ${outputPath}`);
                return outputPath;
            };
        } else {
            // Si no hay ruta, devolver buffer
            const chunks = [];
            doc.on('data', (chunk) => chunks.push(chunk));
            finalCallback = () => Buffer.concat(chunks);
        }
        
        // Añadir logo si existe
        if (data.logoPath && fs.existsSync(data.logoPath)) {
            doc.image(data.logoPath, 50, 50, { width: 150 });
            doc.moveDown(4);
        } else {
            doc.moveDown(2);
        }
        
        // Título
        doc.fontSize(24)
           .font('Helvetica-Bold')
           .text(`CERTIFICADO DE ${tipo.toUpperCase()}`, { align: 'center' })
           .moveDown(2);
        
        // Contenido
        doc.fontSize(12)
           .font('Helvetica')
           .text(`Por la presente, ${data.empresa || 'nuestra empresa'} certifica que:`, { align: 'left' })
           .moveDown();
        
        doc.fontSize(14)
           .font('Helvetica-Bold')
           .text(data.destinatario || '', { align: 'center' })
           .moveDown();
        
        doc.fontSize(12)
           .font('Helvetica')
           .text(data.descripcion || '', { align: 'justify' })
           .moveDown(2);
        
        // Fecha y firma
        doc.fontSize(10)
           .text(`Fecha: ${formatDate(new Date())}`, { align: 'right' })
           .moveDown(3);
        
        // Línea para firma
        doc.moveTo(350, doc.y)
           .lineTo(550, doc.y)
           .stroke();
        
        doc.moveDown()
           .fontSize(10)
           .text('Firma y sello', 350, doc.y, { align: 'center', width: 200 });
        
        // Finalizar documento
        doc.end();
        
        return await new Promise((resolve) => {
            // Esperar a que termine de procesar el documento
            doc.on('end', () => {
                resolve(finalCallback());
            });
        });
        
    } catch (error) {
        logger.error(`Error al generar certificado PDF: ${error.message}`, error);
        throw new Error(`Error al generar certificado PDF: ${error.message}`);
    }
}

/**
 * Exporta productos con sus códigos de barras para impresión
 * @param {Array<Object>} productos - Lista de productos
 * @param {string} outputPath - Ruta donde guardar el PDF (opcional)
 * @returns {Promise<Buffer|string>} - Buffer del PDF o ruta del archivo guardado
 */
async function exportarCodigosBarrasPDF(productos, outputPath = null) {
    try {
        // Crear un nuevo documento PDF
        const doc = new PDFDocument({
            size: 'A4',
            margin: 30,
            info: {
                Title: 'Códigos de Barras',
                Author: 'FactuSystem',
                Subject: 'Códigos de barras para productos'
            }
        });
        
        // Si hay ruta de salida, crear stream de escritura
        let finalCallback;
        if (outputPath) {
            const stream = fs.createWriteStream(outputPath);
            doc.pipe(stream);
            finalCallback = () => {
                stream.end();
                logger.info(`Códigos de barras guardados en: ${outputPath}`);
                return outputPath;
            };
        } else {
            // Si no hay ruta, devolver buffer
            const chunks = [];
            doc.on('data', (chunk) => chunks.push(chunk));
            finalCallback = () => Buffer.concat(chunks);
        }
        
        // Título
        doc.fontSize(18)
           .font('Helvetica-Bold')
           .text('CÓDIGOS DE BARRAS DE PRODUCTOS', { align: 'center' })
           .moveDown(2);
        
        // Definir la disposición de los códigos (3 columnas)
        const columns = 2;
        const codeWidth = 250;
        const codeHeight = 120;
        const margin = 30;
        
        // Generar códigos de barras para cada producto
        let col = 0;
        let row = 0;
        
        for (const producto of productos) {
            try {
                // Calcular posición
                const x = margin + col * (codeWidth + margin);
                const y = 120 + row * (codeHeight + margin);
                
                // Si se pasa del ancho de la página, nueva fila
                if (x + codeWidth > doc.page.width) {
                    col = 0;
                    row++;
                }
                
                // Si se pasa del alto de la página, nueva página
                if (y + codeHeight > doc.page.height) {
                    doc.addPage();
                    row = 0;
                    col = 0;
                }
                
                // Generar el código de barras
                const codigo = producto.codigo || producto.id?.toString() || '0000000000000';
                const barcodeImage = await generateBarcode(codigo, 'code128');
                
                // Convertir data URL a Buffer
                const imageData = barcodeImage.split(',')[1];
                const imageBuffer = Buffer.from(imageData, 'base64');
                
                // Añadir el código al documento
                doc.image(imageBuffer, x, y, { width: codeWidth - 20, height: 80 });
                
                // Añadir información del producto
                doc.fontSize(10)
                   .font('Helvetica')
                   .text(producto.nombre || 'Producto sin nombre', x, y + 85, { width: codeWidth - 20, align: 'center' })
                   .text(`Código: ${codigo}`, x, y + 100, { width: codeWidth - 20, align: 'center' });
                
                // Avanzar a la siguiente columna
                col++;
                
                // Si se llega al final de la fila, pasar a la siguiente
                if (col >= columns) {
                    col = 0;
                    row++;
                }
            } catch (error) {
                logger.warn(`Error al generar código para producto ${producto.id || '?'}: ${error.message}`);
                // Continuar con el siguiente producto
            }
        }
        
        // Finalizar documento
        doc.end();
        
        return await new Promise((resolve) => {
            // Esperar a que termine de procesar el documento
            doc.on('end', () => {
                resolve(finalCallback());
            });
        });
    } catch (error) {
        logger.error(`Error al exportar códigos de barras: ${error.message}`, error);
        throw new Error(`Error al exportar códigos de barras: ${error.message}`);
    }
}

/**
 * Combina múltiples PDFs en uno solo
 * @param {Array<Buffer|string>} pdfFiles - Lista de buffers o rutas de PDFs
 * @param {string} outputPath - Ruta donde guardar el PDF combinado (opcional)
 * @returns {Promise<Buffer|string>} - Buffer del PDF combinado o ruta del archivo guardado
 */
async function combinarPDFs(pdfFiles, outputPath = null) {
    try {
        // Validar que haya archivos para combinar
        if (!pdfFiles || !Array.isArray(pdfFiles) || pdfFiles.length === 0) {
            throw new Error('No se proporcionaron archivos PDF para combinar');
        }
        
        // Usar PDFKit para crear un nuevo documento
        const doc = new PDFDocument();
        
        // Si hay ruta de salida, crear stream de escritura
        let finalCallback;
        if (outputPath) {
            const stream = fs.createWriteStream(outputPath);
            doc.pipe(stream);
            finalCallback = () => {
                stream.end();
                logger.info(`PDF combinado guardado en: ${outputPath}`);
                return outputPath;
            };
        } else {
            // Si no hay ruta, devolver buffer
            const chunks = [];
            doc.on('data', (chunk) => chunks.push(chunk));
            finalCallback = () => Buffer.concat(chunks);
        }
        
        // Por ahora, este método es un placeholder
        // La combinación real de PDFs requiere bibliotecas adicionales como pdf-lib
        // que permiten manipular PDFs a nivel más bajo
        
        doc.fontSize(16)
           .text('Este es un documento combinado', { align: 'center' })
           .moveDown()
           .fontSize(12)
           .text('La funcionalidad de combinación de PDFs no está completamente implementada.', { align: 'center' })
           .moveDown()
           .text(`Se solicitó combinar ${pdfFiles.length} archivos.`, { align: 'center' });
        
        // Finalizar documento
        doc.end();
        
        return await new Promise((resolve) => {
            // Esperar a que termine de procesar el documento
            doc.on('end', () => {
                resolve(finalCallback());
            });
        });
    } catch (error) {
        logger.error(`Error al combinar PDFs: ${error.message}`, error);
        throw new Error(`Error al combinar PDFs: ${error.message}`);
    }
}

// Exportar todas las funciones
module.exports = {
    generatePDFFromTemplate,
    generarFacturaPDF,
    generarRemitoPDF,
    generarNotaPDF,
    generarReportePDF,
    generarPDFDesdeHTML,
    generarCertificadoPDF,
    exportarCodigosBarrasPDF,
    combinarPDFs,
    generateQRCode,
    generateBarcode
};