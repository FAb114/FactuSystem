/**
 * FactuSystem - Módulo de Configuración de Impresión
 * Gestiona toda la configuración relacionada con impresoras y formatos de impresión
 */

// Importaciones
const { ipcRenderer } = require('electron');
const database = require('../../utils/database');
const validation = require('../../utils/validation');
const logger = require('../../utils/logger');
const auth = require('../../utils/auth');

// Servicios de impresión
const printerService = require('../../../../services/print/printer');

// Estado inicial de configuración
let configState = {
    impresoras: [],
    impresoraActiva: null,
    impresoraTicket: null,
    impresoraFactura: null,
    formatoFactura: 'A4',
    formatoTicket: '58mm',
    logoEmpresa: null,
    margenes: {
        superior: 10,
        inferior: 10,
        izquierdo: 10,
        derecho: 10
    },
    mostrarLogo: true,
    mostrarDatosEmpresa: true,
    mostrarQR: true,
    mostrarFirmaDigital: true,
    mostrarCopiaCliente: true,
    previsualizacionPDF: true,
    autoimprimir: false,
    plantillaFacturaA4: 'default',
    plantillaTicket: 'default',
    plantillaRemito: 'default',
    plantillaNotaCredito: 'default',
    plantillaNotaDebito: 'default',
    cantidadCopias: 1,
    tamanioFuente: 'normal'
};

/**
 * Inicializa el módulo de configuración de impresión
 */
async function init() {
    try {
        // Cargar configuración guardada
        await cargarConfiguracion();
        
        // Detectar impresoras disponibles
        await detectarImpresoras();
        
        // Configurar interfaz de usuario
        setupUI();
        
        // Configurar listeners de eventos
        setupEventListeners();
        
        logger.info('Módulo de configuración de impresión inicializado correctamente', {
            modulo: 'configuraciones/impresion'
        });
    } catch (error) {
        logger.error('Error al inicializar el módulo de configuración de impresión', {
            modulo: 'configuraciones/impresion',
            error: error.message
        });
        mostrarError('Error al cargar la configuración de impresión. Por favor, intente nuevamente.');
    }
}

/**
 * Carga la configuración de impresión desde la base de datos
 */
async function cargarConfiguracion() {
    try {
        const config = await database.get('configuracion', 'impresion');
        
        if (config) {
            // Fusionar con la configuración por defecto
            configState = { ...configState, ...config };
            
            logger.info('Configuración de impresión cargada correctamente', {
                modulo: 'configuraciones/impresion'
            });
        } else {
            // Si no existe configuración previa, guardar la configuración por defecto
            await guardarConfiguracion();
            
            logger.info('Configuración de impresión por defecto creada', {
                modulo: 'configuraciones/impresion'
            });
        }
    } catch (error) {
        logger.error('Error al cargar configuración de impresión desde la base de datos', {
            modulo: 'configuraciones/impresion',
            error: error.message
        });
        throw new Error('Error al cargar configuración de impresión');
    }
}

/**
 * Guarda la configuración actual en la base de datos
 */
async function guardarConfiguracion() {
    try {
        // Registrar la acción del usuario
        const usuario = auth.getUsuarioActual();
        
        await database.set('configuracion', 'impresion', configState);
        
        // Registrar cambio en log de auditoría
        logger.audit('Configuración de impresión actualizada', {
            modulo: 'configuraciones/impresion',
            usuario: usuario?.nombre || 'Sistema',
            accion: 'actualizar_config_impresion',
            datos: JSON.stringify(configState)
        });
        
        // Notificar al servicio de impresión sobre los cambios
        ipcRenderer.send('impresion:config-actualizada', configState);
        
        mostrarNotificacion('Configuración de impresión guardada correctamente');
        
        return true;
    } catch (error) {
        logger.error('Error al guardar configuración de impresión', {
            modulo: 'configuraciones/impresion',
            error: error.message
        });
        mostrarError('Error al guardar la configuración. Por favor, intente nuevamente.');
        return false;
    }
}

/**
 * Detecta impresoras disponibles en el sistema
 */
async function detectarImpresoras() {
    try {
        // Solicitar al proceso principal la lista de impresoras
        const impresoras = await ipcRenderer.invoke('impresion:obtener-impresoras');
        
        configState.impresoras = impresoras;
        
        logger.info(`Se detectaron ${impresoras.length} impresoras en el sistema`, {
            modulo: 'configuraciones/impresion',
            impresoras: impresoras.map(i => i.name).join(', ')
        });
        
        return impresoras;
    } catch (error) {
        logger.error('Error al detectar impresoras', {
            modulo: 'configuraciones/impresion',
            error: error.message
        });
        mostrarError('No se pudieron detectar las impresoras. Verifique que estén conectadas y funcionando correctamente.');
        return [];
    }
}

/**
 * Configura la interfaz de usuario
 */
function setupUI() {
    // Elementos del DOM
    const selectImpresoraTicket = document.getElementById('selectImpresoraTicket');
    const selectImpresoraFactura = document.getElementById('selectImpresoraFactura');
    const selectPlantillaFactura = document.getElementById('selectPlantillaFactura');
    const selectPlantillaTicket = document.getElementById('selectPlantillaTicket');
    const inputMargenSuperior = document.getElementById('inputMargenSuperior');
    const inputMargenInferior = document.getElementById('inputMargenInferior');
    const inputMargenIzquierdo = document.getElementById('inputMargenIzquierdo');
    const inputMargenDerecho = document.getElementById('inputMargenDerecho');
    const checkMostrarLogo = document.getElementById('checkMostrarLogo');
    const checkMostrarDatosEmpresa = document.getElementById('checkMostrarDatosEmpresa');
    const checkMostrarQR = document.getElementById('checkMostrarQR');
    const checkMostrarFirmaDigital = document.getElementById('checkMostrarFirmaDigital');
    const checkPrevisualizarPDF = document.getElementById('checkPrevisualizarPDF');
    const checkAutoImprimir = document.getElementById('checkAutoImprimir');
    const inputCantidadCopias = document.getElementById('inputCantidadCopias');
    const selectTamanioFuente = document.getElementById('selectTamanioFuente');
    const btnLogoEmpresa = document.getElementById('btnLogoEmpresa');
    const previewFactura = document.getElementById('previewFactura');
    const previewTicket = document.getElementById('previewTicket');
    const btnGuardarConfig = document.getElementById('btnGuardarConfig');
    const btnDetectarImpresoras = document.getElementById('btnDetectarImpresoras');
    const btnTestImpresoraTicket = document.getElementById('btnTestImpresoraTicket');
    const btnTestImpresoraFactura = document.getElementById('btnTestImpresoraFactura');
    
    // Si algún elemento no existe, probablemente estamos en otra vista
    if (!selectImpresoraTicket || !selectImpresoraFactura) {
        logger.warn('Elementos DOM no encontrados para configuración de impresión', {
            modulo: 'configuraciones/impresion'
        });
        return;
    }
    
    // Llenar selectores de impresoras
    llenarSelectorImpresoras(selectImpresoraTicket, configState.impresoraTicket);
    llenarSelectorImpresoras(selectImpresoraFactura, configState.impresoraFactura);
    
    // Llenar selectores de plantillas
    cargarPlantillasDisponibles(selectPlantillaFactura, 'facturas', configState.plantillaFacturaA4);
    cargarPlantillasDisponibles(selectPlantillaTicket, 'facturas', configState.plantillaTicket);
    
    // Configurar valores en inputs
    if (inputMargenSuperior) inputMargenSuperior.value = configState.margenes.superior;
    if (inputMargenInferior) inputMargenInferior.value = configState.margenes.inferior;
    if (inputMargenIzquierdo) inputMargenIzquierdo.value = configState.margenes.izquierdo;
    if (inputMargenDerecho) inputMargenDerecho.value = configState.margenes.derecho;
    
    // Configurar checkboxes
    if (checkMostrarLogo) checkMostrarLogo.checked = configState.mostrarLogo;
    if (checkMostrarDatosEmpresa) checkMostrarDatosEmpresa.checked = configState.mostrarDatosEmpresa;
    if (checkMostrarQR) checkMostrarQR.checked = configState.mostrarQR;
    if (checkMostrarFirmaDigital) checkMostrarFirmaDigital.checked = configState.mostrarFirmaDigital;
    if (checkPrevisualizarPDF) checkPrevisualizarPDF.checked = configState.previsualizacionPDF;
    if (checkAutoImprimir) checkAutoImprimir.checked = configState.autoimprimir;
    
    // Otros controles
    if (inputCantidadCopias) inputCantidadCopias.value = configState.cantidadCopias;
    
    // Configurar selector de tamaño de fuente
    if (selectTamanioFuente) {
        const opciones = ['pequeño', 'normal', 'grande', 'muy grande'];
        selectTamanioFuente.innerHTML = '';
        
        opciones.forEach(opcion => {
            const optionEl = document.createElement('option');
            optionEl.value = opcion;
            optionEl.textContent = opcion.charAt(0).toUpperCase() + opcion.slice(1);
            if (opcion === configState.tamanioFuente) {
                optionEl.selected = true;
            }
            selectTamanioFuente.appendChild(optionEl);
        });
    }
    
    // Mostrar previsualización inicial
    actualizarPrevisualizacion();
}

/**
 * Llena un selector con las impresoras disponibles
 * @param {HTMLElement} selectElement - Elemento select a llenar
 * @param {string} valorSeleccionado - Nombre de la impresora que debe quedar seleccionada
 */
function llenarSelectorImpresoras(selectElement, valorSeleccionado) {
    if (!selectElement) return;
    
    // Limpiar opciones actuales
    selectElement.innerHTML = '';
    
    // Opción por defecto
    const optionDefault = document.createElement('option');
    optionDefault.value = '';
    optionDefault.textContent = '-- Seleccione una impresora --';
    selectElement.appendChild(optionDefault);
    
    // Agregar cada impresora
    configState.impresoras.forEach(impresora => {
        const option = document.createElement('option');
        option.value = impresora.name;
        option.textContent = impresora.name;
        
        if (impresora.name === valorSeleccionado) {
            option.selected = true;
        }
        
        selectElement.appendChild(option);
    });
}

/**
 * Carga las plantillas disponibles para un tipo de documento
 * @param {HTMLElement} selectElement - Elemento select a llenar
 * @param {string} tipoDocumento - Tipo de documento (facturas, remitos, etc)
 * @param {string} valorSeleccionado - Valor de la plantilla seleccionada
 */
async function cargarPlantillasDisponibles(selectElement, tipoDocumento, valorSeleccionado) {
    if (!selectElement) return;
    
    try {
        // Obtener plantillas disponibles
        const plantillas = await ipcRenderer.invoke('plantillas:obtener-lista', tipoDocumento);
        
        // Limpiar opciones actuales
        selectElement.innerHTML = '';
        
        // Opción por defecto
        const optionDefault = document.createElement('option');
        optionDefault.value = 'default';
        optionDefault.textContent = 'Plantilla por defecto';
        selectElement.appendChild(optionDefault);
        
        // Agregar cada plantilla disponible
        plantillas.forEach(plantilla => {
            const option = document.createElement('option');
            option.value = plantilla.id;
            option.textContent = plantilla.nombre;
            
            if (plantilla.id === valorSeleccionado) {
                option.selected = true;
            }
            
            selectElement.appendChild(option);
        });
    } catch (error) {
        logger.error('Error al cargar plantillas disponibles', {
            modulo: 'configuraciones/impresion',
            tipoDocumento,
            error: error.message
        });
    }
}

/**
 * Configura los escuchadores de eventos para la interfaz
 */
function setupEventListeners() {
    // Elementos del DOM
    const selectImpresoraTicket = document.getElementById('selectImpresoraTicket');
    const selectImpresoraFactura = document.getElementById('selectImpresoraFactura');
    const selectPlantillaFactura = document.getElementById('selectPlantillaFactura');
    const selectPlantillaTicket = document.getElementById('selectPlantillaTicket');
    const inputMargenSuperior = document.getElementById('inputMargenSuperior');
    const inputMargenInferior = document.getElementById('inputMargenInferior');
    const inputMargenIzquierdo = document.getElementById('inputMargenIzquierdo');
    const inputMargenDerecho = document.getElementById('inputMargenDerecho');
    const checkMostrarLogo = document.getElementById('checkMostrarLogo');
    const checkMostrarDatosEmpresa = document.getElementById('checkMostrarDatosEmpresa');
    const checkMostrarQR = document.getElementById('checkMostrarQR');
    const checkMostrarFirmaDigital = document.getElementById('checkMostrarFirmaDigital');
    const checkPrevisualizarPDF = document.getElementById('checkPrevisualizarPDF');
    const checkAutoImprimir = document.getElementById('checkAutoImprimir');
    const inputCantidadCopias = document.getElementById('inputCantidadCopias');
    const selectTamanioFuente = document.getElementById('selectTamanioFuente');
    const btnLogoEmpresa = document.getElementById('btnLogoEmpresa');
    const btnGuardarConfig = document.getElementById('btnGuardarConfig');
    const btnDetectarImpresoras = document.getElementById('btnDetectarImpresoras');
    const btnTestImpresoraTicket = document.getElementById('btnTestImpresoraTicket');
    const btnTestImpresoraFactura = document.getElementById('btnTestImpresoraFactura');
    
    // Si algún elemento no existe, probablemente estamos en otra vista
    if (!selectImpresoraTicket || !selectImpresoraFactura) {
        return;
    }
    
    // Eventos de cambio en los selectores de impresoras
    if (selectImpresoraTicket) {
        selectImpresoraTicket.addEventListener('change', (e) => {
            configState.impresoraTicket = e.target.value;
        });
    }
    
    if (selectImpresoraFactura) {
        selectImpresoraFactura.addEventListener('change', (e) => {
            configState.impresoraFactura = e.target.value;
        });
    }
    
    // Eventos de cambio en las plantillas
    if (selectPlantillaFactura) {
        selectPlantillaFactura.addEventListener('change', (e) => {
            configState.plantillaFacturaA4 = e.target.value;
            actualizarPrevisualizacion();
        });
    }
    
    if (selectPlantillaTicket) {
        selectPlantillaTicket.addEventListener('change', (e) => {
            configState.plantillaTicket = e.target.value;
            actualizarPrevisualizacion();
        });
    }
    
    // Eventos de cambio en los márgenes
    const margenInputs = [inputMargenSuperior, inputMargenInferior, inputMargenIzquierdo, inputMargenDerecho];
    const margenProps = ['superior', 'inferior', 'izquierdo', 'derecho'];
    
    margenInputs.forEach((input, index) => {
        if (input) {
            input.addEventListener('change', (e) => {
                // Validar que sea un número positivo
                const valor = parseInt(e.target.value);
                if (isNaN(valor) || valor < 0) {
                    e.target.value = configState.margenes[margenProps[index]];
                    return;
                }
                
                configState.margenes[margenProps[index]] = valor;
                actualizarPrevisualizacion();
            });
        }
    });
    
    // Eventos de cambio en los checkboxes
    if (checkMostrarLogo) {
        checkMostrarLogo.addEventListener('change', (e) => {
            configState.mostrarLogo = e.target.checked;
            actualizarPrevisualizacion();
        });
    }
    
    if (checkMostrarDatosEmpresa) {
        checkMostrarDatosEmpresa.addEventListener('change', (e) => {
            configState.mostrarDatosEmpresa = e.target.checked;
            actualizarPrevisualizacion();
        });
    }
    
    if (checkMostrarQR) {
        checkMostrarQR.addEventListener('change', (e) => {
            configState.mostrarQR = e.target.checked;
            actualizarPrevisualizacion();
        });
    }
    
    if (checkMostrarFirmaDigital) {
        checkMostrarFirmaDigital.addEventListener('change', (e) => {
            configState.mostrarFirmaDigital = e.target.checked;
            actualizarPrevisualizacion();
        });
    }
    
    if (checkPrevisualizarPDF) {
        checkPrevisualizarPDF.addEventListener('change', (e) => {
            configState.previsualizacionPDF = e.target.checked;
        });
    }
    
    if (checkAutoImprimir) {
        checkAutoImprimir.addEventListener('change', (e) => {
            configState.autoimprimir = e.target.checked;
        });
    }
    
    // Evento de cambio en cantidad de copias
    if (inputCantidadCopias) {
        inputCantidadCopias.addEventListener('change', (e) => {
            const valor = parseInt(e.target.value);
            if (isNaN(valor) || valor < 1) {
                e.target.value = configState.cantidadCopias;
                return;
            }
            
            configState.cantidadCopias = valor;
        });
    }
    
    // Evento de cambio en tamaño de fuente
    if (selectTamanioFuente) {
        selectTamanioFuente.addEventListener('change', (e) => {
            configState.tamanioFuente = e.target.value;
            actualizarPrevisualizacion();
        });
    }
    
    // Evento para seleccionar logo de empresa
    if (btnLogoEmpresa) {
        btnLogoEmpresa.addEventListener('click', async () => {
            try {
                const resultado = await ipcRenderer.invoke('dialogo:seleccionar-imagen');
                
                if (resultado.canceled || resultado.filePaths.length === 0) {
                    return;
                }
                
                const rutaImagen = resultado.filePaths[0];
                
                // Guardar referencia a la imagen en la configuración
                configState.logoEmpresa = rutaImagen;
                
                // Mostrar imagen seleccionada
                const imgLogo = document.getElementById('imgLogoEmpresa');
                if (imgLogo) {
                    imgLogo.src = rutaImagen;
                    imgLogo.style.display = 'block';
                }
                
                actualizarPrevisualizacion();
                
                logger.info('Logo de empresa actualizado', {
                    modulo: 'configuraciones/impresion',
                    ruta: rutaImagen
                });
            } catch (error) {
                logger.error('Error al seleccionar logo de empresa', {
                    modulo: 'configuraciones/impresion',
                    error: error.message
                });
                mostrarError('Error al seleccionar la imagen. Verifique que sea un formato válido (JPG, PNG).');
            }
        });
    }
    
    // Evento para detectar impresoras
    if (btnDetectarImpresoras) {
        btnDetectarImpresoras.addEventListener('click', async () => {
            const spinnerDetectar = document.getElementById('spinnerDetectar');
            if (spinnerDetectar) spinnerDetectar.style.display = 'inline-block';
            
            // Detectar impresoras nuevamente
            const impresoras = await detectarImpresoras();
            
            // Actualizar selectores
            llenarSelectorImpresoras(selectImpresoraTicket, configState.impresoraTicket);
            llenarSelectorImpresoras(selectImpresoraFactura, configState.impresoraFactura);
            
            if (spinnerDetectar) spinnerDetectar.style.display = 'none';
            
            // Mostrar notificación
            mostrarNotificacion(`Se detectaron ${impresoras.length} impresoras en el sistema`);
        });
    }
    
    // Eventos para probar impresoras
    if (btnTestImpresoraTicket) {
        btnTestImpresoraTicket.addEventListener('click', async () => {
            if (!configState.impresoraTicket) {
                mostrarError('Seleccione una impresora para ticket primero');
                return;
            }
            
            try {
                await ipcRenderer.invoke('impresion:test-impresora', {
                    impresora: configState.impresoraTicket,
                    tipo: 'ticket'
                });
                
                mostrarNotificacion('Página de prueba enviada a la impresora de ticket');
            } catch (error) {
                logger.error('Error al imprimir página de prueba (ticket)', {
                    modulo: 'configuraciones/impresion',
                    impresora: configState.impresoraTicket,
                    error: error.message
                });
                mostrarError('Error al imprimir página de prueba. Verifique que la impresora esté conectada y funcionando.');
            }
        });
    }
    
    if (btnTestImpresoraFactura) {
        btnTestImpresoraFactura.addEventListener('click', async () => {
            if (!configState.impresoraFactura) {
                mostrarError('Seleccione una impresora para factura primero');
                return;
            }
            
            try {
                await ipcRenderer.invoke('impresion:test-impresora', {
                    impresora: configState.impresoraFactura,
                    tipo: 'factura'
                });
                
                mostrarNotificacion('Página de prueba enviada a la impresora de factura');
            } catch (error) {
                logger.error('Error al imprimir página de prueba (factura)', {
                    modulo: 'configuraciones/impresion',
                    impresora: configState.impresoraFactura,
                    error: error.message
                });
                mostrarError('Error al imprimir página de prueba. Verifique que la impresora esté conectada y funcionando.');
            }
        });
    }
    
    // Evento para guardar configuración
    if (btnGuardarConfig) {
        btnGuardarConfig.addEventListener('click', async () => {
            // Validar configuración antes de guardar
            if (!validarConfiguracion()) {
                return;
            }
            
            const spinnerGuardar = document.getElementById('spinnerGuardar');
            if (spinnerGuardar) spinnerGuardar.style.display = 'inline-block';
            
            // Guardar configuración
            const resultado = await guardarConfiguracion();
            
            if (spinnerGuardar) spinnerGuardar.style.display = 'none';
            
            if (resultado) {
                mostrarNotificacion('Configuración guardada correctamente');
            }
        });
    }
}

/**
 * Valida la configuración actual
 * @returns {boolean} True si la configuración es válida
 */
function validarConfiguracion() {
    // Validar que al menos una impresora esté configurada
    if (!configState.impresoraTicket && !configState.impresoraFactura) {
        mostrarError('Debe configurar al menos una impresora (ticket o factura)');
        return false;
    }
    
    // Validar márgenes
    for (const prop in configState.margenes) {
        const valor = configState.margenes[prop];
        if (isNaN(valor) || valor < 0 || valor > 100) {
            mostrarError('Los márgenes deben ser números entre 0 y 100');
            return false;
        }
    }
    
    // Validar cantidad de copias
    if (isNaN(configState.cantidadCopias) || configState.cantidadCopias < 1 || configState.cantidadCopias > 10) {
        mostrarError('La cantidad de copias debe ser un número entre 1 y 10');
        return false;
    }
    
    return true;
}

/**
 * Actualiza la previsualización de los documentos
 */
async function actualizarPrevisualizacion() {
    const previewFactura = document.getElementById('previewFactura');
    const previewTicket = document.getElementById('previewTicket');
    
    if (!previewFactura && !previewTicket) return;
    
    try {
        // Datos de ejemplo para la previsualización
        const datosEjemplo = await generarDatosEjemplo();
        
        // Actualizar previsualización de factura
        if (previewFactura) {
            const htmlFactura = await ipcRenderer.invoke('plantillas:renderizar', {
                tipo: 'facturas',
                plantilla: configState.plantillaFacturaA4,
                formato: 'A4',
                datos: datosEjemplo,
                config: {
                    mostrarLogo: configState.mostrarLogo,
                    mostrarDatosEmpresa: configState.mostrarDatosEmpresa,
                    mostrarQR: configState.mostrarQR,
                    mostrarFirmaDigital: configState.mostrarFirmaDigital,
                    tamanioFuente: configState.tamanioFuente,
                    logoEmpresa: configState.logoEmpresa,
                    margenes: configState.margenes
                }
            });
            
            previewFactura.srcdoc = htmlFactura;
        }
        
        // Actualizar previsualización de ticket
        if (previewTicket) {
            const htmlTicket = await ipcRenderer.invoke('plantillas:renderizar', {
                tipo: 'facturas',
                plantilla: configState.plantillaTicket,
                formato: '58mm',
                datos: datosEjemplo,
                config: {
                    mostrarLogo: configState.mostrarLogo,
                    mostrarDatosEmpresa: configState.mostrarDatosEmpresa,
                    mostrarQR: configState.mostrarQR,
                    mostrarFirmaDigital: configState.mostrarFirmaDigital,
                    tamanioFuente: configState.tamanioFuente,
                    logoEmpresa: configState.logoEmpresa
                }
            });
            
            previewTicket.srcdoc = htmlTicket;
        }
    } catch (error) {
        logger.error('Error al actualizar previsualización de documentos', {
            modulo: 'configuraciones/impresion',
            error: error.message
        });
    }
}

/**
 * Genera datos de ejemplo para la previsualización
 */
async function generarDatosEjemplo() {
    // Obtener datos de la empresa
    const datosEmpresa = await database.get('configuracion', 'empresa') || {
        nombre: 'Mi Empresa S.A.',
        cuit: '30-12345678-9',
        direccion: 'Av. Ejemplo 1234',
        telefono: '(011) 4123-4567',
        email: 'info@miempresa.com'
    };
    
    // Datos de ejemplo
    return {
        empresa: datosEmpresa,
        factura: {
            numero: '0001-00000123',
            fecha: new Date().toLocaleDateString(),
            tipo: 'A',
            cae: '71234567890123',
            vencimientoCae: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toLocaleDateString(),
            condicionVenta: 'Contado'
        },
        cliente: {
            nombre: 'Cliente de Ejemplo S.R.L.',
            documento: '30-98765432-1',
            tipoDocumento: 'CUIT',
            direccion: 'Calle Modelo 567, Ciudad',
            condicionIVA: 'Responsable Inscripto',
            telefono: '(011) 5678-1234',
            email: 'contacto@clienteejemplo.com'
        },
        items: [
            {
                codigo: 'PROD001',
                descripcion: 'Producto de Ejemplo 1',
                cantidad: 2,
                precioUnitario: 1000,
                descuento: 0,
                subtotal: 2000,
                iva: 21,
                total: 2420
            },
            {
                codigo: 'PROD002',
                descripcion: 'Producto de Ejemplo 2',
                cantidad: 1,
                precioUnitario: 500,
                descuento: 10,
                subtotal: 450,
                iva: 21,
                total: 544.50
            },
            {
                codigo: 'SERV001',
                descripcion: 'Servicio de Ejemplo',
                cantidad: 3,
                precioUnitario: 300,
                descuento: 0,
                subtotal: 900,
                iva: 10.5,
                total: 994.50
            }
        ],
        totales: {
            subtotal: 3350,
            descuentos: 50,
            iva21: 516.60,
            iva10_5: 94.50,
            total: 3959.10
        },
        formasPago: [
            {
                tipo: 'Efectivo',
                monto: 2000
            },
            {
                tipo: 'Tarjeta de Débito',
                monto: 1959.10,
                datosTarjeta: {
                    ultimos4: '4321',
                    comprobante: '09876543'
                }
            }
        ],
        usuario: {
            nombre: 'Vendedor Ejemplo',
            id: 1
        },
        sucursal: {
            nombre: 'Casa Central',
            direccion: 'Av. Principal 123',
            telefono: '(011) 4123-4567'
        },
        // Datos para código QR
        qrData: 'https://www.afip.gob.ar/fe/qr/?p=30123456789|0001|00000123|A|3959.10|' + 
                new Date().toISOString().split('T')[0].replace(/-/g, '') + '|71234567890123'
    };
}

/**
 * Obtiene la configuración actual de impresión
 * @returns {Object} Configuración actual
 */
function getConfiguracion() {
    return { ...configState };
}

/**
 * Obtiene el nombre de la impresora configurada para un tipo de documento
 * @param {string} tipo - Tipo de documento ('factura' o 'ticket')
 * @returns {string|null} Nombre de la impresora o null si no hay configurada
 */
function getImpresoraPorTipo(tipo) {
    if (tipo === 'factura' || tipo === 'A4') {
        return configState.impresoraFactura;
    } else if (tipo === 'ticket' || tipo === '58mm') {
        return configState.impresoraTicket;
    }
    return null;
}

/**
 * Obtiene el nombre de la plantilla configurada para un tipo de documento
 * @param {string} tipo - Tipo de documento ('factura', 'ticket', 'remito', etc.)
 * @returns {string} Nombre de la plantilla
 */
function getPlantillaPorTipo(tipo) {
    switch (tipo) {
        case 'factura':
        case 'A4':
            return configState.plantillaFacturaA4;
        case 'ticket':
        case '58mm':
            return configState.plantillaTicket;
        case 'remito':
            return configState.plantillaRemito;
        case 'notaCredito':
            return configState.plantillaNotaCredito;
        case 'notaDebito':
            return configState.plantillaNotaDebito;
        default:
            return 'default';
    }
}

/**
 * Verifica si se debe mostrar previsualización PDF antes de imprimir
 * @returns {boolean} True si se debe mostrar previsualización
 */
function debePrevisualizar() {
    return configState.previsualizacionPDF;
}

/**
 * Verifica si se debe imprimir automáticamente
 * @returns {boolean} True si se debe imprimir automáticamente
 */
function debeImprimirAutomaticamente() {
    return configState.autoimprimir;
}

/**
 * Obtiene la cantidad de copias a imprimir
 * @returns {number} Cantidad de copias
 */
function getCantidadCopias() {
    return configState.cantidadCopias;
}

/**
 * Muestra una notificación al usuario
 * @param {string} mensaje - Mensaje a mostrar
 */
function mostrarNotificacion(mensaje) {
    const notificaciones = document.getElementById('notificaciones');
    
    if (!notificaciones) {
        // Si no hay contenedor de notificaciones, usar alert
        alert(mensaje);
        return;
    }
    
    const notificacion = document.createElement('div');
    notificacion.className = 'notificacion notificacion-exito';
    notificacion.innerHTML = `
        <i class="fas fa-check-circle"></i>
        <span>${mensaje}</span>
    `;
    
    notificaciones.appendChild(notificacion);
    
    // Eliminar después de 3 segundos
    setTimeout(() => {
        notificacion.classList.add('notificacion-salida');
        setTimeout(() => {
            notificaciones.removeChild(notificacion);
        }, 300);
    }, 3000);
}

/**
 * Muestra un mensaje de error al usuario
 * @param {string} mensaje - Mensaje de error
 */
function mostrarError(mensaje) {
    const notificaciones = document.getElementById('notificaciones');
    
    if (!notificaciones) {
        // Si no hay contenedor de notificaciones, usar alert
        alert(`Error: ${mensaje}`);
        return;
    }
    
    const notificacion = document.createElement('div');
    notificacion.className = 'notificacion notificacion-error';
    notificacion.innerHTML = `
        <i class="fas fa-exclamation-circle"></i>
        <span>${mensaje}</span>
    `;
    
    notificaciones.appendChild(notificacion);
    
    // Eliminar después de 5 segundos
    setTimeout(() => {
        notificacion.classList.add('notificacion-salida');
        setTimeout(() => {
            notificaciones.removeChild(notificacion);
        }, 300);
    }, 5000);
}

/**
 * Verifica si hay impresoras configuradas en el sistema
 * @returns {boolean} True si hay al menos una impresora configurada
 */
function hayImpresorasConfiguradas() {
    return configState.impresoraTicket !== null || configState.impresoraFactura !== null;
}

/**
 * Renderiza una plantilla con los datos proporcionados
 * @param {string} tipoDocumento - Tipo de documento (factura, ticket, etc.)
 * @param {string} formato - Formato (A4, 58mm)
 * @param {Object} datos - Datos para la plantilla
 * @returns {Promise<string>} HTML renderizado
 */
async function renderizarPlantilla(tipoDocumento, formato, datos) {
    try {
        // Determinar la plantilla a utilizar
        let plantilla;
        
        if (tipoDocumento === 'factura' && formato === 'A4') {
            plantilla = configState.plantillaFacturaA4;
        } else if (tipoDocumento === 'factura' && formato === '58mm') {
            plantilla = configState.plantillaTicket;
        } else if (tipoDocumento === 'remito') {
            plantilla = configState.plantillaRemito;
        } else if (tipoDocumento === 'notaCredito') {
            plantilla = configState.plantillaNotaCredito;
        } else if (tipoDocumento === 'notaDebito') {
            plantilla = configState.plantillaNotaDebito;
        } else {
            plantilla = 'default';
        }
        
        // Opciones de configuración para la plantilla
        const configPlantilla = {
            mostrarLogo: configState.mostrarLogo,
            mostrarDatosEmpresa: configState.mostrarDatosEmpresa,
            mostrarQR: configState.mostrarQR,
            mostrarFirmaDigital: configState.mostrarFirmaDigital,
            tamanioFuente: configState.tamanioFuente,
            logoEmpresa: configState.logoEmpresa,
            margenes: configState.margenes
        };
        
        // Renderizar plantilla a través del proceso principal
        const html = await ipcRenderer.invoke('plantillas:renderizar', {
            tipo: tipoDocumento + 's', // Pluraliza el tipo para la carpeta
            plantilla: plantilla,
            formato: formato,
            datos: datos,
            config: configPlantilla
        });
        
        return html;
    } catch (error) {
        logger.error('Error al renderizar plantilla', {
            modulo: 'configuraciones/impresion',
            tipoDocumento,
            formato,
            error: error.message
        });
        throw new Error(`Error al renderizar plantilla: ${error.message}`);
    }
}

/**
 * Imprime un documento directamente
 * @param {string} tipoDocumento - Tipo de documento (factura, ticket, etc.)
 * @param {string} formato - Formato (A4, 58mm)
 * @param {Object} datos - Datos para la plantilla
 * @returns {Promise<boolean>} True si la impresión fue exitosa
 */
async function imprimirDocumento(tipoDocumento, formato, datos) {
    try {
        // Verificar que haya impresoras configuradas
        if (!hayImpresorasConfiguradas()) {
            throw new Error('No hay impresoras configuradas en el sistema');
        }
        
        // Determinar qué impresora usar según el formato
        let impresora;
        if (formato === 'A4') {
            impresora = configState.impresoraFactura;
        } else if (formato === '58mm') {
            impresora = configState.impresoraTicket;
        }
        
        if (!impresora) {
            throw new Error(`No hay impresora configurada para el formato ${formato}`);
        }
        
        // Renderizar la plantilla
        const html = await renderizarPlantilla(tipoDocumento, formato, datos);
        
        // Enviar a imprimir
        await ipcRenderer.invoke('impresion:imprimir', {
            html: html,
            impresora: impresora,
            copias: configState.cantidadCopias,
            opciones: {
                margenes: configState.margenes,
                tamanioFuente: configState.tamanioFuente,
                formato: formato
            }
        });
        
        logger.info('Documento enviado a impresión correctamente', {
            modulo: 'configuraciones/impresion',
            tipoDocumento,
            formato,
            impresora
        });
        
        return true;
    } catch (error) {
        logger.error('Error al imprimir documento', {
            modulo: 'configuraciones/impresion',
            tipoDocumento,
            formato,
            error: error.message
        });
        throw new Error(`Error al imprimir documento: ${error.message}`);
    }
}

/**
 * Genera un PDF a partir de un documento
 * @param {string} tipoDocumento - Tipo de documento (factura, ticket, etc.)
 * @param {string} formato - Formato (A4, 58mm)
 * @param {Object} datos - Datos para la plantilla
 * @returns {Promise<string>} Ruta del archivo PDF generado
 */
async function generarPDF(tipoDocumento, formato, datos) {
    try {
        // Renderizar la plantilla
        const html = await renderizarPlantilla(tipoDocumento, formato, datos);
        
        // Generar PDF a través del proceso principal
        const rutaPDF = await ipcRenderer.invoke('impresion:generar-pdf', {
            html: html,
            opciones: {
                margenes: configState.margenes,
                tamanioFuente: configState.tamanioFuente,
                formato: formato
            },
            nombreArchivo: `${tipoDocumento}_${datos.factura?.numero || 'sin_numero'}.pdf`
        });
        
        logger.info('PDF generado correctamente', {
            modulo: 'configuraciones/impresion',
            tipoDocumento,
            formato,
            rutaPDF
        });
        
        return rutaPDF;
    } catch (error) {
        logger.error('Error al generar PDF', {
            modulo: 'configuraciones/impresion',
            tipoDocumento,
            formato,
            error: error.message
        });
        throw new Error(`Error al generar PDF: ${error.message}`);
    }
}

/**
 * Exporta las funciones públicas del módulo
 */
module.exports = {
    init,
    getConfiguracion,
    getImpresoraPorTipo,
    getPlantillaPorTipo,
    debePrevisualizar,
    debeImprimirAutomaticamente,
    getCantidadCopias,
    hayImpresorasConfiguradas,
    renderizarPlantilla,
    imprimirDocumento,
    generarPDF,
    actualizarPrevisualizacion,
    cargarConfiguracion,
    guardarConfiguracion,
    detectarImpresoras
};