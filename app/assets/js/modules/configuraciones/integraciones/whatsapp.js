/**
 * FactuSystem - Módulo de configuración para integración con WhatsApp
 * 
 * Este módulo permite configurar la integración con WhatsApp para enviar
 * comprobantes, notificaciones, ofertas personalizadas y consultas automáticas
 * 
 * @author FactuSystem
 * @version 1.0.0
 */

// Importaciones de utilidades y servicios
import { saveConfiguration, getConfiguration } from '../../../../utils/database.js';
import { showNotification } from '../../../../components/notifications.js';
import { validatePhoneNumber } from '../../../../utils/validation.js';
import { logger } from '../../../../utils/logger.js';
import { whatsappApi } from '../../../../../../integrations/whatsapp/api.js';

// Constantes
const CONFIG_KEY = 'whatsapp_integration';
const TEMPLATE_TYPES = {
  FACTURA: 'factura',
  REMITO: 'remito',
  NOTA_CREDITO: 'nota_credito',
  NOTA_DEBITO: 'nota_debito',
  OFERTA: 'oferta',
  CONSULTA_STOCK: 'consulta_stock',
  ESTADO_PEDIDO: 'estado_pedido',
  BIENVENIDA: 'bienvenida',
  CUMPLEANOS: 'cumpleanos'
};

/**
 * Clase para gestionar la configuración de WhatsApp
 */
class WhatsAppConfig {
  constructor() {
    this.config = null;
    this.domElements = {
      form: null,
      apiKeyInput: null,
      phoneNumberInput: null,
      businessNameInput: null,
      enableDocumentsSwitch: null,
      enableOffersSwitch: null,
      enableStockQueriesSwitch: null,
      enableOrderStatusSwitch: null,
      testConnectionBtn: null,
      saveBtn: null,
      templateContainer: null,
      messagingLimitsInfo: null
    };
    
    this.init();
  }

  /**
   * Inicializa el módulo
   */
  async init() {
    try {
      // Cargar configuración existente
      this.config = await getConfiguration(CONFIG_KEY) || this.getDefaultConfig();
      
      // Inicializar elementos del DOM
      this.initDomElements();
      
      // Cargar la configuración en la interfaz
      this.loadConfigToUI();
      
      // Configurar eventos
      this.setupEventListeners();
      
      // Inicializar plantillas de mensajes
      this.initMessageTemplates();
      
      logger.info('Módulo de configuración de WhatsApp inicializado correctamente');
    } catch (error) {
      logger.error('Error al inicializar el módulo de configuración de WhatsApp', error);
      showNotification('Error al cargar la configuración de WhatsApp', 'error');
    }
  }

  /**
   * Inicializa los elementos del DOM
   */
  initDomElements() {
    this.domElements.form = document.getElementById('whatsapp-config-form');
    this.domElements.apiKeyInput = document.getElementById('whatsapp-api-key');
    this.domElements.phoneNumberInput = document.getElementById('whatsapp-phone-number');
    this.domElements.businessNameInput = document.getElementById('whatsapp-business-name');
    this.domElements.enableDocumentsSwitch = document.getElementById('whatsapp-enable-documents');
    this.domElements.enableOffersSwitch = document.getElementById('whatsapp-enable-offers');
    this.domElements.enableStockQueriesSwitch = document.getElementById('whatsapp-enable-stock-queries');
    this.domElements.enableOrderStatusSwitch = document.getElementById('whatsapp-enable-order-status');
    this.domElements.testConnectionBtn = document.getElementById('whatsapp-test-connection');
    this.domElements.saveBtn = document.getElementById('whatsapp-save-config');
    this.domElements.templateContainer = document.getElementById('whatsapp-templates-container');
    this.domElements.messagingLimitsInfo = document.getElementById('whatsapp-messaging-limits-info');
    
    // Si algún elemento no existe, lo creamos dinámicamente
    if (!this.domElements.form) {
      this.createWhatsAppConfigUI();
    }
  }

  /**
   * Crea la interfaz de usuario para la configuración de WhatsApp
   * en caso de que no exista en el HTML
   */
  createWhatsAppConfigUI() {
    const container = document.querySelector('.configuration-content') || document.body;
    
    const configSection = document.createElement('div');
    configSection.className = 'whatsapp-config-section config-section';
    configSection.innerHTML = `
      <h2 class="config-section-title">Configuración de WhatsApp Business API</h2>
      <div class="config-section-description">
        Configure la integración con WhatsApp Business API para enviar facturas, notificaciones y ofertas a sus clientes.
      </div>
      
      <form id="whatsapp-config-form" class="config-form">
        <div class="form-section">
          <h3>Credenciales de API</h3>
          
          <div class="form-group">
            <label for="whatsapp-api-key">API Key de WhatsApp Business</label>
            <input type="password" id="whatsapp-api-key" class="form-control" placeholder="Ingrese su API Key" required>
            <small class="form-text text-muted">Obtenga su API Key desde el portal de desarrolladores de WhatsApp Business</small>
          </div>
          
          <div class="form-group">
            <label for="whatsapp-phone-number">Número de teléfono</label>
            <input type="text" id="whatsapp-phone-number" class="form-control" placeholder="Número con código de país (ej: +5491112345678)" required>
            <small class="form-text text-muted">Número de WhatsApp verificado para su negocio</small>
          </div>
          
          <div class="form-group">
            <label for="whatsapp-business-name">Nombre del negocio</label>
            <input type="text" id="whatsapp-business-name" class="form-control" placeholder="Nombre del negocio" required>
            <small class="form-text text-muted">Este nombre aparecerá en los mensajes enviados</small>
          </div>
        </div>
        
        <div class="form-section">
          <h3>Configuración de funcionalidades</h3>
          
          <div class="form-group form-switch">
            <input type="checkbox" id="whatsapp-enable-documents" class="form-check-input">
            <label for="whatsapp-enable-documents" class="form-check-label">Habilitar envío de documentos</label>
            <small class="form-text text-muted">Permite enviar facturas, remitos y notas por WhatsApp</small>
          </div>
          
          <div class="form-group form-switch">
            <input type="checkbox" id="whatsapp-enable-offers" class="form-check-input">
            <label for="whatsapp-enable-offers" class="form-check-label">Habilitar envío de ofertas personalizadas</label>
            <small class="form-text text-muted">Enviar promociones específicas según el historial de compras</small>
          </div>
          
          <div class="form-group form-switch">
            <input type="checkbox" id="whatsapp-enable-stock-queries" class="form-check-input">
            <label for="whatsapp-enable-stock-queries" class="form-check-label">Habilitar consultas de stock automáticas</label>
            <small class="form-text text-muted">Los clientes podrán consultar disponibilidad de productos</small>
          </div>
          
          <div class="form-group form-switch">
            <input type="checkbox" id="whatsapp-enable-order-status" class="form-check-input">
            <label for="whatsapp-enable-order-status" class="form-check-label">Habilitar notificaciones de estado de pedidos</label>
            <small class="form-text text-muted">Notificar a los clientes sobre cambios en el estado de sus pedidos</small>
          </div>
        </div>
        
        <div id="whatsapp-templates-container" class="form-section">
          <h3>Plantillas de mensajes</h3>
          <p class="text-muted">Estas plantillas deben estar aprobadas en su cuenta de WhatsApp Business</p>
          <!-- Aquí se cargarán dinámicamente las plantillas -->
        </div>
        
        <div id="whatsapp-messaging-limits-info" class="info-box warning">
          <h4>Limitaciones de mensajería</h4>
          <p>Recuerde que WhatsApp Business API tiene las siguientes restricciones:</p>
          <ul>
            <li>Los mensajes iniciados por la empresa solo pueden enviarse utilizando plantillas aprobadas</li>
            <li>Los mensajes libres solo pueden enviarse dentro de las 24hs de una respuesta del cliente</li>
            <li>Existen limitaciones en el tamaño y formato de los archivos adjuntos</li>
          </ul>
        </div>
        
        <div class="form-actions">
          <button type="button" id="whatsapp-test-connection" class="btn btn-secondary">
            Probar conexión
          </button>
          <button type="submit" id="whatsapp-save-config" class="btn btn-primary">
            Guardar configuración
          </button>
        </div>
      </form>
    `;
    
    container.appendChild(configSection);
    
    // Actualizar referencias a elementos del DOM
    this.initDomElements();
  }

  /**
   * Configura los listeners de eventos
   */
  setupEventListeners() {
    // Form submit
    this.domElements.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveConfiguration();
    });
    
    // Test connection button
    this.domElements.testConnectionBtn.addEventListener('click', () => {
      this.testConnection();
    });
    
    // Toggle de funcionalidades
    this.domElements.enableDocumentsSwitch.addEventListener('change', (e) => {
      const templatesSection = document.getElementById('whatsapp-document-templates');
      if (templatesSection) {
        templatesSection.style.display = e.target.checked ? 'block' : 'none';
      }
    });
    
    this.domElements.enableOffersSwitch.addEventListener('change', (e) => {
      const templatesSection = document.getElementById('whatsapp-offer-templates');
      if (templatesSection) {
        templatesSection.style.display = e.target.checked ? 'block' : 'none';
      }
    });
    
    // Resto de toggles para otras funcionalidades
  }

  /**
   * Carga la configuración en la interfaz de usuario
   */
  loadConfigToUI() {
    if (!this.config) return;
    
    this.domElements.apiKeyInput.value = this.config.apiKey || '';
    this.domElements.phoneNumberInput.value = this.config.phoneNumber || '';
    this.domElements.businessNameInput.value = this.config.businessName || '';
    
    this.domElements.enableDocumentsSwitch.checked = this.config.enableDocuments;
    this.domElements.enableOffersSwitch.checked = this.config.enableOffers;
    this.domElements.enableStockQueriesSwitch.checked = this.config.enableStockQueries;
    this.domElements.enableOrderStatusSwitch.checked = this.config.enableOrderStatus;
  }

  /**
   * Obtiene la configuración por defecto
   * @returns {Object} Configuración por defecto
   */
  getDefaultConfig() {
    return {
      apiKey: '',
      phoneNumber: '',
      businessName: '',
      enableDocuments: true,
      enableOffers: false,
      enableStockQueries: false,
      enableOrderStatus: false,
      templates: {
        [TEMPLATE_TYPES.FACTURA]: {
          name: 'factura_enviada',
          enabled: true,
          params: ['cliente_nombre', 'factura_numero', 'factura_total', 'negocio_nombre']
        },
        [TEMPLATE_TYPES.REMITO]: {
          name: 'remito_enviado',
          enabled: true,
          params: ['cliente_nombre', 'remito_numero', 'negocio_nombre']
        },
        [TEMPLATE_TYPES.NOTA_CREDITO]: {
          name: 'nota_credito_enviada',
          enabled: true,
          params: ['cliente_nombre', 'nota_numero', 'nota_total', 'negocio_nombre']
        },
        [TEMPLATE_TYPES.NOTA_DEBITO]: {
          name: 'nota_debito_enviada',
          enabled: true,
          params: ['cliente_nombre', 'nota_numero', 'nota_total', 'negocio_nombre']
        },
        [TEMPLATE_TYPES.OFERTA]: {
          name: 'oferta_personalizada',
          enabled: false,
          params: ['cliente_nombre', 'producto_nombre', 'descuento', 'fecha_limite', 'negocio_nombre']
        },
        [TEMPLATE_TYPES.CONSULTA_STOCK]: {
          name: 'respuesta_stock',
          enabled: false,
          params: ['producto_nombre', 'disponibilidad', 'precio', 'negocio_nombre']
        },
        [TEMPLATE_TYPES.ESTADO_PEDIDO]: {
          name: 'actualizacion_pedido',
          enabled: false,
          params: ['cliente_nombre', 'pedido_numero', 'estado_nuevo', 'negocio_nombre']
        },
        [TEMPLATE_TYPES.BIENVENIDA]: {
          name: 'mensaje_bienvenida',
          enabled: false,
          params: ['cliente_nombre', 'negocio_nombre']
        },
        [TEMPLATE_TYPES.CUMPLEANOS]: {
          name: 'feliz_cumpleanos',
          enabled: false,
          params: ['cliente_nombre', 'cupon_descuento', 'fecha_limite', 'negocio_nombre']
        }
      }
    };
  }

  /**
   * Inicializa las plantillas de mensajes
   */
  initMessageTemplates() {
    if (!this.domElements.templateContainer) return;
    
    // Limpiar el contenedor de plantillas
    this.domElements.templateContainer.innerHTML = '<h3>Plantillas de mensajes</h3><p class="text-muted">Estas plantillas deben estar aprobadas en su cuenta de WhatsApp Business</p>';
    
    // Crear secciones para cada tipo de plantilla
    this.createDocumentTemplatesSection();
    this.createPromotionalTemplatesSection();
    this.createQueryTemplatesSection();
    this.createCustomTemplatesSection();
  }

  /**
   * Crea la sección de plantillas para documentos
   */
  createDocumentTemplatesSection() {
    const section = document.createElement('div');
    section.id = 'whatsapp-document-templates';
    section.className = 'template-section';
    section.style.display = this.config.enableDocuments ? 'block' : 'none';
    
    section.innerHTML = `
      <h4>Plantillas para documentos</h4>
      <div class="templates-grid">
        ${this.createTemplateCard(TEMPLATE_TYPES.FACTURA, 'Factura')}
        ${this.createTemplateCard(TEMPLATE_TYPES.REMITO, 'Remito')}
        ${this.createTemplateCard(TEMPLATE_TYPES.NOTA_CREDITO, 'Nota de Crédito')}
        ${this.createTemplateCard(TEMPLATE_TYPES.NOTA_DEBITO, 'Nota de Débito')}
      </div>
    `;
    
    this.domElements.templateContainer.appendChild(section);
  }

  /**
   * Crea la sección de plantillas promocionales
   */
  createPromotionalTemplatesSection() {
    const section = document.createElement('div');
    section.id = 'whatsapp-offer-templates';
    section.className = 'template-section';
    section.style.display = this.config.enableOffers ? 'block' : 'none';
    
    section.innerHTML = `
      <h4>Plantillas promocionales</h4>
      <div class="templates-grid">
        ${this.createTemplateCard(TEMPLATE_TYPES.OFERTA, 'Oferta personalizada')}
        ${this.createTemplateCard(TEMPLATE_TYPES.BIENVENIDA, 'Mensaje de bienvenida')}
        ${this.createTemplateCard(TEMPLATE_TYPES.CUMPLEANOS, 'Felicitación de cumpleaños')}
      </div>
    `;
    
    this.domElements.templateContainer.appendChild(section);
  }

  /**
   * Crea la sección de plantillas para consultas
   */
  createQueryTemplatesSection() {
    const section = document.createElement('div');
    section.id = 'whatsapp-query-templates';
    section.className = 'template-section';
    section.style.display = this.config.enableStockQueries ? 'block' : 'none';
    
    section.innerHTML = `
      <h4>Plantillas para consultas</h4>
      <div class="templates-grid">
        ${this.createTemplateCard(TEMPLATE_TYPES.CONSULTA_STOCK, 'Consulta de stock')}
      </div>
    `;
    
    this.domElements.templateContainer.appendChild(section);
  }

  /**
   * Crea la sección de plantillas personalizadas
   */
  createCustomTemplatesSection() {
    const section = document.createElement('div');
    section.id = 'whatsapp-custom-templates';
    section.className = 'template-section';
    
    section.innerHTML = `
      <h4>Plantillas personalizadas</h4>
      <p>Agregue plantillas adicionales aprobadas en su cuenta de WhatsApp Business</p>
      
      <div id="custom-templates-list" class="templates-grid">
        <!-- Aquí se cargarán las plantillas personalizadas -->
      </div>
      
      <button type="button" id="add-custom-template" class="btn btn-sm btn-outline-primary mt-2">
        <i class="fas fa-plus"></i> Agregar plantilla personalizada
      </button>
    `;
    
    this.domElements.templateContainer.appendChild(section);
    
    // Configurar el botón para agregar plantillas personalizadas
    document.getElementById('add-custom-template').addEventListener('click', () => {
      this.showAddCustomTemplateModal();
    });
    
    // Cargar plantillas personalizadas existentes si hay
    this.loadCustomTemplates();
  }

  /**
   * Crea una tarjeta para una plantilla
   * @param {string} templateType - Tipo de plantilla
   * @param {string} displayName - Nombre para mostrar
   * @returns {string} HTML de la tarjeta
   */
  createTemplateCard(templateType, displayName) {
    const template = this.config.templates[templateType];
    if (!template) return '';
    
    return `
      <div class="template-card" data-template="${templateType}">
        <div class="template-card-header">
          <div class="template-title">${displayName}</div>
          <label class="switch">
            <input type="checkbox" class="template-toggle" data-template="${templateType}" 
              ${template.enabled ? 'checked' : ''}>
            <span class="slider round"></span>
          </label>
        </div>
        
        <div class="template-card-body">
          <div class="template-name">
            <label>Nombre de plantilla:</label>
            <input type="text" class="form-control form-control-sm template-name-input" 
              value="${template.name}" data-template="${templateType}">
          </div>
          
          <div class="template-params">
            <label>Parámetros:</label>
            <div class="params-list">
              ${template.params.map(param => `<span class="param-tag">${param}</span>`).join('')}
            </div>
          </div>
        </div>
        
        <div class="template-card-footer">
          <button type="button" class="btn btn-sm btn-outline-secondary test-template-btn" 
            data-template="${templateType}">
            Probar
          </button>
          <button type="button" class="btn btn-sm btn-outline-primary edit-template-btn" 
            data-template="${templateType}">
            Editar
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Carga las plantillas personalizadas
   */
  loadCustomTemplates() {
    const customTemplatesList = document.getElementById('custom-templates-list');
    if (!customTemplatesList) return;
    
    // Limpiar lista
    customTemplatesList.innerHTML = '';
    
    // Verificar si hay plantillas personalizadas
    if (!this.config.customTemplates || this.config.customTemplates.length === 0) {
      customTemplatesList.innerHTML = '<p class="text-muted">No hay plantillas personalizadas configuradas</p>';
      return;
    }
    
    // Agregar plantillas personalizadas
    this.config.customTemplates.forEach((template, index) => {
      const templateCard = document.createElement('div');
      templateCard.className = 'template-card';
      templateCard.setAttribute('data-custom-template', index);
      
      templateCard.innerHTML = `
        <div class="template-card-header">
          <div class="template-title">${template.displayName}</div>
          <label class="switch">
            <input type="checkbox" class="template-toggle" data-custom-template="${index}" 
              ${template.enabled ? 'checked' : ''}>
            <span class="slider round"></span>
          </label>
        </div>
        
        <div class="template-card-body">
          <div class="template-name">
            <label>Nombre de plantilla:</label>
            <input type="text" class="form-control form-control-sm template-name-input" 
              value="${template.name}" data-custom-template="${index}">
          </div>
          
          <div class="template-params">
            <label>Parámetros:</label>
            <div class="params-list">
              ${template.params.map(param => `<span class="param-tag">${param}</span>`).join('')}
            </div>
          </div>
        </div>
        
        <div class="template-card-footer">
          <button type="button" class="btn btn-sm btn-outline-secondary test-template-btn" 
            data-custom-template="${index}">
            Probar
          </button>
          <button type="button" class="btn btn-sm btn-outline-primary edit-template-btn" 
            data-custom-template="${index}">
            Editar
          </button>
          <button type="button" class="btn btn-sm btn-outline-danger delete-template-btn" 
            data-custom-template="${index}">
            Eliminar
          </button>
        </div>
      `;
      
      customTemplatesList.appendChild(templateCard);
      
      // Configurar eventos para esta plantilla personalizada
      this.setupCustomTemplateEvents(templateCard, index);
    });
  }

  /**
   * Configura eventos para plantillas personalizadas
   * @param {HTMLElement} templateCard - Elemento de la tarjeta
   * @param {number} index - Índice de la plantilla
   */
  setupCustomTemplateEvents(templateCard, index) {
    // Toggle de habilitación
    const toggle = templateCard.querySelector(`.template-toggle[data-custom-template="${index}"]`);
    if (toggle) {
      toggle.addEventListener('change', (e) => {
        if (!this.config.customTemplates) return;
        this.config.customTemplates[index].enabled = e.target.checked;
      });
    }
    
    // Cambio de nombre
    const nameInput = templateCard.querySelector(`.template-name-input[data-custom-template="${index}"]`);
    if (nameInput) {
      nameInput.addEventListener('change', (e) => {
        if (!this.config.customTemplates) return;
        this.config.customTemplates[index].name = e.target.value;
      });
    }
    
    // Botón de prueba
    const testBtn = templateCard.querySelector(`.test-template-btn[data-custom-template="${index}"]`);
    if (testBtn) {
      testBtn.addEventListener('click', () => {
        if (!this.config.customTemplates) return;
        this.testTemplate(this.config.customTemplates[index]);
      });
    }
    
    // Botón de edición
    const editBtn = templateCard.querySelector(`.edit-template-btn[data-custom-template="${index}"]`);
    if (editBtn) {
      editBtn.addEventListener('click', () => {
        if (!this.config.customTemplates) return;
        this.showEditTemplateModal(this.config.customTemplates[index], index, true);
      });
    }
    
    // Botón de eliminación
    const deleteBtn = templateCard.querySelector(`.delete-template-btn[data-custom-template="${index}"]`);
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => {
        if (!this.config.customTemplates) return;
        this.deleteCustomTemplate(index);
      });
    }
  }

  /**
   * Muestra el modal para agregar una plantilla personalizada
   */
  showAddCustomTemplateModal() {
    // Crear elementos del modal
    const modalOverlay = document.createElement('div');
    modalOverlay.className = 'modal-overlay';
    
    const modalContent = document.createElement('div');
    modalContent.className = 'modal-content';
    modalContent.innerHTML = `
      <div class="modal-header">
        <h3>Agregar plantilla personalizada</h3>
        <button type="button" class="close-modal-btn">&times;</button>
      </div>
      
      <div class="modal-body">
        <form id="custom-template-form">
          <div class="form-group">
            <label for="custom-template-display-name">Nombre para mostrar</label>
            <input type="text" id="custom-template-display-name" class="form-control" required>
          </div>
          
          <div class="form-group">
            <label for="custom-template-name">Nombre de plantilla en WhatsApp</label>
            <input type="text" id="custom-template-name" class="form-control" required>
            <small class="form-text text-muted">Debe coincidir exactamente con el nombre aprobado en WhatsApp Business</small>
          </div>
          
          <div class="form-group">
            <label for="custom-template-params">Parámetros (separados por coma)</label>
            <input type="text" id="custom-template-params" class="form-control" placeholder="param1, param2, param3">
            <small class="form-text text-muted">Ingrese los nombres de los parámetros separados por comas</small>
          </div>
          
          <div class="form-group form-check">
            <input type="checkbox" id="custom-template-enabled" class="form-check-input" checked>
            <label for="custom-template-enabled" class="form-check-label">Habilitada</label>
          </div>
        </form>
      </div>
      
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary cancel-btn">Cancelar</button>
        <button type="button" class="btn btn-primary save-template-btn">Guardar</button>
      </div>
    `;
    
    // Agregar modal al DOM
    modalOverlay.appendChild(modalContent);
    document.body.appendChild(modalOverlay);
    
    // Configurar eventos
    const closeBtn = modalContent.querySelector('.close-modal-btn');
    const cancelBtn = modalContent.querySelector('.cancel-btn');
    const saveBtn = modalContent.querySelector('.save-template-btn');
    
    closeBtn.addEventListener('click', () => {
      document.body.removeChild(modalOverlay);
    });
    
    cancelBtn.addEventListener('click', () => {
      document.body.removeChild(modalOverlay);
    });
    
    saveBtn.addEventListener('click', () => {
      // Obtener valores
      const displayName = document.getElementById('custom-template-display-name').value.trim();
      const name = document.getElementById('custom-template-name').value.trim();
      const paramsString = document.getElementById('custom-template-params').value.trim();
      const enabled = document.getElementById('custom-template-enabled').checked;
      
      // Validar
      if (!displayName || !name) {
        showNotification('Por favor complete todos los campos obligatorios', 'warning');
        return;
      }
      
      // Procesar parámetros
      const params = paramsString ? paramsString.split(',').map(p => p.trim()) : [];
      
      // Crear plantilla
      const newTemplate = {
        displayName,
        name,
        params,
        enabled
      };
      
      // Agregar a la configuración
      if (!this.config.customTemplates) {
        this.config.customTemplates = [];
      }
      
      this.config.customTemplates.push(newTemplate);
      
      // Actualizar UI
      this.loadCustomTemplates();
      
      // Cerrar modal
      document.body.removeChild(modalOverlay);
      
      showNotification('Plantilla personalizada agregada correctamente', 'success');
    });
  }

  /**
   * Muestra el modal para editar una plantilla
   * @param {Object} template - Plantilla a editar
   * @param {number|string} identifier - Identificador de la plantilla
   * @param {boolean} isCustom - Indica si es una plantilla personalizada
   */
  showEditTemplateModal(template, identifier, isCustom = false) {
    // Crear elementos del modal
    const modalOverlay = document.createElement('div');
    modalOverlay.className = 'modal-overlay';
    
    const modalContent = document.createElement('div');
    modalContent.className = 'modal-content';
    modalContent.innerHTML = `
      <div class="modal-header">
        <h3>Editar plantilla${isCustom ? ': ' + template.displayName : ''}</h3>
        <button type="button" class="close-modal-btn">&times;</button>
      </div>
      
      <div class="modal-body">
        <form id="edit-template-form">
          ${isCustom ? `
            <div class="form-group">
              <label for="edit-template-display-name">Nombre para mostrar</label>
              <input type="text" id="edit-template-display-name" class="form-control" value="${template.displayName}" required>
            </div>
          ` : ''}
          
          <div class="form-group">
            <label for="edit-template-name">Nombre de plantilla en WhatsApp</label>
            <input type="text" id="edit-template-name" class="form-control" value="${template.name}" required>
            <small class="form-text text-muted">Debe coincidir exactamente con el nombre aprobado en WhatsApp Business</small>
          </div>
          
          <div class="form-group">
            <label for="edit-template-params">Parámetros</label>
            <div id="edit-template-params-container" class="params-editor-container">
              ${template.params.map((param, idx) => `
                <div class="param-item" data-param-index="${idx}">
                  <input type="text" class="form-control form-control-sm param-input" value="${param}">
                  <button type="button" class="btn btn-sm btn-danger remove-param-btn">
                    <i class="fas fa-times"></i>
                  </button>
                </div>
              `).join('')}
              <button type="button" id="add-param-btn" class="btn btn-sm btn-outline-secondary">
                <i class="fas fa-plus"></i> Agregar parámetro
              </button>
            </div>
          </div>
          
          <div class="form-group form-check">
            <input type="checkbox" id="edit-template-enabled" class="form-check-input" ${template.enabled ? 'checked' : ''}>
            <label for="edit-template-enabled" class="form-check-label">Habilitada</label>
          </div>
          
          <div class="form-group">
            <label>Vista previa del mensaje</label>
            <div id="template-preview" class="template-preview">
              <div class="preview-header">
                <span class="preview-business-name">${this.config.businessName || 'Mi Negocio'}</span>
                <span class="preview-timestamp">12:34 PM</span>
              </div>
              <div class="preview-body">
                <p class="preview-text">Esta es una vista previa de cómo podría verse el mensaje usando esta plantilla.</p>
                <p class="preview-params text-muted">Los parámetros serán reemplazados con datos reales.</p>
              </div>
            </div>
          </div>
        </form>
      </div>
      
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary cancel-btn">Cancelar</button>
        <button type="button" class="btn btn-primary save-template-btn">Guardar cambios</button>
      </div>
    `;
    
    // Agregar modal al DOM
    modalOverlay.appendChild(modalContent);
    document.body.appendChild(modalOverlay);
    
    // Configurar eventos
    const closeBtn = modalContent.querySelector('.close-modal-btn');
    const cancelBtn = modalContent.querySelector('.cancel-btn');
    const saveBtn = modalContent.querySelector('.save-template-btn');
    const addParamBtn = modalContent.querySelector('#add-param-btn');
    
    // Evento para agregar parámetro
    addParamBtn.addEventListener('click', () => {
      const container = document.getElementById('edit-template-params-container');
      const paramItems = container.querySelectorAll('.param-item');
      const newIndex = paramItems.length;
      
      const newParamItem = document.createElement('div');
      newParamItem.className = 'param-item';
      newParamItem.setAttribute('data-param-index', newIndex);
      newParamItem.innerHTML = `
        <input type="text" class="form-control form-control-sm param-input" placeholder="Nuevo parámetro">
        <button type="button" class="btn btn-sm btn-danger remove-param-btn">
          <i class="fas fa-times"></i>
        </button>
      `;
      
      // Insertar antes del botón de agregar
      container.insertBefore(newParamItem, addParamBtn);
      
      // Configurar el botón de eliminar
      const removeBtn = newParamItem.querySelector('.remove-param-btn');
      removeBtn.addEventListener('click', () => {
        container.removeChild(newParamItem);
      });
    });
    
    // Configurar botones de eliminar parámetros existentes
    modalContent.querySelectorAll('.remove-param-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const paramItem = e.target.closest('.param-item');
        paramItem.parentNode.removeChild(paramItem);
      });
    });
    
    // Botones de cerrar/cancelar
    closeBtn.addEventListener('click', () => {
      document.body.removeChild(modalOverlay);
    });
    
    cancelBtn.addEventListener('click', () => {
      document.body.removeChild(modalOverlay);
    });
    
    // Botón de guardar
    saveBtn.addEventListener('click', () => {
      // Recopilar valores
      const name = document.getElementById('edit-template-name').value.trim();
      const enabled = document.getElementById('edit-template-enabled').checked;
      
      // Para plantillas personalizadas, obtener el nombre de visualización
      let displayName = null;
      if (isCustom) {
        displayName = document.getElementById('edit-template-display-name').value.trim();
        if (!displayName) {
          showNotification('El nombre para mostrar es obligatorio', 'warning');
          return;
        }
      }
      
      // Validar nombre
      if (!name) {
        showNotification('El nombre de la plantilla es obligatorio', 'warning');
        return;
      }
      
      // Recopilar parámetros
      const params = [];
      modalContent.querySelectorAll('.param-input').forEach(input => {
        const value = input.value.trim();
        if (value) {
          params.push(value);
        }
      });
      
      // Actualizar la plantilla
      if (isCustom) {
        if (!this.config.customTemplates) return;
        
        this.config.customTemplates[identifier] = {
          displayName,
          name,
          params,
          enabled
        };
        
        // Actualizar UI de plantillas personalizadas
        this.loadCustomTemplates();
      } else {
        if (!this.config.templates[identifier]) return;
        
        this.config.templates[identifier] = {
          name,
          params,
          enabled
        };
        
        // Actualizar UI de plantillas predefinidas
        this.initMessageTemplates();
      }
      
      // Cerrar modal
      document.body.removeChild(modalOverlay);
      
      showNotification('Plantilla actualizada correctamente', 'success');
    });
  }

  /**
   * Elimina una plantilla personalizada
   * @param {number} index - Índice de la plantilla
   */
  deleteCustomTemplate(index) {
    if (!this.config.customTemplates || index >= this.config.customTemplates.length) return;
    
    // Confirmar eliminación
    const confirmModal = document.createElement('div');
    confirmModal.className = 'modal-overlay';
    confirmModal.innerHTML = `
      <div class="modal-content modal-sm">
        <div class="modal-header">
          <h3>Confirmar eliminación</h3>
          <button type="button" class="close-modal-btn">&times;</button>
        </div>
        
        <div class="modal-body">
          <p>¿Está seguro que desea eliminar la plantilla "${this.config.customTemplates[index].displayName}"?</p>
          <p>Esta acción no se puede deshacer.</p>
        </div>
        
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary cancel-btn">Cancelar</button>
          <button type="button" class="btn btn-danger confirm-delete-btn">Eliminar</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(confirmModal);
    
    // Configurar eventos
    const closeBtn = confirmModal.querySelector('.close-modal-btn');
    const cancelBtn = confirmModal.querySelector('.cancel-btn');
    const confirmBtn = confirmModal.querySelector('.confirm-delete-btn');
    
    closeBtn.addEventListener('click', () => {
      document.body.removeChild(confirmModal);
    });
    
    cancelBtn.addEventListener('click', () => {
      document.body.removeChild(confirmModal);
    });
    
    confirmBtn.addEventListener('click', () => {
      // Eliminar la plantilla
      this.config.customTemplates.splice(index, 1);
      
      // Actualizar UI
      this.loadCustomTemplates();
      
      // Cerrar modal
      document.body.removeChild(confirmModal);
      
      showNotification('Plantilla eliminada correctamente', 'success');
    });
  }

  /**
   * Prueba una plantilla
   * @param {Object} template - Plantilla a probar
   */
  testTemplate(template) {
    // Crear un modal para probar la plantilla
    const testModal = document.createElement('div');
    testModal.className = 'modal-overlay';
    testModal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h3>Probar plantilla: ${template.displayName || template.name}</h3>
          <button type="button" class="close-modal-btn">&times;</button>
        </div>
        
        <div class="modal-body">
          <form id="test-template-form">
            <div class="form-group">
              <label for="test-phone-number">Número de teléfono para prueba</label>
              <input type="text" id="test-phone-number" class="form-control" 
                placeholder="Ingrese número con código de país (ej: +5491112345678)" required>
            </div>
            
            <h4>Parámetros de la plantilla</h4>
            ${template.params.map(param => `
              <div class="form-group">
                <label for="param-${param}">${param}</label>
                <input type="text" id="param-${param}" class="form-control param-test-input" 
                  data-param="${param}" placeholder="Valor para ${param}">
              </div>
            `).join('')}
            
            <div class="form-group">
              <label>Vista previa del mensaje</label>
              <div class="test-template-preview whatsapp-preview">
                <div class="preview-content">
                  <div class="preview-header">
                    <div class="preview-business-info">
                      <img src="#" alt="Logo" class="business-logo">
                      <span class="business-name">${this.config.businessName || 'Mi Negocio'}</span>
                    </div>
                    <span class="preview-time">Ahora</span>
                  </div>
                  <div class="preview-message">
                    <p>Mensaje de prueba usando la plantilla "${template.name}"</p>
                    <p class="text-muted">Los parámetros serán reemplazados con los valores ingresados</p>
                  </div>
                </div>
              </div>
            </div>
            
            <div class="alert alert-info">
              <i class="fas fa-info-circle"></i>
              Esta prueba enviará un mensaje real al número indicado utilizando su cuenta de WhatsApp Business API.
            </div>
          </form>
        </div>
        
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary cancel-btn">Cancelar</button>
          <button type="button" class="btn btn-primary send-test-btn">Enviar prueba</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(testModal);
    
    // Configurar eventos
    const closeBtn = testModal.querySelector('.close-modal-btn');
    const cancelBtn = testModal.querySelector('.cancel-btn');
    const sendBtn = testModal.querySelector('.send-test-btn');
    
    closeBtn.addEventListener('click', () => {
      document.body.removeChild(testModal);
    });
    
    cancelBtn.addEventListener('click', () => {
      document.body.removeChild(testModal);
    });
    
    sendBtn.addEventListener('click', async () => {
      // Obtener número de teléfono
      const phoneNumber = document.getElementById('test-phone-number').value.trim();
      
      // Validar número
      if (!phoneNumber || !validatePhoneNumber(phoneNumber)) {
        showNotification('Por favor ingrese un número de teléfono válido incluyendo el código de país', 'warning');
        return;
      }
      
      // Recopilar valores de parámetros
      const paramValues = {};
      testModal.querySelectorAll('.param-test-input').forEach(input => {
        const param = input.getAttribute('data-param');
        paramValues[param] = input.value.trim();
      });
      
      // Mostrar indicador de carga
      sendBtn.disabled = true;
      sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';
      
      try {
        // Enviar mensaje de prueba
        const result = await this.sendTestMessage(template, phoneNumber, paramValues);
        
        // Cerrar modal
        document.body.removeChild(testModal);
        
        if (result.success) {
          showNotification('Mensaje de prueba enviado correctamente', 'success');
        } else {
          showNotification(`Error al enviar mensaje: ${result.error}`, 'error');
        }
      } catch (error) {
        showNotification(`Error al enviar mensaje: ${error.message}`, 'error');
        
        // Restaurar botón
        sendBtn.disabled = false;
        sendBtn.innerHTML = 'Enviar prueba';
      }
    });
  }

  /**
   * Envía un mensaje de prueba
   * @param {Object} template - Plantilla a utilizar
   * @param {string} phoneNumber - Número de teléfono
   * @param {Object} paramValues - Valores de los parámetros
   * @returns {Promise<Object>} Resultado del envío
   */
  async sendTestMessage(template, phoneNumber, paramValues) {
    try {
      // Verificar configuración
      if (!this.config.apiKey) {
        return {
          success: false,
          error: 'Debe configurar la API Key de WhatsApp Business'
        };
      }
      
      // Preparar datos para la API
      const params = template.params.map(param => ({
        type: 'text',
        text: paramValues[param] || `[${param}]`
      }));
      
      // Llamar a la API de WhatsApp
      const response = await whatsappApi.sendTemplateMessage(
        this.config.apiKey,
        phoneNumber,
        template.name,
        params
      );
      
      logger.info('Mensaje de prueba enviado', { phoneNumber, template: template.name });
      
      return {
        success: true,
        messageId: response.messageId
      };
    } catch (error) {
      logger.error('Error al enviar mensaje de prueba', error);
      
      return {
        success: false,
        error: error.message || 'Error desconocido al enviar mensaje'
      };
    }
  }

  /**
   * Prueba la conexión con la API de WhatsApp
   */
  async testConnection() {
    try {
      // Validar configuración
      const apiKey = this.domElements.apiKeyInput.value.trim();
      const phoneNumber = this.domElements.phoneNumberInput.value.trim();
      
      if (!apiKey) {
        showNotification('Por favor ingrese la API Key de WhatsApp Business', 'warning');
        return;
      }
      
      if (!phoneNumber || !validatePhoneNumber(phoneNumber)) {
        showNotification('Por favor ingrese un número de teléfono válido incluyendo el código de país', 'warning');
        return;
      }
      
      // Mostrar indicador de carga
      this.domElements.testConnectionBtn.disabled = true;
      this.domElements.testConnectionBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Probando...';
      
      // Verificar conexión con la API
      const isConnected = await whatsappApi.verifyCredentials(apiKey, phoneNumber);
      
      // Restaurar botón
      this.domElements.testConnectionBtn.disabled = false;
      this.domElements.testConnectionBtn.innerHTML = 'Probar conexión';
      
      if (isConnected) {
        showNotification('Conexión exitosa con WhatsApp Business API', 'success');
      } else {
        showNotification('No se pudo conectar con WhatsApp Business API. Verifique sus credenciales.', 'error');
      }
    } catch (error) {
      // Restaurar botón
      this.domElements.testConnectionBtn.disabled = false;
      this.domElements.testConnectionBtn.innerHTML = 'Probar conexión';
      
      logger.error('Error al probar conexión con WhatsApp', error);
      showNotification(`Error: ${error.message}`, 'error');
    }
  }

  /**
   * Guarda la configuración
   */
  async saveConfiguration() {
    try {
      // Recopilar datos del formulario
      const apiKey = this.domElements.apiKeyInput.value.trim();
      const phoneNumber = this.domElements.phoneNumberInput.value.trim();
      const businessName = this.domElements.businessNameInput.value.trim();
      
      // Validar campos obligatorios
      if (!apiKey || !phoneNumber || !businessName) {
        showNotification('Por favor complete todos los campos obligatorios', 'warning');
        return;
      }
      
      // Validar formato del número de teléfono
      if (!validatePhoneNumber(phoneNumber)) {
        showNotification('Por favor ingrese un número de teléfono válido incluyendo el código de país', 'warning');
        return;
      }
      
      // Actualizar configuración
      this.config.apiKey = apiKey;
      this.config.phoneNumber = phoneNumber;
      this.config.businessName = businessName;
      this.config.enableDocuments = this.domElements.enableDocumentsSwitch.checked;
      this.config.enableOffers = this.domElements.enableOffersSwitch.checked;
      this.config.enableStockQueries = this.domElements.enableStockQueriesSwitch.checked;
      this.config.enableOrderStatus = this.domElements.enableOrderStatusSwitch.checked;
      
      // Guardar en base de datos
      await saveConfiguration(CONFIG_KEY, this.config);
      
      logger.info('Configuración de WhatsApp guardada');
      showNotification('Configuración de WhatsApp guardada correctamente', 'success');
    } catch (error) {
      logger.error('Error al guardar configuración de WhatsApp', error);
      showNotification(`Error al guardar: ${error.message}`, 'error');
    }
  }

  /**
   * Obtiene la configuración actual
   * @returns {Object} Configuración actual
   */
  getConfig() {
    return this.config;
  }

  /**
   * Verifica si la integración con WhatsApp está habilitada y configurada
   * @returns {boolean} true si está habilitada y configurada
   */
  isEnabled() {
    return this.config && this.config.apiKey && this.config.phoneNumber;
  }

  /**
   * Verifica si una funcionalidad específica está habilitada
   * @param {string} feature - Nombre de la funcionalidad
   * @returns {boolean} true si está habilitada
   */
  isFeatureEnabled(feature) {
    if (!this.isEnabled()) return false;
    
    switch (feature) {
      case 'documents':
        return this.config.enableDocuments;
      case 'offers':
        return this.config.enableOffers;
      case 'stockQueries':
        return this.config.enableStockQueries;
      case 'orderStatus':
        return this.config.enableOrderStatus;
      default:
        return false;
    }
  }

  /**
   * Obtiene la plantilla para un tipo específico
   * @param {string} templateType - Tipo de plantilla
   * @returns {Object|null} Plantilla o null si no existe
   */
  getTemplate(templateType) {
    if (!this.config || !this.config.templates) return null;
    
    // Buscar en plantillas predefinidas
    if (this.config.templates[templateType] && this.config.templates[templateType].enabled) {
      return this.config.templates[templateType];
    }
    
    return null;
  }

  /**
   * Envía un documento por WhatsApp
   * @param {string} templateType - Tipo de plantilla
   * @param {string} phoneNumber - Número de teléfono
   * @param {Object} params - Parámetros para la plantilla
   * @param {Blob|File} document - Documento a enviar
   * @returns {Promise<Object>} Resultado del envío
   */
  async sendDocument(templateType, phoneNumber, params, document) {
    try {
      // Verificar si está habilitado
      if (!this.isEnabled() || !this.isFeatureEnabled('documents')) {
        return {
          success: false,
          error: 'La integración con WhatsApp para documentos no está habilitada'
        };
      }
      
      // Obtener plantilla
      const template = this.getTemplate(templateType);
      if (!template) {
        return {
          success: false,
          error: `No se encontró la plantilla para ${templateType}`
        };
      }
      
      // Preparar parámetros
      const templateParams = template.params.map(param => ({
        type: 'text',
        text: params[param] || `[${param}]`
      }));
      
      // Enviar mensaje con documento adjunto
      const result = await whatsappApi.sendDocumentWithTemplate(
        this.config.apiKey,
        phoneNumber,
        template.name,
        templateParams,
        document
      );
      
      logger.info('Documento enviado por WhatsApp', { 
        templateType, 
        phoneNumber, 
        messageId: result.messageId 
      });
      
      return {
        success: true,
        messageId: result.messageId
      };
    } catch (error) {
      logger.error('Error al enviar documento por WhatsApp', error);
      
      return {
        success: false,
        error: error.message || 'Error desconocido al enviar documento'
      };
    }
  }

  /**
   * Envía una oferta personalizada por WhatsApp
   * @param {string} phoneNumber - Número de teléfono
   * @param {Object} offerParams - Parámetros de la oferta
   * @returns {Promise<Object>} Resultado del envío
   */
  async sendOffer(phoneNumber, offerParams) {
    try {
      // Verificar si está habilitado
      if (!this.isEnabled() || !this.isFeatureEnabled('offers')) {
        return {
          success: false,
          error: 'La integración con WhatsApp para ofertas no está habilitada'
        };
      }
      
      // Obtener plantilla
      const template = this.getTemplate(TEMPLATE_TYPES.OFERTA);
      if (!template) {
        return {
          success: false,
          error: 'No se encontró la plantilla para ofertas'
        };
      }
      
      // Preparar parámetros
      const templateParams = template.params.map(param => ({
        type: 'text',
        text: offerParams[param] || `[${param}]`
      }));
      
      // Enviar mensaje
      const result = await whatsappApi.sendTemplateMessage(
        this.config.apiKey,
        phoneNumber,
        template.name,
        templateParams
      );
      
      logger.info('Oferta enviada por WhatsApp', { 
        phoneNumber, 
        messageId: result.messageId 
      });
      
      return {
        success: true,
        messageId: result.messageId
      };
    } catch (error) {
      logger.error('Error al enviar oferta por WhatsApp', error);
      
      return {
        success: false,
        error: error.message || 'Error desconocido al enviar oferta'
      };
    }
  }

  /**
   * Envía una respuesta de consulta de stock
   * @param {string} phoneNumber - Número de teléfono
   * @param {Object} stockParams - Parámetros para la consulta de stock
   * @returns {Promise<Object>} Resultado del envío
   */
  async sendStockResponse(phoneNumber, stockParams) {
    // Implementación similar a sendOffer pero para consultas de stock
    try {
      // Verificar si está habilitado
      if (!this.isEnabled() || !this.isFeatureEnabled('stockQueries')) {
        return {
          success: false,
          error: 'La integración con WhatsApp para consultas de stock no está habilitada'
        };
      }
      
      // Obtener plantilla
      const template = this.getTemplate(TEMPLATE_TYPES.CONSULTA_STOCK);
      if (!template) {
        return {
          success: false,
          error: 'No se encontró la plantilla para consultas de stock'
        };
      }
      
      // Preparar parámetros
      const templateParams = template.params.map(param => ({
        type: 'text',
        text: stockParams[param] || `[${param}]`
      }));
      
      // Enviar mensaje
      const result = await whatsappApi.sendTemplateMessage(
        this.config.apiKey,
        phoneNumber,
        template.name,
        templateParams
      );
      
      logger.info('Respuesta de stock enviada por WhatsApp', { 
        phoneNumber, 
        messageId: result.messageId 
      });
      
      return {
        success: true,
        messageId: result.messageId
      };
    } catch (error) {
      logger.error('Error al enviar respuesta de stock por WhatsApp', error);
      
      return {
        success: false,
        error: error.message || 'Error desconocido al enviar respuesta de stock'
      };
    }
  }

  /**
   * Envía una notificación de estado de pedido
   * @param {string} phoneNumber - Número de teléfono
   * @param {Object} orderParams - Parámetros del estado del pedido
   * @returns {Promise<Object>} Resultado del envío
   */
  async sendOrderStatus(phoneNumber, orderParams) {
    // Implementación similar a sendOffer pero para estados de pedido
    try {
      // Verificar si está habilitado
      if (!this.isEnabled() || !this.isFeatureEnabled('orderStatus')) {
        return {
          success: false,
          error: 'La integración con WhatsApp para estados de pedido no está habilitada'
        };
      }
      
      // Obtener plantilla
      const template = this.getTemplate(TEMPLATE_TYPES.ESTADO_PEDIDO);
      if (!template) {
        return {
          success: false,
          error: 'No se encontró la plantilla para estados de pedido'
        };
      }
      
      // Preparar parámetros
      const templateParams = template.params.map(param => ({
        type: 'text',
        text: orderParams[param] || `[${param}]`
      }));
      
      // Enviar mensaje
      const result = await whatsappApi.sendTemplateMessage(
        this.config.apiKey,
        phoneNumber,
        template.name,
        templateParams
      );
      
      logger.info('Estado de pedido enviado por WhatsApp', { 
        phoneNumber, 
        messageId: result.messageId 
      });
      
      return {
        success: true,
        messageId: result.messageId
      };
    } catch (error) {
      logger.error('Error al enviar estado de pedido por WhatsApp', error);
      
      return {
        success: false,
        error: error.message || 'Error desconocido al enviar estado de pedido'
      };
    }
  }
}

// Exportar una instancia singleton
const whatsappConfig = new WhatsAppConfig();
export default whatsappConfig;

// Exportar constantes y tipos para uso en otros módulos
export const WhatsAppTemplateTypes = TEMPLATE_TYPES;