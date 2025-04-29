/**
 * Módulo de Configuraciones - FactuSystem
 * 
 * Este módulo gestiona todas las configuraciones del sistema:
 * - Datos de la empresa
 * - Personalización visual
 * - Seguridad
 * - Impresiones
 * - Integraciones (Mercado Pago, ARCA, WhatsApp, Email, Bancos)
 * - Respaldos
 */

// Importación de submódulos
const empresaModule = require('./empresa.js');
const visualModule = require('./visual.js');
const seguridadModule = require('./seguridad.js');
const impresionModule = require('./impresion.js');
const backupsModule = require('./backups.js');

// Importación de integraciones
const mercadoPagoModule = require('./integraciones/mercadoPago.js');
const arcaModule = require('./integraciones/arca.js');
const whatsappModule = require('./integraciones/whatsapp.js');
const emailModule = require('./integraciones/email.js');
const bancosModule = require('./integraciones/bancos/index.js');

// Importamos utilidades
const { mostrarNotificacion } = require('../../../utils/notifications.js');
const { guardarEnDB, obtenerDeDB } = require('../../../utils/database.js');
const { verificarConexionInternet } = require('../../../utils/sync.js');
const { registrarAuditoria } = require('../../../utils/logger.js');

// Estado de las configuraciones
let configuracionActual = {
    empresa: {},
    visual: {},
    seguridad: {},
    impresion: {},
    mercadoPago: {},
    arca: {},
    whatsapp: {},
    email: {},
    bancos: {},
    backups: {}
};

// Elemento principal del contenedor
let contenedorPrincipal;

/**
 * Inicializa el módulo de configuraciones
 * @param {HTMLElement} container - Contenedor donde se renderizará el módulo
 */
function initConfiguraciones(container) {
    contenedorPrincipal = container;
    contenedorPrincipal.innerHTML = '';
    
    // Crear estructura básica
    const estructura = crearEstructuraConfiguraciones();
    contenedorPrincipal.appendChild(estructura);
    
    // Cargar configuraciones existentes
    cargarConfiguracionesGuardadas();
    
    // Configurar eventos de navegación
    configurarNavegacion();
    
    // Mostrar sección empresa por defecto
    mostrarSeccion('empresa');
    
    // Registrar en log
    registrarAuditoria('Acceso', 'Módulo de configuraciones', 'Usuario accedió a configuraciones');
}

/**
 * Crea la estructura DOM del módulo de configuraciones
 */
function crearEstructuraConfiguraciones() {
    const fragment = document.createDocumentFragment();
    
    // Encabezado
    const header = document.createElement('div');
    header.className = 'config-header';
    header.innerHTML = `
        <h2>Configuraciones del Sistema</h2>
        <p>Configure los parámetros generales de FactuSystem para adaptarlo a sus necesidades.</p>
    `;
    fragment.appendChild(header);
    
    // Contenedor principal con navegación lateral y contenido
    const mainContainer = document.createElement('div');
    mainContainer.className = 'config-container';
    
    // Navegación lateral
    const sidebar = document.createElement('div');
    sidebar.className = 'config-sidebar';
    sidebar.innerHTML = `
        <ul>
            <li data-section="empresa" class="active"><i class="fas fa-building"></i> Datos de Empresa</li>
            <li data-section="visual"><i class="fas fa-paint-brush"></i> Personalización Visual</li>
            <li data-section="seguridad"><i class="fas fa-shield-alt"></i> Seguridad</li>
            <li data-section="impresion"><i class="fas fa-print"></i> Impresión</li>
            <li class="config-section-header"><i class="fas fa-plug"></i> Integraciones</li>
            <li data-section="mercadoPago" class="sub-item"><i class="fas fa-qrcode"></i> Mercado Pago</li>
            <li data-section="arca" class="sub-item"><i class="fas fa-file-invoice"></i> ARCA (AFIP)</li>
            <li data-section="whatsapp" class="sub-item"><i class="fab fa-whatsapp"></i> WhatsApp</li>
            <li data-section="email" class="sub-item"><i class="fas fa-envelope"></i> Email</li>
            <li data-section="bancos" class="sub-item"><i class="fas fa-university"></i> Bancos</li>
            <li data-section="backups"><i class="fas fa-database"></i> Respaldos</li>
        </ul>
    `;
    mainContainer.appendChild(sidebar);
    
    // Contenedor de contenido
    const contentContainer = document.createElement('div');
    contentContainer.className = 'config-content';
    contentContainer.id = 'config-content';
    
    // Contenedores para cada sección
    const secciones = [
        'empresa', 'visual', 'seguridad', 'impresion', 
        'mercadoPago', 'arca', 'whatsapp', 'email', 'bancos', 'backups'
    ];
    
    secciones.forEach(seccion => {
        const seccionDiv = document.createElement('div');
        seccionDiv.id = `config-${seccion}`;
        seccionDiv.className = 'config-section';
        contentContainer.appendChild(seccionDiv);
    });
    
    mainContainer.appendChild(contentContainer);
    fragment.appendChild(mainContainer);
    
    // Botones de acción al pie
    const actions = document.createElement('div');
    actions.className = 'config-actions';
    actions.innerHTML = `
        <button id="btn-guardar-config" class="btn btn-primary"><i class="fas fa-save"></i> Guardar Configuración</button>
        <button id="btn-cancelar-config" class="btn btn-secondary"><i class="fas fa-times"></i> Cancelar</button>
    `;
    fragment.appendChild(actions);
    
    return fragment;
}

/**
 * Configura los eventos de navegación entre secciones
 */
function configurarNavegacion() {
    // Eventos de navegación en sidebar
    const items = contenedorPrincipal.querySelectorAll('.config-sidebar li[data-section]');
    items.forEach(item => {
        item.addEventListener('click', (e) => {
            const seccion = e.currentTarget.getAttribute('data-section');
            mostrarSeccion(seccion);
        });
    });
    
    // Botón guardar
    const btnGuardar = contenedorPrincipal.querySelector('#btn-guardar-config');
    btnGuardar.addEventListener('click', guardarConfiguraciones);
    
    // Botón cancelar
    const btnCancelar = contenedorPrincipal.querySelector('#btn-cancelar-config');
    btnCancelar.addEventListener('click', () => {
        if (confirm('¿Está seguro de cancelar los cambios? Los cambios no guardados se perderán.')) {
            cargarConfiguracionesGuardadas();
            mostrarNotificacion('Cambios cancelados', 'info');
        }
    });
}

/**
 * Muestra una sección específica y oculta las demás
 * @param {string} seccion - ID de la sección a mostrar
 */
function mostrarSeccion(seccion) {
    // Actualizar menú
    const items = contenedorPrincipal.querySelectorAll('.config-sidebar li');
    items.forEach(item => item.classList.remove('active'));
    contenedorPrincipal.querySelector(`.config-sidebar li[data-section="${seccion}"]`).classList.add('active');
    
    // Ocultar todas las secciones
    const secciones = contenedorPrincipal.querySelectorAll('.config-section');
    secciones.forEach(sec => sec.style.display = 'none');
    
    // Mostrar la sección seleccionada
    const seccionActiva = contenedorPrincipal.querySelector(`#config-${seccion}`);
    seccionActiva.style.display = 'block';
    
    // Inicializar contenido de la sección si está vacío
    if (seccionActiva.childElementCount === 0) {
        inicializarSeccion(seccion, seccionActiva);
    }
}

/**
 * Inicializa el contenido de una sección específica
 * @param {string} seccion - ID de la sección
 * @param {HTMLElement} contenedor - Contenedor de la sección
 */
function inicializarSeccion(seccion, contenedor) {
    switch (seccion) {
        case 'empresa':
            empresaModule.initEmpresaConfiguracion(contenedor, configuracionActual.empresa);
            break;
        case 'visual':
            visualModule.initVisualizacionConfig(contenedor, configuracionActual.visual);
            break;
        case 'seguridad':
            seguridadModule.initSeguridadConfig(contenedor, configuracionActual.seguridad);
            break;
        case 'impresion':
            impresionModule.initConfiguracionImpresion(contenedor, configuracionActual.impresion);
            break;
        case 'mercadoPago':
            mercadoPagoModule.initMercadoPagoConfig(contenedor, configuracionActual.mercadoPago);
            break;
        case 'arca':
            arcaModule.initArcaConfig(contenedor, configuracionActual.arca);
            break;
        case 'whatsapp':
            whatsappModule.initWhatsappConfig(contenedor, configuracionActual.whatsapp);
            break;
        case 'email':
            emailModule.initEmailConfig(contenedor, configuracionActual.email);
            break;
        case 'bancos':
            bancosModule.initBancosConfig(contenedor, configuracionActual.bancos);
            break;
        case 'backups':
            backupsModule.initBackupConfig(contenedor, configuracionActual.backups);
            break;
        default:
            contenedor.innerHTML = '<p>Sección no implementada</p>';
    }
}

/**
 * Carga todas las configuraciones guardadas desde la base de datos
 */
async function cargarConfiguracionesGuardadas() {
    try {
        // Cargar cada tipo de configuración de la DB
        configuracionActual.empresa = await obtenerDeDB('configuraciones', 'empresa') || {};
        configuracionActual.visual = await obtenerDeDB('configuraciones', 'visual') || {};
        configuracionActual.seguridad = await obtenerDeDB('configuraciones', 'seguridad') || {};
        configuracionActual.impresion = await obtenerDeDB('configuraciones', 'impresion') || {};
        configuracionActual.mercadoPago = await obtenerDeDB('configuraciones', 'mercadoPago') || {};
        configuracionActual.arca = await obtenerDeDB('configuraciones', 'arca') || {};
        configuracionActual.whatsapp = await obtenerDeDB('configuraciones', 'whatsapp') || {};
        configuracionActual.email = await obtenerDeDB('configuraciones', 'email') || {};
        configuracionActual.bancos = await obtenerDeDB('configuraciones', 'bancos') || {};
        configuracionActual.backups = await obtenerDeDB('configuraciones', 'backups') || {};
        
        // Aplicar configuraciones visuales inmediatamente
        if (configuracionActual.visual && Object.keys(configuracionActual.visual).length > 0) {
            visualModule.aplicarTema(configuracionActual.visual);
        }
        
        // Refrescar todas las secciones visibles
        const seccionesVisibles = contenedorPrincipal.querySelectorAll('.config-section');
        seccionesVisibles.forEach(seccion => {
            if (seccion.style.display !== 'none' && seccion.id) {
                const idSeccion = seccion.id.replace('config-', '');
                inicializarSeccion(idSeccion, seccion);
            }
        });
        
    } catch (error) {
        console.error('Error al cargar configuraciones:', error);
        mostrarNotificacion('Error al cargar configuraciones', 'error');
    }
}

/**
 * Guarda todas las configuraciones en la base de datos
 */
async function guardarConfiguraciones() {
    try {
        // Recopilar datos de todas las secciones
        const empresaData = empresaModule.obtenerConfiguracionEmpresa();
        const visualData = document.querySelector('#config-visual').dataset.config ? 
            JSON.parse(document.querySelector('#config-visual').dataset.config) : {};
        const seguridadData = document.querySelector('#config-seguridad').dataset.config ? 
            JSON.parse(document.querySelector('#config-seguridad').dataset.config) : {};
        const impresionData = document.querySelector('#config-impresion').dataset.config ? 
            JSON.parse(document.querySelector('#config-impresion').dataset.config) : {};
        const mercadoPagoData = document.querySelector('#config-mercadoPago').dataset.config ? 
            JSON.parse(document.querySelector('#config-mercadoPago').dataset.config) : {};
        const arcaData = document.querySelector('#config-arca').dataset.config ? 
            JSON.parse(document.querySelector('#config-arca').dataset.config) : {};
        const whatsappData = document.querySelector('#config-whatsapp').dataset.config ? 
            JSON.parse(document.querySelector('#config-whatsapp').dataset.config) : {};
        const emailData = document.querySelector('#config-email').dataset.config ? 
            JSON.parse(document.querySelector('#config-email').dataset.config) : {};
        const bancosData = document.querySelector('#config-bancos').dataset.config ? 
            JSON.parse(document.querySelector('#config-bancos').dataset.config) : {};
        const backupsData = document.querySelector('#config-backups').dataset.config ? 
            JSON.parse(document.querySelector('#config-backups').dataset.config) : {};
            
        // Verificar conexión para integraciones
        const hayConexion = await verificarConexionInternet();
        if (hayConexion) {
            // Verificar credenciales de integraciones antes de guardar
            if (mercadoPagoData.clientId && mercadoPagoData.clientSecret) {
                const mpCredencialesValidas = await mercadoPagoModule.verificarCredencialesMercadoPago(
                    mercadoPagoData.clientId, 
                    mercadoPagoData.clientSecret
                );
                
                if (!mpCredencialesValidas) {
                    if (!confirm('Las credenciales de Mercado Pago parecen ser inválidas. ¿Desea guardar de todas formas?')) {
                        mostrarSeccion('mercadoPago');
                        return;
                    }
                }
            }
            
            if (arcaData.certificado && arcaData.clave) {
                const arcaCredencialesValidas = await arcaModule.verificarCredencialesArca(
                    arcaData.certificado,
                    arcaData.clave,
                    arcaData.cuit
                );
                
                if (!arcaCredencialesValidas) {
                    if (!confirm('Las credenciales de ARCA (AFIP) parecen ser inválidas. ¿Desea guardar de todas formas?')) {
                        mostrarSeccion('arca');
                        return;
                    }
                }
            }
        }

        // Actualizar configuraciones en memoria
        configuracionActual = {
            empresa: empresaData,
            visual: visualData,
            seguridad: seguridadData,
            impresion: impresionData,
            mercadoPago: mercadoPagoData,
            arca: arcaData,
            whatsapp: whatsappData,
            email: emailData,
            bancos: bancosData,
            backups: backupsData
        };

        // Guardar en base de datos
        await guardarEnDB('configuraciones', 'empresa', empresaData);
        await guardarEnDB('configuraciones', 'visual', visualData);
        await guardarEnDB('configuraciones', 'seguridad', seguridadData);
        await guardarEnDB('configuraciones', 'impresion', impresionData);
        await guardarEnDB('configuraciones', 'mercadoPago', mercadoPagoData);
        await guardarEnDB('configuraciones', 'arca', arcaData);
        await guardarEnDB('configuraciones', 'whatsapp', whatsappData);
        await guardarEnDB('configuraciones', 'email', emailData);
        await guardarEnDB('configuraciones', 'bancos', bancosData);
        await guardarEnDB('configuraciones', 'backups', backupsData);

        // Aplicar configuraciones
        visualModule.aplicarTema(visualData);
        seguridadModule.actualizarPoliticasSeguridad(seguridadData);
        backupsModule.configurarBackupAutomatico(backupsData);
        
        // Notificar al usuario
        mostrarNotificacion('Configuraciones guardadas correctamente', 'success');
        
        // Registrar en el log
        registrarAuditoria('Configuración', 'Actualización', 'Se actualizaron las configuraciones del sistema');
        
    } catch (error) {
        console.error('Error al guardar configuraciones:', error);
        mostrarNotificacion('Error al guardar configuraciones: ' + error.message, 'error');
    }
}

/**
 * Realiza pruebas de integración para verificar la conectividad
 * @param {string} tipo - Tipo de integración a probar
 * @param {Object} config - Configuración de la integración
 */
async function probarIntegracion(tipo, config) {
    try {
        let resultado = false;
        
        switch (tipo) {
            case 'mercadoPago':
                resultado = await mercadoPagoModule.verificarCredencialesMercadoPago(config.clientId, config.clientSecret);
                break;
            case 'arca':
                resultado = await arcaModule.verificarCredencialesArca(config.certificado, config.clave, config.cuit);
                break;
            case 'whatsapp':
                resultado = await whatsappModule.testConexionWhatsapp(config);
                break;
            case 'email':
                resultado = await emailModule.enviarEmailPrueba(config);
                break;
            case 'bancos':
                resultado = await bancosModule.testConexionBancos(config.banco, config.credenciales);
                break;
        }
        
        if (resultado) {
            mostrarNotificacion(`Conexión con ${tipo} exitosa`, 'success');
        } else {
            mostrarNotificacion(`Error al conectar con ${tipo}`, 'error');
        }
        
        return resultado;
    } catch (error) {
        console.error(`Error al probar integración ${tipo}:`, error);
        mostrarNotificacion(`Error al probar integración ${tipo}: ${error.message}`, 'error');
        return false;
    }
}

/**
 * Exporta todas las configuraciones a un archivo JSON
 */
async function exportarConfiguraciones() {
    try {
        // Obtener todas las configuraciones actuales
        const todasLasConfiguraciones = {
            empresa: configuracionActual.empresa,
            visual: configuracionActual.visual,
            seguridad: configuracionActual.seguridad,
            impresion: configuracionActual.impresion,
            mercadoPago: configuracionActual.mercadoPago,
            arca: configuracionActual.arca,
            whatsapp: configuracionActual.whatsapp,
            email: configuracionActual.email,
            bancos: configuracionActual.bancos,
            backups: configuracionActual.backups,
            timestamp: new Date().toISOString(),
            version: '1.0'
        };
        
        // Eliminar información sensible
        if (todasLasConfiguraciones.mercadoPago) {
            todasLasConfiguraciones.mercadoPago.clientSecret = '[REDACTED]';
        }
        
        if (todasLasConfiguraciones.arca) {
            todasLasConfiguraciones.arca.clave = '[REDACTED]';
        }
        
        if (todasLasConfiguraciones.email && todasLasConfiguraciones.email.password) {
            todasLasConfiguraciones.email.password = '[REDACTED]';
        }
        
        if (todasLasConfiguraciones.bancos) {
            Object.keys(todasLasConfiguraciones.bancos).forEach(banco => {
                if (todasLasConfiguraciones.bancos[banco].password) {
                    todasLasConfiguraciones.bancos[banco].password = '[REDACTED]';
                }
                if (todasLasConfiguraciones.bancos[banco].secretKey) {
                    todasLasConfiguraciones.bancos[banco].secretKey = '[REDACTED]';
                }
            });
        }
        
        // Convertir a JSON
        const jsonConfig = JSON.stringify(todasLasConfiguraciones, null, 2);
        
        // Crear un blob y generar URL de descarga
        const blob = new Blob([jsonConfig], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        // Crear link de descarga y clickearlo
        const a = document.createElement('a');
        a.href = url;
        a.download = `factusystem_config_${new Date().toISOString().slice(0,10)}.json`;
        document.body.appendChild(a);
        a.click();
        
        // Limpiar
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        mostrarNotificacion('Configuraciones exportadas correctamente', 'success');
    } catch (error) {
        console.error('Error al exportar configuraciones:', error);
        mostrarNotificacion('Error al exportar configuraciones', 'error');
    }
}

/**
 * Importa configuraciones desde un archivo JSON
 * @param {File} archivo - Archivo JSON con las configuraciones
 */
async function importarConfiguraciones(archivo) {
    try {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = async (e) => {
                try {
                    const json = JSON.parse(e.target.result);
                    
                    // Validar estructura básica
                    if (!json.version || !json.timestamp) {
                        throw new Error('El archivo no parece ser una configuración válida de FactuSystem');
                    }
                    
                    // Confirmar antes de sobrescribir
                    if (!confirm('¿Está seguro de importar estas configuraciones? Se sobrescribirán las configuraciones actuales.')) {
                        resolve(false);
                        return;
                    }
                    
                    // Actualizar configuraciones (excepto datos sensibles)
                    if (json.empresa) configuracionActual.empresa = json.empresa;
                    if (json.visual) configuracionActual.visual = json.visual;
                    if (json.impresion) configuracionActual.impresion = json.impresion;
                    
                    // Para configuraciones sensibles, solo importar si no tienen [REDACTED]
                    if (json.mercadoPago) {
                        const mpConfig = { ...json.mercadoPago };
                        if (mpConfig.clientSecret === '[REDACTED]') {
                            mpConfig.clientSecret = configuracionActual.mercadoPago.clientSecret;
                        }
                        configuracionActual.mercadoPago = mpConfig;
                    }
                    
                    if (json.arca) {
                        const arcaConfig = { ...json.arca };
                        if (arcaConfig.clave === '[REDACTED]') {
                            arcaConfig.clave = configuracionActual.arca.clave;
                        }
                        configuracionActual.arca = arcaConfig;
                    }
                    
                    if (json.whatsapp) configuracionActual.whatsapp = json.whatsapp;
                    
                    if (json.email) {
                        const emailConfig = { ...json.email };
                        if (emailConfig.password === '[REDACTED]') {
                            emailConfig.password = configuracionActual.email.password;
                        }
                        configuracionActual.email = emailConfig;
                    }
                    
                    if (json.bancos) {
                        const bancosConfig = { ...json.bancos };
                        Object.keys(bancosConfig).forEach(banco => {
                            if (bancosConfig[banco].password === '[REDACTED]' && 
                                configuracionActual.bancos && 
                                configuracionActual.bancos[banco]) {
                                bancosConfig[banco].password = configuracionActual.bancos[banco].password;
                            }
                            if (bancosConfig[banco].secretKey === '[REDACTED]' && 
                                configuracionActual.bancos && 
                                configuracionActual.bancos[banco]) {
                                bancosConfig[banco].secretKey = configuracionActual.bancos[banco].secretKey;
                            }
                        });
                        configuracionActual.bancos = bancosConfig;
                    }
                    
                    if (json.backups) configuracionActual.backups = json.backups;
                    if (json.seguridad) configuracionActual.seguridad = json.seguridad;
                    
                    // Guardar configuraciones
                    await guardarConfiguraciones();
                    
                    // Recargar las secciones visibles
                    const seccionesVisibles = contenedorPrincipal.querySelectorAll('.config-section');
                    seccionesVisibles.forEach(seccion => {
                        if (seccion.style.display !== 'none' && seccion.id) {
                            const idSeccion = seccion.id.replace('config-', '');
                            inicializarSeccion(idSeccion, seccion);
                        }
                    });
                    
                    mostrarNotificacion('Configuraciones importadas correctamente', 'success');
                    resolve(true);
                } catch (error) {
                    console.error('Error al procesar el archivo:', error);
                    mostrarNotificacion('Error al importar configuraciones: ' + error.message, 'error');
                    reject(error);
                }
            };
            
            reader.onerror = (error) => {
                console.error('Error al leer el archivo:', error);
                mostrarNotificacion('Error al leer el archivo', 'error');
                reject(error);
            };
            
            reader.readAsText(archivo);
        });
    } catch (error) {
        console.error('Error al importar configuraciones:', error);
        mostrarNotificacion('Error al importar configuraciones', 'error');
        throw error;
    }
}

/**
 * Restaura las configuraciones a valores predeterminados
 */
async function restaurarValoresPredeterminados() {
    try {
        if (!confirm('¿Está seguro de restaurar todas las configuraciones a valores predeterminados? Esta acción no se puede deshacer.')) {
            return false;
        }
        
        // Valores predeterminados para cada sección
        const defaultEmpresa = {
            nombre: 'Mi Empresa',
            razonSocial: 'Mi Empresa S.A.',
            cuit: '30000000000',
            direccion: 'Dirección predeterminada',
            telefono: '0000000000',
            email: 'contacto@miempresa.com',
            logoUrl: ''
        };
        
        const defaultVisual = {
            tema: 'claro',
            colorPrimario: '#3498db',
            colorSecundario: '#2ecc71',
            fuentePrincipal: 'Roboto',
            tamanoFuente: 'medium'
        };
        
        const defaultSeguridad = {
            tiempoInactividad: 15,
            dobleAutenticacion: false,
            registroActividad: true,
            nivelLog: 'medio'
        };
        
        const defaultImpresion = {
            tipoImpresora: 'termica',
            tamano: '58mm',
            imprimirAutomaticamente: true,
            logoEnDocumentos: true,
            plantillaFactura: 'default',
            plantillaTicket: 'default'
        };
        
        const defaultMercadoPago = {
            activo: false,
            clientId: '',
            clientSecret: '',
            intervaloVerificacion: 10,
            qrEstatico: false
        };
        
        const defaultArca = {
            activo: false,
            ambiente: 'testing',
            cuit: '',
            certificado: '',
            clave: ''
        };
        
        const defaultWhatsapp = {
            activo: false,
            numeroTelefono: '',
            mensajePredeterminado: 'Gracias por su compra en {empresa}. Adjuntamos su comprobante.'
        };
        
        const defaultEmail = {
            activo: false,
            servidor: '',
            puerto: 587,
            seguridad: 'tls',
            usuario: '',
            password: '',
            remitente: '',
            asuntoPredeterminado: 'Factura de compra - {empresa}'
        };
        
        const defaultBancos = {
            galicia: { activo: false },
            getnet: { activo: false },
            bbva: { activo: false },
            payway: { activo: false }
        };
        
        const defaultBackups = {
            activo: true,
            frecuencia: 'diaria',
            horaBackup: '23:00',
            ruta: 'backups/',
            enNube: false,
            cantidadConservar: 7,
            compresion: true,
            incluyeImagenes: true
        };
        
        // Actualizar configuraciones
        configuracionActual = {
            empresa: defaultEmpresa,
            visual: defaultVisual,
            seguridad: defaultSeguridad,
            impresion: defaultImpresion,
            mercadoPago: defaultMercadoPago,
            arca: defaultArca,
            whatsapp: defaultWhatsapp,
            email: defaultEmail,
            bancos: defaultBancos,
            backups: defaultBackups
        };
        
        // Guardar en base de datos
        await guardarEnDB('configuraciones', 'empresa', defaultEmpresa);
        await guardarEnDB('configuraciones', 'visual', defaultVisual);
        await guardarEnDB('configuraciones', 'seguridad', defaultSeguridad);
        await guardarEnDB('configuraciones', 'impresion', defaultImpresion);
        await guardarEnDB('configuraciones', 'mercadoPago', defaultMercadoPago);
        await guardarEnDB('configuraciones', 'arca', defaultArca);
        await guardarEnDB('configuraciones', 'whatsapp', defaultWhatsapp);
        await guardarEnDB('configuraciones', 'email', defaultEmail);
        await guardarEnDB('configuraciones', 'bancos', defaultBancos);
        await guardarEnDB('configuraciones', 'backups', defaultBackups);
        
        // Aplicar tema por defecto
        aplicarTema(defaultVisual);
        
        // Recargar todas las secciones
        const secciones = [
            'empresa', 'visual', 'seguridad', 'impresion', 
            'mercadoPago', 'arca', 'whatsapp', 'email', 'bancos', 'backups'
        ];
        
        secciones.forEach(seccion => {
            const contenedor = document.querySelector(`#config-${seccion}`);
            if (contenedor) {
                inicializarSeccion(seccion, contenedor);
            }
        });
        
        // Mostrar la primera sección
        mostrarSeccion('empresa');
        
        mostrarNotificacion('Configuraciones restauradas a valores predeterminados', 'success');
        
        // Registrar en log
        registrarAuditoria('Configuración', 'Restauración', 'Se restauraron las configuraciones a valores predeterminados');
        
        return true;
    } catch (error) {
        console.error('Error al restaurar valores predeterminados:', error);
        mostrarNotificacion('Error al restaurar valores predeterminados: ' + error.message, 'error');
        return false;
    }
}
/**
 * Verifica si existen todas las configuraciones necesarias
 * @returns {boolean} - True si todas las configuraciones básicas están presentes
 */
async function verificarConfiguracionesBasicas() {
    try {
        // Verificar si existen configuraciones de empresa
        const empresa = await obtenerDeDB('configuraciones', 'empresa');
        if (!empresa || !empresa.nombre || !empresa.cuit) {
            return false;
        }
        
        // Verificar configuraciones de impresión
        const impresion = await obtenerDeDB('configuraciones', 'impresion');
        if (!impresion) {
            return false;
        }
        
        return true;
    } catch (error) {
        console.error('Error al verificar configuraciones básicas:', error);
        return false;
    }
}

/**
 * Comprueba si una integración específica está correctamente configurada y activa
 * @param {string} integracion - Nombre de la integración a verificar
 * @returns {Promise<boolean>} - True si la integración está activa y configurada
 */
async function verificarIntegracion(integracion) {
    try {
        const config = await obtenerDeDB('configuraciones', integracion);
        
        if (!config || !config.activo) {
            return false;
        }
        
        switch (integracion) {
            case 'mercadoPago':
                return config.clientId && config.clientSecret;
                
            case 'arca':
                return config.cuit && config.certificado && config.clave;
                
            case 'whatsapp':
                return config.numeroTelefono;
                
            case 'email':
                return config.servidor && config.usuario && config.password;
                
            case 'bancos':
                // Verificar si al menos un banco está activo
                return Object.values(config).some(banco => banco.activo === true);
                
            default:
                return false;
        }
    } catch (error) {
        console.error(`Error al verificar integración ${integracion}:`, error);
        return false;
    }
}

/**
 * Obtiene las configuraciones de una sucursal específica
 * @param {string} idSucursal - ID de la sucursal
 * @returns {Promise<Object>} - Configuraciones de la sucursal
 */
async function obtenerConfiguracionSucursal(idSucursal) {
    try {
        // Cargar configuraciones generales
        const configuracionesGenerales = {
            empresa: await obtenerDeDB('configuraciones', 'empresa') || {},
            visual: await obtenerDeDB('configuraciones', 'visual') || {},
            impresion: await obtenerDeDB('configuraciones', 'impresion') || {}
        };
        
        // Cargar configuraciones específicas de la sucursal
        const sucursalConfig = await obtenerDeDB('sucursales', idSucursal) || {};
        
        // Combinar con preferencia a configuraciones de sucursal
        return {
            ...configuracionesGenerales,
            ...sucursalConfig,
            sucursalId: idSucursal
        };
    } catch (error) {
        console.error(`Error al obtener configuración de sucursal ${idSucursal}:`, error);
        mostrarNotificacion('Error al cargar configuración de sucursal', 'error');
        return null;
    }
}

/**
 * Aplica y activa las configuraciones específicas para un módulo
 * @param {string} modulo - Nombre del módulo
 * @returns {Object} - Configuraciones aplicables al módulo
 */
async function obtenerConfiguracionModulo(modulo) {
    const resultado = {};
    
    try {
        // Cargar configuraciones básicas que se aplican a todos los módulos
        resultado.empresa = await obtenerDeDB('configuraciones', 'empresa') || {};
        resultado.visual = await obtenerDeDB('configuraciones', 'visual') || {};
        
        // Cargar configuraciones específicas según el módulo
        switch (modulo) {
            case 'facturador':
                resultado.impresion = await obtenerDeDB('configuraciones', 'impresion') || {};
                resultado.mercadoPago = await obtenerDeDB('configuraciones', 'mercadoPago') || {};
                resultado.arca = await obtenerDeDB('configuraciones', 'arca') || {};
                break;
                
            case 'ventas':
                resultado.whatsapp = await obtenerDeDB('configuraciones', 'whatsapp') || {};
                resultado.email = await obtenerDeDB('configuraciones', 'email') || {};
                break;
                
            case 'caja':
                resultado.bancos = await obtenerDeDB('configuraciones', 'bancos') || {};
                break;
                
            // Agregar más casos según sea necesario
        }
        
        return resultado;
    } catch (error) {
        console.error(`Error al obtener configuración para módulo ${modulo}:`, error);
        mostrarNotificacion('Error al cargar configuraciones del módulo', 'error');
        return resultado;
    }
}

/**
 * Eventos del ciclo de vida del módulo
 */
function onModuloActivado() {
    // Registrar en log
    registrarAuditoria('Acceso', 'Módulo de configuraciones', 'Módulo activado');
}

function onModuloDesactivado() {
    // Registrar en log cuando se sale del módulo
    registrarAuditoria('Acceso', 'Módulo de configuraciones', 'Módulo desactivado');
}
 // Mostrar la primera sección
 mostrarSeccion('empresa');
        
 mostrarNotificacion('Configuraciones restauradas a valores predeterminados', 'success');
 
 // Registrar en log
 registrarAuditoria('Configuración', 'Restauración', 'Se restauraron las configuraciones a valores predeterminados');
 
 return true;
 {(error) 
 console.error('Error al restaurar valores predeterminados:', error);
 mostrarNotificacion('Error al restaurar valores predeterminados: ' + error.message, 'error');
 return false;
}

// Exportar todas las funciones que podrían ser útiles para otros módulos
module.exports = {
initConfiguraciones,
cargarConfiguracionesGuardadas,
mostrarSeccion,
guardarConfiguraciones,
obtenerConfiguracionEmpresa,
verificarConfiguracionesBasicas,
verificarIntegracion,
obtenerConfiguracionSucursal,
obtenerConfiguracionModulo,
restaurarValoresPredeterminados,
onModuloActivado,
onModuloDesactivado
};