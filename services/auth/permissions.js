/**
 * permissions.js
 * Sistema de permisos y control de acceso para FactuSystem
 * Este módulo gestiona los permisos de acceso a funcionalidades según roles
 * de usuario, verificando si un usuario tiene permisos para realizar acciones
 * específicas en el sistema.
 */

const { ipcRenderer } = require('electron');
const logger = require('../audit/logger.js');
const db = require('../../app/assets/js/utils/database.js');

// Constantes para los módulos del sistema
const MODULES = {
  FACTURADOR: 'facturador',
  VENTAS: 'ventas',
  COMPRAS: 'compras',
  PRODUCTOS: 'productos',
  CAJA: 'caja',
  CLIENTES: 'clientes',
  PROVEEDORES: 'proveedores',
  USUARIOS: 'usuarios',
  CUOTIFICADOR: 'cuotificador',
  CONFIGURACIONES: 'configuraciones',
  REPORTES: 'reportes',
  DOCUMENTOS: 'documentos',
  AYUDA: 'ayuda',
  SUCURSALES: 'sucursales'
};

// Constantes para las acciones permitidas por módulo
const ACTIONS = {
  VIEW: 'view',      // Ver/acceder al módulo
  CREATE: 'create',  // Crear nuevos registros
  EDIT: 'edit',      // Editar registros existentes
  DELETE: 'delete',  // Eliminar registros
  PRINT: 'print',    // Imprimir documentos
  EXPORT: 'export',  // Exportar datos
  APPROVE: 'approve' // Aprobar operaciones (ej: cerrar caja)
};

// Roles predefinidos del sistema
const ROLES = {
  ADMIN: 'admin',            // Acceso total
  GERENTE: 'gerente',        // Acceso a casi todo excepto configuraciones críticas
  VENDEDOR: 'vendedor',      // Acceso a ventas, facturación, clientes
  CAJERO: 'cajero',          // Acceso a caja, ventas básicas
  SUPERVISOR: 'supervisor',  // Acceso a reportes y supervisión
  ALMACEN: 'almacen',        // Gestión de productos, stock
  CUSTOM: 'custom'           // Rol personalizado
};

// Permisos predefinidos por rol
const DEFAULT_PERMISSIONS = {
  [ROLES.ADMIN]: {
    // El administrador tiene acceso total a todos los módulos y acciones
    all: true
  },
  [ROLES.GERENTE]: {
    // El gerente tiene acceso a casi todo excepto configuraciones críticas
    [MODULES.FACTURADOR]: { [ACTIONS.VIEW]: true, [ACTIONS.CREATE]: true, [ACTIONS.PRINT]: true },
    [MODULES.VENTAS]: { all: true },
    [MODULES.COMPRAS]: { all: true },
    [MODULES.PRODUCTOS]: { all: true },
    [MODULES.CAJA]: { all: true },
    [MODULES.CLIENTES]: { all: true },
    [MODULES.PROVEEDORES]: { all: true },
    [MODULES.USUARIOS]: { [ACTIONS.VIEW]: true },
    [MODULES.CUOTIFICADOR]: { all: true },
    [MODULES.CONFIGURACIONES]: { [ACTIONS.VIEW]: true, [ACTIONS.EDIT]: true },
    [MODULES.REPORTES]: { all: true },
    [MODULES.DOCUMENTOS]: { all: true },
    [MODULES.AYUDA]: { all: true },
    [MODULES.SUCURSALES]: { [ACTIONS.VIEW]: true }
  },
  [ROLES.VENDEDOR]: {
    // El vendedor tiene acceso a ventas, facturación, clientes
    [MODULES.FACTURADOR]: { [ACTIONS.VIEW]: true, [ACTIONS.CREATE]: true, [ACTIONS.PRINT]: true },
    [MODULES.VENTAS]: { [ACTIONS.VIEW]: true, [ACTIONS.CREATE]: true, [ACTIONS.PRINT]: true },
    [MODULES.PRODUCTOS]: { [ACTIONS.VIEW]: true },
    [MODULES.CAJA]: { [ACTIONS.VIEW]: true },
    [MODULES.CLIENTES]: { [ACTIONS.VIEW]: true, [ACTIONS.CREATE]: true, [ACTIONS.EDIT]: true },
    [MODULES.CUOTIFICADOR]: { [ACTIONS.VIEW]: true, [ACTIONS.CREATE]: true },
    [MODULES.DOCUMENTOS]: { [ACTIONS.VIEW]: true, [ACTIONS.CREATE]: true, [ACTIONS.PRINT]: true },
    [MODULES.AYUDA]: { [ACTIONS.VIEW]: true }
  },
  [ROLES.CAJERO]: {
    // El cajero tiene acceso a caja, ventas básicas
    [MODULES.FACTURADOR]: { [ACTIONS.VIEW]: true, [ACTIONS.CREATE]: true, [ACTIONS.PRINT]: true },
    [MODULES.VENTAS]: { [ACTIONS.VIEW]: true },
    [MODULES.CAJA]: { [ACTIONS.VIEW]: true, [ACTIONS.CREATE]: true, [ACTIONS.EDIT]: true, [ACTIONS.APPROVE]: true },
    [MODULES.CLIENTES]: { [ACTIONS.VIEW]: true },
    [MODULES.AYUDA]: { [ACTIONS.VIEW]: true }
  },
  [ROLES.SUPERVISOR]: {
    // El supervisor tiene acceso a reportes y supervisión
    [MODULES.VENTAS]: { [ACTIONS.VIEW]: true, [ACTIONS.EXPORT]: true },
    [MODULES.COMPRAS]: { [ACTIONS.VIEW]: true, [ACTIONS.EXPORT]: true },
    [MODULES.PRODUCTOS]: { [ACTIONS.VIEW]: true, [ACTIONS.EXPORT]: true },
    [MODULES.CAJA]: { [ACTIONS.VIEW]: true, [ACTIONS.EXPORT]: true, [ACTIONS.APPROVE]: true },
    [MODULES.CLIENTES]: { [ACTIONS.VIEW]: true, [ACTIONS.EXPORT]: true },
    [MODULES.PROVEEDORES]: { [ACTIONS.VIEW]: true, [ACTIONS.EXPORT]: true },
    [MODULES.REPORTES]: { all: true },
    [MODULES.DOCUMENTOS]: { [ACTIONS.VIEW]: true, [ACTIONS.EXPORT]: true },
    [MODULES.AYUDA]: { [ACTIONS.VIEW]: true },
    [MODULES.SUCURSALES]: { [ACTIONS.VIEW]: true }
  },
  [ROLES.ALMACEN]: {
    // Almacén gestiona productos, stock
    [MODULES.PRODUCTOS]: { all: true },
    [MODULES.COMPRAS]: { [ACTIONS.VIEW]: true, [ACTIONS.CREATE]: true },
    [MODULES.PROVEEDORES]: { [ACTIONS.VIEW]: true, [ACTIONS.CREATE]: true },
    [MODULES.DOCUMENTOS]: { [ACTIONS.VIEW]: true, [ACTIONS.CREATE]: true },
    [MODULES.AYUDA]: { [ACTIONS.VIEW]: true }
  },
  [ROLES.CUSTOM]: {
    // Los permisos personalizados se cargan desde la base de datos
  }
};

/**
 * Clase que gestiona los permisos de usuarios
 */
class PermissionsManager {
  constructor() {
    this.currentUser = null;
    this.userPermissions = null;
    this.customRoles = new Map(); // Para almacenar roles personalizados
  }

  /**
   * Inicializa el administrador de permisos
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      // Cargar roles personalizados desde la base de datos
      await this.loadCustomRoles();
      
      // Escuchar eventos de inicio y cierre de sesión
      ipcRenderer.on('user-login', (event, userData) => {
        this.setCurrentUser(userData);
      });
      
      ipcRenderer.on('user-logout', () => {
        this.clearCurrentUser();
      });
      
      // Verificar si hay un usuario activo en localStorage
      const storedUser = localStorage.getItem('currentUser');
      if (storedUser) {
        this.setCurrentUser(JSON.parse(storedUser));
      }
      
      logger.info('PermissionsManager inicializado correctamente');
    } catch (error) {
      logger.error('Error inicializando PermissionsManager:', error);
      throw error;
    }
  }

  /**
   * Carga los roles personalizados desde la base de datos
   * @returns {Promise<void>}
   */
  async loadCustomRoles() {
    try {
      // Obtener roles personalizados de la base de datos
      const roles = await db.all(`SELECT * FROM roles WHERE type = 'custom'`);
      
      // Para cada rol personalizado, cargar sus permisos
      for (const role of roles) {
        const permissions = await db.all(`
          SELECT module, action, allowed 
          FROM role_permissions 
          WHERE role_id = ?
        `, [role.id]);
        
        // Estructurar los permisos para este rol
        const rolePermissions = {};
        
        permissions.forEach(perm => {
          if (!rolePermissions[perm.module]) {
            rolePermissions[perm.module] = {};
          }
          rolePermissions[perm.module][perm.action] = perm.allowed === 1;
        });
        
        // Guardar en el mapa de roles personalizados
        this.customRoles.set(role.name, rolePermissions);
      }
      
      logger.info(`Cargados ${this.customRoles.size} roles personalizados`);
    } catch (error) {
      logger.error('Error cargando roles personalizados:', error);
    }
  }

  /**
   * Establece el usuario actual y carga sus permisos
   * @param {Object} userData - Datos del usuario
   */
  async setCurrentUser(userData) {
    try {
      this.currentUser = userData;
      
      // Guardar en localStorage para persistencia
      localStorage.setItem('currentUser', JSON.stringify(userData));
      
      // Cargar los permisos según el rol del usuario
      await this.loadUserPermissions(userData);
      
      logger.info(`Usuario establecido: ${userData.username} (${userData.role})`);
    } catch (error) {
      logger.error(`Error estableciendo usuario ${userData.username}:`, error);
    }
  }

  /**
   * Limpia los datos del usuario actual
   */
  clearCurrentUser() {
    this.currentUser = null;
    this.userPermissions = null;
    localStorage.removeItem('currentUser');
    logger.info('Sesión de usuario eliminada');
  }

  /**
   * Carga los permisos para el usuario actual
   * @param {Object} userData - Datos del usuario
   * @returns {Promise<void>}
   */
  async loadUserPermissions(userData) {
    try {
      // Si es un rol predefinido, usar los permisos por defecto
      if (DEFAULT_PERMISSIONS[userData.role]) {
        this.userPermissions = DEFAULT_PERMISSIONS[userData.role];
      } 
      // Si es un rol personalizado, buscar en el mapa de roles personalizados
      else if (this.customRoles.has(userData.role)) {
        this.userPermissions = this.customRoles.get(userData.role);
      } 
      // Si es un rol desconocido, cargar permisos personalizados de la BD
      else {
        await this.loadCustomPermissionsForUser(userData);
      }
      
      // Si el usuario tiene permisos especiales, añadirlos o sobreescribirlos
      if (userData.id) {
        await this.loadSpecialPermissionsForUser(userData.id);
      }
      
      logger.info(`Permisos cargados para ${userData.username}`);
    } catch (error) {
      logger.error(`Error cargando permisos para ${userData.username}:`, error);
      // Establecer permisos mínimos en caso de error
      this.userPermissions = {
        [MODULES.AYUDA]: { [ACTIONS.VIEW]: true }
      };
    }
  }

  /**
   * Carga permisos personalizados para un usuario desde la base de datos
   * @param {Object} userData - Datos del usuario
   */
  async loadCustomPermissionsForUser(userData) {
    try {
      // Buscar el rol en la base de datos
      const role = await db.get(`SELECT * FROM roles WHERE name = ?`, [userData.role]);
      
      if (!role) {
        logger.warn(`Rol no encontrado: ${userData.role}, asignando permisos mínimos`);
        this.userPermissions = {
          [MODULES.AYUDA]: { [ACTIONS.VIEW]: true }
        };
        return;
      }
      
      // Cargar permisos para este rol
      const permissions = await db.all(`
        SELECT module, action, allowed 
        FROM role_permissions 
        WHERE role_id = ?
      `, [role.id]);
      
      // Estructurar los permisos
      this.userPermissions = {};
      permissions.forEach(perm => {
        if (!this.userPermissions[perm.module]) {
          this.userPermissions[perm.module] = {};
        }
        this.userPermissions[perm.module][perm.action] = perm.allowed === 1;
      });
      
    } catch (error) {
      logger.error(`Error cargando permisos personalizados para ${userData.username}:`, error);
      throw error;
    }
  }

  /**
   * Carga permisos especiales asignados directamente al usuario
   * @param {number} userId - ID del usuario
   */
  async loadSpecialPermissionsForUser(userId) {
    try {
      // Buscar permisos especiales para este usuario
      const specialPermissions = await db.all(`
        SELECT module, action, allowed 
        FROM user_permissions 
        WHERE user_id = ?
      `, [userId]);
      
      // Si no hay permisos especiales, terminar
      if (specialPermissions.length === 0) {
        return;
      }
      
      // Añadir o sobrescribir los permisos especiales
      specialPermissions.forEach(perm => {
        if (!this.userPermissions[perm.module]) {
          this.userPermissions[perm.module] = {};
        }
        this.userPermissions[perm.module][perm.action] = perm.allowed === 1;
      });
      
      logger.info(`Permisos especiales aplicados para usuario ID ${userId}`);
    } catch (error) {
      logger.error(`Error cargando permisos especiales para usuario ID ${userId}:`, error);
    }
  }

  /**
   * Verifica si el usuario actual tiene permiso para realizar una acción en un módulo
   * @param {string} module - Nombre del módulo
   * @param {string} action - Nombre de la acción
   * @returns {boolean} - true si tiene permiso, false si no
   */
  hasPermission(module, action) {
    try {
      // Si no hay usuario o no hay permisos cargados, denegar acceso
      if (!this.currentUser || !this.userPermissions) {
        return false;
      }
      
      // Si el usuario es administrador, permitir todo
      if (this.currentUser.role === ROLES.ADMIN || 
          (this.userPermissions.all === true)) {
        return true;
      }
      
      // Verificar si el módulo existe en los permisos
      if (!this.userPermissions[module]) {
        return false;
      }
      
      // Si tiene acceso total al módulo
      if (this.userPermissions[module].all === true) {
        return true;
      }
      
      // Verificar el permiso específico
      return this.userPermissions[module][action] === true;
    } catch (error) {
      logger.error(`Error verificando permiso ${module}.${action}:`, error);
      return false; // En caso de error, denegar por seguridad
    }
  }

  /**
   * Verifica si el usuario tiene acceso a un módulo (permiso de visualización)
   * @param {string} module - Nombre del módulo
   * @returns {boolean} - true si tiene acceso, false si no
   */
  canAccessModule(module) {
    return this.hasPermission(module, ACTIONS.VIEW);
  }

  /**
   * Verifica si el usuario puede crear registros en un módulo
   * @param {string} module - Nombre del módulo
   * @returns {boolean} - true si puede crear, false si no
   */
  canCreate(module) {
    return this.hasPermission(module, ACTIONS.CREATE);
  }

  /**
   * Verifica si el usuario puede editar registros en un módulo
   * @param {string} module - Nombre del módulo
   * @returns {boolean} - true si puede editar, false si no
   */
  canEdit(module) {
    return this.hasPermission(module, ACTIONS.EDIT);
  }

  /**
   * Verifica si el usuario puede eliminar registros en un módulo
   * @param {string} module - Nombre del módulo
   * @returns {boolean} - true si puede eliminar, false si no
   */
  canDelete(module) {
    return this.hasPermission(module, ACTIONS.DELETE);
  }

  /**
   * Verifica si el usuario puede imprimir documentos de un módulo
   * @param {string} module - Nombre del módulo
   * @returns {boolean} - true si puede imprimir, false si no
   */
  canPrint(module) {
    return this.hasPermission(module, ACTIONS.PRINT);
  }

  /**
   * Verifica si el usuario puede exportar datos de un módulo
   * @param {string} module - Nombre del módulo
   * @returns {boolean} - true si puede exportar, false si no
   */
  canExport(module) {
    return this.hasPermission(module, ACTIONS.EXPORT);
  }

  /**
   * Verifica si el usuario puede aprobar operaciones en un módulo
   * @param {string} module - Nombre del módulo
   * @returns {boolean} - true si puede aprobar, false si no
   */
  canApprove(module) {
    return this.hasPermission(module, ACTIONS.APPROVE);
  }

  /**
   * Actualiza los permisos de un rol en la base de datos
   * @param {string} roleName - Nombre del rol
   * @param {Object} permissions - Objeto con los permisos a actualizar
   * @returns {Promise<boolean>} - true si la actualización fue exitosa, false si no
   */
  async updateRolePermissions(roleName, permissions) {
    try {
      // Verificar si el usuario actual puede modificar roles
      if (!this.hasPermission(MODULES.USUARIOS, ACTIONS.EDIT)) {
        logger.warn(`Usuario ${this.currentUser.username} intentó modificar permisos sin autorización`);
        return false;
      }

      // Obtener el ID del rol
      const role = await db.get(`SELECT id FROM roles WHERE name = ?`, [roleName]);
      if (!role) {
        logger.error(`Rol no encontrado: ${roleName}`);
        return false;
      }

      // Comenzar una transacción
      await db.run('BEGIN TRANSACTION');

      try {
        // Eliminar los permisos existentes para este rol
        await db.run(`DELETE FROM role_permissions WHERE role_id = ?`, [role.id]);

        // Insertar los nuevos permisos
        for (const module in permissions) {
          for (const action in permissions[module]) {
            // Saltarse la propiedad "all" si existe
            if (action === 'all') continue;

            await db.run(`
              INSERT INTO role_permissions (role_id, module, action, allowed)
              VALUES (?, ?, ?, ?)
            `, [role.id, module, action, permissions[module][action] ? 1 : 0]);
          }

          // Si tiene la propiedad "all", agregar todos los permisos
          if (permissions[module].all === true) {
            for (const action of Object.values(ACTIONS)) {
              await db.run(`
                INSERT INTO role_permissions (role_id, module, action, allowed)
                VALUES (?, ?, ?, 1)
              `, [role.id, module, action]);
            }
          }
        }

        // Confirmar la transacción
        await db.run('COMMIT');

        // Actualizar el mapa de roles personalizados
        if (this.customRoles.has(roleName)) {
          this.customRoles.set(roleName, permissions);
        }

        // Registrar la acción
        logger.info(`Permisos actualizados para el rol ${roleName} por ${this.currentUser.username}`);
        return true;
      } catch (error) {
        // Revertir la transacción en caso de error
        await db.run('ROLLBACK');
        logger.error(`Error actualizando permisos para el rol ${roleName}:`, error);
        return false;
      }
    } catch (error) {
      logger.error(`Error en updateRolePermissions para ${roleName}:`, error);
      return false;
    }
  }

  /**
   * Actualiza los permisos especiales de un usuario
   * @param {number} userId - ID del usuario
   * @param {Object} permissions - Objeto con los permisos especiales
   * @returns {Promise<boolean>} - true si la actualización fue exitosa, false si no
   */
  async updateUserSpecialPermissions(userId, permissions) {
    try {
      // Verificar si el usuario actual puede modificar usuarios
      if (!this.hasPermission(MODULES.USUARIOS, ACTIONS.EDIT)) {
        logger.warn(`Usuario ${this.currentUser.username} intentó modificar permisos especiales sin autorización`);
        return false;
      }

      // Comenzar una transacción
      await db.run('BEGIN TRANSACTION');

      try {
        // Eliminar los permisos especiales existentes
        await db.run(`DELETE FROM user_permissions WHERE user_id = ?`, [userId]);

        // Insertar los nuevos permisos especiales
        for (const module in permissions) {
          for (const action in permissions[module]) {
            await db.run(`
              INSERT INTO user_permissions (user_id, module, action, allowed)
              VALUES (?, ?, ?, ?)
            `, [userId, module, action, permissions[module][action] ? 1 : 0]);
          }
        }

        // Confirmar la transacción
        await db.run('COMMIT');

        // Registrar la acción
        logger.info(`Permisos especiales actualizados para usuario ID ${userId} por ${this.currentUser.username}`);
        return true;
      } catch (error) {
        // Revertir la transacción en caso de error
        await db.run('ROLLBACK');
        logger.error(`Error actualizando permisos especiales para usuario ID ${userId}:`, error);
        return false;
      }
    } catch (error) {
      logger.error(`Error en updateUserSpecialPermissions para usuario ID ${userId}:`, error);
      return false;
    }
  }

  /**
   * Crea un nuevo rol personalizado
   * @param {string} roleName - Nombre del nuevo rol
   * @param {string} description - Descripción del rol
   * @param {Object} permissions - Permisos iniciales del rol
   * @returns {Promise<boolean>} - true si la creación fue exitosa, false si no
   */
  async createCustomRole(roleName, description, permissions) {
    try {
      // Verificar si el usuario actual puede crear roles
      if (!this.hasPermission(MODULES.USUARIOS, ACTIONS.CREATE)) {
        logger.warn(`Usuario ${this.currentUser.username} intentó crear rol sin autorización`);
        return false;
      }

      // Verificar si el rol ya existe
      const existingRole = await db.get(`SELECT id FROM roles WHERE name = ?`, [roleName]);
      if (existingRole) {
        logger.warn(`El rol ${roleName} ya existe`);
        return false;
      }

      // Comenzar una transacción
      await db.run('BEGIN TRANSACTION');

      try {
        // Crear el nuevo rol
        const result = await db.run(`
          INSERT INTO roles (name, description, type)
          VALUES (?, ?, 'custom')
        `, [roleName, description]);

        const roleId = result.lastID;

        // Insertar los permisos para este rol
        for (const module in permissions) {
          for (const action in permissions[module]) {
            if (action === 'all') continue;

            await db.run(`
              INSERT INTO role_permissions (role_id, module, action, allowed)
              VALUES (?, ?, ?, ?)
            `, [roleId, module, action, permissions[module][action] ? 1 : 0]);
          }

          // Si tiene la propiedad "all", agregar todos los permisos
          if (permissions[module].all === true) {
            for (const action of Object.values(ACTIONS)) {
              await db.run(`
                INSERT INTO role_permissions (role_id, module, action, allowed)
                VALUES (?, ?, ?, 1)
              `, [roleId, module, action]);
            }
          }
        }

        // Confirmar la transacción
        await db.run('COMMIT');

        // Agregar al mapa de roles personalizados
        this.customRoles.set(roleName, permissions);

        // Registrar la acción
        logger.info(`Rol personalizado ${roleName} creado por ${this.currentUser.username}`);
        return true;
      } catch (error) {
        // Revertir la transacción en caso de error
        await db.run('ROLLBACK');
        logger.error(`Error creando rol personalizado ${roleName}:`, error);
        return false;
      }
    } catch (error) {
      logger.error(`Error en createCustomRole para ${roleName}:`, error);
      return false;
    }
  }

  /**
   * Elimina un rol personalizado
   * @param {string} roleName - Nombre del rol a eliminar
   * @returns {Promise<boolean>} - true si la eliminación fue exitosa, false si no
   */
  async deleteCustomRole(roleName) {
    try {
      // Verificar si el usuario actual puede eliminar roles
      if (!this.hasPermission(MODULES.USUARIOS, ACTIONS.DELETE)) {
        logger.warn(`Usuario ${this.currentUser.username} intentó eliminar rol sin autorización`);
        return false;
      }

      // Verificar si el rol existe y es personalizado
      const role = await db.get(`SELECT id, type FROM roles WHERE name = ?`, [roleName]);
      if (!role) {
        logger.warn(`El rol ${roleName} no existe`);
        return false;
      }

      if (role.type !== 'custom') {
        logger.warn(`El rol ${roleName} no es personalizado y no puede eliminarse`);
        return false;
      }

      // Verificar si hay usuarios asignados a este rol
      const usersWithRole = await db.get(`SELECT COUNT(*) as count FROM users WHERE role = ?`, [roleName]);
      if (usersWithRole.count > 0) {
        logger.warn(`No se puede eliminar el rol ${roleName} porque hay usuarios asignados`);
        return false;
      }

      // Comenzar una transacción
      await db.run('BEGIN TRANSACTION');

      try {
        // Eliminar los permisos asociados a este rol
        await db.run(`DELETE FROM role_permissions WHERE role_id = ?`, [role.id]);

        // Eliminar el rol
        await db.run(`DELETE FROM roles WHERE id = ?`, [role.id]);

        // Confirmar la transacción
        await db.run('COMMIT');

        // Eliminar del mapa de roles personalizados
        this.customRoles.delete(roleName);

        // Registrar la acción
        logger.info(`Rol personalizado ${roleName} eliminado por ${this.currentUser.username}`);
        return true;
      } catch (error) {
        // Revertir la transacción en caso de error
        await db.run('ROLLBACK');
        logger.error(`Error eliminando rol personalizado ${roleName}:`, error);
        return false;
      }
    } catch (error) {
      logger.error(`Error en deleteCustomRole para ${roleName}:`, error);
      return false;
    }
  }

  /**
   * Obtiene todos los roles disponibles
   * @returns {Promise<Array>} - Array con todos los roles
   */
  async getAllRoles() {
    try {
      const roles = await db.all(`SELECT * FROM roles`);
      
      // Añadir los roles predefinidos que no estén en la base de datos
      for (const roleName of Object.values(ROLES)) {
        const roleExists = roles.some(r => r.name === roleName);
        if (!roleExists && roleName !== ROLES.CUSTOM) {
          roles.push({
            id: null,
            name: roleName,
            description: `Rol predefinido: ${roleName}`,
            type: 'predefined'
          });
        }
      }
      
      return roles;
    } catch (error) {
      logger.error('Error obteniendo roles:', error);
      return [];
    }
  }

  /**
   * Obtiene todos los permisos para un rol específico
   * @param {string} roleName - Nombre del rol
   * @returns {Promise<Object>} - Objeto con los permisos del rol
   */
  async getRolePermissions(roleName) {
    try {
      // Si es un rol predefinido
      if (DEFAULT_PERMISSIONS[roleName]) {
        return DEFAULT_PERMISSIONS[roleName];
      }
      
      // Si es un rol personalizado en memoria
      if (this.customRoles.has(roleName)) {
        return this.customRoles.get(roleName);
      }
      
      // Buscar el rol en la base de datos
      const role = await db.get(`SELECT id FROM roles WHERE name = ?`, [roleName]);
      if (!role) {
        logger.warn(`El rol ${roleName} no existe`);
        return {};
      }
      
      // Obtener los permisos para este rol
      const permissions = await db.all(`
        SELECT module, action, allowed 
        FROM role_permissions 
        WHERE role_id = ?
      `, [role.id]);
      
      // Estructurar los permisos
      const rolePermissions = {};
      permissions.forEach(perm => {
        if (!rolePermissions[perm.module]) {
          rolePermissions[perm.module] = {};
        }
        rolePermissions[perm.module][perm.action] = perm.allowed === 1;
      });
      
      return rolePermissions;
    } catch (error) {
        logger.error(`Error obteniendo permisos para rol ${roleName}:`, error);
        return {};
      }
    }
  
    /**
     * Obtiene los permisos especiales para un usuario específico
     * @param {number} userId - ID del usuario
     * @returns {Promise<Object>} - Objeto con los permisos especiales del usuario
     */
    async getUserSpecialPermissions(userId) {
      try {
        // Obtener los permisos especiales para este usuario
        const specialPermissions = await db.all(`
          SELECT module, action, allowed 
          FROM user_permissions 
          WHERE user_id = ?
        `, [userId]);
        
        // Estructurar los permisos
        const userPermissions = {};
        specialPermissions.forEach(perm => {
          if (!userPermissions[perm.module]) {
            userPermissions[perm.module] = {};
          }
          userPermissions[perm.module][perm.action] = perm.allowed === 1;
        });
        
        return userPermissions;
      } catch (error) {
        logger.error(`Error obteniendo permisos especiales para usuario ID ${userId}:`, error);
        return {};
      }
    }
  
    /**
     * Verifica si un usuario tiene permisos para una combinación de múltiples acciones
     * @param {Object} permissions - Objeto con módulos y acciones a verificar
     * @returns {boolean} - true si tiene todos los permisos, false si falta alguno
     */
    checkMultiplePermissions(permissions) {
      try {
        for (const module in permissions) {
          const actions = permissions[module];
          for (const action of actions) {
            if (!this.hasPermission(module, action)) {
              return false;
            }
          }
        }
        return true;
      } catch (error) {
        logger.error('Error en checkMultiplePermissions:', error);
        return false;
      }
    }
  
    /**
     * Registra un intento de acceso no autorizado
     * @param {string} module - Módulo al que se intentó acceder
     * @param {string} action - Acción que se intentó realizar
     * @param {Object} metadata - Información adicional del intento
     */
    logUnauthorizedAccess(module, action, metadata = {}) {
      try {
        const username = this.currentUser ? this.currentUser.username : 'usuario_desconocido';
        const logData = {
          username,
          module,
          action,
          timestamp: new Date().toISOString(),
          ...metadata
        };
        
        logger.warn(`Acceso no autorizado: ${username} intentó ${action} en ${module}`, logData);
        
        // Guardar registro de auditoría en la base de datos
        db.run(`
          INSERT INTO audit_log (user_id, username, action, module, details, ip_address, timestamp, event_type)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'unauthorized_access')
        `, [
          this.currentUser ? this.currentUser.id : null,
          username,
          action,
          module,
          JSON.stringify(metadata),
          metadata.ip || 'desconocida',
          logData.timestamp
        ]).catch(err => {
          logger.error('Error guardando registro de auditoría:', err);
        });
      } catch (error) {
        logger.error('Error en logUnauthorizedAccess:', error);
      }
    }
  
    /**
     * Verifica si el rol actual es un rol específico
     * @param {string} roleName - Nombre del rol a verificar
     * @returns {boolean} - true si es el rol especificado, false si no
     */
    hasRole(roleName) {
      return this.currentUser && this.currentUser.role === roleName;
    }
  
    /**
     * Verifica si el usuario actual es administrador
     * @returns {boolean} - true si es administrador, false si no
     */
    isAdmin() {
      return this.hasRole(ROLES.ADMIN);
    }
  
    /**
     * Verifica si el usuario actual puede ver reportes avanzados
     * @returns {boolean} - true si puede ver reportes avanzados, false si no
     */
    canViewAdvancedReports() {
      return this.isAdmin() || 
             this.hasRole(ROLES.GERENTE) || 
             this.hasRole(ROLES.SUPERVISOR) || 
             this.hasPermission(MODULES.REPORTES, 'advanced');
    }
  
    /**
     * Verifica si el usuario actual puede configurar integraciones
     * @param {string} integrationType - Tipo de integración (opcional)
     * @returns {boolean} - true si puede configurar integraciones, false si no
     */
    canConfigureIntegrations(integrationType = null) {
      // Solo admins y gerentes pueden configurar integraciones
      if (!this.isAdmin() && !this.hasRole(ROLES.GERENTE)) {
        return false;
      }
      
      // Si no se especifica un tipo, verificar permiso general
      if (!integrationType) {
        return this.hasPermission(MODULES.CONFIGURACIONES, 'integrations');
      }
      
      // Verificar permiso específico para el tipo de integración
      return this.hasPermission(MODULES.CONFIGURACIONES, `integration_${integrationType}`);
    }
  
    /**
     * Verifica si el usuario puede acceder a una sucursal específica
     * @param {number} branchId - ID de la sucursal
     * @returns {Promise<boolean>} - true si puede acceder, false si no
     */
    async canAccessBranch(branchId) {
      try {
        // Administradores pueden acceder a todas las sucursales
        if (this.isAdmin()) {
          return true;
        }
        
        // Si no hay usuario actual, denegar acceso
        if (!this.currentUser) {
          return false;
        }
        
        // Verificar si el usuario tiene permiso para acceder a la sucursal
        const access = await db.get(`
          SELECT 1 FROM user_branches 
          WHERE user_id = ? AND branch_id = ?
        `, [this.currentUser.id, branchId]);
        
        return !!access;
      } catch (error) {
        logger.error(`Error verificando acceso a sucursal ${branchId}:`, error);
        return false;
      }
    }
  
    /**
     * Obtiene las sucursales a las que tiene acceso el usuario actual
     * @returns {Promise<Array>} - Array con las sucursales accesibles
     */
    async getAccessibleBranches() {
      try {
        // Si no hay usuario actual, devolver array vacío
        if (!this.currentUser) {
          return [];
        }
        
        // Administradores pueden acceder a todas las sucursales
        if (this.isAdmin()) {
          return await db.all(`SELECT * FROM branches`);
        }
        
        // Obtener las sucursales asignadas al usuario
        return await db.all(`
          SELECT b.* 
          FROM branches b
          JOIN user_branches ub ON b.id = ub.branch_id
          WHERE ub.user_id = ?
        `, [this.currentUser.id]);
      } catch (error) {
        logger.error('Error obteniendo sucursales accesibles:', error);
        return [];
      }
    }
  
    /**
     * Aplica restricciones de permisos a un elemento del DOM
     * Oculta o deshabilita elementos según los permisos del usuario
     * @param {HTMLElement} element - Elemento del DOM
     * @param {string} module - Módulo relacionado
     * @param {string} action - Acción requerida
     * @param {string} behavior - Comportamiento: 'hide' (ocultar) o 'disable' (deshabilitar)
     */
    applyPermissionToElement(element, module, action, behavior = 'hide') {
      if (!element) return;
      
      const hasPermission = this.hasPermission(module, action);
      
      if (!hasPermission) {
        if (behavior === 'hide') {
          element.style.display = 'none';
        } else if (behavior === 'disable') {
          element.disabled = true;
          element.classList.add('disabled');
          
          // Si es un botón, agregar un título explicativo
          if (element.tagName === 'BUTTON') {
            element.setAttribute('title', 'No tiene permisos para esta acción');
          }
        }
      }
    }
  
    /**
     * Aplica restricciones de permisos a varios elementos del DOM basados en atributos data-*
     * @param {string} containerSelector - Selector CSS del contenedor donde buscar elementos
     */
    applyPermissionsToContainer(containerSelector = 'body') {
      try {
        const container = document.querySelector(containerSelector);
        if (!container) return;
        
        // Procesar elementos con data-require-permission
        const elements = container.querySelectorAll('[data-require-permission]');
        elements.forEach(element => {
          const permissionData = element.getAttribute('data-require-permission').split(':');
          if (permissionData.length < 2) return;
          
          const module = permissionData[0];
          const action = permissionData[1];
          const behavior = element.getAttribute('data-permission-behavior') || 'hide';
          
          this.applyPermissionToElement(element, module, action, behavior);
        });
        
        // Procesar elementos con data-require-role
        const roleElements = container.querySelectorAll('[data-require-role]');
        roleElements.forEach(element => {
          const requiredRole = element.getAttribute('data-require-role');
          const behavior = element.getAttribute('data-permission-behavior') || 'hide';
          
          if (!this.hasRole(requiredRole)) {
            if (behavior === 'hide') {
              element.style.display = 'none';
            } else if (behavior === 'disable') {
              element.disabled = true;
              element.classList.add('disabled');
            }
          }
        });
      } catch (error) {
        logger.error(`Error aplicando permisos al contenedor ${containerSelector}:`, error);
      }
    }
  
    /**
     * Inicializa los listeners para cambios en la interfaz de usuario
     * que requieran verificación de permisos
     */
    initializeUIPermissionHandlers() {
      // Observar cambios en el DOM para aplicar permisos a nuevos elementos
      const observer = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
          if (mutation.type === 'childList' && mutation.addedNodes.length) {
            mutation.addedNodes.forEach(node => {
              if (node.nodeType === 1) { // Es un elemento HTML
                this.applyPermissionsToContainer(node);
              }
            });
          }
        });
      });
      
      // Configurar y iniciar el observador
      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
      
      // Aplicar permisos al DOM actual
      document.addEventListener('DOMContentLoaded', () => {
        this.applyPermissionsToContainer();
      });
      
      // Si el DOM ya está cargado, aplicar permisos ahora
      if (document.readyState === 'interactive' || document.readyState === 'complete') {
        this.applyPermissionsToContainer();
      }
    }
  }
  
  // Constantes exportadas para uso en toda la aplicación
  const PERMISSION_MODULES = MODULES;
  const PERMISSION_ACTIONS = ACTIONS;
  const USER_ROLES = ROLES;
  
  // Crear y exportar una instancia única del administrador de permisos
  const permissionsManager = new PermissionsManager();
  
  // Exportar la instancia y las constantes
  module.exports = {
    permissionsManager,
    PERMISSION_MODULES,
    PERMISSION_ACTIONS,
    USER_ROLES,
    // Métodos de conveniencia para verificar permisos
    hasPermission: (module, action) => permissionsManager.hasPermission(module, action),
    canAccessModule: (module) => permissionsManager.canAccessModule(module),
    canCreate: (module) => permissionsManager.canCreate(module),
    canEdit: (module) => permissionsManager.canEdit(module),
    canDelete: (module) => permissionsManager.canDelete(module),
    canPrint: (module) => permissionsManager.canPrint(module),
    canExport: (module) => permissionsManager.canExport(module),
    canApprove: (module) => permissionsManager.canApprove(module),
    isAdmin: () => permissionsManager.isAdmin()
  };