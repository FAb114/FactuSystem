// /app/assets/js/utils/backup.js
// Módulo de respaldo y restauración para FactuSystem
// Incluye compresión, cifrado opcional, metadatos y políticas de retención

const auth = require('./auth');
const logger = require('./logger');
const database = require('./database');
const crypto = require('crypto');
const zlib = require('zlib');

// Servicio expuesto desde main via preload
const backupService = window.electronAPI.backupService;

class BackupManager {
  constructor() {
    this.retentionDays = 30; // días por defecto para retención
    this.autoBackupInterval = null;
  }

  /**
   * Inicializa el gestor de backups: carga políticas y programa backups automáticos
   */
  async init(retentionDays = null, autoIntervalMs = null) {
    try {
      const user = auth.getCurrentUser();
      if (!user) throw new Error('Usuario no autenticado');

      // Cargar política de retención de base de datos si existe
      const config = await database.get('configuraciones', 'backup');
      if (config) {
        this.retentionDays = config.retentionDays || this.retentionDays;
      }

      if (retentionDays !== null) this.retentionDays = retentionDays;
      if (autoIntervalMs !== null) this.startAutoBackup(autoIntervalMs);

      logger.info(`BackupManager: Iniciado con retención ${this.retentionDays} días`);
      await this.enforceRetentionPolicy();
    } catch (err) {
      logger.error('BackupManager: Error durante init', err);
    }
  }

  /**
   * Crea un backup con nombre, datos y opciones de cifrado
   * @param {string} fileName - Nombre base (sin extensión)
   * @param {Object} data - Objeto a respaldar
   * @param {Object} [options]
   * @param {boolean} [options.encrypt=false] - Si se cifra
   * @param {string} [options.encryptionKey] - Clave para AES-256
   * @returns {Promise<string>} - Ruta al archivo creado
   */
  async createBackup(fileName, data, options = {}) {
    const user = auth.getCurrentUser();
    if (!user) throw new Error('Usuario no autenticado');

    try {
      // Serializar
      let buffer = Buffer.from(JSON.stringify(data, null, 2), 'utf8');

      // Comprimir
      buffer = zlib.gzipSync(buffer);

      // Cifrar si se solicita
      if (options.encrypt) {
        const key = crypto.createHash('sha256').update(options.encryptionKey).digest();
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
        buffer = Buffer.concat([iv, cipher.update(buffer), cipher.final()]);
      }

      // Llamar al servicio nativo
      const ext = options.encrypt ? '.enc' : '.gz';
      const fullName = `${fileName}${ext}`;
      const filePath = await backupService.createBackup(fullName, buffer);

      // Guardar metadatos en BD
      await database.insert('backups', {
        nombre: fullName,
        usuarioId: user.id,
        fecha: new Date(),
        size: buffer.length,
        encrypt: !!options.encrypt
      });

      logger.info(`BackupManager: Backup creado (${fullName}) por ${user.nombre}`);
      return filePath;
    } catch (err) {
      logger.error(`BackupManager: Error creando backup ${fileName}`, err);
      throw err;
    }
  }

  /**
   * Restaura un backup existente
   * @param {string} fileName - Nombre del backup (con extensión)
   * @param {Object} [options]
   * @param {boolean} [options.decrypt=false]
   * @param {string} [options.encryptionKey]
   * @returns {Promise<Object>} - Datos restaurados
   */
  async restoreBackup(fileName, options = {}) {
    const user = auth.getCurrentUser();
    if (!user) throw new Error('Usuario no autenticado');

    try {
      // Leer buffer del servicio
      let buffer = await backupService.restoreBackup(fileName);

      // Desencriptar si procede
      if (options.decrypt) {
        const key = crypto.createHash('sha256').update(options.encryptionKey).digest();
        const iv = buffer.slice(0, 16);
        const ciphertext = buffer.slice(16);
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        buffer = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      }

      // Descomprimir
      buffer = zlib.gunzipSync(buffer);

      // Parsear JSON
      const data = JSON.parse(buffer.toString('utf8'));
      logger.info(`BackupManager: Backup restaurado (${fileName}) por ${user.nombre}`);
      return data;
    } catch (err) {
      logger.error(`BackupManager: Error restaurando backup ${fileName}`, err);
      throw err;
    }
  }

  /**
   * Lista backups con metadatos
   * @returns {Promise<Array>} - Lista de objetos { nombre, fecha, size, usuarioId, encrypt }
   */
  async listBackups() {
    try {
      // Leer metadatos desde BD
      const backups = await database.getAll('backups');
      return backups;
    } catch (err) {
      logger.error('BackupManager: Error listando backups', err);
      throw err;
    }
  }

  /**
   * Aplica política de retención: elimina backups viejos
   */
  async enforceRetentionPolicy() {
    try {
      const all = await this.listBackups();
      const cutoff = new Date(Date.now() - this.retentionDays * 24 * 60 * 60 * 1000);
      for (const meta of all) {
        if (new Date(meta.fecha) < cutoff) {
          await backupService.deleteBackup(meta.nombre);
          await database.delete('backups', meta.id);
          logger.info(`BackupManager: Backup ${meta.nombre} eliminado por retención`);
        }
      }
    } catch (err) {
      logger.error('BackupManager: Error aplicando retención', err);
    }
  }

  /**
   * Inicia backups automáticos
   * @param {number} intervalMs - Intervalo en milisegundos
   */
  startAutoBackup(intervalMs = 86400000) {
    if (this.autoBackupInterval) clearInterval(this.autoBackupInterval);
    this.autoBackupInterval = setInterval(async () => {
      try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        await this.createBackup(`auto-backup-${timestamp}`, await database.exportAll(), { encrypt: false });
        await this.enforceRetentionPolicy();
      } catch (err) {
        // ya logueado en createBackup
      }
    }, intervalMs);
    logger.info(`BackupManager: Auto-backup cada ${intervalMs / 1000}s`);
  }
}

// Exportar instancia única
module.exports = new BackupManager();
