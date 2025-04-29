/**
 * FactuSystem - Módulo de mensajes de WhatsApp
 * 
 * Este módulo maneja la integración con WhatsApp Business API para:
 * - Envío de documentos (facturas, remitos, presupuestos)
 * - Envío de notificaciones personalizadas
 * - Envío de ofertas y promociones
 * - Respuestas automáticas básicas
 * 
 * @module integrations/whatsapp/mensajes
 * @requires electron
 * @requires path
 * @requires axios
 * @requires fs
 */

const { app } = require('electron');
const path = require('path');
const axios = require('axios');
const fs = require('fs');
const { ipcMain } = require('electron');
const logger = require('../../services/audit/logger.js');
const configManager = require('../../app/assets/js/modules/configuraciones/integraciones/whatsapp.js');
const { generarTextoFactura } = require('./templates.js');
const { generarPDF } = require('../../services/print/pdf.js');
const database = require('../../app/assets/js/utils/database.js');

// Configuración de WhatsApp API
let apiConfig = null;

/**
 * Inicializa la configuración de WhatsApp API
 * @returns {Promise<Object>} Configuración de la API
 */
async function initConfig() {
    try {
        apiConfig = await configManager.getWhatsAppConfig();
        
        if (!apiConfig || !apiConfig.apiKey || !apiConfig.phoneNumberId) {
            logger.warn('WhatsApp API no configurada correctamente');
            return null;
        }
        
        return apiConfig;
    } catch (error) {
        logger.error('Error al inicializar la configuración de WhatsApp', error);
        throw new Error('No se pudo inicializar la configuración de WhatsApp');
    }
}

/**
 * Formatea un número de teléfono para WhatsApp
 * @param {string} phone Número de teléfono 
 * @returns {string} Número formateado
 */
function formatearNumeroTelefono(phone) {
    // Eliminar caracteres no numéricos
    let clean = phone.replace(/\D/g, '');
    
    // Verificar si tiene código de país
    if (!clean.startsWith('54')) {
        clean = '54' + clean;
    }
    
    // Asegurarse que el formato sea correcto
    if (clean.length === 12 && clean.startsWith('549')) {
        return clean;
    } else if (clean.length === 11 && clean.startsWith('54')) {
        return clean.replace(/^54/, '549');
    }
    
    return clean;
}

/**
 * Envía un mensaje de texto vía WhatsApp
 * @param {string} destinatario Número de teléfono del destinatario
 * @param {string} mensaje Contenido del mensaje
 * @returns {Promise<Object>} Respuesta de la API
 */
async function enviarMensajeTexto(destinatario, mensaje) {
    try {
        if (!apiConfig) {
            await initConfig();
            if (!apiConfig) return { error: 'WhatsApp no configurado' };
        }
        
        const numeroFormateado = formatearNumeroTelefono(destinatario);
        
        const response = await axios({
            method: 'POST',
            url: `https://graph.facebook.com/v16.0/${apiConfig.phoneNumberId}/messages`,
            headers: {
                'Authorization': `Bearer ${apiConfig.apiKey}`,
                'Content-Type': 'application/json'
            },
            data: {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: numeroFormateado,
                type: 'text',
                text: {
                    body: mensaje
                }
            }
        });
        
        logger.info(`Mensaje enviado a ${destinatario}`, { 
            tipo: 'whatsapp', 
            destinatario: numeroFormateado 
        });
        
        return {
            success: true,
            data: response.data
        };
    } catch (error) {
        logger.error('Error al enviar mensaje de WhatsApp', {
            error: error.message,
            destinatario
        });
        
        return {
            success: false,
            error: error.message || 'Error al enviar mensaje de WhatsApp'
        };
    }
}

/**
 * Envía un documento vía WhatsApp
 * @param {string} destinatario Número de teléfono del destinatario
 * @param {string} rutaDocumento Ruta al archivo del documento
 * @param {string} nombreDocumento Nombre del documento
 * @param {string} mensaje Mensaje adicional (opcional)
 * @returns {Promise<Object>} Respuesta de la API
 */
async function enviarDocumento(destinatario, rutaDocumento, nombreDocumento, mensaje = '') {
    try {
        if (!apiConfig) {
            await initConfig();
            if (!apiConfig) return { error: 'WhatsApp no configurado' };
        }
        
        const numeroFormateado = formatearNumeroTelefono(destinatario);
        
        // Verificar si el archivo existe
        if (!fs.existsSync(rutaDocumento)) {
            throw new Error(`El documento no existe: ${rutaDocumento}`);
        }
        
        // Leer el archivo y convertirlo a base64
        const archivo = fs.readFileSync(rutaDocumento);
        const archivoBase64 = archivo.toString('base64');
        
        // Determinar el MIME type
        let mimeType;
        if (rutaDocumento.endsWith('.pdf')) {
            mimeType = 'application/pdf';
        } else if (rutaDocumento.endsWith('.jpg') || rutaDocumento.endsWith('.jpeg')) {
            mimeType = 'image/jpeg';
        } else if (rutaDocumento.endsWith('.png')) {
            mimeType = 'image/png';
        } else {
            mimeType = 'application/octet-stream';
        }
        
        // Enviar mensaje con archivo adjunto
        const response = await axios({
            method: 'POST',
            url: `https://graph.facebook.com/v16.0/${apiConfig.phoneNumberId}/messages`,
            headers: {
                'Authorization': `Bearer ${apiConfig.apiKey}`,
                'Content-Type': 'application/json'
            },
            data: {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: numeroFormateado,
                type: 'document',
                document: {
                    filename: nombreDocumento,
                    caption: mensaje || nombreDocumento,
                    mime_type: mimeType,
                    id: archivoBase64
                }
            }
        });
        
        logger.info(`Documento enviado a ${destinatario}`, { 
            tipo: 'whatsapp', 
            destinatario: numeroFormateado,
            documento: nombreDocumento 
        });
        
        return {
            success: true,
            data: response.data
        };
    } catch (error) {
        logger.error('Error al enviar documento por WhatsApp', {
            error: error.message,
            destinatario,
            documento: nombreDocumento
        });
        
        return {
            success: false,
            error: error.message || 'Error al enviar documento por WhatsApp'
        };
    }
}

/**
 * Envía una factura vía WhatsApp al cliente
 * @param {Object} factura Datos de la factura
 * @param {string} numeroTelefono Número de teléfono del cliente
 * @returns {Promise<Object>} Resultado de la operación
 */
async function enviarFactura(factura, numeroTelefono) {
    try {
        // Generar el PDF de la factura
        const rutaTemporal = path.join(app.getPath('temp'), `factura_${factura.numeroFactura.replace(/\//g, '_')}.pdf`);
        
        await generarPDF(factura, 'factura', rutaTemporal);
        
        // Generar texto personalizado
        const mensajeTexto = generarTextoFactura(factura);
        
        // Enviar el documento
        const resultado = await enviarDocumento(
            numeroTelefono,
            rutaTemporal,
            `Factura ${factura.tipoComprobante} ${factura.numeroFactura}.pdf`,
            mensajeTexto
        );
        
        // Eliminar el archivo temporal
        setTimeout(() => {
            try {
                fs.unlinkSync(rutaTemporal);
            } catch (e) {
                logger.warn('No se pudo eliminar el archivo temporal', e);
            }
        }, 5000);
        
        return resultado;
    } catch (error) {
        logger.error('Error al enviar factura por WhatsApp', {
            error: error.message,
            factura: factura.numeroFactura,
            cliente: factura.cliente.nombre
        });
        
        return {
            success: false,
            error: error.message || 'Error al enviar factura por WhatsApp'
        };
    }
}

/**
 * Envía un presupuesto vía WhatsApp al cliente
 * @param {Object} presupuesto Datos del presupuesto
 * @param {string} numeroTelefono Número de teléfono del cliente
 * @returns {Promise<Object>} Resultado de la operación
 */
async function enviarPresupuesto(presupuesto, numeroTelefono) {
    try {
        // Generar el PDF del presupuesto
        const rutaTemporal = path.join(app.getPath('temp'), `presupuesto_${presupuesto.numeroPresupuesto.replace(/\//g, '_')}.pdf`);
        
        await generarPDF(presupuesto, 'presupuesto', rutaTemporal);
        
        // Mensaje personalizado
        const mensajeTexto = `Estimado/a ${presupuesto.cliente.nombre}, adjuntamos el presupuesto solicitado. ` +
            `Validez: ${presupuesto.validez || '15 días'}. Cualquier consulta, estamos a su disposición.`;
        
        // Enviar el documento
        const resultado = await enviarDocumento(
            numeroTelefono,
            rutaTemporal,
            `Presupuesto ${presupuesto.numeroPresupuesto}.pdf`,
            mensajeTexto
        );
        
        // Eliminar el archivo temporal
        setTimeout(() => {
            try {
                fs.unlinkSync(rutaTemporal);
            } catch (e) {
                logger.warn('No se pudo eliminar el archivo temporal', e);
            }
        }, 5000);
        
        return resultado;
    } catch (error) {
        logger.error('Error al enviar presupuesto por WhatsApp', {
            error: error.message,
            presupuesto: presupuesto.numeroPresupuesto,
            cliente: presupuesto.cliente.nombre
        });
        
        return {
            success: false,
            error: error.message || 'Error al enviar presupuesto por WhatsApp'
        };
    }
}

/**
 * Envía un recordatorio de pago pendiente
 * @param {Object} cliente Datos del cliente
 * @param {Array} facturasPendientes Lista de facturas pendientes
 * @returns {Promise<Object>} Resultado de la operación
 */
async function enviarRecordatorioPago(cliente, facturasPendientes) {
    if (!cliente.telefono) {
        return { success: false, error: 'Cliente sin número de teléfono' };
    }
    
    let mensaje = `Estimado/a ${cliente.nombre}, le recordamos que tiene ${facturasPendientes.length} ` +
        `factura${facturasPendientes.length > 1 ? 's' : ''} pendiente${facturasPendientes.length > 1 ? 's' : ''} de pago:\n\n`;
    
    facturasPendientes.forEach((factura, index) => {
        mensaje += `${index + 1}. Factura ${factura.tipoComprobante} ${factura.numeroFactura} - Vencimiento: ${factura.fechaVencimiento} - Total: $${factura.total}\n`;
    });
    
    mensaje += '\nPuede realizar el pago a través de nuestros canales habituales. Por consultas, no dude en contactarnos.';
    
    return await enviarMensajeTexto(cliente.telefono, mensaje);
}

/**
 * Envía una oferta personalizada a un cliente
 * @param {Object} cliente Datos del cliente
 * @param {Object} oferta Detalles de la oferta
 * @returns {Promise<Object>} Resultado de la operación
 */
async function enviarOfertaPersonalizada(cliente, oferta) {
    if (!cliente.telefono) {
        return { success: false, error: 'Cliente sin número de teléfono' };
    }
    
    let mensaje = `¡Hola ${cliente.nombre}! Tenemos una oferta especial para ti:\n\n` +
        `${oferta.titulo}\n` +
        `${oferta.descripcion}\n\n` +
        `Validez: ${oferta.validez || '7 días'}\n\n` +
        `Para más información, contacta con nosotros.`;
    
    // Si hay una imagen, enviarla junto con el mensaje
    if (oferta.rutaImagen && fs.existsSync(oferta.rutaImagen)) {
        try {
            const rutaImagen = oferta.rutaImagen;
            const nombreImagen = path.basename(rutaImagen);
            
            return await enviarDocumento(cliente.telefono, rutaImagen, nombreImagen, mensaje);
        } catch (error) {
            logger.error('Error al enviar imagen de oferta', error);
            // Si falla el envío de la imagen, intentar enviar solo el texto
            return await enviarMensajeTexto(cliente.telefono, mensaje);
        }
    } else {
        return await enviarMensajeTexto(cliente.telefono, mensaje);
    }
}

/**
 * Envía notificación de estado de pedido
 * @param {Object} pedido Datos del pedido
 * @param {string} estado Nuevo estado del pedido
 * @returns {Promise<Object>} Resultado de la operación
 */
async function enviarNotificacionEstadoPedido(pedido, estado) {
    if (!pedido.cliente || !pedido.cliente.telefono) {
        return { success: false, error: 'Cliente sin número de teléfono' };
    }
    
    let mensaje = `¡Hola ${pedido.cliente.nombre}! Le informamos que su pedido #${pedido.numeroPedido} `;
    
    switch (estado.toLowerCase()) {
        case 'confirmado':
            mensaje += 'ha sido confirmado y está siendo procesado.';
            break;
        case 'preparacion':
            mensaje += 'está en preparación.';
            break;
        case 'listo':
            mensaje += 'está listo para ser retirado.';
            break;
        case 'enviado':
            mensaje += `ha sido enviado. ${pedido.trackingNumber ? `Tracking: ${pedido.trackingNumber}` : ''}`;
            break;
        case 'entregado':
            mensaje += 'ha sido entregado. ¡Gracias por su compra!';
            break;
        default:
            mensaje += `ha cambiado su estado a: ${estado}.`;
    }
    
    mensaje += '\n\nPara cualquier consulta, no dude en contactarnos.';
    
    return await enviarMensajeTexto(pedido.cliente.telefono, mensaje);
}

/**
 * Envía mensaje de felicitación por cumpleaños
 * @param {Object} cliente Datos del cliente
 * @returns {Promise<Object>} Resultado de la operación
 */
async function enviarFelicitacionCumpleanos(cliente) {
    if (!cliente.telefono) {
        return { success: false, error: 'Cliente sin número de teléfono' };
    }
    
    let mensaje = `¡Feliz cumpleaños, ${cliente.nombre}!\n\n` +
        `Queremos celebrar este día especial contigo y ofrecerte un ${cliente.descuentoCumpleanos || 10}% de descuento ` +
        `en tu próxima compra. El código de descuento es: CUMPLE${new Date().getFullYear()}${cliente.id}\n\n` +
        `¡Válido por 7 días! Esperamos verte pronto.`;
    
    return await enviarMensajeTexto(cliente.telefono, mensaje);
}

/**
 * Envía plantilla de respuesta automática 
 * @param {string} tipo Tipo de respuesta
 * @param {Object} datos Datos para personalizar la respuesta
 * @param {string} numeroTelefono Número de teléfono del destinatario
 * @returns {Promise<Object>} Resultado de la operación
 */
async function enviarRespuestaAutomatica(tipo, datos, numeroTelefono) {
    // Obtener la plantilla del tipo especificado
    const plantillas = {
        consultaStock: `Estimado/a cliente, el producto ${datos.producto} ${datos.disponible ? 'está disponible' : 'no está disponible actualmente'}. ${datos.disponible ? `Precio: $${datos.precio}` : 'Le notificaremos cuando esté disponible nuevamente.'}`,
        
        consultaHorario: 'Nuestro horario de atención es de lunes a viernes de 9:00 a 18:00 y sábados de 9:00 a 13:00. ¡Gracias por contactarnos!',
        
        consultaUbicacion: 'Nos encontramos en [DIRECCIÓN DE LA EMPRESA]. Puede visitarnos en nuestro horario de atención. ¡Lo esperamos!',
        
        agradecimiento: `¡Gracias por su ${datos.tipo || 'compra'}! Es un placer poder servirle. No dude en contactarnos ante cualquier consulta.`,
        
        predeterminada: `Gracias por comunicarse con nosotros. Un representante se pondrá en contacto con usted a la brevedad.`
    };
    
    const mensaje = plantillas[tipo] || plantillas.predeterminada;
    
    return await enviarMensajeTexto(numeroTelefono, mensaje);
}

/**
 * Procesa webhooks entrantes de WhatsApp
 * @param {Object} payload Datos del webhook
 * @returns {Promise<Object>} Resultado del procesamiento
 */
async function procesarWebhook(payload) {
    try {
        // Verificar estructura del payload
        if (!payload || !payload.entry || !payload.entry[0] || !payload.entry[0].changes) {
            return { success: false, error: 'Estructura de webhook inválida' };
        }
        
        const changes = payload.entry[0].changes;
        
        for (const change of changes) {
            if (change.field === 'messages' && change.value && change.value.messages) {
                for (const message of change.value.messages) {
                    // Procesar solo mensajes de texto
                    if (message.type === 'text' && message.text && message.text.body) {
                        const remitente = message.from;
                        const texto = message.text.body.toLowerCase();
                        
                        // Buscar si es un cliente existente
                        const db = await database.getConnection();
                        const cliente = await db.get(
                            'SELECT * FROM clientes WHERE telefono LIKE ?',
                            [`%${remitente.slice(-10)}%`]
                        );
                        
                        // Identificar tipo de consulta para respuesta automática
                        let tipoRespuesta = 'predeterminada';
                        let datosRespuesta = {};
                        
                        if (texto.includes('stock') || texto.includes('disponible') || texto.includes('tienen')) {
                            tipoRespuesta = 'consultaStock';
                            
                            // Intentar identificar producto
                            const palabrasClave = texto.split(' ');
                            const productosCoincidentes = await db.all(
                                'SELECT * FROM productos WHERE nombre LIKE ? OR descripcion LIKE ? LIMIT 1',
                                [`%${palabrasClave[palabrasClave.length - 1]}%`, `%${palabrasClave[palabrasClave.length - 1]}%`]
                            );
                            
                            if (productosCoincidentes && productosCoincidentes.length > 0) {
                                const producto = productosCoincidentes[0];
                                datosRespuesta = {
                                    producto: producto.nombre,
                                    disponible: producto.stock > 0,
                                    precio: producto.precio
                                };
                            } else {
                                // Si no se identifica producto, respuesta genérica
                                await enviarMensajeTexto(
                                    remitente,
                                    'Gracias por su consulta. Para verificar stock de productos específicos, por favor especifique el nombre del producto o visite nuestra tienda.'
                                );
                                continue;
                            }
                        } else if (texto.includes('horario') || texto.includes('atienden') || texto.includes('abierto')) {
                            tipoRespuesta = 'consultaHorario';
                        } else if (texto.includes('ubicacion') || texto.includes('direccion') || texto.includes('donde')) {
                            tipoRespuesta = 'consultaUbicacion';
                        } else if (texto.includes('gracias') || texto.includes('agradezco')) {
                            tipoRespuesta = 'agradecimiento';
                            datosRespuesta = { tipo: 'consulta' };
                        }
                        
                        // Enviar respuesta automática
                        await enviarRespuestaAutomatica(tipoRespuesta, datosRespuesta, remitente);
                        
                        // Registrar interacción en la base de datos
                        if (cliente) {
                            await db.run(
                                'INSERT INTO interacciones_clientes (cliente_id, tipo, descripcion, fecha) VALUES (?, ?, ?, ?)',
                                [cliente.id, 'whatsapp', `Mensaje entrante: ${texto}`, new Date().toISOString()]
                            );
                        }
                    }
                }
            }
        }
        
        return { success: true };
    } catch (error) {
        logger.error('Error al procesar webhook de WhatsApp', error);
        return { success: false, error: error.message };
    }
}

/**
 * Registra los eventos IPC para la comunicación con el proceso de renderizado
 */
function registrarEventosIPC() {
    // Envío de mensajes de texto
    ipcMain.handle('whatsapp:enviar-mensaje', async (event, destinatario, mensaje) => {
        return await enviarMensajeTexto(destinatario, mensaje);
    });
    
    // Envío de documentos
    ipcMain.handle('whatsapp:enviar-documento', async (event, destinatario, rutaDocumento, nombreDocumento, mensaje) => {
        return await enviarDocumento(destinatario, rutaDocumento, nombreDocumento, mensaje);
    });
    
    // Envío de facturas
    ipcMain.handle('whatsapp:enviar-factura', async (event, factura, numeroTelefono) => {
        return await enviarFactura(factura, numeroTelefono);
    });
    
    // Envío de presupuestos
    ipcMain.handle('whatsapp:enviar-presupuesto', async (event, presupuesto, numeroTelefono) => {
        return await enviarPresupuesto(presupuesto, numeroTelefono);
    });
    
    // Envío de ofertas personalizadas
    ipcMain.handle('whatsapp:enviar-oferta', async (event, cliente, oferta) => {
        return await enviarOfertaPersonalizada(cliente, oferta);
    });
    
    // Envío de recordatorios de pago
    ipcMain.handle('whatsapp:enviar-recordatorio', async (event, cliente, facturasPendientes) => {
        return await enviarRecordatorioPago(cliente, facturasPendientes);
    });
    
    // Envío de notificaciones de estado de pedido
    ipcMain.handle('whatsapp:notificar-pedido', async (event, pedido, estado) => {
        return await enviarNotificacionEstadoPedido(pedido, estado);
    });
    
    // Envío de felicitación de cumpleaños
    ipcMain.handle('whatsapp:felicitar-cumpleanos', async (event, cliente) => {
        return await enviarFelicitacionCumpleanos(cliente);
    });
    
    // Consultar configuración actual
    ipcMain.handle('whatsapp:get-config', async () => {
        return await initConfig();
    });
}

/**
 * Inicializa el módulo de WhatsApp
 */
function inicializar() {
    // Inicializar configuración
    initConfig()
        .then(config => {
            if (config) {
                logger.info('Módulo de WhatsApp inicializado correctamente');
            } else {
                logger.warn('Módulo de WhatsApp no configurado');
            }
        })
        .catch(error => {
            logger.error('Error al inicializar módulo de WhatsApp', error);
        });
    
    // Registrar eventos IPC
    registrarEventosIPC();
}

// Exportar funciones públicas
module.exports = {
    inicializar,
    enviarMensajeTexto,
    enviarDocumento,
    enviarFactura,
    enviarPresupuesto,
    enviarRecordatorioPago,
    enviarOfertaPersonalizada,
    enviarNotificacionEstadoPedido,
    enviarFelicitacionCumpleanos,
    enviarRespuestaAutomatica,
    procesarWebhook,
    formatearNumeroTelefono
};