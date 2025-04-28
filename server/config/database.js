/**
 * server/config/database.js
 * Configuración de la base de datos para el servidor de sincronización
 * Gestiona conexiones centralizadas para múltiples sucursales
 */

const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const mysql = require('mysql2/promise');
const { Pool } = require('pg');
const mongoose = require('mongoose');
const winston = require('winston');
const { v4: uuidv4 } = require('uuid');

// Configuración de logger para la base de datos
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'database-service' },
  transports: [
    new winston.transports.File({ filename: path.join(__dirname, '../../logs/database-error.log'), level: 'error' }),
    new winston.transports.File({ filename: path.join(__dirname, '../../logs/database.log') }),
  ]
});

// Para entorno de desarrollo, también mostrar logs en consola
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

// Configuración por defecto
const defaultConfig = {
  type: process.env.DB_TYPE || 'sqlite', // sqlite, mysql, postgres, mongodb
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || '',
  username: process.env.DB_USER || '',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'factusystem',
  synchronize: process.env.DB_SYNC === 'true',
  logging: process.env.DB_LOGGING === 'true',
  ssl: process.env.DB_SSL === 'true',
  maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || '10'),
  timeout: parseInt(process.env.DB_TIMEOUT || '60000'),
  socketPath: process.env.DB_SOCKET_PATH || null,
};

// Objeto para almacenar conexiones activas por sucursal
const connections = {};

// Directorio para bases de datos SQLite
const SQLITE_DIR = path.join(__dirname, '../../db/sqlite');

// Asegurar que existe el directorio de SQLite
if (!fs.existsSync(SQLITE_DIR)) {
  fs.mkdirSync(SQLITE_DIR, { recursive: true });
}

/**
 * Establecer la configuración de conexión para una sucursal específica
 * @param {Object} config - Configuración de la base de datos
 * @param {string} branchId - ID de la sucursal
 * @returns {Object} Configuración actualizada
 */
function getConnectionConfig(config, branchId = 'central') {
  const connectionConfig = { ...config };
  
  if (branchId !== 'central') {
    // Para sucursales, modificar la configuración según el ID
    switch (connectionConfig.type) {
      case 'sqlite':
        connectionConfig.database = path.join(SQLITE_DIR, `${branchId}.db`);
        break;
      case 'mysql':
      case 'postgres':
        connectionConfig.database = `${connectionConfig.database}_${branchId}`;
        break;
      case 'mongodb':
        connectionConfig.database = `${connectionConfig.database}_${branchId}`;
        break;
    }
  }
  
  return connectionConfig;
}

/**
 * Crear una conexión SQLite
 * @param {Object} config - Configuración de la base de datos
 * @returns {Promise<Object>} Conexión SQLite
 */
async function createSQLiteConnection(config) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(config.database, (err) => {
      if (err) {
        logger.error(`Error al conectar a SQLite: ${err.message}`, { config });
        return reject(err);
      }
      
      logger.info(`Conexión SQLite establecida: ${config.database}`);
      
      // Habilitar claves foráneas
      db.run('PRAGMA foreign_keys = ON');
      
      // Configuración para optimizar rendimiento
      db.run('PRAGMA journal_mode = WAL');
      db.run('PRAGMA synchronous = NORMAL');
      db.run('PRAGMA temp_store = MEMORY');
      db.run('PRAGMA mmap_size = 30000000000');
      
      resolve(db);
    });
  });
}

/**
 * Crear una conexión MySQL
 * @param {Object} config - Configuración de la base de datos
 * @returns {Promise<Object>} Pool de conexiones MySQL
 */
async function createMySQLConnection(config) {
  try {
    const pool = mysql.createPool({
      host: config.host,
      port: config.port || 3306,
      user: config.username,
      password: config.password,
      database: config.database,
      waitForConnections: true,
      connectionLimit: config.maxConnections,
      queueLimit: 0,
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
      socketPath: config.socketPath,
    });
    
    // Verificar la conexión
    await pool.query('SELECT 1');
    logger.info(`Conexión MySQL establecida: ${config.host}/${config.database}`);
    
    return pool;
  } catch (error) {
    logger.error(`Error al conectar a MySQL: ${error.message}`, { config });
    throw error;
  }
}

/**
 * Crear una conexión PostgreSQL
 * @param {Object} config - Configuración de la base de datos
 * @returns {Promise<Object>} Pool de conexiones PostgreSQL
 */
async function createPostgresConnection(config) {
  try {
    const pool = new Pool({
      host: config.host,
      port: config.port || 5432,
      user: config.username,
      password: config.password,
      database: config.database,
      max: config.maxConnections,
      idleTimeoutMillis: config.timeout,
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
    });
    
    // Verificar la conexión
    await pool.query('SELECT 1');
    logger.info(`Conexión PostgreSQL establecida: ${config.host}/${config.database}`);
    
    return pool;
  } catch (error) {
    logger.error(`Error al conectar a PostgreSQL: ${error.message}`, { config });
    throw error;
  }
}

/**
 * Crear una conexión MongoDB
 * @param {Object} config - Configuración de la base de datos
 * @returns {Promise<Object>} Conexión MongoDB
 */
async function createMongoDBConnection(config) {
  try {
    // Construir URI de conexión
    const uri = config.uri || `mongodb://${config.username ? `${config.username}:${config.password}@` : ''}${config.host}${config.port ? `:${config.port}` : ''}/${config.database}`;
    
    const options = {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: config.timeout,
      ssl: config.ssl,
    };
    
    await mongoose.connect(uri, options);
    logger.info(`Conexión MongoDB establecida: ${uri}`);
    
    return mongoose.connection;
  } catch (error) {
    logger.error(`Error al conectar a MongoDB: ${error.message}`, { config });
    throw error;
  }
}

/**
 * Establecer una conexión a la base de datos según la configuración
 * @param {Object} config - Configuración de la base de datos
 * @returns {Promise<Object>} Conexión a la base de datos
 */
async function createConnection(config) {
  try {
    switch (config.type.toLowerCase()) {
      case 'sqlite':
        return await createSQLiteConnection(config);
      case 'mysql':
        return await createMySQLConnection(config);
      case 'postgres':
        return await createPostgresConnection(config);
      case 'mongodb':
        return await createMongoDBConnection(config);
      default:
        throw new Error(`Tipo de base de datos no soportado: ${config.type}`);
    }
  } catch (error) {
    logger.error(`Error al crear conexión: ${error.message}`, { config });
    throw error;
  }
}

/**
 * Obtener una conexión para una sucursal específica
 * @param {string} branchId - ID de la sucursal
 * @param {Object} customConfig - Configuración personalizada (opcional)
 * @returns {Promise<Object>} Conexión a la base de datos
 */
async function getConnection(branchId = 'central', customConfig = {}) {
  try {
    // Si ya existe una conexión activa para esta sucursal, devolverla
    if (connections[branchId]) {
      return connections[branchId];
    }
    
    // Combinar configuración predeterminada con la personalizada
    const config = { ...defaultConfig, ...customConfig };
    
    // Obtener configuración específica para la sucursal
    const connectionConfig = getConnectionConfig(config, branchId);
    
    // Crear la conexión
    const connection = await createConnection(connectionConfig);
    
    // Almacenar la conexión para futuros usos
    connections[branchId] = connection;
    
    return connection;
  } catch (error) {
    logger.error(`Error al obtener conexión para la sucursal ${branchId}: ${error.message}`);
    throw error;
  }
}

/**
 * Cerrar una conexión específica
 * @param {string} branchId - ID de la sucursal
 * @returns {Promise<void>}
 */
async function closeConnection(branchId = 'central') {
  if (!connections[branchId]) {
    return;
  }
  
  try {
    const connection = connections[branchId];
    const config = getConnectionConfig(defaultConfig, branchId);
    
    switch (config.type.toLowerCase()) {
      case 'sqlite':
        await new Promise((resolve, reject) => {
          connection.close((err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        });
        break;
      case 'mysql':
        await connection.end();
        break;
      case 'postgres':
        await connection.end();
        break;
      case 'mongodb':
        await connection.close();
        break;
    }
    
    delete connections[branchId];
    logger.info(`Conexión cerrada para la sucursal ${branchId}`);
  } catch (error) {
    logger.error(`Error al cerrar la conexión para la sucursal ${branchId}: ${error.message}`);
    throw error;
  }
}

/**
 * Cerrar todas las conexiones activas
 * @returns {Promise<void>}
 */
async function closeAllConnections() {
  const branchIds = Object.keys(connections);
  
  for (const branchId of branchIds) {
    await closeConnection(branchId);
  }
  
  logger.info('Todas las conexiones han sido cerradas');
}

/**
 * Ejecutar una consulta en una conexión específica
 * @param {string} branchId - ID de la sucursal
 * @param {string} query - Consulta SQL o comando
 * @param {Array} params - Parámetros para la consulta
 * @returns {Promise<any>} Resultado de la consulta
 */
async function executeQuery(branchId, query, params = []) {
  try {
    const connection = await getConnection(branchId);
    const config = getConnectionConfig(defaultConfig, branchId);
    
    let result;
    switch (config.type.toLowerCase()) {
      case 'sqlite':
        result = await new Promise((resolve, reject) => {
          const isSelect = query.trim().toLowerCase().startsWith('select');
          
          if (isSelect) {
            connection.all(query, params, (err, rows) => {
              if (err) {
                reject(err);
              } else {
                resolve(rows);
              }
            });
          } else {
            connection.run(query, params, function(err) {
              if (err) {
                reject(err);
              } else {
                resolve({ 
                  lastID: this.lastID, 
                  changes: this.changes 
                });
              }
            });
          }
        });
        break;
      case 'mysql':
        const [rows] = await connection.execute(query, params);
        result = rows;
        break;
      case 'postgres':
        const res = await connection.query(query, params);
        result = res.rows;
        break;
      case 'mongodb':
        // MongoDB requiere un enfoque diferente ya que no usa SQL
        // Este es un placeholder. La implementación real dependerá de cómo
        // se estructuren las consultas en tu aplicación.
        throw new Error('Las consultas directas no son compatibles con MongoDB. Usa el modelo mongoose apropiado.');
    }
    
    return result;
  } catch (error) {
    logger.error(`Error al ejecutar consulta en la sucursal ${branchId}: ${error.message}`, { query, params });
    throw error;
  }
}

/**
 * Iniciar una transacción en una conexión específica
 * @param {string} branchId - ID de la sucursal
 * @returns {Promise<any>} Objeto de transacción
 */
async function beginTransaction(branchId = 'central') {
  try {
    const connection = await getConnection(branchId);
    const config = getConnectionConfig(defaultConfig, branchId);
    
    let transaction;
    switch (config.type.toLowerCase()) {
      case 'sqlite':
        await new Promise((resolve, reject) => {
          connection.run('BEGIN TRANSACTION', (err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        });
        transaction = connection;
        break;
      case 'mysql':
        const [result] = await connection.query('START TRANSACTION');
        transaction = connection;
        break;
      case 'postgres':
        await connection.query('BEGIN');
        transaction = connection;
        break;
      case 'mongodb':
        transaction = await mongoose.startSession();
        transaction.startTransaction();
        break;
    }
    
    logger.info(`Transacción iniciada para la sucursal ${branchId}`);
    return transaction;
  } catch (error) {
    logger.error(`Error al iniciar transacción para la sucursal ${branchId}: ${error.message}`);
    throw error;
  }
}

/**
 * Confirmar una transacción
 * @param {string} branchId - ID de la sucursal
 * @param {Object} transaction - Objeto de transacción
 * @returns {Promise<void>}
 */
async function commitTransaction(branchId = 'central', transaction) {
  try {
    const config = getConnectionConfig(defaultConfig, branchId);
    
    switch (config.type.toLowerCase()) {
      case 'sqlite':
        await new Promise((resolve, reject) => {
          transaction.run('COMMIT', (err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        });
        break;
      case 'mysql':
        await transaction.query('COMMIT');
        break;
      case 'postgres':
        await transaction.query('COMMIT');
        break;
      case 'mongodb':
        await transaction.commitTransaction();
        await transaction.endSession();
        break;
    }
    
    logger.info(`Transacción confirmada para la sucursal ${branchId}`);
  } catch (error) {
    logger.error(`Error al confirmar transacción para la sucursal ${branchId}: ${error.message}`);
    throw error;
  }
}

/**
 * Revertir una transacción
 * @param {string} branchId - ID de la sucursal
 * @param {Object} transaction - Objeto de transacción
 * @returns {Promise<void>}
 */
async function rollbackTransaction(branchId = 'central', transaction) {
  try {
    const config = getConnectionConfig(defaultConfig, branchId);
    
    switch (config.type.toLowerCase()) {
      case 'sqlite':
        await new Promise((resolve, reject) => {
          transaction.run('ROLLBACK', (err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        });
        break;
      case 'mysql':
        await transaction.query('ROLLBACK');
        break;
      case 'postgres':
        await transaction.query('ROLLBACK');
        break;
      case 'mongodb':
        await transaction.abortTransaction();
        await transaction.endSession();
        break;
    }
    
    logger.info(`Transacción revertida para la sucursal ${branchId}`);
  } catch (error) {
    logger.error(`Error al revertir transacción para la sucursal ${branchId}: ${error.message}`);
    throw error;
  }
}

/**
 * Registrar una nueva sucursal en el sistema
 * @param {Object} branchData - Datos de la sucursal
 * @returns {Promise<string>} ID de la sucursal registrada
 */
async function registerBranch(branchData) {
  try {
    // Generar ID único para la sucursal si no se proporciona
    const branchId = branchData.id || uuidv4();
    
    // Registrar la sucursal en la base de datos central
    const centralConnection = await getConnection();
    const config = getConnectionConfig(defaultConfig, 'central');
    
    switch (config.type.toLowerCase()) {
      case 'sqlite':
        await new Promise((resolve, reject) => {
          centralConnection.run(
            `INSERT OR REPLACE INTO branches (id, name, address, phone, email, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
            [branchId, branchData.name, branchData.address, branchData.phone, branchData.email],
            (err) => {
              if (err) {
                reject(err);
              } else {
                resolve();
              }
            }
          );
        });
        break;
      case 'mysql':
        await centralConnection.execute(
          `INSERT INTO branches (id, name, address, phone, email, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, NOW(), NOW())
           ON DUPLICATE KEY UPDATE 
             name = VALUES(name),
             address = VALUES(address),
             phone = VALUES(phone),
             email = VALUES(email),
             updated_at = NOW()`,
          [branchId, branchData.name, branchData.address, branchData.phone, branchData.email]
        );
        break;
      case 'postgres':
        await centralConnection.query(
          `INSERT INTO branches (id, name, address, phone, email, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name,
             address = EXCLUDED.address,
             phone = EXCLUDED.phone,
             email = EXCLUDED.email,
             updated_at = NOW()`,
          [branchId, branchData.name, branchData.address, branchData.phone, branchData.email]
        );
        break;
      case 'mongodb':
        const Branch = mongoose.model('Branch');
        await Branch.findOneAndUpdate(
          { _id: branchId },
          {
            $set: {
              name: branchData.name,
              address: branchData.address,
              phone: branchData.phone,
              email: branchData.email,
              updatedAt: new Date()
            }
          },
          { upsert: true, new: true }
        );
        break;
    }
    
    // Inicializar base de datos para la sucursal si es necesario
    if (branchData.initializeDatabase) {
      await initializeBranchDatabase(branchId);
    }
    
    logger.info(`Sucursal registrada: ${branchId} (${branchData.name})`);
    return branchId;
  } catch (error) {
    logger.error(`Error al registrar sucursal: ${error.message}`, { branchData });
    throw error;
  }
}

/**
 * Inicializar la base de datos para una nueva sucursal
 * @param {string} branchId - ID de la sucursal
 * @returns {Promise<void>}
 */
async function initializeBranchDatabase(branchId) {
  try {
    // Obtener esquema de la base de datos
    const schemaPath = path.join(__dirname, '../../db/schema.js');
    
    if (!fs.existsSync(schemaPath)) {
      throw new Error(`Archivo de esquema no encontrado: ${schemaPath}`);
    }
    
    // Importar y ejecutar el esquema
    const { initializeSchema } = require(schemaPath);
    await initializeSchema(branchId);
    
    logger.info(`Base de datos inicializada para la sucursal: ${branchId}`);
  } catch (error) {
    logger.error(`Error al inicializar base de datos para la sucursal ${branchId}: ${error.message}`);
    throw error;
  }
}

/**
 * Obtener lista de todas las sucursales registradas
 * @returns {Promise<Array>} Lista de sucursales
 */
async function getBranches() {
  try {
    const centralConnection = await getConnection();
    const config = getConnectionConfig(defaultConfig, 'central');
    
    let branches;
    switch (config.type.toLowerCase()) {
      case 'sqlite':
        branches = await new Promise((resolve, reject) => {
          centralConnection.all(
            'SELECT * FROM branches ORDER BY name',
            (err, rows) => {
              if (err) {
                reject(err);
              } else {
                resolve(rows);
              }
            }
          );
        });
        break;
      case 'mysql':
        const [rows] = await centralConnection.execute('SELECT * FROM branches ORDER BY name');
        branches = rows;
        break;
      case 'postgres':
        const result = await centralConnection.query('SELECT * FROM branches ORDER BY name');
        branches = result.rows;
        break;
      case 'mongodb':
        const Branch = mongoose.model('Branch');
        branches = await Branch.find().sort({ name: 1 });
        break;
    }
    
    return branches;
  } catch (error) {
    logger.error(`Error al obtener lista de sucursales: ${error.message}`);
    throw error;
  }
}

/**
 * Verificar el estado de la conexión de una sucursal
 * @param {string} branchId - ID de la sucursal
 * @returns {Promise<Object>} Estado de la conexión
 */
async function checkConnectionStatus(branchId = 'central') {
  try {
    const connection = connections[branchId];
    
    if (!connection) {
      return {
        connected: false,
        status: 'not_initialized',
        message: 'La conexión no ha sido inicializada'
      };
    }
    
    const config = getConnectionConfig(defaultConfig, branchId);
    let status = { connected: false, status: 'unknown', message: '' };
    
    switch (config.type.toLowerCase()) {
      case 'sqlite':
        // Para SQLite, intentamos ejecutar una consulta simple
        try {
          await new Promise((resolve, reject) => {
            connection.get('SELECT 1', (err, row) => {
              if (err) {
                reject(err);
              } else {
                resolve(row);
              }
            });
          });
          status = { connected: true, status: 'connected', message: 'Conexión activa' };
        } catch (err) {
          status = { connected: false, status: 'error', message: err.message };
        }
        break;
      case 'mysql':
        // Para MySQL, revisar si el pool está cerrado
        status = {
          connected: !connection._closed,
          status: connection._closed ? 'closed' : 'connected',
          message: connection._closed ? 'Conexión cerrada' : 'Conexión activa'
        };
        break;
      case 'postgres':
        // Para PostgreSQL, revisar el estado del pool
        try {
          await connection.query('SELECT 1');
          status = { connected: true, status: 'connected', message: 'Conexión activa' };
        } catch (err) {
          status = { connected: false, status: 'error', message: err.message };
        }
        break;
      case 'mongodb':
        // Para MongoDB, revisar el estado de la conexión
        status = {
          connected: connection.readyState === 1,
          status: ['disconnected', 'connected', 'connecting', 'disconnecting'][connection.readyState] || 'unknown',
          message: connection.readyState === 1 ? 'Conexión activa' : 'Conexión inactiva'
        };
        break;
    }
    
    return {
      ...status,
      branchId,
      type: config.type,
      database: config.database
    };
  } catch (error) {
    logger.error(`Error al verificar estado de conexión para sucursal ${branchId}: ${error.message}`);
    return {
      connected: false,
      status: 'error',
      message: error.message,
      branchId,
      type: getConnectionConfig(defaultConfig, branchId).type
    };
  }
}

/**
 * Compactar la base de datos SQLite
 * @param {string} branchId - ID de la sucursal
 * @returns {Promise<void>}
 */
async function vacuumDatabase(branchId) {
  try {
    const connection = await getConnection(branchId);
    const config = getConnectionConfig(defaultConfig, branchId);
    
    if (config.type.toLowerCase() === 'sqlite') {
      await new Promise((resolve, reject) => {
        connection.run('VACUUM', (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
      logger.info(`Base de datos compactada para la sucursal ${branchId}`);
    } else {
      logger.warn(`La operación VACUUM solo está disponible para SQLite (sucursal: ${branchId})`);
    }
  } catch (error) {
    logger.error(`Error al compactar base de datos para la sucursal ${branchId}: ${error.message}`);
    throw error;
  }
}

// Exportar funciones y configuración
module.exports = {
  getConnection,
  closeConnection,
  closeAllConnections,
  executeQuery,
  beginTransaction,
  commitTransaction,
  rollbackTransaction,
  registerBranch,
  initializeBranchDatabase,
  getBranches,
  checkConnectionStatus,
  vacuumDatabase,
  defaultConfig,
  logger
};