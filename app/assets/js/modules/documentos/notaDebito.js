// app/assets/js/modules/documentos/notasDebito.js

import { mostrarNotificacion } from '../../../components/notifications.js';
import { obtenerFiltros } from '../../../utils/validation.js';
import { obtenerNotasDebito, anularNotaDebito, obtenerDetalleNotaDebito } from '../../../utils/database.js';
import { renderEstado, renderAccionesDocumento } from './renderHelpers.js';

// Cargar todas las notas de débito
export async function cargarNotasDebito() {
  try {
    const filtros = obtenerFiltros();
    const notas = await obtenerNotasDebito(filtros);

    const tbody = document.querySelector('#tablaNotasDebito tbody');
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
    console.error('Error cargando notas de débito:', error);
    mostrarNotificacion('error', 'No se pudieron cargar las notas de débito');
  }
}

// Filtrar notas de débito
export function filtrarNotasDebito() {
  cargarNotasDebito(); // se reutiliza con filtros aplicados
}

// Ver detalle de nota de débito
export async function verDetalleNotaDebito(id) {
  try {
    const detalle = await obtenerDetalleNotaDebito(id);

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
      const tr = document.createElement('tr');
      const subtotal = p.cantidad * p.precio;
      total += subtotal;
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
    console.error('Error al obtener detalle:', error);
    mostrarNotificacion('error', 'No se pudo obtener el detalle de la nota de débito');
  }
}

// Anular nota de débito
export async function anularNotaDebitoConMotivo(id, motivo, callback) {
  try {
    await anularNotaDebito(id, motivo);
    mostrarNotificacion('success', 'Nota de débito anulada');
    if (typeof callback === 'function') callback();
  } catch (error) {
    console.error('Error al anular nota de débito:', error);
    mostrarNotificacion('error', 'No se pudo anular la nota de débito');
  }
}
