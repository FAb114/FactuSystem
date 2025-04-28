/**
 * Módulo de Reportes de Stock
 * FactuSystem - Sistema de Facturación y Gestión Comercial
 * 
 * Este módulo se encarga de generar y mostrar reportes relacionados con el inventario
 * incluyendo niveles actuales de stock, productos críticos, rotación de inventario,
 * y predicciones de reabastecimiento.
 */

// Importaciones de módulos y utilidades
import { Database } from '../../../utils/database.js';
import { ValidationUtils } from '../../../utils/validation.js';
import { exportToPDF } from '../../../utils/printer.js';
import { getAuthenticatedUser, checkPermission } from '../../../utils/auth.js';
import { logger } from '../../../utils/logger.js';
import { DateUtils } from '../../../utils/dateUtils.js';
import { ChartUtils } from '../../../utils/chartUtils.js';
import { SyncManager } from '../../../utils/sync.js';
import { NotificationManager } from '../../../components/notifications.js';
import { TabManager } from '../../../components/tabs.js';

class StockReportModule {
    constructor() {
        this.db = new Database();
        this.currentUser = getAuthenticatedUser();
        this.selectedSucursal = this.currentUser.currentSucursal;
        this.chartData = {};
        this.reportData = {};
        this.filterOptions = {
            startDate: DateUtils.getFirstDayOfMonth(),
            endDate: DateUtils.getCurrentDate(),
            categoria: 'todas',
            sucursal: this.selectedSucursal,
            stockMinimo: false,
            stockMaximo: false,
            sinRotacion: false,
            soloActivos: true
        };
        
        // Referencia al contenedor principal del módulo
        this.container = document.getElementById('stock-report-container');
        
        // Verificar permisos
        if (!checkPermission('reportes.stock.view')) {
            NotificationManager.showError('No tiene permisos para acceder a los reportes de stock');
            TabManager.closeCurrentTab();
            return;
        }
        
        this.init();
    }
    
    /**
     * Inicializa el módulo de reportes de stock
     */
    async init() {
        try {
            logger.info('Inicializando módulo de reportes de stock');
            
            this.renderUI();
            this.attachEventListeners();
            
            // Cargar datos iniciales
            await this.loadCategories();
            await this.loadSucursales();
            await this.generateReport();
            
            // Inicializar componentes UI avanzados
            this.initDateRangePicker();
        } catch (error) {
            logger.error('Error al inicializar el módulo de reportes de stock', error);
            NotificationManager.showError('Error al cargar el módulo de reportes de stock');
        }
    }
    
    /**
     * Renderiza la interfaz del módulo
     */
    renderUI() {
        if (!this.container) {
            logger.error('No se encontró el contenedor para el módulo de reportes de stock');
            return;
        }
        
        // Construir la interfaz del módulo
        this.container.innerHTML = `
            <div class="module-header">
                <h2><i class="fas fa-boxes"></i> Reporte de Stock</h2>
                <div class="module-actions">
                    <button id="btn-refresh-stock" class="btn btn-outline"><i class="fas fa-sync-alt"></i> Actualizar</button>
                    <button id="btn-export-stock-pdf" class="btn btn-primary"><i class="fas fa-file-pdf"></i> Exportar PDF</button>
                </div>
            </div>
            
            <div class="filter-container">
                <div class="filter-row">
                    <div class="filter-group">
                        <label for="stock-date-range">Período:</label>
                        <div id="stock-date-range" class="date-range-picker">
                            <input type="date" id="stock-start-date" class="form-control">
                            <span>hasta</span>
                            <input type="date" id="stock-end-date" class="form-control">
                        </div>
                    </div>
                    
                    <div class="filter-group">
                        <label for="stock-category">Categoría:</label>
                        <select id="stock-category" class="form-control">
                            <option value="todas">Todas las categorías</option>
                            <!-- Se completará dinámicamente -->
                        </select>
                    </div>
                    
                    <div class="filter-group">
                        <label for="stock-sucursal">Sucursal:</label>
                        <select id="stock-sucursal" class="form-control">
                            <!-- Se completará dinámicamente -->
                        </select>
                    </div>
                </div>
                
                <div class="filter-row">
                    <div class="filter-group check-group">
                        <input type="checkbox" id="stock-min-check" class="form-check">
                        <label for="stock-min-check">Stock mínimo</label>
                    </div>
                    
                    <div class="filter-group check-group">
                        <input type="checkbox" id="stock-max-check" class="form-check">
                        <label for="stock-max-check">Stock máximo</label>
                    </div>
                    
                    <div class="filter-group check-group">
                        <input type="checkbox" id="stock-no-rotation-check" class="form-check">
                        <label for="stock-no-rotation-check">Sin rotación</label>
                    </div>
                    
                    <div class="filter-group check-group">
                        <input type="checkbox" id="stock-only-active-check" class="form-check" checked>
                        <label for="stock-only-active-check">Solo productos activos</label>
                    </div>
                    
                    <div class="filter-group">
                        <button id="btn-apply-stock-filters" class="btn btn-secondary"><i class="fas fa-filter"></i> Aplicar filtros</button>
                    </div>
                </div>
            </div>
            
            <div class="stock-dashboard">
                <div class="stock-summary-cards">
                    <div class="summary-card">
                        <div class="card-icon"><i class="fas fa-cubes"></i></div>
                        <div class="card-content">
                            <h3>Total productos</h3>
                            <p id="stock-total-products">0</p>
                        </div>
                    </div>
                    
                    <div class="summary-card warning">
                        <div class="card-icon"><i class="fas fa-exclamation-triangle"></i></div>
                        <div class="card-content">
                            <h3>Stock crítico</h3>
                            <p id="stock-critical-count">0</p>
                        </div>
                    </div>
                    
                    <div class="summary-card danger">
                        <div class="card-icon"><i class="fas fa-times-circle"></i></div>
                        <div class="card-content">
                            <h3>Sin stock</h3>
                            <p id="stock-zero-count">0</p>
                        </div>
                    </div>
                    
                    <div class="summary-card info">
                        <div class="card-icon"><i class="fas fa-dollar-sign"></i></div>
                        <div class="card-content">
                            <h3>Valor de inventario</h3>
                            <p id="stock-total-value">$0.00</p>
                        </div>
                    </div>
                </div>
                
                <div class="stock-charts-container">
                    <div class="chart-container">
                        <h3>Distribución de Stock por Categoría</h3>
                        <canvas id="stock-category-chart"></canvas>
                    </div>
                    
                    <div class="chart-container">
                        <h3>Productos con Mayor Rotación</h3>
                        <canvas id="stock-rotation-chart"></canvas>
                    </div>
                </div>
                
                <div class="stock-table-container">
                    <h3>Listado de Productos</h3>
                    <div class="table-responsive">
                        <table id="stock-products-table" class="data-table">
                            <thead>
                                <tr>
                                    <th>Código</th>
                                    <th>Producto</th>
                                    <th>Categoría</th>
                                    <th>Stock Actual</th>
                                    <th>Stock Mínimo</th>
                                    <th>Stock Máximo</th>
                                    <th>Rotación</th>
                                    <th>Último Movimiento</th>
                                    <th>Valor Unitario</th>
                                    <th>Valor Total</th>
                                    <th>Estado</th>
                                </tr>
                            </thead>
                            <tbody id="stock-products-tbody">
                                <!-- Se completará dinámicamente -->
                                <tr>
                                    <td colspan="11" class="table-empty-message">Cargando datos...</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    
                    <div class="pagination-container">
                        <div class="pagination-info">
                            Mostrando <span id="stock-current-page-info">0-0</span> de <span id="stock-total-records">0</span> productos
                        </div>
                        <div class="pagination-controls">
                            <button id="stock-prev-page" class="btn btn-sm" disabled><i class="fas fa-chevron-left"></i></button>
                            <span id="stock-current-page">1</span>
                            <button id="stock-next-page" class="btn btn-sm" disabled><i class="fas fa-chevron-right"></i></button>
                        </div>
                    </div>
                </div>
                
                <div class="stock-alerts-container">
                    <h3>Productos que requieren atención</h3>
                    <div id="stock-alerts-list" class="alerts-list">
                        <!-- Se completará dinámicamente -->
                        <p class="empty-list-message">Cargando alertas...</p>
                    </div>
                </div>
                
                <div class="stock-prediction-container">
                    <h3>Predicción de Reabastecimiento</h3>
                    <div class="table-responsive">
                        <table id="stock-prediction-table" class="data-table">
                            <thead>
                                <tr>
                                    <th>Producto</th>
                                    <th>Stock Actual</th>
                                    <th>Ventas Promedio</th>
                                    <th>Días Restantes</th>
                                    <th>Fecha Estimada</th>
                                    <th>Cantidad Sugerida</th>
                                </tr>
                            </thead>
                            <tbody id="stock-prediction-tbody">
                                <!-- Se completará dinámicamente -->
                                <tr>
                                    <td colspan="6" class="table-empty-message">Cargando predicciones...</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    }
    
    /**
     * Adjunta event listeners a los elementos de la interfaz
     */
    attachEventListeners() {
        // Botones principales
        const refreshButton = document.getElementById('btn-refresh-stock');
        if (refreshButton) {
            refreshButton.addEventListener('click', () => this.generateReport());
        }
        
        const exportButton = document.getElementById('btn-export-stock-pdf');
        if (exportButton) {
            exportButton.addEventListener('click', () => this.exportReportToPDF());
        }
        
        // Filtros
        const applyFiltersButton = document.getElementById('btn-apply-stock-filters');
        if (applyFiltersButton) {
            applyFiltersButton.addEventListener('click', () => this.applyFilters());
        }
        
        // Checkboxes
        const stockMinCheck = document.getElementById('stock-min-check');
        if (stockMinCheck) {
            stockMinCheck.addEventListener('change', (e) => {
                this.filterOptions.stockMinimo = e.target.checked;
            });
        }
        
        const stockMaxCheck = document.getElementById('stock-max-check');
        if (stockMaxCheck) {
            stockMaxCheck.addEventListener('change', (e) => {
                this.filterOptions.stockMaximo = e.target.checked;
            });
        }
        
        const noRotationCheck = document.getElementById('stock-no-rotation-check');
        if (noRotationCheck) {
            noRotationCheck.addEventListener('change', (e) => {
                this.filterOptions.sinRotacion = e.target.checked;
            });
        }
        
        const onlyActiveCheck = document.getElementById('stock-only-active-check');
        if (onlyActiveCheck) {
            onlyActiveCheck.addEventListener('change', (e) => {
                this.filterOptions.soloActivos = e.target.checked;
            });
        }
        
        // Selectores
        const categorySelect = document.getElementById('stock-category');
        if (categorySelect) {
            categorySelect.addEventListener('change', (e) => {
                this.filterOptions.categoria = e.target.value;
            });
        }
        
        const sucursalSelect = document.getElementById('stock-sucursal');
        if (sucursalSelect) {
            sucursalSelect.addEventListener('change', (e) => {
                this.filterOptions.sucursal = e.target.value;
            });
        }
        
        // Paginación
        const prevPageButton = document.getElementById('stock-prev-page');
        if (prevPageButton) {
            prevPageButton.addEventListener('click', () => this.navigateToPage('prev'));
        }
        
        const nextPageButton = document.getElementById('stock-next-page');
        if (nextPageButton) {
            nextPageButton.addEventListener('click', () => this.navigateToPage('next'));
        }
    }
    
    /**
     * Inicializa el selector de rango de fechas
     */
    initDateRangePicker() {
        const startDateInput = document.getElementById('stock-start-date');
        const endDateInput = document.getElementById('stock-end-date');
        
        if (startDateInput && endDateInput) {
            // Establecer valores iniciales
            startDateInput.value = this.filterOptions.startDate;
            endDateInput.value = this.filterOptions.endDate;
            
            // Event listeners
            startDateInput.addEventListener('change', (e) => {
                this.filterOptions.startDate = e.target.value;
                // Asegurarse que la fecha de inicio no sea mayor que la fecha de fin
                if (e.target.value > this.filterOptions.endDate) {
                    this.filterOptions.endDate = e.target.value;
                    endDateInput.value = e.target.value;
                }
            });
            
            endDateInput.addEventListener('change', (e) => {
                this.filterOptions.endDate = e.target.value;
                // Asegurarse que la fecha de fin no sea menor que la fecha de inicio
                if (e.target.value < this.filterOptions.startDate) {
                    this.filterOptions.startDate = e.target.value;
                    startDateInput.value = e.target.value;
                }
            });
        }
    }
    
    /**
     * Carga las categorías de productos para el filtro
     */
    async loadCategories() {
        try {
            const categorySelect = document.getElementById('stock-category');
            if (!categorySelect) return;
            
            // Obtener las categorías de la base de datos
            const categories = await this.db.query(`
                SELECT DISTINCT categoria FROM productos 
                WHERE activo = 1 
                ORDER BY categoria ASC
            `);
            
            // Limpiar las opciones existentes excepto "Todas las categorías"
            while (categorySelect.options.length > 1) {
                categorySelect.remove(1);
            }
            
            // Agregar las categorías al selector
            categories.forEach(category => {
                const option = document.createElement('option');
                option.value = category.categoria;
                option.textContent = category.categoria;
                categorySelect.appendChild(option);
            });
            
        } catch (error) {
            logger.error('Error al cargar las categorías de productos', error);
            NotificationManager.showError('No se pudieron cargar las categorías');
        }
    }
    
    /**
     * Carga las sucursales disponibles para el filtro
     */
    async loadSucursales() {
        try {
            const sucursalSelect = document.getElementById('stock-sucursal');
            if (!sucursalSelect) return;
            
            // Obtener las sucursales de la base de datos
            const sucursales = await this.db.query(`
                SELECT id, nombre FROM sucursales 
                WHERE activo = 1 
                ORDER BY nombre ASC
            `);
            
            // Limpiar las opciones existentes
            sucursalSelect.innerHTML = '';
            
            // Agregar la opción para todas las sucursales si el usuario tiene permiso
            if (checkPermission('sucursales.verTodas')) {
                const allOption = document.createElement('option');
                allOption.value = 'todas';
                allOption.textContent = 'Todas las sucursales';
                sucursalSelect.appendChild(allOption);
            }
            
            // Agregar las sucursales al selector
            sucursales.forEach(sucursal => {
                const option = document.createElement('option');
                option.value = sucursal.id;
                option.textContent = sucursal.nombre;
                
                // Seleccionar la sucursal actual del usuario
                if (sucursal.id === this.selectedSucursal) {
                    option.selected = true;
                }
                
                sucursalSelect.appendChild(option);
            });
            
        } catch (error) {
            logger.error('Error al cargar las sucursales', error);
            NotificationManager.showError('No se pudieron cargar las sucursales');
        }
    }
    
    /**
     * Aplica los filtros seleccionados y regenera el reporte
     */
    applyFilters() {
        try {
            // Actualizar los filtros desde los controles de la UI
            const startDateInput = document.getElementById('stock-start-date');
            const endDateInput = document.getElementById('stock-end-date');
            
            if (startDateInput && endDateInput) {
                this.filterOptions.startDate = startDateInput.value;
                this.filterOptions.endDate = endDateInput.value;
            }
            
            // Regenerar el reporte con los filtros actualizados
            this.generateReport();
            
            // Registrar la aplicación de filtros
            logger.info('Filtros aplicados al reporte de stock', this.filterOptions);
            
        } catch (error) {
            logger.error('Error al aplicar los filtros', error);
            NotificationManager.showError('Error al aplicar los filtros');
        }
    }
    
    /**
     * Genera el reporte de stock con los filtros actuales
     */
    async generateReport() {
        try {
            NotificationManager.showInfo('Generando reporte de stock...');
            
            // 1. Obtener los datos de stock según los filtros
            await this.fetchStockData();
            
            // 2. Calcular las estadísticas de stock
            this.calculateStockStatistics();
            
            // 3. Actualizar la interfaz con los datos obtenidos
            this.updateUIWithReportData();
            
            // 4. Generar los gráficos
            this.generateStockCharts();
            
            // 5. Generar las alertas de stock
            this.generateStockAlerts();
            
            // 6. Generar las predicciones de reabastecimiento
            this.generateStockPredictions();
            
            // Notificar que el reporte se ha generado correctamente
            NotificationManager.showSuccess('Reporte de stock generado con éxito');
            
            // Registrar la generación del reporte
            logger.info('Reporte de stock generado', {
                usuario: this.currentUser.username,
                sucursal: this.filterOptions.sucursal,
                filtros: this.filterOptions
            });
            
        } catch (error) {
            logger.error('Error al generar el reporte de stock', error);
            NotificationManager.showError('Error al generar el reporte de stock');
        }
    }
    
    /**
     * Obtiene los datos de stock de la base de datos según los filtros actuales
     */
    async fetchStockData() {
        // Construir la consulta SQL base para los productos
        let query = `
            SELECT 
                p.codigo,
                p.nombre as producto,
                p.categoria,
                s.cantidad as stock_actual,
                p.stock_minimo,
                p.stock_maximo,
                p.precio_venta as valor_unitario,
                p.activo,
                (SELECT COUNT(*) FROM ventas_detalle vd 
                 JOIN ventas v ON vd.venta_id = v.id 
                 WHERE vd.producto_id = p.id 
                 AND v.fecha BETWEEN ? AND ?) as rotacion,
                (SELECT MAX(v.fecha) FROM ventas_detalle vd 
                 JOIN ventas v ON vd.venta_id = v.id 
                 WHERE vd.producto_id = p.id) as ultimo_movimiento
            FROM 
                productos p
            LEFT JOIN 
                stock s ON p.id = s.producto_id
        `;
        
        // Agregar condiciones según los filtros
        const whereConditions = [];
        const params = [this.filterOptions.startDate, this.filterOptions.endDate];
        
        // Filtrar por sucursal
        if (this.filterOptions.sucursal !== 'todas') {
            whereConditions.push('s.sucursal_id = ?');
            params.push(this.filterOptions.sucursal);
        }
        
        // Filtrar por categoría
        if (this.filterOptions.categoria !== 'todas') {
            whereConditions.push('p.categoria = ?');
            params.push(this.filterOptions.categoria);
        }
        
        // Filtrar por stock mínimo
        if (this.filterOptions.stockMinimo) {
            whereConditions.push('s.cantidad <= p.stock_minimo');
        }
        
        // Filtrar por stock máximo
        if (this.filterOptions.stockMaximo) {
            whereConditions.push('s.cantidad >= p.stock_maximo');
        }
        
        // Filtrar productos sin rotación
        if (this.filterOptions.sinRotacion) {
            whereConditions.push(`(SELECT COUNT(*) FROM ventas_detalle vd 
                JOIN ventas v ON vd.venta_id = v.id 
                WHERE vd.producto_id = p.id 
                AND v.fecha BETWEEN ? AND ?) = 0`);
            params.push(this.filterOptions.startDate, this.filterOptions.endDate);
        }
        
        // Filtrar solo productos activos
        if (this.filterOptions.soloActivos) {
            whereConditions.push('p.activo = 1');
        }
        
        // Construir la cláusula WHERE completa
        if (whereConditions.length > 0) {
            query += ` WHERE ${whereConditions.join(' AND ')}`;
        }
        
        // Ordenar por stock_actual (ascendente para priorizar los de menor stock)
        query += ' ORDER BY s.cantidad ASC';
        
        // Ejecutar la consulta
        this.reportData.productos = await this.db.query(query, params);
        
        // Calcular valores adicionales y formatear los datos
        this.reportData.productos = this.reportData.productos.map(producto => {
            return {
                ...producto,
                valor_total: producto.stock_actual * producto.valor_unitario,
                estado: this.getStockStatus(producto),
                ultimo_movimiento: producto.ultimo_movimiento ? DateUtils.formatDate(producto.ultimo_movimiento) : 'Sin movimientos',
                rotacion_nivel: this.calculateRotationLevel(producto.rotacion)
            };
        });
        
        // Obtener también datos para estadísticas y gráficos
        await this.fetchStockStatisticsData();
    }
    
    /**
     * Obtiene datos adicionales para estadísticas y gráficos
     */
    async fetchStockStatisticsData() {
        try {
            // Datos para el gráfico de categorías
            const categoryQuery = `
                SELECT 
                    p.categoria,
                    COUNT(p.id) as cantidad_productos,
                    SUM(s.cantidad) as cantidad_stock,
                    SUM(s.cantidad * p.precio_venta) as valor_total
                FROM 
                    productos p
                LEFT JOIN 
                    stock s ON p.id = s.producto_id
                WHERE 
                    p.activo = ?
                    ${this.filterOptions.sucursal !== 'todas' ? 'AND s.sucursal_id = ?' : ''}
                GROUP BY 
                    p.categoria
                ORDER BY 
                    cantidad_stock DESC
            `;
            
            const categoryParams = [
                this.filterOptions.soloActivos ? 1 : 0
            ];
            
            if (this.filterOptions.sucursal !== 'todas') {
                categoryParams.push(this.filterOptions.sucursal);
            }
            
            this.chartData.categorias = await this.db.query(categoryQuery, categoryParams);
            
            // Datos para el gráfico de rotación
            const rotationQuery = `
                SELECT 
                    p.nombre as producto,
                    COUNT(vd.id) as cantidad_vendida
                FROM 
                    productos p
                JOIN 
                    ventas_detalle vd ON p.id = vd.producto_id
                JOIN 
                    ventas v ON vd.venta_id = v.id
                WHERE 
                    v.fecha BETWEEN ? AND ?
                    ${this.filterOptions.sucursal !== 'todas' ? 'AND v.sucursal_id = ?' : ''}
                GROUP BY 
                    p.id
                ORDER BY 
                    cantidad_vendida DESC
                LIMIT 10
            `;
            
            const rotationParams = [
                this.filterOptions.startDate,
                this.filterOptions.endDate
            ];
            
            if (this.filterOptions.sucursal !== 'todas') {
                rotationParams.push(this.filterOptions.sucursal);
            }
            
            this.chartData.rotacion = await this.db.query(rotationQuery, rotationParams);
            
        } catch (error) {
            logger.error('Error al obtener datos estadísticos de stock', error);
            throw error;
        }
    }
    
    /**
     * Calcula estadísticas generales sobre el stock
     */
    calculateStockStatistics() {
        try {
            const productos = this.reportData.productos;
            
            // Inicializar estadísticas
            this.reportData.estadisticas = {
                totalProductos: productos.length,
                stockCritico: 0,
                sinStock: 0,
                valorInventarioTotal: 0
            };
            
            // Calcular estadísticas
            productos.forEach(producto => {
                // Sumar al valor total del inventario
                this.reportData.estadisticas.valorInventarioTotal += producto.valor_total;
                
                // Contar productos con stock crítico
                if (producto.stock_actual <= producto.stock_minimo && producto.stock_actual > 0) {
                    this.reportData.estadisticas.stockCritico++;
                }
                
                // Contar productos sin stock
                if (producto.stock_actual === 0) {
                    this.reportData.estadisticas.sinStock++;
                }
            });
            
            // Formatear valor del inventario
            this.reportData.estadisticas.valorInventarioFormateado = new Intl.NumberFormat('es-AR', {
                style: 'currency',
                currency: 'ARS'
            }).format(this.reportData.estadisticas.valorInventarioTotal);
            
        } catch (error) {
            logger.error('Error al calcular estadísticas de stock', error);
            throw error;
        }
    }
    
    /**
     * Actualiza la interfaz con los datos del reporte
     */
    updateUIWithReportData() {
        try {
            // Actualizar las tarjetas de resumen
            const totalProductsElement = document.getElementById('stock-total-products');
            const criticalCountElement = document.getElementById('stock-critical-count');
            const zeroCountElement = document.getElementById('stock-zero-count');
            const totalValueElement = document.getElementById('stock-total-value');
            
            if (totalProductsElement) {
                totalProductsElement.textContent = this.reportData.estadisticas.totalProductos;
            }
            
            if (criticalCountElement) {
                criticalCountElement.textContent = this.reportData.estadisticas.stockCritico;
            }
            
            if (zeroCountElement) {
                zeroCountElement.textContent = this.reportData.estadisticas.sinStock;
            }
            
            if (totalValueElement) {
                totalValueElement.textContent = this.reportData.estadisticas.valorInventarioFormateado;
            }
            
            // Actualizar la tabla de productos
            this.updateProductsTable();
            
        } catch (error) {
            logger.error('Error al actualizar la interfaz con los datos del reporte', error);
            throw error;
        }
    }
    
    /**
     * Actualiza la tabla de productos con los datos del reporte
     */
    updateProductsTable() {
        const tbodyElement = document.getElementById('stock-products-tbody');
        if (!tbodyElement) return;
        
        // Limpiar la tabla
        tbodyElement.innerHTML = '';
        
        // Verificar si hay productos
        if (this.reportData.productos.length === 0) {
            tbodyElement.innerHTML = `
                <tr>
                    <td colspan="11" class="table-empty-message">No se encontraron productos con los filtros seleccionados</td>
                </tr>
            `;
            return;
        }
        
        // Configurar paginación
        this.paginationConfig = {
            totalItems: this.reportData.productos.length,
            itemsPerPage: 15,
            currentPage: 1
        };
        
        this.paginationConfig.totalPages = Math.ceil(
            this.paginationConfig.totalItems / this.paginationConfig.itemsPerPage
        );
        
        // Obtener los productos para la página actual
        const startIndex = (this.paginationConfig.currentPage - 1) * this.paginationConfig.itemsPerPage;
        const endIndex = startIndex + this.paginationConfig.itemsPerPage;
        const paginatedProducts = this.reportData.productos.slice(startIndex, endIndex);
        
        // Crear las filas de la tabla
        paginatedProducts.forEach(producto => {
            const row = document.createElement('tr');
            
            // Aplicar clase según el estado del stock
            if (producto.stock_actual === 0) {
                row.classList.add('stock-zero');
            } else if (producto.stock_actual <= producto.stock_minimo) {
                row.classList.add('stock-critical');
            } else if (producto.stock_actual >= producto.stock_maximo) {
                row.classList.add('stock-excess');
            }
            
            // Formatear valor unitario y total
            const valorUnitarioFormateado = new Intl.NumberFormat('es-AR', {
                style: 'currency',
                currency: 'ARS'
            }).format(producto.valor_unitario);
            
            const valorTotalFormateado = new Intl.NumberFormat('es-AR', {
                style: 'currency',
                currency: 'ARS'
            }).format(producto.valor_total);
            
            // Crear el contenido de la fila
            row.innerHTML = `
                <td>${producto.codigo}</td>
                <td>${producto.producto}</td>
                <td>${producto.categoria}</td>
                <td class="text-right">${producto.stock_actual}</td>
                <td class="text-right">${producto.stock_minimo}</td>
                <td class="text-right">${producto.stock_maximo || '-'}</td>
                <td class="text-right">
                    <span class="rotation-indicator rotation-${producto.rotacion_nivel}">${producto.rotacion}</span>
                </td>
                <td>${producto.ultimo_movimiento}</td>
                <td class="text-right">${valorUnitarioFormateado}</td>
                <td class="text-right">${valorTotalFormateado}</td>
                <td><span class="status-badge status-${producto.activo ? 'active' : 'inactive'}">${producto.activo ? 'Activo' : 'Inactivo'}</span></td>
            `;
            
            tbodyElement.appendChild(row);
        });
        
        // Actualizar la información de paginación
        this.updatePaginationControls();
    }
    
    /**
     * Actualiza los controles de paginación
     */
    updatePaginationControls() {
        const currentPageInfo = document.getElementById('stock-current-page-info');
        const totalRecords = document.getElementById('stock-total-records');
        const currentPage = document.getElementById('stock-current-page');
        const prevPageBtn = document.getElementById('stock-prev-page');
        const nextPageBtn = document.getElementById('stock-next-page');
        
        if (!currentPageInfo || !totalRecords || !currentPage || !prevPageBtn || !nextPageBtn) {
            return;
        }
        
        const startItem = ((this.paginationConfig.currentPage - 1) * this.paginationConfig.itemsPerPage) + 1;
        const endItem = Math.min(
            startItem + this.paginationConfig.itemsPerPage - 1,
            this.paginationConfig.totalItems
        );
        
        currentPageInfo.textContent = `${startItem}-${endItem}`;
        totalRecords.textContent = this.paginationConfig.totalItems;
        currentPage.textContent = this.paginationConfig.currentPage;
        
        // Habilitar/deshabilitar botones de navegación
        prevPageBtn.disabled = this.paginationConfig.currentPage === 1;
        nextPageBtn.disabled = this.paginationConfig.currentPage === this.paginationConfig.totalPages;
    }
    
    /**
     * Navega a la página anterior o siguiente
     * @param {string} direction - Dirección de navegación ('prev' o 'next')
     */
    navigateToPage(direction) {
        if (direction === 'prev' && this.paginationConfig.currentPage > 1) {
            this.paginationConfig.currentPage--;
        } else if (direction === 'next' && this.paginationConfig.currentPage < this.paginationConfig.totalPages) {
            this.paginationConfig.currentPage++;
        } else {
            return; // No hacer nada si estamos en los límites
        }
        
        // Actualizar la tabla con la nueva página
        this.updateProductsTable();
    }
    
    /**
     * Genera los gráficos del reporte de stock
     */
    generateStockCharts() {
        try {
            // Grafico de categorías
            this.generateCategoryChart();
            
            // Gráfico de rotación
            this.generateRotationChart();
            
        } catch (error) {
            logger.error('Error al generar los gráficos del reporte de stock', error);
            NotificationManager.showError('Error al generar los gráficos');
        }
    }
    
    /**
     * Genera el gráfico de distribución de stock por categoría
     */
    generateCategoryChart() {
        const chartCanvas = document.getElementById('stock-category-chart');
        if (!chartCanvas) return;
        
        // Destruir el gráfico anterior si existe
        if (this.categoryChart) {
            this.categoryChart.destroy();
        }
        
        // Preparar los datos para el gráfico
        const categories = this.chartData.categorias.map(item => item.categoria);
        const stockValues = this.chartData.categorias.map(item => item.cantidad_stock);
        const backgroundColors = ChartUtils.generateColorArray(categories.length);
        
        // Crear el gráfico de donut
        this.categoryChart = ChartUtils.createChart(chartCanvas, {
            type: 'doughnut',
            data: {
                labels: categories,
                datasets: [{
                    data: stockValues,
                    backgroundColor: backgroundColors,
                    borderColor: '#ffffff',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                legend: {
                    position: 'right',
                    labels: {
                        fontColor: '#333',
                        fontSize: 12,
                        boxWidth: 12
                    }
                },
                title: {
                    display: false
                },
                tooltips: {
                    callbacks: {
                        label: (tooltipItem, data) => {
                            const dataset = data.datasets[tooltipItem.datasetIndex];
                            const total = dataset.data.reduce((acc, current) => acc + current, 0);
                            const currentValue = dataset.data[tooltipItem.index];
                            const percentage = Math.round((currentValue / total) * 100);
                            
                            return `${data.labels[tooltipItem.index]}: ${currentValue} unidades (${percentage}%)`;
                        }
                    }
                }
            }
        });
    }
    
    /**
     * Genera el gráfico de productos con mayor rotación
     */
    generateRotationChart() {
        const chartCanvas = document.getElementById('stock-rotation-chart');
        if (!chartCanvas) return;
        
        // Destruir el gráfico anterior si existe
        if (this.rotationChart) {
            this.rotationChart.destroy();
        }
        
        // Preparar los datos para el gráfico
        const products = this.chartData.rotacion.map(item => item.producto);
        const salesValues = this.chartData.rotacion.map(item => item.cantidad_vendida);
        const backgroundColors = ChartUtils.generateColorArray(products.length, 0.7);
        const borderColors = ChartUtils.generateColorArray(products.length);
        
        // Crear el gráfico de barras horizontales
        this.rotationChart = ChartUtils.createChart(chartCanvas, {
            type: 'horizontalBar',
            data: {
                labels: products,
                datasets: [{
                    label: 'Unidades vendidas',
                    data: salesValues,
                    backgroundColor: backgroundColors,
                    borderColor: borderColors,
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                legend: {
                    display: false
                },
                title: {
                    display: false
                },
                scales: {
                    xAxes: [{
                        ticks: {
                            beginAtZero: true,
                            fontColor: '#333'
                        },
                        gridLines: {
                            color: 'rgba(0, 0, 0, 0.1)'
                        }
                    }],
                    yAxes: [{
                        ticks: {
                            fontColor: '#333'
                        },
                        gridLines: {
                            color: 'rgba(0, 0, 0, 0.1)'
                        }
                    }]
                },
                tooltips: {
                    callbacks: {
                        label: (tooltipItem, data) => {
                            return `${tooltipItem.xLabel} unidades vendidas`;
                        }
                    }
                }
            }
        });
    }
    
    /**
     * Genera alertas de productos que requieren atención
     */
    generateStockAlerts() {
        const alertsContainer = document.getElementById('stock-alerts-list');
        if (!alertsContainer) return;
        
        // Limpiar alertas anteriores
        alertsContainer.innerHTML = '';
        
        // Productos sin stock
        const sinStock = this.reportData.productos.filter(p => p.stock_actual === 0 && p.activo);
        
        // Productos con stock crítico
        const stockCritico = this.reportData.productos.filter(
            p => p.stock_actual > 0 && p.stock_actual <= p.stock_minimo && p.activo
        );
        
        // Productos sin rotación
        const sinRotacion = this.reportData.productos.filter(
            p => p.rotacion === 0 && p.stock_actual > 0 && p.activo
        );
        
        // Si no hay alertas
        if (sinStock.length === 0 && stockCritico.length === 0 && sinRotacion.length === 0) {
            alertsContainer.innerHTML = `
                <div class="empty-alerts">
                    <i class="fas fa-check-circle"></i>
                    <p>No hay alertas de inventario que requieran atención en este momento.</p>
                </div>
            `;
            return;
        }
        
        // Crear las alertas
        
        // 1. Alertas de productos sin stock
        if (sinStock.length > 0) {
            const sinStockAlert = document.createElement('div');
            sinStockAlert.className = 'alert-group alert-danger';
            
            sinStockAlert.innerHTML = `
                <div class="alert-header">
                    <i class="fas fa-exclamation-circle"></i>
                    <h4>Productos sin stock (${sinStock.length})</h4>
                </div>
                <ul class="alert-items">
                    ${sinStock.slice(0, 5).map(producto => `
                        <li>
                            <strong>${producto.producto}</strong> (${producto.codigo}) - 
                            Último movimiento: ${producto.ultimo_movimiento}
                        </li>
                    `).join('')}
                    ${sinStock.length > 5 ? `<li class="more-items">Y ${sinStock.length - 5} productos más...</li>` : ''}
                </ul>
                <div class="alert-action">
                    <button class="btn btn-sm btn-outline" onclick="window.open('reportes/stock/print/sin-stock', '_blank')">
                        <i class="fas fa-print"></i> Imprimir listado completo
                    </button>
                </div>
            `;
            
            alertsContainer.appendChild(sinStockAlert);
        }
        
        // 2. Alertas de productos con stock crítico
        if (stockCritico.length > 0) {
            const stockCriticoAlert = document.createElement('div');
            stockCriticoAlert.className = 'alert-group alert-warning';
            
            stockCriticoAlert.innerHTML = `
                <div class="alert-header">
                    <i class="fas fa-exclamation-triangle"></i>
                    <h4>Productos con stock crítico (${stockCritico.length})</h4>
                </div>
                <ul class="alert-items">
                    ${stockCritico.slice(0, 5).map(producto => `
                        <li>
                            <strong>${producto.producto}</strong> (${producto.codigo}) - 
                            Stock actual: ${producto.stock_actual} / Mínimo: ${producto.stock_minimo}
                        </li>
                    `).join('')}
                    ${stockCritico.length > 5 ? `<li class="more-items">Y ${stockCritico.length - 5} productos más...</li>` : ''}
                </ul>
                <div class="alert-action">
                    <button class="btn btn-sm btn-outline" onclick="window.open('reportes/stock/print/stock-critico', '_blank')">
                        <i class="fas fa-print"></i> Imprimir listado completo
                    </button>
                </div>
            `;
            
            alertsContainer.appendChild(stockCriticoAlert);
        }
        
        // 3. Alertas de productos sin rotación
        if (sinRotacion.length > 0) {
            const sinRotacionAlert = document.createElement('div');
            sinRotacionAlert.className = 'alert-group alert-info';
            
            sinRotacionAlert.innerHTML = `
                <div class="alert-header">
                    <i class="fas fa-info-circle"></i>
                    <h4>Productos sin rotación (${sinRotacion.length})</h4>
                </div>
                <ul class="alert-items">
                    ${sinRotacion.slice(0, 5).map(producto => `
                        <li>
                            <strong>${producto.producto}</strong> (${producto.codigo}) - 
                            Stock: ${producto.stock_actual} unidades - 
                            Valor: ${new Intl.NumberFormat('es-AR', {style: 'currency', currency: 'ARS'}).format(producto.valor_total)}
                        </li>
                    `).join('')}
                    ${sinRotacion.length > 5 ? `<li class="more-items">Y ${sinRotacion.length - 5} productos más...</li>` : ''}
                </ul>
                <div class="alert-action">
                    <button class="btn btn-sm btn-outline" onclick="window.open('reportes/stock/print/sin-rotacion', '_blank')">
                        <i class="fas fa-print"></i> Imprimir listado completo
                    </button>
                </div>
            `;
            
            alertsContainer.appendChild(sinRotacionAlert);
        }
    }
    
    /**
     * Genera predicciones de reabastecimiento basadas en el histórico de ventas
     */
    async generateStockPredictions() {
        try {
            const tbodyElement = document.getElementById('stock-prediction-tbody');
            if (!tbodyElement) return;
            
            // Limpiar la tabla
            tbodyElement.innerHTML = '';
            
            // Obtener los datos para predicción
            const predictionQuery = `
                SELECT 
                    p.id,
                    p.nombre as producto,
                    s.cantidad as stock_actual,
                    p.stock_minimo,
                    (
                        SELECT SUM(vd.cantidad) / COUNT(DISTINCT SUBSTR(v.fecha, 1, 7))
                        FROM ventas_detalle vd
                        JOIN ventas v ON vd.venta_id = v.id
                        WHERE vd.producto_id = p.id
                        AND v.fecha BETWEEN DATE(?, '-3 month') AND ?
                    ) as promedio_mensual,
                    (
                        SELECT SUM(vd.cantidad) / COUNT(DISTINCT v.fecha)
                        FROM ventas_detalle vd
                        JOIN ventas v ON vd.venta_id = v.id
                        WHERE vd.producto_id = p.id
                        AND v.fecha BETWEEN DATE(?, '-30 day') AND ?
                    ) as promedio_diario
                FROM 
                    productos p
                JOIN 
                    stock s ON p.id = s.producto_id
                WHERE 
                    p.activo = 1
                    AND s.cantidad > 0
                    AND s.cantidad <= p.stock_minimo * 1.5
                    ${this.filterOptions.sucursal !== 'todas' ? 'AND s.sucursal_id = ?' : ''}
                ORDER BY 
                    (s.cantidad / promedio_diario) ASC
                LIMIT 10
            `;
            
            const params = [
                this.filterOptions.endDate,
                this.filterOptions.endDate,
                this.filterOptions.endDate,
                this.filterOptions.endDate
            ];
            
            if (this.filterOptions.sucursal !== 'todas') {
                params.push(this.filterOptions.sucursal);
            }
            
            const predictions = await this.db.query(predictionQuery, params);
            
            // Si no hay predicciones
            if (predictions.length === 0) {
                tbodyElement.innerHTML = `
                    <tr>
                        <td colspan="6" class="table-empty-message">No hay datos suficientes para generar predicciones</td>
                    </tr>
                `;
                return;
            }
            
            // Calcular datos de predicción
            predictions.forEach(item => {
                // Asegurar que los promedios no sean NULL
                item.promedio_mensual = item.promedio_mensual || 0;
                item.promedio_diario = item.promedio_diario || 0.1; // Evitar división por cero
                
                // Calcular días restantes estimados
                item.dias_restantes = Math.round(item.stock_actual / item.promedio_diario);
                
                // Calcular fecha estimada de reposición
                const today = new Date();
                const reposicionDate = new Date(today);
                reposicionDate.setDate(today.getDate() + item.dias_restantes);
                item.fecha_estimada = DateUtils.formatDate(reposicionDate);
                
                // Calcular cantidad sugerida para reponer
                // Formula: (Promedio mensual * 1.2) - stock_actual
                item.cantidad_sugerida = Math.ceil((item.promedio_mensual * 1.2) - item.stock_actual);
                if (item.cantidad_sugerida < 0) item.cantidad_sugerida = 0;
            });
            
            // Mostrar las predicciones en la tabla
            predictions.forEach(item => {
                const row = document.createElement('tr');
                
                // Determinar clase CSS según días restantes
                if (item.dias_restantes <= 3) {
                    row.classList.add('prediction-urgent');
                } else if (item.dias_restantes <= 7) {
                    row.classList.add('prediction-warning');
                }
                
                row.innerHTML = `
                    <td>${item.producto}</td>
                    <td class="text-center">${item.stock_actual}</td>
                    <td class="text-center">${item.promedio_diario.toFixed(2)}/día</td>
                    <td class="text-center">
                        <span class="days-badge days-${item.dias_restantes <= 3 ? 'critical' : (item.dias_restantes <= 7 ? 'warning' : 'normal')}">
                            ${item.dias_restantes} días
                        </span>
                    </td>
                    <td class="text-center">${item.fecha_estimada}</td>
                    <td class="text-center">${item.cantidad_sugerida}</td>
                `;
                
                tbodyElement.appendChild(row);
            });
            
        } catch (error) {
            logger.error('Error al generar predicciones de reabastecimiento', error);
            const tbodyElement = document.getElementById('stock-prediction-tbody');
            if (tbodyElement) {
                tbodyElement.innerHTML = `
                    <tr>
                        <td colspan="6" class="table-empty-message">Error al generar predicciones</td>
                    </tr>
                `;
            }
        }
    }
    
    /**
     * Determina el estado del stock de un producto
     * @param {Object} producto - Datos del producto
     * @returns {string} Estado del stock
     */
    getStockStatus(producto) {
        if (producto.stock_actual === 0) {
            return 'sin_stock';
        } else if (producto.stock_actual <= producto.stock_minimo) {
            return 'critico';
        } else if (producto.stock_maximo && producto.stock_actual >= producto.stock_maximo) {
            return 'exceso';
        } else {
            return 'normal';
        }
    }
    
    /**
     * Calcula el nivel de rotación basado en la cantidad de ventas
     * @param {number} rotacion - Cantidad de productos vendidos
     * @returns {string} Nivel de rotación (alta, media, baja, nula)
     */
    calculateRotationLevel(rotacion) {
        if (rotacion === 0) {
            return 'nula';
        } else if (rotacion <= 5) {
            return 'baja';
        } else if (rotacion <= 20) {
            return 'media';
        } else {
            return 'alta';
        }
    }
    
    /**
     * Exporta el reporte actual a un archivo PDF
     */
    async exportReportToPDF() {
        try {
            // Notificar al usuario
            NotificationManager.showInfo('Generando PDF del reporte de stock...');
            
            // Preparar datos para el PDF
            const reportData = {
                fecha: DateUtils.getCurrentDate(),
                hora: DateUtils.getCurrentTime(),
                usuario: this.currentUser.username,
                sucursal: this.filterOptions.sucursal === 'todas' ? 'Todas las sucursales' : 
                    await this.db.getSucursalName(this.filterOptions.sucursal),
                filtros: {
                    periodo: `${DateUtils.formatDate(this.filterOptions.startDate)} al ${DateUtils.formatDate(this.filterOptions.endDate)}`,
                    categoria: this.filterOptions.categoria === 'todas' ? 'Todas' : this.filterOptions.categoria,
                    stockMinimo: this.filterOptions.stockMinimo ? 'Sí' : 'No',
                    stockMaximo: this.filterOptions.stockMaximo ? 'Sí' : 'No',
                    sinRotacion: this.filterOptions.sinRotacion ? 'Sí' : 'No',
                    soloActivos: this.filterOptions.soloActivos ? 'Sí' : 'No'
                },
                estadisticas: this.reportData.estadisticas,
                productos: this.reportData.productos
            };
            
            // Generar el PDF
            const pdfBlob = await exportToPDF('stock', reportData, 'landscape');
            
            // Guardar o mostrar el PDF
            const fileName = `reporte_stock_${DateUtils.getCurrentDateForFileName()}.pdf`;
            
            // Crear un enlace y simular un clic para descargar el PDF
            const link = document.createElement('a');
            link.href = URL.createObjectURL(pdfBlob);
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            // Notificar éxito
            NotificationManager.showSuccess('Reporte exportado con éxito');
            
            // Registrar la exportación
            logger.info('Reporte de stock exportado a PDF', {
                usuario: this.currentUser.username,
                sucursal: this.filterOptions.sucursal,
                nombre_archivo: fileName
            });
            
        } catch (error) {
            logger.error('Error al exportar reporte de stock a PDF', error);
            NotificationManager.showError('Error al exportar el reporte a PDF');
        }
    }
}

// Registrar el módulo para su uso
export const initStockReportModule = () => {
    // Verificar si el contenedor existe antes de inicializar
    if (document.getElementById('stock-report-container')) {
        return new StockReportModule();
    } else {
        console.error('Contenedor del módulo de reportes de stock no encontrado');
        return null;
    }
};

// Exportar la clase para su uso en otros módulos
export default StockReportModule;