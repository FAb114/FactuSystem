/**
 * cierre.js - Módulo para gestionar el cierre de caja en FactuSystem
 * 
 * Este módulo maneja:
 * - Formulario de cierre
 * - Validación de datos ingresados
 * - Cálculo de diferencias con saldo teórico
 * - Registro en la base de datos
 * - Sincronización con el servidor central
 * - Auditoría
 */

const { ipcRenderer } = require('electron');
const database = require('../../utils/database.js');
const logger = require('../../utils/logger.js');
const auth = require('../../utils/auth.js');
const sync = require('../../utils/sync.js');
const notifications = require('../../components/notifications.js');
const format = require('../../utils/format.js');
const movimientos = require('./movimientos.js');

class CierreCaja {
    constructor() {
        this.currentUser = null;
        this.sucursalData = null;
        this.cajaActiva = null;
        this.montoRealInput = null;
        this.observacionesInput = null;
        this.modalElement = null;
        this.formElement = null;
        this.submitButton = null;
        this.cancelButton = null;
        this.resumen = {};
    }

    async inicializar(config = {}) {
        try {
            this.currentUser = await auth.getCurrentUser();
            this.sucursalData = await database.getSucursalActiva();

            const cajas = await database.query(`
                SELECT * FROM cajas 
                WHERE sucursal_id = ? AND estado = 'ACTIVA' 
                ORDER BY fecha_apertura DESC LIMIT 1
            `, [this.sucursalData.id]);

            if (!cajas.length) throw new Error('No hay caja activa para esta sucursal');

            this.cajaActiva = cajas[0];

            this.mostrarModal();
        } catch (error) {
            logger.error('Error al inicializar cierre de caja', { error: error.message });
            notifications.mostrar({
                tipo: 'error',
                titulo: 'Cierre de Caja',
                mensaje: error.message
            });
        }
    }

    async mostrarModal() {
        this.modalElement = document.getElementById('modal-cierre-caja');
        if (!this.modalElement) {
            this.modalElement = document.createElement('div');
            this.modalElement.id = 'modal-cierre-caja';
            this.modalElement.className = 'modal fade';
            document.body.appendChild(this.modalElement);
            this.modalElement.innerHTML = `
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">Cierre de Caja</h5>
                            <button type="button" class="close" id="btn-close-cierre">
                                <span>&times;</span>
                            </button>
                        </div>
                        <div class="modal-body">
                            <form id="form-cierre-caja">
                                <div id="resumen-cierre" class="mb-3"></div>
                                <div class="form-group">
                                    <label>Monto contado ($)</label>
                                    <input type="number" step="0.01" min="0" class="form-control" id="input-monto-real" required>
                                </div>
                                <div class="form-group">
                                    <label>Observaciones</label>
                                    <textarea class="form-control" id="input-observaciones-cierre" rows="2"></textarea>
                                </div>
                            </form>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" id="btn-cancelar-cierre">Cancelar</button>
                            <button type="submit" class="btn btn-primary" id="btn-confirmar-cierre">Confirmar Cierre</button>
                        </div>
                    </div>
                </div>
            `;
        }

        this.formElement = document.getElementById('form-cierre-caja');
        this.montoRealInput = document.getElementById('input-monto-real');
        this.observacionesInput = document.getElementById('input-observaciones-cierre');
        this.submitButton = document.getElementById('btn-confirmar-cierre');
        this.cancelButton = document.getElementById('btn-cancelar-cierre');

        this.cancelButton.onclick = () => $(this.modalElement).modal('hide');
        document.getElementById('btn-close-cierre').onclick = () => $(this.modalElement).modal('hide');
        this.submitButton.onclick = (e) => this.handleSubmit(e);

        await this.cargarResumen();
        $(this.modalElement).modal({ backdrop: 'static', keyboard: false });
    }

    async cargarResumen() {
        const totales = await movimientos.obtenerTotalesPorTipo(this.cajaActiva.id);
        const ingresos = totales.ingreso || 0;
        const ventas = totales.venta || 0;
        const egresos = totales.egreso || 0;
        const saldoTeorico = this.cajaActiva.monto_inicial + ingresos + ventas - egresos;

        this.resumen = { ingresos, ventas, egresos, saldoTeorico };

        const resumenHtml = `
            <p><strong>Inicial:</strong> $${this.cajaActiva.monto_inicial.toFixed(2)}</p>
            <p><strong>Ingresos:</strong> $${ingresos.toFixed(2)}</p>
            <p><strong>Ventas:</strong> $${ventas.toFixed(2)}</p>
            <p><strong>Egresos:</strong> $${egresos.toFixed(2)}</p>
            <p><strong>Saldo Teórico:</strong> $${saldoTeorico.toFixed(2)}</p>
        `;
        document.getElementById('resumen-cierre').innerHTML = resumenHtml;
        this.montoRealInput.value = saldoTeorico.toFixed(2);
    }

    async handleSubmit(e) {
        e.preventDefault();
        const montoReal = parseFloat(this.montoRealInput.value);
        if (isNaN(montoReal) || montoReal < 0) {
            notifications.mostrar({ tipo: 'warning', titulo: 'Monto inválido', mensaje: 'Debe ingresar un monto válido mayor o igual a 0' });
            return;
        }

        const diferencia = montoReal - this.resumen.saldoTeorico;
        const observaciones = this.observacionesInput.value || '';

        const update = {
            monto_final: montoReal,
            diferencia: diferencia,
            observaciones: observaciones,
            fecha_cierre: new Date().toISOString(),
            estado: 'CERRADA'
        };

        try {
            await database.update('cajas', update, { id: this.cajaActiva.id });

            await logger.audit('caja.cierre', {
                usuario: this.currentUser.nombre,
                sucursal: this.sucursalData.nombre,
                monto_final: montoReal,
                diferencia,
                fecha: update.fecha_cierre
            });

            const isOnline = await sync.isOnline();
            if (isOnline) {
                sync.pushData('cajas', this.cajaActiva.id);
            }

            ipcRenderer.send('caja:actualizar-estado', { activa: false });
            notifications.mostrar({ tipo: 'success', titulo: 'Caja cerrada', mensaje: 'Cierre registrado correctamente' });
            $(this.modalElement).modal('hide');
        } catch (error) {
            logger.error('Error al registrar cierre de caja', { error: error.message });
            notifications.mostrar({ tipo: 'error', titulo: 'Error al cerrar caja', mensaje: error.message });
        }
    }
}

// Exportamos una instancia lista para usarse
const cierreCaja = new CierreCaja();
module.exports = cierreCaja;
module.exports.CierreCaja = CierreCaja;
