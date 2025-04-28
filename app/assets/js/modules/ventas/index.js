/**
 * FactuSystem - Módulo de Ventas
 * 
 * Este módulo maneja la visualización, filtrado y análisis de las ventas realizadas.
 * Permite ver facturas, estadísticas, exportar informes y gestionar el historial de ventas.
 */

// Importaciones
const { ipcRenderer } = require('electron');
const moment = require('moment');
const Chart = require('chart.js');

// Importaciones de módulos internos
const database = require('../../utils/database');
const validation = require('../../utils/validation');
const printer = require('../../utils/printer');
const logger = require('../../utils/logger');
const tabs = require('../../components/tabs');
const notifications = require('../../components/notifications');

// Importaciones de submódulos de ventas
const historial = require('./historial');
const estadisticas = require('./estadisticas');
const reportes = require('./reportes');

// Configuración del módulo
const config = {
    filtrosPredeterminados: {
        fechaInicio: moment().startOf('month').format('YYYY-MM-DD'),
        fechaFin: moment().format('YYYY-MM-DD'),
        tipoComprobante: 'todos',
        metodoPago: 'todos',
        cliente: '',
        usuario: '',
        sucursal: ''
    },
    paginacion: {
        itemsPorPagina: 25,
        paginaActual: 1
    },
    ordenamiento: {
        campo: 'fecha',
        direccion: 'desc' // desc para descendente, asc para ascendente
    }
};

// Estado del módulo
let state = {
    ventas: [],
    ventasFiltradas: [],
    totalVentas: 0,
    filtros: { ...config.filtrosPredeterminados },
    paginacion: { ...config.paginacion },
    ordenamiento: { ...config.ordenamiento },
    cargando: false,
    sucursales: [],
    usuarios: [],
    clientesFrecuentes: [],
    sucursalActual: null
};

// Elementos DOM (se inicializan en la función init)
let elements = {};

/**
 * Inicializa el módulo de ventas
 * @param {Object} params - Parámetros de inicialización
 * @param {string} params.containerId - ID del contenedor donde se cargará el módulo
 * @param {number} params.sucursalId - ID de la sucursal actual
 */
async function init(params = {}) {
    try {
        // Capturamos la información de la sucursal actual
        state.sucursalActual = params.sucursalId || await database.obtenerSucursalActual();
        
        // Cargar la vista en el contenedor
        const container = document.getElementById(params.containerId || 'content-wrapper');
        if (!container) {
            throw new Error('Contenedor no encontrado para el módulo de ventas');
        }
        
        // Cargar la vista HTML
        container.innerHTML = await loadView();
        
        // Inicializar elementos DOM
        initDOMElements();
        
        // Registrar eventos
        registerEvents();
        
        // Cargar datos iniciales
        await loadInitialData();
        
        // Inicializar submódulos
        historial.init({
            parentModule: {
                state,
                refreshVentas
            }
        });
        
        estadisticas.init({
            parentModule: {
                state,
                refreshVentas
            }
        });
        
        // Notificar que el módulo se cargó correctamente
        notifications.show({
            type: 'info',
            message: 'Módulo de ventas cargado correctamente',
            duration: 2000
        });
        
        // Registrar en el log
        logger.info('Módulo de ventas inicializado', {
            usuario: await database.obtenerUsuarioActual(),
            sucursal: state.sucursalActual
        });

    } catch (error) {
        console.error('Error al inicializar el módulo de ventas:', error);
        notifications.show({
            type: 'error',
            message: 'Error al cargar el módulo de ventas: ' + error.message,
            duration: 5000
        });
        logger.error('Error al inicializar el módulo de ventas', {
            error: error.message,
            stack: error.stack
        });
    }
}

/**
 * Carga la vista HTML del módulo
 */
async function loadView() {
    try {
        // En un entorno real, esto podría cargar la vista desde un archivo HTML
        // Para este ejemplo, generamos el HTML directamente
        return `
            <div class="ventas-module">
                <div class="module-header">
                    <h2>Gestión de Ventas</h2>
                    <div class="module-actions">
                        <button id="btn-nueva-venta" class="btn-primary">
                            <i class="fas fa-plus"></i> Nueva Venta
                        </button>
                        <button id="btn-exportar" class="btn-secondary">
                            <i class="fas fa-file-export"></i> Exportar
                        </button>
                        <button id="btn-refresh" class="btn-icon">
                            <i class="fas fa-sync-alt"></i>
                        </button>
                    </div>
                </div>
                
                <div class="ventas-tabs">
                    <ul class="tab-navigation">
                        <li class="tab-item active" data-tab="historial">Historial de Ventas</li>
                        <li class="tab-item" data-tab="estadisticas">Estadísticas</li>
                        <li class="tab-item" data-tab="reportes">Reportes</li>
                    </ul>
                    
                    <div class="tab-content">
                        <!-- Tab Historial -->
                        <div id="tab-historial" class="tab-pane active">
                            <div class="filtros-container">
                                <h3>Filtros</h3>
                                <div class="filtros-form">
                                    <div class="filtro-grupo">
                                        <label for="fecha-inicio">Desde:</label>
                                        <input type="date" id="fecha-inicio" class="filtro-input">
                                    </div>
                                    <div class="filtro-grupo">
                                        <label for="fecha-fin">Hasta:</label>
                                        <input type="date" id="fecha-fin" class="filtro-input">
                                    </div>
                                    <div class="filtro-grupo">
                                        <label for="tipo-comprobante">Tipo:</label>
                                        <select id="tipo-comprobante" class="filtro-input">
                                            <option value="todos">Todos</option>
                                            <option value="A">Factura A</option>
                                            <option value="B">Factura B</option>
                                            <option value="C">Factura C</option>
                                            <option value="X">Factura X</option>
                                            <option value="P">Presupuesto</option>
                                        </select>
                                    </div>
                                    <div class="filtro-grupo">
                                        <label for="metodo-pago">Pago:</label>
                                        <select id="metodo-pago" class="filtro-input">
                                            <option value="todos">Todos</option>
                                            <option value="efectivo">Efectivo</option>
                                            <option value="tarjeta_debito">Tarjeta Débito</option>
                                            <option value="tarjeta_credito">Tarjeta Crédito</option>
                                            <option value="transferencia">Transferencia</option>
                                            <option value="mercadopago">Mercado Pago</option>
                                            <option value="multiple">Pago Mixto</option>
                                        </select>
                                    </div>
                                    <div class="filtro-grupo">
                                        <label for="cliente">Cliente:</label>
                                        <input type="text" id="cliente" class="filtro-input" placeholder="Nombre o CUIT">
                                    </div>
                                    <div class="filtro-grupo">
                                        <label for="usuario">Usuario:</label>
                                        <select id="usuario" class="filtro-input">
                                            <option value="todos">Todos</option>
                                            <!-- Se cargará dinámicamente -->
                                        </select>
                                    </div>
                                    <div class="filtro-grupo">
                                        <label for="sucursal">Sucursal:</label>
                                        <select id="sucursal" class="filtro-input">
                                            <option value="todos">Todas</option>
                                            <!-- Se cargará dinámicamente -->
                                        </select>
                                    </div>
                                    <div class="filtro-acciones">
                                        <button id="btn-aplicar-filtros" class="btn-primary">Aplicar</button>
                                        <button id="btn-limpiar-filtros" class="btn-secondary">Limpiar</button>
                                    </div>
                                </div>
                            </div>
                            
                            <div class="ventas-resultados">
                                <div class="resultados-header">
                                    <div class="resultados-info">
                                        <span id="total-resultados">0 ventas encontradas</span>
                                        <span id="total-monto">Total: $0.00</span>
                                    </div>
                                    <div class="resultados-acciones">
                                        <label for="items-por-pagina">Mostrar:</label>
                                        <select id="items-por-pagina">
                                            <option value="25">25</option>
                                            <option value="50">50</option>
                                            <option value="100">100</option>
                                            <option value="200">200</option>
                                        </select>
                                    </div>
                                </div>
                                
                                <div class="resultados-tabla-container">
                                    <table id="tabla-ventas" class="tabla-datos">
                                        <thead>
                                            <tr>
                                                <th data-sort="numero">Número</th>
                                                <th data-sort="fecha">Fecha</th>
                                                <th data-sort="tipo">Tipo</th>
                                                <th data-sort="cliente">Cliente</th>
                                                <th data-sort="metodoPago">Forma de Pago</th>
                                                <th data-sort="usuario">Usuario</th>
                                                <th data-sort="sucursal">Sucursal</th>
                                                <th data-sort="total" class="text-right">Total</th>
                                                <th class="acciones">Acciones</th>
                                            </tr>
                                        </thead>
                                        <tbody id="ventas-tbody">
                                            <!-- Se cargará dinámicamente -->
                                            <tr>
                                                <td colspan="9" class="text-center">Cargando ventas...</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                                
                                <div class="paginacion">
                                    <button id="btn-pagina-anterior" class="btn-icon" disabled>
                                        <i class="fas fa-chevron-left"></i>
                                    </button>
                                    <span id="info-paginacion">Página 1 de 1</span>
                                    <button id="btn-pagina-siguiente" class="btn-icon" disabled>
                                        <i class="fas fa-chevron-right"></i>
                                    </button>
                                </div>
                            </div>
                        </div>
                        
                        <!-- Tab Estadísticas -->
                        <div id="tab-estadisticas" class="tab-pane">
                            <div class="estadisticas-periodos">
                                <button class="btn-periodo active" data-periodo="dia">Hoy</button>
                                <button class="btn-periodo" data-periodo="semana">Esta Semana</button>
                                <button class="btn-periodo" data-periodo="mes">Este Mes</button>
                                <button class="btn-periodo" data-periodo="anio">Este Año</button>
                                <button class="btn-periodo" data-periodo="personalizado">Personalizado</button>
                            </div>
                            
                            <div class="estadisticas-custom-periodo" style="display: none;">
                                <div class="filtro-grupo">
                                    <label for="estadisticas-fecha-inicio">Desde:</label>
                                    <input type="date" id="estadisticas-fecha-inicio">
                                </div>
                                <div class="filtro-grupo">
                                    <label for="estadisticas-fecha-fin">Hasta:</label>
                                    <input type="date" id="estadisticas-fecha-fin">
                                </div>
                                <button id="btn-aplicar-periodo" class="btn-primary">Aplicar</button>
                            </div>
                            
                            <div class="estadisticas-cards">
                                <div class="estadistica-card">
                                    <div class="card-titulo">Total Ventas</div>
                                    <div class="card-valor" id="total-ventas-valor">$0.00</div>
                                    <div class="card-comparacion" id="total-ventas-comparacion">0% vs periodo anterior</div>
                                </div>
                                <div class="estadistica-card">
                                    <div class="card-titulo">Cantidad de Facturas</div>
                                    <div class="card-valor" id="cantidad-facturas">0</div>
                                    <div class="card-comparacion" id="cantidad-facturas-comparacion">0% vs periodo anterior</div>
                                </div>
                                <div class="estadistica-card">
                                    <div class="card-titulo">Ticket Promedio</div>
                                    <div class="card-valor" id="ticket-promedio">$0.00</div>
                                    <div class="card-comparacion" id="ticket-promedio-comparacion">0% vs periodo anterior</div>
                                </div>
                                <div class="estadistica-card">
                                    <div class="card-titulo">Forma de Pago Principal</div>
                                    <div class="card-valor" id="forma-pago-principal">-</div>
                                    <div class="card-dato-secundario" id="forma-pago-porcentaje">0%</div>
                                </div>
                            </div>
                            
                            <div class="estadisticas-graficos">
                                <div class="grafico-container">
                                    <h3>Ventas por Día</h3>
                                    <canvas id="grafico-ventas-diarias"></canvas>
                                </div>
                                <div class="grafico-container">
                                    <h3>Distribución por Forma de Pago</h3>
                                    <canvas id="grafico-forma-pago"></canvas>
                                </div>
                            </div>
                            
                            <div class="estadisticas-tablas">
                                <div class="tabla-container">
                                    <h3>Top Productos Vendidos</h3>
                                    <table class="tabla-datos" id="tabla-top-productos">
                                        <thead>
                                            <tr>
                                                <th>Producto</th>
                                                <th>Cantidad</th>
                                                <th class="text-right">Total</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <!-- Se cargará dinámicamente -->
                                        </tbody>
                                    </table>
                                </div>
                                <div class="tabla-container">
                                    <h3>Clientes Frecuentes</h3>
                                    <table class="tabla-datos" id="tabla-clientes-frecuentes">
                                        <thead>
                                            <tr>
                                                <th>Cliente</th>
                                                <th>Compras</th>
                                                <th class="text-right">Total</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <!-- Se cargará dinámicamente -->
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                        
                        <!-- Tab Reportes -->
                        <div id="tab-reportes" class="tab-pane">
                            <div class="reportes-tipos">
                                <div class="reporte-tipo-card" data-reporte="ventas_diarias">
                                    <i class="fas fa-chart-line"></i>
                                    <h4>Ventas Diarias</h4>
                                    <p>Reporte detallado de ventas por día, tipo de comprobante y forma de pago.</p>
                                </div>
                                <div class="reporte-tipo-card" data-reporte="ventas_por_producto">
                                    <i class="fas fa-box"></i>
                                    <h4>Ventas por Producto</h4>
                                    <p>Análisis de productos vendidos, cantidades y montos.</p>
                                </div>
                                <div class="reporte-tipo-card" data-reporte="ventas_por_cliente">
                                    <i class="fas fa-users"></i>
                                    <h4>Ventas por Cliente</h4>
                                    <p>Detalle de ventas agrupadas por cliente.</p>
                                </div>
                                <div class="reporte-tipo-card" data-reporte="comparativa_sucursales">
                                    <i class="fas fa-store"></i>
                                    <h4>Comparativa Sucursales</h4>
                                    <p>Análisis comparativo entre sucursales.</p>
                                </div>
                                <div class="reporte-tipo-card" data-reporte="iva_ventas">
                                    <i class="fas fa-file-invoice-dollar"></i>
                                    <h4>IVA Ventas</h4>
                                    <p>Reporte para declaración fiscal de IVA en ventas.</p>
                                </div>
                                <div class="reporte-tipo-card" data-reporte="personalizado">
                                    <i class="fas fa-sliders-h"></i>
                                    <h4>Reporte Personalizado</h4>
                                    <p>Crea un reporte ajustado a tus necesidades específicas.</p>
                                </div>
                            </div>
                            
                            <div id="reporte-config" class="reporte-config" style="display: none;">
                                <!-- Se cargará dinámicamente según el tipo de reporte seleccionado -->
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    } catch (error) {
        console.error('Error al cargar la vista de ventas:', error);
        return `<div class="error-container">Error al cargar la vista: ${error.message}</div>`;
    }
}

/**
 * Inicializa las referencias a los elementos del DOM
 */
function initDOMElements() {
    elements = {
        // Botones principales
        btnNuevaVenta: document.getElementById('btn-nueva-venta'),
        btnExportar: document.getElementById('btn-exportar'),
        btnRefresh: document.getElementById('btn-refresh'),
        
        // Tabs
        tabItems: document.querySelectorAll('.tab-item'),
        tabPanes: document.querySelectorAll('.tab-pane'),
        
        // Filtros
        fechaInicio: document.getElementById('fecha-inicio'),
        fechaFin: document.getElementById('fecha-fin'),
        tipoComprobante: document.getElementById('tipo-comprobante'),
        metodoPago: document.getElementById('metodo-pago'),
        cliente: document.getElementById('cliente'),
        usuario: document.getElementById('usuario'),
        sucursal: document.getElementById('sucursal'),
        btnAplicarFiltros: document.getElementById('btn-aplicar-filtros'),
        btnLimpiarFiltros: document.getElementById('btn-limpiar-filtros'),
        
        // Tabla y paginación
        tablaVentas: document.getElementById('tabla-ventas'),
        ventasTbody: document.getElementById('ventas-tbody'),
        totalResultados: document.getElementById('total-resultados'),
        totalMonto: document.getElementById('total-monto'),
        itemsPorPagina: document.getElementById('items-por-pagina'),
        btnPaginaAnterior: document.getElementById('btn-pagina-anterior'),
        btnPaginaSiguiente: document.getElementById('btn-pagina-siguiente'),
        infoPaginacion: document.getElementById('info-paginacion'),
        
        // Estadísticas
        botonesEstadisticas: document.querySelectorAll('.btn-periodo'),
        estadisticasCustomPeriodo: document.querySelector('.estadisticas-custom-periodo'),
        estadisticasFechaInicio: document.getElementById('estadisticas-fecha-inicio'),
        estadisticasFechaFin: document.getElementById('estadisticas-fecha-fin'),
        btnAplicarPeriodo: document.getElementById('btn-aplicar-periodo'),
        
        // Cards de estadísticas
        totalVentasValor: document.getElementById('total-ventas-valor'),
        totalVentasComparacion: document.getElementById('total-ventas-comparacion'),
        cantidadFacturas: document.getElementById('cantidad-facturas'),
        cantidadFacturasComparacion: document.getElementById('cantidad-facturas-comparacion'),
        ticketPromedio: document.getElementById('ticket-promedio'),
        ticketPromedioComparacion: document.getElementById('ticket-promedio-comparacion'),
        formaPagoPrincipal: document.getElementById('forma-pago-principal'),
        formaPagoPorcentaje: document.getElementById('forma-pago-porcentaje'),
        
        // Gráficos
        graficoVentasDiarias: document.getElementById('grafico-ventas-diarias'),
        graficoFormaPago: document.getElementById('grafico-forma-pago'),
        
        // Tablas de estadísticas
        tablaTopProductos: document.getElementById('tabla-top-productos'),
        tablaClientesFrecuentes: document.getElementById('tabla-clientes-frecuentes'),
        
        // Reportes
        reporteTipoCards: document.querySelectorAll('.reporte-tipo-card'),
        reporteConfig: document.getElementById('reporte-config')
    };
    
    // Inicializar fechas con los valores por defecto
    elements.fechaInicio.value = state.filtros.fechaInicio;
    elements.fechaFin.value = state.filtros.fechaFin;
    elements.estadisticasFechaInicio.value = state.filtros.fechaInicio;
    elements.estadisticasFechaFin.value = state.filtros.fechaFin;
}

/**
 * Registra los eventos para los elementos del DOM
 */
function registerEvents() {
    // Botones principales
    elements.btnNuevaVenta.addEventListener('click', onNuevaVenta);
    elements.btnExportar.addEventListener('click', onExportar);
    elements.btnRefresh.addEventListener('click', refreshVentas);
    
    // Tabs
    elements.tabItems.forEach(tab => {
        tab.addEventListener('click', onTabClick);
    });
    
    // Filtros
    elements.btnAplicarFiltros.addEventListener('click', aplicarFiltros);
    elements.btnLimpiarFiltros.addEventListener('click', limpiarFiltros);
    
    // Tabla y ordenamiento
    const thOrdenables = elements.tablaVentas.querySelectorAll('th[data-sort]');
    thOrdenables.forEach(th => {
        th.addEventListener('click', () => ordenarTabla(th.dataset.sort));
    });
    
    // Paginación
    elements.itemsPorPagina.addEventListener('change', cambiarItemsPorPagina);
    elements.btnPaginaAnterior.addEventListener('click', irPaginaAnterior);
    elements.btnPaginaSiguiente.addEventListener('click', irPaginaSiguiente);
    
    // Estadísticas
    elements.botonesEstadisticas.forEach(btn => {
        btn.addEventListener('click', (e) => cambiarPeriodoEstadisticas(e.target.dataset.periodo));
    });
    elements.btnAplicarPeriodo.addEventListener('click', aplicarPeriodoPersonalizado);
    
    // Reportes
    elements.reporteTipoCards.forEach(card => {
        card.addEventListener('click', () => seleccionarTipoReporte(card.dataset.reporte));
    });
}

/**
 * Carga los datos iniciales necesarios para el módulo
 */
async function loadInitialData() {
    try {
        state.cargando = true;
        updateLoadingState();
        
        // Cargar datos de sucursales
        state.sucursales = await database.obtenerSucursales();
        populateSelect(elements.sucursal, state.sucursales, {
            valueField: 'id',
            textField: 'nombre',
            defaultOption: { id: 'todos', nombre: 'Todas' }
        });
        
        // Cargar datos de usuarios
        state.usuarios = await database.obtenerUsuarios();
        populateSelect(elements.usuario, state.usuarios, {
            valueField: 'id',
            textField: 'nombre',
            defaultOption: { id: 'todos', nombre: 'Todos' }
        });
        
        // Cargar ventas
        await refreshVentas();
        
        // Cargar datos para estadísticas
        await loadEstadisticasData('mes'); // Por defecto cargamos estadísticas del mes actual
        
    } catch (error) {
        console.error('Error al cargar datos iniciales:', error);
        notifications.show({
            type: 'error',
            message: 'Error al cargar datos: ' + error.message,
            duration: 5000
        });
    } finally {
        state.cargando = false;
        updateLoadingState();
    }
}

/**
 * Actualiza la visualización según el estado de carga
 */
function updateLoadingState() {
    if (state.cargando) {
        elements.ventasTbody.innerHTML = `
            <tr>
                <td colspan="9" class="text-center">
                    <div class="loading-spinner"></div>
                    <p>Cargando ventas...</p>
                </td>
            </tr>
        `;
        // Deshabilitar botones de acción
        elements.btnAplicarFiltros.disabled = true;
        elements.btnExportar.disabled = true;
    } else {
        // Habilitar botones de acción
        elements.btnAplicarFiltros.disabled = false;
        elements.btnExportar.disabled = false;
    }
}

/**
 * Refresca la lista de ventas según los filtros actuales
 */
async function refreshVentas() {
    try {
        state.cargando = true;
        updateLoadingState();
        
        // Obtener ventas según filtros
        const resultado = await database.obtenerVentas({
            fechaInicio: state.filtros.fechaInicio,
            fechaFin: state.filtros.fechaFin,
            tipoComprobante: state.filtros.tipoComprobante !== 'todos' ? state.filtros.tipoComprobante : null,
            metodoPago: state.filtros.metodoPago !== 'todos' ? state.filtros.metodoPago : null,
            cliente: state.filtros.cliente || null,
            usuario: state.filtros.usuario !== 'todos' ? state.filtros.usuario : null,
            sucursal: state.filtros.sucursal !== 'todos' ? state.filtros.sucursal : null
        });
        
        state.ventas = resultado.ventas || [];
        state.totalVentas = resultado.total || 0;
        
        // Aplicar ordenamiento
        ordenarVentas();
        
        // Actualizar la tabla
        renderizarTabla();
        
        // Actualizar información de resultados
        actualizarInfoResultados();
        
    } catch (error) {
        console.error('Error al obtener ventas:', error);
        notifications.show({
            type: 'error',
            message: 'Error al cargar ventas: ' + error.message,
            duration: 5000
        });
    } finally {
        state.cargando = false;
        updateLoadingState();
    }
}

/**
 * Aplica los filtros ingresados por el usuario
 */
async function aplicarFiltros() {
    // Actualizar el estado con los valores de los filtros
    state.filtros = {
        fechaInicio: elements.fechaInicio.value,
        fechaFin: elements.fechaFin.value,
        tipoComprobante: elements.tipoComprobante.value,
        metodoPago: elements.metodoPago.value,
        cliente: elements.cliente.value,
        usuario: elements.usuario.value,
        sucursal: elements.sucursal.value
    };
    
    // Resetear la paginación
    state.paginacion.paginaActual = 1;
    
    // Refrescar las ventas con los nuevos filtros
    await refreshVentas();
}

/**
 * Limpia todos los filtros a sus valores predeterminados
 */
async function limpiarFiltros() {
    // Restaurar valores predeterminados en los elementos del DOM
    elements.fechaInicio.value = config.filtrosPredeterminados.fechaInicio;
    elements.fechaFin.value = config.filtrosPredeterminados.fechaFin;
    elements.tipoComprobante.value = config.filtrosPredeterminados.tipoComprobante;
    elements.metodoPago.value = config.filtrosPredeterminados.metodoPago;
    elements.cliente.value = config.filtrosPredeterminados.cliente;
    elements.usuario.value = config.filtrosPredeterminados.usuario;
    elements.sucursal.value = config.filtrosPredeterminados.sucursal;
    
    // Actualizar el estado con los valores predeterminados
    state.filtros = { ...config.filtrosPredeterminados };
    
    // Resetear la paginación
    state.paginacion.paginaActual = 1;
    
    // Refrescar las ventas con los filtros predeterminados
    await refreshVentas();
}

/**
 * Ordena las ventas según el criterio de ordenamiento actual
 */
function ordenarVentas() {
    const { campo, direccion } = state.ordenamiento;
    
    state.ventas.sort((a, b) => {
        let valorA, valorB;
        
        // Determinar los valores a comparar según el campo
        switch (campo) {
            case 'numero':
                valorA = parseInt(a.numero.replace(/\D/g, ''));
                valorB = parseInt(b.numero.replace(/\D/g, ''));
                break;
            case 'fecha':
                valorA = new Date(a.fecha).getTime();
                valorB = new Date(b.fecha).getTime();
                break;
            case 'total':
                valorA = parseFloat(a.total);
                valorB = parseFloat(b.total);
                break;
            default:
                valorA = a[campo]?.toLowerCase?.() || '';
                valorB = b[campo]?.toLowerCase?.() || '';
        }
        
        // Comparar los valores según la dirección
        if (direccion === 'asc') {
            return valorA > valorB ? 1 : -1;
        } else {
            return valorA < valorB ? 1 : -1;
        }
    });
}

/**
 * Cambia el criterio de ordenamiento de la tabla
 * @param {string} campo - Campo por el cual ordenar
 */
function ordenarTabla(campo) {
    // Si es el mismo campo, cambiar la dirección
    if (state.ordenamiento.campo === campo) {
        state.ordenamiento.direccion = state.ordenamiento.direccion === 'asc' ? 'desc' : 'asc';
    } else {
        // Si es un campo distinto, establecer el campo y dirección descendente por defecto
        state.ordenamiento.campo = campo;
        state.ordenamiento.direccion = 'desc';
    }
    
    // Actualizar visuales de ordenamiento
    actualizarIndicadoresOrdenamiento();
    
    // Ordenar y renderizar
    ordenarVentas();
    renderizarTabla();
}

/**
 * Actualiza los indicadores visuales de ordenamiento en la tabla
 */
function actualizarIndicadoresOrdenamiento() {
    // Eliminar clases de ordenamiento de todos los encabezados
    const headers = elements.tablaVentas.querySelectorAll('th[data-sort]');
    headers.forEach(header => {
        header.classList.remove('sort-asc', 'sort-desc');
    });
    
    // Añadir clase al encabezado activo
    const headerActivo = elements.tablaVentas.querySelector(`th[data-sort="${state.ordenamiento.campo}"]`);
    if (headerActivo) {
        headerActivo.classList.add(`sort-${state.ordenamiento.direccion}`);
    }
}

/**
 * Renderiza la tabla de ventas con paginación
 */
function renderizarTabla() {
    // Calcular índices de inicio y fin para la paginación
    const { paginaActual, itemsPorPagina } = state.paginacion;
    const inicio = (paginaActual - 1) * itemsPorPagina;
    const fin = Math.min(inicio + itemsPorPagina, state.ventas.length);
    
    // Obtener las ventas a mostrar en la página actual
    const ventasMostrar = state.ventas.slice(inicio, fin);
    
    // Generar HTML de las filas
    if (ventasMostrar.length === 0) {
        elements.ventasTbody.innerHTML = `
            <tr>
                <td colspan="9" class="text-center">No se encontraron ventas con los filtros aplicados</td>
            </tr>
        `;
    } else {
        elements.ventasTbody.innerHTML = ventasMostrar.map(venta => `
            <tr data-id="${venta.id}">
                <td>${venta.numero}</td>
                <td>${formatearFecha(venta.fecha)}</td>
                <td>
                    <span class="badge badge-${getTipoComprobanteClass(venta.tipo)}">
                        ${getTipoComprobanteNombre(venta.tipo)}
                    </span>
                </td>
                <td>${venta.cliente || 'Consumidor Final'}</td>
                <td>
                    <span class="badge badge-${getMetodoPagoClass(venta.metodoPago)}">
                        ${getMetodoPagoNombre(venta.metodoPago)}
                    </span>
                </td>
                <td>${venta.usuario}</td>
                <td>${venta.sucursal}</td>
                <td class="text-right">$${formatearNumero(venta.total)}</td>
                <td class="acciones">
                    <button class="btn-icon ver-venta" title="Ver detalle">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button class="btn-icon imprimir-venta" title="Imprimir">
                        <i class="fas fa-print"></i>
                    </button>
                    <button class="btn-icon enviar-venta" title="Enviar">
                        <i class="fas fa-share-alt"></i>
                    </button>
                    ${venta.tipo === 'P' ? `
                        <button class="btn-icon facturar-presupuesto" title="Convertir a Factura">
                            <i class="fas fa-file-invoice-dollar"></i>
                        </button>
                    ` : ''}
                </td>
            </tr>
        `).join('');
        
        // Añadir eventos a los botones de acción
        addActionButtonsEvents();
    }
    
    // Actualizar información de paginación
    actualizarPaginacion();
}

/**
 * Añade eventos a los botones de acción de cada fila
 */
function addActionButtonsEvents() {
    // Botones Ver Detalle
    const botonesVer = elements.ventasTbody.querySelectorAll('.ver-venta');
    botonesVer.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.target.closest('tr').dataset.id;
            verDetalleVenta(id);
        });
    });
    
    // Botones Imprimir
    const botonesImprimir = elements.ventasTbody.querySelectorAll('.imprimir-venta');
    botonesImprimir.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.target.closest('tr').dataset.id;
            imprimirVenta(id);
        });
    });
    
    // Botones Enviar
    const botonesEnviar = elements.ventasTbody.querySelectorAll('.enviar-venta');
    botonesEnviar.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.target.closest('tr').dataset.id;
            enviarVenta(id);
        });
    });
    
    // Botones Facturar Presupuesto
    const botonesFacturar = elements.ventasTbody.querySelectorAll('.facturar-presupuesto');
    botonesFacturar.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.target.closest('tr').dataset.id;
            facturarPresupuesto(id);
        });
    });
}

/**
 * Actualiza la información de paginación
 */
function actualizarPaginacion() {
    const { paginaActual, itemsPorPagina } = state.paginacion;
    const totalPaginas = Math.ceil(state.ventas.length / itemsPorPagina) || 1;
    
    // Actualizar texto de paginación
    elements.infoPaginacion.textContent = `Página ${paginaActual} de ${totalPaginas}`;
    
    // Habilitar/deshabilitar botones de navegación
    elements.btnPaginaAnterior.disabled = paginaActual <= 1;
    elements.btnPaginaSiguiente.disabled = paginaActual >= totalPaginas;
}

/**
 * Actualiza la información de resultados (cantidad y total)
 */
function actualizarInfoResultados() {
    // Calcular total monetario
    const totalMonetario = state.ventas.reduce((acc, venta) => acc + parseFloat(venta.total), 0);
    
    // Actualizar elementos
    elements.totalResultados.textContent = `${state.ventas.length} ventas encontradas`;
    elements.totalMonto.textContent = `Total: $${formatearNumero(totalMonetario)}`;
}

/**
 * Cambia la cantidad de ítems por página
 */
function cambiarItemsPorPagina() {
    state.paginacion.itemsPorPagina = parseInt(elements.itemsPorPagina.value);
    state.paginacion.paginaActual = 1; // Resetear a primera página
    renderizarTabla();
}

/**
 * Navega a la página anterior
 */
function irPaginaAnterior() {
    if (state.paginacion.paginaActual > 1) {
        state.paginacion.paginaActual--;
        renderizarTabla();
    }
}

/**
 * Navega a la página siguiente
 */
function irPaginaSiguiente() {
    const totalPaginas = Math.ceil(state.ventas.length / state.paginacion.itemsPorPagina) || 1;
    if (state.paginacion.paginaActual < totalPaginas) {
        state.paginacion.paginaActual++;
        renderizarTabla();
    }
}

/**
 * Maneja el click en las pestañas
 * @param {Event} event 
 */
function onTabClick(event) {
    const tabId = event.target.dataset.tab;
    
    // Actualizar clases activas en tabs
    elements.tabItems.forEach(tab => {
        tab.classList.remove('active');
    });
    event.target.classList.add('active');
    
    // Actualizar contenido visible
    elements.tabPanes.forEach(pane => {
        pane.classList.remove('active');
    });
    document.getElementById(`tab-${tabId}`).classList.add('active');
    
    // Ejecutar acciones específicas según la pestaña
    switch (tabId) {
        case 'estadisticas':
            loadEstadisticasData('mes');
            break;
        case 'reportes':
            // Inicializar vista de reportes
            break;
    }
}

/**
 * Llena un select con opciones de un array de objetos
 * @param {HTMLSelectElement} selectElement - Elemento select a llenar
 * @param {Array} data - Datos para las opciones
 * @param {Object} options - Opciones de configuración
 */
function populateSelect(selectElement, data, options = {}) {
    const { valueField = 'id', textField = 'nombre', defaultOption = null } = options;
    
    // Limpiar opciones actuales
    selectElement.innerHTML = '';
    
    // Añadir opción predeterminada si existe
    if (defaultOption) {
        const option = document.createElement('option');
        option.value = defaultOption[valueField];
        option.textContent = defaultOption[textField];
        selectElement.appendChild(option);
    }
    
    // Añadir opciones de los datos
    data.forEach(item => {
        const option = document.createElement('option');
        option.value = item[valueField];
        option.textContent = item[textField];
        selectElement.appendChild(option);
    });
}

/**
 * Muestra el detalle de una venta
 * @param {string} id - ID de la venta
 */
async function verDetalleVenta(id) {
    try {
        // Mostrar loading
        notifications.show({
            type: 'info',
            message: 'Cargando detalle de venta...',
            duration: 2000
        });
        
        // Obtener detalle de la venta
        const venta = await database.obtenerVentaDetalle(id);
        
        // Crear una nueva pestaña en el dashboard principal con el detalle
        tabs.open({
            id: `venta-${id}`,
            title: `Venta ${venta.numero}`,
            content: await renderDetalleVenta(venta),
            closable: true
        });
        
    } catch (error) {
        console.error('Error al obtener detalle de venta:', error);
        notifications.show({
            type: 'error',
            message: 'Error al cargar detalle: ' + error.message,
            duration: 5000
        });
    }
}

/**
 * Renderiza el HTML para el detalle de una venta
 * @param {Object} venta - Datos de la venta
 * @returns {string} HTML del detalle
 */
async function renderDetalleVenta(venta) {
    // Formato de fecha y hora legible
    const fechaFormateada = formatearFecha(venta.fecha);
    const horaFormateada = formatearHora(venta.fecha);
    
    return `
        <div class="venta-detalle">
            <div class="detalle-header">
                <div class="detalle-titulo">
                    <h2>${getTipoComprobanteNombre(venta.tipo)} ${venta.numero}</h2>
                    <span class="detalle-fecha">${fechaFormateada} - ${horaFormateada}</span>
                </div>
                <div class="detalle-acciones">
                    <button class="btn-primary imprimir-detalle" data-id="${venta.id}">
                        <i class="fas fa-print"></i> Imprimir
                    </button>
                    <button class="btn-secondary enviar-detalle" data-id="${venta.id}">
                        <i class="fas fa-share-alt"></i> Enviar
                    </button>
                    ${venta.tipo === 'P' ? `
                        <button class="btn-success facturar-detalle" data-id="${venta.id}">
                            <i class="fas fa-file-invoice-dollar"></i> Convertir a Factura
                        </button>
                    ` : ''}
                </div>
            </div>
            
            <div class="detalle-info-panel">
                <div class="detalle-seccion">
                    <h3>Cliente</h3>
                    <div class="detalle-cliente">
                        <p><strong>${venta.cliente.nombre || 'Consumidor Final'}</strong></p>
                        ${venta.cliente.documento ? `<p>CUIT/DNI: ${venta.cliente.documento}</p>` : ''}
                        ${venta.cliente.direccion ? `<p>Dirección: ${venta.cliente.direccion}</p>` : ''}
                        ${venta.cliente.condicionIva ? `<p>Cond. IVA: ${venta.cliente.condicionIva}</p>` : ''}
                    </div>
                </div>
                
                <div class="detalle-seccion">
                    <h3>Venta</h3>
                    <div class="detalle-venta-info">
                        <p><strong>Sucursal:</strong> ${venta.sucursal}</p>
                        <p><strong>Vendedor:</strong> ${venta.usuario}</p>
                        <p><strong>Forma de Pago:</strong> ${getMetodoPagoNombre(venta.metodoPago)}</p>
                        ${venta.observaciones ? `<p><strong>Observaciones:</strong> ${venta.observaciones}</p>` : ''}
                    </div>
                </div>
            </div>
            
            <div class="detalle-items">
                <h3>Detalle de Productos</h3>
                <table class="tabla-datos">
                    <thead>
                        <tr>
                            <th>Código</th>
                            <th>Descripción</th>
                            <th class="text-center">Cantidad</th>
                            <th class="text-right">Precio Unit.</th>
                            <th class="text-right">Desc.</th>
                            <th class="text-right">Subtotal</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${venta.items.map(item => `
                            <tr>
                                <td>${item.codigo}</td>
                                <td>${item.descripcion}</td>
                                <td class="text-center">${item.cantidad}</td>
                                <td class="text-right">$${formatearNumero(item.precioUnitario)}</td>
                                <td class="text-right">${item.descuento ? `${item.descuento}%` : '-'}</td>
                                <td class="text-right">$${formatearNumero(item.subtotal)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            
            <div class="detalle-totales">
                <div class="totales-items">
                    <div class="total-item">
                        <span>Subtotal:</span>
                        <span>$${formatearNumero(venta.subtotal)}</span>
                    </div>
                    ${venta.descuento > 0 ? `
                        <div class="total-item">
                            <span>Descuento (${venta.descuentoPorcentaje}%):</span>
                            <span>-$${formatearNumero(venta.descuento)}</span>
                        </div>
                    ` : ''}
                    ${venta.recargo > 0 ? `
                        <div class="total-item">
                            <span>Recargo (${venta.recargoPorcentaje}%):</span>
                            <span>+$${formatearNumero(venta.recargo)}</span>
                        </div>
                    ` : ''}
                    ${venta.iva > 0 ? `
                        <div class="total-item">
                            <span>IVA (${venta.ivaPorcentaje}%):</span>
                            <span>$${formatearNumero(venta.iva)}</span>
                        </div>
                    ` : ''}
                    <div class="total-item total-final">
                        <span>TOTAL:</span>
                        <span>$${formatearNumero(venta.total)}</span>
                    </div>
                </div>
            </div>
            
            ${venta.pagos && venta.pagos.length > 0 ? `
                <div class="detalle-pagos">
                    <h3>Detalle de Pagos</h3>
                    <table class="tabla-datos">
                        <thead>
                            <tr>
                                <th>Forma de Pago</th>
                                <th class="text-right">Monto</th>
                                <th>Referencia</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${venta.pagos.map(pago => `
                                <tr>
                                    <td>${getMetodoPagoNombre(pago.tipo)}</td>
                                    <td class="text-right">$${formatearNumero(pago.monto)}</td>
                                    <td>${pago.referencia || '-'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            ` : ''}
        </div>
    `;
}

/**
 * Imprime una venta
 * @param {string} id - ID de la venta
 */
async function imprimirVenta(id) {
    try {
        notifications.show({
            type: 'info',
            message: 'Preparando impresión...',
            duration: 2000
        });
        
        // Obtener la venta
        const venta = await database.obtenerVentaDetalle(id);
        
        // Mostrar opciones de impresión
        mostrarOpcionesImpresion(venta);
        
    } catch (error) {
        console.error('Error al preparar impresión:', error);
        notifications.show({
            type: 'error',
            message: 'Error al preparar impresión: ' + error.message,
            duration: 5000
        });
    }
}

/**
 * Muestra un modal con las opciones de impresión
 * @param {Object} venta - Datos de la venta
 */
function mostrarOpcionesImpresion(venta) {
    // Crear el modal
    const modal = document.createElement('div');
    modal.className = 'modal-container';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>Opciones de Impresión</h3>
                <button class="btn-close">×</button>
            </div>
            <div class="modal-body">
                <div class="opciones-impresion">
                    <button class="btn-opcion-impresion" data-formato="a4">
                        <i class="fas fa-file-alt fa-3x"></i>
                        <span>Factura A4</span>
                    </button>
                    <button class="btn-opcion-impresion" data-formato="ticket">
                        <i class="fas fa-receipt fa-3x"></i>
                        <span>Ticket 58mm</span>
                    </button>
                    <button class="btn-opcion-impresion" data-formato="pdf">
                        <i class="fas fa-file-pdf fa-3x"></i>
                        <span>Guardar PDF</span>
                    </button>
                </div>
            </div>
        </div>
    `;
    
    // Añadir al DOM
    document.body.appendChild(modal);
    
    // Eventos de los botones
    modal.querySelector('.btn-close').addEventListener('click', () => {
        document.body.removeChild(modal);
    });
    
    // Opciones de impresión
    const botonesOpciones = modal.querySelectorAll('.btn-opcion-impresion');
    botonesOpciones.forEach(btn => {
        btn.addEventListener('click', async () => {
            const formato = btn.dataset.formato;
            document.body.removeChild(modal);
            
            try {
                switch (formato) {
                    case 'a4':
                        await printer.imprimirFacturaA4(venta);
                        break;
                    case 'ticket':
                        await printer.imprimirFacturaTicket(venta);
                        break;
                    case 'pdf':
                        await printer.guardarFacturaPDF(venta);
                        break;
                }
                
                notifications.show({
                    type: 'success',
                    message: `La factura se ${formato === 'pdf' ? 'guardó' : 'envió a la impresora'} correctamente`,
                    duration: 3000
                });
                
            } catch (error) {
                console.error(`Error al ${formato === 'pdf' ? 'guardar' : 'imprimir'} la factura:`, error);
                notifications.show({
                    type: 'error',
                    message: `Error al ${formato === 'pdf' ? 'guardar' : 'imprimir'} la factura: ${error.message}`,
                    duration: 5000
                });
            }
        });
    });
}

/**
 * Envía una venta por correo o WhatsApp
 * @param {string} id - ID de la venta
 */
async function enviarVenta(id) {
    try {
        notifications.show({
            type: 'info',
            message: 'Preparando envío...',
            duration: 2000
        });
        
        // Obtener la venta
        const venta = await database.obtenerVentaDetalle(id);
        
        // Mostrar opciones de envío
        mostrarOpcionesEnvio(venta);
        
    } catch (error) {
        console.error('Error al preparar envío:', error);
        notifications.show({
            type: 'error',
            message: 'Error al preparar envío: ' + error.message,
            duration: 5000
        });
    }
}

/**
 * Muestra un modal con las opciones de envío
 * @param {Object} venta - Datos de la venta
 */
function mostrarOpcionesEnvio(venta) {
    // Crear el modal
    const modal = document.createElement('div');
    modal.className = 'modal-container';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>Enviar Comprobante</h3>
                <button class="btn-close">×</button>
            </div>
            <div class="modal-body">
                <div class="opciones-envio-tabs">
                    <button class="tab-envio active" data-tab="email">
                        <i class="fas fa-envelope"></i> Email
                    </button>
                    <button class="tab-envio" data-tab="whatsapp">
                        <i class="fab fa-whatsapp"></i> WhatsApp
                    </button>
                </div>
                
                <div class="tab-envio-content active" id="tab-email">
                    <div class="form-group">
                        <label for="email-destinatario">Email:</label>
                        <input type="email" id="email-destinatario" 
                               value="${venta.cliente?.email || ''}" 
                               placeholder="correo@ejemplo.com" required>
                    </div>
                    <div class="form-group">
                        <label for="email-asunto">Asunto:</label>
                        <input type="text" id="email-asunto" 
                               value="${getTipoComprobanteNombre(venta.tipo)} ${venta.numero}" required>
                    </div>
                    <div class="form-group">
                        <label for="email-mensaje">Mensaje:</label>
                        <textarea id="email-mensaje" rows="4">Estimado cliente, adjunto el comprobante de su compra. ¡Gracias por confiar en nosotros!</textarea>
                    </div>
                    <div class="form-group">
                        <label>Formato:</label>
                        <div class="radio-options">
                            <label>
                                <input type="radio" name="email-formato" value="pdf" checked> PDF
                            </label>
                        </div>
                    </div>
                    <button class="btn-primary btn-enviar-email">
                        <i class="fas fa-paper-plane"></i> Enviar Email
                    </button>
                </div>
                
                <div class="tab-envio-content" id="tab-whatsapp" style="display: none;">
                    <div class="form-group">
                        <label for="whatsapp-numero">Número de WhatsApp:</label>
                        <input type="tel" id="whatsapp-numero" 
                               value="${venta.cliente?.telefono || ''}" 
                               placeholder="Ej: 5491123456789" required>
                    </div>
                    <div class="form-group">
                        <label for="whatsapp-mensaje">Mensaje:</label>
                        <textarea id="whatsapp-mensaje" rows="4">Hola! Te envío el comprobante de tu compra. ¡Gracias por confiar en nosotros!</textarea>
                    </div>
                    <button class="btn-primary btn-enviar-whatsapp">
                        <i class="fab fa-whatsapp"></i> Enviar WhatsApp
                    </button>
                </div>
            </div>
        </div>
    `;
    
    // Añadir al DOM
    document.body.appendChild(modal);
    
    // Eventos
    // Cerrar modal
    modal.querySelector('.btn-close').addEventListener('click', () => {
        document.body.removeChild(modal);
    });
    
    // Tabs
    const tabBotones = modal.querySelectorAll('.tab-envio');
    const tabContenidos = modal.querySelectorAll('.tab-envio-content');
    
    tabBotones.forEach(tab => {
        tab.addEventListener('click', () => {
            // Actualizar botones de tab
            tabBotones.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            // Actualizar contenidos
            tabContenidos.forEach(content => {
                content.style.display = 'none';
            });
            document.getElementById(`tab-${tab.dataset.tab}`).style.display = 'block';
        });
    });
    
    // Enviar por email
    modal.querySelector('.btn-enviar-email').addEventListener('click', async () => {
        const email = modal.querySelector('#email-destinatario').value.trim();
        const asunto = modal.querySelector('#email-asunto').value.trim();
        const mensaje = modal.querySelector('#email-mensaje').value.trim();
        const formato = modal.querySelector('input[name="email-formato"]:checked').value;
        
        // Validar email
        if (!email || !validation.isValidEmail(email)) {
            notifications.show({
                type: 'error',
                message: 'Por favor, ingrese un email válido',
                duration: 3000
            });
            return;
        }
        
        try {
            // Cerrar el modal
            document.body.removeChild(modal);
            
            // Mostrar cargando
            notifications.show({
                type: 'info',
                message: 'Enviando email...',
                duration: 2000
            });
            
            // Enviar email
            await ipcRenderer.invoke('enviar-factura-email', {
                venta,
                destinatario: email,
                asunto,
                mensaje,
                formato
            });
            
            notifications.show({
                type: 'success',
                message: 'Email enviado correctamente',
                duration: 3000
            });
            
        } catch (error) {
            console.error('Error al enviar email:', error);
            notifications.show({
                type: 'error',
                message: 'Error al enviar email: ' + error.message,
                duration: 5000
            });
        }
    });
    
/**
 * Muestra un modal con las opciones de envío (continuación)
 * @param {Object} venta - Datos de la venta
 */
function mostrarOpcionesEnvio(venta) {
    // (código previo ya incluido)
    
    // Enviar por WhatsApp
    modal.querySelector('.btn-enviar-whatsapp').addEventListener('click', async () => {
        const numero = modal.querySelector('#whatsapp-numero').value.trim();
        const mensaje = modal.querySelector('#whatsapp-mensaje').value.trim();
        
        // Validar número
        if (!numero || !validation.isValidPhone(numero)) {
            notifications.show({
                type: 'error',
                message: 'Por favor, ingrese un número de teléfono válido',
                duration: 3000
            });
            return;
        }
        
        try {
            // Cerrar el modal
            document.body.removeChild(modal);
            
            // Mostrar cargando
            notifications.show({
                type: 'info',
                message: 'Preparando WhatsApp...',
                duration: 2000
            });
            
            // Generar PDF temporal
            const pdfPath = await printer.guardarFacturaPDF(venta, true);
            
            // Construir URL de WhatsApp con el mensaje
            const mensajeEncoded = encodeURIComponent(`${mensaje}\n\n${getTipoComprobanteNombre(venta.tipo)} ${venta.numero}`);
            const whatsappUrl = `https://wa.me/${numero.replace(/\D/g, '')}?text=${mensajeEncoded}`;
            
            // Abrir WhatsApp
            await ipcRenderer.invoke('abrir-url-externa', whatsappUrl);
            
            // Después de 2 segundos, mostrar notificación para adjuntar PDF manualmente
            setTimeout(() => {
                notifications.show({
                    type: 'info',
                    message: 'Comparta manualmente el PDF generado desde WhatsApp',
                    duration: 5000
                });
                
                // Abrir carpeta con el PDF generado
                ipcRenderer.invoke('abrir-carpeta', pdfPath);
            }, 2000);
            
        } catch (error) {
            console.error('Error al enviar por WhatsApp:', error);
            notifications.show({
                type: 'error',
                message: 'Error al enviar por WhatsApp: ' + error.message,
                duration: 5000
            });
        }
    });
}

/**
 * Convierte un presupuesto en factura
 * @param {string} id - ID del presupuesto
 */
async function facturarPresupuesto(id) {
    try {
        notifications.show({
            type: 'info',
            message: 'Preparando conversión a factura...',
            duration: 2000
        });
        
        // Obtener el presupuesto
        const presupuesto = await database.obtenerVentaDetalle(id);
        
        // Verificar que sea un presupuesto
        if (presupuesto.tipo !== 'P') {
            throw new Error('Solo se pueden convertir presupuestos a facturas');
        }
        
        // Mostrar modal de conversión
        mostrarModalConversionFactura(presupuesto);
        
    } catch (error) {
        console.error('Error al preparar conversión:', error);
        notifications.show({
            type: 'error',
            message: 'Error: ' + error.message,
            duration: 5000
        });
    }
}

/**
 * Muestra un modal para convertir presupuesto a factura
 * @param {Object} presupuesto - Datos del presupuesto
 */
function mostrarModalConversionFactura(presupuesto) {
    // Crear el modal
    const modal = document.createElement('div');
    modal.className = 'modal-container';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>Convertir Presupuesto a Factura</h3>
                <button class="btn-close">×</button>
            </div>
            <div class="modal-body">
                <div class="presupuesto-info">
                    <p><strong>Presupuesto:</strong> ${presupuesto.numero}</p>
                    <p><strong>Cliente:</strong> ${presupuesto.cliente.nombre || 'Consumidor Final'}</p>
                    <p><strong>Fecha:</strong> ${formatearFecha(presupuesto.fecha)}</p>
                    <p><strong>Total:</strong> $${formatearNumero(presupuesto.total)}</p>
                </div>
                
                <div class="form-conversion">
                    <div class="form-group">
                        <label for="tipo-factura">Tipo de Factura:</label>
                        <select id="tipo-factura" class="form-input">
                            <option value="B">Factura B</option>
                            <option value="A">Factura A</option>
                            <option value="C">Factura C</option>
                            <option value="X">Factura X</option>
                        </select>
                    </div>
                    
                    <div class="form-group">
                        <label for="forma-pago">Forma de Pago:</label>
                        <select id="forma-pago" class="form-input">
                            <option value="efectivo">Efectivo</option>
                            <option value="tarjeta_debito">Tarjeta Débito</option>
                            <option value="tarjeta_credito">Tarjeta Crédito</option>
                            <option value="transferencia">Transferencia</option>
                            <option value="mercadopago">Mercado Pago</option>
                            <option value="multiple">Pago Mixto</option>
                        </select>
                    </div>
                    
                    <div id="detalle-pago-multiple" style="display: none;">
                        <!-- Se cargará dinámicamente si se selecciona pago mixto -->
                    </div>
                    
                    <div class="form-group">
                        <label for="observaciones-factura">Observaciones:</label>
                        <textarea id="observaciones-factura" class="form-input" rows="3">${presupuesto.observaciones || ''}</textarea>
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn-secondary" id="btn-cancelar-conversion">Cancelar</button>
                <button class="btn-primary" id="btn-confirmar-conversion">Crear Factura</button>
            </div>
        </div>
    `;
    
    // Añadir al DOM
    document.body.appendChild(modal);
    
    // Referenciar elementos
    const selectFormaPago = modal.querySelector('#forma-pago');
    const detallePagoMultiple = modal.querySelector('#detalle-pago-multiple');
    
    // Mostrar/ocultar detalle de pago múltiple
    selectFormaPago.addEventListener('change', () => {
        if (selectFormaPago.value === 'multiple') {
            detallePagoMultiple.style.display = 'block';
            detallePagoMultiple.innerHTML = `
                <h4>Detalle de Pagos</h4>
                <div class="pagos-multiple">
                    <div class="pago-item">
                        <select class="pago-tipo form-input">
                            <option value="efectivo">Efectivo</option>
                            <option value="tarjeta_debito">Tarjeta Débito</option>
                            <option value="tarjeta_credito">Tarjeta Crédito</option>
                            <option value="transferencia">Transferencia</option>
                            <option value="mercadopago">Mercado Pago</option>
                        </select>
                        <input type="number" class="pago-monto form-input" placeholder="Monto" step="0.01" min="0" value="${presupuesto.total}">
                        <input type="text" class="pago-referencia form-input" placeholder="Referencia/Últimos 4 dígitos">
                        <button class="btn-icon btn-agregar-pago"><i class="fas fa-plus"></i></button>
                    </div>
                </div>
                <div class="pagos-total">
                    <span>Total de Pagos:</span>
                    <span class="pagos-total-valor">$${formatearNumero(presupuesto.total)}</span>
                    <span class="pagos-diferencia"></span>
                </div>
            `;
            
            // Botón para agregar otro método de pago
            modal.querySelector('.btn-agregar-pago').addEventListener('click', agregarNuevoMetodoPago);
            
            // Actualizar total de pagos cuando cambie algún monto
            const actualizarTotalPagos = () => {
                const montos = Array.from(detallePagoMultiple.querySelectorAll('.pago-monto')).map(input => parseFloat(input.value) || 0);
                const totalPagos = montos.reduce((acc, monto) => acc + monto, 0);
                
                detallePagoMultiple.querySelector('.pagos-total-valor').textContent = `$${formatearNumero(totalPagos)}`;
                
                const diferencia = totalPagos - presupuesto.total;
                const diferenciaElement = detallePagoMultiple.querySelector('.pagos-diferencia');
                
                if (Math.abs(diferencia) < 0.01) {
                    diferenciaElement.textContent = '';
                    diferenciaElement.className = 'pagos-diferencia';
                } else if (diferencia > 0) {
                    diferenciaElement.textContent = `(Sobra $${formatearNumero(diferencia)})`;
                    diferenciaElement.className = 'pagos-diferencia text-warning';
                } else {
                    diferenciaElement.textContent = `(Falta $${formatearNumero(Math.abs(diferencia))})`;
                    diferenciaElement.className = 'pagos-diferencia text-error';
                }
            };
            
            // Escuchar cambios en los montos
            detallePagoMultiple.addEventListener('input', (e) => {
                if (e.target.classList.contains('pago-monto')) {
                    actualizarTotalPagos();
                }
            });
            
        } else {
            detallePagoMultiple.style.display = 'none';
        }
    });
    
    /**
     * Agrega un nuevo método de pago al formulario
     */
    function agregarNuevoMetodoPago() {
        const pagosContainer = detallePagoMultiple.querySelector('.pagos-multiple');
        const nuevoPago = document.createElement('div');
        nuevoPago.className = 'pago-item';
        nuevoPago.innerHTML = `
            <select class="pago-tipo form-input">
                <option value="efectivo">Efectivo</option>
                <option value="tarjeta_debito">Tarjeta Débito</option>
                <option value="tarjeta_credito">Tarjeta Crédito</option>
                <option value="transferencia">Transferencia</option>
                <option value="mercadopago">Mercado Pago</option>
            </select>
            <input type="number" class="pago-monto form-input" placeholder="Monto" step="0.01" min="0" value="0">
            <input type="text" class="pago-referencia form-input" placeholder="Referencia/Últimos 4 dígitos">
            <button class="btn-icon btn-eliminar-pago"><i class="fas fa-trash"></i></button>
        `;
        
        // Botón para eliminar este método de pago
        nuevoPago.querySelector('.btn-eliminar-pago').addEventListener('click', () => {
            pagosContainer.removeChild(nuevoPago);
            // Actualizar el total después de eliminar
            const event = new Event('input');
            detallePagoMultiple.querySelector('.pago-monto').dispatchEvent(event);
        });
        
        pagosContainer.appendChild(nuevoPago);
    }
    
    // Eventos
    // Cerrar modal
    modal.querySelector('.btn-close').addEventListener('click', () => {
        document.body.removeChild(modal);
    });
    
    // Cancelar
    modal.querySelector('#btn-cancelar-conversion').addEventListener('click', () => {
        document.body.removeChild(modal);
    });
    
    // Confirmar conversión
    modal.querySelector('#btn-confirmar-conversion').addEventListener('click', async () => {
        try {
            const tipoFactura = modal.querySelector('#tipo-factura').value;
            const formaPago = modal.querySelector('#forma-pago').value;
            const observaciones = modal.querySelector('#observaciones-factura').value;
            
            let pagos = [];
            
            // Si es pago múltiple, recopilar la información de cada método
            if (formaPago === 'multiple') {
                const pagosItems = detallePagoMultiple.querySelectorAll('.pago-item');
                
                pagos = Array.from(pagosItems).map(item => {
                    return {
                        tipo: item.querySelector('.pago-tipo').value,
                        monto: parseFloat(item.querySelector('.pago-monto').value) || 0,
                        referencia: item.querySelector('.pago-referencia').value
                    };
                });
                
                // Verificar que el total coincida
                const totalPagos = pagos.reduce((acc, pago) => acc + pago.monto, 0);
                if (Math.abs(totalPagos - presupuesto.total) > 0.01) {
                    throw new Error('El total de pagos no coincide con el total de la factura');
                }
            } else {
                // Si es un solo método de pago
                pagos = [{
                    tipo: formaPago,
                    monto: presupuesto.total,
                    referencia: ''
                }];
            }
            
            // Cerrar el modal
            document.body.removeChild(modal);
            
            // Mostrar cargando
            notifications.show({
                type: 'info',
                message: 'Creando factura...',
                duration: 2000
            });
            
            // Convertir presupuesto a factura
            const facturaCreada = await database.convertirPresupuestoAFactura({
                presupuestoId: presupuesto.id,
                tipoFactura,
                metodoPago: formaPago,
                pagos,
                observaciones
            });
            
            // Mostrar éxito
            notifications.show({
                type: 'success',
                message: `Factura ${facturaCreada.tipo} ${facturaCreada.numero} creada correctamente`,
                duration: 3000
            });
            
            // Refrescar lista de ventas
            await refreshVentas();
            
            // Abrir detalle de la nueva factura
            verDetalleVenta(facturaCreada.id);
            
        } catch (error) {
            console.error('Error al convertir presupuesto:', error);
            notifications.show({
                type: 'error',
                message: 'Error al crear factura: ' + error.message,
                duration: 5000
            });
        }
    });
}

/**
 * Crea una nueva venta
 */
function onNuevaVenta() {
    // Redirigir al módulo de punto de venta
    ipcRenderer.send('cambiar-modulo', {
        modulo: 'punto-venta',
        params: {}
    });
}

/**
 * Muestra opciones para exportar datos de ventas
 */
function onExportar() {
    // Crear modal de exportación
    const modal = document.createElement('div');
    modal.className = 'modal-container';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>Exportar Datos de Ventas</h3>
                <button class="btn-close">×</button>
            </div>
            <div class="modal-body">
                <div class="exportar-opciones">
                    <button class="btn-opcion-exportar" data-formato="excel">
                        <i class="fas fa-file-excel fa-3x"></i>
                        <span>Excel</span>
                    </button>
                    <button class="btn-opcion-exportar" data-formato="csv">
                        <i class="fas fa-file-csv fa-3x"></i>
                        <span>CSV</span>
                    </button>
                    <button class="btn-opcion-exportar" data-formato="pdf">
                        <i class="fas fa-file-pdf fa-3x"></i>
                        <span>PDF</span>
                    </button>
                </div>
                
                <div class="exportar-opciones-adicionales">
                    <h4>Opciones de Exportación</h4>
                    
                    <div class="checkbox-group">
                        <label>
                            <input type="checkbox" id="exportar-filtradas" checked>
                            Exportar solo ventas filtradas
                        </label>
                    </div>
                    
                    <div class="checkbox-group">
                        <label>
                            <input type="checkbox" id="exportar-detalles">
                            Incluir detalles de productos
                        </label>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Añadir al DOM
    document.body.appendChild(modal);
    
    // Eventos
    // Cerrar modal
    modal.querySelector('.btn-close').addEventListener('click', () => {
        document.body.removeChild(modal);
    });
    
    // Botones de exportación
    const botonesExportar = modal.querySelectorAll('.btn-opcion-exportar');
    botonesExportar.forEach(btn => {
        btn.addEventListener('click', async () => {
            const formato = btn.dataset.formato;
            const exportarFiltradas = modal.querySelector('#exportar-filtradas').checked;
            const incluirDetalles = modal.querySelector('#exportar-detalles').checked;
            
            // Cerrar el modal
            document.body.removeChild(modal);
            
            try {
                notifications.show({
                    type: 'info',
                    message: `Preparando exportación a ${formato.toUpperCase()}...`,
                    duration: 2000
                });
                
                // Datos a exportar
                const datos = {
                    ventas: exportarFiltradas ? state.ventas : await database.obtenerTodasLasVentas(),
                    filtros: state.filtros,
                    incluirDetalles,
                    formato
                };
                
                // Exportar
                const rutaArchivo = await ipcRenderer.invoke('exportar-ventas', datos);
                
                notifications.show({
                    type: 'success',
                    message: `Datos exportados correctamente a ${formato.toUpperCase()}`,
                    duration: 3000
                });
                
                // Abrir archivo
                ipcRenderer.invoke('abrir-archivo', rutaArchivo);
                
            } catch (error) {
                console.error(`Error al exportar a ${formato}:`, error);
                notifications.show({
                    type: 'error',
                    message: `Error al exportar: ${error.message}`,
                    duration: 5000
                });
            }
        });
    });
}

/**
 * Carga datos para estadísticas según período seleccionado
 * @param {string} periodo - Período para las estadísticas (dia, semana, mes, anio, personalizado)
 */
async function loadEstadisticasData(periodo) {
    try {
        // Actualizar botones de período
        elements.botonesEstadisticas.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.periodo === periodo);
        });
        
        // Mostrar/ocultar selector de fechas personalizadas
        elements.estadisticasCustomPeriodo.style.display = periodo === 'personalizado' ? 'flex' : 'none';
        
        // Definir fechas según período
        let fechaInicio, fechaFin;
        
        switch (periodo) {
            case 'dia':
                fechaInicio = moment().startOf('day').format('YYYY-MM-DD');
                fechaFin = moment().endOf('day').format('YYYY-MM-DD');
                break;
            case 'semana':
                fechaInicio = moment().startOf('week').format('YYYY-MM-DD');
                fechaFin = moment().endOf('week').format('YYYY-MM-DD');
                break;
            case 'mes':
                fechaInicio = moment().startOf('month').format('YYYY-MM-DD');
                fechaFin = moment().endOf('month').format('YYYY-MM-DD');
                break;
            case 'anio':
                fechaInicio = moment().startOf('year').format('YYYY-MM-DD');
                fechaFin = moment().endOf('year').format('YYYY-MM-DD');
                break;
            case 'personalizado':
                fechaInicio = elements.estadisticasFechaInicio.value;
                fechaFin = elements.estadisticasFechaFin.value;
                break;
        }
        
        // Actualizar campos de fecha personalizada
        if (periodo !== 'personalizado') {
            elements.estadisticasFechaInicio.value = fechaInicio;
            elements.estadisticasFechaFin.value = fechaFin;
        }
        
        // Cargar datos de estadísticas
        const stats = await estadisticas.cargarEstadisticas(fechaInicio, fechaFin);
        
        // Actualizar cards
        elements.totalVentasValor.textContent = `$${formatearNumero(stats.totalVentas)}`;
        elements.totalVentasComparacion.textContent = `${stats.comparacion.totalVentas}% vs período anterior`;
        elements.totalVentasComparacion.className = getComparacionClass(stats.comparacion.totalVentas);
        
        elements.cantidadFacturas.textContent = stats.cantidadFacturas;
        elements.cantidadFacturasComparacion.textContent = `${stats.comparacion.cantidadFacturas}% vs período anterior`;
        elements.cantidadFacturasComparacion.className = getComparacionClass(stats.comparacion.cantidadFacturas);
        
        elements.ticketPromedio.textContent = `$${formatearNumero(stats.ticketPromedio)}`;
        elements.ticketPromedioComparacion.textContent = `${stats.comparacion.ticketPromedio}% vs período anterior`;
        elements.ticketPromedioComparacion.className = getComparacionClass(stats.comparacion.ticketPromedio);
        
        elements.formaPagoPrincipal.textContent = getMetodoPagoNombre(stats.formaPagoPrincipal);
        elements.formaPagoPorcentaje.textContent = `${stats.formaPagoPorcentaje}%`;
        
        // Renderizar gráficos
        renderizarGraficos(stats);
        
        // Llenar tablas
        llenarTablaTopProductos(stats.topProductos);
        llenarTablaClientesFrecuentes(stats.clientesFrecuentes);
        
    } catch (error) {
        console.error('Error al cargar estadísticas:', error);
        notifications.show({
            type: 'error',
            message: 'Error al cargar estadísticas: ' + error.message,
            duration: 5000
        });
    }
}

/**
 * Aplica un período personalizado para estadísticas
 */
function aplicarPeriodoPersonalizado() {
    // Validar fechas
    const fechaInicio = elements.estadisticasFechaInicio.value;
    const fechaFin = elements.estadisticasFechaFin.value;
    
    if (!fechaInicio || !fechaFin) {
        notifications.show({
            type: 'error',
            message: 'Por favor, complete ambas fechas',
            duration: 3000
        });
        return;
    }
    
    if (new Date(fechaInicio) > new Date(fechaFin)) {
        notifications.show({
            type: 'error',
            message: 'La fecha inicial no puede ser posterior a la fecha final',
            duration: 3000
        });
        return;
    }
    
    // Cargar estadísticas con período personalizado
    loadEstadisticasData('personalizado');
}

/**
 * Cambia el período para las estadísticas
 * @param {string} periodo - Nuevo período
 */
function cambiarPeriodoEstadisticas(periodo) {
    loadEstadisticasData(periodo);
}

/**
 * Renderiza los gráficos de estadísticas
 * @param {Object} stats - Datos de estadísticas
 */
function renderizarGraficos(stats) {
    // Destruir gráficos previos si existen
    if (window.graficosVentas) {
        Object.values(window.graficosVentas).forEach(grafico => {
            if (grafico) grafico.destroy();
        });
    }
    
    // Inicializar objeto para almacenar referencias a gráficos
    window.graficosVentas = {};
    
    // Gráfico de ventas diarias
    if (elements.graficoVentasDiarias) {
        const ctx = elements.graficoVentasDiarias.getContext('2d');
        window.graficosVentas.ventasDiarias = new Chart(ctx, {
            type: 'line',
            data: {
                labels: stats.ventasPorDia.map(item => item.fecha),
                datasets: [{
                    label: 'Ventas',
                    data: stats.ventasPorDia.map(item => item.total),
                    borderColor: '#4caf50',
                    backgroundColor: 'rgba(76, 175, 80, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return `$${formatearNumero(context.raw)}`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                return '$' + formatearNumero(value);
                            }
                        }
                    }
                }
            }
        });
    }
    
    // Gráfico de formas de pago
    if (elements.graficoFormaPago) {
        const ctx = elements.graficoFormaPago.getContext('2d');
        window.graficosVentas.formaPago = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: stats.ventasPorFormaPago.map(item => getMetodoPagoNombre(item.metodoPago)),
                datasets: [{
                    data: stats.ventasPorFormaPago.map(item => item.total),
                    backgroundColor: [
                        '#4caf50', // Verde
                        '#2196f3', // Azul
                        '#ff9800', // Naranja
                        '#9c27b0', // Púrpura
                        '#e91e63', // Rosa
                        '#607d8b'  // Gris azulado
                    ]
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right'
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const value = context.raw;
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const percentage = ((value / total) * 100).toFixed(1);
                                return `${context.label}: $${formatearNumero(value)} (${percentage}%)`;
                            }
                        }
                    }
                }
            }
        });
    }
}

/**
 * Llena la tabla de top productos vendidos
 * @param {Array} productos - Lista de productos
 */
function llenarTablaTopProductos(productos) {
    const tbody = elements.tablaTopProductos.querySelector('tbody');
    
    if (productos.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="3" class="text-center">No hay datos para el período seleccionado</td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = productos.map(producto => `
        <tr>
            <td>${producto.nombre}</td>
            <td>${producto.cantidad}</td>
            <td class="text-right">$${formatearNumero(producto.total)}</td>
        </tr>
    `).join('');
}

/**
 * Llena la tabla de clientes frecuentes
 * @param {Array} clientes - Lista de clientes
 */
function llenarTablaClientesFrecuentes(clientes) {
    const tbody = elements.tablaClientesFrecuentes.querySelector('tbody');
    
    if (clientes.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="3" class="text-center">No hay datos para el período seleccionado</td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = clientes.map(cliente => `
        <tr>
            <td>${cliente.nombre || 'Consumidor Final'}</td>
            <td>${cliente.compras}</td>
            <td class="text-right">$${formatearNumero(cliente.total)}</td>
        </tr>
    `).join('');
}

/**
 * Determina la clase CSS para la comparación según su valor
 * @param {number} valor - Valor de la comparación
 * @returns {string} Clase CSS
 */
function getComparacionClass(valor) {
    if (valor > 0) {
        return 'card-comparacion text-success';
    } else if (valor < 0) {
        return 'card-comparacion text-error';
    }
    return 'card-comparacion text-neutral';
}

/**
 * Inicializa el módulo de estadísticas
 */
function initEstadisticasModule() {
    // Configurar eventos para botones de período
    elements.botonesEstadisticas.forEach(btn => {
        btn.addEventListener('click', () => {
            cambiarPeriodoEstadisticas(btn.dataset.periodo);
        });
    });
    
    // Botón para aplicar período personalizado
    elements.btnAplicarPeriodo.addEventListener('click', aplicarPeriodoPersonalizado);
    
    // Inicializar fechas en el período personalizado
    elements.estadisticasFechaInicio.value = moment().startOf('month').format('YYYY-MM-DD');
    elements.estadisticasFechaFin.value = moment().endOf('month').format('YYYY-MM-DD');
    
    // Cargar estadísticas iniciales (mes actual)
    loadEstadisticasData('mes');
}

/**
 * Obtiene el nombre legible de un método de pago
 * @param {string} metodo - Código del método de pago
 * @returns {string} Nombre del método de pago
 */
function getMetodoPagoNombre(metodo) {
    const metodos = {
        'efectivo': 'Efectivo',
        'tarjeta_debito': 'Tarjeta Débito',
        'tarjeta_credito': 'Tarjeta Crédito',
        'transferencia': 'Transferencia',
        'mercadopago': 'Mercado Pago',
        'multiple': 'Pago Mixto',
        'cuenta_corriente': 'Cuenta Corriente',
        'cheque': 'Cheque'
    };
    
    return metodos[metodo] || metodo;
}

/**
 * Obtiene el nombre del tipo de comprobante
 * @param {string} tipo - Código del tipo de comprobante
 * @returns {string} Nombre del tipo de comprobante
 */
function getTipoComprobanteNombre(tipo) {
    const tipos = {
        'A': 'Factura A',
        'B': 'Factura B',
        'C': 'Factura C',
        'X': 'Factura X',
        'R': 'Remito',
        'P': 'Presupuesto',
        'NC': 'Nota de Crédito',
        'ND': 'Nota de Débito'
    };
    
    return tipos[tipo] || tipo;
}

/**
 * Formatea una fecha para mostrar
 * @param {string|Date} fecha - Fecha a formatear
 * @returns {string} Fecha formateada
 */
function formatearFecha(fecha) {
    return moment(fecha).format('DD/MM/YYYY');
}

/**
 * Formatea un número para mostrar como moneda
 * @param {number} numero - Número a formatear
 * @returns {string} Número formateado
 */
function formatearNumero(numero) {
    return numero.toLocaleString('es-AR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

/**
 * Inicializa el módulo de ventas
 */
async function init() {
    try {
        // Cargar elementos del DOM
        loadElements();
        
        // Configurar eventos
        setupEventListeners();
        
        // Cargar datos iniciales
        await refreshVentas();
        
        // Inicializar módulo de estadísticas
        initEstadisticasModule();
        
        // Verificar parámetros de URL (si se abre para mostrar una venta específica)
        const params = new URLSearchParams(window.location.search);
        const ventaId = params.get('id');
        
        if (ventaId) {
            verDetalleVenta(ventaId);
        }
        
        // Ocultar splash screen
        document.getElementById('splash-screen').style.display = 'none';
        
    } catch (error) {
        console.error('Error al inicializar módulo de ventas:', error);
        notifications.show({
            type: 'error',
            message: 'Error al cargar el módulo de ventas: ' + error.message,
            duration: 5000
        });
    }
}

/**
 * Carga referencias a elementos del DOM
 */
function loadElements() {
    elements = {
        // Elementos generales
        tablaVentas: document.getElementById('tabla-ventas'),
        btnNuevaVenta: document.getElementById('btn-nueva-venta'),
        btnExportar: document.getElementById('btn-exportar'),
        
        // Elementos de filtrado
        inputBusqueda: document.getElementById('busqueda-ventas'),
        filtroFechaInicio: document.getElementById('filtro-fecha-inicio'),
        filtroFechaFin: document.getElementById('filtro-fecha-fin'),
        filtroTipo: document.getElementById('filtro-tipo'),
        filtroCliente: document.getElementById('filtro-cliente'),
        btnAplicarFiltros: document.getElementById('btn-aplicar-filtros'),
        btnLimpiarFiltros: document.getElementById('btn-limpiar-filtros'),
        
        // Elementos de paginación
        paginacion: document.getElementById('paginacion'),
        btnPaginaAnterior: document.getElementById('btn-pagina-anterior'),
        btnPaginaSiguiente: document.getElementById('btn-pagina-siguiente'),
        selectItemsPorPagina: document.getElementById('items-por-pagina'),
        
        // Pestañas de sección
        tabsVentas: document.querySelectorAll('.tab-ventas'),
        
        // Elementos de estadísticas
        botonesEstadisticas: document.querySelectorAll('.btn-periodo'),
        estadisticasCustomPeriodo: document.getElementById('estadisticas-custom-periodo'),
        estadisticasFechaInicio: document.getElementById('estadisticas-fecha-inicio'),
        estadisticasFechaFin: document.getElementById('estadisticas-fecha-fin'),
        btnAplicarPeriodo: document.getElementById('btn-aplicar-periodo'),
        
        // Cards de estadísticas
        totalVentasValor: document.getElementById('total-ventas-valor'),
        totalVentasComparacion: document.getElementById('total-ventas-comparacion'),
        cantidadFacturas: document.getElementById('cantidad-facturas'),
        cantidadFacturasComparacion: document.getElementById('cantidad-facturas-comparacion'),
        ticketPromedio: document.getElementById('ticket-promedio'),
        ticketPromedioComparacion: document.getElementById('ticket-promedio-comparacion'),
        formaPagoPrincipal: document.getElementById('forma-pago-principal'),
        formaPagoPorcentaje: document.getElementById('forma-pago-porcentaje'),
        
        // Gráficos
        graficoVentasDiarias: document.getElementById('grafico-ventas-diarias'),
        graficoFormaPago: document.getElementById('grafico-forma-pago'),
        
        // Tablas de estadísticas
        tablaTopProductos: document.getElementById('tabla-top-productos'),
        tablaClientesFrecuentes: document.getElementById('tabla-clientes-frecuentes')
    };
    
    // Inicializar fechas de filtro
    elements.filtroFechaInicio.value = moment().startOf('month').format('YYYY-MM-DD');
    elements.filtroFechaFin.value = moment().format('YYYY-MM-DD');
}

/**
 * Configura listeners de eventos
 */
function setupEventListeners() {
    // Botones principales
    elements.btnNuevaVenta.addEventListener('click', onNuevaVenta);
    elements.btnExportar.addEventListener('click', onExportar);
    
    // Filtros
    elements.btnAplicarFiltros.addEventListener('click', aplicarFiltros);
    elements.btnLimpiarFiltros.addEventListener('click', limpiarFiltros);
    elements.inputBusqueda.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') {
            aplicarFiltros();
        }
    });
    
    // Cambio de pestaña
    elements.tabsVentas.forEach(tab => {
        tab.addEventListener('click', () => {
            const section = tab.dataset.section;
            cambiarSeccion(section);
        });
    });
    
    // Paginación
    elements.btnPaginaAnterior.addEventListener('click', irPaginaAnterior);
    elements.btnPaginaSiguiente.addEventListener('click', irPaginaSiguiente);
    elements.selectItemsPorPagina.addEventListener('change', cambiarItemsPorPagina);
}

/**
 * Cambia entre las secciones del módulo (listado o estadísticas)
 * @param {string} section - Nombre de la sección a mostrar
 */
function cambiarSeccion(section) {
    // Actualizar pestañas activas
    elements.tabsVentas.forEach(tab => {
        tab.classList.toggle('active', tab.dataset.section === section);
    });
    
    // Mostrar/ocultar secciones
    document.querySelectorAll('.section-ventas').forEach(seccion => {
        seccion.style.display = seccion.id === `section-${section}` ? 'block' : 'none';
    });
    
    // Si es la sección de estadísticas, cargar los datos
    if (section === 'estadisticas') {
        loadEstadisticasData('mes');
    }
}

/**
 * Aplica los filtros seleccionados a la lista de ventas
 */
async function aplicarFiltros() {
    try {
        // Actualizar estado de filtros
        state.filtros = {
            busqueda: elements.inputBusqueda.value.trim(),
            fechaInicio: elements.filtroFechaInicio.value,
            fechaFin: elements.filtroFechaFin.value,
            tipo: elements.filtroTipo.value,
            clienteId: elements.filtroCliente.value
        };
        
        // Volver a la primera página
        state.paginacion.paginaActual = 1;
        
        // Cargar ventas con filtros
        await refreshVentas();
        
    } catch (error) {
        console.error('Error al aplicar filtros:', error);
        notifications.show({
            type: 'error',
            message: 'Error al aplicar filtros: ' + error.message,
            duration: 5000
        });
    }
}

/**
 * Limpia todos los filtros aplicados
 */
async function limpiarFiltros() {
    try {
        // Limpiar campos
        elements.inputBusqueda.value = '';
        elements.filtroFechaInicio.value = moment().startOf('month').format('YYYY-MM-DD');
        elements.filtroFechaFin.value = moment().format('YYYY-MM-DD');
        elements.filtroTipo.value = '';
        elements.filtroCliente.value = '';
        
        // Limpiar estado
        state.filtros = {
            busqueda: '',
            fechaInicio: elements.filtroFechaInicio.value,
            fechaFin: elements.filtroFechaFin.value,
            tipo: '',
            clienteId: ''
        };
        
        // Volver a la primera página
        state.paginacion.paginaActual = 1;
        
        // Cargar ventas sin filtros
        await refreshVentas();
        
    } catch (error) {
        console.error('Error al limpiar filtros:', error);
        notifications.show({
            type: 'error',
            message: 'Error al limpiar filtros: ' + error.message,
            duration: 5000
        });
    }
}

/**
 * Carga la lista de ventas desde la base de datos
 */
async function refreshVentas() {
    try {
        // Mostrar indicador de carga
        elements.tablaVentas.querySelector('tbody').innerHTML = `
            <tr>
                <td colspan="7" class="text-center">
                    <div class="spinner">
                        <div class="bounce1"></div>
                        <div class="bounce2"></div>
                        <div class="bounce3"></div>
                    </div>
                </td>
            </tr>
        `;
        
        // Obtener ventas filtradas y paginadas
        const resultado = await database.obtenerVentas({
            ...state.filtros,
            pagina: state.paginacion.paginaActual,
            porPagina: state.paginacion.itemsPorPagina
        });
        
        // Actualizar estado
        state.ventas = resultado.ventas;
        state.paginacion.total = resultado.total;
        state.paginacion.totalPaginas = Math.ceil(resultado.total / state.paginacion.itemsPorPagina);
        
        // Renderizar tabla
        renderizarTablaVentas();
        
        // Actualizar paginación
        actualizarPaginacion();
        
    } catch (error) {
        console.error('Error al cargar ventas:', error);
        notifications.show({
            type: 'error',
            message: 'Error al cargar ventas: ' + error.message,
            duration: 5000
        });
        
        // Mostrar mensaje de error en la tabla
        elements.tablaVentas.querySelector('tbody').innerHTML = `
            <tr>
                <td colspan="7" class="text-center text-error">
                    Error al cargar datos: ${error.message}
                </td>
            </tr>
        `;
    }
}

/**
 * Renderiza la tabla de ventas con los datos actuales
 */
function renderizarTablaVentas() {
    const tbody = elements.tablaVentas.querySelector('tbody');
    
    if (state.ventas.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center">
                    No se encontraron ventas con los filtros aplicados
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = state.ventas.map(venta => `
        <tr data-id="${venta.id}" class="fila-venta">
            <td>${formatearFecha(venta.fecha)}</td>
            <td>${getTipoComprobanteNombre(venta.tipo)} ${venta.numero}</td>
            <td>${venta.cliente?.nombre || 'Consumidor Final'}</td>
            <td class="text-right">$${formatearNumero(venta.total)}</td>
            <td>${getMetodoPagoNombre(venta.metodoPago)}</td>
            <td>${venta.estado}</td>
            <td class="acciones">
                <button class="btn-icon btn-ver" title="Ver detalle">
                    <i class="fas fa-eye"></i>
                </button>
                <button class="btn-icon btn-imprimir" title="Imprimir">
                    <i class="fas fa-print"></i>
                </button>
                <button class="btn-icon btn-opciones" title="Más opciones">
                    <i class="fas fa-ellipsis-v"></i>
                </button>
            </td>
        </tr>
    `).join('');
    
    // Eventos para botones en cada fila
    const filas = tbody.querySelectorAll('.fila-venta');
    filas.forEach(fila => {
        const id = fila.dataset.id;
        
        // Ver detalle
        fila.querySelector('.btn-ver').addEventListener('click', () => {
            verDetalleVenta(id);
        });
        
        // Imprimir
        fila.querySelector('.btn-imprimir').addEventListener('click', () => {
            imprimirVenta(id);
        });
        
        // Más opciones
        fila.querySelector('.btn-opciones').addEventListener('click', (e) => {
            mostrarMenuOpciones(e, id);
        });
        
        // Clic en la fila también muestra detalle
        fila.addEventListener('click', (e) => {
            // Solo si no se clickeó en un botón
            if (!e.target.closest('button')) {
                verDetalleVenta(id);
            }
        });
    });
}

/**
 * Actualiza los controles de paginación
 */
function actualizarPaginacion() {
    // Texto de paginación
    const inicio = (state.paginacion.paginaActual - 1) * state.paginacion.itemsPorPagina + 1;
    const fin = Math.min(inicio + state.paginacion.itemsPorPagina - 1, state.paginacion.total);
    
    elements.paginacion.querySelector('.paginacion-info').textContent = 
        `Mostrando ${inicio}-${fin} de ${state.paginacion.total} resultados`;
    
    // Botones de navegación
    elements.btnPaginaAnterior.disabled = state.paginacion.paginaActual <= 1;
    elements.btnPaginaSiguiente.disabled = state.paginacion.paginaActual >= state.paginacion.totalPaginas;
    
    // Número de página actual
    elements.paginacion.querySelector('.pagina-actual').textContent = state.paginacion.paginaActual;
}

/**
 * Ir a la página anterior
 */
async function irPaginaAnterior() {
    if (state.paginacion.paginaActual > 1) {
        state.paginacion.paginaActual--;
        await refreshVentas();
    }
}

/**
 * Ir a la página siguiente
 */
async function irPaginaSiguiente() {
    if (state.paginacion.paginaActual < state.paginacion.totalPaginas) {
        state.paginacion.paginaActual++;
        await refreshVentas();
    }
}

/**
 * Cambia la cantidad de ítems por página
 */
async function cambiarItemsPorPagina() {
    state.paginacion.itemsPorPagina = parseInt(elements.selectItemsPorPagina.value);
    state.paginacion.paginaActual = 1; // Volver a la primera página
    await refreshVentas();
}

/**
 * Muestra el detalle de una venta
 * @param {string} id - ID de la venta
 */
async function verDetalleVenta(id) {
    try {
        notifications.show({
            type: 'info',
            message: 'Cargando detalle de venta...',
            duration: 2000
        });
        
        // Obtener detalle completo
        const venta = await database.obtenerVentaDetalle(id);
        
        // Mostrar modal con detalle
        mostrarModalDetalleVenta(venta);
        
    } catch (error) {
        console.error('Error al cargar detalle de venta:', error);
        notifications.show({
            type: 'error',
            message: 'Error al cargar detalle: ' + error.message,
            duration: 5000
        });
    }
}

/**
 * Muestra un modal con el detalle de la venta
 * @param {Object} venta - Datos de la venta
 */
function mostrarModalDetalleVenta(venta) {
    // Crear el modal
    const modal = document.createElement('div');
    modal.className = 'modal-container';
    modal.innerHTML = `
        <div class="modal-content modal-lg">
            <div class="modal-header">
                <h3>${getTipoComprobanteNombre(venta.tipo)} ${venta.numero}</h3>
                <button class="btn-close">×</button>
            </div>
            <div class="modal-body">
                <div class="venta-header">
                    <div class="venta-info">
                        <p><strong>Fecha:</strong> ${formatearFecha(venta.fecha)}</p>
                        <p><strong>Cliente:</strong> ${venta.cliente.nombre || 'Consumidor Final'}</p>
                        <p><strong>CUIT/DNI:</strong> ${venta.cliente.documento || '-'}</p>
                        <p><strong>Método de Pago:</strong> ${getMetodoPagoNombre(venta.metodoPago)}</p>
                    </div>
                    <div class="venta-estado">
                        <span class="badge badge-${getEstadoClass(venta.estado)}">${venta.estado}</span>
                    </div>
                </div>
                
                <div class="tabla-detalle-container">
                    <table class="tabla-detalle">
                        <thead>
                            <tr>
                                <th>Producto</th>
                                <th>Cantidad</th>
                                <th>Precio Unit.</th>
                                <th>Descuento</th>
                                <th>Subtotal</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${venta.items.map(item => `
                                <tr>
                                    <td>${item.producto.nombre}</td>
                                    <td>${item.cantidad}</td>
                                    <td class="text-right">$${formatearNumero(item.precioUnitario)}</td>
                                    <td class="text-right">${item.descuento > 0 ? `${item.descuento}%` : '-'}</td>
                                    <td class="text-right">$${formatearNumero(item.subtotal)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                        <tfoot>
                            <tr>
                                <td colspan="3"></td>
                                <td><strong>Subtotal:</strong></td>
                                <td class="text-right">$${formatearNumero(venta.subtotal)}</td>
                            </tr>
                            ${venta.descuento > 0 ? `
                                <tr>
                                    <td colspan="3"></td>
                                    <td><strong>Descuento (${venta.descuentoPorcentaje}%):</strong></td>
                                    <td class="text-right">-$${formatearNumero(venta.descuento)}</td>
                                </tr>
                            ` : ''}
                            <tr>
                                <td colspan="3"></td>
                                <td><strong>IVA (${venta.ivaPorc}%):</strong></td>
                                <td class="text-right">$${formatearNumero(venta.impuestos)}</td>
                            </tr>
                            <tr class="total-row">
                                <td colspan="3"></td>
                                <td><strong>TOTAL:</strong></td>
                                <td class="text-right">$${formatearNumero(venta.total)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
                
                ${venta.observaciones ? `
                    <div class="venta-observaciones">
                        <h4>Observaciones:</h4>
                        <p>${venta.observaciones}</p>
                    </div>
                ` : ''}
                
                ${venta.metodoPago === 'multiple' && venta.pagos?.length > 0 ? `
                    <div class="venta-pagos">
                        <h4>Detalles de Pago:</h4>
                        <table class="tabla-pagos">
                            <thead>
                                <tr>
                                    <th>Método</th>
                                    <th>Monto</th>
                                    <th>Referencia</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${venta.pagos.map(pago => `
                                    <tr>
                                        <td>${getMetodoPagoNombre(pago.tipo)}</td>
                                        <td class="text-right">$${formatearNumero(pago.monto)}</td>
                                        <td>${pago.referencia || '-'}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                ` : ''}
            </div>
            <div class="modal-footer">
                <div class="modal-actions">
                    <button class="btn-secondary" id="btn-cerrar-detalle">Cerrar</button>
                    <button class="btn-primary" id="btn-imprimir-detalle">
                        <i class="fas fa-print"></i> Imprimir
                    </button>
                    <button class="btn-info" id="btn-opciones-envio">
                        <i class="fas fa-share-alt"></i> Enviar
                    </button>
                    ${venta.tipo === 'P' ? `
                        <button class="btn-success" id="btn-facturar-presupuesto">
                            <i class="fas fa-file-invoice"></i> Facturar
                        </button>
                    ` : ''}
                </div>
            </div>
        </div>
    `;
    
    // Añadir al DOM
    document.body.appendChild(modal);
    
    // Eventos
    // Cerrar modal
    const btnCerrar = modal.querySelector('.btn-close');
    const btnCerrarDetalle = modal.querySelector('#btn-cerrar-detalle');
    
    btnCerrar.addEventListener('click', () => {
        document.body.removeChild(modal);
    });
    
    btnCerrarDetalle.addEventListener('click', () => {
        document.body.removeChild(modal);
    });
    
    // Imprimir
    const btnImprimir = modal.querySelector('#btn-imprimir-detalle');
    btnImprimir.addEventListener('click', () => {
        document.body.removeChild(modal);
        imprimirVenta(venta.id);
    });
    
    // Opciones de envío
    const btnOpcionesEnvio = modal.querySelector('#btn-opciones-envio');
    btnOpcionesEnvio.addEventListener('click', () => {
        document.body.removeChild(modal);
        mostrarOpcionesEnvio(venta);
    });
    
    // Facturar presupuesto (solo si es presupuesto)
    if (venta.tipo === 'P') {
        const btnFacturar = modal.querySelector('#btn-facturar-presupuesto');
        btnFacturar.addEventListener('click', () => {
            document.body.removeChild(modal);
            facturarPresupuesto(venta.id);
        });
    }
}

/**
 * Obtiene la clase CSS para un estado de venta
 * @param {string} estado - Estado de la venta
 * @returns {string} Clase CSS
 */
function getEstadoClass(estado) {
    switch (estado.toLowerCase()) {
        case 'pagado':
        case 'completado':
            return 'success';
        case 'pendiente':
            return 'warning';
        case 'anulado':
        case 'cancelado':
            return 'error';
        default:
            return 'info';
    }
}

/**
 * Imprime una venta
 * @param {string} id - ID de la venta
 */
async function imprimirVenta(id) {
    try {
        notifications.show({
            type: 'info',
            message: 'Preparando impresión...',
            duration: 2000
        });
        
        // Obtener detalle completo si no lo tenemos
        const venta = state.ventaActual && state.ventaActual.id === id 
            ? state.ventaActual 
            : await database.obtenerVentaDetalle(id);
        
        // Mostrar opciones de impresión
        mostrarOpcionesImpresion(venta);
        
    } catch (error) {
        console.error('Error al preparar impresión:', error);
        notifications.show({
            type: 'error',
            message: 'Error al preparar impresión: ' + error.message,
            duration: 5000
        });
    }
}

/**
 * Muestra opciones de impresión
 * @param {Object} venta - Datos de la venta
 */
function mostrarOpcionesImpresion(venta) {
    // Crear modal
    const modal = document.createElement('div');
    modal.className = 'modal-container';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>Opciones de Impresión</h3>
                <button class="btn-close">×</button>
            </div>
            <div class="modal-body">
                <div class="opciones-impresion">
                    <button class="btn-opcion-impresion" data-formato="ticket">
                        <i class="fas fa-receipt fa-3x"></i>
                        <span>Ticket</span>
                    </button>
                    <button class="btn-opcion-impresion" data-formato="a4">
                        <i class="fas fa-file-pdf fa-3x"></i>
                        <span>Hoja A4</span>
                    </button>
                    <button class="btn-opcion-impresion" data-formato="vista-previa">
                        <i class="fas fa-eye fa-3x"></i>
                        <span>Vista Previa</span>
                    </button>
                </div>
                
                <div class="opciones-adicionales">
                    <div class="checkbox-group">
                        <label>
                            <input type="checkbox" id="imprimir-original" checked>
                            Original
                        </label>
                    </div>
                    <div class="checkbox-group">
                        <label>
                            <input type="checkbox" id="imprimir-duplicado">
                            Duplicado
                        </label>
                    </div>
                    <div class="checkbox-group">
                        <label>
                            <input type="checkbox" id="abrir-pdf" checked>
                            Abrir PDF después de generar
                        </label>
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn-secondary" id="btn-cancelar-impresion">Cancelar</button>
            </div>
        </div>
    `;
    
    // Añadir al DOM
    document.body.appendChild(modal);
    
    // Eventos
    // Cerrar modal
    modal.querySelector('.btn-close').addEventListener('click', () => {
        document.body.removeChild(modal);
    });
    
    // Cancelar
    modal.querySelector('#btn-cancelar-impresion').addEventListener('click', () => {
        document.body.removeChild(modal);
    });
    
    // Opciones de impresión
    const botonesImpresion = modal.querySelectorAll('.btn-opcion-impresion');
    botonesImpresion.forEach(btn => {
        btn.addEventListener('click', async () => {
            const formato = btn.dataset.formato;
            const imprimirOriginal = modal.querySelector('#imprimir-original').checked;
            const imprimirDuplicado = modal.querySelector('#imprimir-duplicado').checked;
            const abrirPdf = modal.querySelector('#abrir-pdf').checked;
            
            // Cerrar el modal
            document.body.removeChild(modal);
            
            try {
                if (formato === 'vista-previa') {
                    // Generar PDF y mostrar vista previa
                    const rutaPdf = await printer.guardarFacturaPDF(venta, true, 'a4');
                    await ipcRenderer.invoke('abrir-archivo', rutaPdf);
                } else {
                    // Mostrar indicador de carga
                    notifications.show({
                        type: 'info',
                        message: 'Imprimiendo...',
                        duration: 2000
                    });
                    
                    // Imprimir según el formato seleccionado
                    if (formato === 'ticket') {
                        await printer.imprimirTicket(venta, { imprimirOriginal, imprimirDuplicado });
                    } else {
                        const rutaPdf = await printer.imprimirFactura(venta, {
                            formato: 'a4',
                            imprimirOriginal,
                            imprimirDuplicado,
                            abrirPdf
                        });
                        
                        if (abrirPdf && rutaPdf) {
                            // Abrir el PDF generado
                            await ipcRenderer.invoke('abrir-archivo', rutaPdf);
                        }
                    }
                    
                    notifications.show({
                        type: 'success',
                        message: 'Documento enviado a la impresora',
                        duration: 3000
                    });
                }
            } catch (error) {
                console.error('Error al imprimir:', error);
                notifications.show({
                    type: 'error',
                    message: 'Error al imprimir: ' + error.message,
                    duration: 5000
                });
            }
        });
    });
}

/**
 * Muestra un menú de opciones para una venta
 * @param {Event} event - Evento del click
 * @param {string} id - ID de la venta
 */
function mostrarMenuOpciones(event, id) {
    event.stopPropagation();
    
    // Si ya hay un menú abierto, cerrarlo
    const menuExistente = document.querySelector('.menu-opciones');
    if (menuExistente) {
        document.body.removeChild(menuExistente);
    }
    
    // Crear menú de opciones
    const menu = document.createElement('div');
    menu.className = 'menu-opciones';
    
    // Posicionar el menú cerca del botón que lo activó
    const rect = event.target.closest('button').getBoundingClientRect();
    menu.style.top = `${rect.bottom + 5}px`;
    menu.style.left = `${rect.left - 150}px`;
    
    // Contenido del menú
    menu.innerHTML = `
        <ul>
            <li class="opcion-menu" data-accion="ver">
                <i class="fas fa-eye"></i> Ver detalle
            </li>
            <li class="opcion-menu" data-accion="imprimir">
                <i class="fas fa-print"></i> Imprimir
            </li>
            <li class="opcion-menu" data-accion="enviar">
                <i class="fas fa-share-alt"></i> Enviar
            </li>
            <li class="opcion-menu" data-accion="duplicar">
                <i class="fas fa-copy"></i> Duplicar
            </li>
            <li class="separator"></li>
            <li class="opcion-menu opcion-peligrosa" data-accion="anular">
                <i class="fas fa-ban"></i> Anular
            </li>
        </ul>
    `;
    
    // Añadir al DOM
    document.body.appendChild(menu);
    
    // Eventos para opciones del menú
    menu.querySelectorAll('.opcion-menu').forEach(opcion => {
        opcion.addEventListener('click', async () => {
            // Cerrar el menú
            document.body.removeChild(menu);
            
            const accion = opcion.dataset.accion;
            
            switch (accion) {
                case 'ver':
                    verDetalleVenta(id);
                    break;
                case 'imprimir':
                    imprimirVenta(id);
                    break;
                case 'enviar':
                    // Obtener detalle para enviar
                    const venta = await database.obtenerVentaDetalle(id);
                    mostrarOpcionesEnvio(venta);
                    break;
                case 'duplicar': 
                    duplicarVenta(id);
                    break;
                case 'anular':
                    confirmarAnularVenta(id);
                    break;
            }
        });
    });
    
    // Cerrar menú al hacer clic en cualquier parte fuera de él
    document.addEventListener('click', function cerrarMenu(e) {
        if (!menu.contains(e.target)) {
            if (document.body.contains(menu)) {
                document.body.removeChild(menu);
            }
            document.removeEventListener('click', cerrarMenu);
        }
    });
}

/**
 * Muestra un modal para confirmar la anulación de una venta
 * @param {string} id - ID de la venta
 */
function confirmarAnularVenta(id) {
    // Crear modal de confirmación
    const modal = document.createElement('div');
    modal.className = 'modal-container';
    modal.innerHTML = `
        <div class="modal-content modal-sm">
            <div class="modal-header">
                <h3>Confirmar Anulación</h3>
                <button class="btn-close">×</button>
            </div>
            <div class="modal-body">
                <p>¿Está seguro que desea anular esta venta?</p>
                <p class="text-warning">Esta acción no se puede deshacer.</p>
                
                <div class="form-group">
                    <label for="motivo-anulacion">Motivo de anulación:</label>
                    <textarea id="motivo-anulacion" class="form-input" rows="3"></textarea>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn-secondary" id="btn-cancelar-anulacion">Cancelar</button>
                <button class="btn-danger" id="btn-confirmar-anulacion">Anular</button>
            </div>
        </div>
    `;
    
    // Añadir al DOM
    document.body.appendChild(modal);
    
    // Eventos
    // Cerrar modal
    modal.querySelector('.btn-close').addEventListener('click', () => {
        document.body.removeChild(modal);
    });
    
    // Cancelar
    modal.querySelector('#btn-cancelar-anulacion').addEventListener('click', () => {
        document.body.removeChild(modal);
    });
    
    // Confirmar anulación
    modal.querySelector('#btn-confirmar-anulacion').addEventListener('click', async () => {
        const motivo = modal.querySelector('#motivo-anulacion').value.trim();
        
        // Cerrar modal
        document.body.removeChild(modal);
        
        try {
            notifications.show({
                type: 'info',
                message: 'Anulando venta...',
                duration: 2000
            });
            
            // Anular venta
            await database.anularVenta(id, motivo);
            
            notifications.show({
                type: 'success',
                message: 'Venta anulada correctamente',
                duration: 3000
            });
            
            // Refrescar lista de ventas
            await refreshVentas();
            
        } catch (error) {
            console.error('Error al anular venta:', error);
            notifications.show({
                type: 'error',
                message: 'Error al anular venta: ' + error.message,
                duration: 5000
            });
        }
    });
}

/**
 * Duplica una venta existente (crea una nueva basada en esta)
 * @param {string} id - ID de la venta a duplicar
 */
async function duplicarVenta(id) {
    try {
        notifications.show({
            type: 'info',
            message: 'Preparando duplicación...',
            duration: 2000
        });
        
        // Redireccionar al punto de venta con el ID de la venta a duplicar
        ipcRenderer.send('cambiar-modulo', {
            modulo: 'punto-venta',
            params: {
                duplicarVenta: id
            }
        });
        
    } catch (error) {
        console.error('Error al duplicar venta:', error);
        notifications.show({
            type: 'error',
            message: 'Error al duplicar venta: ' + error.message,
            duration: 5000
        });
    }
}

/**
 * Muestra un modal con las opciones de envío
 * @param {Object} venta - Datos de la venta
 */
function mostrarOpcionesEnvio(venta) {
    // Crear modal
    const modal = document.createElement('div');
    modal.className = 'modal-container';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>Opciones de Envío</h3>
                <button class="btn-close">×</button>
            </div>
            <div class="modal-body">
                <div class="opciones-envio">
                    <button class="btn-opcion-envio" data-tipo="email">
                        <i class="fas fa-envelope fa-3x"></i>
                        <span>Email</span>
                    </button>
                    <button class="btn-opcion-envio" data-tipo="whatsapp">
                        <i class="fab fa-whatsapp fa-3x"></i>
                        <span>WhatsApp</span>
                    </button>
                    <button class="btn-opcion-envio" data-tipo="pdf">
                        <i class="fas fa-file-pdf fa-3x"></i>
                        <span>Guardar PDF</span>
                    </button>
                </div>
                
                <!-- Contenedor dinámico para opciones específicas -->
                <div class="envio-opciones-container"></div>
            </div>
        </div>
    `;
    
    // Añadir al DOM
    document.body.appendChild(modal);
    
    // Eventos
    // Cerrar modal
    modal.querySelector('.btn-close').addEventListener('click', () => {
        document.body.removeChild(modal);
    });
    
    // Contenedor para opciones específicas
    const opcionesContainer = modal.querySelector('.envio-opciones-container');
    
    // Botones de opciones de envío
    const botonesEnvio = modal.querySelectorAll('.btn-opcion-envio');
    botonesEnvio.forEach(btn => {
        btn.addEventListener('click', () => {
            const tipo = btn.dataset.tipo;
            
            // Actualizar botones activos
            botonesEnvio.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // Mostrar opciones específicas según el tipo
            mostrarOpcionesEspecificas(tipo, opcionesContainer, venta);
        });
    });
}

/**
 * Muestra opciones específicas según el tipo de envío seleccionado
 * @param {string} tipo - Tipo de envío (email, whatsapp, pdf)
 * @param {HTMLElement} container - Contenedor para las opciones
 * @param {Object} venta - Datos de la venta
 */
function mostrarOpcionesEspecificas(tipo, container, venta) {
    container.innerHTML = '';
    
    switch (tipo) {
        case 'email':
            container.innerHTML = `
                <div class="form-group">
                    <label for="email-destino">Email del destinatario:</label>
                    <input type="email" id="email-destino" class="form-input" 
                           value="${venta.cliente.email || ''}" placeholder="correo@ejemplo.com">
                </div>
                <div class="form-group">
                    <label for="email-asunto">Asunto:</label>
                    <input type="text" id="email-asunto" class="form-input" 
                           value="${getTipoComprobanteNombre(venta.tipo)} ${venta.numero}">
                </div>
                <div class="form-group">
                    <label for="email-mensaje">Mensaje:</label>
                    <textarea id="email-mensaje" class="form-input" rows="4">Estimado/a cliente,

Adjuntamos el comprobante de su compra.

Saludos cordiales.</textarea>
                </div>
                <div class="form-actions">
                    <button class="btn-primary btn-enviar-email">Enviar Email</button>
                </div>
            `;
            
            // Evento para enviar email
            container.querySelector('.btn-enviar-email').addEventListener('click', async () => {
                const email = container.querySelector('#email-destino').value.trim();
                const asunto = container.querySelector('#email-asunto').value.trim();
                const mensaje = container.querySelector('#email-mensaje').value.trim();
                
                // Validar email
                if (!email || !validation.isValidEmail(email)) {
                    notifications.show({
                        type: 'error',
                        message: 'Por favor, ingrese un email válido',
                        duration: 3000
                    });
                    return;
                }
                
                try {
                    // Cerrar el modal
                    document.body.removeChild(modal);
                    
                    // Mostrar cargando
                    notifications.show({
                        type: 'info',
                        message: 'Enviando email...',
                        duration: 2000
                    });
                    
                    // Enviar email
                    await mailer.enviarComprobante(email, asunto, mensaje, venta);
                    
                    notifications.show({
                        type: 'success',
                        message: 'Email enviado correctamente',
                        duration: 3000
                    });
                    
                } catch (error) {
                    console.error('Error al enviar email:', error);
                    notifications.show({
                        type: 'error',
                        message: 'Error al enviar email: ' + error.message,
                        duration: 5000
                    });
                }
            });
            break;
            
        case 'whatsapp':
            container.innerHTML = `
                <div class="form-group">
                    <label for="whatsapp-numero">Número de WhatsApp:</label>
                    <input type="tel" id="whatsapp-numero" class="form-input" 
                           value="${venta.cliente.telefono || ''}" placeholder="Ej: 549xxxxxxxxxx">
                </div>
                <div class="form-group">
                    <label for="whatsapp-mensaje">Mensaje:</label>
                    <textarea id="whatsapp-mensaje" class="form-input" rows="4">Hola, te envío el comprobante de tu compra.</textarea>
                </div>
                <div class="form-actions">
                    <button class="btn-success btn-enviar-whatsapp">Enviar por WhatsApp</button>
                </div>
            `;
            break;
            
        case 'pdf':
            container.innerHTML = `
                <div class="form-group">
                    <p>Se generará un archivo PDF con el comprobante.</p>
                </div>
                <div class="form-actions">
                    <button class="btn-info btn-guardar-pdf">Guardar PDF</button>
                </div>
            `;
            
            // Evento para guardar PDF
            container.querySelector('.btn-guardar-pdf').addEventListener('click', async () => {
                try {
                    // Cerrar el modal
                    document.body.removeChild(modal);
                    
                    // Mostrar cargando
                    notifications.show({
                        type: 'info',
                        message: 'Generando PDF...',
                        duration: 2000
                    });
                    
                    // Generar y guardar PDF
                    const rutaPdf = await printer.guardarFacturaPDF(venta, false);
                    
                    notifications.show({
                        type: 'success',
                        message: 'PDF generado correctamente',
                        duration: 3000
                    });
                    
                    // Abrir el PDF generado
                    await ipcRenderer.invoke('abrir-archivo', rutaPdf);
                    
                } catch (error) {
                    console.error('Error al generar PDF:', error);
                    notifications.show({
                        type: 'error',
                        message: 'Error al generar PDF: ' + error.message,
                        duration: 5000
                    });
                }
            });
            break;
    }
}

/**
 * Determina la clase CSS para la comparación según su valor
 * @param {number} valor - Valor de la comparación
 * @returns {string} Clase CSS
 */
function getComparacionClass(valor) {
    if (valor > 0) {
        return 'card-comparacion text-success';
    } else if (valor < 0) {
        return 'card-comparacion text-error';
    }
    return 'card-comparacion text-neutral';
}

// Inicializar módulo al cargar
init();}