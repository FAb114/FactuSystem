// app/assets/js/modules/documentos/index.js

const { cargarRemitos, cargarNotasCredito, cargarNotasDebito, filtrarDocumentos, anularDocumento } = require('./remitos.js');
const { abrirModalCliente, seleccionarClienteDesdeModal } = require('../clientes/index.js');
const { abrirModalFactura, seleccionarFacturaDesdeModal } = require('../ventas/index.js');
const { abrirModalProducto, seleccionarProductoDesdeModal } = require('../productos/index.js');
const { imprimirDocumento, generarPDFDocumento } = require('../../../utils/printer.js');
const { enviarPorWhatsApp, enviarPorEmail } = require('../../../utils/mensajeria.js');
const { mostrarNotificacion } = require('../../../components/notifications.js');
const { validarFormulario, limpiarFormulario, obtenerFiltros } = require('../../../utils/validation.js');

const electron = window.electron;

// Estado global
let tipoActivo = 'remitos';
let documentoEnCurso = null;

document.addEventListener('DOMContentLoaded', () => {
  configurarTabs();
  configurarEventosGenerales();
  cargarDocumentos(tipoActivo);
});

function configurarTabs() {
  const tabs = document.querySelectorAll('.tab-link');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

      tab.classList.add('active');
      const id = tab.getAttribute('data-tab');
      document.getElementById(id).classList.add('active');
      tipoActivo = id;
      cargarDocumentos(id);
    });
  });
}

function configurarEventosGenerales() {
  document.getElementById('btnNuevoDocumento').addEventListener('click', () => {
    limpiarFormulario();
    documentoEnCurso = {
      tipo: 'remito',
      productos: [],
      cliente: null,
      factura: null,
      observaciones: ''
    };
    $('#modalNuevoDocumento').modal('show');
  });

  document.getElementById('tipoDocumento').addEventListener('change', (e) => {
    documentoEnCurso.tipo = e.target.value;
    const esNota = ['notaCredito', 'notaDebito'].includes(e.target.value);
    document.getElementById('seccionFacturaAsociada').style.display = esNota ? 'block' : 'none';
  });

  document.getElementById('btnBuscarCliente').addEventListener('click', () => abrirModalCliente(seleccionarCliente));
  document.getElementById('btnBuscarFactura').addEventListener('click', () => abrirModalFactura(seleccionarFactura));
  document.getElementById('btnBuscarProducto').addEventListener('click', () => abrirModalProducto(seleccionarProducto));

  document.getElementById('btnGuardar').addEventListener('click', guardarDocumento);
  document.getElementById('btnVistaPrevia').addEventListener('click', vistaPreviaDocumento);
  document.getElementById('btnConfirmarGuardar').addEventListener('click', guardarDocumento);

  document.getElementById('btnFiltrar').addEventListener('click', () => filtrarDocumentos(tipoActivo, obtenerFiltros()));
  document.getElementById('btnLimpiar').addEventListener('click', () => {
    limpiarFiltros();
    cargarDocumentos(tipoActivo);
  });

  document.getElementById('btnConfirmarAnulacion').addEventListener('click', () => {
    const id = document.getElementById('documentoAnularNumero').dataset.id;
    const motivo = document.getElementById('motivoAnulacion').value;
    anularDocumento(id, motivo, () => cargarDocumentos(tipoActivo));
    $('#modalConfirmarAnulacion').modal('hide');
  });

  document.getElementById('btnConfirmarEnvioEmail').addEventListener('click', enviarPorEmail);
  document.getElementById('btnConfirmarEnvioWhatsApp').addEventListener('click', enviarPorWhatsApp);

  document.getElementById('btnImprimirDocumento').addEventListener('click', () => {
    const id = document.getElementById('detalleNumero').dataset.id;
    imprimirDocumento(id);
  });
}

function cargarDocumentos(tipo) {
  switch (tipo) {
    case 'remitos':
      cargarRemitos();
      break;
    case 'notasCredito':
      cargarNotasCredito();
      break;
    case 'notasDebito':
      cargarNotasDebito();
      break;
  }
}

function seleccionarCliente(cliente) {
  documentoEnCurso.cliente = cliente;
  document.getElementById('clienteNombre').value = cliente.nombre;
  document.getElementById('clienteCuit').innerText = cliente.cuit;
  document.getElementById('clienteDireccion').innerText = cliente.direccion;
  document.getElementById('clienteTelefono').innerText = cliente.telefono;
  document.getElementById('clienteCondicionIva').innerText = cliente.iva;
  document.getElementById('datosCliente').style.display = 'block';
}

function seleccionarFactura(factura) {
  documentoEnCurso.factura = factura;
  document.getElementById('facturaAsociada').value = factura.numero;
  document.getElementById('facturaFecha').innerText = factura.fecha;
  document.getElementById('facturaTotal').innerText = `$${factura.total.toFixed(2)}`;
  document.getElementById('facturaTipo').innerText = factura.tipo;
  document.getElementById('facturaEstado').innerText = factura.estado;
  document.getElementById('datosFactura').style.display = 'block';
}

function seleccionarProducto(producto) {
  const modal = $('#modalCantidadProducto');
  document.getElementById('productoSeleccionadoNombre').innerText = producto.descripcion;
  document.getElementById('cantidadProducto').value = 1;
  document.getElementById('precioUnitario').value = producto.precio;
  document.getElementById('stockDisponible').innerText = producto.stock;
  modal.modal('show');

  document.getElementById('btnConfirmarCantidad').onclick = () => {
    const cantidad = parseInt(document.getElementById('cantidadProducto').value);
    const precio = parseFloat(document.getElementById('precioUnitario').value);
    if (!isNaN(cantidad) && cantidad > 0 && !isNaN(precio) && precio > 0) {
      producto.cantidad = cantidad;
      producto.precio = precio;
      producto.subtotal = cantidad * precio;
      documentoEnCurso.productos.push(producto);
      actualizarTablaProductos();
      modal.modal('hide');
    } else {
      mostrarNotificacion('error', 'Cantidad o precio inválido');
    }
  };
}

function actualizarTablaProductos() {
  const tbody = document.querySelector('#tablaProductos tbody');
  tbody.innerHTML = '';
  let total = 0;

  documentoEnCurso.productos.forEach((p, i) => {
    total += p.subtotal;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.codigo}</td>
      <td>${p.descripcion}</td>
      <td>${p.cantidad}</td>
      <td>$${p.precio.toFixed(2)}</td>
      <td>$${p.subtotal.toFixed(2)}</td>
      <td><button class="btn btn-sm btn-danger" data-index="${i}"><i class="fas fa-trash"></i></button></td>
    `;
    tr.querySelector('button').addEventListener('click', () => {
      documentoEnCurso.productos.splice(i, 1);
      actualizarTablaProductos();
    });
    tbody.appendChild(tr);
  });

  document.getElementById('totalDocumento').innerText = `$${total.toFixed(2)}`;
  documentoEnCurso.total = total;
}

function vistaPreviaDocumento() {
  if (!validarFormulario(documentoEnCurso)) return;
  generarPDFDocumento(documentoEnCurso, 'documentPreview');
  $('#modalVistaPrevia').modal('show');
}

function guardarDocumento() {
  if (!validarFormulario(documentoEnCurso)) return;
  electron.guardarDocumento(documentoEnCurso)
    .then(() => {
      mostrarNotificacion('success', 'Documento guardado correctamente');
      $('#modalNuevoDocumento').modal('hide');
      cargarDocumentos(tipoActivo);
    })
    .catch(err => {
      mostrarNotificacion('error', `Error al guardar: ${err.message}`);
    });
}

function limpiarFiltros() {
  ['fechaDesde', 'fechaHasta', 'cliente', 'estado', 'sucursal', 'numero', 'usuario'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}
