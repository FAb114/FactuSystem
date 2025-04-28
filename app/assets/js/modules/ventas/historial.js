/**
 * historial.js - Módulo para la gestión del historial de ventas
 * 
 * Este módulo se encarga de mostrar, filtrar y gestionar todas las facturas emitidas
 * en el sistema, permitiendo la visualización, exportación y análisis de las ventas.
 * 
 * @module ventas/historial
 * @requires utils/database
 * @requires utils/validation
 * @requires utils/auth
 * @requires utils/printer
 * @requires integrations/whatsapp/mensajes
 * @requires integrations/email/sender
 * @requires services/print/pdf
 */

// Importación de dependencias
import { Database } from '../../../utils/database.js';
import { validarFechas, validarFiltros } from '../../../utils/validation.js';
import { verificarPermiso } from '../../../utils/auth.js';
import { imprimirTicket, imprimirA4 } from '../../../utils/printer.js';
import { enviarMensajeWhatsapp } from '../../../../integrations/whatsapp/mensajes.js';
import { enviarEmail } from '../../../../integrations/email/sender.js';
import { generarPDF } from '../../../../services/print/pdf.js';

// Variables globales
const db = new Database();
let tablaVentas = null;
let ventasData = [];
let filasSeleccionadas = [];
let filtrosActivos = {
    fechaDesde: null,
    fechaHasta: null,
    tipoComprobante: 'todos',
    metodoPago: 'todos',
    cliente: '',
    usuario: '',
    sucursal: '',
    montoMinimo: null,
    montoMaximo: null
};

/**
 * Inicializa el módulo de historial de ventas
 */
export async function inicializarHistorial() {
    registrarEventListeners();
    inicializarTabla();
    inicializarFiltros();
    cargarUsuarios();
    cargarSucursales();
    
    // Establecer fechas predeterminadas (último mes)
    const hoy = new Date();
    const unMesAtras = new Date();
    unMesAtras.setMonth(unMesAtras.getMonth() - 1);
    
    document.getElementById('fecha-desde').valueAsDate = unMesAtras;
    document.getElementById('fecha-hasta').valueAsDate = hoy;
    
    // Cargar datos iniciales
    filtrosActivos.fechaDesde = unMesAtras;
    filtrosActivos.fechaHasta = hoy;
    
    await cargarHistorialVentas();
}

/**
 * Registra todos los event listeners para los elementos del DOM
 */
function registrarEventListeners() {
    // Botones de filtrado
    document.getElementById('btn-filtrar').addEventListener('click', aplicarFiltros);
    document.getElementById('btn-limpiar-filtros').addEventListener('click', limpiarFiltros);
    
    // Botones de acciones
    document.getElementById('btn-ver-factura').addEventListener('click', verFacturaSeleccionada);
    document.getElementById('btn-imprimir-ticket').addEventListener('click', imprimirTicketSeleccionado);
    document.getElementById('btn-imprimir-a4').addEventListener('click', imprimirA4Seleccionado);
    document.getElementById('btn-enviar-email').addEventListener('click', enviarEmailSeleccionado);
    document.getElementById('btn-enviar-whatsapp').addEventListener('click', enviarWhatsappSeleccionado);
    document.getElementById('btn-exportar-pdf').addEventListener('click', exportarSeleccionadosPDF);
    document.getElementById('btn-exportar-excel').addEventListener('click', exportarSeleccionadosExcel);
    
    // Botón para ver estadísticas
    document.getElementById('btn-ver-estadisticas').addEventListener('click', () => {
        window.location.href = '#/ventas/estadisticas';
    });
    
    // Select para cantidad de elementos por página
    document.getElementById('registros-por-pagina').addEventListener('change', (e) => {
        cambiarRegistrosPorPagina(parseInt(e.target.value));
    });
}

/**
 * Inicializa la tabla DataTables con configuración para historial de ventas
 */
function inicializarTabla() {
    tablaVentas = $('#tabla-historial-ventas').DataTable({
        responsive: true,
        dom: 'Bfrtip',
        language: {
            url: '//cdn.datatables.net/plug-ins/1.13.4/i18n/es-ES.json'
        },
        columns: [
            { 
                data: null,
                defaultContent: '',
                orderable: false,
                className: 'select-checkbox',
                width: '20px'
            },
            { data: 'id', title: 'ID', visible: false },
            { data: 'fecha', title: 'Fecha' },
            { data: 'hora', title: 'Hora' },
            { data: 'comprobante', title: 'Comprobante' },
            { data: 'numero', title: 'Número' },
            { data: 'cliente', title: 'Cliente' },
            { data: 'total', title: 'Total', 
              render: (data) => `$${parseFloat(data).toLocaleString('es-AR', { minimumFractionDigits: 2 })}` 
            },
            { data: 'metodoPago', title: 'Método de Pago' },
            { data: 'usuario', title: 'Usuario' },
            { data: 'sucursal', title: 'Sucursal' },
            { 
                data: null,
                title: 'Acciones',
                orderable: false,
                render: function(data, type, row) {
                    return `
                        <div class="btn-group">
                            <button class="btn btn-sm btn-primary btn-ver" title="Ver detalle">
                                <i class="fa fa-eye"></i>
                            </button>
                            <button class="btn btn-sm btn-success btn-imprimir" title="Imprimir">
                                <i class="fa fa-print"></i>
                            </button>
                            <button class="btn btn-sm btn-info btn-compartir" title="Compartir">
                                <i class="fa fa-share-alt"></i>
                            </button>
                        </div>
                    `;
                }
            }
        ],
        select: {
            style: 'multi',
            selector: 'td:first-child'
        },
        buttons: [
            'selectAll',
            'selectNone',
            {
                extend: 'collection',
                text: 'Exportar',
                buttons: [
                    'excel',
                    'pdf',
                    'csv'
                ]
            }
        ],
        order: [[2, 'desc'], [3, 'desc']], // Ordenar por fecha descendente, luego por hora
        pageLength: 25,
        lengthMenu: [[10, 25, 50, 100, -1], [10, 25, 50, 100, 'Todos']]
    });
    
    // Event listener para filas seleccionadas
    tablaVentas.on('select', function(e, dt, type, indexes) {
        const rowData = tablaVentas.rows(indexes).data().toArray();
        filasSeleccionadas = [...filasSeleccionadas, ...rowData];
        actualizarBotonesAcciones();
    });
    
    tablaVentas.on('deselect', function(e, dt, type, indexes) {
        const rowData = tablaVentas.rows(indexes).data().toArray();
        filasSeleccionadas = filasSeleccionadas.filter(row => 
            !rowData.some(removedRow => removedRow.id === row.id)
        );
        actualizarBotonesAcciones();
    });
    
    // Event listeners para botones en filas
    $('#tabla-historial-ventas tbody').on('click', '.btn-ver', function() {
        const data = tablaVentas.row($(this).closest('tr')).data();
        verFactura(data.id);
    });
    
    $('#tabla-historial-ventas tbody').on('click', '.btn-imprimir', function() {
        const data = tablaVentas.row($(this).closest('tr')).data();
        mostrarOpcionesImpresion(data);
    });
    
    $('#tabla-historial-ventas tbody').on('click', '.btn-compartir', function() {
        const data = tablaVentas.row($(this).closest('tr')).data();
        mostrarOpcionesCompartir(data);
    });
}

/**
 * Inicializa los componentes de filtro
 */
function inicializarFiltros() {
    // Inicializar selectores
    const selectTipoComprobante = document.getElementById('filtro-tipo-comprobante');
    const selectMetodoPago = document.getElementById('filtro-metodo-pago');
    
    // Cargar tipos de comprobante
    const tiposComprobante = ['Factura A', 'Factura B', 'Factura C', 'Factura X', 'Presupuesto', 'Remito'];
    selectTipoComprobante.innerHTML = '<option value="todos">Todos</option>';
    tiposComprobante.forEach(tipo => {
        const option = document.createElement('option');
        option.value = tipo;
        option.textContent = tipo;
        selectTipoComprobante.appendChild(option);
    });
    
    // Cargar métodos de pago
    const metodosPago = ['Efectivo', 'Tarjeta de Débito', 'Tarjeta de Crédito', 'Transferencia', 'Mercado Pago', 'Varios'];
    selectMetodoPago.innerHTML = '<option value="todos">Todos</option>';
    metodosPago.forEach(metodo => {
        const option = document.createElement('option');
        option.value = metodo;
        option.textContent = metodo;
        selectMetodoPago.appendChild(option);
    });
    
    // Inicializar datepickers
    $('.datepicker').datepicker({
        format: 'dd/mm/yyyy',
        autoclose: true,
        language: 'es',
        todayHighlight: true
    });
    
    // Inicializar autocompletado para clientes
    $('#filtro-cliente').autocomplete({
        source: async function(request, response) {
            const clientes = await db.obtenerClientesPorNombre(request.term);
            response(clientes.map(cliente => ({
                label: `${cliente.nombre} (${cliente.documento})`,
                value: cliente.id
            })));
        },
        minLength: 2,
        select: function(event, ui) {
            event.preventDefault();
            $('#filtro-cliente').val(ui.item.label);
            $('#filtro-cliente-id').val(ui.item.value);
        }
    });
}

/**
 * Carga la lista de usuarios para el filtro
 */
async function cargarUsuarios() {
    try {
        const usuarios = await db.obtenerUsuarios();
        const selectUsuario = document.getElementById('filtro-usuario');
        
        selectUsuario.innerHTML = '<option value="todos">Todos</option>';
        usuarios.forEach(usuario => {
            const option = document.createElement('option');
            option.value = usuario.id;
            option.textContent = usuario.nombre;
            selectUsuario.appendChild(option);
        });
    } catch (error) {
        console.error('Error al cargar usuarios:', error);
        mostrarError('No se pudieron cargar los usuarios. Por favor, intente nuevamente.');
    }
}

/**
 * Carga la lista de sucursales para el filtro
 */
async function cargarSucursales() {
    try {
        const sucursales = await db.obtenerSucursales();
        const selectSucursal = document.getElementById('filtro-sucursal');
        
        selectSucursal.innerHTML = '<option value="todos">Todas</option>';
        sucursales.forEach(sucursal => {
            const option = document.createElement('option');
            option.value = sucursal.id;
            option.textContent = sucursal.nombre;
            selectSucursal.appendChild(option);
        });
        
        // Si el usuario está limitado a una sucursal, preseleccionarla
        const usuarioActual = await db.obtenerUsuarioActual();
        if (usuarioActual.sucursalId && !verificarPermiso('acceso_todas_sucursales')) {
            selectSucursal.value = usuarioActual.sucursalId;
            selectSucursal.disabled = true;
            filtrosActivos.sucursal = usuarioActual.sucursalId;
        }
    } catch (error) {
        console.error('Error al cargar sucursales:', error);
        mostrarError('No se pudieron cargar las sucursales. Por favor, intente nuevamente.');
    }
}

/**
 * Carga el historial de ventas según los filtros activos
 */
async function cargarHistorialVentas() {
    try {
        mostrarCargando(true);
        
        // Verificar permisos
        if (!verificarPermiso('ver_historial_ventas')) {
            mostrarError('No tiene permisos para acceder al historial de ventas');
            return;
        }
        
        // Construir objeto de filtros para la consulta
        const filtros = {
            fechaDesde: formatearFecha(filtrosActivos.fechaDesde),
            fechaHasta: formatearFecha(filtrosActivos.fechaHasta),
            tipoComprobante: filtrosActivos.tipoComprobante !== 'todos' ? filtrosActivos.tipoComprobante : null,
            metodoPago: filtrosActivos.metodoPago !== 'todos' ? filtrosActivos.metodoPago : null,
            clienteId: document.getElementById('filtro-cliente-id').value || null,
            usuarioId: filtrosActivos.usuario !== 'todos' ? filtrosActivos.usuario : null,
            sucursalId: filtrosActivos.sucursal !== 'todos' ? filtrosActivos.sucursal : null,
            montoMinimo: filtrosActivos.montoMinimo,
            montoMaximo: filtrosActivos.montoMaximo
        };
        
        // Obtener ventas de la base de datos
        ventasData = await db.obtenerHistorialVentas(filtros);
        
        // Limpiar tabla y agregar nuevos datos
        tablaVentas.clear();
        tablaVentas.rows.add(formatearDatosTabla(ventasData)).draw();
        
        // Actualizar contador y estadísticas
        actualizarContadorRegistros();
        actualizarEstadisticasResumen();
        
        // Limpiar selecciones
        filasSeleccionadas = [];
        actualizarBotonesAcciones();
        
        mostrarCargando(false);
    } catch (error) {
        console.error('Error al cargar el historial de ventas:', error);
        mostrarError('No se pudo cargar el historial de ventas. Por favor, intente nuevamente.');
        mostrarCargando(false);
    }
}

/**
 * Formatea los datos para mostrarlos en la tabla
 * @param {Array} ventas - Array de objetos de ventas
 * @returns {Array} - Array formateado para DataTables
 */
function formatearDatosTabla(ventas) {
    return ventas.map(venta => {
        const fecha = new Date(venta.fechaHora);
        
        return {
            id: venta.id,
            fecha: fecha.toLocaleDateString('es-AR'),
            hora: fecha.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
            comprobante: venta.tipoComprobante,
            numero: venta.numeroComprobante,
            cliente: venta.clienteNombre || 'Consumidor Final',
            total: venta.total,
            metodoPago: venta.metodoPago,
            usuario: venta.usuarioNombre,
            sucursal: venta.sucursalNombre,
            // Datos adicionales útiles para acciones
            clienteId: venta.clienteId,
            clienteEmail: venta.clienteEmail,
            clienteTelefono: venta.clienteTelefono,
            items: venta.items
        };
    });
}

/**
 * Actualiza el contador de registros mostrados
 */
function actualizarContadorRegistros() {
    const totalVentas = ventasData.length;
    const totalMonto = ventasData.reduce((sum, venta) => sum + parseFloat(venta.total), 0);
    
    document.getElementById('contador-ventas').textContent = totalVentas;
    document.getElementById('total-ventas').textContent = `$${totalMonto.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
}

/**
 * Actualiza las estadísticas de resumen mostradas
 */
function actualizarEstadisticasResumen() {
    // Contar por tipo de comprobante
    const conteoTipoComprobante = {};
    ventasData.forEach(venta => {
        conteoTipoComprobante[venta.tipoComprobante] = (conteoTipoComprobante[venta.tipoComprobante] || 0) + 1;
    });
    
    // Contar por método de pago
    const conteoMetodoPago = {};
    ventasData.forEach(venta => {
        conteoMetodoPago[venta.metodoPago] = (conteoMetodoPago[venta.metodoPago] || 0) + 1;
    });
    
    // Calcular monto por método de pago
    const montoMetodoPago = {};
    ventasData.forEach(venta => {
        montoMetodoPago[venta.metodoPago] = (montoMetodoPago[venta.metodoPago] || 0) + parseFloat(venta.total);
    });
    
    // Actualizar elementos HTML
    actualizarGraficoTipoComprobante(conteoTipoComprobante);
    actualizarGraficoMetodoPago(montoMetodoPago);
}

/**
 * Actualiza el gráfico de tipos de comprobante
 * @param {Object} datos - Datos para el gráfico
 */
function actualizarGraficoTipoComprobante(datos) {
    const ctx = document.getElementById('grafico-tipo-comprobante').getContext('2d');
    
    // Destruir gráfico existente si hay uno
    if (window.graficoTipoComprobante) {
        window.graficoTipoComprobante.destroy();
    }
    
    // Crear nuevo gráfico
    window.graficoTipoComprobante = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: Object.keys(datos),
            datasets: [{
                data: Object.values(datos),
                backgroundColor: [
                    '#4e73df', '#1cc88a', '#36b9cc',
                    '#f6c23e', '#e74a3b', '#858796'
                ]
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            legend: {
                position: 'bottom'
            },
            tooltips: {
                callbacks: {
                    label: function(tooltipItem, data) {
                        const label = data.labels[tooltipItem.index];
                        const value = data.datasets[0].data[tooltipItem.index];
                        return `${label}: ${value} ventas`;
                    }
                }
            }
        }
    });
}

/**
 * Actualiza el gráfico de métodos de pago
 * @param {Object} datos - Datos para el gráfico
 */
function actualizarGraficoMetodoPago(datos) {
    const ctx = document.getElementById('grafico-metodo-pago').getContext('2d');
    
    // Destruir gráfico existente si hay uno
    if (window.graficoMetodoPago) {
        window.graficoMetodoPago.destroy();
    }
    
    // Crear nuevo gráfico
    window.graficoMetodoPago = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: Object.keys(datos),
            datasets: [{
                label: 'Montos por método de pago',
                data: Object.values(datos),
                backgroundColor: [
                    '#4e73df', '#1cc88a', '#36b9cc',
                    '#f6c23e', '#e74a3b', '#858796'
                ]
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                yAxes: [{
                    ticks: {
                        beginAtZero: true,
                        callback: function(value) {
                            return '$' + value.toLocaleString('es-AR');
                        }
                    }
                }]
            },
            tooltips: {
                callbacks: {
                    label: function(tooltipItem, data) {
                        const label = data.datasets[tooltipItem.datasetIndex].label || '';
                        const value = tooltipItem.yLabel;
                        return label + ': $' + value.toLocaleString('es-AR', { minimumFractionDigits: 2 });
                    }
                }
            }
        }
    });
}

/**
 * Aplica los filtros seleccionados en el formulario
 */
async function aplicarFiltros() {
    try {
        // Obtener valores de los campos de filtro
        const fechaDesde = document.getElementById('fecha-desde').valueAsDate;
        const fechaHasta = document.getElementById('fecha-hasta').valueAsDate;
        const tipoComprobante = document.getElementById('filtro-tipo-comprobante').value;
        const metodoPago = document.getElementById('filtro-metodo-pago').value;
        const cliente = document.getElementById('filtro-cliente').value;
        const usuario = document.getElementById('filtro-usuario').value;
        const sucursal = document.getElementById('filtro-sucursal').value;
        const montoMinimo = document.getElementById('filtro-monto-minimo').value;
        const montoMaximo = document.getElementById('filtro-monto-maximo').value;
        
        // Validar fechas
        if (!validarFechas(fechaDesde, fechaHasta)) {
            mostrarError('La fecha desde debe ser anterior o igual a la fecha hasta');
            return;
        }
        
        // Actualizar filtros activos
        filtrosActivos = {
            fechaDesde,
            fechaHasta,
            tipoComprobante,
            metodoPago,
            cliente,
            usuario,
            sucursal,
            montoMinimo: montoMinimo ? parseFloat(montoMinimo) : null,
            montoMaximo: montoMaximo ? parseFloat(montoMaximo) : null
        };
        
        // Cargar datos con nuevos filtros
        await cargarHistorialVentas();
    } catch (error) {
        console.error('Error al aplicar filtros:', error);
        mostrarError('No se pudieron aplicar los filtros. Por favor, intente nuevamente.');
    }
}

/**
 * Limpia todos los filtros y restablece a los valores predeterminados
 */
async function limpiarFiltros() {
    try {
        // Restablecer fechas a último mes
        const hoy = new Date();
        const unMesAtras = new Date();
        unMesAtras.setMonth(unMesAtras.getMonth() - 1);
        
        document.getElementById('fecha-desde').valueAsDate = unMesAtras;
        document.getElementById('fecha-hasta').valueAsDate = hoy;
        
        // Restablecer selectores y campos
        document.getElementById('filtro-tipo-comprobante').value = 'todos';
        document.getElementById('filtro-metodo-pago').value = 'todos';
        document.getElementById('filtro-cliente').value = '';
        document.getElementById('filtro-cliente-id').value = '';
        document.getElementById('filtro-usuario').value = 'todos';
        
        // Si el usuario no está limitado a una sucursal, limpiar ese filtro también
        if (verificarPermiso('acceso_todas_sucursales')) {
            document.getElementById('filtro-sucursal').value = 'todos';
        }
        
        document.getElementById('filtro-monto-minimo').value = '';
        document.getElementById('filtro-monto-maximo').value = '';
        
        // Actualizar filtros activos
        filtrosActivos = {
            fechaDesde: unMesAtras,
            fechaHasta: hoy,
            tipoComprobante: 'todos',
            metodoPago: 'todos',
            cliente: '',
            usuario: 'todos',
            sucursal: document.getElementById('filtro-sucursal').value,
            montoMinimo: null,
            montoMaximo: null
        };
        
        // Cargar datos con filtros restablecidos
        await cargarHistorialVentas();
    } catch (error) {
        console.error('Error al limpiar filtros:', error);
        mostrarError('No se pudieron limpiar los filtros. Por favor, intente nuevamente.');
    }
}

/**
 * Actualiza el estado de los botones de acciones según la selección
 */
function actualizarBotonesAcciones() {
    const haySeleccion = filasSeleccionadas.length > 0;
    const esSeleccionUnica = filasSeleccionadas.length === 1;
    
    // Botones que requieren una sola selección
    document.getElementById('btn-ver-factura').disabled = !esSeleccionUnica;
    document.getElementById('btn-imprimir-ticket').disabled = !esSeleccionUnica;
    document.getElementById('btn-imprimir-a4').disabled = !esSeleccionUnica;
    document.getElementById('btn-enviar-email').disabled = !esSeleccionUnica;
    document.getElementById('btn-enviar-whatsapp').disabled = !esSeleccionUnica;
    
    // Botones que funcionan con múltiples selecciones
    document.getElementById('btn-exportar-pdf').disabled = !haySeleccion;
    document.getElementById('btn-exportar-excel').disabled = !haySeleccion;
}

/**
 * Ver la factura seleccionada en detalle
 */
async function verFacturaSeleccionada() {
    if (filasSeleccionadas.length !== 1) return;
    
    await verFactura(filasSeleccionadas[0].id);
}

/**
 * Ver una factura específica en detalle
 * @param {number} id - ID de la factura
 */
async function verFactura(id) {
    try {
        mostrarCargando(true);
        
        // Cargar detalles de la factura
        const factura = await db.obtenerVentaPorId(id);
        
        if (!factura) {
            mostrarError('No se pudo encontrar la factura seleccionada.');
            mostrarCargando(false);
            return;
        }
        
        // Preparar contenido del modal
        const fechaHora = new Date(factura.fechaHora);
        
        // Construir HTML para los ítems
        let itemsHtml = '';
        let subtotal = 0;
        
        factura.items.forEach(item => {
            const itemTotal = parseFloat(item.precioUnitario) * parseInt(item.cantidad);
            subtotal += itemTotal;
            
            itemsHtml += `
                <tr>
                    <td>${item.cantidad}</td>
                    <td>${item.producto}</td>
                    <td class="text-right">$${parseFloat(item.precioUnitario).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
                    <td class="text-right">$${itemTotal.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
                </tr>
            `;
        });
        
        // Calcular totales
        const descuentoMonto = factura.descuentoPorcentaje ? (subtotal * factura.descuentoPorcentaje / 100) : 0;
        const subtotalConDescuento = subtotal - descuentoMonto;
        const iva = factura.ivaTotal || 0;
        
        // HTML para el modal
        const modalContent = `
            <div class="factura-detalle">
                <div class="cabecera">
                    <div class="d-flex justify-content-between">
                        <h4>${factura.tipoComprobante} ${factura.numeroComprobante}</h4>
                        <p>Fecha: ${fechaHora.toLocaleDateString('es-AR')} ${fechaHora.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</p>
                    </div>
                    <div class="cliente-info">
                        <p><strong>Cliente:</strong> ${factura.clienteNombre || 'Consumidor Final'}</p>
                        ${factura.clienteDocumento ? `<p><strong>CUIT/DNI:</strong> ${factura.clienteDocumento}</p>` : ''}
                        ${factura.clienteDireccion ? `<p><strong>Dirección:</strong> ${factura.clienteDireccion}</p>` : ''}
                    </div>
                    <div class="venta-info">
                        <p><strong>Usuario:</strong> ${factura.usuarioNombre}</p>
                        <p><strong>Sucursal:</strong> ${factura.sucursalNombre}</p>
                        <p><strong>Método de Pago:</strong> ${factura.metodoPago}</p>
                    </div>
                </div>
                
                <div class="items-table mt-4">
                    <table class="table table-striped">
                        <thead>
                            <tr>
                                <th>Cant.</th>
                                <th>Producto</th>
                                <th class="text-right">Precio Unit.</th>
                                <th class="text-right">Subtotal</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${itemsHtml}
                        </tbody>
                        <tfoot>
                            <tr>
                                <td colspan="3" class="text-right"><strong>Subtotal:</strong></td>
                                <td class="text-right">$${subtotal.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
                            </tr>
                            ${factura.descuentoPorcentaje ? `
                            <tr>
                                <td colspan="3" class="text-right"><strong>Descuento (${factura.descuentoPorcentaje}%):</strong></td>
                                <td class="text-right">-$${descuentoMonto.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
                            </tr>` : ''}
                            ${iva > 0 ? `
                            <tr>
                                <td colspan="3" class="text-right"><strong>IVA:</strong></td>
                                <td class="text-right">$${iva.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
                            </tr>` : ''}
                            <tr>
                                <td colspan="3" class="text-right"><strong>TOTAL:</strong></td>
                                <td class="text-right font-weight-bold">$${parseFloat(factura.total).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
                
                ${factura.observaciones ? `
                <div class="observaciones mt-3">
                    <p><strong>Observaciones:</strong> ${factura.observaciones}</p>
                </div>` : ''}
                
                <div class="acciones-factura mt-4 text-center">
                    <button class="btn btn-primary mr-2" onclick="imprimirTicketVenta(${factura.id})">
                        <i class="fa fa-print"></i> Imprimir Ticket
                    </button>
                    <button class="btn btn-info mr-2" onclick="imprimirA4Venta(${factura.id})">
                        <i class="fa fa-file-pdf"></i> Imprimir A4
                    </button>
                    <button class="btn btn-success mr-2" onclick="enviarEmailVenta(${factura.id})">
                        <i class="fa fa-envelope"></i> Enviar por Email
                    </button>
                    <button class="btn btn-success" onclick="enviarWhatsappVenta(${factura.id})">
                        <i class="fa fa-whatsapp"></i> Enviar por WhatsApp
                    </button>
                </div>
            </div>
        `;
        
        // Mostrar modal
        mostrarModal('Detalle de Factura', modalContent, 'modal-lg');
        mostrarCargando(false);
    } catch (error) {
        console.error('Error al ver factura:', error);
        mostrarError('No se pudo cargar el detalle de la factura. Por favor, intente nuevamente.');
        mostrarCargando(false);
    }
}

/**
 * Imprime un ticket para la factura seleccionada
 */
async function imprimirTicketSeleccionado() {
    if (filasSeleccionadas.length !== 1) return;
    
    await imprimirTicketVenta(filasSeleccionadas[0].id);
}

/**
 * Imprime un ticket para una venta específica
 * @param {number} id - ID de la venta
 */
async function imprimirTicketVenta(id) {
    try {
        mostrarCargando(true);
        
        // Verificar permisos
        if (!verificarPermiso('imprimir_comprobantes')) {
            mostrarError('No tiene permisos para imprimir comprobantes');
            mostrarCargando(false);
            return;
        }
        
        // Obtener datos de la venta
        const venta = await db.obtenerVentaPorId(id);
        
        if (!venta) {
            mostrarError('No se pudo encontrar la venta seleccionada.');
            mostrarCargando(false);
            return;
        }
        
        // Imprimir ticket
        const resultado = await imprimirTicket(venta);
        
        if (resultado.exito) {
            mostrarExito('Ticket impreso correctamente');
        } else {
            mostrarError(`Error al imprimir ticket: ${resultado.error}`);
        }
        
        mostrarCargando(false);
    } catch (error) {
        console.error('Error al imprimir ticket:', error);
        mostrarError('No se pudo imprimir el ticket. Por favor, intente nuevamente.');
        mostrarCargando(false);
    }
}

/**
 * Imprime un comprobante A4 para la factura seleccionada
 */
async function imprimirA4Seleccionado() {
    if (filasSeleccionadas.length !== 1) return;
    
    await imprimirA4Venta(filasSeleccionadas[0].id);
}

/**
 * Imprime un comprobante A4 para una venta específica
 * @param {number} id - ID de la venta
 */
async function imprimirA4Venta(id) {
    try {
        mostrarCargando(true);
        
        // Verificar permisos
        if (!verificarPermiso('imprimir_comprobantes')) {
            mostrarError('No tiene permisos para imprimir comprobantes');
            mostrarCargando(false);
            return;
        }
        
        // Obtener datos de la venta
        const venta = await db.obtenerVentaPorId(id);
        
        if (!venta) {
            mostrarError('No se pudo encontrar la venta seleccionada.');
            mostrarCargando(false);
            return;
        }
        
        // Generar PDF y luego imprimir
        const pdfData = await generarPDF(venta, 'a4');
        const resultado = await imprimirA4(pdfData);
        
        if (resultado.exito) {
            mostrarExito('Comprobante A4 impreso correctamente');
        } else {
            mostrarError(`Error al imprimir comprobante: ${resultado.error}`);
        }
        
        mostrarCargando(false);
    } catch (error) {
        console.error('Error al imprimir comprobante A4:', error);
        mostrarError('No se pudo imprimir el comprobante. Por favor, intente nuevamente.');
        mostrarCargando(false);
    }
}

/**
 * Envía por email la factura seleccionada
 */
async function enviarEmailSeleccionado() {
    if (filasSeleccionadas.length !== 1) return;
    
    await enviarEmailVenta(filasSeleccionadas[0].id);
}

/**
 * Envía por email una venta específica
 * @param {number} id - ID de la venta
 */
async function enviarEmailVenta(id) {
    try {
        // Obtener datos de la venta
        const venta = await db.obtenerVentaPorId(id);
        
        if (!venta) {
            mostrarError('No se pudo encontrar la venta seleccionada.');
            return;
        }
        
        // Si no hay cliente o no tiene email, mostrar modal para ingresar email
        if (!venta.clienteEmail) {
            mostrarModalEmail(venta);
            return;
        }
        
        // Confirmar envío
        confirmarAccion(
            `¿Desea enviar la ${venta.tipoComprobante} ${venta.numeroComprobante} por email a ${venta.clienteEmail}?`,
            async () => {
                await procesarEnvioEmail(venta, venta.clienteEmail);
            }
        );
    } catch (error) {
        console.error('Error al preparar envío de email:', error);
        mostrarError('No se pudo preparar el envío del comprobante. Por favor, intente nuevamente.');
    }
}

/**
 * Muestra un modal para ingresar email de destinatario
 * @param {Object} venta - Datos de la venta
 */
function mostrarModalEmail(venta) {
    const modalContent = `
        <div class="form-group">
            <label for="email-destinatario">Email del destinatario</label>
            <input type="email" class="form-control" id="email-destinatario" placeholder="ejemplo@dominio.com" required>
        </div>
    `;
    
    mostrarModal('Ingresar Email', modalContent, 'modal-md', true, async () => {
        const email = document.getElementById('email-destinatario').value.trim();
        
        if (!email) {
            mostrarError('Debe ingresar un email válido');
            return false;
        }
        
        // Validar formato básico de email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            mostrarError('El formato del email no es válido');
            return false;
        }
        
        await procesarEnvioEmail(venta, email);
        return true;
    });
}

/**
 * Procesa el envío de email con la factura
 * @param {Object} venta - Datos de la venta
 * @param {string} email - Email del destinatario
 */
async function procesarEnvioEmail(venta, email) {
    try {
        mostrarCargando(true);
        
        // Generar PDF
        const pdfData = await generarPDF(venta, 'a4');
        
        // Preparar datos para el email
        const asunto = `${venta.tipoComprobante} ${venta.numeroComprobante} - ${venta.empresaNombre}`;
        const cuerpo = `
            Estimado/a ${venta.clienteNombre || 'Cliente'},
            
            Adjuntamos a este correo su ${venta.tipoComprobante} N° ${venta.numeroComprobante}.
            
            Gracias por su compra.
            
            Saludos cordiales,
            ${venta.empresaNombre}
        `;
        
        // Enviar email
        const resultado = await enviarEmail({
            destinatario: email,
            asunto: asunto,
            cuerpo: cuerpo,
            adjuntos: [{
                nombre: `${venta.tipoComprobante.replace(' ', '_')}_${venta.numeroComprobante}.pdf`,
                contenido: pdfData,
                tipo: 'application/pdf'
            }]
        });
        
        if (resultado.exito) {
            mostrarExito('Comprobante enviado correctamente por email');
            
            // Si el email enviado no es el registrado para el cliente, preguntar si desea actualizarlo
            if (venta.clienteId && email !== venta.clienteEmail) {
                confirmarAccion(
                    `¿Desea actualizar el email del cliente ${venta.clienteNombre} a ${email}?`,
                    async () => {
                        await db.actualizarEmailCliente(venta.clienteId, email);
                        mostrarExito('Email del cliente actualizado correctamente');
                    }
                );
            }
        } else {
            mostrarError(`Error al enviar email: ${resultado.error}`);
        }
        
        mostrarCargando(false);
    } catch (error) {
        console.error('Error al enviar email:', error);
        mostrarError('No se pudo enviar el comprobante por email. Por favor, intente nuevamente.');
        mostrarCargando(false);
    }
}

/**
 * Envía por WhatsApp la factura seleccionada
 */
async function enviarWhatsappSeleccionado() {
    if (filasSeleccionadas.length !== 1) return;
    
    await enviarWhatsappVenta(filasSeleccionadas[0].id);
}

/**
 * Envía por WhatsApp una venta específica
 * @param {number} id - ID de la venta
 */
async function enviarWhatsappVenta(id) {
    try {
        // Obtener datos de la venta
        const venta = await db.obtenerVentaPorId(id);
        
        if (!venta) {
            mostrarError('No se pudo encontrar la venta seleccionada.');
            return;
        }
        
        // Si no hay cliente o no tiene teléfono, mostrar modal para ingresar teléfono
        if (!venta.clienteTelefono) {
            mostrarModalTelefono(venta);
            return;
        }
        
        // Confirmar envío
        confirmarAccion(
            `¿Desea enviar la ${venta.tipoComprobante} ${venta.numeroComprobante} por WhatsApp al número ${venta.clienteTelefono}?`,
            async () => {
                await procesarEnvioWhatsapp(venta, venta.clienteTelefono);
            }
        );
    } catch (error) {
        console.error('Error al preparar envío de WhatsApp:', error);
        mostrarError('No se pudo preparar el envío del comprobante. Por favor, intente nuevamente.');
    }
}

/**
 * Muestra un modal para ingresar número de teléfono
 * @param {Object} venta - Datos de la venta
 */
function mostrarModalTelefono(venta) {
    const modalContent = `
        <div class="form-group">
            <label for="telefono-destinatario">Número de teléfono (con código de área, sin 0 ni 15)</label>
            <input type="tel" class="form-control" id="telefono-destinatario" placeholder="1123456789" required>
            <small class="form-text text-muted">Ingrese solo números, sin espacios ni caracteres especiales</small>
        </div>
    `;
    
    mostrarModal('Ingresar Teléfono', modalContent, 'modal-md', true, async () => {
        const telefono = document.getElementById('telefono-destinatario').value.trim();
        
        if (!telefono) {
            mostrarError('Debe ingresar un número de teléfono válido');
            return false;
        }
        
        // Validar formato básico de teléfono (solo números)
        const telefonoRegex = /^\d+$/;
        if (!telefonoRegex.test(telefono)) {
            mostrarError('El formato del teléfono no es válido (solo números)');
            return false;
        }
        
        await procesarEnvioWhatsapp(venta, telefono);
        return true;
    });
}

/**
 * Procesa el envío de WhatsApp con la factura
 * @param {Object} venta - Datos de la venta
 * @param {string} telefono - Número de teléfono del destinatario
 */
async function procesarEnvioWhatsapp(venta, telefono) {
    try {
        mostrarCargando(true);
        
        // Generar PDF
        const pdfData = await generarPDF(venta, 'a4');
        
        // Preparar mensaje para WhatsApp
        const mensaje = `*${venta.empresaNombre}*\n\nEstimado/a ${venta.clienteNombre || 'Cliente'},\n\nLe enviamos su ${venta.tipoComprobante} N° ${venta.numeroComprobante} por un total de $${parseFloat(venta.total).toLocaleString('es-AR', { minimumFractionDigits: 2 })}.\n\nGracias por su compra.`;
        
        // Enviar WhatsApp
        const resultado = await enviarMensajeWhatsapp({
            telefono: telefono,
            mensaje: mensaje,
            adjuntos: [{
                nombre: `${venta.tipoComprobante.replace(' ', '_')}_${venta.numeroComprobante}.pdf`,
                contenido: pdfData,
                tipo: 'application/pdf'
            }]
        });
        
        if (resultado.exito) {
            mostrarExito('Comprobante enviado correctamente por WhatsApp');
            
            // Si el teléfono enviado no es el registrado para el cliente, preguntar si desea actualizarlo
            if (venta.clienteId && telefono !== venta.clienteTelefono) {
                confirmarAccion(
                    `¿Desea actualizar el teléfono del cliente ${venta.clienteNombre} a ${telefono}?`,
                    async () => {
                        await db.actualizarTelefonoCliente(venta.clienteId, telefono);
                        mostrarExito('Teléfono del cliente actualizado correctamente');
                    }
                );
            }
        } else {
            mostrarError(`Error al enviar WhatsApp: ${resultado.error}`);
        }
        
        mostrarCargando(false);
    } catch (error) {
        console.error('Error al enviar WhatsApp:', error);
        mostrarError('No se pudo enviar el comprobante por WhatsApp. Por favor, intente nuevamente.');
        mostrarCargando(false);
    }
}

/**
 * Exporta las ventas seleccionadas a un archivo PDF
 */
async function exportarSeleccionadosPDF() {
    try {
        if (filasSeleccionadas.length === 0) return;
        
        mostrarCargando(true);
        
        // Verificar permisos
        if (!verificarPermiso('exportar_ventas')) {
            mostrarError('No tiene permisos para exportar ventas');
            mostrarCargando(false);
            return;
        }
        
        // Obtener IDs de ventas seleccionadas
        const ventasIds = filasSeleccionadas.map(v => v.id);
        
        // Generar PDF con todas las ventas seleccionadas
        const pdfData = await generarPDF({
            tipoDocumento: 'listado',
            titulo: 'Listado de Ventas',
            ventas: ventasIds
        }, 'a4');
        
        // Descargar PDF
        const nombreArchivo = `Ventas_${new Date().toISOString().slice(0, 10)}.pdf`;
        descargarArchivo(pdfData, nombreArchivo, 'application/pdf');
        
        mostrarExito('Ventas exportadas correctamente a PDF');
        mostrarCargando(false);
    } catch (error) {
        console.error('Error al exportar a PDF:', error);
        mostrarError('No se pudieron exportar las ventas a PDF. Por favor, intente nuevamente.');
        mostrarCargando(false);
    }
}

/**
 * Exporta las ventas seleccionadas a un archivo Excel
 */
async function exportarSeleccionadosExcel() {
    try {
        if (filasSeleccionadas.length === 0) return;
        
        mostrarCargando(true);
        
        // Verificar permisos
        if (!verificarPermiso('exportar_ventas')) {
            mostrarError('No tiene permisos para exportar ventas');
            mostrarCargando(false);
            return;
        }
        
        // Preparar datos para Excel
        const ventasExcel = filasSeleccionadas.map(venta => ({
            ID: venta.id,
            Fecha: venta.fecha,
            Hora: venta.hora,
            TipoComprobante: venta.comprobante,
            NumeroComprobante: venta.numero,
            Cliente: venta.cliente,
            Total: parseFloat(venta.total),
            MetodoPago: venta.metodoPago,
            Usuario: venta.usuario,
            Sucursal: venta.sucursal
        }));
        
        // Generar Excel
        const excelData = await generarExcel(ventasExcel, 'Ventas');
        
        // Descargar Excel
        const nombreArchivo = `Ventas_${new Date().toISOString().slice(0, 10)}.xlsx`;
        descargarArchivo(excelData, nombreArchivo, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        
        mostrarExito('Ventas exportadas correctamente a Excel');
        mostrarCargando(false);
    } catch (error) {
        console.error('Error al exportar a Excel:', error);
        mostrarError('No se pudieron exportar las ventas a Excel. Por favor, intente nuevamente.');
        mostrarCargando(false);
    }
}

/**
 * Muestra opciones de impresión para una venta
 * @param {Object} venta - Datos de la venta
 */
function mostrarOpcionesImpresion(venta) {
    const modalContent = `
        <div class="opciones-impresion text-center">
            <button class="btn btn-lg btn-primary m-2" onclick="imprimirTicketVenta(${venta.id})">
                <i class="fa fa-print fa-2x mb-2"></i><br>
                Ticket
            </button>
            <button class="btn btn-lg btn-info m-2" onclick="imprimirA4Venta(${venta.id})">
                <i class="fa fa-file-pdf fa-2x mb-2"></i><br>
                Factura A4
            </button>
        </div>
    `;
    
    mostrarModal('Opciones de Impresión', modalContent, 'modal-md');
}

/**
 * Muestra opciones para compartir una venta
 * @param {Object} venta - Datos de la venta
 */
function mostrarOpcionesCompartir(venta) {
    const modalContent = `
        <div class="opciones-compartir text-center">
            <button class="btn btn-lg btn-primary m-2" onclick="enviarEmailVenta(${venta.id})">
                <i class="fa fa-envelope fa-2x mb-2"></i><br>
                Email
            </button>
            <button class="btn btn-lg btn-success m-2" onclick="enviarWhatsappVenta(${venta.id})">
                <i class="fa fa-whatsapp fa-2x mb-2"></i><br>
                WhatsApp
            </button>
        </div>
    `;
    
    mostrarModal('Opciones para Compartir', modalContent, 'modal-md');
}

/**
 * Cambia la cantidad de registros por página
 * @param {number} cantidad - Cantidad de registros por página
 */
function cambiarRegistrosPorPagina(cantidad) {
    tablaVentas.page.len(cantidad).draw();
}

/**
 * Formatea una fecha para enviarla a la API
 * @param {Date} fecha - Fecha a formatear
 * @returns {string} - Fecha formateada en formato YYYY-MM-DD
 */
function formatearFecha(fecha) {
    if (!fecha) return null;
    
    const anio = fecha.getFullYear();
    const mes = String(fecha.getMonth() + 1).padStart(2, '0');
    const dia = String(fecha.getDate()).padStart(2, '0');
    
    return `${anio}-${mes}-${dia}`;
}

/**
 * Descarga un archivo generado
 * @param {Blob} data - Datos del archivo
 * @param {string} nombre - Nombre del archivo
 * @param {string} tipo - Tipo MIME del archivo
 */
function descargarArchivo(data, nombre, tipo) {
    const blob = new Blob([data], { type: tipo });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    
    setTimeout(() => {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    }, 100);
}

/**
 * Muestra un indicador de carga
 * @param {boolean} mostrar - Si se debe mostrar u ocultar el indicador
 */
function mostrarCargando(mostrar) {
    const cargando = document.getElementById('cargando-overlay');
    
    if (mostrar) {
        cargando.style.display = 'flex';
    } else {
        cargando.style.display = 'none';
    }
}

/**
 * Muestra un mensaje de éxito
 * @param {string} mensaje - Mensaje a mostrar
 */
function mostrarExito(mensaje) {
    toastr.success(mensaje);
}

/**
 * Muestra un mensaje de error
 * @param {string} mensaje - Mensaje a mostrar
 */
function mostrarError(mensaje) {
    toastr.error(mensaje);
}

/**
 * Muestra un modal genérico
 * @param {string} titulo - Título del modal
 * @param {string} contenido - Contenido HTML del modal
 * @param {string} tamano - Clase CSS para el tamaño del modal
 * @param {boolean} conGuardar - Si debe mostrar botón de guardar
 * @param {Function} fnGuardar - Función a ejecutar al guardar
 */
function mostrarModal(titulo, contenido, tamano = 'modal-md', conGuardar = false, fnGuardar = null) {
    // Crear o reutilizar el modal
    let modal = document.getElementById('modal-generico');
    
    if (!modal) {
        const modalHTML = `
            <div class="modal fade" id="modal-generico" tabindex="-1" role="dialog" aria-labelledby="modal-titulo" aria-hidden="true">
                <div class="modal-dialog modal-md" role="document">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title" id="modal-titulo"></h5>
                            <button type="button" class="close" data-dismiss="modal" aria-label="Cerrar">
                                <span aria-hidden="true">&times;</span>
                            </button>
                        </div>
                        <div class="modal-body" id="modal-contenido">
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-dismiss="modal">Cerrar</button>
                            <button type="button" class="btn btn-primary" id="modal-btn-guardar" style="display: none;">Guardar</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = modalHTML;
        document.body.appendChild(tempDiv.firstChild);
        modal = document.getElementById('modal-generico');
    }
    
    // Configurar el modal
    document.getElementById('modal-titulo').textContent = titulo;
    document.getElementById('modal-contenido').innerHTML = contenido;
    
    // Configurar tamaño
    modal.querySelector('.modal-dialog').className = `modal-dialog ${tamano}`;
    
    // Configurar botón de guardar
    const btnGuardar = document.getElementById('modal-btn-guardar');
    if (conGuardar && fnGuardar) {
        btnGuardar.style.display = 'block';
        btnGuardar.onclick = async function() {
            const resultado = await fnGuardar();
            if (resultado !== false) {
                $(modal).modal('hide');
            }
        };
    } else {
        btnGuardar.style.display = 'none';
    }
    
    // Mostrar modal
    $(modal).modal('show');
}

/**
 * Muestra un diálogo de confirmación
 * @param {string} mensaje - Mensaje a mostrar
 * @param {Function} fnConfirmar - Función a ejecutar si se confirma
 */
function confirmarAccion(mensaje, fnConfirmar) {
    const modalContent = `
        <p>${mensaje}</p>
    `;
    
    mostrarModal('Confirmar', modalContent, 'modal-md', true, fnConfirmar);
}

/**
 * Genera un archivo Excel (función auxiliar)
 * @param {Array} datos - Datos para el Excel
 * @param {string} nombreHoja - Nombre de la hoja de cálculo
 * @returns {Blob} - Archivo Excel generado
 */
async function generarExcel(datos, nombreHoja) {
    // Esta función simula la generación de un Excel
    // En una implementación real, usaría una biblioteca como SheetJS (xlsx)
    
    // Simulación del tiempo que toma generar un Excel
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Placeholder para el return
    return new Blob(['Excel simulado'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// Exportar la función de inicialización
export default {
    inicializarHistorial
};