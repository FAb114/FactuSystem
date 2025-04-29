/**
 * FactuSystem - Módulo de Configuración de Backups
 * 
 * Este módulo gestiona la configuración de copias de seguridad del sistema,
 * permitiendo programar respaldos automáticos, configurar ubicaciones de 
 * almacenamiento y restaurar datos desde copias previas.
 */

const { ipcRenderer } = require('electron');
const { showNotification } = require('../../components/notifications.js');
const { getCurrentUser } = require('../../utils/auth.js');
const { getDbConnection } = require('../../utils/database.js');
const { logger } = require('../../utils/logger.js');

// Servicios de backup
const backupService = {
    /**
     * Realiza una copia de seguridad manual
     * @param {Object} config - Configuración del backup
     * @returns {Promise<Object>} - Resultado de la operación
     */
    createManualBackup: async (config) => {
        try {
            logger.info('Iniciando backup manual', { user: getCurrentUser().username });
            return await ipcRenderer.invoke('backup:create-manual', config);
        } catch (error) {
            logger.error('Error al crear backup manual', { error: error.message });
            throw error;
        }
    },

    /**
     * Configura el programa de backups automáticos
     * @param {Object} schedule - Configuración del programa
     * @returns {Promise<boolean>} - Resultado de la operación
     */
    configureAutoBackup: async (schedule) => {
        try {
            return await ipcRenderer.invoke('backup:configure-auto', schedule);
        } catch (error) {
            logger.error('Error al configurar backups automáticos', { error: error.message });
            throw error;
        }
    },

    /**
     * Restaura datos desde una copia de seguridad
     * @param {string} backupPath - Ruta al archivo de backup
     * @returns {Promise<Object>} - Resultado de la operación
     */
    restoreFromBackup: async (backupPath) => {
        try {
            logger.warn('Iniciando restauración desde backup', { 
                user: getCurrentUser().username,
                backupPath 
            });
            return await ipcRenderer.invoke('backup:restore', backupPath);
        } catch (error) {
            logger.error('Error al restaurar desde backup', { error: error.message });
            throw error;
        }
    },

    /**
     * Obtiene la lista de backups disponibles
     * @returns {Promise<Array>} - Lista de backups
     */
    getBackupsList: async () => {
        try {
            return await ipcRenderer.invoke('backup:list');
        } catch (error) {
            logger.error('Error al obtener lista de backups', { error: error.message });
            throw error;
        }
    },

    /**
     * Configura la integración con almacenamiento en la nube
     * @param {Object} cloudConfig - Configuración de la nube
     * @returns {Promise<boolean>} - Resultado de la operación
     */
    configureCloudStorage: async (cloudConfig) => {
        try {
            return await ipcRenderer.invoke('backup:configure-cloud', cloudConfig);
        } catch (error) {
            logger.error('Error al configurar almacenamiento en la nube', { error: error.message });
            throw error;
        }
    },

    /**
     * Verifica el estado de la sincronización con la nube
     * @returns {Promise<Object>} - Estado de la sincronización
     */
    checkCloudSyncStatus: async () => {
        try {
            return await ipcRenderer.invoke('backup:cloud-status');
        } catch (error) {
            logger.error('Error al verificar estado de sincronización', { error: error.message });
            throw error;
        }
    }
};

// Configuración de almacenamiento
const storageConfig = {
    // Opciones de almacenamiento disponibles
    storageOptions: [
        { id: 'local', name: 'Almacenamiento Local' },
        { id: 'google_drive', name: 'Google Drive' },
        { id: 'dropbox', name: 'Dropbox' },
        { id: 'onedrive', name: 'Microsoft OneDrive' },
        { id: 'custom_ftp', name: 'Servidor FTP Personalizado' }
    ],

    /**
     * Obtiene la configuración actual de almacenamiento
     * @returns {Promise<Object>} - Configuración actual
     */
    getCurrentStorageConfig: async () => {
        const db = await getDbConnection();
        try {
            const config = await db.get('SELECT value FROM system_config WHERE key = "backup_storage_config"');
            return config ? JSON.parse(config.value) : null;
        } catch (error) {
            logger.error('Error al obtener configuración de almacenamiento', { error: error.message });
            return null;
        }
    },

    /**
     * Guarda la configuración de almacenamiento
     * @param {Object} config - Nueva configuración
     * @returns {Promise<boolean>} - Resultado de la operación
     */
    saveStorageConfig: async (config) => {
        const db = await getDbConnection();
        try {
            const configStr = JSON.stringify(config);
            await db.run(
                'INSERT OR REPLACE INTO system_config (key, value) VALUES (?, ?)',
                ['backup_storage_config', configStr]
            );
            logger.info('Configuración de almacenamiento actualizada', { 
                user: getCurrentUser().username,
                storageType: config.type 
            });
            return true;
        } catch (error) {
            logger.error('Error al guardar configuración de almacenamiento', { error: error.message });
            return false;
        }
    },

    /**
     * Prueba la conexión con el almacenamiento configurado
     * @param {Object} config - Configuración a probar
     * @returns {Promise<Object>} - Resultado de la prueba
     */
    testStorageConnection: async (config) => {
        try {
            return await ipcRenderer.invoke('backup:test-storage', config);
        } catch (error) {
            logger.error('Error al probar conexión de almacenamiento', { error: error.message });
            throw error;
        }
    }
};

// Configuración de programación
const scheduleConfig = {
    // Frecuencias disponibles para backups automáticos
    frequencyOptions: [
        { id: 'daily', name: 'Diario', description: 'Una vez al día' },
        { id: 'weekly', name: 'Semanal', description: 'Una vez por semana' },
        { id: 'biweekly', name: 'Quincenal', description: 'Cada 15 días' },
        { id: 'monthly', name: 'Mensual', description: 'Una vez al mes' }
    ],

    // Horas disponibles para programación
    hourOptions: Array.from({ length: 24 }, (_, i) => {
        const hour = i < 10 ? `0${i}` : `${i}`;
        return { id: hour, name: `${hour}:00 hs` };
    }),

    // Días de la semana para backups semanales
    weekdayOptions: [
        { id: '1', name: 'Lunes' },
        { id: '2', name: 'Martes' },
        { id: '3', name: 'Miércoles' },
        { id: '4', name: 'Jueves' },
        { id: '5', name: 'Viernes' },
        { id: '6', name: 'Sábado' },
        { id: '0', name: 'Domingo' }
    ],

    /**
     * Obtiene la configuración actual de programación
     * @returns {Promise<Object>} - Configuración actual
     */
    getCurrentSchedule: async () => {
        const db = await getDbConnection();
        try {
            const config = await db.get('SELECT value FROM system_config WHERE key = "backup_schedule_config"');
            return config ? JSON.parse(config.value) : null;
        } catch (error) {
            logger.error('Error al obtener configuración de programación', { error: error.message });
            return null;
        }
    },

    /**
     * Guarda la configuración de programación
     * @param {Object} schedule - Nueva configuración
     * @returns {Promise<boolean>} - Resultado de la operación
     */
    saveSchedule: async (schedule) => {
        const db = await getDbConnection();
        try {
            const scheduleStr = JSON.stringify(schedule);
            await db.run(
                'INSERT OR REPLACE INTO system_config (key, value) VALUES (?, ?)',
                ['backup_schedule_config', scheduleStr]
            );
            
            // Actualizar el programador de tareas
            await backupService.configureAutoBackup(schedule);
            
            logger.info('Programación de backups actualizada', { 
                user: getCurrentUser().username,
                frequency: schedule.frequency
            });
            return true;
        } catch (error) {
            logger.error('Error al guardar programación de backups', { error: error.message });
            return false;
        }
    }
};

// Gestión de retención
const retentionConfig = {
    // Políticas de retención disponibles
    retentionOptions: [
        { id: 'all', name: 'Conservar todos los backups', description: 'No eliminar ningún backup automáticamente' },
        { id: 'count', name: 'Conservar por cantidad', description: 'Mantener un número específico de backups más recientes' },
        { id: 'days', name: 'Conservar por días', description: 'Mantener backups de los últimos N días' }
    ],

    /**
     * Obtiene la configuración actual de retención
     * @returns {Promise<Object>} - Configuración actual
     */
    getCurrentRetention: async () => {
        const db = await getDbConnection();
        try {
            const config = await db.get('SELECT value FROM system_config WHERE key = "backup_retention_config"');
            return config ? JSON.parse(config.value) : null;
        } catch (error) {
            logger.error('Error al obtener configuración de retención', { error: error.message });
            return null;
        }
    },

    /**
     * Guarda la configuración de retención
     * @param {Object} retention - Nueva configuración
     * @returns {Promise<boolean>} - Resultado de la operación
     */
    saveRetention: async (retention) => {
        const db = await getDbConnection();
        try {
            const retentionStr = JSON.stringify(retention);
            await db.run(
                'INSERT OR REPLACE INTO system_config (key, value) VALUES (?, ?)',
                ['backup_retention_config', retentionStr]
            );
            logger.info('Política de retención actualizada', { 
                user: getCurrentUser().username,
                policy: retention.policy
            });
            return true;
        } catch (error) {
            logger.error('Error al guardar política de retención', { error: error.message });
            return false;
        }
    }
};

// Seguridad y encriptación
const securityConfig = {
    // Opciones de encriptación
    encryptionOptions: [
        { id: 'none', name: 'Sin encriptación' },
        { id: 'aes256', name: 'AES-256 (Recomendado)' },
        { id: 'custom', name: 'Personalizada' }
    ],

    /**
     * Obtiene la configuración actual de seguridad
     * @returns {Promise<Object>} - Configuración actual
     */
    getCurrentSecurity: async () => {
        const db = await getDbConnection();
        try {
            const config = await db.get('SELECT value FROM system_config WHERE key = "backup_security_config"');
            return config ? JSON.parse(config.value) : null;
        } catch (error) {
            logger.error('Error al obtener configuración de seguridad', { error: error.message });
            return null;
        }
    },

    /**
     * Guarda la configuración de seguridad
     * @param {Object} security - Nueva configuración
     * @returns {Promise<boolean>} - Resultado de la operación
     */
    saveSecurity: async (security) => {
        const db = await getDbConnection();
        try {
            const securityStr = JSON.stringify(security);
            await db.run(
                'INSERT OR REPLACE INTO system_config (key, value) VALUES (?, ?)',
                ['backup_security_config', securityStr]
            );
            logger.info('Configuración de seguridad actualizada', { 
                user: getCurrentUser().username,
                encryption: security.encryption
            });
            return true;
        } catch (error) {
            logger.error('Error al guardar configuración de seguridad', { error: error.message });
            return false;
        }
    }
};

// Historial y registro de backups
const backupHistory = {
    /**
     * Obtiene el historial de backups realizados
     * @param {Object} filters - Filtros para la búsqueda
     * @returns {Promise<Array>} - Historial de backups
     */
    getBackupHistory: async (filters = {}) => {
        const db = await getDbConnection();
        try {
            let query = 'SELECT * FROM backup_history';
            const params = [];
            
            // Aplicar filtros si existen
            if (Object.keys(filters).length > 0) {
                query += ' WHERE ';
                const conditions = [];
                
                if (filters.startDate) {
                    conditions.push('date >= ?');
                    params.push(filters.startDate);
                }
                
                if (filters.endDate) {
                    conditions.push('date <= ?');
                    params.push(filters.endDate);
                }
                
                if (filters.type) {
                    conditions.push('type = ?');
                    params.push(filters.type);
                }
                
                if (filters.status) {
                    conditions.push('status = ?');
                    params.push(filters.status);
                }
                
                query += conditions.join(' AND ');
            }
            
            query += ' ORDER BY date DESC';
            
            return await db.all(query, params);
        } catch (error) {
            logger.error('Error al obtener historial de backups', { error: error.message });
            return [];
        }
    },

    /**
     * Registra un nuevo evento de backup en el historial
     * @param {Object} backupEvent - Datos del evento
     * @returns {Promise<boolean>} - Resultado de la operación
     */
    logBackupEvent: async (backupEvent) => {
        const db = await getDbConnection();
        try {
            await db.run(
                `INSERT INTO backup_history (
                    date, type, file_path, size, duration_seconds, 
                    status, user_id, notes, cloud_synced
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    backupEvent.date || new Date().toISOString(),
                    backupEvent.type,
                    backupEvent.filePath,
                    backupEvent.size,
                    backupEvent.durationSeconds,
                    backupEvent.status,
                    backupEvent.userId || getCurrentUser().id,
                    backupEvent.notes,
                    backupEvent.cloudSynced ? 1 : 0
                ]
            );
            return true;
        } catch (error) {
            logger.error('Error al registrar evento de backup', { error: error.message });
            return false;
        }
    }
};

// Integración con múltiples sucursales
const branchBackup = {
    /**
     * Obtiene configuración de backups para sucursales
     * @returns {Promise<Object>} - Configuración actual
     */
    getBranchBackupConfig: async () => {
        const db = await getDbConnection();
        try {
            const config = await db.get('SELECT value FROM system_config WHERE key = "branch_backup_config"');
            return config ? JSON.parse(config.value) : null;
        } catch (error) {
            logger.error('Error al obtener configuración de backup para sucursales', { error: error.message });
            return null;
        }
    },

    /**
     * Guarda configuración de backups para sucursales
     * @param {Object} config - Nueva configuración
     * @returns {Promise<boolean>} - Resultado de la operación
     */
    saveBranchBackupConfig: async (config) => {
        const db = await getDbConnection();
        try {
            const configStr = JSON.stringify(config);
            await db.run(
                'INSERT OR REPLACE INTO system_config (key, value) VALUES (?, ?)',
                ['branch_backup_config', configStr]
            );
            logger.info('Configuración de backup para sucursales actualizada', { 
                user: getCurrentUser().username
            });
            return true;
        } catch (error) {
            logger.error('Error al guardar configuración de backup para sucursales', { error: error.message });
            return false;
        }
    },

    /**
     * Sincroniza backups entre sucursales
     * @returns {Promise<Object>} - Resultado de la sincronización
     */
    syncBranchBackups: async () => {
        try {
            return await ipcRenderer.invoke('backup:sync-branches');
        } catch (error) {
            logger.error('Error al sincronizar backups entre sucursales', { error: error.message });
            throw error;
        }
    }
};

// UI Controller - Maneja la interacción con la interfaz de usuario
class BackupsUIController {
    constructor() {
        this.initialized = false;
    }

    /**
     * Inicializa el controlador y los eventos de la UI
     */
    async initialize() {
        if (this.initialized) return;
        
        try {
            // Cargar configuraciones actuales
            this.loadCurrentConfigurations();
            
            // Configurar selectores y opciones
            this.setupSelectors();
            
            // Configurar listeners de eventos
            this.setupEventListeners();
            
            this.initialized = true;
            
            logger.info('Módulo de configuración de backups inicializado');
        } catch (error) {
            logger.error('Error al inicializar el módulo de configuración de backups', { error: error.message });
            showNotification('Error al cargar configuración de backups', 'error');
        }
    }

    /**
     * Carga las configuraciones actuales desde la BD
     */
    async loadCurrentConfigurations() {
        try {
            // Cargar todas las configuraciones necesarias
            const [storage, schedule, retention, security, branch] = await Promise.all([
                storageConfig.getCurrentStorageConfig(),
                scheduleConfig.getCurrentSchedule(),
                retentionConfig.getCurrentRetention(),
                securityConfig.getCurrentSecurity(),
                branchBackup.getBranchBackupConfig()
            ]);
            
            // Aplicar configuraciones a la UI
            this.applyStorageConfig(storage || this.getDefaultStorageConfig());
            this.applyScheduleConfig(schedule || this.getDefaultScheduleConfig());
            this.applyRetentionConfig(retention || this.getDefaultRetentionConfig());
            this.applySecurityConfig(security || this.getDefaultSecurityConfig());
            this.applyBranchConfig(branch || this.getDefaultBranchConfig());
            
            // Cargar historial de backups
            this.loadBackupHistory();
        } catch (error) {
            logger.error('Error al cargar configuraciones actuales', { error: error.message });
            throw error;
        }
    }

    /**
     * Configura los selectores y opciones en la UI
     */
    setupSelectors() {
        // Configurar selector de almacenamiento
        const storageSelect = document.getElementById('backup-storage-type');
        storageConfig.storageOptions.forEach(option => {
            const optElement = document.createElement('option');
            optElement.value = option.id;
            optElement.textContent = option.name;
            storageSelect.appendChild(optElement);
        });
        
        // Configurar selector de frecuencia
        const frequencySelect = document.getElementById('backup-frequency');
        scheduleConfig.frequencyOptions.forEach(option => {
            const optElement = document.createElement('option');
            optElement.value = option.id;
            optElement.textContent = option.name;
            frequencySelect.appendChild(optElement);
        });
        
        // Configurar selector de hora
        const hourSelect = document.getElementById('backup-hour');
        scheduleConfig.hourOptions.forEach(option => {
            const optElement = document.createElement('option');
            optElement.value = option.id;
            optElement.textContent = option.name;
            hourSelect.appendChild(optElement);
        });
        
        // Configurar selector de día de la semana (para backups semanales)
        const weekdaySelect = document.getElementById('backup-weekday');
        scheduleConfig.weekdayOptions.forEach(option => {
            const optElement = document.createElement('option');
            optElement.value = option.id;
            optElement.textContent = option.name;
            weekdaySelect.appendChild(optElement);
        });
        
        // Configurar selector de política de retención
        const retentionSelect = document.getElementById('backup-retention-policy');
        retentionConfig.retentionOptions.forEach(option => {
            const optElement = document.createElement('option');
            optElement.value = option.id;
            optElement.textContent = option.name;
            optElement.title = option.description;
            retentionSelect.appendChild(optElement);
        });
        
        // Configurar selector de encriptación
        const encryptionSelect = document.getElementById('backup-encryption');
        securityConfig.encryptionOptions.forEach(option => {
            const optElement = document.createElement('option');
            optElement.value = option.id;
            optElement.textContent = option.name;
            encryptionSelect.appendChild(optElement);
        });
    }

    /**
     * Configura los listeners de eventos para la UI
     */
    setupEventListeners() {
        // Backup manual
        document.getElementById('btn-create-backup').addEventListener('click', this.handleManualBackup.bind(this));
        
        // Restauración de backup
        document.getElementById('btn-restore-backup').addEventListener('click', this.handleRestoreBackup.bind(this));
        
        // Guardar configuración de almacenamiento
        document.getElementById('btn-save-storage').addEventListener('click', this.handleSaveStorage.bind(this));
        
        // Probar conexión de almacenamiento
        document.getElementById('btn-test-storage').addEventListener('click', this.handleTestStorage.bind(this));
        
        // Guardar configuración de programación
        document.getElementById('btn-save-schedule').addEventListener('click', this.handleSaveSchedule.bind(this));
        
        // Guardar configuración de retención
        document.getElementById('btn-save-retention').addEventListener('click', this.handleSaveRetention.bind(this));
        
        // Guardar configuración de seguridad
        document.getElementById('btn-save-security').addEventListener('click', this.handleSaveSecurity.bind(this));
        
        // Sincronizar backups entre sucursales
        document.getElementById('btn-sync-branches').addEventListener('click', this.handleSyncBranches.bind(this));
        
        // Guardar configuración de sucursales
        document.getElementById('btn-save-branch-config').addEventListener('click', this.handleSaveBranchConfig.bind(this));
        
        // Cambios en selectores que afectan a otros campos
        document.getElementById('backup-storage-type').addEventListener('change', this.handleStorageTypeChange.bind(this));
        document.getElementById('backup-frequency').addEventListener('change', this.handleFrequencyChange.bind(this));
        document.getElementById('backup-retention-policy').addEventListener('change', this.handleRetentionPolicyChange.bind(this));
        document.getElementById('backup-encryption').addEventListener('change', this.handleEncryptionChange.bind(this));
        
        // Filtros de historial
        document.getElementById('btn-filter-history').addEventListener('click', this.handleFilterHistory.bind(this));
    }

    /**
     * Maneja la acción de crear un backup manual
     */
    async handleManualBackup() {
        try {
            // Mostrar modal de confirmación
            const confirmed = confirm('¿Desea crear una copia de seguridad completa ahora? Esta operación puede tardar varios minutos dependiendo del tamaño de la base de datos.');
            
            if (!confirmed) return;
            
            // Mostrar indicador de carga
            this.showLoading('Creando copia de seguridad...');
            
            // Obtener configuraciones actuales
            const storage = await storageConfig.getCurrentStorageConfig() || this.getDefaultStorageConfig();
            const security = await securityConfig.getCurrentSecurity() || this.getDefaultSecurityConfig();
            
            // Crear el backup
            const result = await backupService.createManualBackup({
                storage,
                security,
                type: 'manual',
                userId: getCurrentUser().id,
                notes: 'Backup manual creado desde la interfaz de configuración'
            });
            
            // Ocultar indicador de carga
            this.hideLoading();
            
            if (result.success) {
                showNotification('Copia de seguridad creada exitosamente', 'success');
                
                // Registrar en el historial
                await backupHistory.logBackupEvent({
                    type: 'manual',
                    filePath: result.filePath,
                    size: result.size,
                    durationSeconds: result.duration,
                    status: 'completed',
                    notes: 'Backup manual creado desde la interfaz de configuración',
                    cloudSynced: result.cloudSynced
                });
                
                // Actualizar la lista de backups
                this.loadBackupHistory();
            } else {
                showNotification(`Error al crear copia de seguridad: ${result.error}`, 'error');
            }
        } catch (error) {
            this.hideLoading();
            logger.error('Error al crear backup manual', { error: error.message });
            showNotification(`Error al crear copia de seguridad: ${error.message}`, 'error');
        }
    }

    /**
     * Maneja la acción de restaurar desde un backup
     */
    async handleRestoreBackup() {
        try {
            // Obtener lista de backups disponibles
            const backups = await backupService.getBackupsList();
            
            if (!backups || backups.length === 0) {
                showNotification('No hay copias de seguridad disponibles para restaurar', 'warning');
                return;
            }
            
            // Crear modal de selección
            const selectElement = document.createElement('select');
            selectElement.id = 'restore-backup-select';
            selectElement.classList.add('form-control');
            
            backups.forEach(backup => {
                const option = document.createElement('option');
                option.value = backup.path;
                option.textContent = `${backup.date} - ${backup.size} - ${backup.type}`;
                selectElement.appendChild(option);
            });
            
            const modalContent = document.createElement('div');
            modalContent.innerHTML = `
                <div class="mb-3">
                    <p class="text-danger font-weight-bold">ADVERTENCIA: La restauración reemplazará todos los datos actuales. Esta acción no se puede deshacer.</p>
                    <p>Seleccione la copia de seguridad que desea restaurar:</p>
                </div>
            `;
            modalContent.appendChild(selectElement);
            
            // Mostrar modal de confirmación
            const modal = this.showModal('Restaurar Copia de Seguridad', modalContent);
            
            // Agregar botones al modal
            const footerElement = modal.querySelector('.modal-footer');
            const cancelButton = document.createElement('button');
            cancelButton.textContent = 'Cancelar';
            cancelButton.classList.add('btn', 'btn-secondary');
            cancelButton.addEventListener('click', () => {
                this.closeModal(modal);
            });
            
            const confirmButton = document.createElement('button');
            confirmButton.textContent = 'Restaurar';
            confirmButton.classList.add('btn', 'btn-danger');
            confirmButton.addEventListener('click', async () => {
                const selectedPath = selectElement.value;
                
                // Pedir confirmación adicional
                const confirmText = prompt('Esta operación reemplazará TODOS los datos actuales. Escriba CONFIRMAR para continuar:');
                
                if (confirmText !== 'CONFIRMAR') {
                    showNotification('Operación cancelada', 'info');
                    this.closeModal(modal);
                    return;
                }
                
                // Mostrar indicador de carga
                this.closeModal(modal);
                this.showLoading('Restaurando datos desde copia de seguridad...');
                
                try {
                    const result = await backupService.restoreFromBackup(selectedPath);
                    
                    this.hideLoading();
                    
                    if (result.success) {
                        showNotification('Sistema restaurado exitosamente. La aplicación se reiniciará.', 'success');
                        
                        // Registrar evento en el historial
                        await backupHistory.logBackupEvent({
                            type: 'restore',
                            filePath: selectedPath,
                            status: 'completed',
                            notes: 'Restauración manual desde la interfaz de configuración'
                        });
                        
                        // Reiniciar la aplicación
                        setTimeout(() => {
                            ipcRenderer.send('app:restart');
                        }, 3000);
                    } else {
                        showNotification(`Error al restaurar: ${result.error}`, 'error');
                    }
                } catch (error) {
                    this.hideLoading();
                    logger.error('Error al restaurar desde backup', { error: error.message });
                    showNotification(`Error al restaurar: ${error.message}`, 'error');
                }
            });
            
            footerElement.appendChild(cancelButton);
            footerElement.appendChild(confirmButton);
        } catch (error) {
            logger.error('Error al preparar restauración de backup', { error: error.message });
            showNotification(`Error al cargar copias de seguridad: ${error.message}`, 'error');
        }
    }

    /**
     * Maneja el guardado de la configuración de almacenamiento
     */
    async handleSaveStorage() {
        try {
            const type = document.getElementById('backup-storage-type').value;
            
            // Crear configuración base
            const config = {
                type,path: document.getElementById('backup-storage-path').value,
            };
            
            // Añadir configuraciones específicas según el tipo de almacenamiento
            switch (type) {
                case 'google_drive':
                    config.clientId = document.getElementById('google-client-id').value;
                    config.clientSecret = document.getElementById('google-client-secret').value;
                    config.folderId = document.getElementById('google-folder-id').value;
                    break;
                case 'dropbox':
                    config.apiKey = document.getElementById('dropbox-api-key').value;
                    config.accessToken = document.getElementById('dropbox-access-token').value;
                    config.folderPath = document.getElementById('dropbox-folder-path').value;
                    break;
                case 'onedrive':
                    config.clientId = document.getElementById('onedrive-client-id').value;
                    config.clientSecret = document.getElementById('onedrive-client-secret').value;
                    config.folderId = document.getElementById('onedrive-folder-id').value;
                    break;
                case 'custom_ftp':
                    config.host = document.getElementById('ftp-host').value;
                    config.port = document.getElementById('ftp-port').value;
                    config.username = document.getElementById('ftp-username').value;
                    config.password = document.getElementById('ftp-password').value;
                    config.path = document.getElementById('ftp-path').value;
                    config.useSftp = document.getElementById('ftp-use-sftp').checked;
                    break;
            }
            
            // Guardar la configuración
            const saved = await storageConfig.saveStorageConfig(config);
            
            if (saved) {
                showNotification('Configuración de almacenamiento guardada exitosamente', 'success');
            } else {
                showNotification('Error al guardar la configuración de almacenamiento', 'error');
            }
        } catch (error) {
            logger.error('Error al guardar configuración de almacenamiento', { error: error.message });
            showNotification(`Error: ${error.message}`, 'error');
        }
    }

    /**
     * Maneja la prueba de conexión al almacenamiento configurado
     */
    async handleTestStorage() {
        try {
            // Mostrar indicador de carga
            this.showLoading('Probando conexión...');
            
            // Obtener la configuración actual del formulario
            const type = document.getElementById('backup-storage-type').value;
            
            // Crear configuración temporal para prueba
            const testConfig = {
                type,
                path: document.getElementById('backup-storage-path').value,
            };
            
            // Añadir configuraciones específicas según el tipo de almacenamiento
            switch (type) {
                case 'google_drive':
                    testConfig.clientId = document.getElementById('google-client-id').value;
                    testConfig.clientSecret = document.getElementById('google-client-secret').value;
                    testConfig.folderId = document.getElementById('google-folder-id').value;
                    break;
                case 'dropbox':
                    testConfig.apiKey = document.getElementById('dropbox-api-key').value;
                    testConfig.accessToken = document.getElementById('dropbox-access-token').value;
                    testConfig.folderPath = document.getElementById('dropbox-folder-path').value;
                    break;
                case 'onedrive':
                    testConfig.clientId = document.getElementById('onedrive-client-id').value;
                    testConfig.clientSecret = document.getElementById('onedrive-client-secret').value;
                    testConfig.folderId = document.getElementById('onedrive-folder-id').value;
                    break;
                case 'custom_ftp':
                    testConfig.host = document.getElementById('ftp-host').value;
                    testConfig.port = document.getElementById('ftp-port').value;
                    testConfig.username = document.getElementById('ftp-username').value;
                    testConfig.password = document.getElementById('ftp-password').value;
                    testConfig.path = document.getElementById('ftp-path').value;
                    testConfig.useSftp = document.getElementById('ftp-use-sftp').checked;
                    break;
            }
            
            // Probar la conexión
            const result = await storageConfig.testStorageConnection(testConfig);
            
            // Ocultar indicador de carga
            this.hideLoading();
            
            if (result.success) {
                showNotification('Conexión exitosa!', 'success');
            } else {
                showNotification(`Error al conectar: ${result.error}`, 'error');
            }
        } catch (error) {
            this.hideLoading();
            logger.error('Error al probar conexión de almacenamiento', { error: error.message });
            showNotification(`Error: ${error.message}`, 'error');
        }
    }

    /**
     * Maneja el guardado de la configuración de programación
     */
    async handleSaveSchedule() {
        try {
            const frequency = document.getElementById('backup-frequency').value;
            const hour = document.getElementById('backup-hour').value;
            
            // Crear configuración base
            const schedule = {
                enabled: document.getElementById('backup-auto-enabled').checked,
                frequency,
                hour,
            };
            
            // Añadir configuración específica según la frecuencia
            switch (frequency) {
                case 'weekly':
                case 'biweekly':
                    schedule.weekday = document.getElementById('backup-weekday').value;
                    break;
                case 'monthly':
                    schedule.dayOfMonth = document.getElementById('backup-day-of-month').value;
                    break;
            }
            
            // Guardar la configuración
            const saved = await scheduleConfig.saveSchedule(schedule);
            
            if (saved) {
                showNotification('Programación de backups guardada exitosamente', 'success');
            } else {
                showNotification('Error al guardar la programación de backups', 'error');
            }
        } catch (error) {
            logger.error('Error al guardar programación de backups', { error: error.message });
            showNotification(`Error: ${error.message}`, 'error');
        }
    }

    /**
     * Maneja el guardado de la configuración de retención
     */
    async handleSaveRetention() {
        try {
            const policy = document.getElementById('backup-retention-policy').value;
            
            // Crear configuración base
            const retention = {
                policy,
            };
            
            // Añadir configuración específica según la política
            switch (policy) {
                case 'count':
                    retention.count = parseInt(document.getElementById('backup-retention-count').value, 10);
                    break;
                case 'days':
                    retention.days = parseInt(document.getElementById('backup-retention-days').value, 10);
                    break;
            }
            
            // Guardar la configuración
            const saved = await retentionConfig.saveRetention(retention);
            
            if (saved) {
                showNotification('Política de retención guardada exitosamente', 'success');
            } else {
                showNotification('Error al guardar la política de retención', 'error');
            }
        } catch (error) {
            logger.error('Error al guardar política de retención', { error: error.message });
            showNotification(`Error: ${error.message}`, 'error');
        }
    }

    /**
     * Maneja el guardado de la configuración de seguridad
     */
    async handleSaveSecurity() {
        try {
            const encryption = document.getElementById('backup-encryption').value;
            
            // Crear configuración base
            const security = {
                encryption,
            };
            
            // Añadir configuración específica según el tipo de encriptación
            switch (encryption) {
                case 'aes256':
                    // La clave se genera automáticamente o se obtiene de una existente
                    break;
                case 'custom':
                    security.method = document.getElementById('custom-encryption-method').value;
                    security.key = document.getElementById('custom-encryption-key').value;
                    break;
            }
            
            // Guardar la configuración
            const saved = await securityConfig.saveSecurity(security);
            
            if (saved) {
                showNotification('Configuración de seguridad guardada exitosamente', 'success');
            } else {
                showNotification('Error al guardar la configuración de seguridad', 'error');
            }
        } catch (error) {
            logger.error('Error al guardar configuración de seguridad', { error: error.message });
            showNotification(`Error: ${error.message}`, 'error');
        }
    }

    /**
     * Maneja la sincronización de backups entre sucursales
     */
    async handleSyncBranches() {
        try {
            // Mostrar indicador de carga
            this.showLoading('Sincronizando backups entre sucursales...');
            
            // Iniciar sincronización
            const result = await branchBackup.syncBranchBackups();
            
            // Ocultar indicador de carga
            this.hideLoading();
            
            if (result.success) {
                showNotification('Sincronización completada exitosamente', 'success');
                
                // Actualizar UI si es necesario
                this.loadBackupHistory();
            } else {
                showNotification(`Error en la sincronización: ${result.error}`, 'error');
            }
        } catch (error) {
            this.hideLoading();
            logger.error('Error al sincronizar backups entre sucursales', { error: error.message });
            showNotification(`Error: ${error.message}`, 'error');
        }
    }

    /**
     * Maneja el guardado de la configuración de sucursales
     */
    async handleSaveBranchConfig() {
        try {
            // Obtener valores de configuración
            const config = {
                enabled: document.getElementById('branch-sync-enabled').checked,
                mode: document.getElementById('branch-sync-mode').value,
                schedule: {
                    frequency: document.getElementById('branch-sync-frequency').value,
                    hour: document.getElementById('branch-sync-hour').value
                },
                branches: []
            };
            
            // Obtener sucursales seleccionadas
            const branchCheckboxes = document.querySelectorAll('.branch-checkbox:checked');
            branchCheckboxes.forEach(checkbox => {
                config.branches.push(checkbox.value);
            });
            
            // Guardar la configuración
            const saved = await branchBackup.saveBranchBackupConfig(config);
            
            if (saved) {
                showNotification('Configuración de sincronización guardada exitosamente', 'success');
            } else {
                showNotification('Error al guardar la configuración de sincronización', 'error');
            }
        } catch (error) {
            logger.error('Error al guardar configuración de sincronización', { error: error.message });
            showNotification(`Error: ${error.message}`, 'error');
        }
    }

    /**
     * Maneja el cambio de tipo de almacenamiento
     */
    handleStorageTypeChange(event) {
        const type = event.target.value;
        
        // Ocultar todos los formularios específicos
        document.querySelectorAll('.storage-specific-form').forEach(form => {
            form.style.display = 'none';
        });
        
        // Mostrar formulario según el tipo seleccionado
        if (type !== 'local') {
            document.getElementById(`${type}-form`).style.display = 'block';
        }
    }

    /**
     * Maneja el cambio de frecuencia de backups
     */
    handleFrequencyChange(event) {
        const frequency = event.target.value;
        
        // Ocultar todos los campos específicos de frecuencia
        document.querySelectorAll('.frequency-specific').forEach(field => {
            field.style.display = 'none';
        });
        
        // Mostrar campos según la frecuencia seleccionada
        switch (frequency) {
            case 'weekly':
            case 'biweekly':
                document.getElementById('backup-weekday-container').style.display = 'block';
                break;
            case 'monthly':
                document.getElementById('backup-day-of-month-container').style.display = 'block';
                break;
        }
    }

    /**
     * Maneja el cambio de política de retención
     */
    handleRetentionPolicyChange(event) {
        const policy = event.target.value;
        
        // Ocultar todos los campos específicos de retención
        document.querySelectorAll('.retention-specific').forEach(field => {
            field.style.display = 'none';
        });
        
        // Mostrar campos según la política seleccionada
        switch (policy) {
            case 'count':
                document.getElementById('backup-retention-count-container').style.display = 'block';
                break;
            case 'days':
                document.getElementById('backup-retention-days-container').style.display = 'block';
                break;
        }
    }

    /**
     * Maneja el cambio de tipo de encriptación
     */
    handleEncryptionChange(event) {
        const encryption = event.target.value;
        
        // Ocultar todos los campos específicos de encriptación
        document.querySelectorAll('.encryption-specific').forEach(field => {
            field.style.display = 'none';
        });
        
        // Mostrar campos según el tipo de encriptación seleccionado
        if (encryption === 'custom') {
            document.getElementById('custom-encryption-container').style.display = 'block';
        }
    }

    /**
     * Maneja el filtrado del historial de backups
     */
    async handleFilterHistory() {
        try {
            const filters = {
                startDate: document.getElementById('history-start-date').value,
                endDate: document.getElementById('history-end-date').value,
                type: document.getElementById('history-filter-type').value,
                status: document.getElementById('history-filter-status').value
            };
            
            // Eliminar filtros vacíos
            Object.keys(filters).forEach(key => {
                if (!filters[key]) delete filters[key];
            });
            
            // Cargar historial con filtros
            await this.loadBackupHistory(filters);
        } catch (error) {
            logger.error('Error al filtrar historial de backups', { error: error.message });
            showNotification(`Error: ${error.message}`, 'error');
        }
    }

    /**
     * Carga el historial de backups en la tabla
     */
    async loadBackupHistory(filters = {}) {
        try {
            // Obtener historial de backups
            const history = await backupHistory.getBackupHistory(filters);
            
            // Obtener tabla
            const historyTable = document.getElementById('backup-history-table');
            const tbody = historyTable.querySelector('tbody');
            
            // Limpiar tabla
            tbody.innerHTML = '';
            
            // Verificar si hay datos
            if (history.length === 0) {
                const row = document.createElement('tr');
                row.innerHTML = '<td colspan="7" class="text-center">No hay registros de backups</td>';
                tbody.appendChild(row);
                return;
            }
            
            // Llenar tabla con datos
            history.forEach(entry => {
                const row = document.createElement('tr');
                
                // Formatear fecha
                const date = new Date(entry.date);
                const formattedDate = date.toLocaleString();
                
                // Formatear tamaño
                const sizeInMB = (entry.size / (1024 * 1024)).toFixed(2);
                
                // Status class
                const statusClass = entry.status === 'completed' 
                    ? 'text-success' 
                    : (entry.status === 'error' ? 'text-danger' : 'text-warning');
                
                // Crear fila
                row.innerHTML = `
                    <td>${formattedDate}</td>
                    <td>${entry.type}</td>
                    <td>${sizeInMB} MB</td>
                    <td>${entry.duration_seconds} seg</td>
                    <td class="${statusClass}">${entry.status}</td>
                    <td>${entry.cloud_synced ? '<i class="fas fa-check text-success"></i>' : '-'}</td>
                    <td>
                        <button class="btn btn-sm btn-info btn-view-backup" data-id="${entry.id}">
                            <i class="fas fa-eye"></i>
                        </button>
                        ${entry.status === 'completed' ? `
                            <button class="btn btn-sm btn-warning btn-restore-backup" data-path="${entry.file_path}">
                                <i class="fas fa-undo"></i>
                            </button>
                        ` : ''}
                    </td>
                `;
                
                tbody.appendChild(row);
            });
            
            // Configurar eventos para los botones
            this.setupHistoryButtonsEvents();
        } catch (error) {
            logger.error('Error al cargar historial de backups', { error: error.message });
            showNotification(`Error: ${error.message}`, 'error');
        }
    }

    /**
     * Configura eventos para los botones del historial
     */
    setupHistoryButtonsEvents() {
        // Botones para ver detalles
        document.querySelectorAll('.btn-view-backup').forEach(button => {
            button.addEventListener('click', async (event) => {
                const backupId = event.currentTarget.dataset.id;
                try {
                    // Obtener detalles del backup
                    const db = await getDbConnection();
                    const details = await db.get('SELECT * FROM backup_history WHERE id = ?', [backupId]);
                    
                    if (!details) {
                        showNotification('No se encontraron detalles para este backup', 'warning');
                        return;
                    }
                    
                    // Crear contenido del modal
                    const modalContent = document.createElement('div');
                    modalContent.innerHTML = `
                        <table class="table table-bordered">
                            <tr>
                                <th>Fecha</th>
                                <td>${new Date(details.date).toLocaleString()}</td>
                            </tr>
                            <tr>
                                <th>Tipo</th>
                                <td>${details.type}</td>
                            </tr>
                            <tr>
                                <th>Archivo</th>
                                <td>${details.file_path}</td>
                            </tr>
                            <tr>
                                <th>Tamaño</th>
                                <td>${(details.size / (1024 * 1024)).toFixed(2)} MB</td>
                            </tr>
                            <tr>
                                <th>Duración</th>
                                <td>${details.duration_seconds} segundos</td>
                            </tr>
                            <tr>
                                <th>Estado</th>
                                <td>${details.status}</td>
                            </tr>
                            <tr>
                                <th>Usuario</th>
                                <td>${details.user_id}</td>
                            </tr>
                            <tr>
                                <th>Notas</th>
                                <td>${details.notes || '-'}</td>
                            </tr>
                            <tr>
                                <th>Sincronizado</th>
                                <td>${details.cloud_synced ? 'Sí' : 'No'}</td>
                            </tr>
                        </table>
                    `;
                    
                    // Mostrar modal
                    this.showModal('Detalles del Backup', modalContent);
                } catch (error) {
                    logger.error('Error al obtener detalles del backup', { error: error.message });
                    showNotification(`Error: ${error.message}`, 'error');
                }
            });
        });
        
        // Botones para restaurar
        document.querySelectorAll('.btn-restore-backup').forEach(button => {
            button.addEventListener('click', async (event) => {
                const backupPath = event.currentTarget.dataset.path;
                
                // Confirmar restauración
                const confirmed = confirm('¿Desea restaurar este backup? Esta acción reemplazará todos los datos actuales.');
                
                if (!confirmed) return;
                
                // Pedir confirmación adicional
                const confirmText = prompt('Esta operación reemplazará TODOS los datos actuales. Escriba CONFIRMAR para continuar:');
                
                if (confirmText !== 'CONFIRMAR') {
                    showNotification('Operación cancelada', 'info');
                    return;
                }
                
                try {
                    // Mostrar indicador de carga
                    this.showLoading('Restaurando datos desde copia de seguridad...');
                    
                    // Restaurar backup
                    const result = await backupService.restoreFromBackup(backupPath);
                    
                    // Ocultar indicador de carga
                    this.hideLoading();
                    
                    if (result.success) {
                        showNotification('Sistema restaurado exitosamente. La aplicación se reiniciará.', 'success');
                        
                        // Registrar evento en el historial
                        await backupHistory.logBackupEvent({
                            type: 'restore',
                            filePath: backupPath,
                            status: 'completed',
                            notes: 'Restauración desde el historial de backups'
                        });
                        
                        // Reiniciar la aplicación
                        setTimeout(() => {
                            ipcRenderer.send('app:restart');
                        }, 3000);
                    } else {
                        showNotification(`Error al restaurar: ${result.error}`, 'error');
                    }
                } catch (error) {
                    this.hideLoading();
                    logger.error('Error al restaurar desde backup', { error: error.message });
                    showNotification(`Error: ${error.message}`, 'error');
                }
            });
        });
    }

    /**
     * Aplica la configuración de almacenamiento a la UI
     */
    applyStorageConfig(config) {
        document.getElementById('backup-storage-type').value = config.type;
        document.getElementById('backup-storage-path').value = config.path || '';
        
        // Ocultar todos los formularios específicos
        document.querySelectorAll('.storage-specific-form').forEach(form => {
            form.style.display = 'none';
        });
        
        // Mostrar y configurar formulario específico según el tipo
        switch (config.type) {
            case 'google_drive':
                document.getElementById('google-drive-form').style.display = 'block';
                document.getElementById('google-client-id').value = config.clientId || '';
                document.getElementById('google-client-secret').value = config.clientSecret || '';
                document.getElementById('google-folder-id').value = config.folderId || '';
                break;
            case 'dropbox':
                document.getElementById('dropbox-form').style.display = 'block';
                document.getElementById('dropbox-api-key').value = config.apiKey || '';
                document.getElementById('dropbox-access-token').value = config.accessToken || '';
                document.getElementById('dropbox-folder-path').value = config.folderPath || '';
                break;
            case 'onedrive':
                document.getElementById('onedrive-form').style.display = 'block';
                document.getElementById('onedrive-client-id').value = config.clientId || '';
                document.getElementById('onedrive-client-secret').value = config.clientSecret || '';
                document.getElementById('onedrive-folder-id').value = config.folderId || '';
                break;
            case 'custom_ftp':
                document.getElementById('custom-ftp-form').style.display = 'block';
                document.getElementById('ftp-host').value = config.host || '';
                document.getElementById('ftp-port').value = config.port || '21';
                document.getElementById('ftp-username').value = config.username || '';
                document.getElementById('ftp-password').value = config.password || '';
                document.getElementById('ftp-path').value = config.path || '';
                document.getElementById('ftp-use-sftp').checked = config.useSftp || false;
                break;
        }
    }

    /**
     * Aplica la configuración de programación a la UI
     */
    applyScheduleConfig(config) {
        document.getElementById('backup-auto-enabled').checked = config.enabled;
        document.getElementById('backup-frequency').value = config.frequency;
        document.getElementById('backup-hour').value = config.hour;
        
        // Ocultar todos los campos específicos de frecuencia
        document.querySelectorAll('.frequency-specific').forEach(field => {
            field.style.display = 'none';
        });
        
        // Mostrar y configurar campos específicos según la frecuencia
        switch (config.frequency) {
            case 'weekly':
            case 'biweekly':
                document.getElementById('backup-weekday-container').style.display = 'block';
                document.getElementById('backup-weekday').value = config.weekday || '1';
                break;
            case 'monthly':
                document.getElementById('backup-day-of-month-container').style.display = 'block';
                document.getElementById('backup-day-of-month').value = config.dayOfMonth || '1';
                break;
        }
    }

    /**
     * Aplica la configuración de retención a la UI
     */
    applyRetentionConfig(config) {
        document.getElementById('backup-retention-policy').value = config.policy;
        
        // Ocultar todos los campos específicos de retención
        document.querySelectorAll('.retention-specific').forEach(field => {
            field.style.display = 'none';
        });
        
        // Mostrar y configurar campos específicos según la política
        switch (config.policy) {
            case 'count':
                document.getElementById('backup-retention-count-container').style.display = 'block';
                document.getElementById('backup-retention-count').value = config.count || 5;
                break;
            case 'days':
                document.getElementById('backup-retention-days-container').style.display = 'block';
                document.getElementById('backup-retention-days').value = config.days || 30;
                break;
        }
    }

    /**
     * Aplica la configuración de seguridad a la UI
     */
    applySecurityConfig(config) {
        document.getElementById('backup-encryption').value = config.encryption;
        
        // Ocultar todos los campos específicos de encriptación
        document.querySelectorAll('.encryption-specific').forEach(field => {
            field.style.display = 'none';
        });
        
        // Mostrar y configurar campos específicos según el tipo de encriptación
        if (config.encryption === 'custom') {
            document.getElementById('custom-encryption-container').style.display = 'block';
            document.getElementById('custom-encryption-method').value = config.method || '';
            document.getElementById('custom-encryption-key').value = config.key || '';
        }
    }

    /**
     * Aplica la configuración de sucursales a la UI
     */
    applyBranchConfig(config) {
        document.getElementById('branch-sync-enabled').checked = config.enabled;
        document.getElementById('branch-sync-mode').value = config.mode;
        document.getElementById('branch-sync-frequency').value = config.schedule?.frequency || 'daily';
        document.getElementById('branch-sync-hour').value = config.schedule?.hour || '00';
        
        // Marcar sucursales seleccionadas
        if (config.branches && config.branches.length > 0) {
            document.querySelectorAll('.branch-checkbox').forEach(checkbox => {
                checkbox.checked = config.branches.includes(checkbox.value);
            });
        }
    }

    /**
     * Muestra un modal genérico
     */
    showModal(title, contentElement) {
        const modalElement = document.createElement('div');
        modalElement.classList.add('modal', 'fade', 'show');
        modalElement.style.display = 'block';
        modalElement.innerHTML = `
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">${title}</h5>
                        <button type="button" class="close" data-dismiss="modal">
                            <span>&times;</span>
                        </button>
                    </div>
                    <div class="modal-body"></div>
                    <div class="modal-footer"></div>
                </div>
            </div>
        `;
        
        // Añadir contenido
        modalElement.querySelector('.modal-body').appendChild(contentElement);
        
        // Añadir evento para cerrar con botón X
        modalElement.querySelector('.close').addEventListener('click', () => {
            this.closeModal(modalElement);
        });
        
        // Añadir overlay
        const overlay = document.createElement('div');
        overlay.classList.add('modal-backdrop', 'fade', 'show');
        document.body.appendChild(overlay);
        
        // Añadir modal al body
        document.body.appendChild(modalElement);
        document.body.classList.add('modal-open');
        
        return modalElement;
    }

    /**
     * Cierra un modal
     */
    closeModal(modalElement) {
        if (modalElement) {
            modalElement.remove();
        }
        
        // Eliminar overlay
        const overlay = document.querySelector('.modal-backdrop');
        if (overlay) {
            overlay.remove();
        }
        
        document.body.classList.remove('modal-open');
    }

    /**
     * Muestra un indicador de carga
     */
    showLoading(message = 'Cargando...') {
        const loadingElement = document.createElement('div');
        loadingElement.id = 'loading-indicator';
        loadingElement.classList.add('loading-overlay');
        loadingElement.innerHTML = `
            <div class="loading-spinner"></div>
            <div class="loading-message">${message}</div>
        `;
        
        document.body.appendChild(loadingElement);
    }

    /**
     * Oculta el indicador de carga
     */
    hideLoading() {
        const loadingElement = document.getElementById('loading-indicator');
        if (loadingElement) {
            loadingElement.remove();
        }
    }

    /**
     * Obtiene la configuración por defecto para almacenamiento
     */
    getDefaultStorageConfig() {
        return {
            type: 'local',
            path: app.getPath('userData') + '/backups',
        };
    }

    /**
     * Obtiene la configuración por defecto para programación
     */
    getDefaultScheduleConfig() {
        return {
            enabled: false,
            frequency: 'daily',
            hour: '22',
            weekday: '1',
            dayOfMonth: '1'
        };
    }

    /**
     * Obtiene la configuración por defecto para retención
     */
    getDefaultRetentionConfig() {
        return {
            policy: 'count',
            count: 5,
            days: 30
        };
    }

    /**
     * Obtiene la configuración por defecto para seguridad
     */
    getDefaultSecurityConfig() {
        return {
            encryption: 'none'
        };
    }

    /**
     * Obtiene la configuración por defecto para sucursales
     */
    getDefaultBranchConfig() {
        return {
            enabled: false,
            mode: 'push',
            schedule: {
                frequency: 'daily',
                hour: '00'
            },
            branches: []
        };
    }

    /**
     * Maneja el evento de cambio en el modo de sincronización de sucursales
     */
    handleSyncModeChange(event) {
        const mode = event.target.value;
        
        // Actualizar descripciones según el modo seleccionado
        const descriptionElement = document.getElementById('branch-sync-mode-description');
        
        switch (mode) {
            case 'push':
                descriptionElement.textContent = 'Envía backups a otras sucursales automáticamente';
                break;
            case 'pull':
                descriptionElement.textContent = 'Recibe backups desde otras sucursales automáticamente';
                break;
            case 'bidirectional':
                descriptionElement.textContent = 'Envía y recibe backups de otras sucursales automáticamente';
                break;
        }
    }

    /**
     * Carga la lista de sucursales disponibles
     */
    async loadBranchList() {
        try {
            // Obtener lista de sucursales desde la API o configuración
            const branches = await branchBackup.getBranchList();
            
            // Obtener contenedor
            const container = document.getElementById('branch-list-container');
            
            // Limpiar contenedor
            container.innerHTML = '';
            
            // Verificar si hay sucursales
            if (branches.length === 0) {
                container.innerHTML = '<p class="text-muted">No hay sucursales configuradas.</p>';
                return;
            }
            
            // Crear lista de checkboxes para cada sucursal
            branches.forEach(branch => {
                const checkbox = document.createElement('div');
                checkbox.classList.add('form-check', 'mb-2');
                checkbox.innerHTML = `
                    <input class="form-check-input branch-checkbox" 
                           type="checkbox" 
                           id="branch-${branch.id}" 
                           value="${branch.id}">
                    <label class="form-check-label" for="branch-${branch.id}">
                        ${branch.name} (${branch.location})
                    </label>
                `;
                
                container.appendChild(checkbox);
            });
        } catch (error) {
            logger.error('Error al cargar lista de sucursales', { error: error.message });
            showNotification(`Error: ${error.message}`, 'error');
        }
    }

    /**
     * Maneja la carga manual de un backup
     */
    async handleBackupUpload(event) {
        const fileInput = event.target;
        const file = fileInput.files[0];
        
        if (!file) return;
        
        try {
            // Verificar extensión
            if (!file.name.endsWith('.backup') && !file.name.endsWith('.zip')) {
                showNotification('El archivo debe tener extensión .backup o .zip', 'error');
                return;
            }
            
            // Confirmar restauración
            const confirmed = confirm('¿Desea restaurar este backup? Esta acción reemplazará todos los datos actuales.');
            
            if (!confirmed) {
                fileInput.value = ''; // Limpiar input
                return;
            }
            
            // Pedir confirmación adicional
            const confirmText = prompt('Esta operación reemplazará TODOS los datos actuales. Escriba CONFIRMAR para continuar:');
            
            if (confirmText !== 'CONFIRMAR') {
                showNotification('Operación cancelada', 'info');
                fileInput.value = ''; // Limpiar input
                return;
            }
            
            // Mostrar indicador de carga
            this.showLoading('Importando y restaurando backup...');
            
            // Crear FormData para enviar archivo
            const formData = new FormData();
            formData.append('backupFile', file);
            
            // Enviar archivo al servidor/api
            const result = await backupService.importAndRestoreBackup(formData);
            
            // Ocultar indicador de carga
            this.hideLoading();
            
            if (result.success) {
                showNotification('Backup importado y restaurado exitosamente. La aplicación se reiniciará.', 'success');
                
                // Registrar evento en el historial
                await backupHistory.logBackupEvent({
                    type: 'restore',
                    filePath: file.name,
                    status: 'completed',
                    notes: 'Restauración desde archivo importado'
                });
                
                // Reiniciar la aplicación
                setTimeout(() => {
                    ipcRenderer.send('app:restart');
                }, 3000);
            } else {
                showNotification(`Error: ${result.error}`, 'error');
            }
        } catch (error) {
            this.hideLoading();
            logger.error('Error al importar backup', { error: error.message });
            showNotification(`Error: ${error.message}`, 'error');
            fileInput.value = ''; // Limpiar input
        }
    }

    /**
     * Maneja la descarga de un backup específico
     */
    async handleDownloadBackup(backupId) {
        try {
            // Mostrar indicador de carga
            this.showLoading('Preparando backup para descarga...');
            
            // Obtener información del backup
            const db = await getDbConnection();
            const backup = await db.get('SELECT * FROM backup_history WHERE id = ?', [backupId]);
            
            if (!backup) {
                showNotification('Backup no encontrado', 'error');
                this.hideLoading();
                return;
            }
            
            // Solicitar descarga del archivo
            const result = await backupService.prepareBackupForDownload(backup.file_path);
            
            // Ocultar indicador de carga
            this.hideLoading();
            
            if (result.success) {
                // Crear link temporal para descarga
                const a = document.createElement('a');
                a.href = result.downloadUrl;
                a.download = backup.file_path.split('/').pop();
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                
                showNotification('Descarga iniciada', 'success');
            } else {
                showNotification(`Error: ${result.error}`, 'error');
            }
        } catch (error) {
            this.hideLoading();
            logger.error('Error al descargar backup', { error: error.message });
            showNotification(`Error: ${error.message}`, 'error');
        }
    }

    /**
     * Actualiza la próxima fecha programada de backup
     */
    async updateNextScheduledBackup() {
        try {
            // Obtener próxima fecha programada
            const nextBackup = await scheduleConfig.getNextScheduledBackup();
            
            if (!nextBackup) {
                document.getElementById('next-backup-info').textContent = 'No hay backups programados';
                return;
            }
            
            // Formatear fecha
            const date = new Date(nextBackup);
            const formattedDate = date.toLocaleString();
            
            // Actualizar UI
            document.getElementById('next-backup-info').textContent = `Próximo backup: ${formattedDate}`;
        } catch (error) {
            logger.error('Error al actualizar próxima fecha de backup', { error: error.message });
        }
    }

    /**
     * Maneja la limpieza manual de backups antiguos
     */
    async handleCleanupBackups() {
        try {
            // Confirmación
            const confirmed = confirm('¿Desea eliminar los backups antiguos según la política de retención configurada?');
            
            if (!confirmed) return;
            
            // Mostrar indicador de carga
            this.showLoading('Limpiando backups antiguos...');
            
            // Ejecutar limpieza
            const result = await retentionConfig.cleanupOldBackups();
            
            // Ocultar indicador de carga
            this.hideLoading();
            
            if (result.success) {
                showNotification(`Limpieza completada. Se eliminaron ${result.removed} backups antiguos.`, 'success');
                
                // Actualizar historial
                this.loadBackupHistory();
            } else {
                showNotification(`Error: ${result.error}`, 'error');
            }
        } catch (error) {
            this.hideLoading();
            logger.error('Error al limpiar backups antiguos', { error: error.message });
            showNotification(`Error: ${error.message}`, 'error');
        }
    }

    /**
     * Maneja la exportación de configuración de respaldos
     */
    async handleExportConfig() {
        try {
            // Obtener todas las configuraciones
            const configs = {
                storage: await storageConfig.getStorageConfig(),
                schedule: await scheduleConfig.getSchedule(),
                retention: await retentionConfig.getRetention(),
                security: await securityConfig.getSecurity(),
                branches: await branchBackup.getBranchBackupConfig()
            };
            
            // Eliminar información sensible (contraseñas, tokens)
            if (configs.storage.password) configs.storage.password = '********';
            if (configs.storage.accessToken) configs.storage.accessToken = '********';
            if (configs.storage.clientSecret) configs.storage.clientSecret = '********';
            if (configs.security && configs.security.key) configs.security.key = '********';
            
            // Convertir a JSON
            const configJson = JSON.stringify(configs, null, 2);
            
            // Crear blob para descarga
            const blob = new Blob([configJson], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            
            // Crear link temporal para descarga
            const a = document.createElement('a');
            a.href = url;
            a.download = 'backup-config.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            
            // Liberar URL
            URL.revokeObjectURL(url);
            
            showNotification('Configuración exportada exitosamente', 'success');
        } catch (error) {
            logger.error('Error al exportar configuración', { error: error.message });
            showNotification(`Error: ${error.message}`, 'error');
        }
    }

    /**
     * Maneja la importación de configuración de respaldos
     */
    async handleImportConfig(event) {
        const fileInput = event.target;
        const file = fileInput.files[0];
        
        if (!file) return;
        
        try {
            // Verificar tipo de archivo
            if (file.type !== 'application/json') {
                showNotification('El archivo debe ser de tipo JSON', 'error');
                fileInput.value = ''; // Limpiar input
                return;
            }
            
            // Leer archivo
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    // Parsear JSON
                    const configs = JSON.parse(e.target.result);
                    
                    // Confirmar importación
                    const confirmed = confirm('¿Desea importar esta configuración? Esto reemplazará su configuración actual de backups.');
                    
                    if (!confirmed) {
                        fileInput.value = ''; // Limpiar input
                        return;
                    }
                    
                    // Mostrar indicador de carga
                    this.showLoading('Importando configuración...');
                    
                    // Aplicar configuraciones
                    let success = true;
                    
                    if (configs.storage) {
                        success = success && await storageConfig.saveStorageConfig(configs.storage);
                    }
                    
                    if (configs.schedule) {
                        success = success && await scheduleConfig.saveSchedule(configs.schedule);
                    }
                    
                    if (configs.retention) {
                        success = success && await retentionConfig.saveRetention(configs.retention);
                    }
                    
                    if (configs.security) {
                        success = success && await securityConfig.saveSecurity(configs.security);
                    }
                    
                    if (configs.branches) {
                        success = success && await branchBackup.saveBranchBackupConfig(configs.branches);
                    }
                    
                    // Ocultar indicador de carga
                    this.hideLoading();
                    
                    if (success) {
                        showNotification('Configuración importada exitosamente', 'success');
                        
                        // Recargar la página para aplicar la nueva configuración
                        window.location.reload();
                    } else {
                        showNotification('Error al importar algunas configuraciones', 'warning');
                    }
                } catch (error) {
                    this.hideLoading();
                    logger.error('Error al procesar archivo de configuración', { error: error.message });
                    showNotification(`Error: ${error.message}`, 'error');
                }
            };
            
            reader.readAsText(file);
        } catch (error) {
            logger.error('Error al importar configuración', { error: error.message });
            showNotification(`Error: ${error.message}`, 'error');
            fileInput.value = ''; // Limpiar input
        }
    }

    /**
     * Actualiza información de uso de espacio
     */
    async updateStorageUsage() {
        try {
            // Obtener información de uso
            const usage = await backupService.getBackupStorageUsage();
            
            // Actualizar UI
            const usageElement = document.getElementById('backup-storage-usage');
            if (usageElement) {
                // Formatear tamaño
                const usedMB = (usage.used / (1024 * 1024)).toFixed(2);
                const totalMB = (usage.total / (1024 * 1024)).toFixed(2);
                const percent = ((usage.used / usage.total) * 100).toFixed(1);
                
                usageElement.innerHTML = `
                    <div class="progress mb-2">
                        <div class="progress-bar ${percent > 80 ? 'bg-danger' : 'bg-success'}" 
                             role="progressbar" 
                             style="width: ${percent}%" 
                             aria-valuenow="${percent}" 
                             aria-valuemin="0" 
                             aria-valuemax="100">
                            ${percent}%
                        </div>
                    </div>
                    <small>${usedMB} MB de ${totalMB} MB utilizados</small>
                `;
            }
        } catch (error) {
            logger.error('Error al actualizar información de uso de almacenamiento', { error: error.message });
        }
    }

    /**
     * Inicializa la interfaz de gestión de backups
     */
    initialize() {
        // Cargar todas las configuraciones
        this.loadAllConfigurations();
        
        // Cargar historial
        this.loadBackupHistory();
        
        // Cargar lista de sucursales
        this.loadBranchList();
        
        // Actualizar próximo backup programado
        this.updateNextScheduledBackup();
        
        // Actualizar uso de almacenamiento
        this.updateStorageUsage();
        
        // Configurar eventos de la UI
        this.setupEvents();
    }

    /**
     * Configura todos los eventos de la interfaz
     */
    setupEvents() {
        // Eventos para almacenamiento
        document.getElementById('btn-save-storage').addEventListener('click', this.handleSaveStorage.bind(this));
        document.getElementById('btn-test-storage').addEventListener('click', this.handleTestStorage.bind(this));
        document.getElementById('backup-storage-type').addEventListener('change', this.handleStorageTypeChange.bind(this));
        
        // Eventos para programación
        document.getElementById('btn-save-schedule').addEventListener('click', this.handleSaveSchedule.bind(this));
        document.getElementById('backup-frequency').addEventListener('change', this.handleFrequencyChange.bind(this));
        
        // Eventos para retención
        document.getElementById('btn-save-retention').addEventListener('click', this.handleSaveRetention.bind(this));
        document.getElementById('backup-retention-policy').addEventListener('change', this.handleRetentionPolicyChange.bind(this));
        document.getElementById('btn-cleanup-backups').addEventListener('click', this.handleCleanupBackups.bind(this));
        
        // Eventos para seguridad
        document.getElementById('btn-save-security').addEventListener('click', this.handleSaveSecurity.bind(this));
        document.getElementById('backup-encryption').addEventListener('change', this.handleEncryptionChange.bind(this));
        
        // Eventos para sucursales
        document.getElementById('btn-save-branch-config').addEventListener('click', this.handleSaveBranchConfig.bind(this));
        document.getElementById('btn-sync-branches').addEventListener('click', this.handleSyncBranches.bind(this));
        document.getElementById('branch-sync-mode').addEventListener('change', this.handleSyncModeChange.bind(this));
        
        // Eventos para backup manual
        document.getElementById('btn-create-backup').addEventListener('click', this.handleCreateBackup.bind(this));
        document.getElementById('backup-file-input').addEventListener('change', this.handleBackupUpload.bind(this));
        
        // Eventos para filtrado de historial
        document.getElementById('btn-filter-history').addEventListener('click', this.handleFilterHistory.bind(this));
        
        // Eventos para exportar/importar configuración
        document.getElementById('btn-export-config').addEventListener('click', this.handleExportConfig.bind(this));
        document.getElementById('config-file-input').addEventListener('change', this.handleImportConfig.bind(this));
    }

    /**
     * Carga todas las configuraciones al iniciar
     */
    async loadAllConfigurations() {
        try {
            // Mostrar indicador de carga
            this.showLoading('Cargando configuraciones...');
            
            // Cargar configuración de almacenamiento
            const storage = await storageConfig.getStorageConfig();
            this.applyStorageConfig(storage || this.getDefaultStorageConfig());
            
            // Cargar configuración de programación
            const schedule = await scheduleConfig.getSchedule();
            this.applyScheduleConfig(schedule || this.getDefaultScheduleConfig());
            
            // Cargar configuración de retención
            const retention = await retentionConfig.getRetention();
            this.applyRetentionConfig(retention || this.getDefaultRetentionConfig());
            
            // Cargar configuración de seguridad
            const security = await securityConfig.getSecurity();
            this.applySecurityConfig(security || this.getDefaultSecurityConfig());
            
            // Cargar configuración de sucursales
            const branches = await branchBackup.getBranchBackupConfig();
            this.applyBranchConfig(branches || this.getDefaultBranchConfig());
            
            // Ocultar indicador de carga
            this.hideLoading();
        } catch (error) {
            this.hideLoading();
            logger.error('Error al cargar configuraciones de backup', { error: error.message });
            showNotification(`Error: ${error.message}`, 'error');
        }
    }
}

// Exportar la clase
 BackupManager

module.exports = BackupManager;