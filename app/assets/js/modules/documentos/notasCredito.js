// app/assets/js/modules/documentos/notasCredito.js

import { mostrarNotificacion } from '../../../components/notifications.js';
import { obtenerNotasCredito, anularNotaCredito, obtenerDetalleNotaCredito } from '../../../utils/database.js';
import { renderEstado, renderAccionesDocumento } from './renderHelpers.js';
import { obtenerFiltros } from '../../../utils/validation.js';

// Cargar todas las notas de crédito
export async function cargarNotasCredito() {
  try {
    const filtros = obtenerFiltros();
    const notas = await obtenerNotasCredito(filtros);

    const tbody = document.querySelector('#tablaNotasCredito tbody');
    tbody.innerHTML = '';

    notas.forEach(nota => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${nota.numero}</td>
        <td>${nota.fecha}</td>
        <td>${nota.cliente}</td>
        <td>${nota.facturaAsociada || '-'}</td>
        <td>$${nota.total.toFixed(2)}</td>
        <td>${renderEstado(nota.estado)}</td>
        <td>${nota.sucursal}</td>
        <td>${renderAccionesDocumento(nota.id, nota.numero)}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (error) {
    console.error('Error al cargar notas de crédito:', error);
    mostrarNotificacion('error', 'No se pudieron cargar las notas de crédito');
  }
}

// Ver detalle de una nota de crédito
export async function verDetalleNotaCredito(id) {
  try {
    const detalle = await obtenerDetalleNotaCredito(id);

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

    // Factura asociada
    if (detalle.facturaAsociada) {
      document.getElementById('seccionDetalleFacturaAsociada').style.display = 'block';
      document.getElementById('detalleFacturaNumero').innerText = detalle.facturaAsociada.numero;
      document.getElementById('detalleFacturaFecha').innerText = detalle.facturaAsociada.fecha;
      document.getElementById('detalleFacturaTipo').innerText = detalle.facturaAsociada.tipo;
      document.getElementById('detalleFacturaTotal').innerText = `$${detalle.facturaAsociada.total.toFixed(2)}`;
    } else {
      document.getElementById('seccionDetalleFacturaAsociada').style.display = 'none';
    }

    // Observaciones
    document.getElementById('detalleObservaciones').innerText = detalle.observaciones || '-';

    // Productos
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
    console.error('Error al obtener detalle de nota de crédito:', error);
    mostrarNotificacion('error', 'No se pudo obtener el detalle de la nota de crédito');
  }
}

// Anular nota de crédito
export async function anularNotaCreditoConMotivo(id, motivo, callback) {
  try {
    await anularNotaCredito(id, motivo);
    mostrarNotificacion('success', 'Nota de crédito anulada correctamente');
    if (typeof callback === 'function') callback();
  } catch (error) {
    console.error('Error al anular nota de crédito:', error);
    mostrarNotificacion('error', 'No se pudo anular la nota de crédito');
  }
}
