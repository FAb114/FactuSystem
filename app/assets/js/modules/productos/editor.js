import { guardarProducto, obtenerCategorias, obtenerProveedores, obtenerGrupos, obtenerSubgrupos, obtenerFamilias, obtenerTipos } from '../../utils/database.js';
import { cerrarModal, abrirModal } from '../../components/modals.js';
import { mostrarNotificacion } from '../../components/notifications.js';

let productoActual = null;

export function initEditorProducto() {
    document.getElementById('form-producto').addEventListener('submit', guardarProductoDesdeFormulario);
    document.getElementById('btn-cancelar-producto').addEventListener('click', () => cerrarModal('modalProducto'));

    cargarSelectsDinamicos();
}

// Carga las listas de opciones para los campos select
async function cargarSelectsDinamicos() {
    const categorias = await obtenerCategorias();
    const proveedores = await obtenerProveedores();
    const grupos = await obtenerGrupos();
    const subgrupos = await obtenerSubgrupos();
    const familias = await obtenerFamilias();
    const tipos = await obtenerTipos();

    cargarOpciones('categoria', categorias);
    cargarOpciones('proveedor', proveedores);
    cargarOpciones('grupo', grupos);
    cargarOpciones('subgrupo', subgrupos);
    cargarOpciones('familia', familias);
    cargarOpciones('tipo', tipos);
}

function cargarOpciones(id, datos) {
    const select = document.getElementById(id);
    select.innerHTML = '<option value="">Seleccionar</option>';
    datos.forEach(dato => {
        const opt = document.createElement('option');
        opt.value = dato.nombre;
        opt.textContent = dato.nombre;
        select.appendChild(opt);
    });
}

// Recolecta datos del formulario y guarda
async function guardarProductoDesdeFormulario(e) {
    e.preventDefault();

    const producto = {
        id: productoActual?.id || null,
        codigo: document.getElementById('codigo').value.trim(),
        nombre: document.getElementById('nombre').value.trim(),
        descripcion: document.getElementById('descripcion').value.trim(),
        precio: parseFloat(document.getElementById('precio').value) || 0,
        iva: parseInt(document.getElementById('iva').value) || 0,
        categoria: document.getElementById('categoria').value,
        proveedor: document.getElementById('proveedor').value,
        grupo: document.getElementById('grupo').value,
        subgrupo: document.getElementById('subgrupo').value,
        familia: document.getElementById('familia').value,
        tipo: document.getElementById('tipo').value,
        stockInicial: parseInt(document.getElementById('stock-inicial').value) || 0,
        costo: parseFloat(document.getElementById('costo').value) || 0,
        imagen: document.getElementById('imagen-preview').src || null
    };

    if (!producto.nombre || !producto.codigo || producto.precio <= 0) {
        mostrarNotificacion('Por favor completá los campos obligatorios correctamente.', 'error');
        return;
    }

    const resultado = await guardarProducto(producto);

    if (resultado.ok) {
        mostrarNotificacion('Producto guardado correctamente.', 'success');
        cerrarModal('modalProducto');
        productoActual = null;
        const recargar = new CustomEvent('productoGuardado');
        window.dispatchEvent(recargar);
    } else {
        mostrarNotificacion('Error al guardar el producto.', 'error');
    }
}

// Cargar producto en el formulario (para edición)
export function cargarProductoEnFormulario(prod) {
    productoActual = prod;

    document.getElementById('producto-id').value = prod.id || '';
    document.getElementById('codigo').value = prod.codigo || '';
    document.getElementById('nombre').value = prod.nombre || '';
    document.getElementById('descripcion').value = prod.descripcion || '';
    document.getElementById('precio').value = prod.precio || 0;
    document.getElementById('iva').value = prod.iva || 21;
    document.getElementById('categoria').value = prod.categoria || '';
    document.getElementById('proveedor').value = prod.proveedor || '';
    document.getElementById('grupo').value = prod.grupo || '';
    document.getElementById('subgrupo').value = prod.subgrupo || '';
    document.getElementById('familia').value = prod.familia || '';
    document.getElementById('tipo').value = prod.tipo || '';
    document.getElementById('stock-inicial').value = prod.stock || 0;
    document.getElementById('costo').value = prod.costo || 0;
    document.getElementById('imagen-preview').src = prod.imagen || '../assets/img/products/default.png';

    abrirModal('modalProducto');
}
