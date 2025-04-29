/**
 * @file seguridad.js
 * @description Módulo de gestión de seguridad del sistema
 * @module configuraciones/seguridad
 */

// Importaciones de utilidades y servicios
const { database } = require('../../../utils/database.js');
const { logger } = require('../../../utils/logger.js');
const { auth } = require('../../../utils/auth.js');
const { ipcRenderer } = require ('../../../renderer.js');

// Importaciones de servicios específicos de autenticación
const { twoFactor } = require ('../../../../services/auth/twoFactor.js');
const { permissions } = require ('../../../../services/auth/permissions.js');

/**
 * Clase para gestionar la configuración de seguridad del sistema
 */
class SeguridadConfig {
    constructor() {
        this.currentUser = null;
        this.configData = null;
        this.twoFactorEnabled = false;
        this.passwordPolicyStrength = 'medium';
        this.sessionTimeout = 30; // minutos
        this.maxLoginAttempts = 5;
        this.lockoutDuration = 15; // minutos
        this.auditLevel = 'standard'; // basic, standard, detailed
        this.backupEncryption = true;
        
        // Referencias a elementos DOM
        this.elements = {
            formSeguridad: null,
            twoFactorToggle: null,
            passwordPolicySelect: null,
            sessionTimeoutInput: null,
            maxLoginAttemptsInput: null,
            lockoutDurationInput: null,
            auditLevelSelect: null,
            backupEncryptionToggle: null,
            saveButton: null,
            testTwoFactorButton: null,
            resetSecurityButton: null,
            passwordExpiryInput: null,
            securityQuestionToggle: null,
            ipRestrictionToggle: null,
            ipAllowList: null,
            sessionHistoryTable: null,
            securityLogsTable: null
        };
        
        // Permisos requeridos para esta sección
        this.requiredPermissions = ['seguridad.configurar', 'seguridad.ver'];
    }

    /**
     * Inicializa el módulo de seguridad
     */
    async init() {
        try {
            logger.info('Inicializando módulo de configuración de seguridad');
            
            // Verificar permisos de usuario
            if (!this.checkPermissions()) {
                logger.warn('Usuario sin permisos suficientes para configuración de seguridad');
                document.getElementById('securityConfigContainer').innerHTML = 
                    '<div class="alert alert-danger">No tiene permisos suficientes para acceder a esta sección</div>';
                return;
            }
            
            // Cargar usuario actual
            this.currentUser = await auth.getCurrentUser();
            
            // Cargar configuración de seguridad
            await this.loadSecurityConfig();
            
            // Inicializar referencias a elementos DOM
            this.initDOMReferences();
            
            // Configurar eventos
            this.setupEventListeners();
            
            // Renderizar configuración actual
            this.renderCurrentConfig();
            
            // Cargar historial de sesiones
            this.loadSessionHistory();
            
            // Cargar logs de seguridad
            this.loadSecurityLogs();
            
            logger.info('Módulo de configuración de seguridad inicializado correctamente');
        } catch (error) {
            logger.error('Error al inicializar módulo de seguridad', error);
            this.showErrorMessage('Error al cargar la configuración de seguridad');
        }
    }

    /**
     * Verifica si el usuario tiene los permisos necesarios
     * @returns {boolean} True si tiene permisos, false en caso contrario
     */
    checkPermissions() {
        return this.requiredPermissions.every(permission => 
            permissions.userHasPermission(this.currentUser?.id, permission));
    }

    /**
     * Carga la configuración de seguridad desde la base de datos
     */
    async loadSecurityConfig() {
        try {
            this.configData = await database.get('configuraciones', 'seguridad');
            
            if (this.configData) {
                this.twoFactorEnabled = this.configData.twoFactorEnabled || false;
                this.passwordPolicyStrength = this.configData.passwordPolicyStrength || 'medium';
                this.sessionTimeout = this.configData.sessionTimeout || 30;
                this.maxLoginAttempts = this.configData.maxLoginAttempts || 5;
                this.lockoutDuration = this.configData.lockoutDuration || 15;
                this.auditLevel = this.configData.auditLevel || 'standard';
                this.backupEncryption = this.configData.backupEncryption !== false;
                this.passwordExpiry = this.configData.passwordExpiry || 90; // días
                this.securityQuestionEnabled = this.configData.securityQuestionEnabled || false;
                this.ipRestrictionEnabled = this.configData.ipRestrictionEnabled || false;
                this.ipAllowList = this.configData.ipAllowList || [];
            } else {
                // Configuración por defecto si no existe en la base de datos
                await this.saveSecurityConfig();
            }
        } catch (error) {
            logger.error('Error al cargar configuración de seguridad', error);
            throw error;
        }
    }

    /**
     * Inicializa referencias a elementos DOM
     */
    initDOMReferences() {
        this.elements.formSeguridad = document.getElementById('formConfigSeguridad');
        this.elements.twoFactorToggle = document.getElementById('twoFactorToggle');
        this.elements.passwordPolicySelect = document.getElementById('passwordPolicySelect');
        this.elements.sessionTimeoutInput = document.getElementById('sessionTimeoutInput');
        this.elements.maxLoginAttemptsInput = document.getElementById('maxLoginAttemptsInput');
        this.elements.lockoutDurationInput = document.getElementById('lockoutDurationInput');
        this.elements.auditLevelSelect = document.getElementById('auditLevelSelect');
        this.elements.backupEncryptionToggle = document.getElementById('backupEncryptionToggle');
        this.elements.saveButton = document.getElementById('saveSecurityButton');
        this.elements.testTwoFactorButton = document.getElementById('testTwoFactorButton');
        this.elements.resetSecurityButton = document.getElementById('resetSecurityButton');
        this.elements.passwordExpiryInput = document.getElementById('passwordExpiryInput');
        this.elements.securityQuestionToggle = document.getElementById('securityQuestionToggle');
        this.elements.ipRestrictionToggle = document.getElementById('ipRestrictionToggle');
        this.elements.ipAllowList = document.getElementById('ipAllowList');
        this.elements.sessionHistoryTable = document.getElementById('sessionHistoryTable');
        this.elements.securityLogsTable = document.getElementById('securityLogsTable');
    }

    /**
     * Configura los event listeners para los elementos de la interfaz
     */
    setupEventListeners() {
        // Guardar configuración
        this.elements.saveButton.addEventListener('click', this.handleSaveConfig.bind(this));
        
        // Probar autenticación de dos factores
        this.elements.testTwoFactorButton.addEventListener('click', this.handleTestTwoFactor.bind(this));
        
        // Restablecer configuración de seguridad
        this.elements.resetSecurityButton.addEventListener('click', this.handleResetSecurity.bind(this));
        
        // Mostrar/ocultar lista de IPs permitidas basado en el toggle
        this.elements.ipRestrictionToggle.addEventListener('change', (e) => {
            const ipListContainer = document.getElementById('ipAllowListContainer');
            ipListContainer.style.display = e.target.checked ? 'block' : 'none';
        });
        
        // Toggle para habilitar/deshabilitar 2FA
        this.elements.twoFactorToggle.addEventListener('change', (e) => {
            this.elements.testTwoFactorButton.disabled = !e.target.checked;
        });
    }

    /**
     * Renderiza la configuración actual en la interfaz
     */
    renderCurrentConfig() {
        this.elements.twoFactorToggle.checked = this.twoFactorEnabled;
        this.elements.passwordPolicySelect.value = this.passwordPolicyStrength;
        this.elements.sessionTimeoutInput.value = this.sessionTimeout;
        this.elements.maxLoginAttemptsInput.value = this.maxLoginAttempts;
        this.elements.lockoutDurationInput.value = this.lockoutDuration;
        this.elements.auditLevelSelect.value = this.auditLevel;
        this.elements.backupEncryptionToggle.checked = this.backupEncryption;
        this.elements.passwordExpiryInput.value = this.passwordExpiry;
        this.elements.securityQuestionToggle.checked = this.securityQuestionEnabled;
        this.elements.ipRestrictionToggle.checked = this.ipRestrictionEnabled;
        
        // Actualizar estado del botón de prueba 2FA
        this.elements.testTwoFactorButton.disabled = !this.twoFactorEnabled;
        
        // Mostrar/ocultar lista de IPs basado en el estado del toggle
        const ipListContainer = document.getElementById('ipAllowListContainer');
        ipListContainer.style.display = this.ipRestrictionEnabled ? 'block' : 'none';
        
        // Renderizar lista de IPs permitidas
        this.renderIPAllowList();
        
        // Mostrar política de contraseñas actual
        this.showPasswordPolicyInfo(this.passwordPolicyStrength);
    }

    /**
     * Muestra la información de la política de contraseñas seleccionada
     * @param {string} policyLevel - Nivel de política seleccionado
     */
    showPasswordPolicyInfo(policyLevel) {
        const policyInfoElement = document.getElementById('passwordPolicyInfo');
        let policyText = '';
        
        switch(policyLevel) {
            case 'low':
                policyText = 'Mínimo 6 caracteres sin requisitos adicionales';
                break;
            case 'medium':
                policyText = 'Mínimo 8 caracteres, al menos 1 número y 1 letra mayúscula';
                break;
            case 'high':
                policyText = 'Mínimo 10 caracteres, al menos 1 número, 1 letra mayúscula, 1 letra minúscula y 1 caracter especial';
                break;
            case 'custom':
                policyText = 'Política personalizada configurada por el administrador';
                // Mostrar configuración personalizada si está disponible
                if (this.configData && this.configData.customPasswordPolicy) {
                    policyText += '<br>' + this.configData.customPasswordPolicy.description;
                }
                break;
        }
        
        policyInfoElement.innerHTML = policyText;
    }

    /**
     * Renderiza la lista de IPs permitidas
     */
    renderIPAllowList() {
        if (!this.elements.ipAllowList) return;
        
        this.elements.ipAllowList.innerHTML = '';
        
        if (this.ipAllowList && this.ipAllowList.length > 0) {
            this.ipAllowList.forEach((ip, index) => {
                const ipItem = document.createElement('div');
                ipItem.className = 'ip-item';
                ipItem.innerHTML = `
                    <input type="text" class="form-control ip-input" value="${ip}" data-index="${index}">
                    <button type="button" class="btn btn-danger btn-sm remove-ip" data-index="${index}">
                        <i class="fas fa-trash"></i>
                    </button>
                `;
                this.elements.ipAllowList.appendChild(ipItem);
            });
            
            // Agregar event listeners para eliminar IPs
            document.querySelectorAll('.remove-ip').forEach(button => {
                button.addEventListener('click', (e) => {
                    const index = parseInt(e.target.dataset.index);
                    this.ipAllowList.splice(index, 1);
                    this.renderIPAllowList();
                });
            });
        }
        
        // Agregar botón para añadir nueva IP
        const addButton = document.createElement('button');
        addButton.type = 'button';
        addButton.className = 'btn btn-primary btn-sm mt-2';
        addButton.textContent = 'Agregar IP';
        addButton.addEventListener('click', () => {
            this.ipAllowList.push('');
            this.renderIPAllowList();
        });
        
        this.elements.ipAllowList.appendChild(addButton);
    }

    /**
     * Maneja el evento de guardar configuración
     * @param {Event} e - Evento del click
     */
    async handleSaveConfig(e) {
        e.preventDefault();
        
        try {
            // Recoger valores de la interfaz
            this.twoFactorEnabled = this.elements.twoFactorToggle.checked;
            this.passwordPolicyStrength = this.elements.passwordPolicySelect.value;
            this.sessionTimeout = parseInt(this.elements.sessionTimeoutInput.value);
            this.maxLoginAttempts = parseInt(this.elements.maxLoginAttemptsInput.value);
            this.lockoutDuration = parseInt(this.elements.lockoutDurationInput.value);
            this.auditLevel = this.elements.auditLevelSelect.value;
            this.backupEncryption = this.elements.backupEncryptionToggle.checked;
            this.passwordExpiry = parseInt(this.elements.passwordExpiryInput.value);
            this.securityQuestionEnabled = this.elements.securityQuestionToggle.checked;
            this.ipRestrictionEnabled = this.elements.ipRestrictionToggle.checked;
            
            // Actualizar lista de IPs permitidas
            if (this.ipRestrictionEnabled) {
                this.ipAllowList = Array.from(document.querySelectorAll('.ip-input'))
                    .map(input => input.value.trim())
                    .filter(ip => ip !== '');
            }
            
            // Validar datos básicos
            if (this.sessionTimeout < 1 || this.maxLoginAttempts < 1 || this.lockoutDuration < 1) {
                throw new Error('Los valores numéricos deben ser mayores a 0');
            }
            
            // Guardar en la base de datos
            await this.saveSecurityConfig();
            
            // Actualizar configuración en el sistema
            await this.applySecurityConfig();
            
            this.showSuccessMessage('Configuración de seguridad guardada correctamente');
            
            // Registrar acción en logs
            logger.audit({
                action: 'security.config.update',
                user: this.currentUser.username,
                details: `Configuración de seguridad actualizada por ${this.currentUser.username}`
            });
        } catch (error) {
            logger.error('Error al guardar configuración de seguridad', error);
            this.showErrorMessage('Error al guardar: ' + error.message);
        }
    }

    /**
     * Guarda la configuración de seguridad en la base de datos
     */
    async saveSecurityConfig() {
        const configToSave = {
            twoFactorEnabled: this.twoFactorEnabled,
            passwordPolicyStrength: this.passwordPolicyStrength,
            sessionTimeout: this.sessionTimeout,
            maxLoginAttempts: this.maxLoginAttempts,
            lockoutDuration: this.lockoutDuration,
            auditLevel: this.auditLevel,
            backupEncryption: this.backupEncryption,
            passwordExpiry: this.passwordExpiry,
            securityQuestionEnabled: this.securityQuestionEnabled,
            ipRestrictionEnabled: this.ipRestrictionEnabled,
            ipAllowList: this.ipAllowList,
            updatedAt: new Date().toISOString(),
            updatedBy: this.currentUser.id
        };
        
        await database.save('configuraciones', 'seguridad', configToSave);
        this.configData = configToSave;
    }

    /**
     * Aplica la configuración de seguridad al sistema
     */
    async applySecurityConfig() {
        // Actualizar configuración de autenticación de dos factores
        await twoFactor.updateConfig({
            enabled: this.twoFactorEnabled
        });
        
        // Actualizar política de contraseñas
        await auth.updatePasswordPolicy(this.passwordPolicyStrength);
        
        // Configurar timeout de sesión
        ipcRenderer.send('update-session-timeout', this.sessionTimeout);
        
        // Actualizar configuración de intentos de login
        auth.updateLoginAttemptsConfig(this.maxLoginAttempts, this.lockoutDuration);
        
        // Actualizar nivel de auditoría
        logger.setAuditLevel(this.auditLevel);
        
        // Actualizar configuración de cifrado de respaldos
        ipcRenderer.send('update-backup-encryption', this.backupEncryption);
        
        // Aplicar configuración de restricción de IPs
        if (this.ipRestrictionEnabled) {
            await auth.setIPRestrictions(this.ipAllowList);
        } else {
            await auth.disableIPRestrictions();
        }
    }

    /**
     * Maneja el evento de probar la autenticación de dos factores
     */
    async handleTestTwoFactor() {
        try {
            // Generar un código QR de prueba para configurar 2FA
            const qrCode = await twoFactor.generateTestQR(this.currentUser.username);
            
            // Mostrar modal con código QR y verificación
            this.showTwoFactorTestModal(qrCode);
        } catch (error) {
            logger.error('Error al probar autenticación de dos factores', error);
            this.showErrorMessage('Error al probar 2FA: ' + error.message);
        }
    }

    /**
     * Muestra un modal para probar la configuración de 2FA
     * @param {string} qrCodeData - Datos del código QR para la app de autenticación
     */
    showTwoFactorTestModal(qrCodeData) {
        // Crear un modal con el contenido necesario
        const modalHTML = `
            <div class="modal fade" id="twoFactorTestModal" tabindex="-1" role="dialog" aria-labelledby="twoFactorTestModalLabel" aria-hidden="true">
                <div class="modal-dialog" role="document">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title" id="twoFactorTestModalLabel">Probar Autenticación de Dos Factores</h5>
                            <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                                <span aria-hidden="true">&times;</span>
                            </button>
                        </div>
                        <div class="modal-body">
                            <p>Escanee este código QR con su aplicación de autenticación (Google Authenticator, Microsoft Authenticator, etc.):</p>
                            <div class="text-center">
                                <img src="${qrCodeData}" alt="Código QR 2FA" class="img-fluid">
                            </div>
                            <p class="mt-3">Ingrese el código generado por la aplicación:</p>
                            <input type="text" id="twoFactorTestCode" class="form-control" placeholder="Código de 6 dígitos">
                            <div id="twoFactorTestResult" class="mt-2"></div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-dismiss="modal">Cerrar</button>
                            <button type="button" class="btn btn-primary" id="verifyTwoFactorTestCode">Verificar</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // Agregar el modal al DOM
        const modalElement = document.createElement('div');
        modalElement.innerHTML = modalHTML;
        document.body.appendChild(modalElement.firstElementChild);
        
        // Mostrar el modal
        $('#twoFactorTestModal').modal('show');
        
        // Agregar event listener para verificar el código
        document.getElementById('verifyTwoFactorTestCode').addEventListener('click', async () => {
            const code = document.getElementById('twoFactorTestCode').value;
            const resultElement = document.getElementById('twoFactorTestResult');
            
            try {
                const isValid = await twoFactor.verifyCode(this.currentUser.username, code);
                
                if (isValid) {
                    resultElement.innerHTML = '<div class="alert alert-success">Código válido. ¡La autenticación de dos factores funciona correctamente!</div>';
                } else {
                    resultElement.innerHTML = '<div class="alert alert-danger">Código inválido. Por favor, verifique e intente nuevamente.</div>';
                }
            } catch (error) {
                resultElement.innerHTML = `<div class="alert alert-danger">Error al verificar: ${error.message}</div>`;
            }
        });
        
        // Eliminar el modal del DOM cuando se cierre
        $('#twoFactorTestModal').on('hidden.bs.modal', function () {
            $(this).remove();
        });
    }

    /**
     * Maneja el evento de restablecer la configuración de seguridad
     */
    async handleResetSecurity() {
        // Mostrar diálogo de confirmación
        if (!confirm('¿Está seguro de que desea restablecer la configuración de seguridad a los valores predeterminados? Esta acción no puede deshacerse.')) {
            return;
        }
        
        try {
            // Restablecer valores a los predeterminados
            this.twoFactorEnabled = false;
            this.passwordPolicyStrength = 'medium';
            this.sessionTimeout = 30;
            this.maxLoginAttempts = 5;
            this.lockoutDuration = 15;
            this.auditLevel = 'standard';
            this.backupEncryption = true;
            this.passwordExpiry = 90;
            this.securityQuestionEnabled = false;
            this.ipRestrictionEnabled = false;
            this.ipAllowList = [];
            
            // Guardar y aplicar configuración
            await this.saveSecurityConfig();
            await this.applySecurityConfig();
            
            // Actualizar interfaz
            this.renderCurrentConfig();
            
            this.showSuccessMessage('Configuración de seguridad restablecida correctamente');
            
            // Registrar en logs
            logger.audit({
                action: 'security.config.reset',
                user: this.currentUser.username,
                details: `Configuración de seguridad restablecida por ${this.currentUser.username}`
            });
        } catch (error) {
            logger.error('Error al restablecer configuración de seguridad', error);
            this.showErrorMessage('Error al restablecer: ' + error.message);
        }
    }

    /**
     * Carga el historial de sesiones de usuarios
     */
    async loadSessionHistory() {
        try {
            if (!this.elements.sessionHistoryTable) return;
            
            // Obtener últimas 50 sesiones
            const sessionHistory = await database.query('audit_log', {
                type: 'auth.session',
                limit: 50,
                orderBy: 'timestamp',
                orderDirection: 'desc'
            });
            
            // Limpiar tabla
            this.elements.sessionHistoryTable.querySelector('tbody').innerHTML = '';
            
            // Agregar filas a la tabla
            sessionHistory.forEach(session => {
                const row = document.createElement('tr');
                
                // Estado de la sesión (activa/finalizada)
                const statusClass = session.action === 'login' ? 'text-success' : 'text-danger';
                const statusIcon = session.action === 'login' ? 'fa-check-circle' : 'fa-times-circle';
                const statusText = session.action === 'login' ? 'Inicio' : 'Cierre';
                
                row.innerHTML = `
                    <td>${session.username}</td>
                    <td>${new Date(session.timestamp).toLocaleString()}</td>
                    <td>${session.ip || 'N/A'}</td>
                    <td>${session.device || 'Desconocido'}</td>
                    <td class="${statusClass}">
                        <i class="fas ${statusIcon}"></i> ${statusText}
                    </td>
                `;
                
                this.elements.sessionHistoryTable.querySelector('tbody').appendChild(row);
            });
        } catch (error) {
            logger.error('Error al cargar historial de sesiones', error);
        }
    }

    /**
     * Carga los logs de eventos de seguridad
     */
    async loadSecurityLogs() {
        try {
            if (!this.elements.securityLogsTable) return;
            
            // Obtener últimos 50 eventos de seguridad
            const securityLogs = await database.query('audit_log', {
                category: 'security',
                limit: 50,
                orderBy: 'timestamp',
                orderDirection: 'desc'
            });
            
            // Limpiar tabla
            this.elements.securityLogsTable.querySelector('tbody').innerHTML = '';
            
            // Agregar filas a la tabla
            securityLogs.forEach(log => {
                const row = document.createElement('tr');
                
                // Definir clase según criticidad del evento
                let severityClass = '';
                switch(log.severity) {
                    case 'critical':
                        severityClass = 'table-danger';
                        break;
                    case 'warning':
                        severityClass = 'table-warning';
                        break;
                    case 'info':
                        severityClass = 'table-info';
                        break;
                }
                
                row.className = severityClass;
                row.innerHTML = `
                    <td>${new Date(log.timestamp).toLocaleString()}</td>
                    <td>${log.action}</td>
                    <td>${log.username || 'Sistema'}</td>
                    <td>${log.ip || 'N/A'}</td>
                    <td>${log.details || ''}</td>
                `;
                
                this.elements.securityLogsTable.querySelector('tbody').appendChild(row);
            });
        } catch (error) {
            logger.error('Error al cargar logs de seguridad', error);
        }
    }

    /**
     * Muestra un mensaje de éxito
     * @param {string} message - Mensaje a mostrar
     */
    showSuccessMessage(message) {
        const alertElement = document.createElement('div');
        alertElement.className = 'alert alert-success alert-dismissible fade show';
        alertElement.innerHTML = `
            ${message}
            <button type="button" class="close" data-dismiss="alert" aria-label="Cerrar">
                <span aria-hidden="true">&times;</span>
            </button>
        `;
        
        const alertContainer = document.getElementById('alertsContainer') || document.getElementById('securityConfigContainer');
        alertContainer.prepend(alertElement);
        
        // Auto-eliminar después de 5 segundos
        setTimeout(() => {
            alertElement.classList.remove('show');
            setTimeout(() => alertElement.remove(), 150);
        }, 5000);
    }

    /**
     * Muestra un mensaje de error
     * @param {string} message - Mensaje a mostrar
     */
    showErrorMessage(message) {
        const alertElement = document.createElement('div');
        alertElement.className = 'alert alert-danger alert-dismissible fade show';
        alertElement.innerHTML = `
            ${message}
            <button type="button" class="close" data-dismiss="alert" aria-label="Cerrar">
                <span aria-hidden="true">&times;</span>
            </button>
        `;
        
        const alertContainer = document.getElementById('alertsContainer') || document.getElementById('securityConfigContainer');
        alertContainer.prepend(alertElement);
        
        // Auto-eliminar después de 8 segundos
        setTimeout(() => {
            alertElement.classList.remove('show');
            setTimeout(() => alertElement.remove(), 150);
        }, 8000);
    }
    
    /**
     * Exporta los registros de seguridad a PDF
     */
    async exportSecurityLogsAsPDF() {
        try {
            const pdfService = await import('../../../../services/print/pdf.js');
            
            // Obtener datos de logs para el reporte
            const securityLogs = await database.query('audit_log', {
                category: 'security',
                limit: 1000, // Límite para el informe
                orderBy: 'timestamp',
                orderDirection: 'desc'
            });
            
            // Configurar el reporte
            const reportConfig = {
                title: 'Informe de Eventos de Seguridad',
                date: new Date().toLocaleDateString(),
                company: this.configData.companyName || 'FactuSystem',
                data: securityLogs,
                columns: [
                    { header: 'Fecha', key: 'timestamp', formatter: (d) => new Date(d).toLocaleString() },
                    { header: 'Acción', key: 'action' },
                    { header: 'Usuario', key: 'username', formatter: (d) => d || 'Sistema' },
                    { header: 'IP', key: 'ip', formatter: (d) => d || 'N/A' },
                    { header: 'Detalles', key: 'details', formatter: (d) => d || '' }
                ]
            };
            
            // Generar PDF
            const pdfPath = await pdfService.generateTableReport(reportConfig, 'seguridad');
            
            // Abrir el PDF
            ipcRenderer.send('open-pdf', pdfPath);
            
            this.showSuccessMessage('Informe de seguridad exportado correctamente');
        } catch (error) {
            logger.error('Error al exportar logs de seguridad a PDF', error);
            this.showErrorMessage('Error al exportar informe: ' + error.message);
        }
    }
}

// Exportar instancia
const seguridadConfig = new SeguridadConfig();
module.exports = seguridadConfig;