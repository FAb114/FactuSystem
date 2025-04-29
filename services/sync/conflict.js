/**
 * @file conflict.js
 * @description Sistema de resolución de conflictos para sincronización entre sucursales
 * 
 * Este módulo maneja la resolución de conflictos que pueden ocurrir cuando múltiples
 * sucursales modifican los mismos datos en modo offline y luego sincronizan.
 * Implementa estrategias de resolución automática y asistida por el usuario.
 */

const path = require('path');
const { ipcRenderer } = require('electron');
const logger = require('../../services/audit/logger.js');
const db = require('../../app/assets/js/utils/database.js');
const offlineSync = require('./offline.js');
const { getAppConfig } = require('../../app/assets/js/utils/config.js');

/**
 * Tipos de conflictos que pueden ocurrir durante la sincronización
 */
const CONFLICT_TYPES = {
  DATA_CONFLICT: 'DATA_CONFLICT',           // Datos modificados en ambas ubicaciones
  DELETE_CONFLICT: 'DELETE_CONFLICT',       // Eliminado en una ubicación pero modificado en otra
  RELATIONSHIP_CONFLICT: 'RELATIONSHIP_CONFLICT', // Conflictos en relaciones entre entidades
  VERSION_CONFLICT: 'VERSION_CONFLICT',     // Conflicto de versiones de registros
  SCHEMA_CONFLICT: 'SCHEMA_CONFLICT'        // Conflicto en el esquema de la base de datos
};

/**
 * Estrategias de resolución de conflictos
 */
const RESOLUTION_STRATEGIES = {
  SERVER_WINS: 'SERVER_WINS',               // La versión del servidor tiene prioridad
  CLIENT_WINS: 'CLIENT_WINS',               // La versión local tiene prioridad
  NEWEST_WINS: 'NEWEST_WINS',               // La versión más reciente gana
  MANUAL_RESOLUTION: 'MANUAL_RESOLUTION',   // Resolución manual por el usuario
  MERGE: 'MERGE'                           // Intentar combinar ambas versiones
};

/**
 * Estado global del sistema de resolución de conflictos
 */
let conflictResolutionState = {
  pendingConflicts: [],
  defaultStrategy: RESOLUTION_STRATEGIES.NEWEST_WINS,
  isResolving: false,
  onResolutionComplete: null,
  userPreferences: {}
};

/**
 * Carga las preferencias de resolución de conflictos del usuario desde la configuración
 * @returns {Promise<Object>} Objeto con las preferencias del usuario
 */
async function loadUserPreferences() {
  try {
    const config = await getAppConfig();
    if (config && config.sync && config.sync.conflictResolution) {
      conflictResolutionState.userPreferences = config.sync.conflictResolution;
      conflictResolutionState.defaultStrategy = config.sync.conflictResolution.defaultStrategy || 
                                               RESOLUTION_STRATEGIES.NEWEST_WINS;
    }
    return conflictResolutionState.userPreferences;
  } catch (error) {
    logger.error('Error al cargar preferencias de resolución de conflictos', error);
    return {};
  }
}

/**
 * Detecta conflictos entre datos locales y del servidor
 * @param {Object} localData Datos de la base de datos local
 * @param {Object} serverData Datos recibidos del servidor
 * @param {String} entityType Tipo de entidad (producto, cliente, etc.)
 * @returns {Array} Lista de conflictos detectados
 */
async function detectConflicts(localData, serverData, entityType) {
  const conflicts = [];
  
  if (!localData || !serverData) {
    logger.warn(`detectConflicts: Datos incompletos para ${entityType}`);
    return conflicts;
  }

  // Mapear los datos por ID para facilitar la comparación
  const serverMap = new Map();
  serverData.forEach(item => serverMap.set(item.id, item));
  
  // Buscar conflictos en los datos locales vs servidor
  for (const localItem of localData) {
    const serverItem = serverMap.get(localItem.id);
    
    // Si el item existe en ambos lados, verificar si hay conflicto
    if (serverItem) {
      const conflict = compareItems(localItem, serverItem, entityType);
      if (conflict) {
        conflicts.push(conflict);
      }
      
      // Quitar del mapa de servidor para identificar luego los que solo existen en el servidor
      serverMap.delete(localItem.id);
    }
  }
  
  // Ahora, serverMap contiene solo los items que existen en el servidor pero no localmente
  // Verificar si alguno de estos ítems fue borrado localmente (esto requiere una tabla de seguimiento)
  const deletedItems = await getLocallyDeletedItems(entityType);
  const deletedIdsMap = new Map(deletedItems.map(item => [item.id, item]));
  
  for (const [id, serverItem] of serverMap.entries()) {
    if (deletedIdsMap.has(id)) {
      // Este item fue borrado localmente pero existe en el servidor
      conflicts.push({
        type: CONFLICT_TYPES.DELETE_CONFLICT,
        entityType,
        serverData: serverItem,
        localData: { id, _deleted: true },
        localDeleteInfo: deletedIdsMap.get(id)
      });
    }
  }
  
  logger.info(`detectConflicts: Encontrados ${conflicts.length} conflictos para ${entityType}`);
  return conflicts;
}

/**
 * Compara dos versiones del mismo ítem para detectar conflictos
 * @param {Object} localItem Versión local del ítem
 * @param {Object} serverItem Versión del servidor del ítem
 * @param {String} entityType Tipo de entidad
 * @returns {Object|null} Objeto de conflicto o null si no hay conflicto
 */
function compareItems(localItem, serverItem, entityType) {
  // Si las versiones o timestamps coinciden, no hay conflicto
  if (localItem.version === serverItem.version) {
    return null;
  }
  
  // Si el ítem no se ha modificado localmente desde la última sincronización
  if (localItem.lastSyncedVersion && localItem.lastSyncedVersion === localItem.version) {
    return null; // No ha habido cambios locales, se puede sobrescribir con la versión del servidor
  }
  
  // Si ambos tienen la misma fecha de modificación (improbable pero posible)
  if (localItem.updatedAt && serverItem.updatedAt && 
      new Date(localItem.updatedAt).getTime() === new Date(serverItem.updatedAt).getTime()) {
    return null; // Mismo timestamp, asumir que son idénticos
  }
  
  // Verificar si los campos clave han sido modificados
  const keyFields = getKeyFieldsForEntity(entityType);
  let hasKeyChanges = false;
  
  for (const field of keyFields) {
    if (JSON.stringify(localItem[field]) !== JSON.stringify(serverItem[field])) {
      hasKeyChanges = true;
      break;
    }
  }
  
  if (!hasKeyChanges) {
    return null; // No hay cambios en campos clave, se puede resolver automáticamente
  }

  // Hay un conflicto que requiere resolución
  return {
    type: CONFLICT_TYPES.DATA_CONFLICT,
    entityType,
    id: localItem.id,
    serverData: serverItem,
    localData: localItem,
    keyFieldsChanged: hasKeyChanges,
    serverTimestamp: new Date(serverItem.updatedAt || serverItem.createdAt),
    localTimestamp: new Date(localItem.updatedAt || localItem.createdAt)
  };
}

/**
 * Obtiene los campos clave para un tipo de entidad específico
 * @param {String} entityType Tipo de entidad
 * @returns {Array<String>} Lista de nombres de campos clave
 */
function getKeyFieldsForEntity(entityType) {
  const keyFieldsMap = {
    producto: ['nombre', 'precio', 'stock', 'codigoBarras'],
    cliente: ['nombre', 'documento', 'email', 'telefono'],
    proveedor: ['nombre', 'cuit', 'contactoPrincipal'],
    factura: ['numero', 'total', 'cliente_id', 'items', 'pagos'],
    usuario: ['nombre', 'email', 'rol_id'],
    caja: ['apertura', 'cierre', 'montoInicial', 'montoCierre'],
    sucursal: ['nombre', 'direccion', 'telefono'],
    // Agregar más entidades según sea necesario
  };
  
  return keyFieldsMap[entityType] || ['id', 'nombre'];
}

/**
 * Obtiene los ítems que fueron eliminados localmente
 * @param {String} entityType Tipo de entidad
 * @returns {Promise<Array>} Lista de ítems eliminados
 */
async function getLocallyDeletedItems(entityType) {
  try {
    const deletedItems = await db.query(`
      SELECT * FROM deleted_${entityType}s 
      WHERE syncedToServer = 0
    `);
    return deletedItems;
  } catch (error) {
    logger.error(`Error al obtener items eliminados de ${entityType}`, error);
    return [];
  }
}

/**
 * Resuelve conflictos detectados durante la sincronización
 * @param {Array} conflicts Lista de conflictos a resolver
 * @param {Function} onComplete Callback a ejecutar cuando se completa la resolución
 * @returns {Promise<Object>} Resultado de la resolución
 */
async function resolveConflicts(conflicts, onComplete) {
  if (conflictResolutionState.isResolving) {
    throw new Error('Ya hay un proceso de resolución de conflictos en curso');
  }
  
  // Si no hay conflictos, devolver inmediatamente
  if (!conflicts || conflicts.length === 0) {
    if (onComplete) onComplete({ resolved: 0, skipped: 0 });
    return { resolved: 0, skipped: 0 };
  }
  
  logger.info(`Iniciando resolución de ${conflicts.length} conflictos`);
  
  conflictResolutionState.pendingConflicts = [...conflicts];
  conflictResolutionState.isResolving = true;
  conflictResolutionState.onResolutionComplete = onComplete;
  
  // Cargar preferencias del usuario para la resolución
  await loadUserPreferences();
  
  // Separar los conflictos que se pueden resolver automáticamente de los que requieren intervención
  const { autoResolvable, manualRequired } = categorizeConflicts(conflicts);
  
  // Resolver los automáticos
  const autoResults = await resolveAutomaticConflicts(autoResolvable);
  
  // Si hay conflictos que requieren resolución manual, mostrar la interfaz
  if (manualRequired.length > 0) {
    showConflictResolutionUI(manualRequired);
    // El proceso continuará cuando el usuario termine la resolución manual
    return { 
      inProgress: true, 
      autoResolved: autoResults.resolved, 
      pendingManual: manualRequired.length 
    };
  } else {
    // No hay conflictos manuales, finalizar el proceso
    conflictResolutionState.isResolving = false;
    if (conflictResolutionState.onResolutionComplete) {
      conflictResolutionState.onResolutionComplete({
        resolved: autoResults.resolved,
        skipped: autoResults.skipped
      });
    }
    
    return {
      resolved: autoResults.resolved,
      skipped: autoResults.skipped,
      completed: true
    };
  }
}

/**
 * Categoriza los conflictos en automáticos y manuales
 * @param {Array} conflicts Lista de conflictos
 * @returns {Object} Objeto con listas de conflictos automáticos y manuales
 */
function categorizeConflicts(conflicts) {
  const autoResolvable = [];
  const manualRequired = [];
  
  conflicts.forEach(conflict => {
    // Determinar si este conflicto se puede resolver automáticamente
    const entityPreferences = conflictResolutionState.userPreferences[conflict.entityType] || {};
    const strategy = entityPreferences.strategy || conflictResolutionState.defaultStrategy;
    
    // Conflictos que siempre requieren resolución manual
    if (conflict.type === CONFLICT_TYPES.SCHEMA_CONFLICT) {
      manualRequired.push(conflict);
      return;
    }
    
    // Los conflictos de eliminación generalmente requieren intervención manual
    if (conflict.type === CONFLICT_TYPES.DELETE_CONFLICT && 
        strategy !== RESOLUTION_STRATEGIES.SERVER_WINS && 
        strategy !== RESOLUTION_STRATEGIES.CLIENT_WINS) {
      manualRequired.push(conflict);
      return;
    }
    
    // Si la estrategia es resolución manual, agregar a la lista manual
    if (strategy === RESOLUTION_STRATEGIES.MANUAL_RESOLUTION) {
      manualRequired.push(conflict);
      return;
    }
    
    // Para otros casos, se puede resolver automáticamente
    autoResolvable.push(conflict);
  });
  
  return { autoResolvable, manualRequired };
}

/**
 * Resuelve automáticamente los conflictos según las estrategias configuradas
 * @param {Array} conflicts Lista de conflictos a resolver automáticamente
 * @returns {Promise<Object>} Resultado de la resolución
 */
async function resolveAutomaticConflicts(conflicts) {
  let resolved = 0;
  let skipped = 0;
  
  for (const conflict of conflicts) {
    try {
      const entityPreferences = conflictResolutionState.userPreferences[conflict.entityType] || {};
      const strategy = entityPreferences.strategy || conflictResolutionState.defaultStrategy;
      
      let resolution;
      switch (strategy) {
        case RESOLUTION_STRATEGIES.SERVER_WINS:
          resolution = await applyServerVersion(conflict);
          break;
        case RESOLUTION_STRATEGIES.CLIENT_WINS:
          resolution = await applyLocalVersion(conflict);
          break;
        case RESOLUTION_STRATEGIES.NEWEST_WINS:
          resolution = await applyNewestVersion(conflict);
          break;
        case RESOLUTION_STRATEGIES.MERGE:
          resolution = await mergeVersions(conflict);
          break;
        default:
          // Estrategia no reconocida, saltarse este conflicto
          logger.warn(`Estrategia desconocida para resolución automática: ${strategy}`);
          skipped++;
          continue;
      }
      
      if (resolution && resolution.success) {
        resolved++;
        await logResolution(conflict, strategy, true);
      } else {
        skipped++;
        await logResolution(conflict, strategy, false, resolution?.error);
      }
    } catch (error) {
      logger.error(`Error al resolver conflicto automáticamente:`, error);
      skipped++;
    }
  }
  
  return { resolved, skipped };
}

/**
 * Aplica la versión del servidor para resolver un conflicto
 * @param {Object} conflict Conflicto a resolver
 * @returns {Promise<Object>} Resultado de la operación
 */
async function applyServerVersion(conflict) {
  try {
    const { entityType, serverData } = conflict;
    
    // Si es un conflicto de eliminación y se gana el servidor, eliminamos la marca de borrado local
    if (conflict.type === CONFLICT_TYPES.DELETE_CONFLICT) {
      await db.query(`DELETE FROM deleted_${entityType}s WHERE id = ?`, [serverData.id]);
    }
    
    // Actualizar el registro local con los datos del servidor
    await updateLocalEntity(entityType, serverData);
    
    // Actualizar el campo de última versión sincronizada
    await db.query(`
      UPDATE ${entityType}s 
      SET lastSyncedVersion = ?, syncStatus = 'synced' 
      WHERE id = ?
    `, [serverData.version, serverData.id]);
    
    return { success: true };
  } catch (error) {
    logger.error(`Error al aplicar versión del servidor:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Aplica la versión local para resolver un conflicto
 * @param {Object} conflict Conflicto a resolver
 * @returns {Promise<Object>} Resultado de la operación
 */
async function applyLocalVersion(conflict) {
  try {
    const { entityType, localData, serverData } = conflict;
    
    // Si es un conflicto de eliminación y gana el cliente, mantenemos la eliminación
    if (conflict.type === CONFLICT_TYPES.DELETE_CONFLICT) {
      // Marcar como sincronizado pero mantener la eliminación para que se propague al servidor
      await db.query(`
        UPDATE deleted_${entityType}s 
        SET syncStatus = 'pending', syncPriority = 'high' 
        WHERE id = ?
      `, [localData.id]);
      
      return { success: true };
    }
    
    // Para conflictos de datos, mantener la versión local pero actualizar para sincronizar después
    await db.query(`
      UPDATE ${entityType}s 
      SET syncStatus = 'pending', syncPriority = 'high', lastServerVersion = ? 
      WHERE id = ?
    `, [serverData.version, localData.id]);
    
    return { success: true };
  } catch (error) {
    logger.error(`Error al aplicar versión local:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Aplica la versión más reciente (por timestamp) para resolver un conflicto
 * @param {Object} conflict Conflicto a resolver
 * @returns {Promise<Object>} Resultado de la operación
 */
async function applyNewestVersion(conflict) {
  const { serverTimestamp, localTimestamp } = conflict;
  
  // Comparar timestamps para determinar qué versión es más reciente
  if (serverTimestamp > localTimestamp) {
    return applyServerVersion(conflict);
  } else {
    return applyLocalVersion(conflict);
  }
}

/**
 * Intenta combinar ambas versiones para resolver un conflicto
 * @param {Object} conflict Conflicto a resolver
 * @returns {Promise<Object>} Resultado de la operación
 */
async function mergeVersions(conflict) {
  try {
    const { entityType, localData, serverData } = conflict;
    
    // No se pueden fusionar conflictos de eliminación
    if (conflict.type === CONFLICT_TYPES.DELETE_CONFLICT) {
      // Por seguridad, damos preferencia al servidor en este caso
      return applyServerVersion(conflict);
    }
    
    // Crear una versión fusionada del objeto
    const mergedData = createMergedVersion(localData, serverData, entityType);
    
    // Actualizar la entidad local con la versión fusionada
    await updateLocalEntity(entityType, mergedData);
    
    // Marcar para sincronización con alta prioridad
    await db.query(`
      UPDATE ${entityType}s 
      SET syncStatus = 'pending', syncPriority = 'high', 
          lastSyncedVersion = ?, version = version + 1 
      WHERE id = ?
    `, [serverData.version, mergedData.id]);
    
    return { success: true };
  } catch (error) {
    logger.error(`Error al fusionar versiones:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Crea una versión fusionada tomando campos de ambas versiones
 * @param {Object} localData Datos locales
 * @param {Object} serverData Datos del servidor
 * @param {String} entityType Tipo de entidad
 * @returns {Object} Versión fusionada
 */
function createMergedVersion(localData, serverData, entityType) {
  // Obtener los campos que se deben preservar de cada versión
  const keyFields = getKeyFieldsForEntity(entityType);
  const mergeRules = getMergeRulesForEntity(entityType);
  
  // Crear un objeto base con todos los campos del servidor
  const mergedData = { ...serverData };
  
  // Aplicar las reglas de fusión
  for (const field in localData) {
    // Saltear campos especiales
    if (['id', 'createdAt', 'version'].includes(field)) continue;
    
    // Aplicar regla de fusión para este campo
    const rule = mergeRules[field] || 'newest';
    
    switch (rule) {
      case 'local_always':
        mergedData[field] = localData[field];
        break;
      case 'server_always':
        // Ya está en mergedData
        break;
      case 'sum':
        if (typeof localData[field] === 'number' && typeof serverData[field] === 'number') {
          mergedData[field] = localData[field] + serverData[field];
        }
        break;
      case 'max':
        if (typeof localData[field] === 'number' && typeof serverData[field] === 'number') {
          mergedData[field] = Math.max(localData[field], serverData[field]);
        }
        break;
      case 'min':
        if (typeof localData[field] === 'number' && typeof serverData[field] === 'number') {
          mergedData[field] = Math.min(localData[field], serverData[field]);
        }
        break;
      case 'concat_array':
        if (Array.isArray(localData[field]) && Array.isArray(serverData[field])) {
          const uniqueSet = new Set([...serverData[field], ...localData[field]]);
          mergedData[field] = [...uniqueSet];
        }
        break;
      case 'newest':
      default:
        // Si el campo local se modificó más recientemente, usarlo
        if (new Date(localData.updatedAt) > new Date(serverData.updatedAt)) {
          mergedData[field] = localData[field];
        }
        break;
    }
  }
  
  // Actualizar timestamp
  mergedData.updatedAt = new Date().toISOString();
  return mergedData;
}

/**
 * Obtiene las reglas de fusión para un tipo de entidad específico
 * @param {String} entityType Tipo de entidad
 * @returns {Object} Reglas de cómo fusionar cada campo
 */
function getMergeRulesForEntity(entityType) {
  const mergeRulesMap = {
    producto: {
      nombre: 'newest',        // Usar el más reciente
      descripcion: 'newest',
      precio: 'newest',
      stock: 'sum',            // Sumar ambos stocks
      categoria_id: 'newest',
      iva: 'newest',
      activo: 'newest',
      imagenes: 'concat_array' // Combinar arrays de imágenes
    },
    cliente: {
      nombre: 'newest',
      direccion: 'newest',
      telefono: 'newest',
      email: 'newest',
      cuit: 'newest',
      saldo: 'min',            // Usar el menor saldo (más conservador)
      categoria: 'newest',
      notas: 'newest'
    },
    proveedor: {
      nombre: 'newest',
      cuit: 'newest',
      direccion: 'newest',
      telefono: 'newest',
      email: 'newest',
      contactoPrincipal: 'newest',
      plazoCredito: 'newest'
    },
    factura: {
      // Las facturas generalmente no se deberían fusionar, pero por si acaso
      numero: 'server_always', // El número de factura debe ser único y controlado por el servidor
      cliente_id: 'newest',
      fecha: 'newest',
      total: 'newest',
      estado: 'newest',
      descuento: 'newest',
      usuario_id: 'local_always' // Mantener el usuario que generó la factura localmente
    },
    // Agregar más entidades según sea necesario
  };
  
  return mergeRulesMap[entityType] || {};
}

/**
 * Actualiza una entidad local con nuevos datos
 * @param {String} entityType Tipo de entidad
 * @param {Object} data Datos a actualizar
 * @returns {Promise<void>}
 */
async function updateLocalEntity(entityType, data) {
  const { id, ...updateData } = data;
  
  // Construir la consulta SQL
  let sql = `UPDATE ${entityType}s SET `;
  const params = [];
  
  // Agregar cada campo a la consulta
  Object.entries(updateData).forEach(([key, value], index) => {
    if (index > 0) sql += ', ';
    sql += `${key} = ?`;
    params.push(value);
  });
  
  sql += ` WHERE id = ?`;
  params.push(id);
  
  await db.query(sql, params);
}

/**
 * Registra la resolución de un conflicto en el log
 * @param {Object} conflict Conflicto resuelto
 * @param {String} strategy Estrategia utilizada
 * @param {Boolean} success Si la resolución fue exitosa
 * @param {String} errorMsg Mensaje de error si hubo alguno
 * @returns {Promise<void>}
 */
async function logResolution(conflict, strategy, success, errorMsg = null) {
  const logData = {
    entityType: conflict.entityType,
    entityId: conflict.localData?.id || conflict.serverData?.id,
    conflictType: conflict.type,
    resolutionStrategy: strategy,
    success,
    timestamp: new Date().toISOString()
  };
  
  if (!success && errorMsg) {
    logData.errorMessage = errorMsg;
  }
  
  // Registrar en el sistema de auditoría
  logger.info(`Resolución de conflicto: ${JSON.stringify(logData)}`);
  
  // Guardar en la tabla de historial de resoluciones
  try {
    await db.query(`
      INSERT INTO sync_conflict_resolutions
      (entity_type, entity_id, conflict_type, resolution_strategy, success, error_message, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      logData.entityType,
      logData.entityId,
      logData.conflictType,
      logData.resolutionStrategy,
      logData.success ? 1 : 0,
      errorMsg || null,
      logData.timestamp
    ]);
  } catch (error) {
    logger.error('Error al registrar resolución de conflicto en BD', error);
  }
}

/**
 * Muestra la interfaz de usuario para resolución manual de conflictos
 * @param {Array} conflicts Conflictos que requieren resolución manual
 */
function showConflictResolutionUI(conflicts) {
  // Enviar evento IPC para mostrar la interfaz de resolución en la ventana principal
  ipcRenderer.send('show-conflict-resolution-ui', {
    conflicts,
    entityTypes: conflicts.map(c => c.entityType).filter((v, i, a) => a.indexOf(v) === i),
    totalConflicts: conflicts.length
  });
  
  // Escuchar eventos de resolución manual
  ipcRenderer.once('manual-conflict-resolution-complete', (event, result) => {
    handleManualResolutionComplete(result);
  });
}

/**
 * Maneja la finalización de la resolución manual de conflictos
 * @param {Object} result Resultados de la resolución manual
 * @returns {Promise<void>}
 */
async function handleManualResolutionComplete(result) {
  try {
    logger.info(`Resolución manual completada: ${result.resolved} resueltos, ${result.skipped} omitidos`);
    
    // Procesar cada resolución manual
    for (const resolution of result.resolutions) {
      const conflict = conflictResolutionState.pendingConflicts.find(c => 
        c.id === resolution.conflictId && c.entityType === resolution.entityType
      );
      
      if (!conflict) continue;
      
      // Aplicar la resolución según la decisión del usuario
      let resolutionResult;
      switch (resolution.decision) {
        case 'use_server':
          resolutionResult = await applyServerVersion(conflict);
          break;
        case 'use_local':
          resolutionResult = await applyLocalVersion(conflict);
          break;
        case 'merge':
          resolutionResult = await mergeVersions(conflict);
          break;
        case 'custom':
          // La versión personalizada ya viene con los datos mezclados manualmente
          resolutionResult = await applyCustomVersion(conflict, resolution.customData);
          break;
        default:
          logger.warn(`Decisión de resolución desconocida: ${resolution.decision}`);
          continue;
      }
      
      await logResolution(
        conflict, 
        `MANUAL_${resolution.decision.toUpperCase()}`, 
        resolutionResult.success, 
        resolutionResult.error
      );
    }
  } catch (error) {
    logger.error('Error al procesar resoluciones manuales', error);
  } finally {
    // Finalizar el proceso de resolución
    conflictResolutionState.isResolving = false;
    if (conflictResolutionState.onResolutionComplete) {
      conflictResolutionState.onResolutionComplete({
        resolved: result.resolved,
        skipped: result.skipped,
        manual: true
      });
    }
    
    // Limpiar estado
    conflictResolutionState.pendingConflicts = [];
    conflictResolutionState.onResolutionComplete = null;
  }
}

/**
 * Aplica una versión personalizada (mezclada manualmente por el usuario)
 * @param {Object} conflict Conflicto original
 * @param {Object} customData Datos personalizados ingresados por el usuario
 * @returns {Promise<Object>} Resultado de la operación
 */
async function applyCustomVersion(conflict, customData) {
    try {
      const { entityType } = conflict;
      
      // Asegurarse de que los campos críticos estén presentes
      const validatedData = validateCustomData(customData, conflict);
      
      if (!validatedData) {
        throw new Error('Los datos personalizados no son válidos para esta entidad');
      }
      
      // Actualizar la entidad local con los datos personalizados
      await updateLocalEntity(entityType, validatedData);
      
      // Marcar para sincronización con alta prioridad
      await db.query(`
        UPDATE ${entityType}s 
        SET syncStatus = 'pending', syncPriority = 'high', 
            lastSyncedVersion = ?, version = version + 1 
        WHERE id = ?
      `, [conflict.serverData.version, validatedData.id]);
      
      return { success: true };
    } catch (error) {
      logger.error(`Error al aplicar versión personalizada:`, error);
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Valida los datos personalizados ingresados por el usuario
   * @param {Object} customData Datos personalizados
   * @param {Object} conflict Conflicto original para referencia
   * @returns {Object|null} Datos validados o null si no son válidos
   */
  function validateCustomData(customData, conflict) {
    const { entityType, localData, serverData } = conflict;
    
    // Validar que el ID coincida
    if (customData.id !== localData.id) {
      logger.error('Error de validación: ID no coincide');
      return null;
    }
    
    // Obtener schema para el tipo de entidad
    const schema = getEntitySchema(entityType);
    if (!schema) {
      logger.error(`No se encontró esquema para el tipo de entidad: ${entityType}`);
      return null;
    }
    
    // Validar campos requeridos
    for (const field of schema.requiredFields || []) {
      if (customData[field] === undefined || customData[field] === null) {
        logger.error(`Falta campo requerido: ${field}`);
        return null;
      }
    }
    
    // Validar tipos de datos
    for (const [field, value] of Object.entries(customData)) {
      const fieldType = schema.fields?.[field]?.type;
      if (!fieldType) continue; // Si no está en el esquema, lo dejamos pasar
      
      let isValid = true;
      switch (fieldType) {
        case 'number':
          isValid = typeof value === 'number';
          break;
        case 'string':
          isValid = typeof value === 'string';
          break;
        case 'boolean':
          isValid = typeof value === 'boolean';
          break;
        case 'array':
          isValid = Array.isArray(value);
          break;
        case 'date':
          isValid = value instanceof Date || 
                   (typeof value === 'string' && !isNaN(Date.parse(value)));
          break;
      }
      
      if (!isValid) {
        logger.error(`Tipo de dato inválido para el campo ${field}: se esperaba ${fieldType}`);
        return null;
      }
    }
    
    // Validar reglas de negocio específicas
    if (schema.validate && typeof schema.validate === 'function') {
      const validationResult = schema.validate(customData);
      if (!validationResult.isValid) {
        logger.error(`Validación de reglas de negocio fallida: ${validationResult.error}`);
        return null;
      }
    }
    
    // Conservar campos que no se deberían modificar manualmente
    for (const field of schema.systemFields || []) {
      customData[field] = serverData[field] || localData[field];
    }
    
    // Asegurar que los campos de tracking se actualizan correctamente
    customData.updatedAt = new Date().toISOString();
    
    return customData;
  }
  
  /**
   * Obtiene el esquema de una entidad específica
   * @param {String} entityType Tipo de entidad
   * @returns {Object|null} Esquema de la entidad o null si no existe
   */
  function getEntitySchema(entityType) {
    try {
      // Importar esquemas desde db/schema.js
      const schemaModule = require('../../db/schema.js');
      return schemaModule[entityType] || null;
    } catch (error) {
      logger.error(`Error al cargar esquema para ${entityType}:`, error);
      
      // Esquemas básicos de respaldo por si falla la carga
      const basicSchemas = {
        producto: {
          requiredFields: ['nombre', 'precio'],
          systemFields: ['createdAt', 'version'],
          fields: {
            nombre: { type: 'string' },
            precio: { type: 'number' },
            stock: { type: 'number' },
            descripcion: { type: 'string' },
            codigoBarras: { type: 'string' },
            activo: { type: 'boolean' }
          }
        },
        cliente: {
          requiredFields: ['nombre'],
          systemFields: ['createdAt', 'version'],
          fields: {
            nombre: { type: 'string' },
            documento: { type: 'string' },
            email: { type: 'string' },
            telefono: { type: 'string' }
          }
        },
        // Esquemas básicos para otras entidades
      };
      
      return basicSchemas[entityType] || null;
    }
  }
  
  /**
   * Guarda las preferencias del usuario para resolución de conflictos
   * @param {Object} preferences Preferencias de resolución
   * @returns {Promise<Boolean>} Éxito de la operación
   */
  async function saveUserPreferences(preferences) {
    try {
      // Validar las preferencias
      if (!preferences || typeof preferences !== 'object') {
        throw new Error('Preferencias inválidas');
      }
      
      // Asegurar que la estrategia predeterminada es válida
      if (preferences.defaultStrategy &&
          !Object.values(RESOLUTION_STRATEGIES).includes(preferences.defaultStrategy)) {
        throw new Error('Estrategia predeterminada inválida');
      }
      
      // Obtener configuración actual
      const config = await getAppConfig();
      
      // Actualizar sección de resolución de conflictos
      if (!config.sync) config.sync = {};
      config.sync.conflictResolution = preferences;
      
      // Guardar configuración actualizada
      const success = await saveAppConfig(config);
      
      if (success) {
        // Actualizar estado local
        conflictResolutionState.userPreferences = preferences;
        if (preferences.defaultStrategy) {
          conflictResolutionState.defaultStrategy = preferences.defaultStrategy;
        }
        
        logger.info('Preferencias de resolución de conflictos guardadas');
        return true;
      } else {
        throw new Error('No se pudo guardar la configuración');
      }
    } catch (error) {
      logger.error('Error al guardar preferencias de resolución de conflictos', error);
      return false;
    }
  }
  
  /**
   * Guarda la configuración de la aplicación
   * @param {Object} config Configuración completa
   * @returns {Promise<Boolean>} Éxito de la operación
   */
  async function saveAppConfig(config) {
    try {
      // Esta función debería implementarse en el módulo de configuración
      // Por ahora simulamos su comportamiento
      return new Promise((resolve) => {
        // Simulación de guardado asíncrono
        setTimeout(() => {
          try {
            // En una implementación real, esto escribiría en un archivo o BD
            resolve(true);
          } catch (error) {
            resolve(false);
          }
        }, 100);
      });
    } catch (error) {
      logger.error('Error al guardar configuración', error);
      return false;
    }
  }
  
  /**
   * Procesa un lote de resoluciones automáticas para mejorar rendimiento
   * @param {Array} conflicts Lote de conflictos a resolver
   * @param {String} strategy Estrategia a aplicar
   * @returns {Promise<Object>} Resultado del procesamiento
   */
  async function processBatchResolution(conflicts, strategy) {
    if (!conflicts || conflicts.length === 0) {
      return { resolved: 0, skipped: 0 };
    }
    
    // Agrupar por tipo de entidad para optimizar operaciones de BD
    const conflictsByEntity = {};
    conflicts.forEach(conflict => {
      const entityType = conflict.entityType;
      if (!conflictsByEntity[entityType]) {
        conflictsByEntity[entityType] = [];
      }
      conflictsByEntity[entityType].push(conflict);
    });
    
    let totalResolved = 0;
    let totalSkipped = 0;
    
    // Procesar cada grupo de entidades
    for (const [entityType, entityConflicts] of Object.entries(conflictsByEntity)) {
      try {
        let resolutionFunction;
        switch (strategy) {
          case RESOLUTION_STRATEGIES.SERVER_WINS:
            resolutionFunction = applyServerVersion;
            break;
          case RESOLUTION_STRATEGIES.CLIENT_WINS:
            resolutionFunction = applyLocalVersion;
            break;
          case RESOLUTION_STRATEGIES.NEWEST_WINS:
            resolutionFunction = applyNewestVersion;
            break;
          case RESOLUTION_STRATEGIES.MERGE:
            resolutionFunction = mergeVersions;
            break;
          default:
            logger.warn(`Estrategia desconocida para resolución por lotes: ${strategy}`);
            totalSkipped += entityConflicts.length;
            continue;
        }
        
        // Procesar conflictos en bloques para no bloquear la UI
        const batchSize = 20;
        for (let i = 0; i < entityConflicts.length; i += batchSize) {
          const batch = entityConflicts.slice(i, i + batchSize);
          
          // Procesamiento concurrente limitado
          const results = await Promise.allSettled(
            batch.map(conflict => resolutionFunction(conflict))
          );
          
          // Contabilizar resultados
          results.forEach((result, index) => {
            const conflict = batch[index];
            if (result.status === 'fulfilled' && result.value?.success) {
              totalResolved++;
              logResolution(conflict, strategy, true).catch(err => {
                logger.error('Error al registrar resolución exitosa', err);
              });
            } else {
              totalSkipped++;
              const errorMsg = result.reason?.message || 'Error desconocido';
              logResolution(conflict, strategy, false, errorMsg).catch(err => {
                logger.error('Error al registrar resolución fallida', err);
              });
            }
          });
          
          // Pequeña pausa para evitar bloquear el hilo principal
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      } catch (error) {
        logger.error(`Error al procesar lote de ${entityType}:`, error);
        totalSkipped += entityConflicts.length;
      }
    }
    
    return { resolved: totalResolved, skipped: totalSkipped };
  }
  
  /**
   * Obtiene estadísticas de conflictos resueltos
   * @param {Object} options Opciones de filtrado
   * @returns {Promise<Object>} Estadísticas de resolución
   */
  async function getConflictStats(options = {}) {
    try {
      const { startDate, endDate, entityType, limit = 100 } = options;
      
      // Construir consulta base
      let query = `
        SELECT 
          entity_type, 
          conflict_type, 
          resolution_strategy, 
          COUNT(*) as total_conflicts,
          SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful,
          SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed
        FROM sync_conflict_resolutions
        WHERE 1=1
      `;
      
      const params = [];
      
      // Agregar filtros
      if (startDate) {
        query += ` AND created_at >= ?`;
        params.push(new Date(startDate).toISOString());
      }
      
      if (endDate) {
        query += ` AND created_at <= ?`;
        params.push(new Date(endDate).toISOString());
      }
      
      if (entityType) {
        query += ` AND entity_type = ?`;
        params.push(entityType);
      }
      
      // Agrupar resultados
      query += `
        GROUP BY entity_type, conflict_type, resolution_strategy
        ORDER BY total_conflicts DESC
        LIMIT ?
      `;
      params.push(limit);
      
      // Ejecutar consulta
      const stats = await db.query(query, params);
      
      // Obtener totales globales
      const totalsQuery = `
        SELECT 
          COUNT(*) as total_conflicts,
          SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful,
          SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed
        FROM sync_conflict_resolutions
        WHERE 1=1
      `;
      
      const paramsTotal = [...params];
      paramsTotal.pop(); // Quitar el límite
      
      const [totals] = await db.query(totalsQuery, paramsTotal);
      
      // Obtener los conflictos más recientes
      const recentQuery = `
        SELECT 
          id, entity_type, entity_id, conflict_type, 
          resolution_strategy, success, error_message, created_at
        FROM sync_conflict_resolutions
        ORDER BY created_at DESC
        LIMIT 10
      `;
      
      const recentConflicts = await db.query(recentQuery);
      
      return {
        stats,
        totals,
        recentConflicts
      };
    } catch (error) {
      logger.error('Error al obtener estadísticas de conflictos', error);
      return {
        stats: [],
        totals: { total_conflicts: 0, successful: 0, failed: 0 },
        recentConflicts: []
      };
    }
  }
  
  /**
   * Registra problemas recurrentes de conflictos para análisis
   * @returns {Promise<Object>} Problemas recurrentes identificados
   */
  async function analyzeRecurringIssues() {
    try {
      // Buscar entidades con conflictos repetidos
      const repeatedConflictsQuery = `
        SELECT 
          entity_type, entity_id, COUNT(*) as conflict_count
        FROM sync_conflict_resolutions
        WHERE created_at >= datetime('now', '-30 days')
        GROUP BY entity_type, entity_id
        HAVING COUNT(*) > 3
        ORDER BY conflict_count DESC
        LIMIT 20
      `;
      
      const repeatedConflicts = await db.query(repeatedConflictsQuery);
      
      // Buscar tipos de conflictos más comunes
      const commonTypesQuery = `
        SELECT 
          conflict_type, COUNT(*) as count
        FROM sync_conflict_resolutions
        WHERE created_at >= datetime('now', '-30 days')
        GROUP BY conflict_type
        ORDER BY count DESC
      `;
      
      const commonTypes = await db.query(commonTypesQuery);
      
      // Buscar estrategias de resolución más exitosas
      const successfulStrategiesQuery = `
        SELECT 
          resolution_strategy, 
          COUNT(*) as total,
          SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful,
          ROUND(SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as success_rate
        FROM sync_conflict_resolutions
        WHERE created_at >= datetime('now', '-30 days')
        GROUP BY resolution_strategy
        HAVING total > 5
        ORDER BY success_rate DESC
      `;
      
      const successfulStrategies = await db.query(successfulStrategiesQuery);
      
      return {
        repeatedConflicts,
        commonTypes,
        successfulStrategies,
        analysisDate: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Error al analizar problemas recurrentes', error);
      return {
        repeatedConflicts: [],
        commonTypes: [],
        successfulStrategies: [],
        analysisDate: new Date().toISOString(),
        error: error.message
      };
    }
  }
  
  /**
   * Sincroniza las resoluciones de conflictos con el servidor central
   * para análisis global de la empresa
   * @returns {Promise<Boolean>} Éxito de la operación
   */
  async function syncConflictResolutionsToServer() {
    try {
      // Obtener resoluciones no sincronizadas
      const pendingResolutionsQuery = `
        SELECT * FROM sync_conflict_resolutions
        WHERE synced_to_server = 0
        LIMIT 500
      `;
      
      const pendingResolutions = await db.query(pendingResolutionsQuery);
      
      if (pendingResolutions.length === 0) {
        return true; // No hay nada para sincronizar
      }
      
      // Obtener información de la sucursal para incluirla en los datos
      const sucursalInfo = await getSucursalInfo();
      
      // Preparar datos para envío al servidor
      const dataToSync = pendingResolutions.map(resolution => ({
        ...resolution,
        sucursal_id: sucursalInfo.id,
        sucursal_nombre: sucursalInfo.nombre
      }));
      
      // Enviar al servidor
      const response = await offlineSync.sendToServer('/api/conflict-resolutions/batch', dataToSync);
      
      if (response && response.success) {
        // Marcar como sincronizados
        const ids = pendingResolutions.map(r => r.id).join(',');
        await db.query(`
          UPDATE sync_conflict_resolutions
          SET synced_to_server = 1, 
              sync_date = ?
          WHERE id IN (${ids})
        `, [new Date().toISOString()]);
        
        logger.info(`Sincronizadas ${pendingResolutions.length} resoluciones de conflictos al servidor`);
        return true;
      } else {
        throw new Error(response?.error || 'Error desconocido en la sincronización');
      }
    } catch (error) {
      logger.error('Error al sincronizar resoluciones de conflictos', error);
      return false;
    }
  }
  
  /**
   * Obtiene información de la sucursal actual
   * @returns {Promise<Object>} Información de la sucursal
   */
  async function getSucursalInfo() {
    try {
      const [sucursal] = await db.query(`
        SELECT id, nombre, codigo
        FROM sucursales
        WHERE activa = 1
        LIMIT 1
      `);
      
      return sucursal || { id: 1, nombre: 'Principal', codigo: 'SUC001' };
    } catch (error) {
      logger.error('Error al obtener información de sucursal', error);
      return { id: 1, nombre: 'Principal', codigo: 'SUC001' };
    }
  }
  
  // Exportar funciones y constantes del módulo
  module.exports = {
    // Constantes
    CONFLICT_TYPES,
    RESOLUTION_STRATEGIES,
    
    // Funciones principales
    detectConflicts,
    resolveConflicts,
    processBatchResolution,
    
    // Estrategias de resolución individuales
    applyServerVersion,
    applyLocalVersion,
    applyNewestVersion,
    mergeVersions,
    
    // Estadísticas y análisis
    getConflictStats,
    analyzeRecurringIssues,
    
    // Gestión de preferencias
    loadUserPreferences,
    saveUserPreferences,
    
    // Sincronización con servidor central
    syncConflictResolutionsToServer
  };