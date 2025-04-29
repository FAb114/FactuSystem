/**
 * @file bbva.js
 * @description Integración con BBVA para FactuSystem
 * @version 1.0.0
 * 
 * Este módulo proporciona una interfaz para interactuar con la API de BBVA
 * Permite procesar pagos, verificar transferencias y consultar saldos
 */

const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const logger = require('../../services/audit/logger.js');
const { getConfig, saveConfig } = require('../../app/assets/js/modules/configuraciones/integraciones/bancos/bbva.js');

// Configuración base para BBVA
let config = {
    apiUrl: 'https://api.bbva.com.ar/v1',
    sandboxUrl: 'https://sandbox.bbva.com.ar/v1',
    clientId: '',
    clientSecret: '',
    merchantId: '',
    terminalId: '',
    useSandbox: true,
    accessToken: null,
    tokenExpires: 0,
    certificatePath: '',
    privateKeyPath: '',
    webhook: {
        url: '',
        enabled: false
    },
    lastSync: null
};

/**
 * Inicializa la configuración desde el archivo guardado
 * @returns {Promise<Object>} - Configuración cargada
 */
async function init() {
    try {
        const savedConfig = await getConfig();
        if (savedConfig) {
            config = { ...config, ...savedConfig };
        }
        return config;
    } catch (error) {
        logger.error('Error al inicializar configuración BBVA', { error: error.message });
        throw new Error('No se pudo inicializar la integración con BBVA');
    }
}

/**
 * Obtiene un token de acceso a la API de BBVA
 * @returns {Promise<string>} - Token de acceso
 */
async function getAccessToken() {
    try {
        // Verificar si ya tenemos un token válido
        const now = Date.now();
        if (config.accessToken && config.tokenExpires > now) {
            return config.accessToken;
        }

        const baseUrl = config.useSandbox ? config.sandboxUrl : config.apiUrl;
        const authUrl = `${baseUrl}/oauth/token`;

        // Credenciales en formato base64
        const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');

        const response = await axios({
            method: 'post',
            url: authUrl,
            headers: {
                'Authorization': `Basic ${credentials}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            data: 'grant_type=client_credentials'
        });

        if (response.data && response.data.access_token) {
            // Guardar el token y su tiempo de expiración
            config.accessToken = response.data.access_token;
            // Convertir segundos a milisegundos y restar 5 minutos para seguridad
            config.tokenExpires = now + (response.data.expires_in * 1000) - 300000;
            await saveConfig(config);
            
            logger.info('Token BBVA obtenido correctamente');
            return config.accessToken;
        } else {
            throw new Error('Respuesta inválida al obtener token');
        }
    } catch (error) {
        logger.error('Error al obtener token BBVA', { 
            error: error.message,
            response: error.response?.data
        });
        throw new Error(`Error de autenticación con BBVA: ${error.message}`);
    }
}

/**
 * Genera una firma digital para las solicitudes que requieren mayor seguridad
 * @param {string} payload - Datos a firmar
 * @returns {string} - Firma codificada en base64
 */
function generateSignature(payload) {
    try {
        if (!config.privateKeyPath) {
            throw new Error('Ruta de clave privada no configurada');
        }
        
        const privateKey = fs.readFileSync(config.privateKeyPath);
        const sign = crypto.createSign('SHA256');
        sign.update(payload);
        sign.end();
        
        return sign.sign(privateKey, 'base64');
    } catch (error) {
        logger.error('Error al generar firma BBVA', { error: error.message });
        throw new Error(`No se pudo generar la firma: ${error.message}`);
    }
}

/**
 * Consulta el saldo disponible en la cuenta
 * @returns {Promise<Object>} - Información de saldos
 */
async function consultarSaldo() {
    try {
        const token = await getAccessToken();
        const baseUrl = config.useSandbox ? config.sandboxUrl : config.apiUrl;
        
        const response = await axios({
            method: 'get',
            url: `${baseUrl}/accounts/balance`,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'X-BBVA-Merchant-ID': config.merchantId
            }
        });
        
        logger.info('Saldo BBVA consultado correctamente');
        return response.data;
    } catch (error) {
        logger.error('Error al consultar saldo BBVA', { 
            error: error.message, 
            response: error.response?.data 
        });
        throw new Error(`Error al consultar saldo: ${error.message}`);
    }
}

/**
 * Consulta los últimos movimientos de la cuenta
 * @param {Object} options - Opciones de consulta
 * @param {string} options.fechaDesde - Fecha desde (YYYY-MM-DD)
 * @param {string} options.fechaHasta - Fecha hasta (YYYY-MM-DD)
 * @param {number} options.limit - Límite de registros (máx 100)
 * @returns {Promise<Array>} - Lista de movimientos
 */
async function consultarMovimientos({ fechaDesde, fechaHasta, limit = 50 }) {
    try {
        const token = await getAccessToken();
        const baseUrl = config.useSandbox ? config.sandboxUrl : config.apiUrl;
        
        const response = await axios({
            method: 'get',
            url: `${baseUrl}/accounts/transactions`,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'X-BBVA-Merchant-ID': config.merchantId
            },
            params: {
                from_date: fechaDesde,
                to_date: fechaHasta,
                limit: Math.min(limit, 100) // Máximo 100 registros
            }
        });
        
        logger.info('Movimientos BBVA consultados correctamente', { 
            count: response.data.transactions?.length || 0 
        });
        
        return response.data.transactions || [];
    } catch (error) {
        logger.error('Error al consultar movimientos BBVA', { 
            error: error.message, 
            response: error.response?.data 
        });
        throw new Error(`Error al consultar movimientos: ${error.message}`);
    }
}

/**
 * Verifica si una transferencia específica ha sido recibida
 * @param {Object} params - Parámetros de búsqueda
 * @param {string} params.referencia - Código de referencia
 * @param {number} params.monto - Monto de la transferencia
 * @param {string} params.fecha - Fecha de la transferencia (YYYY-MM-DD)
 * @returns {Promise<Object|null>} - Datos de la transferencia o null si no se encuentra
 */
async function verificarTransferencia({ referencia, monto, fecha }) {
    try {
        // Obtener movimientos del día de la fecha indicada
        const fechaObj = new Date(fecha);
        const fechaFormateada = fechaObj.toISOString().split('T')[0];
        
        const movimientos = await consultarMovimientos({
            fechaDesde: fechaFormateada,
            fechaHasta: fechaFormateada,
            limit: 100
        });
        
        // Buscar la transferencia por referencia y monto aproximado (con margen de 0.01)
        const transferencia = movimientos.find(mov => {
            const esReferenciaSimilar = mov.reference && mov.reference.includes(referencia);
            const esMontoCorrecto = Math.abs(parseFloat(mov.amount) - parseFloat(monto)) < 0.01;
            return mov.type === 'TRANSFER' && esReferenciaSimilar && esMontoCorrecto;
        });
        
        if (transferencia) {
            logger.info('Transferencia BBVA verificada correctamente', { 
                referencia, 
                monto, 
                transactionId: transferencia.id 
            });
        } else {
            logger.info('Transferencia BBVA no encontrada', { referencia, monto, fecha });
        }
        
        return transferencia || null;
    } catch (error) {
        logger.error('Error al verificar transferencia BBVA', { 
            error: error.message, 
            params: { referencia, monto, fecha } 
        });
        throw new Error(`Error al verificar transferencia: ${error.message}`);
    }
}

/**
 * Registra un pago con tarjeta
 * @param {Object} pagoData - Datos del pago
 * @param {number} pagoData.monto - Monto del pago
 * @param {string} pagoData.moneda - Código de moneda (ARS, USD, etc)
 * @param {string} pagoData.descripcion - Descripción del pago
 * @param {string} pagoData.numeroTarjeta - Número de tarjeta (tokenizado)
 * @param {string} pagoData.titular - Nombre del titular
 * @param {string} pagoData.vencimiento - Fecha de vencimiento (MM/YY)
 * @param {string} pagoData.cvv - Código de seguridad
 * @param {number} pagoData.cuotas - Número de cuotas
 * @param {string} pagoData.idFactura - ID de la factura asociada
 * @returns {Promise<Object>} - Respuesta del proceso de pago
 */
async function procesarPagoTarjeta(pagoData) {
    try {
        const token = await getAccessToken();
        const baseUrl = config.useSandbox ? config.sandboxUrl : config.apiUrl;
        
        // Crear payload
        const payload = {
            merchant_id: config.merchantId,
            terminal_id: config.terminalId,
            amount: pagoData.monto.toFixed(2),
            currency: pagoData.moneda || 'ARS',
            description: pagoData.descripcion,
            payment_method: {
                type: 'CREDIT_CARD',  // CREDIT_CARD o DEBIT_CARD
                installments: pagoData.cuotas || 1,
                card: {
                    number: pagoData.numeroTarjeta,
                    holder_name: pagoData.titular,
                    expiration: pagoData.vencimiento,
                    cvv: pagoData.cvv
                }
            },
            capture: true,  // true para captura automática, false para preautorización
            reference_id: pagoData.idFactura,
            notification_url: config.webhook.enabled ? config.webhook.url : undefined
        };
        
        // Generar firma para la solicitud
        const payloadString = JSON.stringify(payload);
        const signature = generateSignature(payloadString);
        
        // Enviar solicitud de pago
        const response = await axios({
            method: 'post',
            url: `${baseUrl}/payments`,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'X-BBVA-Signature': signature
            },
            data: payload
        });
        
        logger.info('Pago con tarjeta BBVA procesado correctamente', {
            transactionId: response.data.transaction_id,
            amount: pagoData.monto,
            status: response.data.status
        });
        
        return {
            transactionId: response.data.transaction_id,
            status: response.data.status,
            authorizationCode: response.data.authorization_code,
            reference: response.data.reference_id,
            date: response.data.transaction_date,
            cardInfo: {
                brand: response.data.card?.brand,
                lastFour: response.data.card?.last_four,
                holderName: response.data.card?.holder_name
            }
        };
    } catch (error) {
        logger.error('Error al procesar pago con tarjeta BBVA', {
            error: error.message,
            response: error.response?.data,
            reference: pagoData.idFactura
        });
        throw new Error(`Error al procesar pago: ${error.response?.data?.error_description || error.message}`);
    }
}

/**
 * Solicita la anulación de un pago realizado
 * @param {string} transactionId - ID de la transacción a anular
 * @param {string} motivo - Motivo de la anulación
 * @returns {Promise<Object>} - Resultado de la anulación
 */
async function anularPago(transactionId, motivo) {
    try {
        const token = await getAccessToken();
        const baseUrl = config.useSandbox ? config.sandboxUrl : config.apiUrl;
        
        const payload = {
            reason: motivo || 'Anulación solicitada por el comercio'
        };
        
        const response = await axios({
            method: 'post',
            url: `${baseUrl}/payments/${transactionId}/refunds`,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'X-BBVA-Merchant-ID': config.merchantId
            },
            data: payload
        });
        
        logger.info('Pago BBVA anulado correctamente', {
            transactionId,
            refundId: response.data.refund_id,
            status: response.data.status
        });
        
        return {
            refundId: response.data.refund_id,
            status: response.data.status,
            amount: response.data.amount,
            date: response.data.date
        };
    } catch (error) {
        logger.error('Error al anular pago BBVA', {
            error: error.message,
            response: error.response?.data,
            transactionId
        });
        throw new Error(`Error al anular pago: ${error.response?.data?.error_description || error.message}`);
    }
}

/**
 * Consulta el estado de un pago previamente realizado
 * @param {string} transactionId - ID de la transacción
 * @returns {Promise<Object>} - Estado del pago
 */
async function consultarEstadoPago(transactionId) {
    try {
        const token = await getAccessToken();
        const baseUrl = config.useSandbox ? config.sandboxUrl : config.apiUrl;
        
        const response = await axios({
            method: 'get',
            url: `${baseUrl}/payments/${transactionId}`,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'X-BBVA-Merchant-ID': config.merchantId
            }
        });
        
        logger.info('Estado de pago BBVA consultado', {
            transactionId,
            status: response.data.status
        });
        
        return {
            transactionId: response.data.transaction_id,
            status: response.data.status,
            amount: response.data.amount,
            currency: response.data.currency,
            date: response.data.transaction_date,
            reference: response.data.reference_id,
            paymentMethod: response.data.payment_method,
            cardInfo: response.data.card ? {
                brand: response.data.card.brand,
                lastFour: response.data.card.last_four,
                holderName: response.data.card.holder_name
            } : null
        };
    } catch (error) {
        logger.error('Error al consultar estado de pago BBVA', {
            error: error.message,
            response: error.response?.data,
            transactionId
        });
        throw new Error(`Error al consultar estado: ${error.response?.data?.error_description || error.message}`);
    }
}

/**
 * Genera un enlace de pago para enviar a clientes
 * @param {Object} pagoData - Datos del pago
 * @param {number} pagoData.monto - Monto del pago
 * @param {string} pagoData.moneda - Código de moneda (ARS, USD, etc)
 * @param {string} pagoData.descripcion - Descripción del pago
 * @param {string} pagoData.idFactura - ID de la factura asociada
 * @param {string} pagoData.emailCliente - Email del cliente
 * @param {Date} pagoData.vencimiento - Fecha de vencimiento del enlace
 * @returns {Promise<Object>} - Datos del enlace generado
 */
async function generarEnlacePago(pagoData) {
    try {
        const token = await getAccessToken();
        const baseUrl = config.useSandbox ? config.sandboxUrl : config.apiUrl;
        
        // Crear payload
        const payload = {
            merchant_id: config.merchantId,
            amount: pagoData.monto.toFixed(2),
            currency: pagoData.moneda || 'ARS',
            description: pagoData.descripcion,
            reference_id: pagoData.idFactura,
            expiration_date: pagoData.vencimiento ? new Date(pagoData.vencimiento).toISOString() : undefined,
            customer_email: pagoData.emailCliente,
            notification_url: config.webhook.enabled ? config.webhook.url : undefined,
            redirect_url: pagoData.urlRedireccion || ''
        };
        
        const response = await axios({
            method: 'post',
            url: `${baseUrl}/payment-links`,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'X-BBVA-Merchant-ID': config.merchantId
            },
            data: payload
        });
        
        logger.info('Enlace de pago BBVA generado correctamente', {
            linkId: response.data.link_id,
            reference: pagoData.idFactura
        });
        
        return {
            linkId: response.data.link_id,
            url: response.data.payment_url,
            qrCode: response.data.qr_code_url,
            expirationDate: response.data.expiration_date,
            status: response.data.status
        };
    } catch (error) {
        logger.error('Error al generar enlace de pago BBVA', {
            error: error.message,
            response: error.response?.data,
            reference: pagoData.idFactura
        });
        throw new Error(`Error al generar enlace: ${error.response?.data?.error_description || error.message}`);
    }
}

/**
 * Configura el webhook para recibir notificaciones de pagos
 * @param {string} url - URL del webhook
 * @returns {Promise<Object>} - Resultado de la configuración
 */
async function configurarWebhook(url) {
    try {
        const token = await getAccessToken();
        const baseUrl = config.useSandbox ? config.sandboxUrl : config.apiUrl;
        
        const payload = {
            url: url,
            event_types: [
                'payment.created',
                'payment.approved',
                'payment.rejected',
                'payment.cancelled',
                'refund.created',
                'refund.approved',
                'refund.rejected'
            ]
        };
        
        const response = await axios({
            method: 'post',
            url: `${baseUrl}/webhooks`,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'X-BBVA-Merchant-ID': config.merchantId
            },
            data: payload
        });
        
        // Actualizar configuración local
        config.webhook = {
            url: url,
            enabled: true,
            webhookId: response.data.webhook_id
        };
        await saveConfig(config);
        
        logger.info('Webhook BBVA configurado correctamente', {
            webhookId: response.data.webhook_id
        });
        
        return {
            webhookId: response.data.webhook_id,
            url: response.data.url,
            active: response.data.active,
            eventTypes: response.data.event_types
        };
    } catch (error) {
        logger.error('Error al configurar webhook BBVA', {
            error: error.message,
            response: error.response?.data
        });
        throw new Error(`Error al configurar webhook: ${error.response?.data?.error_description || error.message}`);
    }
}

/**
 * Procesa un webhook recibido desde BBVA
 * @param {Object} webhookData - Datos recibidos en el webhook
 * @returns {Object} - Resultado del procesamiento
 */
function procesarWebhook(webhookData) {
    try {
        const eventType = webhookData.event_type;
        const eventData = webhookData.data;
        
        // Verificar firma del webhook si está disponible
        if (webhookData.signature && config.certificatePath) {
            // Aquí iría la lógica de verificación de firma
            // usando la clave pública de BBVA
        }
        
        logger.info('Webhook BBVA recibido', {
            eventType,
            transactionId: eventData.transaction_id || eventData.refund_id
        });
        
        return {
            eventType,
            data: eventData,
            processed: true,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        logger.error('Error al procesar webhook BBVA', {
            error: error.message,
            webhookData
        });
        throw new Error(`Error al procesar webhook: ${error.message}`);
    }
}

/**
 * Actualiza la configuración de la integración
 * @param {Object} newConfig - Nueva configuración
 * @returns {Promise<Object>} - Configuración actualizada
 */
async function actualizarConfiguracion(newConfig) {
    try {
        // Preservar el token y su fecha de expiración si no se especifica
        if (!newConfig.accessToken) {
            newConfig.accessToken = config.accessToken;
            newConfig.tokenExpires = config.tokenExpires;
        }
        
        // Actualizar configuración
        config = { ...config, ...newConfig };
        await saveConfig(config);
        
        logger.info('Configuración BBVA actualizada correctamente');
        return config;
    } catch (error) {
        logger.error('Error al actualizar configuración BBVA', { error: error.message });
        throw new Error(`Error al actualizar configuración: ${error.message}`);
    }
}

/**
 * Sincroniza transacciones recientes y actualiza la base de datos local
 * @param {Object} options - Opciones de sincronización
 * @param {string} options.fechaDesde - Fecha desde (YYYY-MM-DD)
 * @param {string} options.fechaHasta - Fecha hasta (YYYY-MM-DD)
 * @returns {Promise<Object>} - Resultado de la sincronización
 */
async function sincronizarTransacciones({ fechaDesde, fechaHasta }) {
    try {
        // Si no se especifican fechas, usar la última sincronización
        if (!fechaDesde) {
            if (config.lastSync) {
                const lastSyncDate = new Date(config.lastSync);
                fechaDesde = lastSyncDate.toISOString().split('T')[0];
            } else {
                // Si nunca se sincronizó, usar hace 7 días
                const sevenDaysAgo = new Date();
                sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
                fechaDesde = sevenDaysAgo.toISOString().split('T')[0];
            }
        }
        
        if (!fechaHasta) {
            const today = new Date();
            fechaHasta = today.toISOString().split('T')[0];
        }
        
        // Obtener movimientos del período
        const movimientos = await consultarMovimientos({ fechaDesde, fechaHasta, limit: 100 });
        
        // Actualizar fecha de última sincronización
        config.lastSync = new Date().toISOString();
        await saveConfig(config);
        
        logger.info('Transacciones BBVA sincronizadas correctamente', {
            count: movimientos.length,
            desde: fechaDesde,
            hasta: fechaHasta
        });
        
        return {
            success: true,
            count: movimientos.length,
            transactions: movimientos,
            syncDate: config.lastSync
        };
    } catch (error) {
        logger.error('Error al sincronizar transacciones BBVA', {
            error: error.message,
            options: { fechaDesde, fechaHasta }
        });
        throw new Error(`Error al sincronizar transacciones: ${error.message}`);
    }
}

/**
 * Genera datos para pruebas en entorno sandbox
 * @returns {Promise<Object>} - Datos generados
 */
async function generarDatosPrueba() {
    try {
        if (!config.useSandbox) {
            throw new Error('Esta función solo está disponible en modo sandbox');
        }
        
        const token = await getAccessToken();
        const baseUrl = config.sandboxUrl;
        
        // Generar datos de prueba
        const response = await axios({
            method: 'post',
            url: `${baseUrl}/sandbox/generate-data`,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'X-BBVA-Merchant-ID': config.merchantId
            },
            data: {
                transactions: true,
                payment_links: true,
                refunds: true
            }
        });
        
        logger.info('Datos de prueba BBVA generados correctamente');
        return response.data;
    } catch (error) {
        logger.error('Error al generar datos de prueba BBVA', {
            error: error.message,
            response: error.response?.data
        });
        throw new Error(`Error al generar datos de prueba: ${error.message}`);
    }
}

// Exportar funciones del módulo
module.exports = {
    init,
    getAccessToken,
    consultarSaldo,
    consultarMovimientos,
    verificarTransferencia,
    procesarPagoTarjeta,
    anularPago,
    consultarEstadoPago,
    generarEnlacePago,
    configurarWebhook,
    procesarWebhook,
    actualizarConfiguracion,
    sincronizarTransacciones,
    generarDatosPrueba
};