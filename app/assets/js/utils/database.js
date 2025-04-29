/**
 * database.js
 * Sistema de gestión de base de datos para FactuSystem
 * Maneja conexiones, migraciones, sincronización y operaciones CRUD
 */

const { ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');
const Datastore = require('nedb-promises');
const crypto = require('crypto');
const EventEmitter = require('events');

// Evento para notificar cambios en la base de datos
class DatabaseEvents extends EventEmitter {}
const dbEvents = new DatabaseEvents();

// Configuración de bases de datos
let dbConfig = {
  autocompactionInterval: 1000 * 60 * 60, // Compactación automática cada hora
  timestampData: true,
  sucursalId: null,
  userId: null,
  isOnline: false,
  dbPath: null,
  encryption: {
    enabled: false,
    key: null
  }
};

// Objeto para almacenar las instancias de las bases de datos
const databases = {};

// Colecciones de base de datos
const collections = [
  'facturas',
  'clientes',
  'productos',
  'compras',
  'caja',
  'proveedores',
  'usuarios',
  'roles',
  'stock',
  'pagos',
  'cuotas',
  'remitos',
  'notasCredito',
  'notasDebito',
  'configuracion',
  'auditoria',
  'sync',
  'sucursales',
  'fidelizacion'
];

/**
 * Inicializa la base de datos
 * @param {Object} config Configuración inicial
 * @returns {Promise} Promesa que resuelve cuando todas las bases de datos están inicializadas
 */
async function initializeDatabase(config = {}) {
  try {
    // Merge de configuración
    dbConfig = { ...dbConfig, ...config };
    
    // Verificar y crear directorio si no existe
    if (!dbConfig.dbPath) {
      const userDataPath = await ipcRenderer.invoke('get-user-data-path');
      dbConfig.dbPath = path.join(userDataPath, 'databases');
    }
    
    if (!fs.existsSync(dbConfig.dbPath)) {
      fs.mkdirSync(dbConfig.dbPath, { recursive: true });
    }
    
    // Inicializar bases de datos
    const initPromises = collections.map(collection => initCollection(collection));
    await Promise.all(initPromises);
    
    console.log('Base de datos inicializada correctamente');
    
    // Iniciar la compactación automática
    startAutoCompaction();
    
    return true;
  } catch (error) {
    console.error('Error al inicializar la base de datos:', error);
    throw error;
  }
}

/**
 * Inicializa una colección individual
 * @param {string} collectionName Nombre de la colección
 * @returns {Promise} Promesa que resuelve cuando la colección está inicializada
 */
async function initCollection(collectionName) {
  try {
    // Construir ruta específica de sucursal si está configurada
    let dbFilePath;
    if (dbConfig.sucursalId) {
      dbFilePath = path.join(dbConfig.dbPath, `${dbConfig.sucursalId}_${collectionName}.db`);
    } else {
      dbFilePath = path.join(dbConfig.dbPath, `${collectionName}.db`);
    }
    
    // Configuración de la base de datos
    const dbOptions = {
      filename: dbFilePath,
      autoload: true,
      timestampData: dbConfig.timestampData
    };
    
    // Crear o cargar la base de datos
    databases[collectionName] = Datastore.create(dbOptions);
    
    // Crear índices según la colección
    await createCollectionIndexes(collectionName);
    
    return databases[collectionName];
  } catch (error) {
    console.error(`Error al inicializar la colección ${collectionName}:`, error);
    throw error;
  }
}

/**
 * Crea los índices apropiados para cada colección
 * @param {string} collectionName Nombre de la colección
 * @returns {Promise} Promesa que resuelve cuando se han creado los índices
 */
async function createCollectionIndexes(collectionName) {
  try {
    const db = databases[collectionName];
    
    switch (collectionName) {
      case 'facturas':
        await db.ensureIndex({ fieldName: 'numeroFactura', unique: true });
        await db.ensureIndex({ fieldName: 'clienteId' });
        await db.ensureIndex({ fieldName: 'fecha' });
        await db.ensureIndex({ fieldName: 'usuarioId' });
        await db.ensureIndex({ fieldName: 'tipoComprobante' });
        break;
        
      case 'clientes':
        await db.ensureIndex({ fieldName: 'documento', unique: true });
        await db.ensureIndex({ fieldName: 'email' });
        await db.ensureIndex({ fieldName: 'telefono' });
        break;
        
      case 'productos':
        await db.ensureIndex({ fieldName: 'codigo', unique: true });
        await db.ensureIndex({ fieldName: 'codigoBarras' });
        await db.ensureIndex({ fieldName: 'nombre' });
        await db.ensureIndex({ fieldName: 'categoria' });
        break;
        
      case 'stock':
        await db.ensureIndex({ fieldName: 'productoId' });
        await db.ensureIndex({ fieldName: 'sucursalId' });
        break;
        
      case 'usuarios':
        await db.ensureIndex({ fieldName: 'username', unique: true });
        await db.ensureIndex({ fieldName: 'email', unique: true });
        await db.ensureIndex({ fieldName: 'rolId' });
        break;
        
      case 'caja':
        await db.ensureIndex({ fieldName: 'fecha' });
        await db.ensureIndex({ fieldName: 'usuarioId' });
        await db.ensureIndex({ fieldName: 'sucursalId' });
        break;
        
      case 'proveedores':
        await db.ensureIndex({ fieldName: 'cuit', unique: true });
        await db.ensureIndex({ fieldName: 'razonSocial' });
        break;
        
      case 'compras':
        await db.ensureIndex({ fieldName: 'numeroFactura' });
        await db.ensureIndex({ fieldName: 'proveedorId' });
        await db.ensureIndex({ fieldName: 'fecha' });
        break;
        
      case 'sync':
        await db.ensureIndex({ fieldName: 'timestamp' });
        await db.ensureIndex({ fieldName: 'coleccion' });
        await db.ensureIndex({ fieldName: 'operacion' });
        break;
        
      case 'auditoria':
        await db.ensureIndex({ fieldName: 'fecha' });
        await db.ensureIndex({ fieldName: 'usuarioId' });
        await db.ensureIndex({ fieldName: 'accion' });
        break;
        
      case 'fidelizacion':
        await db.ensureIndex({ fieldName: 'clienteId', unique: true });
        await db.ensureIndex({ fieldName: 'puntos' });
        break;
        
      default:
        // Índices comunes para las demás colecciones
        await db.ensureIndex({ fieldName: '_id' });
        break;
    }
    
  } catch (error) {
    console.error(`Error al crear índices para ${collectionName}:`, error);
    throw error;
  }
}

/**
 * Inicia el proceso de compactación automática
 */
function startAutoCompaction() {
  setInterval(() => {
    Object.keys(databases).forEach(collectionName => {
      databases[collectionName].persistence.compactDatafile();
    });
    console.log('Compactación automática de bases de datos completada');
  }, dbConfig.autocompactionInterval);
}

/**
 * Encripta datos sensibles
 * @param {*} data Datos a encriptar
 * @returns {string} Datos encriptados
 */
function encryptData(data) {
  if (!dbConfig.encryption.enabled || !dbConfig.encryption.key) {
    return data;
  }
  
  try {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(dbConfig.encryption.key), iv);
    
    let encrypted = cipher.update(JSON.stringify(data));
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    
    return {
      iv: iv.toString('hex'),
      encryptedData: encrypted.toString('hex')
    };
  } catch (error) {
    console.error('Error al encriptar datos:', error);
    return data;
  }
}

/**
 * Desencripta datos
 * @param {Object} encryptedData Objeto con datos encriptados
 * @returns {*} Datos desencriptados
 */
function decryptData(encryptedData) {
  if (!dbConfig.encryption.enabled || !dbConfig.encryption.key || !encryptedData.iv) {
    return encryptedData;
  }
  
  try {
    const iv = Buffer.from(encryptedData.iv, 'hex');
    const encryptedText = Buffer.from(encryptedData.encryptedData, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(dbConfig.encryption.key), iv);
    
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    return JSON.parse(decrypted.toString());
  } catch (error) {
    console.error('Error al desencriptar datos:', error);
    return encryptedData;
  }
}

/**
 * Registra operaciones en el log de sincronización
 * @param {string} collection Nombre de la colección
 * @param {string} operation Tipo de operación (insert, update, remove)
 * @param {string} documentId ID del documento afectado
 * @param {Object} [data] Datos relacionados con la operación
 */
async function logSyncOperation(collection, operation, documentId, data = null) {
  if (!dbConfig.isOnline || !databases.sync) return;
  
  try {
    const syncRecord = {
      coleccion: collection,
      operacion: operation,
      documentId: documentId,
      data: data,
      sucursalId: dbConfig.sucursalId,
      usuarioId: dbConfig.userId,
      timestamp: new Date(),
      sincronizado: false
    };
    
    await databases.sync.insert(syncRecord);
  } catch (error) {
    console.error('Error al registrar operación para sincronización:', error);
  }
}

/**
 * Registra eventos de auditoría
 * @param {string} accion Acción realizada
 * @param {string} coleccion Colección afectada
 * @param {string} documentId ID del documento (opcional)
 * @param {Object} detalles Detalles adicionales (opcional)
 */
async function registrarAuditoria(accion, coleccion, documentId = null, detalles = null) {
  if (!databases.auditoria) return;
  
  try {
    const registroAuditoria = {
      fecha: new Date(),
      usuarioId: dbConfig.userId,
      sucursalId: dbConfig.sucursalId,
      accion: accion,
      coleccion: coleccion,
      documentId: documentId,
      detalles: detalles
    };
    
    await databases.auditoria.insert(registroAuditoria);
  } catch (error) {
    console.error('Error al registrar auditoría:', error);
  }
}

/**
 * Inserta un documento en una colección
 * @param {string} collection Nombre de la colección
 * @param {Object} document Documento a insertar
 * @param {boolean} [audit=true] Indica si se debe auditar la operación
 * @returns {Promise<Object>} Documento insertado
 */
async function insert(collection, document, audit = true) {
  if (!databases[collection]) {
    throw new Error(`La colección ${collection} no existe`);
  }
  
  try {
    // Agregar metadatos
    const documentoConMeta = {
      ...document,
      _createdAt: new Date(),
      _sucursalId: dbConfig.sucursalId,
      _createdBy: dbConfig.userId
    };
    
    // Encriptar datos sensibles si es necesario
    if (needsEncryption(collection)) {
      documentoConMeta.data = encryptData(documentoConMeta.data || document);
    }
    
    // Insertar en la base de datos
    const insertedDoc = await databases[collection].insert(documentoConMeta);
    
    // Registrar para sincronización
    await logSyncOperation(collection, 'insert', insertedDoc._id, document);
    
    // Auditar si está habilitado
    if (audit) {
      await registrarAuditoria('insert', collection, insertedDoc._id);
    }
    
    // Emitir evento de cambio
    dbEvents.emit('change', {
      collection,
      operation: 'insert',
      documentId: insertedDoc._id,
      document: insertedDoc
    });
    
    return insertedDoc;
  } catch (error) {
    console.error(`Error al insertar en ${collection}:`, error);
    throw error;
  }
}

/**
 * Actualiza documentos en una colección
 * @param {string} collection Nombre de la colección
 * @param {Object} query Consulta para encontrar documentos
 * @param {Object} update Actualizaciones a aplicar
 * @param {Object} options Opciones de actualización
 * @param {boolean} [audit=true] Indica si se debe auditar la operación
 * @returns {Promise<number>} Número de documentos actualizados
 */
async function update(collection, query, update, options = {}, audit = true) {
  if (!databases[collection]) {
    throw new Error(`La colección ${collection} no existe`);
  }
  
  try {
    // Agregar metadatos de actualización
    if (!update.$set) update.$set = {};
    update.$set._updatedAt = new Date();
    update.$set._updatedBy = dbConfig.userId;
    
    // Si se necesita encriptar, primero obtenemos el documento
    if (needsEncryption(collection) && update.$set.data) {
      update.$set.data = encryptData(update.$set.data);
    }
    
    // Opción por defecto: multi = false (actualizar solo el primer documento que coincida)
    const updateOptions = { 
      multi: false, 
      returnUpdatedDocs: true,
      ...options 
    };
    
    // Obtener documentos antes de actualizar para el log de sincronización
    const docsBeforeUpdate = await databases[collection].find(query);
    
    // Actualizar documentos
    const numUpdated = await databases[collection].update(query, update, updateOptions);
    
    // Obtener documentos actualizados
    const updatedDocs = updateOptions.returnUpdatedDocs 
      ? (Array.isArray(updateOptions.returnUpdatedDocs) ? updateOptions.returnUpdatedDocs : [updateOptions.returnUpdatedDocs])
      : await databases[collection].find(query);
    
    // Registrar para sincronización y auditoría cada documento actualizado
    for (const doc of updatedDocs) {
      await logSyncOperation(collection, 'update', doc._id, doc);
      
      if (audit) {
        await registrarAuditoria('update', collection, doc._id, {
          query: query,
          changes: update
        });
      }
      
      // Emitir evento de cambio
      dbEvents.emit('change', {
        collection,
        operation: 'update',
        documentId: doc._id,
        document: doc
      });
    }
    
    return numUpdated;
  } catch (error) {
    console.error(`Error al actualizar en ${collection}:`, error);
    throw error;
  }
}

/**
 * Elimina documentos de una colección
 * @param {string} collection Nombre de la colección
 * @param {Object} query Consulta para encontrar documentos a eliminar
 * @param {Object} options Opciones de eliminación
 * @param {boolean} [audit=true] Indica si se debe auditar la operación
 * @returns {Promise<number>} Número de documentos eliminados
 */
async function remove(collection, query, options = {}, audit = true) {
  if (!databases[collection]) {
    throw new Error(`La colección ${collection} no existe`);
  }
  
  try {
    // Obtener documentos antes de eliminar para el log de sincronización
    const docsToRemove = await databases[collection].find(query);
    
    // Opción por defecto: multi = false (eliminar solo el primer documento que coincida)
    const removeOptions = { 
      multi: false,
      ...options 
    };
    
    // Eliminar documentos
    const numRemoved = await databases[collection].remove(query, removeOptions);
    
    // Registrar para sincronización y auditoría cada documento eliminado
    for (const doc of docsToRemove) {
      await logSyncOperation(collection, 'remove', doc._id);
      
      if (audit) {
        await registrarAuditoria('remove', collection, doc._id, {
          query: query
        });
      }
      
      // Emitir evento de cambio
      dbEvents.emit('change', {
        collection,
        operation: 'remove',
        documentId: doc._id,
        document: doc
      });
    }
    
    return numRemoved;
  } catch (error) {
    console.error(`Error al eliminar en ${collection}:`, error);
    throw error;
  }
}

/**
 * Busca documentos en una colección
 * @param {string} collection Nombre de la colección
 * @param {Object} query Consulta para encontrar documentos
 * @param {Object} projection Campos a incluir/excluir
 * @returns {Promise<Array>} Documentos encontrados
 */
async function find(collection, query = {}, projection = {}) {
  if (!databases[collection]) {
    throw new Error(`La colección ${collection} no existe`);
  }
  
  try {
    // Buscar documentos
    let documents = await databases[collection].find(query, projection);
    
    // Desencriptar datos si es necesario
    if (needsEncryption(collection)) {
      documents = documents.map(doc => {
        if (doc.data) {
          doc.data = decryptData(doc.data);
        }
        return doc;
      });
    }
    
    return documents;
  } catch (error) {
    console.error(`Error al buscar en ${collection}:`, error);
    throw error;
  }
}

/**
 * Busca un único documento en una colección
 * @param {string} collection Nombre de la colección
 * @param {Object} query Consulta para encontrar el documento
 * @param {Object} projection Campos a incluir/excluir
 * @returns {Promise<Object|null>} Documento encontrado o null
 */
async function findOne(collection, query = {}, projection = {}) {
  if (!databases[collection]) {
    throw new Error(`La colección ${collection} no existe`);
  }
  
  try {
    // Buscar documento
    let document = await databases[collection].findOne(query, projection);
    
    // Desencriptar datos si es necesario
    if (document && needsEncryption(collection) && document.data) {
      document.data = decryptData(document.data);
    }
    
    return document;
  } catch (error) {
    console.error(`Error al buscar un documento en ${collection}:`, error);
    throw error;
  }
}

/**
 * Encuentra un documento por ID
 * @param {string} collection Nombre de la colección
 * @param {string} id ID del documento
 * @returns {Promise<Object|null>} Documento encontrado o null
 */
async function findById(collection, id) {
  return findOne(collection, { _id: id });
}

/**
 * Cuenta documentos en una colección
 * @param {string} collection Nombre de la colección
 * @param {Object} query Consulta para contar documentos
 * @returns {Promise<number>} Número de documentos que coinciden
 */
async function count(collection, query = {}) {
  if (!databases[collection]) {
    throw new Error(`La colección ${collection} no existe`);
  }
  
  try {
    return await databases[collection].count(query);
  } catch (error) {
    console.error(`Error al contar documentos en ${collection}:`, error);
    throw error;
  }
}

/**
 * Busca documentos con paginación y ordenamiento
 * @param {string} collection Nombre de la colección
 * @param {Object} query Consulta para encontrar documentos
 * @param {Object} options Opciones de paginación y ordenamiento
 * @returns {Promise<Object>} Objeto con documentos y metadata de paginación
 */
async function findWithPagination(collection, query = {}, options = {}) {
  if (!databases[collection]) {
    throw new Error(`La colección ${collection} no existe`);
  }
  
  try {
    const {
      page = 1,
      limit = 20,
      sort = { _createdAt: -1 },
      projection = {}
    } = options;
    
    // Calcular skip para paginación
    const skip = (page - 1) * limit;
    
    // Contar total de documentos para la consulta
    const total = await databases[collection].count(query);
    
    // Obtener documentos paginados
    let cursor = databases[collection].find(query, projection);
    
    // Aplicar ordenamiento
    if (sort) {
      cursor = cursor.sort(sort);
    }
    
    // Aplicar paginación
    cursor = cursor.skip(skip).limit(limit);
    
    // Ejecutar consulta
    let documents = await cursor.exec();
    
    // Desencriptar datos si es necesario
    if (needsEncryption(collection)) {
      documents = documents.map(doc => {
        if (doc.data) {
          doc.data = decryptData(doc.data);
        }
        return doc;
      });
    }
    
    // Calcular metadata de paginación
    const totalPages = Math.ceil(total / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;
    
    return {
      docs: documents,
      pagination: {
        total,
        limit,
        page,
        pages: totalPages,
        hasNextPage,
        hasPrevPage
      }
    };
  } catch (error) {
    console.error(`Error al buscar con paginación en ${collection}:`, error);
    throw error;
  }
}

/**
 * Realiza una búsqueda avanzada con diferentes criterios
 * @param {string} collection Nombre de la colección
 * @param {Object} criteria Criterios de búsqueda
 * @returns {Promise<Array>} Documentos encontrados
 */
async function advancedSearch(collection, criteria) {
  if (!databases[collection]) {
    throw new Error(`La colección ${collection} no existe`);
  }
  
  try {
    const {
      texto,
      fechaDesde,
      fechaHasta,
      campos = [],
      categorias = [],
      estados = [],
      sucursales = [],
      orderBy,
      orderDirection = 'desc',
      limit = 100
    } = criteria;
    
    // Construir consulta
    let query = {};
    
    // Búsqueda por texto en múltiples campos
    if (texto && campos.length > 0) {
      const regexSearch = new RegExp(texto, 'i');
      query.$or = campos.map(campo => ({ [campo]: regexSearch }));
    }
    
    // Filtro por fecha
    if (fechaDesde || fechaHasta) {
      query.fecha = {};
      if (fechaDesde) query.fecha.$gte = new Date(fechaDesde);
      if (fechaHasta) query.fecha.$lte = new Date(fechaHasta);
    }
    
    // Filtro por categoría
    if (categorias.length > 0) {
      query.categoria = { $in: categorias };
    }
    
    // Filtro por estado
    if (estados.length > 0) {
      query.estado = { $in: estados };
    }
    
    // Filtro por sucursal
    if (sucursales.length > 0) {
      query._sucursalId = { $in: sucursales };
    }
    
    // Ordenamiento
    const sort = {};
    if (orderBy) {
      sort[orderBy] = orderDirection === 'asc' ? 1 : -1;
    }
    
    // Ejecutar consulta
    let documents = await databases[collection].find(query).sort(sort).limit(limit).exec();
    
    // Desencriptar datos si es necesario
    if (needsEncryption(collection)) {
      documents = documents.map(doc => {
        if (doc.data) {
          doc.data = decryptData(doc.data);
        }
        return doc;
      });
    }
    
    return documents;
  } catch (error) {
    console.error(`Error en búsqueda avanzada en ${collection}:`, error);
    throw error;
  }
}

/**
 * Determina si una colección necesita encriptación
 * @param {string} collection Nombre de la colección
 * @returns {boolean} True si la colección necesita encriptación
 */
function needsEncryption(collection) {
  if (!dbConfig.encryption.enabled) return false;
  
  // Lista de colecciones que necesitan encriptación
  const encryptedCollections = [
    'clientes',     // Datos personales sensibles
    'usuarios',     // Información de acceso
    'configuracion' // Claves API, tokens, etc.
  ];
  
  return encryptedCollections.includes(collection);
}

/**
 * Establece la configuración de encriptación
 * @param {Object} config Configuración de encriptación
 */
function setEncryptionConfig(config) {
  dbConfig.encryption = {
    ...dbConfig.encryption,
    ...config
  };
}

/**
 * Obtiene un backup de la base de datos actual
 * @param {Array} [collectionsList] Lista de colecciones a incluir en el backup
 * @returns {Promise<Object>} Objeto con los datos del backup
 */
async function getBackup(collectionsList = collections) {
  try {
    const backup = {};
    
    for (const collection of collectionsList) {
      if (databases[collection]) {
        backup[collection] = await databases[collection].find({});
      }
    }
    
    return {
      timestamp: new Date(),
      sucursalId: dbConfig.sucursalId,
      version: '1.0',
      data: backup
    };
  } catch (error) {
    console.error('Error al generar backup:', error);
    throw error;
  }
}

/**
 * Restaura un backup en la base de datos
 * @param {Object} backupData Datos del backup
 * @param {boolean} clearExisting Eliminar datos existentes antes de restaurar
 * @returns {Promise<boolean>} True si la restauración fue exitosa
 */
async function restoreBackup(backupData, clearExisting = false) {
  try {
    // Validar formato del backup
    if (!backupData.data || typeof backupData.data !== 'object') {
      throw new Error('Formato de backup inválido');
    }
    
    // Registrar auditoría de inicio de restauración
    await registrarAuditoria('inicioRestauracion', 'sistema', null, {
      timestamp: backupData.timestamp,
      sucursalId: backupData.sucursalId,
      version: backupData.version
    });
    
    // Procesar cada colección
    for (const [collection, data] of Object.entries(backupData.data)) {
      if (!databases[collection]) continue;
      
      // Limpiar datos existentes si se especificó
      if (clearExisting) {
        await databases[collection].remove({}, { multi: true });
      }
      
      // Insertar datos del backup
      for (const doc of data) {
        // Evitar duplicados por _id
        const existingDoc = await databases[collection].findOne({ _id: doc._id });
        
        if (existingDoc) {
          // Actualizar documento existente
          await databases[collection].update({ _id: doc._id }, { $set: doc });
        } else {
          // Insertar nuevo documento
          await databases[collection].insert(doc);
        }
      }
    }
    
    // Registrar auditoría de finalización
    await registrarAuditoria('finRestauracion', 'sistema', null, {
      exitoso: true,
      coleccionesRestauradas: Object.keys(backupData.data)
    });
    
    return true;
  } catch (error) {
    console.error('Error al restaurar backup:', error);
    
    // Registrar auditoría del error
    await registrarAuditoria('errorRestauracion', 'sistema', null, {
      error: error.message
    });
    
    throw error;
  }
}

/**
 * Compacta todas las bases de datos
 * @returns {Promise<boolean>} True si la compactación fue exitosa
 */
async function compactDatabases() {
  try {
    const compactPromises = Object.keys(databases).map(collection => {
      return new Promise((resolve, reject) => {
        databases[collection].persistence.compactDatafile((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });
    
    await Promise.all(compactPromises);
    console.log('Compactación manual de bases de datos completada');
    return true;
  } catch (error) {
    console.error('Error al compactar bases de datos:', error);
    throw error;
  }
}

/**
 * Cambia la sucursal activa
 * @param {string} sucursalId ID de la sucursal
 * @returns {Promise<boolean>} True si el cambio fue exitoso
 */
async function cambiarSucursal(sucursalId) {
    try {
      // Guardar ID de sucursal anterior
      const sucursalAnterior = dbConfig.sucursalId;
      
      // Actualizar configuración
      dbConfig.sucursalId = sucursalId;
      
      // Reinicializar todas las bases de datos con la nueva sucursal
      const initPromises = collections.map(collection => initCollection(collection));
      await Promise.all(initPromises);
      
      // Registrar en auditoría
      await registrarAuditoria('cambioSucursal', 'sistema', null, {
        sucursalAnterior,
        sucursalNueva: sucursalId
      });
      
      console.log(`Base de datos cambiada a sucursal: ${sucursalId}`);
      return true;
    } catch (error) {
      console.error('Error al cambiar de sucursal:', error);
      throw error;
    }
  }
  
  /**
   * Actualiza el estado online/offline
   * @param {boolean} isOnline Nuevo estado de conexión
   */
  function setOnlineStatus(isOnline) {
    dbConfig.isOnline = isOnline;
    
    // Emitir evento de cambio de estado
    dbEvents.emit('connectionChange', isOnline);
    
    console.log(`Estado de conexión cambiado a: ${isOnline ? 'Online' : 'Offline'}`);
  }
  
  /**
   * Busca registros pendientes de sincronización
   * @returns {Promise<Array>} Registros pendientes
   */
  async function getPendingSyncOperations() {
    if (!databases.sync) return [];
    
    try {
      return await databases.sync.find({ sincronizado: false }).sort({ timestamp: 1 }).exec();
    } catch (error) {
      console.error('Error al obtener operaciones pendientes de sincronización:', error);
      throw error;
    }
  }
  
  /**
   * Marca operaciones de sincronización como completadas
   * @param {Array} operationIds IDs de las operaciones
   * @returns {Promise<number>} Número de operaciones actualizadas
   */
  async function markSyncOperationsComplete(operationIds) {
    if (!databases.sync) return 0;
    
    try {
      return await databases.sync.update(
        { _id: { $in: operationIds } },
        { $set: { sincronizado: true, fechaSincronizacion: new Date() } },
        { multi: true }
      );
    } catch (error) {
      console.error('Error al marcar operaciones como sincronizadas:', error);
      throw error;
    }
  }
  
  /**
   * Realiza una transacción (operación ACID)
   * @param {Function} transactionFn Función que realiza la transacción
   * @returns {Promise<*>} Resultado de la transacción
   */
  async function transaction(transactionFn) {
    // Crear un punto de restauración antes de la transacción
    const backupBeforeTransaction = await getBackup();
    
    try {
      // Ejecutar la transacción
      const result = await transactionFn();
      
      // Si llegamos aquí, la transacción fue exitosa
      return result;
    } catch (error) {
      console.error('Error en transacción, restaurando estado anterior:', error);
      
      // Restaurar al estado anterior en caso de error
      await restoreBackup(backupBeforeTransaction, true);
      
      // Propagar el error
      throw error;
    }
  }
  
  /**
   * Cuenta documentos por intervalo de tiempo y agrupación
   * @param {string} collection Nombre de la colección
   * @param {Object} options Opciones de agrupación
   * @returns {Promise<Array>} Resultados agrupados
   */
  async function countByTimeInterval(collection, options) {
    if (!databases[collection]) {
      throw new Error(`La colección ${collection} no existe`);
    }
    
    const {
      startDate,
      endDate,
      interval = 'day', // day, week, month, year
      dateField = 'fecha',
      groupBy = null
    } = options;
    
    try {
      // Obtener todos los documentos en el rango de fechas
      const query = {};
      
      if (startDate || endDate) {
        query[dateField] = {};
        if (startDate) query[dateField].$gte = new Date(startDate);
        if (endDate) query[dateField].$lte = new Date(endDate);
      }
      
      const documents = await databases[collection].find(query);
      
      // Realizar agrupación manual (NeDB no tiene funciones de agregación)
      const result = {};
      
      documents.forEach(doc => {
        const date = doc[dateField] ? new Date(doc[dateField]) : new Date();
        let intervalKey;
        
        // Generar clave según el intervalo
        switch (interval) {
          case 'day':
            intervalKey = `${date.getFullYear()}-${(date.getMonth()+1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
            break;
          case 'week':
            // Obtener el primer día de la semana (domingo = 0)
            const firstDayOfWeek = new Date(date);
            const day = date.getDay();
            firstDayOfWeek.setDate(date.getDate() - day);
            intervalKey = `${firstDayOfWeek.getFullYear()}-W${Math.ceil((firstDayOfWeek.getDate() + firstDayOfWeek.getDay()) / 7)}`;
            break;
          case 'month':
            intervalKey = `${date.getFullYear()}-${(date.getMonth()+1).toString().padStart(2, '0')}`;
            break;
          case 'year':
            intervalKey = `${date.getFullYear()}`;
            break;
          default:
            intervalKey = `${date.getFullYear()}-${(date.getMonth()+1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
        }
        
        // Si hay campo de agrupación adicional
        if (groupBy && doc[groupBy]) {
          const groupValue = doc[groupBy];
          
          if (!result[intervalKey]) {
            result[intervalKey] = {};
          }
          
          if (!result[intervalKey][groupValue]) {
            result[intervalKey][groupValue] = 0;
          }
          
          result[intervalKey][groupValue]++;
        } else {
          if (!result[intervalKey]) {
            result[intervalKey] = 0;
          }
          
          result[intervalKey]++;
        }
      });
      
      // Convertir a formato de array para facilitar el uso
      const resultArray = Object.keys(result).map(key => {
        if (groupBy) {
          return {
            interval: key,
            groups: Object.keys(result[key]).map(group => ({
              name: group,
              count: result[key][group]
            }))
          };
        } else {
          return {
            interval: key,
            count: result[key]
          };
        }
      });
      
      // Ordenar por intervalo
      resultArray.sort((a, b) => a.interval.localeCompare(b.interval));
      
      return resultArray;
    } catch (error) {
      console.error(`Error al contar por intervalo de tiempo en ${collection}:`, error);
      throw error;
    }
  }
  
  /**
   * Calcula estadísticas avanzadas sobre una colección
   * @param {string} collection Nombre de la colección
   * @param {Object} options Opciones para el cálculo
   * @returns {Promise<Object>} Estadísticas
   */
  async function calculateStats(collection, options) {
    if (!databases[collection]) {
      throw new Error(`La colección ${collection} no existe`);
    }
    
    const {
      dateField = 'fecha',
      numberField = 'total',
      startDate,
      endDate,
      groupBy = null
    } = options;
    
    try {
      // Construir query para filtrar por fecha
      const query = {};
      
      if (startDate || endDate) {
        query[dateField] = {};
        if (startDate) query[dateField].$gte = new Date(startDate);
        if (endDate) query[dateField].$lte = new Date(endDate);
      }
      
      // Obtener documentos
      const documents = await databases[collection].find(query);
      
      // Estadísticas a calcular
      const stats = {
        count: documents.length,
        sum: 0,
        avg: 0,
        min: Number.MAX_VALUE,
        max: Number.MIN_VALUE,
        median: 0
      };
      
      // Estadísticas por grupo (si aplica)
      const groupStats = {};
      
      // Calcular estadísticas
      if (documents.length > 0) {
        // Valores para cálculos
        const values = [];
        
        documents.forEach(doc => {
          const value = Number(doc[numberField]) || 0;
          values.push(value);
          
          stats.sum += value;
          stats.min = Math.min(stats.min, value);
          stats.max = Math.max(stats.max, value);
          
          // Si hay agrupación
          if (groupBy && doc[groupBy]) {
            const groupValue = doc[groupBy];
            
            if (!groupStats[groupValue]) {
              groupStats[groupValue] = {
                count: 0,
                sum: 0,
                avg: 0,
                min: Number.MAX_VALUE,
                max: Number.MIN_VALUE,
                values: []
              };
            }
            
            groupStats[groupValue].count++;
            groupStats[groupValue].sum += value;
            groupStats[groupValue].min = Math.min(groupStats[groupValue].min, value);
            groupStats[groupValue].max = Math.max(groupStats[groupValue].max, value);
            groupStats[groupValue].values.push(value);
          }
        });
        
        // Calcular promedio general
        stats.avg = stats.sum / documents.length;
        
        // Calcular mediana general
        values.sort((a, b) => a - b);
        const mid = Math.floor(values.length / 2);
        stats.median = values.length % 2 === 0
          ? (values[mid - 1] + values[mid]) / 2
          : values[mid];
        
        // Calcular promedios y medianas por grupo
        if (groupBy) {
          Object.keys(groupStats).forEach(group => {
            const grp = groupStats[group];
            
            // Promedio del grupo
            grp.avg = grp.sum / grp.count;
            
            // Mediana del grupo
            grp.values.sort((a, b) => a - b);
            const midGroup = Math.floor(grp.values.length / 2);
            grp.median = grp.values.length % 2 === 0
              ? (grp.values[midGroup - 1] + grp.values[midGroup]) / 2
              : grp.values[midGroup];
              
            // Eliminar array de valores para no sobrecargar la respuesta
            delete grp.values;
          });
        }
      } else {
        // Si no hay documentos, ajustar valores mínimos/máximos
        stats.min = 0;
        stats.max = 0;
      }
      
      return {
        overall: stats,
        ...(groupBy ? { groups: groupStats } : {})
      };
    } catch (error) {
      console.error(`Error al calcular estadísticas en ${collection}:`, error);
      throw error;
    }
  }
  
  /**
   * Crea una copia de seguridad completa y la guarda en un archivo
   * @param {string} filename Nombre del archivo
   * @returns {Promise<string>} Ruta al archivo de backup
   */
  async function saveBackupToFile(filename) {
    try {
      // Obtener backup completo
      const backupData = await getBackup();
      
      // Determinar la ruta del archivo
      const userDataPath = await ipcRenderer.invoke('get-user-data-path');
      const backupsDir = path.join(userDataPath, 'backups');
      
      // Crear directorio si no existe
      if (!fs.existsSync(backupsDir)) {
        fs.mkdirSync(backupsDir, { recursive: true });
      }
      
      // Nombre del archivo con timestamp si no se especificó
      const backupFilename = filename || `backup_${new Date().toISOString().replace(/:/g, '-')}.json`;
      const backupPath = path.join(backupsDir, backupFilename);
      
      // Guardar archivo
      fs.writeFileSync(
        backupPath,
        JSON.stringify(backupData, null, 2),
        'utf8'
      );
      
      // Registrar en auditoría
      await registrarAuditoria('backupCreado', 'sistema', null, {
        archivo: backupFilename,
        ruta: backupPath
      });
      
      console.log(`Backup guardado en: ${backupPath}`);
      return backupPath;
    } catch (error) {
      console.error('Error al guardar backup en archivo:', error);
      throw error;
    }
  }
  
  /**
   * Restaura base de datos desde un archivo de backup
   * @param {string} filePath Ruta al archivo de backup
   * @param {boolean} clearExisting Eliminar datos existentes
   * @returns {Promise<boolean>} Resultado de la restauración
   */
  async function restoreFromFile(filePath, clearExisting = false) {
    try {
      // Verificar que el archivo existe
      if (!fs.existsSync(filePath)) {
        throw new Error(`El archivo de backup no existe: ${filePath}`);
      }
      
      // Leer el archivo
      const backupJson = fs.readFileSync(filePath, 'utf8');
      const backupData = JSON.parse(backupJson);
      
      // Registrar en auditoría
      await registrarAuditoria('inicioRestauracionArchivo', 'sistema', null, {
        archivo: path.basename(filePath)
      });
      
      // Restaurar desde los datos
      const result = await restoreBackup(backupData, clearExisting);
      
      // Registrar éxito
      await registrarAuditoria('finRestauracionArchivo', 'sistema', null, {
        archivo: path.basename(filePath),
        exitoso: true
      });
      
      return result;
    } catch (error) {
      console.error('Error al restaurar desde archivo:', error);
      
      // Registrar error
      await registrarAuditoria('errorRestauracionArchivo', 'sistema', null, {
        archivo: filePath ? path.basename(filePath) : 'desconocido',
        error: error.message
      });
      
      throw error;
    }
  }
  
  /**
   * Obtiene información sobre el estado de la base de datos
   * @returns {Promise<Object>} Información de la base de datos
   */
  async function getDatabaseInfo() {
    try {
      const info = {
        collections: {},
        totalDocuments: 0,
        dbSize: 0,
        sucursalId: dbConfig.sucursalId,
        isOnline: dbConfig.isOnline,
        lastCompaction: null,
        pendingSyncOperations: 0
      };
      
      // Recopilar información de cada colección
      for (const collection of collections) {
        if (!databases[collection]) continue;
        
        // Contar documentos
        const count = await databases[collection].count({});
        
        // Obtener tamaño del archivo si es posible
        let fileSize = 0;
        try {
          const dbFilePath = databases[collection].persistence.filename;
          if (fs.existsSync(dbFilePath)) {
            const stats = fs.statSync(dbFilePath);
            fileSize = stats.size;
          }
        } catch (e) {
          console.error(`Error al obtener tamaño de ${collection}:`, e);
        }
        
        // Guardar información de la colección
        info.collections[collection] = {
          documentCount: count,
          fileSize: fileSize
        };
        
        // Actualizar totales
        info.totalDocuments += count;
        info.dbSize += fileSize;
      }
      
      // Obtener cantidad de operaciones pendientes de sincronización
      if (databases.sync) {
        info.pendingSyncOperations = await databases.sync.count({ sincronizado: false });
      }
      
      // Formatear tamaño en MB
      info.dbSizeMB = (info.dbSize / (1024 * 1024)).toFixed(2);
      
      return info;
    } catch (error) {
      console.error('Error al obtener información de la base de datos:', error);
      throw error;
    }
  }
  
  /**
   * Migra la estructura de la base de datos según un esquema
   * @param {Object} schema Esquema de la base de datos
   * @returns {Promise<Object>} Resultado de la migración
   */
  async function migrateSchema(schema) {
    try {
      const result = {
        collectionsCreated: [],
        indexesCreated: [],
        errors: []
      };
      
      // Registrar inicio de migración
      await registrarAuditoria('inicioMigracion', 'sistema', null, {
        version: schema.version
      });
      
      // Procesar cada colección en el esquema
      for (const [collectionName, collectionSchema] of Object.entries(schema.collections)) {
        try {
          // Verificar si la colección existe, si no, inicializarla
          if (!databases[collectionName]) {
            await initCollection(collectionName);
            result.collectionsCreated.push(collectionName);
          }
          
          // Crear índices definidos en el esquema
          if (collectionSchema.indexes && Array.isArray(collectionSchema.indexes)) {
            for (const indexDef of collectionSchema.indexes) {
              try {
                await databases[collectionName].ensureIndex(indexDef);
                result.indexesCreated.push(`${collectionName}.${indexDef.fieldName}`);
              } catch (indexError) {
                result.errors.push(`Error al crear índice ${indexDef.fieldName} en ${collectionName}: ${indexError.message}`);
              }
            }
          }
          
          // Implementar migraciones de datos si es necesario
          if (collectionSchema.migrations && typeof collectionSchema.migrations === 'function') {
            await collectionSchema.migrations(databases[collectionName]);
          }
        } catch (collError) {
          result.errors.push(`Error al procesar colección ${collectionName}: ${collError.message}`);
        }
      }
      
      // Registrar fin de migración
      await registrarAuditoria('finMigracion', 'sistema', null, {
        version: schema.version,
        resultado: result
      });
      
      return result;
    } catch (error) {
      console.error('Error durante migración de esquema:', error);
      
      // Registrar error
      await registrarAuditoria('errorMigracion', 'sistema', null, {
        error: error.message
      });
      
      throw error;
    }
  }
  
  /**
   * Obtiene el listado de bases de datos para importación
   * @returns {Promise<Array>} Lista de archivos de backup disponibles
   */
  async function getAvailableBackups() {
    try {
      // Obtener ruta de backups
      const userDataPath = await ipcRenderer.invoke('get-user-data-path');
      const backupsDir = path.join(userDataPath, 'backups');
      
      // Verificar si el directorio existe
      if (!fs.existsSync(backupsDir)) {
        return [];
      }
      
      // Leer archivos de backup
      const files = fs.readdirSync(backupsDir)
        .filter(file => file.endsWith('.json'))
        .map(fileName => {
          const filePath = path.join(backupsDir, fileName);
          const stats = fs.statSync(filePath);
          
          // Intentar leer la información del backup
          let info = { sucursalId: 'desconocida', timestamp: null, version: 'desconocida' };
          try {
            const fileContent = fs.readFileSync(filePath, 'utf8');
            const backupData = JSON.parse(fileContent);
            info = {
              sucursalId: backupData.sucursalId || 'desconocida',
              timestamp: backupData.timestamp || null,
              version: backupData.version || 'desconocida'
            };
          } catch (e) {
            console.error(`Error al leer información de backup ${fileName}:`, e);
          }
          
          return {
            name: fileName,
            path: filePath,
            size: stats.size,
            sizeFormatted: (stats.size / (1024 * 1024)).toFixed(2) + ' MB',
            createdAt: stats.birthtime,
            ...info
          };
        });
      
      // Ordenar por fecha de creación (más reciente primero)
      return files.sort((a, b) => b.createdAt - a.createdAt);
    } catch (error) {
      console.error('Error al obtener backups disponibles:', error);
      throw error;
    }
  }
  
  /**
   * Exporta datos a formato CSV
   * @param {string} collection Nombre de la colección
   * @param {Object} query Consulta para filtrar documentos
   * @param {Array} fields Campos a incluir en el CSV
   * @param {string} outputPath Ruta donde guardar el archivo
   * @returns {Promise<string>} Ruta del archivo generado
   */
  async function exportToCSV(collection, query = {}, fields = [], outputPath = null) {
    if (!databases[collection]) {
      throw new Error(`La colección ${collection} no existe`);
    }
    
    try {
      // Obtener documentos
      const documents = await databases[collection].find(query);
      
      if (documents.length === 0) {
        throw new Error('No hay datos para exportar');
      }
      
      // Si no se especificaron campos, usar todos los campos del primer documento
      if (!fields || fields.length === 0) {
        fields = Object.keys(documents[0]).filter(key => !key.startsWith('_'));
      }
      
      // Generar cabecera CSV
      let csvContent = fields.join(',') + '\n';
      
      // Generar filas
      documents.forEach(doc => {
        const row = fields.map(field => {
          const value = doc[field];
          
          // Procesar valor según su tipo
          if (value === null || value === undefined) {
            return '';
          } else if (typeof value === 'string') {
            // Escapar comillas y encerrar en comillas si tiene comas
            const escaped = value.replace(/"/g, '""');
            return value.includes(',') ? `"${escaped}"` : escaped;
          } else if (value instanceof Date) {
            return value.toISOString();
          } else if (typeof value === 'object') {
            // Convertir objetos a JSON y encerrar en comillas
            const jsonStr = JSON.stringify(value).replace(/"/g, '""');
            return `"${jsonStr}"`;
          } else {
            return value;
          }
        }).join(',');
        
        csvContent += row + '\n';
      });
      
      // Determinar ruta de salida
      let csvPath;
      if (outputPath) {
        csvPath = outputPath;
      } else {
        const userDataPath = await ipcRenderer.invoke('get-user-data-path');
        const exportsDir = path.join(userDataPath, 'exports');
        
        // Crear directorio si no existe
        if (!fs.existsSync(exportsDir)) {
          fs.mkdirSync(exportsDir, { recursive: true });
        }
        
        // Nombre de archivo basado en colección y fecha
        const timestamp = new Date().toISOString().replace(/:/g, '-');
        csvPath = path.join(exportsDir, `${collection}_${timestamp}.csv`);
      }
      
      // Guardar archivo
      fs.writeFileSync(csvPath, csvContent, 'utf8');
      
      // Registrar en auditoría
      await registrarAuditoria('exportarCSV', collection, null, {
        archivo: path.basename(csvPath),
        cantidadRegistros: documents.length
      });
      
      return csvPath;
    } catch (error) {
      console.error(`Error al exportar ${collection} a CSV:`, error);
      throw error;
    }
  }
  
  /**
   * Importa datos desde un archivo CSV
   * @param {string} collection Nombre de la colección
   * @param {string} filePath Ruta al archivo CSV
   * @param {Object} options Opciones de importación
   * @returns {Promise<Object>} Resultado de la importación
   */
  async function importFromCSV(collection, filePath, options = {}) {
    if (!databases[collection]) {
      throw new Error(`La colección ${collection} no existe`);
    }
    
    try {
      const {
        headerRow = true,
        keyField = null,
        updateExisting = true,
        delimiter = ','
      } = options;
      
      // Verificar que el archivo existe
      if (!fs.existsSync(filePath)) {
        throw new Error(`El archivo no existe: ${filePath}`);
      }
      
      // Leer el contenido del archivo
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const rows = fileContent.split('\n').filter(row => row.trim());
      
      if (rows.length === 0) {
        throw new Error('El archivo CSV está vacío');
      }
      
      // Procesar encabezados
      let headers;
      let dataStartIndex = 0;
      
      if (headerRow) {
        headers = rows[0].split(delimiter).map(header => header.trim());
        dataStartIndex = 1;
      } else {
        // Si no hay encabezados, usar índices numéricos
        const firstRow = rows[0].split(delimiter);
        headers = Array.from({ length: firstRow.length }, (_, i) => `field${i}`);
      }
      
      // Resultados
      const result = {
        total: rows.length - dataStartIndex,
        imported: 0,
        updated: 0,
        errors: []
      };
      
      // Procesar filas de datos
      for (let i = dataStartIndex; i < rows.length; i++) {
        try {
          const values = parseCSVRow(rows[i], delimiter);
          
          // Si la fila tiene menos columnas que los encabezados, rellenar con nulls
          while (values.length < headers.length) {
            values.push(null);
          }
          
          // Crear objeto con los datos
          const record = {};
          headers.forEach((header, index) => {
            if (index < values.length) {
              record[header] = parseValue(values[index]);
            }
          });
          
          // Si hay campo clave, verificar si existe
          if (keyField && record[keyField]) {
            const query = { [keyField]: record[keyField] };
            const existing = await databases[collection].findOne(query);
            
            if (existing) {
              if (updateExisting) {
                // Actualizar registro existente
                await databases[collection].update(
                  query,
                  { $set: record },
                  {}
                );
                result.updated++;
              }
              continue;
            }
          }
          
          // Insertar nuevo registro
          const inserted = await databases[collection].insert(record);
          await logSyncOperation(collection, 'insert', inserted._id, record);
          result.imported++;
        } catch (rowError) {
          result.errors.push(`Error en fila ${i + 1}: ${rowError.message}`);
        }
      }
      
      // Registrar en auditoría
      await registrarAuditoria('importarCSV', collection, null, {
        archivo: path.basename(filePath),
        importados: result.imported,
        actualizados: result.updated,
        errores: result.errors.length
      });
      
      return result;
    } catch (error) {
      console.error(`Error al importar CSV a ${collection}:`, error);
      throw error;
    }
  }
  
  /**
   * Analiza una fila CSV manejando valores entre comillas
   * @param {string} row Fila CSV
   * @param {string} delimiter Delimitador
   * @returns {Array} Valores de la fila
   */
  function parseCSVRow(row, delimiter = ',') {
    const values = [];
    let currentValue = '';
    let insideQuotes = false;
    
    for (let i = 0; i < row.length; i++) {
      const char = row[i];
      
      if (char === '"') {
        if (insideQuotes && i + 1 < row.length && row[i + 1] === '"') {
          // Comilla escapada dentro de comillas
          currentValue += '"';
          i++; // Saltar la siguiente comilla
        } else {
          // Cambiar estado de comillas
          insideQuotes = !insideQuotes;
        }
      } else if (char === delimiter && !insideQuotes) {
        // Fin del valor
        values.push(currentValue);
        currentValue = '';
      } else {
        // Agregar caracter al valor actual
        currentValue += char;
      }
    }
    
    // Agregar el último valor
    values.push(currentValue);
    
    return values;
  }
  
  /**
   * Intenta convertir un valor string a su tipo adecuado
   * @param {string} value Valor a convertir
   * @returns {*} Valor convertido
   */
  function parseValue(value) {
    if (value === null || value === undefined || value === '') {
      return null;
    }
   
  
    // Intentar convertir a número
    if (/^-?\d+(\.\d+)?$/.test(value)) {
      return parseFloat(value);
    }
    
    // Intentar convertir a booleano
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
    
    return value;
  }
        /**
 * Exporta una colección a archivo CSV
 * @param {string} collection - Nombre de la colección
 * @param {object} query - Filtro de búsqueda
 * @param {Array<string>} fields - Campos a incluir
 * @param {string} outputPath - Ruta del archivo CSV
 */
async function exportToCSV(collection, query = {}, fields = [], outputPath = 'export.csv') {
    try {
      const documents = await find(collection, query);
  
      const parsedDocuments = documents.map(doc => {
        const row = {};
        fields.forEach(field => {
          const value = doc[field];
  
          // Intentar convertir a fecha (ISO)
          if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
            const date = new Date(value);
            row[field] = date.toLocaleString();
          } else {
            row[field] = value;
          }
        });
        return row;
      });
  
      const parser = new Parser({ fields });
      const csv = parser.parse(parsedDocuments);
  
      fs.writeFileSync(outputPath, csv, 'utf8');
  
      // Registrar auditoría
      await registrarAuditoria('exportCSV', collection, null, {
        query,
        fields,
        outputPath
      });
  
      console.log(`Exportación CSV completada: ${outputPath}`);
      return outputPath;
    } catch (error) {
      console.error(`Error al exportar CSV en ${collection}:`, error);
      throw error;
    }
  }
  
  
      /**
       * Exportación de funciones principales
       */
      module.exports = {
        initializeDatabase,
        insert,
        update,
        remove,
        find,
        findOne,
        findById,
        count,
        findWithPagination,
        advancedSearch,
        setEncryptionConfig,
        getBackup,
        restoreBackup,
        compactDatabases,
        cambiarSucursal,
        setOnlineStatus,
        getPendingSyncOperations,
        markSyncOperationsComplete,
        transaction,
        countByTimeInterval,
        calculateStats,
        saveBackupToFile,
        restoreFromFile,
        getDatabaseInfo,
        migrateSchema,
        getAvailableBackups,
        exportToCSV,
        dbEvents
      };