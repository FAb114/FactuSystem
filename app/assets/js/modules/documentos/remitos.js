// app/assets/js/modules/documentos/remitos.js

const { mostrarNotificacion } = require('../../../components/notifications.js');
const { obtenerRemitos, anularRemito, obtenerDetalleRemito } = require('../../../utils/database.js');
const { renderEstado, renderAccionesDocumento } = require('./renderHelpers.js');
const { obtenerFiltros } = require('../../../utils/validation.js');

// Cargar todos los remitos
export async function cargarRemitos() {
  try {
    const filtros = obtenerFiltros();
    const remitos = await obtenerRemitos(filtros);

    const tbody = document.querySelector('#tablaRemitos tbody');
    tbody.innerHTML = '';

    remitos.forEach(remito => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${remito.numero}</td>
        <td>${remito.fecha}</td>
        <td>${remito.cliente}</td>
        <td>$${remito.total.toFixed(2)}</td>
        <td>${renderEstado(remito.estado)}</td>
        <td>${remito.sucursal}</td>
        <td>${remito.usuario}</td>
        <td>${renderAccionesDocumento(remito.id, remito.numero)}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (error) {
    console.error('Error al cargar remitos:', error);
    mostrarNotificacion('error', 'No se pudieron cargar los remitos');
  }
}

// Ver detalle de remito
export async function verDetalleRemito(id) {
  try {
    const detalle = await obtenerDetalleRemito(id);

    document.getElementById('detalleNumero').innerText = detalle.numero;
    document.getElementById('detalleNumero').dataset.id = id;
    document.getElementById('detalleFecha').innerText = detalle.fecha;
    document.getElementById('detalleEstado').innerText = detalle.estado;
    document.getElementById('detalleUsuario').innerText = detalle.usuario;
    document.getElementById('detalleSucursal').innerText = detalle.sucursal;

    document.getElementById('detalleCliente').innerText = detalle.cliente.nombre;
    document.getElementById('detalleCuit').innerText = detalle.cliente.cuit;
    document.getElementById('detalleDireccion').innerText = detalle.cliente.direccion;
    document.getElementById('detalleCondicionIva').innerText = detalle.cliente.iva;

    document.getElementById('seccionDetalleFacturaAsociada').style.display = 'none';
    document.getElementById('detalleObservaciones').innerText = detalle.observaciones || '-';

    const tbody = document.querySelector('#tablaDetalleProductos tbody');
    tbody.innerHTML = '';
    let total = 0;

    detalle.productos.forEach(p => {
      const subtotal = p.cantidad * p.precio;
      total += subtotal;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${p.codigo}</td>
        <td>${p.descripcion}</td>
        <td>${p.cantidad}</td>
        <td>$${p.precio.toFixed(2)}</td>
        <td>$${subtotal.toFixed(2)}</td>
      `;
      tbody.appendChild(tr);
    });

    document.getElementById('detalleTotalDocumento').innerText = `$${total.toFixed(2)}`;
    $('#modalDetalleDocumento').modal('show');

  } catch (error) {
    console.error('Error al obtener detalle del remito:', error);
    mostrarNotificacion('error', 'No se pudo obtener el detalle del remito');
  }
}

// Anular remito
export async function anularRemitoConMotivo(id, motivo, callback) {
  try {
    await anularRemito(id, motivo);
    mostrarNotificacion('success', 'Remito anulado correctamente');
    if (typeof callback === 'function') callback();
  } catch (error) {
    console.error('Error al anular remito:', error);
    mostrarNotificacion('error', 'No se pudo anular el remito');
  }
}
