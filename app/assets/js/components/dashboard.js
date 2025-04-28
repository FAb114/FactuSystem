// app/assets/js/components/dashboard.js

import { getVentasDelDia } from '../../modules/ventas/estadisticas.js';
import { getTotalesCaja } from '../../modules/caja/index.js';
import { getComprasDelDia } from '../../modules/compras/analisis.js';
import { getProductosBajoStock } from '../../modules/productos/stock.js';
import { showToast } from '../../utils/notifications.js';
import { logger } from '../../utils/logger.js';

export async function cargarEstadisticas() {
  try {
    await cargarVentasHoy();
    await cargarCajaActual();
    await cargarStockCritico();
    mostrarNotificacionInicial();
  } catch (err) {
    console.error('Error al cargar estadísticas del dashboard:', err);
    logger('error', 'dashboard.js', err.message);
    showToast('Error al cargar estadísticas', 'error');
  }
}

async function cargarVentasHoy() {
  const datos = await getVentasDelDia();
  document.querySelector('#ventas-hoy .dashboard-value').textContent = `$${datos.total.toFixed(2)}`;
  document.querySelector('#ventas-hoy .dashboard-change').innerHTML = `+${datos.variacion}% <i class="fas fa-arrow-up"></i>`;
}

async function cargarCajaActual() {
  const caja = await getTotalesCaja();
  document.querySelector('#caja-actual .dashboard-value').textContent = `$${caja.saldo.toFixed(2)}`;
  document.querySelector('#caja-actual .dashboard-change').innerHTML = `${caja.tendencia > 0 ? '+' : ''}${caja.tendencia}% <i class="fas fa-arrow-${caja.tendencia >= 0 ? 'up' : 'down'}"></i>`;
}

async function cargarStockCritico() {
  const productos = await getProductosBajoStock();
  document.querySelector('#stock-critico .dashboard-value').textContent = productos.length;
  document.querySelector('#stock-critico .dashboard-change').innerHTML = `${productos.length} <i class="fas fa-${productos.length > 0 ? 'exclamation' : 'minus'}"></i>`;
}

function mostrarNotificacionInicial() {
  const hora = new Date().getHours();
  if (hora < 12) {
    showToast('Buen día ☀️ ¿Ya revisaste tus ventas de ayer?', 'info');
  } else if (hora < 18) {
    showToast('¡Seguimos vendiendo! Revisá tu stock si hace falta reponer.', 'info');
  } else {
    showToast('Cierre de día: recordá respaldar tu base de datos.', 'warning');
  }
}
