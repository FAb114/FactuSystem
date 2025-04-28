const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { check, validationResult } = require('express-validator');
const authController = require('../controllers/authController');
const authMiddleware = require('../middleware/auth');
const rateLimit = require('express-rate-limit');
const twoFactorService = require('../../services/auth/twoFactor');
const permissionsService = require('../../services/auth/permissions');
const auditLogger = require('../../services/audit/logger');
const config = require('../config/security');

// Limitar intentos de inicio de sesión para prevenir ataques de fuerza bruta
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5, // 5 intentos por IP
  message: { 
    status: 'error', 
    message: 'Demasiados intentos de inicio de sesión, por favor intente de nuevo más tarde.' 
  }
});

/**
 * @route   POST /api/auth/login
 * @desc    Autenticar usuario y generar token JWT
 * @access  Public
 */
router.post('/login', 
  loginLimiter,
  [
    check('username', 'El nombre de usuario es requerido').not().isEmpty(),
    check('password', 'La contraseña es requerida').not().isEmpty(),
    check('sucursalId', 'La sucursal es requerida').optional()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ status: 'error', errors: errors.array() });
      }

      const { username, password, sucursalId } = req.body;
      
      // Registrar intento de inicio de sesión
      auditLogger.log({
        event: 'AUTH_LOGIN_ATTEMPT',
        username,
        sucursalId: sucursalId || 'no especificada',
        ip: req.ip,
        userAgent: req.headers['user-agent']
      });
      
      // Verificar credenciales
      const authResult = await authController.validateCredentials(username, password);
      
      if (!authResult.success) {
        return res.status(401).json({ 
          status: 'error', 
          message: authResult.message 
        });
      }

      const { user } = authResult;
      
      // Verificar si el usuario tiene acceso a la sucursal seleccionada
      if (sucursalId) {
        const hasSucursalAccess = await permissionsService.checkSucursalAccess(user.id, sucursalId);
        if (!hasSucursalAccess) {
          auditLogger.log({
            event: 'AUTH_UNAUTHORIZED_BRANCH',
            userId: user.id,
            username: user.username,
            sucursalId,
            ip: req.ip
          });
          
          return res.status(403).json({ 
            status: 'error', 
            message: 'No tiene permisos para acceder a esta sucursal' 
          });
        }
      }
      
      // Verificar si se requiere autenticación de dos factores
      if (user.twoFactorEnabled) {
        // Generar y enviar código temporal
        const tempToken = await twoFactorService.generateTempToken(user);
        await twoFactorService.sendAuthCode(user);
        
        return res.status(200).json({
          status: 'two_factor_required',
          tempToken,
          message: 'Se requiere verificación de dos factores',
          userId: user.id
        });
      }
      
      // Generar token JWT
      const token = authController.generateToken(user, sucursalId);
      
      // Registrar inicio de sesión exitoso
      auditLogger.log({
        event: 'AUTH_LOGIN_SUCCESS',
        userId: user.id,
        username: user.username,
        sucursalId: sucursalId || 'principal',
        ip: req.ip
      });
      
      // Enviar respuesta con token
      res.json({
        status: 'success',
        token,
        user: {
          id: user.id,
          username: user.username,
          nombre: user.nombre,
          email: user.email,
          role: user.role,
          permisos: user.permisos,
          sucursalId: sucursalId || user.sucursalPrincipal
        }
      });
    } catch (error) {
      console.error('Error en autenticación:', error);
      res.status(500).json({ 
        status: 'error', 
        message: 'Error del servidor en autenticación' 
      });
    }
  }
);

/**
 * @route   POST /api/auth/verify-2fa
 * @desc    Verificar código de autenticación de dos factores
 * @access  Public
 */
router.post('/verify-2fa',
  [
    check('userId', 'El ID de usuario es requerido').not().isEmpty(),
    check('tempToken', 'El token temporal es requerido').not().isEmpty(),
    check('code', 'El código de verificación es requerido').not().isEmpty()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ status: 'error', errors: errors.array() });
      }

      const { userId, tempToken, code, sucursalId } = req.body;
      
      // Verificar código de autenticación
      const verification = await twoFactorService.verifyCode(userId, tempToken, code);
      
      if (!verification.success) {
        auditLogger.log({
          event: 'AUTH_2FA_FAILED',
          userId,
          ip: req.ip
        });
        
        return res.status(401).json({ 
          status: 'error', 
          message: verification.message 
        });
      }
      
      const user = verification.user;
      
      // Verificar si el usuario tiene acceso a la sucursal
      if (sucursalId) {
        const hasSucursalAccess = await permissionsService.checkSucursalAccess(user.id, sucursalId);
        if (!hasSucursalAccess) {
          return res.status(403).json({ 
            status: 'error', 
            message: 'No tiene permisos para acceder a esta sucursal' 
          });
        }
      }
      
      // Generar token JWT
      const token = authController.generateToken(user, sucursalId);
      
      // Registrar 2FA exitoso
      auditLogger.log({
        event: 'AUTH_2FA_SUCCESS',
        userId: user.id,
        username: user.username,
        sucursalId: sucursalId || 'principal',
        ip: req.ip
      });
      
      // Enviar respuesta con token
      res.json({
        status: 'success',
        token,
        user: {
          id: user.id,
          username: user.username,
          nombre: user.nombre,
          email: user.email,
          role: user.role,
          permisos: user.permisos,
          sucursalId: sucursalId || user.sucursalPrincipal
        }
      });
    } catch (error) {
      console.error('Error en verificación 2FA:', error);
      res.status(500).json({ 
        status: 'error', 
        message: 'Error del servidor en verificación 2FA' 
      });
    }
  }
);

/**
 * @route   POST /api/auth/refresh
 * @desc    Refrescar token JWT
 * @access  Private
 */
router.post('/refresh', authMiddleware, async (req, res) => {
  try {
    const { user, sucursalId } = req;
    
    // Generar nuevo token
    const token = authController.generateToken(user, sucursalId);
    
    res.json({
      status: 'success',
      token,
      message: 'Token refrescado exitosamente'
    });
  } catch (error) {
    console.error('Error refrescando token:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Error refrescando token' 
    });
  }
});

/**
 * @route   POST /api/auth/cambiar-sucursal
 * @desc    Cambiar la sucursal del usuario autenticado
 * @access  Private
 */
router.post('/cambiar-sucursal', 
  authMiddleware,
  [
    check('sucursalId', 'El ID de la sucursal es requerido').not().isEmpty()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ status: 'error', errors: errors.array() });
      }

      const { sucursalId } = req.body;
      const userId = req.user.id;
      
      // Verificar que el usuario tenga acceso a la sucursal solicitada
      const hasSucursalAccess = await permissionsService.checkSucursalAccess(userId, sucursalId);
      
      if (!hasSucursalAccess) {
        auditLogger.log({
          event: 'AUTH_BRANCH_CHANGE_DENIED',
          userId,
          sucursalId,
          ip: req.ip
        });
        
        return res.status(403).json({ 
          status: 'error', 
          message: 'No tiene permisos para acceder a esta sucursal' 
        });
      }
      
      // Generar nuevo token con la sucursal actualizada
      const token = authController.generateToken(req.user, sucursalId);
      
      // Registrar cambio de sucursal
      auditLogger.log({
        event: 'AUTH_BRANCH_CHANGE',
        userId,
        username: req.user.username,
        sucursalId,
        ip: req.ip
      });
      
      res.json({
        status: 'success',
        token,
        message: 'Sucursal cambiada exitosamente',
        sucursalId
      });
    } catch (error) {
      console.error('Error cambiando sucursal:', error);
      res.status(500).json({ 
        status: 'error', 
        message: 'Error cambiando sucursal' 
      });
    }
  }
);

/**
 * @route   POST /api/auth/logout
 * @desc    Cerrar sesión (invalidar token)
 * @access  Private
 */
router.post('/logout', authMiddleware, async (req, res) => {
  try {
    const { user, token } = req;
    
    // Invalidar token
    await authController.invalidateToken(token);
    
    // Registrar cierre de sesión
    auditLogger.log({
      event: 'AUTH_LOGOUT',
      userId: user.id,
      username: user.username,
      ip: req.ip
    });
    
    res.json({
      status: 'success',
      message: 'Sesión cerrada exitosamente'
    });
  } catch (error) {
    console.error('Error en cierre de sesión:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Error en cierre de sesión' 
    });
  }
});

/**
 * @route   POST /api/auth/reset-password-request
 * @desc    Solicitar restablecimiento de contraseña
 * @access  Public
 */
router.post('/reset-password-request',
  [
    check('email', 'Ingrese un email válido').isEmail()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ status: 'error', errors: errors.array() });
      }

      const { email } = req.body;
      
      // Iniciar proceso de restablecimiento
      const result = await authController.requestPasswordReset(email);
      
      if (!result.success) {
        return res.status(400).json({ 
          status: 'error', 
          message: result.message 
        });
      }
      
      // Registrar solicitud de cambio de contraseña
      auditLogger.log({
        event: 'AUTH_PASSWORD_RESET_REQUEST',
        email,
        ip: req.ip
      });
      
      res.json({
        status: 'success',
        message: 'Se ha enviado un correo con instrucciones para restablecer su contraseña'
      });
    } catch (error) {
      console.error('Error en solicitud de restablecimiento:', error);
      res.status(500).json({ 
        status: 'error', 
        message: 'Error procesando solicitud de restablecimiento' 
      });
    }
  }
);

/**
 * @route   POST /api/auth/reset-password
 * @desc    Restablecer contraseña con token
 * @access  Public
 */
router.post('/reset-password',
  [
    check('token', 'El token es requerido').not().isEmpty(),
    check('password', 'La contraseña debe tener al menos 8 caracteres').isLength({ min: 8 })
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ status: 'error', errors: errors.array() });
      }

      const { token, password } = req.body;
      
      // Verificar token y actualizar contraseña
      const result = await authController.resetPassword(token, password);
      
      if (!result.success) {
        return res.status(400).json({ 
          status: 'error', 
          message: result.message 
        });
      }
      
      // Registrar cambio de contraseña
      auditLogger.log({
        event: 'AUTH_PASSWORD_RESET_COMPLETE',
        userId: result.userId,
        ip: req.ip
      });
      
      res.json({
        status: 'success',
        message: 'Contraseña restablecida exitosamente'
      });
    } catch (error) {
      console.error('Error en restablecimiento de contraseña:', error);
      res.status(500).json({ 
        status: 'error', 
        message: 'Error restableciendo contraseña' 
      });
    }
  }
);

/**
 * @route   POST /api/auth/cambiar-password
 * @desc    Cambiar contraseña de usuario autenticado
 * @access  Private
 */
router.post('/cambiar-password',
  authMiddleware,
  [
    check('currentPassword', 'La contraseña actual es requerida').not().isEmpty(),
    check('newPassword', 'La nueva contraseña debe tener al menos 8 caracteres').isLength({ min: 8 })
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ status: 'error', errors: errors.array() });
      }

      const { currentPassword, newPassword } = req.body;
      const userId = req.user.id;
      
      // Verificar contraseña actual y actualizar
      const result = await authController.changePassword(userId, currentPassword, newPassword);
      
      if (!result.success) {
        return res.status(400).json({ 
          status: 'error', 
          message: result.message 
        });
      }
      
      // Registrar cambio de contraseña
      auditLogger.log({
        event: 'AUTH_PASSWORD_CHANGE',
        userId,
        username: req.user.username,
        ip: req.ip
      });
      
      res.json({
        status: 'success',
        message: 'Contraseña actualizada exitosamente'
      });
    } catch (error) {
      console.error('Error cambiando contraseña:', error);
      res.status(500).json({ 
        status: 'error', 
        message: 'Error actualizando contraseña' 
      });
    }
  }
);

/**
 * @route   GET /api/auth/sucursales
 * @desc    Obtener sucursales disponibles para un usuario
 * @access  Private
 */
router.get('/sucursales', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Obtener sucursales disponibles para el usuario
    const sucursales = await permissionsService.getUserSucursales(userId);
    
    res.json({
      status: 'success',
      sucursales
    });
  } catch (error) {
    console.error('Error obteniendo sucursales:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Error obteniendo sucursales' 
    });
  }
});

/**
 * @route   POST /api/auth/configurar-2fa
 * @desc    Configurar autenticación de dos factores
 * @access  Private
 */
router.post('/configurar-2fa',
  authMiddleware,
  [
    check('enable', 'Debe especificar si desea habilitar o deshabilitar 2FA').isBoolean()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ status: 'error', errors: errors.array() });
      }

      const { enable } = req.body;
      const userId = req.user.id;
      
      let result;
      if (enable) {
        // Habilitar 2FA
        result = await twoFactorService.enable(userId);
        
        // Registrar activación 2FA
        auditLogger.log({
          event: 'AUTH_2FA_ENABLED',
          userId,
          username: req.user.username,
          ip: req.ip
        });
      } else {
        // Deshabilitar 2FA
        result = await twoFactorService.disable(userId);
        
        // Registrar desactivación 2FA
        auditLogger.log({
          event: 'AUTH_2FA_DISABLED',
          userId,
          username: req.user.username,
          ip: req.ip
        });
      }
      
      if (!result.success) {
        return res.status(400).json({ 
          status: 'error', 
          message: result.message 
        });
      }
      
      res.json({
        status: 'success',
        message: enable ? 'Autenticación de dos factores activada' : 'Autenticación de dos factores desactivada',
        data: result.data
      });
    } catch (error) {
      console.error('Error configurando 2FA:', error);
      res.status(500).json({ 
        status: 'error', 
        message: 'Error configurando autenticación de dos factores' 
      });
    }
  }
);

/**
 * @route   GET /api/auth/me
 * @desc    Obtener información del usuario autenticado
 * @access  Private
 */
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const sucursalId = req.sucursalId;
    
    // Obtener información actualizada del usuario
    const user = await authController.getUserInfo(userId);
    
    if (!user) {
      return res.status(404).json({ 
        status: 'error', 
        message: 'Usuario no encontrado' 
      });
    }
    
    // Obtener permisos específicos para la sucursal actual
    const permisosEnSucursal = await permissionsService.getUserPermissionsForBranch(userId, sucursalId);
    
    // Enviar información del usuario
    res.json({
      status: 'success',
      user: {
        id: user.id,
        username: user.username,
        nombre: user.nombre,
        email: user.email,
        role: user.role,
        twoFactorEnabled: user.twoFactorEnabled,
        permisos: permisosEnSucursal,
        sucursalId
      }
    });
  } catch (error) {
    console.error('Error obteniendo información del usuario:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Error obteniendo información del usuario' 
    });
  }
});

/**
 * @route   POST /api/auth/verificar-token
 * @desc    Verificar si un token es válido
 * @access  Public
 */
router.post('/verificar-token', async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'Token no proporcionado' 
      });
    }
    
    // Verificar token
    const isValid = await authController.verifyToken(token);
    
    res.json({
      status: 'success',
      valid: isValid
    });
  } catch (error) {
    console.error('Error verificando token:', error);
    res.status(401).json({ 
      status: 'error', 
      message: 'Token inválido' 
    });
  }
});

module.exports = router;