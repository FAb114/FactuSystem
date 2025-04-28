/**
 * services/sync/offline.js
 * 
 * Maneja las operaciones mientras la aplicación está offline y gestiona
 * la cola de sincronización para cuando se restablezca la conexión.
 * 
 * FactuSystem - Sistema de Facturación y Gestión Comercial Multisucursal
 */

const { ipcRenderer } = require('electron');
const localforage = require('localforage');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const logger = require('../audit/logger');
const conflictResolver = require('./conflict');
const syncScheduler = require('./scheduler');
const config = require('../../app/assets/js/utils/config');
const db = require('../../app/assets/js/utils/database');

// Configuración de los almacenamientos
const syncQueueStore = localforage.createInstance({
    name: 'factusystem',
    storeName: 'sync_queue'
});

const lastSyncStore = localforage.createInstance({
    name: 'factusystem',
    storeName: 'last_sync'
});

// Estado de la conexión
let isOnline = navigator.onLine;
let syncInProgress = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_INTERVAL = 30000; // 30 segundos

/**
 * Inicializa el sistema de sincronización offline
 */
function initialize() {
    // Escuchar eventos de conexión
    window.addEventListener('online', handleConnectionChange);
    window.addEventListener('offline', handleConnectionChange);
    
    // Verificar conexión inicial
    checkConnection();
    
    // Configurar verificación periódica
    setInterval(checkConnection, 60000); // Cada minuto
    
    // Configurar sincronización programada
    syncScheduler.setupScheduledSync(() => {
        if (isOnline && !syncInProgress) {
            syncPendingData();
        }
    });
    
    logger.info('Sistema de sincronización offline inicializado');
    
    return {
        isOnline: () => isOnline,
        queueOperation: queueOperation,
        syncNow: syncPendingData,
        getQueueStatus: getQueueStatus,
        clearQueue: clearQueue
    };
}

/**
 * Maneja los cambios en el estado de la conexión
 */
function handleConnectionChange(event) {
    const previousState = isOnline;
    isOnline = event.type === 'online';
    
    if (!previousState && isOnline) {
        logger.info('Conexión restablecida');
        reconnectAttempts = 0;
        
        // Intentar sincronizar datos pendientes
        syncPendingData();
        
        // Notificar al usuario
        const notification = new Notification('FactuSystem', {
            body: 'Conexión restablecida. Sincronizando datos...',
            icon: '../../app/assets/img/logo.png'
        });
        
        // Notificar a otros componentes
        ipcRenderer.send('connection-status-changed', isOnline);
    } else if (previousState && !isOnline) {
        logger.warn('Conexión perdida. Trabajando en modo offline');
        
        // Notificar al usuario
        const notification = new Notification('FactuSystem', {
            body: 'Conexión perdida. Trabajando en modo offline',
            icon: '../../app/assets/img/logo.png'
        });
        
        // Notificar a otros componentes
        ipcRenderer.send('connection-status-changed', isOnline);
    }
}

/**
 * Verifica activamente el estado de la conexión
 */
async function checkConnection() {
    try {
        // Obtener la URL del servidor desde la configuración
        const serverUrl = await config.get('serverUrl');
        if (!serverUrl) {
            isOnline = false;
            return;
        }
        
        // Intentar ping al servidor
        const response = await axios.get(`${serverUrl}/api/ping`, { 
            timeout: 5000,
            headers: {
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Expires': '0'
            }
        });
        
        const newStatus = response.status === 200;
        
        // Si el estado cambió, disparar el evento correspondiente
        if (newStatus !== isOnline) {
            if (newStatus) {
                window.dispatchEvent(new Event('online'));
            } else {
                window.dispatchEvent(new Event('offline'));
            }
        }
    } catch (error) {
        if (isOnline) {
            reconnectAttempts++;
            logger.warn(`Error al verificar conexión: ${error.message}. Intento ${reconnectAttempts} de ${MAX_RECONNECT_ATTEMPTS}`);
            
            if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
                window.dispatchEvent(new Event('offline'));
                setTimeout(() => { reconnectAttempts = 0; }, RECONNECT_INTERVAL);
            }
        }
    }
}

/**
 * Agrega una operación a la cola de sincronización
 * 
 * @param {string} entityType - Tipo de entidad (ventas, productos, clientes, etc.)
 * @param {string} operation - Tipo de operación (create, update, delete)
 * @param {object} data - Datos a sincronizar
 * @param {number} priority - Prioridad de sincronización (1-10)
 * @returns {Promise<string>} ID de la operación en cola
 */
async function queueOperation(entityType, operation, data, priority = 5) {
    try {
        // Obtener información de la sucursal y usuario
        const branchId = await config.get('currentBranchId');
        const userId = await config.get('currentUserId');
        
        if (!branchId || !userId) {
            throw new Error('No se pudo identificar la sucursal o el usuario actual');
        }
        
        // Crear el registro de sincronización
        const timestamp = new Date().toISOString();
        const operationId = uuidv4();
        
        const syncItem = {
            id: operationId,
            entityType,
            operation,
            data,
            metadata: {
                timestamp,
                branchId,
                userId,
                priority,
                attempts: 0,
                lastAttempt: null
            }
        };
        
        // Guardar en la cola de sincronización
        await syncQueueStore.setItem(operationId, syncItem);
        
        logger.info(`Operación ${operation} en ${entityType} agregada a la cola de sincronización: ${operationId}`);
        
        // Si estamos online, intentar sincronizar inmediatamente
        if (isOnline && !syncInProgress) {
            setTimeout(syncPendingData, 1000);
        }
        
        return operationId;
    } catch (error) {
        logger.error(`Error al encolar operación: ${error.message}`, { entityType, operation });
        throw error;
    }
}

/**
 * Sincroniza los datos pendientes con el servidor
 */
async function syncPendingData() {
    if (syncInProgress || !isOnline) {
        return;
    }
    
    syncInProgress = true;
    logger.info('Iniciando sincronización de datos pendientes');
    
    try {
        // Obtener todos los elementos de la cola
        const keys = await syncQueueStore.keys();
        
        if (keys.length === 0) {
            logger.info('No hay datos pendientes para sincronizar');
            syncInProgress = false;
            return;
        }
        
        // Obtener todos los elementos
        const queueItems = [];
        for (const key of keys) {
            const item = await syncQueueStore.getItem(key);
            queueItems.push(item);
        }
        
        // Ordenar por prioridad y timestamp
        queueItems.sort((a, b) => {
            if (a.metadata.priority !== b.metadata.priority) {
                return b.metadata.priority - a.metadata.priority; // Mayor prioridad primero
            }
            return new Date(a.metadata.timestamp) - new Date(b.metadata.timestamp); // Más antiguos primero
        });
        
        // Obtener token de autenticación
        const authToken = await config.get('authToken');
        const serverUrl = await config.get('serverUrl');
        const branchId = await config.get('currentBranchId');
        
        if (!authToken || !serverUrl || !branchId) {
            throw new Error('Falta información de configuración para sincronizar');
        }
        
        // Obtener última marca de tiempo de sincronización
        const lastSyncTimestamp = await lastSyncStore.getItem(`lastSync_${branchId}`) || '1970-01-01T00:00:00.000Z';
        
        // Procesar los elementos de la cola
        for (const item of queueItems) {
            try {
                // Incrementar el contador de intentos
                item.metadata.attempts++;
                item.metadata.lastAttempt = new Date().toISOString();
                await syncQueueStore.setItem(item.id, item);
                
                // Intentar sincronizar con el servidor
                const response = await axios({
                    method: 'post',
                    url: `${serverUrl}/api/sync/${item.entityType}/${item.operation}`,
                    data: {
                        payload: item.data,
                        metadata: item.metadata
                    },
                    headers: {
                        'Authorization': `Bearer ${authToken}`,
                        'X-Branch-Id': branchId,
                        'X-Last-Sync': lastSyncTimestamp
                    },
                    timeout: 15000 // 15 segundos
                });
                
                if (response.status === 200) {
                    // Operación sincronizada exitosamente
                    await syncQueueStore.removeItem(item.id);
                    logger.info(`Operación ${item.id} sincronizada correctamente`);
                    
                    // Actualizar datos locales si es necesario
                    if (response.data && response.data.updates) {
                        await processServerUpdates(response.data.updates);
                    }
                } else if (response.status === 409) {
                    // Conflicto detectado
                    logger.warn(`Conflicto detectado en operación ${item.id}`);
                    await handleSyncConflict(item, response.data);
                }
            } catch (error) {
                logger.error(`Error al sincronizar operación ${item.id}: ${error.message}`);
                
                // Si hay demasiados intentos fallidos, mover a la lista de conflictos
                if (item.metadata.attempts >= 5) {
                    await handleFailedSync(item);
                }
            }
        }
        
        // Actualizar marca de tiempo de última sincronización
        const newSyncTimestamp = new Date().toISOString();
        await lastSyncStore.setItem(`lastSync_${branchId}`, newSyncTimestamp);
        
        // Verificar si hay actualizaciones desde el servidor
        await fetchServerUpdates(lastSyncTimestamp);
        
    } catch (error) {
        logger.error(`Error general en sincronización: ${error.message}`);
    } finally {
        syncInProgress = false;
    }
}

/**
 * Maneja un conflicto de sincronización
 * 
 * @param {object} item - Elemento en conflicto
 * @param {object} conflictData - Datos del conflicto desde el servidor
 */
async function handleSyncConflict(item, conflictData) {
    try {
        // Usar el resolvedor de conflictos
        const resolution = await conflictResolver.resolveConflict(
            item.entityType,
            item.data,
            conflictData.serverData,
            item.operation
        );
        
        if (resolution.action === 'local') {
            // Mantener cambio local y forzar en el servidor
            item.metadata.forceUpdate = true;
            await syncQueueStore.setItem(item.id, item);
        } else if (resolution.action === 'server') {
            // Aceptar cambio del servidor
            await syncQueueStore.removeItem(item.id);
            
            // Actualizar datos locales
            if (resolution.entityType && resolution.entityId) {
                await db.updateEntity(
                    resolution.entityType,
                    resolution.entityId,
                    conflictData.serverData
                );
            }
        } else if (resolution.action === 'merge') {
            // Usar datos fusionados
            item.data = resolution.mergedData;
            await syncQueueStore.setItem(item.id, item);
        }
        
        logger.info(`Conflicto de sincronización ${item.id} resuelto con acción: ${resolution.action}`);
    } catch (error) {
        logger.error(`Error al resolver conflicto de sincronización: ${error.message}`);
        
        // Mover a la lista de conflictos no resueltos
        await handleFailedSync(item, 'conflict');
    }
}

/**
 * Maneja una sincronización fallida
 * 
 * @param {object} item - Elemento que falló
 * @param {string} reason - Razón del fallo
 */
async function handleFailedSync(item, reason = 'error') {
    // Almacenar en lista de conflictos para revisión manual
    const conflictStore = localforage.createInstance({
        name: 'factusystem',
        storeName: 'sync_conflicts'
    });
    
    // Agregar información sobre el fallo
    item.metadata.reason = reason;
    item.metadata.failedAt = new Date().toISOString();
    
    // Guardar en la lista de conflictos
    await conflictStore.setItem(item.id, item);
    
    // Eliminar de la cola de sincronización
    await syncQueueStore.removeItem(item.id);
    
    logger.warn(`Operación ${item.id} movida a conflictos después de múltiples intentos fallidos`);
    
    // Notificar al usuario sobre el conflicto
    const notification = new Notification('FactuSystem', {
        body: `Hay un conflicto de sincronización que requiere revisión manual en ${item.entityType}`,
        icon: '../../app/assets/img/logo.png'
    });
}

/**
 * Obtiene actualizaciones desde el servidor
 * 
 * @param {string} lastSyncTimestamp - Marca de tiempo de la última sincronización
 */
async function fetchServerUpdates(lastSyncTimestamp) {
    try {
        const serverUrl = await config.get('serverUrl');
        const authToken = await config.get('authToken');
        const branchId = await config.get('currentBranchId');
        
        if (!serverUrl || !authToken || !branchId) {
            return;
        }
        
        const response = await axios({
            method: 'get',
            url: `${serverUrl}/api/sync/updates`,
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'X-Branch-Id': branchId,
                'X-Last-Sync': lastSyncTimestamp
            }
        });
        
        if (response.status === 200 && response.data.updates) {
            await processServerUpdates(response.data.updates);
        }
    } catch (error) {
        logger.error(`Error al obtener actualizaciones del servidor: ${error.message}`);
    }
}

/**
 * Procesa las actualizaciones recibidas del servidor
 * 
 * @param {Array} updates - Lista de actualizaciones
 */
async function processServerUpdates(updates) {
    if (!Array.isArray(updates) || updates.length === 0) {
        return;
    }
    
    logger.info(`Procesando ${updates.length} actualizaciones del servidor`);
    
    for (const update of updates) {
        try {
            const { entityType, operation, data, id } = update;
            
            if (!entityType || !operation || !data) {
                logger.warn('Actualización del servidor con formato incorrecto', update);
                continue;
            }
            
            // Verificar si hay operaciones pendientes locales que puedan entrar en conflicto
            const pendingConflicts = await checkPendingConflicts(entityType, id);
            
            if (pendingConflicts.length > 0) {
                // Hay conflictos potenciales, manejarlos
                for (const conflictItem of pendingConflicts) {
                    await handleSyncConflict(conflictItem, { serverData: data });
                }
            } else {
                // No hay conflictos, aplicar directamente la actualización
                switch (operation) {
                    case 'create':
                    case 'update':
                        await db.updateEntity(entityType, id, data);
                        break;
                    case 'delete':
                        await db.deleteEntity(entityType, id);
                        break;
                    default:
                        logger.warn(`Operación desconocida: ${operation}`);
                }
                
                logger.info(`Actualización aplicada: ${operation} en ${entityType} con ID ${id}`);
                
                // Notificar a la UI sobre la actualización
                ipcRenderer.send('entity-updated', { entityType, operation, id });
            }
        } catch (error) {
            logger.error(`Error al procesar actualización del servidor: ${error.message}`, update);
        }
    }
}

/**
 * Verifica si hay operaciones pendientes que puedan entrar en conflicto
 * 
 * @param {string} entityType - Tipo de entidad
 * @param {string} entityId - ID de la entidad
 * @returns {Promise<Array>} Lista de operaciones en conflicto
 */
async function checkPendingConflicts(entityType, entityId) {
    const keys = await syncQueueStore.keys();
    const conflicts = [];
    
    for (const key of keys) {
        const item = await syncQueueStore.getItem(key);
        
        // Verificar si la operación afecta a la misma entidad
        if (item.entityType === entityType && 
            item.data && 
            (item.data.id === entityId || 
             (item.operation === 'create' && item.metadata.tempId === entityId))) {
            conflicts.push(item);
        }
    }
    
    return conflicts;
}

/**
 * Obtiene el estado actual de la cola de sincronización
 * 
 * @returns {Promise<object>} Estado de la cola
 */
async function getQueueStatus() {
    try {
        const keys = await syncQueueStore.keys();
        const items = [];
        
        for (const key of keys) {
            items.push(await syncQueueStore.getItem(key));
        }
        
        // Agrupar por tipo de entidad
        const byEntityType = {};
        for (const item of items) {
            if (!byEntityType[item.entityType]) {
                byEntityType[item.entityType] = 0;
            }
            byEntityType[item.entityType]++;
        }
        
        // Obtener el estado de los conflictos
        const conflictStore = localforage.createInstance({
            name: 'factusystem',
            storeName: 'sync_conflicts'
        });
        
        const conflictKeys = await conflictStore.keys();
        
        return {
            pendingCount: keys.length,
            conflictCount: conflictKeys.length,
            byEntityType,
            isOnline,
            syncInProgress
        };
    } catch (error) {
        logger.error(`Error al obtener estado de la cola: ${error.message}`);
        return {
            pendingCount: 0,
            conflictCount: 0,
            byEntityType: {},
            isOnline,
            syncInProgress,
            error: error.message
        };
    }
}

/**
 * Limpia la cola de sincronización
 * 
 * @param {string} type - Tipo de limpieza ('all', 'conflicts', o un entityType específico)
 * @returns {Promise<number>} Número de elementos eliminados
 */
async function clearQueue(type = 'all') {
    try {
        let count = 0;
        
        if (type === 'all') {
            // Eliminar toda la cola
            const keys = await syncQueueStore.keys();
            for (const key of keys) {
                await syncQueueStore.removeItem(key);
                count++;
            }
        } else if (type === 'conflicts') {
            // Eliminar solo los conflictos
            const conflictStore = localforage.createInstance({
                name: 'factusystem',
                storeName: 'sync_conflicts'
            });
            
            const keys = await conflictStore.keys();
            for (const key of keys) {
                await conflictStore.removeItem(key);
                count++;
            }
        } else {
            // Eliminar por tipo de entidad
            const keys = await syncQueueStore.keys();
            for (const key of keys) {
                const item = await syncQueueStore.getItem(key);
                if (item.entityType === type) {
                    await syncQueueStore.removeItem(key);
                    count++;
                }
            }
        }
        
        logger.info(`Cola de sincronización limpiada: ${count} elementos eliminados (tipo: ${type})`);
        return count;
    } catch (error) {
        logger.error(`Error al limpiar cola: ${error.message}`);
        throw error;
    }
}

// Exportar funciones
module.exports = {
    initialize,
    queueOperation,
    syncNow: syncPendingData,
    getQueueStatus,
    clearQueue,
    isOnline: () => isOnline
};