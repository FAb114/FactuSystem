/**
 * email.js
 * Módulo para la configuración e integración de envío de correos electrónicos en FactuSystem
 * Este módulo gestiona la configuración SMTP, plantillas de correo, y funcionalidades de envío
 */

// Importaciones
const { ipcRenderer } = require('electron');
const validator = require('../../../utils/validation');
const logger = require('../../../utils/logger');
const database = require('../../../utils/database');

// Configuración por defecto
const DEFAULT_CONFIG = {
    smtp: {
        host: '',
        port: 587,
        secure: false, // true para 465, false para otros puertos
        auth: {
            user: '',
            pass: ''
        }
    },
    sender: {
        name: '',
        email: ''
    },
    templates: {
        factura: {
            subject: 'Su factura de {empresa}',
            body: `
                <h2>Estimado/a {cliente},</h2>
                <p>Adjunto encontrará su factura {nroFactura} por un total de {total}.</p>
                <p>Gracias por confiar en {empresa}.</p>
                <p>Saludos cordiales,<br>El equipo de {empresa}</p>
            `
        },
        presupuesto: {
            subject: 'Presupuesto de {empresa}',
            body: `
                <h2>Estimado/a {cliente},</h2>
                <p>Adjunto encontrará el presupuesto solicitado por un total de {total}.</p>
                <p>Este presupuesto tiene una validez de 15 días.</p>
                <p>Ante cualquier consulta, no dude en contactarnos.</p>
                <p>Saludos cordiales,<br>El equipo de {empresa}</p>
            `
        },
        notaCredito: {
            subject: 'Nota de Crédito - {empresa}',
            body: `
                <h2>Estimado/a {cliente},</h2>
                <p>Adjunto encontrará la nota de crédito {nroNota} por un total de {total}.</p>
                <p>Saludos cordiales,<br>El equipo de {empresa}</p>
            `
        },
        notaDebito: {
            subject: 'Nota de Débito - {empresa}',
            body: `
                <h2>Estimado/a {cliente},</h2>
                <p>Adjunto encontrará la nota de débito {nroNota} por un total de {total}.</p>
                <p>Saludos cordiales,<br>El equipo de {empresa}</p>
            `
        },
        remito: {
            subject: 'Remito de {empresa}',
            body: `
                <h2>Estimado/a {cliente},</h2>
                <p>Adjunto encontrará el remito {nroRemito} correspondiente a su compra.</p>
                <p>Saludos cordiales,<br>El equipo de {empresa}</p>
            `
        },
        personalizado: {
            subject: 'Mensaje de {empresa}',
            body: `
                <h2>Estimado/a {cliente},</h2>
                <p>Mensaje personalizado de {empresa}.</p>
                <p>Saludos cordiales,<br>El equipo de {empresa}</p>
            `
        }
    },
    settings: {
        sendCopyToSender: true,
        autoSendFacturas: false,
        maxRetries: 3,
        retryInterval: 60000, // 1 minuto en milisegundos
        logEmails: true
    }
};

/**
 * Clase para gestionar la configuración de email
 */
class EmailConfigManager {
    constructor() {
        this.config = null;
        this.testResult = null;
        this.initialized = false;
        this.loadingState = 'idle';
        this.error = null;

        // Elementos DOM relevantes
        this.elements = {};
        
        // Bindeo de métodos
        this.init = this.init.bind(this);
        this.loadConfig = this.loadConfig.bind(this);
        this.saveConfig = this.saveConfig.bind(this);
        this.testConnection = this.testConnection.bind(this);
        this.renderConfig = this.renderConfig.bind(this);
        this.bindEvents = this.bindEvents.bind(this);
        this.sendTestEmail = this.sendTestEmail.bind(this);
        this.validateForm = this.validateForm.bind(this);
        this.resetToDefaults = this.resetToDefaults.bind(this);
        this.renderTemplateEditor = this.renderTemplateEditor.bind(this);
        this.updateTemplatePreview = this.updateTemplatePreview.bind(this);
        this.initTemplateVariableHelper = this.initTemplateVariableHelper.bind(this);
    }

    /**
     * Inicializa el módulo de configuración de email
     */
    async init() {
        try {
            this.loadingState = 'loading';
            this.renderLoadingState();
            
            // Cargar configuración
            await this.loadConfig();
            
            // Capturar elementos DOM
            this.captureElements();
            
            // Renderizar configuración
            this.renderConfig();
            
            // Enlazar eventos
            this.bindEvents();
            
            // Inicializar el editor de plantillas
            this.initTemplateEditor();
            
            // Inicializar el selector de variables para plantillas
            this.initTemplateVariableHelper();
            
            this.initialized = true;
            this.loadingState = 'success';
            
            logger.log('info', 'Módulo de configuración de email inicializado correctamente');
        } catch (error) {
            this.loadingState = 'error';
            this.error = error.message || 'Error desconocido al inicializar el módulo de email';
            logger.log('error', `Error al inicializar el módulo de configuración de email: ${error.message}`);
        } finally {
            this.renderLoadingState();
        }
    }

    /**
     * Captura los elementos DOM relevantes
     */
    captureElements() {
        // Formulario principal
        this.elements.form = document.querySelector('#email-config-form');
        
        // Campos SMTP
        this.elements.smtpHost = document.querySelector('#smtp-host');
        this.elements.smtpPort = document.querySelector('#smtp-port');
        this.elements.smtpSecure = document.querySelector('#smtp-secure');
        this.elements.smtpUser = document.querySelector('#smtp-user');
        this.elements.smtpPass = document.querySelector('#smtp-pass');
        
        // Campos de remitente
        this.elements.senderName = document.querySelector('#sender-name');
        this.elements.senderEmail = document.querySelector('#sender-email');
        
        // Campos de configuración
        this.elements.sendCopyToSender = document.querySelector('#send-copy-to-sender');
        this.elements.autoSendFacturas = document.querySelector('#auto-send-facturas');
        this.elements.maxRetries = document.querySelector('#max-retries');
        this.elements.retryInterval = document.querySelector('#retry-interval');
        this.elements.logEmails = document.querySelector('#log-emails');
        
        // Botones
        this.elements.saveBtn = document.querySelector('#save-email-config');
        this.elements.testBtn = document.querySelector('#test-email-connection');
        this.elements.resetBtn = document.querySelector('#reset-email-defaults');
        this.elements.sendTestEmailBtn = document.querySelector('#send-test-email');
        
        // Elementos de estado
        this.elements.testResult = document.querySelector('#email-test-result');
        this.elements.loadingIndicator = document.querySelector('#email-loading-indicator');
        this.elements.errorMessage = document.querySelector('#email-error-message');
        
        // Elementos para plantillas
        this.elements.templateSelector = document.querySelector('#email-template-selector');
        this.elements.templateSubject = document.querySelector('#email-template-subject');
        this.elements.templateBody = document.querySelector('#email-template-body');
        this.elements.templatePreview = document.querySelector('#email-template-preview');
        this.elements.variableSelector = document.querySelector('#email-variable-selector');
    }

    /**
     * Renderiza el estado de carga
     */
    renderLoadingState() {
        if (!this.elements.loadingIndicator || !this.elements.errorMessage) return;
        
        switch (this.loadingState) {
            case 'loading':
                this.elements.loadingIndicator.style.display = 'block';
                this.elements.errorMessage.style.display = 'none';
                break;
            case 'error':
                this.elements.loadingIndicator.style.display = 'none';
                this.elements.errorMessage.style.display = 'block';
                this.elements.errorMessage.textContent = this.error;
                break;
            case 'success':
            case 'idle':
                this.elements.loadingIndicator.style.display = 'none';
                this.elements.errorMessage.style.display = 'none';
                break;
        }
    }

    /**
     * Carga la configuración desde la base de datos
     */
    async loadConfig() {
        try {
            const configData = await database.getConfig('email');
            
            if (configData && Object.keys(configData).length > 0) {
                this.config = configData;
            } else {
                // Si no hay configuración, usar la configuración por defecto
                this.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
                // Guardar la configuración por defecto
                await this.saveConfig(false);
            }
            
            logger.log('info', 'Configuración de email cargada correctamente');
        } catch (error) {
            logger.log('error', `Error al cargar la configuración de email: ${error.message}`);
            this.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
            throw new Error(`Error al cargar la configuración de email: ${error.message}`);
        }
    }

    /**
     * Guarda la configuración en la base de datos
     * @param {boolean} showNotification - Indica si se debe mostrar una notificación
     */
    async saveConfig(showNotification = true) {
        try {
            await database.saveConfig('email', this.config);
            
            if (showNotification) {
                // Notificar al usuario
                const notification = document.createElement('div');
                notification.className = 'notification success';
                notification.textContent = 'Configuración de email guardada correctamente';
                document.body.appendChild(notification);
                
                // Eliminar la notificación después de 3 segundos
                setTimeout(() => {
                    notification.classList.add('fade-out');
                    setTimeout(() => {
                        document.body.removeChild(notification);
                    }, 500);
                }, 3000);
            }
            
            logger.log('info', 'Configuración de email guardada correctamente');
            
            // Notificar al proceso principal sobre el cambio de configuración
            ipcRenderer.send('email-config-updated', this.config);
            
            return true;
        } catch (error) {
            logger.log('error', `Error al guardar la configuración de email: ${error.message}`);
            
            if (showNotification) {
                // Notificar al usuario del error
                const notification = document.createElement('div');
                notification.className = 'notification error';
                notification.textContent = `Error al guardar la configuración: ${error.message}`;
                document.body.appendChild(notification);
                
                // Eliminar la notificación después de 5 segundos
                setTimeout(() => {
                    notification.classList.add('fade-out');
                    setTimeout(() => {
                        document.body.removeChild(notification);
                    }, 500);
                }, 5000);
            }
            
            return false;
        }
    }

    /**
     * Renderiza la configuración en la interfaz
     */
    renderConfig() {
        if (!this.config) return;
        
        // Configuración SMTP
        this.elements.smtpHost.value = this.config.smtp.host;
        this.elements.smtpPort.value = this.config.smtp.port;
        this.elements.smtpSecure.checked = this.config.smtp.secure;
        this.elements.smtpUser.value = this.config.smtp.auth.user;
        this.elements.smtpPass.value = this.config.smtp.auth.pass;
        
        // Configuración de remitente
        this.elements.senderName.value = this.config.sender.name;
        this.elements.senderEmail.value = this.config.sender.email;
        
        // Configuración general
        this.elements.sendCopyToSender.checked = this.config.settings.sendCopyToSender;
        this.elements.autoSendFacturas.checked = this.config.settings.autoSendFacturas;
        this.elements.maxRetries.value = this.config.settings.maxRetries;
        this.elements.retryInterval.value = this.config.settings.retryInterval / 1000; // Convertir de ms a segundos para la UI
        this.elements.logEmails.checked = this.config.settings.logEmails;
        
        // Actualizar selector de plantillas
        this.updateTemplateSelector();
    }

    /**
     * Actualiza el selector de plantillas
     */
    updateTemplateSelector() {
        if (!this.elements.templateSelector) return;
        
        // Limpiar selector
        this.elements.templateSelector.innerHTML = '';
        
        // Añadir opciones para cada plantilla
        Object.keys(this.config.templates).forEach(templateKey => {
            const option = document.createElement('option');
            option.value = templateKey;
            option.textContent = this.getTemplateName(templateKey);
            this.elements.templateSelector.appendChild(option);
        });
        
        // Seleccionar la primera opción y cargar su contenido
        if (this.elements.templateSelector.options.length > 0) {
            this.elements.templateSelector.selectedIndex = 0;
            this.loadTemplateContent(this.elements.templateSelector.value);
        }
    }

    /**
     * Obtiene el nombre legible de una plantilla a partir de su clave
     * @param {string} templateKey - Clave de la plantilla
     * @returns {string} Nombre legible de la plantilla
     */
    getTemplateName(templateKey) {
        const templateNames = {
            factura: 'Factura',
            presupuesto: 'Presupuesto',
            notaCredito: 'Nota de Crédito',
            notaDebito: 'Nota de Débito',
            remito: 'Remito',
            personalizado: 'Mensaje Personalizado'
        };
        
        return templateNames[templateKey] || templateKey.charAt(0).toUpperCase() + templateKey.slice(1);
    }

    /**
     * Carga el contenido de una plantilla en el editor
     * @param {string} templateKey - Clave de la plantilla a cargar
     */
    loadTemplateContent(templateKey) {
        if (!this.config.templates[templateKey]) return;
        
        const template = this.config.templates[templateKey];
        
        this.elements.templateSubject.value = template.subject;
        this.elements.templateBody.value = template.body;
        
        // Actualizar la vista previa
        this.updateTemplatePreview();
    }

    /**
     * Enlaza los eventos de la interfaz
     */
    bindEvents() {
        // Formulario principal
        this.elements.form.addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveFormData();
        });
        
        // Botones
        this.elements.saveBtn.addEventListener('click', () => {
            if (this.validateForm()) {
                this.saveFormData();
            }
        });
        
        this.elements.testBtn.addEventListener('click', () => {
            this.testConnection();
        });
        
        this.elements.resetBtn.addEventListener('click', () => {
            if (confirm('¿Está seguro de restablecer la configuración a los valores predeterminados?')) {
                this.resetToDefaults();
            }
        });
        
        this.elements.sendTestEmailBtn.addEventListener('click', () => {
            this.sendTestEmail();
        });
        
        // Selector de plantillas
        this.elements.templateSelector.addEventListener('change', () => {
            this.loadTemplateContent(this.elements.templateSelector.value);
        });
        
        // Evento para actualizar la vista previa al cambiar el contenido
        this.elements.templateSubject.addEventListener('input', () => {
            this.updateTemplatePreview();
        });
        
        this.elements.templateBody.addEventListener('input', () => {
            this.updateTemplatePreview();
        });
        
        // Toggle para mostrar/ocultar contraseña
        const togglePasswordBtn = document.querySelector('#toggle-smtp-pass');
        if (togglePasswordBtn) {
            togglePasswordBtn.addEventListener('click', () => {
                const passField = this.elements.smtpPass;
                passField.type = passField.type === 'password' ? 'text' : 'password';
                togglePasswordBtn.textContent = passField.type === 'password' ? '👁️' : '🔒';
            });
        }
    }

    /**
     * Guarda los datos del formulario
     */
    saveFormData() {
        if (!this.validateForm()) return;
        
        // Actualizar configuración con los valores del formulario
        this.config.smtp.host = this.elements.smtpHost.value.trim();
        this.config.smtp.port = parseInt(this.elements.smtpPort.value, 10);
        this.config.smtp.secure = this.elements.smtpSecure.checked;
        this.config.smtp.auth.user = this.elements.smtpUser.value.trim();
        this.config.smtp.auth.pass = this.elements.smtpPass.value;
        
        this.config.sender.name = this.elements.senderName.value.trim();
        this.config.sender.email = this.elements.senderEmail.value.trim();
        
        this.config.settings.sendCopyToSender = this.elements.sendCopyToSender.checked;
        this.config.settings.autoSendFacturas = this.elements.autoSendFacturas.checked;
        this.config.settings.maxRetries = parseInt(this.elements.maxRetries.value, 10);
        this.config.settings.retryInterval = parseInt(this.elements.retryInterval.value, 10) * 1000; // Convertir de segundos a ms
        this.config.settings.logEmails = this.elements.logEmails.checked;
        
        // Guardar la plantilla actual
        const currentTemplate = this.elements.templateSelector.value;
        if (currentTemplate && this.config.templates[currentTemplate]) {
            this.config.templates[currentTemplate].subject = this.elements.templateSubject.value;
            this.config.templates[currentTemplate].body = this.elements.templateBody.value;
        }
        
        // Guardar la configuración
        this.saveConfig();
    }

    /**
     * Valida el formulario
     * @returns {boolean} True si el formulario es válido, false en caso contrario
     */
    validateForm() {
        const validations = [
            { field: this.elements.smtpHost, message: 'El servidor SMTP es requerido', validator: val => val.trim().length > 0 },
            { field: this.elements.smtpPort, message: 'El puerto debe ser un número entre 1 y 65535', validator: val => validator.isInteger(val, 1, 65535) },
            { field: this.elements.smtpUser, message: 'El usuario SMTP es requerido', validator: val => val.trim().length > 0 },
            { field: this.elements.smtpPass, message: 'La contraseña SMTP es requerida', validator: val => val.length > 0 },
            { field: this.elements.senderName, message: 'El nombre del remitente es requerido', validator: val => val.trim().length > 0 },
            { field: this.elements.senderEmail, message: 'El email del remitente debe ser una dirección válida', validator: val => validator.isEmail(val) },
            { field: this.elements.maxRetries, message: 'Los reintentos deben ser un número entre 0 y 10', validator: val => validator.isInteger(val, 0, 10) },
            { field: this.elements.retryInterval, message: 'El intervalo debe ser un número entre 10 y 3600 segundos', validator: val => validator.isInteger(val, 10, 3600) }
        ];

        let isValid = true;
        const errorMessages = [];

        // Eliminar mensajes de error anteriores
        document.querySelectorAll('.validation-error').forEach(el => el.remove());

        // Validar cada campo
        validations.forEach(v => {
            if (!v.validator(v.field.value)) {
                isValid = false;
                errorMessages.push(v.message);
                
                // Mostrar el error junto al campo
                const errorEl = document.createElement('div');
                errorEl.className = 'validation-error';
                errorEl.textContent = v.message;
                v.field.parentNode.appendChild(errorEl);
                
                // Resaltar el campo con error
                v.field.classList.add('error-field');
            } else {
                v.field.classList.remove('error-field');
            }
        });

        if (!isValid) {
            // Mostrar un mensaje general
            const errorSummary = document.createElement('div');
            errorSummary.className = 'validation-error-summary';
            errorSummary.innerHTML = `<strong>Errores de validación:</strong><ul>${errorMessages.map(msg => `<li>${msg}</li>`).join('')}</ul>`;
            
            // Insertar al principio del formulario
            this.elements.form.prepend(errorSummary);
            
            // Eliminar después de 5 segundos
            setTimeout(() => {
                errorSummary.remove();
            }, 5000);
        }

        return isValid;
    }

    /**
     * Prueba la conexión al servidor SMTP
     */
    async testConnection() {
        try {
            // Validar los campos necesarios para la prueba
            const requiredFields = [
                { field: this.elements.smtpHost, message: 'El servidor SMTP es requerido' },
                { field: this.elements.smtpPort, message: 'El puerto SMTP es requerido' },
                { field: this.elements.smtpUser, message: 'El usuario SMTP es requerido' },
                { field: this.elements.smtpPass, message: 'La contraseña SMTP es requerida' }
            ];
            
            for (const field of requiredFields) {
                if (!field.field.value) {
                    this.showTestResult(false, field.message);
                    return;
                }
            }
            
            // Mostrar indicador de carga
            this.showTestResult(null, 'Probando conexión...');
            
            // Preparar datos de configuración para la prueba
            const testConfig = {
                host: this.elements.smtpHost.value,
                port: parseInt(this.elements.smtpPort.value, 10),
                secure: this.elements.smtpSecure.checked,
                auth: {
                    user: this.elements.smtpUser.value,
                    pass: this.elements.smtpPass.value
                }
            };
            
            // Enviar solicitud al proceso principal para probar la conexión
            const result = await ipcRenderer.invoke('test-email-connection', testConfig);
            
            if (result.success) {
                this.showTestResult(true, 'Conexión exitosa al servidor SMTP');
            } else {
                this.showTestResult(false, `Error de conexión: ${result.error}`);
            }
        } catch (error) {
            this.showTestResult(false, `Error inesperado: ${error.message}`);
            logger.log('error', `Error al probar la conexión SMTP: ${error.message}`);
        }
    }

    /**
     * Muestra el resultado de la prueba de conexión
     * @param {boolean|null} success - true si la prueba fue exitosa, false si falló, null si está en proceso
     * @param {string} message - Mensaje a mostrar
     */
    showTestResult(success, message) {
        if (!this.elements.testResult) return;
        
        // Eliminar clases anteriores
        this.elements.testResult.classList.remove('success', 'error', 'loading');
        
        // Establecer la clase según el resultado
        if (success === true) {
            this.elements.testResult.classList.add('success');
        } else if (success === false) {
            this.elements.testResult.classList.add('error');
        } else {
            this.elements.testResult.classList.add('loading');
        }
        
        // Establecer el mensaje
        this.elements.testResult.textContent = message;
        
        // Mostrar el resultado
        this.elements.testResult.style.display = 'block';
        
        // Si es un resultado final (éxito o error), ocultarlo después de un tiempo
        if (success !== null) {
            setTimeout(() => {
                this.elements.testResult.classList.add('fade-out');
                setTimeout(() => {
                    this.elements.testResult.style.display = 'none';
                    this.elements.testResult.classList.remove('fade-out');
                }, 500);
            }, 5000);
        }
    }

    /**
     * Envía un correo electrónico de prueba
     */
    async sendTestEmail() {
        try {
            // Validar los campos necesarios
            if (!this.validateForm()) {
                return;
            }
            
            // Obtener el email de destino
            const testEmailModal = document.getElementById('test-email-modal');
            if (!testEmailModal) {
                // Crear modal para ingresar el email de destino
                this.createTestEmailModal();
                return;
            }
            
            const testEmailInput = document.getElementById('test-email-address');
            if (!testEmailInput || !validator.isEmail(testEmailInput.value)) {
                alert('Por favor, ingrese una dirección de correo electrónico válida.');
                return;
            }
            
            // Mostrar indicador de carga
            const sendingIndicator = document.getElementById('sending-test-email-indicator');
            if (sendingIndicator) {
                sendingIndicator.style.display = 'block';
            }
            
            // Preparar los datos para el envío
            const testEmailData = {
                config: {
                    smtp: {
                        host: this.elements.smtpHost.value,
                        port: parseInt(this.elements.smtpPort.value, 10),
                        secure: this.elements.smtpSecure.checked,
                        auth: {
                            user: this.elements.smtpUser.value,
                            pass: this.elements.smtpPass.value
                        }
                    },
                    sender: {
                        name: this.elements.senderName.value,
                        email: this.elements.senderEmail.value
                    }
                },
                to: testEmailInput.value,
                subject: 'Correo de prueba de FactuSystem',
                body: `
                    <h2>Correo de prueba</h2>
                    <p>Este es un correo de prueba enviado desde FactuSystem para verificar la configuración de correo electrónico.</p>
                    <p>Si recibiste este correo, la configuración es correcta.</p>
                    <p>Fecha y hora de envío: ${new Date().toLocaleString()}</p>
                `
            };
            
            // Enviar solicitud al proceso principal para enviar el correo
            const result = await ipcRenderer.invoke('send-test-email', testEmailData);
            
            // Ocultar indicador de carga
            if (sendingIndicator) {
                sendingIndicator.style.display = 'none';
            }
            
            // Cerrar el modal
            const closeBtn = document.getElementById('close-test-email-modal');
            if (closeBtn) {
                closeBtn.click();
            }
            
            // Mostrar resultado
            if (result.success) {
                alert('Correo de prueba enviado correctamente. Verifique la bandeja de entrada del destinatario.');
            } else {
                alert(`Error al enviar el correo de prueba: ${result.error}`);
            }
        } catch (error) {
            logger.log('error', `Error al enviar correo de prueba: ${error.message}`);
            alert(`Error inesperado al enviar el correo de prueba: ${error.message}`);
        }
    }

    /**
     * Crea un modal para ingresar el email de destino para la prueba
     */
    createTestEmailModal() {
        // Crear el modal
        const modal = document.createElement('div');
        modal.id = 'test-email-modal';
        modal.className = 'modal';
        
        // Contenido del modal
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Enviar correo de prueba</h3>
                    <span id="close-test-email-modal" class="close-modal">&times;</span>
                </div>
                <div class="modal-body">
                    <p>Ingrese la dirección de correo electrónico a la que desea enviar el correo de prueba:</p>
                    <div class="form-group">
                        <label for="test-email-address">Correo electrónico:</label>
                        <input type="email" id="test-email-address" class="form-control" placeholder="ejemplo@correo.com" required>
                    </div>
                    <div id="sending-test-email-indicator" class="loading-indicator" style="display: none;">
                        <span class="spinner"></span> Enviando correo de prueba...
                    </div>
                </div>
                <div class="modal-footer">
                    <button id="send-test-email-btn" class="btn btn-primary">Enviar</button>
                    <button id="cancel-test-email-btn" class="btn btn-secondary">Cancelar</button>
                </div>
            </div>
        `;
        
        // Añadir el modal al cuerpo del documento
        document.body.appendChild(modal);
        
        // Mostrar el modal
        modal.style.display = 'block';
        
        // Eventos del modal
        document.getElementById('close-test-email-modal').addEventListener('click', () => {
            modal.style.display = 'none';
            document.body.removeChild(modal);
        });
        
        document.getElementById('cancel-test-email-btn').addEventListener('click', () => {
            modal.style.display = 'none';
            document.body.removeChild(modal);
        });
        
        document.getElementById('send-test-email-btn').addEventListener('click', () => {
            const emailInput = document.getElementById('test-email-address');
            if (!emailInput || !validator.isEmail(emailInput.value)) {
                alert('Por favor, ingrese una dirección de correo electrónico válida.');
                return;
            }
            
            this.sendTestEmail();
        });
        
        // Enfocar el campo de email
        document.getElementById('test-email-address').focus();
    }

    /**
     * Restablece la configuración a los valores predeterminados
     */
    resetToDefaults() {
        this.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
        this.renderConfig();
        this.saveConfig();
    }

    /**
     * Inicializa el editor de plantillas
     */
    initTemplateEditor() {
        if (!this.elements.templateSelector || !this.elements.templateSubject || !this.elements.templateBody) return;
        
        // Actualizar selector de plantillas
        this.updateTemplateSelector();
        
        // Crear botón para añadir nueva plantilla
        const addTemplateBtn = document.createElement('button');
        addTemplateBtn.id = 'add-template-btn';
        addTemplateBtn.className = 'btn btn-secondary';
        addTemplateBtn.textContent = 'Nueva Plantilla';
        addTemplateBtn.addEventListener('click', () => {
            this.createNewTemplateModal();
        });
        
        // Insertar botón junto al selector
        this.elements.templateSelector.parentNode.appendChild(addTemplateBtn);
        
        // Crear botón para eliminar plantilla
        const deleteTemplateBtn = document.createElement('button');
        deleteTemplateBtn.id = 'delete-template-btn';
        deleteTemplateBtn.className = 'btn btn-danger';
        deleteTemplateBtn.textContent = 'Eliminar';
        deleteTemplateBtn.addEventListener('click', () => {
            const templateKey = this.elements.templateSelector.value;
            if (templateKey && this.isDefaultTemplate(templateKey)) {
                alert('No se pueden eliminar las plantillas predeterminadas del sistema.');
                return;
            }
            
            if (templateKey && confirm(`¿Está seguro de eliminar la plantilla "${this.getTemplateName(templateKey)}"?`)) {
                delete this.config.templates[templateKey];
                this.updateTemplateSelector();
                this.saveConfig();
            }
        });
        
        // Insertar botón junto al selector
        this.elements.templateSelector.parentNode.appendChild(deleteTemplateBtn);
    }

    /**
     * Verifica si una plantilla es predeterminada
     * @param {string} templateKey - Clave de la plantilla
     * @returns {boolean} True si es una plantilla predeterminada
     */
    isDefaultTemplate(templateKey) {
        const defaultTemplates = ['factura', 'presupuesto', 'notaCredito', 'notaDebito', 'remito', 'personalizado'];
        return defaultTemplates.includes(templateKey);
    }

    /**
     * Crea un modal para añadir una nueva plantilla
     */
    createNewTemplateModal() {
        // Crear el modal
        const modal = document.createElement('div');
        modal.id = 'new-template-modal';
        modal.className = 'modal';
        
        // Contenido del modal
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Nueva Plantilla de Correo</h3>
                    <span id="close-new-template-modal" class="close-modal">&times;</span>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label for="new-template-key">Identificador:</label>
                        <input type="text" id="new-template-key" class="form-control" placeholder="identificador" required>
                        <small class="form-text text-muted">Solo letras, números y guiones bajos. Sin espacios.</small>
                    </div>
                    <div class="form-group">
                        <label for="new-template-name">Nombre:</label>
                        <input type="text" id="new-template-name" class="form-control" placeholder="Nombre de la plantilla" required>
                    </div>
                </div>
                <div class="modal-footer">
                    <button id="create-template-btn" class="btn btn-primary">Crear</button>
                    <button id="cancel-new-template-btn" class="btn btn-secondary">Cancelar</button>
                </div>
            </div>
        `;
        
        // Añadir el modal al cuerpo del documento
        document.body.appendChild(modal);
        
        // Mostrar el modal
        modal.style.display = 'block';
        
        // Eventos del modal
        document.getElementById('close-new-template-modal').addEventListener('click', () => {
            modal.style.display = 'none';
            document.body.removeChild(modal);
        });
        
        document.getElementById('cancel-new-template-btn').addEventListener('click', () => {
            modal.style.display = 'none';
            document.body.removeChild(modal);
        });
        
        document.getElementById('create-template-btn').addEventListener('click', () => {
            const keyInput = document.getElementById('new-template-key');
            const nameInput = document.getElementById('new-template-name');
            
            if (!keyInput.value || !nameInput.value) {
                alert('Todos los campos son obligatorios.');
                return;
            }
            
            // Validar formato del identificador
            if (!/^[a-zA-Z0-9_]+$/.test(keyInput.value)) {
                alert('El identificador solo puede contener letras, números y guiones bajos. Sin espacios.');
                return;
            }
            
            // Verificar si ya existe
            if (this.config.templates[keyInput.value]) {
                alert('Ya existe una plantilla con ese identificador.');
                return;
            }
            
            // Crear nueva plantilla
            this.config.templates[keyInput.value] = {
                subject: `Mensaje de {empresa}`,
                body: `
                    <h2>Estimado/a {cliente},</h2>
                    <p>Este es un mensaje de {empresa}.</p>
                    <p>Saludos cordiales,<br>El equipo de {empresa}</p>
                `
            };
            
            // Actualizar selector y guardar
            this.updateTemplateSelector();
            this.saveConfig();
            
            // Seleccionar la nueva plantilla
            this.elements.templateSelector.value = keyInput.value;
            this.loadTemplateContent(keyInput.value);
            
            // Cerrar modal
            modal.style.display = 'none';
            document.body.removeChild(modal);
        });
        
        // Enfocar el campo de identificador
        document.getElementById('new-template-key').focus();
    }

    /**
     * Inicializa el ayudante de variables para plantillas
     */
    initTemplateVariableHelper() {
        if (!this.elements.variableSelector) return;
        
        // Variables disponibles
        const variables = [
            { name: '{empresa}', description: 'Nombre de la empresa' },
            { name: '{cliente}', description: 'Nombre del cliente' },
            { name: '{nroFactura}', description: 'Número de factura' },
            { name: '{nroNota}', description: 'Número de nota (crédito/débito)' },
            { name: '{nroRemito}', description: 'Número de remito' },
            { name: '{total}', description: 'Monto total' },
            { name: '{fecha}', description: 'Fecha de emisión' },
            { name: '{vencimiento}', description: 'Fecha de vencimiento' },
            { name: '{items}', description: 'Lista de productos/servicios' },
            { name: '{subtotal}', description: 'Subtotal sin impuestos' },
            { name: '{impuestos}', description: 'Total de impuestos' },
            { name: '{usuario}', description: 'Usuario que genera el documento' },
            { name: '{sucursal}', description: 'Nombre de la sucursal' }
        ];
        
        // Limpiar selector
        this.elements.variableSelector.innerHTML = '';
        
        // Añadir opción por defecto
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = 'Insertar variable...';
        defaultOption.disabled = true;
        defaultOption.selected = true;
        this.elements.variableSelector.appendChild(defaultOption);
        
        // Añadir variables
        variables.forEach(v => {
            const option = document.createElement('option');
            option.value = v.name;
            option.textContent = `${v.name} - ${v.description}`;
            this.elements.variableSelector.appendChild(option);
        });
        
        // Evento para insertar variable
        this.elements.variableSelector.addEventListener('change', () => {
            const variable = this.elements.variableSelector.value;
            if (!variable) return;
            
            // Determinar dónde insertar la variable
            if (document.activeElement === this.elements.templateSubject) {
                this.insertAtCursor(this.elements.templateSubject, variable);
            } else {
                this.insertAtCursor(this.elements.templateBody, variable);
            }
            
            // Restablecer selector
            this.elements.variableSelector.selectedIndex = 0;
            
            // Actualizar vista previa
            this.updateTemplatePreview();
        });
    }

    /**
     * Inserta texto en la posición del cursor en un campo de texto
     * @param {HTMLElement} field - Campo de texto
     * @param {string} text - Texto a insertar
     */
    insertAtCursor(field, text) {
        if (!field) return;
        
        const startPos = field.selectionStart;
        const endPos = field.selectionEnd;
        const beforeText = field.value.substring(0, startPos);
        const afterText = field.value.substring(endPos, field.value.length);
        
        field.value = beforeText + text + afterText;
        field.selectionStart = startPos + text.length;
        field.selectionEnd = startPos + text.length;
        field.focus();
    }

    /**
     * Actualiza la vista previa de la plantilla
     */
    updateTemplatePreview() {
        if (!this.elements.templatePreview) return;
        
        // Obtener datos actuales
        const subject = this.elements.templateSubject.value;
        const body = this.elements.templateBody.value;
        
        // Datos de ejemplo para la vista previa
        const empresaInfo = {
            empresa: 'Mi Empresa S.A.',
            cliente: 'Juan Pérez',
            nroFactura: 'A-0001-00000123',
            nroNota: 'NC-0001-00000045',
            nroRemito: 'R-0001-00000078',
            total: '$12,345.67',
            fecha: new Date().toLocaleDateString(),
            vencimiento: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toLocaleDateString(),
            items: 'Producto 1 - $1,234.56<br>Producto 2 - $2,345.67<br>Servicio 1 - $8,765.44',
            subtotal: '$10,203.84',
            impuestos: '$2,141.83',
            usuario: 'Admin',
            sucursal: 'Casa Central'
        };
        
        // Reemplazar variables
        let previewSubject = subject;
        let previewBody = body;
        
        for (const [key, value] of Object.entries(empresaInfo)) {
            const regex = new RegExp(`{${key}}`, 'g');
            previewSubject = previewSubject.replace(regex, value);
            previewBody = previewBody.replace(regex, value);
        }
        
        // Actualizar vista previa
        this.elements.templatePreview.innerHTML = `
            <div class="email-preview-header">
                <strong>Asunto:</strong> ${previewSubject}
            </div>
            <div class="email-preview-body">
                ${previewBody}
            </div>
        `;
    }
}

/**
 * Clase para gestionar el envío de correos electrónicos
 */
class EmailSender {
    constructor() {
        this.config = null;
        this.initialized = false;
    }

    /**
     * Inicializa el servicio de envío de correos
     * @param {Object} config - Configuración de correo (opcional)
     */
    async init(config = null) {
        try {
            if (config) {
                this.config = config;
            } else {
                // Cargar configuración desde la base de datos
                this.config = await database.getConfig('email');
                
                if (!this.config) {
                    // Si no hay configuración, usar valores por defecto
                    this.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
                }
            }
            
            this.initialized = true;
            logger.log('info', 'Servicio de envío de correos inicializado');
            
            return true;
        } catch (error) {
            logger.log('error', `Error al inicializar el servicio de envío de correos: ${error.message}`);
            return false;
        }
    }

    /**
     * Envía un correo electrónico
     * @param {Object} options - Opciones para el envío
     * @param {string} options.to - Destinatario
     * @param {string} options.subject - Asunto
     * @param {string} options.body - Cuerpo del mensaje (HTML)
     * @param {Array} options.attachments - Archivos adjuntos (opcional)
     * @param {string} options.templateKey - Clave de la plantilla a utilizar (opcional)
     * @param {Object} options.templateData - Datos para reemplazar en la plantilla (opcional)
     * @returns {Promise<Object>} Resultado del envío
     */
    async sendEmail(options) {
        try {
            if (!this.initialized) {
                await this.init();
            }
            
            if (!this.config) {
                throw new Error('El servicio de correo no está configurado correctamente');
            }
            
            // Validar opciones básicas
            if (!options.to) {
                throw new Error('El destinatario es requerido');
            }
            
            let emailSubject = options.subject || '';
            let emailBody = options.body || '';
            
            // Si se especifica una plantilla, utilizarla
            if (options.templateKey && this.config.templates[options.templateKey]) {
                const template = this.config.templates[options.templateKey];
                emailSubject = template.subject;
                emailBody = template.body;
                
                // Reemplazar variables en la plantilla si se proporcionan datos
                if (options.templateData) {
                    for (const [key, value] of Object.entries(options.templateData)) {
                        const regex = new RegExp(`{${key}}`, 'g');
                        emailSubject = emailSubject.replace(regex, value);
                        emailBody = emailBody.replace(regex, value);
                    }
                }
            }
            
            // Preparar datos para enviar al proceso principal
            const emailData = {
                config: {
                    smtp: this.config.smtp,
                    sender: this.config.sender
                },
                to: options.to,
                cc: options.cc || [],
                bcc: options.bcc || [],
                subject: emailSubject,
                body: emailBody,
                attachments: options.attachments || []
            };
            
            // Si está habilitado, enviar copia al remitente
            if (this.config.settings.sendCopyToSender && !emailData.bcc.includes(this.config.sender.email)) {
                emailData.bcc.push(this.config.sender.email);
            }
            
            // Registrar el intento en el log si está habilitado
            if (this.config.settings.logEmails) {
                logger.log('info', `Intentando enviar correo a: ${options.to}, Asunto: ${emailSubject}`);
            }
            
            // Enviar solicitud al proceso principal
            const result = await ipcRenderer.invoke('send-email', emailData);
            
            // Registrar el resultado en el log si está habilitado
            if (this.config.settings.logEmails) {
                if (result.success) {
                    logger.log('info', `Correo enviado exitosamente a: ${options.to}`);
                } else {
                    logger.log('error', `Error al enviar correo a: ${options.to}. Error: ${result.error}`);
                }
            }
            
            return result;
        } catch (error) {
            logger.log('error', `Error en el servicio de envío de correos: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * Envía un documento por correo electrónico
     * @param {Object} options - Opciones para el envío
     * @param {string} options.to - Destinatario
     * @param {string} options.documentType - Tipo de documento ('factura', 'presupuesto', 'notaCredito', 'notaDebito', 'remito')
     * @param {Object} options.documentData - Datos del documento
     * @param {string} options.pdfPath - Ruta al archivo PDF del documento
     * @returns {Promise<Object>} Resultado del envío
     */
    async sendDocument(options) {
        try {
            if (!options.to || !options.documentType || !options.documentData || !options.pdfPath) {
                throw new Error('Faltan datos requeridos para enviar el documento');
            }
            
            // Seleccionar la plantilla adecuada según el tipo de documento
            let templateKey = '';
            switch (options.documentType) {
                case 'factura':
                    templateKey = 'factura';
                    break;
                case 'presupuesto':
                    templateKey = 'presupuesto';
                    break;
                case 'notaCredito':
                    templateKey = 'notaCredito';
                    break;
                case 'notaDebito':
                    templateKey = 'notaDebito';
                    break;
                case 'remito':
                    templateKey = 'remito';
                    break;
                default:
                    templateKey = 'personalizado';
            }
            
            // Preparar datos para la plantilla
            const templateData = {
                empresa: options.documentData.empresa || '',
                cliente: options.documentData.cliente || '',
                nroFactura: options.documentData.numero || '',
                nroNota: options.documentData.numero || '',
                nroRemito: options.documentData.numero || '',
                total: options.documentData.total || '',
                fecha: options.documentData.fecha || new Date().toLocaleDateString(),
                vencimiento: options.documentData.vencimiento || '',
                items: options.documentData.items || '',
                subtotal: options.documentData.subtotal || '',
                impuestos: options.documentData.impuestos || '',
                usuario: options.documentData.usuario || '',
                sucursal: options.documentData.sucursal || ''
            };
            
            // Preparar archivo adjunto
            const attachments = [
                {
                    filename: `${options.documentType}-${options.documentData.numero}.pdf`,
                    path: options.pdfPath
                }
            ];
            
            // Enviar correo con la plantilla y adjunto
            return await this.sendEmail({
                to: options.to,
                templateKey: templateKey,
                templateData: templateData,
                attachments: attachments
            });
        } catch (error) {
            logger.log('error', `Error al enviar documento por correo: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * Agrega un correo a la cola para reintento en caso de fallo
     * @param {Object} emailData - Datos del correo
     */
    addToRetryQueue(emailData) {
        // Implementar lógica para cola de reintentos
        // Esta funcionalidad requiere una base de datos para almacenar los correos pendientes
        // y un servicio que intente enviarlos periódicamente
    }
}

// Instancia del gestor de configuración de email
const emailConfig = new EmailConfigManager();

// Instancia del servicio de envío de correos
const emailSender = new EmailSender();

// Inicializar el módulo cuando se cargue el DOM
document.addEventListener('DOMContentLoaded', () => {
    // Verificar si estamos en la página de configuración de email
    const emailConfigContainer = document.getElementById('email-config-container');
    if (emailConfigContainer) {
        // Inicializar el gestor de configuración
        emailConfig.init();
    }
});

// Exponer funcionalidades para uso externo
module.exports = {
    // Gestor de configuración
    configManager: emailConfig,
    
    // Servicio de envío
    sender: emailSender,
    
    // Métodos de acceso rápido
    init: emailSender.init.bind(emailSender),
    sendEmail: emailSender.sendEmail.bind(emailSender),
    sendDocument: emailSender.sendDocument.bind(emailSender),
    
    // Configuración por defecto
    defaultConfig: DEFAULT_CONFIG
};