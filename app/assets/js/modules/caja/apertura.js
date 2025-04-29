/**
 * apertura.js - Módulo para gestionar la apertura de caja en FactuSystem
 * 
 * Este módulo maneja:
 * - Formulario de apertura de caja
 * - Validación de datos ingresados
 * - Registro en la base de datos
 * - Sincronización con el servidor central
 * - Registro de auditoría
 */

// Importamos dependencias necesarias
const { ipcRenderer } = require('electron');
const database = require('../../utils/database.js');
const auth = require('../../utils/auth.js');
const validation = require('../../utils/validation.js');
const sync = require('../../utils/sync.js');
const logger = require('../../utils/logger.js');
const notifications = require('../../components/notifications.js');

// Clase principal para la gestión de apertura de caja
class AperturaCaja {
    constructor() {
        this.currentUser = null;
        this.sucursalData = null;
        this.cajaElement = null;
        this.montoInicialInput = null;
        this.observacionesInput = null;
        this.fechaInput = null;
        this.horaInput = null;
        this.submitButton = null;
        this.cancelButton = null;
        this.formElement = null;
        
        // Estado interno
        this.isSubmitting = false;
        this.cajaActiva = false;
        
        // Bind de métodos
        this.inicializar = this.inicializar.bind(this);
        this.cargarDatos = this.cargarDatos.bind(this);
        this.verificarCajaActiva = this.verificarCajaActiva.bind(this);
        this.handleSubmit = this.handleSubmit.bind(this);
        this.validarFormulario = this.validarFormulario.bind(this);
        this.registrarApertura = this.registrarApertura.bind(this);
        this.renderizarFormulario = this.renderizarFormulario.bind(this);
        this.mostrarModal = this.mostrarModal.bind(this);
        this.cerrarModal = this.cerrarModal.bind(this);
        this.actualizarUI = this.actualizarUI.bind(this);
    }

    /**
     * Inicializa el módulo de apertura de caja
     * @param {Object} config - Configuración inicial opcional
     */
    async inicializar(config = {}) {
        try {
            console.log('Inicializando módulo de apertura de caja...');
            
            // Obtenemos información del usuario actual
            this.currentUser = await auth.getCurrentUser();
            if (!this.currentUser) {
                throw new Error('Usuario no autenticado');
            }
            
            // Verificamos permisos para operar caja
            const tienePermiso = await auth.verificarPermiso('caja.apertura');
            if (!tienePermiso) {
                throw new Error('No tiene permisos para realizar apertura de caja');
            }
            
            // Obtenemos datos de la sucursal
            this.sucursalData = await database.getSucursalActiva();
            
            // Verificamos si ya hay una caja abierta para esta sucursal
            this.cajaActiva = await this.verificarCajaActiva();
            
            // Si hay configuración de elementos UI los asignamos, sino buscamos en el DOM
            if (config.elements) {
                this.asignarElementos(config.elements);
            } else {
                this.buscarElementosDOM();
            }
            
            // Registramos eventos
            this.registrarEventos();
            
            // Si estamos en modo modal de inicio, mostramos el formulario
            if (config.mostrarModalInicio === true) {
                this.mostrarModal();
            }
            
            // Si la caja ya está activa, actualizamos la UI
            if (this.cajaActiva) {
                this.actualizarUI();
            }
            
            logger.info('Módulo de apertura de caja inicializado correctamente');
            return true;
        } catch (error) {
            logger.error('Error al inicializar módulo de apertura de caja', { error: error.message });
            notifications.mostrar({
                tipo: 'error',
                titulo: 'Error en módulo de caja',
                mensaje: `No se pudo inicializar: ${error.message}`
            });
            return false;
        }
    }
    
    /**
     * Asigna los elementos UI pasados por configuración
     * @param {Object} elements - Elementos del DOM
     */
    asignarElementos(elements) {
        this.cajaElement = elements.cajaElement || null;
        this.montoInicialInput = elements.montoInicialInput || null;
        this.observacionesInput = elements.observacionesInput || null;
        this.fechaInput = elements.fechaInput || null;
        this.horaInput = elements.horaInput || null;
        this.submitButton = elements.submitButton || null;
        this.cancelButton = elements.cancelButton || null;
        this.formElement = elements.formElement || null;
    }
    
    /**
     * Busca los elementos necesarios en el DOM
     */
    buscarElementosDOM() {
        this.cajaElement = document.getElementById('caja-container');
        this.formElement = document.getElementById('form-apertura-caja');
        this.montoInicialInput = document.getElementById('monto-inicial');
        this.observacionesInput = document.getElementById('observaciones-apertura');
        this.fechaInput = document.getElementById('fecha-apertura');
        this.horaInput = document.getElementById('hora-apertura');
        this.submitButton = document.getElementById('btn-confirmar-apertura');
        this.cancelButton = document.getElementById('btn-cancelar-apertura');
    }
    
    /**
     * Registra los eventos necesarios
     */
    registrarEventos() {
        if (this.formElement) {
            this.formElement.addEventListener('submit', this.handleSubmit);
        }
        
        if (this.montoInicialInput) {
            // Validamos que solo se ingresen números y punto decimal
            this.montoInicialInput.addEventListener('input', (e) => {
                const valor = e.target.value;
                if (!/^\d*\.?\d*$/.test(valor)) {
                    e.target.value = valor.replace(/[^\d.]/g, '');
                }
            });
        }
        
        if (this.cancelButton) {
            this.cancelButton.addEventListener('click', this.cerrarModal);
        }
        
        // Escuchamos eventos de IPC para sincronización de caja
        ipcRenderer.on('caja:estado-actualizado', (_, data) => {
            this.actualizarEstadoCaja(data);
        });
    }
    
    /**
     * Carga los datos iniciales en el formulario
     */
    cargarDatos() {
        const ahora = new Date();
        
        // Formato de fecha YYYY-MM-DD
        const fecha = ahora.toISOString().split('T')[0];
        
        // Formato de hora HH:MM
        const hora = ahora.toTimeString().slice(0, 5);
        
        if (this.fechaInput) {
            this.fechaInput.value = fecha;
        }
        
        if (this.horaInput) {
            this.horaInput.value = hora;
        }
        
        // Establecemos foco en el monto inicial
        if (this.montoInicialInput) {
            this.montoInicialInput.focus();
        }
    }
    
    /**
     * Verifica si ya existe una caja activa para la sucursal actual
     * @returns {Promise<boolean>} - Verdadero si hay caja activa
     */
    async verificarCajaActiva() {
        try {
            const sucursalId = this.sucursalData.id;
            
            // Consultamos a la base de datos
            const cajasActivas = await database.query(
                'SELECT * FROM cajas WHERE sucursal_id = ? AND estado = ? AND fecha_cierre IS NULL',
                [sucursalId, 'ACTIVA']
            );
            
            return cajasActivas && cajasActivas.length > 0;
        } catch (error) {
            logger.error('Error al verificar caja activa', { error: error.message });
            return false;
        }
    }
    
    /**
     * Muestra el modal de apertura de caja
     */
    mostrarModal() {
        // Si no tenemos un elemento contenedor, lo creamos
        if (!this.cajaElement) {
            this.cajaElement = document.createElement('div');
            this.cajaElement.id = 'modal-apertura-caja';
            this.cajaElement.className = 'modal fade';
            document.body.appendChild(this.cajaElement);
            
            // Creamos el contenido HTML del modal
            this.cajaElement.innerHTML = `
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">Apertura de Caja</h5>
                            <button type="button" class="close" id="btn-close-apertura">
                                <span aria-hidden="true">&times;</span>
                            </button>
                        </div>
                        <div class="modal-body">
                            <form id="form-apertura-caja">
                                <div class="form-group">
                                    <label for="fecha-apertura">Fecha:</label>
                                    <input type="date" class="form-control" id="fecha-apertura" readonly>
                                </div>
                                <div class="form-group">
                                    <label for="hora-apertura">Hora:</label>
                                    <input type="time" class="form-control" id="hora-apertura" readonly>
                                </div>
                                <div class="form-group">
                                    <label for="usuario-apertura">Usuario:</label>
                                    <input type="text" class="form-control" id="usuario-apertura" 
                                        value="${this.currentUser ? this.currentUser.nombre : ''}" readonly>
                                </div>
                                <div class="form-group">
                                    <label for="sucursal-apertura">Sucursal:</label>
                                    <input type="text" class="form-control" id="sucursal-apertura" 
                                        value="${this.sucursalData ? this.sucursalData.nombre : ''}" readonly>
                                </div>
                                <div class="form-group">
                                    <label for="monto-inicial">Monto Inicial ($):</label>
                                    <input type="number" step="0.01" min="0" class="form-control" 
                                        id="monto-inicial" placeholder="0.00" required>
                                </div>
                                <div class="form-group">
                                    <label for="observaciones-apertura">Observaciones:</label>
                                    <textarea class="form-control" id="observaciones-apertura" 
                                        rows="2" placeholder="Observaciones (opcional)"></textarea>
                                </div>
                            </form>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" id="btn-cancelar-apertura">Cancelar</button>
                            <button type="button" class="btn btn-primary" id="btn-confirmar-apertura">Confirmar Apertura</button>
                        </div>
                    </div>
                </div>
            `;
            
            // Buscamos los nuevos elementos del DOM
            this.buscarElementosDOM();
            
            // Registramos eventos
            this.registrarEventos();
            
            // Añadimos evento al nuevo botón de cerrar
            const closeButton = document.getElementById('btn-close-apertura');
            if (closeButton) {
                closeButton.addEventListener('click', this.cerrarModal);
            }
        }
        
        // Cargamos los datos iniciales
        this.cargarDatos();
        
        // Mostramos el modal usando Bootstrap
        $(this.cajaElement).modal({
            backdrop: 'static',
            keyboard: false
        });
    }
    
    /**
     * Cierra el modal de apertura de caja
     */
    cerrarModal() {
        $(this.cajaElement).modal('hide');
        
        // Emitimos evento de cancelación
        const event = new CustomEvent('caja:apertura-cancelada');
        document.dispatchEvent(event);
    }
    
    /**
     * Maneja el envío del formulario de apertura
     * @param {Event} e - Evento de submit
     */
    async handleSubmit(e) {
        if (e) e.preventDefault();
        
        try {
            // Evitamos múltiples envíos
            if (this.isSubmitting) return;
            this.isSubmitting = true;
            
            if (this.submitButton) {
                this.submitButton.disabled = true;
                this.submitButton.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Procesando...';
            }
            
            // Validamos el formulario
            const esValido = this.validarFormulario();
            if (!esValido) {
                this.isSubmitting = false;
                if (this.submitButton) {
                    this.submitButton.disabled = false;
                    this.submitButton.textContent = 'Confirmar Apertura';
                }
                return;
            }
            
            // Si todo está bien, registramos la apertura
            const resultado = await this.registrarApertura();
            
            if (resultado) {
                // Actualizamos el estado global
                this.cajaActiva = true;
                
                // Cerramos el modal
                $(this.cajaElement).modal('hide');
                
                // Mostramos confirmación
                notifications.mostrar({
                    tipo: 'success',
                    titulo: 'Caja abierta',
                    mensaje: 'La caja ha sido abierta correctamente'
                });
                
                // Emitimos evento de apertura exitosa
                const event = new CustomEvent('caja:apertura-exitosa', { detail: resultado });
                document.dispatchEvent(event);
            } else {
                notifications.mostrar({
                    tipo: 'error',
                    titulo: 'Error',
                    mensaje: 'No se pudo completar la apertura de caja'
                });
            }
        } catch (error) {
            logger.error('Error al procesar apertura de caja', { error: error.message });
            notifications.mostrar({
                tipo: 'error',
                titulo: 'Error',
                mensaje: `Error al abrir caja: ${error.message}`
            });
        } finally {
            this.isSubmitting = false;
            if (this.submitButton) {
                this.submitButton.disabled = false;
                this.submitButton.textContent = 'Confirmar Apertura';
            }
        }
    }
    
    /**
     * Valida los datos del formulario de apertura
     * @returns {boolean} - Verdadero si los datos son válidos
     */
    validarFormulario() {
        try {
            // Validamos monto inicial
            if (!this.montoInicialInput || !this.montoInicialInput.value) {
                notifications.mostrar({
                    tipo: 'warning',
                    titulo: 'Campo requerido',
                    mensaje: 'Debe ingresar el monto inicial de caja'
                });
                this.montoInicialInput?.focus();
                return false;
            }
            
            const montoInicial = parseFloat(this.montoInicialInput.value);
            
            if (isNaN(montoInicial) || montoInicial < 0) {
                notifications.mostrar({
                    tipo: 'warning',
                    titulo: 'Valor inválido',
                    mensaje: 'El monto inicial debe ser un número positivo'
                });
                this.montoInicialInput?.focus();
                return false;
            }
            
            // Validamos que no haya una caja activa ya
            if (this.cajaActiva) {
                notifications.mostrar({
                    tipo: 'warning',
                    titulo: 'Caja ya activa',
                    mensaje: 'Ya existe una caja abierta para esta sucursal'
                });
                return false;
            }
            
            return true;
        } catch (error) {
            logger.error('Error en validación de formulario', { error: error.message });
            return false;
        }
    }
    
    /**
     * Registra la apertura de caja en la base de datos
     * @returns {Promise<Object|boolean>} - Datos de la apertura o falso si falló
     */
    async registrarApertura() {
        try {
            // Obtenemos los datos del formulario
            const montoInicial = parseFloat(this.montoInicialInput.value);
            const observaciones = this.observacionesInput?.value || '';
            
            // Creamos el objeto de apertura
            const apertura = {
                sucursal_id: this.sucursalData.id,
                usuario_id: this.currentUser.id,
                fecha_apertura: new Date().toISOString(),
                monto_inicial: montoInicial,
                observaciones: observaciones,
                estado: 'ACTIVA',
                fecha_cierre: null,
                monto_final: null,
                diferencia: null
            };
            
            // Guardamos en la base de datos
            const resultado = await database.insert('cajas', apertura);
            
            if (!resultado || !resultado.id) {
                throw new Error('No se pudo registrar la apertura en la base de datos');
            }
            
            // Registramos en el log de auditoría
            await logger.audit('caja.apertura', {
                usuario: this.currentUser.nombre,
                sucursal: this.sucursalData.nombre,
                monto_inicial: montoInicial,
                fecha: apertura.fecha_apertura
            });
            
            // Sincronizamos con el servidor si estamos online
            const isOnline = await sync.isOnline();
            if (isOnline) {
                sync.pushData('cajas', resultado.id).catch(error => {
                    logger.error('Error al sincronizar apertura de caja', { error: error.message });
                });
            }
            
            // Enviamos los datos para actualizar la interfaz
            ipcRenderer.send('caja:actualizar-estado', {
                activa: true,
                id: resultado.id,
                monto_inicial: montoInicial,
                fecha_apertura: apertura.fecha_apertura
            });
            
            return { ...apertura, id: resultado.id };
        } catch (error) {
            logger.error('Error al registrar apertura de caja', { error: error.message });
            return false;
        }
    }
    
    /**
     * Actualiza el estado de la caja cuando se recibe notificación
     * @param {Object} data - Datos actualizados de la caja
     */
    actualizarEstadoCaja(data) {
        if (data) {
            this.cajaActiva = data.activa || false;
            this.actualizarUI();
        }
    }
    
    /**
     * Actualiza la interfaz de usuario según el estado de la caja
     */
    actualizarUI() {
        // Si hay un elemento específico para mostrar el estado, lo actualizamos
        const statusElement = document.getElementById('estado-caja');
        if (statusElement) {
            statusElement.textContent = this.cajaActiva ? 'Caja Abierta' : 'Caja Cerrada';
            statusElement.className = this.cajaActiva ? 'badge badge-success' : 'badge badge-danger';
        }
        
        // Actualizamos botones u otros elementos según el estado
        const btnApertura = document.getElementById('btn-abrir-caja');
        const btnCierre = document.getElementById('btn-cerrar-caja');
        
        if (btnApertura) {
            btnApertura.disabled = this.cajaActiva;
        }
        
        if (btnCierre) {
            btnCierre.disabled = !this.cajaActiva;
        }
    }
    
    /**
     * Reinicia el formulario a sus valores iniciales
     */
    reiniciarFormulario() {
        if (this.formElement) {
            this.formElement.reset();
        }
        
        if (this.montoInicialInput) {
            this.montoInicialInput.value = '0.00';
        }
        
        if (this.observacionesInput) {
            this.observacionesInput.value = '';
        }
        
        // Recargamos fecha y hora actuales
        this.cargarDatos();
    }
}

// Exportamos una instancia del manejador de apertura de caja
const aperturaCaja = new AperturaCaja();
module.exports = aperturaCaja;

// Si se necesita acceder a la clase para crear instancias personalizadas
module.exports.AperturaCaja = AperturaCaja;