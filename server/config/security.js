/**
 * security.js
 * Configuración de seguridad para el servidor de FactuSystem
 * Maneja autenticación, autorización, cifrado y protección contra ataques
 */

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { authenticator } = require('otplib');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const xss = require('xss-clean');
const hpp = require('hpp');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');

// Cargar variables de entorno o valores por defecto
const JWT_SECRET = process.env.JWT_SECRET || uuidv4();
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const JWT_COOKIE_EXPIRES_IN = process.env.JWT_COOKIE_EXPIRES_IN || 7;
const NODE_ENV = process.env.NODE_ENV || 'development';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
const ENCRYPTION_IV = process.env.ENCRYPTION_IV || crypto.randomBytes(16).toString('hex');

// Configuración de cifrado
const encryptionConfig = {
  algorithm: 'aes-256-cbc',
  key: Buffer.from(ENCRYPTION_KEY, 'hex'),
  iv: Buffer.from(ENCRYPTION_IV, 'hex')
};

/**
 * Cifra datos sensibles para almacenamiento
 * @param {string} text - Texto a cifrar
 * @returns {string} - Texto cifrado en formato hexadecimal
 */
const encrypt = (text) => {
  try {
    const cipher = crypto.createCipheriv(
      encryptionConfig.algorithm, 
      encryptionConfig.key, 
      encryptionConfig.iv
    );
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted;
  } catch (error) {
    console.error('Error en cifrado:', error);
    throw new Error('Error al cifrar datos');
  }
};

/**
 * Descifra datos previamente cifrados
 * @param {string} encryptedText - Texto cifrado en formato hexadecimal
 * @returns {string} - Texto descifrado
 */
const decrypt = (encryptedText) => {
  try {
    const decipher = crypto.createDecipheriv(
      encryptionConfig.algorithm, 
      encryptionConfig.key, 
      encryptionConfig.iv
    );
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error('Error en descifrado:', error);
    throw new Error('Error al descifrar datos');
  }
};

/**
 * Genera un hash seguro para contraseñas
 * @param {string} password - Contraseña en texto plano
 * @returns {Promise<string>} - Hash de la contraseña
 */
const hashPassword = async (password) => {
  const saltRounds = 12;
  return await bcrypt.hash(password, saltRounds);
};

/**
 * Verifica una contraseña contra su hash
 * @param {string} password - Contraseña en texto plano
 * @param {string} hash - Hash almacenado de la contraseña
 * @returns {Promise<boolean>} - True si coincide, false en caso contrario
 */
const verifyPassword = async (password, hash) => {
  return await bcrypt.compare(password, hash);
};

/**
 * Genera un token JWT para autenticación
 * @param {Object} user - Datos del usuario a incluir en el token
 * @returns {string} - Token JWT firmado
 */
const generateToken = (user) => {
  // Excluimos datos sensibles y solo incluimos lo necesario
  const tokenData = {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    sucursal: user.sucursal
  };
  
  return jwt.sign(tokenData, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN
  });
};

/**
 * Verifica y decodifica un token JWT
 * @param {string} token - Token JWT a verificar
 * @returns {Object|null} - Datos del usuario o null si el token es inválido
 */
const verifyToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    console.error('Error al verificar token:', error.message);
    return null;
  }
};

/**
 * Genera una clave secreta para autenticación de dos factores
 * @returns {string} - Clave secreta compatible con TOTP
 */
const generateTwoFactorSecret = () => {
  return authenticator.generateSecret();
};

/**
 * Verifica un código TOTP para autenticación de dos factores
 * @param {string} token - Código ingresado por el usuario
 * @param {string} secret - Clave secreta almacenada
 * @returns {boolean} - True si el código es válido
 */
const verifyTwoFactorToken = (token, secret) => {
  return authenticator.verify({ token, secret });
};

/**
 * Genera una URL para QR de configuración de 2FA
 * @param {string} username - Nombre de usuario
 * @param {string} secret - Clave secreta TOTP
 * @returns {string} - URL para generar código QR
 */
const getTwoFactorQRUrl = (username, secret) => {
  return authenticator.keyuri(username, 'FactuSystem', secret);
};

/**
 * Política de contraseñas
 * @param {string} password - Contraseña a verificar
 * @returns {Object} - Resultado de la validación
 */
const validatePassword = (password) => {
  const result = {
    isValid: true,
    errors: []
  };

  // Mínimo 8 caracteres
  if (password.length < 8) {
    result.isValid = false;
    result.errors.push('La contraseña debe tener al menos 8 caracteres');
  }

  // Debe contener al menos una letra mayúscula
  if (!/[A-Z]/.test(password)) {
    result.isValid = false;
    result.errors.push('La contraseña debe contener al menos una letra mayúscula');
  }

  // Debe contener al menos una letra minúscula
  if (!/[a-z]/.test(password)) {
    result.isValid = false;
    result.errors.push('La contraseña debe contener al menos una letra minúscula');
  }

  // Debe contener al menos un número
  if (!/\d/.test(password)) {
    result.isValid = false;
    result.errors.push('La contraseña debe contener al menos un número');
  }

  // Debe contener al menos un caracter especial
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    result.isValid = false;
    result.errors.push('La contraseña debe contener al menos un caracter especial');
  }

  return result;
};

/**
 * Middleware para limitar intentos de inicio de sesión
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5, // Limitar a 5 intentos por ventana por IP
  message: {
    status: 'error',
    message: 'Demasiados intentos de inicio de sesión. Intente nuevamente después de 15 minutos.'
  }
});

/**
 * Limiter general para APIs
 */
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 100, // Limitar a 100 solicitudes por minuto por IP
  message: {
    status: 'error',
    message: 'Demasiadas solicitudes. Intente nuevamente más tarde.'
  }
});

/**
 * Configuración de CORS
 */
const corsOptions = {
  origin: (origin, callback) => {
    // En producción, restringir a orígenes conocidos
    const allowedOrigins = [
      'https://factusystem.com',
      'https://admin.factusystem.com'
    ];
    
    // En desarrollo permitir cualquier origen
    if (NODE_ENV === 'development' || !origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('No permitido por CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

/**
 * Middleware para configuración de seguridad Express
 * @param {Object} app - Instancia de Express
 */
const configureExpress = (app) => {
  // Usar Helmet para configurar encabezados de seguridad HTTP
  app.use(helmet());
  
  // Protección contra ataques XSS
  app.use(xss());
  
  // Protección contra parámetros HTTP pollution
  app.use(hpp());
  
  // Configurar CORS
  app.use(cors(corsOptions));
  
  // Análisis de cookies
  app.use(cookieParser());
  
  // Configurar limitadores de tasa
  app.use('/api/auth/login', loginLimiter);
  app.use('/api', apiLimiter);
  
  // Configurar validación de tipo de contenido
  app.use((req, res, next) => {
    if (req.method === 'POST' || req.method === 'PUT') {
      if (!req.is('application/json') && !req.is('multipart/form-data')) {
        return res.status(415).json({
          status: 'error',
          message: 'Tipo de contenido no soportado. Use application/json o multipart/form-data'
        });
      }
    }
    next();
  });
};

/**
 * Genera un token de sesión seguro
 * @returns {string} - Token de sesión único
 */
const generateSessionToken = () => {
  return crypto.randomBytes(64).toString('hex');
};

/**
 * Configuración para cookies seguras
 * @returns {Object} - Opciones para cookie segura
 */
const secureCookieConfig = () => {
  return {
    httpOnly: true,
    secure: NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: JWT_COOKIE_EXPIRES_IN * 24 * 60 * 60 * 1000
  };
};

/**
 * Verifica permisos de un usuario para una acción específica
 * @param {Object} user - Datos del usuario
 * @param {string} action - Acción a verificar
 * @param {string} resource - Recurso sobre el que se aplica la acción
 * @returns {boolean} - True si tiene permiso, false en caso contrario
 */
const checkPermission = (user, action, resource) => {
  // Si es un superadmin, tiene todos los permisos
  if (user.role === 'superadmin') return true;
  
  // Verificar en permisos del usuario
  if (!user.permissions) return false;
  
  // Buscar permiso específico o global sobre el recurso
  return user.permissions.some(permission => {
    return (
      // Permiso específico para acción y recurso
      (permission.action === action && permission.resource === resource) ||
      // Permiso global para el recurso
      (permission.action === '*' && permission.resource === resource) ||
      // Permiso global completo
      (permission.action === '*' && permission.resource === '*')
    );
  });
};

/**
 * Verifica si el usuario tiene acceso a una sucursal específica
 * @param {Object} user - Datos del usuario
 * @param {number|string} sucursalId - ID de la sucursal
 * @returns {boolean} - True si tiene acceso, false en caso contrario
 */
const checkSucursalAccess = (user, sucursalId) => {
  // Si es superadmin o admin general, tiene acceso a todas
  if (['superadmin', 'admin'].includes(user.role)) return true;
  
  // Verificar si la sucursal está en la lista de accesos del usuario
  return user.sucursales && user.sucursales.includes(Number(sucursalId));
};

/**
 * Sanitiza entradas de texto para prevenir XSS
 * @param {string} input - Texto a sanitizar
 * @returns {string} - Texto sanitizado
 */
const sanitizeInput = (input) => {
  const xssFilter = require('xss');
  return xssFilter(input);
};

/**
 * Genera un token CSRF
 * @returns {string} - Token CSRF
 */
const generateCSRFToken = () => {
  return crypto.randomBytes(64).toString('hex');
};

/**
 * Genera un hash para verificación de integridad de datos
 * @param {Object|string} data - Datos a verificar
 * @returns {string} - Hash de verificación
 */
const generateIntegrityHash = (data) => {
  const content = typeof data === 'object' ? JSON.stringify(data) : String(data);
  return crypto.createHash('sha256').update(content).digest('hex');
};

/**
 * Verifica un hash de integridad
 * @param {Object|string} data - Datos a verificar
 * @param {string} hash - Hash previamente generado
 * @returns {boolean} - True si el hash coincide
 */
const verifyIntegrityHash = (data, hash) => {
  const newHash = generateIntegrityHash(data);
  return newHash === hash;
};

/**
 * Configuración para WebSockets seguros
 */
const secureWebSocketConfig = {
  // Opciones para Socket.IO o WebSockets nativos
  cors: corsOptions,
  pingTimeout: 30000,
  pingInterval: 25000,
  upgradeTimeout: 10000,
  // Manejo de autenticación para WebSockets
  beforeUpgrade: (request, socket, head) => {
    // Verificar token en cabecera o query
    const token = request.headers.authorization || 
                 (request.url.includes('?') && 
                  new URLSearchParams(request.url.split('?')[1]).get('token'));
    
    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return false;
    }
    
    const user = verifyToken(token.replace('Bearer ', ''));
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return false;
    }
    
    return true;
  }
};

/**
 * Genera un token temporal para acciones críticas
 * (cambios de contraseña, eliminación de datos, etc.)
 * @param {string} userId - ID del usuario
 * @param {string} action - Acción para la que se genera el token
 * @returns {Object} - Token y fecha de expiración
 */
const generateActionToken = (userId, action) => {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutos
  
  return {
    token,
    expiresAt,
    userId,
    action
  };
};

// Exportar todas las funciones y configuraciones
module.exports = {
  // Funciones de cifrado
  encrypt,
  decrypt,
  encryptionConfig,
  
  // Gestión de contraseñas
  hashPassword,
  verifyPassword,
  validatePassword,
  
  // JWT y autenticación
  generateToken,
  verifyToken,
  JWT_SECRET,
  JWT_EXPIRES_IN,
  
  // Autenticación de dos factores
  generateTwoFactorSecret,
  verifyTwoFactorToken,
  getTwoFactorQRUrl,
  
  // Middleware y configuración Express
  configureExpress,
  loginLimiter,
  apiLimiter,
  corsOptions,
  
  // Gestión de sesiones y cookies
  generateSessionToken,
  secureCookieConfig,
  
  // Control de acceso
  checkPermission,
  checkSucursalAccess,
  
  // Protección y sanitización
  sanitizeInput,
  generateCSRFToken,
  
  // Verificación de integridad
  generateIntegrityHash,
  verifyIntegrityHash,
  
  // WebSockets
  secureWebSocketConfig,
  
  // Tokens de acción
  generateActionToken
};