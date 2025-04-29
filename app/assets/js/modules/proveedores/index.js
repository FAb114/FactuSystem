const { obtenerProveedores, guardarProveedor, eliminarProveedor, obtenerCategoriasProveedores, exportarProveedoresExcel, importarProveedoresDesdeExcel } = require('../../utils/database.js');
const { abrirModal, cerrarModal } = require('../../components/modals.js');
const { mostrarNotificacion } = require('../../components/notifications.js');
const { cargarProveedorEnFormulario } = require('./editor.js');

let proveedores = [];

// Inicializar módulo
document.addEventListener('DOMContentLoaded', async () => {
    await cargarProveedores();
    configurarEventos();
});

// Cargar listado de proveedores
async function cargarProveedores() {
    proveedores = await obtenerProveedores();
    renderizarTablaProveedores(proveedores);
    cargarFiltroCategorias();
}

// Renderizado de la tabla de proveedores
function renderizarTablaProveedores(lista) {
    const tbody = document.querySelector('#tabla-proveedores tbody');
    tbody.innerHTML = '';

    lista.forEach(p => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${p.cuit}</td>
            <td>${p.razonSocial}</td>
            <td>${p.categoria || '-'}</td>
            <td>${p.telefono || '-'}</td>
            <td>${p.email || '-'}</td>
            <td>$${(p.saldo || 0).toFixed(2)}</td>
            <td><span class="badge bg-${p.estado === 'active' ? 'success' : (p.estado === 'inactive' ? 'secondary' : 'warning')}">${estadoLabel(p.estado)}</span></td>
            <td>${p.ultimaCompra || '-'}</td>
            <td>
                <button class="btn btn-sm btn-outline-primary btn-editar" data-id="${p.id}"><i class="bi bi-pencil"></i></button>
                <button class="btn btn-sm btn-outline-danger btn-eliminar" data-id="${p.id}"><i class="bi bi-trash"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    document.querySelectorAll('.btn-editar').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            const proveedor = proveedores.find(p => p.id == id);
            if (proveedor) cargarProveedorEnFormulario(proveedor);
        });
    });

    document.querySelectorAll('.btn-eliminar').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.id;
            const proveedor = proveedores.find(p => p.id == id);
            if (proveedor && confirm(`¿Eliminar proveedor ${proveedor.razonSocial}?`)) {
                await eliminarProveedor(id);
                await cargarProveedores();
                mostrarNotificacion('Proveedor eliminado correctamente.', 'success');
            }
        });
    });
}

// Traducción del estado
function estadoLabel(estado) {
    switch (estado) {
        case 'active': return 'Activo';
        case 'inactive': return 'Inactivo';
        case 'pending': return 'Pendiente';
        default: return 'Sin Estado';
    }
}

// Eventos
function configurarEventos() {
    document.getElementById('btn-nuevo-proveedor').addEventListener('click', () => {
        document.getElementById('form-proveedor').reset();
        document.getElementById('proveedor-id').value = '';
        abrirModal('modalProveedor');
    });

    document.getElementById('btn-exportar-proveedores').addEventListener('click', () => {
        exportarProveedoresExcel(proveedores);
    });

    document.getElementById('btn-importar-proveedores').addEventListener('click', () => {
        abrirModal('modalImportarProveedores');
    });

    document.getElementById('link-plantilla').addEventListener('click', descargarPlantillaProveedores);

    document.getElementById('btn-importar').addEventListener('click', async () => {
        const input = document.getElementById('archivo-importacion');
        if (!input.files.length) {
            mostrarNotificacion('Seleccione un archivo para importar.', 'warning');
            return;
        }

        const resultado = await importarProveedoresDesdeExcel(input.files[0]);
        if (resultado.ok) {
            mostrarNotificacion('Importación completada.', 'success');
            await cargarProveedores();
            cerrarModal('modalImportarProveedores');
        } else {
            mostrarNotificacion(resultado.mensaje || 'Error durante la importación.', 'error');
        }
    });

    document.getElementById('buscar-proveedor').addEventListener('input', filtrarProveedores);
    document.getElementById('filtro-categoria').addEventListener('change', filtrarProveedores);
    document.getElementById('filtro-estado').addEventListener('change', filtrarProveedores);
    document.getElementById('btn-aplicar-filtros').addEventListener('click', filtrarProveedores);
}

// Filtro de proveedores
function filtrarProveedores() {
    const texto = document.getElementById('buscar-proveedor').value.toLowerCase();
    const categoria = document.getElementById('filtro-categoria').value;
    const estado = document.getElementById('filtro-estado').value;

    const filtrados = proveedores.filter(p => {
        const coincideTexto = p.razonSocial.toLowerCase().includes(texto) || p.cuit.toLowerCase().includes(texto);
        const coincideCategoria = !categoria || p.categoria === categoria;
        const coincideEstado = !estado || p.estado === estado;
        return coincideTexto && coincideCategoria && coincideEstado;
    });

    renderizarTablaProveedores(filtrados);
}

// Carga opciones del filtro de categorías
async function cargarFiltroCategorias() {
    const categorias = await obtenerCategoriasProveedores();
    const select = document.getElementById('filtro-categoria');
    select.innerHTML = '<option value="">Todas las categorías</option>';
    categorias.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        select.appendChild(opt);
    });
}

// Descargar plantilla Excel
function descargarPlantillaProveedores(e) {
    e.preventDefault();

    const encabezados = [["cuit", "razonSocial", "categoria", "telefono", "email", "estado"]];
    const ws = XLSX.utils.aoa_to_sheet(encabezados);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Proveedores');
    XLSX.writeFile(wb, 'plantilla_proveedores.xlsx');
}
