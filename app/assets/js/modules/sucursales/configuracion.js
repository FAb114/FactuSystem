/**
 * @file configuracion.js
 * @description Módulo para la configuración de sucursales en FactuSystem
 * @module modules/sucursales/configuracion
 */

// Importaciones de utilidades necesarias
import { db } from '../../../../utils/database.js';
import { showNotification } from '../../../../components/notifications.js';
import { validateForm } from '../../../../utils/validation.js';
import { syncManager } from '../../../../utils/sync.js';
import { logger } from '../../../../utils/logger.js';
import { backupManager } from '../../../../utils/backup.js';
import { getCurrentUser } from '../../../../utils/auth.js';

// Importaciones relacionadas con integraciones
import { testMercadoPagoConfig } from '../../../configuraciones/integraciones/mercadoPago.js';
import { testArcaConfig } from '../../../configuraciones/integraciones/arca.js';
import { testWhatsAppConfig } from '../../../configuraciones/integraciones/whatsapp.js';
import { testEmailConfig } from '../../../configuraciones/integraciones/email.js';
import { testBancoConfig } from '../../../configuraciones/integraciones/bancos/index.js';

/**
 * Clase principal para la configuración de sucursales
 */
class SucursalConfiguracion {
    constructor() {
        this.currentSucursal = null;
        this.isEditMode = false;
        this.configForm = null;
        this.syncSettings = null;
        this.fiscalSettings = null;
        this.integrationSettings = null;
        this.printSettings = null;
    }

    /**
     * Inicializa el módulo de configuración de sucursales
     */
    async init() {
        try {
            // Inicializar elementos del DOM
            this.configForm = document.getElementById('sucursal-config-form');
            this.syncSettings = document.getElementById('sync-settings');
            this.fiscalSettings = document.getElementById('fiscal-settings');
            this.integrationSettings = document.getElementById('integration-settings');
            this.printSettings = document.getElementById('print-settings');
            
            // Verificar si tenemos acceso a todos los elementos necesarios
            if (!this.configForm || !this.syncSettings || !this.fiscalSettings || 
                !this.integrationSettings || !this.printSettings) {
                throw new Error('No se pudieron encontrar todos los elementos del formulario de configuración');
            }
            
            // Cargar sucursal actual
            await this.loadCurrentSucursal();
            
            // Configurar eventos
            this.setupEventListeners();
            
            // Si estamos en modo edición, cargar los datos de la sucursal
            if (this.isEditMode && this.currentSucursal) {
                await this.loadSucursalData();
            } else {
                this.resetForm();
            }
            
            logger.info('Módulo de configuración de sucursales inicializado correctamente');
        } catch (error) {
            logger.error('Error al inicializar el módulo de configuración de sucursales', error);
            showNotification('Error al cargar la configuración de sucursales', 'error');
        }
    }

    /**
     * Configura los event listeners para el formulario y botones
     */
    setupEventListeners() {
        // Botón de guardar configuración
        const saveButton = document.getElementById('save-sucursal-config');
        if (saveButton) {
            saveButton.addEventListener('click', (e) => {
                e.preventDefault();
                this.saveSucursalConfig();
            });
        }
        
        // Botón de cancelar
        const cancelButton = document.getElementById('cancel-sucursal-config');
        if (cancelButton) {
            cancelButton.addEventListener('click', (e) => {
                e.preventDefault();
                window.location.href = '#/sucursales';
            });
        }
        
        // Botón de probar sincronización
        const testSyncButton = document.getElementById('test-sync-connection');
        if (testSyncButton) {
            testSyncButton.addEventListener('click', (e) => {
                e.preventDefault();
                this.testSyncConnection();
            });
        }
        
        // Botones para probar las diferentes integraciones
        this.setupIntegrationTestButtons();
        
        // Cambio en modo de sincronización
        const syncMode = document.getElementById('sync-mode');
        if (syncMode) {
            syncMode.addEventListener('change', () => this.toggleSyncOptions(syncMode.value));
        }
        
        // Cambio en estado fiscal
        const fiscalStatus = document.getElementById('fiscal-status');
        if (fiscalStatus) {
            fiscalStatus.addEventListener('change', () => this.toggleFiscalOptions(fiscalStatus.checked));
        }
    }
    
    /**
     * Configura los botones para probar las integraciones de la sucursal
     */
    setupIntegrationTestButtons() {
        // Botón para probar Mercado Pago
        const testMPButton = document.getElementById('test-mercadopago');
        if (testMPButton) {
            testMPButton.addEventListener('click', async (e) => {
                e.preventDefault();
                const accessToken = document.getElementById('mp-access-token').value;
                const publicKey = document.getElementById('mp-public-key').value;
                const userId = document.getElementById('mp-user-id').value;
                
                if (!accessToken || !publicKey) {
                    showNotification('Complete las credenciales de Mercado Pago', 'warning');
                    return;
                }
                
                try {
                    const result = await testMercadoPagoConfig({accessToken, publicKey, userId});
                    if (result.success) {
                        showNotification('Conexión con Mercado Pago exitosa', 'success');
                    } else {
                        showNotification(`Error en Mercado Pago: ${result.message}`, 'error');
                    }
                } catch (error) {
                    showNotification(`Error al probar Mercado Pago: ${error.message}`, 'error');
                }
            });
        }
        
        // Botón para probar ARCA (AFIP)
        const testArcaButton = document.getElementById('test-arca');
        if (testArcaButton) {
            testArcaButton.addEventListener('click', async (e) => {
                e.preventDefault();
                const cuit = document.getElementById('arca-cuit').value;
                const certificado = document.getElementById('arca-certificado').value;
                const clave = document.getElementById('arca-clave').value;
                
                if (!cuit || !certificado || !clave) {
                    showNotification('Complete los datos de ARCA/AFIP', 'warning');
                    return;
                }
                
                try {
                    const result = await testArcaConfig({cuit, certificado, clave});
                    if (result.success) {
                        showNotification('Conexión con ARCA exitosa', 'success');
                    } else {
                        showNotification(`Error en ARCA: ${result.message}`, 'error');
                    }
                } catch (error) {
                    showNotification(`Error al probar ARCA: ${error.message}`, 'error');
                }
            });
        }
        
        // Botón para probar integración con WhatsApp
        const testWhatsAppButton = document.getElementById('test-whatsapp');
        if (testWhatsAppButton) {
            testWhatsAppButton.addEventListener('click', async (e) => {
                e.preventDefault();
                const apiKey = document.getElementById('whatsapp-api-key').value;
                const phoneNumber = document.getElementById('whatsapp-phone').value;
                
                if (!apiKey || !phoneNumber) {
                    showNotification('Complete los datos de WhatsApp', 'warning');
                    return;
                }
                
                try {
                    const result = await testWhatsAppConfig({apiKey, phoneNumber});
                    if (result.success) {
                        showNotification('Conexión con WhatsApp exitosa', 'success');
                    } else {
                        showNotification(`Error en WhatsApp: ${result.message}`, 'error');
                    }
                } catch (error) {
                    showNotification(`Error al probar WhatsApp: ${error.message}`, 'error');
                }
            });
        }
        
        // Botón para probar Email
        const testEmailButton = document.getElementById('test-email');
        if (testEmailButton) {
            testEmailButton.addEventListener('click', async (e) => {
                e.preventDefault();
                const smtpServer = document.getElementById('email-smtp').value;
                const smtpPort = document.getElementById('email-port').value;
                const username = document.getElementById('email-user').value;
                const password = document.getElementById('email-password').value;
                
                if (!smtpServer || !smtpPort || !username || !password) {
                    showNotification('Complete los datos de Email', 'warning');
                    return;
                }
                
                try {
                    const result = await testEmailConfig({smtpServer, smtpPort, username, password});
                    if (result.success) {
                        showNotification('Conexión de Email exitosa', 'success');
                    } else {
                        showNotification(`Error en Email: ${result.message}`, 'error');
                    }
                } catch (error) {
                    showNotification(`Error al probar Email: ${error.message}`, 'error');
                }
            });
        }
    }
    
    /**
     * Carga la información de la sucursal actual
     */
    async loadCurrentSucursal() {
        try {
            // Obtener el ID de la sucursal de la URL si está presente (modo edición)
            const urlParams = new URLSearchParams(window.location.hash.split('?')[1]);
            const sucursalId = urlParams.get('id');
            
            if (sucursalId) {
                this.isEditMode = true;
                
                // Verificar si el usuario tiene permisos para editar esta sucursal
                const currentUser = getCurrentUser();
                if (!currentUser.permisos.includes('editar_sucursales')) {
                    throw new Error('No tiene permisos para editar sucursales');
                }
                
                // Cargar datos de la sucursal
                this.currentSucursal = await db.sucursales.get(parseInt(sucursalId));
                
                if (!this.currentSucursal) {
                    throw new Error(`No se encontró la sucursal con ID ${sucursalId}`);
                }
                
                // Actualizar título del formulario
                const formTitle = document.getElementById('config-form-title');
                if (formTitle) {
                    formTitle.textContent = `Configurar Sucursal: ${this.currentSucursal.nombre}`;
                }
            } else {
                // Modo creación - verificar permisos
                const currentUser = getCurrentUser();
                if (!currentUser.permisos.includes('crear_sucursales')) {
                    throw new Error('No tiene permisos para crear sucursales');
                }
                
                // Actualizar título
                const formTitle = document.getElementById('config-form-title');
                if (formTitle) {
                    formTitle.textContent = 'Crear Nueva Sucursal';
                }
            }
        } catch (error) {
            logger.error('Error al cargar la sucursal actual', error);
            showNotification(`Error: ${error.message}`, 'error');
            // Redirigir al listado de sucursales en caso de error
            setTimeout(() => {
                window.location.href = '#/sucursales';
            }, 2000);
        }
    }
    
    /**
     * Carga los datos de la sucursal en el formulario
     */
    async loadSucursalData() {
        try {
            if (!this.currentSucursal) return;
            
            // Datos básicos
            document.getElementById('sucursal-nombre').value = this.currentSucursal.nombre;
            document.getElementById('sucursal-direccion').value = this.currentSucursal.direccion;
            document.getElementById('sucursal-telefono').value = this.currentSucursal.telefono;
            document.getElementById('sucursal-email').value = this.currentSucursal.email;
            document.getElementById('sucursal-responsable').value = this.currentSucursal.responsable;
            
            // Configuración de sincronización
            document.getElementById('sync-mode').value = this.currentSucursal.config?.sync?.modo || 'manual';
            this.toggleSyncOptions(this.currentSucursal.config?.sync?.modo || 'manual');
            
            if (this.currentSucursal.config?.sync) {
                document.getElementById('sync-interval').value = this.currentSucursal.config.sync.intervalo || 30;
                document.getElementById('sync-server-url').value = this.currentSucursal.config.sync.serverUrl || '';
                document.getElementById('sync-api-key').value = this.currentSucursal.config.sync.apiKey || '';
                document.getElementById('sync-priority').value = this.currentSucursal.config.sync.prioridad || 'normal';
            }
            
            // Configuración fiscal
            const fiscalStatus = !!this.currentSucursal.config?.fiscal?.habilitado;
            document.getElementById('fiscal-status').checked = fiscalStatus;
            this.toggleFiscalOptions(fiscalStatus);
            
            if (this.currentSucursal.config?.fiscal) {
                document.getElementById('punto-venta').value = this.currentSucursal.config.fiscal.puntoVenta || '';
                document.getElementById('arca-cuit').value = this.currentSucursal.config.fiscal.cuit || '';
                document.getElementById('arca-certificado').value = this.currentSucursal.config.fiscal.certificado || '';
                document.getElementById('arca-clave').value = this.currentSucursal.config.fiscal.clave || '';
                document.getElementById('arca-ambiente').value = this.currentSucursal.config.fiscal.ambiente || 'homologacion';
                document.getElementById('razon-social').value = this.currentSucursal.config.fiscal.razonSocial || '';
                document.getElementById('domicilio-comercial').value = this.currentSucursal.config.fiscal.domicilioComercial || '';
                document.getElementById('ingresos-brutos').value = this.currentSucursal.config.fiscal.ingresosBrutos || '';
                document.getElementById('fecha-inicio').value = this.currentSucursal.config.fiscal.fechaInicio || '';
            }
            
            // Integraciones
            // MercadoPago
            if (this.currentSucursal.config?.integraciones?.mercadoPago) {
                document.getElementById('mp-habilitado').checked = !!this.currentSucursal.config.integraciones.mercadoPago.habilitado;
                document.getElementById('mp-access-token').value = this.currentSucursal.config.integraciones.mercadoPago.accessToken || '';
                document.getElementById('mp-public-key').value = this.currentSucursal.config.integraciones.mercadoPago.publicKey || '';
                document.getElementById('mp-user-id').value = this.currentSucursal.config.integraciones.mercadoPago.userId || '';
                document.getElementById('mp-refresh-time').value = this.currentSucursal.config.integraciones.mercadoPago.refreshTime || 5;
            }
            
            // WhatsApp
            if (this.currentSucursal.config?.integraciones?.whatsapp) {
                document.getElementById('whatsapp-habilitado').checked = !!this.currentSucursal.config.integraciones.whatsapp.habilitado;
                document.getElementById('whatsapp-api-key').value = this.currentSucursal.config.integraciones.whatsapp.apiKey || '';
                document.getElementById('whatsapp-phone').value = this.currentSucursal.config.integraciones.whatsapp.phoneNumber || '';
            }
            
            // Email
            if (this.currentSucursal.config?.integraciones?.email) {
                document.getElementById('email-habilitado').checked = !!this.currentSucursal.config.integraciones.email.habilitado;
                document.getElementById('email-smtp').value = this.currentSucursal.config.integraciones.email.smtpServer || '';
                document.getElementById('email-port').value = this.currentSucursal.config.integraciones.email.smtpPort || '';
                document.getElementById('email-user').value = this.currentSucursal.config.integraciones.email.username || '';
                document.getElementById('email-password').value = this.currentSucursal.config.integraciones.email.password || '';
                document.getElementById('email-from').value = this.currentSucursal.config.integraciones.email.fromName || '';
            }
            
            // Bancos (ejemplo con un banco)
            if (this.currentSucursal.config?.integraciones?.bancos) {
                const bancoSeleccionado = document.getElementById('banco-seleccionado');
                if (bancoSeleccionado) {
                    bancoSeleccionado.value = this.currentSucursal.config.integraciones.bancos.seleccionado || 'ninguno';
                    this.loadBancoConfig(bancoSeleccionado.value);
                }
            }
            
            // Configuración de impresión
            if (this.currentSucursal.config?.impresion) {
                document.getElementById('ticket-impresora').value = this.currentSucursal.config.impresion.ticketImpresora || '';
                document.getElementById('factura-impresora').value = this.currentSucursal.config.impresion.facturaImpresora || '';
                document.getElementById('impresion-automatica').checked = !!this.currentSucursal.config.impresion.automatica;
                document.getElementById('tamano-papel').value = this.currentSucursal.config.impresion.tamanoPapel || '58mm';
            }
            
            logger.info(`Datos de la sucursal ${this.currentSucursal.id} cargados correctamente`);
        } catch (error) {
            logger.error('Error al cargar los datos de la sucursal', error);
            showNotification(`Error al cargar datos: ${error.message}`, 'error');
        }
    }
    
    /**
     * Alterna las opciones de sincronización según el modo seleccionado
     * @param {string} mode - Modo de sincronización seleccionado
     */
    toggleSyncOptions(mode) {
        const syncOptionsContainer = document.getElementById('sync-options');
        if (!syncOptionsContainer) return;
        
        if (mode === 'desactivado') {
            syncOptionsContainer.classList.add('hidden');
        } else {
            syncOptionsContainer.classList.remove('hidden');
            
            // Mostrar/ocultar opciones específicas según el modo
            const intervalContainer = document.getElementById('interval-container');
            if (intervalContainer) {
                intervalContainer.classList.toggle('hidden', mode === 'manual');
            }
        }
    }
    
    /**
     * Alterna las opciones fiscales según el estado seleccionado
     * @param {boolean} enabled - Estado de la configuración fiscal
     */
    toggleFiscalOptions(enabled) {
        const fiscalOptionsContainer = document.getElementById('fiscal-options');
        if (!fiscalOptionsContainer) return;
        
        if (enabled) {
            fiscalOptionsContainer.classList.remove('hidden');
        } else {
            fiscalOptionsContainer.classList.add('hidden');
        }
    }
    
    /**
     * Carga la configuración del banco seleccionado
     * @param {string} banco - Nombre del banco seleccionado
     */
    loadBancoConfig(banco) {
        const bancoConfigContainer = document.getElementById('banco-config');
        if (!bancoConfigContainer) return;
        
        // Ocultar primero todos los contenedores de configuración
        const configContainers = bancoConfigContainer.querySelectorAll('.banco-config-container');
        configContainers.forEach(container => container.classList.add('hidden'));
        
        if (banco === 'ninguno') {
            return;
        }
        
        // Mostrar el contenedor correspondiente al banco seleccionado
        const selectedContainer = document.getElementById(`${banco}-config`);
        if (selectedContainer) {
            selectedContainer.classList.remove('hidden');
            
            // Cargar datos si estamos en modo edición
            if (this.isEditMode && this.currentSucursal?.config?.integraciones?.bancos?.[banco]) {
                const bancoConfig = this.currentSucursal.config.integraciones.bancos[banco];
                
                // Cargar campos genéricos comunes a todos los bancos
                document.getElementById(`${banco}-habilitado`).checked = !!bancoConfig.habilitado;
                document.getElementById(`${banco}-merchant-id`).value = bancoConfig.merchantId || '';
                document.getElementById(`${banco}-api-key`).value = bancoConfig.apiKey || '';
                
                // Cargar campos específicos según el banco
                switch (banco) {
                    case 'galicia':
                        document.getElementById('galicia-usuario').value = bancoConfig.usuario || '';
                        document.getElementById('galicia-codigo-comercio').value = bancoConfig.codigoComercio || '';
                        break;
                    case 'getnet':
                        document.getElementById('getnet-terminal-id').value = bancoConfig.terminalId || '';
                        break;
                    case 'bbva':
                        document.getElementById('bbva-comercio-id').value = bancoConfig.comercioId || '';
                        document.getElementById('bbva-terminal').value = bancoConfig.terminal || '';
                        break;
                    case 'payway':
                        document.getElementById('payway-site-id').value = bancoConfig.siteId || '';
                        break;
                }
            }
        }
    }
    
    /**
     * Prueba la conexión de sincronización con el servidor
     */
    async testSyncConnection() {
        try {
            const serverUrl = document.getElementById('sync-server-url').value;
            const apiKey = document.getElementById('sync-api-key').value;
            
            if (!serverUrl || !apiKey) {
                showNotification('Ingrese URL del servidor y API Key', 'warning');
                return;
            }
            
            // Mostrar loading
            const testButton = document.getElementById('test-sync-connection');
            const originalText = testButton.textContent;
            testButton.disabled = true;
            testButton.textContent = 'Probando...';
            
            // Intentar la conexión
            const result = await syncManager.testConnection(serverUrl, apiKey);
            
            // Restaurar botón
            testButton.disabled = false;
            testButton.textContent = originalText;
            
            if (result.success) {
                showNotification('Conexión establecida correctamente', 'success');
            } else {
                showNotification(`Error de conexión: ${result.message}`, 'error');
            }
        } catch (error) {
            logger.error('Error al probar la conexión de sincronización', error);
            showNotification(`Error: ${error.message}`, 'error');
            
            // Restaurar botón en caso de error
            const testButton = document.getElementById('test-sync-connection');
            if (testButton) {
                testButton.disabled = false;
                testButton.textContent = 'Probar Conexión';
            }
        }
    }
    
    /**
     * Guarda la configuración de la sucursal
     */
    async saveSucursalConfig() {
        try {
            // Validar el formulario
            if (!validateForm(this.configForm)) {
                showNotification('Por favor complete todos los campos requeridos', 'warning');
                return;
            }
            
            // Recopilar datos básicos
            const sucursalData = {
                nombre: document.getElementById('sucursal-nombre').value,
                direccion: document.getElementById('sucursal-direccion').value,
                telefono: document.getElementById('sucursal-telefono').value,
                email: document.getElementById('sucursal-email').value,
                responsable: document.getElementById('sucursal-responsable').value,
                config: {
                    // Configuración de sincronización
                    sync: {
                        modo: document.getElementById('sync-mode').value,
                        intervalo: parseInt(document.getElementById('sync-interval').value) || 30,
                        serverUrl: document.getElementById('sync-server-url').value,
                        apiKey: document.getElementById('sync-api-key').value,
                        prioridad: document.getElementById('sync-priority').value
                    },
                    // Configuración fiscal
                    fiscal: {
                        habilitado: document.getElementById('fiscal-status').checked,
                        puntoVenta: document.getElementById('punto-venta').value,
                        cuit: document.getElementById('arca-cuit').value,
                        certificado: document.getElementById('arca-certificado').value,
                        clave: document.getElementById('arca-clave').value,
                        ambiente: document.getElementById('arca-ambiente').value,
                        razonSocial: document.getElementById('razon-social').value,
                        domicilioComercial: document.getElementById('domicilio-comercial').value,
                        ingresosBrutos: document.getElementById('ingresos-brutos').value,
                        fechaInicio: document.getElementById('fecha-inicio').value
                    },
                    // Integraciones
                    integraciones: {
                        // MercadoPago
                        mercadoPago: {
                            habilitado: document.getElementById('mp-habilitado').checked,
                            accessToken: document.getElementById('mp-access-token').value,
                            publicKey: document.getElementById('mp-public-key').value,
                            userId: document.getElementById('mp-user-id').value,
                            refreshTime: parseInt(document.getElementById('mp-refresh-time').value) || 5
                        },
                        // WhatsApp
                        whatsapp: {
                            habilitado: document.getElementById('whatsapp-habilitado').checked,
                            apiKey: document.getElementById('whatsapp-api-key').value,
                            phoneNumber: document.getElementById('whatsapp-phone').value
                        },
                        // Email
                        email: {
                            habilitado: document.getElementById('email-habilitado').checked,
                            smtpServer: document.getElementById('email-smtp').value,
                            smtpPort: document.getElementById('email-port').value,
                            username: document.getElementById('email-user').value,
                            password: document.getElementById('email-password').value,
                            fromName: document.getElementById('email-from').value
                        },
                        // Bancos
                        bancos: this.getBancosConfig()
                    },
                    // Configuración de impresión
                    impresion: {
                        ticketImpresora: document.getElementById('ticket-impresora').value,
                        facturaImpresora: document.getElementById('factura-impresora').value,
                        automatica: document.getElementById('impresion-automatica').checked,
                        tamanoPapel: document.getElementById('tamano-papel').value
                    }
                }
            };
            
            // Si estamos en modo edición, actualizar la sucursal existente
            if (this.isEditMode && this.currentSucursal) {
                // Guardar la fecha de modificación
                sucursalData.fechaModificacion = new Date().toISOString();
                sucursalData.usuarioModificacion = getCurrentUser().username;
                
                // Actualizar en la base de datos
                await db.sucursales.update(this.currentSucursal.id, sucursalData);
                logger.info(`Sucursal ${this.currentSucursal.id} actualizada correctamente`);
                
                // Actualizar configuración de sincronización si estaba activa
                if (sucursalData.config.sync.modo !== 'desactivado') {
                    await syncManager.updateSucursalSync(this.currentSucursal.id, sucursalData.config.sync);
                }
                
                showNotification(`Sucursal "${sucursalData.nombre}" actualizada correctamente`, 'success');
            } else {
                // Si es nueva sucursal, agregar metadatos adicionales
                sucursalData.fechaCreacion = new Date().toISOString();
                sucursalData.usuarioCreacion = getCurrentUser().username;
                sucursalData.activa = true;
                
                // Insertar en la base de datos
                const id = await db.sucursales.add(sucursalData);
                logger.info(`Nueva sucursal creada con ID ${id}`);
                
                // Configurar sincronización si está activa
                if (sucursalData.config.sync.modo !== 'desactivado') {
                    await syncManager.setupSucursalSync(id, sucursalData.config.sync);
                }
                
                showNotification(`Sucursal "${sucursalData.nombre}" creada correctamente`, 'success');
            }
            
            // Crear respaldo automático después de modificar la configuración de sucursales
            await backupManager.createBackup('sucursales');
            
            // Redirigir al listado de sucursales
            setTimeout(() => {
                window.location.href = '#/sucursales';
            }, 1500);
        } catch (error) {
            logger.error('Error al guardar la configuración de la sucursal', error);
            showNotification(`Error: ${error.message}`, 'error');
        }
    }
    
    /**
     * Obtiene la configuración de los bancos desde el formulario
     * @returns {Object} - Configuración de los bancos
     */
    getBancosConfig() {
        const bancoSeleccionado = document.getElementById('banco-seleccionado').value;
        const bancosConfig = {
            seleccionado: bancoSeleccionado
        };
        
        // Configuración para cada banco
        const bancos = ['galicia', 'getnet', 'bbva', 'payway'];
        
        bancos.forEach(banco => {
            const habilitadoEl = document.getElementById(`${banco}-habilitado`);
            const merchantIdEl = document.getElementById(`${banco}-merchant-id`);
            const apiKeyEl = document.getElementById(`${banco}-api-key`);
            
            if (habilitadoEl && merchantIdEl && apiKeyEl) {
                bancosConfig[banco] = {
                    habilitado: habilitadoEl.checked,
                    merchantId: merchantIdEl.value,
                    apiKey: apiKeyEl.value
                };
                
                // Campos específicos según el banco
                switch (banco) {
                    case 'galicia':
                        const comercioEl = document.getElementById('galicia-codigo-comercio');
                        if (usuarioEl && comercioEl) {
                            bancosConfig[banco].usuario = usuarioEl.value;
                            bancosConfig[banco].codigoComercio = comercioEl.value;
                        }
                        break;
                    case 'getnet':
                        const terminalIdEl = document.getElementById('getnet-terminal-id');
                        if (terminalIdEl) {
                            bancosConfig[banco].terminalId = terminalIdEl.value;
                        }
                        break;
                    case 'bbva':
                        const comercioIdEl = document.getElementById('bbva-comercio-id');
                        const terminalEl = document.getElementById('bbva-terminal');
                        if (comercioIdEl && terminalEl) {
                            bancosConfig[banco].comercioId = comercioIdEl.value;
                            bancosConfig[banco].terminal = terminalEl.value;
                        }
                        break;
                    case 'payway':
                        const siteIdEl = document.getElementById('payway-site-id');
                        if (siteIdEl) {
                            bancosConfig[banco].siteId = siteIdEl.value;
                        }
                        break;
                }
            }
        });
        
        return bancosConfig;
    }
    
    /**
     * Reinicia el formulario de configuración a valores predeterminados
     */
    resetForm() {
        // Datos básicos
        document.getElementById('sucursal-nombre').value = '';
        document.getElementById('sucursal-direccion').value = '';
        document.getElementById('sucursal-telefono').value = '';
        document.getElementById('sucursal-email').value = '';
        document.getElementById('sucursal-responsable').value = '';
        
        // Configuración de sincronización
        document.getElementById('sync-mode').value = 'manual';
        document.getElementById('sync-interval').value = '30';
        document.getElementById('sync-server-url').value = '';
        document.getElementById('sync-api-key').value = '';
        document.getElementById('sync-priority').value = 'normal';
        this.toggleSyncOptions('manual');
        
        // Configuración fiscal
        document.getElementById('fiscal-status').checked = false;
        document.getElementById('punto-venta').value = '';
        document.getElementById('arca-cuit').value = '';
        document.getElementById('arca-certificado').value = '';
        document.getElementById('arca-clave').value = '';
        document.getElementById('arca-ambiente').value = 'homologacion';
        document.getElementById('razon-social').value = '';
        document.getElementById('domicilio-comercial').value = '';
        document.getElementById('ingresos-brutos').value = '';
        document.getElementById('fecha-inicio').value = '';
        this.toggleFiscalOptions(false);
        
        // Integraciones
        // MercadoPago
        document.getElementById('mp-habilitado').checked = false;
        document.getElementById('mp-access-token').value = '';
        document.getElementById('mp-public-key').value = '';
        document.getElementById('mp-user-id').value = '';
        document.getElementById('mp-refresh-time').value = '5';
        
        // WhatsApp
        document.getElementById('whatsapp-habilitado').checked = false;
        document.getElementById('whatsapp-api-key').value = '';
        document.getElementById('whatsapp-phone').value = '';
        
        // Email
        document.getElementById('email-habilitado').checked = false;
        document.getElementById('email-smtp').value = '';
        document.getElementById('email-port').value = '';
        document.getElementById('email-user').value = '';
        document.getElementById('email-password').value = '';
        document.getElementById('email-from').value = '';
        
        // Bancos
        document.getElementById('banco-seleccionado').value = 'ninguno';
        this.loadBancoConfig('ninguno');
        
        // Configuración de impresión
        document.getElementById('ticket-impresora').value = '';
        document.getElementById('factura-impresora').value = '';
        document.getElementById('impresion-automatica').checked = false;
        document.getElementById('tamano-papel').value = '58mm';
    }
    
    /**
     * Activa o desactiva una sucursal
     * @param {number} sucursalId - ID de la sucursal
     * @param {boolean} estado - Nuevo estado de la sucursal
     */
    async cambiarEstadoSucursal(sucursalId, estado) {
        try {
            // Verificar permisos
            const currentUser = getCurrentUser();
            if (!currentUser.permisos.includes('gestionar_sucursales')) {
                throw new Error('No tiene permisos para cambiar el estado de las sucursales');
            }
            
            // Actualizar estado en la base de datos
            await db.sucursales.update(sucursalId, { 
                activa: estado,
                fechaModificacion: new Date().toISOString(),
                usuarioModificacion: currentUser.username
            });
            
            logger.info(`Sucursal ${sucursalId} ${estado ? 'activada' : 'desactivada'} correctamente`);
            
            // Si la desactivamos, detener la sincronización si estaba configurada
            if (!estado) {
                await syncManager.stopSucursalSync(sucursalId);
            } else {
                // Si la activamos, verificar si debemos iniciar la sincronización
                const sucursal = await db.sucursales.get(sucursalId);
                if (sucursal && sucursal.config?.sync?.modo !== 'desactivado') {
                    await syncManager.setupSucursalSync(sucursalId, sucursal.config.sync);
                }
            }
            
            return { success: true, message: `Sucursal ${estado ? 'activada' : 'desactivada'} correctamente` };
        } catch (error) {
            logger.error(`Error al cambiar estado de la sucursal ${sucursalId}`, error);
            return { success: false, message: error.message };
        }
    }
    
    /**
     * Elimina una sucursal (solo si no tiene información asociada)
     * @param {number} sucursalId - ID de la sucursal a eliminar
     */
    async eliminarSucursal(sucursalId) {
        try {
            // Verificar permisos
            const currentUser = getCurrentUser();
            if (!currentUser.permisos.includes('eliminar_sucursales')) {
                throw new Error('No tiene permisos para eliminar sucursales');
            }
            
            // Verificar si la sucursal tiene información asociada
            const tieneFacturas = await db.facturas.where('sucursalId').equals(sucursalId).count() > 0;
            const tieneVentas = await db.ventas.where('sucursalId').equals(sucursalId).count() > 0;
            const tieneCajas = await db.cajas.where('sucursalId').equals(sucursalId).count() > 0;
            
            if (tieneFacturas || tieneVentas || tieneCajas) {
                throw new Error('No se puede eliminar la sucursal porque tiene información asociada');
            }
            
            // Detener sincronización si estaba configurada
            await syncManager.stopSucursalSync(sucursalId);
            
            // Eliminar la sucursal
            await db.sucursales.delete(sucursalId);
            
            logger.info(`Sucursal ${sucursalId} eliminada correctamente`);
            
            // Crear respaldo después de eliminar una sucursal
            await backupManager.createBackup('sucursales');
            
            return { success: true, message: 'Sucursal eliminada correctamente' };
        } catch (error) {
            logger.error(`Error al eliminar la sucursal ${sucursalId}`, error);
            return { success: false, message: error.message };
        }
    }
    
    /**
     * Verifica la conectividad de las integraciones configuradas
     */
    async verificarIntegraciones() {
        try {
            const resultados = {
                mercadoPago: false,
                arca: false,
                whatsapp: false,
                email: false,
                bancos: {}
            };
            
            // Verificar MercadoPago si está habilitado
            if (this.currentSucursal?.config?.integraciones?.mercadoPago?.habilitado) {
                const mpConfig = this.currentSucursal.config.integraciones.mercadoPago;
                const mpResult = await testMercadoPagoConfig(mpConfig);
                resultados.mercadoPago = mpResult.success;
            }
            
            // Verificar ARCA si está habilitado
            if (this.currentSucursal?.config?.fiscal?.habilitado) {
                const arcaConfig = {
                    cuit: this.currentSucursal.config.fiscal.cuit,
                    certificado: this.currentSucursal.config.fiscal.certificado,
                    clave: this.currentSucursal.config.fiscal.clave
                };
                const arcaResult = await testArcaConfig(arcaConfig);
                resultados.arca = arcaResult.success;
            }
            
            // Verificar WhatsApp si está habilitado
            if (this.currentSucursal?.config?.integraciones?.whatsapp?.habilitado) {
                const waConfig = this.currentSucursal.config.integraciones.whatsapp;
                const waResult = await testWhatsAppConfig(waConfig);
                resultados.whatsapp = waResult.success;
            }
            
            // Verificar Email si está habilitado
            if (this.currentSucursal?.config?.integraciones?.email?.habilitado) {
                const emailConfig = this.currentSucursal.config.integraciones.email;
                const emailResult = await testEmailConfig(emailConfig);
                resultados.email = emailResult.success;
            }
            
            // Verificar bancos configurados
            const bancosConfig = this.currentSucursal?.config?.integraciones?.bancos;
            if (bancosConfig) {
                const bancoSeleccionado = bancosConfig.seleccionado;
                
                if (bancoSeleccionado !== 'ninguno' && bancosConfig[bancoSeleccionado]?.habilitado) {
                    const bancoConfig = bancosConfig[bancoSeleccionado];
                    const bancoResult = await testBancoConfig(bancoSeleccionado, bancoConfig);
                    resultados.bancos[bancoSeleccionado] = bancoResult.success;
                }
            }
            
            return resultados;
        } catch (error) {
            logger.error('Error al verificar integraciones', error);
            return { error: error.message };
        }
    }
    
    /**
     * Crea los directorios necesarios para una nueva sucursal
     * @param {number} sucursalId - ID de la sucursal
     */
    async crearDirectorios(sucursalId) {
        try {
            const fs = window.api.fs;
            const path = window.api.path;
            const appDataPath = await window.api.getAppDataPath();
            
            // Directorio base de la sucursal
            const sucursalPath = path.join(appDataPath, 'sucursales', `sucursal_${sucursalId}`);
            
            // Crear directorios necesarios
            const directorios = [
                sucursalPath,
                path.join(sucursalPath, 'db'),
                path.join(sucursalPath, 'backups'),
                path.join(sucursalPath, 'logs'),
                path.join(sucursalPath, 'temp'),
                path.join(sucursalPath, 'facturas'),
                path.join(sucursalPath, 'remitos'),
                path.join(sucursalPath, 'productos'),
                path.join(sucursalPath, 'certificados'),
                path.join(sucursalPath, 'reportes')
            ];
            
            for (const dir of directorios) {
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
            }
            
            logger.info(`Directorios creados correctamente para la sucursal ${sucursalId}`);
            return true;
        } catch (error) {
            logger.error(`Error al crear directorios para la sucursal ${sucursalId}`, error);
            throw error;
        }
    }
    
    /**
     * Realiza una copia de seguridad específica de la configuración de la sucursal
     * @param {number} sucursalId - ID de la sucursal
     */
    async respaldarConfiguracion(sucursalId) {
        try {
            const sucursal = await db.sucursales.get(sucursalId);
            if (!sucursal) {
                throw new Error(`No se encontró la sucursal con ID ${sucursalId}`);
            }
            
            // Crear objeto con la configuración a respaldar
            const configBackup = {
                fecha: new Date().toISOString(),
                usuario: getCurrentUser().username,
                sucursalId: sucursalId,
                nombre: sucursal.nombre,
                configuracion: sucursal.config
            };
            
            // Guardar en la base de datos de respaldos
            await db.respaldosConfiguracion.add(configBackup);
            
            // Guardar como archivo JSON
            const fs = window.api.fs;
            const path = window.api.path;
            const appDataPath = await window.api.getAppDataPath();
            
            const backupPath = path.join(
                appDataPath, 
                'sucursales', 
                `sucursal_${sucursalId}`, 
                'backups', 
                `config_${new Date().toISOString().replace(/[:.]/g, '-')}.json`
            );
            
            fs.writeFileSync(backupPath, JSON.stringify(configBackup, null, 2));
            
            logger.info(`Respaldo de configuración creado para la sucursal ${sucursalId}`);
            return { success: true, path: backupPath };
        } catch (error) {
            logger.error(`Error al respaldar configuración de la sucursal ${sucursalId}`, error);
            return { success: false, message: error.message };
        }
    }
    
    /**
     * Restaura una configuración previa de la sucursal
     * @param {number} respaldoId - ID del respaldo a restaurar
     */
    async restaurarConfiguracion(respaldoId) {
        try {
            // Verificar permisos
            const currentUser = getCurrentUser();
            if (!currentUser.permisos.includes('gestionar_sucursales')) {
                throw new Error('No tiene permisos para restaurar configuraciones');
            }
            
            // Obtener respaldo
            const respaldo = await db.respaldosConfiguracion.get(respaldoId);
            if (!respaldo) {
                throw new Error(`No se encontró el respaldo con ID ${respaldoId}`);
            }
            
            // Verificar que la sucursal existe
            const sucursal = await db.sucursales.get(respaldo.sucursalId);
            if (!sucursal) {
                throw new Error(`No se encontró la sucursal con ID ${respaldo.sucursalId}`);
            }
            
            // Guardar configuración actual como respaldo antes de restaurar
            await this.respaldarConfiguracion(respaldo.sucursalId);
            
            // Actualizar la configuración de la sucursal
            await db.sucursales.update(respaldo.sucursalId, {
                config: respaldo.configuracion,
                fechaModificacion: new Date().toISOString(),
                usuarioModificacion: currentUser.username
            });
            
            // Si la sincronización estaba activa, actualizarla
            if (respaldo.configuracion?.sync?.modo !== 'desactivado') {
                await syncManager.updateSucursalSync(respaldo.sucursalId, respaldo.configuracion.sync);
            } else {
                // Si estaba desactivada, detener sincronización si estaba corriendo
                await syncManager.stopSucursalSync(respaldo.sucursalId);
            }
            
            logger.info(`Configuración restaurada para la sucursal ${respaldo.sucursalId} desde respaldo ${respaldoId}`);
            return { success: true, message: `Configuración restaurada correctamente` };
        } catch (error) {
            logger.error(`Error al restaurar configuración desde respaldo ${respaldoId}`, error);
            return { success: false, message: error.message };
        }
    }
    
    /**
     * Clona la configuración de una sucursal a otra
     * @param {number} sucursalOrigenId - ID de la sucursal origen
     * @param {number} sucursalDestinoId - ID de la sucursal destino
     * @param {Object} opciones - Opciones de clonación (qué partes clonar)
     */
    async clonarConfiguracion(sucursalOrigenId, sucursalDestinoId, opciones = {}) {
        try {
            // Verificar permisos
            const currentUser = getCurrentUser();
            if (!currentUser.permisos.includes('gestionar_sucursales')) {
                throw new Error('No tiene permisos para clonar configuraciones');
            }
            
            // Obtener sucursales
            const sucursalOrigen = await db.sucursales.get(sucursalOrigenId);
            const sucursalDestino = await db.sucursales.get(sucursalDestinoId);
            
            if (!sucursalOrigen || !sucursalDestino) {
                throw new Error('No se encontraron las sucursales especificadas');
            }
            
            // Crear respaldo de la configuración actual antes de modificar
            await this.respaldarConfiguracion(sucursalDestinoId);
            
            // Clonar configuración según opciones
            const nuevaConfig = { ...sucursalDestino.config };
            
            // Clonar configuración fiscal si se solicitó
            if (opciones.fiscal) {
                nuevaConfig.fiscal = JSON.parse(JSON.stringify(sucursalOrigen.config.fiscal));
                // Mantener el punto de venta original
                nuevaConfig.fiscal.puntoVenta = sucursalDestino.config.fiscal?.puntoVenta || '';
            }
            
            // Clonar configuración de impresión si se solicitó
            if (opciones.impresion) {
                nuevaConfig.impresion = JSON.parse(JSON.stringify(sucursalOrigen.config.impresion));
            }
            
            // Clonar integraciones específicas si se solicitaron
            if (opciones.integraciones) {
                if (!nuevaConfig.integraciones) {
                    nuevaConfig.integraciones = {};
                }
                
                if (opciones.integraciones.mercadoPago) {
                    nuevaConfig.integraciones.mercadoPago = JSON.parse(
                        JSON.stringify(sucursalOrigen.config.integraciones.mercadoPago || {})
                    );
                }
                
                if (opciones.integraciones.whatsapp) {
                    nuevaConfig.integraciones.whatsapp = JSON.parse(
                        JSON.stringify(sucursalOrigen.config.integraciones.whatsapp || {})
                    );
                }
                
                if (opciones.integraciones.email) {
                    nuevaConfig.integraciones.email = JSON.parse(
                        JSON.stringify(sucursalOrigen.config.integraciones.email || {})
                    );
                }
                
                if (opciones.integraciones.bancos) {
                    nuevaConfig.integraciones.bancos = JSON.parse(
                        JSON.stringify(sucursalOrigen.config.integraciones.bancos || {})
                    );
                }
            }
            
            // No clonar configuración de sincronización ya que debe ser específica de cada sucursal
            
            // Actualizar la configuración de la sucursal destino
            await db.sucursales.update(sucursalDestinoId, {
                config: nuevaConfig,
                fechaModificacion: new Date().toISOString(),
                usuarioModificacion: currentUser.username
            });
            
            logger.info(`Configuración clonada de sucursal ${sucursalOrigenId} a ${sucursalDestinoId}`);
            return { success: true, message: 'Configuración clonada correctamente' };
        } catch (error) {
            logger.error('Error al clonar configuración', error);
            return { success: false, message: error.message };
        }
    }
    
    /**
     * Obtiene el historial de modificaciones de configuración de una sucursal
     * @param {number} sucursalId - ID de la sucursal
     */
    async obtenerHistorialConfiguracion(sucursalId) {
        try {
            // Verificar permisos
            const currentUser = getCurrentUser();
            if (!currentUser.permisos.includes('ver_sucursales')) {
                throw new Error('No tiene permisos para ver el historial de configuraciones');
            }
            
            // Obtener historial desde la base de datos
            const historial = await db.respaldosConfiguracion
                .where('sucursalId')
                .equals(sucursalId)
                .reverse()
                .sortBy('fecha');
            
            return historial;
        } catch (error) {
            logger.error(`Error al obtener historial de configuración para sucursal ${sucursalId}`, error);
            throw error;
        }
    }
}

// Exportar una instancia del módulo
const sucursalConfiguracion = new SucursalConfiguracion();
export default sucursalConfiguracion;