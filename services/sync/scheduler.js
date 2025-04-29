/**
 * FactuSystem - Módulo de Programación de Sincronización
 * 
 * Este módulo gestiona la programación de sincronizaciones automáticas entre
 * la sucursal local y el servidor central, determinando la frecuencia,
 * intentos de reconexión, y prioridades de sincronización.
 * 
 * @author FactuSystem
 * @version 1.0
 */

const { ipcRenderer } = require('electron');
const offlineSync = require('./offline.js');
const conflictResolver = require('./conflict.js');
const database = require('../../app/assets/js/utils/database.js');
const logger = require('../../services/audit/logger.js');
const backupService = require('../../services/backup/autoBackup.js');
const connectionMonitor = require('../../app/assets/js/utils/connection.js');

// Configuración predeterminada del programador de sincronización
const DEFAULT_CONFIG = {
    // Frecuencia de sincronización en minutos cuando se está online
    syncIntervalOnline: 5,
    // Frecuencia de intentos de sincronización en minutos cuando se está offline
    syncIntervalOffline: 15,
    // Número máximo de intentos antes de notificar al usuario
    maxRetries: 5,
    // Datos prioritarios para sincronizar primero (en caso de conexión limitada)
    priorityData: ['ventas', 'caja', 'stock', 'clientes'],
    // Sincronizar automáticamente al iniciar la aplicación
    syncOnStartup: true,
    // Sincronizar automáticamente antes de cerrar la aplicación
    syncOnShutdown: true,
    // Mostrar notificaciones de sincronización al usuario
    showNotifications: true,
    // Permitir sincronización en segundo plano (incluso con la app minimizada)
    backgroundSync: true,
    // Comprimir datos antes de sincronizar (ahorra ancho de banda)
    compressData: true,
    // Tamaño máximo de paquete de datos para sincronizar (en KB)
    maxPacketSize: 500,
    // Enviar solo datos modificados desde la última sincronización exitosa
    deltaSync: true
};

// Variables de estado del programador
let syncConfig = { ...DEFAULT_CONFIG };
let syncTimerId = null;
let retryCount = 0;
let lastSyncTime = null;
let isSyncing = false;
let pendingSyncOperations = [];
let syncErrors = [];
let syncStatus = 'idle'; // 'idle', 'syncing', 'error', 'partial', 'complete'
let forceSync = false;
let syncQueue = [];
let syncInProgress = false;

/**
 * Inicializa el programador de sincronización
 * @param {Object} config - Configuración personalizada para sobreescribir los valores predeterminados
 * @returns {Promise<void>}
 */
async function initialize(config = {}) {
    try {
        // Cargar configuración guardada en la base de datos
        const savedConfig = await loadSavedConfig();
        
        // Combinar configuraciones: predeterminada < guardada < personalizada
        syncConfig = { ...DEFAULT_CONFIG, ...savedConfig, ...config };
        
        logger.info('Scheduler: Inicializando programador de sincronización', { config: syncConfig });
        
        // Registrar eventos de conexión
        connectionMonitor.on('online', handleConnectionOnline);
        connectionMonitor.on('offline', handleConnectionOffline);
        
        // Registrar eventos de la aplicación
        ipcRenderer.on('app-before-quit', handleAppShutdown);
        ipcRenderer.on('force-sync', () => scheduleSync(true));
        
        // Registrar listeners para cambios en la base de datos local
        registerDatabaseChangeListeners();
        
        // Sincronizar al inicio si está configurado
        if (syncConfig.syncOnStartup) {
            // Pequeño retraso para asegurar que la aplicación esté completamente inicializada
            setTimeout(() => scheduleSync(true), 3000);
        } else {
            // Si no sincroniza al inicio, programar la próxima sincronización
            scheduleNextSync();
        }
        
        return { success: true, message: 'Programador de sincronización inicializado correctamente' };
    } catch (error) {
        logger.error('Scheduler: Error al inicializar el programador de sincronización', { error });
        return { success: false, error: error.message };
    }
}

/**
 * Carga la configuración guardada de la base de datos
 * @returns {Promise<Object>} Configuración guardada
 */
async function loadSavedConfig() {
    try {
        const db = await database.getConnection();
        const config = await db.get('SELECT * FROM configuracion WHERE modulo = ?', ['sync_scheduler']);
        
        return config ? JSON.parse(config.valor) : {};
    } catch (error) {
        logger.error('Scheduler: Error al cargar configuración guardada', { error });
        return {};
    }
}

/**
 * Guarda la configuración actual en la base de datos
 * @returns {Promise<boolean>} Éxito de la operación
 */
async function saveConfig() {
    try {
        const db = await database.getConnection();
        const configValue = JSON.stringify(syncConfig);
        
        await db.run(
            'INSERT OR REPLACE INTO configuracion (modulo, valor, actualizado_at) VALUES (?, ?, datetime("now"))',
            ['sync_scheduler', configValue]
        );
        
        return true;
    } catch (error) {
        logger.error('Scheduler: Error al guardar configuración', { error });
        return false;
    }
}

/**
 * Registra observadores para cambios en tablas críticas de la base de datos
 */
function registerDatabaseChangeListeners() {
    // Tablas a monitorear para sincronización
    const tablesToMonitor = [
        'ventas', 'caja', 'stock', 'clientes', 'productos', 
        'proveedores', 'usuarios', 'configuracion'
    ];
    
    // Registrar evento para cada tabla
    tablesToMonitor.forEach(table => {
        database.onTableChange(table, (changeType, recordId) => {
            addToSyncQueue({
                table,
                changeType, // 'insert', 'update', 'delete'
                recordId,
                timestamp: Date.now(),
                priority: syncConfig.priorityData.includes(table) ? 'high' : 'normal'
            });
        });
    });
    
    logger.info('Scheduler: Registrados listeners para cambios en la base de datos', { tables: tablesToMonitor });
}

/**
 * Añade una operación a la cola de sincronización
 * @param {Object} operation - Operación a añadir
 */
function addToSyncQueue(operation) {
    // Evitar duplicados en la cola (mismo registro, misma operación)
    const existingIndex = syncQueue.findIndex(item => 
        item.table === operation.table && 
        item.recordId === operation.recordId && 
        item.changeType === operation.changeType
    );
    
    if (existingIndex >= 0) {
        // Actualizar entrada existente
        syncQueue[existingIndex] = {
            ...operation,
            attempts: (syncQueue[existingIndex].attempts || 0)
        };
    } else {
        // Añadir nueva entrada
        syncQueue.push({
            ...operation,
            attempts: 0
        });
    }
    
    // Si la cola supera cierto tamaño, considerar programar una sincronización
    if (syncQueue.length >= 50) {
        scheduleSync(true);
    }
}

/**
 * Programa la próxima sincronización basada en el estado de conexión
 * @param {boolean} immediate - Si se debe sincronizar inmediatamente
 */
function scheduleNextSync(immediate = false) {
    // Cancelar el temporizador existente
    if (syncTimerId) {
        clearTimeout(syncTimerId);
        syncTimerId = null;
    }
    
    const isOnline = connectionMonitor.isOnline();
    const interval = isOnline ? 
        syncConfig.syncIntervalOnline * 60 * 1000 : 
        syncConfig.syncIntervalOffline * 60 * 1000;
    
    if (immediate) {
        executeSync();
    } else {
        // Programar la próxima sincronización
        syncTimerId = setTimeout(executeSync, interval);
        logger.debug('Scheduler: Próxima sincronización programada', { 
            isOnline, 
            interval: `${interval / 60000} minutos`,
            nextSyncTime: new Date(Date.now() + interval)
        });
    }
}

/**
 * Programa una sincronización
 * @param {boolean} force - Si se debe forzar la sincronización inmediatamente
 */
function scheduleSync(force = false) {
    if (force) {
        forceSync = true;
        
        // Si ya hay una sincronización en curso, se ejecutará al finalizar
        if (!syncInProgress) {
            scheduleNextSync(true);
        }
    } else {
        scheduleNextSync();
    }
}

/**
 * Ejecuta el proceso de sincronización
 * @returns {Promise<Object>} Resultado de la sincronización
 */
async function executeSync() {
    // Evitar sincronizaciones paralelas
    if (syncInProgress && !forceSync) {
        logger.debug('Scheduler: Sincronización ya en curso, omitiendo');
        return { success: false, message: 'Sincronización ya en curso' };
    }
    
    try {
        syncInProgress = true;
        syncStatus = 'syncing';
        
        // Notificar inicio de sincronización
        if (syncConfig.showNotifications) {
            ipcRenderer.send('show-notification', {
                title: 'FactuSystem',
                body: 'Iniciando sincronización de datos...',
                silent: true
            });
        }
        
        logger.info('Scheduler: Iniciando proceso de sincronización');
        
        // Verificar conexión
        if (!connectionMonitor.isOnline()) {
            // Si está offline, almacenar para sincronización posterior
            logger.warn('Scheduler: Sistema offline, almacenando operaciones para sincronización posterior');
            syncStatus = 'idle';
            syncInProgress = false;
            
            // Programar el próximo intento
            retryCount++;
            scheduleNextSync();
            
            return { success: false, message: 'Sin conexión', retryCount };
        }
        
        // Resetear contador de reintentos al tener conexión
        retryCount = 0;
        
        // Preparar datos para sincronización
        let syncData = prepareSyncData();
        
        // Comprimir datos si está configurado
        if (syncConfig.compressData && syncData.size > 10) {
            syncData = await compressData(syncData);
        }
        
        // Realizar sincronización
        const syncResult = await performSync(syncData);
        
        // Procesar resultado
        if (syncResult.success) {
            // Sincronización exitosa
            await handleSuccessfulSync(syncResult);
            syncStatus = 'complete';
            lastSyncTime = new Date();
            
            // Notificar éxito
            if (syncConfig.showNotifications) {
                ipcRenderer.send('show-notification', {
                    title: 'FactuSystem',
                    body: 'Sincronización completada correctamente',
                    silent: true
                });
            }
            
            logger.info('Scheduler: Sincronización completada correctamente', { syncResult });
        } else {
            // Sincronización fallida
            await handleFailedSync(syncResult);
            syncStatus = 'error';
            
            // Notificar error
            if (syncConfig.showNotifications) {
                ipcRenderer.send('show-notification', {
                    title: 'FactuSystem',
                    body: 'Error en la sincronización: ' + syncResult.message,
                    silent: false
                });
            }
            
            logger.error('Scheduler: Error en la sincronización', { syncResult });
        }
        
        // Programar la próxima sincronización
        forceSync = false;
        syncInProgress = false;
        scheduleNextSync();
        
        return syncResult;
    } catch (error) {
        syncStatus = 'error';
        syncInProgress = false;
        
        // Registrar error
        syncErrors.push({
            timestamp: new Date(),
            error: error.message,
            stack: error.stack
        });
        
        logger.error('Scheduler: Error crítico durante la sincronización', { error });
        
        // Notificar error
        if (syncConfig.showNotifications) {
            ipcRenderer.send('show-notification', {
                title: 'FactuSystem',
                body: 'Error en la sincronización: ' + error.message,
                silent: false
            });
        }
        
        // Programar reintento
        scheduleNextSync();
        
        return { success: false, error: error.message };
    }
}

/**
 * Prepara los datos para sincronización
 * @returns {Object} Datos a sincronizar
 */
function prepareSyncData() {
    // Identificar la información de la sucursal
    const sucursalInfo = getSucursalInfo();
    
    // Obtener datos pendientes de sincronización
    const pendingData = syncQueue.sort((a, b) => {
        // Ordenar por prioridad y luego por antigüedad
        if (a.priority === 'high' && b.priority !== 'high') return -1;
        if (a.priority !== 'high' && b.priority === 'high') return 1;
        return a.timestamp - b.timestamp;
    });
    
    // Limitar el tamaño del paquete si es necesario
    const dataToSync = limitDataPacketSize(pendingData);
    
    // Estructura de datos para sincronización
    return {
        sucursal: sucursalInfo,
        timestamp: Date.now(),
        data: dataToSync,
        size: dataToSync.length
    };
}

/**
 * Limita el tamaño del paquete de datos a sincronizar
 * @param {Array} data - Datos a sincronizar
 * @returns {Array} Datos limitados por tamaño
 */
function limitDataPacketSize(data) {
    // Si deltaSync está activado, solo sincronizar datos modificados
    let dataToSync = syncConfig.deltaSync ? 
        data.filter(item => item.timestamp > (lastSyncTime?.getTime() || 0)) : 
        [...data];
    
    // Ajustar tamaño del paquete si es necesario
    if (syncConfig.maxPacketSize > 0) {
        // Estimación simple de tamaño basada en JSON stringificado
        let currentSize = 0;
        const sizeLimit = syncConfig.maxPacketSize * 1024; // Convertir KB a bytes
        
        dataToSync = dataToSync.filter(item => {
            const itemSize = JSON.stringify(item).length;
            
            if (currentSize + itemSize <= sizeLimit) {
                currentSize += itemSize;
                return true;
            }
            return false;
        });
    }
    
    return dataToSync;
}

/**
 * Comprime los datos antes de sincronizar
 * @param {Object} data - Datos a comprimir
 * @returns {Promise<Object>} Datos comprimidos
 */
async function compressData(data) {
    try {
        const zlib = require('zlib');
        const { promisify } = require('util');
        const gzip = promisify(zlib.gzip);
        
        const jsonData = JSON.stringify(data);
        const compressedData = await gzip(jsonData);
        
        return {
            ...data,
            compressed: true,
            originalSize: jsonData.length,
            compressedSize: compressedData.length,
            compressedData: compressedData.toString('base64')
        };
    } catch (error) {
        logger.error('Scheduler: Error al comprimir datos', { error });
        return {
            ...data,
            compressed: false
        };
    }
}

/**
 * Realiza la sincronización con el servidor
 * @param {Object} syncData - Datos a sincronizar
 * @returns {Promise<Object>} Resultado de la sincronización
 */
async function performSync(syncData) {
    try {
        // Obtener URL del servidor
        const serverUrl = await getServerUrl();
        
        if (!serverUrl) {
            return { 
                success: false, 
                message: 'URL del servidor no configurada', 
                code: 'NO_SERVER_URL' 
            };
        }
        
        // Obtener credenciales
        const credentials = await getCredentials();
        
        // Preparar petición
        const response = await fetch(`${serverUrl}/api/sync`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${credentials.token}`
            },
            body: JSON.stringify(syncData)
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            return {
                success: false,
                status: response.status,
                message: errorData.message || `Error ${response.status}`,
                code: errorData.code || 'SERVER_ERROR',
                details: errorData
            };
        }
        
        const result = await response.json();
        
        // Verificar si hay conflictos que resolver
        if (result.conflicts && result.conflicts.length > 0) {
            await handleSyncConflicts(result.conflicts);
        }
        
        // Procesar datos recibidos del servidor
        if (result.serverData) {
            await processServerData(result.serverData);
        }
        
        return {
            success: true,
            message: 'Sincronización completada',
            syncedItemsCount: syncData.data.length,
            serverChanges: result.serverData ? result.serverData.length : 0,
            conflicts: result.conflicts ? result.conflicts.length : 0,
            timestamp: result.timestamp
        };
    } catch (error) {
        return {
            success: false,
            message: 'Error de conexión con el servidor',
            error: error.message,
            code: 'CONNECTION_ERROR'
        };
    }
}

/**
 * Maneja los conflictos de sincronización
 * @param {Array} conflicts - Conflictos detectados
 * @returns {Promise<void>}
 */
async function handleSyncConflicts(conflicts) {
    logger.info('Scheduler: Resolviendo conflictos de sincronización', { conflictsCount: conflicts.length });
    
    try {
        // Utilizar el módulo de resolución de conflictos
        const resolutionResults = await conflictResolver.resolveConflicts(conflicts);
        
        // Registrar resultados
        logger.info('Scheduler: Conflictos resueltos', { resolutionResults });
        
        // Programar resincronización de conflictos resueltos
        if (resolutionResults.resyncNeeded) {
            scheduleSync(true);
        }
    } catch (error) {
        logger.error('Scheduler: Error al resolver conflictos', { error });
        throw error;
    }
}

/**
 * Procesa los datos recibidos del servidor
 * @param {Array} serverData - Datos recibidos
 * @returns {Promise<void>}
 */
async function processServerData(serverData) {
    logger.info('Scheduler: Procesando datos recibidos del servidor', { itemsCount: serverData.length });
    
    try {
        // Obtener conexión a la base de datos
        const db = await database.getConnection();
        
        // Iniciar transacción
        await db.run('BEGIN TRANSACTION');
        
        // Procesar cada elemento
        for (const item of serverData) {
            try {
                // Aplicar cambio según tipo de operación
                switch (item.changeType) {
                    case 'insert':
                    case 'update':
                        await applyDataChange(db, item);
                        break;
                    case 'delete':
                        await applyDataDelete(db, item);
                        break;
                    default:
                        logger.warn('Scheduler: Tipo de operación no reconocido', { item });
                }
            } catch (error) {
                logger.error('Scheduler: Error al procesar ítem del servidor', { item, error });
                // Continuar con el siguiente ítem
            }
        }
        
        // Confirmar transacción
        await db.run('COMMIT');
        
        // Notificar cambios a la aplicación
        ipcRenderer.send('db-changes-from-server', {
            changesCount: serverData.length,
            tables: [...new Set(serverData.map(item => item.table))]
        });
        
        logger.info('Scheduler: Datos del servidor procesados correctamente');
    } catch (error) {
        // Revertir transacción en caso de error
        const db = await database.getConnection();
        await db.run('ROLLBACK');
        
        logger.error('Scheduler: Error al procesar datos del servidor', { error });
        throw error;
    }
}

/**
 * Aplica un cambio de datos (inserción o actualización)
 * @param {Object} db - Conexión a la base de datos
 * @param {Object} item - Ítem a procesar
 * @returns {Promise<void>}
 */
async function applyDataChange(db, item) {
    // Obtener estructura de la tabla
    const tableInfo = await getTableStructure(db, item.table);
    
    if (!tableInfo.success) {
        throw new Error(`Estructura de tabla no encontrada: ${item.table}`);
    }
    
    const { columns } = tableInfo;
    
    // Filtrar solo los campos que existen en la tabla
    const validData = {};
    Object.keys(item.data).forEach(key => {
        if (columns.includes(key)) {
            validData[key] = item.data[key];
        }
    });
    
    // Asegurar que hay datos válidos
    if (Object.keys(validData).length === 0) {
        throw new Error(`No hay datos válidos para ${item.table}`);
    }
    
    // Determinar si es insert o update
    if (item.changeType === 'insert') {
        // Preparar consulta de inserción
        const fields = Object.keys(validData).join(', ');
        const placeholders = Object.keys(validData).map(() => '?').join(', ');
        const values = Object.values(validData);
        
        const query = `INSERT INTO ${item.table} (${fields}) VALUES (${placeholders})`;
        await db.run(query, values);
    } else {
        // Preparar consulta de actualización
        const setClause = Object.keys(validData)
            .map(key => `${key} = ?`)
            .join(', ');
        const values = [...Object.values(validData), item.recordId];
        
        const query = `UPDATE ${item.table} SET ${setClause} WHERE id = ?`;
        await db.run(query, values);
    }
}

/**
 * Aplica una eliminación de datos
 * @param {Object} db - Conexión a la base de datos
 * @param {Object} item - Ítem a procesar
 * @returns {Promise<void>}
 */
async function applyDataDelete(db, item) {
    const query = `DELETE FROM ${item.table} WHERE id = ?`;
    await db.run(query, [item.recordId]);
}

/**
 * Obtiene la estructura de una tabla
 * @param {Object} db - Conexión a la base de datos
 * @param {string} tableName - Nombre de la tabla
 * @returns {Promise<Object>} Información de la tabla
 */
async function getTableStructure(db, tableName) {
    try {
        const tableInfo = await db.all(`PRAGMA table_info(${tableName})`);
        
        if (tableInfo.length === 0) {
            return { success: false, message: 'Tabla no encontrada' };
        }
        
        const columns = tableInfo.map(col => col.name);
        
        return {
            success: true,
            columns,
            primaryKey: tableInfo.find(col => col.pk === 1)?.name || 'id'
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Maneja una sincronización exitosa
 * @param {Object} result - Resultado de la sincronización
 * @returns {Promise<void>}
 */
async function handleSuccessfulSync(result) {
    try {
        // Limpiar elementos sincronizados de la cola
        const syncedItemsCount = result.syncedItemsCount || 0;
        
        if (syncedItemsCount > 0) {
            // Eliminar elementos sincronizados de la cola
            const syncedItems = syncQueue.splice(0, syncedItemsCount);
            
            // Registrar items sincronizados
            logger.debug('Scheduler: Items sincronizados correctamente', { 
                count: syncedItems.length,
                items: syncedItems.map(i => ({ table: i.table, id: i.recordId, type: i.changeType }))
            });
        }
        
        // Verificar si quedan elementos en la cola
        if (syncQueue.length > 0) {
            logger.info('Scheduler: Quedan elementos pendientes de sincronización', { count: syncQueue.length });
            
            // Si hay muchos elementos pendientes, programar una sincronización pronto
            if (syncQueue.length > 20) {
                setTimeout(() => scheduleSync(true), 5000);
            }
        } else {
            logger.info('Scheduler: Cola de sincronización vacía');
        }
        
        // Crear respaldo después de una sincronización exitosa (cada 6 horas)
        const lastBackupTime = await getLastBackupTime();
        const sixHoursInMs = 6 * 60 * 60 * 1000;
        
        if (!lastBackupTime || (Date.now() - lastBackupTime > sixHoursInMs)) {
            backupService.createBackup()
                .then(backupResult => {
                    logger.info('Scheduler: Respaldo creado después de sincronización', { backupResult });
                })
                .catch(error => {
                    logger.error('Scheduler: Error al crear respaldo después de sincronización', { error });
                });
        }
    } catch (error) {
        logger.error('Scheduler: Error al manejar sincronización exitosa', { error });
    }
}

/**
 * Maneja una sincronización fallida
 * @param {Object} result - Resultado de la sincronización
 * @returns {Promise<void>}
 */
async function handleFailedSync(result) {
    try {
        // Incrementar contador de intentos para cada elemento en la cola
        syncQueue.forEach(item => {
            item.attempts = (item.attempts || 0) + 1;
        });
        
        // Registrar el error
        syncErrors.push({
            timestamp: new Date(),
            error: result.message || 'Error desconocido',
            code: result.code,
            details: result.details
        });
        
        // Limitar el número de errores almacenados
        if (syncErrors.length > 100) {
            syncErrors = syncErrors.slice(-100);
        }
        
        // Si hay muchos intentos fallidos, notificar al usuario
        const maxAttemptsItems = syncQueue.filter(item => item.attempts >= syncConfig.maxRetries);
        
        if (maxAttemptsItems.length > 0) {
            logger.warn('Scheduler: Items con múltiples intentos fallidos', { count: maxAttemptsItems.length });
            
            if (syncConfig.showNotifications) {
                ipcRenderer.send('show-notification', {
                    title: 'Problemas de sincronización',
                    body: `Hay ${maxAttemptsItems.length} elementos que no se han podido sincronizar después de varios intentos`,
                    silent: false
                });
            }
        }
        
        // Si el error es por credenciales o permisos, notificar
        if (result.code === 'UNAUTHORIZED' || result.code === 'FORBIDDEN') {
            if (syncConfig.showNotifications) {
                ipcRenderer.send('show-notification', {
                    title: 'Error de autenticación',
                    body: 'Problema con las credenciales de sincronización. Verifique la configuración.',
                    silent: false
                });
            }
        }
    } catch (error) {
        logger.error('Scheduler: Error al manejar sincronización fallida', { error });
    }
}

/**
 * Maneja el evento de conexión online
 */
function handleConnectionOnline() {
    logger.info('Scheduler: Conexión a Internet detectada');
    
    // Si hay elementos pendientes, programar sincronización inmediata
    if (syncQueue.length > 0) {
        scheduleSync(true);
    } else {
        scheduleNextSync();
    }
}

/**
 * Maneja el evento de conexión offline
 */
function handleConnectionOffline() {
    logger.info('Scheduler: Conexión a Internet perdida');
    
    // Activar modo offline
    offlineSync.activateOfflineMode();
    
    // Reprogramar con intervalo de offline
    scheduleNextSync();
}

/**
 * Maneja el cierre de la aplicación
 */
async function handleAppShutdown() {
    logger.info('Scheduler: Manejando cierre de aplicación');
    
    // Si está configurado para sincronizar al cerrar y hay elementos pendientes
    if (syncConfig.syncOnShutdown && syncQueue.length > 0) {
        try {
            // Intentar sincronización final
            await executeSync();
        } catch (error) {
            logger.error('Scheduler: Error en sincronización final al cerrar', { error });
        }
    }
    
    // Guardar estado de sincronización
    await saveOfflineState();
    
    logger.info('Scheduler: Estado de sincronización guardado para próximo inicio');
}

/**
 * Guarda el estado offline para la próxima sesión
 * @returns {Promise<boolean>} Éxito de la operación
 */
async function saveOfflineState() {
    try {
        const db = await database.getConnection();
        
        // Guardar cola de sincronización
        const syncQueueData = JSON.stringify(syncQueue);
        
        await db.run(
            'INSERT OR REPLACE INTO configuracion (modulo, valor, actualizado_at) VALUES (?, ?, datetime("now"))',
            ['sync_queue', syncQueueData]
        );
        
        // Guardar estado adicional de sincronización
        const syncStateData = JSON.stringify({
            lastSyncTime: lastSyncTime ? lastSyncTime.toISOString() : null,
            syncErrors: syncErrors.slice(-20), // Solo guardamos los últimos 20 errores
            retryCount,
            syncStatus
        });
        
        await db.run(
            'INSERT OR REPLACE INTO configuracion (modulo, valor, actualizado_at) VALUES (?, ?, datetime("now"))',
            ['sync_state', syncStateData]
        );
        
        return true;
    } catch (error) {
        logger.error('Scheduler: Error al guardar estado offline', { error });
        return false;
    }
}

/**
 * Carga el estado offline de una sesión anterior
 * @returns {Promise<boolean>} Éxito de la operación
 */
async function loadOfflineState() {
    try {
        const db = await database.getConnection();
        
        // Cargar cola de sincronización
        const queueData = await db.get('SELECT valor FROM configuracion WHERE modulo = ?', ['sync_queue']);
        
        if (queueData && queueData.valor) {
            try {
                const loadedQueue = JSON.parse(queueData.valor);
                
                if (Array.isArray(loadedQueue)) {
                    syncQueue = loadedQueue;
                    logger.info('Scheduler: Cola de sincronización cargada', { count: syncQueue.length });
                }
            } catch (e) {
                logger.error('Scheduler: Error al parsear cola de sincronización', { error: e });
            }
        }
        
        // Cargar estado adicional
        const stateData = await db.get('SELECT valor FROM configuracion WHERE modulo = ?', ['sync_state']);
        
        if (stateData && stateData.valor) {
            try {
                const state = JSON.parse(stateData.valor);
                
                // Restaurar último tiempo de sincronización
                if (state.lastSyncTime) {
                    lastSyncTime = new Date(state.lastSyncTime);
                }
                
                // Restaurar errores
                if (Array.isArray(state.syncErrors)) {
                    syncErrors = state.syncErrors;
                }
                
                // Restaurar otros valores
                retryCount = state.retryCount || 0;
                syncStatus = state.syncStatus || 'idle';
                
                logger.info('Scheduler: Estado de sincronización cargado', { lastSyncTime, errorsCount: syncErrors.length });
            } catch (e) {
                logger.error('Scheduler: Error al parsear estado de sincronización', { error: e });
            }
        }
        
        return true;
    } catch (error) {
        logger.error('Scheduler: Error al cargar estado offline', { error });
        return false;
    }
}

/**
 * Obtiene información de la sucursal actual
 * @returns {Object} Información de la sucursal
 */
async function getSucursalInfo() {
    try {
        const db = await database.getConnection();
        const sucursal = await db.get('SELECT * FROM sucursales WHERE es_actual = 1');
        
        if (!sucursal) {
            // Usar valores por defecto si no hay configuración
            return {
                id: 1,
                nombre: 'Principal',
                codigo: 'SUC001',
                dispositivo_id: getDeviceId()
            };
        }
        
        return {
            id: sucursal.id,
            nombre: sucursal.nombre,
            codigo: sucursal.codigo,
            direccion: sucursal.direccion,
            telefono: sucursal.telefono,
            email: sucursal.email,
            dispositivo_id: getDeviceId()
        };
    } catch (error) {
        logger.error('Scheduler: Error al obtener información de sucursal', { error });
        
        // Devolver información mínima
        return {
            id: 0,
            nombre: 'Desconocida',
            codigo: 'ERROR',
            dispositivo_id: getDeviceId()
        };
    }
}

/**
 * Genera o recupera el ID único del dispositivo
 * @returns {string} ID del dispositivo
 */
function getDeviceId() {
    try {
        const { machineIdSync } = require('node-machine-id');
        return machineIdSync();
    } catch (error) {
        // Alternativa si node-machine-id falla
        const os = require('os');
        const crypto = require('crypto');
        
        const networkInterfaces = os.networkInterfaces();
        let mac = '';
        
        // Intentar obtener la MAC address
        Object.values(networkInterfaces).forEach(interfaces => {
            interfaces.forEach(iface => {
                if (!iface.internal && mac === '') {
                    mac = iface.mac;
                }
            });
        });
        
        // Si no hay MAC, usar combinación de hostname y username
        if (!mac) {
            const hostInfo = `${os.hostname()}-${os.userInfo().username}-${os.platform()}`;
            return crypto.createHash('md5').update(hostInfo).digest('hex');
        }
        
        return crypto.createHash('md5').update(mac).digest('hex');
    }
}

/**
 * Obtiene la URL del servidor de sincronización
 * @returns {Promise<string>} URL del servidor
 */
async function getServerUrl() {
    try {
        const db = await database.getConnection();
        const config = await db.get('SELECT valor FROM configuracion WHERE modulo = ?', ['server_url']);
        
        if (config && config.valor) {
            return config.valor.trim();
        }
        
        return null;
    } catch (error) {
        logger.error('Scheduler: Error al obtener URL del servidor', { error });
        return null;
    }
}

/**
 * Obtiene las credenciales para sincronización
 * @returns {Promise<Object>} Credenciales
 */
async function getCredentials() {
    try {
        const db = await database.getConnection();
        const tokenConfig = await db.get('SELECT valor FROM configuracion WHERE modulo = ?', ['sync_token']);
        
        if (tokenConfig && tokenConfig.valor) {
            return { token: tokenConfig.valor.trim() };
        }
        
        // Si no hay token específico de sincronización, intentar usar el del usuario actual
        const userToken = await db.get('SELECT token FROM usuarios WHERE es_actual = 1');
        
        if (userToken && userToken.token) {
            return { token: userToken.token };
        }
        
        // Si tampoco hay, buscar el super administrador
        const adminToken = await db.get('SELECT token FROM usuarios WHERE rol = "super_admin" LIMIT 1');
        
        if (adminToken && adminToken.token) {
            return { token: adminToken.token };
        }
        
        logger.warn('Scheduler: No se encontraron credenciales para sincronización');
        return { token: '' };
    } catch (error) {
        logger.error('Scheduler: Error al obtener credenciales', { error });
        return { token: '' };
    }
}

/**
 * Obtiene el tiempo del último respaldo
 * @returns {Promise<number>} Timestamp del último respaldo
 */
async function getLastBackupTime() {
    try {
        const db = await database.getConnection();
        const lastBackup = await db.get('SELECT MAX(fecha) as ultima_fecha FROM backup_log');
        
        if (lastBackup && lastBackup.ultima_fecha) {
            return new Date(lastBackup.ultima_fecha).getTime();
        }
        
        return null;
    } catch (error) {
        logger.error('Scheduler: Error al obtener tiempo del último respaldo', { error });
        return null;
    }
}

/**
 * Actualiza la configuración del programador
 * @param {Object} newConfig - Nueva configuración
 * @returns {Promise<Object>} Resultado de la operación
 */
async function updateConfig(newConfig) {
    try {
        // Validar configuración
        if (typeof newConfig !== 'object') {
            return { success: false, message: 'Configuración inválida' };
        }
        
        // Actualizar configuración
        syncConfig = { ...syncConfig, ...newConfig };
        
        // Guardar configuración
        const saved = await saveConfig();
        
        if (!saved) {
            return { success: false, message: 'Error al guardar configuración' };
        }
        
        // Reprogramar siguiendo la nueva configuración
        scheduleNextSync();
        
        logger.info('Scheduler: Configuración actualizada', { newConfig });
        
        return { success: true, message: 'Configuración actualizada correctamente' };
    } catch (error) {
        logger.error('Scheduler: Error al actualizar configuración', { error });
        return { success: false, error: error.message };
    }
}

/**
 * Obtiene el estado actual del programador de sincronización
 * @returns {Object} Estado del programador
 */
function getStatus() {
    return {
        status: syncStatus,
        lastSync: lastSyncTime,
        pendingItems: syncQueue.length,
        errors: syncErrors.length,
        config: { ...syncConfig },
        isOnline: connectionMonitor.isOnline(),
        retryCount
    };
}

/**
 * Limpia los errores de sincronización
 * @returns {Object} Resultado de la operación
 */
function clearErrors() {
    syncErrors = [];
    logger.info('Scheduler: Errores de sincronización limpiados');
    return { success: true, message: 'Errores eliminados' };
}

/**
 * Reinicia el proceso de sincronización
 * @returns {Promise<Object>} Resultado de la operación
 */
async function resetSync() {
    try {
        // Cancelar temporizador existente
        if (syncTimerId) {
            clearTimeout(syncTimerId);
            syncTimerId = null;
        }
        
        // Reiniciar variables
        retryCount = 0;
        syncStatus = 'idle';
        syncErrors = [];
        
        // Forzar sincronización si hay elementos pendientes
        if (syncQueue.length > 0) {
            return await scheduleSync(true);
        } else {
            scheduleNextSync();
            return { success: true, message: 'Sincronización reiniciada' };
        }
    } catch (error) {
        logger.error('Scheduler: Error al reiniciar sincronización', { error });
        return { success: false, error: error.message };
    }
}

/**
 * Prioriza elementos específicos en la cola de sincronización
 * @param {string} table - Tabla a priorizar
 * @param {string|number} recordId - ID del registro (opcional)
 * @returns {number} Número de elementos priorizados
 */
function prioritizeItems(table, recordId = null) {
    let count = 0;
    
    syncQueue.forEach(item => {
        if (item.table === table && (recordId === null || item.recordId === recordId)) {
            item.priority = 'high';
            count++;
        }
    });
    
    if (count > 0) {
        logger.info('Scheduler: Elementos priorizados', { table, recordId, count });
    }
    
    return count;
}

/**
 * Verifica si hay elementos pendientes de sincronización para una tabla específica
 * @param {string} table - Nombre de la tabla
 * @param {string|number} recordId - ID específico del registro (opcional)
 * @returns {boolean} True si hay elementos pendientes
 */
function hasPendingSync(table, recordId = null) {
    return syncQueue.some(item => 
        item.table === table && (recordId === null || item.recordId === recordId)
    );
}

// Exportar funciones públicas
module.exports = {
    initialize,
    scheduleSync,
    getStatus,
    updateConfig,
    clearErrors,
    resetSync,
    prioritizeItems,
    hasPendingSync,
    
    // Eventos que otros módulos pueden escuchar
    events: {
        SYNC_STARTED: 'sync_started',
        SYNC_COMPLETED: 'sync_completed',
        SYNC_FAILED: 'sync_failed',
        SYNC_CONFLICT: 'sync_conflict',
        CONNECTION_CHANGED: 'connection_changed'
    }
};