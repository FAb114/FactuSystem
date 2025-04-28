/**
 * PayWay Integration Module for FactuSystem
 * 
 * Este módulo maneja la integración con el sistema de pagos PayWay,
 * permitiendo procesar pagos con tarjetas, verificar transacciones,
 * y obtener información sobre cuotas disponibles.
 * 
 * @module integrations/bancos/payway
 * @requires axios
 * @requires crypto
 * @requires ../modules/cuotificador/tasas
 */

const axios = require('axios');
const crypto = require('crypto');
const logger = require('../../app/assets/js/utils/logger');
const configManager = require('../../app/assets/js/modules/configuraciones/index');
const { getInterestRates } = require('../../app/assets/js/modules/cuotificador/tasas');

// Constantes para la API
const API_ENDPOINTS = {
    SANDBOX: 'https://api.sandbox.payway.com.ar/v1',
    PRODUCTION: 'https://api.payway.com.ar/v1'
};

// Cache para no tener que consultar el token en cada operación
let tokenCache = {
    token: null,
    expiresAt: null
};

/**
 * Inicializa la configuración de PayWay
 * @returns {Object} Configuración de PayWay
 */
const getPaywayConfig = async () => {
    try {
        const config = await configManager.getIntegrationConfig('payway');
        
        if (!config || !config.apiKey || !config.secretKey || !config.merchantId) {
            logger.error('PayWay: Configuración incompleta');
            throw new Error('La configuración de PayWay está incompleta. Verifique apiKey, secretKey y merchantId.');
        }
        
        return {
            apiKey: config.apiKey,
            secretKey: config.secretKey,
            merchantId: config.merchantId,
            environment: config.environment || 'SANDBOX',
            callbackUrl: config.callbackUrl || '',
            notificationUrl: config.notificationUrl || '',
        };
    } catch (error) {
        logger.error('Error al obtener configuración de PayWay:', error);
        throw new Error('Error al obtener configuración de PayWay');
    }
};

/**
 * Obtiene el endpoint base de la API según el entorno configurado
 * @returns {string} URL base de la API
 */
const getApiBaseUrl = async () => {
    const config = await getPaywayConfig();
    return API_ENDPOINTS[config.environment];
};

/**
 * Obtiene un token de autenticación para la API de PayWay
 * @returns {Promise<string>} Token de autenticación
 */
const getAuthToken = async () => {
    // Verificar si hay un token en caché y es válido
    const now = Date.now();
    if (tokenCache.token && tokenCache.expiresAt && tokenCache.expiresAt > now) {
        return tokenCache.token;
    }

    try {
        const config = await getPaywayConfig();
        const baseUrl = await getApiBaseUrl();
        
        const timestamp = Math.floor(Date.now() / 1000);
        const nonce = crypto.randomBytes(8).toString('hex');
        
        // Crear firma
        const signatureData = `${config.apiKey}${timestamp}${nonce}`;
        const signature = crypto.createHmac('sha256', config.secretKey)
            .update(signatureData)
            .digest('hex');
        
        const response = await axios.post(`${baseUrl}/auth/token`, {}, {
            headers: {
                'Content-Type': 'application/json',
                'X-Api-Key': config.apiKey,
                'X-Signature': signature,
                'X-Timestamp': timestamp,
                'X-Nonce': nonce
            }
        });
        
        if (!response.data || !response.data.token) {
            throw new Error('No se pudo obtener un token de autenticación');
        }
        
        // Guardar token en caché (válido por 1 hora menos 5 minutos por seguridad)
        tokenCache = {
            token: response.data.token,
            expiresAt: now + ((response.data.expiresIn || 3600) - 300) * 1000
        };
        
        return tokenCache.token;
    } catch (error) {
        logger.error('Error al obtener token de PayWay:', error.response?.data || error.message);
        throw new Error('Error al autenticar con PayWay');
    }
};

/**
 * Obtiene las tarjetas y planes de cuotas disponibles
 * @returns {Promise<Array>} Lista de tarjetas con sus planes de cuotas
 */
const getAvailableCards = async () => {
    try {
        const token = await getAuthToken();
        const baseUrl = await getApiBaseUrl();
        
        const response = await axios.get(`${baseUrl}/payment-methods`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!response.data || !response.data.paymentMethods) {
            throw new Error('No se pudieron obtener los métodos de pago');
        }
        
        return response.data.paymentMethods.map(card => ({
            id: card.id,
            name: card.name,
            type: card.type,
            cardType: card.cardType || null,
            installmentPlans: card.installmentPlans || [],
            logo: card.logoUrl || null
        }));
    } catch (error) {
        logger.error('Error al obtener tarjetas disponibles:', error.response?.data || error.message);
        throw new Error('Error al obtener tarjetas disponibles de PayWay');
    }
};

/**
 * Calcula el interés y monto de cuotas según PayWay
 * @param {number} amount - Monto total sin interés
 * @param {string} cardId - ID de la tarjeta
 * @param {number} installments - Número de cuotas
 * @returns {Promise<Object>} Información de cuotas calculada
 */
const calculateInstallments = async (amount, cardId, installments) => {
    try {
        // Primero intentamos obtener información específica de PayWay
        const cards = await getAvailableCards();
        const selectedCard = cards.find(card => card.id === cardId);
        
        if (!selectedCard) {
            throw new Error('Tarjeta no encontrada');
        }
        
        const installmentPlan = selectedCard.installmentPlans.find(
            plan => plan.installments === installments
        );
        
        // Si encontramos un plan específico en PayWay, lo usamos
        if (installmentPlan) {
            const totalAmount = amount * (1 + (installmentPlan.interestRate / 100));
            const installmentAmount = totalAmount / installments;
            
            return {
                originalAmount: amount,
                totalAmount: totalAmount,
                installments: installments,
                installmentAmount: installmentAmount,
                interestRate: installmentPlan.interestRate,
                source: 'payway'
            };
        }
        
        // Si no encontramos un plan específico, usamos las tasas del cuotificador local
        const localRates = await getInterestRates();
        const cardType = selectedCard.cardType || 'default';
        
        let interestRate = 0;
        if (localRates[cardType] && localRates[cardType][installments]) {
            interestRate = localRates[cardType][installments];
        } else if (localRates.default && localRates.default[installments]) {
            interestRate = localRates.default[installments];
        }
        
        const totalAmount = amount * (1 + (interestRate / 100));
        const installmentAmount = totalAmount / installments;
        
        return {
            originalAmount: amount,
            totalAmount: totalAmount,
            installments: installments,
            installmentAmount: installmentAmount,
            interestRate: interestRate,
            source: 'local'
        };
    } catch (error) {
        logger.error('Error al calcular cuotas:', error);
        throw new Error('Error al calcular cuotas');
    }
};

/**
 * Crea un pago en PayWay
 * @param {Object} paymentData - Datos del pago
 * @returns {Promise<Object>} Resultado de la creación del pago
 */
const createPayment = async (paymentData) => {
    try {
        const token = await getAuthToken();
        const baseUrl = await getApiBaseUrl();
        const config = await getPaywayConfig();
        
        // Formatear los datos según la API de PayWay
        const formattedData = {
            merchant_id: config.merchantId,
            payment_method_id: paymentData.cardId,
            amount: paymentData.amount,
            currency: 'ARS',
            description: paymentData.description || 'Pago FactuSystem',
            installments: paymentData.installments || 1,
            order_id: paymentData.orderId || `FS-${Date.now()}`,
            customer: {
                email: paymentData.customer.email,
                identification: {
                    type: paymentData.customer.identificationType || 'DNI',
                    number: paymentData.customer.identificationNumber
                },
                name: paymentData.customer.name,
                phone: paymentData.customer.phone || ''
            },
            card: {
                holder_name: paymentData.card.holderName,
                number: paymentData.card.number.replace(/\s/g, ''),
                expiration_month: paymentData.card.expirationMonth,
                expiration_year: paymentData.card.expirationYear,
                security_code: paymentData.card.securityCode
            },
            notification_url: config.notificationUrl || null,
            callback_url: config.callbackUrl || null,
            metadata: {
                factura_id: paymentData.facturaId || null,
                sucursal_id: paymentData.sucursalId || null,
                usuario_id: paymentData.usuarioId || null
            }
        };
        
        const response = await axios.post(`${baseUrl}/payments`, formattedData, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });
        
        return {
            success: true,
            paymentId: response.data.id,
            status: response.data.status,
            transactionDate: response.data.date,
            authorizationCode: response.data.authorization_code || null,
            receiptNumber: response.data.receipt_number || null,
            lastFourDigits: response.data.last_four_digits || null,
            installments: response.data.installments,
            amount: response.data.amount,
            rawResponse: response.data
        };
    } catch (error) {
        logger.error('Error al crear pago en PayWay:', error.response?.data || error.message);
        
        return {
            success: false,
            error: error.response?.data?.error_message || 'Error al procesar el pago',
            errorCode: error.response?.data?.error_code || 'UNKNOWN_ERROR',
            rawError: error.response?.data || null
        };
    }
};

/**
 * Verifica el estado de un pago
 * @param {string} paymentId - ID del pago a verificar
 * @returns {Promise<Object>} Estado actual del pago
 */
const checkPaymentStatus = async (paymentId) => {
    try {
        const token = await getAuthToken();
        const baseUrl = await getApiBaseUrl();
        
        const response = await axios.get(`${baseUrl}/payments/${paymentId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        return {
            success: true,
            paymentId: response.data.id,
            status: response.data.status,
            transactionDate: response.data.date,
            amount: response.data.amount,
            installments: response.data.installments,
            rawResponse: response.data
        };
    } catch (error) {
        logger.error('Error al verificar estado de pago:', error.response?.data || error.message);
        
        return {
            success: false,
            error: error.response?.data?.error_message || 'Error al verificar el pago',
            errorCode: error.response?.data?.error_code || 'UNKNOWN_ERROR',
            rawError: error.response?.data || null
        };
    }
};

/**
 * Procesa una devolución (refund) completa o parcial
 * @param {string} paymentId - ID del pago original
 * @param {number} amount - Monto a devolver (opcional, si no se especifica es devolución total)
 * @returns {Promise<Object>} Resultado de la devolución
 */
const refundPayment = async (paymentId, amount = null) => {
    try {
        const token = await getAuthToken();
        const baseUrl = await getApiBaseUrl();
        
        const refundData = {};
        if (amount !== null) {
            refundData.amount = amount; // Si se especifica monto, es un refund parcial
        }
        
        const response = await axios.post(`${baseUrl}/payments/${paymentId}/refunds`, refundData, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });
        
        return {
            success: true,
            refundId: response.data.id,
            paymentId: response.data.payment_id,
            amount: response.data.amount,
            status: response.data.status,
            rawResponse: response.data
        };
    } catch (error) {
        logger.error('Error al procesar devolución:', error.response?.data || error.message);
        
        return {
            success: false,
            error: error.response?.data?.error_message || 'Error al procesar la devolución',
            errorCode: error.response?.data?.error_code || 'UNKNOWN_ERROR',
            rawError: error.response?.data || null
        };
    }
};

/**
 * Verifica y procesa una notificación webhook de PayWay
 * @param {Object} webhookData - Datos recibidos en el webhook
 * @returns {Promise<Object>} Información procesada del webhook
 */
const processWebhook = async (webhookData) => {
    try {
        // Verificar firma del webhook si está disponible
        if (webhookData.signature) {
            const config = await getPaywayConfig();
            const calculatedSignature = crypto.createHmac('sha256', config.secretKey)
                .update(JSON.stringify(webhookData.data))
                .digest('hex');
                
            if (calculatedSignature !== webhookData.signature) {
                logger.warn('Firma de webhook inválida');
                return {
                    success: false,
                    error: 'Firma inválida',
                    verified: false
                };
            }
        }
        
        // Procesar según el tipo de evento
        const eventType = webhookData.type;
        const eventData = webhookData.data;
        
        switch (eventType) {
            case 'payment.created':
            case 'payment.updated':
            case 'payment.approved':
            case 'payment.rejected':
                return {
                    success: true,
                    verified: true,
                    eventType: eventType,
                    paymentId: eventData.id,
                    status: eventData.status,
                    metadata: eventData.metadata || {},
                    amount: eventData.amount,
                    rawData: eventData
                };
            
            case 'refund.created':
            case 'refund.approved':
                return {
                    success: true,
                    verified: true,
                    eventType: eventType,
                    refundId: eventData.id,
                    paymentId: eventData.payment_id,
                    status: eventData.status,
                    amount: eventData.amount,
                    rawData: eventData
                };
                
            default:
                logger.warn(`Tipo de evento desconocido: ${eventType}`);
                return {
                    success: true,
                    verified: true,
                    eventType: eventType,
                    unprocessed: true,
                    rawData: eventData
                };
        }
    } catch (error) {
        logger.error('Error al procesar webhook:', error);
        return {
            success: false,
            error: 'Error al procesar webhook',
            errorDetails: error.message
        };
    }
};

/**
 * Genera un token de pago para utilizar en transacciones posteriores
 * @param {Object} cardData - Datos de la tarjeta
 * @returns {Promise<Object>} Token generado
 */
const generateCardToken = async (cardData) => {
    try {
        const token = await getAuthToken();
        const baseUrl = await getApiBaseUrl();
        
        const tokenData = {
            card_number: cardData.number.replace(/\s/g, ''),
            holder_name: cardData.holderName,
            expiration_month: cardData.expirationMonth,
            expiration_year: cardData.expirationYear,
            security_code: cardData.securityCode
        };
        
        const response = await axios.post(`${baseUrl}/card-tokens`, tokenData, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });
        
        return {
            success: true,
            cardToken: response.data.id,
            lastFourDigits: response.data.last_four_digits,
            expirationDate: response.data.expiration_date,
            cardType: response.data.card_type
        };
    } catch (error) {
        logger.error('Error al generar token de tarjeta:', error.response?.data || error.message);
        
        return {
            success: false,
            error: error.response?.data?.error_message || 'Error al tokenizar tarjeta',
            errorCode: error.response?.data?.error_code || 'UNKNOWN_ERROR'
        };
    }
};

/**
 * Realiza un pago con un token de tarjeta previamente generado
 * @param {Object} paymentData - Datos del pago incluyendo cardToken en lugar de datos de tarjeta
 * @returns {Promise<Object>} Resultado del pago
 */
const createPaymentWithToken = async (paymentData) => {
    try {
        const token = await getAuthToken();
        const baseUrl = await getApiBaseUrl();
        const config = await getPaywayConfig();
        
        // Formatear los datos según la API de PayWay
        const formattedData = {
            merchant_id: config.merchantId,
            payment_method_id: paymentData.cardId,
            amount: paymentData.amount,
            currency: 'ARS',
            description: paymentData.description || 'Pago FactuSystem',
            installments: paymentData.installments || 1,
            order_id: paymentData.orderId || `FS-${Date.now()}`,
            customer: {
                email: paymentData.customer.email,
                identification: {
                    type: paymentData.customer.identificationType || 'DNI',
                    number: paymentData.customer.identificationNumber
                },
                name: paymentData.customer.name,
                phone: paymentData.customer.phone || ''
            },
            card_token: paymentData.cardToken,
            security_code: paymentData.securityCode, // Algunos procesadores requieren CVV incluso con token
            notification_url: config.notificationUrl || null,
            callback_url: config.callbackUrl || null,
            metadata: {
                factura_id: paymentData.facturaId || null,
                sucursal_id: paymentData.sucursalId || null,
                usuario_id: paymentData.usuarioId || null
            }
        };
        
        const response = await axios.post(`${baseUrl}/payments`, formattedData, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });
        
        return {
            success: true,
            paymentId: response.data.id,
            status: response.data.status,
            transactionDate: response.data.date,
            authorizationCode: response.data.authorization_code || null,
            receiptNumber: response.data.receipt_number || null,
            lastFourDigits: response.data.last_four_digits || null,
            installments: response.data.installments,
            amount: response.data.amount,
            rawResponse: response.data
        };
    } catch (error) {
        logger.error('Error al crear pago con token en PayWay:', error.response?.data || error.message);
        
        return {
            success: false,
            error: error.response?.data?.error_message || 'Error al procesar el pago',
            errorCode: error.response?.data?.error_code || 'UNKNOWN_ERROR',
            rawError: error.response?.data || null
        };
    }
};

/**
 * Obtiene las promociones activas en PayWay
 * @returns {Promise<Array>} Lista de promociones disponibles
 */
const getActivePromotions = async () => {
    try {
        const token = await getAuthToken();
        const baseUrl = await getApiBaseUrl();
        
        const response = await axios.get(`${baseUrl}/promotions`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!response.data || !response.data.promotions) {
            return [];
        }
        
        return response.data.promotions.map(promo => ({
            id: promo.id,
            name: promo.name,
            description: promo.description,
            startDate: promo.start_date,
            endDate: promo.end_date,
            paymentMethodId: promo.payment_method_id,
            discountRate: promo.discount_rate,
            maxAmount: promo.max_amount || null,
            daysOfWeek: promo.days_of_week || null,
            active: promo.active
        }));
    } catch (error) {
        logger.error('Error al obtener promociones:', error.response?.data || error.message);
        throw new Error('Error al obtener promociones de PayWay');
    }
};

/**
 * Obtiene y configura el terminal virtual de PayWay para el punto de venta
 * @returns {Promise<Object>} Información del terminal configurado
 */
const configureTerminal = async () => {
    try {
        const token = await getAuthToken();
        const baseUrl = await getApiBaseUrl();
        const config = await getPaywayConfig();
        
        // Verificar si ya existe un terminal configurado
        const response = await axios.get(`${baseUrl}/terminals`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        let terminal;
        const terminalName = `FactuSystem-${config.merchantId}`;
        
        // Si ya existe un terminal con ese nombre, lo usamos
        if (response.data && response.data.terminals) {
            terminal = response.data.terminals.find(t => t.name === terminalName);
        }
        
        // Si no existe, creamos uno nuevo
        if (!terminal) {
            const createResponse = await axios.post(`${baseUrl}/terminals`, {
                name: terminalName,
                description: 'Terminal virtual para FactuSystem',
                callback_url: config.callbackUrl || '',
                notification_url: config.notificationUrl || ''
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                }
            });
            
            terminal = createResponse.data;
        }
        
        return {
            terminalId: terminal.id,
            name: terminal.name,
            accessToken: terminal.access_token,
            publicKey: terminal.public_key
        };
    } catch (error) {
        logger.error('Error al configurar terminal PayWay:', error.response?.data || error.message);
        throw new Error('Error al configurar terminal virtual de PayWay');
    }
};

module.exports = {
    getAvailableCards,
    calculateInstallments,
    createPayment,
    checkPaymentStatus,
    refundPayment,
    processWebhook,
    generateCardToken,
    createPaymentWithToken,
    getActivePromotions,
    configureTerminal
};