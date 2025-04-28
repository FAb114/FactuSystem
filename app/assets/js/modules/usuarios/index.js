/**
 * Módulo de Gestión de Usuarios
 * 
 * Este módulo maneja toda la lógica relacionada con usuarios:
 * - Listado de usuarios
 * - Alta, baja y modificación de usuarios
 * - Actividad de usuarios
 * - Permisos y roles
 * - Cambio de contraseñas
 * - Bloqueo/desbloqueo de cuentas
 * 
 * @module modules/usuarios/index
 */

// Importación de dependencias y utilidades
import { Database } from '../../utils/database.js';
import { Auth } from '../../utils/auth.js';
import { Logger } from '../../utils/logger.js';
import { Validation } from '../../utils/validation.js';
import { Notifications } from '../../components/notifications.js';

// Importación de submódulos específicos
import { RolesManager } from './roles.js';
import { PermisosManager } from './permisos.js';
import { ActividadManager } from './actividad.js';

/**
 * Clase principal para la gestión de usuarios
 */
class UsuariosManager {
    /**
     * Constructor de la clase
     */
    constructor() {
        // Inicialización de propiedades
        this.db = new Database();
        this.auth = new Auth();
        this.logger = new Logger();
        this.validation = new Validation();
        this.notifications = new Notifications();
        
        // Inicialización de submódulos
        this.rolesManager = new RolesManager();
        this.permisosManager = new PermisosManager();
        this.actividadManager = new ActividadManager();
        
        // Estado interno
        this.usuarioActual = null;
        this.usuariosLista = [];
        this.filtrosActivos = {
            rol: 'todos',
            estado: 'todos',
            sucursal: 'todas'
        };
        
        // Referencias a elementos DOM
        this.elements = {
            userTable: document.getElementById('usuarios-table'),
            userForm: document.getElementById('usuario-form'),
            searchInput: document.getElementById('usuarios-search'),
            filterRol: document.getElementById('filter-rol'),
            filterEstado: document.getElementById('filter-estado'),
            filterSucursal: document.getElementById('filter-sucursal'),
            btnNuevoUsuario: document.getElementById('btn-nuevo-usuario'),
            modalUsuario: document.getElementById('modal-usuario'),
            modalCambioPassword: document.getElementById('modal-cambio-password'),
            usuarioDetalle: document.getElementById('usuario-detalle'),
            tabActividad: document.getElementById('tab-actividad'),
        };
        
        // Inicialización
        this.init();
    }
    
    /**
     * Inicializa el módulo
     */
    async init() {
        try {
            // Verifica permisos del usuario actual
            const tienePermiso = await this.auth.verificarPermiso('usuarios.ver');
            if (!tienePermiso) {
                this.notifications.showError('No tienes permisos para acceder a este módulo');
                window.location.href = '../dashboard/index.html';
                return;
            }
            
            // Cargar datos iniciales
            await this.cargarDatos();
            
            // Configurar eventos
            this.configurarEventos();
            
            // Inicializar componentes UI
            this.initUI();
            
            // Registrar esta actividad en el log
            this.logger.registrarActividad('usuarios', 'acceso', 'Acceso al módulo de usuarios');
            
        } catch (error) {
            console.error('Error al inicializar el módulo de usuarios:', error);
            this.notifications.showError('Error al cargar el módulo de usuarios');
        }
    }
    
    /**
     * Carga todos los datos necesarios para el módulo
     */
    async cargarDatos() {
        try {
            // Obtener todos los usuarios
            this.usuariosLista = await this.db.query('SELECT u.id, u.username, u.nombre, u.apellido, u.email, ' +
                'u.estado, u.ultimo_acceso, u.fecha_creacion, r.nombre as rol_nombre, ' +
                's.nombre as sucursal_nombre ' +
                'FROM usuarios u ' +
                'LEFT JOIN roles r ON u.rol_id = r.id ' +
                'LEFT JOIN sucursales s ON u.sucursal_id = s.id ' +
                'ORDER BY u.nombre ASC');
            
            // Cargar roles y sucursales para filtros
            const roles = await this.rolesManager.obtenerTodosRoles();
            const sucursales = await this.db.query('SELECT id, nombre FROM sucursales ORDER BY nombre ASC');
            
            // Renderizar datos iniciales
            this.renderizarTablaUsuarios();
            this.popularFiltros(roles, sucursales);
            
        } catch (error) {
            console.error('Error al cargar datos de usuarios:', error);
            throw new Error('No se pudieron cargar los datos de usuarios');
        }
    }
    
    /**
     * Configura los eventos para los elementos de la interfaz
     */
    configurarEventos() {
        // Eventos para filtros
        this.elements.searchInput.addEventListener('input', this.filtrarUsuarios.bind(this));
        this.elements.filterRol.addEventListener('change', this.filtrarUsuarios.bind(this));
        this.elements.filterEstado.addEventListener('change', this.filtrarUsuarios.bind(this));
        this.elements.filterSucursal.addEventListener('change', this.filtrarUsuarios.bind(this));
        
        // Eventos para acciones de usuario
        this.elements.btnNuevoUsuario.addEventListener('click', this.mostrarFormularioNuevoUsuario.bind(this));
        this.elements.userForm.addEventListener('submit', this.guardarUsuario.bind(this));
        
        // Delegación de eventos para botones en tabla (editar, eliminar, etc.)
        this.elements.userTable.addEventListener('click', this.handleTableActions.bind(this));
        
        // Eventos para modales
        document.getElementById('btn-cerrar-modal-usuario').addEventListener('click', () => {
            this.elements.modalUsuario.classList.add('hidden');
        });
        
        document.getElementById('btn-cerrar-modal-password').addEventListener('click', () => {
            this.elements.modalCambioPassword.classList.add('hidden');
        });
        
        // Evento para cambio de contraseña
        document.getElementById('form-cambio-password').addEventListener('submit', this.cambiarPassword.bind(this));
        
        // Eventos para pestañas de detalle de usuario
        this.elements.tabActividad.addEventListener('click', () => {
            if (this.usuarioActual) {
                this.actividadManager.cargarActividadUsuario(this.usuarioActual.id);
            }
        });
    }
    
    /**
     * Inicializa componentes UI adicionales
     */
    initUI() {
        // Inicializar cualquier componente UI que necesite configuración adicional
        // Por ejemplo, selectores personalizados, tooltips, etc.
    }
    
    /**
     * Rellena los selectores de filtros con datos
     */
    popularFiltros(roles, sucursales) {
        // Poblar filtro de roles
        this.elements.filterRol.innerHTML = '<option value="todos">Todos los roles</option>';
        roles.forEach(rol => {
            this.elements.filterRol.innerHTML += `<option value="${rol.id}">${rol.nombre}</option>`;
        });
        
        // Poblar filtro de sucursales
        this.elements.filterSucursal.innerHTML = '<option value="todas">Todas las sucursales</option>';
        sucursales.forEach(sucursal => {
            this.elements.filterSucursal.innerHTML += `<option value="${sucursal.id}">${sucursal.nombre}</option>`;
        });
    }
    
    /**
     * Renderiza la tabla de usuarios con los datos actuales
     */
    renderizarTablaUsuarios() {
        // Limpiar tabla actual
        const tbody = this.elements.userTable.querySelector('tbody');
        tbody.innerHTML = '';
        
        // Si no hay usuarios después de aplicar filtros
        if (this.usuariosLista.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="text-center py-4">No se encontraron usuarios</td>
                </tr>
            `;
            return;
        }
        
        // Agregar cada usuario a la tabla
        this.usuariosLista.forEach(usuario => {
            const estadoClass = usuario.estado === 'activo' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800';
            
            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="px-4 py-2">${usuario.username}</td>
                <td class="px-4 py-2">${usuario.nombre} ${usuario.apellido}</td>
                <td class="px-4 py-2">${usuario.email}</td>
                <td class="px-4 py-2">${usuario.rol_nombre}</td>
                <td class="px-4 py-2">${usuario.sucursal_nombre || 'No asignada'}</td>
                <td class="px-4 py-2">
                    <span class="px-2 py-1 rounded-full text-xs font-semibold ${estadoClass}">
                        ${usuario.estado === 'activo' ? 'Activo' : 'Bloqueado'}
                    </span>
                </td>
                <td class="px-4 py-2">
                    <div class="flex space-x-2">
                        <button 
                            class="btn-ver text-blue-600 hover:text-blue-800" 
                            data-id="${usuario.id}" 
                            title="Ver detalles">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button 
                            class="btn-editar text-green-600 hover:text-green-800" 
                            data-id="${usuario.id}" 
                            title="Editar usuario">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button 
                            class="btn-password text-yellow-600 hover:text-yellow-800" 
                            data-id="${usuario.id}" 
                            title="Cambiar contraseña">
                            <i class="fas fa-key"></i>
                        </button>
                        <button 
                            class="btn-toggle-estado ${usuario.estado === 'activo' ? 'text-red-600 hover:text-red-800' : 'text-green-600 hover:text-green-800'}" 
                            data-id="${usuario.id}" 
                            data-estado="${usuario.estado}"
                            title="${usuario.estado === 'activo' ? 'Bloquear usuario' : 'Activar usuario'}">
                            <i class="fas fa-${usuario.estado === 'activo' ? 'lock' : 'unlock'}"></i>
                        </button>
                        <button 
                            class="btn-eliminar text-red-600 hover:text-red-800" 
                            data-id="${usuario.id}" 
                            title="Eliminar usuario">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(row);
        });
    }
    
    /**
     * Maneja las acciones en los botones de la tabla de usuarios
     */
    async handleTableActions(event) {
        const target = event.target.closest('button');
        if (!target) return;
        
        const userId = target.dataset.id;
        
        // Verificar qué botón se presionó
        if (target.classList.contains('btn-ver')) {
            await this.mostrarDetalleUsuario(userId);
        } else if (target.classList.contains('btn-editar')) {
            await this.mostrarFormularioEditarUsuario(userId);
        } else if (target.classList.contains('btn-password')) {
            this.mostrarFormularioCambioPassword(userId);
        } else if (target.classList.contains('btn-toggle-estado')) {
            const estado = target.dataset.estado;
            await this.cambiarEstadoUsuario(userId, estado === 'activo' ? 'bloqueado' : 'activo');
        } else if (target.classList.contains('btn-eliminar')) {
            await this.confirmarEliminarUsuario(userId);
        }
    }
    
    /**
     * Filtra la lista de usuarios según los criterios seleccionados
     */
    async filtrarUsuarios() {
        try {
            const searchTerm = this.elements.searchInput.value.toLowerCase();
            const rolFilter = this.elements.filterRol.value;
            const estadoFilter = this.elements.filterEstado.value;
            const sucursalFilter = this.elements.filterSucursal.value;
            
            // Construir la consulta SQL con los filtros
            let query = 'SELECT u.id, u.username, u.nombre, u.apellido, u.email, ' +
                'u.estado, u.ultimo_acceso, u.fecha_creacion, r.nombre as rol_nombre, ' +
                's.nombre as sucursal_nombre ' +
                'FROM usuarios u ' +
                'LEFT JOIN roles r ON u.rol_id = r.id ' +
                'LEFT JOIN sucursales s ON u.sucursal_id = s.id ' +
                'WHERE 1=1';
            
            const params = [];
            
            // Filtro de búsqueda por texto
            if (searchTerm) {
                query += ' AND (LOWER(u.nombre) LIKE ? OR LOWER(u.apellido) LIKE ? OR LOWER(u.email) LIKE ? OR LOWER(u.username) LIKE ?)';
                const searchParam = `%${searchTerm}%`;
                params.push(searchParam, searchParam, searchParam, searchParam);
            }
            
            // Filtro por rol
            if (rolFilter !== 'todos') {
                query += ' AND u.rol_id = ?';
                params.push(rolFilter);
            }
            
            // Filtro por estado
            if (estadoFilter !== 'todos') {
                query += ' AND u.estado = ?';
                params.push(estadoFilter);
            }
            
            // Filtro por sucursal
            if (sucursalFilter !== 'todas') {
                query += ' AND u.sucursal_id = ?';
                params.push(sucursalFilter);
            }
            
            query += ' ORDER BY u.nombre ASC';
            
            // Ejecutar consulta
            this.usuariosLista = await this.db.query(query, params);
            
            // Actualizar tabla
            this.renderizarTablaUsuarios();
            
        } catch (error) {
            console.error('Error al filtrar usuarios:', error);
            this.notifications.showError('Error al aplicar filtros');
        }
    }
    
    /**
     * Muestra el formulario para crear un nuevo usuario
     */
    async mostrarFormularioNuevoUsuario() {
        try {
            // Verificar permisos
            const tienePermiso = await this.auth.verificarPermiso('usuarios.crear');
            if (!tienePermiso) {
                this.notifications.showError('No tienes permisos para crear usuarios');
                return;
            }
            
            // Limpiar formulario
            this.elements.userForm.reset();
            document.getElementById('usuario-id').value = '';
            document.getElementById('form-title').textContent = 'Crear Nuevo Usuario';
            
            // Cargar roles y sucursales para el formulario
            const roles = await this.rolesManager.obtenerTodosRoles();
            const sucursales = await this.db.query('SELECT id, nombre FROM sucursales ORDER BY nombre ASC');
            
            // Poblar select de roles
            const selectRol = document.getElementById('usuario-rol');
            selectRol.innerHTML = '<option value="">Seleccione un rol</option>';
            roles.forEach(rol => {
                selectRol.innerHTML += `<option value="${rol.id}">${rol.nombre}</option>`;
            });
            
            // Poblar select de sucursales
            const selectSucursal = document.getElementById('usuario-sucursal');
            selectSucursal.innerHTML = '<option value="">Seleccione una sucursal</option>';
            sucursales.forEach(sucursal => {
                selectSucursal.innerHTML += `<option value="${sucursal.id}">${sucursal.nombre}</option>`;
            });
            
            // Mostrar/ocultar campos relevantes
            document.getElementById('password-group').classList.remove('hidden');
            document.getElementById('confirm-password-group').classList.remove('hidden');
            
            // Mostrar modal
            this.elements.modalUsuario.classList.remove('hidden');
            
        } catch (error) {
            console.error('Error al preparar formulario de nuevo usuario:', error);
            this.notifications.showError('Error al abrir el formulario de usuario');
        }
    }
    
    /**
     * Muestra el formulario para editar un usuario existente
     */
    async mostrarFormularioEditarUsuario(userId) {
        try {
            // Verificar permisos
            const tienePermiso = await this.auth.verificarPermiso('usuarios.editar');
            if (!tienePermiso) {
                this.notifications.showError('No tienes permisos para editar usuarios');
                return;
            }
            
            // Obtener datos del usuario
            const usuario = await this.db.queryOne('SELECT * FROM usuarios WHERE id = ?', [userId]);
            if (!usuario) {
                this.notifications.showError('Usuario no encontrado');
                return;
            }
            
            // Cargar roles y sucursales para el formulario
            const roles = await this.rolesManager.obtenerTodosRoles();
            const sucursales = await this.db.query('SELECT id, nombre FROM sucursales ORDER BY nombre ASC');
            
            // Poblar select de roles
            const selectRol = document.getElementById('usuario-rol');
            selectRol.innerHTML = '<option value="">Seleccione un rol</option>';
            roles.forEach(rol => {
                selectRol.innerHTML += `<option value="${rol.id}" ${usuario.rol_id === rol.id ? 'selected' : ''}>${rol.nombre}</option>`;
            });
            
            // Poblar select de sucursales
            const selectSucursal = document.getElementById('usuario-sucursal');
            selectSucursal.innerHTML = '<option value="">Seleccione una sucursal</option>';
            sucursales.forEach(sucursal => {
                selectSucursal.innerHTML += `<option value="${sucursal.id}" ${usuario.sucursal_id === sucursal.id ? 'selected' : ''}>${sucursal.nombre}</option>`;
            });
            
            // Rellenar formulario con datos del usuario
            document.getElementById('usuario-id').value = usuario.id;
            document.getElementById('usuario-username').value = usuario.username;
            document.getElementById('usuario-nombre').value = usuario.nombre;
            document.getElementById('usuario-apellido').value = usuario.apellido;
            document.getElementById('usuario-email').value = usuario.email;
            
            // Ocultar campos de contraseña en modo edición
            document.getElementById('password-group').classList.add('hidden');
            document.getElementById('confirm-password-group').classList.add('hidden');
            
            // Actualizar título
            document.getElementById('form-title').textContent = 'Editar Usuario';
            
            // Mostrar modal
            this.elements.modalUsuario.classList.remove('hidden');
            
        } catch (error) {
            console.error('Error al preparar formulario de edición:', error);
            this.notifications.showError('Error al cargar datos del usuario');
        }
    }
    
    /**
     * Guarda los datos del usuario (creación o edición)
     */
    async guardarUsuario(event) {
        event.preventDefault();
        
        try {
            const formData = new FormData(this.elements.userForm);
            const userId = formData.get('id');
            const isNew = !userId;
            
            // Validar datos
            const username = formData.get('username');
            const nombre = formData.get('nombre');
            const apellido = formData.get('apellido');
            const email = formData.get('email');
            const rolId = formData.get('rol_id');
            
            if (!this.validation.validarCamposObligatorios([
                { value: username, name: 'Usuario' },
                { value: nombre, name: 'Nombre' },
                { value: apellido, name: 'Apellido' },
                { value: email, name: 'Email' },
                { value: rolId, name: 'Rol' }
            ])) {
                return;
            }
            
            // Validar email
            if (!this.validation.validarEmail(email)) {
                this.notifications.showError('El email ingresado no es válido');
                return;
            }
            
            // Si es nuevo usuario, validar contraseña
            if (isNew) {
                const password = formData.get('password');
                const confirmPassword = formData.get('confirm_password');
                
                if (!password) {
                    this.notifications.showError('La contraseña es obligatoria');
                    return;
                }
                
                if (password !== confirmPassword) {
                    this.notifications.showError('Las contraseñas no coinciden');
                    return;
                }
                
                if (!this.validation.validarFortalezaPassword(password)) {
                    this.notifications.showError('La contraseña debe tener al menos 8 caracteres, incluir una mayúscula, una minúscula y un número');
                    return;
                }
            }
            
            // Verificar si el username está disponible
            const existeUsername = await this.db.queryOne(
                'SELECT id FROM usuarios WHERE username = ? AND id != ?',
                [username, userId || 0]
            );
            
            if (existeUsername) {
                this.notifications.showError('El nombre de usuario ya está en uso');
                return;
            }
            
            // Verificar si el email está disponible
            const existeEmail = await this.db.queryOne(
                'SELECT id FROM usuarios WHERE email = ? AND id != ?',
                [email, userId || 0]
            );
            
            if (existeEmail) {
                this.notifications.showError('El email ya está registrado para otro usuario');
                return;
            }
            
            // Preparar objeto de usuario
            const usuarioData = {
                username,
                nombre,
                apellido,
                email,
                rol_id: rolId,
                sucursal_id: formData.get('sucursal_id') || null
            };
            
            // Si es nuevo usuario, agregar contraseña y estado
            if (isNew) {
                // Hash de la contraseña
                usuarioData.password = await this.auth.hashPassword(formData.get('password'));
                usuarioData.estado = 'activo';
                usuarioData.fecha_creacion = new Date().toISOString();
            }
            
            // Guardar en la base de datos
            if (isNew) {
                await this.db.insert('usuarios', usuarioData);
                this.logger.registrarActividad('usuarios', 'crear', `Usuario creado: ${username}`);
                this.notifications.showSuccess('Usuario creado exitosamente');
            } else {
                await this.db.update('usuarios', usuarioData, { id: userId });
                this.logger.registrarActividad('usuarios', 'editar', `Usuario actualizado: ${username}`);
                this.notifications.showSuccess('Usuario actualizado exitosamente');
            }
            
            // Cerrar modal y recargar datos
            this.elements.modalUsuario.classList.add('hidden');
            await this.cargarDatos();
            
        } catch (error) {
            console.error('Error al guardar usuario:', error);
            this.notifications.showError('Error al guardar los datos del usuario');
        }
    }
    
    /**
     * Muestra el formulario para cambiar la contraseña de un usuario
     */
    mostrarFormularioCambioPassword(userId) {
        // Verificar permisos
        this.auth.verificarPermiso('usuarios.cambiarPassword').then(tienePermiso => {
            if (!tienePermiso) {
                this.notifications.showError('No tienes permisos para cambiar contraseñas');
                return;
            }
            
            // Establecer el ID de usuario
            document.getElementById('password-usuario-id').value = userId;
            
            // Limpiar campos de contraseña
            document.getElementById('new-password').value = '';
            document.getElementById('confirm-new-password').value = '';
            
            // Mostrar modal
            this.elements.modalCambioPassword.classList.remove('hidden');
        });
    }
    
    /**
     * Cambia la contraseña de un usuario
     */
    async cambiarPassword(event) {
        event.preventDefault();
        
        try {
            const userId = document.getElementById('password-usuario-id').value;
            const newPassword = document.getElementById('new-password').value;
            const confirmPassword = document.getElementById('confirm-new-password').value;
            
            // Validaciones
            if (!newPassword) {
                this.notifications.showError('La nueva contraseña es obligatoria');
                return;
            }
            
            if (newPassword !== confirmPassword) {
                this.notifications.showError('Las contraseñas no coinciden');
                return;
            }
            
            if (!this.validation.validarFortalezaPassword(newPassword)) {
                this.notifications.showError('La contraseña debe tener al menos 8 caracteres, incluir una mayúscula, una minúscula y un número');
                return;
            }
            
            // Obtener usuario para registro de actividad
            const usuario = await this.db.queryOne('SELECT username FROM usuarios WHERE id = ?', [userId]);
            
            // Hash de la nueva contraseña
            const passwordHash = await this.auth.hashPassword(newPassword);
            
            // Actualizar contraseña en la base de datos
            await this.db.update('usuarios', { password: passwordHash }, { id: userId });
            
            // Registrar actividad
            this.logger.registrarActividad('usuarios', 'cambiarPassword', `Contraseña cambiada para: ${usuario.username}`);
            
            // Notificar y cerrar modal
            this.notifications.showSuccess('Contraseña actualizada exitosamente');
            this.elements.modalCambioPassword.classList.add('hidden');
            
        } catch (error) {
            console.error('Error al cambiar contraseña:', error);
            this.notifications.showError('Error al actualizar la contraseña');
        }
    }
    
    /**
     * Cambia el estado de un usuario (activo/bloqueado)
     */
    async cambiarEstadoUsuario(userId, nuevoEstado) {
        try {
            // Verificar permisos
            const tienePermiso = await this.auth.verificarPermiso('usuarios.bloquear');
            if (!tienePermiso) {
                this.notifications.showError('No tienes permisos para cambiar el estado de usuarios');
                return;
            }
            
            // Verificar que no sea el usuario actual
            const usuarioActual = await this.auth.obtenerUsuarioActual();
            if (userId === usuarioActual.id) {
                this.notifications.showError('No puedes bloquear tu propio usuario');
                return;
            }
            
            // Obtener usuario para registro de actividad
            const usuario = await this.db.queryOne('SELECT username FROM usuarios WHERE id = ?', [userId]);
            
            // Actualizar estado en la base de datos
            await this.db.update('usuarios', { estado: nuevoEstado }, { id: userId });
            
            // Registrar actividad
            const accion = nuevoEstado === 'activo' ? 'desbloquear' : 'bloquear';
            this.logger.registrarActividad('usuarios', accion, `Usuario ${accion === 'bloquear' ? 'bloqueado' : 'desbloqueado'}: ${usuario.username}`);
            
            // Notificar y recargar datos
            this.notifications.showSuccess(`Usuario ${nuevoEstado === 'activo' ? 'activado' : 'bloqueado'} exitosamente`);
            await this.cargarDatos();
            
        } catch (error) {
            console.error('Error al cambiar estado de usuario:', error);
            this.notifications.showError('Error al actualizar el estado del usuario');
        }
    }
    
    /**
     * Muestra un diálogo de confirmación para eliminar un usuario
     */
    async confirmarEliminarUsuario(userId) {
        try {
            // Verificar permisos
            const tienePermiso = await this.auth.verificarPermiso('usuarios.eliminar');
            if (!tienePermiso) {
                this.notifications.showError('No tienes permisos para eliminar usuarios');
                return;
            }
            
            // Verificar que no sea el usuario actual
            const usuarioActual = await this.auth.obtenerUsuarioActual();
            if (userId === usuarioActual.id) {
                this.notifications.showError('No puedes eliminar tu propio usuario');
                return;
            }
            
            // Obtener usuario para confirmación
            const usuario = await this.db.queryOne('SELECT username, nombre, apellido FROM usuarios WHERE id = ?', [userId]);
            
            // Confirmar eliminación
            const confirmar = await this.notifications.showConfirm(
                'Eliminar Usuario',
                `¿Estás seguro de que deseas eliminar al usuario ${usuario.nombre} ${usuario.apellido} (${usuario.username})? Esta acción no se puede deshacer.`
            );
            
            if (!confirmar) return;
            
            // Verificar dependencias antes de eliminar
            const tieneDependencias = await this.verificarDependenciasUsuario(userId);
            if (tieneDependencias) {
                const confirmarDependencias = await this.notifications.showConfirm(
                    'Advertencia',
                    'Este usuario tiene registros asociados (facturas, movimientos de caja, etc). En lugar de eliminar, se recomienda bloquear el usuario. ¿Deseas continuar con la eliminación?'
                );
                
                if (!confirmarDependencias) return;
            }
            
            // Eliminar usuario
            await this.db.delete('usuarios', { id: userId });
            
            // Registrar actividad
            this.logger.registrarActividad('usuarios', 'eliminar', `Usuario eliminado: ${usuario.username}`);
            
            // Notificar y recargar datos
            this.notifications.showSuccess('Usuario eliminado exitosamente');
            await this.cargarDatos();
            
        } catch (error) {
            console.error('Error al eliminar usuario:', error);
            this.notifications.showError('Error al eliminar el usuario');
        }
    }
    
    /**
     * Verifica si un usuario tiene registros asociados en otras tablas
     */
    async verificarDependenciasUsuario(userId) {
        try {
            // Verificar si el usuario tiene facturas
            const facturasCount = await this.db.queryValue(
                'SELECT COUNT(*) FROM facturas WHERE usuario_id = ?',
                [userId]
            );
            
            // Verificar si el usuario tiene movimientos de caja
            const cajaCount = await this.db.queryValue(
                'SELECT COUNT(*) FROM caja_movimientos WHERE usuario_id = ?',
                [userId]
            );
            
            // Verificar si el usuario tiene compras registradas
            const comprasCount = await this.db.queryValue(
                'SELECT COUNT(*) FROM compras WHERE usuario_id = ?',
                [userId]
            );
            
            // Si existe alguna dependencia, retornar true
            return facturasCount > 0 || cajaCount > 0 || comprasCount > 0;
            
        } catch (error) {
            console.error('Error al verificar dependencias del usuario:', error);
            throw new Error('No se pudieron verificar las dependencias del usuario');
        }
    }
    
    /**
     * Muestra los detalles completos de un usuario
     */
    async mostrarDetalleUsuario(userId) {
        try {
            // Verificar permisos
            const tienePermiso = await this.auth.verificarPermiso('usuarios.ver');
            if (!tienePermiso) {
                this.notifications.showError('No tienes permisos para ver detalles de usuarios');
                return;
            }
            
            // Obtener datos completos del usuario
            const usuario = await this.db.queryOne(`
                SELECT u.*, r.nombre as rol_nombre, s.nombre as sucursal_nombre
                FROM usuarios u
                LEFT JOIN roles r ON u.rol_id = r.id
                LEFT JOIN sucursales s ON u.sucursal_id = s.id
                WHERE u.id = ?
            `, [userId]);
            
            if (!usuario) {
                this.notifications.showError('Usuario no encontrado');
                return;
            }
            
            // Guardar el usuario actual para uso en pestañas
            this.usuarioActual = usuario;
            
            // Cargar estadísticas del usuario
            const estadisticas = await this.obtenerEstadisticasUsuario(userId);
            
            // Renderizar detalles del usuario
            const detalleContainer = this.elements.usuarioDetalle;
            detalleContainer.innerHTML = `
                <div class="bg-white shadow rounded-lg p-6">
                    <div class="flex justify-between items-center mb-6">
                        <h2 class="text-2xl font-semibold">Detalles del Usuario</h2>
                        <div>
                            <button id="btn-cerrar-detalle" class="text-gray-500 hover:text-gray-700">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                    </div>
                    
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <div class="mb-4">
                                <h3 class="text-lg font-medium mb-2">Información Personal</h3>
                                <div class="bg-gray-50 p-4 rounded">
                                    <div class="mb-2">
                                        <span class="font-medium">Usuario:</span> ${usuario.username}
                                    </div>
                                    <div class="mb-2">
                                        <span class="font-medium">Nombre:</span> ${usuario.nombre} ${usuario.apellido}
                                    </div>
                                    <div class="mb-2">
                                        <span class="font-medium">Email:</span> ${usuario.email}
                                    </div>
                                    <div class="mb-2">
                                        <span class="font-medium">Estado:</span>
                                        <span class="px-2 py-1 rounded text-xs font-semibold ${usuario.estado === 'activo' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                                            ${usuario.estado === 'activo' ? 'Activo' : 'Bloqueado'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            
                            <div>
                                <h3 class="text-lg font-medium mb-2">Información del Sistema</h3>
                                <div class="bg-gray-50 p-4 rounded">
                                    <div class="mb-2">
                                        <span class="font-medium">Rol:</span> ${usuario.rol_nombre}
                                    </div>
                                    <div class="mb-2">
                                        <span class="font-medium">Sucursal:</span> ${usuario.sucursal_nombre || 'No asignada'}
                                    </div>
                                    <div class="mb-2">
                                        <span class="font-medium">Fecha de creación:</span> ${new Date(usuario.fecha_creacion).toLocaleDateString()}
                                    </div>
                                    <div class="mb-2">
                                        <span class="font-medium">Último acceso:</span> ${usuario.ultimo_acceso ? new Date(usuario.ultimo_acceso).toLocaleString() : 'Nunca'}
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        <div>
                            <h3 class="text-lg font-medium mb-2">Estadísticas de Usuario</h3>
                            <div class="bg-gray-50 p-4 rounded">
                                <div class="grid grid-cols-2 gap-4">
                                    <div class="bg-white p-3 rounded shadow">
                                        <div class="text-xl font-bold text-blue-600">${estadisticas.totalFacturas}</div>
                                        <div class="text-gray-500 text-sm">Facturas emitidas</div>
                                    </div>
                                    <div class="bg-white p-3 rounded shadow">
                                        <div class="text-xl font-bold text-green-600">$${estadisticas.totalVentas.toLocaleString()}</div>
                                        <div class="text-gray-500 text-sm">Ventas totales</div>
                                    </div>
                                    <div class="bg-white p-3 rounded shadow">
                                        <div class="text-xl font-bold text-yellow-600">${estadisticas.totalAperturasCaja}</div>
                                        <div class="text-gray-500 text-sm">Aperturas de caja</div>
                                    </div>
                                    <div class="bg-white p-3 rounded shadow">
                                        <div class="text-xl font-bold text-purple-600">${estadisticas.ultimaActividad ? new Date(estadisticas.ultimaActividad).toLocaleString() : 'N/A'}</div>
                                        <div class="text-gray-500 text-sm">Última actividad</div>
                                    </div>
                                </div>
                            </div>
                            
                            <div class="mt-6">
                                <h3 class="text-lg font-medium mb-2">Permisos</h3>
                                <div class="bg-gray-50 p-4 rounded">
                                    <div id="permisos-container" class="flex flex-wrap gap-2">
                                        <div class="loader">Cargando permisos...</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="mt-6">
                        <div class="border-b border-gray-200">
                            <ul class="flex flex-wrap -mb-px">
                                <li class="mr-2">
                                    <a id="tab-facturas" class="inline-block p-4 border-b-2 border-transparent rounded-t-lg hover:text-gray-600 hover:border-gray-300 cursor-pointer tab-active">
                                        Facturas
                                    </a>
                                </li>
                                <li class="mr-2">
                                    <a id="tab-caja" class="inline-block p-4 border-b-2 border-transparent rounded-t-lg hover:text-gray-600 hover:border-gray-300 cursor-pointer">
                                        Caja
                                    </a>
                                </li>
                                <li class="mr-2">
                                    <a id="tab-actividad" class="inline-block p-4 border-b-2 border-transparent rounded-t-lg hover:text-gray-600 hover:border-gray-300 cursor-pointer">
                                        Actividad
                                    </a>
                                </li>
                            </ul>
                        </div>
                        <div id="tab-content" class="py-4">
                            <div id="tab-content-facturas">
                                <h3 class="text-lg font-medium mb-3">Últimas Facturas</h3>
                                <div class="loader">Cargando facturas...</div>
                            </div>
                            <div id="tab-content-caja" class="hidden">
                                <h3 class="text-lg font-medium mb-3">Movimientos de Caja</h3>
                                <div class="loader">Cargando movimientos...</div>
                            </div>
                            <div id="tab-content-actividad" class="hidden">
                                <h3 class="text-lg font-medium mb-3">Registro de Actividad</h3>
                                <div class="loader">Cargando actividad...</div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            
            // Mostrar el contenedor de detalles
            detalleContainer.classList.remove('hidden');
            
            // Configurar eventos
            document.getElementById('btn-cerrar-detalle').addEventListener('click', () => {
                detalleContainer.classList.add('hidden');
            });
            
            // Configurar tabs
            this.configurarTabs();
            
            // Cargar permisos del usuario
            this.cargarPermisosUsuario(userId);
            
            // Cargar contenido inicial de la primera pestaña
            this.cargarFacturasUsuario(userId);
            
        } catch (error) {
            console.error('Error al mostrar detalles de usuario:', error);
            this.notifications.showError('Error al cargar detalles del usuario');
        }
    }
    
    /**
     * Configura los eventos para las pestañas en el detalle de usuario
     */
    configurarTabs() {
        // Referencias a las pestañas
        const tabFacturas = document.getElementById('tab-facturas');
        const tabCaja = document.getElementById('tab-caja');
        const tabActividad = document.getElementById('tab-actividad');
        
        // Referencias a los contenidos
        const contentFacturas = document.getElementById('tab-content-facturas');
        const contentCaja = document.getElementById('tab-content-caja');
        const contentActividad = document.getElementById('tab-content-actividad');
        
        // Función para cambiar de pestaña
        const cambiarTab = (tab, content) => {
            // Quitar clase activa de todas las pestañas
            tabFacturas.classList.remove('tab-active', 'text-blue-600', 'border-blue-600');
            tabCaja.classList.remove('tab-active', 'text-blue-600', 'border-blue-600');
            tabActividad.classList.remove('tab-active', 'text-blue-600', 'border-blue-600');
            
            // Ocultar todos los contenidos
            contentFacturas.classList.add('hidden');
            contentCaja.classList.add('hidden');
            contentActividad.classList.add('hidden');
            
            // Activar pestaña seleccionada
            tab.classList.add('tab-active', 'text-blue-600', 'border-blue-600');
            
            // Mostrar contenido seleccionado
            content.classList.remove('hidden');
        };
        
        // Eventos para cambiar de pestaña
        tabFacturas.addEventListener('click', () => {
            cambiarTab(tabFacturas, contentFacturas);
            if (this.usuarioActual) {
                this.cargarFacturasUsuario(this.usuarioActual.id);
            }
        });
        
        tabCaja.addEventListener('click', () => {
            cambiarTab(tabCaja, contentCaja);
            if (this.usuarioActual) {
                this.cargarCajaUsuario(this.usuarioActual.id);
            }
        });
        
        tabActividad.addEventListener('click', () => {
            cambiarTab(tabActividad, contentActividad);
            if (this.usuarioActual) {
                this.actividadManager.cargarActividadUsuario(this.usuarioActual.id);
            }
        });
        
        // Activar la primera pestaña por defecto
        tabFacturas.classList.add('tab-active', 'text-blue-600', 'border-blue-600');
    }
    
    /**
     * Obtiene estadísticas del usuario
     */
    async obtenerEstadisticasUsuario(userId) {
        try {
            // Total de facturas emitidas
            const totalFacturas = await this.db.queryValue(
                'SELECT COUNT(*) FROM facturas WHERE usuario_id = ?',
                [userId]
            );
            
            // Total de ventas en pesos
            const totalVentas = await this.db.queryValue(
                'SELECT COALESCE(SUM(total), 0) FROM facturas WHERE usuario_id = ?',
                [userId]
            );
            
            // Total de aperturas de caja
            const totalAperturasCaja = await this.db.queryValue(
                'SELECT COUNT(*) FROM caja_movimientos WHERE usuario_id = ? AND tipo = "apertura"',
                [userId]
            );
            
            // Última actividad
            const ultimaActividad = await this.db.queryValue(
                'SELECT MAX(fecha) FROM log_actividad WHERE usuario_id = ?',
                [userId]
            );
            
            return {
                totalFacturas,
                totalVentas,
                totalAperturasCaja,
                ultimaActividad
            };
            
        } catch (error) {
            console.error('Error al obtener estadísticas del usuario:', error);
            throw new Error('No se pudieron cargar las estadísticas del usuario');
        }
    }
    
    /**
     * Carga los permisos del usuario
     */
    async cargarPermisosUsuario(userId) {
        try {
            // Obtener permisos del usuario desde su rol
            const permisos = await this.permisosManager.obtenerPermisosUsuario(userId);
            
            // Renderizar permisos
            const permisosContainer = document.getElementById('permisos-container');
            permisosContainer.innerHTML = '';
            
            if (permisos.length === 0) {
                permisosContainer.innerHTML = '<p class="text-gray-500">No hay permisos asignados</p>';
                return;
            }
            
            // Agrupar permisos por módulo
            const permisosAgrupados = {};
            permisos.forEach(permiso => {
                const [modulo] = permiso.codigo.split('.');
                if (!permisosAgrupados[modulo]) {
                    permisosAgrupados[modulo] = [];
                }
                permisosAgrupados[modulo].push(permiso);
            });
            
            // Crear acordeón para los permisos
            Object.entries(permisosAgrupados).forEach(([modulo, permisosList]) => {
                const moduloDiv = document.createElement('div');
                moduloDiv.className = 'w-full mb-2';
                moduloDiv.innerHTML = `
                    <div class="bg-gray-200 p-2 rounded font-medium cursor-pointer flex justify-between items-center">
                        <span>${this.capitalizarPrimeraLetra(modulo)}</span>
                        <i class="fas fa-chevron-down"></i>
                    </div>
                    <div class="permisos-lista hidden p-2">
                        <ul class="list-disc pl-5">
                            ${permisosList.map(permiso => 
                                `<li>${this.obtenerDescripcionPermiso(permiso.codigo)}</li>`
                            ).join('')}
                        </ul>
                    </div>
                `;
                
                // Agregar evento para expandir/colapsar
                const header = moduloDiv.querySelector('.bg-gray-200');
                const content = moduloDiv.querySelector('.permisos-lista');
                const icon = moduloDiv.querySelector('i');
                
                header.addEventListener('click', () => {
                    content.classList.toggle('hidden');
                    icon.classList.toggle('fa-chevron-down');
                    icon.classList.toggle('fa-chevron-up');
                });
                
                permisosContainer.appendChild(moduloDiv);
            });
            
        } catch (error) {
            console.error('Error al cargar permisos del usuario:', error);
            document.getElementById('permisos-container').innerHTML = 
                '<p class="text-red-500">Error al cargar permisos</p>';
        }
    }
    
    /**
     * Carga las facturas emitidas por el usuario
     */
    async cargarFacturasUsuario(userId) {
        try {
            // Obtener las últimas facturas del usuario
            const facturas = await this.db.query(`
                SELECT f.*, c.nombre as cliente_nombre, c.apellido as cliente_apellido
                FROM facturas f
                LEFT JOIN clientes c ON f.cliente_id = c.id
                WHERE f.usuario_id = ?
                ORDER BY f.fecha DESC
                LIMIT 10
            `, [userId]);
            
            // Contenedor de facturas
            const contenedor = document.getElementById('tab-content-facturas');
            
            // Si no hay facturas
            if (facturas.length === 0) {
                contenedor.innerHTML = `
                    <h3 class="text-lg font-medium mb-3">Últimas Facturas</h3>
                    <p class="text-gray-500">Este usuario no ha emitido facturas</p>
                `;
                return;
            }
            
            // Renderizar tabla de facturas
            contenedor.innerHTML = `
                <h3 class="text-lg font-medium mb-3">Últimas Facturas</h3>
                <div class="overflow-x-auto">
                    <table class="w-full table-auto">
                        <thead>
                            <tr class="bg-gray-100">
                                <th class="px-4 py-2 text-left">Número</th>
                                <th class="px-4 py-2 text-left">Fecha</th>
                                <th class="px-4 py-2 text-left">Cliente</th>
                                <th class="px-4 py-2 text-left">Tipo</th>
                                <th class="px-4 py-2 text-right">Total</th>
                                <th class="px-4 py-2 text-center">Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${facturas.map(factura => `
                                <tr class="border-b hover:bg-gray-50">
                                    <td class="px-4 py-2">${factura.numero}</td>
                                    <td class="px-4 py-2">${new Date(factura.fecha).toLocaleDateString()}</td>
                                    <td class="px-4 py-2">${factura.cliente_nombre ? `${factura.cliente_nombre} ${factura.cliente_apellido}` : 'Consumidor Final'}</td>
                                    <td class="px-4 py-2">${this.obtenerTipoFactura(factura.tipo)}</td>
                                    <td class="px-4 py-2 text-right">$${factura.total.toLocaleString()}</td>
                                    <td class="px-4 py-2 text-center">
                                        <button class="btn-ver-factura text-blue-600 hover:text-blue-800" 
                                                data-id="${factura.id}" title="Ver factura">
                                            <i class="fas fa-file-alt"></i>
                                        </button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                <div class="mt-4 text-right">
                    <a href="#" class="text-blue-600 hover:text-blue-800 text-sm font-medium" id="ver-todas-facturas">
                        Ver todas las facturas de este usuario →
                    </a>
                </div>
            `;
            
            // Evento para ver todas las facturas
            document.getElementById('ver-todas-facturas').addEventListener('click', (e) => {
                e.preventDefault();
                // Aquí se podría redirigir a la sección de facturas con un filtro por usuario
                // O mostrar un modal con todas las facturas
                // Por ejemplo:
                window.location.href = `../ventas/index.html?usuario_id=${userId}`;
            });
            
            // Eventos para ver facturas individuales
            const botonesVerFactura = contenedor.querySelectorAll('.btn-ver-factura');
            botonesVerFactura.forEach(boton => {
                boton.addEventListener('click', () => {
                    const facturaId = boton.dataset.id;
                    // Aquí se podría mostrar un modal con los detalles de la factura
                    // O redirigir a una página de detalles
                    window.location.href = `../ventas/detalle.html?id=${facturaId}`;
                });
            });
            
        } catch (error) {
            console.error('Error al cargar facturas del usuario:', error);
            document.getElementById('tab-content-facturas').innerHTML = `
                <h3 class="text-lg font-medium mb-3">Últimas Facturas</h3>
                <p class="text-red-500">Error al cargar facturas</p>
            `;
        }
    }
    
    /**
     * Carga los movimientos de caja del usuario
     */
    async cargarCajaUsuario(userId) {
        try {
            // Obtener los últimos movimientos de caja del usuario
            const movimientos = await this.db.query(`
                SELECT cm.*, s.nombre as sucursal_nombre
                FROM caja_movimientos cm
                LEFT JOIN sucursales s ON cm.sucursal_id = s.id
                WHERE cm.usuario_id = ?
                ORDER BY cm.fecha DESC
                LIMIT 10
            `, [userId]);
            
            // Contenedor de movimientos
            const contenedor = document.getElementById('tab-content-caja');
            
            // Si no hay movimientos
            if (movimientos.length === 0) {
                contenedor.innerHTML = `
                    <h3 class="text-lg font-medium mb-3">Movimientos de Caja</h3>
                    <p class="text-gray-500">Este usuario no ha realizado movimientos de caja</p>
                `;
                return;
            }
            
            // Renderizar tabla de movimientos
            contenedor.innerHTML = `
                <h3 class="text-lg font-medium mb-3">Movimientos de Caja</h3>
                <div class="overflow-x-auto">
                    <table class="w-full table-auto">
                        <thead>
                            <tr class="bg-gray-100">
                                <th class="px-4 py-2 text-left">Fecha</th>
                                <th class="px-4 py-2 text-left">Tipo</th>
                                <th class="px-4 py-2 text-left">Sucursal</th>
                                <th class="px-4 py-2 text-right">Monto</th>
                                <th class="px-4 py-2 text-left">Descripción</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${movimientos.map(mov => `
                                <tr class="border-b hover:bg-gray-50">
                                    <td class="px-4 py-2">${new Date(mov.fecha).toLocaleString()}</td>
                                    <td class="px-4 py-2">
                                        <span class="px-2 py-1 rounded-full text-xs font-semibold ${this.obtenerClaseCajaMovimiento(mov.tipo)}">
                                            ${this.capitalizarPrimeraLetra(mov.tipo)}
                                        </span>
                                    </td>
                                    <td class="px-4 py-2">${mov.sucursal_nombre}</td>
                                    <td class="px-4 py-2 text-right">$${mov.monto.toLocaleString()}</td>
                                    <td class="px-4 py-2">${mov.descripcion || '-'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                <div class="mt-4 text-right">
                    <a href="#" class="text-blue-600 hover:text-blue-800 text-sm font-medium" id="ver-todos-movimientos">
                        Ver todos los movimientos de caja de este usuario →
                    </a>
                </div>
            `;
            
            // Evento para ver todos los movimientos
            document.getElementById('ver-todos-movimientos').addEventListener('click', (e) => {
                e.preventDefault();
                // Redirigir a la sección de caja con filtro por usuario
                window.location.href = `../caja/movimientos.html?usuario_id=${userId}`;
            });
            
        } catch (error) {
            console.error('Error al cargar movimientos de caja:', error);
            document.getElementById('tab-content-caja').innerHTML = `
                <h3 class="text-lg font-medium mb-3">Movimientos de Caja</h3>
                <p class="text-red-500">Error al cargar movimientos de caja</p>
            `;
        }
    }
    
    /**
     * Devuelve la descripción de un permiso
     */
    obtenerDescripcionPermiso(codigoPermiso) {
        const descripciones = {
            'usuarios.ver': 'Ver usuarios',
            'usuarios.crear': 'Crear usuarios',
            'usuarios.editar': 'Editar usuarios',
            'usuarios.eliminar': 'Eliminar usuarios',
            'usuarios.bloquear': 'Bloquear/desbloquear usuarios',
            'usuarios.cambiarPassword': 'Cambiar contraseñas',
            'facturador.ver': 'Acceder al facturador',
            'facturador.crear': 'Emitir facturas',
            'facturador.anular': 'Anular facturas',
            'caja.ver': 'Ver caja',
            'caja.apertura': 'Apertura de caja',
            'caja.cierre': 'Cierre de caja',
            'caja.movimientos': 'Registrar movimientos de caja',
            'productos.ver': 'Ver productos',
            'productos.crear': 'Crear productos',
            'productos.editar': 'Editar productos',
            'productos.eliminar': 'Eliminar productos',
            'clientes.ver': 'Ver clientes',
            'clientes.crear': 'Crear clientes',
            'clientes.editar': 'Editar clientes',
            'clientes.eliminar': 'Eliminar clientes',
            'reportes.ver': 'Ver reportes',
            'reportes.exportar': 'Exportar reportes',
            'configuracion.ver': 'Ver configuración',
            'configuracion.editar': 'Editar configuración',
            'configuracion.avanzada': 'Configuración avanzada'
        };
        
        return descripciones[codigoPermiso] || codigoPermiso;
    }
    
    /**
     * Devuelve el tipo de factura formateado
     */
    obtenerTipoFactura(tipo) {
        const tipos = {
            'A': 'Factura A',
            'B': 'Factura B',
            'C': 'Factura C',
            'X': 'Factura X',
            'P': 'Presupuesto'
        };
        
        return tipos[tipo] || tipo;
    }
    
    /**
     * Devuelve la clase CSS para el tipo de movimiento de caja
     */
    obtenerClaseCajaMovimiento(tipo) {
        switch (tipo) {
            case 'apertura':
                return 'bg-blue-100 text-blue-800';
            case 'cierre':
                return 'bg-purple-100 text-purple-800';
            case 'ingreso':
                return 'bg-green-100 text-green-800';
            case 'egreso':
                return 'bg-red-100 text-red-800';
            default:
                return 'bg-gray-100 text-gray-800';
        }
    }
    
    /**
     * Capitaliza la primera letra de una cadena
     */
    capitalizarPrimeraLetra(texto) {
        return texto.charAt(0).toUpperCase() + texto.slice(1);
    }
}

// Exportar la clase UsuariosManager
export default UsuariosManager;

// Inicializar el módulo al cargar el documento
document.addEventListener('DOMContentLoaded', () => {
    const usuariosManager = new UsuariosManager();
});