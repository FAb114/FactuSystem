/**
 * backupController.js
 * Controlador para la gestión de respaldos en FactuSystem
 * 
 * Este controlador maneja:
 * - Creación de respaldos manuales y automáticos
 * - Almacenamiento local y en la nube
 * - Restauración de respaldos
 * - Sincronización entre sucursales
 * - Programación de respaldos automáticos
 */

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const extract = require('extract-zip');
const { format } = require('date-fns');
const { v4: uuidv4 } = require('uuid');
const { Pool } = require('pg'); // Para PostgreSQL
const sqlite3 = require('sqlite3').verbose(); // Para SQLite (DB local)
const axios = require('axios');
const crypto = require('crypto');
const schedule = require('node-schedule');
const { checkDiskSpace } = require('check-disk-space');
const { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsCommand } = require('@aws-sdk/client-s3.js');
const { Dropbox } = require('dropbox');
const { google } = require('googleapis');
const logger = require('../config/logger.js');

// Configuraciones
const config = require('../config/backup.config.js');
const dbConfig = require('../config/database.js');
const securityConfig = require('../config/security.js');

// Conexiones a bases de datos
let centralDB = null;
const localDBConnections = new Map();

/**
 * Inicializa las conexiones de bases de datos necesarias
 */
const initDatabaseConnections = async () => {
  try {
    // Conexión a la base de datos central (PostgreSQL)
    centralDB = new Pool(dbConfig.central);
    
    // Cargar configuraciones de sucursales desde la base central
    const branchesResult = await centralDB.query('SELECT id, name, db_connection FROM branches WHERE active = true');
    
    // Crear conexiones para cada sucursal
    for (const branch of branchesResult.rows) {
      if (branch.db_connection.type === 'sqlite') {
        // Para sucursales con SQLite
        const db = new sqlite3.Database(branch.db_connection.path);
        localDBConnections.set(branch.id, db);
      } else if (branch.db_connection.type === 'postgres') {
        // Para sucursales con PostgreSQL remoto
        const branchPool = new Pool(branch.db_connection.config);
        localDBConnections.set(branch.id, branchPool);
      }
    }
    
    logger.info('Conexiones de bases de datos inicializadas correctamente');
    return true;
  } catch (error) {
    logger.error('Error al inicializar conexiones de bases de datos:', error);
    throw new Error('No se pudieron inicializar las conexiones de bases de datos');
  }
};

/**
 * Configura el cliente de almacenamiento en la nube según la configuración
 */
const getCloudStorageClient = () => {
  try {
    switch (config.cloudStorage.provider) {
      case 's3':
        return new S3Client({
          region: config.cloudStorage.s3.region,
          credentials: {
            accessKeyId: config.cloudStorage.s3.accessKeyId,
            secretAccessKey: config.cloudStorage.s3.secretAccessKey
          }
        });
      
      case 'dropbox':
        return new Dropbox({ 
          accessToken: config.cloudStorage.dropbox.accessToken 
        });
        
      case 'google':
        const auth = new google.auth.JWT(
          config.cloudStorage.google.clientEmail,
          null,
          config.cloudStorage.google.privateKey,
          ['https://www.googleapis.com/auth/drive']
        );
        
        return google.drive({ version: 'v3', auth });
        
      default:
        logger.warn('Proveedor de almacenamiento en la nube no configurado, usando solo almacenamiento local');
        return null;
    }
  } catch (error) {
    logger.error('Error al configurar cliente de almacenamiento en la nube:', error);
    return null;
  }
};

/**
 * Encripta un archivo usando AES-256
 */
const encryptFile = (inputPath, outputPath) => {
  return new Promise((resolve, reject) => {
    try {
      const key = Buffer.from(securityConfig.backupEncryptionKey, 'hex');
      const iv = crypto.randomBytes(16);
      
      const input = fs.createReadStream(inputPath);
      const output = fs.createWriteStream(outputPath);
      
      const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
      
      // Escribir el IV al principio del archivo
      output.write(iv);
      
      input.pipe(cipher).pipe(output);
      
      output.on('finish', () => {
        resolve(outputPath);
      });
      
      output.on('error', (err) => {
        reject(err);
      });
    } catch (error) {
      reject(error);
    }
  });
};

/**
 * Desencripta un archivo usando AES-256
 */
const decryptFile = (inputPath, outputPath) => {
  return new Promise((resolve, reject) => {
    try {
      const key = Buffer.from(securityConfig.backupEncryptionKey, 'hex');
      
      const input = fs.createReadStream(inputPath);
      const output = fs.createWriteStream(outputPath);
      
      // Leer los primeros 16 bytes (IV)
      let iv = Buffer.alloc(16);
      let bytesRead = 0;
      
      input.on('readable', () => {
        if (bytesRead < 16) {
          const chunk = input.read(16 - bytesRead);
          if (chunk) {
            chunk.copy(iv, bytesRead);
            bytesRead += chunk.length;
          }
        }
        
        if (bytesRead === 16) {
          // Una vez que tenemos el IV, configuramos el desencriptado
          const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
          input.pipe(decipher).pipe(output);
        }
      });
      
      output.on('finish', () => {
        resolve(outputPath);
      });
      
      output.on('error', (err) => {
        reject(err);
      });
    } catch (error) {
      reject(error);
    }
  });
};

/**
 * Crea un archivo zip con el contenido del directorio especificado
 */
const createZipArchive = (sourceDir, outputPath, options = {}) => {
  return new Promise((resolve, reject) => {
    try {
      const output = fs.createWriteStream(outputPath);
      const archive = archiver('zip', {
        zlib: { level: 9 } // Nivel máximo de compresión
      });
      
      output.on('close', () => {
        logger.info(`Archivo creado: ${outputPath} - ${archive.pointer()} bytes`);
        resolve(outputPath);
      });
      
      archive.on('error', (err) => {
        logger.error('Error al comprimir:', err);
        reject(err);
      });
      
      archive.pipe(output);
      
      // Si se especifican archivos individuales
      if (options.files && Array.isArray(options.files)) {
        options.files.forEach(file => {
          if (fs.existsSync(file.path)) {
            archive.file(file.path, { name: file.name || path.basename(file.path) });
          }
        });
      } 
      // Si no, comprimir todo el directorio
      else {
        archive.directory(sourceDir, false);
      }
      
      archive.finalize();
    } catch (error) {
      logger.error('Error al crear archivo zip:', error);
      reject(error);
    }
  });
};

/**
 * Extrae un archivo zip en el directorio especificado
 */
const extractZipArchive = async (zipPath, outputDir) => {
  try {
    await extract(zipPath, { dir: outputDir });
    logger.info(`Archivo extraído correctamente en ${outputDir}`);
    return outputDir;
  } catch (error) {
    logger.error('Error al extraer archivo zip:', error);
    throw error;
  }
};

/**
 * Sube un archivo al almacenamiento en la nube configurado
 */
const uploadToCloud = async (filePath, destinationPath) => {
  try {
    const cloudClient = getCloudStorageClient();
    
    if (!cloudClient) {
      logger.warn('No hay cliente de almacenamiento en la nube configurado');
      return { success: false, message: 'No hay cliente de almacenamiento en la nube configurado' };
    }
    
    const fileContent = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);
    
    switch (config.cloudStorage.provider) {
      case 's3':
        const s3Params = {
          Bucket: config.cloudStorage.s3.bucket,
          Key: `${destinationPath}/${fileName}`,
          Body: fileContent
        };
        
        await cloudClient.send(new PutObjectCommand(s3Params));
        
        return {
          success: true,
          path: `s3://${config.cloudStorage.s3.bucket}/${destinationPath}/${fileName}`
        };
        
      case 'dropbox':
        const dropboxPath = `/${destinationPath}/${fileName}`;
        
        const dropboxResponse = await cloudClient.filesUpload({
          path: dropboxPath,
          contents: fileContent,
          mode: 'overwrite'
        });
        
        return {
          success: true,
          path: dropboxPath,
          metadata: dropboxResponse
        };
        
      case 'google':
        const fileMetadata = {
          name: fileName,
          parents: [config.cloudStorage.google.folderId]
        };
        
        const media = {
          mimeType: 'application/zip',
          body: fs.createReadStream(filePath)
        };
        
        const driveResponse = await cloudClient.files.create({
          resource: fileMetadata,
          media: media,
          fields: 'id,name,webViewLink'
        });
        
        return {
          success: true,
          path: driveResponse.data.webViewLink,
          fileId: driveResponse.data.id
        };
        
      default:
        return { success: false, message: 'Proveedor de almacenamiento en la nube no soportado' };
    }
  } catch (error) {
    logger.error('Error al subir a la nube:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Descarga un archivo del almacenamiento en la nube
 */
const downloadFromCloud = async (cloudPath, localDestination) => {
  try {
    const cloudClient = getCloudStorageClient();
    
    if (!cloudClient) {
      return { success: false, message: 'No hay cliente de almacenamiento en la nube configurado' };
    }
    
    // Asegurar que el directorio de destino exista
    const destDir = path.dirname(localDestination);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    
    switch (config.cloudStorage.provider) {
      case 's3':
        // Extraer el bucket y la clave del path
        const s3Path = cloudPath.replace('s3://', '');
        const [bucket, ...keyParts] = s3Path.split('/');
        const key = keyParts.join('/');
        
        const s3Params = {
          Bucket: bucket,
          Key: key
        };
        
        const s3Response = await cloudClient.send(new GetObjectCommand(s3Params));
        const writeStream = fs.createWriteStream(localDestination);
        
        s3Response.Body.pipe(writeStream);
        
        return new Promise((resolve, reject) => {
          writeStream.on('finish', () => {
            resolve({ success: true, path: localDestination });
          });
          
          writeStream.on('error', (err) => {
            reject({ success: false, error: err.message });
          });
        });
        
      case 'dropbox':
        const dropboxResponse = await cloudClient.filesDownload({ path: cloudPath });
        fs.writeFileSync(localDestination, dropboxResponse.result.fileBinary);
        
        return {
          success: true,
          path: localDestination
        };
        
      case 'google':
        // Extraer el ID del archivo del path si es un enlace, o usar directamnete si es un ID
        let fileId = cloudPath;
        if (cloudPath.includes('google.com')) {
          const urlParams = new URL(cloudPath).searchParams;
          fileId = urlParams.get('id');
        }
        
        const dest = fs.createWriteStream(localDestination);
        
        const driveResponse = await cloudClient.files.get(
          { fileId, alt: 'media' },
          { responseType: 'stream' }
        );
        
        driveResponse.data.pipe(dest);
        
        return new Promise((resolve, reject) => {
          dest.on('finish', () => {
            resolve({ success: true, path: localDestination });
          });
          
          dest.on('error', (err) => {
            reject({ success: false, error: err.message });
          });
        });
        
      default:
        return { success: false, message: 'Proveedor de almacenamiento en la nube no soportado' };
    }
  } catch (error) {
    logger.error('Error al descargar de la nube:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Verifica el espacio disponible y elimina respaldos antiguos si es necesario
 */
const manageBackupStorage = async () => {
  try {
    // Verificar espacio en disco
    const diskSpace = await checkDiskSpace(config.localBackupPath);
    const availableGB = diskSpace.free / (1024 * 1024 * 1024);
    
    logger.info(`Espacio disponible: ${availableGB.toFixed(2)} GB`);
    
    // Si el espacio es menor que el umbral configurado
    if (availableGB < config.minDiskSpaceGB) {
      logger.warn(`Espacio insuficiente (${availableGB.toFixed(2)} GB). Eliminando respaldos antiguos...`);
      
      // Obtener lista de archivos de respaldo ordenados por fecha
      const backupFiles = fs.readdirSync(config.localBackupPath)
        .filter(file => file.endsWith('.zip') || file.endsWith('.enc'))
        .map(file => ({
          name: file,
          path: path.join(config.localBackupPath, file),
          stats: fs.statSync(path.join(config.localBackupPath, file))
        }))
        .sort((a, b) => a.stats.mtime.getTime() - b.stats.mtime.getTime());
      
      // Eliminar los más antiguos hasta liberar suficiente espacio
      let deletedCount = 0;
      let deletedSize = 0;
      
      for (const file of backupFiles) {
        // Mantener siempre los últimos X respaldos configurados
        if (backupFiles.length - deletedCount <= config.minBackupsToKeep) {
          break;
        }
        
        const fileSize = file.stats.size / (1024 * 1024 * 1024); // En GB
        
        try {
          // Eliminar el archivo
          fs.unlinkSync(file.path);
          deletedCount++;
          deletedSize += fileSize;
          
          logger.info(`Respaldo antiguo eliminado: ${file.name} (${fileSize.toFixed(2)} GB)`);
          
          // Verificar si ya liberamos suficiente espacio
          if (availableGB + deletedSize >= config.targetDiskSpaceGB) {
            break;
          }
        } catch (err) {
          logger.error(`No se pudo eliminar el archivo ${file.name}:`, err);
        }
      }
      
      logger.info(`Se eliminaron ${deletedCount} respaldos antiguos, liberando ${deletedSize.toFixed(2)} GB`);
    }
    
    return true;
  } catch (error) {
    logger.error('Error al gestionar almacenamiento de respaldos:', error);
    return false;
  }
};

/**
 * Crea un respaldo de la base de datos para una sucursal específica
 */
const backupBranchDatabase = async (branchId) => {
  try {
    const branchConn = localDBConnections.get(branchId);
    
    if (!branchConn) {
      throw new Error(`No se encontró conexión para la sucursal ID: ${branchId}`);
    }
    
    // Obtener información de la sucursal
    const branchInfo = await centralDB.query('SELECT name, db_connection FROM branches WHERE id = $1', [branchId]);
    
    if (branchInfo.rows.length === 0) {
      throw new Error(`No se encontró información para la sucursal ID: ${branchId}`);
    }
    
    const branch = branchInfo.rows[0];
    const timestamp = format(new Date(), 'yyyyMMdd_HHmmss');
    const backupId = `branch_${branchId}_${timestamp}`;
    const tempDir = path.join(config.tempPath, backupId);
    
    // Crear directorio temporal
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Realizar respaldo según el tipo de base de datos
    if (branch.db_connection.type === 'sqlite') {
      // Para SQLite, copia directa del archivo
      const dbFilePath = branch.db_connection.path;
      const backupDbPath = path.join(tempDir, 'database.sqlite');
      
      fs.copyFileSync(dbFilePath, backupDbPath);
      
      // Crear archivo de metadatos
      const metadata = {
        id: backupId,
        timestamp: new Date().toISOString(),
        branch: {
          id: branchId,
          name: branch.name
        },
        type: 'branch_database',
        dbType: 'sqlite'
      };
      
      fs.writeFileSync(
        path.join(tempDir, 'metadata.json'),
        JSON.stringify(metadata, null, 2)
      );
      
      // Comprimir respaldo
      const backupFileName = `${backupId}.zip`;
      const backupFilePath = path.join(config.localBackupPath, backupFileName);
      
      await createZipArchive(tempDir, backupFilePath);
      
      // Encriptar respaldo si está configurado
      let finalBackupPath = backupFilePath;
      if (config.encryptBackups) {
        const encryptedPath = `${backupFilePath}.enc`;
        await encryptFile(backupFilePath, encryptedPath);
        
        // Eliminar archivo sin encriptar
        fs.unlinkSync(backupFilePath);
        finalBackupPath = encryptedPath;
      }
      
      // Subir a la nube si está configurado
      let cloudUploadResult = null;
      if (config.useCloudStorage) {
        cloudUploadResult = await uploadToCloud(
          finalBackupPath, 
          `backups/branches/${branchId}`
        );
      }
      
      // Registrar respaldo en la base de datos central
      const backupRecord = {
        id: backupId,
        branch_id: branchId,
        created_at: new Date(),
        path: finalBackupPath,
        size: fs.statSync(finalBackupPath).size,
        type: 'branch_database',
        encrypted: config.encryptBackups,
        cloud_path: cloudUploadResult?.path || null,
        cloud_provider: config.useCloudStorage ? config.cloudStorage.provider : null
      };
      
      await centralDB.query(
        `INSERT INTO backups (id, branch_id, created_at, path, size, type, encrypted, cloud_path, cloud_provider) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          backupRecord.id,
          backupRecord.branch_id,
          backupRecord.created_at,
          backupRecord.path,
          backupRecord.size,
          backupRecord.type,
          backupRecord.encrypted,
          backupRecord.cloud_path,
          backupRecord.cloud_provider
        ]
      );
      
      // Limpiar directorio temporal
      fs.rmSync(tempDir, { recursive: true, force: true });
      
      return {
        success: true,
        backupId,
        path: finalBackupPath,
        cloudPath: cloudUploadResult?.path || null
      };
      
    } else if (branch.db_connection.type === 'postgres') {
      // Para PostgreSQL, usar pg_dump
      const { exec } = require('child_process');
      const util = require('util');
      const execPromise = util.promisify(exec);
      
      const dbConfig = branch.db_connection.config;
      const dumpFilePath = path.join(tempDir, 'database.sql');
      
      // Crear comando pg_dump
      const pgDumpCmd = `pg_dump -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -d ${dbConfig.database} -f "${dumpFilePath}"`;
      
      // Ejecutar pg_dump
      const env = { ...process.env, PGPASSWORD: dbConfig.password };
      await execPromise(pgDumpCmd, { env });
      
      // Crear archivo de metadatos
      const metadata = {
        id: backupId,
        timestamp: new Date().toISOString(),
        branch: {
          id: branchId,
          name: branch.name
        },
        type: 'branch_database',
        dbType: 'postgres',
        dbName: dbConfig.database
      };
      
      fs.writeFileSync(
        path.join(tempDir, 'metadata.json'),
        JSON.stringify(metadata, null, 2)
      );
      
      // Comprimir respaldo
      const backupFileName = `${backupId}.zip`;
      const backupFilePath = path.join(config.localBackupPath, backupFileName);
      
      await createZipArchive(tempDir, backupFilePath);
      
      // Encriptar respaldo si está configurado
      let finalBackupPath = backupFilePath;
      if (config.encryptBackups) {
        const encryptedPath = `${backupFilePath}.enc`;
        await encryptFile(backupFilePath, encryptedPath);
        
        // Eliminar archivo sin encriptar
        fs.unlinkSync(backupFilePath);
        finalBackupPath = encryptedPath;
      }
      
      // Subir a la nube si está configurado
      let cloudUploadResult = null;
      if (config.useCloudStorage) {
        cloudUploadResult = await uploadToCloud(
          finalBackupPath, 
          `backups/branches/${branchId}`
        );
      }
      
      // Registrar respaldo en la base de datos central
      const backupRecord = {
        id: backupId,
        branch_id: branchId,
        created_at: new Date(),
        path: finalBackupPath,
        size: fs.statSync(finalBackupPath).size,
        type: 'branch_database',
        encrypted: config.encryptBackups,
        cloud_path: cloudUploadResult?.path || null,
        cloud_provider: config.useCloudStorage ? config.cloudStorage.provider : null
      };
      
      await centralDB.query(
        `INSERT INTO backups (id, branch_id, created_at, path, size, type, encrypted, cloud_path, cloud_provider) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          backupRecord.id,
          backupRecord.branch_id,
          backupRecord.created_at,
          backupRecord.path,
          backupRecord.size,
          backupRecord.type,
          backupRecord.encrypted,
          backupRecord.cloud_path,
          backupRecord.cloud_provider
        ]
      );
      
      // Limpiar directorio temporal
      fs.rmSync(tempDir, { recursive: true, force: true });
      
      return {
        success: true,
        backupId,
        path: finalBackupPath,
        cloudPath: cloudUploadResult?.path || null
      };
    } else {
      throw new Error(`Tipo de base de datos no soportado: ${branch.db_connection.type}`);
    }
  } catch (error) {
    logger.error(`Error al respaldar base de datos de sucursal ${branchId}:`, error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Crea un respaldo completo de la base de datos central
 */
const backupCentralDatabase = async () => {
  try {
    const timestamp = format(new Date(), 'yyyyMMdd_HHmmss');
    const backupId = `central_${timestamp}`;
    const tempDir = path.join(config.tempPath, backupId);
    
    // Crear directorio temporal
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Para PostgreSQL, usar pg_dump
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    
    const dbConfig = dbConfig.central;
    const dumpFilePath = path.join(tempDir, 'central_database.sql');
    
    // Crear comando pg_dump
    const pgDumpCmd = `pg_dump -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -d ${dbConfig.database} -f "${dumpFilePath}"`;
    
    // Ejecutar pg_dump
    const env = { ...process.env, PGPASSWORD: dbConfig.password };
    await execPromise(pgDumpCmd, { env });
    
    // Crear archivo de metadatos
    const metadata = {
      id: backupId,
      timestamp: new Date().toISOString(),
      type: 'central_database',
      dbType: 'postgres',
      dbName: dbConfig.database
    };
    
    fs.writeFileSync(
      path.join(tempDir, 'metadata.json'),
      JSON.stringify(metadata, null, 2)
    );
    
    // Comprimir respaldo
    const backupFileName = `${backupId}.zip`;
    const backupFilePath = path.join(config.localBackupPath, backupFileName);
    
    await createZipArchive(tempDir, backupFilePath);
    
    // Encriptar respaldo si está configurado
    let finalBackupPath = backupFilePath;
    if (config.encryptBackups) {
      const encryptedPath = `${backupFilePath}.enc`;
      await encryptFile(backupFilePath, encryptedPath);
      
      // Eliminar archivo sin encriptar
      fs.unlinkSync(backupFilePath);
      finalBackupPath = encryptedPath;
    }
    
    // Subir a la nube si está configurado
    let cloudUploadResult = null;
    if (config.useCloudStorage) {
      cloudUploadResult = await uploadToCloud(
        finalBackupPath, 
        'backups/central'
      );
    }
    
    // Registrar respaldo en la base de datos central
    const backupRecord = {
      id: backupId,
      branch_id: null, // Central no tiene branch_id
      created_at: new Date(),
      path: finalBackupPath,
      size: fs.statSync(finalBackupPath).size,
      type: 'central_database',
      encrypted: config.encryptBackups,
      cloud_path: cloudUploadResult?.path || null,
      cloud_provider: config.useCloudStorage ? config.cloudStorage.provider : null
    };
    
    await centralDB.query(
      `INSERT INTO backups (id, branch_id, created_at, path, size, type, encrypted, cloud_path, cloud_provider) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        backupRecord.id,
        backupRecord.branch_id,
        backupRecord.created_at,
        backupRecord.path,
        backupRecord.size,
        backupRecord.type,
        backupRecord.encrypted,
        backupRecord.cloud_path,
        backupRecord.cloud_provider
      ]
    );
    
    // Limpiar directorio temporal
    fs.rmSync(tempDir, { recursive: true, force: true });
    
    return {
      success: true,
      backupId,
      path: finalBackupPath,
      cloudPath: cloudUploadResult?.path || null
    };
  } catch (error) {
    logger.error('Error al respaldar base de datos central:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Crea un respaldo del sistema completo (configuraciones, plantillas, etc.)
 */
const backupSystemFiles = async () => {
  try {
    const timestamp = format(new Date(), 'yyyyMMdd_HHmmss');
    const backupId = `system_${timestamp}`;
    const tempDir = path.join(config.tempPath, backupId);
    
    // Crear directorio temporal
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Copiar archivos de sistema importantes
    const systemPaths = [
      { src: path.join(config.appRootPath, 'app/templates'), dest: path.join(tempDir, 'templates') },
      { src: path.join(config.appRootPath, 'app/assets/img'), dest: path.join(tempDir, 'assets/img') },
      { src: path.join(config.appRootPath, 'config'), dest: path.join(tempDir, 'config')
      }
    ];
    
    // Copiar cada directorio
    for (const pathItem of systemPaths) {
      if (fs.existsSync(pathItem.src)) {
        fs.mkdirSync(path.dirname(pathItem.dest), { recursive: true });
        fs.cpSync(pathItem.src, pathItem.dest, { recursive: true });
      }
    }
    
    // Crear archivo de metadatos
    const metadata = {
      id: backupId,
      timestamp: new Date().toISOString(),
      type: 'system_files',
      contents: systemPaths.map(p => path.basename(p.src))
    };
    
    fs.writeFileSync(
      path.join(tempDir, 'metadata.json'),
      JSON.stringify(metadata, null, 2)
    );
    
    // Comprimir respaldo
    const backupFileName = `${backupId}.zip`;
    const backupFilePath = path.join(config.localBackupPath, backupFileName);
    
    await createZipArchive(tempDir, backupFilePath);
    
    // Encriptar respaldo si está configurado
    let finalBackupPath = backupFilePath;
    if (config.encryptBackups) {
      const encryptedPath = `${backupFilePath}.enc`;
      await encryptFile(backupFilePath, encryptedPath);
      
      // Eliminar archivo sin encriptar
      fs.unlinkSync(backupFilePath);
      finalBackupPath = encryptedPath;
    }
    
    // Subir a la nube si está configurado
    let cloudUploadResult = null;
    if (config.useCloudStorage) {
      cloudUploadResult = await uploadToCloud(
        finalBackupPath, 
        'backups/system'
      );
    }
    
    // Registrar respaldo en la base de datos central
    const backupRecord = {
      id: backupId,
      branch_id: null,
      created_at: new Date(),
      path: finalBackupPath,
      size: fs.statSync(finalBackupPath).size,
      type: 'system_files',
      encrypted: config.encryptBackups,
      cloud_path: cloudUploadResult?.path || null,
      cloud_provider: config.useCloudStorage ? config.cloudStorage.provider : null
    };
    
    await centralDB.query(
      `INSERT INTO backups (id, branch_id, created_at, path, size, type, encrypted, cloud_path, cloud_provider) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        backupRecord.id,
        backupRecord.branch_id,
        backupRecord.created_at,
        backupRecord.path,
        backupRecord.size,
        backupRecord.type,
        backupRecord.encrypted,
        backupRecord.cloud_path,
        backupRecord.cloud_provider
      ]
    );
    
    // Limpiar directorio temporal
    fs.rmSync(tempDir, { recursive: true, force: true });
    
    return {
      success: true,
      backupId,
      path: finalBackupPath,
      cloudPath: cloudUploadResult?.path || null
    };
  } catch (error) {
    logger.error('Error al respaldar archivos del sistema:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Crea un respaldo completo de todo el sistema (todas las bases de datos y archivos)
 */
const createFullBackup = async () => {
  try {
    // Verificar espacio en disco y limpiar si es necesario
    await manageBackupStorage();
    
    // Iniciar respaldo del sistema
    logger.info('Iniciando respaldo completo del sistema...');
    
    // Obtener todas las sucursales activas
    const branchesResult = await centralDB.query('SELECT id, name FROM branches WHERE active = true');
    
    // Respaldo de base de datos central
    logger.info('Respaldando base de datos central...');
    const centralBackupResult = await backupCentralDatabase();
    
    if (!centralBackupResult.success) {
      throw new Error(`Error al respaldar base de datos central: ${centralBackupResult.error}`);
    }
    
    // Respaldo de archivos del sistema
    logger.info('Respaldando archivos del sistema...');
    const systemFilesBackupResult = await backupSystemFiles();
    
    if (!systemFilesBackupResult.success) {
      throw new Error(`Error al respaldar archivos del sistema: ${systemFilesBackupResult.error}`);
    }
    
    // Respaldo de cada sucursal
    const branchResults = [];
    
    for (const branch of branchesResult.rows) {
      logger.info(`Respaldando sucursal ${branch.name} (ID: ${branch.id})...`);
      
      const branchBackupResult = await backupBranchDatabase(branch.id);
      branchResults.push({
        branchId: branch.id,
        branchName: branch.name,
        result: branchBackupResult
      });
      
      if (!branchBackupResult.success) {
        logger.error(`Error al respaldar sucursal ${branch.name}: ${branchBackupResult.error}`);
      }
    }
    
    // Crear registro de respaldo completo
    const timestamp = format(new Date(), 'yyyyMMdd_HHmmss');
    const fullBackupId = `full_${timestamp}`;
    
    // Registro de respaldo completo en la base de datos
    await centralDB.query(
      `INSERT INTO full_backups (id, created_at, central_backup_id, system_backup_id, status, branch_count, success_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        fullBackupId,
        new Date(),
        centralBackupResult.backupId,
        systemFilesBackupResult.backupId,
        'completed',
        branchesResult.rows.length,
        branchResults.filter(r => r.result.success).length
      ]
    );
    
    // Insertar detalles de cada sucursal respaldada
    for (const branchResult of branchResults) {
      if (branchResult.result.success) {
        await centralDB.query(
          `INSERT INTO full_backup_details (full_backup_id, branch_id, branch_backup_id, status)
           VALUES ($1, $2, $3, $4)`,
          [
            fullBackupId,
            branchResult.branchId,
            branchResult.result.backupId,
            'completed'
          ]
        );
      } else {
        await centralDB.query(
          `INSERT INTO full_backup_details (full_backup_id, branch_id, status, error)
           VALUES ($1, $2, $3, $4)`,
          [
            fullBackupId,
            branchResult.branchId,
            'failed',
            branchResult.result.error
          ]
        );
      }
    }
    
    logger.info(`Respaldo completo finalizado. ID: ${fullBackupId}`);
    
    return {
      success: true,
      backupId: fullBackupId,
      centralBackup: centralBackupResult,
      systemBackup: systemFilesBackupResult,
      branchBackups: branchResults
    };
  } catch (error) {
    logger.error('Error al crear respaldo completo:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Restaura un respaldo específico
 */
const restoreBackup = async (backupId, options = {}) => {
  try {
    // Buscar el respaldo en la base de datos
    const backupResult = await centralDB.query(
      'SELECT * FROM backups WHERE id = $1',
      [backupId]
    );
    
    if (backupResult.rows.length === 0) {
      throw new Error(`No se encontró el respaldo con ID: ${backupId}`);
    }
    
    const backup = backupResult.rows[0];
    let backupPath = backup.path;
    
    // Si el respaldo está en la nube pero no localmente, descargarlo
    if (backup.cloud_path && (!fs.existsSync(backupPath) || options.forceCloudDownload)) {
      logger.info(`Descargando respaldo desde la nube: ${backup.cloud_path}`);
      
      const downloadResult = await downloadFromCloud(backup.cloud_path, backupPath);
      
      if (!downloadResult.success) {
        throw new Error(`Error al descargar respaldo desde la nube: ${downloadResult.error}`);
      }
      
      backupPath = downloadResult.path;
    }
    
    // Si el respaldo no existe localmente
    if (!fs.existsSync(backupPath)) {
      throw new Error(`No se encontró el archivo de respaldo en la ruta: ${backupPath}`);
    }
    
    // Crear directorio temporal para la restauración
    const restoreDir = path.join(config.tempPath, `restore_${backupId}_${Date.now()}`);
    if (!fs.existsSync(restoreDir)) {
      fs.mkdirSync(restoreDir, { recursive: true });
    }
    
    // Si el respaldo está encriptado, desencriptarlo primero
    let zipPath = backupPath;
    if (backup.encrypted) {
      const decryptedPath = path.join(config.tempPath, `${path.basename(backupPath, '.enc')}`);
      await decryptFile(backupPath, decryptedPath);
      zipPath = decryptedPath;
    }
    
    // Extraer el archivo zip
    await extractZipArchive(zipPath, restoreDir);
    
    // Leer el archivo de metadatos
    const metadataPath = path.join(restoreDir, 'metadata.json');
    if (!fs.existsSync(metadataPath)) {
      throw new Error('El respaldo no contiene archivo de metadatos');
    }
    
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    
    // Restaurar según el tipo de respaldo
    switch (backup.type) {
      case 'branch_database':
        return await restoreBranchDatabase(backup.branch_id, restoreDir, metadata, options);
        
      case 'central_database':
        return await restoreCentralDatabase(restoreDir, metadata, options);
        
      case 'system_files':
        return await restoreSystemFiles(restoreDir, metadata, options);
        
      default:
        throw new Error(`Tipo de respaldo no soportado: ${backup.type}`);
    }
  } catch (error) {
    logger.error(`Error al restaurar respaldo ${backupId}:`, error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Restaura la base de datos de una sucursal específica
 */
const restoreBranchDatabase = async (branchId, restoreDir, metadata, options = {}) => {
  try {
    // Verificar si la sucursal existe
    const branchResult = await centralDB.query(
      'SELECT * FROM branches WHERE id = $1',
      [branchId]
    );
    
    if (branchResult.rows.length === 0) {
      throw new Error(`La sucursal con ID ${branchId} no existe`);
    }
    
    const branch = branchResult.rows[0];
    
    // Si la opción de forzar restauración no está habilitada y la sucursal está activa
    if (!options.forceRestore && branch.active) {
      // Verificar que no haya usuarios conectados
      const activeSessionsResult = await centralDB.query(
        'SELECT COUNT(*) FROM active_sessions WHERE branch_id = $1',
        [branchId]
      );
      
      const activeSessions = parseInt(activeSessionsResult.rows[0].count);
      
      if (activeSessions > 0 && !options.ignoreActiveSessions) {
        throw new Error(`No se puede restaurar la sucursal porque hay ${activeSessions} sesiones activas`);
      }
    }
    
    // Desconectar la sucursal temporalmente
    await centralDB.query(
      'UPDATE branches SET active = false, status = $1 WHERE id = $2',
      ['restoring', branchId]
    );
    
    // Restaurar según el tipo de base de datos
    if (metadata.dbType === 'sqlite') {
      // Para SQLite, reemplazar el archivo de base de datos
      const dbFilePath = branch.db_connection.path;
      const backupDbPath = path.join(restoreDir, 'database.sqlite');
      
      if (!fs.existsSync(backupDbPath)) {
        throw new Error('El archivo de base de datos no existe en el respaldo');
      }
      
      // Crear respaldo antes de restaurar
      const dbBackupPath = `${dbFilePath}.bak_${Date.now()}`;
      if (fs.existsSync(dbFilePath)) {
        fs.copyFileSync(dbFilePath, dbBackupPath);
      }
      
      // Reemplazar el archivo
      fs.copyFileSync(backupDbPath, dbFilePath);
      
      logger.info(`Base de datos SQLite restaurada para sucursal ${branch.name}`);
    } else if (metadata.dbType === 'postgres') {
      // Para PostgreSQL, usar pg_restore
      const { exec } = require('child_process');
      const util = require('util');
      const execPromise = util.promisify(exec);
      
      const dbConfig = branch.db_connection.config;
      const dumpFilePath = path.join(restoreDir, 'database.sql');
      
      if (!fs.existsSync(dumpFilePath)) {
        throw new Error('El archivo de respaldo SQL no existe en el respaldo');
      }
      
      // Crear comando para restaurar
      const pgRestoreCmd = `psql -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -d ${dbConfig.database} -f "${dumpFilePath}"`;
      
      // Ejecutar comando
      const env = { ...process.env, PGPASSWORD: dbConfig.password };
      await execPromise(pgRestoreCmd, { env });
      
      logger.info(`Base de datos PostgreSQL restaurada para sucursal ${branch.name}`);
    } else {
      throw new Error(`Tipo de base de datos no soportado: ${metadata.dbType}`);
    }
    
    // Activar la sucursal nuevamente
    await centralDB.query(
      'UPDATE branches SET active = true, status = $1, last_restore = $2 WHERE id = $3',
      ['active', new Date(), branchId]
    );
    
    // Registrar la restauración
    await centralDB.query(
      `INSERT INTO restore_history (backup_id, branch_id, restored_at, restored_by, success)
       VALUES ($1, $2, $3, $4, $5)`,
      [metadata.id, branchId, new Date(), options.userId || null, true]
    );
    
    return {
      success: true,
      branchId,
      branchName: branch.name,
      type: 'branch_database',
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    // En caso de error, intentar reactivar la sucursal
    try {
      await centralDB.query(
        'UPDATE branches SET active = true, status = $1 WHERE id = $2',
        ['active', branchId]
      );
    } catch (e) {
      logger.error('Error al reactivar sucursal después de fallo en restauración:', e);
    }
    
    logger.error(`Error al restaurar base de datos de sucursal ${branchId}:`, error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Restaura la base de datos central
 */
const restoreCentralDatabase = async (restoreDir, metadata, options = {}) => {
  try {
    // Esta operación es muy crítica, verificar permisos específicos
    if (!options.adminPermission) {
      throw new Error('Se requieren permisos de administrador para restaurar la base de datos central');
    }
    
    // Verificar que no haya usuarios conectados
    if (!options.ignoreActiveSessions) {
      const activeSessionsResult = await centralDB.query('SELECT COUNT(*) FROM active_sessions');
      const activeSessions = parseInt(activeSessionsResult.rows[0].count);
      
      if (activeSessions > 0) {
        throw new Error(`No se puede restaurar la base de datos central porque hay ${activeSessions} sesiones activas`);
      }
    }
    
    // Colocar el servidor en modo mantenimiento
    await centralDB.query(`
      UPDATE system_status SET 
        maintenance_mode = true, 
        maintenance_reason = 'Restauración de base de datos central en progreso', 
        last_updated = $1
    `, [new Date()]);
    
    // Para PostgreSQL, usar pg_restore
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    
    const dbConfig = dbConfig.central;
    const dumpFilePath = path.join(restoreDir, 'central_database.sql');
    
    if (!fs.existsSync(dumpFilePath)) {
      throw new Error('El archivo de respaldo SQL no existe en el respaldo');
    }
    
    // Crear comando para restaurar
    const pgRestoreCmd = `psql -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -d ${dbConfig.database} -f "${dumpFilePath}"`;
    
    // Ejecutar comando
    const env = { ...process.env, PGPASSWORD: dbConfig.password };
    await execPromise(pgRestoreCmd, { env });
    
    logger.info('Base de datos central restaurada correctamente');
    
    // Desactivar modo mantenimiento
    await centralDB.query(`
      UPDATE system_status SET 
        maintenance_mode = false, 
        maintenance_reason = null, 
        last_updated = $1
    `, [new Date()]);
    
    // No podemos registrar en restore_history porque podría haberse restaurado
    // Pero podemos notificar por correo al administrador
    if (options.notifyAdmin && config.adminEmail) {
      try {
        // Importar servicio de correo
        const emailService = require('../../services/email.js');
        
        await emailService.send({
          to: config.adminEmail,
          subject: 'Restauración de base de datos central completada',
          template: 'admin-notification',
          data: {
            action: 'Restauración de base de datos central',
            date: new Date().toLocaleString(),
            user: options.userId ? `ID: ${options.userId}` : 'Sistema',
            details: 'La restauración se completó exitosamente'
          }
        });
      } catch (e) {
        logger.error('Error al enviar notificación de restauración:', e);
      }
    }
    
    return {
      success: true,
      type: 'central_database',
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    // En caso de error, intentar desactivar modo mantenimiento
    try {
      await centralDB.query(`
        UPDATE system_status SET 
          maintenance_mode = false, 
          maintenance_reason = 'Falló la restauración: ${error.message}', 
          last_updated = $1
      `, [new Date()]);
    } catch (e) {
      logger.error('Error al actualizar estado después de fallo en restauración:', e);
    }
    
    logger.error('Error al restaurar base de datos central:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Restaura los archivos del sistema
 */
const restoreSystemFiles = async (restoreDir, metadata, options = {}) => {
  try {
    // Verificar permisos
    if (!options.adminPermission) {
      throw new Error('Se requieren permisos de administrador para restaurar archivos del sistema');
    }
    
    // Verificar contenido del respaldo
    const expectedDirs = ['templates', 'assets/img', 'config'];
    
    for (const dir of expectedDirs) {
      const sourcePath = path.join(restoreDir, dir);
      if (!fs.existsSync(sourcePath)) {
        logger.warn(`Directorio ${dir} no encontrado en el respaldo`);
      }
    }
    
    // Restaurar archivos
    const systemPaths = [
      { src: path.join(restoreDir, 'templates'), dest: path.join(config.appRootPath, 'app/templates') },
      { src: path.join(restoreDir, 'assets/img'), dest: path.join(config.appRootPath, 'app/assets/img') },
      { src: path.join(restoreDir, 'config'), dest: path.join(config.appRootPath, 'config') }
    ];
    
    for (const pathItem of systemPaths) {
      if (fs.existsSync(pathItem.src)) {
        // Crear respaldo del directorio actual
        if (fs.existsSync(pathItem.dest)) {
          const backupPath = `${pathItem.dest}.bak_${Date.now()}`;
          fs.cpSync(pathItem.dest, backupPath, { recursive: true });
        }
        
        // Reemplazar los archivos
        fs.cpSync(pathItem.src, pathItem.dest, { recursive: true });
        logger.info(`Directorio ${path.basename(pathItem.src)} restaurado correctamente`);
      }
    }
    
    // Registrar la restauración si es posible
    try {
      await centralDB.query(
        `INSERT INTO restore_history (backup_id, restored_at, restored_by, success, notes)
         VALUES ($1, $2, $3, $4, $5)`,
        [metadata.id, new Date(), options.userId || null, true, 'Restauración de archivos del sistema']
      );
    } catch (e) {
      logger.error('Error al registrar restauración de archivos del sistema:', e);
    }
    
    return {
      success: true,
      type: 'system_files',
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    logger.error('Error al restaurar archivos del sistema:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Restaura un respaldo completo
 */
const restoreFullBackup = async (fullBackupId, options = {}) => {
  try {
    // Buscar el respaldo completo
    const fullBackupResult = await centralDB.query(
      `SELECT * FROM full_backups WHERE id = $1`,
      [fullBackupId]
    );
    
    if (fullBackupResult.rows.length === 0) {
      throw new Error(`No se encontró el respaldo completo con ID: ${fullBackupId}`);
    }
    
    const fullBackup = fullBackupResult.rows[0];
    
    // Buscar detalles del respaldo completo
    const detailsResult = await centralDB.query(
      `SELECT * FROM full_backup_details WHERE full_backup_id = $1`,
      [fullBackupId]
    );
    
    // Iniciar restauración
    logger.info(`Iniciando restauración de respaldo completo ID: ${fullBackupId}`);
    
    // Primero restaurar la base de datos central
    if (fullBackup.central_backup_id) {
      logger.info(`Restaurando base de datos central (${fullBackup.central_backup_id})...`);
      
      const centralRestoreResult = await restoreBackup(
        fullBackup.central_backup_id, 
        { ...options, adminPermission: true, ignoreActiveSessions: options.force }
      );
      
      if (!centralRestoreResult.success) {
        throw new Error(`Error al restaurar base de datos central: ${centralRestoreResult.error}`);
      }
    }
    
    // Luego restaurar los archivos del sistema
    if (fullBackup.system_backup_id) {
      logger.info(`Restaurando archivos del sistema (${fullBackup.system_backup_id})...`);
      
      const systemRestoreResult = await restoreBackup(
        fullBackup.system_backup_id, 
        { ...options, adminPermission: true }
      );
      
      if (!systemRestoreResult.success) {
        throw new Error(`Error al restaurar archivos del sistema: ${systemRestoreResult.error}`);
      }
    }
    
    // Finalmente restaurar las bases de datos de las sucursales
    const branchResults = [];
    
    for (const detail of detailsResult.rows) {
      if (detail.branch_backup_id) {
        logger.info(`Restaurando sucursal ID ${detail.branch_id} (${detail.branch_backup_id})...`);
        
        const branchRestoreResult = await restoreBackup(
          detail.branch_backup_id, 
          { ...options, forceRestore: options.force, ignoreActiveSessions: options.force }
        );
        
        branchResults.push({
          branchId: detail.branch_id,
          result: branchRestoreResult
        });
        
        if (!branchRestoreResult.success) {
          logger.error(`Error al restaurar sucursal ${detail.branch_id}: ${branchRestoreResult.error}`);
        }
      }
    }
    
    // Registro de restauración completa
    await centralDB.query(
      `INSERT INTO full_restore_history (full_backup_id, restored_at, restored_by, success, branch_count, success_count)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        fullBackupId,
        new Date(),
        options.userId || null,
        true,
        detailsResult.rows.length,
        branchResults.filter(r => r.result.success).length
      ]
    );
    
    logger.info(`Restauración completa finalizada. ID: ${fullBackupId}`);
    
    return {
      success: true,
      fullBackupId,
      centralRestored: !!fullBackup.central_backup_id,
      systemRestored: !!fullBackup.system_backup_id,
      branchResults
    };
  } catch (error) {
    logger.error(`Error al restaurar respaldo completo ${fullBackupId}:`, error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Lista todos los respaldos disponibles
 */
const listBackups = async (filters = {}) => {
  try {
    let query = `
      SELECT b.*, 
             CASE WHEN b.branch_id IS NOT NULL THEN br.name ELSE NULL END AS branch_name
      FROM backups b
      LEFT JOIN branches br ON b.branch_id = br.id
      WHERE 1=1
    `;
    
    const queryParams = [];
    let paramIndex = 1;
    
    // Aplicar filtros
    if (filters.branch_id) {
      query += ` AND b.branch_id = $${paramIndex}`;
      queryParams.push(filters.branch_id);
      paramIndex++;
    }
    
    if (filters.type) {
      query += ` AND b.type = $${paramIndex}`;
      queryParams.push(filters.type);
      paramIndex++;
    }
    
    if (filters.startDate) {
      query += ` AND b.created_at >= $${paramIndex}`;
      queryParams.push(filters.startDate);
      paramIndex++;
    }
    
    if (filters.endDate) {
      query += ` AND b.created_at <= $${paramIndex}`;
      queryParams.push(filters.endDate);
      paramIndex++;
    }
    
    // Ordenar por fecha de creación descendente
    query += ' ORDER BY b.created_at DESC';
    
    // Limitar resultados si se especifica
    if (filters.limit) {
      query += ` LIMIT $${paramIndex}`;
      queryParams.push(filters.limit);
      paramIndex++;
    }
    
    const result = await centralDB.query(query, queryParams);
    
    // Añadir información de disponibilidad local
    const backupsWithAvailability = result.rows.map(backup => ({
      ...backup,
      local_available: fs.existsSync(backup.path)
    }));
    
    return {
      success: true,
      backups: backupsWithAvailability
    };
  } catch (error) {
    logger.error('Error al listar respaldos:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Lista todos los respaldos completos disponibles
 */
const listFullBackups = async (filters = {}) => {
  try {
    let query = `
      SELECT fb.*, 
             (SELECT COUNT(*) FROM full_backup_details fbd WHERE fbd.full_backup_id = fb.id) AS branch_count
      FROM full_backups fb
      WHERE 1=1
    `;
    
    const queryParams = [];
    let paramIndex = 1;
    
    // Aplicar filtros
    if (filters.startDate) {
      query += ` AND fb.created_at >= $${paramIndex}`;
      queryParams.push(filters.startDate);
      paramIndex++;
    }
    
    if (filters.endDate) {
      query += ` AND fb.created_at <= $${paramIndex}`;
      queryParams.push(filters.endDate);
      paramIndex++;
    }
    
    // Ordenar por fecha de creación descendente
    query += ' ORDER BY fb.created_at DESC';
    
    // Limitar resultados si se especifica
    if (filters.limit) {
      query += ` LIMIT $${paramIndex}`;
      queryParams.push(filters.limit);
      paramIndex++;
    }
    
    const result = await centralDB.query(query, queryParams);
    
    return {
      success: true,
      fullBackups: result.rows
    };
  } catch (error) {
    logger.error('Error al listar respaldos completos:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Elimina un respaldo específico
 */
const deleteBackup = async (backupId, options = {}) => {
  try {
    // Verificar si existe el respaldo
    const backupResult = await centralDB.query(
      'SELECT * FROM backups WHERE id = $1',
      [backupId]
    );
    
    if (backupResult.rows.length === 0) {
      throw new Error(`No se encontró el respaldo con ID: ${backupId}`);
    }
    
    const backup = backupResult.rows[0];
    
    // Eliminar archivo local si existe
    if (fs.existsSync(backup.path)) {
      fs.unlinkSync(backup.path);
      logger.info(`Archivo de respaldo eliminado: ${backup.path}`);
    }
    
    // Eliminar de la nube si está configurado y se solicita
    if (backup.cloud_path && options.deleteFromCloud) {
      try {
        const cloudClient = getCloudStorageClient();
        
        if (cloudClient) {
          switch (config.cloudStorage.provider) {
            case 's3':
              // Extraer el bucket y la clave del path
              const s3Path = backup.cloud_path.replace('s3://', '');
              const [bucket, ...keyParts] = s3Path.split('/');
              const key = keyParts.join('/');
              
              await cloudClient.send(new DeleteObjectCommand({
                Bucket: bucket,
                Key: key
              }));
              
              logger.info(`Respaldo eliminado de S3: ${backup.cloud_path}`);
              break;
              
            case 'dropbox':
              await cloudClient.filesDelete({
                path: backup.cloud_path
              });
              
              logger.info(`Respaldo eliminado de Dropbox: ${backup.cloud_path}`);
              break;
              
            case 'google':
              // Extraer el ID del archivo
              let fileId = backup.cloud_path;
              if (backup.cloud_path.includes('google.com')) {
                const urlParams = new URL(backup.cloud_path).searchParams;
                fileId = urlParams.get('id');
              }
              
              await cloudClient.files.delete({
                fileId: fileId
              });
              
              logger.info(`Respaldo eliminado de Google Drive: ${fileId}`);
              break;
          }
        }
      } catch (cloudError) {
        logger.error(`Error al eliminar respaldo de la nube: ${cloudError.message}`);
        // Continuamos con la eliminación del registro aunque falle la eliminación en la nube
      }
    }
    
    // Eliminar registro de la base de datos
    await centralDB.query(
      'DELETE FROM backups WHERE id = $1',
      [backupId]
    );
    
    return {
      success: true,
      backupId,
      message: 'Respaldo eliminado correctamente'
    };
  } catch (error) {
    logger.error(`Error al eliminar respaldo ${backupId}:`, error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Elimina un respaldo completo y sus componentes
 */
const deleteFullBackup = async (fullBackupId, options = {}) => {
  try {
    // Verificar si existe el respaldo completo
    const fullBackupResult = await centralDB.query(
      'SELECT * FROM full_backups WHERE id = $1',
      [fullBackupId]
    );
    
    if (fullBackupResult.rows.length === 0) {
      throw new Error(`No se encontró el respaldo completo con ID: ${fullBackupId}`);
    }
    
    const fullBackup = fullBackupResult.rows[0];
    
    // Obtener detalles del respaldo completo
    const detailsResult = await centralDB.query(
      'SELECT * FROM full_backup_details WHERE full_backup_id = $1',
      [fullBackupId]
    );
    
    // Eliminar respaldos de sucursales si se solicita
    if (options.deleteBranchBackups) {
      for (const detail of detailsResult.rows) {
        if (detail.branch_backup_id) {
          try {
            await deleteBackup(detail.branch_backup_id, options);
            logger.info(`Respaldo de sucursal eliminado: ${detail.branch_backup_id}`);
          } catch (err) {
            logger.error(`Error al eliminar respaldo de sucursal ${detail.branch_backup_id}:`, err);
          }
        }
      }
    }
    
    // Eliminar respaldo central si se solicita
    if (options.deleteCentralBackup && fullBackup.central_backup_id) {
      try {
        await deleteBackup(fullBackup.central_backup_id, options);
        logger.info(`Respaldo central eliminado: ${fullBackup.central_backup_id}`);
      } catch (err) {
        logger.error(`Error al eliminar respaldo central ${fullBackup.central_backup_id}:`, err);
      }
    }
    
    // Eliminar respaldo del sistema si se solicita
    if (options.deleteSystemBackup && fullBackup.system_backup_id) {
      try {
        await deleteBackup(fullBackup.system_backup_id, options);
        logger.info(`Respaldo del sistema eliminado: ${fullBackup.system_backup_id}`);
      } catch (err) {
        logger.error(`Error al eliminar respaldo del sistema ${fullBackup.system_backup_id}:`, err);
      }
    }
    
    // Eliminar detalles del respaldo completo
    await centralDB.query(
      'DELETE FROM full_backup_details WHERE full_backup_id = $1',
      [fullBackupId]
    );
    
    // Eliminar registro de respaldo completo
    await centralDB.query(
      'DELETE FROM full_backups WHERE id = $1',
      [fullBackupId]
    );
    
    return {
      success: true,
      fullBackupId,
      message: 'Respaldo completo eliminado correctamente'
    };
  } catch (error) {
    logger.error(`Error al eliminar respaldo completo ${fullBackupId}:`, error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Configura la programación de respaldos automáticos
 */
const setupBackupSchedule = () => {
  try {
    // Cancelar cualquier tarea programada previamente
    const scheduledJobs = schedule.scheduledJobs;
    for (const jobName in scheduledJobs) {
      if (jobName.startsWith('backup_')) {
        scheduledJobs[jobName].cancel();
        logger.info(`Tarea programada cancelada: ${jobName}`);
      }
    }
    
    // Programar respaldo completo automático
    if (config.autoBackup.enabled) {
      // Expresión cron para la hora configurada (por defecto, todos los días a las 23:00)
      const cronExpression = config.autoBackup.cronExpression || '0 23 * * *';
      
      schedule.scheduleJob('backup_full', cronExpression, async () => {
        logger.info('Iniciando respaldo automático programado...');
        
        try {
          const result = await createFullBackup();
          
          if (result.success) {
            logger.info(`Respaldo automático completado. ID: ${result.backupId}`);
            
            // Enviar notificación si está configurado
            if (config.autoBackup.notifyOnComplete && config.adminEmail) {
              const emailService = require('../../services/email.js');
              
              await emailService.send({
                to: config.adminEmail,
                subject: 'Respaldo automático completado',
                template: 'auto-backup-notification',
                data: {
                  backupId: result.backupId,
                  timestamp: new Date().toISOString(),
                  successBranches: result.branchBackups.filter(b => b.result.success).length,
                  totalBranches: result.branchBackups.length
                }
              });
            }
          } else {
            logger.error(`Error en respaldo automático: ${result.error}`);
            
            // Enviar notificación de error si está configurado
            if (config.autoBackup.notifyOnError && config.adminEmail) {
              const emailService = require('../../services/email.js');
              
              await emailService.send({
                to: config.adminEmail,
                subject: 'Error en respaldo automático',
                template: 'auto-backup-error',
                data: {
                  timestamp: new Date().toISOString(),
                  error: result.error
                }
              });
            }
          }
        } catch (error) {
          logger.error('Error inesperado en respaldo automático:', error);
        }
      });
      
      logger.info(`Respaldo automático programado: ${cronExpression}`);
    }
    
    return {
      success: true,
      scheduled: config.autoBackup.enabled,
      cronExpression: config.autoBackup.cronExpression || '0 23 * * *'
    };
  } catch (error) {
    logger.error('Error al configurar programación de respaldos:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Sincroniza respaldos entre la nube y el almacenamiento local
 */
const syncCloudBackups = async (options = {}) => {
  try {
    if (!config.useCloudStorage) {
      return {
        success: false,
        message: 'El almacenamiento en la nube no está configurado'
      };
    }
    
    const cloudClient = getCloudStorageClient();
    if (!cloudClient) {
      return {
        success: false,
        message: 'No se pudo inicializar el cliente de almacenamiento en la nube'
      };
    }
    
    // Obtener respaldos locales
    const localBackupsResult = await listBackups();
    if (!localBackupsResult.success) {
      throw new Error(`Error al obtener respaldos locales: ${localBackupsResult.error}`);
    }
    
    const localBackups = localBackupsResult.backups;
    
    // Descargar respaldos desde la nube que no existen localmente
    if (options.downloadMissing) {
      const missingBackups = localBackups.filter(b => b.cloud_path && !b.local_available);
      
      logger.info(`Se encontraron ${missingBackups.length} respaldos para descargar desde la nube`);
      
      for (const backup of missingBackups) {
        try {
          logger.info(`Descargando respaldo ${backup.id} desde la nube...`);
          
          await downloadFromCloud(backup.cloud_path, backup.path);
          
          logger.info(`Respaldo ${backup.id} descargado correctamente`);
        } catch (err) {
          logger.error(`Error al descargar respaldo ${backup.id}:`, err);
        }
      }
    }
    
    // Subir respaldos locales que no están en la nube
    if (options.uploadMissing) {
      const pendingBackups = localBackups.filter(b => !b.cloud_path && b.local_available);
      
      logger.info(`Se encontraron ${pendingBackups.length} respaldos para subir a la nube`);
      
      for (const backup of pendingBackups) {
        try {
          logger.info(`Subiendo respaldo ${backup.id} a la nube...`);
          
          const destinationPath = backup.branch_id 
            ? `backups/branches/${backup.branch_id}`
            : `backups/${backup.type}`;
          
          const uploadResult = await uploadToCloud(backup.path, destinationPath);
          
          if (uploadResult.success) {
            // Actualizar registro con la ruta en la nube
            await centralDB.query(
              `UPDATE backups SET cloud_path = $1, cloud_provider = $2 WHERE id = $3`,
              [uploadResult.path, config.cloudStorage.provider, backup.id]
            );
            
            logger.info(`Respaldo ${backup.id} subido correctamente`);
          } else {
            logger.error(`Error al subir respaldo ${backup.id}: ${uploadResult.error}`);
          }
        } catch (err) {
          logger.error(`Error al procesar respaldo ${backup.id} para subir:`, err);
        }
      }
    }
    
    return {
      success: true,
      syncedCount: {
        downloaded: options.downloadMissing ? localBackups.filter(b => b.cloud_path && !b.local_available).length : 0,
        uploaded: options.uploadMissing ? localBackups.filter(b => !b.cloud_path && b.local_available).length : 0
      }
    };
  } catch (error) {
    logger.error('Error al sincronizar respaldos con la nube:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

// Inicializar programación de respaldos al cargar el módulo
setupBackupSchedule();

// Exportar funciones del controlador
module.exports = {
  initDatabaseConnections,
  createFullBackup,
  backupBranchDatabase,
  backupCentralDatabase,
  backupSystemFiles,
  restoreBackup,
  restoreFullBackup,
  listBackups,
  listFullBackups,
  deleteBackup,
  deleteFullBackup,
  manageBackupStorage,
  syncCloudBackups,
  setupBackupSchedule
};