/**
 * Módulo de Sincronización de Sucursales para FactuSystem
 * 
 * Este módulo gestiona toda la sincronización de datos entre sucursales y
 * el servidor central, maneja operaciones offline/online, resolución de conflictos
 * y la gestión del estado de sincronización.
 * 
 * @module sucursales/sincronizacion
 * @requires utils/database
 * @requires utils/sync
 * @requires utils/logger
 * @requires modules/configuraciones/empresa
 */

// Importar utilidades necesarias
import { getDatabase, saveTransaction } from '../../../utils/database.js';
import { 
  isOnline, 
  getSyncQueue, 
  clearSyncQueue, 
  handleConflict, 
  getLastSyncDate 
} from '../../../utils/sync.js';
import { logEvent, logError, SYNC_EVENT } from '../../../utils/logger.js';
import { getCurrentSucursal, getAllSucursales } from '../configuraciones/empresa.js';

// Importar modelos de datos que necesitan sincronización
import { 
  getVentasPendientes, 
  updateVentasSincronizadas 
} from '../../modules/ventas/index.js';
import { 
  getComprasPendientes, 
  updateComprasSincronizadas 
} from '../../modules/compras/index.js';
import { 
  getStockUpdates, 
  applyStockUpdates 
} from '../../modules/productos/stock.js';
import { 
  getClientesUpdates, 
  applyClientesUpdates 
} from '../../modules/clientes/index.js';
import { 
  getProveedoresUpdates, 
  applyProveedoresUpdates 
} from '../../modules/proveedores/index.js';
import { 
  getCajaMovimientos, 
  updateCajaSincronizada 
} from '../../modules/caja/movimientos.js';

// Importar el servicio de sincronización offline
import { 
  storeOfflineChanges, 
  processPendingChanges 
} from '../../../services/sync/offline.js';
import { 
  resolveConflicts, 
  detectConflicts 
} from '../../../services/sync/conflict.js';
import { 
  scheduleSync, 
  cancelScheduledSync 
} from '../../../services/sync/scheduler.js';

// Configuración por defecto para sincronización
const DEFAULT_CONFIG = {
  syncInterval: 15, // minutos
  priorityEntities: ['ventas', 'productos', 'clientes'],
  syncOnStartup: true,
  retryAttempts: 3,
  conflictResolutionStrategy: 'server-wins' // o 'client-wins', 'manual', 'merge'
};

// Variables del módulo
let syncConfig = DEFAULT_CONFIG;
let isSyncing = false;
let lastSyncStatus = null;
let syncProgressCallback = null;
let syncScheduleId = null;

/**
 * Inicializa el módulo de sincronización
 * @param {Object} config - Configuración de sincronización personalizada
 * @returns {Promise<boolean>} - Resultado de la inicialización
 */
export async function initSyncModule(config = {}) {
  try {
    syncConfig = { ...DEFAULT_CONFIG, ...config };
    
    // Cargar configuración guardada desde la base de datos
    const db = await getDatabase();
    const savedConfig = await db.get('sync_config');
    if (savedConfig) {
      syncConfig = { ...syncConfig, ...savedConfig };
    }
    
    // Iniciar sincronización programada
    if (syncConfig.syncOnStartup) {
      const lastSync = await getLastSyncDate();
      const currentTime = new Date();
      const timeDiff = (currentTime - lastSync) / (1000 * 60); // diferencia en minutos
      
      if (timeDiff > syncConfig.syncInterval) {
        // Si pasó más tiempo del intervalo, sincronizar ahora
        setTimeout(() => synchronizeAll(), 5000); // Esperar 5s después de inicializar
      } else {
        // Programar la próxima sincronización
        const nextSyncIn = syncConfig.syncInterval - timeDiff;
        scheduleSyncProcess(nextSyncIn);
      }
    } else {
      // Si no sincronizamos al inicio, programar según el intervalo configurado
      scheduleSyncProcess(syncConfig.syncInterval);
    }
    
    // Verificar si hay cambios pendientes offline
    await processPendingChangesIfOnline();
    
    logEvent(SYNC_EVENT, 'Módulo de sincronización inicializado correctamente');
    return true;
  } catch (error) {
    logError('Error al inicializar el módulo de sincronización', error);
    return false;
  }
}

/**
 * Programa el proceso de sincronización periódica
 * @param {number} minutes - Minutos para la próxima sincronización
 */
function scheduleSyncProcess(minutes) {
  // Cancelar sincronización programada anterior si existe
  if (syncScheduleId) {
    cancelScheduledSync(syncScheduleId);
  }
  
  // Programar nueva sincronización
  syncScheduleId = scheduleSync(() => {
    synchronizeAll();
  }, minutes);
  
  logEvent(SYNC_EVENT, `Próxima sincronización programada en ${minutes} minutos`);
}

/**
 * Sincroniza todos los datos con el servidor central
 * @param {Function} progressCallback - Función de callback para reportar progreso
 * @returns {Promise<Object>} - Resultado de la sincronización
 */
export async function synchronizeAll(progressCallback = null) {
  // Si ya está sincronizando, no iniciar otro proceso
  if (isSyncing) {
    return { success: false, message: 'Ya existe un proceso de sincronización en curso' };
  }
  
  syncProgressCallback = progressCallback;
  isSyncing = true;
  updateSyncStatus('iniciando', 0);
  
  try {
    // Verificar conexión a internet
    if (!await isOnline()) {
      updateSyncStatus('sin-conexion', 0);
      isSyncing = false;
      return { 
        success: false, 
        message: 'No hay conexión a internet. Los cambios se sincronizarán cuando vuelva la conexión.',
        offline: true
      };
    }
    
    // Obtener información de la sucursal actual
    const sucursalActual = await getCurrentSucursal();
    if (!sucursalActual || !sucursalActual.id) {
      isSyncing = false;
      return { success: false, message: 'No se pudo determinar la sucursal actual' };
    }
    
    updateSyncStatus('preparando-datos', 10);
    
    // 1. Recopilar todos los cambios pendientes de enviar al servidor
    const pendingChanges = await collectPendingChanges();
    
    updateSyncStatus('enviando-cambios', 30);
    
    // 2. Enviar cambios al servidor
    const sendResult = await sendChangesToServer(pendingChanges, sucursalActual.id);
    if (!sendResult.success) {
      // Si falla, guardar cambios para intentar más tarde
      await storeOfflineChanges(pendingChanges);
      isSyncing = false;
      updateSyncStatus('error-envio', 0);
      return { 
        success: false, 
        message: 'Error al enviar cambios al servidor: ' + sendResult.message 
      };
    }
    
    updateSyncStatus('recibiendo-cambios', 60);
    
    // 3. Obtener cambios desde el servidor
    const lastSync = await getLastSyncDate();
    const receivedChanges = await getChangesFromServer(lastSync, sucursalActual.id);
    
    updateSyncStatus('aplicando-cambios', 80);
    
    // 4. Aplicar cambios recibidos localmente
    if (receivedChanges && receivedChanges.data) {
      // Verificar si hay conflictos
      const conflicts = await detectConflicts(receivedChanges.data);
      
      if (conflicts.length > 0) {
        // Resolver conflictos según la estrategia configurada
        const resolvedChanges = await resolveConflicts(
          conflicts, 
          syncConfig.conflictResolutionStrategy
        );
        
        // Aplicar cambios resueltos
        await applyServerChangesLocally(resolvedChanges);
      } else {
        // No hay conflictos, aplicar cambios directamente
        await applyServerChangesLocally(receivedChanges.data);
      }
    }
    
    // 5. Actualizar fecha de última sincronización
    const syncTimestamp = new Date();
    const db = await getDatabase();
    await db.put('last_sync_date', syncTimestamp.toISOString());
    
    // 6. Programar la próxima sincronización
    scheduleSyncProcess(syncConfig.syncInterval);
    
    updateSyncStatus('completado', 100);
    
    // Informar éxito
    const result = { 
      success: true, 
      message: 'Sincronización completada correctamente',
      timestamp: syncTimestamp,
      sentItems: pendingChanges.length,
      receivedItems: receivedChanges?.data?.length || 0,
    };
    
    logEvent(SYNC_EVENT, 'Sincronización completada', result);
    isSyncing = false;
    return result;
    
  } catch (error) {
    logError('Error durante la sincronización', error);
    updateSyncStatus('error', 0);
    isSyncing = false;
    return { 
      success: false, 
      message: 'Error en el proceso de sincronización: ' + error.message 
    };
  }
}

/**
 * Recopila todos los cambios pendientes de las diferentes entidades
 * @returns {Promise<Array>} - Lista de cambios pendientes
 */
async function collectPendingChanges() {
  try {
    const pendingChanges = [];
    
    // Obtener cambios de ventas
    const ventasPendientes = await getVentasPendientes();
    pendingChanges.push(...ventasPendientes.map(v => ({
      entity: 'ventas',
      action: 'create', // Las ventas generalmente son solo creación
      data: v,
      id: v.id,
      timestamp: v.fecha_creacion
    })));
    
    // Obtener cambios de compras
    const comprasPendientes = await getComprasPendientes();
    pendingChanges.push(...comprasPendientes.map(c => ({
      entity: 'compras',
      action: 'create', 
      data: c,
      id: c.id,
      timestamp: c.fecha_creacion
    })));
    
    // Obtener actualizaciones de stock
    const stockUpdates = await getStockUpdates();
    pendingChanges.push(...stockUpdates.map(s => ({
      entity: 'productos_stock',
      action: 'update', 
      data: s,
      id: s.producto_id,
      timestamp: s.fecha_actualizacion
    })));
    
    // Obtener cambios de clientes
    const clientesUpdates = await getClientesUpdates();
    pendingChanges.push(...clientesUpdates.map(c => ({
      entity: 'clientes',
      action: c.is_new ? 'create' : 'update',
      data: c,
      id: c.id,
      timestamp: c.fecha_actualizacion
    })));
    
    // Obtener cambios de proveedores
    const proveedoresUpdates = await getProveedoresUpdates();
    pendingChanges.push(...proveedoresUpdates.map(p => ({
      entity: 'proveedores',
      action: p.is_new ? 'create' : 'update',
      data: p,
      id: p.id,
      timestamp: p.fecha_actualizacion
    })));
    
    // Obtener movimientos de caja
    const cajaMovimientos = await getCajaMovimientos();
    pendingChanges.push(...cajaMovimientos.map(m => ({
      entity: 'caja_movimientos',
      action: 'create',
      data: m,
      id: m.id,
      timestamp: m.fecha
    })));
    
    // Ordenar cambios por timestamp y prioridad
    return pendingChanges.sort((a, b) => {
      // Primero ordenar por prioridad de entidad
      const aPriority = syncConfig.priorityEntities.indexOf(a.entity);
      const bPriority = syncConfig.priorityEntities.indexOf(b.entity);
      
      if (aPriority !== bPriority) {
        return aPriority - bPriority;
      }
      
      // Si misma prioridad, ordenar por timestamp
      return new Date(a.timestamp) - new Date(b.timestamp);
    });
    
  } catch (error) {
    logError('Error al recopilar cambios pendientes', error);
    throw error;
  }
}

/**
 * Envía los cambios pendientes al servidor central
 * @param {Array} changes - Lista de cambios a enviar
 * @param {number} sucursalId - ID de la sucursal actual
 * @returns {Promise<Object>} - Resultado del envío
 */
async function sendChangesToServer(changes, sucursalId) {
  if (!changes || changes.length === 0) {
    return { success: true, message: 'No hay cambios para enviar' };
  }
  
  try {
    // Preparar datos para enviar
    const payload = {
      sucursalId,
      changes,
      timestamp: new Date().toISOString()
    };
    
    // URL del endpoint del servidor (ajustar según configuración)
    const apiUrl = window.electron.getServerUrl() + '/api/sync/upload';
    
    // Enviar datos al servidor
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${await window.electron.getAuthToken()}`
      },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      throw new Error(`Error HTTP: ${response.status}`);
    }
    
    const result = await response.json();
    
    // Si la sincronización fue exitosa, marcar los items como sincronizados
    if (result.success) {
      await markItemsAsSynchronized(changes);
    }
    
    return result;
    
  } catch (error) {
    logError('Error al enviar cambios al servidor', error);
    return { success: false, message: error.message };
  }
}

/**
 * Obtiene cambios del servidor desde la última sincronización
 * @param {Date} lastSyncDate - Fecha de la última sincronización
 * @param {number} sucursalId - ID de la sucursal actual
 * @returns {Promise<Object>} - Datos recibidos del servidor
 */
async function getChangesFromServer(lastSyncDate, sucursalId) {
  try {
    // URL del endpoint del servidor
    const apiUrl = window.electron.getServerUrl() + '/api/sync/download';
    
    // Parámetros para la solicitud
    const params = new URLSearchParams({
      sucursalId,
      lastSync: lastSyncDate ? lastSyncDate.toISOString() : '1970-01-01T00:00:00Z'
    });
    
    // Realizar solicitud al servidor
    const response = await fetch(`${apiUrl}?${params.toString()}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${await window.electron.getAuthToken()}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`Error HTTP: ${response.status}`);
    }
    
    return await response.json();
    
  } catch (error) {
    logError('Error al obtener cambios del servidor', error);
    throw error;
  }
}

/**
 * Aplica los cambios recibidos del servidor a la base de datos local
 * @param {Array} changes - Cambios a aplicar localmente
 * @returns {Promise<void>}
 */
async function applyServerChangesLocally(changes) {
  if (!changes || changes.length === 0) return;
  
  try {
    const db = await getDatabase();
    
    // Agrupar cambios por entidad para procesarlos en bloques
    const changesByEntity = changes.reduce((acc, change) => {
      if (!acc[change.entity]) {
        acc[change.entity] = [];
      }
      acc[change.entity].push(change);
      return acc;
    }, {});
    
    // Procesar cambios por entidad
    for (const [entity, entityChanges] of Object.entries(changesByEntity)) {
      // Actualizar progreso para la interfaz de usuario
      updateSyncStatus(`aplicando-${entity}`, 80);
      
      switch (entity) {
        case 'productos_stock':
          await applyStockUpdates(entityChanges.map(c => c.data));
          break;
          
        case 'clientes':
          await applyClientesUpdates(entityChanges.map(c => c.data));
          break;
          
        case 'proveedores':
          await applyProveedoresUpdates(entityChanges.map(c => c.data));
          break;
          
        case 'ventas':
          // Las ventas normalmente solo se sincronizan desde sucursal a central,
          // pero podrían venir historiales de otras sucursales
          for (const change of entityChanges) {
            if (change.action === 'create' && change.data.sucursal_id !== await getCurrentSucursal().id) {
              await db.put('ventas', change.data);
            }
          }
          break;
          
        case 'compras':
          // Similar a ventas
          for (const change of entityChanges) {
            if (change.action === 'create' && change.data.sucursal_id !== await getCurrentSucursal().id) {
              await db.put('compras', change.data);
            }
          }
          break;
          
        case 'caja_movimientos':
          // Similar a ventas/compras
          for (const change of entityChanges) {
            if (change.data.sucursal_id !== await getCurrentSucursal().id) {
              await db.put('caja_movimientos', change.data);
            }
          }
          break;
          
        default:
          // Para otras entidades menos específicas
          for (const change of entityChanges) {
            const collection = entity;
            
            switch (change.action) {
              case 'create':
              case 'update':
                await db.put(collection, change.data);
                break;
                
              case 'delete':
                await db.delete(collection, change.id);
                break;
            }
          }
      }
    }
    
    logEvent(SYNC_EVENT, `Aplicados ${changes.length} cambios desde el servidor`);
    
  } catch (error) {
    logError('Error al aplicar cambios localmente', error);
    throw error;
  }
}

/**
 * Marca los elementos como sincronizados en la base de datos local
 * @param {Array} changes - Cambios sincronizados
 * @returns {Promise<void>}
 */
async function markItemsAsSynchronized(changes) {
  try {
    // Agrupar cambios por entidad
    const changesByEntity = changes.reduce((acc, change) => {
      if (!acc[change.entity]) {
        acc[change.entity] = [];
      }
      acc[change.entity].push(change);
      return acc;
    }, {});
    
    // Actualizar cada entidad
    for (const [entity, entityChanges] of Object.entries(changesByEntity)) {
      const ids = entityChanges.map(c => c.id);
      
      switch (entity) {
        case 'ventas':
          await updateVentasSincronizadas(ids);
          break;
          
        case 'compras':
          await updateComprasSincronizadas(ids);
          break;
          
        case 'caja_movimientos':
          await updateCajaSincronizada(ids);
          break;
          
        // Para otras entidades se podría implementar un mecanismo similar
      }
    }
  } catch (error) {
    logError('Error al marcar elementos como sincronizados', error);
    throw error;
  }
}

/**
 * Procesa los cambios pendientes si hay conexión a internet
 * @returns {Promise<boolean>} - Resultado del procesamiento
 */
async function processPendingChangesIfOnline() {
  try {
    if (await isOnline()) {
      const pendingChanges = await getSyncQueue();
      if (pendingChanges && pendingChanges.length > 0) {
        logEvent(SYNC_EVENT, `Procesando ${pendingChanges.length} cambios pendientes`);
        const sucursalActual = await getCurrentSucursal();
        
        // Enviar cambios pendientes al servidor
        const result = await sendChangesToServer(pendingChanges, sucursalActual.id);
        if (result.success) {
          await clearSyncQueue();
          return true;
        }
      }
    }
    return false;
  } catch (error) {
    logError('Error al procesar cambios pendientes', error);
    return false;
  }
}

/**
 * Actualiza el estado de sincronización y notifica a la UI
 * @param {string} status - Estado de la sincronización
 * @param {number} progress - Porcentaje de progreso (0-100)
 */
function updateSyncStatus(status, progress) {
  lastSyncStatus = { status, progress, timestamp: new Date() };
  
  // Si hay un callback de progreso registrado, notificarlo
  if (syncProgressCallback && typeof syncProgressCallback === 'function') {
    syncProgressCallback(lastSyncStatus);
  }
  
  // Enviar evento para actualizar la UI
  window.dispatchEvent(new CustomEvent('sync-status-update', { 
    detail: lastSyncStatus 
  }));
}

/**
 * Obtiene el estado actual de sincronización
 * @returns {Object} - Estado actual
 */
export function getSyncStatus() {
  return lastSyncStatus;
}

/**
 * Fuerza una sincronización inmediata
 * @param {Function} progressCallback - Callback para reportar progreso
 * @returns {Promise<Object>} - Resultado de la sincronización
 */
export async function forceSyncNow(progressCallback = null) {
  return synchronizeAll(progressCallback);
}

/**
 * Actualiza la configuración de sincronización
 * @param {Object} newConfig - Nueva configuración
 * @returns {Promise<boolean>} - Resultado de la actualización
 */
export async function updateSyncConfig(newConfig) {
  try {
    syncConfig = { ...syncConfig, ...newConfig };
    
    // Guardar configuración en la base de datos
    const db = await getDatabase();
    await db.put('sync_config', syncConfig);
    
    // Reprogramar sincronización con la nueva configuración
    scheduleSyncProcess(syncConfig.syncInterval);
    
    return true;
  } catch (error) {
    logError('Error al actualizar configuración de sincronización', error);
    return false;
  }
}

/**
 * Obtiene la configuración actual de sincronización
 * @returns {Object} - Configuración actual
 */
export function getSyncConfig() {
  return { ...syncConfig };
}

/**
 * Obtiene las estadísticas de sincronización
 * @returns {Promise<Object>} - Estadísticas de sincronización
 */
export async function getSyncStats() {
  try {
    const db = await getDatabase();
    const lastSyncDate = await getLastSyncDate();
    const pendingChanges = await getSyncQueue();
    const sucursalActual = await getCurrentSucursal();
    
    // Obtener registros de sincronización reciente (últimos 10)
    const syncLogs = await db.getAll('sync_logs', { limit: 10, sort: [{ field: 'timestamp', direction: 'desc' }] });
    
    return {
      lastSync: lastSyncDate,
      pendingChangesCount: pendingChanges ? pendingChanges.length : 0,
      sucursalId: sucursalActual ? sucursalActual.id : null,
      sucursalNombre: sucursalActual ? sucursalActual.nombre : 'No definida',
      isSyncing,
      syncConfig,
      recentLogs: syncLogs
    };
  } catch (error) {
    logError('Error al obtener estadísticas de sincronización', error);
    return {
      error: error.message,
      lastSync: null,
      pendingChangesCount: 0,
      isSyncing: false
    };
  }
}

/**
 * Reinicia el estado de sincronización (para casos de migración o emergencia)
 * @returns {Promise<boolean>} - Resultado del reinicio
 */
export async function resetSyncState() {
  try {
    const db = await getDatabase();
    
    // Eliminar fecha de última sincronización
    await db.delete('last_sync_date');
    
    // Marcar todo como no sincronizado
    // Esto depende de la implementación específica de cada módulo
    
    // Limpiar cola de sincronización
    await clearSyncQueue();
    
    // Registrar evento
    logEvent(SYNC_EVENT, 'Estado de sincronización reiniciado manualmente');
    
    return true;
  } catch (error) {
    logError('Error al reiniciar estado de sincronización', error);
    return false;
  }
}

/**
 * Verifica si hay cambios específicos pendientes de sincronización
 * @param {string} entityType - Tipo de entidad a verificar
 * @param {string|number} entityId - ID de la entidad
 * @returns {Promise<boolean>} - True si hay cambios pendientes
 */
export async function hasPendingChanges(entityType, entityId) {
  try {
    const pendingChanges = await getSyncQueue();
    if (!pendingChanges) return false;
    
    return pendingChanges.some(change => 
      change.entity === entityType && change.id.toString() === entityId.toString()
    );
  } catch (error) {
    logError('Error al verificar cambios pendientes', error);
    return false;
  }
}

/**
 * Registra un evento manual de sincronización
 * @param {Object} event - Detalle del evento
 * @returns {Promise<boolean>} - Resultado del registro
 */
export async function logSyncEvent(event) {
  try {
    logEvent(SYNC_EVENT, event.message || 'Evento de sincronización manual', event);
    return true;
  } catch (error) {
    logError('Error al registrar evento de sincronización', error);
    return false;
  }
}

/**
 * Sincroniza una entidad específica bajo demanda
 * @param {string} entityType - Tipo de entidad a sincronizar
 * @param {Array} entityIds - IDs de las entidades a sincronizar
 * @returns {Promise<Object>} - Resultado de la sincronización
 */
export async function syncSpecificEntities(entityType, entityIds = []) {
  if (isSyncing) {
    return { success: false, message: 'Ya existe un proceso de sincronización en curso' };
  }
  
  isSyncing = true;
  updateSyncStatus('sincronizando-especifico', 10);
  
  try {
    // Verificar conexión
    if (!await isOnline()) {
      isSyncing = false;
      updateSyncStatus('sin-conexion', 0);
      return { 
        success: false, 
        message: 'No hay conexión a internet'
      };
    }
    
    // Obtener sucursal actual
    const sucursalActual = await getCurrentSucursal();
    if (!sucursalActual) {
      isSyncing = false;
      return { success: false, message: 'No se pudo determinar la sucursal actual' };
    }
    
    // Recopilar solo los cambios de la entidad especificada
    let changes = [];
    
    switch (entityType) {
      case 'ventas':
        const ventas = await getVentasPendientes(entityIds);
        changes = ventas.map(v => ({
          entity: 'ventas',
          action: 'create',
          data: v,
          id: v.id,
          timestamp: v.fecha_creacion
        }));
        break;
        
      case 'productos':
        const stockUpdates = await getStockUpdates(entityIds);
        changes = stockUpdates.map(s => ({
          entity: 'productos_stock',
          action: 'update',
          data: s,
          id: s.producto_id,
          timestamp: s.fecha_actualizacion
        }));
        break;
        
      case 'clientes':
        const clientes = await getClientesUpdates(entityIds);
        changes = clientes.map(c => ({
          entity: 'clientes',
          action: c.is_new ? 'create' : 'update',
          data: c,
          id: c.id,
          timestamp: c.fecha_actualizacion
        }));
        break;
        
      // Añadir otros tipos según sea necesario
    }
    
    updateSyncStatus('enviando-especifico', 40);
    
    // Enviar cambios al servidor
    const result = await sendChangesToServer(changes, sucursalActual.id);
    
    // Actualizar estado de sincronización
    updateSyncStatus(result.success ? 'completado-especifico' : 'error-especifico', result.success ? 100 : 0);
    
    isSyncing = false;
    return result;
    
  } catch (error) {
    logError(`Error al sincronizar entidad ${entityType}`, error);
    updateSyncStatus('error-especifico', 0);
    isSyncing = false;
    return { 
      success: false, 
      message: `Error al sincronizar ${entityType}: ${error.message}` 
    };
  }
}

/**
 * Agrega un listener para eventos de sincronización
 * @param {Function} callback - Función a llamar cuando cambie el estado
 * @returns {Function} - Función para remover el listener
 */
export function addSyncStatusListener(callback) {
  if (typeof callback !== 'function') return () => {};
  
  const handler = (event) => {
    callback(event.detail);
  };
  
  window.addEventListener('sync-status-update', handler);
  
  // Devolver función para remover el listener
  return () => {
    window.removeEventListener('sync-status-update', handler);
  };
}

/**
 * Obtiene el estado de conectividad actual
 * @returns {Promise<boolean>} - True si está online
 */
export async function checkOnlineStatus() {
  return isOnline();
}

/**
 * Sincroniza datos específicos de otra sucursal
 * @param {number} sucursalId - ID de la sucursal a sincronizar
 * @param {string} entityType - Tipo de entidad a sincronizar (opcional)
 * @returns {Promise<Object>} - Resultado de la sincronización
 */
export async function syncFromSpecificBranch(sucursalId, entityType = null) {
  if (isSyncing) {
    return { success: false, message: 'Ya existe un proceso de sincronización en curso' };
  }
  
  isSyncing = true;
  updateSyncStatus('sincronizando-sucursal', 10);
  
  try {
    // Verificar conexión
    if (!await isOnline()) {
      isSyncing = false;
      updateSyncStatus('sin-conexion', 0);
      return { 
        success: false, 
        message: 'No hay conexión a internet'
      };
    }
    
    // Verificar que la sucursal existe
    const sucursales = await getAllSucursales();
    const sucursal = sucursales.find(s => s.id === sucursalId);
    
    if (!sucursal) {
      isSyncing = false;
      return { success: false, message: 'La sucursal especificada no existe' };
    }
    
    updateSyncStatus('solicitando-datos', 30);
    
    // URL del endpoint del servidor
    const apiUrl = window.electron.getServerUrl() + '/api/sync/branch-data';
    
    // Parámetros para la solicitud
    const params = new URLSearchParams({
      fromSucursalId: sucursalId,
      toSucursalId: (await getCurrentSucursal()).id
    });
    
    if (entityType) {
      params.append('entityType', entityType);
    }
    
    // Realizar solicitud al servidor
    const response = await fetch(`${apiUrl}?${params.toString()}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${await window.electron.getAuthToken()}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`Error HTTP: ${response.status}`);
    }
    
    const result = await response.json();
    
    updateSyncStatus('aplicando-datos-sucursal', 70);
    
    // Aplicar datos recibidos
    if (result.success && result.data) {
      await applyServerChangesLocally(result.data);
      
      // Registrar sincronización específica de sucursal
      logEvent(SYNC_EVENT, `Sincronización desde sucursal ${sucursal.nombre} completada`, {
        sucursalId,
        entityType,
        itemsCount: result.data.length
      });
    }
    
    updateSyncStatus('completado-sucursal', 100);
    isSyncing = false;
    
    return {
      success: true,
      message: `Sincronización con sucursal ${sucursal.nombre} completada`,
      itemsCount: result.data ? result.data.length : 0,
      timestamp: new Date()
    };
    
  } catch (error) {
    logError(`Error al sincronizar con sucursal ${sucursalId}`, error);
    updateSyncStatus('error-sucursal', 0);
    isSyncing = false;
    return { 
      success: false, 
      message: `Error al sincronizar con sucursal: ${error.message}` 
    };
  }
}

/**
 * Solicita una sincronización completa (desde cero)
 * @returns {Promise<Object>} - Resultado de la operación
 */
export async function requestFullSync() {
  if (isSyncing) {
    return { success: false, message: 'Ya existe un proceso de sincronización en curso' };
  }
  
  isSyncing = true;
  updateSyncStatus('inicializando-completa', 5);
  
  try {
    // Verificar conexión
    if (!await isOnline()) {
      isSyncing = false;
      updateSyncStatus('sin-conexion', 0);
      return { 
        success: false, 
        message: 'No hay conexión a internet'
      };
    }
    
    updateSyncStatus('solicitando-completa', 15);
    
    // URL del endpoint para sincronización completa
    const apiUrl = window.electron.getServerUrl() + '/api/sync/full-sync';
    
    // Obtener sucursal actual
    const sucursalActual = await getCurrentSucursal();
    
    // Realizar solicitud al servidor
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${await window.electron.getAuthToken()}`
      },
      body: JSON.stringify({
        sucursalId: sucursalActual.id,
        timestamp: new Date().toISOString(),
        requestType: 'full'
      })
    });
    
    if (!response.ok) {
      throw new Error(`Error HTTP: ${response.status}`);
    }
    
    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.message || 'Error en la solicitud de sincronización completa');
    }
    
    updateSyncStatus('recibiendo-datos-completos', 30);
    
    // Procesar lotes de datos recibidos (esto podría ser un proceso en múltiples fases)
    for (let i = 0; i < result.batches; i++) {
      const progress = 30 + Math.floor((i / result.batches) * 60);
      updateSyncStatus(`procesando-lote-${i+1}`, progress);
      
      // Obtener lote de datos
      const batchUrl = window.electron.getServerUrl() + `/api/sync/full-sync-batch/${result.syncId}/${i}`;
      const batchResponse = await fetch(batchUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${await window.electron.getAuthToken()}`
        }
      });
      
      if (!batchResponse.ok) {
        throw new Error(`Error al obtener lote ${i+1}: ${batchResponse.status}`);
      }
      
      const batchData = await batchResponse.json();
      
      // Aplicar datos del lote
      if (batchData.data && batchData.data.length > 0) {
        await applyServerChangesLocally(batchData.data);
      }
    }
    
    // Actualizar fecha de última sincronización
    const db = await getDatabase();
    await db.put('last_sync_date', new Date().toISOString());
    
    // Programar próxima sincronización
    scheduleSyncProcess(syncConfig.syncInterval);
    
    updateSyncStatus('completado-completa', 100);
    isSyncing = false;
    
    return {
      success: true,
      message: 'Sincronización completa finalizada correctamente',
      timestamp: new Date()
    };
    
  } catch (error) {
    logError('Error en sincronización completa', error);
    updateSyncStatus('error-completa', 0);
    isSyncing = false;
    return { 
      success: false, 
      message: `Error en sincronización completa: ${error.message}` 
    };
  }
}

/**
 * Envía datos locales al servidor sin esperar respuesta (útil en caso de cierre de app)
 * @returns {Promise<boolean>} - Resultado de la operación
 */
export async function pushLocalChangesBeforeExit() {
  try {
    // Si no hay conexión, no intentar enviar
    if (!await isOnline()) {
      return false;
    }
    
    // Recopilar cambios pendientes
    const pendingChanges = await collectPendingChanges();
    if (!pendingChanges || pendingChanges.length === 0) {
      return true; // No hay cambios que enviar
    }
    
    // Obtener sucursal actual
    const sucursalActual = await getCurrentSucursal();
    if (!sucursalActual) {
      return false;
    }
    
    // Intentar enviar cambios
    const result = await sendChangesToServer(pendingChanges, sucursalActual.id);
    
    // Registrar resultado
    logEvent(SYNC_EVENT, `Envío de cambios antes de salir: ${result.success ? 'Exitoso' : 'Fallido'}`, {
      itemsCount: pendingChanges.length,
      success: result.success
    });
    
    return result.success;
    
  } catch (error) {
    logError('Error al enviar cambios antes de salir', error);
    return false;
  }
}

/**
 * Verifica el estado de la sincronización con el servidor
 * @returns {Promise<Object>} - Estado de sincronización del servidor
 */
export async function checkServerSyncStatus() {
  try {
    // Verificar conexión
    if (!await isOnline()) {
      return { 
        online: false, 
        message: 'No hay conexión a internet'
      };
    }
    
    // URL del endpoint
    const apiUrl = window.electron.getServerUrl() + '/api/sync/status';
    
    // Realizar solicitud al servidor
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${await window.electron.getAuthToken()}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`Error HTTP: ${response.status}`);
    }
    
    const result = await response.json();
    
    return {
      online: true,
      serverTime: result.serverTime,
      activeConnections: result.activeConnections,
      lastSyncJobs: result.lastSyncJobs,
      status: result.status
    };
    
  } catch (error) {
    logError('Error al verificar estado del servidor de sincronización', error);
    return { 
      online: false,
      error: error.message,
      message: 'Error al comunicarse con el servidor'
    };
  }
}

/**
 * Obtiene historial de sincronizaciones para mostrar en reportes
 * @param {Object} options - Opciones de filtrado
 * @returns {Promise<Array>} - Historial de sincronizaciones
 */
export async function getSyncHistory(options = {}) {
  try {
    const db = await getDatabase();
    
    // Construir consulta según opciones
    const query = {
      sort: [{ field: 'timestamp', direction: 'desc' }],
      limit: options.limit || 100
    };
    
    if (options.startDate && options.endDate) {
      query.where = [
        { field: 'timestamp', operator: '>=', value: options.startDate },
        { field: 'timestamp', operator: '<=', value: options.endDate }
      ];
    }
    
    if (options.status) {
      if (!query.where) query.where = [];
      query.where.push({ field: 'success', operator: '==', value: options.status === 'success' });
    }
    
    // Obtener registros
    const syncLogs = await db.getAll('sync_logs', query);
    
    return syncLogs;
    
  } catch (error) {
    logError('Error al obtener historial de sincronizaciones', error);
    return [];
  }
}

/**
 * Resolver conflictos de sincronización manualmente
 * @param {Array} conflicts - Lista de conflictos a resolver
 * @param {string} resolution - Estrategia de resolución: 'local' o 'server'
 * @returns {Promise<Object>} - Resultado de la resolución
 */
export async function resolveConflictsManually(conflicts, resolution) {
  try {
    // Validar parámetros
    if (!conflicts || !Array.isArray(conflicts) || conflicts.length === 0) {
      return { success: false, message: 'No se proporcionaron conflictos para resolver' };
    }
    
    if (!['local', 'server'].includes(resolution)) {
      return { success: false, message: 'Estrategia de resolución no válida' };
    }
    
    // Procesar cada conflicto
    for (const conflict of conflicts) {
      // Determinar qué versión usar
      const versionToUse = resolution === 'local' ? conflict.localData : conflict.serverData;
      
      // Aplicar la versión seleccionada
      await handleConflict(conflict.entity, conflict.id, versionToUse, resolution);
      
      // Registrar la resolución
      logEvent(SYNC_EVENT, `Conflicto resuelto manualmente: ${conflict.entity} #${conflict.id}`, {
        resolution,
        entity: conflict.entity,
        entityId: conflict.id
      });
    }
    
    return {
      success: true,
      message: `${conflicts.length} conflictos resueltos correctamente`,
      resolvedCount: conflicts.length
    };
    
  } catch (error) {
    logError('Error al resolver conflictos manualmente', error);
    return { 
      success: false, 
      message: `Error al resolver conflictos: ${error.message}` 
    };
  }
}

/**
 * Sincroniza las configuraciones del sistema entre sucursales
 * @returns {Promise<Object>} - Resultado de la sincronización
 */
export async function syncSystemSettings() {
  try {
    if (!await isOnline()) {
      return { success: false, message: 'No hay conexión a internet' };
    }
    
    // URL del endpoint
    const apiUrl = window.electron.getServerUrl() + '/api/sync/settings';
    
    // Obtener sucursal actual
    const sucursalActual = await getCurrentSucursal();
    
    // Realizar solicitud al servidor
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${await window.electron.getAuthToken()}`
      },
      params: {
        sucursalId: sucursalActual.id
      }
    });
    
    if (!response.ok) {
      throw new Error(`Error HTTP: ${response.status}`);
    }
    
    const result = await response.json();
    
    if (result.success && result.settings) {
      // Guardar configuraciones en la base de datos local
      const db = await getDatabase();
      
      for (const [key, value] of Object.entries(result.settings)) {
        await db.put('system_settings', value, key);
      }
      
      return {
        success: true,
        message: 'Configuraciones sincronizadas correctamente',
        settingsCount: Object.keys(result.settings).length
      };
    } else {
      return {
        success: false,
        message: result.message || 'No se recibieron configuraciones'
      };
    }
    
  } catch (error) {
    logError('Error al sincronizar configuraciones del sistema', error);
    return { 
      success: false, 
      message: `Error al sincronizar configuraciones: ${error.message}` 
    };
  }
}

/**
 * Verifica si una sucursal específica está online
 * @param {number} sucursalId - ID de la sucursal a verificar
 * @returns {Promise<Object>} - Estado de la sucursal
 */
export async function checkBranchOnlineStatus(sucursalId) {
  try {
    // Verificar conexión
    if (!await isOnline()) {
      return { 
        online: false, 
        message: 'No hay conexión a internet'
      };
    }
    
    // URL del endpoint
    const apiUrl = window.electron.getServerUrl() + '/api/sync/branch-status';
    
    // Realizar solicitud al servidor
    const response = await fetch(`${apiUrl}?sucursalId=${sucursalId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${await window.electron.getAuthToken()}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`Error HTTP: ${response.status}`);
    }
    
    return await response.json();
    
  } catch (error) {
    logError(`Error al verificar estado de sucursal ${sucursalId}`, error);
    return { 
      online: false,
      error: error.message,
      message: 'Error al comunicarse con el servidor'
    };
  }
}

/**
 * Sincroniza solo los productos críticos (bajo stock, nuevos, etc)
 * @returns {Promise<Object>} - Resultado de la sincronización
 */
export async function syncCriticalProducts() {
  try {
    if (isSyncing) {
      return { success: false, message: 'Ya existe un proceso de sincronización en curso' };
    }
    
    isSyncing = true;
    updateSyncStatus('sincronizando-productos-criticos', 10);
    
    if (!await isOnline()) {
      isSyncing = false;
      updateSyncStatus('sin-conexion', 0);
      return { success: false, message: 'No hay conexión a internet' };
    }
    
    // URL del endpoint
    const apiUrl = window.electron.getServerUrl() + '/api/sync/critical-products';
    
    // Obtener sucursal actual
    const sucursalActual = await getCurrentSucursal();
    
    // Realizar solicitud al servidor
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${await window.electron.getAuthToken()}`
      },
      params: {
        sucursalId: sucursalActual.id
      }
    });
    
    if (!response.ok) {
      throw new Error(`Error HTTP: ${response.status}`);
    }
    
    const result = await response.json();
    
    updateSyncStatus('aplicando-productos-criticos', 60);
    
    if (result.success && result.products) {
      // Aplicar actualizaciones de productos
      await applyServerChangesLocally(result.products.map(p => ({
        entity: 'productos',
        action: 'update',
        data: p,
        id: p.id
      })));
      
      updateSyncStatus('completado-productos-criticos', 100);
      isSyncing = false;
      
      return {
        success: true,
        message: 'Productos críticos sincronizados correctamente',
        count: result.products.length
      };
    } else {
      updateSyncStatus('error-productos-criticos', 0);
      isSyncing = false;
      
      return {
        success: false,
        message: result.message || 'No se recibieron productos críticos'
      };
    }
    
  } catch (error) {
    logError('Error al sincronizar productos críticos', error);
    updateSyncStatus('error-productos-criticos', 0);
    isSyncing = false;
    
    return { 
      success: false, 
      message: `Error al sincronizar productos críticos: ${error.message}` 
    };
  }
}

/**
 * Exporta funciones y variables del módulo
 */
export default {
  initSyncModule,
  synchronizeAll,
  forceSyncNow,
  getSyncStatus,
  updateSyncConfig,
  getSyncConfig,
  getSyncStats,
  resetSyncState,
  syncSpecificEntities,
  addSyncStatusListener,
  checkOnlineStatus,
  syncFromSpecificBranch,
  requestFullSync,
  pushLocalChangesBeforeExit,
  checkServerSyncStatus,
  getSyncHistory,
  resolveConflictsManually,
  syncSystemSettings,
  checkBranchOnlineStatus,
  syncCriticalProducts,
  hasPendingChanges
};
