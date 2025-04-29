const { obtenerHistorialComprasCliente, obtenerEstadisticasHistorialCliente } = require('../../utils/database.js');
const { renderChartLine, renderChartBar } = require('../../components/charts.js'); // Utilidad para gráficos con Chart.js

// Función principal para cargar el historial de compras de un cliente específico
export async function cargarHistorialCliente(clienteId) {
    const desde = document.getElementById('fechaDesdeHistorial').value || null;
    const hasta = document.getElementById('fechaHastaHistorial').value || null;

    const compras = await obtenerHistorialComprasCliente(clienteId, desde, hasta);
    const estadisticas = await obtenerEstadisticasHistorialCliente(clienteId, desde, hasta);

    renderizarTablaHistorial(compras);
    renderizarEstadisticas(estadisticas);
    renderizarGraficos(estadisticas);
}

// Renderiza las compras en tabla
function renderizarTablaHistorial(compras) {
    const tbody = document.getElementById('clienteHistorialCompras');
    tbody.innerHTML = '';

    compras.forEach(compra => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${compra.fecha}</td>
            <td>${compra.comprobante}</td>
            <td>$${compra.total.toFixed(2)}</td>
            <td>${compra.formaPago}</td>
            <td>${compra.estado}</td>
            <td>
                <button class="btn-icon btn-ver-comprobante" data-id="${compra.id}">
                    <i class="fas fa-eye"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    document.querySelectorAll('.btn-ver-comprobante').forEach(btn =>
        btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            window.open(`/factura/${id}`, '_blank');
        })
    );
}

// Renderiza los KPIs de compras del período
function renderizarEstadisticas(stats) {
    document.getElementById('historialTotalPeriodo').innerText = `$${stats.totalPeriodo.toFixed(2)}`;
    document.getElementById('historialCantidadCompras').innerText = stats.cantidadCompras;
    document.getElementById('historialProductosDistintos').innerText = stats.productosDistintos;
}

// Renderiza los gráficos con Chart.js
function renderizarGraficos(stats) {
    renderChartLine('historialComprasMes', {
        labels: stats.meses.map(m => m.mes),
        datasets: [{
            label: 'Compras por Mes',
            data: stats.meses.map(m => m.total),
            borderColor: '#007bff',
            backgroundColor: 'rgba(0,123,255,0.1)',
            tension: 0.3
        }]
    });

    renderChartBar('historialProductosFrecuentes', {
        labels: stats.productos.map(p => p.nombre),
        datasets: [{
            label: 'Productos Más Comprados',
            data: stats.productos.map(p => p.cantidad),
            backgroundColor: '#28a745'
        }]
    });
}

// Filtro por fecha
document.getElementById('btnFiltrarHistorial').addEventListener('click', () => {
    const clienteId = document.getElementById('clienteId').value;
    if (clienteId) {
        cargarHistorialCliente(clienteId);
    }
});
