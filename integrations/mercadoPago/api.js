/**
 * Mercado Pago API Integration
 * 
 * Este módulo maneja todas las interacciones con la API de Mercado Pago,
 * incluyendo autenticación, manejo de pagos, verificación de transferencias
 * y procesamiento de notificaciones.
 * 
 * @module integrations/mercadoPago/api
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');
const logger = require('../../app/assets/js/utils/logger.js');
const database = require('../../app/assets/js/utils/database.js');
const configPath = path.join(__dirname, '../../config/mercadopago.json');

// Constantes para la API de Mercado Pago
const MP_API_BASE_URL = 'https://api.mercadopago.com/v1';
const MP_AUTH_URL = 'https://auth.mercadopago.com/oauth/token';

// Cache de credenciales para evitar leer del disco en cada operación
let cachedCredentials = null;

/**
 * Carga las credenciales de Mercado Pago desde el archivo de configuración
 * @returns {Object} Credenciales de Mercado Pago
 */
function loadCredentials() {
  if (cachedCredentials) return cachedCredentials;
  
  try {
    if (fs.existsSync(configPath)) {
      cachedCredentials = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return cachedCredentials;
    } else {
      logger.error('Archivo de configuración de Mercado Pago no encontrado');
      return null;
    }
  } catch (error) {
    logger.error('Error al cargar credenciales de Mercado Pago:', error);
    return null;
  }
}

/**
 * Guarda las credenciales de Mercado Pago en el archivo de configuración
 * @param {Object} credentials Credenciales a guardar
 * @returns {Boolean} Resultado de la operación
 */
function saveCredentials(credentials) {
  try {
    // Asegurarse de que el directorio existe
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(configPath, JSON.stringify(credentials, null, 2));
    cachedCredentials = credentials;
    return true;
  } catch (error) {
    logger.error('Error al guardar credenciales de Mercado Pago:', error);
    return false;
  }
}

/**
 * Obtiene un token de acceso para la API de Mercado Pago
 * @returns {Promise<string>} Token de acceso
 */
async function getAccessToken() {
  const credentials = loadCredentials();
  
  // Si tenemos un token válido, lo devolvemos
  if (credentials && credentials.access_token && credentials.expires_at) {
    const now = new Date();
    if (new Date(credentials.expires_at) > now) {
      return credentials.access_token;
    }
  }
  
  // Si no hay credenciales o el token expiró, obtenemos uno nuevo
  if (!credentials || !credentials.client_id || !credentials.client_secret) {
    throw new Error('Credenciales de Mercado Pago no configuradas');
  }
  
  try {
    const response = await axios.post(MP_AUTH_URL, {
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      grant_type: 'client_credentials'
    });
    
    const { access_token, expires_in } = response.data;
    
    // Calculamos la fecha de expiración y guardamos el token
    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + expires_in);
    
    const updatedCredentials = {
      ...credentials,
      access_token,
      expires_at: expiresAt.toISOString()
    };
    
    saveCredentials(updatedCredentials);
    return access_token;
  } catch (error) {
    logger.error('Error al obtener token de acceso de Mercado Pago:', error);
    throw new Error('No se pudo autenticar con Mercado Pago');
  }
}

/**
 * Verifica si las credenciales de Mercado Pago están configuradas y son válidas
 * @returns {Promise<Boolean>} Estado de las credenciales
 */
async function verifyCredentials() {
  try {
    await getAccessToken();
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Configura las credenciales de Mercado Pago
 * @param {Object} credentials Objeto con client_id y client_secret
 * @returns {Promise<Boolean>} Resultado de la operación
 */
async function configureCredentials(credentials) {
  try {
    // Validamos que las credenciales sean correctas intentando obtener un token
    const response = await axios.post(MP_AUTH_URL, {
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      grant_type: 'client_credentials'
    });
    
    const { access_token, expires_in } = response.data;
    
    // Calculamos la fecha de expiración
    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + expires_in);
    
    // Guardamos las credenciales con el token
    const newCredentials = {
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      access_token,
      expires_at: expiresAt.toISOString(),
      public_key: credentials.public_key || '',
      user_id: response.data.user_id || '',
      refresh_token: response.data.refresh_token || ''
    };
    
    return saveCredentials(newCredentials);
  } catch (error) {
    logger.error('Error al configurar credenciales de Mercado Pago:', error);
    return false;
  }
}

/**
 * Crea un QR de pago con un monto específico
 * @param {Number} amount Monto del pago
 * @param {String} description Descripción del pago
 * @param {String} external_reference Referencia externa (ID de factura)
 * @returns {Promise<Object>} Datos del QR creado
 */
async function createPaymentQR(amount, description, external_reference) {
  try {
    const accessToken = await getAccessToken();
    const credentials = loadCredentials();
    
    if (!credentials.user_id) {
      throw new Error('ID de usuario de Mercado Pago no configurado');
    }
    
    // Creamos un QR dinámico con preferencia de pago
    const preferenceResponse = await axios.post(
      `${MP_API_BASE_URL}/checkout/preferences`,
      {
        items: [{
          title: description || 'Pago FactuSystem',
          quantity: 1,
          unit_price: parseFloat(amount)
        }],
        external_reference,
        payment_methods: {
          excluded_payment_types: [
            { id: "ticket" },
            { id: "atm" }
          ]
        },
        expires: true,
        expiration_date_to: new Date(Date.now() + 30 * 60000).toISOString() // 30 minutos
      },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    return {
      id: preferenceResponse.data.id,
      init_point: preferenceResponse.data.init_point,
      qr_code_base64: await generateQRBase64(preferenceResponse.data.init_point),
      external_reference,
      amount
    };
  } catch (error) {
    logger.error('Error al crear QR de pago:', error);
    throw new Error('No se pudo crear el QR de pago');
  }
}

/**
 * Genera una imagen QR en Base64 a partir de una URL
 * @param {String} url URL a codificar en el QR
 * @returns {Promise<String>} Imagen QR en formato Base64
 */
async function generateQRBase64(url) {
  try {
    const QRCode = require('qrcode');
    return await QRCode.toDataURL(url, {
      errorCorrectionLevel: 'H',
      margin: 1,
      scale: 8
    });
  } catch (error) {
    logger.error('Error al generar QR en Base64:', error);
    throw new Error('No se pudo generar la imagen QR');
  }
}

/**
 * Verifica el estado de un pago por su ID
 * @param {String} payment_id ID del pago en Mercado Pago
 * @returns {Promise<Object>} Estado del pago
 */
async function checkPaymentStatus(payment_id) {
  try {
    const accessToken = await getAccessToken();
    
    const response = await axios.get(
      `${MP_API_BASE_URL}/payments/${payment_id}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      }
    );
    
    return {
      status: response.data.status,
      status_detail: response.data.status_detail,
      amount: response.data.transaction_amount,
      external_reference: response.data.external_reference,
      payment_method: response.data.payment_method_id,
      payment_type: response.data.payment_type_id,
      date_created: response.data.date_created,
      date_approved: response.data.date_approved
    };
  } catch (error) {
    logger.error('Error al verificar estado del pago:', error);
    throw new Error('No se pudo verificar el estado del pago');
  }
}

/**
 * Busca pagos recibidos en un período de tiempo
 * @param {Date} beginDate Fecha de inicio
 * @param {Date} endDate Fecha de fin
 * @returns {Promise<Array>} Lista de pagos encontrados
 */
async function searchPayments(beginDate, endDate) {
  try {
    const accessToken = await getAccessToken();
    
    // Formatear fechas para la API
    const begin_date = beginDate.toISOString().split('T')[0];
    const end_date = endDate.toISOString().split('T')[0];
    
    const response = await axios.get(
      `${MP_API_BASE_URL}/payments/search`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        },
        params: {
          begin_date,
          end_date,
          sort: 'date_created',
          criteria: 'desc'
        }
      }
    );
    
    return response.data.results.map(payment => ({
      id: payment.id,
      status: payment.status,
      amount: payment.transaction_amount,
      external_reference: payment.external_reference,
      date_created: payment.date_created,
      date_approved: payment.date_approved,
      payment_method: payment.payment_method_id,
      payment_type: payment.payment_type_id
    }));
  } catch (error) {
    logger.error('Error al buscar pagos:', error);
    throw new Error('No se pudieron buscar los pagos');
  }
}

/**
 * Verifica si un pago con referencia externa específica ha sido recibido
 * @param {String} external_reference Referencia externa (ID de factura)
 * @returns {Promise<Object|null>} Datos del pago o null si no se encontró
 */
async function checkPaymentByReference(external_reference) {
  try {
    const accessToken = await getAccessToken();
    
    const response = await axios.get(
      `${MP_API_BASE_URL}/payments/search`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        },
        params: {
          external_reference,
          sort: 'date_created',
          criteria: 'desc'
        }
      }
    );
    
    if (response.data.results.length > 0) {
      const payment = response.data.results[0];
      return {
        id: payment.id,
        status: payment.status,
        amount: payment.transaction_amount,
        date_created: payment.date_created,
        date_approved: payment.date_approved
      };
    }
    
    return null;
  } catch (error) {
    logger.error('Error al verificar pago por referencia:', error);
    return null;
  }
}

/**
 * Crea un pedido de pago (POS) para usar con QR estático
 * @param {Number} amount Monto del pago
 * @param {String} description Descripción del pago
 * @param {String} external_reference Referencia externa (ID de factura)
 * @returns {Promise<Object>} Datos del pedido creado
 */
async function createPOSPayment(amount, description, external_reference) {
  try {
    const accessToken = await getAccessToken();
    const credentials = loadCredentials();
    
    if (!credentials.user_id) {
      throw new Error('ID de usuario de Mercado Pago no configurado');
    }
    
    // Creamos un pedido (POS)
    const orderResponse = await axios.post(
      `${MP_API_BASE_URL}/pos`,
      {
        name: external_reference || `FactuSystem-${Date.now()}`,
        external_id: external_reference || `FS-${Date.now()}`,
        fixed_amount: true
      },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    // Creamos un cashout (pedido de dinero)
    const cashoutResponse = await axios.post(
      `${MP_API_BASE_URL}/pos/${orderResponse.data.id}/cashout`,
      {
        amount: parseFloat(amount),
        description: description || 'Pago FactuSystem',
        external_reference
      },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    return {
      qr_id: orderResponse.data.id,
      cashout_id: cashoutResponse.data.id,
      amount,
      external_reference
    };
  } catch (error) {
    logger.error('Error al crear pedido POS:', error);
    throw new Error('No se pudo crear el pedido de pago');
  }
}

/**
 * Verifica el estado de un pedido POS (QR estático)
 * @param {String} cashout_id ID del cashout
 * @returns {Promise<Object>} Estado del pedido
 */
async function checkPOSStatus(cashout_id) {
  try {
    const accessToken = await getAccessToken();
    
    const response = await axios.get(
      `${MP_API_BASE_URL}/pos/cashout/${cashout_id}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      }
    );
    
    return {
      status: response.data.status,
      amount: response.data.amount,
      external_reference: response.data.external_reference,
      date_created: response.data.date_created,
      date_last_updated: response.data.date_last_updated
    };
  } catch (error) {
    logger.error('Error al verificar estado del POS:', error);
    throw new Error('No se pudo verificar el estado del pedido');
  }
}

/**
 * Procesa notificaciones de pagos desde Mercado Pago
 * @param {Object} notification Datos de la notificación
 * @returns {Promise<Object>} Resultado del procesamiento
 */
async function processNotification(notification) {
  try {
    if (notification.type !== 'payment') {
      return { success: true, message: 'Notificación ignorada (no es de pago)' };
    }
    
    const accessToken = await getAccessToken();
    
    // Obtenemos los detalles del pago
    const paymentResponse = await axios.get(
      `${MP_API_BASE_URL}/payments/${notification.data.id}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      }
    );
    
    const payment = paymentResponse.data;
    
    // Si el pago fue aprobado, actualizamos en nuestra base de datos
    if (payment.status === 'approved') {
      if (payment.external_reference) {
        // Guardamos el pago en la base de datos
        await database.insertPayment({
          payment_id: payment.id,
          external_reference: payment.external_reference,
          amount: payment.transaction_amount,
          status: payment.status,
          payment_method: payment.payment_method_id,
          payment_type: payment.payment_type_id,
          date_created: payment.date_created,
          date_approved: payment.date_approved
        });
        
        // Emitimos evento para la UI
        ipcMain.emit('mercadopago:payment-received', {
          payment_id: payment.id,
          external_reference: payment.external_reference,
          amount: payment.transaction_amount,
          status: payment.status
        });
      }
    }
    
    return {
      success: true,
      payment_id: payment.id,
      status: payment.status,
      external_reference: payment.external_reference
    };
  } catch (error) {
    logger.error('Error al procesar notificación de pago:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Obtiene información de la cuenta de Mercado Pago configurada
 * @returns {Promise<Object>} Información de la cuenta
 */
async function getAccountInfo() {
  try {
    const accessToken = await getAccessToken();
    
    const response = await axios.get(
      `${MP_API_BASE_URL}/users/me`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      }
    );
    
    return {
      id: response.data.id,
      name: `${response.data.first_name} ${response.data.last_name}`,
      email: response.data.email,
      site_id: response.data.site_id,
      country_id: response.data.country_id,
      account_type: response.data.account_type
    };
  } catch (error) {
    logger.error('Error al obtener información de la cuenta:', error);
    throw new Error('No se pudo obtener información de la cuenta');
  }
}

/**
 * Suscribe a un webhook para recibir notificaciones de Mercado Pago
 * @param {String} url URL del webhook
 * @returns {Promise<Boolean>} Resultado de la operación
 */
async function subscribeWebhook(url) {
  try {
    const accessToken = await getAccessToken();
    
    // Primero verificamos si ya existe una suscripción
    const currentHooks = await axios.get(
      `${MP_API_BASE_URL}/webhooks`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      }
    );
    
    // Si ya existe un webhook con esta URL, no hacemos nada
    const existingHook = currentHooks.data.find(hook => hook.url === url);
    if (existingHook) {
      return true;
    }
    
    // Si no existe, creamos la suscripción
    await axios.post(
      `${MP_API_BASE_URL}/webhooks`,
      {
        url,
        topic: 'payment'
      },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    return true;
  } catch (error) {
    logger.error('Error al suscribir webhook:', error);
    return false;
  }
}

/**
 * Obtiene las suscripciones a webhooks existentes
 * @returns {Promise<Array>} Lista de webhooks
 */
async function getWebhooks() {
  try {
    const accessToken = await getAccessToken();
    
    const response = await axios.get(
      `${MP_API_BASE_URL}/webhooks`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      }
    );
    
    return response.data;
  } catch (error) {
    logger.error('Error al obtener webhooks:', error);
    return [];
  }
}

/**
 * Realiza un reembolso de un pago
 * @param {String} payment_id ID del pago a reembolsar
 * @returns {Promise<Object>} Resultado del reembolso
 */
async function refundPayment(payment_id) {
  try {
    const accessToken = await getAccessToken();
    
    const response = await axios.post(
      `${MP_API_BASE_URL}/payments/${payment_id}/refunds`,
      {},
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    return {
      success: true,
      refund_id: response.data.id,
      payment_id,
      status: response.data.status
    };
  } catch (error) {
    logger.error('Error al reembolsar pago:', error);
    throw new Error('No se pudo realizar el reembolso');
  }
}

/**
 * Obtiene las últimas transacciones de Mercado Pago
 * @param {Number} limit Límite de transacciones a obtener
 * @returns {Promise<Array>} Lista de transacciones
 */
async function getLastTransactions(limit = 10) {
  try {
    const accessToken = await getAccessToken();
    
    const response = await axios.get(
      `${MP_API_BASE_URL}/payments/search`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        },
        params: {
          sort: 'date_created',
          criteria: 'desc',
          limit
        }
      }
    );
    
    return response.data.results.map(payment => ({
      id: payment.id,
      status: payment.status,
      amount: payment.transaction_amount,
      external_reference: payment.external_reference,
      date_created: payment.date_created,
      date_approved: payment.date_approved,
      payment_method: payment.payment_method_id,
      payment_type: payment.payment_type_id
    }));
  } catch (error) {
    logger.error('Error al obtener últimas transacciones:', error);
    return [];
  }
}

/**
 * Implementa el poller para verificar pagos periódicamente
 * @param {String} external_reference Referencia a verificar
 * @param {Number} amount Monto esperado
 * @param {Number} timeout Tiempo máximo de espera en ms
 * @param {Number} interval Intervalo entre verificaciones en ms
 * @returns {Promise<Object>} Resultado de la verificación
 */
function pollPayment(external_reference, amount, timeout = 180000, interval = 3000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    let timer = null;
    
    const checkPayment = async () => {
      try {
        const payment = await checkPaymentByReference(external_reference);
        
        // Si encontramos un pago con esta referencia y está aprobado
        if (payment && payment.status === 'approved') {
          clearTimeout(timer);
          // Verificamos que el monto coincida (con pequeña tolerancia)
          if (Math.abs(payment.amount - amount) < 0.01) {
            resolve(payment);
          } else {
            reject(new Error('El monto pagado no coincide con el solicitado'));
          }
          return;
        }
        
        // Si excedimos el timeout
        if (Date.now() - start > timeout) {
          clearTimeout(timer);
          reject(new Error('Tiempo de espera agotado'));
          return;
        }
        
        // Seguimos esperando
        timer = setTimeout(checkPayment, interval);
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    };
    
    // Comenzamos el polling
    timer = setTimeout(checkPayment, 0);
  });
}

// Configurar handlers para IPC (comunicación con el renderer)
function setupIPCHandlers() {
  // Verificar credenciales
  ipcMain.handle('mercadopago:verify-credentials', async () => {
    try {
      return await verifyCredentials();
    } catch (error) {
      return false;
    }
  });
  
  // Configurar credenciales
  ipcMain.handle('mercadopago:configure-credentials', async (event, credentials) => {
    try {
      return await configureCredentials(credentials);
    } catch (error) {
      return false;
    }
  });
  
  // Crear QR de pago
  ipcMain.handle('mercadopago:create-payment-qr', async (event, { amount, description, external_reference }) => {
    try {
      return await createPaymentQR(amount, description, external_reference);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Crear pago POS
  ipcMain.handle('mercadopago:create-pos-payment', async (event, { amount, description, external_reference }) => {
    try {
      return await createPOSPayment(amount, description, external_reference);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Verificar pago
  ipcMain.handle('mercadopago:check-payment', async (event, { payment_id }) => {
    try {
      return await checkPaymentStatus(payment_id);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Verificar pago por referencia
  ipcMain.handle('mercadopago:check-payment-reference', async (event, { external_reference }) => {
    try {
      return await checkPaymentByReference(external_reference);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Polling de pago
  ipcMain.handle('mercadopago:poll-payment', async (event, { external_reference, amount, timeout, interval }) => {
    try {
      return await pollPayment(external_reference, amount, timeout, interval);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Obtener últimas transacciones
  ipcMain.handle('mercadopago:get-transactions', async (event, { limit }) => {
    try {
      return await getLastTransactions(limit);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Buscar pagos por fecha
  ipcMain.handle('mercadopago:search-payments', async (event, { beginDate, endDate }) => {
    try {
      return await searchPayments(new Date(beginDate), new Date(endDate));
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Reembolsar pago
  ipcMain.handle('mercadopago:refund-payment', async (event, { payment_id }) => {
    try {
      return await refundPayment(payment_id);
    } catch (error) {
      return { error: error.message };
    }
  });
  
  // Obtener info de cuenta
  ipcMain.handle('mercadopago:get-account-info', async () => {
    try {
      return await getAccountInfo();
    } catch (error) {
      return { error: error.message };
    }
  });
}

// Inicializar la integración
function init() {
  setupIPCHandlers();
  logger.info('Integración de Mercado Pago inicializada');
}

module.exports = {
  init,
  verifyCredentials,
  configureCredentials,
  createPaymentQR,
  createPOSPayment,
  checkPaymentStatus,
  checkPaymentByReference,
  searchPayments,
  getLastTransactions,
  pollPayment,
  refundPayment,
  processNotification,
  getAccountInfo,
  subscribeWebhook,
  getWebhooks
};