/**
 * FactuSystem - Módulo de gestión de permisos de usuarios
 * 
 * Este módulo se encarga de:
 * - Gestionar los permisos disponibles en el sistema
 * - Asignar permisos a roles
 * - Verificar si un usuario tiene determinado permiso
 * - Interfaz para la administración de permisos
 */

// Importaciones necesarias
const { ipcRenderer } = require('electron');
const database = require('../../utils/database.js');
const auth = require('../../utils/auth.js');
const logger = require('../../utils/logger.js');
const validation = require('../../utils/validation.js');
const notifications = require('../../components/notifications.js');

/**
 * Clase para la gestión de permisos de usuarios
 */
class PermisosManager {
  constructor() {
    // Almacena permisos cargados
    this.permisos = [];
    
    // Estructura de permisos por módulo
    this.estructuraPermisos = {};
    
    // Cache de permisos por rol
    this.permisosRol = {};
    
    // Elementos del DOM
    this.elements = {
      permisosContainer: document.getElementById('permisos-container'),
      rolSelector: document.getElementById('rol-selector'),
      guardarPermisosBtn: document.getElementById('guardar-permisos-btn'),
      buscarPermiso: document.getElementById('buscar-permiso'),
      filtroModulo: document.getElementById('filtro-modulo')
    };
    
    // Inicialización
    this.init();
  }
  
  /**
   * Inicializa el módulo de permisos
   */
  async init() {
    try {
      await this.cargarPermisos();
      await this.cargarRoles();
      this.setupEventListeners();
      this.setupPermisosUI();
      
      logger.info('Módulo de permisos inicializado correctamente', { modulo: 'usuarios/permisos' });
    } catch (error) {
      logger.error('Error al inicializar módulo de permisos', { error: error.message, modulo: 'usuarios/permisos' });
      notifications.mostrarError('Error al cargar los permisos', error.message);
    }
  }
  
  /**
   * Carga todos los permisos desde la base de datos
   */
  async cargarPermisos() {
    try {
      const conn = await database.getConnection();
      const permisos = await conn.all('SELECT * FROM permisos ORDER BY modulo, nombre');
      this.permisos = permisos;
      
      // Organizar permisos por módulo para UI
      this.estructuraPermisos = this.permisos.reduce((acc, permiso) => {
        if (!acc[permiso.modulo]) {
          acc[permiso.modulo] = [];
        }
        acc[permiso.modulo].push(permiso);
        return acc;
      }, {});
      
      return permisos;
    } catch (error) {
      logger.error('Error al cargar permisos desde la base de datos', { error: error.message });
      throw new Error(`Error al cargar permisos: ${error.message}`);
    }
  }
  
  /**
   * Carga todos los roles desde la base de datos
   */
  async cargarRoles() {
    try {
      const conn = await database.getConnection();
      const roles = await conn.all('SELECT * FROM roles ORDER BY nombre');
      
      // Llenar el selector de roles
      if (this.elements.rolSelector) {
        this.elements.rolSelector.innerHTML = '';
        roles.forEach(rol => {
          const option = document.createElement('option');
          option.value = rol.id;
          option.textContent = rol.nombre;
          this.elements.rolSelector.appendChild(option);
        });
        
        // Cargar permisos del primer rol por defecto
        if (roles.length > 0) {
          this.cargarPermisosRol(roles[0].id);
        }
      }
      
      return roles;
    } catch (error) {
      logger.error('Error al cargar roles desde la base de datos', { error: error.message });
      throw new Error(`Error al cargar roles: ${error.message}`);
    }
  }
  
  /**
   * Configura todos los manejadores de eventos
   */
  setupEventListeners() {
    // Si estamos en la página de administración de permisos
    if (this.elements.rolSelector) {
      // Cambio de rol seleccionado
      this.elements.rolSelector.addEventListener('change', (e) => {
        const rolId = e.target.value;
        this.cargarPermisosRol(rolId);
      });
      
      // Guardar cambios en permisos
      this.elements.guardarPermisosBtn?.addEventListener('click', () => {
        this.guardarPermisosRol();
      });
      
      // Filtro de búsqueda
      this.elements.buscarPermiso?.addEventListener('input', (e) => {
        this.filtrarPermisos(e.target.value);
      });
      
      // Filtro por módulo
      this.elements.filtroModulo?.addEventListener('change', (e) => {
        this.filtrarPorModulo(e.target.value);
      });
    }
  }
  
  /**
   * Crea la interfaz de usuario para la administración de permisos
   */
  setupPermisosUI() {
    if (!this.elements.permisosContainer) return;
    
    // Limpiar contenedor
    this.elements.permisosContainer.innerHTML = '';
    
    // Llenar el filtro de módulos
    if (this.elements.filtroModulo) {
      this.elements.filtroModulo.innerHTML = '<option value="todos">Todos los módulos</option>';
      Object.keys(this.estructuraPermisos).forEach(modulo => {
        const option = document.createElement('option');
        option.value = modulo;
        option.textContent = this.formatearNombreModulo(modulo);
        this.elements.filtroModulo.appendChild(option);
      });
    }
    
    // Construir UI para cada módulo
    Object.keys(this.estructuraPermisos).sort().forEach(modulo => {
      const moduloDiv = document.createElement('div');
      moduloDiv.className = 'permiso-modulo';
      moduloDiv.dataset.modulo = modulo;
      
      const moduloHeader = document.createElement('div');
      moduloHeader.className = 'permiso-modulo-header';
      
      // Título del módulo con ícono
      const moduloTitulo = document.createElement('h3');
      moduloTitulo.innerHTML = `<i class="fas ${this.getIconoModulo(modulo)}"></i> ${this.formatearNombreModulo(modulo)}`;
      moduloHeader.appendChild(moduloTitulo);
      
      // Botón para seleccionar/deseleccionar todos los permisos del módulo
      const seleccionarTodos = document.createElement('button');
      seleccionarTodos.className = 'btn-select-all';
      seleccionarTodos.innerHTML = '<i class="fas fa-check-square"></i> Seleccionar todos';
      seleccionarTodos.addEventListener('click', () => this.toggleGrupoPermisos(modulo));
      moduloHeader.appendChild(seleccionarTodos);
      
      moduloDiv.appendChild(moduloHeader);
      
      // Contenedor para los permisos individuales
      const permisosGrid = document.createElement('div');
      permisosGrid.className = 'permisos-grid';
      
      // Crear checkbox para cada permiso
      this.estructuraPermisos[modulo].forEach(permiso => {
        const permisoItem = document.createElement('div');
        permisoItem.className = 'permiso-item';
        permisoItem.dataset.busqueda = `${permiso.nombre.toLowerCase()} ${permiso.descripcion.toLowerCase()}`;
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `permiso-${permiso.id}`;
        checkbox.dataset.permisoId = permiso.id;
        checkbox.className = 'permiso-checkbox';
        
        const label = document.createElement('label');
        label.htmlFor = `permiso-${permiso.id}`;
        label.innerHTML = `<span class="permiso-nombre">${permiso.nombre}</span>
                         <span class="permiso-descripcion">${permiso.descripcion}</span>`;
        
        permisoItem.appendChild(checkbox);
        permisoItem.appendChild(label);
        permisosGrid.appendChild(permisoItem);
      });
      
      moduloDiv.appendChild(permisosGrid);
      this.elements.permisosContainer.appendChild(moduloDiv);
    });
  }
  
  /**
   * Filtra los permisos mostrados según un texto de búsqueda
   * @param {string} texto - Texto para filtrar
   */
  filtrarPermisos(texto) {
    if (!texto) {
      // Mostrar todos los permisos si no hay texto de búsqueda
      document.querySelectorAll('.permiso-item').forEach(item => {
        item.style.display = 'flex';
      });
      document.querySelectorAll('.permiso-modulo').forEach(modulo => {
        modulo.style.display = 'block';
      });
      return;
    }
    
    texto = texto.toLowerCase();
    
    // Filtrar permisos que coincidan con la búsqueda
    document.querySelectorAll('.permiso-item').forEach(item => {
      const coincide = item.dataset.busqueda.includes(texto);
      item.style.display = coincide ? 'flex' : 'none';
    });
    
    // Ocultar módulos sin permisos visibles
    document.querySelectorAll('.permiso-modulo').forEach(modulo => {
      const permisosVisibles = modulo.querySelectorAll('.permiso-item[style="display: flex;"]').length;
      modulo.style.display = permisosVisibles > 0 ? 'block' : 'none';
    });
  }
  
  /**
   * Filtra permisos por módulo
   * @param {string} modulo - Nombre del módulo a filtrar
   */
  filtrarPorModulo(modulo) {
    if (modulo === 'todos') {
      document.querySelectorAll('.permiso-modulo').forEach(mod => {
        mod.style.display = 'block';
      });
      return;
    }
    
    document.querySelectorAll('.permiso-modulo').forEach(mod => {
      mod.style.display = mod.dataset.modulo === modulo ? 'block' : 'none';
    });
  }
  
  /**
   * Carga los permisos asignados a un rol específico
   * @param {number} rolId - ID del rol
   */
  async cargarPermisosRol(rolId) {
    try {
      // Si ya tenemos los permisos en caché, usamos esos
      if (this.permisosRol[rolId]) {
        this.actualizarUIPermisos(this.permisosRol[rolId]);
        return this.permisosRol[rolId];
      }
      
      const conn = await database.getConnection();
      const permisosRol = await conn.all(
        'SELECT permiso_id FROM rol_permisos WHERE rol_id = ?',
        [rolId]
      );
      
      // Guardar en caché
      this.permisosRol[rolId] = permisosRol.map(p => p.permiso_id);
      
      // Actualizar UI
      this.actualizarUIPermisos(this.permisosRol[rolId]);
      
      return this.permisosRol[rolId];
    } catch (error) {
      logger.error('Error al cargar permisos del rol', { rolId, error: error.message });
      notifications.mostrarError('Error', `No se pudieron cargar los permisos del rol: ${error.message}`);
      return [];
    }
  }
  
  /**
   * Actualiza la UI marcando los permisos asignados a un rol
   * @param {Array<number>} permisosRol - IDs de permisos asignados al rol
   */
  actualizarUIPermisos(permisosRol) {
    // Desmarcar todos los permisos primero
    document.querySelectorAll('.permiso-checkbox').forEach(checkbox => {
      checkbox.checked = false;
    });
    
    // Marcar los permisos asignados
    permisosRol.forEach(permisoId => {
      const checkbox = document.querySelector(`.permiso-checkbox[data-permiso-id="${permisoId}"]`);
      if (checkbox) {
        checkbox.checked = true;
      }
    });
  }
  
  /**
   * Guarda los permisos asignados al rol seleccionado
   */
  async guardarPermisosRol() {
    try {
      const rolId = this.elements.rolSelector.value;
      if (!rolId) {
        notifications.mostrarAdvertencia('Seleccione un rol', 'Debe seleccionar un rol para guardar los permisos');
        return;
      }
      
      // Obtener todos los permisos seleccionados
      const permisosSeleccionados = [];
      document.querySelectorAll('.permiso-checkbox:checked').forEach(checkbox => {
        permisosSeleccionados.push(parseInt(checkbox.dataset.permisoId));
      });
      
      // Verificar permisos esenciales
      if (!this.validarPermisosEsenciales(permisosSeleccionados)) {
        return;
      }
      
      // Guardar en la base de datos dentro de una transacción
      const conn = await database.getConnection();
      await conn.run('BEGIN TRANSACTION');
      
      try {
        // Eliminar permisos actuales del rol
        await conn.run('DELETE FROM rol_permisos WHERE rol_id = ?', [rolId]);
        
        // Insertar nuevos permisos
        const stmt = await conn.prepare('INSERT INTO rol_permisos (rol_id, permiso_id) VALUES (?, ?)');
        for (const permisoId of permisosSeleccionados) {
          await stmt.run(rolId, permisoId);
        }
        await stmt.finalize();
        
        await conn.run('COMMIT');
        
        // Actualizar caché
        this.permisosRol[rolId] = permisosSeleccionados;
        
        // Registrar acción
        const usuario = auth.getUsuarioActual();
        logger.info('Permisos de rol actualizados', { 
          rolId, 
          permisosCount: permisosSeleccionados.length,
          usuario: usuario.username,
          usuarioId: usuario.id
        });
        
        // Forzar refresco de permisos en memoria para todos los usuarios activos
        ipcRenderer.send('permisos:actualizar');
        
        notifications.mostrarExito('Permisos guardados', 'Los permisos del rol han sido actualizados correctamente');
      } catch (error) {
        await conn.run('ROLLBACK');
        throw error;
      }
    } catch (error) {
      logger.error('Error al guardar permisos del rol', { error: error.message });
      notifications.mostrarError('Error', `No se pudieron guardar los permisos: ${error.message}`);
    }
  }
  
  /**
   * Valida que se mantengan ciertos permisos esenciales para evitar bloqueos
   * @param {Array<number>} permisosSeleccionados - Lista de IDs de permisos seleccionados
   * @returns {boolean} - True si la validación pasa, false si no
   */
  validarPermisosEsenciales(permisosSeleccionados) {
    // Para el rol de administrador (id=1) verificar permisos críticos
    if (this.elements.rolSelector.value === '1') {
      // Obtener IDs de permisos esenciales
      const permisosEsenciales = this.permisos.filter(p => 
        p.nombre === 'acceder_config' || 
        p.nombre === 'gestionar_usuarios' ||
        p.nombre === 'gestionar_permisos'
      ).map(p => p.id);
      
      // Verificar si todos los permisos esenciales están seleccionados
      const tieneEsenciales = permisosEsenciales.every(id => permisosSeleccionados.includes(id));
      
      if (!tieneEsenciales) {
        notifications.mostrarAdvertencia(
          'Permisos requeridos', 
          'El rol de Administrador debe mantener acceso a Configuración, Usuarios y Permisos para evitar bloqueos en el sistema'
        );
        return false;
      }
    }
    
    return true;
  }
  
  /**
   * Selecciona o deselecciona todos los permisos de un módulo
   * @param {string} modulo - Nombre del módulo
   */
  toggleGrupoPermisos(modulo) {
    const moduloDiv = document.querySelector(`.permiso-modulo[data-modulo="${modulo}"]`);
    if (!moduloDiv) return;
    
    const checkboxes = moduloDiv.querySelectorAll('.permiso-checkbox');
    
    // Determinar si marcar o desmarcar basado en si la mayoría está marcada
    const marcados = Array.from(checkboxes).filter(cb => cb.checked).length;
    const debenMarcarse = marcados < checkboxes.length / 2;
    
    checkboxes.forEach(checkbox => {
      checkbox.checked = debenMarcarse;
    });
    
    // Cambiar texto del botón
    const boton = moduloDiv.querySelector('.btn-select-all');
    if (boton) {
      boton.innerHTML = debenMarcarse ? 
        '<i class="fas fa-times-square"></i> Deseleccionar todos' : 
        '<i class="fas fa-check-square"></i> Seleccionar todos';
    }
  }
  
  /**
   * Verifica si un usuario tiene un permiso específico
   * @param {string} nombrePermiso - Nombre del permiso a verificar
   * @returns {boolean} - True si tiene permiso, false si no
   */
  static async tienePermiso(nombrePermiso) {
    try {
      const usuario = auth.getUsuarioActual();
      if (!usuario) return false;
      
      // El superadmin (id=1) siempre tiene todos los permisos
      if (usuario.id === 1) return true;
      
      const conn = await database.getConnection();
      
      // Consulta para verificar si el usuario tiene el permiso a través de su rol
      const query = `
        SELECT COUNT(*) as tiene
        FROM permisos p
        JOIN rol_permisos rp ON p.id = rp.permiso_id
        JOIN usuarios u ON u.rol_id = rp.rol_id
        WHERE p.nombre = ? AND u.id = ?
      `;
      
      const resultado = await conn.get(query, [nombrePermiso, usuario.id]);
      return resultado.tiene > 0;
    } catch (error) {
      logger.error('Error al verificar permiso', { permiso: nombrePermiso, error: error.message });
      return false;
    }
  }
  
  /**
   * Crea un nuevo permiso en el sistema
   * @param {Object} permiso - Datos del nuevo permiso
   * @returns {number} - ID del permiso creado
   */
  static async crearPermiso(permiso) {
    try {
      // Validar datos
      if (!permiso.nombre || !permiso.modulo || !permiso.descripcion) {
        throw new Error('Nombre, módulo y descripción son obligatorios');
      }
      
      // Normalizar nombre (sin espacios, minúsculas)
      permiso.nombre = permiso.nombre.toLowerCase().replace(/\s+/g, '_');
      
      const conn = await database.getConnection();
      
      // Verificar si ya existe
      const existente = await conn.get('SELECT id FROM permisos WHERE nombre = ?', [permiso.nombre]);
      if (existente) {
        throw new Error(`Ya existe un permiso con el nombre "${permiso.nombre}"`);
      }
      
      // Insertar permiso
      const resultado = await conn.run(
        'INSERT INTO permisos (nombre, modulo, descripcion) VALUES (?, ?, ?)',
        [permiso.nombre, permiso.modulo, permiso.descripcion]
      );
      
      const permisoId = resultado.lastID;
      
      // Registrar acción
      const usuario = auth.getUsuarioActual();
      logger.info('Permiso creado', { 
        permisoId, 
        nombre: permiso.nombre,
        usuario: usuario.username,
        usuarioId: usuario.id
      });
      
      return permisoId;
    } catch (error) {
      logger.error('Error al crear permiso', { error: error.message });
      throw error;
    }
  }
  
  /**
   * Elimina un permiso del sistema
   * @param {number} permisoId - ID del permiso a eliminar
   * @returns {boolean} - True si se eliminó correctamente
   */
  static async eliminarPermiso(permisoId) {
    try {
      const conn = await database.getConnection();
      
      // Verificar si es un permiso esencial
      const permiso = await conn.get('SELECT nombre FROM permisos WHERE id = ?', [permisoId]);
      if (!permiso) {
        throw new Error('El permiso no existe');
      }
      
      const permisosEsenciales = ['acceder_config', 'gestionar_usuarios', 'gestionar_permisos'];
      if (permisosEsenciales.includes(permiso.nombre)) {
        throw new Error('No se puede eliminar un permiso esencial del sistema');
      }
      
      // Eliminar permiso y sus asignaciones en una transacción
      await conn.run('BEGIN TRANSACTION');
      
      try {
        await conn.run('DELETE FROM rol_permisos WHERE permiso_id = ?', [permisoId]);
        await conn.run('DELETE FROM permisos WHERE id = ?', [permisoId]);
        
        await conn.run('COMMIT');
        
        // Registrar acción
        const usuario = auth.getUsuarioActual();
        logger.info('Permiso eliminado', { 
          permisoId, 
          nombre: permiso.nombre,
          usuario: usuario.username,
          usuarioId: usuario.id
        });
        
        return true;
      } catch (error) {
        await conn.run('ROLLBACK');
        throw error;
      }
    } catch (error) {
      logger.error('Error al eliminar permiso', { permisoId, error: error.message });
      throw error;
    }
  }
  
  /**
   * Obtiene el icono CSS correspondiente a un módulo
   * @param {string} modulo - Nombre del módulo
   * @returns {string} - Clase CSS del icono
   */
  getIconoModulo(modulo) {
    const iconos = {
      'facturador': 'fa-file-invoice',
      'ventas': 'fa-chart-line',
      'compras': 'fa-shopping-cart',
      'productos': 'fa-box',
      'caja': 'fa-cash-register',
      'clientes': 'fa-users',
      'proveedores': 'fa-truck',
      'usuarios': 'fa-user-cog',
      'cuotificador': 'fa-calculator',
      'configuraciones': 'fa-cogs',
      'reportes': 'fa-chart-bar',
      'documentos': 'fa-file-alt',
      'ayuda': 'fa-question-circle',
      'sucursales': 'fa-store',
      'sistema': 'fa-shield-alt'
    };
    
    return iconos[modulo] || 'fa-puzzle-piece';
  }
  
  /**
   * Formatea el nombre del módulo para mostrar
   * @param {string} modulo - Nombre del módulo
   * @returns {string} - Nombre formateado
   */
  formatearNombreModulo(modulo) {
    // Capitalizar primera letra y reemplazar guiones por espacios
    return modulo.charAt(0).toUpperCase() + modulo.slice(1).replace(/-/g, ' ');
  }
  
  /**
   * Genera todos los permisos iniciales para un sistema nuevo
   * @returns {boolean} - True si se crearon correctamente
   */
  static async generarPermisosIniciales() {
    try {
      const conn = await database.getConnection();
      
      // Verificar si ya existen permisos
      const permisosExistentes = await conn.get('SELECT COUNT(*) as total FROM permisos');
      if (permisosExistentes.total > 0) {
        return true; // Ya existen permisos, no hace falta crearlos
      }
      
      // Estructura de permisos iniciales
      const permisosIniciales = [
        // Permisos del sistema general
        { nombre: 'acceder_sistema', modulo: 'sistema', descripcion: 'Acceder al sistema' },
        { nombre: 'acceder_config', modulo: 'sistema', descripcion: 'Acceder a configuraciones' },
        
        // Usuarios
        { nombre: 'ver_usuarios', modulo: 'usuarios', descripcion: 'Ver lista de usuarios' },
        { nombre: 'crear_usuarios', modulo: 'usuarios', descripcion: 'Crear nuevos usuarios' },
        { nombre: 'editar_usuarios', modulo: 'usuarios', descripcion: 'Modificar usuarios existentes' },
        { nombre: 'eliminar_usuarios', modulo: 'usuarios', descripcion: 'Eliminar usuarios' },
        { nombre: 'gestionar_roles', modulo: 'usuarios', descripcion: 'Gestionar roles de usuarios' },
        { nombre: 'gestionar_permisos', modulo: 'usuarios', descripcion: 'Gestionar permisos de roles' },
        { nombre: 'ver_actividad', modulo: 'usuarios', descripcion: 'Ver registros de actividad' },
        
        // Facturador
        { nombre: 'crear_facturas', modulo: 'facturador', descripcion: 'Crear nuevas facturas' },
        { nombre: 'anular_facturas', modulo: 'facturador', descripcion: 'Anular facturas emitidas' },
        { nombre: 'modificar_precios', modulo: 'facturador', descripcion: 'Cambiar precios durante facturación' },
        { nombre: 'aplicar_descuentos', modulo: 'facturador', descripcion: 'Aplicar descuentos en facturas' },
        
        // Ventas
        { nombre: 'ver_ventas', modulo: 'ventas', descripcion: 'Ver historial de ventas' },
        { nombre: 'ver_estadisticas', modulo: 'ventas', descripcion: 'Ver estadísticas de ventas' },
        { nombre: 'exportar_ventas', modulo: 'ventas', descripcion: 'Exportar reportes de ventas' },
        
        // Productos
        { nombre: 'ver_productos', modulo: 'productos', descripcion: 'Ver catálogo de productos' },
        { nombre: 'crear_productos', modulo: 'productos', descripcion: 'Crear nuevos productos' },
        { nombre: 'editar_productos', modulo: 'productos', descripcion: 'Modificar productos existentes' },
        { nombre: 'eliminar_productos', modulo: 'productos', descripcion: 'Eliminar productos' },
        { nombre: 'importar_productos', modulo: 'productos', descripcion: 'Importar productos masivamente' },
        { nombre: 'generar_codigos', modulo: 'productos', descripcion: 'Generar códigos de barras' },
        { nombre: 'ajustar_stock', modulo: 'productos', descripcion: 'Realizar ajustes de inventario' },
        
        // Caja
        { nombre: 'abrir_caja', modulo: 'caja', descripcion: 'Abrir caja diaria' },
        { nombre: 'cerrar_caja', modulo: 'caja', descripcion: 'Cerrar caja diaria' },
        { nombre: 'registrar_movimientos', modulo: 'caja', descripcion: 'Registrar movimientos de caja' },
        { nombre: 'ver_movimientos', modulo: 'caja', descripcion: 'Ver todos los movimientos' },
        { nombre: 'exportar_caja', modulo: 'caja', descripcion: 'Exportar reportes de caja' },
        
        // Clientes
        { nombre: 'ver_clientes', modulo: 'clientes', descripcion: 'Ver lista de clientes' },
        { nombre: 'crear_clientes', modulo: 'clientes', descripcion: 'Crear nuevos clientes' },
        { nombre: 'editar_clientes', modulo: 'clientes', descripcion: 'Modificar clientes existentes' },
        { nombre: 'eliminar_clientes', modulo: 'clientes', descripcion: 'Eliminar clientes' },
        { nombre: 'ver_historial_cliente', modulo: 'clientes', descripcion: 'Ver historial de compras de clientes' },
        { nombre: 'gestionar_fidelizacion', modulo: 'clientes', descripcion: 'Administrar programa de fidelización' },
        
        // Proveedores
        { nombre: 'ver_proveedores', modulo: 'proveedores', descripcion: 'Ver lista de proveedores' },
        { nombre: 'crear_proveedores', modulo: 'proveedores', descripcion: 'Crear nuevos proveedores' },
        { nombre: 'editar_proveedores', modulo: 'proveedores', descripcion: 'Modificar proveedores existentes' },
        { nombre: 'eliminar_proveedores', modulo: 'proveedores', descripcion: 'Eliminar proveedores' },
        { nombre: 'ver_historial_proveedor', modulo: 'proveedores', descripcion: 'Ver historial de compras a proveedores' },
        
        // Compras
        { nombre: 'ver_compras', modulo: 'compras', descripcion: 'Ver historial de compras' },
        { nombre: 'registrar_compras', modulo: 'compras', descripcion: 'Registrar nuevas compras' },
        { nombre: 'modificar_compras', modulo: 'compras', descripcion: 'Modificar compras registradas' },
        { nombre: 'eliminar_compras', modulo: 'compras', descripcion: 'Eliminar compras' },
        { nombre: 'analizar_compras', modulo: 'compras', descripcion: 'Ver análisis de compras' },
        
        // Cuotificador
        { nombre: 'usar_cuotificador', modulo: 'cuotificador', descripcion: 'Usar calculadora de cuotas' },
        { nombre: 'configurar_tasas', modulo: 'cuotificador', descripcion: 'Configurar tasas de interés' },
        
        // Reportes
        { nombre: 'generar_reportes', modulo: 'reportes', descripcion: 'Generar cualquier tipo de reporte' },
        { nombre: 'exportar_reportes', modulo: 'reportes', descripcion: 'Exportar reportes a PDF/Excel' },
        { nombre: 'reportes_fiscales', modulo: 'reportes', descripcion: 'Generar reportes fiscales' },
        
        // Documentos
        { nombre: 'crear_remitos', modulo: 'documentos', descripcion: 'Crear remitos' },
        { nombre: 'crear_notas_credito', modulo: 'documentos', descripcion: 'Crear notas de crédito' },
        { nombre: 'crear_notas_debito', modulo: 'documentos', descripcion: 'Crear notas de débito' },
        { nombre: 'ver_documentos', modulo: 'documentos', descripcion: 'Ver todos los documentos' },
        
        // Configuraciones
        { nombre: 'config_empresa', modulo: 'configuraciones', descripcion: 'Configurar datos de la empresa' },
        { nombre: 'config_visual', modulo: 'configuraciones', descripcion: 'Personalizar apariencia' },
        { nombre: 'config_impresion', modulo: 'configuraciones', descripcion: 'Configurar opciones de impresión' },
        { nombre: 'config_backups', modulo: 'configuraciones', descripcion: 'Gestionar copias de seguridad' },
        { nombre: 'config_seguridad', modulo: 'configuraciones', descripcion: 'Configurar opciones de seguridad' },
        
        // Integraciones
        { nombre: 'config_mercadopago', modulo: 'configuraciones', descripcion: 'Configurar Mercado Pago' },
        { nombre: 'config_arca', modulo: 'configuraciones', descripcion: 'Configurar ARCA (AFIP)' },
        { nombre: 'config_whatsapp', modulo: 'configuraciones', descripcion: 'Configurar WhatsApp' },
        { nombre: 'config_email', modulo: 'configuraciones', descripcion: 'Configurar Email' },
        { nombre: 'config_bancos', modulo: 'configuraciones', descripcion: 'Configurar integraciones bancarias' },
        
        // Sucursales
        { nombre: 'ver_sucursales', modulo: 'sucursales', descripcion: 'Ver todas las sucursales' },
        { nombre: 'crear_sucursales', modulo: 'sucursales', descripcion: 'Crear nuevas sucursales' },
        { nombre: 'editar_sucursales', modulo: 'sucursales', descripcion: 'Modificar sucursales existentes' },
        { nombre: 'eliminar_sucursales', modulo: 'sucursales', descripcion: 'Eliminar sucursales' },
        { nombre: 'config_sincronizacion', modulo: 'sucursales', descripcion: 'Configurar sincronización entre sucursales' }
      ];
      
      // Insertar permisos iniciales en una transacción
      await conn.run('BEGIN TRANSACTION');
      
      try {
        const stmt = await conn.prepare('INSERT INTO permisos (nombre, modulo, descripcion) VALUES (?, ?, ?)');
        
        for (const permiso of permisosIniciales) {
          await stmt.run(permiso.nombre, permiso.modulo, permiso.descripcion);
        }
        
        await stmt.finalize();
        
        // Crear roles básicos
        await conn.run('INSERT INTO roles (nombre, descripcion) VALUES (?, ?)', 
          ['Administrador', 'Control total del sistema']);
        
        await conn.run('INSERT INTO roles (nombre, descripcion) VALUES (?, ?)', 
          ['Vendedor', 'Acceso a facturación y atención al cliente']);
        
        await conn.run('INSERT INTO roles (nombre, descripcion) VALUES (?, ?)', 
          ['Supervisor', 'Gestión de ventas y empleados']);
        
        await conn.run('INSERT INTO roles (nombre, descripcion) VALUES (?, ?)', 
          ['Almacén', 'Gestión de inventario y proveedores']);
        
        // Obtener todos los permisos insertados
        const permisos = await conn.all('SELECT id FROM permisos');
        
        // Asignar todos los permisos al rol Administrador (id=1)
        for (const permiso of permisos) {
          await conn.run('INSERT INTO rol_permisos (rol_id, permiso_id) VALUES (?, ?)', [1, permiso.id]);
        }
        
        // Asignar permisos básicos al rol Vendedor (id=2)
        const permisosVendedor = [
          'acceder_sistema', 'ver_productos', 'crear_facturas', 'aplicar_descuentos',
          'ver_clientes', 'crear_clientes', 'ver_ventas', 'abrir_caja', 'cerrar_caja',
          'usar_cuotificador', 'crear_remitos'
        ];
        
        for (const nombrePermiso of permisosVendedor) {
          const permiso = await conn.get('SELECT id FROM permisos WHERE nombre = ?', [nombrePermiso]);
          if (permiso) {
            await conn.run('INSERT INTO rol_permisos (rol_id, permiso_id) VALUES (?, ?)', [2, permiso.id]);
          }
        }
        
        await conn.run('COMMIT');
        
        logger.info('Permisos iniciales creados correctamente');
        return true;
      } catch (error) {
        await conn.run('ROLLBACK');
        logger.error('Error al crear permisos iniciales', { error: error.message });
        throw error;
      }
    } catch (error) {
      logger.error('Error al generar permisos iniciales', { error: error.message });
      throw error;
    }
  }
  
  /**
   * Crea una copia de permisos de un rol a otro
   * @param {number} rolOrigenId - ID del rol origen
   * @param {number} rolDestinoId - ID del rol destino
   * @returns {boolean} - True si se copió correctamente
   */
  static async copiarPermisosRol(rolOrigenId, rolDestinoId) {
    try {
      if (rolOrigenId === rolDestinoId) {
        throw new Error('No se puede copiar permisos al mismo rol');
      }
      
      const conn = await database.getConnection();
      
      // Verificar que ambos roles existan
      const roles = await conn.all('SELECT id FROM roles WHERE id IN (?, ?)', [rolOrigenId, rolDestinoId]);
      if (roles.length !== 2) {
        throw new Error('Alguno de los roles no existe');
      }
      
      // Realizar la copia en una transacción
      await conn.run('BEGIN TRANSACTION');
      
      try {
        // Primero eliminamos los permisos actuales del rol destino
        await conn.run('DELETE FROM rol_permisos WHERE rol_id = ?', [rolDestinoId]);
        
        // Luego copiamos los permisos del rol origen al destino
        const permisosOrigen = await conn.all('SELECT permiso_id FROM rol_permisos WHERE rol_id = ?', [rolOrigenId]);
        
        const stmt = await conn.prepare('INSERT INTO rol_permisos (rol_id, permiso_id) VALUES (?, ?)');
        
        for (const permiso of permisosOrigen) {
          await stmt.run(rolDestinoId, permiso.permiso_id);
        }
        
        await stmt.finalize();
        await conn.run('COMMIT');
        
        // Registrar acción
        const usuario = auth.getUsuarioActual();
        logger.info('Permisos copiados entre roles', { 
          rolOrigenId, 
          rolDestinoId,
          cantidadPermisos: permisosOrigen.length,
          usuario: usuario.username,
          usuarioId: usuario.id
        });
        
        // Forzar refresco de permisos en memoria para todos los usuarios activos
        ipcRenderer.send('permisos:actualizar');
        
        return true;
      } catch (error) {
        await conn.run('ROLLBACK');
        throw error;
      }
    } catch (error) {
      logger.error('Error al copiar permisos entre roles', { rolOrigenId, rolDestinoId, error: error.message });
      throw error;
    }
  }
  
  /**
   * Verifica si un usuario tiene todos los permisos especificados
   * @param {Array<string>} nombresPermisos - Lista de nombres de permisos a verificar
   * @returns {boolean} - True si tiene todos los permisos, false si no
   */
  static async tieneTodosLosPermisos(nombresPermisos) {
    try {
      const usuario = auth.getUsuarioActual();
      if (!usuario) return false;
      
      // El superadmin (id=1) siempre tiene todos los permisos
      if (usuario.id === 1) return true;
      
      const conn = await database.getConnection();
      
      // Para cada permiso, verificar si lo tiene
      for (const nombrePermiso of nombresPermisos) {
        const query = `
          SELECT COUNT(*) as tiene
          FROM permisos p
          JOIN rol_permisos rp ON p.id = rp.permiso_id
          JOIN usuarios u ON u.rol_id = rp.rol_id
          WHERE p.nombre = ? AND u.id = ?
        `;
        
        const resultado = await conn.get(query, [nombrePermiso, usuario.id]);
        if (resultado.tiene === 0) {
          return false; // Si no tiene uno solo, retorna false
        }
      }
      
      // Si llegó hasta aquí, tiene todos los permisos
      return true;
    } catch (error) {
      logger.error('Error al verificar permisos múltiples', { permisos: nombresPermisos, error: error.message });
      return false;
    }
  }
  
  /**
   * Verifica si un usuario tiene al menos uno de los permisos especificados
   * @param {Array<string>} nombresPermisos - Lista de nombres de permisos a verificar
   * @returns {boolean} - True si tiene al menos uno de los permisos, false si no
   */
  static async tieneAlgunPermiso(nombresPermisos) {
    try {
      const usuario = auth.getUsuarioActual();
      if (!usuario) return false;
      
      // El superadmin (id=1) siempre tiene todos los permisos
      if (usuario.id === 1) return true;
      
      const conn = await database.getConnection();
      
      // Consulta para verificar si tiene alguno de los permisos
      const placeholders = nombresPermisos.map(() => '?').join(',');
      const query = `
        SELECT COUNT(*) as tiene
        FROM permisos p
        JOIN rol_permisos rp ON p.id = rp.permiso_id
        JOIN usuarios u ON u.rol_id = rp.rol_id
        WHERE p.nombre IN (${placeholders}) AND u.id = ?
      `;
      
      const params = [...nombresPermisos, usuario.id];
      const resultado = await conn.get(query, params);
      
      return resultado.tiene > 0;
    } catch (error) {
      logger.error('Error al verificar permisos alternativos', { permisos: nombresPermisos, error: error.message });
      return false;
    }
  }
  
  /**
   * Obtiene todos los permisos asignados a un usuario específico
   * @param {number} usuarioId - ID del usuario
   * @returns {Array<Object>} - Lista de permisos asignados
   */
  static async obtenerPermisosUsuario(usuarioId) {
    try {
      const conn = await database.getConnection();
      
      const query = `
        SELECT p.id, p.nombre, p.modulo, p.descripcion
        FROM permisos p
        JOIN rol_permisos rp ON p.id = rp.permiso_id
        JOIN usuarios u ON u.rol_id = rp.rol_id
        WHERE u.id = ?
        ORDER BY p.modulo, p.nombre
      `;
      
      const permisos = await conn.all(query, [usuarioId]);
      return permisos;
    } catch (error) {
      logger.error('Error al obtener permisos de usuario', { usuarioId, error: error.message });
      throw error;
    }
  }
  
  /**
   * Actualiza la seguridad de los elementos de la UI según los permisos del usuario
   * Oculta elementos para los que el usuario no tiene permiso
   */
  static async actualizarUISegunPermisos() {
    try {
      // Elementos con atributos data-permiso
      document.querySelectorAll('[data-permiso]').forEach(async (elemento) => {
        const permiso = elemento.dataset.permiso;
        
        if (permiso) {
          const tienePermiso = await PermisosManager.tienePermiso(permiso);
          
          if (!tienePermiso) {
            // Si no tiene permiso, ocultar el elemento
            elemento.style.display = 'none';
            
            // Si es un enlace o botón, deshabilitarlo también
            if (elemento.tagName === 'A' || elemento.tagName === 'BUTTON') {
              elemento.setAttribute('disabled', 'disabled');
              elemento.style.pointerEvents = 'none';
              elemento.style.opacity = '0.5';
            }
          } else {
            // Si tiene permiso, asegurarse de que sea visible
            elemento.style.display = '';
            
            // Habilitar si es enlace o botón
            if (elemento.tagName === 'A' || elemento.tagName === 'BUTTON') {
              elemento.removeAttribute('disabled');
              elemento.style.pointerEvents = '';
              elemento.style.opacity = '';
            }
          }
        }
      });
      
      // Elementos que requieren todos los permisos especificados
      document.querySelectorAll('[data-permiso-todos]').forEach(async (elemento) => {
        const permisos = elemento.dataset.permisoTodos.split(',');
        
        if (permisos.length > 0) {
          const tienePermisos = await PermisosManager.tieneTodosLosPermisos(permisos);
          
          if (!tienePermisos) {
            elemento.style.display = 'none';
            
            if (elemento.tagName === 'A' || elemento.tagName === 'BUTTON') {
              elemento.setAttribute('disabled', 'disabled');
              elemento.style.pointerEvents = 'none';
            }
          } else {
            elemento.style.display = '';
            
            if (elemento.tagName === 'A' || elemento.tagName === 'BUTTON') {
              elemento.removeAttribute('disabled');
              elemento.style.pointerEvents = '';
            }
          }
        }
      });
      
      // Elementos que requieren al menos uno de los permisos especificados
      document.querySelectorAll('[data-permiso-alguno]').forEach(async (elemento) => {
        const permisos = elemento.dataset.permisoAlguno.split(',');
        
        if (permisos.length > 0) {
          const tieneAlgunPermiso = await PermisosManager.tieneAlgunPermiso(permisos);
          
          if (!tieneAlgunPermiso) {
            elemento.style.display = 'none';
            
            if (elemento.tagName === 'A' || elemento.tagName === 'BUTTON') {
              elemento.setAttribute('disabled', 'disabled');
              elemento.style.pointerEvents = 'none';
            }
          } else {
            elemento.style.display = '';
            
            if (elemento.tagName === 'A' || elemento.tagName === 'BUTTON') {
              elemento.removeAttribute('disabled');
              elemento.style.pointerEvents = '';
            }
          }
        }
      });
    } catch (error) {
      logger.error('Error al actualizar UI según permisos', { error: error.message });
    }
  }
}

// Exportar la clase para su uso en otros módulos
module.exports = PermisosManager;

// Iniciar la actualización de UI cuando el documento está listo
document.addEventListener('DOMContentLoaded', () => {
  // Actualizar UI según permisos cuando se carga la página
  PermisosManager.actualizarUISegunPermisos();
  
  // Si estamos en la vista de administración de permisos, inicializar el gestor
  if (document.getElementById('permisos-container')) {
    // Inicializar cuando el DOM está listo
    const permisosManager = new PermisosManager();
  }
});

// Actualizar permisos cuando se recibe mensaje del proceso principal
ipcRenderer.on('permisos:actualizar', () => {
  PermisosManager.actualizarUISegunPermisos();
});