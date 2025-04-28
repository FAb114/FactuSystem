import { obtenerProductos, guardarProducto, eliminarProducto, importarProductosExcel, exportarProductosExcel, obtenerCategorias, obtenerStockBajo, obtenerGrupos, obtenerSubgrupos, obtenerFamilias, obtenerTipos, obtenerProveedores } from '../../utils/database.js';
import { abrirModal, cerrarModal } from '../../components/modals.js';
import { mostrarNotificacion } from '../../components/notifications.js';
import { initEditorProducto, cargarProductoEnFormulario } from './editor.js';
import { inicializarCodigosDeBarras } from './codigosBarras.js';
import { inicializarStock, cargarResumenStock, renderizarHistorialStock } from './stock.js';
import JsBarcode from 'jsbarcode';

let productos = [];

document.addEventListener('DOMContentLoaded', async () => {
    await inicializarModuloProductos();
});

async function inicializarModuloProductos() {
    initEditorProducto();
    inicializarCodigosDeBarras();
    inicializarStock();

    configurarEventos();
    await cargarFiltros();
    await cargarListadoProductos();
    await mostrarAlertaStockBajo();
}

// Carga el listado principal
async function cargarListadoProductos() {
    productos = await obtenerProductos();
    renderizarTablaProductos(productos);
    cargarResumenStock(productos);
}

// Renderiza tabla
function renderizarTablaProductos(lista) {
    const tbody = document.querySelector('#tabla-productos tbody');
    tbody.innerHTML = '';
    lista.forEach(producto => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><img src="${producto.imagen || '../assets/img/products/default.png'}" class="producto-img" /></td>
            <td>${producto.codigo}</td>
            <td>${producto.nombre}</td>
            <td>${producto.categoria || '-'}</td>
            <td>$${producto.precio.toFixed(2)}</td>
            <td>${producto.iva}%</td>
            <td><span class="badge ${clasificarStock(producto.stock)}">${producto.stock}</span></td>
            <td class="actions-column">
                <button class="btn btn-sm btn-outline-primary btn-editar" data-id="${producto.id}"><i class="fas fa-edit"></i></button>
                <button class="btn btn-sm btn-outline-danger btn-eliminar" data-id="${producto.id}"><i class="fas fa-trash"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    document.querySelectorAll('.btn-editar').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            const prod = productos.find(p => p.id == id);
            if (prod) cargarProductoEnFormulario(prod);
        });
    });

    document.querySelectorAll('.btn-eliminar').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.id;
            if (confirm('¿Estás seguro de eliminar este producto?')) {
                await eliminarProducto(id);
                mostrarNotificacion('Producto eliminado correctamente.', 'success');
                await cargarListadoProductos();
            }
        });
    });
}

function clasificarStock(stock) {
    if (stock <= 0) return 'badge-stock-bajo';
    if (stock < 10) return 'badge-stock-medio';
    return 'badge-stock-alto';
}

// Eventos
function configurarEventos() {
    document.getElementById('btn-nuevo-producto').addEventListener('click', () => {
        document.getElementById('form-producto').reset();
        abrirModal('modalProducto');
    });

    document.getElementById('btn-importar-excel').addEventListener('click', async () => {
        await importarProductosExcel();
        mostrarNotificacion('Importación finalizada.', 'success');
        await cargarListadoProductos();
    });

    document.getElementById('btn-exportar-excel').addEventListener('click', () => {
        exportarProductosExcel(productos);
    });

    document.getElementById('busqueda-rapida').addEventListener('input', () => {
        const termino = document.getElementById('busqueda-rapida').value.toLowerCase();
        const filtrados = productos.filter(p =>
            p.nombre.toLowerCase().includes(termino) || p.codigo.toLowerCase().includes(termino)
        );
        renderizarTablaProductos(filtrados);
    });

    document.getElementById('btn-aplicar-filtros').addEventListener('click', aplicarFiltros);

    document.getElementById('btn-ver-productos-bajo-stock').addEventListener('click', async () => {
        const bajoStock = await obtenerStockBajo();
        renderizarTablaProductos(bajoStock);
    });
}

// Filtros avanzados
async function cargarFiltros() {
    const categorias = await obtenerCategorias();
    const grupos = await obtenerGrupos();
    const subgrupos = await obtenerSubgrupos();
    const familias = await obtenerFamilias();
    const tipos = await obtenerTipos();

    llenarSelect('filtro-categoria', categorias);
    llenarSelect('filtro-grupo', grupos);
    llenarSelect('filtro-subgrupo', subgrupos);
    llenarSelect('filtro-familia', familias);
    llenarSelect('filtro-tipo', tipos);
}

function llenarSelect(id, datos) {
    const select = document.getElementById(id);
    datos.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item.nombre;
        opt.textContent = item.nombre;
        select.appendChild(opt);
    });
}

function aplicarFiltros() {
    let resultado = [...productos];

    const categoria = document.getElementById('filtro-categoria').value;
    const grupo = document.getElementById('filtro-grupo').value;
    const subgrupo = document.getElementById('filtro-subgrupo').value;
    const familia = document.getElementById('filtro-familia').value;
    const tipo = document.getElementById('filtro-tipo').value;
    const precioMin = parseFloat(document.getElementById('filtro-precio-min').value);
    const precioMax = parseFloat(document.getElementById('filtro-precio-max').value);
    const stockEstado = document.getElementById('filtro-estado-stock').value;
    const iva = document.getElementById('filtro-iva').value;

    if (categoria) resultado = resultado.filter(p => p.categoria === categoria);
    if (grupo) resultado = resultado.filter(p => p.grupo === grupo);
    if (subgrupo) resultado = resultado.filter(p => p.subgrupo === subgrupo);
    if (familia) resultado = resultado.filter(p => p.familia === familia);
    if (tipo) resultado = resultado.filter(p => p.tipo === tipo);
    if (!isNaN(precioMin)) resultado = resultado.filter(p => p.precio >= precioMin);
    if (!isNaN(precioMax)) resultado = resultado.filter(p => p.precio <= precioMax);
    if (iva) resultado = resultado.filter(p => String(p.iva) === iva);

    if (stockEstado === 'bajo') resultado = resultado.filter(p => p.stock <= 5);
    if (stockEstado === 'normal') resultado = resultado.filter(p => p.stock > 5 && p.stock < 20);
    if (stockEstado === 'sinstock') resultado = resultado.filter(p => p.stock <= 0);

    renderizarTablaProductos(resultado);
}

// Alerta de stock bajo
async function mostrarAlertaStockBajo() {
    const productosBajo = await obtenerStockBajo();
    const alertBox = document.getElementById('stock-alert');
    const count = productosBajo.length;

    if (count > 0) {
        alertBox.style.display = 'block';
        document.getElementById('cantidad-productos-bajo-stock').innerText = count;
    } else {
        alertBox.style.display = 'none';
    }
}
