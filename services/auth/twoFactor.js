/**
 * services/auth/twoFactor.js
 * Servicio de autenticación de dos factores para FactuSystem
 * 
 * Este servicio maneja la configuración, generación y verificación de códigos
 * para la autenticación de dos factores (2FA) mediante TOTP (Time-based One-Time Password)
 */

const { ipcMain } = require('electron');
const crypto = require('crypto');
const qrcode = require('qrcode');
const speakeasy = require('speakeasy');
const path = require('path');
const fs = require('fs');
const database = require('../../app/assets/js/utils/database.js');
const logger = require('../audit/logger.js');

// Tiempo de validez de un código OTP en segundos (por defecto: 30 segundos)
const OTP_STEP = process.env.OTP_STEP || 30;
// Ventana de códigos válidos (por defecto: 1 código hacia atrás y 1 hacia adelante)
const OTP_WINDOW = process.env.OTP_WINDOW ? parseInt(process.env.OTP_WINDOW) : 1;

/**
 * Inicializa los manejadores de eventos para 2FA
 * @param {Electron.BrowserWindow} mainWindow - Ventana principal de la aplicación
 */
function initialize2FAHandlers(mainWindow) {
  // Generar nueva configuración de 2FA para un usuario
  ipcMain.handle('2fa:generate', async (event, { userId, username }) => {
    try {
      // Generar nueva secret key para el usuario
      const { secret, qrCodeUrl } = await generateSecretAndQR(username);
      
      // Almacenar temporalmente el secreto (sin activar aún)
      await storeTemporarySecret(userId, secret);
      
      return {
        success: true,
        qrCodeUrl,
        manualCode: secret.base32 // Código para ingreso manual
      };
    } catch (error) {
      logger.logError('2fa', 'generate_error', {
        userId,
        error: error.message,
        stack: error.stack,
        timestamp: new Date()
      });
      
      return {
        success: false,
        message: 'Error al generar configuración de 2FA'
      };
    }
  });

  // Verificar y activar 2FA
  ipcMain.handle('2fa:verify-setup', async (event, { userId, code }) => {
    try {
      // Obtener el secreto temporal almacenado
      const secret = await getTemporarySecret(userId);
      if (!secret) {
        return {
          success: false,
          message: 'No se encontró configuración pendiente de 2FA'
        };
      }
      
      // Verificar el código proporcionado
      const verified = verifyTOTP(secret, code);
      
      if (verified) {
        // Activar 2FA para el usuario
        await activateTwoFactor(userId, secret);
        
        // Generar códigos de recuperación
        const recoveryCodes = await generateRecoveryCodes(userId);
        
        // Registrar activación exitosa
        logger.logEvent('2fa', 'setup_complete', {
          userId,
          timestamp: new Date()
        });
        
        return {
          success: true,
          recoveryCodes
        };
      } else {
        // Registrar verificación fallida
        logger.logEvent('2fa', 'setup_verification_failed', {
          userId,
          timestamp: new Date()
        });
        
        return {
          success: false,
          message: 'Código incorrecto, por favor inténtelo nuevamente'
        };
      }
    } catch (error) {
      logger.logError('2fa', 'verify_setup_error', {
        userId,
        error: error.message,
        stack: error.stack,
        timestamp: new Date()
      });
      
      return {
        success: false,
        message: 'Error al verificar código de configuración'
      };
    }
  });

  // Desactivar 2FA
  ipcMain.handle('2fa:disable', async (event, { userId, password, code }) => {
    try {
      // Verificar la contraseña del usuario primero
      const passwordValid = await verifyPassword(userId, password);
      if (!passwordValid) {
        return {
          success: false,
          message: 'Contraseña incorrecta'
        };
      }
      
      // Obtener secreto activo
      const secret = await getActiveSecret(userId);
      if (!secret) {
        return {
          success: false,
          message: 'El usuario no tiene 2FA activado'
        };
      }
      
      // Verificar el código proporcionado
      const verified = verifyTOTP(secret, code);
      
      if (verified) {
        // Desactivar 2FA para el usuario
        await deactivateTwoFactor(userId);
        
        // Registrar desactivación
        logger.logEvent('2fa', 'disabled', {
          userId,
          timestamp: new Date()
        });
        
        return {
          success: true
        };
      } else {
        // Intentar validar con código de recuperación
        const recoveryValid = await validateRecoveryCode(userId, code);
        if (recoveryValid) {
          // Desactivar 2FA para el usuario
          await deactivateTwoFactor(userId);
          
          // Registrar desactivación con código de recuperación
          logger.logEvent('2fa', 'disabled_with_recovery', {
            userId,
            timestamp: new Date()
          });
          
          return {
            success: true,
            usedRecoveryCode: true
          };
        }
        
        // Registrar verificación fallida
        logger.logEvent('2fa', 'disable_verification_failed', {
          userId,
          timestamp: new Date()
        });
        
        return {
          success: false,
          message: 'Código incorrecto, por favor inténtelo nuevamente'
        };
      }
    } catch (error) {
      logger.logError('2fa', 'disable_error', {
        userId,
        error: error.message,
        stack: error.stack,
        timestamp: new Date()
      });
      
      return {
        success: false,
        message: 'Error al desactivar 2FA'
      };
    }
  });

  // Regenerar códigos de recuperación
  ipcMain.handle('2fa:regenerate-recovery', async (event, { userId, code }) => {
    try {
      // Obtener secreto activo
      const secret = await getActiveSecret(userId);
      if (!secret) {
        return {
          success: false,
          message: 'El usuario no tiene 2FA activado'
        };
      }
      
      // Verificar el código proporcionado
      const verified = verifyTOTP(secret, code);
      
      if (verified) {
        // Generar nuevos códigos de recuperación
        const recoveryCodes = await generateRecoveryCodes(userId, true);
        
        // Registrar regeneración exitosa
        logger.logEvent('2fa', 'recovery_codes_regenerated', {
          userId,
          timestamp: new Date()
        });
        
        return {
          success: true,
          recoveryCodes
        };
      } else {
        // Registrar verificación fallida
        logger.logEvent('2fa', 'recovery_regeneration_failed', {
          userId,
          timestamp: new Date()
        });
        
        return {
          success: false,
          message: 'Código incorrecto, por favor inténtelo nuevamente'
        };
      }
    } catch (error) {
      logger.logError('2fa', 'regenerate_recovery_error', {
        userId,
        error: error.message,
        stack: error.stack,
        timestamp: new Date()
      });
      
      return {
        success: false,
        message: 'Error al regenerar códigos de recuperación'
      };
    }
  });

  // Verificar si un usuario tiene 2FA activado
  ipcMain.handle('2fa:status', async (event, { userId }) => {
    try {
      const db = await database.getConnection();
      const user = await db.get('SELECT twoFactorEnabled FROM users WHERE id = ?', [userId]);
      
      if (!user) {
        return {
          success: false,
          message: 'Usuario no encontrado'
        };
      }
      
      return {
        success: true,
        enabled: !!user.twoFactorEnabled
      };
    } catch (error) {
      logger.logError('2fa', 'status_check_error', {
        userId,
        error: error.message,
        stack: error.stack,
        timestamp: new Date()
      });
      
      return {
        success: false,
        message: 'Error al verificar estado de 2FA'
      };
    }
  });
}

/**
 * Verifica un código OTP contra un secreto TOTP
 * @param {Object} secret - Secreto para TOTP
 * @param {string} code - Código proporcionado por el usuario
 * @returns {boolean} Resultado de la verificación
 */
function verifyTOTP(secret, code) {
  try {
    // Verificar código TOTP
    return speakeasy.totp.verify({
      secret: secret.base32,
      encoding: 'base32',
      token: code,
      window: OTP_WINDOW,
      step: OTP_STEP
    });
  } catch (error) {
    logger.logError('2fa', 'verify_totp_error', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date()
    });
    return false;
  }
}

/**
 * Genera un nuevo secreto y código QR para 2FA
 * @param {string} username - Nombre de usuario
 * @returns {Promise<Object>} Objeto con el secreto y la URL del código QR
 */
async function generateSecretAndQR(username) {
  // Generar nuevo secreto para TOTP
  const secret = speakeasy.generateSecret({
    length: 20,
    name: `FactuSystem:${username}`
  });
  
  // Generar código QR como Data URL
  const qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url);
  
  return { secret, qrCodeUrl };
}

/**
 * Almacena temporalmente un secreto 2FA para su activación posterior
 * @param {number|string} userId - ID del usuario
 * @param {Object} secret - Secreto generado para TOTP
 * @returns {Promise<void>}
 */
async function storeTemporarySecret(userId, secret) {
  try {
    const db = await database.getConnection();
    
    // Comprobar si ya existe un secreto temporal
    const existing = await db.get(
      'SELECT 1 FROM two_factor_temp WHERE userId = ?',
      [userId]
    );
    
    if (existing) {
      // Actualizar secreto existente
      await db.run(
        'UPDATE two_factor_temp SET secret = ?, createdAt = ? WHERE userId = ?',
        [JSON.stringify(secret), new Date().toISOString(), userId]
      );
    } else {
      // Crear nuevo registro
      await db.run(
        'INSERT INTO two_factor_temp (userId, secret, createdAt) VALUES (?, ?, ?)',
        [userId, JSON.stringify(secret), new Date().toISOString()]
      );
    }
  } catch (error) {
    logger.logError('2fa', 'store_temp_secret_error', {
      userId,
      error: error.message,
      stack: error.stack,
      timestamp: new Date()
    });
    throw error;
  }
}

/**
 * Obtiene el secreto temporal almacenado para un usuario
 * @param {number|string} userId - ID del usuario
 * @returns {Promise<Object|null>} Secreto TOTP o null si no existe
 */
async function getTemporarySecret(userId) {
  try {
    const db = await database.getConnection();
    const row = await db.get(
      'SELECT secret FROM two_factor_temp WHERE userId = ?',
      [userId]
    );
    
    if (!row) return null;
    
    return JSON.parse(row.secret);
  } catch (error) {
    logger.logError('2fa', 'get_temp_secret_error', {
      userId,
      error: error.message,
      stack: error.stack,
      timestamp: new Date()
    });
    return null;
  }
}

/**
 * Obtiene el secreto activo de 2FA para un usuario
 * @param {number|string} userId - ID del usuario
 * @returns {Promise<Object|null>} Secreto TOTP o null si no existe
 */
async function getActiveSecret(userId) {
  try {
    const db = await database.getConnection();
    const user = await db.get(
      'SELECT twoFactorSecret FROM users WHERE id = ? AND twoFactorEnabled = 1',
      [userId]
    );
    
    if (!user || !user.twoFactorSecret) return null;
    
    return JSON.parse(user.twoFactorSecret);
  } catch (error) {
    logger.logError('2fa', 'get_active_secret_error', {
      userId,
      error: error.message,
      stack: error.stack,
      timestamp: new Date()
    });
    return null;
  }
}

/**
 * Activa 2FA para un usuario utilizando el secreto temporal
 * @param {number|string} userId - ID del usuario
 * @param {Object} secret - Secreto TOTP (opcional, si no se proporciona se usa el temporal)
 * @returns {Promise<boolean>} Resultado de la activación
 */
async function activateTwoFactor(userId, secret = null) {
  try {
    const db = await database.getConnection();
    
    // Si no se proporciona secreto, usar el temporal
    if (!secret) {
      secret = await getTemporarySecret(userId);
      if (!secret) return false;
    }
    
    // Activar 2FA en la cuenta del usuario
    await db.run(
      'UPDATE users SET twoFactorEnabled = 1, twoFactorSecret = ? WHERE id = ?',
      [JSON.stringify(secret), userId]
    );
    
    // Eliminar secreto temporal
    await db.run('DELETE FROM two_factor_temp WHERE userId = ?', [userId]);
    
    return true;
  } catch (error) {
    logger.logError('2fa', 'activate_error', {
      userId,
      error: error.message,
      stack: error.stack,
      timestamp: new Date()
    });
    return false;
  }
}

/**
 * Desactiva 2FA para un usuario
 * @param {number|string} userId - ID del usuario
 * @returns {Promise<boolean>} Resultado de la desactivación
 */
async function deactivateTwoFactor(userId) {
  try {
    const db = await database.getConnection();
    
    // Desactivar 2FA
    await db.run(
      'UPDATE users SET twoFactorEnabled = 0, twoFactorSecret = NULL WHERE id = ?',
      [userId]
    );
    
    // Eliminar códigos de recuperación
    await db.run('DELETE FROM recovery_codes WHERE userId = ?', [userId]);
    
    return true;
  } catch (error) {
    logger.logError('2fa', 'deactivate_error', {
      userId,
      error: error.message,
      stack: error.stack,
      timestamp: new Date()
    });
    return false;
  }
}

/**
 * Verifica la contraseña de un usuario
 * @param {number|string} userId - ID del usuario
 * @param {string} password - Contraseña a verificar
 * @returns {Promise<boolean>} Resultado de la verificación
 */
async function verifyPassword(userId, password) {
  try {
    const db = await database.getConnection();
    const user = await db.get('SELECT password FROM users WHERE id = ?', [userId]);
    
    if (!user) return false;
    
    // Verificar contraseña con bcrypt
    const bcrypt = require('bcryptjs');
    return await bcrypt.compare(password, user.password);
  } catch (error) {
    logger.logError('2fa', 'verify_password_error', {
      userId,
      error: error.message,
      stack: error.stack,
      timestamp: new Date()
    });
    return false;
  }
}

/**
 * Genera códigos de recuperación para un usuario
 * @param {number|string} userId - ID del usuario
 * @param {boolean} [regenerate=false] - Indica si se deben regenerar los códigos existentes
 * @returns {Promise<string[]>} Lista de códigos de recuperación
 */
async function generateRecoveryCodes(userId, regenerate = false) {
  try {
    const db = await database.getConnection();
    
    // Eliminar códigos existentes si se está regenerando
    if (regenerate) {
      await db.run('DELETE FROM recovery_codes WHERE userId = ?', [userId]);
    }
    
    // Generar 10 códigos de recuperación
    const codes = [];
    const bcrypt = require('bcryptjs');
    
    for (let i = 0; i < 10; i++) {
      // Generar código alfanumérico de 8 caracteres (formato XXXX-XXXX)
      const part1 = crypto.randomBytes(2).toString('hex').toUpperCase();
      const part2 = crypto.randomBytes(2).toString('hex').toUpperCase();
      const code = `${part1}-${part2}`;
      
      // Almacenar código hasheado en la base de datos
      const hashedCode = await bcrypt.hash(code, 10);
      await db.run(
        'INSERT INTO recovery_codes (userId, code, used, createdAt) VALUES (?, ?, 0, ?)',
        [userId, hashedCode, new Date().toISOString()]
      );
      
      codes.push(code);
    }
    
    return codes;
  } catch (error) {
    logger.logError('2fa', 'generate_recovery_codes_error', {
      userId,
      error: error.message,
      stack: error.stack,
      timestamp: new Date()
    });
    throw error;
  }
}

/**
 * Valida un código de recuperación
 * @param {number|string} userId - ID del usuario
 * @param {string} inputCode - Código proporcionado por el usuario
 * @returns {Promise<boolean>} Resultado de la validación
 */
async function validateRecoveryCode(userId, inputCode) {
  try {
    const db = await database.getConnection();
    const recoveryCodes = await db.all(
      'SELECT id, code FROM recovery_codes WHERE userId = ? AND used = 0',
      [userId]
    );
    
    if (!recoveryCodes || recoveryCodes.length === 0) return false;
    
    // Verificar cada código
    const bcrypt = require('bcryptjs');
    for (const record of recoveryCodes) {
      const isValid = await bcrypt.compare(inputCode, record.code);
      
      if (isValid) {
        // Marcar código como usado
        await db.run(
          'UPDATE recovery_codes SET used = 1, usedAt = ? WHERE id = ?',
          [new Date().toISOString(), record.id]
        );
        
        return true;
      }
    }
    
    return false;
  } catch (error) {
    logger.logError('2fa', 'validate_recovery_code_error', {
      userId,
      error: error.message,
      stack: error.stack,
      timestamp: new Date()
    });
    return false;
  }
}

/**
 * Verifica un código 2FA para un usuario
 * @param {number|string} userId - ID del usuario
 * @param {string} code - Código proporcionado por el usuario
 * @returns {Promise<boolean>} Resultado de la verificación
 */
async function verifyCode(userId, code) {
  try {
    // Verificar si es un código de aplicación
    const secret = await getActiveSecret(userId);
    if (secret) {
      const verified = verifyTOTP(secret, code);
      if (verified) return true;
    }
    
    // Si no es válido, intentar como código de recuperación
    return await validateRecoveryCode(userId, code);
  } catch (error) {
    logger.logError('2fa', 'verify_code_error', {
      userId,
      error: error.message,
      stack: error.stack,
      timestamp: new Date()
    });
    return false;
  }
}

/**
 * Verifica si un usuario tiene 2FA habilitado
 * @param {number|string} userId - ID del usuario
 * @returns {Promise<boolean>} true si 2FA está habilitado, false en caso contrario
 */
async function isEnabled(userId) {
  try {
    const db = await database.getConnection();
    const user = await db.get(
      'SELECT twoFactorEnabled FROM users WHERE id = ?',
      [userId]
    );
    
    return user && user.twoFactorEnabled === 1;
  } catch (error) {
    logger.logError('2fa', 'check_enabled_error', {
      userId,
      error: error.message,
      stack: error.stack,
      timestamp: new Date()
    });
    return false;
  }
}

/**
 * Verifica el estado de la base de datos y crea las tablas necesarias si no existen
 */
async function ensureDatabaseStructure() {
  try {
    const db = await database.getConnection();
    
    // Tabla temporal para secretos pendientes de activación
    await db.run(`
      CREATE TABLE IF NOT EXISTS two_factor_temp (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER NOT NULL,
        secret TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        UNIQUE(userId)
      )
    `);
    
    // Tabla para códigos de recuperación
    await db.run(`
      CREATE TABLE IF NOT EXISTS recovery_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER NOT NULL,
        code TEXT NOT NULL,
        used INTEGER DEFAULT 0,
        createdAt TEXT NOT NULL,
        usedAt TEXT
      )
    `);
    
    // Asegurar que la tabla users tenga los campos necesarios
    // Nota: En una aplicación real, esto debería manejarse con migraciones
    const userColumns = await db.all('PRAGMA table_info(users)');
    
    const has2FAEnabled = userColumns.some(col => col.name === 'twoFactorEnabled');
    const has2FASecret = userColumns.some(col => col.name === 'twoFactorSecret');
    
    if (!has2FAEnabled) {
      await db.run('ALTER TABLE users ADD COLUMN twoFactorEnabled INTEGER DEFAULT 0');
    }
    
    if (!has2FASecret) {
      await db.run('ALTER TABLE users ADD COLUMN twoFactorSecret TEXT');
    }
  } catch (error) {
    logger.logError('2fa', 'database_structure_error', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date()
    });
  }
}

module.exports = {
  initialize2FAHandlers,
  verifyCode,
  isEnabled,
  ensureDatabaseStructure,
  generateSecretAndQR,
  activateTwoFactor,
  deactivateTwoFactor,
  verifyTOTP,
  generateRecoveryCodes,
  validateRecoveryCode
};