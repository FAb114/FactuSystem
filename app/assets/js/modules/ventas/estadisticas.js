/**
 * Módulo de Estadísticas de Ventas para FactuSystem
 * 
 * Este módulo maneja la visualización y cálculo de estadísticas de ventas,
 * incluyendo gráficos, tendencias, comparativas y métricas clave.
 * 
 * @author FactuSystem
 * @version 1.0.0
 */

// Importar dependencias y utilidades
import { formatCurrency, formatDate, formatNumber } from '../../utils/formatters.js';
import { showNotification } from '../../components/notifications.js';
import { getDatabase } from '../../utils/database.js';
import { getUserPermissions } from '../../utils/auth.js';
import { exportToPDF } from '../../utils/export.js';
import { getCurrentSucursal, getAllSucursales } from '../../modules/sucursales/index.js';
import { createChart, updateChart } from '../../utils/charts.js';

// Elementos del DOM
let ventasChart, productsChart, paymentMethodsChart, comparativeChart;
let dateRangeSelector, sucursalSelector, filterButton, exportButton;
let statsTotals, statsComparison, topProductsList, periodsSelector;
let loadingIndicator;

// Variables de estado
let currentDateRange = 'month'; // 'day', 'week', 'month', 'year', 'custom'
let currentSucursal = 'all'; // 'all' o ID de sucursal
let chartData = {};
let customDateStart = null;
let customDateEnd = null;
let currentUserPermissions = [];
let isMultiSucursal = false;

/**
 * Inicializa el módulo de estadísticas de ventas
 * @param {string} containerId - ID del contenedor donde se cargarán las estadísticas
 * @returns {Promise<void>}
 */
export async function init(containerId) {
    try {
        loadingIndicator = document.getElementById(`${containerId}-loading`);
        if (loadingIndicator) loadingIndicator.style.display = 'block';
        
        // Verificar permisos
        currentUserPermissions = await getUserPermissions();
        const hasPermission = currentUserPermissions.includes('view_sales_statistics');
        
        if (!hasPermission) {
            showNotification('No tienes permisos para acceder a las estadísticas de ventas', 'error');
            return;
        }
        
        // Obtener información de sucursales
        const currentSucursalData = await getCurrentSucursal();
        const allSucursales = await getAllSucursales();
        isMultiSucursal = allSucursales.length > 1;
        currentSucursal = currentSucursalData.id;
        
        // Inicializar interfaz
        await renderUI(containerId);
        setupEventListeners();
        
        // Cargar datos iniciales
        await refreshData();
        
    } catch (error) {
        console.error('Error al inicializar módulo de estadísticas:', error);
        showNotification('Error al cargar estadísticas de ventas', 'error');
    } finally {
        if (loadingIndicator) loadingIndicator.style.display = 'none';
    }
}

/**
 * Renderiza la interfaz de usuario para estadísticas
 * @param {string} containerId - ID del contenedor
 */
async function renderUI(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    // Crear estructura HTML
    container.innerHTML = `
        <div class="statistics-header">
            <h2>Estadísticas de Ventas</h2>
            <div class="statistics-filters">
                <div class="filter-group">
                    <label for="date-range">Período:</label>
                    <select id="date-range-selector" class="form-select">
                        <option value="day">Hoy</option>
                        <option value="yesterday">Ayer</option>
                        <option value="week">Esta semana</option>
                        <option value="last-week">Semana anterior</option>
                        <option value="month" selected>Este mes</option>
                        <option value="last-month">Mes anterior</option>
                        <option value="quarter">Este trimestre</option>
                        <option value="year">Este año</option>
                        <option value="custom">Personalizado</option>
                    </select>
                    <div id="custom-date-container" class="custom-date-range" style="display: none;">
                        <input type="date" id="date-start" class="form-control">
                        <span>hasta</span>
                        <input type="date" id="date-end" class="form-control">
                    </div>
                </div>
                
                ${isMultiSucursal ? `
                <div class="filter-group">
                    <label for="sucursal-selector">Sucursal:</label>
                    <select id="sucursal-selector" class="form-select">
                        <option value="all">Todas las sucursales</option>
                        ${(await getAllSucursales()).map(s => 
                            `<option value="${s.id}" ${s.id === currentSucursal ? 'selected' : ''}>${s.nombre}</option>`
                        ).join('')}
                    </select>
                </div>
                ` : ''}
                
                <div class="filter-group">
                    <label for="periods-selector">Comparar con:</label>
                    <select id="periods-selector" class="form-select">
                        <option value="none">Sin comparativa</option>
                        <option value="previous">Período anterior</option>
                        <option value="last-year">Mismo período año anterior</option>
                    </select>
                </div>
                
                <button id="filter-button" class="btn btn-primary">
                    <i class="fas fa-filter"></i> Filtrar
                </button>
                
                <button id="export-button" class="btn btn-secondary">
                    <i class="fas fa-file-export"></i> Exportar
                </button>
            </div>
        </div>
        
        <div class="statistics-summary">
            <div class="stats-card total-ventas">
                <h3>Total Ventas</h3>
                <p class="stats-value" id="total-ventas">$0.00</p>
                <p class="stats-change" id="change-ventas"><span class="neutral">0%</span></p>
            </div>
            <div class="stats-card total-transacciones">
                <h3>Transacciones</h3>
                <p class="stats-value" id="total-transacciones">0</p>
                <p class="stats-change" id="change-transacciones"><span class="neutral">0%</span></p>
            </div>
            <div class="stats-card ticket-promedio">
                <h3>Ticket Promedio</h3>
                <p class="stats-value" id="ticket-promedio">$0.00</p>
                <p class="stats-change" id="change-ticket"><span class="neutral">0%</span></p>
            </div>
            <div class="stats-card margen-promedio">
                <h3>Margen Estimado</h3>
                <p class="stats-value" id="margen-promedio">0%</p>
                <p class="stats-change" id="change-margen"><span class="neutral">0%</span></p>
            </div>
        </div>
        
        <div class="statistics-charts">
            <div class="chart-container">
                <h3>Ventas por período</h3>
                <div class="chart-wrapper">
                    <canvas id="ventas-chart"></canvas>
                </div>
            </div>
            
            <div class="chart-container">
                <h3>Productos más vendidos</h3>
                <div class="chart-wrapper">
                    <canvas id="products-chart"></canvas>
                </div>
                <div id="top-products-list" class="top-list"></div>
            </div>
        </div>
        
        <div class="statistics-charts secondary-charts">
            <div class="chart-container">
                <h3>Medios de pago</h3>
                <div class="chart-wrapper">
                    <canvas id="payment-methods-chart"></canvas>
                </div>
            </div>
            
            <div class="chart-container">
                <h3>Comparativa entre períodos</h3>
                <div class="chart-wrapper">
                    <canvas id="comparative-chart"></canvas>
                </div>
            </div>
        </div>
        
        ${isMultiSucursal ? `
        <div class="statistics-charts">
            <div class="chart-container full-width">
                <h3>Comparativa entre sucursales</h3>
                <div class="chart-wrapper">
                    <canvas id="sucursales-chart"></canvas>
                </div>
            </div>
        </div>
        ` : ''}
    `;
    
    // Obtener referencias a elementos del DOM
    dateRangeSelector = document.getElementById('date-range-selector');
    sucursalSelector = document.getElementById('sucursal-selector');
    filterButton = document.getElementById('filter-button');
    exportButton = document.getElementById('export-button');
    periodsSelector = document.getElementById('periods-selector');
    topProductsList = document.getElementById('top-products-list');
    
    // Inicializar gráficos con Chart.js
    initCharts();
}

/**
 * Configura los listeners de eventos para elementos interactivos
 */
function setupEventListeners() {
    // Evento para cambio de rango de fechas
    dateRangeSelector.addEventListener('change', function() {
        const customDateContainer = document.getElementById('custom-date-container');
        if (this.value === 'custom') {
            customDateContainer.style.display = 'flex';
            
            // Inicializar fechas si no están definidas
            if (!customDateStart || !customDateEnd) {
                const today = new Date();
                const lastMonth = new Date();
                lastMonth.setMonth(today.getMonth() - 1);
                
                document.getElementById('date-start').value = formatDateForInput(lastMonth);
                document.getElementById('date-end').value = formatDateForInput(today);
            }
        } else {
            customDateContainer.style.display = 'none';
        }
    });
    
    // Eventos para fechas personalizadas
    if (document.getElementById('date-start')) {
        document.getElementById('date-start').addEventListener('change', function() {
            customDateStart = this.value;
        });
    }
    
    if (document.getElementById('date-end')) {
        document.getElementById('date-end').addEventListener('change', function() {
            customDateEnd = this.value;
        });
    }
    
    // Evento para cambio de sucursal
    if (sucursalSelector) {
        sucursalSelector.addEventListener('change', function() {
            currentSucursal = this.value;
        });
    }
    
    // Evento para botón de filtrar
    filterButton.addEventListener('click', async function() {
        currentDateRange = dateRangeSelector.value;
        if (loadingIndicator) loadingIndicator.style.display = 'block';
        await refreshData();
        if (loadingIndicator) loadingIndicator.style.display = 'none';
    });
    
    // Evento para botón de exportar
    exportButton.addEventListener('click', async function() {
        await exportStatistics();
    });
    
    // Evento para selector de períodos comparativos
    periodsSelector.addEventListener('change', function() {
        refreshComparativeChart(this.value);
    });
}

/**
 * Inicializa los gráficos con Chart.js
 */
function initCharts() {
    // Gráfico de ventas por período
    const ventasCtx = document.getElementById('ventas-chart').getContext('2d');
    ventasChart = createChart(ventasCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Ventas',
                borderColor: '#4a6cf7',
                backgroundColor: 'rgba(74, 108, 247, 0.1)',
                data: [],
                tension: 0.3,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return '$' + formatNumber(value);
                        }
                    }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return 'Ventas: $' + formatNumber(context.raw);
                        }
                    }
                }
            }
        }
    });
    
    // Gráfico de productos más vendidos
    const productsCtx = document.getElementById('products-chart').getContext('2d');
    productsChart = createChart(productsCtx, {
        type: 'doughnut',
        data: {
            labels: [],
            datasets: [{
                data: [],
                backgroundColor: [
                    '#4a6cf7', '#6c5ce7', '#00cec9', '#0984e3', '#e84393',
                    '#00b894', '#fdcb6e', '#e17055', '#d63031', '#636e72'
                ]
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        boxWidth: 12
                    }
                }
            }
        }
    });
    
    // Gráfico de métodos de pago
    const paymentsCtx = document.getElementById('payment-methods-chart').getContext('2d');
    paymentMethodsChart = createChart(paymentsCtx, {
        type: 'pie',
        data: {
            labels: [],
            datasets: [{
                data: [],
                backgroundColor: [
                    '#00b894', '#0984e3', '#6c5ce7', '#fdcb6e', '#e84393'
                ]
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom'
                }
            }
        }
    });
    
    // Gráfico comparativo
    const comparativeCtx = document.getElementById('comparative-chart').getContext('2d');
    comparativeChart = createChart(comparativeCtx, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Período actual',
                    backgroundColor: '#4a6cf7',
                    data: []
                },
                {
                    label: 'Período anterior',
                    backgroundColor: '#6c5ce7',
                    data: []
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return '$' + formatNumber(value);
                        }
                    }
                }
            }
        }
    });

    // Inicializar gráfico de sucursales si es necesario
    if (isMultiSucursal && document.getElementById('sucursales-chart')) {
        const sucursalesCtx = document.getElementById('sucursales-chart').getContext('2d');
        createChart(sucursalesCtx, {
            type: 'bar',
            data: {
                labels: [],
                datasets: [{
                    label: 'Ventas por Sucursal',
                    backgroundColor: '#00b894',
                    data: []
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                return '$' + formatNumber(value);
                            }
                        }
                    }
                }
            }
        });
    }
}

/**
 * Actualiza todos los datos y gráficos
 */
async function refreshData() {
    try {
        if (loadingIndicator) loadingIndicator.style.display = 'block';
        
        // Determinar rango de fechas
        const dateRange = getDateRangeFromSelection();
        
        // Obtener datos de ventas
        const ventasData = await fetchVentasData(dateRange.startDate, dateRange.endDate, currentSucursal);
        chartData = ventasData;
        
        // Actualizar resumen de estadísticas
        updateStatsSummary(ventasData);
        
        // Actualizar gráficos
        updateVentasChart(ventasData);
        updateProductsChart(ventasData);
        updatePaymentMethodsChart(ventasData);
        
        // Actualizar comparativa según el selector
        const comparativeType = document.getElementById('periods-selector').value;
        if (comparativeType !== 'none') {
            refreshComparativeChart(comparativeType);
        }
        
        // Actualizar comparativa de sucursales si es necesario
        if (isMultiSucursal && currentSucursal === 'all') {
            updateSucursalesChart(ventasData);
        }
        
    } catch (error) {
        console.error('Error al actualizar datos de estadísticas:', error);
        showNotification('Error al cargar datos de estadísticas', 'error');
    } finally {
        if (loadingIndicator) loadingIndicator.style.display = 'none';
    }
}

/**
 * Obtiene el rango de fechas según la selección del usuario
 * @returns {Object} Objeto con fechas de inicio y fin
 */
function getDateRangeFromSelection() {
    const now = new Date();
    let startDate = new Date();
    let endDate = new Date();
    
    switch (currentDateRange) {
        case 'day':
            startDate.setHours(0, 0, 0, 0);
            endDate.setHours(23, 59, 59, 999);
            break;
            
        case 'yesterday': 
            startDate.setDate(now.getDate() - 1);
            startDate.setHours(0, 0, 0, 0);
            endDate.setDate(now.getDate() - 1);
            endDate.setHours(23, 59, 59, 999);
            break;
            
        case 'week':
            // Inicio de la semana (lunes)
            const dayOfWeek = now.getDay() || 7; // Domingo es 0, lo convertimos a 7
            startDate.setDate(now.getDate() - dayOfWeek + 1);
            startDate.setHours(0, 0, 0, 0);
            endDate.setHours(23, 59, 59, 999);
            break;
            
        case 'last-week':
            // Semana anterior
            const lastDayOfWeek = now.getDay() || 7;
            startDate.setDate(now.getDate() - lastDayOfWeek - 6);
            startDate.setHours(0, 0, 0, 0);
            endDate.setDate(now.getDate() - lastDayOfWeek);
            endDate.setHours(23, 59, 59, 999);
            break;
            
        case 'month':
            startDate.setDate(1);
            startDate.setHours(0, 0, 0, 0);
            endDate.setHours(23, 59, 59, 999);
            break;
            
        case 'last-month':
            startDate.setMonth(now.getMonth() - 1);
            startDate.setDate(1);
            startDate.setHours(0, 0, 0, 0);
            endDate.setDate(0); // Último día del mes anterior
            endDate.setHours(23, 59, 59, 999);
            break;
            
        case 'quarter':
            const currentQuarter = Math.floor(now.getMonth() / 3);
            startDate.setMonth(currentQuarter * 3);
            startDate.setDate(1);
            startDate.setHours(0, 0, 0, 0);
            endDate.setHours(23, 59, 59, 999);
            break;
            
        case 'year':
            startDate.setMonth(0);
            startDate.setDate(1);
            startDate.setHours(0, 0, 0, 0);
            endDate.setHours(23, 59, 59, 999);
            break;
            
        case 'custom':
            if (customDateStart && customDateEnd) {
                startDate = new Date(customDateStart);
                startDate.setHours(0, 0, 0, 0);
                endDate = new Date(customDateEnd);
                endDate.setHours(23, 59, 59, 999);
            }
            break;
    }
    
    return { startDate, endDate };
}

/**
 * Obtiene datos de ventas desde la base de datos
 * @param {Date} startDate - Fecha de inicio
 * @param {Date} endDate - Fecha de fin
 * @param {string} sucursalId - ID de sucursal o 'all' para todas
 * @returns {Promise<Object>} Datos de ventas
 */
async function fetchVentasData(startDate, endDate, sucursalId) {
    try {
        // Obtener instancia de la base de datos
        const db = await getDatabase();
        
        // Construir query base
        let query = `
            SELECT 
                v.id, v.fecha, v.total, v.metodoPago, v.sucursalId,
                s.nombre as sucursalNombre,
                c.id as clienteId, c.nombre as clienteNombre,
                vd.productoId, vd.cantidad, vd.precioUnitario, vd.subtotal,
                p.nombre as productoNombre, p.costo
            FROM ventas v
            LEFT JOIN clientes c ON v.clienteId = c.id
            LEFT JOIN sucursales s ON v.sucursalId = s.id
            LEFT JOIN ventaDetalle vd ON v.id = vd.ventaId
            LEFT JOIN productos p ON vd.productoId = p.id
            WHERE v.fecha BETWEEN ? AND ?
        `;
        
        // Añadir filtro por sucursal si es necesario
        const params = [startDate.toISOString(), endDate.toISOString()];
        if (sucursalId !== 'all') {
            query += ' AND v.sucursalId = ?';
            params.push(sucursalId);
        }
        
        // Ejecutar query
        const results = await db.all(query, params);
        
        // Procesar resultados
        const ventasPorPeriodo = procesarVentasPorPeriodo(results, startDate, endDate);
        const topProductos = calcularTopProductos(results);
        const metodosPago = calcularMetodosPago(results);
        const ventasPorSucursal = isMultiSucursal ? calcularVentasPorSucursal(results) : null;
        const totales = calcularTotales(results);
        
        return {
            ventasPorPeriodo,
            topProductos,
            metodosPago,
            ventasPorSucursal,
            totales,
            rawData: results,
            dateRange: { startDate, endDate }
        };
        
    } catch (error) {
        console.error('Error al obtener datos de ventas:', error);
        throw error;
    }
}

/**
 * Procesa los datos de ventas para agruparlos por período
 * @param {Array} data - Datos de ventas
 * @param {Date} startDate - Fecha de inicio
 * @param {Date} endDate - Fecha de fin
 * @returns {Object} Ventas agrupadas por período
 */
function procesarVentasPorPeriodo(data, startDate, endDate) {
    // Determinar el formato de fecha según el rango
    const diffDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
    
    let format, groupingFunction;
    
    if (diffDays <= 1) {
        // Por hora
        format = 'HH:00';
        groupingFunction = (date) => {
            return new Date(date).getHours() + ':00';
        };
    } else if (diffDays <= 31) {
        // Por día
        format = 'DD/MM';
        groupingFunction = (date) => {
            const d = new Date(date);
            return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}`;
        };
    } else if (diffDays <= 365) {
        // Por mes
        format = 'MMM YYYY';
        groupingFunction = (date) => {
            const d = new Date(date);
            const month = d.toLocaleString('default', { month: 'short' });
            return `${month} ${d.getFullYear()}`;
        };
    } else {
        // Por año
        format = 'YYYY';
        groupingFunction = (date) => {
            return new Date(date).getFullYear().toString();
        };
    }
    
    // Crear objeto para agrupar ventas
    const ventasPorPeriodo = {};
    
    // Si es por día, preparar todos los días en el rango
    if (diffDays <= 31 && diffDays > 1) {
        let currentDate = new Date(startDate);
        while (currentDate <= endDate) {
            const key = groupingFunction(currentDate);
            ventasPorPeriodo[key] = 0;
            currentDate.setDate(currentDate.getDate() + 1);
        }
    }
    
    // Si es por hora, preparar todas las horas
    if (diffDays <= 1) {
        for (let hora = 0; hora < 24; hora++) {
            const key = `${hora}:00`;
            ventasPorPeriodo[key] = 0;
        }
    }
    
    // Procesar cada venta
    const ventasIds = new Set();
    
    data.forEach(row => {
        // Evitar duplicados (por el JOIN con ventaDetalle)
        if (ventasIds.has(row.id)) return;
        ventasIds.add(row.id);
        
        const periodo = groupingFunction(row.fecha);
        
        if (!ventasPorPeriodo[periodo]) {
            ventasPorPeriodo[periodo] = 0;
        }
        
        ventasPorPeriodo[periodo] += row.total;
    });
    
    return {
        format,
        data: ventasPorPeriodo
    };
}

/**
 * Calcula los productos más vendidos
 * @param {Array} data - Datos de ventas
 * @returns {Array} Lista de productos con cantidad y monto vendido
 */
function calcularTopProductos(data) {
    const productosMap = new Map();
    
    data.forEach(row => {
        if (!row.productoId) return;
        
        const key = row.productoId;
        if (!productosMap.has(key)) {
            productosMap.set(key, {
                id: row.productoId,
                nombre: row.productoNombre,
                cantidad: 0,
                monto: 0,
                margen: 0
            });
        }
        
        const producto = productosMap.get(key);
        producto.cantidad += row.cantidad;
        producto.monto += row.subtotal;
        
        // Calcular margen si hay información de costo
        if (row.costo) {
            const costoTotal = row.costo * row.cantidad;
            producto.margen += row.subtotal - costoTotal;
        }
    });
    
    // Convertir a array y ordenar por monto
    return Array.from(productosMap.values())
        .sort((a, b) => b.monto - a.monto)
        .slice(0, 10); // Top 10
}

/**
 * Calcula las ventas por método de pago
 * @param {Array} data - Datos de ventas
 * @returns {Object} Ventas agrupadas por método de pago
 */
function calcularMetodosPago(data) {
    const metodosPago = {};
    const ventasIds = new Set();
    
    data.forEach(row => {
        // Evitar duplicados (por el JOIN con ventaDetalle)
        if (ventasIds.has(row.id)) return;
        ventasIds.add(row.id);
        
        const metodo = row.metodoPago || 'No especificado';
        
        if (!metodosPago[metodo]) {
            metodosPago[metodo] = 0;
        }
        
        metodosPago[metodo] += row.total;
    });
    
    return metodosPago;
}

/**
 * Calcula ventas por sucursal
 * @param {Array} data - Datos de ventas
 * @returns {Object} Ventas agrupadas por sucursal
 */
function calcularVentasPorSucursal(data) {
    const ventasPorSucursal = {};
    const ventasIds = new Set();
    
    data.forEach(row => {
        // Evitar duplicados (por el JOIN con ventaDetalle)
        if (ventasIds.has(row.id)) return;
        ventasIds.add(row.id);
        
        const sucursal = row.sucursalNombre || `Sucursal ${row.sucursalId}` || 'Desconocida';
        
        if (!ventasPorSucursal[sucursal]) {
            ventasPorSucursal[sucursal] = 0;
        }
        
        ventasPorSucursal[sucursal] += row.total;
    });
    
    return ventasPorSucursal;
}

/**
 * Calcula totales y métricas principales
 * @param {Array} data - Datos de ventas
 * @returns {Object} Totales y métricas
 */
function calcularTotales(data) {
    const ventasIds = new Set();
    let totalVentas = 0;
    let totalTransacciones = 0;
    let totalCosto = 0;
    
    data.forEach(row => {
        // Para total de ventas y transacciones, evitar duplicados
        if (!ventasIds.has(row.id) && row.id) {
            ventasIds.add(row.id);
            totalVentas += row.total;
            totalTransacciones++;
        }
        
        // Calcular costo total de productos
        if (row.costo && row.cantidad) {
            totalCosto += (row.costo * row.cantidad);
        }
    });
    
    // Calcular ticket promedio
    const ticketPromedio = totalTransacciones > 0 ? totalVentas / totalTransacciones : 0;
    
    // Calcular margen promedio
    const margenTotal = totalVentas - totalCosto;
    const margenPorcentaje = totalVentas > 0 ? (margenTotal / totalVentas) * 100 : 0;
    
    return {
        totalVentas,
        totalTransacciones,
        ticketPromedio,
        margenPorcentaje
    };
}

/**
 * Actualiza el resumen de estadísticas en la UI
 * @param {Object} data - Datos procesados de ventas
 */
function updateStatsSummary(data) {
    const { totalVentas, totalTransacciones, ticketPromedio, margenPorcentaje } = data.totales;
    
    // Actualizar elementos de la UI
    document.getElementById('total-ventas').textContent = formatCurrency(totalVentas);
    document.getElementById('total-transacciones').textContent = formatNumber(totalTransacciones);
    document.getElementById('ticket-promedio').textContent = formatCurrency(ticketPromedio);
    document.getElementById('margen-promedio').textContent = `${margenPorcentaje.toFixed(2)}%`;
    
    // Si hay datos anteriores para comparar, actualizar indicadores de cambio
    if (data.previousPeriod) {
        updateChangeIndicators(data);
    } else {
        // Si no hay datos anteriores, mostrar indicadores neutrales
        document.getElementById('change-ventas').innerHTML = '<span class="neutral">--</span>';
        document.getElementById('change-transacciones').innerHTML = '<span class="neutral">--</span>';
        document.getElementById('change-ticket').innerHTML = '<span class="neutral">--</span>';
        document.getElementById('change-margen').innerHTML = '<span class="neutral">--</span>';
    }
}

/**
 * Actualiza indicadores de cambio entre períodos
 * @param {Object} data - Datos con período actual y anterior
 */
function updateChangeIndicators(data) {
    const current = data.totales;
    const previous = data.previousPeriod.totales;
    
    // Calcular cambios
    const ventasChange = previous.totalVentas > 0 ? 
        ((current.totalVentas - previous.totalVentas) / previous.totalVentas) * 100 : 0;
    
    const transaccionesChange = previous.totalTransacciones > 0 ? 
        ((current.totalTransacciones - previous.totalTransacciones) / previous.totalTransacciones) * 100 : 0;
    
    const ticketChange = previous.ticketPromedio > 0 ? 
        ((current.ticketPromedio - previous.ticketPromedio) / previous.ticketPromedio) * 100 : 0;
    
    const margenChange = previous.margenPorcentaje > 0 ? 
        (current.margenPorcentaje - previous.margenPorcentaje) : 0;
    
    // Actualizar elementos de la UI
    updateChangeElement('change-ventas', ventasChange);
    updateChangeElement('change-transacciones', transaccionesChange);
    updateChangeElement('change-ticket', ticketChange);
    updateChangeElement('change-margen', margenChange, true);
}

/**
 * Actualiza un elemento de cambio con formato y color
 * @param {string} elementId - ID del elemento a actualizar
 * @param {number} changeValue - Valor del cambio
 * @param {boolean} isAbsolute - Si es un cambio absoluto o porcentual
 */
function updateChangeElement(elementId, changeValue, isAbsolute = false) {
    const element = document.getElementById(elementId);
    if (!element) return;
    
    let displayValue;
    let cssClass;
    
    if (isAbsolute) {
        displayValue = `${changeValue > 0 ? '+' : ''}${changeValue.toFixed(2)}%`;
    } else {
        displayValue = `${changeValue > 0 ? '+' : ''}${changeValue.toFixed(2)}%`;
    }
    
    if (changeValue > 0) {
        cssClass = 'positive';
    } else if (changeValue < 0) {
        cssClass = 'negative';
    } else {
        cssClass = 'neutral';
    }
    
    element.innerHTML = `<span class="${cssClass}">${displayValue}</span>`;
}

/**
 * Actualiza el gráfico de ventas por período
 * @param {Object} data - Datos procesados de ventas
 */
function updateVentasChart(data) {
    const ventasPorPeriodo = data.ventasPorPeriodo;
    
    // Obtener labels y valores ordenados
    const labels = Object.keys(ventasPorPeriodo.data);
    const values = labels.map(label => ventasPorPeriodo.data[label]);
    
    // Actualizar chart
    updateChart(ventasChart, {
        labels: labels,
        datasets: [{
            label: 'Ventas',
            data: values,
            borderColor: '#4a6cf7',
            backgroundColor: 'rgba(74, 108, 247, 0.1)',
            tension: 0.3,
            fill: true
        }]
    });
}

/**
 * Actualiza el gráfico de productos más vendidos
 * @param {Object} data - Datos procesados de ventas
 */
function updateProductsChart(data) {
    const topProductos = data.topProductos;
    
    // Limitar a 5 productos para el gráfico
    const topProductosChart = topProductos.slice(0, 5);
    
    // Datos para el gráfico
    const labels = topProductosChart.map(p => p.nombre);
    const values = topProductosChart.map(p => p.monto);
    
    // Actualizar chart
    updateChart(productsChart, {
        labels: labels,
        datasets: [{
            data: values,
            backgroundColor: [
                '#4a6cf7', '#6c5ce7', '#00cec9', '#0984e3', '#e84393'
            ]
        }]
    });
    
    // Actualizar lista de productos
    updateTopProductsList(topProductos);
}

/**
 * Actualiza la lista de top productos
 * @param {Array} topProductos - Lista de productos más vendidos
 */
function updateTopProductsList(topProductos) {
    if (!topProductsList) return;
    
    let html = '<table class="top-products-table">';
    html += '<thead><tr><th>Producto</th><th>Cantidad</th><th>Monto</th></tr></thead>';
    html += '<tbody>';
    
    topProductos.forEach((producto, index) => {
        html += `<tr>
            <td>${producto.nombre}</td>
            <td>${formatNumber(producto.cantidad)}</td>
            <td>${formatCurrency(producto.monto)}</td>
        </tr>`;
    });
    
    html += '</tbody></table>';
    topProductsList.innerHTML = html;
}

/**
 * Actualiza el gráfico de métodos de pago
 * @param {Object} data - Datos procesados de ventas
 */
function updatePaymentMethodsChart(data) {
    const metodosPago = data.metodosPago;
    
    // Datos para el gráfico
    const labels = Object.keys(metodosPago);
    const values = labels.map(label => metodosPago[label]);
    
    // Mapear nombres de métodos de pago para mejor visualización
    const mappedLabels = labels.map(label => {
        switch(label) {
            case 'efectivo': return 'Efectivo';
            case 'tarjeta_credito': return 'Tarjeta de Crédito';
            case 'tarjeta_debito': return 'Tarjeta de Débito';
            case 'transferencia': return 'Transferencia';
            case 'mercadopago': return 'Mercado Pago';
            case 'mercadopago_qr': return 'QR Mercado Pago';
            default: return label;
        }
    });
    
    // Actualizar chart
    updateChart(paymentMethodsChart, {
        labels: mappedLabels,
        datasets: [{
            data: values,
            backgroundColor: [
                '#00b894', '#0984e3', '#6c5ce7', '#fdcb6e', '#e84393', '#d63031'
            ]
        }]
    });
}

/**
 * Actualiza el gráfico de comparativa entre sucursales
 * @param {Object} data - Datos procesados de ventas
 */
function updateSucursalesChart(data) {
    if (!isMultiSucursal || !data.ventasPorSucursal) return;
    
    const sucursalesChart = document.getElementById('sucursales-chart');
    if (!sucursalesChart) return;
    
    const ventasPorSucursal = data.ventasPorSucursal;
    
    // Datos para el gráfico
    const labels = Object.keys(ventasPorSucursal);
    const values = labels.map(label => ventasPorSucursal[label]);
    
    // Actualizar chart
    updateChart(sucursalesChart, {
        labels: labels,
        datasets: [{
            label: 'Ventas por Sucursal',
            data: values,
            backgroundColor: [
                '#00b894', '#4a6cf7', '#6c5ce7', '#0984e3', '#e84393', 
                '#00cec9', '#fdcb6e', '#e17055', '#d63031', '#636e72'
            ]
        }]
    });
}

/**
 * Actualiza el gráfico comparativo entre períodos
 * @param {string} comparativeType - Tipo de comparativa ('previous' o 'last-year')
 */
async function refreshComparativeChart(comparativeType) {
    try {
        if (comparativeType === 'none') {
            // Ocultar o limpiar el gráfico comparativo
            updateChart(comparativeChart, {
                labels: [],
                datasets: [
                    {
                        label: 'Período actual',
                        backgroundColor: '#4a6cf7',
                        data: []
                    },
                    {
                        label: 'Período anterior',
                        backgroundColor: '#6c5ce7',
                        data: []
                    }
                ]
            });
            return;
        }
        
        // Determinar el rango de fechas anterior
        const currentRange = getDateRangeFromSelection();
        const previousRange = getPreviousDateRange(currentRange, comparativeType);
        
        // Obtener datos del período anterior
        const previousData = await fetchVentasData(
            previousRange.startDate, 
            previousRange.endDate, 
            currentSucursal
        );
        
        // Guardar datos del período anterior en los datos actuales
        chartData.previousPeriod = previousData;
        
        // Actualizar indicadores de cambio
        updateChangeIndicators(chartData);
        
        // Actualizar gráfico comparativo
        updateComparativeChart(chartData, previousData);
        
    } catch (error) {
        console.error('Error al actualizar gráfico comparativo:', error);
        showNotification('Error al cargar datos comparativos', 'error');
    }
}

/**
 * Obtiene el rango de fechas anterior
 * @param {Object} currentRange - Rango de fechas actual
 * @param {string} comparativeType - Tipo de comparativa
 * @returns {Object} Rango de fechas anterior
 */
function getPreviousDateRange(currentRange, comparativeType) {
    const { startDate, endDate } = currentRange;
    
    // Calcular duración del período actual
    const durationMs = endDate.getTime() - startDate.getTime();
    
    // Crear nuevas fechas para el período anterior
    let previousStartDate = new Date(startDate);
    let previousEndDate = new Date(endDate);
    
    if (comparativeType === 'previous') {
        // Período inmediatamente anterior de la misma duración
        previousStartDate = new Date(startDate.getTime() - durationMs);
        previousEndDate = new Date(endDate.getTime() - durationMs);
    } else if (comparativeType === 'last-year') {
        // Mismo período del año anterior
        previousStartDate.setFullYear(startDate.getFullYear() - 1);
        previousEndDate.setFullYear(endDate.getFullYear() - 1);
    }
    
    return { startDate: previousStartDate, endDate: previousEndDate };
}

/**
 * Actualiza el gráfico comparativo
 * @param {Object} currentData - Datos del período actual
 * @param {Object} previousData - Datos del período anterior
 */
function updateComparativeChart(currentData, previousData) {
    // Si usamos datos de ventas por período
    const currentPeriods = Object.keys(currentData.ventasPorPeriodo.data);
    const previousPeriods = Object.keys(previousData.ventasPorPeriodo.data);
    
    // Determinar etiquetas comunes o usar sólo las actuales
    // Para simplificar, usamos sólo etiquetas como "Semana 1", "Semana 2", etc.
    const numPeriods = Math.max(currentPeriods.length, previousPeriods.length);
    const labels = Array.from({ length: numPeriods }, (_, i) => `Período ${i + 1}`);
    
    // Valores agrupados por período
    const currentValues = groupDataByPeriods(currentData.ventasPorPeriodo.data, numPeriods);
    const previousValues = groupDataByPeriods(previousData.ventasPorPeriodo.data, numPeriods);
    
    // Actualizar chart
    updateChart(comparativeChart, {
        labels: labels,
        datasets: [
            {
                label: 'Período actual',
                backgroundColor: '#4a6cf7',
                data: currentValues
            },
            {
                label: 'Período anterior',
                backgroundColor: '#6c5ce7',
                data: previousValues
            }
        ]
    });
}

/**
 * Agrupa datos por períodos para visualización comparativa
 * @param {Object} data - Datos de ventas por período
 * @param {number} numPeriods - Número de períodos a mostrar
 * @returns {Array} Valores agrupados por período
 */
function groupDataByPeriods(data, numPeriods) {
    const values = Object.values(data);
    const result = Array(numPeriods).fill(0);
    
    // Si hay más valores que períodos, agrupar
    if (values.length > numPeriods) {
        const periodSize = Math.ceil(values.length / numPeriods);
        for (let i = 0; i < numPeriods; i++) {
            const start = i * periodSize;
            const end = Math.min(start + periodSize, values.length);
            const sum = values.slice(start, end).reduce((a, b) => a + b, 0);
            result[i] = sum;
        }
    } else {
        // Si hay menos valores que períodos, rellenar los disponibles
        for (let i = 0; i < values.length; i++) {
            result[i] = values[i];
        }
    }
    
    return result;
}

/**
 * Exporta las estadísticas a PDF
 */
async function exportStatistics() {
    try {
        // Verificar que tengamos datos
        if (!chartData || !chartData.ventasPorPeriodo) {
            showNotification('No hay datos disponibles para exportar', 'warning');
            return;
        }
        
        // Crear contenido para el PDF
        const content = {
            title: 'Estadísticas de Ventas',
            dateRange: `Del ${formatDate(chartData.dateRange.startDate)} al ${formatDate(chartData.dateRange.endDate)}`,
            sucursal: currentSucursal === 'all' ? 'Todas las sucursales' : `Sucursal: ${getSucursalName(currentSucursal)}`,
            totales: chartData.totales,
            ventasPorPeriodo: chartData.ventasPorPeriodo,
            topProductos: chartData.topProductos,
            metodosPago: chartData.metodosPago,
            ventasPorSucursal: chartData.ventasPorSucursal,
            charts: {
                ventasChart: ventasChart,
                productsChart: productsChart,
                paymentMethodsChart: paymentMethodsChart,
                comparativeChart: comparativeChart
            }
        };
        
        // Exportar a PDF
        const filename = `estadisticas_ventas_${formatDateForFilename(new Date())}.pdf`;
        await exportToPDF(content, filename, 'ventas-estadisticas');
        
        showNotification('Estadísticas exportadas correctamente', 'success');
        
    } catch (error) {
        console.error('Error al exportar estadísticas:', error);
        showNotification('Error al exportar estadísticas', 'error');
    }
}

/**
 * Obtiene el nombre de una sucursal por su ID
 * @param {string} sucursalId - ID de la sucursal
 * @returns {Promise<string>} Nombre de la sucursal
 */
async function getSucursalName(sucursalId) {
    try {
        const allSucursales = await getAllSucursales();
        const sucursal = allSucursales.find(s => s.id === sucursalId);
        return sucursal ? sucursal.nombre : `Sucursal ${sucursalId}`;
    } catch (error) {
        console.error('Error al obtener nombre de sucursal:', error);
        return `Sucursal ${sucursalId}`;
    }
}

/**
 * Formatea una fecha para incluir en nombre de archivo
 * @param {Date} date - Fecha a formatear
 * @returns {string} Fecha formateada
 */
function formatDateForFilename(date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}${month}${day}`;
}

/**
 * Formatea una fecha para input de tipo date
 * @param {Date} date - Fecha a formatear
 * @returns {string} Fecha formateada YYYY-MM-DD
 */
function formatDateForInput(date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Exportar funciones públicas
export default {
    init,
    refreshData,
    exportStatistics
};