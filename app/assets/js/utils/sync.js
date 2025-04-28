// /app/assets/js/utils/sync.js
// Módulo de sincronización para FactuSystem (Cliente)

import database from './database';
import logger from './logger';
import auth from './auth';

const syncAPI = window.electronAPI.syncService;

class SyncManager {
  constructor() {
    this.syncStatus = 'idle';
    this.syncQueue = [];
    this.offlineChanges = [];
  }

  async init() {
    try {
      logger.info('SyncManager: Inicializando sincronización...');

      // Verificar si hay cambios offline pendientes
      this.offlineChanges = await database.getAll('syncOfflineQueue');

      if (this.offlineChanges.length > 0) {
        logger.info(`SyncManager: ${this.offlineChanges.length} cambios offline detectados.`);
        await this.syncOfflineChanges();
      }

      // Iniciar sincronización periódica
      this.startAutoSync();
    } catch (err) {
      logger.error('SyncManager: Error durante la inicialización', err);
    }
  }

  startAutoSync(intervalMs = 60000) {
    setInterval(async () => {
      await this.syncWithServer();
    }, intervalMs);
  }

  async syncWithServer() {
    try {
      this.syncStatus = 'syncing';

      const user = auth.getCurrentUser();
      if (!user) throw new Error('Usuario no autenticado');

      // Obtener datos modificados localmente
      const localData = await this.collectLocalChanges();

      // Enviar datos al servidor y obtener respuesta
      const response = await syncAPI.syncData(localData);

      // Aplicar los datos sincronizados en local
      await this.applyServerChanges(response);

      this.syncStatus = 'idle';
      logger.info('SyncManager: Sincronización con servidor completada');
    } catch (error) {
      this.syncStatus = 'error';
      logger.error('SyncManager: Error al sincronizar con servidor', error);
    }
  }

  async collectLocalChanges() {
    const tables = ['facturas', 'remitos', 'notas', 'clientes', 'productos', 'caja'];
    const localChanges = {};
    for (const table of tables) {
      const changes = await database.getModifiedSinceLastSync(table);
      localChanges[table] = changes;
    }
    return localChanges;
  }

  async applyServerChanges(serverData) {
    for (const [table, records] of Object.entries(serverData)) {
      for (const record of records) {
        await database.upsert(table, record);
      }
    }
  }

  async syncOfflineChanges() {
    try {
      for (const change of this.offlineChanges) {
        await syncAPI.sendOfflineChange(change);
        await database.delete('syncOfflineQueue', change.id);
      }
      logger.info('SyncManager: Cambios offline sincronizados con éxito');
    } catch (err) {
      logger.error('SyncManager: Error al sincronizar cambios offline', err);
    }
  }

  async queueOfflineChange(change) {
    await database.insert('syncOfflineQueue', change);
    logger.info('SyncManager: Cambio encolado para sincronización offline');
  }

  getStatus() {
    return this.syncStatus;
  }
}

const syncManager = new SyncManager();
export default syncManager;
