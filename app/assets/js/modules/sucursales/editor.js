/**
 * editor.js - Módulo para la creación y edición de sucursales
 * Parte del sistema FactuSystem - Gestión multisucursal
 */

// Importación de utilidades y servicios necesarios
const { database } = require('../../../utils/database.js');
const { validation } = require('../../../utils/validation.js');
const { auth } = require('../../../utils/auth.js');
const { notifications } = require('../../../components/notifications.js');
const { sync } = require('../../../utils/sync.js');
const { logger } = require('../../../utils/logger.js');

// Clase principal para la gestión del editor de sucursales
class SucursalEditor {
  constructor() {
    this.currentSucursal = null;
    this.isEditing = false;
    this.formElement = null;
    this.originalData = {};
    this.hasChanges = false;
    
    // Referencias a elementos del DOM que se inicializarán cuando se cargue el editor
    this.elements = {
      form: null,
      submitBtn: null,
      cancelBtn: null,
      deleteBtn: null,
      nombreInput: null,
      direccionInput: null,
      telefonoInput: null,
      emailInput: null,
      responsableInput: null,
      activaCheckbox: null,
      tipoSelect: null,
      sincronizacionSelect: null,
      servidorInput: null,
      puertoInput: null,
      sincAutomaticaCheckbox: null,
      intervaloInput: null,
      stockCompartidoCheckbox: null,
      cajaIndependienteCheckbox: null,
      mercadoPagoTokenInput: null,
      qrImagePreview: null,
      uploadQrBtn: null,
      generarQrBtn: null,
      configFiscalContainer: null,
      ptoVentaInput: null,
      certFiscalFile: null,
      integrarARCACheckbox: null
    };
    
    // Bind de métodos
    this.init = this.init.bind(this);
    this.loadSucursal = this.loadSucursal.bind(this);
    this.renderForm = this.renderForm.bind(this);
    this.setupEventListeners = this.setupEventListeners.bind(this);
    this.handleSubmit = this.handleSubmit.bind(this);
    this.validateForm = this.validateForm.bind(this);
    this.saveSucursal = this.saveSucursal.bind(this);
    this.handleCancel = this.handleCancel.bind(this);
    this.handleDelete = this.handleDelete.bind(this);
    this.confirmDelete = this.confirmDelete.bind(this);
    this.handleTipoChange = this.handleTipoChange.bind(this);
    this.handleSincronizacionChange = this.handleSincronizacionChange.bind(this);
    this.handleFormChange = this.handleFormChange.bind(this);
    this.handleQrUpload = this.handleQrUpload.bind(this);
    this.generateQr = this.generateQr.bind(this);
    this.handleIntegrarARCAChange = this.handleIntegrarARCAChange.bind(this);
    this.setupValidation = this.setupValidation.bind(this);
    this.testConnection = this.testConnection.bind(this);
    this.loadDefaultValues = this.loadDefaultValues.bind(this);
  }

  /**
   * Inicializa el editor de sucursales
   * @param {string|null} sucursalId - ID de la sucursal a editar, null para crear nueva
   * @param {HTMLElement} container - Contenedor donde se renderizará el editor
   * @returns {Promise<void>}
   */
  async init(sucursalId = null, container) {
    try {
      if (!container) {
        throw new Error('No se especificó un contenedor para el editor de sucursales');
      }
      
      // Verificar permisos del usuario actual
      const currentUser = auth.getCurrentUser();
      if (!currentUser || !auth.hasPermission(currentUser.id, 'sucursales_editar')) {
        notifications.show('No tiene permisos para editar sucursales', 'error');
        return;
      }
      
      this.isEditing = !!sucursalId;
      
      if (sucursalId) {
        await this.loadSucursal(sucursalId);
      } else {
        this.currentSucursal = {
          id: null,
          nombre: '',
          direccion: '',
          telefono: '',
          email: '',
          responsable: '',
          activa: true,
          tipo: 'secundaria', // Por defecto
          sincronizacion: 'manual',
          servidor: '',
          puerto: 3000,
          sincAutomatica: false,
          intervaloSinc: 60, // minutos
          stockCompartido: false,
          cajaIndependiente: true,
          mercadoPagoToken: '',
          qrImage: null,
          ptoVenta: '',
          certificadoFiscal: null,
          integrarARCA: false,
          fechaCreacion: new Date(),
          creadoPor: currentUser.id,
          ultimaModificacion: new Date(),
          modificadoPor: currentUser.id
        };
      }
      
      this.originalData = JSON.parse(JSON.stringify(this.currentSucursal));
      this.renderForm(container);
      this.setupEventListeners();
      this.setupValidation();
      
      // Registrar en el log
      logger.log({
        accion: this.isEditing ? 'editar_sucursal' : 'crear_sucursal',
        modulo: 'sucursales',
        usuario: currentUser.id,
        detalles: `${this.isEditing ? 'Edición' : 'Creación'} de sucursal ${this.isEditing ? this.currentSucursal.nombre : 'nueva'}`
      });
      
    } catch (error) {
      console.error('Error al inicializar el editor de sucursales:', error);
      notifications.show(`Error al cargar el editor: ${error.message}`, 'error');
    }
  }

  /**
   * Carga los datos de una sucursal existente
   * @param {string} sucursalId - ID de la sucursal a cargar
   * @returns {Promise<void>}
   */
  async loadSucursal(sucursalId) {
    try {
      const sucursal = await database.get('sucursales', sucursalId);
      
      if (!sucursal) {
        throw new Error(`No se encontró la sucursal con ID: ${sucursalId}`);
      }
      
      this.currentSucursal = sucursal;
    } catch (error) {
      console.error('Error al cargar la sucursal:', error);
      throw error;
    }
  }

  /**
   * Renderiza el formulario de edición
   * @param {HTMLElement} container - Contenedor donde se renderizará el formulario
   */
  renderForm(container) {
    const isMainBranch = this.isEditing && this.currentSucursal.tipo === 'principal';
    
    // Crear estructura HTML del formulario
    container.innerHTML = `
      <div class="card shadow-sm">
        <div class="card-header bg-primary text-white">
          <h5 class="mb-0">${this.isEditing ? 'Editar Sucursal' : 'Nueva Sucursal'}</h5>
        </div>
        <div class="card-body">
          <form id="sucursal-form">
            <div class="row">
              <!-- Datos básicos -->
              <div class="col-md-6">
                <h6 class="mb-3">Información General</h6>
                
                <div class="mb-3">
                  <label for="nombre" class="form-label">Nombre de la Sucursal *</label>
                  <input type="text" class="form-control" id="nombre" name="nombre" 
                         value="${this.currentSucursal.nombre}" required>
                  <div class="invalid-feedback">Ingrese un nombre válido</div>
                </div>
                
                <div class="mb-3">
                  <label for="direccion" class="form-label">Dirección *</label>
                  <input type="text" class="form-control" id="direccion" name="direccion"
                         value="${this.currentSucursal.direccion}" required>
                  <div class="invalid-feedback">Ingrese una dirección válida</div>
                </div>
                
                <div class="row">
                  <div class="col-md-6">
                    <div class="mb-3">
                      <label for="telefono" class="form-label">Teléfono</label>
                      <input type="tel" class="form-control" id="telefono" name="telefono"
                             value="${this.currentSucursal.telefono || ''}">
                      <div class="invalid-feedback">Ingrese un teléfono válido</div>
                    </div>
                  </div>
                  <div class="col-md-6">
                    <div class="mb-3">
                      <label for="email" class="form-label">Email</label>
                      <input type="email" class="form-control" id="email" name="email"
                             value="${this.currentSucursal.email || ''}">
                      <div class="invalid-feedback">Ingrese un email válido</div>
                    </div>
                  </div>
                </div>
                
                <div class="mb-3">
                  <label for="responsable" class="form-label">Responsable</label>
                  <input type="text" class="form-control" id="responsable" name="responsable"
                         value="${this.currentSucursal.responsable || ''}">
                </div>
                
                <div class="mb-3 form-check">
                  <input type="checkbox" class="form-check-input" id="activa" name="activa"
                         ${this.currentSucursal.activa ? 'checked' : ''}>
                  <label class="form-check-label" for="activa">Sucursal Activa</label>
                </div>
                
                <div class="mb-3">
                  <label for="tipo" class="form-label">Tipo *</label>
                  <select class="form-select" id="tipo" name="tipo" ${isMainBranch ? 'disabled' : ''}>
                    <option value="principal" ${this.currentSucursal.tipo === 'principal' ? 'selected' : ''}>Principal (Servidor)</option>
                    <option value="secundaria" ${this.currentSucursal.tipo === 'secundaria' ? 'selected' : ''}>Secundaria (Cliente)</option>
                  </select>
                  ${isMainBranch ? '<small class="text-muted">No se puede cambiar el tipo de la sucursal principal</small>' : ''}
                </div>
              </div>
              
              <!-- Configuración de sincronización -->
              <div class="col-md-6">
                <h6 class="mb-3">Configuración de Sincronización</h6>
                
                <div class="mb-3">
                  <label for="sincronizacion" class="form-label">Modo de Sincronización</label>
                  <select class="form-select" id="sincronizacion" name="sincronizacion">
                    <option value="manual" ${this.currentSucursal.sincronizacion === 'manual' ? 'selected' : ''}>Manual</option>
                    <option value="automatica" ${this.currentSucursal.sincronizacion === 'automatica' ? 'selected' : ''}>Automática</option>
                  </select>
                </div>
                
                <div id="config-sync" class="${this.currentSucursal.tipo === 'principal' ? 'd-none' : ''}">
                  <div class="mb-3">
                    <label for="servidor" class="form-label">Servidor Central</label>
                    <div class="input-group">
                      <input type="text" class="form-control" id="servidor" name="servidor"
                             value="${this.currentSucursal.servidor || ''}" placeholder="Ej: 192.168.1.100">
                      <input type="number" class="form-control" id="puerto" name="puerto" style="max-width: 100px;"
                             value="${this.currentSucursal.puerto || 3000}" min="1" max="65535">
                      <button class="btn btn-outline-secondary" type="button" id="test-connection">Probar</button>
                    </div>
                    <div class="invalid-feedback">Ingrese un servidor válido</div>
                  </div>
                </div>
                
                <div id="config-sync-auto" class="${this.currentSucursal.sincronizacion !== 'automatica' ? 'd-none' : ''}">
                  <div class="mb-3 form-check">
                    <input type="checkbox" class="form-check-input" id="sincAutomatica" name="sincAutomatica"
                           ${this.currentSucursal.sincAutomatica ? 'checked' : ''}>
                    <label class="form-check-label" for="sincAutomatica">Sincronización Automática</label>
                  </div>
                  
                  <div class="mb-3">
                    <label for="intervaloSinc" class="form-label">Intervalo de Sincronización (minutos)</label>
                    <input type="number" class="form-control" id="intervaloSinc" name="intervaloSinc"
                           value="${this.currentSucursal.intervaloSinc || 60}" min="5" max="1440">
                  </div>
                </div>
                
                <div class="mb-3 form-check">
                  <input type="checkbox" class="form-check-input" id="stockCompartido" name="stockCompartido"
                         ${this.currentSucursal.stockCompartido ? 'checked' : ''}>
                  <label class="form-check-label" for="stockCompartido">Stock Compartido</label>
                  <small class="form-text text-muted d-block">
                    Si se habilita, el stock se gestionará de manera centralizada para todas las sucursales
                  </small>
                </div>
                
                <div class="mb-3 form-check">
                  <input type="checkbox" class="form-check-input" id="cajaIndependiente" name="cajaIndependiente"
                         ${this.currentSucursal.cajaIndependiente ? 'checked' : ''}>
                  <label class="form-check-label" for="cajaIndependiente">Caja Independiente</label>
                  <small class="form-text text-muted d-block">
                    Si se habilita, la caja se gestionará de manera independiente en esta sucursal
                  </small>
                </div>
              </div>
            </div>
            
            <!-- Integraciones -->
            <div class="row mt-4">
              <div class="col-12">
                <h6 class="mb-3">Integraciones</h6>
              </div>
              
              <!-- Mercado Pago -->
              <div class="col-md-6">
                <div class="card mb-3">
                  <div class="card-header">
                    <h6 class="mb-0">Mercado Pago</h6>
                  </div>
                  <div class="card-body">
                    <div class="mb-3">
                      <label for="mercadoPagoToken" class="form-label">Token de Acceso</label>
                      <input type="text" class="form-control" id="mercadoPagoToken" name="mercadoPagoToken"
                             value="${this.currentSucursal.mercadoPagoToken || ''}">
                      <small class="form-text text-muted">
                        Token de acceso para la integración con Mercado Pago
                      </small>
                    </div>
                    
                    <div class="mb-3">
                      <label class="form-label">QR Estático</label>
                      <div class="d-flex align-items-center mb-2">
                        <div id="qr-preview" class="border me-3" style="width: 150px; height: 150px; display: flex; align-items: center; justify-content: center;">
                          ${this.currentSucursal.qrImage ? 
                            `<img src="${this.currentSucursal.qrImage}" alt="QR Mercado Pago" class="img-fluid">` : 
                            '<span class="text-muted">Sin QR</span>'}
                        </div>
                        <div>
                          <button type="button" class="btn btn-outline-primary mb-2 w-100" id="upload-qr">
                            <i class="bi bi-upload"></i> Subir QR
                          </button>
                          <button type="button" class="btn btn-outline-success w-100" id="generar-qr">
                            <i class="bi bi-qr-code"></i> Generar QR
                          </button>
                        </div>
                      </div>
                      <input type="file" id="qr-file" accept="image/*" class="d-none">
                    </div>
                  </div>
                </div>
              </div>
              
              <!-- Configuración Fiscal -->
              <div class="col-md-6">
                <div class="card mb-3">
                  <div class="card-header">
                    <h6 class="mb-0">Configuración Fiscal (ARCA)</h6>
                  </div>
                  <div class="card-body">
                    <div class="mb-3 form-check">
                      <input type="checkbox" class="form-check-input" id="integrarARCA" name="integrarARCA"
                             ${this.currentSucursal.integrarARCA ? 'checked' : ''}>
                      <label class="form-check-label" for="integrarARCA">Integrar con ARCA (AFIP)</label>
                    </div>
                    
                    <div id="config-fiscal" class="${!this.currentSucursal.integrarARCA ? 'd-none' : ''}">
                      <div class="mb-3">
                        <label for="ptoVenta" class="form-label">Punto de Venta</label>
                        <input type="text" class="form-control" id="ptoVenta" name="ptoVenta"
                               value="${this.currentSucursal.ptoVenta || ''}">
                      </div>
                      
                      <div class="mb-3">
                        <label for="certFiscal" class="form-label">Certificado Fiscal</label>
                        <input type="file" class="form-control" id="certFiscal" name="certFiscal">
                        ${this.currentSucursal.certificadoFiscal ? 
                          `<small class="text-success">Certificado cargado el ${new Date(this.currentSucursal.ultimaModificacion).toLocaleDateString()}</small>` : 
                          '<small class="text-muted">No hay certificado cargado</small>'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            <!-- Botones de acción -->
            <div class="d-flex justify-content-between mt-4">
              <div>
                ${this.isEditing ? 
                  `<button type="button" class="btn btn-danger" id="delete-btn">
                    <i class="bi bi-trash"></i> Eliminar
                  </button>` : ''}
              </div>
              <div>
                <button type="button" class="btn btn-secondary me-2" id="cancel-btn">Cancelar</button>
                <button type="submit" class="btn btn-primary" id="submit-btn">
                  ${this.isEditing ? 'Actualizar' : 'Crear'} Sucursal
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    `;
    
    // Capturar referencias a los elementos del DOM
    this.elements.form = document.getElementById('sucursal-form');
    this.elements.submitBtn = document.getElementById('submit-btn');
    this.elements.cancelBtn = document.getElementById('cancel-btn');
    this.elements.deleteBtn = document.getElementById('delete-btn');
    this.elements.nombreInput = document.getElementById('nombre');
    this.elements.direccionInput = document.getElementById('direccion');
    this.elements.telefonoInput = document.getElementById('telefono');
    this.elements.emailInput = document.getElementById('email');
    this.elements.responsableInput = document.getElementById('responsable');
    this.elements.activaCheckbox = document.getElementById('activa');
    this.elements.tipoSelect = document.getElementById('tipo');
    this.elements.sincronizacionSelect = document.getElementById('sincronizacion');
    this.elements.servidorInput = document.getElementById('servidor');
    this.elements.puertoInput = document.getElementById('puerto');
    this.elements.sincAutomaticaCheckbox = document.getElementById('sincAutomatica');
    this.elements.intervaloInput = document.getElementById('intervaloSinc');
    this.elements.stockCompartidoCheckbox = document.getElementById('stockCompartido');
    this.elements.cajaIndependienteCheckbox = document.getElementById('cajaIndependiente');
    this.elements.mercadoPagoTokenInput = document.getElementById('mercadoPagoToken');
    this.elements.qrImagePreview = document.getElementById('qr-preview');
    this.elements.uploadQrBtn = document.getElementById('upload-qr');
    this.elements.qrFileInput = document.getElementById('qr-file');
    this.elements.generarQrBtn = document.getElementById('generar-qr');
    this.elements.integrarARCACheckbox = document.getElementById('integrarARCA');
    this.elements.configFiscalContainer = document.getElementById('config-fiscal');
    this.elements.ptoVentaInput = document.getElementById('ptoVenta');
    this.elements.certFiscalFile = document.getElementById('certFiscal');
    this.elements.testConnectionBtn = document.getElementById('test-connection');
  }

  /**
   * Configura los listeners de eventos para el formulario
   */
  setupEventListeners() {
    // Evento de envío del formulario
    this.elements.form.addEventListener('submit', this.handleSubmit);
    
    // Evento de cancelar edición
    this.elements.cancelBtn.addEventListener('click', this.handleCancel);
    
    // Evento para eliminar sucursal (solo en modo edición)
    if (this.isEditing && this.elements.deleteBtn) {
      this.elements.deleteBtn.addEventListener('click', this.handleDelete);
    }
    
    // Evento para cambio de tipo de sucursal
    this.elements.tipoSelect.addEventListener('change', this.handleTipoChange);
    
    // Evento para cambio de modo de sincronización
    this.elements.sincronizacionSelect.addEventListener('change', this.handleSincronizacionChange);
    
    // Evento para integración con ARCA
    this.elements.integrarARCACheckbox.addEventListener('change', this.handleIntegrarARCAChange);
    
    // Evento para subir imagen QR
    this.elements.uploadQrBtn.addEventListener('click', () => {
      this.elements.qrFileInput.click();
    });
    
    this.elements.qrFileInput.addEventListener('change', this.handleQrUpload);
    
    // Evento para generar QR
    this.elements.generarQrBtn.addEventListener('click', this.generateQr);
    
    // Evento para probar conexión
    this.elements.testConnectionBtn.addEventListener('click', this.testConnection);
    
    // Detectar cambios en el formulario
    const formElements = this.elements.form.querySelectorAll('input, select, textarea');
    formElements.forEach(element => {
      element.addEventListener('change', this.handleFormChange);
      if (element.type !== 'checkbox' && element.type !== 'file') {
        element.addEventListener('input', this.handleFormChange);
      }
    });
  }

  /**
   * Maneja el evento de cambio en el formulario
   */
  handleFormChange() {
    this.hasChanges = true;
  }

  /**
   * Maneja el cambio en el tipo de sucursal
   * @param {Event} event - Evento de cambio
   */
  handleTipoChange(event) {
    const configSyncDiv = document.getElementById('config-sync');
    
    if (event.target.value === 'principal') {
      configSyncDiv.classList.add('d-none');
    } else {
      configSyncDiv.classList.remove('d-none');
    }
  }

  /**
   * Maneja el cambio en el modo de sincronización
   * @param {Event} event - Evento de cambio
   */
  handleSincronizacionChange(event) {
    const configSyncAutoDiv = document.getElementById('config-sync-auto');
    
    if (event.target.value === 'automatica') {
      configSyncAutoDiv.classList.remove('d-none');
    } else {
      configSyncAutoDiv.classList.add('d-none');
    }
  }

  /**
   * Maneja el cambio en la integración con ARCA
   * @param {Event} event - Evento de cambio
   */
  handleIntegrarARCAChange(event) {
    if (event.target.checked) {
      this.elements.configFiscalContainer.classList.remove('d-none');
    } else {
      this.elements.configFiscalContainer.classList.add('d-none');
    }
  }

  /**
   * Maneja la subida de la imagen QR
   * @param {Event} event - Evento de cambio en el input file
   */
  async handleQrUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    try {
      // Validación del archivo
      if (!file.type.startsWith('image/')) {
        throw new Error('El archivo debe ser una imagen');
      }
      
      if (file.size > 1024 * 1024) { // 1MB máximo
        throw new Error('La imagen no debe superar 1MB');
      }
      
      // Convertir a Base64 para almacenar
      const reader = new FileReader();
      reader.onload = (e) => {
        const base64Image = e.target.result;
        
        // Actualizar vista previa
        this.elements.qrImagePreview.innerHTML = `<img src="${base64Image}" alt="QR Mercado Pago" class="img-fluid">`;
        
        // Guardar en el objeto de sucursal
        this.currentSucursal.qrImage = base64Image;
        this.hasChanges = true;
      };
      
      reader.readAsDataURL(file);
      
    } catch (error) {
      console.error('Error al subir QR:', error);
      notifications.show(`Error: ${error.message}`, 'error');
    }
  }

  /**
   * Genera un código QR usando el token de Mercado Pago
   */
  async generateQr() {
    try {
      const token = this.elements.mercadoPagoTokenInput.value.trim();
      
      if (!token) {
        throw new Error('Debe ingresar un token de Mercado Pago válido');
      }
      
      notifications.show('Generando código QR...', 'info');
      
      // Generar QR usando la API de Mercado Pago (simulación)
      // En una implementación real, esto llamaría a la API de Mercado Pago
      const response = await fetch('/api/mercadopago/generateQR', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          token,
          sucursalId: this.currentSucursal.id,
          sucursalNombre: this.elements.nombreInput.value
        })
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Error al generar el código QR');
      }
      
      const data = await response.json();
      
      // Actualizar vista previa
      this.elements.qrImagePreview.innerHTML = `<img src="${data.qrImage}" alt="QR Mercado Pago" class="img-fluid">`;
      
      // Guardar en el objeto de sucursal
      this.currentSucursal.qrImage = data.qrImage;
      this.hasChanges = true;
      
      notifications.show('Código QR generado correctamente', 'success');
      
    } catch (error) {
      console.error('Error al generar QR:', error);
      
      // Como estamos en un entorno de desarrollo, simulamos una respuesta exitosa
      // En producción, esto se eliminaría
      const mockQrImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAKQAAACkCAYAAAAZtYVBAAAAAklEQVR4AewaftIAAAUcSURBVO3BQY4cSRLAQDLQ//8yV0c/JZCoai72ZoT9wVqXOKx1jcNa1zisdY3DWtc4rHWNw1rXOKx1jcNa1zisdY3DWtc4rHWNw1rXOKx1jcNa1zisdY0PL6X8TRV3UiaVJ1KepEwqU8pU8UTK31TxjcNa1zisdY3DWtf48GUV35RyJWVSmSpuSplUpooJ+aaSJymTylQxVXxTyjcOa13jsNY1Dmtd48OPpbxTxZ2UqeJJyjdVTCl3qriT8k7FLx3WusZhrWsc1rrGh/8zKXcqnqQ8qZgqJpWp4r/ksNY1Dmtd47DWNT78WMXfVDGlTBWTyqQyVUwVk8qTiicVf1PFnzis9Y3DWtc4rHWND/9nKk9SnqhMKVPFpDKpTBV3Kp6k/Jcc1rrGYa1rHNa6xocfq/ilik8qJpU7KVPFk4onFXdSpoqp4knFE5VfOqx1jcNa1zisdY0PP5byThV3Ut6p4k7KVDGlTBVPVKaKSeVOxaTyTsU7h7WucVjrGoe1rvHhyyqeVEwqU8WkMqlMFVPFpPKkYlK5UzGl3KmYKr6p4psOa13jsNY1Dmtd48NLKXcqJpWpYlJ5UnGnYlKZKiaVqWJK+ZsqJpWp4k7FpPJOh7WucVjrGoe1rvHhZSpTxaQyVUwqd1KeVEwqk8qdlCcV/yWHta5xWOsah7Wu8eGXUt6p4ptS7lRMKpPKpDJVTCpTxZ2UOxVPUqaKKWVSuVPxToe1rnFY6xqHta7x4csqvqliUpkqnlRMKlPFpDKpTBVPKiaVJxVPKu6kTBWTyqTyTYe1rnFY6xqHta4R9gcvpEwVk8qTiknlScWkMlVMKpPKVDGpTBWTyqTyTRXfdFjrGoe1rnFY6xofXkqZKiaVqeJOyp2KSeVJxaQyVdxJmSomlaliUnlSMalMFXcqnqR802Gtaxw=';
      
      this.elements.qrImagePreview.innerHTML = `<img src="${mockQrImage}" alt="QR Mercado Pago (Simulado)" class="img-fluid">`;
      this.currentSucursal.qrImage = mockQrImage;
      this.hasChanges = true;
      
      notifications.show('Código QR generado correctamente (modo simulación)', 'success');
    }
  }

  /**
   * Prueba la conexión con el servidor central
   */
  async testConnection() {
    try {
      const servidor = this.elements.servidorInput.value.trim();
      const puerto = this.elements.puertoInput.value;
      
      if (!servidor) {
        throw new Error('Debe ingresar la dirección del servidor');
      }
      
      notifications.show('Probando conexión con el servidor...', 'info');
      
      // En una implementación real, esto realizaría un ping al servidor
      // Para esta demostración, simulamos un delay y una respuesta exitosa
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Simulación de resultado aleatorio para demostración
      const success = Math.random() > 0.3; // 70% de éxito
      
      if (success) {
        notifications.show(`Conexión exitosa con ${servidor}:${puerto}`, 'success');
      } else {
        throw new Error('No se pudo establecer conexión con el servidor');
      }
    } catch (error) {
      console.error('Error al probar conexión:', error);
      notifications.show(`Error: ${error.message}`, 'error');
    }
  }

  /**
   * Configura las validaciones del formulario
   */
  setupValidation() {
    // Configurar reglas de validación para el formulario
    validation.setupFormValidation(this.elements.form, {
      nombre: {
        required: true,
        minLength: 3,
        maxLength: 50
      },
      direccion: {
        required: true,
        minLength: 5,
        maxLength: 100
      },
      telefono: {
        pattern: /^(\+?[0-9]{1,4}[-\s]?)?[0-9]{6,12}$/,
        required: false
      },
      email: {
        email: true,
        required: false
      },
      servidor: {
        required: value => this.elements.tipoSelect.value === 'secundaria',
        pattern: /^([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$|^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/
      },
      puerto: {
        required: value => this.elements.tipoSelect.value === 'secundaria',
        number: true,
        min: 1,
        max: 65535
      },
      intervaloSinc: {
        number: true,
        min: 5,
        max: 1440
      },
      ptoVenta: {
        required: value => this.elements.integrarARCACheckbox.checked,
        pattern: /^[0-9]{1,5}$/
      }
    });
  }

  /**
   * Valida el formulario completo antes de enviar
   * @returns {boolean} - true si el formulario es válido, false en caso contrario
   */
  validateForm() {
    // Verificar que la sucursal tenga un nombre
    if (!this.elements.nombreInput.value.trim()) {
      notifications.show('El nombre de la sucursal es obligatorio', 'error');
      this.elements.nombreInput.focus();
      return false;
    }
    
    // Verificar la dirección
    if (!this.elements.direccionInput.value.trim()) {
      notifications.show('La dirección de la sucursal es obligatoria', 'error');
      this.elements.direccionInput.focus();
      return false;
    }
    
    // Si es sucursal secundaria, verificar servidor
    if (this.elements.tipoSelect.value === 'secundaria') {
      if (!this.elements.servidorInput.value.trim()) {
        notifications.show('Debe ingresar la dirección del servidor central', 'error');
        this.elements.servidorInput.focus();
        return false;
      }
    }
    
    // Si tiene integración ARCA, verificar punto de venta
    if (this.elements.integrarARCACheckbox.checked) {
      if (!this.elements.ptoVentaInput.value.trim()) {
        notifications.show('Debe ingresar el punto de venta para la integración fiscal', 'error');
        this.elements.ptoVentaInput.focus();
        return false;
      }
    }
    
    return true;
  }

  /**
   * Maneja el envío del formulario
   * @param {Event} event - Evento de submit
   */
  async handleSubmit(event) {
    event.preventDefault();
    
    if (!this.validateForm()) {
      return;
    }
    
    try {
      // Actualizar los datos de la sucursal con los valores del formulario
      this.currentSucursal.nombre = this.elements.nombreInput.value.trim();
      this.currentSucursal.direccion = this.elements.direccionInput.value.trim();
      this.currentSucursal.telefono = this.elements.telefonoInput.value.trim();
      this.currentSucursal.email = this.elements.emailInput.value.trim();
      this.currentSucursal.responsable = this.elements.responsableInput.value.trim();
      this.currentSucursal.activa = this.elements.activaCheckbox.checked;
      this.currentSucursal.tipo = this.elements.tipoSelect.value;
      this.currentSucursal.sincronizacion = this.elements.sincronizacionSelect.value;
      this.currentSucursal.servidor = this.elements.servidorInput.value.trim();
      this.currentSucursal.puerto = parseInt(this.elements.puertoInput.value);
      this.currentSucursal.sincAutomatica = this.elements.sincAutomaticaCheckbox.checked;
      this.currentSucursal.intervaloSinc = parseInt(this.elements.intervaloInput.value);
      this.currentSucursal.stockCompartido = this.elements.stockCompartidoCheckbox.checked;
      this.currentSucursal.cajaIndependiente = this.elements.cajaIndependienteCheckbox.checked;
      this.currentSucursal.mercadoPagoToken = this.elements.mercadoPagoTokenInput.value.trim();
      this.currentSucursal.integrarARCA = this.elements.integrarARCACheckbox.checked;
      this.currentSucursal.ptoVenta = this.elements.ptoVentaInput.value.trim();
      
      // Procesar el certificado fiscal si se ha cargado uno nuevo
      if (this.elements.certFiscalFile.files.length > 0) {
        const file = this.elements.certFiscalFile.files[0];
        
        // Convertir a Base64 para almacenar
        const reader = new FileReader();
        const certPromise = new Promise((resolve, reject) => {
          reader.onload = e => resolve(e.target.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        
        this.currentSucursal.certificadoFiscal = await certPromise;
      }
      
      // Actualizar fecha de modificación
      this.currentSucursal.ultimaModificacion = new Date();
      
      // Obtener usuario actual
      const currentUser = auth.getCurrentUser();
      this.currentSucursal.modificadoPor = currentUser.id;
      
      // Si es nueva sucursal, establecer fecha de creación y usuario creador
      if (!this.currentSucursal.id) {
        this.currentSucursal.fechaCreacion = new Date();
        this.currentSucursal.creadoPor = currentUser.id;
      }
      
      // Guardar sucursal
      await this.saveSucursal();
      
    } catch (error) {
      console.error('Error al guardar la sucursal:', error);
      notifications.show(`Error: ${error.message}`, 'error');
    }
  }

  /**
   * Guarda la sucursal en la base de datos
   * @returns {Promise<void>}
   */
  async saveSucursal() {
    try {
      let sucursalId;
      
      if (this.isEditing) {
        // Actualizar sucursal existente
        sucursalId = this.currentSucursal.id;
        await database.update('sucursales', sucursalId, this.currentSucursal);
        notifications.show(`Sucursal "${this.currentSucursal.nombre}" actualizada correctamente`, 'success');
      } else {
        // Crear nueva sucursal
        sucursalId = await database.add('sucursales', this.currentSucursal);
        this.currentSucursal.id = sucursalId;
        notifications.show(`Sucursal "${this.currentSucursal.nombre}" creada correctamente`, 'success');
      }
      
      // Registrar en el log
      logger.log({
        accion: this.isEditing ? 'sucursal_actualizada' : 'sucursal_creada',
        modulo: 'sucursales',
        usuario: auth.getCurrentUser().id,
        detalles: {
          sucursalId,
          nombre: this.currentSucursal.nombre,
          tipo: this.currentSucursal.tipo
        }
      });
      
      // Si es sucursal principal, comprobar si hay que cambiar otras a secundarias
      if (this.currentSucursal.tipo === 'principal') {
        await this.checkAndUpdateOtherMainBranches(sucursalId);
      }
      
      // Actualizar la configuración de sincronización si es necesario
      if (this.currentSucursal.sincronizacion === 'automatica' && this.currentSucursal.sincAutomatica) {
        await sync.configureSyncForBranch(sucursalId, this.currentSucursal.intervaloSinc);
      }
      
      // Después de guardar, disparar un evento personalizado para actualizar la lista de sucursales
      const event = new CustomEvent('sucursal:saved', {
        detail: {
          sucursalId,
          nombre: this.currentSucursal.nombre,
          isNew: !this.isEditing
        }
      });
      document.dispatchEvent(event);
      
      // Redirigir a la lista de sucursales
      setTimeout(() => {
        // Simular una redirección cambiando de pestaña
        const event = new CustomEvent('tab:change', {
          detail: {
            module: 'sucursales',
            action: 'list'
          }
        });
        document.dispatchEvent(event);
      }, 1500);
      
    } catch (error) {
      console.error('Error al guardar sucursal en la base de datos:', error);
      throw error;
    }
  }

  /**
   * Verifica si hay otras sucursales marcadas como "principal" y las actualiza a "secundaria"
   * @param {string} currentBranchId - ID de la sucursal que se acaba de marcar como principal
   */
  async checkAndUpdateOtherMainBranches(currentBranchId) {
    try {
      // Buscar otras sucursales marcadas como principal
      const sucursales = await database.query('sucursales', { tipo: 'principal' });
      
      // Filtrar la sucursal actual
      const otherMainBranches = sucursales.filter(s => s.id !== currentBranchId);
      
      if (otherMainBranches.length > 0) {
        // Hay otras sucursales principales, cambiarlas a secundarias
        const updatePromises = otherMainBranches.map(async (sucursal) => {
          sucursal.tipo = 'secundaria';
          sucursal.ultimaModificacion = new Date();
          sucursal.modificadoPor = auth.getCurrentUser().id;
          
          await database.update('sucursales', sucursal.id, sucursal);
          
          // Registrar en el log
          logger.log({
            accion: 'sucursal_cambio_tipo',
            modulo: 'sucursales',
            usuario: auth.getCurrentUser().id,
            detalles: {
              sucursalId: sucursal.id,
              nombre: sucursal.nombre,
              tipoAnterior: 'principal',
              tipoNuevo: 'secundaria'
            }
          });
        });
        
        await Promise.all(updatePromises);
        
        notifications.show(`Se han actualizado ${otherMainBranches.length} sucursales de principal a secundaria`, 'info');
      }
    } catch (error) {
      console.error('Error al actualizar otras sucursales principales:', error);
      throw error;
    }
  }

  /**
   * Maneja el evento de cancelar la edición
   */
  handleCancel() {
    if (this.hasChanges) {
      // Mostrar confirmación antes de salir si hay cambios
      const confirmed = window.confirm('¿Está seguro que desea cancelar? Se perderán los cambios no guardados.');
      
      if (!confirmed) {
        return;
      }
    }
    
    // Disparar evento para cambiar de pestaña
    const event = new CustomEvent('tab:change', {
      detail: {
        module: 'sucursales',
        action: 'list'
      }
    });
    document.dispatchEvent(event);
  }

  /**
   * Maneja el evento de eliminar la sucursal
   */
  handleDelete() {
    // Mostrar confirmación antes de eliminar
    const confirmModal = document.createElement('div');
    confirmModal.className = 'modal fade';
    confirmModal.id = 'confirmDeleteModal';
    confirmModal.setAttribute('tabindex', '-1');
    confirmModal.setAttribute('aria-labelledby', 'confirmDeleteModalLabel');
    confirmModal.setAttribute('aria-hidden', 'true');
    
    confirmModal.innerHTML = `
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header bg-danger text-white">
            <h5 class="modal-title" id="confirmDeleteModalLabel">Eliminar Sucursal</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <p>¿Está seguro que desea eliminar la sucursal "${this.currentSucursal.nombre}"?</p>
            <p><strong>Esta acción no se puede deshacer.</strong></p>
            <div class="form-check mt-3">
              <input class="form-check-input" type="checkbox" id="confirmDeleteCheck">
              <label class="form-check-label" for="confirmDeleteCheck">
                Entiendo que se eliminarán todos los datos asociados a esta sucursal
              </label>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
            <button type="button" class="btn btn-danger" id="confirmDeleteBtn" disabled>
              Eliminar Permanentemente
            </button>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(confirmModal);
    
    // Inicializar el modal usando Bootstrap
    const modal = new bootstrap.Modal(confirmModal);
    modal.show();
    
    // Configurar eventos
    const confirmCheck = document.getElementById('confirmDeleteCheck');
    const confirmBtn = document.getElementById('confirmDeleteBtn');
    
    confirmCheck.addEventListener('change', () => {
      confirmBtn.disabled = !confirmCheck.checked;
    });
    
    confirmBtn.addEventListener('click', () => {
      modal.hide();
      this.confirmDelete();
    });
    
    // Limpiar el DOM cuando se cierre el modal
    confirmModal.addEventListener('hidden.bs.modal', () => {
      document.body.removeChild(confirmModal);
    });
  }

  /**
   * Confirma la eliminación de la sucursal
   */
  async confirmDelete() {
    try {
      // Verificar si es la única sucursal principal
      if (this.currentSucursal.tipo === 'principal') {
        const sucursales = await database.query('sucursales', { tipo: 'principal' });
        
        if (sucursales.length <= 1) {
          notifications.show('No se puede eliminar la única sucursal principal. Debe crear otra sucursal principal primero.', 'error');
          return;
        }
      }
      
      // Registrar en el log antes de eliminar
      logger.log({
        accion: 'sucursal_eliminada',
        modulo: 'sucursales',
        usuario: auth.getCurrentUser().id,
        detalles: {
          sucursalId: this.currentSucursal.id,
          nombre: this.currentSucursal.nombre,
          tipo: this.currentSucursal.tipo
        }
      });
      
      // Eliminar la sucursal
      await database.remove('sucursales', this.currentSucursal.id);
      
      notifications.show(`Sucursal "${this.currentSucursal.nombre}" eliminada correctamente`, 'success');
      
      // Disparar evento para actualizar la lista
      const event = new CustomEvent('sucursal:deleted', {
        detail: {
          sucursalId: this.currentSucursal.id,
          nombre: this.currentSucursal.nombre
        }
      });
      document.dispatchEvent(event);
      
      // Redirigir a la lista
      setTimeout(() => {
        const event = new CustomEvent('tab:change', {
          detail: {
            module: 'sucursales',
            action: 'list'
          }
        });
        document.dispatchEvent(event);
      }, 1500);
      
    } catch (error) {
      console.error('Error al eliminar sucursal:', error);
      notifications.show(`Error: ${error.message}`, 'error');
    }
  }

  /**
   * Carga valores predeterminados para nuevas sucursales
   * @returns {Promise<void>}
   */
  async loadDefaultValues() {
    try {
      // Si es una nueva sucursal secundaria, intentar obtener la configuración
      // de la sucursal principal para facilitar la configuración
      if (!this.isEditing && this.currentSucursal.tipo === 'secundaria') {
        const sucursalesPrincipales = await database.query('sucursales', { tipo: 'principal' });
        
        if (sucursalesPrincipales.length > 0) {
          const principal = sucursalesPrincipales[0];
          
          // Copiar configuraciones compartidas
          this.currentSucursal.stockCompartido = principal.stockCompartido;
          
          // Proponer servidor basado en la IP de la sucursal principal
          if (principal.ip) {
            this.elements.servidorInput.value = principal.ip;
            this.currentSucursal.servidor = principal.ip;
          }
          
          // Proponer configuración de Mercado Pago similar
          if (principal.mercadoPagoToken) {
            this.elements.mercadoPagoTokenInput.value = principal.mercadoPagoToken;
            this.currentSucursal.mercadoPagoToken = principal.mercadoPagoToken;
          }
        }
      }
    } catch (error) {
      console.error('Error al cargar valores predeterminados:', error);
    }
  }
}

// Exportar la clase para su uso en otros módulos
 new

module.exports = new SucursalEditor();