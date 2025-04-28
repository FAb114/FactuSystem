/**
 * FactuSystem - Sistema de Facturación y Gestión Comercial Multisucursal
 * Módulo de Recuperación de Respaldos
 * 
 * Este módulo maneja la recuperación de copias de seguridad, validando
 * su integridad y restaurando los datos en el sistema.
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const crypto = require('crypto');
const archiver = require('archiver');
const extract = require('extract-zip');
const { ipcMain } = require('electron');
const axios = require('axios');
const { dialog } = require('electron').remote || require('@electron/remote');

// Importaciones internas
const db = require('../../app/assets/js/utils/database');
const logger = require('../audit/logger');
const dbSchema = require('../../db/schema');
const cloudSync = require('./cloudSync');
const { getAppDataPath, getCurrentVersion } = require('../../app/assets/js/utils/app');

// Configuración
const BACKUP_EXTENSION = '.factubackup';
const TEMP_EXTRACT_DIR = path.join(getAppDataPath(), 'temp_restore');
const BACKUP_METADATA_FILE = 'metadata.json';
const DB_BACKUP_FILE = 'database.sqlite';
const CONFIG_BACKUP_FILE = 'config.json';
const ASSETS_BACKUP_DIR = 'assets';

/**
 * Clase para gestionar la recuperación de respaldos
 */
class RecoveryManager {
  constructor() {
    this.tempDir = TEMP_EXTRACT_DIR;
    this.registerEvents();
  }

  /**
   * Registra los eventos IPC para la comunicación con el renderer
   */
  registerEvents() {
    ipcMain.handle('backup:listAvailable', this.listAvailableBackups.bind(this));
    ipcMain.handle('backup:restore', (event, backupPath) => this.restoreBackup(backupPath));
    ipcMain.handle('backup:restoreFromCloud', (event, backupId) => this.restoreFromCloud(backupId));
    ipcMain.handle('backup:selectAndRestore', this.selectAndRestoreBackup.bind(this));
    ipcMain.handle('backup:validateBackup', (event, backupPath) => this.validateBackup(backupPath));
  }

  /**
   * Lista los respaldos disponibles localmente
   * @returns {Promise<Array>} Lista de respaldos disponibles
   */
  async listAvailableBackups() {
    try {
      const backupDir = path.join(getAppDataPath(), 'backups');
      
      if (!fs.existsSync(backupDir)) {
        return [];
      }
      
      const files = fs.readdirSync(backupDir)
        .filter(file => file.endsWith(BACKUP_EXTENSION));
      
      const backups = [];
      
      for (const file of files) {
        try {
          const filePath = path.join(backupDir, file);
          const stats = fs.statSync(filePath);
          const metaData = await this.extractMetadata(filePath);
          
          backups.push({
            path: filePath,
            filename: file,
            size: stats.size,
            created: stats.birthtime,
            version: metaData?.version || 'Desconocida',
            description: metaData?.description || '',
            sucursal: metaData?.sucursal || 'Principal',
            isValid: metaData !== null
          });
        } catch (error) {
          logger.error(`Error al procesar backup ${file}:`, error);
        }
      }
      
      return backups.sort((a, b) => b.created - a.created);
    } catch (error) {
      logger.error('Error al listar respaldos disponibles:', error);
      throw new Error('No se pudieron listar los respaldos');
    }
  }

  /**
   * Extrae los metadatos de un archivo de respaldo
   * @param {string} backupPath Ruta al archivo de respaldo
   * @returns {Promise<Object|null>} Metadatos del respaldo o null si hay error
   */
  async extractMetadata(backupPath) {
    try {
      // Crear directorio temporal si no existe
      if (!fs.existsSync(this.tempDir)) {
        fs.mkdirSync(this.tempDir, { recursive: true });
      }
      
      // Extraer sólo el archivo de metadatos
      await extract(backupPath, {
        dir: this.tempDir,
        onEntry: (entry) => {
          return entry.fileName === BACKUP_METADATA_FILE;
        }
      });
      
      // Leer metadatos
      const metadataPath = path.join(this.tempDir, BACKUP_METADATA_FILE);
      if (fs.existsSync(metadataPath)) {
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        
        // Limpiar directorio temporal
        fs.unlinkSync(metadataPath);
        
        return metadata;
      }
      
      return null;
    } catch (error) {
      logger.error('Error al extraer metadatos del respaldo:', error);
      return null;
    }
  }

  /**
   * Valida la integridad de un archivo de respaldo
   * @param {string} backupPath Ruta al archivo de respaldo
   * @returns {Promise<Object>} Resultado de la validación
   */
  async validateBackup(backupPath) {
    try {
      if (!fs.existsSync(backupPath)) {
        return { 
          valid: false, 
          error: 'El archivo de respaldo no existe' 
        };
      }

      const metadata = await this.extractMetadata(backupPath);
      
      if (!metadata) {
        return { 
          valid: false, 
          error: 'No se pudieron leer los metadatos del respaldo' 
        };
      }

      // Validar formato de los metadatos
      const requiredFields = ['version', 'createdAt', 'checksum', 'dbVersion'];
      for (const field of requiredFields) {
        if (!metadata[field]) {
          return { 
            valid: false, 
            error: `El respaldo no contiene el campo requerido: ${field}` 
          };
        }
      }

      // Extraer temporalmente para verificar checksum
      await this.extractBackup(backupPath);
      
      // Verificar checksum del archivo de base de datos
      const dbPath = path.join(this.tempDir, DB_BACKUP_FILE);
      if (!fs.existsSync(dbPath)) {
        this.cleanupTempFiles();
        return { 
          valid: false, 
          error: 'El respaldo no contiene la base de datos' 
        };
      }

      const fileBuffer = fs.readFileSync(dbPath);
      const hashSum = crypto.createHash('sha256');
      hashSum.update(fileBuffer);
      const calculatedChecksum = hashSum.digest('hex');

      // Limpiar archivos temporales
      this.cleanupTempFiles();
      
      // Verificar si el checksum coincide
      if (calculatedChecksum !== metadata.checksum) {
        return { 
          valid: false, 
          error: 'La integridad del respaldo está comprometida' 
        };
      }

      // Verificar compatibilidad de versiones
      const currentVersion = getCurrentVersion();
      if (this.isVersionIncompatible(metadata.version, currentVersion)) {
        return { 
          valid: true, 
          warning: `El respaldo es de la versión ${metadata.version} y la versión actual es ${currentVersion}. Puede haber problemas de compatibilidad.` 
        };
      }

      return { 
        valid: true, 
        metadata: metadata 
      };
    } catch (error) {
      logger.error('Error al validar respaldo:', error);
      this.cleanupTempFiles();
      return { 
        valid: false, 
        error: `Error al validar: ${error.message}` 
      };
    }
  }

  /**
   * Compara versiones para determinar compatibilidad
   * @param {string} backupVersion Versión del respaldo
   * @param {string} currentVersion Versión actual de la aplicación
   * @returns {boolean} Verdadero si las versiones son incompatibles
   */
  isVersionIncompatible(backupVersion, currentVersion) {
    try {
      // Convertir versiones a arrays de números
      const backupParts = backupVersion.split('.').map(Number);
      const currentParts = currentVersion.split('.').map(Number);
      
      // Verificar si hay diferencia en versión mayor
      return backupParts[0] !== currentParts[0];
    } catch (error) {
      logger.error('Error al comparar versiones:', error);
      return true; // Por seguridad, asumir incompatible
    }
  }

  /**
   * Extrae un archivo de respaldo en el directorio temporal
   * @param {string} backupPath Ruta al archivo de respaldo
   * @returns {Promise<void>}
   */
  async extractBackup(backupPath) {
    try {
      // Limpiar directorio temporal si existe
      if (fs.existsSync(this.tempDir)) {
        this.cleanupTempFiles();
      }
      
      // Crear directorio temporal
      fs.mkdirSync(this.tempDir, { recursive: true });
      
      // Extraer el archivo de respaldo
      await extract(backupPath, { dir: this.tempDir });
      
      return true;
    } catch (error) {
      logger.error('Error al extraer respaldo:', error);
      throw error;
    }
  }

  /**
   * Limpia los archivos temporales
   */
  cleanupTempFiles() {
    try {
      if (fs.existsSync(this.tempDir)) {
        const files = fs.readdirSync(this.tempDir);
        
        for (const file of files) {
          const filePath = path.join(this.tempDir, file);
          
          if (fs.lstatSync(filePath).isDirectory()) {
            // Eliminar recursivamente subcarpetas
            fs.rmdirSync(filePath, { recursive: true });
          } else {
            // Eliminar archivo
            fs.unlinkSync(filePath);
          }
        }
        
        fs.rmdirSync(this.tempDir, { recursive: true });
      }
    } catch (error) {
      logger.error('Error al limpiar archivos temporales:', error);
    }
  }

  /**
   * Restaura un respaldo desde un archivo local
   * @param {string} backupPath Ruta al archivo de respaldo
   * @returns {Promise<Object>} Resultado de la restauración
   */
  async restoreBackup(backupPath) {
    try {
      logger.info(`Iniciando restauración desde: ${backupPath}`);
      
      // Validar el respaldo
      const validation = await this.validateBackup(backupPath);
      
      if (!validation.valid) {
        return {
          success: false,
          error: validation.error
        };
      }
      
      // Extraer el respaldo
      await this.extractBackup(backupPath);
      
      // Verificar archivos esenciales
      const dbPath = path.join(this.tempDir, DB_BACKUP_FILE);
      const configPath = path.join(this.tempDir, CONFIG_BACKUP_FILE);
      
      if (!fs.existsSync(dbPath)) {
        this.cleanupTempFiles();
        return {
          success: false,
          error: 'El respaldo no contiene la base de datos'
        };
      }
      
      // Cerrar conexiones de la base de datos actual
      await db.close();
      
      // Hacer copia de seguridad de la base de datos actual antes de restaurar
      await this.backupCurrentDatabase();
      
      // Restaurar la base de datos
      const dbRestored = await this.restoreDatabase(dbPath);
      if (!dbRestored.success) {
        return dbRestored;
      }
      
      // Restaurar configuraciones si existen
      if (fs.existsSync(configPath)) {
        await this.restoreConfig(configPath);
      }
      
      // Restaurar activos si existen
      const assetsDir = path.join(this.tempDir, ASSETS_BACKUP_DIR);
      if (fs.existsSync(assetsDir)) {
        await this.restoreAssets(assetsDir);
      }
      
      // Ejecutar migraciones necesarias
      const migrationResult = await this.runMigrations(validation.metadata.dbVersion);
      
      // Limpiar archivos temporales
      this.cleanupTempFiles();
      
      // Reiniciar conexión de la base de datos
      await db.initialize();
      
      logger.info('Restauración completada exitosamente');
      
      return {
        success: true,
        message: 'Restauración completada exitosamente',
        migrations: migrationResult
      };
    } catch (error) {
      logger.error('Error en la restauración:', error);
      
      // Intentar restaurar la copia de seguridad previa en caso de error
      await this.restoreFromPreRestoreBackup();
      
      return {
        success: false,
        error: `Error al restaurar: ${error.message}`
      };
    }
  }

  /**
   * Hace una copia de seguridad de la base de datos actual antes de restaurar
   * @returns {Promise<void>}
   */
  async backupCurrentDatabase() {
    try {
      const dbPath = db.getDbPath();
      const preRestoreDir = path.join(getAppDataPath(), 'pre_restore_backup');
      
      if (!fs.existsSync(preRestoreDir)) {
        fs.mkdirSync(preRestoreDir, { recursive: true });
      }
      
      const timestamp = new Date().getTime();
      const backupPath = path.join(preRestoreDir, `pre_restore_${timestamp}.sqlite`);
      
      // Copiar base de datos actual
      fs.copyFileSync(dbPath, backupPath);
      
      // Guardar metadata
      const metadataPath = path.join(preRestoreDir, 'pre_restore_info.json');
      fs.writeFileSync(metadataPath, JSON.stringify({
        originalDbPath: dbPath,
        backupPath: backupPath,
        timestamp: timestamp,
        appVersion: getCurrentVersion()
      }));
      
      logger.info(`Copia de seguridad previa a restauración creada en: ${backupPath}`);
      
      return true;
    } catch (error) {
      logger.error('Error al crear copia de seguridad pre-restauración:', error);
      return false;
    }
  }

  /**
   * Restaura la base de datos desde una copia previa en caso de error
   * @returns {Promise<boolean>}
   */
  async restoreFromPreRestoreBackup() {
    try {
      const preRestoreDir = path.join(getAppDataPath(), 'pre_restore_backup');
      const metadataPath = path.join(preRestoreDir, 'pre_restore_info.json');
      
      if (!fs.existsSync(metadataPath)) {
        logger.error('No se encontró información de respaldo pre-restauración');
        return false;
      }
      
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      
      if (!fs.existsSync(metadata.backupPath)) {
        logger.error('No se encontró el archivo de respaldo pre-restauración');
        return false;
      }
      
      // Copiar el respaldo de vuelta
      fs.copyFileSync(metadata.backupPath, metadata.originalDbPath);
      
      logger.info('Base de datos restaurada desde copia de seguridad previa');
      
      return true;
    } catch (error) {
      logger.error('Error al restaurar desde copia previa:', error);
      return false;
    }
  }

  /**
   * Restaura la base de datos desde un respaldo
   * @param {string} dbBackupPath Ruta al archivo de base de datos del respaldo
   * @returns {Promise<Object>} Resultado de la restauración
   */
  async restoreDatabase(dbBackupPath) {
    try {
      const appDbPath = db.getDbPath();
      
      // Copiar el archivo de la base de datos
      fs.copyFileSync(dbBackupPath, appDbPath);
      
      logger.info('Base de datos restaurada correctamente');
      
      return {
        success: true
      };
    } catch (error) {
      logger.error('Error al restaurar la base de datos:', error);
      
      return {
        success: false,
        error: `Error al restaurar la base de datos: ${error.message}`
      };
    }
  }

  /**
   * Restaura el archivo de configuración
   * @param {string} configPath Ruta al archivo de configuración del respaldo
   * @returns {Promise<boolean>} Resultado de la restauración
   */
  async restoreConfig(configPath) {
    try {
      const appConfigPath = path.join(getAppDataPath(), 'config.json');
      
      // Leer configuración actual y de respaldo
      const currentConfig = fs.existsSync(appConfigPath) 
        ? JSON.parse(fs.readFileSync(appConfigPath, 'utf8')) 
        : {};
      
      const backupConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      
      // Preservar configuraciones sensibles que no deberían restaurarse
      const preservedSettings = [
        'serverUrl',
        'installationId',
        'licenseKey',
        'deviceName'
      ];
      
      for (const key of preservedSettings) {
        if (currentConfig[key]) {
          backupConfig[key] = currentConfig[key];
        }
      }
      
      // Guardar la nueva configuración
      fs.writeFileSync(appConfigPath, JSON.stringify(backupConfig, null, 2));
      
      logger.info('Configuración restaurada correctamente');
      
      return true;
    } catch (error) {
      logger.error('Error al restaurar configuración:', error);
      return false;
    }
  }

  /**
   * Restaura los archivos de activos (imágenes, etc.)
   * @param {string} assetsDir Directorio de activos en el respaldo
   * @returns {Promise<boolean>} Resultado de la restauración
   */
  async restoreAssets(assetsDir) {
    try {
      const appAssetsDir = path.join(getAppDataPath(), 'assets');
      
      // Crear directorio de activos si no existe
      if (!fs.existsSync(appAssetsDir)) {
        fs.mkdirSync(appAssetsDir, { recursive: true });
      }
      
      // Copiar directorios específicos
      const directories = ['products', 'logos', 'signatures'];
      
      for (const dir of directories) {
        const sourceDir = path.join(assetsDir, dir);
        const targetDir = path.join(appAssetsDir, dir);
        
        if (fs.existsSync(sourceDir)) {
          // Crear directorio destino si no existe
          if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
          }
          
          // Copiar archivos
          const files = fs.readdirSync(sourceDir);
          for (const file of files) {
            const sourcePath = path.join(sourceDir, file);
            const targetPath = path.join(targetDir, file);
            
            if (fs.lstatSync(sourcePath).isFile()) {
              fs.copyFileSync(sourcePath, targetPath);
            }
          }
        }
      }
      
      logger.info('Archivos de activos restaurados correctamente');
      
      return true;
    } catch (error) {
      logger.error('Error al restaurar activos:', error);
      return false;
    }
  }

  /**
   * Ejecuta las migraciones necesarias para actualizar la base de datos
   * @param {string} backupDbVersion Versión de la base de datos del respaldo
   * @returns {Promise<Object>} Resultado de las migraciones
   */
  async runMigrations(backupDbVersion) {
    try {
      const currentDbVersion = dbSchema.getCurrentVersion();
      
      // Si la versión es la misma, no hay migraciones que ejecutar
      if (backupDbVersion === currentDbVersion) {
        return {
          migrationsRun: 0,
          message: 'No se requieren migraciones'
        };
      }
      
      // Ejecutar migraciones
      const migrations = await dbSchema.migrateFromVersion(backupDbVersion);
      
      logger.info(`Migraciones ejecutadas: ${migrations.length}`);
      
      return {
        migrationsRun: migrations.length,
        message: `Se ejecutaron ${migrations.length} migraciones`
      };
    } catch (error) {
      logger.error('Error al ejecutar migraciones:', error);
      
      return {
        success: false,
        error: `Error al ejecutar migraciones: ${error.message}`
      };
    }
  }

  /**
   * Abre un diálogo para seleccionar un archivo de respaldo y lo restaura
   * @returns {Promise<Object>} Resultado de la restauración
   */
  async selectAndRestoreBackup() {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Seleccionar archivo de respaldo',
        filters: [
          { name: 'Respaldos FactuSystem', extensions: [BACKUP_EXTENSION.replace('.', '')] }
        ],
        properties: ['openFile']
      });
      
      if (result.canceled || result.filePaths.length === 0) {
        return {
          success: false,
          canceled: true
        };
      }
      
      const backupPath = result.filePaths[0];
      return await this.restoreBackup(backupPath);
      
    } catch (error) {
      logger.error('Error al seleccionar respaldo:', error);
      
      return {
        success: false,
        error: `Error al seleccionar respaldo: ${error.message}`
      };
    }
  }

  /**
   * Restaura un respaldo desde la nube
   * @param {string} backupId ID del respaldo en la nube
   * @returns {Promise<Object>} Resultado de la restauración
   */
  async restoreFromCloud(backupId) {
    try {
      logger.info(`Iniciando restauración desde la nube. ID: ${backupId}`);
      
      // Descargar respaldo desde la nube
      const downloadPath = await cloudSync.downloadBackup(backupId);
      
      if (!downloadPath) {
        return {
          success: false,
          error: 'No se pudo descargar el respaldo desde la nube'
        };
      }
      
      // Restaurar desde el archivo descargado
      const result = await this.restoreBackup(downloadPath);
      
      // Eliminar archivo temporal descargado
      try {
        if (fs.existsSync(downloadPath)) {
          fs.unlinkSync(downloadPath);
        }
      } catch (error) {
        logger.error('Error al eliminar archivo temporal:', error);
      }
      
      return result;
      
    } catch (error) {
      logger.error('Error al restaurar desde la nube:', error);
      
      return {
        success: false,
        error: `Error al restaurar desde la nube: ${error.message}`
      };
    }
  }

  /**
   * Lista los respaldos disponibles en la nube
   * @returns {Promise<Array>} Lista de respaldos en la nube
   */
  async listCloudBackups() {
    try {
      return await cloudSync.listAvailableBackups();
    } catch (error) {
      logger.error('Error al listar respaldos en la nube:', error);
      throw error;
    }
  }
}

// Exportar instancia única
module.exports = new RecoveryManager();