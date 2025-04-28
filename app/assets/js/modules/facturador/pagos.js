/**
 * pagos.js - Módulo de gestión de pagos para el facturador
 * 
 * Este módulo maneja todas las formas de pago disponibles en el sistema:
 * - Efectivo
 * - Tarjetas (débito/crédito)
 * - Transferencia bancaria
 * - QR de Mercado Pago
 * 
 * También se encarga de registrar los pagos en la base de datos y 
 * preparar la información para la facturación electrónica.
 */

import { ipcRenderer } from '../../../renderer.js';
import { createLogger } from '../../../utils/logger.js';
import { validatePaymentData } from '../../../utils/validation.js';
import { showNotification } from '../../../components/notifications.js';
import { getUserInfo } from '../../../utils/auth.js';
import { getSucursalConfig } from '../../sucursales/configuracion.js';
import { getDatabase } from '../../../utils/database.js';

// Integraciones de pago
import { verificarPagoQR, generarQRMercadoPago } from '../../../../integrations/mercadoPago/qr.js';
import { registrarTransferencia } from '../../../../integrations/bancos/api.js';

// Configuración del logger
const logger = createLogger('facturador-pagos');

// Estado de pagos para la factura actual
let estadoPagos = {
  total: 0,
  totalPagado: 0,
  metodosPago: [],
  sucursalId: null,
  usuarioId: null,
  clienteId: null,
  vuelto: 0,
  pagoVerificado: false
};

/**
 * Inicializa el módulo de pagos
 */
export async function inicializarPagos(sucursalId, usuarioId) {
  try {
    estadoPagos.sucursalId = sucursalId;
    estadoPagos.usuarioId = usuarioId;
    await getSucursalConfig(sucursalId);
    configurarListeners();
    logger.info('Módulo de pagos inicializado', { sucursalId, usuarioId });
    return true;
  } catch (error) {
    logger.error('Error al inicializar módulo de pagos', { error });
    showNotification('Error al inicializar los métodos de pago', 'error');
    return false;
  }
}

/**
 * Establece el total a pagar y cliente
 */
export function setTotalAPagar(total, clienteId) {
  estadoPagos.total = total;
  estadoPagos.clienteId = clienteId;
  estadoPagos.totalPagado = 0;
  estadoPagos.metodosPago = [];
  estadoPagos.vuelto = 0;
  estadoPagos.pagoVerificado = false;
  actualizarVisualizacionTotales();
  logger.info('Total a pagar configurado', { total, clienteId });
}

// Configura listeners para botones de pago
function configurarListeners() {
  document.getElementById('btn-pago-efectivo')?.addEventListener('click', mostrarModalEfectivo);
  document.getElementById('btn-pago-tarjeta')?.addEventListener('click', mostrarModalTarjeta);
  document.getElementById('btn-pago-transferencia')?.addEventListener('click', mostrarModalTransferencia);
  document.getElementById('btn-pago-qr')?.addEventListener('click', mostrarModalQR);
  document.getElementById('btn-cancelar-pago')?.addEventListener('click', cancelarPago);
}

// Actualiza totales en UI
function actualizarVisualizacionTotales() {
  const totalEl = document.getElementById('facturador-total');
  const pagadoEl = document.getElementById('facturador-pagado');
  const faltanteEl = document.getElementById('facturador-faltante');
  if (totalEl) totalEl.textContent = formatearMoneda(estadoPagos.total);
  if (pagadoEl) pagadoEl.textContent = formatearMoneda(estadoPagos.totalPagado);
  const faltante = Math.max(0, estadoPagos.total - estadoPagos.totalPagado);
  if (faltanteEl) faltanteEl.textContent = formatearMoneda(faltante);
  actualizarEstadoBotonFacturar();
}

// Habilita o deshabilita el botón de facturar
function actualizarEstadoBotonFacturar() {
  const btnFacturar = document.getElementById('btn-generar-factura');
  if (!btnFacturar) return;
  const pagoCompleto = estadoPagos.totalPagado >= estadoPagos.total;
  const requiereVerif = estadoPagos.metodosPago.some(m => ['qr','transferencia'].includes(m.tipo));
  estadoPagos.pagoVerificado = pagoCompleto && (!requiereVerif || estadoPagos.pagoVerificado);
  btnFacturar.disabled = !estadoPagos.pagoVerificado;
}

// Cancela todos los pagos
function cancelarPago() {
  estadoPagos.totalPagado = 0;
  estadoPagos.metodosPago = [];
  estadoPagos.vuelto = 0;
  estadoPagos.pagoVerificado = false;
  actualizarVisualizacionTotales();
  showNotification('Pagos cancelados', 'info');
}

/** Modal y procesamiento Efectivo **/
function mostrarModalEfectivo() {
  const faltante = estadoPagos.total - estadoPagos.totalPagado;
  if (faltante <= 0) return showNotification('El pago ya está completo','info');
  const modal = document.createElement('div');
  modal.className='modal-pago active'; modal.id='modal-pago-efectivo';
  modal.innerHTML=`
    <div class='modal-content'>
      <div class='modal-header'><h3>Pago en Efectivo</h3><button class='close-modal'>&times;</button></div>
      <div class='modal-body'>
        <div><label>Monto recibido:</label><input type='number' id='monto-efectivo' value='${faltante.toFixed(2)}'/></div>
        <div><label>Total a pagar:</label><p>${formatearMoneda(faltante)}</p></div>
        <div><label>Vuelto:</label><p id='vuelto-efectivo'>$0.00</p></div>
      </div>
      <div class='modal-footer'><button id='btn-cancelar-efectivo'>Cancelar</button><button id='btn-aceptar-efectivo'>Aceptar Pago</button></div>
    </div>`;
  document.body.appendChild(modal);
  const input = document.getElementById('monto-efectivo');
  const vueltoEl = document.getElementById('vuelto-efectivo');
  const calcular = () => { const rec=parseFloat(input.value)||0; vueltoEl.textContent=formatearMoneda(Math.max(0, rec-faltante)); };
  input.addEventListener('input', calcular); calcular();
  modal.querySelector('#btn-cancelar-efectivo').onclick=()=>modal.remove();
  modal.querySelector('.close-modal').onclick=()=>modal.remove();
  modal.querySelector('#btn-aceptar-efectivo').onclick=()=>{
    const rec=parseFloat(input.value)||0;
    if(rec<=0) return showNotification('Ingrese un monto válido','error');
    procesarPagoEfectivo(Math.min(rec,faltante), Math.max(0, rec-faltante)); modal.remove();
  };
}
async function procesarPagoEfectivo(monto,vuelto) {
  try {
    const err = validatePaymentData({ tipo:'efectivo', monto }); if(err) return showNotification(err,'error');
    estadoPagos.metodosPago.push({tipo:'efectivo', monto, timestamp:new Date().toISOString(), detalles:{vuelto}});
    estadoPagos.totalPagado+=monto; estadoPagos.vuelto=vuelto; estadoPagos.pagoVerificado=true;
    actualizarVisualizacionTotales();
    await registrarMovimiento('ingreso', monto, 'Pago en efectivo');
    mostrarResumenPago('efectivo', monto, {vuelto});
    logger.info('Pago en efectivo procesado',{monto,vuelto});
  } catch(e){ logger.error('Error procesando efectivo',{e}); showNotification('Error al procesar el pago','error'); }
}

/** Modal y procesamiento Tarjeta **/
function mostrarModalTarjeta() {
  const faltante=estadoPagos.total-estadoPagos.totalPagado; if(faltante<=0) return showNotification('Pago completo','info');
  const modal=document.createElement('div'); modal.className='modal-pago active'; modal.id='modal-pago-tarjeta';
  modal.innerHTML=`<div class='modal-content'>
    <div class='modal-header'><h3>Pago con Tarjeta</h3><button class='close-modal'>&times;</button></div>
    <div class='modal-body'>
      <div><label>Monto:</label><input type='number' id='monto-tarjeta' value='${faltante.toFixed(2)}'/></div>
      <div><label>Tipo:</label><select id='tipo-tarjeta'><option value='debito'>Débito</option><option value='credito'>Crédito</option></select></div>
      <div class='credito' style='display:none;'><label>Cuotas:</label><select id='cuotas-tarjeta'><option>1</option><option>3</option><option>6</option><option>12</option></select></div>
      <div><label>Terminal:</label><select id='terminal-tarjeta'><option value='manual'>Manual</option><option value='posnet'>POSNET</option><option value='getnet'>GetNet</option><option value='mercadopago'>Mercado Pago</option></select></div>
      <div id='grp-manual'><label>Últimos 4 dígitos:</label><input id='ultimos-digitos' maxlength='4'/></div>
    </div>
    <div class='modal-footer'><button id='btn-cancelar-tarjeta'>Cancelar</button><button id='btn-aceptar-tarjeta'>Aceptar Pago</button></div>
  </div>`;
  document.body.appendChild(modal);
  const tipo=modal.querySelector('#tipo-tarjeta'), cred=modal.querySelector('.credito'), term=modal.querySelector('#terminal-tarjeta'), grp=modal.querySelector('#grp-manual');
  tipo.addEventListener('change',()=>cred.style.display=tipo.value==='credito'?'block':'none');
  term.addEventListener('change',()=>grp.style.display=term.value==='manual'?'block':'none');
  modal.querySelector('#btn-cancelar-tarjeta').onclick=()=>modal.remove();
  modal.querySelector('.close-modal').onclick=()=>modal.remove();
  modal.querySelector('#btn-aceptar-tarjeta').onclick=()=>{
    const m=parseFloat(modal.querySelector('#monto-tarjeta').value)||0;
    if(m<=0||m>faltante) return showNotification('Monto inválido','error');
    const tp=tipo.value, ds=modal.querySelector('#ultimos-digitos').value, cuotas=tp==='credito'?parseInt(modal.querySelector('#cuotas-tarjeta').value):1;
    if(term.value==='manual'&&ds.length!==4) return showNotification('Dígitos inválidos','error');
    procesarPagoTarjeta(m,tp,term.value,ds,cuotas); modal.remove();
  };
}
async function procesarPagoTarjeta(monto,tipoTar,terminal,ultimosDigitos,cuotas){
  try{
    const err = validatePaymentData({ tipo:'tarjeta', monto }); if(err) return showNotification(err,'error');
    estadoPagos.metodosPago.push({ tipo:'tarjeta', monto, timestamp:new Date().toISOString(), detalles:{tipoTar,terminal,ultimosDigitos,cuotas}});
    estadoPagos.totalPagado+=monto; estadoPagos.pagoVerificado=true;
    actualizarVisualizacionTotales();
    await registrarMovimiento('ingreso_pendiente', monto, `Pago con tarjeta ${tipoTar}`);
    mostrarResumenPago('tarjeta', monto, {tipoTar,terminal,cuotas});
    logger.info('Pago con tarjeta procesado',{monto,tipoTar,cuotas});
  }catch(e){logger.error('Error pago tarjeta',{e});showNotification('Error al procesar el pago','error');}
}

/** Modal y procesamiento Transferencia **/
function mostrarModalTransferencia(){
  const faltante=estadoPagos.total-estadoPagos.totalPagado; if(faltante<=0) return showNotification('Pago completo','info');
  getSucursalConfig(estadoPagos.sucursalId).then(config=>{
    const modal=document.createElement('div'); modal.className='modal-pago active'; modal.id='modal-pago-transferencia';
    const opts=(config.bancos||[]).map(b=>`<option value='${b.id}'>${b.nombre}</option>`).join('');
    modal.innerHTML=`<div class='modal-content'>
      <div class='modal-header'><h3>Pago Transferencia</h3><button class='close-modal'>&times;</button></div>
      <div class='modal-body'>
        <div><label>Monto:</label><input id='monto-transferencia' value='${faltante.toFixed(2)}'/></div>
        <div><label>Banco:</label><select id='banco-transferencia'>${opts}<option value='otro'>Otro</option></select></div>
        <div><label>Comprobante:</label><input id='comprobante-transferencia'/></div>
        <div><p>CBU:${config.datosBancarios?.cbu||''}</p></div>
        <div><input type='checkbox' id='verificado-transferencia'/>Confirmo recepción</div>
      </div>
      <div class='modal-footer'><button id='btn-cancelar-transferencia'>Cancelar</button><button id='btn-aceptar-transferencia' disabled>Aceptar</button></div>
    </div>`;
    document.body.appendChild(modal);
    const check=modal.querySelector('#verificado-transferencia'), btn=modal.querySelector('#btn-aceptar-transferencia');
    check.onchange=()=>btn.disabled=!check.checked;
    modal.querySelector('#btn-cancelar-transferencia').onclick=()=>modal.remove();
    modal.querySelector('.close-modal').onclick=()=>modal.remove();
    btn.onclick=()=>{
      const m=parseFloat(modal.querySelector('#monto-transferencia').value)||0;
      const bancoId=modal.querySelector('#banco-transferencia').value;
      const comp=modal.querySelector('#comprobante-transferencia').value;
      if(m<=0||m>faltante) return showNotification('Monto inválido','error');
      if(!comp) return showNotification('Ingrese comprobante','error');
      procesarPagoTransferencia(m,bancoId,comp); modal.remove();
    };
  }).catch(err=>{logger.error('Config bancos',{err});showNotification('Error config bancos','error');});
}
async function procesarPagoTransferencia(monto,bancoId,comprobante){
  try{
    await registrarTransferencia({ monto, bancoId, comprobante, sucursalId:estadoPagos.sucursalId, clienteId:estadoPagos.clienteId });
    estadoPagos.metodosPago.push({tipo:'transferencia', monto, timestamp:new Date().toISOString(), detalles:{bancoId,comprobante}});
    estadoPagos.totalPagado+=monto; estadoPagos.pagoVerificado=true;
    actualizarVisualizacionTotales();
    await registrarMovimiento('ingreso_pendiente', monto, 'Pago por transferencia');
    mostrarResumenPago('transferencia', monto, {bancoId,comprobante});
    logger.info('Pago transferencia',{monto,bancoId,comprobante});
  }catch(e){logger.error('Error transferencia',{e});showNotification('Error al procesar','error');}
}

/** Modal y procesamiento QR **/
function mostrarModalQR(){
  const faltante=estadoPagos.total-estadoPagos.totalPagado; if(faltante<=0) return showNotification('Pago completo','info');
  const modal=document.createElement('div'); modal.className='modal-pago active'; modal.id='modal-pago-qr';
  modal.innerHTML=`<div class='modal-content'>
    <div class='modal-header'><h3>Pago con QR</h3><button class='close-modal'>&times;</button></div>
    <div class='modal-body'><div><strong>${formatearMoneda(faltante)}</strong></div><div id='qr-placeholder'>Generando QR...</div><div id='qr-image' style='display:none'></div>
      <div id='verificando-spinner' style='display:none'>Verificando...</div><div id='pago-verificado' style='display:none'>✔ Pago verificado</div></div>
    <div class='modal-footer'><button id='btn-cancelar-qr'>Cancelar</button><button id='btn-verificar-qr'>Verificar Pago</button><button id='btn-aceptar-qr' style='display:none'>Aceptar Pago</button></div>
  </div>`;
  document.body.appendChild(modal);
  const placeholder=modal.querySelector('#qr-placeholder'), img=modal.querySelector('#qr-image');
  generarQRMercadoPago(faltante, estadoPagos.clienteId).then(qr=>{
    placeholder.style.display='none'; img.style.display='block'; img.innerHTML=qr.qrHtml; modal.dataset.qrId=qr.qrId;
  }).catch(err=>{logger.error('Error QR',{err});placeholder.textContent='Error generando QR';});
  modal.querySelector('#btn-cancelar-qr').onclick=()=>modal.remove();
  modal.querySelector('.close-modal').onclick=()=>modal.remove();
  modal.querySelector('#btn-verificar-qr').onclick=()=>{
    const qrId=modal.dataset.qrId; if(!qrId) return showNotification('Error QR','error');
    modal.querySelector('#verificando-spinner').style.display='block';
    verificarPagoQR(qrId,faltante).then(res=>{
      modal.querySelector('#verificando-spinner').style.display='none';
      if(res.pagado){ modal.querySelector('#pago-verificado').style.display='block'; modal.querySelector('#btn-verificar-qr').style.display='none'; modal.querySelector('#btn-aceptar-qr').style.display='inline-block'; }
      else{ showNotification('Pago no detectado','warning'); }
    }).catch(err=>{logger.error('Error verif QR',{err}); showNotification('Error al verificar','error');});
  };
  modal.querySelector('#btn-aceptar-qr').onclick=()=>{ procesarPagoQR(faltante, modal.dataset.qrId); modal.remove(); };
}

/** Procesamiento QR **/
async function procesarPagoQR(monto, qrId){
  try{
    const err=validatePaymentData({tipo:'qr',monto}); if(err) return showNotification(err,'error');
    estadoPagos.metodosPago.push({tipo:'qr',monto,timestamp:new Date().toISOString(),detalles:{qrId}});
    estadoPagos.totalPagado+=monto; estadoPagos.pagoVerificado=true;
    actualizarVisualizacionTotales();
    await registrarMovimiento('ingreso_pendiente', monto, 'Pago QR Mercado Pago');
    mostrarResumenPago('QR', monto, {qrId});
    logger.info('Pago QR procesado',{monto,qrId});
  }catch(e){logger.error('Error procesar QR',{e});showNotification('Error al procesar el pago QR','error');}
}

// Registrar movimiento en caja
async function registrarMovimiento(tipo,monto,descripcion){
  const db=getDatabase(); const user=getUserInfo();
  await db.insert('caja',{tipo,monto,descripcion,fecha:new Date().toISOString(),sucursalId:estadoPagos.sucursalId,usuarioId:estadoPagos.usuarioId});
}

// Mostrar resumen al usuario
function mostrarResumenPago(metodo,monto,detalles){
  showNotification(`Pago ${metodo} de ${formatearMoneda(monto)} registrado`,'success');
}

// Formatear moneda
function formatearMoneda(value){
  return new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS'}).format(value);
}
