import { obtenerClientes, buscarClientes, guardarCliente, eliminarCliente, importarClientes, exportarClientes } from '../../utils/database.js';
import { validarFormulario } from '../../utils/validation.js';
import { mostrarNotificacion } from '../../components/notifications.js';
import { abrirModal, cerrarModal } from '../../components/modals.js';
import { actualizarGrafico, initGraficosClientes } from './estadisticas.js';
import { cargarHistorialCliente } from './historial.js';
import { inicializarFidelizacion, cargarStatsFidelizacion } from './fidelizacion.js';

// Estado global
let clientes = [];
let clienteSeleccionado = null;

// Inicialización principal del módulo
document.addEventListener('DOMContentLoaded', async () => {
    await cargarClientes();
    configurarEventosUI();
    initGraficosClientes();
    inicializarFidelizacion();
});

// Carga inicial de clientes
async function cargarClientes() {
    clientes = await obtenerClientes();
    renderizarTablaClientes(clientes);
    cargarFiltrosSucursal(clientes);
}

// Renderizado de la tabla
function renderizarTablaClientes(lista) {
    const tbody = document.querySelector('#tablaClientes tbody');
    tbody.innerHTML = '';
    lista.forEach(cliente => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${cliente.id}</td>
            <td>${cliente.nombre || cliente.razonSocial}</td>
            <td>${cliente.documento}</td>
            <td>${cliente.telefono || '-'}</td>
            <td>${cliente.email || '-'}</td>
            <td>${cliente.condicionIVA}</td>
            <td>${cliente.sucursal}</td>
            <td>${cliente.categoria}</td>
            <td>${cliente.ultimaCompra || '-'}</td>
            <td>
                <button class="btn-icon btn-ver" data-id="${cliente.id}"><i class="fas fa-eye"></i></button>
                <button class="btn-icon btn-editar" data-id="${cliente.id}"><i class="fas fa-edit"></i></button>
                <button class="btn-icon btn-eliminar" data-id="${cliente.id}"><i class="fas fa-trash"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });
    configurarAccionesTabla();
}

// Eventos generales de interfaz
function configurarEventosUI() {
    document.getElementById('btnNuevoCliente').addEventListener('click', abrirFormularioNuevoCliente);
    document.getElementById('btnBuscar').addEventListener('click', buscarEnTabla);
    document.getElementById('btnExportarClientes').addEventListener('click', () => exportarClientes(clientes));
    document.getElementById('btnImportarClientes').addEventListener('click', importarClientes);
    document.getElementById('formCliente').addEventListener('submit', guardarClienteDesdeFormulario);
}

// Buscar
function buscarEnTabla() {
    const termino = document.getElementById('searchCliente').value.toLowerCase();
    const filtrados = buscarClientes(clientes, termino);
    renderizarTablaClientes(filtrados);
}

// Nuevo cliente
function abrirFormularioNuevoCliente() {
    clienteSeleccionado = null;
    document.getElementById('formCliente').reset();
    abrirModal('modalCliente');
}

// Guardar cliente
async function guardarClienteDesdeFormulario(e) {
    e.preventDefault();
    if (!validarFormulario('formCliente')) return;

    const cliente = recolectarDatosFormulario();
    const resultado = await guardarCliente(cliente, clienteSeleccionado?.id);
    mostrarNotificacion(resultado.mensaje, resultado.ok ? 'success' : 'error');
    if (resultado.ok) {
        cerrarModal('modalCliente');
        await cargarClientes();
    }
}

// Recolectar datos del formulario
function recolectarDatosFormulario() {
    return {
        tipo: document.getElementById('tipoCliente').value,
        nombre: document.getElementById('nombre').value,
        apellido: document.getElementById('apellido').value,
        razonSocial: document.getElementById('razonSocial').value,
        documento: document.getElementById('documento').value,
        email: document.getElementById('email').value,
        telefono: document.getElementById('telefono').value,
        celular: document.getElementById('celular').value,
        direccion: document.getElementById('direccion').value,
        localidad: document.getElementById('localidad').value,
        provincia: document.getElementById('provincia').value,
        pais: document.getElementById('pais').value,
        condicionIVA: document.getElementById('condicionIVA').value,
        categoria: document.getElementById('categoriaCliente').value,
        sucursal: document.getElementById('sucursalAsignada').value,
        vendedor: document.getElementById('vendedorAsignado').value,
        fechaNacimiento: document.getElementById('fechaNacimiento').value,
        limiteCredito: parseFloat(document.getElementById('limiteCredito').value || 0),
        plazoCredito: parseInt(document.getElementById('plazoCredito').value || 0),
        listaPrecio: document.getElementById('listaPrecio').value,
        descuento: parseFloat(document.getElementById('descuentoGeneral').value || 0),
        tipoFactura: document.getElementById('tipoFactura').value,
        observaciones: document.getElementById('observaciones').value,
        participaFidelizacion: document.getElementById('participaFidelizacion').checked,
    };
}

// Acciones por cliente
function configurarAccionesTabla() {
    document.querySelectorAll('.btn-ver').forEach(btn =>
        btn.addEventListener('click', () => verDetalleCliente(btn.dataset.id))
    );
    document.querySelectorAll('.btn-editar').forEach(btn =>
        btn.addEventListener('click', async () => editarCliente(btn.dataset.id))
    );
    document.querySelectorAll('.btn-eliminar').forEach(btn =>
        btn.addEventListener('click', async () => {
            if (confirm('¿Eliminar este cliente?')) {
                await eliminarCliente(btn.dataset.id);
                await cargarClientes();
            }
        })
    );
}

// Ver detalles
async function verDetalleCliente(id) {
    const cliente = clientes.find(c => c.id == id);
    if (!cliente) return;

    clienteSeleccionado = cliente;
    document.getElementById('clienteNombreCompleto').innerText = cliente.nombre || cliente.razonSocial;
    document.getElementById('clienteDocumento').innerText = cliente.documento;
    document.getElementById('clienteTelefono').innerText = cliente.telefono || '-';
    document.getElementById('clienteEmailDetalle').innerText = cliente.email || '-';
    document.getElementById('clienteCategoriaDetalle').innerText = cliente.categoria || '-';
    document.getElementById('clienteSucursalDetalle').innerText = cliente.sucursal || '-';
    document.getElementById('clienteTipoFacturaDetalle').innerText = cliente.tipoFactura || 'B';
    document.getElementById('clienteLimiteCreditoDetalle').innerText = `$${cliente.limiteCredito.toFixed(2)}`;
    document.getElementById('clienteDescuentoDetalle').innerText = `${cliente.descuento}%`;

    cargarHistorialCliente(id);
    cargarStatsFidelizacion(cliente);

    abrirModal('modalVerCliente');
}

// Editar
function editarCliente(id) {
    const cliente = clientes.find(c => c.id == id);
    if (!cliente) return;

    clienteSeleccionado = cliente;
    document.getElementById('nombre').value = cliente.nombre || '';
    document.getElementById('apellido').value = cliente.apellido || '';
    document.getElementById('razonSocial').value = cliente.razonSocial || '';
    document.getElementById('documento').value = cliente.documento || '';
    document.getElementById('email').value = cliente.email || '';
    document.getElementById('telefono').value = cliente.telefono || '';
    document.getElementById('celular').value = cliente.celular || '';
    document.getElementById('direccion').value = cliente.direccion || '';
    document.getElementById('localidad').value = cliente.localidad || '';
    document.getElementById('provincia').value = cliente.provincia || '';
    document.getElementById('pais').value = cliente.pais || 'AR';
    document.getElementById('condicionIVA').value = cliente.condicionIVA || 'CF';
    document.getElementById('categoriaCliente').value = cliente.categoria || 'regular';
    document.getElementById('sucursalAsignada').value = cliente.sucursal || '';
    document.getElementById('vendedorAsignado').value = cliente.vendedor || '';
    document.getElementById('fechaNacimiento').value = cliente.fechaNacimiento || '';
    document.getElementById('limiteCredito').value = cliente.limiteCredito || 0;
    document.getElementById('plazoCredito').value = cliente.plazoCredito || 0;
    document.getElementById('listaPrecio').value = cliente.listaPrecio || 'estandar';
    document.getElementById('descuentoGeneral').value = cliente.descuento || 0;
    document.getElementById('tipoFactura').value = cliente.tipoFactura || 'B';
    document.getElementById('observaciones').value = cliente.observaciones || '';
    document.getElementById('participaFidelizacion').checked = cliente.participaFidelizacion;

    abrirModal('modalCliente');
}

// Carga de filtros dinámicos
function cargarFiltrosSucursal(clientes) {
    const select = document.getElementById('filterSucursal');
    const sucursales = [...new Set(clientes.map(c => c.sucursal))];
    sucursales.forEach(sucursal => {
        const opt = document.createElement('option');
        opt.value = sucursal;
        opt.textContent = sucursal;
        select.appendChild(opt);
    });
}
