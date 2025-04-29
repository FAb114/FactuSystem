const { obtenerSucursales, obtenerUsuarios } = require('../../utils/database.js');
const { abrirModal, cerrarModal } = require('../../components/modals.js');
const { validarFormulario } = require('../../utils/validation.js');
const { mostrarNotificacion } = require('../../components/notifications.js');

function initEditorCliente
module.exports.initEditorCliente = initEditorCliente() {
    document.querySelector('#btnCancelarCliente').addEventListener('click', () => cerrarModal('modalCliente'));
    document.querySelector('.modal .close').addEventListener('click', () => cerrarModal('modalCliente'));
    document.querySelectorAll('.form-tab').forEach(tab =>
        tab.addEventListener('click', cambiarTabFormulario)
    );
    document.querySelector('#tipoCliente').addEventListener('change', mostrarCamposTipo);
    cargarSelects();
}

function cambiarTabFormulario(e) {
    const tab = e.target.dataset.tab;
    document.querySelectorAll('.form-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.form-tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector(`.form-tab[data-tab="${tab}"]`).classList.add('active');
    document.getElementById(tab).classList.add('active');
}

function mostrarCamposTipo() {
    const tipo = document.getElementById('tipoCliente').value;
    const camposPersona = document.querySelector('.persona-fields');
    const camposEmpresa = document.querySelector('.empresa-fields');
    if (tipo === 'empresa') {
        camposPersona.style.display = 'none';
        camposEmpresa.style.display = 'flex';
    } else {
        camposPersona.style.display = 'flex';
        camposEmpresa.style.display = 'none';
    }
}

async function cargarSelects() {
    const sucursales = await obtenerSucursales();
    const vendedores = await obtenerUsuarios();

    const sucursalSelect = document.getElementById('sucursalAsignada');
    const vendedorSelect = document.getElementById('vendedorAsignado');

    sucursales.forEach(sucursal => {
        const opt = document.createElement('option');
        opt.value = sucursal.nombre;
        opt.textContent = sucursal.nombre;
        sucursalSelect.appendChild(opt);
    });

    vendedores.forEach(user => {
        const opt = document.createElement('option');
        opt.value = user.nombre;
        opt.textContent = user.nombre;
        vendedorSelect.appendChild(opt);
    });
}

// Función para cargar los datos en el editor
function cargarClienteEnFormulario
module.exports.cargarClienteEnFormulario = cargarClienteEnFormulario(cliente) {
    document.getElementById('clienteId').value = cliente.id || '';
    document.getElementById('tipoCliente').value = cliente.tipo || 'persona';
    document.getElementById('categoriaCliente').value = cliente.categoria || 'regular';
    document.getElementById('nombre').value = cliente.nombre || '';
    document.getElementById('apellido').value = cliente.apellido || '';
    document.getElementById('razonSocial').value = cliente.razonSocial || '';
    document.getElementById('documento').value = cliente.documento || '';
    document.getElementById('fechaNacimiento').value = cliente.fechaNacimiento || '';
    document.getElementById('sucursalAsignada').value = cliente.sucursal || '';
    document.getElementById('vendedorAsignado').value = cliente.vendedor || '';
    document.getElementById('condicionIVA').value = cliente.condicionIVA || 'CF';
    document.getElementById('condicionIIBB').value = cliente.condicionIIBB || 'CM';
    document.getElementById('nroIIBB').value = cliente.nroIIBB || '';
    document.getElementById('tipoFactura').value = cliente.tipoFactura || 'B';
    document.getElementById('telefono').value = cliente.telefono || '';
    document.getElementById('celular').value = cliente.celular || '';
    document.getElementById('email').value = cliente.email || '';
    document.getElementById('direccion').value = cliente.direccion || '';
    document.getElementById('localidad').value = cliente.localidad || '';
    document.getElementById('provincia').value = cliente.provincia || '';
    document.getElementById('codigoPostal').value = cliente.codigoPostal || '';
    document.getElementById('pais').value = cliente.pais || 'AR';
    document.getElementById('limiteCredito').value = cliente.limiteCredito || 0;
    document.getElementById('plazoCredito').value = cliente.plazoCredito || 30;
    document.getElementById('listaPrecio').value = cliente.listaPrecio || 'estandar';
    document.getElementById('descuentoGeneral').value = cliente.descuento || 0;
    document.getElementById('observaciones').value = cliente.observaciones || '';
    document.getElementById('participaFidelizacion').checked = !!cliente.participaFidelizacion;
    document.getElementById('puntosFidelizacion').value = cliente.puntos || 0;

    mostrarCamposTipo();
    abrirModal('modalCliente');
}

// Función para limpiar el formulario
function limpiarFormularioCliente
module.exports.limpiarFormularioCliente = limpiarFormularioCliente() {
    document.getElementById('formCliente').reset();
    document.getElementById('clienteId').value = '';
    mostrarCamposTipo();
}
