/**
 * @file api.js
 * @description API para integración con WhatsApp Business para envío de documentos y mensajes
 * @module integrations/whatsapp
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');
const logger = require('../../services/audit/logger.js');
const { getConfiguracion } = require('../../db/schema.js');
const { generarPDF } = require('../../services/print/pdf.js');

// Configuración por defecto
let config = {
  apiUrl: 'https://graph.facebook.com/v17.0',
  phoneNumberId: '',
  accessToken: '',
  businessAccountId: '',
  templateNamespace: '',
  verificado: false, // Indica si la cuenta está verificada para usar templates personalizados
  templates: [],
  lastSync: null,
  maxRetries: 3,
  retryDelay: 5000,
};

/**
 * Inicializa la API de WhatsApp con la configuración almacenada
 * @async
 * @returns {Promise<Object>} Configuración actual
 */
async function inicializar() {
  try {
    const configuracion = await getConfiguracion('whatsapp');
    if (configuracion) {
      config = { ...config, ...configuracion };
      
      // Sincronizar templates disponibles si hay token configurado
      if (config.accessToken && config.businessAccountId) {
        await sincronizarTemplates();
      }
      
      logger.info('Integración WhatsApp inicializada correctamente');
    } else {
      logger.warn('Configuración de WhatsApp no encontrada, usando valores por defecto');
    }
    return config;
  } catch (error) {
    logger.error('Error al inicializar la API de WhatsApp', error);
    throw new Error('No se pudo inicializar la integración de WhatsApp');
  }
}

/**
 * Establece la configuración de la API
 * @async
 * @param {Object} configuracion - Nuevos valores de configuración
 * @returns {Promise<Object>} Configuración actualizada
 */
async function configurar(configuracion) {
  try {
    config = { ...config, ...configuracion };
    
    // Validar la configuración
    const esValida = await validarConfiguracion();
    config.verificado = esValida;
    
    // Si es válida, sincronizar templates
    if (esValida) {
      await sincronizarTemplates();
    }
    
    logger.info('Configuración de WhatsApp actualizada');
    return config;
  } catch (error) {
    logger.error('Error al configurar la API de WhatsApp', error);
    throw new Error('No se pudo actualizar la configuración de WhatsApp');
  }
}

/**
 * Valida que la configuración de la API sea correcta
 * @async
 * @returns {Promise<boolean>} Indica si la configuración es válida
 */
async function validarConfiguracion() {
  try {
    if (!config.accessToken || !config.phoneNumberId || !config.businessAccountId) {
      return false;
    }
    
    // Intenta hacer una llamada a la API para validar las credenciales
    const response = await axios.get(
      `${config.apiUrl}/${config.phoneNumberId}?fields=status,quality`,
      {
        headers: {
          'Authorization': `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    return response.status === 200;
  } catch (error) {
    logger.error('Error al validar configuración de WhatsApp', error);
    return false;
  }
}

/**
 * Sincroniza los templates disponibles desde la cuenta de WhatsApp Business
 * @async
 * @returns {Promise<Array>} Lista de templates disponibles
 */
async function sincronizarTemplates() {
  try {
    if (!config.accessToken || !config.businessAccountId) {
      throw new Error('Configuración de WhatsApp incompleta');
    }
    
    const response = await axios.get(
      `${config.apiUrl}/${config.businessAccountId}/message_templates?limit=100`,
      {
        headers: {
          'Authorization': `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (response.data && response.data.data) {
      config.templates = response.data.data.map(template => ({
        id: template.id,
        name: template.name,
        language: template.language,
        status: template.status,
        category: template.category,
        components: template.components
      }));
      
      config.lastSync = new Date().toISOString();
      logger.info(`Templates de WhatsApp sincronizados: ${config.templates.length} encontrados`);
    }
    
    return config.templates;
  } catch (error) {
    logger.error('Error al sincronizar templates de WhatsApp', error);
    throw new Error('No se pudieron obtener los templates de WhatsApp');
  }
}

/**
 * Envía un mensaje de texto simple a un número de WhatsApp
 * @async
 * @param {string} telefono - Número de teléfono del destinatario (formato internacional sin +)
 * @param {string} mensaje - Texto del mensaje a enviar
 * @returns {Promise<Object>} Respuesta de la API
 */
async function enviarMensaje(telefono, mensaje) {
  try {
    if (!validarTelefono(telefono)) {
      throw new Error('Número de teléfono inválido');
    }

    const response = await axios.post(
      `${config.apiUrl}/${config.phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: telefono,
        type: 'text',
        text: {
          body: mensaje
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    logger.info(`Mensaje enviado a ${telefono}`, { messageId: response.data.messages[0].id });
    return response.data;
  } catch (error) {
    logger.error(`Error al enviar mensaje a ${telefono}`, error);
    throw new Error('No se pudo enviar el mensaje de WhatsApp');
  }
}

/**
 * Envía un documento como PDF a un número de WhatsApp
 * @async
 * @param {string} telefono - Número de teléfono del destinatario (formato internacional sin +)
 * @param {string} nombreArchivo - Nombre del archivo a enviar
 * @param {string} rutaArchivo - Ruta completa al archivo PDF
 * @param {string} [caption=''] - Texto adicional que acompaña al documento
 * @returns {Promise<Object>} Respuesta de la API
 */
async function enviarDocumentoPDF(telefono, nombreArchivo, rutaArchivo, caption = '') {
  try {
    if (!validarTelefono(telefono)) {
      throw new Error('Número de teléfono inválido');
    }
    
    if (!fs.existsSync(rutaArchivo)) {
      throw new Error('El archivo no existe');
    }
    
    // Convertir el archivo a base64
    const archivoBase64 = fs.readFileSync(rutaArchivo).toString('base64');
    
    const response = await axios.post(
      `${config.apiUrl}/${config.phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: telefono,
        type: 'document',
        document: {
          filename: nombreArchivo,
          caption: caption,
          link: `data:application/pdf;base64,${archivoBase64}`
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json'
        },
        maxBodyLength: Infinity
      }
    );
    
    logger.info(`Documento enviado a ${telefono}`, { 
      messageId: response.data.messages[0].id,
      fileName: nombreArchivo
    });
    return response.data;
  } catch (error) {
    logger.error(`Error al enviar documento a ${telefono}`, error);
    throw new Error('No se pudo enviar el documento por WhatsApp');
  }
}

/**
 * Envía una factura generada en el sistema por WhatsApp
 * @async
 * @param {string} telefono - Número de teléfono del destinatario (formato internacional sin +)
 * @param {Object} factura - Datos de la factura a enviar
 * @param {string} [mensaje] - Mensaje personalizado a enviar con la factura
 * @returns {Promise<Object>} Respuesta de la API
 */
async function enviarFactura(telefono, factura, mensaje) {
  try {
    if (!validarTelefono(telefono)) {
      throw new Error('Número de teléfono inválido');
    }
    
    // Generar PDF de la factura
    const nombreArchivo = `Factura_${factura.tipoComprobante}_${factura.numero}.pdf`;
    const carpetaTemporal = path.join(process.cwd(), 'temp');
    
    // Asegurar que exista la carpeta temporal
    if (!fs.existsSync(carpetaTemporal)) {
      fs.mkdirSync(carpetaTemporal, { recursive: true });
    }
    
    const rutaArchivo = path.join(carpetaTemporal, nombreArchivo);
    
    // Generar el PDF
    await generarPDF({
      tipo: 'factura',
      datos: factura,
      rutaDestino: rutaArchivo,
      formato: 'a4' // Formato preferido para enviar por WhatsApp
    });
    
    // Texto por defecto
    const textoMensaje = mensaje || 
      `Hola! Te enviamos la factura ${factura.tipoComprobante} N° ${factura.numero} por un total de $${factura.total.toFixed(2)}. Gracias por tu compra!`;
    
    // Enviar el documento
    const respuesta = await enviarDocumentoPDF(
      telefono, 
      nombreArchivo, 
      rutaArchivo, 
      textoMensaje
    );
    
    // Eliminar archivo temporal
    fs.unlinkSync(rutaArchivo);
    
    return respuesta;
  } catch (error) {
    logger.error(`Error al enviar factura por WhatsApp a ${telefono}`, error);
    throw new Error('No se pudo enviar la factura por WhatsApp');
  }
}

/**
 * Envía un comprobante de pago por WhatsApp
 * @async
 * @param {string} telefono - Número de teléfono del destinatario (formato internacional sin +)
 * @param {Object} pago - Datos del pago realizado
 * @returns {Promise<Object>} Respuesta de la API
 */
async function enviarComprobantePago(telefono, pago) {
  try {
    if (!validarTelefono(telefono)) {
      throw new Error('Número de teléfono inválido');
    }
    
    // Generar PDF del comprobante
    const nombreArchivo = `Comprobante_Pago_${pago.id}.pdf`;
    const carpetaTemporal = path.join(process.cwd(), 'temp');
    
    // Asegurar que exista la carpeta temporal
    if (!fs.existsSync(carpetaTemporal)) {
      fs.mkdirSync(carpetaTemporal, { recursive: true });
    }
    
    const rutaArchivo = path.join(carpetaTemporal, nombreArchivo);
    
    // Generar el PDF
    await generarPDF({
      tipo: 'comprobante',
      datos: pago,
      rutaDestino: rutaArchivo,
      formato: 'a4'
    });
    
    // Texto del mensaje
    const textoMensaje = `Hola! Te enviamos el comprobante de pago por $${pago.monto.toFixed(2)}. Gracias por tu compra!`;
    
    // Enviar el documento
    const respuesta = await enviarDocumentoPDF(
      telefono, 
      nombreArchivo, 
      rutaArchivo, 
      textoMensaje
    );
    
    // Eliminar archivo temporal
    fs.unlinkSync(rutaArchivo);
    
    return respuesta;
  } catch (error) {
    logger.error(`Error al enviar comprobante de pago por WhatsApp a ${telefono}`, error);
    throw new Error('No se pudo enviar el comprobante de pago por WhatsApp');
  }
}

/**
 * Envía un mensaje usando una plantilla predefinida en WhatsApp Business
 * @async
 * @param {string} telefono - Número de teléfono del destinatario (formato internacional sin +)
 * @param {string} nombreTemplate - Nombre de la plantilla a utilizar
 * @param {string} idioma - Código de idioma (ej: 'es' para español)
 * @param {Array} componentes - Componentes de la plantilla con sus valores
 * @returns {Promise<Object>} Respuesta de la API
 */
async function enviarMensajeTemplate(telefono, nombreTemplate, idioma = 'es', componentes = []) {
  try {
    if (!validarTelefono(telefono)) {
      throw new Error('Número de teléfono inválido');
    }

    // Verificar si existe el template
    const templateExiste = config.templates.some(t => 
      t.name === nombreTemplate && t.language === idioma
    );
    
    if (!templateExiste) {
      throw new Error(`No se encontró el template "${nombreTemplate}" para el idioma "${idioma}"`);
    }
    
    const response = await axios.post(
      `${config.apiUrl}/${config.phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: telefono,
        type: 'template',
        template: {
          name: nombreTemplate,
          language: {
            code: idioma
          },
          components: componentes
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    logger.info(`Mensaje template "${nombreTemplate}" enviado a ${telefono}`, { 
      messageId: response.data.messages[0].id 
    });
    return response.data;
  } catch (error) {
    logger.error(`Error al enviar mensaje template a ${telefono}`, error);
    throw new Error('No se pudo enviar el mensaje template por WhatsApp');
  }
}

/**
 * Envía una oferta personalizada a un cliente
 * @async
 * @param {string} telefono - Número de teléfono del destinatario
 * @param {Object} oferta - Datos de la oferta
 * @returns {Promise<Object>} Respuesta de la API
 */
async function enviarOfertaPersonalizada(telefono, oferta) {
  try {
    // Preparar componentes para el template
    const componentes = [
      {
        type: "header",
        parameters: [
          {
            type: "image",
            image: {
              link: oferta.imagenUrl || "https://tudominio.com/logo.png"
            }
          }
        ]
      },
      {
        type: "body",
        parameters: [
          {
            type: "text",
            text: oferta.cliente.nombre || "cliente"
          },
          {
            type: "text",
            text: oferta.descripcion || "productos seleccionados"
          },
          {
            type: "text",
            text: oferta.descuento.toString() || "10"
          },
          {
            type: "text",
            text: oferta.fechaVencimiento || "la próxima semana"
          }
        ]
      }
    ];
    
    // Enviar usando el template de ofertas
    return await enviarMensajeTemplate(
      telefono,
      'oferta_personalizada',
      'es',
      componentes
    );
  } catch (error) {
    logger.error(`Error al enviar oferta personalizada a ${telefono}`, error);
    throw new Error('No se pudo enviar la oferta personalizada');
  }
}

/**
 * Envía una notificación sobre el estado de un pedido
 * @async
 * @param {string} telefono - Número de teléfono del destinatario
 * @param {Object} pedido - Datos del pedido
 * @param {string} estado - Estado actual del pedido
 * @returns {Promise<Object>} Respuesta de la API
 */
async function enviarNotificacionEstadoPedido(telefono, pedido, estado) {
  try {
    // Estados válidos
    const estadosValidos = ['preparado', 'enviado', 'entregado', 'cancelado'];
    
    if (!estadosValidos.includes(estado.toLowerCase())) {
      throw new Error('Estado de pedido no válido');
    }
    
    // Preparar componentes para el template
    const componentes = [
      {
        type: "body",
        parameters: [
          {
            type: "text",
            text: pedido.cliente.nombre || "cliente"
          },
          {
            type: "text",
            text: pedido.numero || "000000"
          },
          {
            type: "text",
            text: estado
          }
        ]
      }
    ];
    
    // Enviar usando el template de estado de pedido
    return await enviarMensajeTemplate(
      telefono,
      'estado_pedido',
      'es',
      componentes
    );
  } catch (error) {
    logger.error(`Error al enviar notificación de estado de pedido a ${telefono}`, error);
    throw new Error('No se pudo enviar la notificación de estado del pedido');
  }
}

/**
 * Envía una consulta de stock a través del chatbot
 * @async
 * @param {string} telefono - Número de teléfono del destinatario
 * @param {string} consulta - Consulta realizada
 * @param {Object} resultado - Resultado de la consulta de stock
 * @returns {Promise<Object>} Respuesta de la API
 */
async function responderConsultaStock(telefono, consulta, resultado) {
  try {
    let mensaje;
    
    if (resultado.encontrado) {
      mensaje = `👋 Gracias por tu consulta sobre "${consulta}".\n\n`;
      mensaje += `✅ Producto: ${resultado.producto.nombre}\n`;
      mensaje += `💲 Precio: $${resultado.producto.precio.toFixed(2)}\n`;
      
      if (resultado.producto.stock > 0) {
        mensaje += `📦 Stock disponible: ${resultado.producto.stock} unidades`;
      } else {
        mensaje += "❌ Producto sin stock actualmente";
      }
      
      // Añadir sucursal si está disponible
      if (resultado.sucursal) {
        mensaje += `\n🏢 Sucursal: ${resultado.sucursal.nombre}`;
      }
    } else {
      mensaje = `👋 Gracias por tu consulta sobre "${consulta}".\n\n`;
      mensaje += "❌ No encontramos productos que coincidan con tu búsqueda.\n";
      mensaje += "🔍 Por favor intenta con otra descripción o contacta con nosotros directamente.";
    }
    
    return await enviarMensaje(telefono, mensaje);
  } catch (error) {
    logger.error(`Error al responder consulta de stock a ${telefono}`, error);
    throw new Error('No se pudo responder la consulta de stock');
  }
}

/**
 * Responde a consultas de precios a través del chatbot
 * @async
 * @param {string} telefono - Número de teléfono del destinatario
 * @param {string} consulta - Consulta realizada
 * @param {Array} resultados - Resultados de la consulta de precios
 * @returns {Promise<Object>} Respuesta de la API
 */
async function responderConsultaPrecios(telefono, consulta, resultados) {
  try {
    let mensaje;
    
    if (resultados.length > 0) {
      mensaje = `👋 Resultados para tu consulta "${consulta}":\n\n`;
      
      // Mostrar solo los primeros 5 resultados para no hacer el mensaje muy largo
      const productosAMostrar = resultados.slice(0, 5);
      
      productosAMostrar.forEach((prod, index) => {
        mensaje += `${index + 1}. ${prod.nombre}: $${prod.precio.toFixed(2)}\n`;
      });
      
      if (resultados.length > 5) {
        mensaje += `\n...y ${resultados.length - 5} productos más.`;
      }
    } else {
      mensaje = `👋 No encontramos resultados para tu consulta "${consulta}".\n`;
      mensaje += "🔍 Por favor intenta con otra descripción o contacta con nosotros directamente.";
    }
    
    return await enviarMensaje(telefono, mensaje);
  } catch (error) {
    logger.error(`Error al responder consulta de precios a ${telefono}`, error);
    throw new Error('No se pudo responder la consulta de precios');
  }
}

/**
 * Registra un webhook entrante de WhatsApp
 * @async
 * @param {Object} data - Datos del webhook
 * @returns {Promise<Object>} Objeto procesado del webhook
 */
async function procesarWebhook(data) {
  try {
    if (!data || !data.entry || data.entry.length === 0) {
      logger.warn('Webhook recibido sin datos válidos');
      return { status: 'error', message: 'Datos inválidos' };
    }
    
    const entry = data.entry[0];
    if (!entry.changes || entry.changes.length === 0) {
      return { status: 'ignored', message: 'No hay cambios para procesar' };
    }
    
    const change = entry.changes[0];
    if (change.field !== 'messages') {
      return { status: 'ignored', message: 'No es un mensaje' };
    }
    
    const value = change.value;
    if (!value || !value.messages || value.messages.length === 0) {
      return { status: 'ignored', message: 'No hay mensajes' };
    }
    
    // Procesar cada mensaje
    const procesados = [];
    for (const message of value.messages) {
      const from = message.from;
      const timestamp = new Date(parseInt(message.timestamp) * 1000);
      
      let contenido = null;
      let tipo = message.type;
      
      // Extraer el contenido según el tipo de mensaje
      if (tipo === 'text') {
        contenido = message.text.body;
      } else if (tipo === 'image') {
        contenido = message.image;
      } else if (tipo === 'document') {
        contenido = message.document;
      } else if (tipo === 'location') {
        contenido = message.location;
      } else if (tipo === 'button') {
        contenido = message.button;
      }
      
      const mensajeProcesado = {
        id: message.id,
        from,
        timestamp,
        tipo,
        contenido,
        procesado: true
      };
      
      // Emitir evento para que otros componentes puedan responder
      // Por ejemplo, el chatbot que responderá consultas
      global.whatsappEvent.emit('mensaje-recibido', mensajeProcesado);
      
      procesados.push(mensajeProcesado);
      
      logger.info(`Mensaje de WhatsApp recibido de ${from}`, {
        messageId: message.id,
        type: tipo
      });
    }
    
    return {
      status: 'success',
      messages: procesados
    };
  } catch (error) {
    logger.error('Error al procesar webhook de WhatsApp', error);
    return { status: 'error', message: error.message };
  }
}

/**
 * Valida que un número de teléfono tenga el formato correcto
 * @param {string} telefono - Número a validar
 * @returns {boolean} Indica si el formato es válido
 */
function validarTelefono(telefono) {
  // Formato esperado: código de país + número, sin signos ni espacios
  // Ejemplos válidos: 5491112345678, 14155552671
  const regex = /^\d{10,15}$/;
  return regex.test(telefono);
}

/**
 * Formatea un número de teléfono al formato requerido por la API de WhatsApp
 * @param {string} telefono - Número a formatear
 * @returns {string} Número formateado
 */
function formatearTelefono(telefono) {
  // Eliminar todos los caracteres no numéricos
  let numeroLimpio = telefono.replace(/\D/g, '');
  
  // Asegurar que comience con el código de país
  if (numeroLimpio.length <= 10) {
    // Asumir que es un número argentino sin código
    numeroLimpio = `549${numeroLimpio}`;
  } else if (numeroLimpio.startsWith('0')) {
    // Convertir formato argentino (0xxx) a internacional
    numeroLimpio = `549${numeroLimpio.substring(1)}`;
  } else if (!numeroLimpio.startsWith('549') && !numeroLimpio.startsWith('1')) {
    // Si no comienza con 549 (Argentina) ni 1 (USA), asumir Argentina
    numeroLimpio = `549${numeroLimpio}`;
  }
  
  return numeroLimpio;
}

/**
 * Registra los eventos IPC para comunicación con el proceso de renderizado
 */
function registrarEventosIPC() {
  // Enviar mensaje simple
  ipcMain.handle('whatsapp:enviar-mensaje', async (event, { telefono, mensaje }) => {
    try {
      const telefonoFormateado = formatearTelefono(telefono);
      return await enviarMensaje(telefonoFormateado, mensaje);
    } catch (error) {
      logger.error('Error en IPC whatsapp:enviar-mensaje', error);
      throw error;
    }
  });
  
  // Enviar factura
  ipcMain.handle('whatsapp:enviar-factura', async (event, { telefono, factura, mensaje }) => {
    try {
      const telefonoFormateado = formatearTelefono(telefono);
      return await enviarFactura(telefonoFormateado, factura, mensaje);
    } catch (error) {
      logger.error('Error en IPC whatsapp:enviar-factura', error);
      throw error;
    }
  });
  
  // Enviar comprobante de pago
  ipcMain.handle('whatsapp:enviar-comprobante', async (event, { telefono, pago }) => {
    try {
      const telefonoFormateado = formatearTelefono(telefono);
      return await enviarComprobantePago(telefonoFormateado, pago);
    } catch (error) {
      logger.error('Error en IPC whatsapp:enviar-comprobante', error);
      throw error;
    }
  });
  
  // Enviar oferta personalizada
  ipcMain.handle('whatsapp:enviar-oferta', async (event, { telefono, oferta }) => {
    try {
      const telefonoFormateado = formatearTelefono(telefono);
      return await enviarOfertaPersonalizada(telefonoFormateado, oferta);
    } catch (error) {
      logger.error('Error en IPC whatsapp:enviar-oferta', error);
      throw error;
    }
  });
  
  // Enviar notificación de estado de pedido
  ipcMain.handle('whatsapp:notificar-estado-pedido', async (event, { telefono, pedido, estado }) => {
    try {
      const telefonoFormateado = formatearTelefono(telefono);
      return await enviarNotificacionEstadoPedido(telefonoFormateado, pedido, estado);
    } catch (error) {
      logger.error('Error en IPC whatsapp:notificar-estado-pedido', error);
      throw error;
    }
  });
  
  // Obtener configuración actual
  ipcMain.handle('whatsapp:obtener-config', async () => {
    try {
      return config;
    } catch (error) {
      logger.error('Error en IPC whatsapp:obtener-config', error);
      throw error;
    }
  });
  
  // Actualizar configuración
  ipcMain.handle('whatsapp:actualizar-config', async (event, configuracion) => {
    try {
      return await configurar(configuracion);
    } catch (error) {
      logger.error('Error en IPC whatsapp:actualizar-config', error);
      throw error;
    }
  });
  
  // Sincronizar templates disponibles
  ipcMain.handle('whatsapp:sincronizar-templates', async () => {
    try {
      return await sincronizarTemplates();
    } catch (error) {
      logger.error('Error en IPC whatsapp:sincronizar-templates', error);
      throw error;
    }
  });
}

// Exportar todas las funciones públicas
module.exports = {
  inicializar,
  configurar,
  validarConfiguracion,
  sincronizarTemplates,
  enviarMensaje,
  enviarDocumentoPDF,
  enviarFactura,
  enviarComprobantePago,
  enviarMensajeTemplate,
  enviarOfertaPersonalizada,
  enviarNotificacionEstadoPedido,
  responderConsultaStock,
  responderConsultaPrecios,
  procesarWebhook,
  validarTelefono,
  formatearTelefono,
  registrarEventosIPC
};