// /app/assets/js/modules/compras/historial.js

import { obtenerDeDB, eliminarDeDB } from '../../utils/database.js';
import { logEvent } from '../../utils/logger.js';

let compras = [];
let paginaActual = 1;
const comprasPorPagina = 10;

export function initHistorialCompras() {
    document.getElementById('btn-aplicar-filtros')?.addEventListener('click', aplicarFiltros);
    document.getElementById('btn-limpiar-filtros')?.addEventListener('click', limpiarFiltros);
    document.getElementById('btn-exportar-excel')?.addEventListener('click', exportarExcel);
    document.getElementById('btn-exportar-pdf')?.addEventListener('click', exportarPDF);
    document.getElementById('btn-confirmar-eliminar')?.addEventListener('click', confirmarEliminarCompra);
    cargarCompras();
}

export function cargarCompras() {
    obtenerDeDB('compras')
        .then(data => {
            compras = data;
            renderizarCompras();
        })
        .catch(err => {
            console.error('Error al cargar compras:', err);
        });
}

function aplicarFiltros() {
    const desde = document.getElementById('fecha-desde').value;
    const hasta = document.getElementById('fecha-hasta').value;
    const proveedor = document.getElementById('filtro-proveedor').value;
    const estado = document.getElementById('filtro-estado').value;

    let filtradas = [...compras];

    if (desde) filtradas = filtradas.filter(c => c.fecha >= desde);
    if (hasta) filtradas = filtradas.filter(c => c.fecha <= hasta);
    if (proveedor) filtradas = filtradas.filter(c => c.proveedor === proveedor);
    if (estado) filtradas = filtradas.filter(c => c.estado === estado);

    renderizarCompras(filtradas);
}

function limpiarFiltros() {
    document.getElementById('fecha-desde').value = '';
    document.getElementById('fecha-hasta').value = '';
    document.getElementById('filtro-proveedor').value = '';
    document.getElementById('filtro-estado').value = '';
    renderizarCompras();
}

function renderizarCompras(lista = compras) {
    const tbody = document.getElementById('compras-list');
    if (!tbody) return;

    const totalPaginas = Math.ceil(lista.length / comprasPorPagina);
    const inicio = (paginaActual - 1) * comprasPorPagina;
    const paginadas = lista.slice(inicio, inicio + comprasPorPagina);

    if (paginadas.length === 0) {
        tbody.innerHTML = `
            <tr><td colspan="9" class="empty-state">
                <i class="fas fa-search"></i>
                <p>No se encontraron compras para los filtros aplicados</p>
            </td></tr>`;
        return;
    }

    tbody.innerHTML = paginadas.map(c => `
        <tr>
            <td>${c.fecha}</td>
            <td>${c.tipo} - ${c.numero}</td>
            <td>${c.proveedor}</td>
            <td>$${c.total.toFixed(2)}</td>
            <td>${c.estado}</td>
            <td>${c.formaPago}</td>
            <td>${c.usuario || 'Admin'}</td>
            <td>${c.sucursal || 'Principal'}</td>
            <td class="compra-actions">
                <button class="btn-action btn-view" onclick="verDetalleCompra('${c.numero}')"><i class="fas fa-eye"></i></button>
                <button class="btn-action btn-edit" onclick="editarCompra('${c.numero}')"><i class="fas fa-edit"></i></button>
                <button class="btn-action btn-delete" onclick="mostrarModalEliminar('${c.numero}')"><i class="fas fa-trash-alt"></i></button>
            </td>
        </tr>
    `).join('');

    renderizarPaginacion(totalPaginas);
}

function renderizarPaginacion(total) {
    const pagCont = document.getElementById('compras-pagination');
    if (!pagCont) return;

    let botones = '';
    for (let i = 1; i <= total; i++) {
        botones += `<button class="btn btn-sm ${i === paginaActual ? 'btn-primary' : ''}" onclick="cambiarPagina(${i})">${i}</button>`;
    }
    pagCont.innerHTML = botones;
}

window.cambiarPagina = function (nuevaPagina) {
    paginaActual = nuevaPagina;
    aplicarFiltros();
};

window.verDetalleCompra = function (numero) {
    const compra = compras.find(c => c.numero === numero);
    if (!compra) return;

    const contenedor = document.getElementById('detalle-compra-body');
    if (!contenedor) return;

    contenedor.innerHTML = `
        <p><strong>Proveedor:</strong> ${compra.proveedor}</p>
        <p><strong>Fecha:</strong> ${compra.fecha}</p>
        <p><strong>Total:</strong> $${compra.total.toFixed(2)}</p>
        <p><strong>Forma de pago:</strong> ${compra.formaPago}</p>
        <p><strong>Estado:</strong> ${compra.estado}</p>
        <h4>Productos:</h4>
        <ul>${compra.productos.map(p => `<li>${p.nombre} - ${p.cantidad} x $${p.precio.toFixed(2)}</li>`).join('')}</ul>
    `;
    document.getElementById('modal-detalle-compra').style.display = 'block';
};

window.editarCompra = function (numero) {
    alert(`Función para editar la compra ${numero} aún no implementada.`);
};

let numeroAEliminar = null;
window.mostrarModalEliminar = function (numero) {
    numeroAEliminar = numero;
    document.getElementById('modal-confirmacion-eliminar').style.display = 'block';
};

function confirmarEliminarCompra() {
    if (!numeroAEliminar) return;

    eliminarDeDB('compras', numeroAEliminar)
        .then(() => {
            logEvent('CompraEliminada', { numero: numeroAEliminar });
            numeroAEliminar = null;
            document.getElementById('modal-confirmacion-eliminar').style.display = 'none';
            cargarCompras();
        })
        .catch(err => {
            console.error('Error al eliminar compra:', err);
        });
}

function exportarExcel() {
    alert('Exportar a Excel (no implementado en esta demo)');
}

function exportarPDF() {
    alert('Exportar a PDF (no implementado en esta demo)');
}
