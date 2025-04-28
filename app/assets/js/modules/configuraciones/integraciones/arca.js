/**
 * arca.js - Módulo de integración con ARCA/AFIP para facturación electrónica
 * 
 * Este módulo maneja toda la integración con el sistema de facturación electrónica
 * de Argentina (AFIP) a través de ARCA, incluyendo:
 * - Autenticación y gestión de tokens
 * - Generación y envío de comprobantes electrónicos
 * - Consulta de comprobantes
 * - Descarga de constancias
 */

// Importaciones de módulos del sistema
const database = require('../../../../utils/database');
const auth = require('../../../../utils/auth');
const logger = require('../../../../utils/logger');
const sync = require('../../../../utils/sync');
const validation = require('../../../../utils/validation');

// API principal de integración con ARCA
const arcaApi = require('../../../../../integrations/arca/api');
const arcaFacturacion = require('../../../../../integrations/arca/facturacion');

// Estado de la configuración y conexión
let configStatus = {
    connected: false,
    lastSync: null,
    certificateStatus: null,
    environment: 'testing', // 'testing' o 'production'
    errors: []
};

/**
 * Clase para gestionar la integración con ARCA/AFIP
 */
class ArcaIntegration {
    constructor() {
        this.token = null;
        this.tokenExpiry = null;
        this.certificateData = null;
        this.puntoVenta = null;
        this.cuit = null;
        this.razonSocial = null;
        this.inicioActividades = null;
        this.condicionIVA = null;
        this.domicilioFiscal = null;
        this.ingresosBrutos = null;
        this.offlineMode = false;
        this.pendingInvoices = [];
        
        // Cargar configuración inicial
        this.loadConfig();
        
        // Asignar event listeners para sincronización
        this.setupEventListeners();
    }
    
    /**
     * Carga la configuración desde la base de datos
     */
    async loadConfig() {
        try {
            const config = await database.getConfig('arca');
            
            if (config) {
                this.cuit = config.cuit;
                this.razonSocial = config.razonSocial;
                this.puntoVenta = config.puntoVenta;
                this.inicioActividades = config.inicioActividades;
                this.condicionIVA = config.condicionIVA;
                this.domicilioFiscal = config.domicilioFiscal;
                this.ingresosBrutos = config.ingresosBrutos;
                this.certificateData = config.certificateData;
                configStatus.environment = config.environment || 'testing';
                
                // Validar si hay un token almacenado y si sigue siendo válido
                if (config.token && config.tokenExpiry && new Date(config.tokenExpiry) > new Date()) {
                    this.token = config.token;
                    this.tokenExpiry = config.tokenExpiry;
                    configStatus.connected = true;
                    logger.info('ARCA: Configuración cargada con éxito, token válido');
                } else {
                    // El token ha expirado, necesitamos renovarlo
                    logger.info('ARCA: Token expirado o no disponible, se intentará renovar');
                    this.refreshToken();
                }
                
                // Cargar facturas pendientes en caso de modo offline
                this.loadPendingInvoices();
                
                return true;
            } else {
                logger.warn('ARCA: No se encontró configuración');
                configStatus.errors.push('No se encontró configuración de ARCA');
                return false;
            }
        } catch (error) {
            logger.error('ARCA: Error al cargar configuración', error);
            configStatus.errors.push('Error al cargar configuración: ' + error.message);
            return false;
        }
    }
    
    /**
     * Configura escuchas de eventos para sincronización
     */
    setupEventListeners() {
        // Escuchar eventos de conexión/desconexión
        window.addEventListener('online', () => this.handleConnectionChange(true));
        window.addEventListener('offline', () => this.handleConnectionChange(false));
        
        // Escuchar eventos de sincronización
        document.addEventListener('sync-completed', () => this.processPendingInvoices());
    }
    
    /**
     * Maneja cambios en la conexión a internet
     * @param {boolean} isOnline - Estado de la conexión
     */
    async handleConnectionChange(isOnline) {
        this.offlineMode = !isOnline;
        
        if (isOnline) {
            logger.info('ARCA: Conexión a internet restaurada');
            await this.refreshToken();
            await this.processPendingInvoices();
        } else {
            logger.warn('ARCA: Modo sin conexión activado');
            // Notificar al usuario que estamos en modo offline
            const notificationModule = await import('../../../../components/notifications');
            notificationModule.showNotification('Modo sin conexión', 'Las facturas electrónicas se enviarán cuando se restablezca la conexión', 'warning');
        }
    }
    
    /**
     * Renueva el token de autenticación con AFIP
     */
    async refreshToken() {
        if (this.offlineMode) {
            logger.warn('ARCA: No se puede renovar token sin conexión');
            return false;
        }
        
        try {
            if (!this.certificateData) {
                logger.error('ARCA: No se encontró certificado digital');
                configStatus.errors.push('No se encontró certificado digital');
                return false;
            }
            
            const response = await arcaApi.authenticate({
                cuit: this.cuit,
                certificateData: this.certificateData,
                environment: configStatus.environment
            });
            
            if (response && response.token) {
                this.token = response.token;
                this.tokenExpiry = response.expiry;
                
                // Guardar en la base de datos
                await database.saveConfig('arca', {
                    token: this.token,
                    tokenExpiry: this.tokenExpiry,
                    cuit: this.cuit,
                    razonSocial: this.razonSocial,
                    puntoVenta: this.puntoVenta,
                    environment: configStatus.environment,
                    certificateData: this.certificateData,
                    inicioActividades: this.inicioActividades,
                    condicionIVA: this.condicionIVA,
                    domicilioFiscal: this.domicilioFiscal,
                    ingresosBrutos: this.ingresosBrutos
                });
                
                configStatus.connected = true;
                configStatus.lastSync = new Date();
                logger.info('ARCA: Token renovado con éxito');
                
                return true;
            } else {
                configStatus.connected = false;
                configStatus.errors.push('Error en autenticación con AFIP');
                logger.error('ARCA: Error en autenticación con AFIP');
                return false;
            }
        } catch (error) {
            configStatus.connected = false;
            configStatus.errors.push('Error en autenticación: ' + error.message);
            logger.error('ARCA: Error en renovación de token', error);
            return false;
        }
    }
    
    /**
     * Verifica si el sistema está listo para facturar electrónicamente
     * @returns {boolean} Estado de la configuración
     */
    isConfiguredAndReady() {
        // Verificar que tengamos todos los datos necesarios
        const hasRequiredData = this.cuit && 
                                this.razonSocial && 
                                this.puntoVenta && 
                                this.certificateData &&
                                this.token &&
                                this.tokenExpiry;
        
        // Verificar que el token sea válido
        const tokenValid = this.tokenExpiry && new Date(this.tokenExpiry) > new Date();
        
        return hasRequiredData && (tokenValid || this.offlineMode);
    }
    
    /**
     * Genera y envía una factura electrónica
     * @param {Object} invoiceData - Datos de la factura
     * @returns {Object} Resultado de la operación
     */
    async generateInvoice(invoiceData) {
        // Registrar la solicitud de facturación
        logger.info('ARCA: Iniciando generación de factura', { 
            tipo: invoiceData.tipoComprobante, 
            cliente: invoiceData.cliente.nombre 
        });
        
        // Verificar si el sistema está configurado
        if (!this.isConfiguredAndReady()) {
            if (!this.offlineMode) {
                await this.refreshToken();
                if (!this.isConfiguredAndReady()) {
                    logger.error('ARCA: Sistema no configurado correctamente para facturación');
                    return {
                        success: false,
                        error: 'Sistema no configurado correctamente para facturación electrónica',
                        offlineMode: false
                    };
                }
            } else {
                // En modo offline, guardar para procesar después
                return this.saveInvoiceForLater(invoiceData);
            }
        }
        
        // Verificar si estamos en modo offline
        if (this.offlineMode) {
            return this.saveInvoiceForLater(invoiceData);
        }
        
        try {
            // Preparar datos de factura para AFIP
            const preparedData = this.prepareInvoiceData(invoiceData);
            
            // Enviar a AFIP
            const result = await arcaFacturacion.createInvoice({
                token: this.token,
                cuit: this.cuit,
                puntoVenta: this.puntoVenta,
                environment: configStatus.environment,
                invoiceData: preparedData
            });
            
            if (result.success) {
                // Actualizar la factura con los datos de AFIP
                await database.updateInvoice(invoiceData.id, {
                    afipData: result.data,
                    afipStatus: 'APROBADO',
                    cae: result.data.cae,
                    caeFechaVto: result.data.caeFechaVto,
                    procesada: true
                });
                
                logger.info('ARCA: Factura generada con éxito', { 
                    numeroFactura: result.data.numeroComprobante,
                    cae: result.data.cae
                });
                
                return {
                    success: true,
                    data: result.data,
                    offlineMode: false
                };
            } else {
                logger.error('ARCA: Error al generar factura en AFIP', result.error);
                
                // Guardar el error para referencia
                await database.updateInvoice(invoiceData.id, {
                    afipStatus: 'ERROR',
                    afipError: result.error,
                    procesada: false
                });
                
                return {
                    success: false,
                    error: result.error,
                    offlineMode: false
                };
            }
        } catch (error) {
            logger.error('ARCA: Error en proceso de facturación', error);
            
            // Si hay un error de conexión, guardar para procesar después
            if (error.message.includes('network') || error.message.includes('conexión')) {
                this.offlineMode = true;
                return this.saveInvoiceForLater(invoiceData);
            }
            
            return {
                success: false,
                error: error.message,
                offlineMode: false
            };
        }
    }
    
    /**
     * Guarda una factura para procesarla más tarde cuando haya conexión
     * @param {Object} invoiceData - Datos de la factura
     * @returns {Object} Resultado de la operación
     */
    async saveInvoiceForLater(invoiceData) {
        try {
            // Marcar como pendiente en la base de datos
            await database.updateInvoice(invoiceData.id, {
                afipStatus: 'PENDIENTE',
                procesada: false
            });
            
            // Agregar a la lista de pendientes
            this.pendingInvoices.push(invoiceData.id);
            await database.setPendingInvoices(this.pendingInvoices);
            
            logger.info('ARCA: Factura guardada para procesamiento posterior', { 
                facturaId: invoiceData.id,
                offlineMode: this.offlineMode
            });
            
            return {
                success: true,
                offlineMode: true,
                message: 'La factura se procesará cuando se restablezca la conexión'
            };
        } catch (error) {
            logger.error('ARCA: Error al guardar factura para procesamiento posterior', error);
            return {
                success: false,
                offlineMode: true,
                error: 'Error al guardar factura para procesamiento posterior: ' + error.message
            };
        }
    }
    
    /**
     * Carga facturas pendientes de la base de datos
     */
    async loadPendingInvoices() {
        try {
            const pendingInvoices = await database.getPendingInvoices();
            if (pendingInvoices && Array.isArray(pendingInvoices)) {
                this.pendingInvoices = pendingInvoices;
                logger.info(`ARCA: ${pendingInvoices.length} facturas pendientes cargadas`);
            }
        } catch (error) {
            logger.error('ARCA: Error al cargar facturas pendientes', error);
        }
    }
    
    /**
     * Procesa facturas pendientes cuando se restablece la conexión
     */
    async processPendingInvoices() {
        if (this.offlineMode || !this.isConfiguredAndReady() || this.pendingInvoices.length === 0) {
            return;
        }
        
        logger.info(`ARCA: Procesando ${this.pendingInvoices.length} facturas pendientes`);
        
        const notificationModule = await import('../../../../components/notifications');
        notificationModule.showNotification(
            'Procesando facturas pendientes', 
            `Se están enviando ${this.pendingInvoices.length} facturas a AFIP`,
            'info'
        );
        
        // Procesar cada factura pendiente
        const processedIds = [];
        
        for (const invoiceId of this.pendingInvoices) {
            try {
                // Obtener datos de la factura
                const invoiceData = await database.getInvoice(invoiceId);
                
                if (!invoiceData) {
                    logger.warn(`ARCA: No se encontró la factura pendiente ID ${invoiceId}`);
                    processedIds.push(invoiceId);
                    continue;
                }
                
                // Intentar enviar a AFIP
                const result = await this.generateInvoice(invoiceData);
                
                if (result.success && !result.offlineMode) {
                    processedIds.push(invoiceId);
                    
                    notificationModule.showNotification(
                        'Factura procesada', 
                        `Factura #${invoiceData.numeroFactura} procesada correctamente en AFIP`,
                        'success'
                    );
                }
            } catch (error) {
                logger.error(`ARCA: Error al procesar factura pendiente ID ${invoiceId}`, error);
            }
        }
        
        // Eliminar las facturas procesadas de la lista de pendientes
        if (processedIds.length > 0) {
            this.pendingInvoices = this.pendingInvoices.filter(id => !processedIds.includes(id));
            await database.setPendingInvoices(this.pendingInvoices);
            
            logger.info(`ARCA: ${processedIds.length} facturas pendientes procesadas correctamente`);
        }
    }
    
    /**
     * Prepara los datos de la factura para el formato requerido por AFIP
     * @param {Object} invoiceData - Datos de la factura
     * @returns {Object} Datos formateados para AFIP
     */
    prepareInvoiceData(invoiceData) {
        // Determinar el tipo de comprobante según AFIP
        let codigoComprobante;
        switch (invoiceData.tipoComprobante) {
            case 'A':
                codigoComprobante = 1;
                break;
            case 'B':
                codigoComprobante = 6;
                break;
            case 'C':
                codigoComprobante = 11;
                break;
            default:
                codigoComprobante = 6; // Factura B por defecto
        }
        
        // Determinar tipo de documento del cliente
        let tipoDocumentoCliente = 99; // Consumidor Final por defecto
        if (invoiceData.cliente.documentoTipo === 'CUIT') {
            tipoDocumentoCliente = 80;
        } else if (invoiceData.cliente.documentoTipo === 'DNI') {
            tipoDocumentoCliente = 96;
        }
        
        // Calcular importes
        const importeTotal = parseFloat(invoiceData.total);
        const importeNeto = parseFloat(invoiceData.subtotal);
        const importeIVA = parseFloat(invoiceData.iva || 0);
        
        // Formatear fecha
        const fecha = new Date(invoiceData.fecha);
        const fechaFormatted = `${fecha.getFullYear()}${String(fecha.getMonth() + 1).padStart(2, '0')}${String(fecha.getDate()).padStart(2, '0')}`;
        
        // Preparar estructura de datos para AFIP
        return {
            codigoComprobante,
            puntoVenta: this.puntoVenta,
            fechaComprobante: fechaFormatted,
            importeTotal: importeTotal.toFixed(2),
            importeNeto: importeNeto.toFixed(2),
            importeIVA: importeIVA.toFixed(2),
            codigoMoneda: 'PES', // Pesos argentinos
            cotizacionMoneda: 1,
            
            // Datos del cliente
            documentoTipoCliente: tipoDocumentoCliente,
            documentoNroCliente: invoiceData.cliente.documentoNro || '0',
            razonSocialCliente: invoiceData.cliente.nombre,
            emailCliente: invoiceData.cliente.email,
            
            // Conceptos facturados
            items: invoiceData.items.map(item => ({
                descripcion: item.descripcion,
                cantidad: item.cantidad,
                precioUnitario: parseFloat(item.precioUnitario).toFixed(2),
                importeItem: parseFloat(item.importe).toFixed(2),
                alicuotaIVA: 21.00 // Alícuota de IVA estándar, podría variar según el producto
            }))
        };
    }
    
    /**
     * Consulta una factura por número
     * @param {string} tipo - Tipo de comprobante (A, B, C)
     * @param {number} numero - Número de factura
     * @returns {Object} Información de la factura
     */
    async consultarFactura(tipo, numero) {
        if (!this.isConfiguredAndReady() || this.offlineMode) {
            return {
                success: false,
                error: this.offlineMode ? 'Sin conexión a internet' : 'Sistema no configurado correctamente'
            };
        }
        
        try {
            // Convertir tipo de factura a código AFIP
            let codigoComprobante;
            switch (tipo) {
                case 'A': codigoComprobante = 1; break;
                case 'B': codigoComprobante = 6; break;
                case 'C': codigoComprobante = 11; break;
                default: codigoComprobante = 6;
            }
            
            const result = await arcaFacturacion.getInvoice({
                token: this.token,
                cuit: this.cuit,
                puntoVenta: this.puntoVenta,
                tipoComprobante: codigoComprobante,
                numeroComprobante: numero,
                environment: configStatus.environment
            });
            
            return result;
        } catch (error) {
            logger.error('ARCA: Error al consultar factura', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    /**
     * Descarga una constancia de factura electrónica
     * @param {Object} invoiceData - Datos de la factura
     * @returns {Object} URL o Blob del PDF
     */
    async descargarConstancia(invoiceData) {
        if (!this.isConfiguredAndReady() || this.offlineMode) {
            return {
                success: false,
                error: this.offlineMode ? 'Sin conexión a internet' : 'Sistema no configurado correctamente'
            };
        }
        
        try {
            // Verificar que la factura tenga CAE
            if (!invoiceData.cae) {
                return {
                    success: false,
                    error: 'La factura no tiene CAE asignado'
                };
            }
            
            // Convertir tipo de factura a código AFIP
            let codigoComprobante;
            switch (invoiceData.tipoComprobante) {
                case 'A': codigoComprobante = 1; break;
                case 'B': codigoComprobante = 6; break;
                case 'C': codigoComprobante = 11; break;
                default: codigoComprobante = 6;
            }
            
            const result = await arcaFacturacion.downloadInvoicePDF({
                token: this.token,
                cuit: this.cuit,
                puntoVenta: this.puntoVenta,
                tipoComprobante: codigoComprobante,
                numeroComprobante: invoiceData.numeroFactura,
                cae: invoiceData.cae,
                environment: configStatus.environment
            });
            
            return result;
        } catch (error) {
            logger.error('ARCA: Error al descargar constancia', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    /**
     * Solicita último número de comprobante para un tipo de factura
     * @param {string} tipo - Tipo de comprobante (A, B, C)
     * @returns {Object} Último número
     */
    async obtenerUltimoNumeroComprobante(tipo) {
        if (!this.isConfiguredAndReady() || this.offlineMode) {
            return {
                success: false,
                error: this.offlineMode ? 'Sin conexión a internet' : 'Sistema no configurado correctamente',
                numero: 0
            };
        }
        
        try {
            // Convertir tipo de factura a código AFIP
            let codigoComprobante;
            switch (tipo) {
                case 'A': codigoComprobante = 1; break;
                case 'B': codigoComprobante = 6; break;
                case 'C': codigoComprobante = 11; break;
                default: codigoComprobante = 6;
            }
            
            const result = await arcaFacturacion.getLastInvoiceNumber({
                token: this.token,
                cuit: this.cuit,
                puntoVenta: this.puntoVenta,
                tipoComprobante: codigoComprobante,
                environment: configStatus.environment
            });
            
            if (result.success) {
                logger.info(`ARCA: Último número de comprobante ${tipo}: ${result.numero}`);
                return {
                    success: true,
                    numero: result.numero
                };
            } else {
                logger.error('ARCA: Error al obtener último número de comprobante', result.error);
                return {
                    success: false,
                    error: result.error,
                    numero: 0
                };
            }
        } catch (error) {
            logger.error('ARCA: Error al obtener último número de comprobante', error);
            return {
                success: false,
                error: error.message,
                numero: 0
            };
        }
    }
    
    /**
     * Verifica si una factura debe ser electrónica según el método de pago
     * @param {Object} metodoPago - Método de pago
     * @returns {boolean} Debe ser electrónica
     */
    debeSerElectronica(metodoPago) {
        const metodosElectronicos = ['transferencia', 'tarjeta_debito', 'tarjeta_credito', 'qr'];
        return metodosElectronicos.includes(metodoPago.tipo);
    }
    
    /**
     * Guarda la configuración de ARCA/AFIP
     * @param {Object} config - Configuración a guardar
     * @returns {Object} Resultado de la operación
     */
    async saveConfiguration(config) {
        try {
            // Validar configuración
            if (!config.cuit || !config.razonSocial || !config.puntoVenta) {
                return {
                    success: false,
                    error: 'Faltan campos obligatorios'
                };
            }
            
            // Actualizar propiedades
            this.cuit = config.cuit;
            this.razonSocial = config.razonSocial;
            this.puntoVenta = config.puntoVenta;
            this.inicioActividades = config.inicioActividades;
            this.condicionIVA = config.condicionIVA;
            this.domicilioFiscal = config.domicilioFiscal;
            this.ingresosBrutos = config.ingresosBrutos;
            
            // Si hay un nuevo certificado, actualizarlo
            if (config.certificateData) {
                this.certificateData = config.certificateData;
            }
            
            // Si se cambió el entorno, actualizar
            if (config.environment) {
                configStatus.environment = config.environment;
            }
            
            // Guardar en la base de datos
            await database.saveConfig('arca', {
                cuit: this.cuit,
                razonSocial: this.razonSocial,
                puntoVenta: this.puntoVenta,
                inicioActividades: this.inicioActividades,
                condicionIVA: this.condicionIVA,
                domicilioFiscal: this.domicilioFiscal,
                ingresosBrutos: this.ingresosBrutos,
                certificateData: this.certificateData,
                environment: configStatus.environment,
                token: this.token,
                tokenExpiry: this.tokenExpiry
            });
            
            // Intentar actualizar el token
            if (this.certificateData && !this.offlineMode) {
                await this.refreshToken();
            }
            
            logger.info('ARCA: Configuración guardada con éxito');
            
            return {
                success: true
            };
        } catch (error) {
            logger.error('ARCA: Error al guardar configuración', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    /**
     * Sube un certificado digital
     * @param {File} file - Archivo del certificado
     * @param {string} password - Contraseña del certificado
     * @returns {Object} Resultado de la operación
     */
    async uploadCertificate(file, password) {
        try {
            // Verificar archivo
            if (!file) {
                return {
                    success: false,
                    error: 'No se seleccionó ningún archivo'
                };
            }
            
            // Leer archivo
            const reader = new FileReader();
            const fileData = await new Promise((resolve, reject) => {
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
            
            // Validar certificado con AFIP
            const validationResult = await arcaApi.validateCertificate({
                certificateData: fileData,
                password: password,
                environment: configStatus.environment
            });
            
            if (validationResult.success) {
                // Guardar certificado
                this.certificateData = {
                    data: fileData,
                    password: password,
                    validUntil: validationResult.validUntil
                };
                
                configStatus.certificateStatus = {
                    valid: true,
                    validUntil: validationResult.validUntil
                };
                
                // Actualizar configuración
                await database.saveConfig('arca', {
                    ...await database.getConfig('arca'),
                    certificateData: this.certificateData
                });
                
                // Renovar token con el nuevo certificado
                await this.refreshToken();
                
                logger.info('ARCA: Certificado subido y validado correctamente');
                
                return {
                    success: true,
                    validUntil: validationResult.validUntil
                };
            } else {
                logger.error('ARCA: Error en validación de certificado', validationResult.error);
                
                configStatus.certificateStatus = {
                    valid: false,
                    error: validationResult.error
                };
                
                return {
                    success: false,
                    error: validationResult.error
                };
            }
        } catch (error) {
            logger.error('ARCA: Error al procesar certificado', error);
            
            configStatus.certificateStatus = {
                valid: false,
                error: error.message
            };
            
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    /**
     * Consulta el estado del servicio AFIP
     * @returns {Object} Estado del servicio
     */
    async checkServiceStatus() {
        try {
            if (this.offlineMode) {
                return {
                    success: false,
                    error: 'Sin conexión a internet'
                };
            }
            
            const status = await arcaApi.getServiceStatus({
                environment: configStatus.environment
            });
            
            logger.info('ARCA: Estado del servicio consultado', status);
            
            return status;
        } catch (error) {
            logger.error('ARCA: Error al consultar estado del servicio', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    /**
     * Obtiene los puntos de venta habilitados para el CUIT
     * @returns {Object} Lista de puntos de venta
     */
    async getPuntosVenta() {
        try {
            if (!this.isConfiguredAndReady() || this.offlineMode) {
                return {
                    success: false,
                    error: this.offlineMode ? 'Sin conexión a internet' : 'Sistema no configurado correctamente',
                    puntos: []
                };
            }
            
            const result = await arcaApi.getPuntosVenta({
                token: this.token,
                cuit: this.cuit,
                environment: configStatus.environment
            });
            
            logger.info('ARCA: Puntos de venta consultados', result);
            
            return result;
        } catch (error) {
            logger.error('ARCA: Error al consultar puntos de venta', error);
            return {
                success: false,
                error: error.message,
                puntos: []
            };
        }
    }
    
    /**
     * Obtiene los tipos de comprobantes disponibles para el contribuyente
     * @returns {Object} Lista de tipos de comprobantes
     */
    async getTiposComprobante() {
        try {
            if (!this.isConfiguredAndReady() || this.offlineMode) {
                return {
                    success: false,
                    error: this.offlineMode ? 'Sin conexión a internet' : 'Sistema no configurado correctamente',
                    tipos: []
                };
            }
            
            const result = await arcaApi.getTiposComprobante({
                token: this.token,
                cuit: this.cuit,
                environment: configStatus.environment
            });
            
            logger.info('ARCA: Tipos de comprobante consultados', result);
            
            return result;
        } catch (error) {
            logger.error('ARCA: Error al consultar tipos de comprobante', error);
            return {
                success: false,
                error: error.message,
                tipos: []
            };
        }
    }
    
    /**
     * Obtiene información fiscal del contribuyente
     * @param {string} cuit - CUIT a consultar
     * @returns {Object} Información del contribuyente
     */
    async getContribuyenteInfo(cuit = null) {
        try {
            if (this.offlineMode) {
                return {
                    success: false,
                    error: 'Sin conexión a internet',
                    data: null
                };
            }
            
            // Si no se especifica un CUIT, usar el configurado
            const cuitToQuery = cuit || this.cuit;
            
            if (!cuitToQuery) {
                return {
                    success: false,
                    error: 'No se especificó CUIT',
                    data: null
                };
            }
            
            // Para consultar otro CUIT necesitamos estar autenticados
            if (cuit && (!this.token || new Date(this.tokenExpiry) <= new Date())) {
                await this.refreshToken();
                if (!this.token) {
                    return {
                        success: false,
                        error: 'No hay token válido para consultar',
                        data: null
                    };
                }
            }
            
            const result = await arcaApi.getContribuyenteInfo({
                token: this.token,
                cuit: cuitToQuery,
                environment: configStatus.environment
            });
            
            logger.info(`ARCA: Información del contribuyente ${cuitToQuery} consultada`, result);
            
            return result;
        } catch (error) {
            logger.error('ARCA: Error al consultar información del contribuyente', error);
            return {
                success: false,
                error: error.message,
                data: null
            };
        }
    }
    
    /**
     * Verifica si un CUIT es válido
     * @param {string} cuit - CUIT a verificar
     * @returns {Object} Resultado de la validación
     */
    async verificarCuit(cuit) {
        try {
            if (this.offlineMode) {
                // Validación básica de formato en modo offline
                return {
                    success: validation.isValidCuit(cuit),
                    message: validation.isValidCuit(cuit) ? 'CUIT con formato válido' : 'Formato de CUIT inválido',
                    warning: 'Verificación completa no disponible sin conexión'
                };
            }
            
            const result = await arcaApi.verificarCuit({
                cuit: cuit,
                environment: configStatus.environment
            });
            
            logger.info(`ARCA: CUIT ${cuit} verificado`, result);
            
            return result;
        } catch (error) {
            logger.error('ARCA: Error al verificar CUIT', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    /**
     * Obtiene alícuotas de IVA disponibles
     * @returns {Object} Lista de alícuotas
     */
    async getAlicuotasIVA() {
        try {
            if (!this.isConfiguredAndReady() || this.offlineMode) {
                // En modo offline, devolver valores predeterminados
                return {
                    success: true,
                    alicuotas: [
                        { id: '5', descripcion: 'IVA 21%', valor: 21 },
                        { id: '4', descripcion: 'IVA 10.5%', valor: 10.5 },
                        { id: '6', descripcion: 'IVA 27%', valor: 27 },
                        { id: '3', descripcion: 'IVA 0%', valor: 0 },
                        { id: '9', descripcion: 'IVA Exento', valor: 0 }
                    ],
                    offlineMode: true
                };
            }
            
            const result = await arcaApi.getAlicuotasIVA({
                token: this.token,
                environment: configStatus.environment
            });
            
            logger.info('ARCA: Alícuotas de IVA consultadas', result);
            
            return result;
        } catch (error) {
            logger.error('ARCA: Error al consultar alícuotas de IVA', error);
            // En caso de error, devolver valores predeterminados
            return {
                success: true,
                alicuotas: [
                    { id: '5', descripcion: 'IVA 21%', valor: 21 },
                    { id: '4', descripcion: 'IVA 10.5%', valor: 10.5 },
                    { id: '6', descripcion: 'IVA 27%', valor: 27 },
                    { id: '3', descripcion: 'IVA 0%', valor: 0 },
                    { id: '9', descripcion: 'IVA Exento', valor: 0 }
                ],
                warning: 'Usando valores predeterminados debido a un error: ' + error.message
            };
        }
    }
    
    /**
     * Genera código QR para factura electrónica según normativa AFIP
     * @param {Object} facturaData - Datos de la factura
     * @returns {string} URL del código QR
     */
    generateQrCode(facturaData) {
        try {
            if (!facturaData || !facturaData.cae) {
                logger.warn('ARCA: Intentando generar QR sin CAE');
                return null;
            }
            
            // Crear objeto de datos según especificación AFIP
            const qrData = {
                ver: 1,                                // Versión del formato de los datos del código QR
                fecha: facturaData.fecha,              // Fecha de emisión
                cuit: this.cuit,                       // CUIT del emisor
                ptoVta: this.puntoVenta,               // Punto de venta
                tipoCmp: this.getCodigoComprobante(facturaData.tipoComprobante), // Tipo de comprobante
                nroCmp: facturaData.numeroFactura,     // Número de comprobante
                importe: parseFloat(facturaData.total), // Importe total
                moneda: 'PES',                         // Código de moneda
                ctz: 1,                                // Cotización
                tipoDocRec: this.getTipoDocumento(facturaData.cliente.documentoTipo), // Tipo de documento del receptor
                nroDocRec: facturaData.cliente.documentoNro || '0', // Número de documento del receptor
                tipoCodAut: 'E',                       // Tipo de código de autorización (E: CAE, A: CAA)
                codAut: facturaData.cae                // Código de autorización
            };
            
            // Convertir a JSON y codificar en Base64
            const jsonData = JSON.stringify(qrData);
            const base64Data = btoa(jsonData);
            
            // Generar URL para el código QR según especificación AFIP
            const qrUrl = `https://www.afip.gob.ar/fe/qr/?p=${base64Data}`;
            
            logger.info('ARCA: Código QR generado correctamente');
            
            return qrUrl;
        } catch (error) {
            logger.error('ARCA: Error al generar código QR', error);
            return null;
        }
    }
    
    /**
     * Obtiene el código AFIP para un tipo de comprobante
     * @param {string} tipoComprobante - Tipo de comprobante (A, B, C)
     * @returns {number} Código AFIP
     */
    getCodigoComprobante(tipoComprobante) {
        switch (tipoComprobante) {
            case 'A': return 1;
            case 'B': return 6;
            case 'C': return 11;
            case 'NC-A': return 3;  // Nota de Crédito A
            case 'NC-B': return 8;  // Nota de Crédito B
            case 'NC-C': return 13; // Nota de Crédito C
            case 'ND-A': return 2;  // Nota de Débito A
            case 'ND-B': return 7;  // Nota de Débito B
            case 'ND-C': return 12; // Nota de Débito C
            default: return 6;      // Factura B por defecto
        }
    }
    
    /**
     * Obtiene el código AFIP para un tipo de documento
     * @param {string} tipoDocumento - Tipo de documento
     * @returns {number} Código AFIP
     */
    getTipoDocumento(tipoDocumento) {
        switch (tipoDocumento) {
            case 'CUIT': return 80;
            case 'CUIL': return 86;
            case 'DNI': return 96;
            case 'Pasaporte': return 94;
            case 'CDI': return 87;
            case 'LE': return 89;
            case 'LC': return 90;
            default: return 99;     // Consumidor Final por defecto
        }
    }
    
    /**
     * Determina si un cliente requiere factura electrónica según su monto
     * @param {number} monto - Monto de la factura
     * @returns {boolean} Requiere factura electrónica
     */
    requiereFacturaElectronica(monto) {
        // Según normativa vigente de AFIP (actualizar según cambios regulatorios)
        const montoMinimo = 22500; // Ejemplo - Actualizar según normativa vigente
        return monto >= montoMinimo;
    }
    
    /**
     * Verifica si el cliente debe proporcionar datos adicionales según el monto
     * @param {number} monto - Monto de la factura
     * @returns {boolean} Requiere datos adicionales
     */
    requiereDatosAdicionales(monto) {
        // Según normativa vigente de AFIP (actualizar según cambios regulatorios)
        const montoMinimo = 18000; // Ejemplo - Actualizar según normativa vigente
        return monto >= montoMinimo;
    }
    
    /**
     * Obtiene el estado actual de la configuración
     * @returns {Object} Estado de la configuración
     */
    getStatus() {
        return {
            configured: this.isConfiguredAndReady(),
            connected: configStatus.connected,
            lastSync: configStatus.lastSync,
            certificate: configStatus.certificateStatus,
            environment: configStatus.environment,
            errors: configStatus.errors,
            pendingInvoices: this.pendingInvoices.length,
            offlineMode: this.offlineMode
        };
    }
    
    /**
     * Cambia el entorno (testing/producción)
     * @param {string} environment - Entorno ('testing' o 'production')
     * @returns {Object} Resultado de la operación
     */
    async changeEnvironment(environment) {
        try {
            if (environment !== 'testing' && environment !== 'production') {
                return {
                    success: false,
                    error: 'Entorno inválido. Debe ser "testing" o "production"'
                };
            }
            
            // Cambiar entorno
            configStatus.environment = environment;
            
            // Actualizar configuración
            await database.saveConfig('arca', {
                ...await database.getConfig('arca'),
                environment: environment
            });
            
            // Renovar token con el nuevo entorno
            await this.refreshToken();
            
            logger.info(`ARCA: Entorno cambiado a ${environment}`);
            
            return {
                success: true
            };
        } catch (error) {
            logger.error('ARCA: Error al cambiar entorno', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    /**
     * Crea una nota de crédito o débito relacionada a una factura
     * @param {Object} noteData - Datos de la nota
     * @param {Object} originalInvoice - Factura original
     * @returns {Object} Resultado de la operación
     */
    async createCreditDebitNote(noteData, originalInvoice) {
        try {
            if (!this.isConfiguredAndReady()) {
                if (!this.offlineMode) {
                    await this.refreshToken();
                    if (!this.isConfiguredAndReady()) {
                        return {
                            success: false,
                            error: 'Sistema no configurado para emitir notas electrónicas',
                            offlineMode: false
                        };
                    }
                } else {
                    return this.saveNoteForLater(noteData, originalInvoice);
                }
            }
            
            if (this.offlineMode) {
                return this.saveNoteForLater(noteData, originalInvoice);
            }
            
            // Preparar datos para AFIP
            const preparedData = this.prepareNoteData(noteData, originalInvoice);
            
            // Enviar a AFIP
            const result = await arcaFacturacion.createNote({
                token: this.token,
                cuit: this.cuit,
                puntoVenta: this.puntoVenta,
                environment: configStatus.environment,
                noteData: preparedData
            });
            
            if (result.success) {
                // Actualizar la nota con los datos de AFIP
                await database.updateNote(noteData.id, {
                    afipData: result.data,
                    afipStatus: 'APROBADO',
                    cae: result.data.cae,
                    caeFechaVto: result.data.caeFechaVto,
                    procesada: true
                });
                
                logger.info(`ARCA: Nota de ${noteData.tipo === 'credito' ? 'crédito' : 'débito'} emitida con éxito`, { 
                    numeroNota: result.data.numeroComprobante,
                    cae: result.data.cae
                });
                
                return {
                    success: true,
                    data: result.data,
                    offlineMode: false
                };
            } else {
                logger.error(`ARCA: Error al emitir nota de ${noteData.tipo === 'credito' ? 'crédito' : 'débito'}`, result.error);
                
                // Guardar el error para referencia
                await database.updateNote(noteData.id, {
                    afipStatus: 'ERROR',
                    afipError: result.error,
                    procesada: false
                });
                
                return {
                    success: false,
                    error: result.error,
                    offlineMode: false
                };
            }
        } catch (error) {
            logger.error(`ARCA: Error al emitir nota de ${noteData.tipo === 'credito' ? 'crédito' : 'débito'}`, error);
            
            // Si hay un error de conexión, guardar para procesar después
            if (error.message.includes('network') || error.message.includes('conexión')) {
                this.offlineMode = true;
                return this.saveNoteForLater(noteData, originalInvoice);
            }
            
            return {
                success: false,
                error: error.message,
                offlineMode: false
            };
        }
    }
    
    /**
     * Guarda una nota para procesarla más tarde
     * @param {Object} noteData - Datos de la nota
     * @param {Object} originalInvoice - Factura original
     * @returns {Object} Resultado de la operación
     */
    async saveNoteForLater(noteData, originalInvoice) {
        try {
            // Guardar referencia a la factura original
            noteData.facturaOriginalId = originalInvoice.id;
            
            // Marcar como pendiente
            await database.updateNote(noteData.id, {
                afipStatus: 'PENDIENTE',
                procesada: false,
                facturaOriginalId: originalInvoice.id
            });
            
            // Agregar a lista de pendientes (junto con la factura original)
            this.pendingInvoices.push({
                id: noteData.id,
                type: 'note',
                facturaOriginalId: originalInvoice.id
            });
            
            await database.setPendingInvoices(this.pendingInvoices);
            
            logger.info(`ARCA: Nota de ${noteData.tipo === 'credito' ? 'crédito' : 'débito'} guardada para procesamiento posterior`, { 
                notaId: noteData.id,
                facturaOriginalId: originalInvoice.id
            });
            
            return {
                success: true,
                offlineMode: true,
                message: 'La nota se procesará cuando se restablezca la conexión'
            };
        } catch (error) {
            logger.error(`ARCA: Error al guardar nota de ${noteData.tipo === 'credito' ? 'crédito' : 'débito'} para procesamiento posterior`, error);
            return {
                success: false,
                offlineMode: true,
                error: 'Error al guardar nota para procesamiento posterior: ' + error.message
            };
        }
    }
    
    /**
     * Prepara los datos de la nota para AFIP
     * @param {Object} noteData - Datos de la nota
     * @param {Object} originalInvoice - Factura original
     * @returns {Object} Datos formateados para AFIP
     */
    prepareNoteData(noteData, originalInvoice) {
        // Determinar tipo de comprobante según tipo de nota y tipo de factura original
        let codigoComprobante;
        const tipoFacturaOriginal = originalInvoice.tipoComprobante;
        
        if (noteData.tipo === 'credito') {
            // Notas de crédito
            switch (tipoFacturaOriginal) {
                case 'A': codigoComprobante = 3; break;  // NC-A
                case 'B': codigoComprobante = 8; break;  // NC-B
                case 'C': codigoComprobante = 13; break; // NC-C
                default: codigoComprobante = 8;          // NC-B por defecto
            }
        } else {
            // Notas de débito
            switch (tipoFacturaOriginal) {
                case 'A': codigoComprobante = 2; break;  // ND-A
                case 'B': codigoComprobante = 7; break;  // ND-B
                case 'C': codigoComprobante = 12; break; // ND-C
                default: codigoComprobante = 7;          // ND-B por defecto
            }
        }
        
        // Formatear fecha
        const fecha = new Date(noteData.fecha);
        const fechaFormatted = `${fecha.getFullYear()}${String(fecha.getMonth() + 1).padStart(2, '0')}${String(fecha.getDate()).padStart(2, '0')}`;
        
        // Datos del cliente (de la factura original)
        const tipoDocumentoCliente = this.getTipoDocumento(originalInvoice.cliente.documentoTipo);
        
        // Preparar estructura de datos para AFIP
        return {
            codigoComprobante,
            puntoVenta: this.puntoVenta,
            fechaComprobante: fechaFormatted,
            importeTotal: parseFloat(noteData.total).toFixed(2),
            importeNeto: parseFloat(noteData.subtotal).toFixed(2),
            importeIVA: parseFloat(noteData.iva || 0).toFixed(2),
            codigoMoneda: 'PES',
            cotizacionMoneda: 1,
            
            // Datos del cliente
            documentoTipoCliente: tipoDocumentoCliente,
            documentoNroCliente: originalInvoice.cliente.documentoNro || '0',
            razonSocialCliente: originalInvoice.cliente.nombre,
            emailCliente: originalInvoice.cliente.email,
            
            // Referencia a comprobante original
            comprobanteAsociado: {
                tipo: this.getCodigoComprobante(tipoFacturaOriginal),
                puntoVenta: this.puntoVenta,
                numero: originalInvoice.numeroFactura
            },
            
            // Conceptos
            items: noteData.items.map(item => ({
                descripcion: item.descripcion,
                cantidad: item.cantidad,
                precioUnitario: parseFloat(item.precioUnitario).toFixed(2),
                importeItem: parseFloat(item.importe).toFixed(2),
                alicuotaIVA: 21.00 // Alícuota de IVA estándar, podría variar
            }))
        };
    }
}

// Exportar la clase
module.exports = new ArcaIntegration();