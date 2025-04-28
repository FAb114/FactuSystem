/**
 * visual.js - Módulo de configuración visual para FactuSystem
 * 
 * Este módulo permite la personalización de la interfaz del sistema:
 * - Colores principales y secundarios
 * - Logos para documentos e interfaz
 * - Formatos de documentos (A4/Ticket)
 * - Personalización de plantillas
 */

// Importamos dependencias necesarias
const { ipcRenderer } = require('electron');
const Swal = require('sweetalert2');
const fs = require('fs');
const path = require('path');

// Importamos utilidades
const database = require('../../../utils/database');
const auth = require('../../../utils/auth');
const logger = require('../../../utils/logger');

// Clase principal para gestión de configuraciones visuales
class VisualConfig {
    constructor() {
        this.db = database.getConnection();
        this.config = null;
        this.colorPickers = {};
        this.logoPreview = null;
        this.currentUser = auth.getCurrentUser();
        this.rootPath = ipcRenderer.sendSync('get-app-path');
        this.defaultColors = {
            primary: '#0d47a1',
            secondary: '#2196f3',
            accent: '#03a9f4',
            text: '#212121',
            background: '#f5f5f5',
            sidebar: '#1565c0',
            header: '#1976d2'
        };
        this.defaultSettings = {
            documentFormat: 'A4',
            showImages: true,
            darkMode: false,
            fontSize: 'medium',
            animationsEnabled: true,
            compactMode: false
        };
    }

    /**
     * Inicializa el módulo de configuración visual
     */
    async init() {
        try {
            // Cargamos la configuración visual actual
            await this.loadConfig();
            
            // Inicializamos la interfaz
            this.initInterface();
            
            // Cargamos los eventos
            this.setupEventListeners();
            
            logger.log('info', 'Módulo de configuración visual inicializado', { user: this.currentUser.username });
        } catch (error) {
            logger.log('error', 'Error al inicializar configuración visual', { error: error.message });
            Swal.fire({
                title: 'Error',
                text: 'No se pudo cargar la configuración visual',
                icon: 'error',
                confirmButtonText: 'Aceptar'
            });
        }
    }

    /**
     * Carga la configuración visual desde la base de datos
     */
    async loadConfig() {
        try {
            // Obtenemos la configuración de la sucursal actual
            const sucursalId = ipcRenderer.sendSync('get-current-sucursal');
            
            const visualConfig = await this.db.visual_config.findOne({
                where: { sucursalId: sucursalId }
            });
            
            if (visualConfig) {
                this.config = {
                    colors: JSON.parse(visualConfig.colors),
                    settings: JSON.parse(visualConfig.settings),
                    logoPath: visualConfig.logoPath,
                    customCss: visualConfig.customCss,
                    templateVariants: JSON.parse(visualConfig.templateVariants)
                };
            } else {
                // Si no existe configuración, creamos una por defecto
                this.config = {
                    colors: this.defaultColors,
                    settings: this.defaultSettings,
                    logoPath: '',
                    customCss: '',
                    templateVariants: {
                        facturaA4: 'default',
                        facturaTicket: 'default',
                        remito: 'default',
                        notaCredito: 'default',
                        notaDebito: 'default'
                    }
                };
                
                // Guardamos la configuración por defecto
                await this.saveConfig();
            }
            
            // Aplicamos la configuración visual cargada
            this.applyVisualConfig();
            
        } catch (error) {
            logger.log('error', 'Error al cargar configuración visual', { error: error.message });
            throw new Error(`Error al cargar configuración visual: ${error.message}`);
        }
    }

    /**
     * Guarda la configuración visual en la base de datos
     */
    async saveConfig() {
        try {
            const sucursalId = ipcRenderer.sendSync('get-current-sucursal');
            
            await this.db.visual_config.upsert({
                sucursalId: sucursalId,
                colors: JSON.stringify(this.config.colors),
                settings: JSON.stringify(this.config.settings),
                logoPath: this.config.logoPath,
                customCss: this.config.customCss,
                templateVariants: JSON.stringify(this.config.templateVariants),
                updatedAt: new Date(),
                updatedBy: this.currentUser.id
            });
            
            // Notificamos al proceso principal para que actualice la configuración global
            ipcRenderer.send('visual-config-updated', this.config);
            
            logger.log('info', 'Configuración visual guardada', { 
                user: this.currentUser.username,
                sucursalId: sucursalId
            });
            
            return true;
        } catch (error) {
            logger.log('error', 'Error al guardar configuración visual', { error: error.message });
            throw new Error(`Error al guardar configuración visual: ${error.message}`);
        }
    }

    /**
     * Inicializa la interfaz de usuario del módulo
     */
    initInterface() {
        // Contenedor principal
        const container = document.getElementById('visual-config-container');
        if (!container) return;
        
        // Limpiamos el contenedor
        container.innerHTML = '';
        
        // Creamos la estructura de pestañas
        const tabsHTML = `
            <div class="config-tabs">
                <ul class="nav nav-tabs" role="tablist">
                    <li class="nav-item">
                        <a class="nav-link active" id="colors-tab" data-toggle="tab" href="#colors-content" role="tab">Colores</a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" id="logo-tab" data-toggle="tab" href="#logo-content" role="tab">Logo</a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" id="templates-tab" data-toggle="tab" href="#templates-content" role="tab">Plantillas</a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" id="interface-tab" data-toggle="tab" href="#interface-content" role="tab">Interfaz</a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" id="advanced-tab" data-toggle="tab" href="#advanced-content" role="tab">Avanzado</a>
                    </li>
                </ul>
                <div class="tab-content mt-3">
                    <div class="tab-pane fade show active" id="colors-content" role="tabpanel"></div>
                    <div class="tab-pane fade" id="logo-content" role="tabpanel"></div>
                    <div class="tab-pane fade" id="templates-content" role="tabpanel"></div>
                    <div class="tab-pane fade" id="interface-content" role="tabpanel"></div>
                    <div class="tab-pane fade" id="advanced-content" role="tabpanel"></div>
                </div>
            </div>
            <div class="form-actions mt-4">
                <button id="save-visual-config" class="btn btn-primary"><i class="fas fa-save"></i> Guardar Configuración</button>
                <button id="reset-visual-config" class="btn btn-outline-danger"><i class="fas fa-undo"></i> Restaurar Predeterminados</button>
            </div>
        `;
        
        container.innerHTML = tabsHTML;
        
        // Inicializamos cada pestaña
        this.initColorsTab();
        this.initLogoTab();
        this.initTemplatesTab();
        this.initInterfaceTab();
        this.initAdvancedTab();
    }

    /**
     * Inicializa la pestaña de configuración de colores
     */
    initColorsTab() {
        const container = document.getElementById('colors-content');
        if (!container) return;
        
        let html = `
            <div class="card">
                <div class="card-header">
                    <h5>Personalización de Colores</h5>
                    <p class="text-muted">Seleccione los colores principales de la interfaz</p>
                </div>
                <div class="card-body">
                    <div class="row" id="color-pickers-container">
                        <div class="col-md-6 mb-3">
                            <label for="color-primary">Color Primario</label>
                            <div class="input-group">
                                <div class="input-group-prepend">
                                    <span class="input-group-text color-preview" id="preview-primary"></span>
                                </div>
                                <input type="text" class="form-control color-input" id="color-primary" 
                                    value="${this.config.colors.primary}" data-color-name="primary">
                            </div>
                            <small class="form-text text-muted">Color principal para botones y acentos</small>
                        </div>
                        <div class="col-md-6 mb-3">
                            <label for="color-secondary">Color Secundario</label>
                            <div class="input-group">
                                <div class="input-group-prepend">
                                    <span class="input-group-text color-preview" id="preview-secondary"></span>
                                </div>
                                <input type="text" class="form-control color-input" id="color-secondary" 
                                    value="${this.config.colors.secondary}" data-color-name="secondary">
                            </div>
                            <small class="form-text text-muted">Color secundario para elementos de soporte</small>
                        </div>
                        <div class="col-md-6 mb-3">
                            <label for="color-accent">Color de Acento</label>
                            <div class="input-group">
                                <div class="input-group-prepend">
                                    <span class="input-group-text color-preview" id="preview-accent"></span>
                                </div>
                                <input type="text" class="form-control color-input" id="color-accent" 
                                    value="${this.config.colors.accent}" data-color-name="accent">
                            </div>
                            <small class="form-text text-muted">Color para destacar elementos importantes</small>
                        </div>
                        <div class="col-md-6 mb-3">
                            <label for="color-text">Color de Texto</label>
                            <div class="input-group">
                                <div class="input-group-prepend">
                                    <span class="input-group-text color-preview" id="preview-text"></span>
                                </div>
                                <input type="text" class="form-control color-input" id="color-text" 
                                    value="${this.config.colors.text}" data-color-name="text">
                            </div>
                            <small class="form-text text-muted">Color principal para textos</small>
                        </div>
                        <div class="col-md-6 mb-3">
                            <label for="color-background">Color de Fondo</label>
                            <div class="input-group">
                                <div class="input-group-prepend">
                                    <span class="input-group-text color-preview" id="preview-background"></span>
                                </div>
                                <input type="text" class="form-control color-input" id="color-background" 
                                    value="${this.config.colors.background}" data-color-name="background">
                            </div>
                            <small class="form-text text-muted">Color de fondo general</small>
                        </div>
                        <div class="col-md-6 mb-3">
                            <label for="color-sidebar">Color de Sidebar</label>
                            <div class="input-group">
                                <div class="input-group-prepend">
                                    <span class="input-group-text color-preview" id="preview-sidebar"></span>
                                </div>
                                <input type="text" class="form-control color-input" id="color-sidebar" 
                                    value="${this.config.colors.sidebar}" data-color-name="sidebar">
                            </div>
                            <small class="form-text text-muted">Color para la barra lateral</small>
                        </div>
                        <div class="col-md-6 mb-3">
                            <label for="color-header">Color de Cabecera</label>
                            <div class="input-group">
                                <div class="input-group-prepend">
                                    <span class="input-group-text color-preview" id="preview-header"></span>
                                </div>
                                <input type="text" class="form-control color-input" id="color-header" 
                                    value="${this.config.colors.header}" data-color-name="header">
                            </div>
                            <small class="form-text text-muted">Color para la cabecera</small>
                        </div>
                    </div>
                </div>
                <div class="card-footer">
                    <div class="color-theme-presets">
                        <h6>Temas Predefinidos</h6>
                        <div class="theme-buttons">
                            <button class="btn btn-sm theme-button" id="theme-blue" data-theme="blue">Azul</button>
                            <button class="btn btn-sm theme-button" id="theme-green" data-theme="green">Verde</button>
                            <button class="btn btn-sm theme-button" id="theme-purple" data-theme="purple">Púrpura</button>
                            <button class="btn btn-sm theme-button" id="theme-red" data-theme="red">Rojo</button>
                            <button class="btn btn-sm theme-button" id="theme-dark" data-theme="dark">Oscuro</button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="card mt-3">
                <div class="card-header">
                    <h5>Vista Previa</h5>
                </div>
                <div class="card-body">
                    <div class="color-preview-container">
                        <div class="color-preview-header" id="preview-header-element">
                            <div class="preview-brand">FactuSystem</div>
                            <div class="preview-actions">
                                <span class="preview-action"></span>
                                <span class="preview-action"></span>
                            </div>
                        </div>
                        <div class="color-preview-content">
                            <div class="color-preview-sidebar" id="preview-sidebar-element">
                                <div class="preview-menu-item active"></div>
                                <div class="preview-menu-item"></div>
                                <div class="preview-menu-item"></div>
                                <div class="preview-menu-item"></div>
                            </div>
                            <div class="color-preview-main" id="preview-main-element">
                                <div class="preview-card">
                                    <div class="preview-card-header" id="preview-primary-element">Título</div>
                                    <div class="preview-card-body">
                                        <p class="preview-text" id="preview-text-element">Texto de ejemplo</p>
                                        <button class="preview-button" id="preview-accent-element">Botón</button>
                                    </div>
                                </div>
                                <div class="preview-data-table">
                                    <div class="preview-table-header" id="preview-secondary-element"></div>
                                    <div class="preview-table-row"></div>
                                    <div class="preview-table-row"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        container.innerHTML = html;
        
        // Inicializamos color pickers
        this.initColorPickers();
        
        // Actualizamos vista previa
        this.updateColorPreview();
        
        // Inicializamos eventos para temas predefinidos
        this.initThemeButtons();
    }

    /**
     * Inicializa la pestaña de configuración del logo
     */
    initLogoTab() {
        const container = document.getElementById('logo-content');
        if (!container) return;
        
        let html = `
            <div class="card">
                <div class="card-header">
                    <h5>Logo de la Empresa</h5>
                    <p class="text-muted">Este logo aparecerá en facturas, remitos y otros documentos</p>
                </div>
                <div class="card-body">
                    <div class="row">
                        <div class="col-md-6">
                            <div class="logo-upload-container">
                                <div class="logo-preview" id="logo-preview">
                                    ${this.config.logoPath ? 
                                        `<img src="${this.config.logoPath}" alt="Logo de la empresa" id="logo-preview-img">` : 
                                        `<div class="no-logo">
                                            <i class="fas fa-image"></i>
                                            <p>No hay logo cargado</p>
                                        </div>`
                                    }
                                </div>
                                <div class="logo-actions mt-3">
                                    <button id="select-logo" class="btn btn-primary">
                                        <i class="fas fa-upload"></i> Seleccionar Logo
                                    </button>
                                    <button id="remove-logo" class="btn btn-outline-danger" 
                                        ${!this.config.logoPath ? 'disabled' : ''}>
                                        <i class="fas fa-trash"></i> Eliminar
                                    </button>
                                </div>
                                <input type="file" id="logo-file-input" accept="image/png,image/jpeg,image/svg+xml" style="display:none">
                                <p class="text-muted mt-2">Formatos aceptados: PNG, JPEG, SVG. Tamaño recomendado: 300x150px</p>
                            </div>
                        </div>
                        <div class="col-md-6">
                            <div class="logo-options">
                                <h6>Opciones de Logo</h6>
                                <div class="form-group">
                                    <label for="logo-position">Posición en Documentos</label>
                                    <select class="form-control" id="logo-position">
                                        <option value="top-left" ${this.config.settings.logoPosition === 'top-left' ? 'selected' : ''}>
                                            Superior Izquierda
                                        </option>
                                        <option value="top-center" ${this.config.settings.logoPosition === 'top-center' ? 'selected' : ''}>
                                            Superior Centro
                                        </option>
                                        <option value="top-right" ${this.config.settings.logoPosition === 'top-right' ? 'selected' : ''}>
                                            Superior Derecha
                                        </option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label for="logo-size">Tamaño en Documentos</label>
                                    <select class="form-control" id="logo-size">
                                        <option value="small" ${this.config.settings.logoSize === 'small' ? 'selected' : ''}>
                                            Pequeño
                                        </option>
                                        <option value="medium" ${this.config.settings.logoSize === 'medium' ? 'selected' : ''}>
                                            Mediano
                                        </option>
                                        <option value="large" ${this.config.settings.logoSize === 'large' ? 'selected' : ''}>
                                            Grande
                                        </option>
                                    </select>
                                </div>
                                <div class="form-check mt-3">
                                    <input class="form-check-input" type="checkbox" id="show-logo-in-dashboard" 
                                        ${this.config.settings.showLogoInDashboard ? 'checked' : ''}>
                                    <label class="form-check-label" for="show-logo-in-dashboard">
                                        Mostrar logo en el Dashboard
                                    </label>
                                </div>
                                <div class="form-check">
                                    <input class="form-check-input" type="checkbox" id="show-logo-in-login" 
                                        ${this.config.settings.showLogoInLogin ? 'checked' : ''}>
                                    <label class="form-check-label" for="show-logo-in-login">
                                        Mostrar logo en la pantalla de Login
                                    </label>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="card mt-3">
                <div class="card-header">
                    <h5>Vista Previa del Documento</h5>
                </div>
                <div class="card-body">
                    <div class="document-preview" id="document-preview">
                        <div class="document-header">
                            <div class="document-logo" id="document-logo">
                                ${this.config.logoPath ? 
                                    `<img src="${this.config.logoPath}" alt="Logo" class="logo-${this.config.settings.logoSize || 'medium'}">` : 
                                    `<div class="no-logo-placeholder"></div>`
                                }
                            </div>
                            <div class="document-title">FACTURA</div>
                            <div class="document-type">A</div>
                        </div>
                        <div class="document-body">
                            <div class="document-company">
                                <p><strong>Empresa S.A.</strong></p>
                                <p>CUIT: 30-12345678-9</p>
                                <p>Dirección: Av. Ejemplo 123</p>
                            </div>
                            <div class="document-customer">
                                <p><strong>Cliente:</strong> Juan Pérez</p>
                                <p><strong>CUIT/DNI:</strong> 20-12345678-9</p>
                                <p><strong>Dirección:</strong> Calle Cliente 456</p>
                            </div>
                            <div class="document-items">
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Descripción</th>
                                            <th>Cantidad</th>
                                            <th>Precio</th>
                                            <th>Total</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr>
                                            <td>Producto 1</td>
                                            <td>2</td>
                                            <td>$100.00</td>
                                            <td>$200.00</td>
                                        </tr>
                                        <tr>
                                            <td>Producto 2</td>
                                            <td>1</td>
                                            <td>$150.00</td>
                                            <td>$150.00</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                            <div class="document-total">
                                <p><strong>Total:</strong> $350.00</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        container.innerHTML = html;
        
        // Inicializamos eventos para la carga del logo
        this.initLogoUpload();
        
        // Inicializamos eventos para opciones de logo
        this.initLogoOptions();
    }

    /**
     * Inicializa la pestaña de configuración de plantillas
     */
    initTemplatesTab() {
        const container = document.getElementById('templates-content');
        if (!container) return;
        
        let html = `
            <div class="card">
                <div class="card-header">
                    <h5>Plantillas de Documentos</h5>
                    <p class="text-muted">Seleccione el formato visual para cada tipo de documento</p>
                </div>
                <div class="card-body">
                    <div class="row">
                        <div class="col-md-6">
                            <div class="template-selector">
                                <h6>Factura Formato A4</h6>
                                <div class="template-options">
                                    <div class="template-option ${this.config.templateVariants.facturaA4 === 'default' ? 'active' : ''}" 
                                         data-template="facturaA4" data-variant="default">
                                        <div class="template-preview">
                                            <img src="../assets/img/templates/factura-a4-default.png" alt="Plantilla Predeterminada">
                                        </div>
                                        <div class="template-name">Predeterminada</div>
                                    </div>
                                    <div class="template-option ${this.config.templateVariants.facturaA4 === 'modern' ? 'active' : ''}" 
                                         data-template="facturaA4" data-variant="modern">
                                        <div class="template-preview">
                                            <img src="../assets/img/templates/factura-a4-modern.png" alt="Plantilla Moderna">
                                        </div>
                                        <div class="template-name">Moderna</div>
                                    </div>
                                    <div class="template-option ${this.config.templateVariants.facturaA4 === 'simple' ? 'active' : ''}" 
                                         data-template="facturaA4" data-variant="simple">
                                        <div class="template-preview">
                                            <img src="../assets/img/templates/factura-a4-simple.png" alt="Plantilla Simple">
                                        </div>
                                        <div class="template-name">Simple</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="col-md-6">
                            <div class="template-selector">
                                <h6>Factura Formato Ticket</h6>
                                <div class="template-options">
                                    <div class="template-option ${this.config.templateVariants.facturaTicket === 'default' ? 'active' : ''}" 
                                         data-template="facturaTicket" data-variant="default">
                                        <div class="template-preview">
                                            <img src="../assets/img/templates/factura-ticket-default.png" alt="Ticket Predeterminado">
                                        </div>
                                        <div class="template-name">Predeterminado</div>
                                    </div>
                                    <div class="template-option ${this.config.templateVariants.facturaTicket === 'compact' ? 'active' : ''}" 
                                         data-template="facturaTicket" data-variant="compact">
                                        <div class="template-preview">
                                            <img src="../assets/img/templates/factura-ticket-compact.png" alt="Ticket Compacto">
                                        </div>
                                        <div class="template-name">Compacto</div>
                                    </div>
                                    <div class="template-option ${this.config.templateVariants.facturaTicket === 'detailed' ? 'active' : ''}" 
                                         data-template="facturaTicket" data-variant="detailed">
                                        <div class="template-preview">
                                            <img src="../assets/img/templates/factura-ticket-detailed.png" alt="Ticket Detallado">
                                        </div>
                                        <div class="template-name">Detallado</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="row mt-4">
                        <div class="col-md-6">
                            <div class="template-selector">
                                <h6>Remito</h6>
                                <div class="template-options">
                                    <div class="template-option ${this.config.templateVariants.remito === 'default' ? 'active' : ''}" 
                                         data-template="remito" data-variant="default">
                                        <div class="template-preview">
                                            <img src="../assets/img/templates/remito-default.png" alt="Remito Predeterminado">
                                        </div>
                                        <div class="template-name">Predeterminado</div>
                                    </div>
                                    <div class="template-option ${this.config.templateVariants.remito === 'detailed' ? 'active' : ''}" 
                                         data-template="remito" data-variant="detailed">
                                        <div class="template-preview">
                                            <img src="../assets/img/templates/remito-detailed.png" alt="Remito Detallado">
                                        </div>
                                        <div class="template-name">Detallado</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="col-md-6">
                            <div class="template-selector">
                                <h6>Notas de Crédito/Débito</h6>
                                <div class="template-options">
                                    <div class="template-option ${this.config.templateVariants.notaCredito === 'default' ? 'active' : ''}" 
                                         data-template="notaCredito" data-variant="default">
                                        <div class="template-preview">
                                            <img src="../assets/img/templates/nota-credito-default.png" alt="Nota Crédito Predeterminada">
                                        </div>
                                        <div class="template-name">Predeterminado</div>
                                    </div>
                                    <div class="template-option ${this.config.templateVariants.notaCredito === 'simple' ? 'active' : ''}" 
                                         data-template="notaCredito" data-variant="simple">
                                        <div class="template-preview">
                                            <img src="../assets/img/templates/nota-credito-simple.png" alt="Nota Crédito Simple">
                                        </div>
                                        <div class="template-name">Simple</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="card mt-3">
                <div class="card-header">
                    <h5>Documentos Personalizados</h5>
                </div>
                <div class="card-body">
                    <div class="form-group">
                        <div class="custom-control custom-switch">
                            <input type="checkbox" class="custom-control-input" id="enable-custom-template" 
                                ${this.config.settings.enableCustomTemplate ? 'checked' : ''}>
                            <label class="custom-control-label" for="enable-custom-template">Activar plantilla personalizada HTML</label>
                        </div>
                        <small class="form-text text-muted">
                            Permite editar el HTML de las plantillas. Solo para usuarios avanzados.
                        </small>
                    </div>
                    
                    <div id="custom-template-editor" class="${this.config.settings.enableCustomTemplate ? '' : 'd-none'}">
                        <div class="form-group mt-3">
                            <label for="template-selector">Seleccionar plantilla a editar</label>
                            <select class="form-control" id="template-selector">
                                <option value="facturaA4">Factura A4</option>
                                <option value="facturaTicket">Factura Ticket (58mm)</option>
                                <option value="remito">Remito</option>
                                <option value="notaCredito">Nota de Crédito</option>
                                <option value="notaDebito">Nota de Débito</option>
                            </select>
                        </div>
                        
                        <div class="form-group">
                            <label for="custom-html-editor">Editor HTML</label>
                            <textarea class="form-control code-editor" id="custom-html-editor" rows="10"></textarea>
                            <small class="form-text text-muted">
                                Utilice variables con formato {{variable}} para insertar datos dinámicos.
                                <a href="#" id="show-variables">Ver variables disponibles</a>
                            </small>
                        </div>
                        
                        <div class="template-actions">
                            <button id="save-custom-template" class="btn btn-primary btn-sm">
                                <i class="fas fa-save"></i> Guardar Plantilla
                            </button>
                            <button id="reset-custom-template" class="btn btn-outline-secondary btn-sm">
                                <i class="fas fa-undo"></i> Restaurar Predeterminada
                            </button>
                            <button id="preview-custom-template" class="btn btn-info btn-sm">
                                <i class="fas fa-eye"></i> Vista Previa
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        container.innerHTML = html;
        
        // Inicializamos eventos para selección de plantillas
        this.initTemplateSelectors();
        
        // Inicializamos editor de HTML personalizado
        this.initCustomTemplateEditor();
    }

    /**
     * Inicializa la pestaña de configuración de interfaz
     */
    initInterfaceTab() {
        const container = document.getElementById('interface-content');
        if (!container) return;
        
        let html = `
            <div class="card">
                <div class="card-header">
                    <h5>Configuración de Interfaz</h5>
                    <p class="text-muted">Personalice la apariencia y comportamiento de la interfaz</p>
                </div>
                <div class="card-body">
                    <div class="row">
                        <div class="col-md-6">
                            <h6>Apariencia General</h6>
                            
                            <div class="form-group">
                                <div class="custom-control custom-switch">
                                    <input type="checkbox" class="custom-control-input" id="dark-mode" 
                                        ${this.config.settings.darkMode ? 'checked' : ''}>
                                    <label class="custom-control-label" for="dark-mode">Modo oscuro</label>
                                </div>
                            </div>
                            
                            <div class="form-group">
                                <label for="font-size">Tamaño de fuente</label>
                                <select class="form-control" id="font-size">
                                    <option value="small" ${this.config.settings.fontSize === 'small' ? 'selected' : ''}>Pequeño</option>
                                    <option value="medium" ${this.config.settings.fontSize === 'medium' ? 'selected' : ''}>Medio</option>
                                    <option value="large" ${this.config.settings.fontSize === 'large' ? 'selected' : ''}>Grande</option>
                                </select>
                            </div>
                            
                            <div class="form-group">
                                <div class="custom-control custom-switch">
                                    <input type="checkbox" class="custom-control-input" id="compact-mode" 
                                        ${this.config.settings.compactMode ? 'checked' : ''}>
                                    <label class="custom-control-label" for="compact-mode">Modo compacto</label>
                                </div>
                                <small class="form-text text-muted">Reduce el espacio entre elementos para mostrar más información</small>
                            </div>
                            
                            <div class="form-group">
                                <div class="custom-control custom-switch">
                                    <input type="checkbox" class="custom-control-input" id="animations-enabled" 
                                        ${this.config.settings.animationsEnabled ? 'checked' : ''}>
                                    <label class="custom-control-label" for="animations-enabled">Animaciones</label>
                                </div>
                                <small class="form-text text-muted">Activar/desactivar animaciones en la interfaz</small>
                            </div>
                        </div>
                        
                        <div class="col-md-6">
                            <h6>Visualización de Datos</h6>
                            
                            <div class="form-group">
                                <div class="custom-control custom-switch">
                                    <input type="checkbox" class="custom-control-input" id="show-images" 
                                        ${this.config.settings.showImages ? 'checked' : ''}>
                                    <label class="custom-control-label" for="show-images">Mostrar imágenes de productos</label>
                                </div>
                            </div>
                            
                            <div class="form-group">
                                <label for="date-format">Formato de fecha</label>
                                <select class="form-control" id="date-format">
                                    <option value="DD/MM/YYYY" ${this.config.settings.dateFormat === 'DD/MM/YYYY' ? 'selected' : ''}>DD/MM/YYYY</option>
                                    <option value="MM/DD/YYYY" ${this.config.settings.dateFormat === 'MM/DD/YYYY' ? 'selected' : ''}>MM/DD/YYYY</option>
                                    <option value="YYYY-MM-DD" ${this.config.settings.dateFormat === 'YYYY-MM-DD' ? 'selected' : ''}>YYYY-MM-DD</option>
                                </select>
                            </div>
                            
                            <div class="form-group">
                                <label for="currency-format">Formato de moneda</label>
                                <select class="form-control" id="currency-format">
                                    <option value="$ #,##0.00" ${this.config.settings.currencyFormat === '$ #,##0.00' ? 'selected' : ''}>$ 1,234.56</option>
                                    <option value="$#,##0.00" ${this.config.settings.currencyFormat === '$#,##0.00' ? 'selected' : ''}>$1,234.56</option>
                                    <option value="# ###,## $" ${this.config.settings.currencyFormat === '# ###,## $' ? 'selected' : ''}>1 234,56 $</option>
                                </select>
                            </div>
                            
                            <div class="form-group">
                                <label for="rows-per-page">Filas por página en tablas</label>
                                <select class="form-control" id="rows-per-page">
                                    <option value="10" ${this.config.settings.rowsPerPage === 10 ? 'selected' : ''}>10</option>
                                    <option value="25" ${this.config.settings.rowsPerPage === 25 ? 'selected' : ''}>25</option>
                                    <option value="50" ${this.config.settings.rowsPerPage === 50 ? 'selected' : ''}>50</option>
                                    <option value="100" ${this.config.settings.rowsPerPage === 100 ? 'selected' : ''}>100</option>
                                </select>
                            </div>
                        </div>
                    </div>
                    
                    <div class="row mt-4">
                        <div class="col-md-12">
                            <h6>Disposición de Ventanas</h6>
                            
                            <div class="form-group">
                                <label for="default-view">Vista predeterminada al iniciar</label>
                                <select class="form-control" id="default-view">
                                    <option value="dashboard" ${this.config.settings.defaultView === 'dashboard' ? 'selected' : ''}>Dashboard</option>
                                    <option value="facturador" ${this.config.settings.defaultView === 'facturador' ? 'selected' : ''}>Facturador</option>
                                    <option value="ventas" ${this.config.settings.defaultView === 'ventas' ? 'selected' : ''}>Ventas</option>
                                    <option value="productos" ${this.config.settings.defaultView === 'productos' ? 'selected' : ''}>Productos</option>
                                </select>
                            </div>
                            
                            <div class="form-group">
                                <label>Módulos visibles en Dashboard</label>
                                <div class="dashboard-modules-selector">
                                    <div class="module-option">
                                        <input type="checkbox" id="module-ventas" 
                                            ${this.config.settings.dashboardModules?.ventas ? 'checked' : ''}>
                                        <label for="module-ventas">Ventas</label>
                                    </div>
                                    <div class="module-option">
                                        <input type="checkbox" id="module-productos" 
                                            ${this.config.settings.dashboardModules?.productos ? 'checked' : ''}>
                                        <label for="module-productos">Productos</label>
                                    </div>
                                    <div class="module-option">
                                        <input type="checkbox" id="module-caja" 
                                            ${this.config.settings.dashboardModules?.caja ? 'checked' : ''}>
                                        <label for="module-caja">Caja</label>
                                    </div>
                                    <div class="module-option">
                                        <input type="checkbox" id="module-estadisticas" 
                                            ${this.config.settings.dashboardModules?.estadisticas ? 'checked' : ''}>
                                        <label for="module-estadisticas">Estadísticas</label>
                                    </div>
                                    <div class="module-option">
                                        <input type="checkbox" id="module-stock" 
                                            ${this.config.settings.dashboardModules?.stock ? 'checked' : ''}>
                                        <label for="module-stock">Stock</label>
                                    </div>
                                    <div class="module-option">
                                        <input type="checkbox" id="module-clientes" 
                                            ${this.config.settings.dashboardModules?.clientes ? 'checked' : ''}>
                                        <label for="module-clientes">Clientes</label>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        container.innerHTML = html;
        
        // Inicializamos eventos para configuración de interfaz
        this.initInterfaceSettings();
    }

    /**
     * Inicializa la pestaña de configuración avanzada
     */
    initAdvancedTab() {
        const container = document.getElementById('advanced-content');
        if (!container) return;
        
        let html = `
            <div class="card">
                <div class="card-header">
                    <h5>Configuración Avanzada</h5>
                    <p class="text-muted">Opciones avanzadas para personalizar la interfaz</p>
                </div>
                <div class="card-body">
                    <div class="row">
                        <div class="col-md-12">
                            <h6>CSS Personalizado</h6>
                            <p class="text-muted">Añada reglas CSS personalizadas para modificar la apariencia del sistema.</p>
                            
                            <div class="form-group">
                                <div class="custom-control custom-switch">
                                    <input type="checkbox" class="custom-control-input" id="enable-custom-css" 
                                        ${this.config.customCss ? 'checked' : ''}>
                                    <label class="custom-control-label" for="enable-custom-css">Activar CSS personalizado</label>
                                </div>
                            </div>
                            
                            <div id="custom-css-editor" class="${this.config.customCss ? '' : 'd-none'}">
                                <div class="form-group">
                                    <label for="custom-css">Código CSS</label>
                                    <textarea class="form-control code-editor" id="custom-css" rows="10">${this.config.customCss || ''}</textarea>
                                    <small class="form-text text-muted">
                                        Use este campo para añadir estilos CSS personalizados. Los cambios se aplican al guardar la configuración.
                                    </small>
                                </div>
                                
                                <div class="css-examples mt-3">
                                    <h6>Ejemplos de CSS</h6>
                                    <div class="css-example-item">
                                        <button class="btn btn-sm btn-outline-secondary css-example-btn" data-css=".sidebar { background: linear-gradient(180deg, #1a237e, #3949ab); }">
                                            Degradado en Sidebar
                                        </button>
                                    </div>
                                    <div class="css-example-item">
                                        <button class="btn btn-sm btn-outline-secondary css-example-btn" data-css=".btn-primary { border-radius: 20px; }">
                                            Botones Redondeados
                                        </button>
                                    </div>
                                    <div class="css-example-item">
                                        <button class="btn btn-sm btn-outline-secondary css-example-btn" data-css=".dashboard-card { box-shadow: 0 8px 16px rgba(0,0,0,0.1); }">
                                            Sombras Profundas
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="card mt-3">
                <div class="card-header">
                    <h5>Exportar/Importar Configuración</h5>
                </div>
                <div class="card-body">
                    <p>Guarde su configuración actual para respaldo o transferencia a otra sucursal.</p>
                    
                    <div class="config-actions">
                        <button id="export-config" class="btn btn-outline-primary">
                            <i class="fas fa-download"></i> Exportar Configuración
                        </button>
                        <button id="import-config" class="btn btn-outline-secondary">
                            <i class="fas fa-upload"></i> Importar Configuración
                        </button>
                        <input type="file" id="import-config-file" style="display:none" accept="application/json">
                    </div>
                    
                    <div class="form-group mt-3">
                        <div class="custom-control custom-checkbox">
                            <input type="checkbox" class="custom-control-input" id="sync-config-across-sucursales">
                            <label class="custom-control-label" for="sync-config-across-sucursales">
                                Sincronizar esta configuración con todas las sucursales
                            </label>
                        </div>
                        <small class="form-text text-muted">
                            Si se activa, esta configuración visual se aplicará a todas las sucursales al guardarse.
                        </small>
                    </div>
                </div>
            </div>
        `;
        
        container.innerHTML = html;
        
        // Inicializamos eventos para configuración avanzada
        this.initAdvancedSettings();
    }

    /**
     * Inicializa los selectores de color y sus eventos
     */
    initColorPickers() {
        // Actualizamos las previsualizaciones de color
        const colorInputs = document.querySelectorAll('.color-input');
        
        colorInputs.forEach(input => {
            const colorName = input.dataset.colorName;
            const preview = document.getElementById(`preview-${colorName}`);
            
            if (preview) {
                preview.style.backgroundColor = input.value;
            }
            
            // Usar colorpicker (suponiendo que se usa bootstrap-colorpicker o similar)
            $(input).colorpicker({
                format: 'hex'
            }).on('colorpickerChange', (event) => {
                const color = event.color.toString();
                
                // Actualizamos el preview
                if (preview) {
                    preview.style.backgroundColor = color;
                }
                
                // Actualizamos la config
                this.config.colors[colorName] = color;
                
                // Actualizamos la vista previa general
                this.updateColorPreview();
            });
            
            // Guardamos referencia al colorpicker
            this.colorPickers[colorName] = $(input).colorpicker();
        });
    }

    /**
     * Actualiza la vista previa de colores en la interfaz
     */
    updateColorPreview() {
        // Actualizamos los elementos del preview
        const previewElements = {
            'primary': document.getElementById('preview-primary-element'),
            'secondary': document.getElementById('preview-secondary-element'),
            'accent': document.getElementById('preview-accent-element'),
            'text': document.getElementById('preview-text-element'),
            'background': document.getElementById('preview-main-element'),
            'sidebar': document.getElementById('preview-sidebar-element'),
            'header': document.getElementById('preview-header-element')
        };
        
        // Aplicamos los colores a los elementos correspondientes
        for (const [colorName, element] of Object.entries(previewElements)) {
            if (element && this.config.colors[colorName]) {
                if (colorName === 'text') {
                    element.style.color = this.config.colors[colorName];
                } else {
                    element.style.backgroundColor = this.config.colors[colorName];
                    
                    // Si es un color oscuro, usar texto claro
                    if (this.isColorDark(this.config.colors[colorName])) {
                        element.classList.add('text-white');
                        element.classList.remove('text-dark');
                    } else {
                        element.classList.add('text-dark');
                        element.classList.remove('text-white');
                    }
                }
            }
        }
    }

    /**
     * Determina si un color es oscuro o claro
     * @param {string} color - Color en formato hexadecimal
     * @returns {boolean} true si el color es oscuro
     */
    isColorDark(color) {
        // Convertimos hex a RGB
        const hex = color.replace('#', '');
        const r = parseInt(hex.substr(0, 2), 16);
        const g = parseInt(hex.substr(2, 2), 16);
        const b = parseInt(hex.substr(4, 2), 16);
        
        // Calculamos la luminosidad
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        
        // Si la luminosidad es menor a 0.5, es un color oscuro
        return luminance < 0.5;
    }

    /**
     * Inicializa los botones de temas predefinidos
     */
    initThemeButtons() {
        const themeButtons = document.querySelectorAll('.theme-button');
        
        const themes = {
            'blue': {
                primary: '#0d47a1',
                secondary: '#2196f3',
                accent: '#03a9f4',
                text: '#212121',
                background: '#f5f5f5',
                sidebar: '#1565c0',
                header: '#1976d2'
            },
            'green': {
                primary: '#2e7d32',
                secondary: '#4caf50',
                accent: '#8bc34a',
                text: '#212121',
                background: '#f5f5f5',
                sidebar: '#1b5e20',
                header: '#388e3c'
            },
            'purple': {
                primary: '#6a1b9a',
                secondary: '#9c27b0',
                accent: '#e040fb',
                text: '#212121',
                background: '#f5f5f5',
                sidebar: '#4a148c',
                header: '#7b1fa2'
            },
            'red': {
                primary: '#b71c1c',
                secondary: '#f44336',
                accent: '#ff5722',
                text: '#212121',
                background: '#f5f5f5',
                sidebar: '#8e0000',
                header: '#c62828'
            },
            'dark': {
                primary: '#263238',
                secondary: '#455a64',
                accent: '#607d8b',
                text: '#ffffff',
                background: '#121212',
                sidebar: '#161616',
                header: '#202020'
            }
        };
        
        themeButtons.forEach(button => {
            button.addEventListener('click', () => {
                const theme = button.dataset.theme;
                
                if (themes[theme]) {
                    // Aplicamos el tema
                    this.config.colors = {...themes[theme]};
                    
                    // Actualizamos los inputs de color
                    for (const [colorName, colorValue] of Object.entries(this.config.colors)) {
                        const colorInput = document.getElementById(`color-${colorName}`);
                        const preview = document.getElementById(`preview-${colorName}`);
                        
                        if (colorInput) {
                            colorInput.value = colorValue;
                            
                            // Actualizamos el colorpicker
                            if (this.colorPickers[colorName]) {
                                this.colorPickers[colorName].colorpicker('setValue', colorValue);
                            }
                            
                            // Actualizamos el preview
                            if (preview) {
                                preview.style.backgroundColor = colorValue;
                            }
                        }
                    }
                    
                    // Actualizamos la vista previa general
                    this.updateColorPreview();
                    
                    // Mostramos notificación
                    Swal.fire({
                        title: 'Tema Aplicado',
                        text: `Se ha aplicado el tema ${theme.charAt(0).toUpperCase() + theme.slice(1)}`,
                        icon: 'success',
                        toast: true,
                        position: 'top-end',
                        showConfirmButton: false,
                        timer: 2000
                    });
                }
            });
        });
    }

    /**
     * Inicializa eventos para la carga del logo
     */
    initLogoUpload() {
        const selectLogoBtn = document.getElementById('select-logo');
        const removeLogoBtn = document.getElementById('remove-logo');
        const logoFileInput = document.getElementById('logo-file-input');
        const logoPreviewContainer = document.getElementById('logo-preview');
        
        if (selectLogoBtn && logoFileInput) {
            // Evento para seleccionar archivo
            selectLogoBtn.addEventListener('click', () => {
                logoFileInput.click();
            });
            
            // Evento cuando se selecciona un archivo
            logoFileInput.addEventListener('change', async (event) => {
                if (event.target.files && event.target.files[0]) {
                    const file = event.target.files[0];
                    
                    // Validamos formato y tamaño
                    const validTypes = ['image/png', 'image/jpeg', 'image/svg+xml'];
                    if (!validTypes.includes(file.type)) {
                        Swal.fire({
                            title: 'Formato no válido',
                            text: 'Por favor seleccione un archivo PNG, JPEG o SVG',
                            icon: 'error'
                        });
                        return;
                    }
                    
                    if (file.size > 2 * 1024 * 1024) { // 2MB max
                        Swal.fire({
                            title: 'Archivo demasiado grande',
                            text: 'El tamaño máximo permitido es 2MB',
                            icon: 'error'
                        });
                        return;
                    }
                    
                    try {
                        // Crear directorio si no existe
                        const logoDir = path.join(this.rootPath, 'app', 'assets', 'img', 'company');
                        if (!fs.existsSync(logoDir)) {
                            fs.mkdirSync(logoDir, { recursive: true });
                        }
                        
                        // Nombre de archivo único
                        const sucursalId = ipcRenderer.sendSync('get-current-sucursal');
                        const fileExt = path.extname(file.name);
                        const fileName = `logo_${sucursalId}_${Date.now()}${fileExt}`;
                        const destPath = path.join(logoDir, fileName);
                        
                        // Leer el archivo y guardar en destino
                        const buffer = await file.arrayBuffer();
                        fs.writeFileSync(destPath, Buffer.from(buffer));
                        
                        // Actualizamos la configuración
                        const relativePath = path.join('..', 'assets', 'img', 'company', fileName).replace(/\\/g, '/');
                        this.config.logoPath = relativePath;
                        
                        // Actualizamos la vista previa
                        logoPreviewContainer.innerHTML = `<img src="${relativePath}" alt="Logo de la empresa" id="logo-preview-img">`;
                        
                        // Activamos botón de eliminar
                        removeLogoBtn.disabled = false;
                        
                        // Actualizamos vista previa en el documento
                        const documentLogo = document.getElementById('document-logo');
                        if (documentLogo) {
                            documentLogo.innerHTML = `<img src="${relativePath}" alt="Logo" class="logo-${this.config.settings.logoSize || 'medium'}">`;
                        }
                        
                        logger.log('info', 'Logo actualizado', { 
                            user: this.currentUser.username,
                            fileName: fileName
                        });
                    } catch (error) {
                        logger.log('error', 'Error al guardar logo', { error: error.message });
                        Swal.fire({
                            title: 'Error',
                            text: 'No se pudo guardar el logo: ' + error.message,
                            icon: 'error'
                        });
                    }
                }
            });
        }
        
        if (removeLogoBtn) {
            // Evento para eliminar logo
            removeLogoBtn.addEventListener('click', () => {
                Swal.fire({
                    title: '¿Eliminar logo?',
                    text: 'Esta acción eliminará el logo actual',
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonText: 'Sí, eliminar',
                    cancelButtonText: 'Cancelar'
                }).then((result) => {
                    if (result.isConfirmed) {
                        try {
                            // Eliminar archivo si existe y no es una URL externa
                            if (this.config.logoPath && this.config.logoPath.startsWith('..')) {
                                const fullPath = path.join(this.rootPath, 'app', this.config.logoPath.replace(/^\.\.\//, ''));
                                if (fs.existsSync(fullPath)) {
                                    fs.unlinkSync(fullPath);
                                }
                            }
                            
                            // Actualizar configuración
                            this.config.logoPath = '';
                            
                            // Actualizar vista previa
                            logoPreviewContainer.innerHTML = `
                                <div class="no-logo">
                                    <i class="fas fa-image"></i>
                                    <p>No hay logo cargado</p>
                                </div>
                            `;
                            
                            // Desactivar botón de eliminar
                            removeLogoBtn.disabled = true;
                            
                            // Actualizamos vista previa en el documento
                            const documentLogo = document.getElementById('document-logo');
                            if (documentLogo) {
                                documentLogo.innerHTML = `<div class="no-logo-placeholder"></div>`;
                            }
                            
                            logger.log('info', 'Logo eliminado', { 
                                user: this.currentUser.username
                            });
                            
                            Swal.fire({
                                title: 'Logo eliminado',
                                icon: 'success',
                                toast: true,
                                position: 'top-end',
                                showConfirmButton: false,
                                timer: 2000
                            });
                        } catch (error) {
                            logger.log('error', 'Error al eliminar logo', { error: error.message });
                            Swal.fire({
                                title: 'Error',
                                text: 'No se pudo eliminar el logo: ' + error.message,
                                icon: 'error'
                            });
                        }
                    }
                });
            });
        }
    }

    /**
     * Inicializa eventos para opciones de logo
     */
    initLogoOptions() {
        const logoPosition = document.getElementById('logo-position');
        const logoSize = document.getElementById('logo-size');
        const showLogoInDashboard = document.getElementById('show-logo-in-dashboard');
        const showLogoInLogin = document.getElementById('show-logo-in-login');
        
        // Evento para cambio de posición del logo
        if (logoPosition) {
            logoPosition.addEventListener('change', () => {
                this.config.settings.logoPosition = logoPosition.value;
                this.updateDocumentPreview();
            });
        }
        
        // Evento para cambio de tamaño del logo
        if (logoSize) {
            logoSize.addEventListener('change', () => {
                this.config.settings.logoSize = logoSize.value;
                this.updateDocumentPreview();
            });
        }
        
        // Evento para mostrar logo en dashboard
        if (showLogoInDashboard) {
            showLogoInDashboard.addEventListener('change', () => {
                this.config.settings.showLogoInDashboard = showLogoInDashboard.checked;
            });
        }
        
        // Evento para mostrar logo en login
        if (showLogoInLogin) {
            showLogoInLogin.addEventListener('change', () => {
                this.config.settings.showLogoInLogin = showLogoInLogin.checked;
            });
        }
    }

    /**
     * Actualiza la vista previa del documento según la configuración
     */
    updateDocumentPreview() {
        const documentLogo = document.getElementById('document-logo');
        const documentPreview = document.getElementById('document-preview');
        
        if (documentLogo && documentPreview) {
            // Actualizar imagen del logo
            if (this.config.logoPath) {
                documentLogo.innerHTML = `<img src="${this.config.logoPath}" alt="Logo" class="logo-${this.config.settings.logoSize || 'medium'}">`;
            } else {
                documentLogo.innerHTML = `<div class="no-logo-placeholder"></div>`;
            }
            
            // Actualizar posición del logo
            documentPreview.className = `document-preview logo-position-${this.config.settings.logoPosition || 'top-left'}`;
        }
    }

    /**
     * Inicializa eventos para selección de plantillas
     */
    initTemplateSelectors() {
        const templateOptions = document.querySelectorAll('.template-option');
        
        templateOptions.forEach(option => {
            option.addEventListener('click', () => {
                const template = option.dataset.template;
                const variant = option.dataset.variant;
                
                // Desactivamos todas las opciones de ese tipo de plantilla
                const siblings = document.querySelectorAll(`.template-option[data-template="${template}"]`);
                siblings.forEach(sibling => sibling.classList.remove('active'));
                
                // Activamos la opción seleccionada
                option.classList.add('active');
                
                // Guardamos la selección en la configuración
                this.config.templateVariants[template] = variant;
                
                // Mostramos notificación
                Swal.fire({
                    title: 'Plantilla Seleccionada',
                    text: `Se ha seleccionado la plantilla ${variant} para ${template}`,
                    icon: 'success',
                    toast: true,
                    position: 'top-end',
                    showConfirmButton: false,
                    timer: 1500
                });
            });
        });
        
        // Evento para activar/desactivar plantillas personalizadas
        const enableCustomTemplate = document.getElementById('enable-custom-template');
        const customTemplateEditor = document.getElementById('custom-template-editor');
        
        if (enableCustomTemplate && customTemplateEditor) {
            enableCustomTemplate.addEventListener('change', () => {
                this.config.settings.enableCustomTemplate = enableCustomTemplate.checked;
                
                if (enableCustomTemplate.checked) {
                    customTemplateEditor.classList.remove('d-none');
                } else {
                    customTemplateEditor.classList.add('d-none');
                }
            });
        }
    }

    /**
     * Inicializa el editor de plantillas personalizadas
     */
    initCustomTemplateEditor() {
        const templateSelector = document.getElementById('template-selector');
        const customHtmlEditor = document.getElementById('custom-html-editor');
        const saveCustomTemplate = document.getElementById('save-custom-template');
        const resetCustomTemplate = document.getElementById('reset-custom-template');
        const previewCustomTemplate = document.getElementById('preview-custom-template');
        const showVariables = document.getElementById('show-variables');
        
        if (!templateSelector || !customHtmlEditor) return;
        
        // Cargar plantilla actual al cambiar selector
        templateSelector.addEventListener('change', async () => {
            try {
                const templateName = templateSelector.value;
                const template = await this.loadCustomTemplate(templateName);
                customHtmlEditor.value = template;
            } catch (error) {
                logger.log('error', 'Error al cargar plantilla personalizada', { error: error.message });
                Swal.fire({
                    title: 'Error',
                    text: 'No se pudo cargar la plantilla: ' + error.message,
                    icon: 'error'
                });
            }
        });
        
        // Inicializar con la primera plantilla
        if (templateSelector.value) {
            this.loadCustomTemplate(templateSelector.value)
                .then(template => {
                    customHtmlEditor.value = template;
                })
                .catch(error => {
                    logger.log('error', 'Error al cargar plantilla inicial', { error: error.message });
                });
        }
        
        // Guardar plantilla personalizada
        if (saveCustomTemplate) {
            saveCustomTemplate.addEventListener('click', async () => {
                try {
                    const templateName = templateSelector.value;
                    const htmlContent = customHtmlEditor.value;
                    
                    await this.saveCustomTemplate(templateName, htmlContent);
                    
                    Swal.fire({
                        title: 'Plantilla Guardada',
                        text: 'La plantilla personalizada ha sido guardada exitosamente',
                        icon: 'success',
                        toast: true,
                        position: 'top-end',
                        showConfirmButton: false,
                        timer: 2000
                    });
                } catch (error) {
                    logger.log('error', 'Error al guardar plantilla personalizada', { error: error.message });
                    Swal.fire({
                        title: 'Error',
                        text: 'No se pudo guardar la plantilla: ' + error.message,
                        icon: 'error'
                    });
                }
            });
        }
        
        // Resetear plantilla
        if (resetCustomTemplate) {
            resetCustomTemplate.addEventListener('click', async () => {
                try {
                    const templateName = templateSelector.value;
                    
                    Swal.fire({
                        title: '¿Restaurar plantilla?',
                        text: 'Se restaurará la plantilla predeterminada. Los cambios personalizados se perderán.',
                        icon: 'warning',
                        showCancelButton: true,
                        confirmButtonText: 'Sí, restaurar',
                        cancelButtonText: 'Cancelar'
                    }).then(async (result) => {
                        if (result.isConfirmed) {
                            await this.resetCustomTemplate(templateName);
                            const template = await this.loadCustomTemplate(templateName);
                            customHtmlEditor.value = template;
                            
                            Swal.fire({
                                title: 'Plantilla Restaurada',
                                text: 'Se ha restaurado la plantilla predeterminada',
                                icon: 'success',
                                toast: true,
                                position: 'top-end',
                                showConfirmButton: false,
                                timer: 2000
                            });
                        }
                    });
                } catch (error) {
                    logger.log('error', 'Error al restaurar plantilla', { error: error.message });
                    Swal.fire({
                        title: 'Error',
                        text: 'No se pudo restaurar la plantilla: ' + error.message,
                        icon: 'error'
                    });
                }
            });
        }
        
        // Mostrar vista previa
        if (previewCustomTemplate) {
            previewCustomTemplate.addEventListener('click', () => {
                const templateName = templateSelector.value;
                const htmlContent = customHtmlEditor.value;
                
                // Mostramos vista previa en ventana emergente
                const previewWindow = window.open('', 'preview', 'width=800,height=600');
                if (previewWindow) {
                    previewWindow.document.write(`
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <title>Vista Previa - ${templateName}</title>
                            <meta charset="utf-8">
                            <style>
                                body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
                                .preview-note { background: #f8f9fa; padding: 10px; margin-bottom: 20px; border-left: 4px solid #007bff; }
                            </style>
                        </head>
                        <body>
                            <div class="preview-note">
                                <h3>Vista Previa de Plantilla</h3>
                                <p>Las variables no se renderizan en esta vista previa. 
                                Se muestran las etiquetas de variables como {{variable}}.</p>
                            </div>
                            ${htmlContent}
                        </body>
                        </html>
                    `);
                    previewWindow.document.close();
                } else {
                    Swal.fire({
                        title: 'Error',
                        text: 'No se pudo abrir la ventana de vista previa. Verifique que no esté bloqueada por el navegador.',
                        icon: 'error'
                    });
                }
            });
        }
        
        // Mostrar variables disponibles
        if (showVariables) {
            showVariables.addEventListener('click', (e) => {
                e.preventDefault();
                
                const templateName = templateSelector.value;
                let variables = [];
                
                // Variables según tipo de plantilla
                switch (templateName) {
                    case 'facturaA4':
                    case 'facturaTicket':
                        variables = [
                            '{{empresa_nombre}}', '{{empresa_cuit}}', '{{empresa_direccion}}',
                            '{{cliente_nombre}}', '{{cliente_documento}}', '{{cliente_direccion}}',
                            '{{factura_numero}}', '{{factura_fecha}}', '{{factura_tipo}}',
                            '{{item_descripcion}}', '{{item_cantidad}}', '{{item_precio}}', '{{item_subtotal}}',
                            '{{total_bruto}}', '{{total_iva}}', '{{total_final}}'
                        ];
                        break;
                    case 'remito':
                        variables = [
                            '{{empresa_nombre}}', '{{empresa_cuit}}', '{{empresa_direccion}}',
                            '{{cliente_nombre}}', '{{cliente_documento}}', '{{cliente_direccion}}',
                            '{{remito_numero}}', '{{remito_fecha}}',
                            '{{item_descripcion}}', '{{item_cantidad}}'
                        ];
                        break;
                    case 'notaCredito':
                    case 'notaDebito':
                        variables = [
                            '{{empresa_nombre}}', '{{empresa_cuit}}', '{{empresa_direccion}}',
                            '{{cliente_nombre}}', '{{cliente_documento}}', '{{cliente_direccion}}',
                            '{{nota_numero}}', '{{nota_fecha}}', '{{nota_tipo}}', '{{factura_referencia}}',
                            '{{item_descripcion}}', '{{item_cantidad}}', '{{item_precio}}', '{{item_subtotal}}',
                            '{{total_bruto}}', '{{total_iva}}', '{{total_final}}'
                        ];
                        break;
                }
                
                Swal.fire({
                    title: 'Variables Disponibles',
                    html: `
                        <div class="variables-list">
                            <p>Puede utilizar las siguientes variables en su plantilla:</p>
                            <ul class="list-group">
                                ${variables.map(v => `<li class="list-group-item">${v}</li>`).join('')}
                            </ul>
                        </div>
                    `,
                    width: '600px'
                });
            });
        }
    }

    /**
     * Carga una plantilla personalizada
     * @param {string} templateName - Nombre de la plantilla
     * @returns {Promise<string>} - HTML de la plantilla
     */
    async loadCustomTemplate(templateName) {
        try {
            // Obtener la plantilla personalizada de la base de datos
            const sucursalId = ipcRenderer.sendSync('get-current-sucursal');
            
            const customTemplate = await this.db.custom_templates.findOne({
                where: {
                    sucursalId: sucursalId,
                    templateName: templateName
                }
            });
            
            if (customTemplate) {
                return customTemplate.htmlContent;
            } else {
                // Si no existe, cargar la plantilla predeterminada
                const defaultTemplateFile = path.join(
                    this.rootPath, 
                    'app', 
                    'templates', 
                    `${templateName}_default.html`
                );
                
                if (fs.existsSync(defaultTemplateFile)) {
                    return fs.readFileSync(defaultTemplateFile, 'utf8');
                } else {
                    return '<!-- Plantilla predeterminada no encontrada -->';
                }
            }
        } catch (error) {
            logger.log('error', 'Error al cargar plantilla', { 
                templateName: templateName,
                error: error.message 
            });
            throw new Error(`Error al cargar plantilla: ${error.message}`);
        }
    }

    /**
     * Guarda una plantilla personalizada
     * @param {string} templateName - Nombre de la plantilla
     * @param {string} htmlContent - Contenido HTML de la plantilla
     */
    async saveCustomTemplate(templateName, htmlContent) {
        try {
            const sucursalId = ipcRenderer.sendSync('get-current-sucursal');
            
            await this.db.custom_templates.upsert({
                sucursalId: sucursalId,
                templateName: templateName,
                htmlContent: htmlContent,
                updatedBy: this.currentUser.id,
                updatedAt: new Date()
            });
            
            logger.log('info', 'Plantilla personalizada guardada', { 
                user: this.currentUser.username,
                templateName: templateName
            });
            
            return true;
        } catch (error) {
            logger.log('error', 'Error al guardar plantilla personalizada', { 
                templateName: templateName,
                error: error.message 
            });
            throw new Error(`Error al guardar plantilla: ${error.message}`);
        }
    }

    /**
     * Restaura una plantilla a su valor predeterminado
     * @param {string} templateName - Nombre de la plantilla
     */
    async resetCustomTemplate(templateName) {
        try {
            const sucursalId = ipcRenderer.sendSync('get-current-sucursal');
            
            // Eliminar plantilla personalizada
            await this.db.custom_templates.destroy({
                where: {
                    sucursalId: sucursalId,
                    templateName: templateName
                }
            });
            
            logger.log('info', 'Plantilla restaurada a predeterminada', { 
                user: this.currentUser.username,
                templateName: templateName
            });
            
            return true;
        } catch (error) {
            logger.log('error', 'Error al restaurar plantilla', { 
                templateName: templateName,
                error: error.message 
            });
            throw new Error(`Error al restaurar plantilla: ${error.message}`);
        }
    }

    /**
     * Inicializa eventos para configuración de interfaz
     */
    initInterfaceSettings() {
        // Capturar elementos
        const darkMode = document.getElementById('dark-mode');
        const fontSize = document.getElementById('font-size');
        const compactMode = document.getElementById('compact-mode');
        const animationsEnabled = document.getElementById('animations-enabled');
        const showImages = document.getElementById('show-images');
        const dateFormat = document.getElementById('date-format');
        const currencyFormat = document.getElementById('currency-format');
        const rowsPerPage = document.getElementById('rows-per-page');
        const defaultView = document.getElementById('default-view');
        
        // Eventos para cambios en la configuración
        if (darkMode) {
            darkMode.addEventListener('change', () => {
                this.config.settings.darkMode = darkMode.checked;
            });
        }
        
        if (fontSize) {
            fontSize.addEventListener('change', () => {
                this.config.settings.fontSize = fontSize.value;
            });
        }
        
        if (compactMode) {
            compactMode.addEventListener('change', () => {
                this.config.settings.compactMode = compactMode.checked;
            });
        }
        
        if (animationsEnabled) {
            animationsEnabled.addEventListener('change', () => {
                this.config.settings.animationsEnabled = animationsEnabled.checked;
            });
        }
        
        if (showImages) {
            showImages.addEventListener('change', () => {
                this.config.settings.showImages = showImages.checked;
            });
        }
        
        if (dateFormat) {
            dateFormat.addEventListener('change', () => {
                this.config.settings.dateFormat = dateFormat.value;
            });
        }
        
        if (currencyFormat) {
            currencyFormat.addEventListener('change', () => {
                this.config.settings.currencyFormat = currencyFormat.value;
            });
        }
        
        if (rowsPerPage) {
            rowsPerPage.addEventListener('change', () => {
                this.config.settings.rowsPerPage = parseInt(rowsPerPage.value);
            });
        }
        
        if (defaultView) {
            defaultView.addEventListener('change', () => {
                this.config.settings.defaultView = defaultView.value;
            });
        }
        
        // Eventos para módulos de dashboard
        const dashboardModules = [
            'ventas', 'productos', 'caja', 'estadisticas', 'stock', 'clientes'
        ];
        
        dashboardModules.forEach(module => {
            const checkbox = document.getElementById(`module-${module}`);
            if (checkbox) {
                checkbox.addEventListener('change', () => {
                    if (!this.config.settings.dashboardModules) {
                        this.config.settings.dashboardModules = {};
                    }
                    this.config.settings.dashboardModules[module] = checkbox.checked;
                });
            }
        });
    }

    /**
     * Inicializa eventos para configuración avanzada
     */
    initAdvancedSettings() {
        const enableCustomCss = document.getElementById('enable-custom-css');
        const customCssEditor = document.getElementById('custom-css-editor');
        const customCssField = document.getElementById('custom-css');
        const cssExampleButtons = document.querySelectorAll('.css-example-btn');
        const exportConfigBtn = document.getElementById('export-config');
        const importConfigBtn = document.getElementById('import-config');
        const importConfigFile = document.getElementById('import-config-file');
        const syncConfigCheckbox = document.getElementById('sync-config-across-sucursales');
        
        // Evento para activar/desactivar CSS personalizado
        if (enableCustomCss && customCssEditor) {
            enableCustomCss.addEventListener('change', () => {
                if (enableCustomCss.checked) {
                    customCssEditor.classList.remove('d-none');
                } else {
                    customCssEditor.classList.add('d-none');
                    
                    // Si se desactiva, limpiamos el CSS personalizado
                    if (customCssField) {
                        customCssField.value = '';
                        this.config.customCss = '';
                    }
                }
            });
        }
        
        // Evento para actualizar el CSS personalizado
        if (customCssField) {
            customCssField.addEventListener('input', () => {
                this.config.customCss = customCssField.value;
            });
        }
        
        // Ejemplos de CSS
        if (cssExampleButtons) {
            cssExampleButtons.forEach(button => {
                button.addEventListener('click', () => {
                    const cssExample = button.dataset.css;
                    
                    if (customCssField) {
                        // Añadir al final del CSS actual
                        customCssField.value += '\n\n' + cssExample;
                        this.config.customCss = customCssField.value;
                    }
                });
            });
        }
        
        // Exportar configuración
        if (exportConfigBtn) {
            exportConfigBtn.addEventListener('click', () => {
                try {
                    // Crear un objeto JSON con la configuración
                    const configData = {
                        colors: this.config.colors,
                        settings: this.config.settings,
                        templateVariants: this.config.templateVariants,
                        customCss: this.config.customCss,
                        exportedAt: new Date().toISOString(),
                        exportedBy: this.currentUser.username
                    };
                    
                    // Convertir a JSON
                    const jsonConfig = JSON.stringify(configData, null, 2);
                    
                    // Crear un Blob
                    const blob = new Blob([jsonConfig], { type: 'application/json' });
                    
                    // Crear un enlace temporal para descargar
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `factusystem_config_${new Date().toISOString().slice(0,10)}.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    
                    logger.log('info', 'Configuración visual exportada', { 
                        user: this.currentUser.username 
                    });
                    
                    Swal.fire({
                        title: 'Configuración Exportada',
                        text: 'Se ha descargado un archivo con la configuración actual',
                        icon: 'success',
                        toast: true,
                        position: 'top-end',
                        showConfirmButton: false,
                        timer: 2000
                    });
                } catch (error) {
                    logger.log('error', 'Error al exportar configuración', { error: error.message });
                    Swal.fire({
                        title: 'Error',
                        text: 'No se pudo exportar la configuración: ' + error.message,
                        icon: 'error'
                    });
                }
            });
        }
        
        // Importar configuración
        if (importConfigBtn && importConfigFile) {
            importConfigBtn.addEventListener('click', () => {
                importConfigFile.click();
            });
            
            importConfigFile.addEventListener('change', (event) => {
                if (event.target.files && event.target.files[0]) {
                    const file = event.target.files[0];
                    
                    if (file.type !== 'application/json') {
                        Swal.fire({
                            title: 'Formato no válido',
                            text: 'Por favor seleccione un archivo JSON de configuración',
                            icon: 'error'
                        });
                        return;
                    }
                    
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        try {
                            const configData = JSON.parse(e.target.result);
                            
                            // Validar el archivo de configuración
                            if (!configData.colors || !configData.settings || !configData.templateVariants) {
                                throw new Error('El archivo no contiene una configuración válida');
                            }
                            
                            // Confirmar la importación
                            Swal.fire({
                                title: '¿Importar configuración?',
                                text: 'Se reemplazará la configuración actual por la del archivo',
                                icon: 'warning',
                                showCancelButton: true,
                                confirmButtonText: 'Sí, importar',
                                cancelButtonText: 'Cancelar'
                            }).then((result) => {
                                if (result.isConfirmed) {
                                    // Actualizar la configuración
                                    this.config.colors = configData.colors;
                                    this.config.settings = configData.settings;
                                    this.config.templateVariants = configData.templateVariants;
                                    this.config.customCss = configData.customCss || '';
                                    
                                    // Reiniciar la interfaz para reflejar los cambios
                                    this.initInterface();
                                    
                                    logger.log('info', 'Configuración visual importada', { 
                                        user: this.currentUser.username 
                                    });
                                    
                                    Swal.fire({
                                        title: 'Configuración Importada',
                                        text: 'La configuración ha sido importada exitosamente',
                                        icon: 'success'
                                    });
                                }
                            });
                        } catch (error) {
                            logger.log('error', 'Error al importar configuración', { error: error.message });
                            Swal.fire({
                                title: 'Error',
                                text: 'No se pudo importar la configuración: ' + error.message,
                                icon: 'error'
                            });
                        }
                    };
                    reader.readAsText(file);
                }
            });
        }
    }

    /**
     * Configura los eventos para guardar y restaurar configuración
     */
    setupEventListeners() {
        const saveBtn = document.getElementById('save-visual-config');
        const resetBtn = document.getElementById('reset-visual-config');
        
        if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
                try {
                    await this.saveConfig();
                    this.applyVisualConfig();
                    
                    Swal.fire({
                        title: 'Configuración Guardada',
                        text: 'Los cambios han sido aplicados exitosamente',
                        icon: 'success',
                        confirmButtonText: 'Aceptar'
                    });
                } catch (error) {
                    logger.log('error', 'Error al guardar configuración visual', { error: error.message });
                    Swal.fire({
                        title: 'Error',
                        text: 'No se pudo guardar la configuración: ' + error.message,
                        icon: 'error',
                        confirmButtonText: 'Aceptar'
                    });
                }
            });
        }
        
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                Swal.fire({
                    title: '¿Restaurar Configuración?',
                    text: 'Se restaurará la configuración a los valores predeterminados',
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonText: 'Sí, restaurar',
                    cancelButtonText: 'Cancelar'
                }).then((result) => {
                    if (result.isConfirmed) {
                        // Restaurar a valores predeterminados
                        this.config.colors = {...this.defaultColors};
                        this.config.settings = {...this.defaultSettings};
                        this.config.customCss = '';
                        this.config.templateVariants = {
                            facturaA4: 'default',
                            facturaTicket: 'default',
                            remito: 'default',
                            notaCredito: 'default',
                            notaDebito: 'default'
                        };
                        
                        // Reiniciar la interfaz para reflejar los cambios
                        this.initInterface();
                        
                        logger.log('info', 'Configuración visual restaurada a predeterminada', { 
                            user: this.currentUser.username 
                        });
                        
                        Swal.fire({
                            title: 'Configuración Restaurada',
                            text: 'Se ha restaurado la configuración a los valores predeterminados',
                            icon: 'success',
                            confirmButtonText: 'Aceptar'
                        });
                    }
                });
            });
        }
    }

    /**
     * Aplica la configuración visual actual al sistema
     */
    applyVisualConfig() {
        try {
            // Aplicar colores al CSS de la aplicación
            let cssVars = `:root {\n`;
            for (const [name, value] of Object.entries(this.config.colors)) {
                cssVars += `  --color-${name}: ${value};\n`;
            }
            cssVars += `}\n`;
            
            // Aplicar configuración de tamaño de fuente
            cssVars += `body {\n`;
            
            if (this.config.settings.fontSize === 'small') {
                cssVars += `  font-size: 0.9rem;\n`;
            } else if (this.config.settings.fontSize === 'large') {
                cssVars += `  font-size: 1.1rem;\n`;
            } else {
                cssVars += `  font-size: 1rem;\n`;
            }
            
            cssVars += `}\n`;
            
            // Aplicar modo compacto si está activado
            if (this.config.settings.compactMode) {
                cssVars += `
                .table td, .table th { padding: 0.3rem; }
                .card-body { padding: 0.75rem; }
                .form-group { margin-bottom: 0.5rem; }
                .container-fluid { padding: 0.5rem; }
                `;
            }
            
            // Aplicar modo oscuro si está activado
            if (this.config.settings.darkMode) {
                cssVars += `
                body, .card, .modal-content { 
                    background-color: var(--color-dark);
                    color: var(--color-light);
                }
                .card, .modal-content, .list-group-item {
                    border-color: var(--color-secondary);
                }
                .table, .table th, .table td {
                    color: var(--color-light);
                }
                .table-striped tbody tr:nth-of-type(odd) {
                    background-color: rgba(255, 255, 255, 0.05);
                }
                .nav-link, .navbar-brand {
                    color: var(--color-light);
                }
                .form-control {
                    background-color: var(--color-secondary);
                    color: var(--color-light);
                    border-color: var(--color-accent);
                }
                .text-dark {
                    color: var(--color-light) !important;
                }
                `;
            }
            
            // Añadir CSS personalizado si está habilitado
            if (this.config.customCss && this.config.settings.enableCustomCss) {
                cssVars += this.config.customCss;
            }
            
            // Crear elemento de estilo o actualizar el existente
            let styleEl = document.getElementById('dynamic-visual-style');
            if (!styleEl) {
                styleEl = document.createElement('style');
                styleEl.id = 'dynamic-visual-style';
                document.head.appendChild(styleEl);
            }
            styleEl.textContent = cssVars;
            
            // Guardar configuración en localStorage para persistencia
            localStorage.setItem('visualConfig', JSON.stringify({
                timestamp: new Date().getTime(),
                config: this.config
            }));
            
            // Notificar al proceso principal sobre la configuración actualizada
            ipcRenderer.send('visual-config-updated', this.config);
            
            logger.log('info', 'Configuración visual aplicada', {
                user: this.currentUser ? this.currentUser.username : 'unknown'
            });
            
            return true;
        } catch (error) {
            logger.log('error', 'Error al aplicar configuración visual', { error: error.message });
            throw new Error(`Error al aplicar configuración visual: ${error.message}`);
        }
    }

    /**
     * Guarda la configuración visual en la base de datos
     * @returns {Promise<boolean>} - Resultado de la operación
     */
    async saveConfig() {
        try {
            const sucursalId = ipcRenderer.sendSync('get-current-sucursal');
            
            // Guardar configuración general
            await this.db.visual_config.upsert({
                sucursalId: sucursalId,
                colors: JSON.stringify(this.config.colors),
                settings: JSON.stringify(this.config.settings),
                customCss: this.config.customCss,
                templateVariants: JSON.stringify(this.config.templateVariants),
                updatedBy: this.currentUser.id,
                updatedAt: new Date()
            });
            
            // Sincronizar a otras sucursales si está habilitado
            const syncConfig = document.getElementById('sync-config-across-sucursales');
            if (syncConfig && syncConfig.checked) {
                await this.syncConfigToAllSucursales();
            }
            
            logger.log('info', 'Configuración visual guardada en base de datos', {
                user: this.currentUser.username
            });
            
            return true;
        } catch (error) {
            logger.log('error', 'Error al guardar configuración visual en base de datos', { 
                error: error.message 
            });
            throw new Error(`Error al guardar configuración: ${error.message}`);
        }
    }

    /**
     * Sincroniza la configuración visual a todas las sucursales
     * @returns {Promise<boolean>} - Resultado de la operación
     */
    async syncConfigToAllSucursales() {
        try {
            // Obtener todas las sucursales
            const sucursales = await this.db.sucursales.findAll({
                where: {
                    active: true
                }
            });
            
            const currentSucursalId = ipcRenderer.sendSync('get-current-sucursal');
            
            // Preparar datos para actualización
            const updateData = {
                colors: JSON.stringify(this.config.colors),
                settings: JSON.stringify(this.config.settings),
                customCss: this.config.customCss,
                templateVariants: JSON.stringify(this.config.templateVariants),
                updatedBy: this.currentUser.id,
                updatedAt: new Date()
            };
            
            // Actualizar cada sucursal excepto la actual
            for (const sucursal of sucursales) {
                if (sucursal.id !== currentSucursalId) {
                    await this.db.visual_config.upsert({
                        ...updateData,
                        sucursalId: sucursal.id
                    });
                }
            }
            
            logger.log('info', 'Configuración visual sincronizada a todas las sucursales', {
                user: this.currentUser.username
            });
            
            return true;
        } catch (error) {
            logger.log('error', 'Error al sincronizar configuración a todas las sucursales', { 
                error: error.message 
            });
            throw new Error(`Error al sincronizar configuración: ${error.message}`);
        }
    }

    /**
     * Exporta la configuración visual como un objeto JSON
     * @returns {Object} - Configuración visual completa
     */
    exportConfig() {
        return {
            colors: {...this.config.colors},
            settings: {...this.config.settings},
            templateVariants: {...this.config.templateVariants},
            customCss: this.config.customCss,
            exportedAt: new Date().toISOString(),
            exportedBy: this.currentUser ? this.currentUser.username : 'unknown'
        };
    }

    /**
     * Importa configuración visual desde un objeto JSON
     * @param {Object} configData - Datos de configuración a importar
     * @returns {boolean} - Resultado de la operación
     */
    importConfig(configData) {
        try {
            // Validar configuración
            if (!configData.colors || !configData.settings || !configData.templateVariants) {
                throw new Error('El archivo no contiene una configuración válida');
            }
            
            // Actualizar configuración
            this.config.colors = configData.colors;
            this.config.settings = configData.settings;
            this.config.templateVariants = configData.templateVariants;
            this.config.customCss = configData.customCss || '';
            
            logger.log('info', 'Configuración visual importada', {
                user: this.currentUser ? this.currentUser.username : 'unknown'
            });
            
            return true;
        } catch (error) {
            logger.log('error', 'Error al importar configuración', { error: error.message });
            throw new Error(`Error al importar configuración: ${error.message}`);
        }
    }

    /**
     * Inicializa la vista previa del tema en tiempo real
     */
    initLiveThemePreview() {
        const colorInputs = document.querySelectorAll('.color-input');
        const themePreview = document.getElementById('theme-preview');
        
        if (!colorInputs || !themePreview) return;
        
        // Actualizar vista previa cuando cambia un color
        colorInputs.forEach(input => {
            input.addEventListener('input', () => {
                const colorName = input.id.replace('color-', '');
                const colorValue = input.value;
                
                // Actualizar en la configuración
                this.config.colors[colorName] = colorValue;
                
                // Actualizar vista previa
                this.updateThemePreview();
            });
        });
        
        // Inicializar vista previa
        this.updateThemePreview();
    }
    
    /**
     * Actualiza la vista previa del tema con los colores actuales
     */
    updateThemePreview() {
        const preview = document.getElementById('theme-preview');
        if (!preview) return;
        
        // Crear HTML para la vista previa
        const html = `
            <div class="preview-container p-3" style="background-color: ${this.config.colors.light};">
                <div class="preview-card p-3 mb-3" style="background-color: ${this.config.colors.primary}; color: ${this.config.colors.light};">
                    <h5>Color Primario</h5>
                    <p>Este es el color principal de la aplicación.</p>
                </div>
                
                <div class="preview-card p-3 mb-3" style="background-color: ${this.config.colors.secondary}; color: ${this.config.colors.dark};">
                    <h5>Color Secundario</h5>
                    <p>Este es el color secundario de la aplicación.</p>
                </div>
                
                <div class="preview-card p-3 mb-3" style="background-color: ${this.config.colors.accent}; color: ${this.config.colors.light};">
                    <h5>Color de Acento</h5>
                    <p>Este es el color de acento para elementos destacados.</p>
                </div>
                
                <div class="preview-buttons">
                    <button class="btn mb-2" style="background-color: ${this.config.colors.primary}; color: ${this.config.colors.light};">
                        Botón Primario
                    </button>
                    
                    <button class="btn mb-2" style="background-color: ${this.config.colors.secondary}; color: ${this.config.colors.dark};">
                        Botón Secundario
                    </button>
                    
                    <button class="btn mb-2" style="background-color: ${this.config.colors.accent}; color: ${this.config.colors.light};">
                        Botón de Acento
                    </button>
                    
                    <button class="btn mb-2" style="background-color: ${this.config.colors.success}; color: ${this.config.colors.light};">
                        Éxito
                    </button>
                    
                    <button class="btn mb-2" style="background-color: ${this.config.colors.danger}; color: ${this.config.colors.light};">
                        Peligro
                    </button>
                </div>
            </div>
        `;
        
        preview.innerHTML = html;
    }
}

// Exportar la clase
module.exports = VisualConfigModule;