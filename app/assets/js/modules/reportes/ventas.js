/**
 * FactuSystem - Módulo de Reportes de Ventas
 * 
 * Este módulo maneja la generación y visualización de reportes de ventas,
 * incluyendo filtros, estadísticas, gráficos y exportación a PDF.
 */

// Importaciones de dependencias
const { getDatabase } = require('../../../utils/database.js');
const { getCurrentUser } = require('../../../utils/auth.js');
const { formatCurrency, formatDate, formatDateTime } = require('../../../utils/formatting.js');
const { generatePDF } = require('../../../../services/print/pdf.js');
const { getPermissions } = require('../../../utils/auth.js');
const { ipcRenderer } = require('electron');
const { getSucursalData } = require('../../../modules/sucursales/index.js');
const notificaciones = require('../../../components/notifications.js');
const chartjs = require('chart.js');

// Variables globales
let db;
let currentFilters = {
    startDate: new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
    tipoComprobante: 'todos',
    metodoPago: 'todos',
    cliente: '',
    usuario: '',
    sucursal: 'todas',
    ordenarPor: 'fecha',
    ordenDireccion: 'desc'
};
let ventasData = [];
let usuarioActual;
let sucursales = [];
let userPermissions;
let chartVentasPorDia;
let chartVentasPorMetodo;
let chartTopProductos;
let chartComparativaSucursales;
let chartVentasMensuales;

/**
 * Inicializa el módulo de reportes de ventas
 * @async
 */
async function init() {
    try {
        // Conectar a la base de datos
        db = await getDatabase();
        
        // Obtener información del usuario actual
        usuarioActual = await getCurrentUser();
        
        // Obtener permisos del usuario
        userPermissions = await getPermissions(usuarioActual.id);
        
        // Verificar permisos
        if (!userPermissions.reportes.ver) {
            document.getElementById('ventasReporteContainer').innerHTML = `
                <div class="permiso-denegado">
                    <i class="fas fa-lock"></i>
                    <h3>Acceso Denegado</h3>
                    <p>No tienes permisos para ver reportes de ventas.</p>
                </div>
            `;
            return;
        }
        
        // Obtener lista de sucursales
        await cargarSucursales();
        
        // Inicializar selectores y filtros
        inicializarFiltros();
        
        // Cargar datos iniciales
        await cargarDatos();
        
        // Inicializar gráficos
        inicializarGraficos();
        
        // Configurar listeners para eventos
        configurarEventListeners();
        
        notificaciones.mostrar('Módulo de reportes de ventas cargado correctamente', 'info');
    } catch (error) {
        console.error('Error al inicializar el módulo de reportes de ventas:', error);
        notificaciones.mostrar('Error al cargar el módulo de reportes de ventas', 'error');
    }
}

/**
 * Carga la lista de sucursales disponibles
 * @async
 */
async function cargarSucursales() {
    try {
        // Si el usuario es administrador o tiene permiso para ver todas las sucursales
        if (userPermissions.sucursales.verTodas) {
            sucursales = await db.all("SELECT * FROM sucursales ORDER BY nombre");
        } else {
            // Si sólo tiene acceso a su sucursal
            sucursales = await db.all(
                "SELECT * FROM sucursales WHERE id IN (SELECT sucursal_id FROM usuario_sucursal WHERE usuario_id = ?)",
                [usuarioActual.id]
            );
        }
    } catch (error) {
        console.error('Error al cargar sucursales:', error);
        notificaciones.mostrar('Error al cargar la lista de sucursales', 'error');
    }
}

/**
 * Inicializa los componentes de filtro de la interfaz
 */
function inicializarFiltros() {
    // Establecer fechas por defecto en los inputs
    document.getElementById('fechaInicio').value = currentFilters.startDate;
    document.getElementById('fechaFin').value = currentFilters.endDate;
    
    // Inicializar selector de sucursales
    const sucursalSelect = document.getElementById('selectSucursal');
    sucursalSelect.innerHTML = '<option value="todas">Todas las sucursales</option>';
    
    sucursales.forEach(sucursal => {
        sucursalSelect.innerHTML += `<option value="${sucursal.id}">${sucursal.nombre}</option>`;
    });
    
    // Inicializar selector de tipo de comprobante
    const tipoComprobanteSelect = document.getElementById('selectTipoComprobante');
    tipoComprobanteSelect.innerHTML = `
        <option value="todos">Todos los comprobantes</option>
        <option value="A">Factura A</option>
        <option value="B">Factura B</option>
        <option value="C">Factura C</option>
        <option value="X">Factura X</option>
        <option value="P">Presupuesto</option>
    `;
    
    // Inicializar selector de método de pago
    const metodoPagoSelect = document.getElementById('selectMetodoPago');
    metodoPagoSelect.innerHTML = `
        <option value="todos">Todos los métodos</option>
        <option value="efectivo">Efectivo</option>
        <option value="tarjeta_debito">Tarjeta de Débito</option>
        <option value="tarjeta_credito">Tarjeta de Crédito</option>
        <option value="transferencia">Transferencia</option>
        <option value="mercadopago">Mercado Pago</option>
        <option value="otros">Otros</option>
    `;
    
    // Inicializar selector de usuarios si tiene el permiso
    if (userPermissions.reportes.verPorUsuario) {
        cargarUsuarios();
    } else {
        // Ocultar el filtro de usuarios si no tiene permiso
        document.getElementById('filtroUsuario').style.display = 'none';
    }
    
    // Inicializar autocompletado de clientes
    document.getElementById('inputCliente').addEventListener('input', debounce(buscarClientes, 300));
}

/**
 * Configura los eventos para los elementos de la interfaz
 */
function configurarEventListeners() {
    // Botón aplicar filtros
    document.getElementById('btnAplicarFiltros').addEventListener('click', async () => {
        actualizarFiltros();
        await cargarDatos();
    });
    
    // Botón reset filtros
    document.getElementById('btnResetFiltros').addEventListener('click', resetFiltros);
    
    // Botón exportar a PDF
    document.getElementById('btnExportarPDF').addEventListener('click', exportarPDF);
    
    // Selector de agrupación para gráficos
    document.getElementById('selectAgrupacion').addEventListener('change', cambiarAgrupacionGrafico);
    
    // Tabs para cambiar entre vista detallada y análisis
    document.getElementById('tabDetalle').addEventListener('click', () => cambiarTab('detalle'));
    document.getElementById('tabAnalisis').addEventListener('click', () => cambiarTab('analisis'));
    
    // Opciones de ordenación
    document.getElementById('selectOrdenarPor').addEventListener('change', (e) => {
        currentFilters.ordenarPor = e.target.value;
        actualizarTablaVentas();
    });
    
    document.getElementById('btnCambiarOrden').addEventListener('click', () => {
        currentFilters.ordenDireccion = currentFilters.ordenDireccion === 'desc' ? 'asc' : 'desc';
        document.getElementById('btnCambiarOrden').innerHTML = currentFilters.ordenDireccion === 'desc' ? 
            '<i class="fas fa-sort-amount-down"></i>' : 
            '<i class="fas fa-sort-amount-up"></i>';
        actualizarTablaVentas();
    });
    
    // Eventos para cambiar entre diferentes gráficos
    document.querySelectorAll('.btn-chart-selector').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.btn-chart-selector').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            mostrarGrafico(e.target.dataset.chart);
        });
    });
}

/**
 * Debounce function para limitar las llamadas frecuentes
 * @param {Function} func - Función a ejecutar
 * @param {number} wait - Tiempo de espera en ms
 * @returns {Function} - Función con debounce aplicado
 */
function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

/**
 * Carga los usuarios para el filtro
 * @async
 */
async function cargarUsuarios() {
    try {
        const usuarios = await db.all("SELECT id, nombre, apellido FROM usuarios ORDER BY nombre");
        
        const usuarioSelect = document.getElementById('selectUsuario');
        usuarioSelect.innerHTML = '<option value="">Todos los usuarios</option>';
        
        usuarios.forEach(usuario => {
            usuarioSelect.innerHTML += `<option value="${usuario.id}">${usuario.nombre} ${usuario.apellido}</option>`;
        });
    } catch (error) {
        console.error('Error al cargar usuarios:', error);
    }
}

/**
 * Busca clientes para el autocompletado
 * @async
 * @param {Event} event - Evento de input
 */
async function buscarClientes(event) {
    const searchTerm = event.target.value.trim();
    
    if (searchTerm.length < 3) {
        document.getElementById('clientesSugerencias').innerHTML = '';
        document.getElementById('clientesSugerencias').style.display = 'none';
        return;
    }
    
    try {
        const clientes = await db.all(
            `SELECT id, nombre, apellido, razon_social, documento 
             FROM clientes 
             WHERE nombre LIKE ? OR apellido LIKE ? OR razon_social LIKE ? OR documento LIKE ?
             LIMIT 10`,
            [`%${searchTerm}%`, `%${searchTerm}%`, `%${searchTerm}%`, `%${searchTerm}%`]
        );
        
        const sugerenciasContainer = document.getElementById('clientesSugerencias');
        
        if (clientes.length === 0) {
            sugerenciasContainer.style.display = 'none';
            return;
        }
        
        sugerenciasContainer.innerHTML = '';
        
        clientes.forEach(cliente => {
            const nombreCompleto = cliente.razon_social || `${cliente.nombre} ${cliente.apellido}`;
            const item = document.createElement('div');
            item.className = 'cliente-sugerencia';
            item.innerHTML = `${nombreCompleto} <small>(${cliente.documento})</small>`;
            
            item.addEventListener('click', () => {
                document.getElementById('inputCliente').value = nombreCompleto;
                document.getElementById('inputClienteId').value = cliente.id;
                sugerenciasContainer.style.display = 'none';
            });
            
            sugerenciasContainer.appendChild(item);
        });
        
        sugerenciasContainer.style.display = 'block';
    } catch (error) {
        console.error('Error al buscar clientes:', error);
    }
}

/**
 * Actualiza los filtros con los valores seleccionados en la interfaz
 */
function actualizarFiltros() {
    currentFilters.startDate = document.getElementById('fechaInicio').value;
    currentFilters.endDate = document.getElementById('fechaFin').value;
    currentFilters.tipoComprobante = document.getElementById('selectTipoComprobante').value;
    currentFilters.metodoPago = document.getElementById('selectMetodoPago').value;
    currentFilters.cliente = document.getElementById('inputClienteId').value;
    currentFilters.usuario = document.getElementById('selectUsuario')?.value || '';
    currentFilters.sucursal = document.getElementById('selectSucursal').value;
}

/**
 * Resetea los filtros a sus valores predeterminados
 */
function resetFiltros() {
    document.getElementById('fechaInicio').value = new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0];
    document.getElementById('fechaFin').value = new Date().toISOString().split('T')[0];
    document.getElementById('selectTipoComprobante').value = 'todos';
    document.getElementById('selectMetodoPago').value = 'todos';
    document.getElementById('inputCliente').value = '';
    document.getElementById('inputClienteId').value = '';
    if (document.getElementById('selectUsuario')) {
        document.getElementById('selectUsuario').value = '';
    }
    document.getElementById('selectSucursal').value = 'todas';
    
    actualizarFiltros();
    cargarDatos();
}

/**
 * Carga los datos de ventas según los filtros aplicados
 * @async
 */
async function cargarDatos() {
    try {
        document.getElementById('loadingIndicator').style.display = 'flex';
        
        let query = `
            SELECT v.*, 
                   c.nombre as cliente_nombre,
                   c.apellido as cliente_apellido,
                   c.razon_social as cliente_razon_social,
                   u.nombre as usuario_nombre,
                   u.apellido as usuario_apellido,
                   s.nombre as sucursal_nombre
            FROM ventas v
            LEFT JOIN clientes c ON v.cliente_id = c.id
            LEFT JOIN usuarios u ON v.usuario_id = u.id
            LEFT JOIN sucursales s ON v.sucursal_id = s.id
            WHERE v.fecha >= ? AND v.fecha <= ?
        `;
        
        const params = [
            currentFilters.startDate + ' 00:00:00',
            currentFilters.endDate + ' 23:59:59'
        ];
        
        // Agregar filtros adicionales si están seleccionados
        if (currentFilters.tipoComprobante !== 'todos') {
            query += ' AND v.tipo_comprobante = ?';
            params.push(currentFilters.tipoComprobante);
        }
        
        if (currentFilters.metodoPago !== 'todos') {
            query += ' AND v.metodo_pago = ?';
            params.push(currentFilters.metodoPago);
        }
        
        if (currentFilters.cliente) {
            query += ' AND v.cliente_id = ?';
            params.push(currentFilters.cliente);
        }
        
        if (currentFilters.usuario) {
            query += ' AND v.usuario_id = ?';
            params.push(currentFilters.usuario);
        }
        
        if (currentFilters.sucursal !== 'todas') {
            query += ' AND v.sucursal_id = ?';
            params.push(currentFilters.sucursal);
        }
        
        // Ordenar
        query += ` ORDER BY v.${currentFilters.ordenarPor} ${currentFilters.ordenDireccion}`;
        
        ventasData = await db.all(query, params);
        
        // Cargar detalles de productos para cada venta
        for (let venta of ventasData) {
            venta.detalles = await db.all(
                `SELECT d.*, p.nombre as producto_nombre, p.codigo as producto_codigo
                 FROM venta_detalle d
                 LEFT JOIN productos p ON d.producto_id = p.id
                 WHERE d.venta_id = ?`,
                [venta.id]
            );
        }
        
        // Actualizar la interfaz con los datos cargados
        actualizarInterfaz();
        
    } catch (error) {
        console.error('Error al cargar datos de ventas:', error);
        notificaciones.mostrar('Error al cargar datos de ventas', 'error');
    } finally {
        document.getElementById('loadingIndicator').style.display = 'none';
    }
}

/**
 * Actualiza la interfaz con los datos cargados
 */
function actualizarInterfaz() {
    actualizarTablaVentas();
    actualizarResumen();
    actualizarGraficos();
}

/**
 * Actualiza la tabla de ventas con los datos filtrados
 */
function actualizarTablaVentas() {
    const tablaContainer = document.getElementById('tablaVentas');
    
    // Ordenar las ventas según el criterio seleccionado
    const ordenadas = [...ventasData].sort((a, b) => {
        const factor = currentFilters.ordenDireccion === 'desc' ? -1 : 1;
        const campo = currentFilters.ordenarPor;
        
        if (campo === 'fecha') {
            return factor * (new Date(a.fecha) - new Date(b.fecha));
        } else if (campo === 'total') {
            return factor * (parseFloat(a.total) - parseFloat(b.total));
        } else {
            // Para otros campos como número o cliente
            return factor * String(a[campo]).localeCompare(String(b[campo]));
        }
    });

    if (ordenadas.length === 0) {
        tablaContainer.innerHTML = `
            <div class="sin-datos">
                <i class="fas fa-search"></i>
                <p>No hay ventas que coincidan con los filtros seleccionados</p>
            </div>
        `;
        return;
    }
    
    let html = `
        <table class="table table-ventas">
            <thead>
                <tr>
                    <th>Comprobante</th>
                    <th>Fecha</th>
                    <th>Cliente</th>
                    <th>Total</th>
                    <th>Método</th>
                    <th>Usuario</th>
                    <th>Sucursal</th>
                    <th>Acciones</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    ordenadas.forEach(venta => {
        const clienteNombre = venta.cliente_razon_social || 
                             `${venta.cliente_nombre || ''} ${venta.cliente_apellido || ''}`.trim() || 
                             'Consumidor Final';
        
        const usuarioNombre = `${venta.usuario_nombre || ''} ${venta.usuario_apellido || ''}`.trim();
        
        // Formatear tipo de comprobante
        let tipoComprobante = `Factura ${venta.tipo_comprobante}`;
        if (venta.tipo_comprobante === 'P') tipoComprobante = 'Presupuesto';
        
        // Formatear método de pago
        let metodoPago = venta.metodo_pago;
        switch (venta.metodo_pago) {
            case 'efectivo': metodoPago = 'Efectivo'; break;
            case 'tarjeta_debito': metodoPago = 'Tarjeta Débito'; break;
            case 'tarjeta_credito': metodoPago = 'Tarjeta Crédito'; break;
            case 'transferencia': metodoPago = 'Transferencia'; break; 
            case 'mercadopago': metodoPago = 'Mercado Pago'; break;
            default: metodoPago = 'Otro';
        }
        
        html += `
            <tr>
                <td>${tipoComprobante} #${venta.numero}</td>
                <td>${formatDateTime(venta.fecha)}</td>
                <td>${clienteNombre}</td>
                <td>${formatCurrency(venta.total)}</td>
                <td>${metodoPago}</td>
                <td>${usuarioNombre}</td>
                <td>${venta.sucursal_nombre}</td>
                <td class="acciones">
                    <button class="btn btn-sm btn-outline-primary btn-ver-detalle" data-id="${venta.id}">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-success btn-ver-pdf" data-id="${venta.id}">
                        <i class="fas fa-file-pdf"></i>
                    </button>
                </td>
            </tr>
        `;
    });
    
    html += `
            </tbody>
        </table>
    `;
    
    tablaContainer.innerHTML = html;
    
    // Agregar event listeners para los botones de acción
    document.querySelectorAll('.btn-ver-detalle').forEach(btn => {
        btn.addEventListener('click', () => verDetalleVenta(btn.dataset.id));
    });
    
    document.querySelectorAll('.btn-ver-pdf').forEach(btn => {
        btn.addEventListener('click', () => verPDFVenta(btn.dataset.id));
    });
}

/**
 * Actualiza el resumen de ventas
 */
function actualizarResumen() {
    const totalVentas = ventasData.length;
    const importeTotal = ventasData.reduce((sum, venta) => sum + parseFloat(venta.total), 0);
    
    // Cálculo del ticket promedio
    const ticketPromedio = totalVentas > 0 ? importeTotal / totalVentas : 0;
    
    // Contar ventas por método de pago
    const ventasPorMetodo = {};
    ventasData.forEach(venta => {
        if (!ventasPorMetodo[venta.metodo_pago]) {
            ventasPorMetodo[venta.metodo_pago] = {
                cantidad: 0,
                total: 0
            };
        }
        ventasPorMetodo[venta.metodo_pago].cantidad++;
        ventasPorMetodo[venta.metodo_pago].total += parseFloat(venta.total);
    });
    
    // Contar ventas por tipo de comprobante
    const ventasPorComprobante = {};
    ventasData.forEach(venta => {
        if (!ventasPorComprobante[venta.tipo_comprobante]) {
            ventasPorComprobante[venta.tipo_comprobante] = {
                cantidad: 0,
                total: 0
            };
        }
        ventasPorComprobante[venta.tipo_comprobante].cantidad++;
        ventasPorComprobante[venta.tipo_comprobante].total += parseFloat(venta.total);
    });
    
    // Actualizar los elementos HTML del resumen
    document.getElementById('totalVentas').textContent = totalVentas;
    document.getElementById('importeTotal').textContent = formatCurrency(importeTotal);
    document.getElementById('ticketPromedio').textContent = formatCurrency(ticketPromedio);
    
    // Actualizar métodos de pago
    let metodosHtml = '';
    Object.entries(ventasPorMetodo).forEach(([metodo, datos]) => {
        let nombreMetodo = '';
        switch (metodo) {
            case 'efectivo': nombreMetodo = 'Efectivo'; break;
            case 'tarjeta_debito': nombreMetodo = 'Tarjeta Débito'; break;
            case 'tarjeta_credito': nombreMetodo = 'Tarjeta Crédito'; break;
            case 'transferencia': nombreMetodo = 'Transferencia'; break; 
            case 'mercadopago': nombreMetodo = 'Mercado Pago'; break;
            default: nombreMetodo = 'Otro';
        }
        
        metodosHtml += `
            <div class="metodo-pago-item">
                <span class="metodo-nombre">${nombreMetodo}</span>
                <span class="metodo-cantidad">${datos.cantidad} ventas</span>
                <span class="metodo-total">${formatCurrency(datos.total)}</span>
            </div>
        `;
    });
    document.getElementById('ventasPorMetodo').innerHTML = metodosHtml || '<p>No hay datos disponibles</p>';
    
    // Actualizar tipos de comprobante
    let comprobantesHtml = '';
    Object.entries(ventasPorComprobante).forEach(([tipo, datos]) => {
        let nombreTipo = '';
        switch (tipo) {
            case 'A': nombreTipo = 'Factura A'; break;
            case 'B': nombreTipo = 'Factura B'; break;
            case 'C': nombreTipo = 'Factura C'; break;
            case 'X': nombreTipo = 'Factura X'; break;
            case 'P': nombreTipo = 'Presupuesto'; break;
            default: nombreTipo = 'Otro';
        }
        
        comprobantesHtml += `
            <div class="comprobante-item">
                <span class="comprobante-nombre">${nombreTipo}</span>
                <span class="comprobante-cantidad">${datos.cantidad}</span>
                <span class="comprobante-total">${formatCurrency(datos.total)}</span>
            </div>
        `;
    });
    document.getElementById('ventasPorComprobante').innerHTML = comprobantesHtml || '<p>No hay datos disponibles</p>';
}

/**
 * Cambia entre las pestañas de detalle y análisis
 * @param {string} tab - Pestaña a mostrar ('detalle' o 'analisis')
 */
function cambiarTab(tab) {
    // Actualizar clases activas en las pestañas
    document.getElementById('tabDetalle').classList.toggle('active', tab === 'detalle');
    document.getElementById('tabAnalisis').classList.toggle('active', tab === 'analisis');
    
    // Mostrar/ocultar contenedores
    document.getElementById('detalleVentasContainer').style.display = tab === 'detalle' ? 'block' : 'none';
    document.getElementById('analisisVentasContainer').style.display = tab === 'analisis' ? 'block' : 'none';
    
    // Si se activa el análisis, actualizar los gráficos
    if (tab === 'analisis') {
        // Actualizar los gráficos con los datos actuales
        actualizarGraficos();
    }
}

/**
 * Inicializa los gráficos utilizados en el análisis
 */
function inicializarGraficos() {
    // Gráfico de ventas por día
    const ctxVentasDiarias = document.getElementById('chartVentasPorDia').getContext('2d');
    chartVentasPorDia = new Chart(ctxVentasDiarias, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Ventas por día',
                data: [],
                backgroundColor: 'rgba(54, 162, 235, 0.2)',
                borderColor: 'rgba(54, 162, 235, 1)',
                borderWidth: 2,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                },
                title: {
                    display: true,
                    text: 'Ventas por día'
                }
            },
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });
    
    // Gráfico de ventas por método de pago
    const ctxVentasMetodo = document.getElementById('chartVentasPorMetodo').getContext('2d');
    chartVentasPorMetodo = new Chart(ctxVentasMetodo, {
        type: 'doughnut',
        data: {
            labels: [],
            datasets: [{
                data: [],
                backgroundColor: [
                    'rgba(255, 99, 132, 0.7)',
                    'rgba(54, 162, 235, 0.7)',
                    'rgba(255, 206, 86, 0.7)',
                    'rgba(75, 192, 192, 0.7)',
                    'rgba(153, 102, 255, 0.7)',
                    'rgba(255, 159, 64, 0.7)'
                ],
                borderColor: [
                    'rgba(255, 99, 132, 1)',
                    'rgba(54, 162, 235, 1)',
                    'rgba(255, 206, 86, 1)',
                    'rgba(75, 192, 192, 1)',
                    'rgba(153, 102, 255, 1)',
                    'rgba(255, 159, 64, 1)'
                ],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                },
                title: {
                    display: true,
                    text: 'Ventas por método de pago'
                }
            }
        }
    });
    
    // Gráfico de top productos
    const ctxTopProductos = document.getElementById('chartTopProductos').getContext('2d');
    chartTopProductos = new Chart(ctxTopProductos, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [{
                label: 'Cantidad vendida',
                data: [],
                backgroundColor: 'rgba(75, 192, 192, 0.7)',
                borderColor: 'rgba(75, 192, 192, 1)',
                borderWidth: 1
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                title: {
                    display: true,
                    text: 'Top Productos Vendidos'
                }
            },
            scales: {
                x: {
                    beginAtZero: true
                }
            }
        }
    });
    
    // Gráfico comparativo entre sucursales
    const ctxComparativaSucursales = document.getElementById('chartComparativaSucursales').getContext('2d');
    chartComparativaSucursales = new Chart(ctxComparativaSucursales, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [{
                label: 'Total vendido',
                data: [],
                backgroundColor: 'rgba(153, 102, 255, 0.7)',
                borderColor: 'rgba(153, 102, 255, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                title: {
                    display: true,
                    text: 'Comparativa entre sucursales'
                }
            },
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });
    
    // Gráfico de ventas mensuales
    const ctxVentasMensuales = document.getElementById('chartVentasMensuales').getContext('2d');
    chartVentasMensuales = new Chart(ctxVentasMensuales, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [{
                label: 'Total vendido',
                data: [],
                backgroundColor: 'rgba(255, 159, 64, 0.7)',
                borderColor: 'rgba(255, 159, 64, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                title: {
                    display: true,
                    text: 'Ventas mensuales'
                }
            },
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });
    
    // Mostrar el primer gráfico por defecto
    mostrarGrafico('ventasDiarias');
}

/**
 * Actualiza todos los gráficos con los datos actuales
 */
function actualizarGraficos() {
    // Actualizar gráfico de ventas por día
    actualizarGraficoVentasPorDia();
    
    // Actualizar gráfico de ventas por método de pago
    actualizarGraficoVentasPorMetodo();
    
    // Actualizar gráfico de top productos
    actualizarGraficoTopProductos();
    
    // Actualizar gráfico comparativo entre sucursales (si hay más de una)
    if (sucursales.length > 1) {
        document.getElementById('chartComparativaSucursalesContainer').style.display = 'block';
        actualizarGraficoComparativaSucursales();
    } else {
        document.getElementById('chartComparativaSucursalesContainer').style.display = 'none';
    }
    
    // Actualizar gráfico de ventas mensuales
    actualizarGraficoVentasMensuales();
}

/**
 * Actualiza el gráfico de ventas por día
 */
function actualizarGraficoVentasPorDia() {
    // Agrupar ventas por día
    const ventasPorDia = {};
    
    // Crear estructura para todos los días en el rango seleccionado
    const fechaInicio = new Date(currentFilters.startDate);
    const fechaFin = new Date(currentFilters.endDate);
    
    // Añadir un día a la fecha de fin para incluirla en el rango
    fechaFin.setDate(fechaFin.getDate() + 1);
    
    for (let fecha = new Date(fechaInicio); fecha < fechaFin; fecha.setDate(fecha.getDate() + 1)) {
        const fechaStr = fecha.toISOString().split('T')[0];
        ventasPorDia[fechaStr] = 0;
    }
    
    // Sumar ventas por día
    ventasData.forEach(venta => {
        const fechaVenta = venta.fecha.split(' ')[0];
        if (ventasPorDia.hasOwnProperty(fechaVenta)) {
            ventasPorDia[fechaVenta] += parseFloat(venta.total);
        }
    });
    
    // Actualizar gráfico
    const labels = Object.keys(ventasPorDia);
    const datos = Object.values(ventasPorDia);
    
    chartVentasPorDia.data.labels = labels;
    chartVentasPorDia.data.datasets[0].data = datos;
    chartVentasPorDia.update();
}

/**
 * Actualiza el gráfico de ventas por método de pago
 */
function actualizarGraficoVentasPorMetodo() {
    // Agrupar ventas por método de pago
    const ventasPorMetodo = {};
    const nombreMetodos = {
        'efectivo': 'Efectivo',
        'tarjeta_debito': 'Tarjeta Débito',
        'tarjeta_credito': 'Tarjeta Crédito',
        'transferencia': 'Transferencia',
        'mercadopago': 'Mercado Pago',
        'otros': 'Otros'
    };
    
    ventasData.forEach(venta => {
        const metodo = venta.metodo_pago;
        if (!ventasPorMetodo[metodo]) {
            ventasPorMetodo[metodo] = 0;
        }
        ventasPorMetodo[metodo] += parseFloat(venta.total);
    });
    
    // Convertir a arrays para el gráfico, traduciendo los nombres de los métodos
    const labels = Object.keys(ventasPorMetodo).map(metodo => nombreMetodos[metodo] || metodo);
    const datos = Object.values(ventasPorMetodo);
    
    chartVentasPorMetodo.data.labels = labels;
    chartVentasPorMetodo.data.datasets[0].data = datos;
    chartVentasPorMetodo.update();
}

/**
 * Actualiza el gráfico de top productos vendidos
 */
function actualizarGraficoTopProductos() {
    // Crear un mapa para contar productos
    const productosContador = {};
    
    // Contar productos
    ventasData.forEach(venta => {
        venta.detalles.forEach(detalle => {
            const productoId = detalle.producto_id;
            const productoNombre = detalle.producto_nombre || 'Producto sin nombre';
            const cantidad = parseFloat(detalle.cantidad);
            
            if (!productosContador[productoId]) {
                productosContador[productoId] = {
                    nombre: productoNombre,
                    cantidad: 0
                };
            }
            
            productosContador[productoId].cantidad += cantidad;
        });
    });
    
    // Convertir a array y ordenar
    const productosArray = Object.values(productosContador)
        .sort((a, b) => b.cantidad - a.cantidad)
        .slice(0, 10); // Top 10
    
    // Actualizar gráfico
    const labels = productosArray.map(p => p.nombre);
    const datos = productosArray.map(p => p.cantidad);
    
    chartTopProductos.data.labels = labels;
    chartTopProductos.data.datasets[0].data = datos;
    chartTopProductos.update();
    
    // También actualizar la tabla de top productos
    actualizarTablaTopProductos(productosArray);
}

/**
 * Actualiza la tabla que muestra el top de productos vendidos
 * @param {Array} productosArray - Array de productos ordenados
 */
function actualizarTablaTopProductos(productosArray) {
    const contenedor = document.getElementById('tablaTopProductos');
    
    if (productosArray.length === 0) {
        contenedor.innerHTML = '<p>No hay datos disponibles</p>';
        return;
    }
    
    let html = `
        <table class="table table-sm">
            <thead>
                <tr>
                    <th>Producto</th>
                    <th>Unidades vendidas</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    productosArray.forEach(producto => {
        html += `
            <tr>
                <td>${producto.nombre}</td>
                <td>${producto.cantidad.toFixed(2)}</td>
            </tr>
        `;
    });
    
    html += `
            </tbody>
        </table>
    `;
    
    contenedor.innerHTML = html;
}

/**
 * Actualiza el gráfico comparativo entre sucursales
 */
function actualizarGraficoComparativaSucursales() {
    // Agrupar ventas por sucursal
    const ventasPorSucursal = {};
    
    // Inicializar con todas las sucursales
    sucursales.forEach(sucursal => {
        ventasPorSucursal[sucursal.id] = {
            nombre: sucursal.nombre,
            total: 0
        };
    });
    
    // Sumar ventas por sucursal
    ventasData.forEach(venta => {
        if (ventasPorSucursal[venta.sucursal_id]) {
            ventasPorSucursal[venta.sucursal_id].total += parseFloat(venta.total);
        }
    });
    
    // Convertir a arrays para el gráfico
    const sucursalesData = Object.values(ventasPorSucursal);
    const labels = sucursalesData.map(s => s.nombre);
    const datos = sucursalesData.map(s => s.total);
    
    chartComparativaSucursales.data.labels = labels;
    chartComparativaSucursales.data.datasets[0].data = datos;
    chartComparativaSucursales.update();
}

/**
 * Actualiza el gráfico de ventas mensuales
 */
function actualizarGraficoVentasMensuales() {
    // Determinar el rango de meses a mostrar
    const fechaInicio = new Date(currentFilters.startDate);
    const fechaFin = new Date(currentFilters.endDate);
    const meses = [];
    const ventasPorMes = {};
    
    // Nombres de los meses
    const nombresMeses = [
        'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];
    
    // Crear estructura para todos los meses en el rango
    for (let año = fechaInicio.getFullYear(); año <= fechaFin.getFullYear(); año++) {
        let mesInicial = (año === fechaInicio.getFullYear()) ? fechaInicio.getMonth() : 0;
        let mesFinal = (año === fechaFin.getFullYear()) ? fechaFin.getMonth() : 11;
        
        for (let mes = mesInicial; mes <= mesFinal; mes++) {
            const mesKey = `${año}-${(mes + 1).toString().padStart(2, '0')}`;
            const mesNombre = `${nombresMeses[mes]} ${año}`;
            
            meses.push(mesKey);
            ventasPorMes[mesKey] = {
                nombre: mesNombre,
                total: 0
            };
        }
    }
    
    // Agrupar ventas por mes
    ventasData.forEach(venta => {
        const fechaParts = venta.fecha.split(' ')[0].split('-');
        const mesKey = `${fechaParts[0]}-${fechaParts[1]}`;
        
        if (ventasPorMes[mesKey]) {
            ventasPorMes[mesKey].total += parseFloat(venta.total);
        }
    });
    
    // Actualizar gráfico
    const labels = meses.map(mes => ventasPorMes[mes].nombre);
    const datos = meses.map(mes => ventasPorMes[mes].total);
    
    chartVentasMensuales.data.labels = labels;
    chartVentasMensuales.data.datasets[0].data = datos;
    chartVentasMensuales.update();
}

/**
 * Cambia entre los diferentes gráficos disponibles
 * @param {string} chartId - Identificador del gráfico a mostrar
 */
function mostrarGrafico(chartId) {
    // Ocultar todos los contenedores de gráficos
    document.querySelectorAll('.chart-container').forEach(container => {
        container.style.display = 'none';
    });
    
    // Mostrar el contenedor del gráfico seleccionado
    document.getElementById(`${chartId}Container`).style.display = 'block';
}

/**
 * Cambia la agrupación del gráfico seleccionado actualmente
 * @param {Event} event - Evento de cambio del selector
 */
function cambiarAgrupacionGrafico(event) {
    const agrupacion = event.target.value;
    
    // Actualizar el gráfico según la agrupación seleccionada
    switch(agrupacion) {
        case 'dia':
            actualizarGraficoVentasPorDia();
            break;
        case 'semana':
            // Implementar agrupación por semana si es necesario
            break;
        case 'mes':
            actualizarGraficoVentasMensuales();
            break;
    }
}

/**
 * Muestra los detalles de una venta específica
 * @param {string} ventaId - ID de la venta a mostrar
 */
function verDetalleVenta(ventaId) {
    const venta = ventasData.find(v => v.id == ventaId);
    
    if (!venta) {
        notificaciones.mostrar('No se encontraron detalles para esta venta', 'error');
        return;
    }
    
    // Preparar la información del cliente
    const clienteNombre = venta.cliente_razon_social || 
                       `${venta.cliente_nombre || ''} ${venta.cliente_apellido || ''}`.trim() || 
                       'Consumidor Final';
    
    // Preparar información del usuario
    const usuarioNombre = `${venta.usuario_nombre || ''} ${venta.usuario_apellido || ''}`.trim();
    
    // Formatear tipo de comprobante
    let tipoComprobante = `Factura ${venta.tipo_comprobante}`;
    if (venta.tipo_comprobante === 'P') tipoComprobante = 'Presupuesto';
    
    // Formatear método de pago
    let metodoPago = venta.metodo_pago;
    switch (venta.metodo_pago) {
        case 'efectivo': metodoPago = 'Efectivo'; break;
        case 'tarjeta_debito': metodoPago = 'Tarjeta Débito'; break;
        case 'tarjeta_credito': metodoPago = 'Tarjeta Crédito'; break;
        case 'transferencia': metodoPago = 'Transferencia'; break; 
        case 'mercadopago': metodoPago = 'Mercado Pago'; break;
        default: metodoPago = 'Otro';
    }
    
    // Mostrar el detalle en un modal
    const modalContent = `
        <div class="modal-header">
            <h5 class="modal-title">${tipoComprobante} #${venta.numero}</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
        </div>
        <div class="modal-body">
            <div class="row mb-3">
                <div class="col-md-6">
                    <h6>Información General</h6>
                    <p><strong>Fecha:</strong> ${formatDateTime(venta.fecha)}</p>
                    <p><strong>Cliente:</strong> ${clienteNombre}</p>
                    <p><strong>Usuario:</strong> ${usuarioNombre}</p>
                    <p><strong>Sucursal:</strong> ${venta.sucursal_nombre}</p>
                </div>
                <div class="col-md-6">
                    <h6>Información de Pago</h6>
                    <p><strong>Método de Pago:</strong> ${metodoPago}</p>
                    <p><strong>Subtotal:</strong> ${formatCurrency(venta.subtotal)}</p>
                    <p><strong>IVA:</strong> ${formatCurrency(venta.iva_monto)}</p>
                    <p><strong>Total:</strong> ${formatCurrency(venta.total)}</p>
                </div>
            </div>
            <h6>Detalle de Productos</h6>
            <table class="table table-sm table-bordered">
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
                    ${venta.detalles.map(detalle => `
                        <tr>
                            <td>${detalle.producto_nombre || 'Producto sin nombre'} (${detalle.producto_codigo || 'S/C'})</td>
                            <td>${detalle.cantidad}</td>
                            <td>${formatCurrency(detalle.precio_unitario)}</td>
                            <td>${detalle.descuento_porcentaje}%</td>
                            <td>${formatCurrency(detalle.subtotal)}</td>
                        </tr>
                    `).join('')}
                </tbody>
                <tfoot>
                    <tr>
                        <th colspan="4" class="text-end">Total:</th>
                        <th>${formatCurrency(venta.total)}</th>
                    </tr>
                </tfoot>
            </table>
            ${venta.comentarios ? `
                <h6>Comentarios</h6>
                <p>${venta.comentarios}</p>
            ` : ''}
        </div>
        <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cerrar</button>
            <button type="button" class="btn btn-primary" id="btnImprimirDetalle">Imprimir</button>
            <button type="button" class="btn btn-success" id="btnVerPDF">Ver PDF</button>
        </div>
    `;
    
    // Crear y mostrar el modal
    const modalEl = document.createElement('div');
    modalEl.classList.add('modal', 'fade');
    modalEl.id = 'modalDetalleVenta';
    modalEl.setAttribute('tabindex', '-1');
    modalEl.innerHTML = `
        <div class="modal-dialog modal-lg">
            <div class="modal-content">
                ${modalContent}
            </div>
        </div>
    `;
    
    document.body.appendChild(modalEl);
    
    // Inicializar el modal
    const modalInstance = new bootstrap.Modal(modalEl);
    modalInstance.show();
    
    // Configurar eventos del modal
    modalEl.addEventListener('hidden.bs.modal', () => {
        document.body.removeChild(modalEl);
    });
    
    document.getElementById('btnImprimirDetalle').addEventListener('click', () => {
        modalInstance.hide();
        imprimirVenta(ventaId);
    });
    
    document.getElementById('btnVerPDF').addEventListener('click', () => {
        modalInstance.hide();
        verPDFVenta(ventaId);
    });
}

/**
 * Visualiza el PDF de una venta
 * @param {string} ventaId - ID de la venta
 */
async function verPDFVenta(ventaId) {
    try {
        // Solicitar al proceso principal que genere y muestre el PDF
        ipcRenderer.send('ver-pdf-venta', ventaId);
    } catch (error) {
        console.error('Error al visualizar PDF de venta:', error);
        notificaciones.mostrar('Error al visualizar el PDF de la venta', 'error');
    }
}

/**
 * Imprime una venta específica
 * @param {string} ventaId - ID de la venta
 */
async function imprimirVenta(ventaId) {
    try {
        // Solicitar al proceso principal que imprima la venta
        ipcRenderer.send('imprimir-venta', ventaId);
    } catch (error) {
        console.error('Error al imprimir venta:', error);
        notificaciones.mostrar('Error al imprimir la venta', 'error');
    }
}

/**
 * Exporta el reporte actual a PDF
 * @async
 */
async function exportarPDF() {
    try {
        // Mostrar indicador de carga
        document.getElementById('loadingIndicator').style.display = 'flex';
        
        // Preparar datos para el PDF
        const datosReporte = {
            filtros: currentFilters,
            ventas: ventasData,
            resumen: {
                totalVentas: ventasData.length,
                importeTotal: ventasData.reduce((sum, venta) => sum + parseFloat(venta.total), 0),
                periodo: `${formatDate(currentFilters.startDate)} al ${formatDate(currentFilters.endDate)}`
            },
            usuario: usuarioActual,
            timestamp: new Date().toISOString()
        };
        
        // Solicitar al proceso principal que genere el PDF
        ipcRenderer.send('exportar-reporte-ventas', datosReporte);
        
        // El proceso principal enviará una respuesta cuando el PDF esté listo
        ipcRenderer.once('reporte-ventas-exportado', (event, resultado) => {
            document.getElementById('loadingIndicator').style.display = 'none';
            
            if (resultado.error) {
                notificaciones.mostrar('Error al exportar el reporte: ' + resultado.error, 'error');
            } else {
                notificaciones.mostrar('Reporte exportado exitosamente', 'success');
            }
        });
        
    } catch (error) {
        console.error('Error al exportar reporte a PDF:', error);
        notificaciones.mostrar('Error al exportar el reporte', 'error');
        document.getElementById('loadingIndicator').style.display = 'none';
    }
}

/**
 * Limpiar recursos al desmontar el módulo
 */
function cleanup() {
    // Destruir gráficos para liberar recursos
    if (chartVentasPorDia) chartVentasPorDia.destroy();
    if (chartVentasPorMetodo) chartVentasPorMetodo.destroy();
    if (chartTopProductos) chartTopProductos.destroy();
    if (chartComparativaSucursales) chartComparativaSucursales.destroy();
    if (chartVentasMensuales) chartVentasMensuales.destroy();
    
    // Eliminar event listeners
    document.getElementById('btnAplicarFiltros').removeEventListener('click', cargarDatos);
    document.getElementById('btnResetFiltros').removeEventListener('click', resetFiltros);
    document.getElementById('btnExportarPDF').removeEventListener('click', exportarPDF);
}

// Exportar funciones públicas del módulo
module.exports = {
    init,
    cleanup,
    cargarDatos,
    exportarPDF
};