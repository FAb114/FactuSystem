// /app/assets/js/utils/backup.js
// Módulo de respaldo y restauración para FactuSystem
// Incluye compresión, cifrado opcional, metadatos y políticas de retención

const auth = require('./auth');
const logger = require('./logger');
const database = require('./database');
const crypto = require('crypto');
const zlib = require('zlib');
const { createBackup, restoreBackup, getBackups, deleteBackup } = require('../../../../services/backup/autoBackup'); // Importa las funciones directamente

class BackupManager {
    constructor(auth, logger, database, crypto, zlib, backupService) { // Inyección de dependencias
        this.auth = auth;
        this.logger = logger;
        this.database = database;
        this.crypto = crypto;
        this.zlib = zlib;
        this.backupService = { createBackup, restoreBackup, getBackups, deleteBackup }; //  Usamos las funciones importadas
        this.retentionDays = 30; // días por defecto para retención
        this.autoBackupInterval = null;
    }

    /**
     * Inicializa el gestor de backups: carga políticas y programa backups automáticos
     */
    async init(retentionDays = null, autoIntervalMs = null) {
        try {
            const user = this.auth.getCurrentUser();
            if (!user) throw new Error('Usuario no autenticado');

            // Cargar política de retención de base de datos si existe
            const config = await this.database.get('configuraciones', 'backup');
            if (config) {
                this.retentionDays = config.retentionDays || this.retentionDays;
            }

            if (retentionDays !== null) this.retentionDays = retentionDays;
            if (autoIntervalMs !== null) this.startAutoBackup(autoIntervalMs);

            this.logger.info(`BackupManager: Iniciado con retención ${this.retentionDays} días`);
            await this.enforceRetentionPolicy();
        } catch (err) {
            this.logger.error('BackupManager: Error durante init', err);
        }
    }

    /**
     * Crea un nuevo backup
     * @param {string} fileName - Nombre base del archivo (sin extensión)
     * @param {object} data - Datos a respaldar (objeto serializable)
     * @param {object} options - Opciones de respaldo
     * @param {boolean} options.encrypt - Si se debe cifrar el backup
     * @param {string} options.encryptionKey - Clave de cifrado (si encrypt=true)
     */
    async createBackup(fileName, data, options = {}) {
        const user = this.auth.getCurrentUser();
        if (!user) throw new Error('Usuario no autenticado');

        try {
            let buffer = Buffer.from(JSON.stringify(data, null, 2), 'utf8');
            buffer = this.zlib.gzipSync(buffer);

            if (options.encrypt) {
                const key = this.crypto.createHash('sha256').update(options.encryptionKey).digest();
                const iv = this.crypto.randomBytes(16);
                const cipher = this.crypto.createCipheriv('aes-256-cbc', key, iv);
                buffer = Buffer.concat([iv, cipher.update(buffer), cipher.final()]);
            }

            const ext = options.encrypt ? '.enc' : '.gz';
            const fullName = `${fileName}${ext}`;
            const filePath = await this.backupService.createBackup(fullName, buffer); // Llama a la función importada

            await this.database.insert('backups', {
                nombre: fullName,
                usuarioId: user.id,
                fecha: new Date(),
                size: buffer.length,
                encrypt: !!options.encrypt
            });

            this.logger.info(`BackupManager: Backup creado (${fullName}) por ${user.nombre}`);
            return filePath;
        } catch (err) {
            this.logger.error(`BackupManager: Error creando backup ${fileName}`, err);
            throw err;
        }
    }

    /**
     * Restaura un backup
     * @param {string} fileName - Nombre del archivo de backup (con extensión)
     * @param {object} options - Opciones de restauración
     * @param {string} options.encryptionKey - Clave de descifrado (si el backup está cifrado)
     */
    async restoreBackup(fileName, options = {}) {
        try {
            let buffer = await this.backupService.restoreBackup(fileName); // Llama a la función importada

            if (fileName.endsWith('.enc') && options.encryptionKey) {
                const iv = buffer.slice(0, 16);
                const key = this.crypto.createHash('sha256').update(options.encryptionKey).digest();
                const decipher = this.crypto.createDecipheriv('aes-256-cbc', key, iv);
                buffer = decipher.update(buffer.slice(16));
                buffer = Buffer.concat([buffer, decipher.final()]);
            }

            if (fileName.endsWith('.gz') || fileName.endsWith('.enc')) {
                buffer = this.zlib.gunzipSync(buffer);
            }

            return JSON.parse(buffer.toString('utf8'));
        } catch (err) {
            this.logger.error(`BackupManager: Error restaurando backup ${fileName}`, err);
            throw err;
        }
    }

    /**
     * Lista los backups disponibles
     * @returns {Array<object>} - Array de metadatos de backups
     */
    async listBackups() {
        try {
            const backups = await this.database.getAll('backups');
            return backups.map(backup => ({
                id: backup.id,
                nombre: backup.nombre,
                fecha: backup.fecha,
                size: backup.size,
                encrypt: backup.encrypt
            }));
        } catch (err) {
            this.logger.error('BackupManager: Error listando backups', err);
            throw err;
        }
    }

    /**
     * Elimina un backup
     * @param {string} fileName - Nombre del archivo de backup a eliminar
     */
    async deleteBackup(fileName) {
        try {
            await this.backupService.deleteBackup(fileName); // Llama a la función importada
            await this.database.delete('backups', { nombre: fileName });
            this.logger.info(`BackupManager: Backup ${fileName} eliminado`);
        } catch (err) {
            this.logger.error(`BackupManager: Error eliminando backup ${fileName}`, err);
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
                    await this.backupService.deleteBackup(meta.nombre); // Llama a la función importada
                    await this.database.delete('backups', meta.id);
                    this.logger.info(`BackupManager: Backup ${meta.nombre} eliminado por retención`);
                }
            }
        } catch (err) {
            this.logger.error('BackupManager: Error aplicando retención', err);
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
                await this.createBackup(`auto-backup-${timestamp}`, await this.database.exportAll(), { encrypt: false });
                await this.enforceRetentionPolicy();
            } catch (err) {
                this.logger.error('BackupManager: Error en autoBackup', err);
            }
        }, intervalMs);
    }

    /**
     * Detiene los backups automáticos
     */
    stopAutoBackup() {
        if (this.autoBackupInterval) clearInterval(this.autoBackupInterval);
        this.autoBackupInterval = null;
    }
}

// Instanciación y exportación
const backupManager = new BackupManager(auth, logger, database, crypto, zlib, { createBackup, restoreBackup, getBackups, deleteBackup }); //  Pasa las dependencias
module.exports = backupManager;
