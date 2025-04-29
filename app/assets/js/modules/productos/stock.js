const { obtenerStockPorProducto, ajustarStockProducto, obtenerHistorialStock } = require('../../utils/database.js');
const { abrirModal, cerrarModal } = require('../../components/modals.js');
const { mostrarNotificacion } = require('../../components/notifications.js');

let stockActual = [];
let productoActivo = null;

// Inicializa eventos y componentes del módulo de stock
function inicializarStock
module.exports.inicializarStock = inicializarStock() {
    document.getElementById('btn-ajustar-stock').addEventListener('click', abrirModalAjusteStock);
    document.getElementById('form-ajuste-stock').addEventListener('submit', realizarAjusteStock);
    document.getElementById('btn-cerrar-historial-stock').addEventListener('click', () => cerrarModal('modalHistorialStock'));
}

// Carga el resumen de stock en la vista principal
function cargarResumenStock
module.exports.cargarResumenStock = cargarResumenStock(productos) {
    const total = productos.length;
    const sinStock = productos.filter(p => p.stock <= 0).length;
    const bajoStock = productos.filter(p => p.stock > 0 && p.stock < 5).length;

    document.getElementById('resumen-total-productos').innerText = total;
    document.getElementById('resumen-sin-stock').innerText = sinStock;
    document.getElementById('resumen-bajo-stock').innerText = bajoStock;
}

// Muestra detalle de stock por sucursal en el modal
export async function mostrarStockPorProducto(producto) {
    productoActivo = producto;
    document.getElementById('stock-producto-nombre').innerText = producto.nombre;
    stockActual = await obtenerStockPorProducto(producto.id);

    const tbody = document.getElementById('tabla-stock-sucursales');
    tbody.innerHTML = '';

    stockActual.forEach(entry => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${entry.sucursal}</td>
            <td>${entry.stock}</td>
            <td><button class="btn btn-sm btn-outline-dark btn-historial-stock" data-sucursal="${entry.sucursal}">Ver historial</button></td>
        `;
        tbody.appendChild(tr);
    });

    document.querySelectorAll('.btn-historial-stock').forEach(btn => {
        btn.addEventListener('click', () => {
            const sucursal = btn.dataset.sucursal;
            cargarHistorialStock(producto.id, sucursal);
        });
    });

    abrirModal('modalStockProducto');
}

// Muestra el historial de movimientos para un producto y sucursal
export async function cargarHistorialStock(productoId, sucursal) {
    const movimientos = await obtenerHistorialStock(productoId, sucursal);

    const tbody = document.getElementById('tabla-historial-stock');
    tbody.innerHTML = '';

    movimientos.forEach(mov => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${mov.fecha}</td>
            <td>${mov.tipo}</td>
            <td>${mov.cantidad}</td>
            <td>${mov.usuario}</td>
            <td>${mov.descripcion}</td>
        `;
        tbody.appendChild(tr);
    });

    document.getElementById('historial-stock-titulo').innerText = `Historial - ${sucursal}`;
    abrirModal('modalHistorialStock');
}

// Abre modal para ajustar stock
function abrirModalAjusteStock() {
    if (!productoActivo) {
        mostrarNotificacion('Debe seleccionar un producto primero.', 'error');
        return;
    }

    document.getElementById('form-ajuste-stock').reset();
    document.getElementById('ajuste-nombre-producto').innerText = productoActivo.nombre;
    abrirModal('modalAjusteStock');
}

// Realiza el ajuste de stock desde el formulario
async function realizarAjusteStock(e) {
    e.preventDefault();

    const sucursal = document.getElementById('ajuste-sucursal').value;
    const tipo = document.getElementById('ajuste-tipo').value;
    const cantidad = parseInt(document.getElementById('ajuste-cantidad').value);
    const descripcion = document.getElementById('ajuste-descripcion').value;

    if (!sucursal || !tipo || isNaN(cantidad)) {
        mostrarNotificacion('Por favor completa todos los campos correctamente.', 'error');
        return;
    }

    const resultado = await ajustarStockProducto({
        productoId: productoActivo.id,
        sucursal,
        tipo,
        cantidad,
        descripcion
    });

    if (resultado.ok) {
        mostrarNotificacion('Stock ajustado correctamente.', 'success');
        cerrarModal('modalAjusteStock');
        await mostrarStockPorProducto(productoActivo);
    } else {
        mostrarNotificacion(resultado.mensaje || 'Error al ajustar stock.', 'error');
    }
}
