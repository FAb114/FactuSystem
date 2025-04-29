/**
 * cloudSync.js
 * Servicio para sincronización de respaldos en la nube
 * FactuSystem - Sistema de Facturación y Gestión Comercial Multisucursal
 * 
 * Este módulo gestiona:
 * - Sincronización automática de respaldos con servicios en la nube
 * - Configuración de credenciales para servicios cloud
 * - Encriptación de datos sensibles
 * - Programación de sincronización periódica
 * - Gestión de errores y reintentos
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ipcMain } = require('electron');
const axios = require('axios');
const FormData = require('form-data');
const { promisify } = require('util');
const { getAppDataPath } = require('../auth/login');
const logger = require('../audit/logger');
const { getStoreValue, setStoreValue } = require('../../app/assets/js/utils/database');
const { isOnline } = require('../../app/assets/js/utils/sync');

// Promisificar operaciones de fs
const readFileAsync = promisify(fs.readFile);
const writeFileAsync = promisify(fs.writeFile);
const mkdirAsync = promisify(fs.mkdir);
const readdirAsync = promisify(fs.readdir);
const statAsync = promisify(fs.stat);

// Configuración predeterminada
const DEFAULT_CONFIG = {
  enabled: true,
  provider: 'local', // 'local', 'dropbox', 'google-drive', 'onedrive', 'custom'
  encryptBackups: true,
  scheduleFrequency: 'daily', // 'hourly', 'daily', 'weekly'
  maxBackupsToKeep: 7,
  retryAttempts: 3,
  retryDelay: 30000, // 30 segundos
  customEndpoint: '',
  lastSync: null,
  syncOnStartup: true,
  syncOnShutdown: true,
  excludeTables: ['temp_data', 'logs'],
  credentials: {
    dropbox: { token: '' },
    googleDrive: { clientId: '', clientSecret: '', refreshToken: '' },
    oneDrive: { clientId: '', clientSecret: '', refreshToken: '' },
    custom: { apiKey: '', username: '', password: '' }
  }
};

// Variables de estado
let currentConfig = { ...DEFAULT_CONFIG };
let syncInProgress = false;
let retryCount = 0;
let syncTimer = null;
let encryptionKey = null;

/**
 * Inicializa el servicio de sincronización en la nube
 * @param {Object} app - Instancia principal de la aplicación Electron
 * @param {boolean} startSync - Si debe iniciar la sincronización automática
 * @returns {Promise<void>}
 */
async function initialize(app, startSync = true) {
  try {
    // Cargar configuración
    await loadConfig();
    
    // Configurar encriptación
    await setupEncryption();
    
    // Registrar eventos IPC
    registerIPCHandlers();
    
    // Iniciar sincronización si está habilitada y se solicita
    if (currentConfig.enabled && startSync && currentConfig.syncOnStartup) {
      // Pequeño retraso para asegurar que la app esté completamente cargada
      setTimeout(() => {
        syncBackupsToCloud();
      }, 5000);
    }
    
    // Configurar sincronización programada
    if (currentConfig.enabled) {
      setupScheduledSync();
    }
    
    // Configurar sincronización al cerrar la app
    app.on('before-quit', async (event) => {
      if (currentConfig.enabled && currentConfig.syncOnShutdown && !syncInProgress) {
        event.preventDefault();
        await syncBackupsToCloud();
        app.quit();
      }
    });
    
    logger.info('CloudSync: Servicio inicializado correctamente');
    return true;
  } catch (error) {
    logger.error(`CloudSync: Error al inicializar el servicio: ${error.message}`);
    return false;
  }
}

/**
 * Carga la configuración almacenada o crea una predeterminada
 * @returns {Promise<void>}
 */
async function loadConfig() {
  try {
    const storedConfig = await getStoreValue('cloudSyncConfig');
    if (storedConfig) {
      currentConfig = { ...DEFAULT_CONFIG, ...storedConfig };
      logger.info('CloudSync: Configuración cargada correctamente');
    } else {
      await setStoreValue('cloudSyncConfig', DEFAULT_CONFIG);
      currentConfig = { ...DEFAULT_CONFIG };
      logger.info('CloudSync: Configuración predeterminada creada');
    }
  } catch (error) {
    logger.error(`CloudSync: Error al cargar la configuración: ${error.message}`);
    currentConfig = { ...DEFAULT_CONFIG };
  }
}

/**
 * Configura la clave de encriptación
 * @returns {Promise<void>}
 */
async function setupEncryption() {
  try {
    // Si ya existe una clave de encriptación en la base de datos, la usamos
    const storedKey = await getStoreValue('encryptionKey');
    if (storedKey) {
      encryptionKey = storedKey;
    } else {
      // Generar una nueva clave y guardarla
      encryptionKey = crypto.randomBytes(32).toString('hex');
      await setStoreValue('encryptionKey', encryptionKey);
    }
  } catch (error) {
    logger.error(`CloudSync: Error al configurar la encriptación: ${error.message}`);
    // Generar una clave temporal si falla
    encryptionKey = crypto.randomBytes(32).toString('hex');
  }
}

/**
 * Registra los manejadores de eventos IPC para la comunicación con el renderer
 */
function registerIPCHandlers() {
  // Obtener configuración actual
  ipcMain.handle('cloud-sync:get-config', async () => {
    const configToSend = { ...currentConfig };
    
    // Ocultar información sensible
    if (configToSend.credentials) {
      Object.keys(configToSend.credentials).forEach(provider => {
        const creds = configToSend.credentials[provider];
        if (creds) {
          Object.keys(creds).forEach(key => {
            if (creds[key] && creds[key].length > 0) {
              creds[key] = '••••••';
            }
          });
        }
      });
    }
    
    return configToSend;
  });
  
  // Actualizar configuración
  ipcMain.handle('cloud-sync:update-config', async (_, newConfig) => {
    try {
      // Mezclar con configuración actual preservando credenciales si no se proporcionan nuevas
      const updatedConfig = { ...currentConfig, ...newConfig };
      
      // Si se proporcionan nuevas credenciales, actualizar solo las proporcionadas
      if (newConfig.credentials) {
        Object.keys(newConfig.credentials).forEach(provider => {
          if (newConfig.credentials[provider]) {
            // Filtrar valores vacíos que no deben sobrescribir los existentes
            const filteredCreds = {};
            Object.keys(newConfig.credentials[provider]).forEach(key => {
              if (newConfig.credentials[provider][key] !== '••••••' && 
                  newConfig.credentials[provider][key] !== '') {
                filteredCreds[key] = newConfig.credentials[provider][key];
              }
            });
            
            // Actualizar solo las credenciales proporcionadas
            updatedConfig.credentials[provider] = {
              ...currentConfig.credentials[provider],
              ...filteredCreds
            };
          }
        });
      }
      
      // Guardar la configuración actualizada
      await setStoreValue('cloudSyncConfig', updatedConfig);
      currentConfig = updatedConfig;
      
      // Actualizar la programación si cambió la frecuencia
      if (newConfig.scheduleFrequency !== currentConfig.scheduleFrequency || 
          newConfig.enabled !== currentConfig.enabled) {
        setupScheduledSync();
      }
      
      logger.info('CloudSync: Configuración actualizada correctamente');
      return { success: true, message: 'Configuración actualizada correctamente' };
    } catch (error) {
      logger.error(`CloudSync: Error al actualizar la configuración: ${error.message}`);
      return { success: false, message: `Error al actualizar: ${error.message}` };
    }
  });
  
  // Iniciar sincronización manual
  ipcMain.handle('cloud-sync:sync-now', async () => {
    try {
      if (syncInProgress) {
        return { success: false, message: 'Ya hay una sincronización en progreso' };
      }
      
      const result = await syncBackupsToCloud();
      return result;
    } catch (error) {
      logger.error(`CloudSync: Error en sincronización manual: ${error.message}`);
      return { success: false, message: `Error en sincronización: ${error.message}` };
    }
  });
  
  // Verificar credenciales del proveedor
  ipcMain.handle('cloud-sync:test-credentials', async (_, provider) => {
    try {
      const result = await testProviderConnection(provider);
      return result;
    } catch (error) {
      logger.error(`CloudSync: Error al probar credenciales: ${error.message}`);
      return { success: false, message: `Error al probar conexión: ${error.message}` };
    }
  });
  
  // Restaurar backup desde la nube
  ipcMain.handle('cloud-sync:restore-backup', async (_, backupInfo) => {
    try {
      const result = await restoreBackupFromCloud(backupInfo);
      return result;
    } catch (error) {
      logger.error(`CloudSync: Error al restaurar backup: ${error.message}`);
      return { success: false, message: `Error al restaurar: ${error.message}` };
    }
  });
  
  // Obtener lista de backups disponibles en la nube
  ipcMain.handle('cloud-sync:list-backups', async () => {
    try {
      const backups = await listCloudBackups();
      return { success: true, backups };
    } catch (error) {
      logger.error(`CloudSync: Error al listar backups: ${error.message}`);
      return { success: false, message: `Error al listar backups: ${error.message}`, backups: [] };
    }
  });
}

/**
 * Configura la sincronización programada según la frecuencia configurada
 */
function setupScheduledSync() {
  // Limpiar timer existente si hay uno
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
  
  // No configurar si la sincronización está deshabilitada
  if (!currentConfig.enabled) {
    logger.info('CloudSync: Sincronización programada deshabilitada');
    return;
  }
  
  let interval;
  
  // Determinar intervalo según la frecuencia
  switch (currentConfig.scheduleFrequency) {
    case 'hourly':
      interval = 60 * 60 * 1000; // 1 hora
      break;
    case 'weekly':
      interval = 7 * 24 * 60 * 60 * 1000; // 7 días
      break;
    case 'daily':
    default:
      interval = 24 * 60 * 60 * 1000; // 1 día
      break;
  }
  
  // Configurar timer
  syncTimer = setInterval(async () => {
    if (!syncInProgress) {
      await syncBackupsToCloud();
    }
  }, interval);
  
  logger.info(`CloudSync: Sincronización programada configurada (${currentConfig.scheduleFrequency})`);
}

/**
 * Sincroniza los backups locales con el servicio en la nube
 * @returns {Promise<Object>} Resultado de la sincronización
 */
async function syncBackupsToCloud() {
  // Evitar sincronizaciones simultáneas
  if (syncInProgress) {
    return { success: false, message: 'Ya hay una sincronización en progreso' };
  }
  
  syncInProgress = true;
  
  try {
    // Verificar conectividad
    if (!await isOnline()) {
      syncInProgress = false;
      logger.warn('CloudSync: No hay conexión a Internet. Sincronización pospuesta.');
      return { success: false, message: 'No hay conexión a Internet' };
    }
    
    logger.info('CloudSync: Iniciando sincronización de backups');
    
    // Obtener backups locales
    const backupsDir = path.join(getAppDataPath(), 'backups');
    const backups = await getLocalBackups(backupsDir);
    
    if (backups.length === 0) {
      syncInProgress = false;
      logger.info('CloudSync: No hay backups locales para sincronizar');
      return { success: true, message: 'No hay backups para sincronizar' };
    }
    
    // Obtener backups ya sincronizados en la nube
    const cloudBackups = await listCloudBackups();
    
    // Filtrar backups que no están en la nube
    const backupsToSync = backups.filter(local => {
      return !cloudBackups.some(cloud => cloud.filename === path.basename(local));
    });
    
    if (backupsToSync.length === 0) {
      // Actualizar fecha de última sincronización
      currentConfig.lastSync = new Date().toISOString();
      await setStoreValue('cloudSyncConfig', currentConfig);
      
      syncInProgress = false;
      logger.info('CloudSync: Todos los backups ya están sincronizados');
      return { success: true, message: 'Todos los backups ya están sincronizados' };
    }
    
    // Sincronizar cada backup
    const results = [];
    for (const backupPath of backupsToSync) {
      try {
        const result = await uploadBackupToCloud(backupPath);
        results.push({
          filename: path.basename(backupPath),
          success: result.success,
          message: result.message
        });
      } catch (error) {
        results.push({
          filename: path.basename(backupPath),
          success: false,
          message: error.message
        });
      }
    }
    
    // Gestionar límite de backups en la nube
    await enforceBackupLimit();
    
    // Actualizar fecha de última sincronización
    currentConfig.lastSync = new Date().toISOString();
    await setStoreValue('cloudSyncConfig', currentConfig);
    
    // Reiniciar contador de reintentos
    retryCount = 0;
    
    syncInProgress = false;
    
    const successCount = results.filter(r => r.success).length;
    logger.info(`CloudSync: Sincronización completada. ${successCount}/${backupsToSync.length} backups sincronizados.`);
    
    return { 
      success: true, 
      message: `${successCount} de ${backupsToSync.length} backups sincronizados`, 
      details: results 
    };
    
  } catch (error) {
    syncInProgress = false;
    logger.error(`CloudSync: Error durante la sincronización: ${error.message}`);
    
    // Gestionar reintentos
    if (retryCount < currentConfig.retryAttempts) {
      retryCount++;
      logger.info(`CloudSync: Programando reintento ${retryCount}/${currentConfig.retryAttempts} en ${currentConfig.retryDelay/1000} segundos`);
      
      setTimeout(() => {
        syncBackupsToCloud();
      }, currentConfig.retryDelay);
    } else {
      retryCount = 0;
      logger.error('CloudSync: Se alcanzó el límite de reintentos');
    }
    
    return { success: false, message: `Error en sincronización: ${error.message}` };
  }
}

/**
 * Obtiene los backups locales disponibles
 * @param {string} backupsDir - Directorio de backups
 * @returns {Promise<string[]>} - Lista de rutas de archivos de backup
 */
async function getLocalBackups(backupsDir) {
  try {
    // Crear directorio si no existe
    if (!fs.existsSync(backupsDir)) {
      await mkdirAsync(backupsDir, { recursive: true });
      return [];
    }
    
    // Leer directorio
    const files = await readdirAsync(backupsDir);
    
    // Filtrar solo archivos .zip y .enc (encriptados)
    const backupFiles = [];
    for (const file of files) {
      if (file.endsWith('.zip') || file.endsWith('.enc')) {
        const filePath = path.join(backupsDir, file);
        const stats = await statAsync(filePath);
        
        // Solo incluir archivos, no directorios
        if (stats.isFile()) {
          backupFiles.push(filePath);
        }
      }
    }
    
    // Ordenar por fecha de modificación (más reciente primero)
    backupFiles.sort(async (a, b) => {
      const statsA = await statAsync(a);
      const statsB = await statAsync(b);
      return statsB.mtime.getTime() - statsA.mtime.getTime();
    });
    
    return backupFiles;
  } catch (error) {
    logger.error(`CloudSync: Error al listar backups locales: ${error.message}`);
    return [];
  }
}

/**
 * Encripta un archivo de backup
 * @param {string} filePath - Ruta del archivo a encriptar
 * @returns {Promise<string>} - Ruta del archivo encriptado
 */
async function encryptBackup(filePath) {
  if (!currentConfig.encryptBackups) {
    return filePath;
  }
  
  try {
    // Generar archivo de salida
    const outputPath = `${filePath}.enc`;
    
    // Leer archivo original
    const fileData = await readFileAsync(filePath);
    
    // Generar IV
    const iv = crypto.randomBytes(16);
    
    // Crear cipher con la clave y el IV
    const key = Buffer.from(encryptionKey, 'hex');
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    
    // Encriptar datos
    let encrypted = cipher.update(fileData);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    
    // Escribir IV al inicio del archivo encriptado, seguido de los datos encriptados
    await writeFileAsync(outputPath, Buffer.concat([iv, encrypted]));
    
    logger.info(`CloudSync: Backup encriptado: ${path.basename(filePath)}`);
    return outputPath;
  } catch (error) {
    logger.error(`CloudSync: Error al encriptar backup: ${error.message}`);
    return filePath; // Devolver archivo original si falla la encriptación
  }
}

/**
 * Desencripta un archivo de backup
 * @param {string} encFilePath - Ruta del archivo encriptado
 * @returns {Promise<string>} - Ruta del archivo desencriptado
 */
async function decryptBackup(encFilePath) {
  try {
    // Generar archivo de salida (quitar extensión .enc)
    const outputPath = encFilePath.endsWith('.enc') 
      ? encFilePath.slice(0, -4) 
      : `${encFilePath}.decrypted`;
    
    // Leer archivo encriptado
    const encData = await readFileAsync(encFilePath);
    
    // Extraer IV (primeros 16 bytes)
    const iv = encData.slice(0, 16);
    
    // Extraer datos encriptados (resto del archivo)
    const encryptedData = encData.slice(16);
    
    // Crear decipher con la clave y el IV
    const key = Buffer.from(encryptionKey, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    
    // Desencriptar datos
    let decrypted = decipher.update(encryptedData);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    // Escribir datos desencriptados
    await writeFileAsync(outputPath, decrypted);
    
    logger.info(`CloudSync: Backup desencriptado: ${path.basename(encFilePath)}`);
    return outputPath;
  } catch (error) {
    logger.error(`CloudSync: Error al desencriptar backup: ${error.message}`);
    throw new Error(`Error al desencriptar: ${error.message}`);
  }
}

/**
 * Sube un backup al servicio en la nube seleccionado
 * @param {string} backupPath - Ruta del archivo de backup
 * @returns {Promise<Object>} - Resultado de la subida
 */
async function uploadBackupToCloud(backupPath) {
  try {
    logger.info(`CloudSync: Subiendo backup: ${path.basename(backupPath)}`);
    
    // Encriptar backup si está habilitado
    let fileToUpload = backupPath;
    if (currentConfig.encryptBackups && !backupPath.endsWith('.enc')) {
      fileToUpload = await encryptBackup(backupPath);
    }
    
    // Seleccionar el proveedor adecuado
    switch (currentConfig.provider) {
      case 'dropbox':
        return await uploadToDropbox(fileToUpload);
      case 'google-drive':
        return await uploadToGoogleDrive(fileToUpload);
      case 'onedrive':
        return await uploadToOneDrive(fileToUpload);
      case 'custom':
        return await uploadToCustomServer(fileToUpload);
      case 'local':
      default:
        // Para 'local', simplemente confirmamos que se generó el backup
        return { 
          success: true, 
          message: 'Backup almacenado localmente', 
          location: 'local', 
          path: fileToUpload 
        };
    }
  } catch (error) {
    logger.error(`CloudSync: Error al subir backup: ${error.message}`);
    return { success: false, message: `Error al subir: ${error.message}` };
  }
}

/**
 * Sube un backup a Dropbox
 * @param {string} filePath - Ruta del archivo a subir
 * @returns {Promise<Object>} - Resultado de la subida
 */
async function uploadToDropbox(filePath) {
  try {
    const token = currentConfig.credentials.dropbox.token;
    if (!token) {
      throw new Error('No se ha configurado el token de acceso para Dropbox');
    }
    
    // Leer archivo
    const fileData = await readFileAsync(filePath);
    const fileName = path.basename(filePath);
    
    // Configurar la solicitud de subida
    const response = await axios({
      method: 'post',
      url: 'https://content.dropboxapi.com/2/files/upload',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({
          path: `/FactuSystem/backups/${fileName}`,
          mode: 'overwrite'
        })
      },
      data: fileData
    });
    
    logger.info(`CloudSync: Backup subido a Dropbox: ${fileName}`);
    return { 
      success: true, 
      message: 'Backup subido a Dropbox correctamente',
      location: 'dropbox',
      path: response.data.path_display 
    };
  } catch (error) {
    logger.error(`CloudSync: Error al subir a Dropbox: ${error.message}`);
    
    // Manejar errores específicos de Dropbox
    let errorMessage = 'Error al subir a Dropbox';
    if (error.response) {
      const status = error.response.status;
      
      if (status === 401) {
        errorMessage = 'Token de Dropbox inválido o expirado';
      } else if (status === 403) {
        errorMessage = 'No tienes permisos para subir archivos a Dropbox';
      } else if (status === 409) {
        errorMessage = 'Conflicto en la subida, el archivo ya existe';
      } else if (status === 429) {
        errorMessage = 'Se ha excedido el límite de peticiones a Dropbox';
      }
    }
    
    return { success: false, message: errorMessage };
  }
}

/**
 * Sube un backup a Google Drive
 * @param {string} filePath - Ruta del archivo a subir
 * @returns {Promise<Object>} - Resultado de la subida
 */
async function uploadToGoogleDrive(filePath) {
  try {
    const { clientId, clientSecret, refreshToken } = currentConfig.credentials.googleDrive;
    
    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error('Faltan credenciales para Google Drive');
    }
    
    // Obtener token de acceso usando el refresh token
    const tokenResponse = await axios({
      method: 'post',
      url: 'https://oauth2.googleapis.com/token',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      data: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      })
    });
    
    const accessToken = tokenResponse.data.access_token;
    
    // Verificar si existe una carpeta para los backups
    let folderId = await getOrCreateGDriveFolder(accessToken, 'FactuSystem_Backups');
    
    // Preparar FormData para la subida
    const fileData = await readFileAsync(filePath);
    const fileName = path.basename(filePath);
    
    const form = new FormData();
    form.append('metadata', JSON.stringify({
      name: fileName,
      parents: [folderId]
    }), {
      contentType: 'application/json'
    });
    
    form.append('file', fileData, {
      filename: fileName,
      contentType: 'application/zip'
    });
    
    // Subir archivo
    const uploadResponse = await axios({
      method: 'post',
      url: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        ...form.getHeaders()
      },
      data: form
    });
    
    logger.info(`CloudSync: Backup subido a Google Drive: ${fileName}`);
    return { 
      success: true, 
      message: 'Backup subido a Google Drive correctamente',
      location: 'google-drive',
      fileId: uploadResponse.data.id 
    };
  } catch (error) {
    logger.error(`CloudSync: Error al subir a Google Drive: ${error.message}`);
    
    // Manejar errores específicos de Google Drive
    let errorMessage = 'Error al subir a Google Drive';
    if (error.response) {
      const status = error.response.status;
      
      if (status === 401) {
        errorMessage = 'Credenciales inválidas o expiradas para Google Drive';
      } else if (status === 403) {
        errorMessage = 'No tienes permisos para subir archivos a Google Drive';
      } else if (status === 429) {
        errorMessage = 'Se ha excedido el límite de peticiones a Google Drive';
      }
    }
    
    return { success: false, message: errorMessage };
  }
}

/**
 * Obtiene o crea una carpeta en Google Drive
 * @param {string} accessToken - Token de acceso
 * @param {string} folderName - Nombre de la carpeta
 * @returns {Promise<string>} - ID de la carpeta
 */
async function getOrCreateGDriveFolder(accessToken, folderName) {
  try {
    // Buscar si ya existe la carpeta
    const searchResponse = await axios({
      method: 'get',
      url: `https://www.googleapis.com/drive/v3/files?q=name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    // Si la carpeta ya existe, devolver su ID
    if (searchResponse.data.files && searchResponse.data.files.length > 0) {
      return searchResponse.data.files[0].id;
    }
    
    // Si no existe, crear la carpeta
    const createResponse = await axios({
      method: 'post',
      url: 'https://www.googleapis.com/drive/v3/files',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      data: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder'
      }
    });
    
    return createResponse.data.id;
  } catch (error) {
    logger.error(`CloudSync: Error al gestionar carpeta en Google Drive: ${error.message}`);
    throw error;
  }
}

/**
 * Sube un backup a OneDrive
 * @param {string} filePath - Ruta del archivo a subir
 * @returns {Promise<Object>} - Resultado de la subida
 */
async function uploadToOneDrive(filePath) {
  try {
    const { clientId, clientSecret, refreshToken } = currentConfig.credentials.oneDrive;
    
    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error('Faltan credenciales para OneDrive');
    }
    
    // Obtener token de acceso usando el refresh token
    const tokenResponse = await axios({
      method: 'post',
      url: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      data: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
        scope: 'files.readwrite offline_access'
      })
    });
    
    const accessToken = tokenResponse.data.access_token;
    
    // Verificar si existe una carpeta para los backups
    let folderId = await getOrCreateOneDriveFolder(accessToken, 'FactuSystem_Backups');
    
    // Leer archivo
    const fileData = await readFileAsync(filePath);
    const fileName = path.basename(filePath);
    
    // Subir archivo
    const uploadResponse = await axios({
      method: 'put',
      url: `https://graph.microsoft.com/v1.0/me/drive/items/${folderId}:/${fileName}:/content`,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/octet-stream'
      },
      data: fileData
    });
    
    logger.info(`CloudSync: Backup subido a OneDrive: ${fileName}`);
    return { 
      success: true, 
      message: 'Backup subido a OneDrive correctamente',
      location: 'onedrive',
      fileId: uploadResponse.data.id 
    };
  } catch (error) {
    logger.error(`CloudSync: Error al subir a OneDrive: ${error.message}`);
    
    // Manejar errores específicos de OneDrive
    let errorMessage = 'Error al subir a OneDrive';
    if (error.response) {
      const status = error.response.status;
      
      if (status === 401) {
        errorMessage = 'Credenciales inválidas o expiradas para OneDrive';
      } else if (status === 403) {
        errorMessage = 'No tienes permisos para subir archivos a OneDrive';
      } else if (status === 429) {
        errorMessage = 'Se ha excedido el límite de peticiones a OneDrive';
      }
    }
    
    return { success: false, message: errorMessage };
  }
}

/**
 * Obtiene o crea una carpeta en OneDrive
 * @param {string} accessToken - Token de acceso
 * @param {string} folderName - Nombre de la carpeta
 * @returns {Promise<string>} - ID de la carpeta
 */
async function getOrCreateOneDriveFolder(accessToken, folderName) {
  try {
    // Buscar si ya existe la carpeta
    try {
      const searchResponse = await axios({
        method: 'get',
        url: `https://graph.microsoft.com/v1.0/me/drive/root:/${folderName}`,
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });
      
      // Si la carpeta existe, devolver su ID
      return searchResponse.data.id;
    } catch (error) {
      // Si no existe (404), la creamos
      if (error.response && error.response.status === 404) {
        const createResponse = await axios({
          method: 'post',
          url: 'https://graph.microsoft.com/v1.0/me/drive/root/children',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          data: {
            name: folderName,
            folder: {},
            '@microsoft.graph.conflictBehavior': 'rename'
          }
        });
        
        return createResponse.data.id;
      } else {
        throw error;
      }
    }
  } catch (error) {
    logger.error(`CloudSync: Error al gestionar carpeta en OneDrive: ${error.message}`);
    throw error;
  }
}

/**
 * Sube un backup a un servidor personalizado
 * @param {string} filePath - Ruta del archivo a subir
 * @returns {Promise<Object>} - Resultado de la subida
 */
async function uploadToCustomServer(filePath) {
  try {
    const { apiKey, username, password } = currentConfig.credentials.custom;
    const endpoint = currentConfig.customEndpoint;
    
    if (!endpoint) {
      throw new Error('No se ha configurado el endpoint del servidor personalizado');
    }
    
    // Leer archivo
    const fileData = await readFileAsync(filePath);
    const fileName = path.basename(filePath);
    
    // Preparar form data
    const form = new FormData();
    form.append('file', fileData, {
      filename: fileName,
      contentType: 'application/octet-stream'
    });
    
    // Configurar headers de autenticación
    const headers = { ...form.getHeaders() };
    
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
    }
    
    if (username && password) {
      headers['Authorization'] = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
    }
    
    // Subir archivo
    const response = await axios({
      method: 'post',
      url: endpoint,
      headers: headers,
      data: form
    });
    
    logger.info(`CloudSync: Backup subido a servidor personalizado: ${fileName}`);
    return { 
      success: true, 
      message: 'Backup subido al servidor personalizado correctamente',
      location: 'custom',
      details: response.data 
    };
  } catch (error) {
    logger.error(`CloudSync: Error al subir al servidor personalizado: ${error.message}`);
    return { success: false, message: `Error al subir al servidor personalizado: ${error.message}` };
  }
}

/**
 * Lista los backups disponibles en el servicio en la nube
 * @returns {Promise<Array>} - Lista de backups
 */
async function listCloudBackups() {
  try {
    switch (currentConfig.provider) {
      case 'dropbox':
        return await listDropboxBackups();
      case 'google-drive':
        return await listGoogleDriveBackups();
      case 'onedrive':
        return await listOneDriveBackups();
      case 'custom':
        return await listCustomServerBackups();
      case 'local':
      default:
        return await listLocalBackups();
    }
  } catch (error) {
    logger.error(`CloudSync: Error al listar backups en la nube: ${error.message}`);
    return [];
  }
}

/**
 * Lista los backups locales
 * @returns {Promise<Array>} - Lista de backups
 */
async function listLocalBackups() {
  try {
    const backupsDir = path.join(getAppDataPath(), 'backups');
    
    // Asegurar que el directorio existe
    if (!fs.existsSync(backupsDir)) {
      await mkdirAsync(backupsDir, { recursive: true });
      return [];
    }
    
    // Leer directorio
    const files = await readdirAsync(backupsDir);
    
    // Filtrar solo archivos .zip y .enc (encriptados)
    const backups = [];
    for (const file of files) {
      if (file.endsWith('.zip') || file.endsWith('.enc')) {
        const filePath = path.join(backupsDir, file);
        const stats = await statAsync(filePath);
        
        backups.push({
          id: file,
          filename: file,
          path: filePath,
          size: stats.size,
          createdAt: stats.birthtime.toISOString(),
          modifiedAt: stats.mtime.toISOString(),
          location: 'local',
          encrypted: file.endsWith('.enc')
        });
      }
    }
    
    // Ordenar por fecha de modificación (más reciente primero)
    backups.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
    
    return backups;
  } catch (error) {
    logger.error(`CloudSync: Error al listar backups locales: ${error.message}`);
    return [];
  }
}

/**
 * Lista los backups disponibles en Dropbox
 * @returns {Promise<Array>} - Lista de backups
 */
async function listDropboxBackups() {
  try {
    const token = currentConfig.credentials.dropbox.token;
    if (!token) {
      throw new Error('No se ha configurado el token de acceso para Dropbox');
    }
    
    // Listar archivos en la carpeta de backups
    const response = await axios({
      method: 'post',
      url: 'https://api.dropboxapi.com/2/files/list_folder',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      data: {
        path: '/FactuSystem/backups',
        recursive: false
      }
    });
    
    // Formatear la respuesta
    const backups = response.data.entries.map(entry => ({
      id: entry.id,
      filename: entry.name,
      path: entry.path_display,
      size: entry.size,
      createdAt: null, // Dropbox no proporciona fecha de creación
      modifiedAt: entry.server_modified,
      location: 'dropbox',
      encrypted: entry.name.endsWith('.enc')
    }));
    
    // Ordenar por fecha de modificación (más reciente primero)
    backups.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
    
    return backups;
  } catch (error) {
    // Si el error es porque la carpeta no existe, intenta crearla
    if (error.response && error.response.status === 409) {
      try {
        await axios({
          method: 'post',
          url: 'https://api.dropboxapi.com/2/files/create_folder_v2',
          headers: {
            'Authorization': `Bearer ${currentConfig.credentials.dropbox.token}`,
            'Content-Type': 'application/json'
          },
          data: {
            path: '/FactuSystem/backups',
            autorename: false
          }
        });
        
        return []; // Carpeta creada, pero aún no hay backups
      } catch (createError) {
        logger.error(`CloudSync: Error al crear carpeta en Dropbox: ${createError.message}`);
        return [];
      }
    }
    
    logger.error(`CloudSync: Error al listar backups en Dropbox: ${error.message}`);
    return [];
  }
}

/**
 * Lista los backups disponibles en Google Drive
 * @returns {Promise<Array>} - Lista de backups
 */
async function listGoogleDriveBackups() {
  try {
    const { clientId, clientSecret, refreshToken } = currentConfig.credentials.googleDrive;
    
    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error('Faltan credenciales para Google Drive');
    }
    
    // Obtener token de acceso
    const tokenResponse = await axios({
      method: 'post',
      url: 'https://oauth2.googleapis.com/token',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      data: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      })
    });
    
    const accessToken = tokenResponse.data.access_token;
    
    // Encontrar la carpeta de backups
    const folderResponse = await axios({
      method: 'get',
      url: `https://www.googleapis.com/drive/v3/files?q=name='FactuSystem_Backups' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    if (!folderResponse.data.files || folderResponse.data.files.length === 0) {
      // Carpeta no encontrada, crearla
      await getOrCreateGDriveFolder(accessToken, 'FactuSystem_Backups');
      return []; // Carpeta creada, pero aún no hay backups
    }
    
    const folderId = folderResponse.data.files[0].id;
    
    // Listar archivos en la carpeta
    const filesResponse = await axios({
      method: 'get',
      url: `https://www.googleapis.com/drive/v3/files?q='${folderId}' in parents and trashed=false&fields=files(id,name,size,createdTime,modifiedTime,mimeType)`,
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    // Formatear la respuesta
    const backups = filesResponse.data.files.map(file => ({
      id: file.id,
      filename: file.name,
      path: `gdrive://${file.id}`,
      size: parseInt(file.size || '0'),
      createdAt: file.createdTime,
      modifiedAt: file.modifiedTime,
      location: 'google-drive',
      encrypted: file.name.endsWith('.enc')
    }));
    
    // Ordenar por fecha de modificación (más reciente primero)
    backups.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
    
    return backups;
  } catch (error) {
    logger.error(`CloudSync: Error al listar backups en Google Drive: ${error.message}`);
    return [];
  }
}

/**
 * Lista los backups disponibles en OneDrive
 * @returns {Promise<Array>} - Lista de backups
 */
async function listOneDriveBackups() {
  try {
    const { clientId, clientSecret, refreshToken } = currentConfig.credentials.oneDrive;
    
    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error('Faltan credenciales para OneDrive');
    }
    
    // Obtener token de acceso
    const tokenResponse = await axios({
      method: 'post',
      url: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      data: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
        scope: 'files.readwrite offline_access'
      })
    });
    
    const accessToken = tokenResponse.data.access_token;
    
    // Intentar listar archivos en la carpeta
    try {
      const response = await axios({
        method: 'get',
        url: `https://graph.microsoft.com/v1.0/me/drive/root:/${encodeURIComponent('FactuSystem_Backups')}:/children`,
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });
      
      // Formatear la respuesta
      const backups = response.data.value.map(item => ({
        id: item.id,
        filename: item.name,
        path: item.parentReference.path + '/' + item.name,
        size: item.size,
        createdAt: item.createdDateTime,
        modifiedAt: item.lastModifiedDateTime,
        location: 'onedrive',
        encrypted: item.name.endsWith('.enc')
      }));
      
      // Ordenar por fecha de modificación (más reciente primero)
      backups.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
      
      return backups;
    } catch (error) {
      // Si la carpeta no existe, crearla
      if (error.response && error.response.status === 404) {
        await getOrCreateOneDriveFolder(accessToken, 'FactuSystem_Backups');
        return []; // Carpeta creada, pero aún no hay backups
      } else {
        throw error;
      }
    }
  } catch (error) {
    logger.error(`CloudSync: Error al listar backups en OneDrive: ${error.message}`);
    return [];
  }
}

/**
 * Lista los backups disponibles en el servidor personalizado
 * @returns {Promise<Array>} - Lista de backups
 */
async function listCustomServerBackups() {
  try {
    const { apiKey, username, password } = currentConfig.credentials.custom;
    const endpoint = currentConfig.customEndpoint;
    
    if (!endpoint) {
      throw new Error('No se ha configurado el endpoint del servidor personalizado');
    }
    
    // Configurar headers de autenticación
    const headers = {};
    
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
    }
    
    if (username && password) {
      headers['Authorization'] = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
    }
    
    // Obtener lista de backups
    const response = await axios({
      method: 'get',
      url: `${endpoint}/list`,
      headers: headers
    });
    
    // Formatear la respuesta (asumiendo un formato específico del servidor)
    const backups = response.data.backups.map(item => ({
      id: item.id,
      filename: item.filename,
      path: item.path,
      size: item.size,
      createdAt: item.createdAt,
      modifiedAt: item.modifiedAt,
      location: 'custom',
      encrypted: item.filename.endsWith('.enc')
    }));
    
    // Ordenar por fecha de modificación (más reciente primero)
    backups.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
    
    return backups;
  } catch (error) {
    logger.error(`CloudSync: Error al listar backups en servidor personalizado: ${error.message}`);
    return [];
  }
}

/**
 * Descarga un backup desde el servicio en la nube
 * @param {Object} backupInfo - Información del backup a descargar
 * @returns {Promise<string>} - Ruta al archivo descargado
 */
async function downloadBackupFromCloud(backupInfo) {
  try {
    switch (backupInfo.location) {
      case 'dropbox':
        return await downloadFromDropbox(backupInfo);
      case 'google-drive':
        return await downloadFromGoogleDrive(backupInfo);
      case 'onedrive':
        return await downloadFromOneDrive(backupInfo);
      case 'custom':
        return await downloadFromCustomServer(backupInfo);
      case 'local':
      default:
        // Para local, el archivo ya está disponible
        return backupInfo.path;
    }
  } catch (error) {
    logger.error(`CloudSync: Error al descargar backup: ${error.message}`);
    throw error;
  }
}

/**
 * Descarga un backup desde Dropbox
 * @param {Object} backupInfo - Información del backup a descargar
 * @returns {Promise<string>} - Ruta al archivo descargado
 */
async function downloadFromDropbox(backupInfo) {
  try {
    const token = currentConfig.credentials.dropbox.token;
    if (!token) {
      throw new Error('No se ha configurado el token de acceso para Dropbox');
    }
    
    // Descargar archivo
    const response = await axios({
      method: 'post',
      url: 'https://content.dropboxapi.com/2/files/download',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Dropbox-API-Arg': JSON.stringify({
          path: backupInfo.path
        })
      },
      responseType: 'arraybuffer'
    });
    
    // Guardar archivo localmente
    const downloadPath = path.join(getAppDataPath(), 'backups', 'downloads', backupInfo.filename);
    
    // Asegurar que el directorio existe
    await mkdirAsync(path.dirname(downloadPath), { recursive: true });
    
    // Escribir archivo
    await writeFileAsync(downloadPath, response.data);
    
    logger.info(`CloudSync: Backup descargado desde Dropbox: ${backupInfo.filename}`);
    return downloadPath;
  } catch (error) {
    logger.error(`CloudSync: Error al descargar desde Dropbox: ${error.message}`);
    throw error;
  }
}

/**
 * Descarga un backup desde Google Drive
 * @param {Object} backupInfo - Información del backup a descargar
 * @returns {Promise<string>} - Ruta al archivo descargado
 */
async function downloadFromGoogleDrive(backupInfo) {
  try {
    const { clientId, clientSecret, refreshToken } = currentConfig.credentials.googleDrive;
    
    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error('Faltan credenciales para Google Drive');
    }
    
    // Obtener token de acceso
    const tokenResponse = await axios({
      method: 'post',
      url: 'https://oauth2.googleapis.com/token',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      data: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      })
    });
    
    const accessToken = tokenResponse.data.access_token;
    
    // Descargar archivo
    const response = await axios({
      method: 'get',
      url: `https://www.googleapis.com/drive/v3/files/${backupInfo.id}?alt=media`,
      headers: {
        'Authorization': `Bearer ${accessToken}`
      },
      responseType: 'arraybuffer'
    });
    
    // Guardar archivo localmente
    const downloadPath = path.join(getAppDataPath(), 'backups', 'downloads', backupInfo.filename);
    
    // Asegurar que el directorio existe
    await mkdirAsync(path.dirname(downloadPath), { recursive: true });
    
    // Escribir archivo
    await writeFileAsync(downloadPath, response.data);
    
    logger.info(`CloudSync: Backup descargado desde Google Drive: ${backupInfo.filename}`);
    return downloadPath;
  } catch (error) {
    logger.error(`CloudSync: Error al descargar desde Google Drive: ${error.message}`);
    throw error;
  }
}

/**
 * Descarga un backup desde OneDrive
 * @param {Object} backupInfo - Información del backup a descargar
 * @returns {Promise<string>} - Ruta al archivo descargado
 */
async function downloadFromOneDrive(backupInfo) {
  try {
    const { clientId, clientSecret, refreshToken } = currentConfig.credentials.oneDrive;
    
    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error('Faltan credenciales para OneDrive');
    }
    
    // Obtener token de acceso
    const tokenResponse = await axios({
      method: 'post',
      url: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      data: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
        scope: 'files.readwrite offline_access'
      })
    });
    
    const accessToken = tokenResponse.data.access_token;
    
    // Descargar archivo
    const response = await axios({
      method: 'get',
      url: `https://graph.microsoft.com/v1.0/me/drive/items/${backupInfo.id}/content`,
      headers: {
        'Authorization': `Bearer ${accessToken}`
      },
      responseType: 'arraybuffer'
    });
    
    // Guardar archivo localmente
    const downloadPath = path.join(getAppDataPath(), 'backups', 'downloads', backupInfo.filename);
    
    // Asegurar que el directorio existe
    await mkdirAsync(path.dirname(downloadPath), { recursive: true });
    
    // Escribir archivo
    await writeFileAsync(downloadPath, response.data);
    
    logger.info(`CloudSync: Backup descargado desde OneDrive: ${backupInfo.filename}`);
    return downloadPath;
  } catch (error) {
    logger.error(`CloudSync: Error al descargar desde OneDrive: ${error.message}`);
    throw error;
  }
}

/**
 * Descarga un backup desde el servidor personalizado
 * @param {Object} backupInfo - Información del backup a descargar
 * @returns {Promise<string>} - Ruta al archivo descargado
 */
async function downloadFromCustomServer(backupInfo) {
  try {
    const { apiKey, username, password } = currentConfig.credentials.custom;
    const endpoint = currentConfig.customEndpoint;
    
    if (!endpoint) {
      throw new Error('No se ha configurado el endpoint del servidor personalizado');
    }
    
    // Configurar headers de autenticación
    const headers = {};
    
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
    }
    
    if (username && password) {
      headers['Authorization'] = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
    }
    
    // Descargar archivo
    const response = await axios({
      method: 'get',
      url: `${endpoint}/download/${backupInfo.id}`,
      headers: headers,
      responseType: 'arraybuffer'
    });
    
    // Guardar archivo localmente
    const downloadPath = path.join(getAppDataPath(), 'backups', 'downloads', backupInfo.filename);
    
    // Asegurar que el directorio existe
    await mkdirAsync(path.dirname(downloadPath), { recursive: true });
    
    // Escribir archivo
    await writeFileAsync(downloadPath, response.data);
    
    logger.info(`CloudSync: Backup descargado desde servidor personalizado: ${backupInfo.filename}`);
    return downloadPath;
  } catch (error) {
    logger.error(`CloudSync: Error al descargar desde servidor personalizado: ${error.message}`);
    throw error;
  }
}

/**
 * Restaura un backup desde la nube
 * @param {Object} backupInfo - Información del backup a restaurar
 * @returns {Promise<Object>} - Resultado de la restauración
 */
async function restoreBackupFromCloud(backupInfo) {
  try {
    logger.info(`CloudSync: Iniciando restauración de backup: ${backupInfo.filename}`);
    
    // Descargar el backup si no está en local
    let backupPath = backupInfo.path;
    if (backupInfo.location !== 'local') {
      backupPath = await downloadBackupFromCloud(backupInfo);
    }
    
    // Desencriptar si está encriptado
    if (backupInfo.encrypted) {
      try {
        backupPath = await decryptBackup(backupPath);
      } catch (decryptError) {
        throw new Error(`Error al desencriptar el backup: ${decryptError.message}`);
      }
    }
    
    // Delegar la restauración al módulo específico
    const recovery = require('./recovery');
    const result = await recovery.restoreFromBackup(backupPath);
    
    if (result.success) {
      logger.info(`CloudSync: Backup restaurado exitosamente: ${backupInfo.filename}`);
    } else {
      logger.error(`CloudSync: Error al restaurar backup: ${result.message}`);
    }
    
    return result;
  } catch (error) {
    logger.error(`CloudSync: Error al restaurar backup: ${error.message}`);
    return { success: false, message: `Error al restaurar: ${error.message}` };
  }
}

/**
 * Mantiene el límite de backups configurado eliminando los más antiguos
 * @returns {Promise<void>}
 */
async function enforceBackupLimit() {
  try {
    // Obtener todos los backups
    const backups = await listCloudBackups();
    
    // Si hay menos backups que el límite, no hacer nada
    if (backups.length <= currentConfig.maxBackupsToKeep) {
      return;
    }
    
    // Ordenar por fecha (más antiguos primero)
    backups.sort((a, b) => new Date(a.modifiedAt) - new Date(b.modifiedAt));
    
    // Determinar cuántos backups eliminar
    const backupsToDelete = backups.slice(0, backups.length - currentConfig.maxBackupsToKeep);
    
    // Eliminar backups antiguos
    for (const backup of backupsToDelete) {
      try {
        await deleteBackup(backup);
        logger.info(`CloudSync: Backup antiguo eliminado: ${backup.filename}`);
      } catch (error) {
        logger.error(`CloudSync: Error al eliminar backup antiguo: ${error.message}`);
      }
    }
  } catch (error) {
    logger.error(`CloudSync: Error al aplicar límite de backups: ${error.message}`);
  }
}

/**
 * Elimina un backup
 * @param {Object} backupInfo - Información del backup a eliminar
 * @returns {Promise<boolean>} - Resultado de la eliminación
 */
async function deleteBackup(backupInfo) {
  try {
    switch (backupInfo.location) {
      case 'dropbox':
        return await deleteFromDropbox(backupInfo);
      case 'google-drive':
        return await deleteFromGoogleDrive(backupInfo);
      case 'onedrive':
        return await deleteFromOneDrive(backupInfo);
      case 'custom':
        return await deleteFromCustomServer(backupInfo);
      case 'local':
      default:
        return await deleteLocalBackup(backupInfo);
    }
  } catch (error) {
    logger.error(`CloudSync: Error al eliminar backup: ${error.message}`);
    throw error;
  }
}

/**
 * Elimina un backup local
 * @param {Object} backupInfo - Información del backup a eliminar
 * @returns {Promise<boolean>} - Resultado de la eliminación
 */
async function deleteLocalBackup(backupInfo) {
  try {
    if (fs.existsSync(backupInfo.path)) {
      fs.unlinkSync(backupInfo.path);
      logger.info(`CloudSync: Backup local eliminado: ${backupInfo.filename}`);
      return true;
    } else {
      logger.warn(`CloudSync: No se encontró el backup local: ${backupInfo.path}`);
      return false;
    }
  } catch (error) {
    logger.error(`CloudSync: Error al eliminar backup local: ${error.message}`);
    return false;
  }
}

/**
 * Elimina un backup de Dropbox
 * @param {Object} backupInfo - Información del backup a eliminar
 * @returns {Promise<boolean>} - Resultado de la eliminación
 */
async function deleteFromDropbox(backupInfo) {
  try {
    const token = currentConfig.credentials.dropbox.token;
    if (!token) {
      throw new Error('No se ha configurado el token de acceso para Dropbox');
    }
    
    // Eliminar archivo
    await axios({
      method: 'post',
      url: 'https://api.dropboxapi.com/2/files/delete_v2',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      data: {
        path: backupInfo.path
      }
    });
    
    logger.info(`CloudSync: Backup eliminado de Dropbox: ${backupInfo.filename}`);
    return true;
  } catch (error) {
    logger.error(`CloudSync: Error al eliminar backup de Dropbox: ${error.message}`);
    return false;
  }
}

/**
 * Elimina un backup de Google Drive
 * @param {Object} backupInfo - Información del backup a eliminar
 * @returns {Promise<boolean>} - Resultado de la eliminación
 */
async function deleteFromGoogleDrive(backupInfo) {
  try {
    const { clientId, clientSecret, refreshToken } = currentConfig.credentials.googleDrive;
    
    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error('Faltan credenciales para Google Drive');
    }
    
    // Obtener token de acceso
    const tokenResponse = await axios({
      method: 'post',
      url: 'https://oauth2.googleapis.com/token',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      data: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      })
    });
    
    const accessToken = tokenResponse.data.access_token;
    
    // Eliminar archivo
    await axios({
      method: 'delete',
      url: `https://www.googleapis.com/drive/v3/files/${backupInfo.id}`,
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    logger.info(`CloudSync: Backup eliminado de Google Drive: ${backupInfo.filename}`);
    return true;
  } catch (error) {
    logger.error(`CloudSync: Error al eliminar backup de Google Drive: ${error.message}`);
    return false;
  }
}

/**
 * Elimina un backup de OneDrive
 * @param {Object} backupInfo - Información del backup a eliminar
 * @returns {Promise<boolean>} - Resultado de la eliminación
 */
async function deleteFromOneDrive(backupInfo) {
  try {
    const { clientId, clientSecret, refreshToken } = currentConfig.credentials.oneDrive;
    
    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error('Faltan credenciales para OneDrive');
    }
    
    // Obtener token de acceso
    const tokenResponse = await axios({
      method: 'post',
      url: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      data: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
        scope: 'files.readwrite offline_access'
      })
    });
    
    const accessToken = tokenResponse.data.access_token;
    
    // Eliminar archivo
    await axios({
      method: 'delete',
      url: `https://graph.microsoft.com/v1.0/me/drive/items/${backupInfo.id}`,
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    logger.info(`CloudSync: Backup eliminado de OneDrive: ${backupInfo.filename}`);
    return true;
  } catch (error) {
    logger.error(`CloudSync: Error al eliminar backup de OneDrive: ${error.message}`);
    return false;
  }
}

/**
 * Elimina un backup del servidor personalizado
 * @param {Object} backupInfo - Información del backup a eliminar
 * @returns {Promise<boolean>} - Resultado de la eliminación
 */
async function deleteFromCustomServer(backupInfo) {
  try {
    const { apiKey, username, password } = currentConfig.credentials.custom;
    const endpoint = currentConfig.customEndpoint;
    
    if (!endpoint) {
      throw new Error('No se ha configurado el endpoint del servidor personalizado');
    }
    
    // Configurar headers de autenticación
    const headers = {};
    
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
    }
    
    if (username && password) {
      headers['Authorization'] = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
    }
    
    // Eliminar archivo
    await axios({
      method: 'delete',
      url: `${endpoint}/delete/${backupInfo.id}`,
      headers: headers
    });
    
    logger.info(`CloudSync: Backup eliminado del servidor personalizado: ${backupInfo.filename}`);
    return true;
  } catch (error) {
    logger.error(`CloudSync: Error al eliminar backup del servidor personalizado: ${error.message}`);
    return false;
  }
}

/**
 * Prueba la conexión con el proveedor seleccionado
 * @param {string} provider - Proveedor a probar ('dropbox', 'google-drive', 'onedrive', 'custom')
 * @returns {Promise<Object>} - Resultado de la prueba
 */
async function testProviderConnection(provider) {
  try {
    switch (provider) {
      case 'dropbox':
        return await testDropboxConnection();
      case 'google-drive':
        return await testGoogleDriveConnection();
      case 'onedrive':
        return await testOneDriveConnection();
      case 'custom':
        return await testCustomServerConnection();
      default:
        return { success: false, message: 'Proveedor no soportado' };
    }
  } catch (error) {
    logger.error(`CloudSync: Error al probar conexión: ${error.message}`);
    return { success: false, message: `Error: ${error.message}` };
  }
}

/**
 * Prueba la conexión con Dropbox
 * @returns {Promise<Object>} - Resultado de la prueba
 */
async function testDropboxConnection() {
  try {
    const token = currentConfig.credentials.dropbox.token;
    if (!token) {
      return { success: false, message: 'No se ha configurado el token de acceso para Dropbox' };
    }
    
    // Intentar obtener información de la cuenta
    const response = await axios({
      method: 'post',
      url: 'https://api.dropboxapi.com/2/users/get_current_account',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    return { 
      success: true, 
      message: `Conexión exitosa con la cuenta ${response.data.email}`,
      accountInfo: {
        name: response.data.name.display_name,
        email: response.data.email
      }
    };
  } catch (error) {
    let message = 'Error al conectar con Dropbox';
    
    if (error.response) {
      if (error.response.status === 401) {
        message = 'Token de Dropbox inválido o expirado';
      }
    }
    
    return { success: false, message };
  }
}

/**
 * Prueba la conexión con Google Drive
 * @returns {Promise<Object>} - Resultado de la prueba
 */
async function testGoogleDriveConnection() {
  try {
    const { clientId, clientSecret, refreshToken } = currentConfig.credentials.googleDrive;
    
    if (!clientId || !clientSecret || !refreshToken) {
      return { success: false, message: 'Faltan credenciales para Google Drive' };
    }
    
    // Obtener token de acceso
    const tokenResponse = await axios({
      method: 'post',
      url: 'https://oauth2.googleapis.com/token',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      data: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      })
    });
    
    const accessToken = tokenResponse.data.access_token;
    
    // Obtener información del usuario
    const userResponse = await axios({
      method: 'get',
      url: 'https://www.googleapis.com/drive/v3/about?fields=user',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    return { 
      success: true, 
      message: `Conexión exitosa con la cuenta ${userResponse.data.user.emailAddress}`,
      accountInfo: {
        name: userResponse.data.user.displayName,
        email: userResponse.data.user.emailAddress
      }
    };
  } catch (error) {
    let message = 'Error al conectar con Google Drive';
    
    if (error.response) {
      if (error.response.status === 401) {
        message = 'Credenciales inválidas o expiradas para Google Drive';
      }
    }
    
    return { success: false, message };
  }
}

/**
 * Prueba la conexión con OneDrive
 * @returns {Promise<Object>} - Resultado de la prueba
 */
async function testOneDriveConnection() {
  try {
    const { clientId, clientSecret, refreshToken } = currentConfig.credentials.oneDrive;
    
    if (!clientId || !clientSecret || !refreshToken) {
      return { success: false, message: 'Faltan credenciales para OneDrive' };
    }
    
    // Obtener token de acceso
    const tokenResponse = await axios({
      method: 'post',
      url: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      data: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
        scope: 'files.readwrite offline_access'
      })
    });
    
    const accessToken = tokenResponse.data.access_token;
    
    // Obtener información del usuario
    const userResponse = await axios({
      method: 'get',
      url: 'https://graph.microsoft.com/v1.0/me',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    return { 
      success: true, 
      message: `Conexión exitosa con la cuenta ${userResponse.data.userPrincipalName}`,
      accountInfo: {
        name: userResponse.data.displayName,
        email: userResponse.data.userPrincipalName
      }
    };
  } catch (error) {
    let message = 'Error al conectar con OneDrive';
    
    if (error.response) {
      if (error.response.status === 401) {
        message = 'Credenciales inválidas o expiradas para OneDrive';
      }
    }
    
    return { success: false, message };
  }
}

/**
 * Prueba la conexión con el servidor personalizado
 * @returns {Promise<Object>} - Resultado de la prueba
 */
async function testCustomServerConnection() {
  try {
    const { apiKey, username, password } = currentConfig.credentials.custom;
    const endpoint = currentConfig.customEndpoint;
    
    if (!endpoint) {
      return { success: false, message: 'No se ha configurado el endpoint del servidor personalizado' };
    }
    
    // Configurar headers de autenticación
    const headers = {};
    
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
    }
    
    if (username && password) {
      headers['Authorization'] = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
    }
    
    // Intentar conectar con el endpoint de prueba/status
    const response = await axios({
      method: 'get',
      url: `${endpoint}/status`,
      headers: headers
    });
    
    return { 
      success: true, 
      message: 'Conexión exitosa con el servidor personalizado',
      serverInfo: response.data
    };
  } catch (error) {
    let message = 'Error al conectar con el servidor personalizado';
    
    if (error.response) {
      if (error.response.status === 401 || error.response.status === 403) {
        message = 'Credenciales inválidas para el servidor personalizado';
      } else if (error.response.status === 404) {
        message = 'Endpoint no encontrado. Verifique la URL del servidor';
      }
    } else if (error.code === 'ECONNREFUSED') {
      message = 'No se pudo establecer conexión con el servidor. Verifique la URL y que el servidor esté en línea';
    }
    
    return { success: false, message };
  }
}

// Exportar funciones públicas
module.exports = {
  initialize,
  syncBackupsToCloud,
  listCloudBackups,
  restoreBackupFromCloud,
  testProviderConnection
};