/**
 * services/backup/autoBackup.js
 * Sistema de respaldo automático para FactuSystem
 * 
 * Este módulo se encarga de:
 * - Programar y ejecutar respaldos automáticos
 * - Gestionar respaldos locales y en la nube
 * - Integrar con el sistema de offline/online sync
 * - Mantener historial de respaldos
 */

const fs = require('fs-extra');
const path = require('path');
const archiver = require('archiver');
const dayjs = require('dayjs');
const cron = require('node-cron');
const { app, dialog } = require('electron');
const { ipcMain } = require('electron');
const logger = require('../audit/logger');
const cloudSync = require('./cloudSync');
const database = require('../../app/assets/js/utils/database');
const configManager = require('../../app/assets/js/modules/configuraciones/index');
const { getConnection } = require('../../app/assets/js/utils/database');

// Carpeta por defecto para respaldos
const DEFAULT_BACKUP_DIR = path.join(app.getPath('userData'), 'backups');

// Estado de las tareas programadas
let scheduledTasks = {};

/**
 * Inicializar sistema de respaldo automático
 * @param {Object} options - Opciones de configuración
 */
function init(options = {}) {
    // Asegurar que existe el directorio de respaldos
    fs.ensureDirSync(DEFAULT_BACKUP_DIR);
    
    // Cargar configuración
    const config = loadBackupConfig();
    
    // Programar tareas de respaldo basadas en la configuración
    scheduleBackupTasks(config);
    
    // Registrar listeners IPC para comunicación con el renderer
    registerIPCListeners();
    
    logger.info('Sistema de respaldo automático inicializado', { module: 'autoBackup' });
}

/**
 * Cargar configuración de respaldos
 * @returns {Object} Configuración de respaldos
 */
function loadBackupConfig() {
    try {
        // Intentar cargar desde la base de datos
        const db = getConnection();
        const config = db.prepare('SELECT * FROM configuraciones WHERE modulo = ?').get('backups');
        
        if (config && config.valor) {
            const parsedConfig = JSON.parse(config.valor);
            return parsedConfig;
        }
    } catch (error) {
        logger.error('Error al cargar configuración de respaldos', { 
            error: error.message, 
            module: 'autoBackup' 
        });
    }
    
    // Configuración por defecto si no se puede cargar
    return {
        schedule: '0 0 * * *', // Diario a medianoche (formato cron)
        keepLocal: 7,          // Mantener 7 copias locales
        cloudSync: true,       // Sincronizar con la nube
        includeDatabases: true,
        includeSettings: true,
        includeDocuments: true,
        compressionLevel: 9,   // Nivel máximo de compresión
        maxConcurrentBackups: 1
    };
}

/**
 * Guardar configuración de respaldos
 * @param {Object} config - Nueva configuración
 * @returns {Boolean} Éxito de la operación
 */
function saveBackupConfig(config) {
    try {
        const db = getConnection();
        const configString = JSON.stringify(config);
        
        const existingConfig = db.prepare('SELECT * FROM configuraciones WHERE modulo = ?').get('backups');
        
        if (existingConfig) {
            db.prepare('UPDATE configuraciones SET valor = ? WHERE modulo = ?')
                .run(configString, 'backups');
        } else {
            db.prepare('INSERT INTO configuraciones (modulo, valor) VALUES (?, ?)')
                .run('backups', configString);
        }
        
        // Reprogramar tareas con la nueva configuración
        scheduleBackupTasks(config);
        
        logger.info('Configuración de respaldos actualizada', { 
            config, 
            module: 'autoBackup' 
        });
        
        return true;
    } catch (error) {
        logger.error('Error al guardar configuración de respaldos', { 
            error: error.message, 
            config, 
            module: 'autoBackup' 
        });
        return false;
    }
}

/**
 * Programar tareas de respaldo según configuración
 * @param {Object} config - Configuración de respaldos
 */
function scheduleBackupTasks(config) {
    // Cancelar tareas existentes
    Object.keys(scheduledTasks).forEach(taskId => {
        if (scheduledTasks[taskId]) {
            scheduledTasks[taskId].stop();
            delete scheduledTasks[taskId];
        }
    });
    
    // Programar respaldo automático principal
    if (config.schedule) {
        try {
            const task = cron.schedule(config.schedule, () => {
                createBackup({
                    automatic: true,
                    config
                });
            });
            
            scheduledTasks.mainBackup = task;
            logger.info('Tarea de respaldo programada', { 
                schedule: config.schedule, 
                module: 'autoBackup' 
            });
        } catch (error) {
            logger.error('Error al programar tarea de respaldo', { 
                error: error.message, 
                schedule: config.schedule, 
                module: 'autoBackup' 
            });
        }
    }
    
    // Programar limpieza de respaldos antiguos (diariamente)
    const cleanupTask = cron.schedule('0 2 * * *', () => {
        cleanupOldBackups(config.keepLocal);
    });
    
    scheduledTasks.cleanup = cleanupTask;
}

/**
 * Crear un respaldo del sistema
 * @param {Object} options - Opciones del respaldo
 * @returns {Promise<Object>} Resultado del respaldo
 */
async function createBackup(options = {}) {
    const startTime = Date.now();
    const backupId = `backup_${dayjs().format('YYYYMMDD_HHmmss')}`;
    const config = options.config || loadBackupConfig();
    const isAutomatic = options.automatic || false;
    
    try {
        // Verificar si ya hay un respaldo en curso
        const activeBackups = getActiveBackupsCount();
        if (activeBackups >= config.maxConcurrentBackups) {
            logger.warn('No se pudo iniciar respaldo: ya hay respaldos en curso', { 
                active: activeBackups, 
                max: config.maxConcurrentBackups,
                module: 'autoBackup'
            });
            return { 
                success: false, 
                error: 'Ya hay respaldos en curso. Intente más tarde.'
            };
        }
        
        // Informar inicio del respaldo
        logger.info('Iniciando respaldo del sistema', { 
            backupId, 
            automatic: isAutomatic,
            module: 'autoBackup'
        });
        
        // Incrementar contador de respaldos activos
        incrementActiveBackups();
        
        // Crear directorio para este respaldo específico
        const backupDir = path.join(DEFAULT_BACKUP_DIR, backupId);
        fs.ensureDirSync(backupDir);
        
        // Archivo zip de salida
        const outputFile = path.join(DEFAULT_BACKUP_DIR, `${backupId}.zip`);
        const output = fs.createWriteStream(outputFile);
        const archive = archiver('zip', {
            zlib: { level: config.compressionLevel }
        });
        
        // Listeners para el proceso de archivado
        output.on('close', () => {
            const fileSize = archive.pointer();
            const duration = (Date.now() - startTime) / 1000;
            
            // Registrar resultado
            logger.info('Respaldo completado', { 
                backupId, 
                size: formatFileSize(fileSize),
                duration: `${duration.toFixed(2)}s`,
                module: 'autoBackup'
            });
            
            // Sincronizar con la nube si está configurado
            if (config.cloudSync) {
                cloudSync.uploadBackup(outputFile)
                    .then(result => {
                        logger.info('Respaldo sincronizado con la nube', { 
                            backupId, 
                            cloudLocation: result.location,
                            module: 'autoBackup'
                        });
                    })
                    .catch(error => {
                        logger.error('Error en sincronización con la nube', { 
                            backupId, 
                            error: error.message,
                            module: 'autoBackup'
                        });
                    });
            }
            
            // Limpiar directorio temporal
            fs.removeSync(backupDir);
            
            // Registrar en base de datos
            registerBackupInDatabase({
                id: backupId,
                path: outputFile,
                size: fileSize,
                date: new Date(),
                automatic: isAutomatic,
                cloudSync: config.cloudSync,
                duration
            });
            
            // Decrementar contador de respaldos activos
            decrementActiveBackups();
        });
        
        archive.on('error', (err) => {
            logger.error('Error durante la creación del respaldo', { 
                backupId, 
                error: err.message,
                module: 'autoBackup'
            });
            
            // Limpiar
            fs.removeSync(backupDir);
            decrementActiveBackups();
            
            throw err;
        });
        
        // Vincular archive con output
        archive.pipe(output);
        
        // 1. Respaldar bases de datos
        if (config.includeDatabases) {
            await backupDatabases(archive, backupDir);
        }
        
        // 2. Respaldar configuraciones
        if (config.includeSettings) {
            await backupSettings(archive, backupDir);
        }
        
        // 3. Respaldar documentos
        if (config.includeDocuments) {
            await backupDocuments(archive, backupDir);
        }
        
        // Finalizar el archivo
        await archive.finalize();
        
        return {
            success: true,
            backupId,
            path: outputFile
        };
        
    } catch (error) {
        logger.error('Error general en el proceso de respaldo', { 
            backupId, 
            error: error.message,
            stack: error.stack,
            module: 'autoBackup'
        });
        
        decrementActiveBackups();
        
        return {
            success: false,
            error: error.message,
            backupId
        };
    }
}

/**
 * Respaldar bases de datos
 * @param {Object} archive - Objeto archiver
 * @param {String} tempDir - Directorio temporal
 */
async function backupDatabases(archive, tempDir) {
    logger.info('Respaldando bases de datos', { module: 'autoBackup' });
    
    try {
        // Cerrar conexiones activas para poder hacer copia segura
        await database.closeAllConnections();
        
        // Obtener ruta de la base de datos principal
        const mainDbPath = database.getMainDbPath();
        const dbFileName = path.basename(mainDbPath);
        
        // Crear una copia de la base de datos en la carpeta temporal
        const tempDbPath = path.join(tempDir, dbFileName);
        await fs.copy(mainDbPath, tempDbPath);
        
        // Añadir al archivo zip
        archive.file(tempDbPath, { name: `databases/${dbFileName}` });
        
        // Buscar bases de datos de sucursales
        const dbDir = path.dirname(mainDbPath);
        const branchDbs = fs.readdirSync(dbDir)
            .filter(file => file.startsWith('branch_') && file.endsWith('.db'));
        
        // Añadir cada base de datos de sucursal
        for (const branchDb of branchDbs) {
            const branchPath = path.join(dbDir, branchDb);
            const tempBranchPath = path.join(tempDir, branchDb);
            
            await fs.copy(branchPath, tempBranchPath);
            archive.file(tempBranchPath, { name: `databases/${branchDb}` });
        }
        
        // Reabrir conexiones
        await database.initializeConnections();
        
        logger.info('Respaldo de bases de datos completado', { 
            dbCount: 1 + branchDbs.length,
            module: 'autoBackup'
        });
        
    } catch (error) {
        logger.error('Error al respaldar bases de datos', { 
            error: error.message,
            module: 'autoBackup'
        });
        
        // Asegurar que las conexiones se reabren en caso de error
        try {
            await database.initializeConnections();
        } catch (e) {
            logger.error('Error al reabrir conexiones de base de datos', { 
                error: e.message,
                module: 'autoBackup'
            });
        }
        
        throw error;
    }
}

/**
 * Respaldar configuraciones del sistema
 * @param {Object} archive - Objeto archiver
 * @param {String} tempDir - Directorio temporal
 */
async function backupSettings(archive, tempDir) {
    logger.info('Respaldando configuraciones', { module: 'autoBackup' });
    
    try {
        // Extraer configuraciones de la base de datos
        const db = getConnection();
        const configs = db.prepare('SELECT * FROM configuraciones').all();
        
        // Guardar en archivo JSON temporal
        const configPath = path.join(tempDir, 'configuraciones.json');
        await fs.writeJson(configPath, configs, { spaces: 2 });
        
        // Añadir al archivo zip
        archive.file(configPath, { name: 'settings/configuraciones.json' });
        
        // Respaldar archivos de configuración del usuario
        const userConfigDir = app.getPath('userData');
        const configFiles = fs.readdirSync(userConfigDir)
            .filter(file => file.endsWith('.json') || file.endsWith('.config'));
        
        for (const configFile of configFiles) {
            const filePath = path.join(userConfigDir, configFile);
            archive.file(filePath, { name: `settings/${configFile}` });
        }
        
        logger.info('Respaldo de configuraciones completado', { 
            configCount: configs.length,
            configFiles: configFiles.length,
            module: 'autoBackup'
        });
        
    } catch (error) {
        logger.error('Error al respaldar configuraciones', { 
            error: error.message,
            module: 'autoBackup'
        });
        throw error;
    }
}

/**
 * Respaldar documentos generados
 * @param {Object} archive - Objeto archiver
 * @param {String} tempDir - Directorio temporal
 */
async function backupDocuments(archive, tempDir) {
    logger.info('Respaldando documentos', { module: 'autoBackup' });
    
    try {
        const documentsDir = path.join(app.getPath('userData'), 'documents');
        
        // Verificar si existe el directorio
        if (!fs.existsSync(documentsDir)) {
            logger.info('No hay directorio de documentos para respaldar', { 
                module: 'autoBackup'
            });
            return;
        }
        
        // Añadir todo el directorio de documentos
        archive.directory(documentsDir, 'documents');
        
        // Contar documentos para el log
        let docCount = 0;
        const countFiles = (dir) => {
            const files = fs.readdirSync(dir);
            for (const file of files) {
                const fullPath = path.join(dir, file);
                if (fs.statSync(fullPath).isDirectory()) {
                    countFiles(fullPath);
                } else {
                    docCount++;
                }
            }
        };
        
        countFiles(documentsDir);
        
        logger.info('Respaldo de documentos completado', { 
            documentCount: docCount,
            module: 'autoBackup'
        });
        
    } catch (error) {
        logger.error('Error al respaldar documentos', { 
            error: error.message,
            module: 'autoBackup'
        });
        throw error;
    }
}

/**
 * Registrar respaldo en la base de datos
 * @param {Object} backupInfo - Información del respaldo
 */
function registerBackupInDatabase(backupInfo) {
    try {
        const db = getConnection();
        
        db.prepare(`
            INSERT INTO respaldos 
            (id, ruta, tamano, fecha, automatico, nube, duracion) 
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
            backupInfo.id,
            backupInfo.path,
            backupInfo.size,
            backupInfo.date.toISOString(),
            backupInfo.automatic ? 1 : 0,
            backupInfo.cloudSync ? 1 : 0,
            backupInfo.duration
        );
        
    } catch (error) {
        logger.error('Error al registrar respaldo en base de datos', { 
            backupId: backupInfo.id,
            error: error.message,
            module: 'autoBackup'
        });
    }
}

/**
 * Limpiar respaldos antiguos
 * @param {Number} keepCount - Número de respaldos a mantener
 */
function cleanupOldBackups(keepCount = 7) {
    try {
        logger.info('Iniciando limpieza de respaldos antiguos', { 
            keepCount,
            module: 'autoBackup'
        });
        
        const db = getConnection();
        
        // Obtener respaldos ordenados por fecha (más recientes primero)
        const backups = db.prepare(`
            SELECT * FROM respaldos 
            ORDER BY fecha DESC
        `).all();
        
        // Mantener los más recientes y eliminar el resto
        if (backups.length > keepCount) {
            const toDelete = backups.slice(keepCount);
            
            for (const backup of toDelete) {
                // Eliminar archivo físico
                if (fs.existsSync(backup.ruta)) {
                    fs.removeSync(backup.ruta);
                }
                
                // Eliminar registro de la base de datos
                db.prepare('DELETE FROM respaldos WHERE id = ?')
                    .run(backup.id);
                
                logger.info('Respaldo antiguo eliminado', { 
                    backupId: backup.id,
                    date: backup.fecha,
                    module: 'autoBackup'
                });
            }
            
            logger.info('Limpieza de respaldos completada', { 
                deleted: toDelete.length,
                remaining: keepCount,
                module: 'autoBackup'
            });
        } else {
            logger.info('No se requiere limpieza de respaldos', { 
                current: backups.length,
                threshold: keepCount,
                module: 'autoBackup'
            });
        }
    } catch (error) {
        logger.error('Error en limpieza de respaldos antiguos', { 
            error: error.message,
            module: 'autoBackup'
        });
    }
}

/**
 * Restaurar desde un respaldo
 * @param {String} backupPath - Ruta al archivo de respaldo
 * @returns {Promise<Object>} Resultado de la restauración
 */
async function restoreFromBackup(backupPath) {
    const startTime = Date.now();
    const restoreId = `restore_${dayjs().format('YYYYMMDD_HHmmss')}`;
    
    try {
        logger.info('Iniciando restauración desde respaldo', { 
            backupPath,
            restoreId,
            module: 'autoBackup'
        });
        
        // Crear directorio temporal para extracción
        const tempDir = path.join(app.getPath('temp'), restoreId);
        fs.ensureDirSync(tempDir);
        
        // Extraer el archivo zip
        await extractBackup(backupPath, tempDir);
        
        // Cerrar conexiones a la base de datos
        await database.closeAllConnections();
        
        // Restaurar bases de datos
        const dbResult = await restoreDatabases(tempDir);
        
        // Restaurar configuraciones
        const configResult = await restoreSettings(tempDir);
        
        // Restaurar documentos (si existen)
        const docsResult = await restoreDocuments(tempDir);
        
        // Reabrir conexiones
        await database.initializeConnections();
        
        // Limpiar directorio temporal
        fs.removeSync(tempDir);
        
        const duration = (Date.now() - startTime) / 1000;
        
        logger.info('Restauración completada exitosamente', { 
            restoreId,
            duration: `${duration.toFixed(2)}s`,
            databases: dbResult,
            configurations: configResult,
            documents: docsResult,
            module: 'autoBackup'
        });
        
        return {
            success: true,
            restoreId,
            duration,
            details: {
                databases: dbResult,
                configurations: configResult,
                documents: docsResult
            }
        };
        
    } catch (error) {
        logger.error('Error en proceso de restauración', { 
            restoreId,
            backupPath,
            error: error.message,
            stack: error.stack,
            module: 'autoBackup'
        });
        
        // Asegurar que las conexiones se reabren en caso de error
        try {
            await database.initializeConnections();
        } catch (e) {
            logger.error('Error al reabrir conexiones durante restauración', { 
                error: e.message,
                module: 'autoBackup'
            });
        }
        
        return {
            success: false,
            error: error.message,
            restoreId
        };
    }
}

/**
 * Extraer archivo de respaldo
 * @param {String} backupPath - Ruta al archivo de respaldo
 * @param {String} destDir - Directorio destino
 */
async function extractBackup(backupPath, destDir) {
    return new Promise((resolve, reject) => {
        try {
            const extract = require('extract-zip');
            
            extract(backupPath, { dir: destDir })
                .then(() => {
                    logger.info('Archivo de respaldo extraído', { 
                        backupPath,
                        destDir,
                        module: 'autoBackup'
                    });
                    resolve();
                })
                .catch(err => {
                    logger.error('Error al extraer archivo de respaldo', { 
                        backupPath,
                        error: err.message,
                        module: 'autoBackup'
                    });
                    reject(err);
                });
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * Restaurar bases de datos desde respaldo
 * @param {String} extractDir - Directorio de extracción
 * @returns {Object} Resultado de la restauración
 */
async function restoreDatabases(extractDir) {
    const dbDir = path.join(extractDir, 'databases');
    
    // Verificar si existe el directorio de bases de datos
    if (!fs.existsSync(dbDir)) {
        logger.warn('No se encontraron bases de datos en el respaldo', { 
            module: 'autoBackup'
        });
        return { restored: 0 };
    }
    
    // Obtener archivos de base de datos
    const dbFiles = fs.readdirSync(dbDir)
        .filter(file => file.endsWith('.db'));
    
    if (dbFiles.length === 0) {
        logger.warn('No se encontraron archivos de base de datos', { 
            module: 'autoBackup'
        });
        return { restored: 0 };
    }
    
    // Restaurar cada base de datos
    const mainDbPath = database.getMainDbPath();
    const targetDir = path.dirname(mainDbPath);
    let restoredCount = 0;
    
    for (const dbFile of dbFiles) {
        const sourcePath = path.join(dbDir, dbFile);
        const targetPath = path.join(targetDir, dbFile);
        
        // Crear respaldo de la base de datos actual antes de sobrescribirla
        if (fs.existsSync(targetPath)) {
            const backupPath = `${targetPath}.bak.${Date.now()}`;
            await fs.copy(targetPath, backupPath);
            logger.info('Backup de seguridad creado antes de restaurar', { 
                original: targetPath,
                backup: backupPath,
                module: 'autoBackup'
            });
        }
        
        // Copiar base de datos del respaldo
        await fs.copy(sourcePath, targetPath);
        restoredCount++;
        
        logger.info('Base de datos restaurada', { 
            db: dbFile,
            module: 'autoBackup'
        });
    }
    
    return { restored: restoredCount };
}

/**
 * Restaurar configuraciones desde respaldo
 * @param {String} extractDir - Directorio de extracción
 * @returns {Object} Resultado de la restauración
 */
async function restoreSettings(extractDir) {
    const settingsDir = path.join(extractDir, 'settings');
    
    // Verificar si existe el directorio de configuraciones
    if (!fs.existsSync(settingsDir)) {
        logger.warn('No se encontraron configuraciones en el respaldo', { 
            module: 'autoBackup'
        });
        return { restored: 0 };
    }
    
    // Restaurar configuraciones JSON
    const configPath = path.join(settingsDir, 'configuraciones.json');
    let configCount = 0;
    
    if (fs.existsSync(configPath)) {
        try {
            const configs = await fs.readJson(configPath);
            const db = database.getConnection();
            
            // Primero hacemos backup de las configuraciones actuales
            const currentConfigs = db.prepare('SELECT * FROM configuraciones').all();
            await fs.writeJson(
                path.join(app.getPath('userData'), `configuraciones.bak.${Date.now()}.json`),
                currentConfigs,
                { spaces: 2 }
            );
            
            // Limpiar configuraciones existentes y restaurar
            db.prepare('DELETE FROM configuraciones').run();
            
            for (const config of configs) {
                db.prepare(`
                    INSERT INTO configuraciones (modulo, valor) 
                    VALUES (?, ?)
                `).run(config.modulo, config.valor);
                configCount++;
            }
            
            logger.info('Configuraciones restauradas desde JSON', { 
                count: configCount,
                module: 'autoBackup'
            });
            
        } catch (error) {
            logger.error('Error al restaurar configuraciones JSON', { 
                error: error.message,
                module: 'autoBackup'
            });
        }
    }
    
    // Restaurar archivos de configuración
    const userConfigDir = app.getPath('userData');
    const configFiles = fs.readdirSync(settingsDir)
        .filter(file => file !== 'configuraciones.json');
    
    let fileCount = 0;
    
    for (const file of configFiles) {
        try {
            const sourcePath = path.join(settingsDir, file);
            const targetPath = path.join(userConfigDir, file);
            
            // Crear respaldo del archivo actual
            if (fs.existsSync(targetPath)) {
                const backupPath = `${targetPath}.bak.${Date.now()}`;
                await fs.copy(targetPath, backupPath);
            }
            
            // Copiar archivo de configuración
            await fs.copy(sourcePath, targetPath);
            fileCount++;
            
        } catch (error) {
            logger.error('Error al restaurar archivo de configuración', { 
                file,
                error: error.message,
                module: 'autoBackup'
            });
        }
    }
    
    logger.info('Archivos de configuración restaurados', { 
        count: fileCount,
        module: 'autoBackup'
    });
    
    return { 
        restoredConfigs: configCount,
        restoredFiles: fileCount 
    };
}

/**
 * Restaurar documentos desde respaldo
 * @param {String} extractDir - Directorio de extracción
 * @returns {Object} Resultado de la restauración
 */
async function restoreDocuments(extractDir) {
    const docsDir = path.join(extractDir, 'documents');
    
    // Verificar si existe el directorio de documentos
    if (!fs.existsSync(docsDir)) {
        logger.info('No se encontraron documentos en el respaldo', { 
            module: 'autoBackup'
        });
        return { restored: 0 };
    }
    
    // Directorio destino para documentos
    const targetDir = path.join(app.getPath('userData'), 'documents');
    
    // Crear respaldo de documentos actuales
    if (fs.existsSync(targetDir)) {
        const backupDir = `${targetDir}.bak.${Date.now()}`;
        await fs.copy(targetDir, backupDir);
        logger.info('Backup de documentos creado antes de restaurar', { 
            original: targetDir,
            backup: backupDir,
            module: 'autoBackup'
        });
    } else {
        fs.ensureDirSync(targetDir);
    }
    
    // Copiar documentos del respaldo
    await fs.copy(docsDir, targetDir, { overwrite: true });
    
    // Contar documentos restaurados
    let docCount = 0;
    const countFiles = (dir) => {
        const files = fs.readdirSync(dir);
        for (const file of files) {
            const fullPath = path.join(dir, file);
            if (fs.statSync(fullPath).isDirectory()) {
                countFiles(fullPath);
            } else {
                docCount++;
            }
        }
    };
    
    countFiles(docsDir);
    
    logger.info('Documentos restaurados', { 
        count: docCount,
        module: 'autoBackup'
    });
    
    return { restored: docCount };
}

/**
 * Listar todos los respaldos disponibles
 * @returns {Array} Lista de respaldos
 */
function listBackups() {
    try {
        const db = getConnection();
        const backups = db.prepare(`
            SELECT * FROM respaldos 
            ORDER BY fecha DESC
        `).all();
        
        // Verificar si los archivos físicos existen y añadir información
        return backups.map(backup => {
            const exists = fs.existsSync(backup.ruta);
            return {
                ...backup,
                fileExists: exists,
                formattedSize: formatFileSize(backup.tamano),
                formattedDate: dayjs(backup.fecha).format('DD/MM/YYYY HH:mm:ss')
            };
        });
    } catch (error) {
        logger.error('Error al listar respaldos', { 
            error: error.message,
            module: 'autoBackup'
        });
        return [];
    }
}

/**
 * Eliminar un respaldo
 * @param {String} backupId - ID del respaldo a eliminar
 * @returns {Boolean} Éxito de la operación
 */
function deleteBackup(backupId) {
    try {
        const db = getConnection();
        
        // Obtener información del respaldo
        const backup = db.prepare('SELECT * FROM respaldos WHERE id = ?')
            .get(backupId);
        
        if (!backup) {
            logger.warn('Intento de eliminar un respaldo inexistente', { 
                backupId,
                module: 'autoBackup'
            });
            return false;
        }
        
        // Eliminar archivo físico
        if (fs.existsSync(backup.ruta)) {
            fs.removeSync(backup.ruta);
        }
        
        // Eliminar de la nube si está allí
        if (backup.nube === 1) {
            cloudSync.deleteBackup(backupId)
                .catch(error => {
                    logger.error('Error al eliminar respaldo de la nube', { 
                        backupId,
                        error: error.message,
                        module: 'autoBackup'
                    });
                });
        }
        
        // Eliminar registro de la base de datos
        db.prepare('DELETE FROM respaldos WHERE id = ?')
            .run(backupId);
        
        logger.info('Respaldo eliminado', { 
            backupId,
            module: 'autoBackup'
        });
        
        return true;
    } catch (error) {
        logger.error('Error al eliminar respaldo', { 
            backupId,
            error: error.message,
            module: 'autoBackup'
        });
        return false;
    }
}

/**
 * Obtener contador de respaldos activos
 * @returns {Number} Número de respaldos activos
 */
function getActiveBackupsCount() {
    try {
        const db = getConnection();
        const result = db.prepare('SELECT valor FROM system_state WHERE clave = ?')
            .get('active_backups');
        
        return result ? parseInt(result.valor, 10) : 0;
    } catch (error) {
        logger.error('Error al obtener contador de respaldos activos', { 
            error: error.message,
            module: 'autoBackup'
        });
        return 0;
    }
}

/**
 * Incrementar contador de respaldos activos
 */
function incrementActiveBackups() {
    try {
        const db = getConnection();
        const currentCount = getActiveBackupsCount();
        
        const existingRecord = db.prepare('SELECT * FROM system_state WHERE clave = ?')
            .get('active_backups');
        
        if (existingRecord) {
            db.prepare('UPDATE system_state SET valor = ? WHERE clave = ?')
                .run((currentCount + 1).toString(), 'active_backups');
        } else {
            db.prepare('INSERT INTO system_state (clave, valor) VALUES (?, ?)')
                .run('active_backups', '1');
        }
    } catch (error) {
        logger.error('Error al incrementar contador de respaldos activos', { 
            error: error.message,
            module: 'autoBackup'
        });
    }
}

/**
 * Decrementar contador de respaldos activos
 */
function decrementActiveBackups() {
    try {
        const db = getConnection();
        const currentCount = getActiveBackupsCount();
        
        if (currentCount > 0) {
            db.prepare('UPDATE system_state SET valor = ? WHERE clave = ?')
                .run((currentCount - 1).toString(), 'active_backups');
        }
    } catch (error) {
        logger.error('Error al decrementar contador de respaldos activos', { 
            error: error.message,
            module: 'autoBackup'
        });
    }
}

/**
 * Formatear tamaño de archivo a formato legible
 * @param {Number} bytes - Tamaño en bytes
 * @returns {String} Tamaño formateado
 */
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Registrar listeners IPC para comunicación con el renderer
 */
function registerIPCListeners() {
    // Obtener configuración de respaldos
    ipcMain.handle('backup:getConfig', async () => {
        return loadBackupConfig();
    });
    
    // Guardar configuración de respaldos
    ipcMain.handle('backup:saveConfig', async (event, config) => {
        return saveBackupConfig(config);
    });
    
    // Crear respaldo manual
    ipcMain.handle('backup:create', async (event, options) => {
        return createBackup({
            ...options,
            automatic: false
        });
    });
    
    // Listar respaldos
    ipcMain.handle('backup:list', async () => {
        return listBackups();
    });
    
    // Eliminar respaldo
    ipcMain.handle('backup:delete', async (event, backupId) => {
        return deleteBackup(backupId);
    });
    
    // Restaurar desde respaldo
    ipcMain.handle('backup:restore', async (event, backupPath) => {
        // Mostrar diálogo de confirmación desde el proceso principal
        const { response } = await dialog.showMessageBox({
            type: 'warning',
            title: 'Restaurar Sistema',
            message: 'Está a punto de restaurar el sistema desde un respaldo.',
            detail: 'Esta acción reemplazará todos los datos actuales. ¿Está seguro de continuar?',
            buttons: ['Cancelar', 'Restaurar'],
            defaultId: 0,
            cancelId: 0
        });
        
        if (response === 1) { // "Restaurar" fue seleccionado
            return restoreFromBackup(backupPath);
        } else {
            return { 
                success: false, 
                canceled: true 
            };
        }
    });
    
    // Seleccionar directorio para backup manual
    ipcMain.handle('backup:selectDirectory', async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog({
            title: 'Seleccione directorio para respaldo',
            properties: ['openDirectory']
        });
        
        if (canceled) {
            return { success: false, canceled: true };
        }
        
        return { 
            success: true, 
            directory: filePaths[0] 
        };
    });
    
    // Seleccionar archivo de respaldo para restaurar
    ipcMain.handle('backup:selectBackupFile', async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog({
            title: 'Seleccione archivo de respaldo',
            filters: [
                { name: 'Archivos de respaldo', extensions: ['zip'] }
            ],
            properties: ['openFile']
        });
        
        if (canceled) {
            return { success: false, canceled: true };
        }
        
        return { 
            success: true, 
            file: filePaths[0] 
        };
    });
    
    logger.info('Listeners IPC registrados para sistema de respaldo', { 
        module: 'autoBackup'
    });
}

/**
 * Realizar un respaldo automático antes de actualizaciones del software
 * @returns {Promise<Object>} Resultado del respaldo
 */
async function backupBeforeUpdate() {
    logger.info('Iniciando respaldo antes de actualización', { 
        module: 'autoBackup'
    });
    
    return createBackup({
        automatic: true,
        config: {
            ...loadBackupConfig(),
            cloudSync: true, // Forzar sincronización con la nube para respaldos pre-actualización
        }
    });
}

/**
 * Verificar integridad de los respaldos
 * @returns {Object} Resultado de la verificación
 */
async function verifyBackupsIntegrity() {
    const results = {
        checked: 0,
        valid: 0,
        invalid: 0,
        details: []
    };

    try {
        logger.info('Verificando integridad de respaldos', { 
            module: 'autoBackup'
        });
        
        // Obtener lista de respaldos
        const backups = listBackups().filter(b => b.fileExists);
        
        for (const backup of backups) {
            try {
                results.checked++;
                
                // Verificar si el archivo ZIP es válido
                const yauzl = require('yauzl');
                
                const isValid = await new Promise((resolve) => {
                    yauzl.open(backup.ruta, { validateEntrySizes: true }, (err, zipfile) => {
                        if (err) {
                            logger.warn('Archivo de respaldo inválido o corrupto', { 
                                backupId: backup.id,
                                error: err.message,
                                module: 'autoBackup'
                            });
                            resolve(false);
                            return;
                        }
                        
                        zipfile.on('error', (err) => {
                            resolve(false);
                        });
                        
                        zipfile.on('entry', (entry) => {
                            // Solo verificamos que pueda leer las entradas
                        });
                        
                        zipfile.on('end', () => {
                            resolve(true);
                        });
                        
                        // No necesitamos leer todos los datos, solo verificar la estructura
                        zipfile.close();
                        resolve(true);
                    });
                });
                
                if (isValid) {
                    results.valid++;
                } else {
                    results.invalid++;
                }
                
                results.details.push({
                    id: backup.id,
                    path: backup.ruta,
                    date: backup.fecha,
                    valid: isValid
                });
                
            } catch (error) {
                logger.error('Error al verificar respaldo', { 
                    backupId: backup.id,
                    error: error.message,
                    module: 'autoBackup'
                });
                
                results.invalid++;
                results.details.push({
                    id: backup.id,
                    path: backup.ruta,
                    date: backup.fecha,
                    valid: false,
                    error: error.message
                });
            }
        }
        
        logger.info('Verificación de integridad completada', { 
            checked: results.checked,
            valid: results.valid,
            invalid: results.invalid,
            module: 'autoBackup'
        });
        
        return {
            success: true,
            ...results
        };
        
    } catch (error) {
        logger.error('Error general en verificación de integridad', { 
            error: error.message,
            module: 'autoBackup'
        });
        
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Reconstruir la base de datos de respaldos
 * Útil si la información de respaldos se ha perdido pero los archivos existen
 */
async function rebuildBackupsDatabase() {
    try {
        logger.info('Iniciando reconstrucción de base de datos de respaldos', { 
            module: 'autoBackup'
        });
        
        // Verificar que existe el directorio de respaldos
        if (!fs.existsSync(DEFAULT_BACKUP_DIR)) {
            return {
                success: false,
                error: 'No existe el directorio de respaldos'
            };
        }
        
        // Buscar archivos de respaldo
        const backupFiles = fs.readdirSync(DEFAULT_BACKUP_DIR)
            .filter(file => file.endsWith('.zip') && file.startsWith('backup_'));
        
        if (backupFiles.length === 0) {
            return {
                success: false,
                error: 'No se encontraron archivos de respaldo'
            };
        }
        
        // Limpiar tabla de respaldos actual
        const db = getConnection();
        db.prepare('DELETE FROM respaldos').run();
        
        // Registrar cada respaldo encontrado
        let registered = 0;
        
        for (const fileName of backupFiles) {
            try {
                const filePath = path.join(DEFAULT_BACKUP_DIR, fileName);
                const stats = fs.statSync(filePath);
                
                // Extraer ID y fecha del nombre del archivo
                const idMatch = fileName.match(/backup_(\d{8}_\d{6})/);
                if (!idMatch) continue;
                
                const backupId = `backup_${idMatch[1]}`;
                
                // Convertir la fecha del nombre del archivo a objeto Date
                const dateStr = idMatch[1];
                const year = dateStr.substring(0, 4);
                const month = dateStr.substring(4, 6);
                const day = dateStr.substring(6, 8);
                const hour = dateStr.substring(9, 11);
                const minute = dateStr.substring(11, 13);
                const second = dateStr.substring(13, 15);
                
                const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
                
                // Registrar en la base de datos
                db.prepare(`
                    INSERT INTO respaldos 
                    (id, ruta, tamano, fecha, automatico, nube, duracion) 
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `).run(
                    backupId,
                    filePath,
                    stats.size,
                    date.toISOString(),
                    0, // No sabemos si fue automático, asumimos manual
                    0, // No sabemos si está en la nube
                    0  // No conocemos la duración
                );
                
                registered++;
                
                logger.info('Respaldo registrado en reconstrucción', { 
                    backupId,
                    filePath,
                    module: 'autoBackup'
                });
                
            } catch (error) {
                logger.error('Error al registrar respaldo en reconstrucción', { 
                    fileName,
                    error: error.message,
                    module: 'autoBackup'
                });
            }
        }
        
        logger.info('Reconstrucción de base de datos de respaldos completada', { 
            total: backupFiles.length,
            registered,
            module: 'autoBackup'
        });
        
        return {
            success: true,
            total: backupFiles.length,
            registered
        };
        
    } catch (error) {
        logger.error('Error en reconstrucción de base de datos de respaldos', { 
            error: error.message,
            module: 'autoBackup'
        });
        
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Exportar un respaldo a un directorio específico
 * @param {String} backupId - ID del respaldo a exportar
 * @param {String} destDir - Directorio destino
 * @returns {Promise<Object>} Resultado de la exportación
 */
async function exportBackup(backupId, destDir) {
    try {
        logger.info('Iniciando exportación de respaldo', { 
            backupId,
            destDir,
            module: 'autoBackup'
        });
        
        // Buscar información del respaldo
        const db = getConnection();
        const backup = db.prepare('SELECT * FROM respaldos WHERE id = ?')
            .get(backupId);
        
        if (!backup) {
            return {
                success: false,
                error: 'Respaldo no encontrado'
            };
        }
        
        // Verificar que el archivo existe
        if (!fs.existsSync(backup.ruta)) {
            return {
                success: false,
                error: 'El archivo de respaldo no existe'
            };
        }
        
        // Verificar que el directorio destino existe
        if (!fs.existsSync(destDir)) {
            return {
                success: false,
                error: 'El directorio destino no existe'
            };
        }
        
        // Crear nombre de archivo para el respaldo exportado
        const fileName = `FactuSystem_${backup.id}.zip`;
        const destPath = path.join(destDir, fileName);
        
        // Copiar archivo
        await fs.copy(backup.ruta, destPath);
        
        logger.info('Respaldo exportado exitosamente', { 
            backupId,
            destPath,
            module: 'autoBackup'
        });
        
        return {
            success: true,
            backupId,
            path: destPath
        };
        
    } catch (error) {
        logger.error('Error al exportar respaldo', { 
            backupId,
            destDir,
            error: error.message,
            module: 'autoBackup'
        });
        
        return {
            success: false,
            error: error.message
        };
    }
}

// Exportar métodos públicos del módulo
module.exports = {
    init,
    createBackup,
    restoreFromBackup,
    listBackups,
    deleteBackup,
    loadBackupConfig,
    saveBackupConfig,
    backupBeforeUpdate,
    verifyBackupsIntegrity,
    rebuildBackupsDatabase,
    exportBackup
};