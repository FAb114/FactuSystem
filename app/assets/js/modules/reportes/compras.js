/**
 * Módulo de Reportes de Compras - FactuSystem
 * 
 * Este módulo gestiona la generación y visualización de reportes
 * relacionados con las compras y proveedores en el sistema.
 * 
 * @module reportes/compras
 */

const { getDB } = require('../../utils/database.js');
const { validateDateRange } = require('../../utils/validation.js');
const { logAction } = require('../../utils/logger.js');
const { createPDF } = require('../../../services/print/pdf.js');
const { getCurrentUser } = require('../../utils/auth.js');
const { formatCurrency, formatDate } = require('../../utils/helpers.js');

class ComprasReportes {
    constructor() {
        this.db = getDB();
        this.currentFilters = {
            dateFrom: new Date(),
            dateTo: new Date(),
            proveedor: 'todos',
            sucursal: getCurrentUser().sucursal,
            usuario: 'todos',
            categoria: 'todas',
            estadoPago: 'todos'
        };
        
        // Referencias a elementos DOM
        this.elements = {};
        
        // Configuración para gráficos
        this.chartOptions = {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                },
                tooltip: {
                    callbacks: {
                        label: (context) => `${context.dataset.label}: ${formatCurrency(context.raw)}`
                    }
                }
            }
        };
        
        // Referencias a gráficos
        this.charts = {};
    }
    
    /**
     * Inicializa el módulo de reportes de compras
     */
    async init() {
        try {
            // Configurar fecha desde/hasta por defecto (último mes)
            const today = new Date();
            this.currentFilters.dateTo = today;
            this.currentFilters.dateFrom = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());
            
            this.bindElements();
            this.bindEvents();
            await this.loadProveedores();
            await this.loadSucursales();
            await this.loadUsuarios();
            await this.loadCategorias();
            
            // Ejecuta el reporte con filtros iniciales
            await this.generateReport();
            
            logAction('reportes_compras', 'init', 'Módulo de reportes de compras inicializado');
        } catch (error) {
            console.error('Error al inicializar reportes de compras:', error);
            this.showError('No se pudo inicializar el módulo de reportes de compras');
        }
    }
    
    /**
     * Obtiene referencias a elementos del DOM
     */
    bindElements() {
        this.elements = {
            // Contenedores principales
            reportContainer: document.getElementById('compras-report-container'),
            filtersContainer: document.getElementById('compras-filters-container'),
            chartsContainer: document.getElementById('compras-charts-container'),
            tableContainer: document.getElementById('compras-table-container'),
            
            // Inputs de filtros
            dateFrom: document.getElementById('compras-date-from'),
            dateTo: document.getElementById('compras-date-to'),
            proveedorSelect: document.getElementById('compras-proveedor-select'),
            sucursalSelect: document.getElementById('compras-sucursal-select'),
            usuarioSelect: document.getElementById('compras-usuario-select'),
            categoriaSelect: document.getElementById('compras-categoria-select'),
            estadoPagoSelect: document.getElementById('compras-estado-pago-select'),
            
            // Botones
            filterBtn: document.getElementById('compras-filter-btn'),
            exportPdfBtn: document.getElementById('compras-export-pdf-btn'),
            exportExcelBtn: document.getElementById('compras-export-excel-btn'),
            printBtn: document.getElementById('compras-print-btn'),
            
            // Contenedores de gráficos
            comprasPorMesChart: document.getElementById('compras-por-mes-chart'),
            comprasPorProveedorChart: document.getElementById('compras-por-proveedor-chart'),
            comprasPorCategoriaChart: document.getElementById('compras-por-categoria-chart'),
            
            // Elementos de resumen
            totalCompras: document.getElementById('compras-total'),
            promedioCompra: document.getElementById('compras-promedio'),
            cantidadCompras: document.getElementById('compras-cantidad'),
            mayorCompra: document.getElementById('compras-mayor'),
            
            // Tabla de resultados
            comprasTable: document.getElementById('compras-table'),
            comprasTableBody: document.getElementById('compras-table-body'),
            
            // Elementos de carga y error
            loadingIndicator: document.getElementById('compras-loading'),
            errorMessage: document.getElementById('compras-error')
        };
        
        // Inicializar fechas en los inputs
        this.elements.dateFrom.value = formatDate(this.currentFilters.dateFrom, 'yyyy-MM-dd');
        this.elements.dateTo.value = formatDate(this.currentFilters.dateTo, 'yyyy-MM-dd');
    }
    
    /**
     * Configura los eventos para los elementos del DOM
     */
    bindEvents() {
        this.elements.filterBtn.addEventListener('click', () => this.applyFilters());
        this.elements.exportPdfBtn.addEventListener('click', () => this.exportToPDF());
        this.elements.exportExcelBtn.addEventListener('click', () => this.exportToExcel());
        this.elements.printBtn.addEventListener('click', () => this.printReport());
        
        // Eventos de cambio para filtros autoaplicables
        const autoApplyFilters = ['proveedorSelect', 'sucursalSelect', 'usuarioSelect', 
                                 'categoriaSelect', 'estadoPagoSelect'];
        
        autoApplyFilters.forEach(filter => {
            this.elements[filter].addEventListener('change', () => this.applyFilters());
        });
    }
    
    /**
     * Carga la lista de proveedores para el filtro
     */
    async loadProveedores() {
        try {
            const proveedores = await this.db.proveedores.find({}).sort({razonSocial: 1}).toArray();
            
            // Limpiar select y agregar opción "Todos"
            this.elements.proveedorSelect.innerHTML = '<option value="todos">Todos los proveedores</option>';
            
            // Agregar cada proveedor
            proveedores.forEach(proveedor => {
                const option = document.createElement('option');
                option.value = proveedor._id;
                option.textContent = proveedor.razonSocial;
                this.elements.proveedorSelect.appendChild(option);
            });
        } catch (error) {
            console.error('Error al cargar proveedores:', error);
        }
    }
    
    /**
     * Carga la lista de sucursales para el filtro
     */
    async loadSucursales() {
        try {
            const currentUser = getCurrentUser();
            const userHasMultiSucursalAccess = currentUser.permisos.includes('ver_todas_sucursales');
            
            // Si el usuario no tiene acceso a todas las sucursales, mostrar solo la suya
            if (!userHasMultiSucursalAccess) {
                this.elements.sucursalSelect.innerHTML = `<option value="${currentUser.sucursal}" selected>${currentUser.sucursalNombre}</option>`;
                this.elements.sucursalSelect.disabled = true;
                return;
            }
            
            const sucursales = await this.db.sucursales.find({}).sort({nombre: 1}).toArray();
            
            // Limpiar select y agregar opción "Todas"
            this.elements.sucursalSelect.innerHTML = '<option value="todas">Todas las sucursales</option>';
            
            // Agregar cada sucursal
            sucursales.forEach(sucursal => {
                const option = document.createElement('option');
                option.value = sucursal._id;
                option.textContent = sucursal.nombre;
                this.elements.sucursalSelect.appendChild(option);
            });
            
            // Seleccionar la sucursal del usuario por defecto
            this.elements.sucursalSelect.value = currentUser.sucursal;
        } catch (error) {
            console.error('Error al cargar sucursales:', error);
        }
    }
    
    /**
     * Carga la lista de usuarios para el filtro
     */
    async loadUsuarios() {
        try {
            const usuarios = await this.db.usuarios.find({activo: true}).sort({nombre: 1}).toArray();
            
            // Limpiar select y agregar opción "Todos"
            this.elements.usuarioSelect.innerHTML = '<option value="todos">Todos los usuarios</option>';
            
            // Agregar cada usuario
            usuarios.forEach(usuario => {
                const option = document.createElement('option');
                option.value = usuario._id;
                option.textContent = `${usuario.nombre} ${usuario.apellido}`;
                this.elements.usuarioSelect.appendChild(option);
            });
        } catch (error) {
            console.error('Error al cargar usuarios:', error);
        }
    }
    
    /**
     * Carga las categorías de productos para el filtro
     */
    async loadCategorias() {
        try {
            const categorias = await this.db.categorias.find({}).sort({nombre: 1}).toArray();
            
            // Limpiar select y agregar opción "Todas"
            this.elements.categoriaSelect.innerHTML = '<option value="todas">Todas las categorías</option>';
            
            // Agregar cada categoría
            categorias.forEach(categoria => {
                const option = document.createElement('option');
                option.value = categoria._id;
                option.textContent = categoria.nombre;
                this.elements.categoriaSelect.appendChild(option);
            });
        } catch (error) {
            console.error('Error al cargar categorías:', error);
        }
    }
    
    /**
     * Aplica los filtros seleccionados y regenera el reporte
     */
    async applyFilters() {
        try {
            // Verificar y obtener fechas
            const dateFrom = new Date(this.elements.dateFrom.value);
            const dateTo = new Date(this.elements.dateTo.value);
            
            // Validar rango de fechas
            if (!validateDateRange(dateFrom, dateTo)) {
                this.showError('El rango de fechas no es válido');
                return;
            }
            
            // Actualizar filtros
            this.currentFilters = {
                dateFrom,
                dateTo,
                proveedor: this.elements.proveedorSelect.value,
                sucursal: this.elements.sucursalSelect.value,
                usuario: this.elements.usuarioSelect.value,
                categoria: this.elements.categoriaSelect.value,
                estadoPago: this.elements.estadoPagoSelect.value
            };
            
            // Generar reporte con nuevos filtros
            await this.generateReport();
            
            logAction('reportes_compras', 'filter_applied', 'Filtros aplicados', {
                filtros: this.currentFilters
            });
        } catch (error) {
            console.error('Error al aplicar filtros:', error);
            this.showError('No se pudieron aplicar los filtros');
        }
    }
    
    /**
     * Genera el reporte completo basado en los filtros actuales
     */
    async generateReport() {
        try {
            this.showLoading(true);
            this.hideError();
            
            // Obtener datos de compras según filtros
            const compras = await this.fetchComprasData();
            
            // Si no hay datos, mostrar mensaje
            if (compras.length === 0) {
                this.showNoData();
                this.showLoading(false);
                return;
            }
            
            // Generar resumen y estadísticas
            const resumen = this.generarResumen(compras);
            this.mostrarResumen(resumen);
            
            // Generar gráficos
            await this.generarGraficos(compras);
            
            // Generar tabla detallada
            this.generarTablaDetallada(compras);
            
            this.showLoading(false);
            
            logAction('reportes_compras', 'report_generated', 'Reporte generado', {
                filtros: this.currentFilters,
                cantidadCompras: compras.length
            });
        } catch (error) {
            console.error('Error al generar reporte:', error);
            this.showError('No se pudo generar el reporte');
            this.showLoading(false);
        }
    }
    
    /**
     * Obtiene los datos de compras filtrados desde la base de datos
     */
    async fetchComprasData() {
        try {
            // Construir consulta basada en filtros
            const query = {
                fecha: {
                    $gte: this.currentFilters.dateFrom,
                    $lte: this.currentFilters.dateTo
                }
            };
            
            // Agregar filtro de proveedor si no es "todos"
            if (this.currentFilters.proveedor !== 'todos') {
                query['proveedor._id'] = this.currentFilters.proveedor;
            }
            
            // Agregar filtro de sucursal si no es "todas"
            if (this.currentFilters.sucursal !== 'todas') {
                query.sucursalId = this.currentFilters.sucursal;
            }
            
            // Agregar filtro de usuario si no es "todos"
            if (this.currentFilters.usuario !== 'todos') {
                query.usuarioId = this.currentFilters.usuario;
            }
            
            // Agregar filtro de categoría si no es "todas"
            if (this.currentFilters.categoria !== 'todas') {
                query['productos.categoriaId'] = this.currentFilters.categoria;
            }
            
            // Agregar filtro de estado de pago si no es "todos"
            if (this.currentFilters.estadoPago !== 'todos') {
                query.pagado = this.currentFilters.estadoPago === 'pagado';
            }
            
            // Obtener datos de compras
            const compras = await this.db.compras.find(query)
                .sort({ fecha: -1 })
                .toArray();
            
            // Para cada compra, obtener datos adicionales si es necesario
            for (let i = 0; i < compras.length; i++) {
                const compra = compras[i];
                
                // Si no tiene datos completos del proveedor, obtenerlos
                if (!compra.proveedor || !compra.proveedor.razonSocial) {
                    const proveedor = await this.db.proveedores.findOne({ _id: compra.proveedorId });
                    compra.proveedor = proveedor || { razonSocial: 'Proveedor no encontrado' };
                }
                
                // Si no tiene datos completos del usuario, obtenerlos
                if (!compra.usuario || !compra.usuario.nombre) {
                    const usuario = await this.db.usuarios.findOne({ _id: compra.usuarioId });
                    compra.usuario = usuario || { nombre: 'Usuario no encontrado', apellido: '' };
                }
                
                // Si no tiene datos completos de la sucursal, obtenerlos
                if (!compra.sucursal || !compra.sucursal.nombre) {
                    const sucursal = await this.db.sucursales.findOne({ _id: compra.sucursalId });
                    compra.sucursal = sucursal || { nombre: 'Sucursal no encontrada' };
                }
            }
            
            return compras;
        } catch (error) {
            console.error('Error al obtener datos de compras:', error);
            throw error;
        }
    }
    
    /**
     * Genera un resumen estadístico de las compras
     */
    generarResumen(compras) {
        // Total de compras
        const total = compras.reduce((sum, compra) => sum + compra.total, 0);
        
        // Promedio por compra
        const promedio = total / compras.length;
        
        // Cantidad de compras
        const cantidad = compras.length;
        
        // Mayor compra
        const mayorCompra = compras.reduce((max, compra) => 
            compra.total > max.total ? compra : max, { total: 0 });
        
        // Cantidad de compras por estado de pago
        const pagas = compras.filter(compra => compra.pagado).length;
        const pendientes = compras.filter(compra => !compra.pagado).length;
        
        // Totales por forma de pago
        const totalPorFormaPago = {};
        compras.forEach(compra => {
            if (compra.formaPago) {
                if (!totalPorFormaPago[compra.formaPago]) {
                    totalPorFormaPago[compra.formaPago] = 0;
                }
                totalPorFormaPago[compra.formaPago] += compra.total;
            }
        });
        
        return {
            total,
            promedio,
            cantidad,
            mayorCompra,
            pagas,
            pendientes,
            totalPorFormaPago
        };
    }
    
    /**
     * Muestra el resumen en la interfaz
     */
    mostrarResumen(resumen) {
        this.elements.totalCompras.textContent = formatCurrency(resumen.total);
        this.elements.promedioCompra.textContent = formatCurrency(resumen.promedio);
        this.elements.cantidadCompras.textContent = resumen.cantidad;
        this.elements.mayorCompra.textContent = formatCurrency(resumen.mayorCompra.total);
        
        // Actualizar otros elementos de resumen aquí si es necesario
    }
    
    /**
     * Genera los gráficos basados en los datos de compras
     */
    async generarGraficos(compras) {
        try {
            // Destruir gráficos anteriores si existen
            Object.values(this.charts).forEach(chart => {
                if (chart) chart.destroy();
            });
            
            // 1. Gráfico de compras por mes
            await this.generarGraficoComprasPorMes(compras);
            
            // 2. Gráfico de compras por proveedor
            await this.generarGraficoComprasPorProveedor(compras);
            
            // 3. Gráfico de compras por categoría
            await this.generarGraficoComprasPorCategoria(compras);
        } catch (error) {
            console.error('Error al generar gráficos:', error);
        }
    }
    
    /**
     * Genera el gráfico de compras por mes
     */
    async generarGraficoComprasPorMes(compras) {
        try {
            // Agrupar compras por mes
            const comprasPorMes = {};
            
            compras.forEach(compra => {
                const fecha = new Date(compra.fecha);
                const mes = `${fecha.getFullYear()}-${(fecha.getMonth() + 1).toString().padStart(2, '0')}`;
                
                if (!comprasPorMes[mes]) {
                    comprasPorMes[mes] = 0;
                }
                
                comprasPorMes[mes] += compra.total;
            });
            
            // Ordenar meses cronológicamente
            const mesesOrdenados = Object.keys(comprasPorMes).sort();
            
            // Formatear etiquetas de meses para mostrar (MM-YYYY)
            const etiquetas = mesesOrdenados.map(mes => {
                const [year, month] = mes.split('-');
                return `${month}/${year}`;
            });
            
            // Obtener valores
            const valores = mesesOrdenados.map(mes => comprasPorMes[mes]);
            
            // Crear gráfico
            const ctx = this.elements.comprasPorMesChart.getContext('2d');
            
            this.charts.comprasPorMes = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: etiquetas,
                    datasets: [{
                        label: 'Total de compras',
                        data: valores,
                        backgroundColor: 'rgba(54, 162, 235, 0.6)',
                        borderColor: 'rgba(54, 162, 235, 1)',
                        borderWidth: 1
                    }]
                },
                options: {
                    ...this.chartOptions,
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: {
                                callback: value => formatCurrency(value)
                            }
                        }
                    }
                }
            });
        } catch (error) {
            console.error('Error al generar gráfico de compras por mes:', error);
        }
    }
    
    /**
     * Genera el gráfico de compras por proveedor
     */
    async generarGraficoComprasPorProveedor(compras) {
        try {
            // Agrupar compras por proveedor
            const comprasPorProveedor = {};
            
            compras.forEach(compra => {
                const proveedorId = compra.proveedor._id;
                const proveedorNombre = compra.proveedor.razonSocial;
                
                if (!comprasPorProveedor[proveedorId]) {
                    comprasPorProveedor[proveedorId] = {
                        nombre: proveedorNombre,
                        total: 0
                    };
                }
                
                comprasPorProveedor[proveedorId].total += compra.total;
            });
            
            // Convertir a array y ordenar por total (mayor a menor)
            const proveedoresArray = Object.values(comprasPorProveedor).sort((a, b) => b.total - a.total);
            
            // Limitar a los 10 proveedores con mayor total
            const topProveedores = proveedoresArray.slice(0, 10);
            
            // Preparar datos para el gráfico
            const etiquetas = topProveedores.map(p => p.nombre);
            const valores = topProveedores.map(p => p.total);
            
            // Generar colores para cada proveedor
            const colores = this.generateColors(topProveedores.length);
            
            // Crear gráfico
            const ctx = this.elements.comprasPorProveedorChart.getContext('2d');
            
            this.charts.comprasPorProveedor = new Chart(ctx, {
                type: 'pie',
                data: {
                    labels: etiquetas,
                    datasets: [{
                        label: 'Total por proveedor',
                        data: valores,
                        backgroundColor: colores.background,
                        borderColor: colores.border,
                        borderWidth: 1
                    }]
                },
                options: this.chartOptions
            });
        } catch (error) {
            console.error('Error al generar gráfico de compras por proveedor:', error);
        }
    }
    
    /**
     * Genera el gráfico de compras por categoría de producto
     */
    async generarGraficoComprasPorCategoria(compras) {
        try {
            // Para este gráfico necesitamos desglosar las compras por categoría de producto
            const comprasPorCategoria = {};
            
            // Primero, reconstruimos el array de productos de cada compra con sus respectivas categorías
            for (const compra of compras) {
                // Si la compra tiene productos detallados
                if (compra.productos && compra.productos.length > 0) {
                    for (const producto of compra.productos) {
                        // Si el producto no tiene categoría asignada, buscarla en la DB
                        if (!producto.categoria) {
                            try {
                                // Obtener producto completo primero
                                const productoCompleto = await this.db.productos.findOne({ _id: producto.productoId });
                                if (productoCompleto && productoCompleto.categoriaId) {
                                    // Obtener categoría
                                    const categoria = await this.db.categorias.findOne({ _id: productoCompleto.categoriaId });
                                    if (categoria) {
                                        producto.categoria = categoria;
                                        producto.categoriaId = categoria._id;
                                    }
                                }
                            } catch (err) {
                                console.error('Error al obtener categoría de producto:', err);
                            }
                        }
                        
                        // Si tenemos categoría, acumular por categoría
                        if (producto.categoriaId) {
                            const categoriaId = producto.categoriaId;
                            const categoriaNombre = producto.categoria ? producto.categoria.nombre : 'Sin categoría';
                            const subtotal = producto.precio * producto.cantidad;
                            
                            if (!comprasPorCategoria[categoriaId]) {
                                comprasPorCategoria[categoriaId] = {
                                    nombre: categoriaNombre,
                                    total: 0
                                };
                            }
                            
                            comprasPorCategoria[categoriaId].total += subtotal;
                        }
                    }
                } else {
                    // Si no hay detalle de productos, asignar a "Sin categoría"
                    if (!comprasPorCategoria['sin_categoria']) {
                        comprasPorCategoria['sin_categoria'] = {
                            nombre: 'Sin categoría',
                            total: 0
                        };
                    }
                    
                    comprasPorCategoria['sin_categoria'].total += compra.total;
                }
            }
            
            // Convertir a array y ordenar por total
            const categoriasArray = Object.values(comprasPorCategoria).sort((a, b) => b.total - a.total);
            
            // Preparar datos para el gráfico
            const etiquetas = categoriasArray.map(c => c.nombre);
            const valores = categoriasArray.map(c => c.total);
            
            // Generar colores
            const colores = this.generateColors(categoriasArray.length);
            
            // Crear gráfico
            const ctx = this.elements.comprasPorCategoriaChart.getContext('2d');
            
            this.charts.comprasPorCategoria = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: etiquetas,
                    datasets: [{
                        label: 'Total por categoría',
                        data: valores,
                        backgroundColor: colores.background,
                        borderColor: colores.border,
                        borderWidth: 1
                    }]
                },
                options: this.chartOptions
            });
        } catch (error) {
            console.error('Error al generar gráfico de compras por categoría:', error);
        }
    }
    
    /**
     * Genera colores aleatorios para los gráficos
     */
    generateColors(count) {
        const backgroundColors = [];
        const borderColors = [];
        
        // Colores predefinidos para los primeros elementos
        const baseColors = [
            'rgba(54, 162, 235, 0.6)', // Azul
            'rgba(255, 99, 132, 0.6)',  // Rojo
            'rgba(255, 206, 86, 0.6)',  // Amarillo
            'rgba(75, 192, 192, 0.6)',  // Verde agua
            'rgba(153, 102, 255, 0.6)', // Púrpura
            'rgba(255, 159, 64, 0.6)',  // Naranja
            'rgba(199, 199, 199, 0.6)', // Gris
            'rgba(83, 102, 255, 0.6)',  // Azul-violeta
            'rgba(255, 99, 71, 0.6)',   // Tomate
            'rgba(50, 205, 50, 0.6)'    // Verde lima
        ];
        
        for (let i = 0; i < count; i++) {
            if (i < baseColors.length) {
                // Usar colores predefinidos
                backgroundColors.push(baseColors[i]);
                borderColors.push(baseColors[i].replace('0.6', '1'));
            } else {
                // Generar colores aleatorios para elementos adicionales
                const r = Math.floor(Math.random() * 255);
                const g = Math.floor(Math.random() * 255);
                const b = Math.floor(Math.random() * 255);
                
                backgroundColors.push(`rgba(${r}, ${g}, ${b}, 0.6)`);
                borderColors.push(`rgba(${r}, ${g}, ${b}, 1)`);
            }
        }
        
        return {
            background: backgroundColors,
            border: borderColors
        };
    }
    
    /**
     * Genera la tabla detallada de compras
     */
    generarTablaDetallada(compras) {
        try {
            // Limpiar tabla
            this.elements.comprasTableBody.innerHTML = '';
            
            // Generar filas
            compras.forEach(compra => {
                const row = document.createElement('tr');
                
                // Formatear fecha
                const fecha = new Date(compra.fecha);
                const fechaFormateada = formatDate(fecha, 'dd/MM/yyyy');
                
                // Estado de pago
                const estadoPago = compra.pagado ? 
                    '<span class="badge badge-success">Pagado</span>' : 
                    '<span class="badge badge-warning">Pendiente</span>';
                
                // Crear celdas
                row.innerHTML = `
                    <td>${fechaFormateada}</td>
                    <td>${compra.numeroFactura || 'N/A'}</td>
                    <td>${compra.proveedor.razonSocial}</td>
                    <td>${compra.sucursal ? compra.sucursal.nombre : 'N/A'}</td>
                    <td>${formatCurrency(compra.total)}</td>
                    <td>${compra.formaPago || 'N/A'}</td>
                    <td>${estadoPago}</td>
                    <td>
                        <div class="btn-group btn-group-sm">
                            <button class="btn btn-info ver-detalle" data-id="${compra._id}" title="Ver detalle">
                                <i class="fas fa-eye"></i>
                            </button>
                            <button class="btn btn-secondary imprimir-compra" data-id="${compra._id}" title="Imprimir">
                                <i class="fas fa-print"></i>
                            </button>
                        </div>
                    </td>
                `;
                
                // Agregar fila a la tabla
                this.elements.comprasTableBody.appendChild(row);
                
                // Añadir eventos a los botones
                const verDetalleBtn = row.querySelector('.ver-detalle');
                const imprimirCompraBtn = row.querySelector('.imprimir-compra');
                
                verDetalleBtn.addEventListener('click', () => this.mostrarDetalleCompra(compra._id));
                imprimirCompraBtn.addEventListener('click', () => this.imprimirCompra(compra._id));
            });
            
            // Añadir evento de ordenamiento a la tabla
            this.initializeTableSort();
            
            // Inicializar paginación si hay muchos registros
            if (compras.length > 20) {
                this.initializePagination(compras.length);
            }
        } catch (error) {
            console.error('Error al generar tabla de compras:', error);
            this.showError('No se pudo generar la tabla de compras');
        }
    }
    
    /**
     * Inicializa la funcionalidad de ordenamiento de tabla
     */
    initializeTableSort() {
        // Si existe una instancia previa de DataTable, destruirla
        if ($.fn.DataTable.isDataTable('#compras-table')) {
            $('#compras-table').DataTable().destroy();
        }
        
        // Inicializar DataTable con opciones
        $('#compras-table').DataTable({
            language: {
                url: '../assets/js/utils/dataTables.spanish.json'
            },
            order: [[0, 'desc']], // Ordenar por fecha descendente por defecto
            pageLength: 20,
            responsive: true,
            columnDefs: [
                { orderable: false, targets: [7] } // La columna de acciones no es ordenable
            ]
        });
    }
    
    /**
     * Inicializa la paginación para tablas con muchos registros
     */
    initializePagination(totalRecords) {
        // La paginación se maneja automáticamente por DataTable
        console.log(`Paginación inicializada para ${totalRecords} registros`);
    }
    
    /**
     * Muestra el detalle de una compra específica
     */
    async mostrarDetalleCompra(compraId) {
        try {
            // Mostrar indicador de carga
            this.showLoading(true);
            
            // Obtener datos de la compra
            const compra = await this.db.compras.findOne({ _id: compraId });
            
            if (!compra) {
                this.showError('No se encontró la compra solicitada');
                this.showLoading(false);
                return;
            }
            
            // Cargar detalles completos de productos si no están ya cargados
            if (compra.productos && compra.productos.length > 0) {
                for (const producto of compra.productos) {
                    if (!producto.nombre) {
                        const productoCompleto = await this.db.productos.findOne({ _id: producto.productoId });
                        if (productoCompleto) {
                            producto.nombre = productoCompleto.nombre;
                            producto.sku = productoCompleto.codigoBarras || productoCompleto.sku || 'N/A';
                        }
                    }
                }
            }
            
            // Obtener datos del proveedor si no están completos
            if (!compra.proveedor || !compra.proveedor.razonSocial) {
                const proveedor = await this.db.proveedores.findOne({ _id: compra.proveedorId });
                compra.proveedor = proveedor || { razonSocial: 'Proveedor no encontrado' };
            }
            
            // Crear el modal con los detalles
            const modalContent = this.generarHTMLDetalleCompra(compra);
            
            // Mostrar el modal
            const modalId = 'detalleCompraModal';
            
            // Si ya existe el modal, eliminarlo
            const existingModal = document.getElementById(modalId);
            if (existingModal) {
                existingModal.remove();
            }
            
            // Crear nuevo modal
            const modalElement = document.createElement('div');
            modalElement.id = modalId;
            modalElement.className = 'modal fade';
            modalElement.innerHTML = modalContent;
            
            document.body.appendChild(modalElement);
            
            // Mostrar el modal
            $('#' + modalId).modal('show');
            
            // Ocultar indicador de carga
            this.showLoading(false);
            
            // Agregar eventos a los botones del modal
            document.getElementById('imprimirDetalleBtn').addEventListener('click', () => {
                $('#' + modalId).modal('hide');
                this.imprimirCompra(compraId);
            });
            
            document.getElementById('exportarPDFDetalleBtn').addEventListener('click', () => {
                $('#' + modalId).modal('hide');
                this.exportarCompraPDF(compraId);
            });
            
            logAction('reportes_compras', 'ver_detalle', 'Detalle de compra visualizado', {
                compraId: compraId
            });
        } catch (error) {
            console.error('Error al mostrar detalle de compra:', error);
            this.showError('No se pudo mostrar el detalle de la compra');
            this.showLoading(false);
        }
    }
    
    /**
     * Genera el HTML para el modal de detalle de compra
     */
    generarHTMLDetalleCompra(compra) {
        // Formatear fecha
        const fecha = new Date(compra.fecha);
        const fechaFormateada = formatDate(fecha, 'dd/MM/yyyy HH:mm');
        
        // Estado de pago
        const estadoPago = compra.pagado ? 
            '<span class="badge badge-success">Pagado</span>' : 
            '<span class="badge badge-warning">Pendiente</span>';
        
        // Generar tabla de productos
        let productosHTML = '';
        let subtotal = 0;
        
        if (compra.productos && compra.productos.length > 0) {
            productosHTML = `
                <table class="table table-sm table-striped">
                    <thead>
                        <tr>
                            <th>Código</th>
                            <th>Producto</th>
                            <th class="text-right">Cantidad</th>
                            <th class="text-right">Precio Unit.</th>
                            <th class="text-right">Subtotal</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
            
            compra.productos.forEach(producto => {
                const productoSubtotal = producto.precio * producto.cantidad;
                subtotal += productoSubtotal;
                
                productosHTML += `
                    <tr>
                        <td>${producto.sku || 'N/A'}</td>
                        <td>${producto.nombre || 'Producto no encontrado'}</td>
                        <td class="text-right">${producto.cantidad}</td>
                        <td class="text-right">${formatCurrency(producto.precio)}</td>
                        <td class="text-right">${formatCurrency(productoSubtotal)}</td>
                    </tr>
                `;
            });
            
            productosHTML += '</tbody></table>';
        } else {
            productosHTML = '<div class="alert alert-info">No hay detalle de productos disponible para esta compra.</div>';
            subtotal = compra.total;
        }
        
        // Generar HTML completo del modal
        return `
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Detalle de Compra #${compra.numeroFactura || compra._id}</h5>
                        <button type="button" class="close" data-dismiss="modal">
                            <span>&times;</span>
                        </button>
                    </div>
                    <div class="modal-body">
                        <div class="row mb-3">
                            <div class="col-md-6">
                                <h6>Información del Proveedor</h6>
                                <p>
                                    <strong>Razón Social:</strong> ${compra.proveedor.razonSocial}<br>
                                    <strong>CUIT:</strong> ${compra.proveedor.cuit || 'N/A'}<br>
                                    <strong>Dirección:</strong> ${compra.proveedor.direccion || 'N/A'}<br>
                                    <strong>Teléfono:</strong> ${compra.proveedor.telefono || 'N/A'}
                                </p>
                            </div>
                            <div class="col-md-6">
                                <h6>Información de la Compra</h6>
                                <p>
                                    <strong>Fecha:</strong> ${fechaFormateada}<br>
                                    <strong>Factura Nº:</strong> ${compra.numeroFactura || 'N/A'}<br>
                                    <strong>Forma de Pago:</strong> ${compra.formaPago || 'N/A'}<br>
                                    <strong>Estado:</strong> ${estadoPago}
                                </p>
                            </div>
                        </div>
                        
                        <hr>
                        
                        <h6>Productos</h6>
                        ${productosHTML}
                        
                        <div class="row">
                            <div class="col-md-6">
                                <p><strong>Observaciones:</strong></p>
                                <p>${compra.observaciones || 'Sin observaciones'}</p>
                            </div>
                            <div class="col-md-6">
                                <div class="table-responsive">
                                    <table class="table table-sm">
                                        <tr>
                                            <th>Subtotal:</th>
                                            <td class="text-right">${formatCurrency(subtotal)}</td>
                                        </tr>
                                        ${compra.descuento ? `
                                        <tr>
                                            <th>Descuento (${compra.descuentoPorcentaje || 0}%):</th>
                                            <td class="text-right">${formatCurrency(compra.descuento)}</td>
                                        </tr>` : ''}
                                        ${compra.impuestos ? `
                                        <tr>
                                            <th>Impuestos:</th>
                                            <td class="text-right">${formatCurrency(compra.impuestos)}</td>
                                        </tr>` : ''}
                                        <tr>
                                            <th>TOTAL:</th>
                                            <td class="text-right h5">${formatCurrency(compra.total)}</td>
                                        </tr>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-dismiss="modal">Cerrar</button>
                        <button id="imprimirDetalleBtn" type="button" class="btn btn-info">
                            <i class="fas fa-print"></i> Imprimir
                        </button>
                        <button id="exportarPDFDetalleBtn" type="button" class="btn btn-primary">
                            <i class="fas fa-file-pdf"></i> Exportar PDF
                        </button>
                    </div>
                </div>
            </div>
        `;
    }
    
    /**
     * Imprime el detalle de una compra específica
     */
    async imprimirCompra(compraId) {
        try {
            // Mostrar indicador de carga
            this.showLoading(true);
            
            // Obtener datos de la compra
            const compra = await this.db.compras.findOne({ _id: compraId });
            
            if (!compra) {
                this.showError('No se encontró la compra solicitada');
                this.showLoading(false);
                return;
            }
            
            // Cargar datos adicionales necesarios para la impresión
            await this.cargarDatosCompletos(compra);
            
            // Generar y mostrar vista previa de impresión
            const printContent = await this.generarHTMLImpresion(compra);
            
            // Enviar a imprimir
            const { printDocument } = await Promise.resolve(require('../../../services/print/printer.js'));
            
            await printDocument({
                content: printContent,
                title: `Compra #${compra.numeroFactura || compra._id}`,
                preview: true // Mostrar vista previa antes de imprimir
            });
            
            this.showLoading(false);
            
            logAction('reportes_compras', 'imprimir_compra', 'Compra impresa', {
                compraId: compraId
            });
        } catch (error) {
            console.error('Error al imprimir compra:', error);
            this.showError('No se pudo imprimir la compra');
            this.showLoading(false);
        }
    }
    
    /**
     * Exporta una compra específica a PDF
     */
    async exportarCompraPDF(compraId) {
        try {
            // Mostrar indicador de carga
            this.showLoading(true);
            
            // Obtener datos de la compra
            const compra = await this.db.compras.findOne({ _id: compraId });
            
            if (!compra) {
                this.showError('No se encontró la compra solicitada');
                this.showLoading(false);
                return;
            }
            
            // Cargar datos adicionales necesarios para el PDF
            await this.cargarDatosCompletos(compra);
            
            // Generar contenido HTML
            const htmlContent = await this.generarHTMLImpresion(compra);
            
            // Generar PDF
            const { generatePDF } = await Promise.resolve(require('../../../services/print/pdf.js'));
            
            const fecha = new Date(compra.fecha);
            const fechaFormateada = formatDate(fecha, 'yyyy-MM-dd');
            
            const fileName = `Compra_${compra.numeroFactura || compra._id}_${fechaFormateada}.pdf`;
            
            await generatePDF({
                content: htmlContent,
                fileName: fileName,
                options: {
                    format: 'A4',
                    margin: {
                        top: '1.5cm',
                        right: '1.5cm',
                        bottom: '1.5cm',
                        left: '1.5cm'
                    },
                    printBackground: true,
                    headerTemplate: `
                        <div style="width: 100%; text-align: center; font-size: 10px; color: #777;">
                            <p>FactuSystem - Reporte de Compra</p>
                        </div>
                    `,
                    footerTemplate: `
                        <div style="width: 100%; text-align: center; font-size: 10px; color: #777;">
                            <p>Página <span class="pageNumber"></span> de <span class="totalPages"></span></p>
                        </div>
                    `,
                    displayHeaderFooter: true
                }
            });
            
            this.showLoading(false);
            
            logAction('reportes_compras', 'exportar_pdf_compra', 'Compra exportada a PDF', {
                compraId: compraId
            });
        } catch (error) {
            console.error('Error al exportar compra a PDF:', error);
            this.showError('No se pudo exportar la compra a PDF');
            this.showLoading(false);
        }
    }
    
    /**
     * Carga datos completos de una compra (productos, proveedor, etc.)
     */
    async cargarDatosCompletos(compra) {
        try {
            // Cargar datos del proveedor si no están completos
            if (!compra.proveedor || !compra.proveedor.razonSocial) {
                const proveedor = await this.db.proveedores.findOne({ _id: compra.proveedorId });
                compra.proveedor = proveedor || { razonSocial: 'Proveedor no encontrado' };
            }
            
            // Cargar datos de productos
            if (compra.productos && compra.productos.length > 0) {
                for (const producto of compra.productos) {
                    if (!producto.nombre) {
                        const productoCompleto = await this.db.productos.findOne({ _id: producto.productoId });
                        if (productoCompleto) {
                            producto.nombre = productoCompleto.nombre;
                            producto.sku = productoCompleto.codigoBarras || productoCompleto.sku || 'N/A';
                        } else {
                            producto.nombre = 'Producto no encontrado';
                            producto.sku = 'N/A';
                        }
                    }
                }
            }
            
            // Cargar datos de la sucursal si no están completos
            if (!compra.sucursal || !compra.sucursal.nombre) {
                const sucursal = await this.db.sucursales.findOne({ _id: compra.sucursalId });
                compra.sucursal = sucursal || { nombre: 'Sucursal no encontrada' };
            }
            
            // Cargar datos del usuario si no están completos
            if (!compra.usuario || !compra.usuario.nombre) {
                const usuario = await this.db.usuarios.findOne({ _id: compra.usuarioId });
                compra.usuario = usuario || { nombre: 'Usuario no encontrado', apellido: '' };
            }
            
            // Obtener datos de la empresa
            compra.empresa = await this.db.configuracion.findOne({ tipo: 'empresa' }) || {
                nombre: 'Mi Empresa',
                direccion: '',
                telefono: '',
                cuit: '',
                logo: ''
            };
            
            return compra;
        } catch (error) {
            console.error('Error al cargar datos completos de compra:', error);
            throw error;
        }
    }
    
    /**
     * Genera HTML para impresión o exportación de una compra
     */
    async generarHTMLImpresion(compra) {
        // Formatear fecha
        const fecha = new Date(compra.fecha);
        const fechaFormateada = formatDate(fecha, 'dd/MM/yyyy HH:mm');
        
        // Obtener plantilla de impresión
        let template;
        try {
            const response = await fetch('../../../templates/reportes/compra.html');
            template = await response.text();
        } catch (error) {
            console.error('Error al cargar plantilla:', error);
            template = this.generarPlantillaHTML(); // Plantilla de respaldo
        }
        
        // Generar tabla de productos
        let productosHTML = '';
        let subtotal = 0;
        
        if (compra.productos && compra.productos.length > 0) {
            compra.productos.forEach(producto => {
                const productoSubtotal = producto.precio * producto.cantidad;
                subtotal += productoSubtotal;
                
                productosHTML += `
                    <tr>
                        <td>${producto.sku || 'N/A'}</td>
                        <td>${producto.nombre || 'Producto no encontrado'}</td>
                        <td class="text-right">${producto.cantidad}</td>
                        <td class="text-right">${formatCurrency(producto.precio)}</td>
                        <td class="text-right">${formatCurrency(productoSubtotal)}</td>
                    </tr>
                `;
            });
        } else {
            productosHTML = `
                <tr>
                    <td colspan="5" class="text-center">No hay detalle de productos disponible para esta compra.</td>
                </tr>
            `;
            subtotal = compra.total;
        }
        
        // Reemplazar variables en la plantilla
        const logoEmpresa = compra.empresa.logo || '';
        
        const reemplazos = {
            '{{LOGO_EMPRESA}}': logoEmpresa ? `<img src="${logoEmpresa}" alt="Logo" style="max-height: 80px; max-width: 200px;">` : '',
            '{{EMPRESA_NOMBRE}}': compra.empresa.nombre || 'Mi Empresa',
            '{{EMPRESA_DIRECCION}}': compra.empresa.direccion || '',
            '{{EMPRESA_TELEFONO}}': compra.empresa.telefono || '',
            '{{EMPRESA_CUIT}}': compra.empresa.cuit || '',
            '{{COMPRA_NUMERO}}': compra.numeroFactura || compra._id,
            '{{COMPRA_FECHA}}': fechaFormateada,
            '{{PROVEEDOR_NOMBRE}}': compra.proveedor.razonSocial || 'Proveedor no encontrado',
            '{{PROVEEDOR_CUIT}}': compra.proveedor.cuit || 'N/A',
            '{{PROVEEDOR_DIRECCION}}': compra.proveedor.direccion || 'N/A',
            '{{PROVEEDOR_TELEFONO}}': compra.proveedor.telefono || 'N/A',
            '{{FORMA_PAGO}}': compra.formaPago || 'N/A',
            '{{ESTADO_PAGO}}': compra.pagado ? 'PAGADO' : 'PENDIENTE',
            '{{PRODUCTOS_TABLA}}': productosHTML,
            '{{SUBTOTAL}}': formatCurrency(subtotal),
            '{{DESCUENTO}}': compra.descuento ? formatCurrency(compra.descuento) : '0,00',
            '{{DESCUENTO_PORCENTAJE}}': compra.descuentoPorcentaje ? `${compra.descuentoPorcentaje}%` : '0%',
            '{{IMPUESTOS}}': compra.impuestos ? formatCurrency(compra.impuestos) : '0,00',
            '{{TOTAL}}': formatCurrency(compra.total),
            '{{USUARIO}}': compra.usuario ? `${compra.usuario.nombre} ${compra.usuario.apellido}` : 'Usuario no registrado',
            '{{SUCURSAL}}': compra.sucursal ? compra.sucursal.nombre : 'Sucursal no registrada',
            '{{OBSERVACIONES}}': compra.observaciones || 'Sin observaciones',
            '{{FECHA_IMPRESION}}': formatDate(new Date(), 'dd/MM/yyyy HH:mm:ss')
        };
        
        // Aplicar reemplazos
        let htmlContent = template;
        for (const [key, value] of Object.entries(reemplazos)) {
            htmlContent = htmlContent.replace(new RegExp(key, 'g'), value);
        }
        
        return htmlContent;
    }
    
    /**
     * Genera una plantilla HTML básica en caso de no poder cargar la predefinida
     */
    generarPlantillaHTML() {
        return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Detalle de Compra</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    margin: 0;
                    padding: 20px;
                    font-size: 12px;
                }
                h1 {
                    font-size: 18px;
                    margin-bottom: 15px;
                }
                .header {
                    margin-bottom: 20px;
                    display: flex;
                    justify-content: space-between;
                }
                .company-info {
                    width: 50%;
                }
                .document-info {
                    width: 50%;
                    text-align: right;
                }
                .info-block {
                    margin-bottom: 15px;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-bottom: 20px;
                }
                th, td {
                    padding: 8px;
                    border: 1px solid #ddd;
                }
                th {
                    background-color: #f2f2f2;
                    text-align: left;
                }
                .text-right {
                    text-align: right;
                }
                .text-center {
                    text-align: center;
                }
                .totals {
                    width: 50%;
                    margin-left: 50%;
                }
                .footer {
                    margin-top: 30px;
                    text-align: center;
                    font-size: 10px;
                    color: #666;
                }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="company-info">
                    <div>{{LOGO_EMPRESA}}</div>
                    <h1>{{EMPRESA_NOMBRE}}</h1>
                    <p>{{EMPRESA_DIRECCION}}</p>
                    <p>Tel: {{EMPRESA_TELEFONO}}</p>
                    <p>CUIT: {{EMPRESA_CUIT}}</p>
                </div>
                <div class="document-info">
                    <h2>COMPRA N° {{COMPRA_NUMERO}}</h2>
                    <p>Fecha: {{COMPRA_FECHA}}</p>
                    <p>Estado: {{ESTADO_PAGO}}</p>
                </div>
            </div>
            
            <div class="info-block">
                <h3>Datos del Proveedor</h3>
                <p>
                    <strong>Razón Social:</strong> {{PROVEEDOR_NOMBRE}}<br>
                    <strong>CUIT:</strong> {{PROVEEDOR_CUIT}}<br>
                    <strong>Dirección:</strong> {{PROVEEDOR_DIRECCION}}<br>
                    <strong>Teléfono:</strong> {{PROVEEDOR_TELEFONO}}
                </p>
            </div>
            
            <div class="info-block">
                <h3>Productos</h3>
                <table>
                    <thead>
                        <tr>
                            <th>Código</th>
                            <th>Producto</th>
                            <th class="text-right">Cantidad</th>
                            <th class="text-right">Precio Unit.</th>
                            <th class="text-right">Subtotal</th>
                        </tr>
                    </thead>
                    <tbody>
                        {{PRODUCTOS_TABLA}}
                    </tbody>
                </table>
            </div>
            
            <div class="totals">
                <table>
                    <tr>
                        <th>Subtotal:</th>
                        <td class="text-right">{{SUBTOTAL}}</td>
                    </tr>
                    <tr>
                        <th>Descuento ({{DESCUENTO_PORCENTAJE}}):</th>
                        <td class="text-right">{{DESCUENTO}}</td>
                    </tr>
                    <tr>
                        <th>Impuestos:</th>
                        <td class="text-right">{{IMPUESTOS}}</td>
                    </tr>
                    <tr>
                        <th>TOTAL:</th>
                        <td class="text-right"><strong>{{TOTAL}}</strong></td>
                    </tr>
                </table>
            </div>
            
            <div class="info-block">
                <h3>Observaciones</h3>
                <p>{{OBSERVACIONES}}</p>
            </div>
            
            <div class="info-block">
                <p>
                    <strong>Forma de Pago:</strong> {{FORMA_PAGO}}<br>
                    <strong>Usuario:</strong> {{USUARIO}}<br>
                    <strong>Sucursal:</strong> {{SUCURSAL}}
                </p>
            </div>
            
            <div class="footer">
                <p>Documento generado el {{FECHA_IMPRESION}} - FactuSystem</p>
            </div>
        </body>
        </html>
        `;
    }
    
    /**
     * Exporta el reporte actual a PDF
     */
    async exportToPDF() {
        try {
            // Mostrar indicador de carga
            this.showLoading(true);
            
            // Obtener datos actuales según filtros
            const compras = await this.fetchComprasData();
            
            if (compras.length === 0) {
                this.showError('No hay datos para exportar');
                this.showLoading(false);
                return;
            }
            
            // Obtener datos de la empresa
            const empresa = await this.db.configuracion.findOne({ tipo: 'empresa' }) || {
                nombre: 'Mi Empresa',
                direccion: '',
                telefono: '',
                cuit: '',
                logo: ''
            };
            
            // Generar contenido HTML para el PDF
            const htmlContent = await this.generarHTMLReporteCompleto(compras, empresa);
            
            // Generar PDF
            const { generatePDF } = await Promise.resolve(require('../../../services/print/pdf.js'));
            
            // Formatear fechas para el nombre del archivo
            const dateFrom = formatDate(this.currentFilters.dateFrom, 'yyyy-MM-dd');
            const dateTo = formatDate(this.currentFilters.dateTo, 'yyyy-MM-dd');
            
            const fileName = `Reporte_Compras_${dateFrom}_${dateTo}.pdf`;
            
            await generatePDF({
                content: htmlContent,
                fileName: fileName,
                options: {
                    format: 'A4',
                    margin: {
                        top: '2cm',
                        right: '1.5cm',
                        bottom: '2cm',
                        left: '1.5cm'
                    },
                    printBackground: true,
                    headerTemplate: `
                        <div style="width: 100%; text-align: center; font-size: 10px; color: #777;">
                            <p>FactuSystem - Reporte de Compras</p>
                        </div>
                    `,
                    footerTemplate: `
                        <div style="width: 100%; text-align: center; font-size: 10px; color: #777;">
                            <p>Página <span class="pageNumber"></span> de <span class="totalPages"></span></p>
                        </div>
                    `,
                    displayHeaderFooter: true
                }
            });
            
            this.showLoading(false);
            
            logAction('reportes_compras', 'export_pdf', 'Reporte exportado a PDF', {
                filtros: this.currentFilters,
                cantidadCompras: compras.length
            });
        } catch (error) {
            console.error('Error al exportar a PDF:', error);
            this.showError('No se pudo exportar el reporte a PDF');
            this.showLoading(false);
        }
    }
    
    /**
     * Genera el HTML completo para el reporte de compras
     */
    async generarHTMLReporteCompleto(compras, empresa) {
        // Formatear fechas del rango
        const dateFrom = formatDate(this.currentFilters.dateFrom, 'dd/MM/yyyy');
        const dateTo = formatDate(this.currentFilters.dateTo, 'dd/MM/yyyy');
        
        // Obtener plantilla de reporte
        let template;
        try {
            const response = await fetch('../../../templates/reportes/compras_reporte.html');
            template = await response.text();
        } catch (error) {
            console.error('Error al cargar plantilla:', error);
            template = this.generarPlantillaReporteHTML(); // Plantilla de respaldo
        }
        
        // Generar tabla de compras
        let comprasHTML = '';
        let total = 0;
        
        compras.forEach((compra, index) => {
            // Formatear fecha
            const fecha = new Date(compra.fecha);
            const fechaFormateada = formatDate(fecha, 'dd/MM/yyyy');
            
            // Estado de pago
            const estadoPago = compra.pagado ? 'Pagado' : 'Pendiente';
            
            // Acumular total
            total += compra.total;
            
            // Agregar fila
            comprasHTML += `
                <tr>
                    <td>${index + 1}</td>
                    <td>${fechaFormateada}</td>
                    <td>${compra.numeroFactura || 'N/A'}</td>
                    <td>${compra.proveedor.razonSocial}</td>
                    <td>${compra.sucursal ? compra.sucursal.nombre : 'N/A'}</td>
                    <td>${formatCurrency(compra.total)}</td>
                    <td>${compra.formaPago || 'N/A'}</td>
                    <td>${estadoPago}</td>
                </tr>
            `;
        });
        
        // Definir reemplazos
        const logoEmpresa = empresa.logo || '';
        
        const reemplazos = {
            '{{LOGO_EMPRESA}}': logoEmpresa ? `<img src="${logoEmpresa}" alt="Logo" style="max-height: 80px; max-width: 200px;">` : '',
            '{{EMPRESA_NOMBRE}}': empresa.nombre || 'Mi Empresa',
            '{{EMPRESA_DIRECCION}}': empresa.direccion || '',
            '{{EMPRESA_TELEFONO}}': empresa.telefono || '',
            '{{EMPRESA_CUIT}}': empresa.cuit || '',
            '{{FECHA_DESDE}}': dateFrom,
            '{{FECHA_HASTA}}': dateTo,
            '{{PROVEEDOR}}': this.currentFilters.proveedor !== 'todos' ? 
                await this.getNombreProveedor(this.currentFilters.proveedor) : 'Todos',
            '{{SUCURSAL}}': this.currentFilters.sucursal !== 'todas' ? 
                await this.getNombreSucursal(this.currentFilters.sucursal) : 'Todas',
            '{{COMPRAS_TABLA}}': comprasHTML,
            '{{TOTAL_COMPRAS}}': formatCurrency(total),
            '{{CANTIDAD_COMPRAS}}': compras.length,
            '{{FECHA_GENERACION}}': formatDate(new Date(), 'dd/MM/yyyy HH:mm:ss'),
            '{{USUARIO}}': getCurrentUser().nombre + ' ' + getCurrentUser().apellido
        };
        
        // Aplicar reemplazos
        let htmlContent = template;
        for (const [key, value] of Object.entries(reemplazos)) {
            htmlContent = htmlContent.replace(new RegExp(key, 'g'), value);
        }
        
        return htmlContent;
    }
    
    /**
     * Obtiene el nombre de un proveedor por su ID
     */
    async getNombreProveedor(proveedorId) {
        try {
            const proveedor = await this.db.proveedores.findOne({ _id: proveedorId });
            return proveedor ? proveedor.razonSocial : 'Proveedor no encontrado';
        } catch (error) {
            console.error('Error al obtener nombre de proveedor:', error);
            return 'Proveedor no encontrado';
        }
    }
    
    /**
     * Obtiene el nombre de una sucursal por su ID
     */
    async getNombreSucursal(sucursalId) {
        try {
            const sucursal = await this.db.sucursales.findOne({ _id: sucursalId });
            return sucursal ? sucursal.nombre : 'Sucursal no encontrada';
        } catch (error) {
            console.error('Error al obtener nombre de sucursal:', error);
            return 'Sucursal no encontrada';
        }
    }
    
    /**
     * Genera una plantilla HTML básica para el reporte completo
     */
    generarPlantillaReporteHTML() {
        return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Reporte de Compras</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    margin: 0;
                    padding: 20px;
                    font-size: 12px;
                }
                h1 {
                    font-size: 18px;
                    margin-bottom: 15px;
                    text-align: center;
                }
                .header {
                    margin-bottom: 20px;
                    display: flex;
                    justify-content: space-between;
                }
                .company-info {
                    width: 50%;
                }
                .report-info {
                    width: 50%;
                    text-align: right;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-bottom: 20px;
                }
                th, td {
                    padding: 8px;
                    border: 1px solid #ddd;
                }
                th {
                    background-color: #f2f2f2;
                    text-align: left;
                }
                .text-right {
                    text-align: right;
                }
                .text-center {
                    text-align: center;
                }
                .footer {
                    margin-top: 30px;
                    text-align: center;
                    font-size: 10px;
                    color: #666;
                }
                .summary {
                    margin-top: 20px;
                    border: 1px solid #ddd;
                    padding: 10px;
                    background-color: #f9f9f9;
                }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="company-info">
                    <div>{{LOGO_EMPRESA}}</div>
                    <h2>{{EMPRESA_NOMBRE}}</h2>
                    <p>{{EMPRESA_DIRECCION}}</p>
                    <p>Tel: {{EMPRESA_TELEFONO}}</p>
                    <p>CUIT: {{EMPRESA_CUIT}}</p>
                </div>
                <div class="report-info">
                    <h2>REPORTE DE COMPRAS</h2>
                    <p><strong>Período:</strong> {{FECHA_DESDE}} - {{FECHA_HASTA}}</p>
                    <p><strong>Proveedor:</strong> {{PROVEEDOR}}</p>
                    <p><strong>Sucursal:</strong> {{SUCURSAL}}</p>
                </div>
            </div>
            
            <h1>LISTADO DE COMPRAS</h1>
            
            <table>
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Fecha</th>
                        <th>Factura</th>
                        <th>Proveedor</th>
                        <th>Sucursal</th>
                        <th class="text-right">Total</th>
                        <th>Forma de Pago</th>
                        <th>Estado</th>
                    </tr>
                </thead>
                <tbody>
                    {{COMPRAS_TABLA}}
                </tbody>
                <tfoot>
                    <tr>
                        <th colspan="5" class="text-right">TOTAL:</th>
                        <th class="text-right">{{TOTAL_COMPRAS}}</th>
                        <th colspan="2"></th>
                    </tr>
                </tfoot>
            </table>
            
            <div class="summary">
                <h3>Resumen</h3>
                <p><strong>Total de compras en el período:</strong> {{TOTAL_COMPRAS}}</p>
                <p><strong>Cantidad de compras:</strong> {{CANTIDAD_COMPRAS}}</p>
            </div>
            
            <div class="footer">
                <p>Reporte generado el {{FECHA_GENERACION}} por {{USUARIO}} - FactuSystem</p>
            </div>
        </body>
        </html>
        `;
    }
    
    /**
     * Exporta el reporte actual a Excel
     */
    async exportToExcel() {
        try {
            // Mostrar indicador de carga
            this.showLoading(true);
            
            // Obtener datos actuales según filtros
            const compras = await this.fetchComprasData();
            
            if (compras.length === 0) {
                this.showError('No hay datos para exportar');
                this.showLoading(false);
                return;
            }
            
            // Importar librería para Excel
            const { generateExcel } = await Promise.resolve(require('../../../services/export/excel.js'));
            
            // Formatear fechas para el nombre del archivo
            const dateFrom = formatDate(this.currentFilters.dateFrom, 'yyyy-MM-dd');
            const dateTo = formatDate(this.currentFilters.dateTo, 'yyyy-MM-dd');
            
            const fileName = `Reporte_Compras_${dateFrom}_${dateTo}.xlsx`;
            
            // Preparar datos para Excel
            const headers = [
                'Fecha', 'Nº Factura', 'Proveedor', 'Sucursal', 
                'Total', 'Forma de Pago', 'Estado', 'Usuario'
            ];
            
            const data = compras.map(compra => [
                formatDate(new Date(compra.fecha), 'dd/MM/yyyy'),
                compra.numeroFactura || 'N/A',
                compra.proveedor.razonSocial,
                compra.sucursal ? compra.sucursal.nombre : 'N/A',
                compra.total,
                compra.formaPago || 'N/A',
                compra.pagado ? 'Pagado' : 'Pendiente',
                compra.usuario ? `${compra.usuario.nombre} ${compra.usuario.apellido}` : 'N/A'
            ]);
            
            // Configurar opciones para Excel
            const options = {
                fileName: fileName,
                sheets: [
                    {
                        name: 'Compras',
                        headers: headers,
                        data: data
                    }
                ],
                properties: {
                    title: 'Reporte de Compras',
                    subject: `Período ${dateFrom} - ${dateTo}`,
                    author: getCurrentUser().nombre + ' ' + getCurrentUser().apellido,
                    company: 'FactuSystem'
                },
                formats: [
                    { cells: 'E', type: 'currency' }
                ]
            };
            
            // Generar Excel
            await generateExcel(options);
            
            this.showLoading(false);
            
            logAction('reportes_compras', 'export_excel', 'Reporte exportado a Excel', {
                filtros: this.currentFilters,
                cantidadCompras: compras.length
            });
        } catch (error) {
            console.error('Error al exportar a Excel:', error);
            this.showError('No se pudo exportar el reporte a Excel');
            this.showLoading(false);
        }
    }
    
    /**
     * Imprime el reporte actual
     */
    async printReport() {
        try {
            // Mostrar indicador de carga
            this.showLoading(true);
            
            // Obtener datos actuales según filtros
            const compras = await this.fetchComprasData();
            
            if (compras.length === 0) {
                this.showError('No hay datos para imprimir');
                this.showLoading(false);
                return;
            }
            
            // Obtener datos de la empresa
            const empresa = await this.db.configuracion.findOne({ tipo: 'empresa' }) || {
                nombre: 'Mi Empresa',
                direccion: '',
                telefono: '',
                cuit: '',
                logo: ''
            };
            
            // Generar contenido HTML para la impresión
            const htmlContent = await this.generarHTMLReporteCompleto(compras, empresa);
            
            // Enviar a imprimir
            const { printDocument } = await Promise.resolve(require('../../../services/print/printer.js'));
            
            await printDocument({
                content: htmlContent,
                title: 'Reporte de Compras',
                preview: true // Mostrar vista previa antes de imprimir
            });
            
            this.showLoading(false);
            
            logAction('reportes_compras', 'print_report', 'Reporte impreso', {
                filtros: this.currentFilters,
                cantidadCompras: compras.length
            });
        } catch (error) {
            console.error('Error al imprimir reporte:', error);
            this.showError('No se pudo imprimir el reporte');
            this.showLoading(false);
        }
    }
    
    /**
     * Muestra un mensaje cuando no hay datos para mostrar
     */
    showNoData() {
        // Ocultar gráficos y tabla
        this.elements.chartsContainer.style.display = 'none';
        this.elements.tableContainer.style.display = 'none';
        
        // Mostrar mensaje
        const noDataElement = document.createElement('div');
        noDataElement.className = 'alert alert-info text-center';
        noDataElement.id = 'compras-no-data';
        noDataElement.innerHTML = `
            <i class="fas fa-info-circle fa-2x mb-3"></i>
            <h4>No hay datos para mostrar</h4>
            <p>No se encontraron compras para los filtros seleccionados.</p>
            <p>Intente con otros criterios de búsqueda.</p>
        `;
        
        // Eliminar mensaje anterior si existe
        const existingNoData = document.getElementById('compras-no-data');
        if (existingNoData) {
            existingNoData.remove();
        }
        
        // Insertar después del contenedor de filtros
        this.elements.filtersContainer.after(noDataElement);
    }
    
    /**
     * Muestra u oculta el indicador de carga
     */
    showLoading(show) {
        if (show) {
            this.elements.loadingIndicator.style.display = 'block';
        } else {
            this.elements.loadingIndicator.style.display = 'none';
        }
    }
    
    /**
     * Muestra un mensaje de error
     */
    showError(message) {
        this.elements.errorMessage.textContent = message;
        this.elements.errorMessage.style.display = 'block';
        
        // Ocultar automáticamente después de 5 segundos
        setTimeout(() => {
            this.hideError();
        }, 5000);
    }
    
    /**
     * Oculta el mensaje de error
     */
    hideError() {
        this.elements.errorMessage.style.display = 'none';
    }
}

// Exportar clase para uso en otros módulos
 ComprasReportes

module.exports = ComprasReportes;
                