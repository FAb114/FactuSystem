/**
 * @file galicia.js
 * @description Integración con la API del Banco Galicia para FactuSystem
 * @module integrations/bancos/galicia
 */

const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');
const logger = require('../../services/audit/logger.js');
const { getConfiguracion } = require('../../app/assets/js/modules/configuraciones/integraciones/bancos/galicia.js');

// Configuración base para la API de Galicia
const BASE_URL = 'https://api.bancogalicia.com.ar/api/v1';
const SANDBOX_URL = 'https://sandbox.bancogalicia.com.ar/api/v1';

// Credenciales y configuración
let apiKey = null;
let apiSecret = null;
let merchantId = null;
let useSandbox = true;
let certificatePath = null;
let privateKeyPath = null;
let callbackUrl = null;

/**
 * Inicializa la configuración de la API de Galicia
 * @returns {Promise<boolean>} - Verdadero si la inicialización fue exitosa
 */
async function inicializar() {
    try {
        // Obtener configuración desde el módulo de configuraciones
        const config = await getConfiguracion();
        
        if (!config) {
            logger.error('Galicia: No se encontró configuración para Banco Galicia');
            return false;
        }
        
        apiKey = config.apiKey;
        apiSecret = config.apiSecret;
        merchantId = config.merchantId;
        useSandbox = config.useSandbox || true;
        certificatePath = config.certificatePath;
        privateKeyPath = config.privateKeyPath;
        callbackUrl = config.callbackUrl;
        
        // Validar configuración básica
        if (!apiKey || !apiSecret || !merchantId) {
            logger.error('Galicia: Configuración incompleta');
            return false;
        }
        
        logger.info('Galicia: Inicialización exitosa');
        return true;
    } catch (error) {
        logger.error(`Galicia: Error de inicialización: ${error.message}`);
        return false;
    }
}

/**
 * Genera los encabezados de autenticación para la API de Galicia
 * @param {string} method - Método HTTP (GET, POST, etc.)
 * @param {string} endpoint - Endpoint de la API sin incluir la URL base
 * @param {Object} body - Cuerpo de la solicitud (si es POST o PUT)
 * @returns {Object} - Encabezados de autenticación
 */
function generarEncabezados(method, endpoint, body = null) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = crypto.randomBytes(16).toString('hex');
    
    // Crear la firma
    let dataToSign = `${method.toUpperCase()}\n${endpoint}\n${timestamp}\n${nonce}`;
    
    if (body) {
        const bodyHash = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
        dataToSign += `\n${bodyHash}`;
    }
    
    const signature = crypto.createHmac('sha256', apiSecret)
        .update(dataToSign)
        .digest('base64');
    
    // Encabezados requeridos por la API de Galicia
    return {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'x-merchant-id': merchantId,
        'x-timestamp': timestamp,
        'x-nonce': nonce,
        'x-signature': signature
    };
}

/**
 * Realiza una solicitud a la API de Galicia
 * @param {string} method - Método HTTP (GET, POST, etc.)
 * @param {string} endpoint - Endpoint de la API sin incluir la URL base
 * @param {Object} data - Datos para enviar (solo para POST, PUT, PATCH)
 * @returns {Promise<Object>} - Respuesta de la API
 */
async function realizarSolicitud(method, endpoint, data = null) {
    try {
        const url = `${useSandbox ? SANDBOX_URL : BASE_URL}${endpoint}`;
        const headers = generarEncabezados(method, endpoint, data);
        
        const options = {
            method,
            url,
            headers,
            data: data ? JSON.stringify(data) : undefined,
        };
        
        // Si hay certificados, añadirlos a la solicitud
        if (certificatePath && privateKeyPath && fs.existsSync(certificatePath) && fs.existsSync(privateKeyPath)) {
            options.httpsAgent = new https.Agent({
                cert: fs.readFileSync(certificatePath),
                key: fs.readFileSync(privateKeyPath),
                passphrase: ''  // Si el certificado tiene contraseña, obtenerla de la configuración
            });
        }
        
        logger.info(`Galicia: Realizando solicitud ${method} a ${endpoint}`);
        const response = await axios(options);
        
        logger.info(`Galicia: Respuesta exitosa de ${endpoint}`);
        return response.data;
    } catch (error) {
        // Manejar errores específicos del API de Galicia
        if (error.response) {
            logger.error(`Galicia: Error en solicitud ${method} ${endpoint} - ${error.response.status}: ${JSON.stringify(error.response.data)}`);
            throw new Error(`Error ${error.response.status}: ${error.response.data.message || 'Error desconocido'}`);
        } else {
            logger.error(`Galicia: Error de red en solicitud ${method} ${endpoint} - ${error.message}`);
            throw new Error(`Error de conexión: ${error.message}`);
        }
    }
}

/**
 * Consulta el estado de una cuenta
 * @param {string} cuentaId - ID de la cuenta
 * @returns {Promise<Object>} - Información de la cuenta
 */
async function consultarCuenta(cuentaId) {
    return await realizarSolicitud('GET', `/cuentas/${cuentaId}`);
}

/**
 * Obtiene el saldo de una cuenta
 * @param {string} cuentaId - ID de la cuenta
 * @returns {Promise<Object>} - Información del saldo
 */
async function consultarSaldo(cuentaId) {
    return await realizarSolicitud('GET', `/cuentas/${cuentaId}/saldo`);
}

/**
 * Obtiene los movimientos de una cuenta
 * @param {string} cuentaId - ID de la cuenta
 * @param {Object} filtros - Filtros para la consulta (fechaDesde, fechaHasta, etc.)
 * @returns {Promise<Array>} - Lista de movimientos
 */
async function consultarMovimientos(cuentaId, filtros = {}) {
    const queryParams = new URLSearchParams();
    
    if (filtros.fechaDesde) {
        queryParams.append('fechaDesde', filtros.fechaDesde);
    }
    
    if (filtros.fechaHasta) {
        queryParams.append('fechaHasta', filtros.fechaHasta);
    }
    
    if (filtros.tipoMovimiento) {
        queryParams.append('tipoMovimiento', filtros.tipoMovimiento);
    }
    
    const endpoint = `/cuentas/${cuentaId}/movimientos${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    return await realizarSolicitud('GET', endpoint);
}

/**
 * Inicia una transferencia bancaria
 * @param {Object} datosTransferencia - Datos de la transferencia
 * @returns {Promise<Object>} - Resultado de la operación
 */
async function iniciarTransferencia(datosTransferencia) {
    // Validar datos mínimos
    if (!datosTransferencia.cuentaOrigen || !datosTransferencia.cuentaDestino || !datosTransferencia.monto) {
        throw new Error('Datos de transferencia incompletos');
    }
    
    const payload = {
        cuentaOrigen: datosTransferencia.cuentaOrigen,
        cuentaDestino: {
            cbu: datosTransferencia.cuentaDestino.cbu,
            alias: datosTransferencia.cuentaDestino.alias,
            banco: datosTransferencia.cuentaDestino.banco,
            titular: datosTransferencia.cuentaDestino.titular,
            tipoDocumento: datosTransferencia.cuentaDestino.tipoDocumento,
            numeroDocumento: datosTransferencia.cuentaDestino.numeroDocumento,
        },
        monto: parseFloat(datosTransferencia.monto).toFixed(2),
        moneda: datosTransferencia.moneda || 'ARS',
        concepto: datosTransferencia.concepto || 'Transferencia FactuSystem',
        referencia: datosTransferencia.referencia || `FS-${Date.now()}`,
        callbackUrl: datosTransferencia.callbackUrl || callbackUrl
    };
    
    return await realizarSolicitud('POST', '/transferencias', payload);
}

/**
 * Consulta el estado de una transferencia
 * @param {string} transferenciaId - ID de la transferencia
 * @returns {Promise<Object>} - Estado de la transferencia
 */
async function consultarTransferencia(transferenciaId) {
    return await realizarSolicitud('GET', `/transferencias/${transferenciaId}`);
}

/**
 * Genera un QR para pagos
 * @param {Object} datosPago - Datos del pago
 * @returns {Promise<Object>} - Datos del QR generado
 */
async function generarQRPago(datosPago) {
    const payload = {
        monto: parseFloat(datosPago.monto).toFixed(2),
        moneda: datosPago.moneda || 'ARS',
        concepto: datosPago.concepto || 'Pago FactuSystem',
        referencia: datosPago.referencia || `FS-${Date.now()}`,
        fechaVencimiento: datosPago.fechaVencimiento || null,
        callbackUrl: datosPago.callbackUrl || callbackUrl
    };
    
    return await realizarSolicitud('POST', '/pagos/qr', payload);
}

/**
 * Consulta el estado de un pago por QR
 * @param {string} pagoId - ID del pago
 * @returns {Promise<Object>} - Estado del pago
 */
async function consultarPagoQR(pagoId) {
    return await realizarSolicitud('GET', `/pagos/qr/${pagoId}`);
}

/**
 * Verifica si un pago por QR ha sido completado
 * @param {string} pagoId - ID del pago
 * @returns {Promise<boolean>} - Verdadero si el pago está completado
 */
async function verificarPagoCompletado(pagoId) {
    try {
        const estadoPago = await consultarPagoQR(pagoId);
        return estadoPago.estado === 'COMPLETADO';
    } catch (error) {
        logger.error(`Galicia: Error al verificar pago ${pagoId} - ${error.message}`);
        return false;
    }
}

/**
 * Genera un token para el sistema de pagos
 * @returns {Promise<Object>} - Token generado
 */
async function generarToken() {
    const payload = {
        merchantId: merchantId,
        timestamp: Math.floor(Date.now() / 1000)
    };
    
    return await realizarSolicitud('POST', '/auth/token', payload);
}

/**
 * Maneja la respuesta del webhook de Galicia
 * @param {Object} data - Datos recibidos del webhook
 * @returns {Promise<Object>} - Respuesta procesada
 */
async function procesarWebhook(data) {
    try {
        // Verificar la firma del webhook
        const signature = data.signature;
        const payload = data.payload;
        
        // Eliminar la firma antes de verificar
        delete data.signature;
        
        const calculatedSignature = crypto.createHmac('sha256', apiSecret)
            .update(JSON.stringify(data))
            .digest('base64');
        
        if (signature !== calculatedSignature) {
            logger.error('Galicia: Firma de webhook inválida');
            throw new Error('Firma de webhook inválida');
        }
        
        logger.info(`Galicia: Webhook recibido - Tipo: ${payload.tipo}, ID: ${payload.id}`);
        
        // Procesar según el tipo de notificación
        switch (payload.tipo) {
            case 'TRANSFERENCIA_COMPLETADA':
                // Actualizar estado de la transferencia en la base de datos
                // Este código dependerá de cómo manejes las transferencias en tu sistema
                return { estado: 'procesado', mensaje: 'Transferencia actualizada' };
                
            case 'PAGO_COMPLETADO':
                // Actualizar estado del pago en la base de datos
                // Este código dependerá de cómo manejes los pagos en tu sistema
                return { estado: 'procesado', mensaje: 'Pago actualizado' };
                
            default:
                logger.warn(`Galicia: Tipo de webhook no manejado: ${payload.tipo}`);
                return { estado: 'ignorado', mensaje: 'Tipo de webhook no manejado' };
        }
    } catch (error) {
        logger.error(`Galicia: Error procesando webhook - ${error.message}`);
        throw error;
    }
}

/**
 * Genera un link de pago
 * @param {Object} datosPago - Datos del pago
 * @returns {Promise<Object>} - Link de pago generado
 */
async function generarLinkPago(datosPago) {
    const payload = {
        monto: parseFloat(datosPago.monto).toFixed(2),
        moneda: datosPago.moneda || 'ARS',
        concepto: datosPago.concepto || 'Pago FactuSystem',
        referencia: datosPago.referencia || `FS-${Date.now()}`,
        fechaVencimiento: datosPago.fechaVencimiento || null,
        callbackUrl: datosPago.callbackUrl || callbackUrl,
        callbackUrlExito: datosPago.callbackUrlExito || `${callbackUrl}/exito`,
        callbackUrlFallo: datosPago.callbackUrlFallo || `${callbackUrl}/fallo`
    };
    
    return await realizarSolicitud('POST', '/pagos/link', payload);
}

/**
 * Consulta la conciliación de transferencias para un día específico
 * @param {string} fecha - Fecha en formato YYYY-MM-DD
 * @returns {Promise<Object>} - Datos de conciliación
 */
async function consultarConciliacion(fecha) {
    return await realizarSolicitud('GET', `/conciliacion/transferencias?fecha=${fecha}`);
}

/**
 * Configura los escuchadores de eventos IPC para la comunicación con el proceso de renderizado
 */
function configurarEscuchadores() {
    // Inicializar
    ipcMain.handle('galicia:inicializar', async () => {
        return await inicializar();
    });
    
    // Consulta de cuenta
    ipcMain.handle('galicia:consultarCuenta', async (event, cuentaId) => {
        return await consultarCuenta(cuentaId);
    });
    
    // Consulta de saldo
    ipcMain.handle('galicia:consultarSaldo', async (event, cuentaId) => {
        return await consultarSaldo(cuentaId);
    });
    
    // Consulta de movimientos
    ipcMain.handle('galicia:consultarMovimientos', async (event, cuentaId, filtros) => {
        return await consultarMovimientos(cuentaId, filtros);
    });
    
    // Iniciar transferencia
    ipcMain.handle('galicia:iniciarTransferencia', async (event, datosTransferencia) => {
        return await iniciarTransferencia(datosTransferencia);
    });
    
    // Consultar transferencia
    ipcMain.handle('galicia:consultarTransferencia', async (event, transferenciaId) => {
        return await consultarTransferencia(transferenciaId);
    });
    
    // Generar QR de pago
    ipcMain.handle('galicia:generarQRPago', async (event, datosPago) => {
        return await generarQRPago(datosPago);
    });
    
    // Consultar pago QR
    ipcMain.handle('galicia:consultarPagoQR', async (event, pagoId) => {
        return await consultarPagoQR(pagoId);
    });
    
    // Verificar pago completado
    ipcMain.handle('galicia:verificarPagoCompletado', async (event, pagoId) => {
        return await verificarPagoCompletado(pagoId);
    });
    
    // Generar token
    ipcMain.handle('galicia:generarToken', async () => {
        return await generarToken();
    });
    
    // Generar link de pago
    ipcMain.handle('galicia:generarLinkPago', async (event, datosPago) => {
        return await generarLinkPago(datosPago);
    });
    
    // Consultar conciliación
    ipcMain.handle('galicia:consultarConciliacion', async (event, fecha) => {
        return await consultarConciliacion(fecha);
    });
    
    logger.info('Galicia: Escuchadores IPC configurados');
}

/**
 * Inicializa y configura el módulo de Galicia
 */
function inicializarModulo() {
    inicializar()
        .then(result => {
            if (result) {
                configurarEscuchadores();
                logger.info('Galicia: Módulo inicializado correctamente');
            } else {
                logger.warn('Galicia: No se pudo inicializar el módulo correctamente');
            }
        })
        .catch(error => {
            logger.error(`Galicia: Error al inicializar el módulo - ${error.message}`);
        });
}

// Inicializar el módulo cuando se carga el archivo
inicializarModulo();

// Exportar funciones para uso directo
module.exports = {
    inicializar,
    consultarCuenta,
    consultarSaldo,
    consultarMovimientos,
    iniciarTransferencia,
    consultarTransferencia,
    generarQRPago,
    consultarPagoQR,
    verificarPagoCompletado,
    generarToken,
    procesarWebhook,
    generarLinkPago,
    consultarConciliacion
};