'use strict';

// Dependencias principales
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const compression = require('compression');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const winston = require('winston');

// Configuración
const config = require('./config/config.js');
const dbConfig = require('./config/database.js');
const securityConfig = require('./config/security.js');

// Rutas
const apiRoutes = require('./routes/api.js');
const authRoutes = require('./routes/auth.js');
const syncRoutes = require('./routes/sync.js');

// Controladores para WebSockets
const syncController = require('./controllers/syncController.js');
const backupController = require('./controllers/backupController.js');

// Configuración de logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'factusystem-server' },
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

// Crear directorio de logs si no existe
if (!fs.existsSync('logs')) {
  fs.mkdirSync('logs');
}

// Inicializar la aplicación Express
const app = express();

// Configuración de seguridad básica
app.use(helmet());
app.use(cors({
  origin: config.allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Limitar peticiones para prevenir ataques DoS
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 150, // limite de peticiones por ventana
  message: 'Demasiadas peticiones desde esta IP, por favor intente nuevamente más tarde'
});
app.use('/api/', limiter);

// Middleware para parseo y compresión
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(compression());

// Logging de peticiones HTTP
app.use(morgan('combined', {
  stream: {
    write: (message) => logger.info(message.trim())
  }
}));

// Middleware de autenticación JWT para rutas protegidas
const authenticateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (authHeader) {
    const token = authHeader.split(' ')[1];

    jwt.verify(token, securityConfig.jwtSecret, (err, user) => {
      if (err) {
        logger.warn(`Error de autenticación JWT: ${err.message}`);
        return res.sendStatus(403);
      }

      req.user = user;
      next();
    });
  } else {
    res.sendStatus(401);
  }
};

// Middleware para acceso a rutas según rol de usuario
const checkRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'No autenticado' });
    }

    if (roles.includes(req.user.role)) {
      return next();
    }

    return res.status(403).json({ message: 'No autorizado - Rol insuficiente' });
  };
};

// Rutas públicas
app.use('/api/auth', authRoutes);

// Rutas protegidas
app.use('/api', authenticateJWT, apiRoutes);
app.use('/api/sync', authenticateJWT, syncRoutes);

// Ruta para verificar estado del servidor
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'UP',
    timestamp: new Date(),
    serverInfo: {
      platform: process.platform,
      nodeVersion: process.version,
      memoryUsage: process.memoryUsage()
    }
  });
});

// Conexión a la base de datos MongoDB
mongoose.connect(dbConfig.mongoUri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  useCreateIndex: true,
  useFindAndModify: false
})
.then(() => {
  logger.info('Conexión a MongoDB establecida correctamente');
})
.catch((error) => {
  logger.error(`Error al conectar a MongoDB: ${error.message}`);
  process.exit(1);
});

// Manejo de errores no capturados
app.use((err, req, res, next) => {
  logger.error(`Error no manejado: ${err.stack}`);
  res.status(500).json({
    error: 'Error interno del servidor',
    message: config.environment === 'development' ? err.message : 'Algo salió mal'
  });
});

// Ruta 404 para solicitudes no encontradas
app.use((req, res) => {
  res.status(404).json({
    error: 'Ruta no encontrada',
    path: req.originalUrl
  });
});

// Configuración de SSL para modo producción
let server;
if (config.environment === 'production' && fs.existsSync(securityConfig.sslCertPath) && fs.existsSync(securityConfig.sslKeyPath)) {
  const httpsOptions = {
    key: fs.readFileSync(securityConfig.sslKeyPath),
    cert: fs.readFileSync(securityConfig.sslCertPath)
  };
  server = https.createServer(httpsOptions, app);
  logger.info('Servidor HTTPS configurado con éxito');
} else {
  server = http.createServer(app);
  if (config.environment === 'production') {
    logger.warn('Ejecutando en producción sin SSL - se recomienda configurar HTTPS');
  } else {
    logger.info('Servidor HTTP configurado para entorno de desarrollo');
  }
}

// Configuración de Socket.IO para sincronización en tiempo real
const io = socketIo(server, {
  cors: {
    origin: config.allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Middleware para autenticación de Socket.IO
io.use((socket, next) => {
  if (socket.handshake.query && socket.handshake.query.token) {
    jwt.verify(socket.handshake.query.token, securityConfig.jwtSecret, (err, decoded) => {
      if (err) {
        logger.warn(`WebSocket: Error de autenticación: ${err.message}`);
        return next(new Error('Autenticación fallida'));
      }
      socket.user = decoded;
      next();
    });
  } else {
    logger.warn('WebSocket: Intento de conexión sin token');
    next(new Error('Autenticación requerida'));
  }
});

// Gestionar conexiones WebSocket
io.on('connection', (socket) => {
  logger.info(`WebSocket: Nueva conexión establecida - Usuario: ${socket.user.username}, Sucursal: ${socket.user.branch}`);
  
  // Unir al usuario a la sala de su sucursal
  socket.join(`branch-${socket.user.branch}`);
  
  // Eventos de sincronización
  socket.on('sync:request', (data) => {
    syncController.handleSyncRequest(socket, data);
  });
  
  socket.on('sync:push', (data) => {
    syncController.handleSyncPush(io, socket, data);
  });
  
  // Eventos de backup
  socket.on('backup:request', (data) => {
    backupController.requestBackup(socket, data);
  });
  
  socket.on('backup:status', (data) => {
    backupController.updateBackupStatus(socket, data);
  });
  
  // Manejar actualizaciones de productos
  socket.on('products:update', (data) => {
    // Notificar a todos los clientes de la misma sucursal sobre la actualización
    io.to(`branch-${socket.user.branch}`).emit('products:updated', {
      productId: data.productId,
      updatedData: data.data,
      updatedBy: socket.user.username,
      timestamp: new Date()
    });
    logger.info(`WebSocket: Producto actualizado y notificado - ID: ${data.productId}, Usuario: ${socket.user.username}`);
  });
  
  // Manejar actualizaciones de caja
  socket.on('cash:update', (data) => {
    // Notificar a todos los clientes de la misma sucursal sobre la actualización de caja
    io.to(`branch-${socket.user.branch}`).emit('cash:updated', {
      operation: data.operation,
      amount: data.amount,
      updatedBy: socket.user.username,
      timestamp: new Date()
    });
    logger.info(`WebSocket: Actualización de caja notificada - Operación: ${data.operation}, Usuario: ${socket.user.username}`);
  });
  
  // Manejar nuevas ventas
  socket.on('sale:new', (data) => {
    // Notificar a todos los clientes de la misma sucursal sobre la nueva venta
    io.to(`branch-${socket.user.branch}`).emit('sale:created', {
      saleId: data.saleId,
      amount: data.amount,
      client: data.client,
      createdBy: socket.user.username,
      timestamp: new Date()
    });
    logger.info(`WebSocket: Nueva venta notificada - ID: ${data.saleId}, Usuario: ${socket.user.username}`);
  });
  
  // Notificaciones para clientes en caja
  socket.on('notification:cashier', (data) => {
    // Enviar notificación a todos los usuarios de la sucursal con rol de cajero
    io.to(`branch-${socket.user.branch}`).emit('notification', {
      type: 'cashier',
      message: data.message,
      data: data.data,
      timestamp: new Date()
    });
    logger.info(`WebSocket: Notificación a cajeros enviada - Sucursal: ${socket.user.branch}`);
  });
  
  // Manejar eventos de pago
  socket.on('payment:mercadopago', (data) => {
    // Notificar a todos los clientes de la misma sucursal sobre el pago de MercadoPago
    io.to(`branch-${socket.user.branch}`).emit('payment:received', {
      paymentId: data.paymentId,
      type: 'mercadopago',
      amount: data.amount,
      status: data.status,
      externalId: data.externalId,
      timestamp: new Date()
    });
    logger.info(`WebSocket: Pago MercadoPago recibido - ID: ${data.paymentId}, Estado: ${data.status}`);
  });
  
  // Desconexión
  socket.on('disconnect', () => {
    logger.info(`WebSocket: Conexión cerrada - Usuario: ${socket.user?.username}`);
  });
});

// Programador de tareas para sincronización periódica
const syncScheduler = require('./services/sync/scheduler.js');
syncScheduler.initScheduledJobs();

// Iniciar el servidor
const PORT = process.env.PORT || config.port;
server.listen(PORT, () => {
  logger.info(`Servidor FactuSystem iniciado en el puerto ${PORT} - Entorno: ${config.environment}`);
  logger.info(`Fecha de inicio: ${new Date().toISOString()}`);
  logger.info(`Versión del servidor: ${config.version}`);
  
  // Información sobre las integraciones configuradas
  logger.info(`Integraciones activas: 
    - ARCA (AFIP): ${config.integrations.arca.enabled ? 'Activado' : 'Desactivado'}
    - MercadoPago: ${config.integrations.mercadoPago.enabled ? 'Activado' : 'Desactivado'}
    - WhatsApp: ${config.integrations.whatsapp.enabled ? 'Activado' : 'Desactivado'}
    - Email: ${config.integrations.email.enabled ? 'Activado' : 'Desactivado'}
    - Bancos: ${Object.keys(config.integrations.banks).filter(bank => config.integrations.banks[bank].enabled).join(', ') || 'Ninguno activado'}
  `);
});

// Manejo de señales para cierre gracioso del servidor
process.on('SIGTERM', () => {
  logger.info('Señal SIGTERM recibida. Cerrando el servidor...');
  gracefulShutdown();
});

process.on('SIGINT', () => {
  logger.info('Señal SIGINT recibida. Cerrando el servidor...');
  gracefulShutdown();
});

// Función para cierre gracioso
function gracefulShutdown() {
  server.close(() => {
    logger.info('Servidor HTTP cerrado.');
    
    // Cerrar conexión a la base de datos
    mongoose.connection.close(false, () => {
      logger.info('Conexión a MongoDB cerrada.');
      logger.info('Servidor detenido correctamente.');
      process.exit(0);
    });
    
    // Si la conexión a la BD no se cierra en 5 segundos, forzar salida
    setTimeout(() => {
      logger.error('No se pudo cerrar la conexión a MongoDB, forzando salida.');
      process.exit(1);
    }, 5000);
  });
  
  // Si el servidor no se cierra en 10 segundos, forzar salida
  setTimeout(() => {
    logger.error('No se pudo cerrar el servidor correctamente, forzando salida.');
    process.exit(1);
  }, 10000);
}

module.exports = { app, server };