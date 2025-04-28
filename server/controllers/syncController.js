/**
 * syncController.js
 * Controlador para manejar todas las operaciones de sincronización entre sucursales
 * y servidor central en FactuSystem
 */

const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Importaciones de modelos y servicios
const db = require('../../db/schema');
const logger = require('../../services/audit/logger');
const conflictResolver = require('../../services/sync/conflict');
const securityConfig = require('../config/security');

/**
 * Clase principal del controlador de sincronización
 */
class SyncController {
  /**
   * Inicializa el controlador de sincronización
   */
  constructor() {
    this.pendingChanges = new Map();
    this.syncInProgress = false;
    this.lastSyncTimestamp = null;
    this.maxRetries = 3;
    this.syncInterval = 300000; // 5 minutos por defecto
    this.tables = [
      'productos', 'clientes', 'proveedores', 'ventas', 
      'compras', 'usuarios', 'caja', 'configuraciones',
      'remitos', 'notasCredito', 'notasDebito'
    ];
  }

  /**
   * Inicia la sincronización con el servidor o sucursal
   * @param {Object} req - Objeto de solicitud Express
   * @param {Object} res - Objeto de respuesta Express
   */
  async startSync(req, res) {
    const { sucursalId, timestamp, forceFull } = req.body;
    const authToken = req.headers.authorization;

    try {
      // Verificar autenticación
      if (!this.verifyAuthToken(authToken)) {
        return res.status(401).json({ 
          success: false, 
          message: 'Token de autenticación inválido' 
        });
      }

      // Verificar si hay una sincronización en progreso
      if (this.syncInProgress) {
        return res.status(409).json({ 
          success: false, 
          message: 'Sincronización en progreso, intente más tarde' 
        });
      }

      this.syncInProgress = true;
      logger.info(`Iniciando sincronización para sucursal ${sucursalId}`, { 
        sucursalId, 
        timestamp, 
        forceFull: !!forceFull 
      });

      // Determinar el tipo de sincronización
      let syncData;
      if (forceFull) {
        syncData = await this.performFullSync(sucursalId);
      } else {
        syncData = await this.performIncrementalSync(sucursalId, timestamp);
      }

      this.lastSyncTimestamp = new Date().toISOString();
      this.syncInProgress = false;

      return res.status(200).json({
        success: true,
        data: syncData,
        timestamp: this.lastSyncTimestamp,
        message: 'Sincronización completada exitosamente'
      });
    } catch (error) {
      this.syncInProgress = false;
      logger.error('Error en sincronización', { 
        error: error.message, 
        stack: error.stack,
        sucursalId 
      });
      
      return res.status(500).json({
        success: false,
        message: 'Error durante la sincronización',
        error: error.message
      });
    }
  }

  /**
   * Realiza una sincronización completa de todos los datos
   * @param {string} sucursalId - ID de la sucursal
   * @returns {Object} Datos completos de todas las tablas
   */
  async performFullSync(sucursalId) {
    logger.info(`Realizando sincronización completa para sucursal ${sucursalId}`);
    
    const fullData = {};
    
    // Obtener datos completos de todas las tablas
    for (const table of this.tables) {
      fullData[table] = await this.getFullTableData(table);
    }
    
    // Registrar el evento de sincronización completa
    await this.recordSyncEvent(sucursalId, 'full', null);
    
    return {
      type: 'full',
      data: fullData,
      checksum: this.generateChecksum(fullData)
    };
  }

  /**
   * Realiza una sincronización incremental basada en cambios desde timestamp
   * @param {string} sucursalId - ID de la sucursal
   * @param {string} timestamp - Marca de tiempo desde la última sincronización
   * @returns {Object} Cambios incrementales desde el timestamp
   */
  async performIncrementalSync(sucursalId, timestamp) {
    logger.info(`Realizando sincronización incremental para sucursal ${sucursalId} desde ${timestamp}`);
    
    const incrementalData = {};
    
    // Obtener cambios incrementales de todas las tablas
    for (const table of this.tables) {
      incrementalData[table] = await this.getChangesFromTimestamp(table, timestamp);
    }
    
    // Registrar el evento de sincronización incremental
    await this.recordSyncEvent(sucursalId, 'incremental', timestamp);
    
    return {
      type: 'incremental',
      data: incrementalData,
      lastTimestamp: timestamp,
      checksum: this.generateChecksum(incrementalData)
    };
  }

  /**
   * Recibe datos de sincronización desde una sucursal
   * @param {Object} req - Objeto de solicitud Express
   * @param {Object} res - Objeto de respuesta Express
   */
  async receiveSyncData(req, res) {
    const { sucursalId, data, timestamp, checksum } = req.body;
    const authToken = req.headers.authorization;

    try {
      // Verificar autenticación
      if (!this.verifyAuthToken(authToken)) {
        return res.status(401).json({ 
          success: false, 
          message: 'Token de autenticación inválido' 
        });
      }
      
      // Verificar el checksum para asegurar integridad de datos
      const calculatedChecksum = this.generateChecksum(data);
      if (calculatedChecksum !== checksum) {
        logger.warn(`Checksum inválido recibido de sucursal ${sucursalId}`, {
          expected: calculatedChecksum,
          received: checksum
        });
        
        return res.status(400).json({
          success: false,
          message: 'Error de integridad en los datos recibidos'
        });
      }
      
      // Procesar los datos recibidos
      await this.processSyncData(sucursalId, data);
      
      // Registrar el evento de recepción de datos
      await this.recordSyncEvent(sucursalId, 'receive', timestamp);
      
      return res.status(200).json({
        success: true,
        message: 'Datos recibidos y procesados correctamente',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Error al recibir datos de sincronización', { 
        error: error.message, 
        stack: error.stack,
        sucursalId 
      });
      
      return res.status(500).json({
        success: false,
        message: 'Error al procesar los datos recibidos',
        error: error.message
      });
    }
  }

  /**
   * Procesa los datos recibidos de la sincronización
   * @param {string} sucursalId - ID de la sucursal
   * @param {Object} data - Datos recibidos para sincronizar
   */
  async processSyncData(sucursalId, data) {
    logger.info(`Procesando datos recibidos de sucursal ${sucursalId}`);
    
    // Iterar sobre cada tabla en los datos
    for (const [table, records] of Object.entries(data)) {
      if (!Array.isArray(records) || records.length === 0) continue;
      
      for (const record of records) {
        try {
          // Verificar si el registro ya existe
          const existingRecord = await this.findRecordById(table, record.id);
          
          if (existingRecord) {
            // Verificar si hay conflictos
            if (existingRecord.updatedAt > record.updatedAt) {
              // El registro local es más reciente, resolver conflicto
              const resolvedRecord = await conflictResolver.resolve(
                table, existingRecord, record, sucursalId
              );
              
              await this.updateRecord(table, resolvedRecord);
            } else {
              // El registro entrante es más reciente, actualizar
              await this.updateRecord(table, record);
            }
          } else {
            // Registro nuevo, insertar
            await this.insertRecord(table, record);
          }
        } catch (error) {
          // Registrar error pero continuar con el siguiente registro
          logger.error(`Error al procesar registro en tabla ${table}`, {
            recordId: record.id,
            error: error.message
          });
          
          // Añadir a la lista de cambios pendientes para reintentar después
          this.addToPendingChanges(table, record, sucursalId);
        }
      }
    }
    
    // Intentar procesar cambios pendientes previos
    await this.processPendingChanges();
  }

  /**
   * Agrega un cambio a la lista de pendientes para reintentar
   * @param {string} table - Nombre de la tabla
   * @param {Object} record - Registro a sincronizar
   * @param {string} sucursalId - ID de la sucursal
   */
  addToPendingChanges(table, record, sucursalId) {
    const key = `${table}-${record.id}`;
    const pendingChange = {
      table,
      record,
      sucursalId,
      retries: 0,
      lastAttempt: new Date()
    };
    
    this.pendingChanges.set(key, pendingChange);
  }

  /**
   * Procesa los cambios pendientes de sincronización
   */
  async processPendingChanges() {
    if (this.pendingChanges.size === 0) return;
    
    logger.info(`Procesando ${this.pendingChanges.size} cambios pendientes`);
    
    const pendingEntries = Array.from(this.pendingChanges.entries());
    
    for (const [key, pendingChange] of pendingEntries) {
      const { table, record, sucursalId, retries } = pendingChange;
      
      if (retries >= this.maxRetries) {
        logger.warn(`Abandoning sync for record after ${retries} attempts`, {
          table, recordId: record.id, sucursalId
        });
        
        this.pendingChanges.delete(key);
        continue;
      }
      
      try {
        const existingRecord = await this.findRecordById(table, record.id);
        
        if (existingRecord) {
          await this.updateRecord(table, record);
        } else {
          await this.insertRecord(table, record);
        }
        
        // Éxito, eliminar de pendientes
        this.pendingChanges.delete(key);
      } catch (error) {
        // Actualizar contador de reintentos
        pendingChange.retries += 1;
        pendingChange.lastAttempt = new Date();
        this.pendingChanges.set(key, pendingChange);
        
        logger.error(`Error al procesar cambio pendiente (intento ${pendingChange.retries})`, {
          table, recordId: record.id, error: error.message
        });
      }
    }
  }

  /**
   * Obtiene todos los datos de una tabla
   * @param {string} table - Nombre de la tabla
   * @returns {Array} Registros completos de la tabla
   */
  async getFullTableData(table) {
    try {
      return await db[table].findAll({
        where: { deleted: false },
        raw: true
      });
    } catch (error) {
      logger.error(`Error al obtener datos completos de tabla ${table}`, {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Obtiene cambios en una tabla desde un timestamp específico
   * @param {string} table - Nombre de la tabla
   * @param {string} timestamp - Marca de tiempo desde la cual buscar cambios
   * @returns {Array} Registros modificados desde el timestamp
   */
  async getChangesFromTimestamp(table, timestamp) {
    try {
      return await db[table].findAll({
        where: {
          updatedAt: {
            [db.Sequelize.Op.gt]: new Date(timestamp)
          }
        },
        raw: true
      });
    } catch (error) {
      logger.error(`Error al obtener cambios incrementales de tabla ${table}`, {
        error: error.message, timestamp
      });
      throw error;
    }
  }

  /**
   * Busca un registro por su ID en una tabla específica
   * @param {string} table - Nombre de la tabla
   * @param {string} id - ID del registro
   * @returns {Object|null} Registro encontrado o null
   */
  async findRecordById(table, id) {
    try {
      return await db[table].findByPk(id, { raw: true });
    } catch (error) {
      logger.error(`Error al buscar registro en tabla ${table}`, {
        id, error: error.message
      });
      throw error;
    }
  }

  /**
   * Actualiza un registro existente en la base de datos
   * @param {string} table - Nombre de la tabla
   * @param {Object} record - Datos del registro a actualizar
   */
  async updateRecord(table, record) {
    try {
      const { id, ...updateData } = record;
      
      await db[table].update(updateData, {
        where: { id }
      });
      
      logger.info(`Registro actualizado en tabla ${table}`, { id });
    } catch (error) {
      logger.error(`Error al actualizar registro en tabla ${table}`, {
        id: record.id, error: error.message
      });
      throw error;
    }
  }

  /**
   * Inserta un nuevo registro en la base de datos
   * @param {string} table - Nombre de la tabla
   * @param {Object} record - Datos del registro a insertar
   */
  async insertRecord(table, record) {
    try {
      await db[table].create(record);
      logger.info(`Nuevo registro creado en tabla ${table}`, { id: record.id });
    } catch (error) {
      logger.error(`Error al insertar registro en tabla ${table}`, {
        id: record.id, error: error.message
      });
      throw error;
    }
  }

  /**
   * Verifica si una sucursal está activa y autorizada para sincronización
   * @param {string} sucursalId - ID de la sucursal
   * @returns {Promise<boolean>} Estado de la autorización
   */
  async verifySucursalPermission(sucursalId) {
    try {
      const sucursal = await db.sucursales.findByPk(sucursalId);
      return sucursal && sucursal.activa && sucursal.sincronizacionHabilitada;
    } catch (error) {
      logger.error(`Error al verificar permisos de sucursal ${sucursalId}`, {
        error: error.message
      });
      return false;
    }
  }

  /**
   * Registra un evento de sincronización en la base de datos
   * @param {string} sucursalId - ID de la sucursal
   * @param {string} eventType - Tipo de evento (full, incremental, receive)
   * @param {string|null} timestamp - Marca de tiempo relacionada al evento
   */
  async recordSyncEvent(sucursalId, eventType, timestamp) {
    try {
      await db.syncEvents.create({
        id: uuidv4(),
        sucursalId,
        eventType,
        timestamp: timestamp || new Date().toISOString(),
        createdAt: new Date(),
        updatedAt: new Date()
      });
    } catch (error) {
      logger.error(`Error al registrar evento de sincronización`, {
        sucursalId, eventType, error: error.message
      });
      // No propagamos el error para no interrumpir el flujo principal
    }
  }

  /**
   * Verifica un token de autenticación
   * @param {string} token - Token de autenticación
   * @returns {boolean} Resultado de la verificación
   */
  verifyAuthToken(token) {
    if (!token || !token.startsWith('Bearer ')) {
      return false;
    }
    
    const tokenValue = token.split(' ')[1];
    
    try {
      // En un entorno real, usarías JWT u otro mecanismo seguro
      return securityConfig.verifyToken(tokenValue);
    } catch (error) {
      logger.error(`Error al verificar token de autenticación`, {
        error: error.message
      });
      return false;
    }
  }

  /**
   * Genera un checksum para verificar integridad de datos
   * @param {Object} data - Datos para generar el checksum
   * @returns {string} Checksum generado
   */
  generateChecksum(data) {
    const hash = crypto.createHash('sha256');
    hash.update(JSON.stringify(data));
    return hash.digest('hex');
  }

  /**
   * Obtiene el estado actual de la sincronización
   * @param {Object} req - Objeto de solicitud Express
   * @param {Object} res - Objeto de respuesta Express
   */
  async getSyncStatus(req, res) {
    const { sucursalId } = req.params;
    
    try {
      // Verificar si la sucursal tiene permisos
      const hasPermission = await this.verifySucursalPermission(sucursalId);
      if (!hasPermission) {
        return res.status(403).json({
          success: false,
          message: 'Sucursal no autorizada para sincronización'
        });
      }
      
      // Obtener el último evento de sincronización
      const lastSyncEvent = await db.syncEvents.findOne({
        where: { sucursalId },
        order: [['createdAt', 'DESC']]
      });
      
      // Obtener cantidad de cambios pendientes
      const pendingChangesCount = Array.from(this.pendingChanges.values())
        .filter(change => change.sucursalId === sucursalId).length;
      
      return res.status(200).json({
        success: true,
        status: {
          inProgress: this.syncInProgress,
          lastSync: lastSyncEvent ? lastSyncEvent.createdAt : null,
          lastSyncType: lastSyncEvent ? lastSyncEvent.eventType : null,
          pendingChanges: pendingChangesCount
        }
      });
    } catch (error) {
      logger.error(`Error al obtener estado de sincronización`, {
        sucursalId, error: error.message, stack: error.stack
      });
      
      return res.status(500).json({
        success: false,
        message: 'Error al obtener estado de sincronización',
        error: error.message
      });
    }
  }

  /**
   * Resuelve conflictos manualmente cuando no se pueden resolver automáticamente
   * @param {Object} req - Objeto de solicitud Express
   * @param {Object} res - Objeto de respuesta Express
   */
  async resolveConflict(req, res) {
    const { table, recordId, resolution } = req.body;
    
    try {
      const result = await conflictResolver.manualResolve(
        table, recordId, resolution
      );
      
      return res.status(200).json({
        success: true,
        message: 'Conflicto resuelto correctamente',
        data: result
      });
    } catch (error) {
      logger.error(`Error al resolver conflicto manualmente`, {
        table, recordId, error: error.message
      });
      
      return res.status(500).json({
        success: false,
        message: 'Error al resolver conflicto',
        error: error.message
      });
    }
  }

  /**
   * Fuerza la sincronización inmediata con todas las sucursales
   * @param {Object} req - Objeto de solicitud Express
   * @param {Object} res - Objeto de respuesta Express
   */
  async forceSyncAll(req, res) {
    const { type } = req.body;
    const isFull = type === 'full';
    
    try {
      // Obtener todas las sucursales activas
      const sucursales = await db.sucursales.findAll({
        where: {
          activa: true,
          sincronizacionHabilitada: true
        }
      });
      
      if (sucursales.length === 0) {
        return res.status(200).json({
          success: true,
          message: 'No hay sucursales activas para sincronizar'
        });
      }
      
      // Iniciar proceso de sincronización en segundo plano
      this.startBackgroundSync(sucursales, isFull);
      
      return res.status(200).json({
        success: true,
        message: `Sincronización ${isFull ? 'completa' : 'incremental'} iniciada en segundo plano`,
        sucursalesCount: sucursales.length
      });
    } catch (error) {
      logger.error(`Error al forzar sincronización con todas las sucursales`, {
        error: error.message, stack: error.stack
      });
      
      return res.status(500).json({
        success: false,
        message: 'Error al iniciar sincronización forzada',
        error: error.message
      });
    }
  }

  /**
   * Inicia sincronización en segundo plano con múltiples sucursales
   * @param {Array} sucursales - Lista de sucursales para sincronizar
   * @param {boolean} isFull - Indica si es sincronización completa
   */
  async startBackgroundSync(sucursales, isFull) {
    logger.info(`Iniciando sincronización en segundo plano con ${sucursales.length} sucursales`);
    
    for (const sucursal of sucursales) {
      try {
        // Simular solicitud a cada sucursal
        const timestamp = this.lastSyncTimestamp || new Date().toISOString();
        
        if (isFull) {
          await this.performFullSync(sucursal.id);
        } else {
          await this.performIncrementalSync(sucursal.id, timestamp);
        }
        
        logger.info(`Sincronización exitosa con sucursal ${sucursal.id}`);
      } catch (error) {
        logger.error(`Error en sincronización con sucursal ${sucursal.id}`, {
          error: error.message
        });
        // Continuar con la siguiente sucursal
      }
    }
    
    logger.info('Sincronización en segundo plano completada');
  }

  /**
   * Configura la sincronización periódica automática
   * @param {number} interval - Intervalo en milisegundos entre sincronizaciones
   */
  setupAutomaticSync(interval = null) {
    if (interval) {
      this.syncInterval = interval;
    }
    
    // Limpiar intervalo existente si hay uno
    if (this._syncIntervalId) {
      clearInterval(this._syncIntervalId);
    }
    
    // Configurar nueva sincronización automática
    this._syncIntervalId = setInterval(async () => {
      try {
        if (this.syncInProgress) {
          logger.info('Saltando sincronización automática porque hay una en progreso');
          return;
        }
        
        logger.info('Iniciando sincronización automática periódica');
        
        // Obtenemos sucursales activas
        const sucursales = await db.sucursales.findAll({
          where: {
            activa: true,
            sincronizacionHabilitada: true
          }
        });
        
        // Sincronizar con cada sucursal
        this.startBackgroundSync(sucursales, false);
      } catch (error) {
        logger.error('Error en sincronización automática', {
          error: error.message, stack: error.stack
        });
      }
    }, this.syncInterval);
    
    logger.info(`Sincronización automática configurada cada ${this.syncInterval / 1000} segundos`);
  }

  /**
   * Recupera métricas de sincronización para análisis
   * @param {Object} req - Objeto de solicitud Express
   * @param {Object} res - Objeto de respuesta Express
   */
  async getSyncMetrics(req, res) {
    const { desde, hasta } = req.query;
    
    try {
      // Convertir fechas
      const startDate = desde ? new Date(desde) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const endDate = hasta ? new Date(hasta) : new Date();
      
      // Obtener eventos de sincronización en el período
      const events = await db.syncEvents.findAll({
        where: {
          createdAt: {
            [db.Sequelize.Op.between]: [startDate, endDate]
          }
        },
        order: [['createdAt', 'ASC']]
      });
      
      // Agrupar por tipo de evento y sucursal
      const stats = {
        total: events.length,
        byType: {
          full: events.filter(e => e.eventType === 'full').length,
          incremental: events.filter(e => e.eventType === 'incremental').length,
          receive: events.filter(e => e.eventType === 'receive').length
        },
        bySucursal: {}
      };
      
      // Calcular estadísticas por sucursal
      for (const event of events) {
        if (!stats.bySucursal[event.sucursalId]) {
          stats.bySucursal[event.sucursalId] = {
            total: 0,
            full: 0,
            incremental: 0,
            receive: 0
          };
        }
        
        stats.bySucursal[event.sucursalId].total++;
        stats.bySucursal[event.sucursalId][event.eventType]++;
      }
      
      return res.status(200).json({
        success: true,
        metrics: stats,
        period: {
          desde: startDate,
          hasta: endDate
        }
      });
    } catch (error) {
      logger.error('Error al obtener métricas de sincronización', {
        error: error.message, stack: error.stack
      });
      
      return res.status(500).json({
        success: false,
        message: 'Error al obtener métricas de sincronización',
        error: error.message
      });
    }
  }
}

// Exportamos una instancia singleton del controlador
const syncController = new SyncController();

// Iniciamos la sincronización automática
syncController.setupAutomaticSync();

module.exports = syncController;