/**
 * @fileoverview Gestión de roles de usuarios - FactuSystem
 * Permite la administración de roles y sus permisos asociados
 */

// Importación de utilidades y servicios necesarios
const { showNotification } = require('../../components/notifications.js');
const { validatePermission } = require('../../utils/auth.js');
const { database } = require('../../utils/database.js');
const { logger } = require('../../utils/logger.js');
const { openTab } = require('../../components/tabs.js');
const { loadingOverlay } = require('../../components/dashboard.js');
const { showConfirmDialog, showModalForm } = require('../../components/notifications.js');

// Definición de módulo para gestión de roles
const RolesModule = (() => {
    // Cache de datos y estado
    let currentRoles = [];
    let allPermissions = [];
    let selectedRoleId = null;
    let isEditing = false;

    // Elementos DOM principales
    let rolTable;
    let roleFormContainer;
    let permissionsContainer;
    
    /**
     * Inicializa el módulo de roles
     * @returns {Promise<void>}
     */
    const initialize = async () => {
        try {
            // Verificar permisos de acceso
            if (!validatePermission('usuarios.roles.ver')) {
                showNotification('error', 'No tiene permisos para acceder a la gestión de roles');
                return;
            }

            // Cargar la vista de roles
            await loadRolesView();
            
            // Configurar listeners de eventos
            setupEventListeners();
            
            // Cargar datos iniciales
            await Promise.all([
                loadRoles(),
                loadPermissions()
            ]);
            
            logger.info('Módulo de roles inicializado correctamente');
        } catch (error) {
            logger.error('Error al inicializar el módulo de roles', error);
            showNotification('error', 'Error al cargar el módulo de roles');
        }
    };

    /**
     * Carga la vista HTML de roles en el contenedor principal
     * @returns {Promise<void>}
     */
    const loadRolesView = async () => {
        try {
            loadingOverlay(true, 'Cargando gestión de roles...');
            
            // Cargar la vista desde el archivo HTML
            const response = await fetch('../views/usuarios/roles.html');
            if (!response.ok) throw new Error('No se pudo cargar la vista de roles');
            
            const html = await response.text();
            
            // Insertar HTML en el contenedor principal
            const container = document.getElementById('main-content');
            container.innerHTML = html;
            
            // Obtener referencias a elementos importantes del DOM
            rolTable = document.getElementById('roles-table');
            roleFormContainer = document.getElementById('role-form-container');
            permissionsContainer = document.getElementById('permissions-container');
            
            loadingOverlay(false);
        } catch (error) {
            loadingOverlay(false);
            logger.error('Error al cargar la vista de roles', error);
            showNotification('error', 'Error al cargar la interfaz de roles');
        }
    };

    /**
     * Configura los manejadores de eventos para la interfaz
     */
    const setupEventListeners = () => {
        // Botón para crear nuevo rol
        document.getElementById('btn-new-role').addEventListener('click', () => {
            if (validatePermission('usuarios.roles.crear')) {
                clearRoleForm();
                isEditing = false;
                selectedRoleId = null;
                showRoleForm();
            } else {
                showNotification('error', 'No tiene permisos para crear roles');
            }
        });

        // Botón para guardar rol (crear o actualizar)
        document.getElementById('btn-save-role').addEventListener('click', saveRole);
        
        // Botón para cancelar edición
        document.getElementById('btn-cancel-role').addEventListener('click', hideRoleForm);
        
        // Filtro de búsqueda
        document.getElementById('search-role').addEventListener('input', (e) => {
            filterRoles(e.target.value);
        });
    };

    /**
     * Carga los roles desde la base de datos
     * @returns {Promise<void>}
     */
    const loadRoles = async () => {
        try {
            loadingOverlay(true, 'Cargando roles...');
            
            // Consultar roles en la base de datos
            const result = await database.query(`
                SELECT id, nombre, descripcion, es_predeterminado, fecha_creacion 
                FROM roles 
                ORDER BY nombre ASC
            `);
            
            currentRoles = result || [];
            
            // Renderizar la tabla de roles
            renderRolesTable();
            
            loadingOverlay(false);
        } catch (error) {
            loadingOverlay(false);
            logger.error('Error al cargar los roles', error);
            showNotification('error', 'Error al cargar la lista de roles');
        }
    };

    /**
     * Carga todos los permisos disponibles en el sistema
     * @returns {Promise<void>}
     */
    const loadPermissions = async () => {
        try {
            // Consultar todos los permisos disponibles
            const result = await database.query(`
                SELECT id, codigo, nombre, descripcion, modulo
                FROM permisos
                ORDER BY modulo, nombre
            `);
            
            allPermissions = result || [];
        } catch (error) {
            logger.error('Error al cargar los permisos', error);
            showNotification('error', 'Error al cargar los permisos del sistema');
        }
    };

    /**
     * Renderiza la tabla de roles con los datos cargados
     */
    const renderRolesTable = () => {
        if (!rolTable) return;
        
        // Limpiar tabla
        const tbody = rolTable.querySelector('tbody');
        tbody.innerHTML = '';
        
        if (currentRoles.length === 0) {
            // Si no hay roles, mostrar mensaje
            const row = document.createElement('tr');
            row.innerHTML = `
                <td colspan="5" class="text-center">No hay roles disponibles</td>
            `;
            tbody.appendChild(row);
            return;
        }
        
        // Crear filas para cada rol
        currentRoles.forEach(role => {
            const row = document.createElement('tr');
            
            // Formatear fecha de creación
            const creationDate = new Date(role.fecha_creacion);
            const formattedDate = creationDate.toLocaleDateString('es-AR', { 
                day: '2-digit', 
                month: '2-digit', 
                year: 'numeric' 
            });
            
            // Crear contenido de la fila
            row.innerHTML = `
                <td>${role.nombre}</td>
                <td>${role.descripcion || ''}</td>
                <td>${role.es_predeterminado ? 'Sí' : 'No'}</td>
                <td>${formattedDate}</td>
                <td class="text-center">
                    <button class="btn btn-sm btn-primary btn-edit" data-id="${role.id}" 
                        ${!validatePermission('usuarios.roles.editar') ? 'disabled' : ''}>
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-sm btn-danger btn-delete" data-id="${role.id}" 
                        ${!validatePermission('usuarios.roles.eliminar') || role.es_predeterminado ? 'disabled' : ''}>
                        <i class="fas fa-trash"></i>
                    </button>
                    <button class="btn btn-sm btn-info btn-permissions" data-id="${role.id}"
                        ${!validatePermission('usuarios.roles.permisos') ? 'disabled' : ''}>
                        <i class="fas fa-key"></i>
                    </button>
                </td>
            `;
            
            // Añadir fila a la tabla
            tbody.appendChild(row);
            
            // Asignar eventos a los botones de cada fila
            const editBtn = row.querySelector('.btn-edit');
            const deleteBtn = row.querySelector('.btn-delete');
            const permissionsBtn = row.querySelector('.btn-permissions');
            
            if (editBtn) {
                editBtn.addEventListener('click', () => editRole(role.id));
            }
            
            if (deleteBtn) {
                deleteBtn.addEventListener('click', () => deleteRole(role.id));
            }
            
            if (permissionsBtn) {
                permissionsBtn.addEventListener('click', () => manageRolePermissions(role.id));
            }
        });
    };

    /**
     * Filtra la tabla de roles según el texto de búsqueda
     * @param {string} searchText - Texto a buscar
     */
    const filterRoles = (searchText) => {
        if (!searchText || searchText.trim() === '') {
            renderRolesTable();
            return;
        }
        
        const filteredRoles = currentRoles.filter(role => {
            const searchLower = searchText.toLowerCase();
            return (
                role.nombre.toLowerCase().includes(searchLower) ||
                (role.descripcion && role.descripcion.toLowerCase().includes(searchLower))
            );
        });
        
        const tbody = rolTable.querySelector('tbody');
        tbody.innerHTML = '';
        
        if (filteredRoles.length === 0) {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td colspan="5" class="text-center">No se encontraron resultados para "${searchText}"</td>
            `;
            tbody.appendChild(row);
            return;
        }
        
        // Recrear tabla con roles filtrados
        filteredRoles.forEach(role => {
            const row = document.createElement('tr');
            const creationDate = new Date(role.fecha_creacion);
            const formattedDate = creationDate.toLocaleDateString('es-AR', { 
                day: '2-digit', 
                month: '2-digit', 
                year: 'numeric' 
            });
            
            row.innerHTML = `
                <td>${role.nombre}</td>
                <td>${role.descripcion || ''}</td>
                <td>${role.es_predeterminado ? 'Sí' : 'No'}</td>
                <td>${formattedDate}</td>
                <td class="text-center">
                    <button class="btn btn-sm btn-primary btn-edit" data-id="${role.id}" 
                        ${!validatePermission('usuarios.roles.editar') ? 'disabled' : ''}>
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-sm btn-danger btn-delete" data-id="${role.id}" 
                        ${!validatePermission('usuarios.roles.eliminar') || role.es_predeterminado ? 'disabled' : ''}>
                        <i class="fas fa-trash"></i>
                    </button>
                    <button class="btn btn-sm btn-info btn-permissions" data-id="${role.id}"
                        ${!validatePermission('usuarios.roles.permisos') ? 'disabled' : ''}>
                        <i class="fas fa-key"></i>
                    </button>
                </td>
            `;
            
            tbody.appendChild(row);
            
            // Asignar eventos a los botones
            const editBtn = row.querySelector('.btn-edit');
            const deleteBtn = row.querySelector('.btn-delete');
            const permissionsBtn = row.querySelector('.btn-permissions');
            
            if (editBtn) {
                editBtn.addEventListener('click', () => editRole(role.id));
            }
            
            if (deleteBtn) {
                deleteBtn.addEventListener('click', () => deleteRole(role.id));
            }
            
            if (permissionsBtn) {
                permissionsBtn.addEventListener('click', () => manageRolePermissions(role.id));
            }
        });
    };

    /**
     * Muestra el formulario para crear/editar rol
     */
    const showRoleForm = () => {
        if (!roleFormContainer) return;
        
        // Mostrar el formulario y ocultar listado
        document.getElementById('roles-list-container').classList.add('d-none');
        roleFormContainer.classList.remove('d-none');
        
        // Actualizar título según sea creación o edición
        document.getElementById('role-form-title').textContent = isEditing ? 'Editar Rol' : 'Nuevo Rol';
        
        // Enfocar el primer campo
        setTimeout(() => {
            document.getElementById('role-name').focus();
        }, 100);
    };

    /**
     * Oculta el formulario y muestra el listado de roles
     */
    const hideRoleForm = () => {
        if (!roleFormContainer) return;
        
        // Ocultar formulario y mostrar listado
        roleFormContainer.classList.add('d-none');
        document.getElementById('roles-list-container').classList.remove('d-none');
    };

    /**
     * Limpia el formulario de roles
     */
    const clearRoleForm = () => {
        document.getElementById('role-name').value = '';
        document.getElementById('role-description').value = '';
        document.getElementById('role-is-default').checked = false;
    };

    /**
     * Carga los datos de un rol en el formulario para edición
     * @param {number} roleId - ID del rol a editar
     */
    const editRole = async (roleId) => {
        if (!validatePermission('usuarios.roles.editar')) {
            showNotification('error', 'No tiene permisos para editar roles');
            return;
        }
        
        try {
            loadingOverlay(true, 'Cargando datos del rol...');
            
            // Buscar el rol en la lista actual primero (para evitar consulta innecesaria)
            let role = currentRoles.find(r => r.id === roleId);
            
            // Si no se encuentra, consultar a la base de datos
            if (!role) {
                const result = await database.query(`
                    SELECT id, nombre, descripcion, es_predeterminado
                    FROM roles
                    WHERE id = ?
                `, [roleId]);
                
                if (!result || result.length === 0) {
                    throw new Error('El rol no existe o fue eliminado');
                }
                
                role = result[0];
            }
            
            // Establecer el modo de edición
            isEditing = true;
            selectedRoleId = roleId;
            
            // Cargar datos en el formulario
            document.getElementById('role-name').value = role.nombre;
            document.getElementById('role-description').value = role.descripcion || '';
            document.getElementById('role-is-default').checked = !!role.es_predeterminado;
            
            // Si es rol predeterminado, deshabilitar esa opción
            if (role.es_predeterminado) {
                document.getElementById('role-is-default').disabled = true;
            } else {
                document.getElementById('role-is-default').disabled = false;
            }
            
            // Mostrar formulario
            showRoleForm();
            
            loadingOverlay(false);
        } catch (error) {
            loadingOverlay(false);
            logger.error('Error al cargar rol para edición', error);
            showNotification('error', 'Error al cargar los datos del rol');
        }
    };

    /**
     * Guarda un rol (creación o actualización)
     */
    const saveRole = async () => {
        try {
            // Validar permisos según operación
            if (isEditing && !validatePermission('usuarios.roles.editar')) {
                showNotification('error', 'No tiene permisos para editar roles');
                return;
            } else if (!isEditing && !validatePermission('usuarios.roles.crear')) {
                showNotification('error', 'No tiene permisos para crear roles');
                return;
            }
            
            // Obtener valores del formulario
            const roleName = document.getElementById('role-name').value.trim();
            const roleDescription = document.getElementById('role-description').value.trim();
            const isDefault = document.getElementById('role-is-default').checked;
            
            // Validar datos
            if (!roleName) {
                showNotification('warning', 'El nombre del rol es obligatorio');
                document.getElementById('role-name').focus();
                return;
            }
            
            loadingOverlay(true, isEditing ? 'Actualizando rol...' : 'Creando rol...');
            
            // Determinar si ya existe un rol con el mismo nombre
            const existingRole = await database.query(`
                SELECT id FROM roles WHERE nombre = ? AND id != ?
            `, [roleName, isEditing ? selectedRoleId : 0]);
            
            if (existingRole && existingRole.length > 0) {
                loadingOverlay(false);
                showNotification('warning', 'Ya existe un rol con ese nombre');
                return;
            }
            
            // Si es un rol predeterminado, verificar si hay otros
            if (isDefault) {
                // Si se está configurando como predeterminado, quitar ese estado de otros roles
                await database.query(`
                    UPDATE roles SET es_predeterminado = 0 WHERE es_predeterminado = 1
                `);
            } else if (isEditing) {
                // Verificar si este rol era predeterminado antes y asegurarse que siempre haya uno
                const currentDefault = await database.query(`
                    SELECT COUNT(*) as count FROM roles WHERE es_predeterminado = 1 AND id != ?
                `, [selectedRoleId]);
                
                if (currentDefault[0].count === 0) {
                    loadingOverlay(false);
                    showNotification('warning', 'Debe haber al menos un rol predeterminado en el sistema');
                    return;
                }
            }
            
            let result;
            
            // Realizar operación según sea creación o edición
            if (isEditing) {
                // Actualizar rol existente
                result = await database.query(`
                    UPDATE roles 
                    SET nombre = ?, descripcion = ?, es_predeterminado = ?
                    WHERE id = ?
                `, [roleName, roleDescription, isDefault ? 1 : 0, selectedRoleId]);
                
                logger.info(`Rol actualizado: ${roleName} (ID: ${selectedRoleId})`);
            } else {
                // Crear nuevo rol
                result = await database.query(`
                    INSERT INTO roles (nombre, descripcion, es_predeterminado, fecha_creacion)
                    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                `, [roleName, roleDescription, isDefault ? 1 : 0]);
                
                logger.info(`Nuevo rol creado: ${roleName}`);
            }
            
            // Recargar roles y actualizar interfaz
            await loadRoles();
            hideRoleForm();
            
            showNotification('success', isEditing ? 'Rol actualizado correctamente' : 'Rol creado correctamente');
            loadingOverlay(false);
        } catch (error) {
            loadingOverlay(false);
            logger.error('Error al guardar rol', error);
            showNotification('error', `Error al ${isEditing ? 'actualizar' : 'crear'} el rol`);
        }
    };

    /**
     * Elimina un rol del sistema
     * @param {number} roleId - ID del rol a eliminar
     */
    const deleteRole = async (roleId) => {
        if (!validatePermission('usuarios.roles.eliminar')) {
            showNotification('error', 'No tiene permisos para eliminar roles');
            return;
        }
        
        try {
            // Buscar información del rol
            const role = currentRoles.find(r => r.id === roleId);
            
            if (!role) {
                showNotification('error', 'El rol no existe o fue eliminado');
                return;
            }
            
            // Verificar si es rol predeterminado
            if (role.es_predeterminado) {
                showNotification('warning', 'No se puede eliminar un rol predeterminado del sistema');
                return;
            }
            
            // Mostrar confirmación
            const confirmed = await showConfirmDialog(
                'Eliminar Rol',
                `¿Está seguro que desea eliminar el rol "${role.nombre}"? Esta acción no se puede deshacer y podría afectar a los usuarios que tienen este rol asignado.`
            );
            
            if (!confirmed) return;
            
            loadingOverlay(true, 'Eliminando rol...');
            
            // Verificar si hay usuarios con este rol
            const usersWithRole = await database.query(`
                SELECT COUNT(*) as count FROM usuarios WHERE rol_id = ?
            `, [roleId]);
            
            if (usersWithRole[0].count > 0) {
                loadingOverlay(false);
                showNotification('warning', `No se puede eliminar el rol porque hay ${usersWithRole[0].count} usuarios asignados a él`);
                return;
            }
            
            // Eliminar permisos asociados al rol
            await database.query(`
                DELETE FROM rol_permisos WHERE rol_id = ?
            `, [roleId]);
            
            // Eliminar el rol
            await database.query(`
                DELETE FROM roles WHERE id = ?
            `, [roleId]);
            
            logger.info(`Rol eliminado: ${role.nombre} (ID: ${roleId})`);
            
            // Actualizar la lista de roles
            await loadRoles();
            
            showNotification('success', 'Rol eliminado correctamente');
            loadingOverlay(false);
        } catch (error) {
            loadingOverlay(false);
            logger.error('Error al eliminar rol', error);
            showNotification('error', 'Error al eliminar el rol');
        }
    };

    /**
     * Gestiona los permisos de un rol específico
     * @param {number} roleId - ID del rol a gestionar permisos
     */
    const manageRolePermissions = async (roleId) => {
        if (!validatePermission('usuarios.roles.permisos')) {
            showNotification('error', 'No tiene permisos para gestionar los permisos de roles');
            return;
        }
        
        try {
            loadingOverlay(true, 'Cargando permisos del rol...');
            
            // Buscar información del rol
            const role = currentRoles.find(r => r.id === roleId);
            
            if (!role) {
                throw new Error('El rol no existe o fue eliminado');
            }
            
            // Cargar permisos asignados al rol
            const assignedPermissions = await database.query(`
                SELECT permiso_id FROM rol_permisos WHERE rol_id = ?
            `, [roleId]);
            
            const assignedPermissionIds = assignedPermissions.map(p => p.permiso_id);
            
            // Crear contenido del modal
            const modalConfig = {
                title: `Permisos del Rol: ${role.nombre}`,
                size: 'xl',
                html: createPermissionsModalContent(assignedPermissionIds),
                buttons: [
                    {
                        id: 'btn-save-permissions',
                        text: 'Guardar Permisos',
                        class: 'btn-primary',
                        click: async () => {
                            await saveRolePermissions(roleId);
                            modalConfig.close();
                        }
                    },
                    {
                        id: 'btn-cancel-permissions',
                        text: 'Cancelar',
                        class: 'btn-secondary',
                        click: () => modalConfig.close()
                    }
                ]
            };
            
            loadingOverlay(false);
            
            // Mostrar modal
            showModalForm(modalConfig);
            
            // Configurar los toggles para seleccionar todo por grupo
            setupPermissionCheckboxes();
            
        } catch (error) {
            loadingOverlay(false);
            logger.error('Error al cargar permisos del rol', error);
            showNotification('error', 'Error al cargar los permisos del rol');
        }
    };

    /**
     * Crea el contenido HTML para el modal de permisos
     * @param {number[]} assignedPermissionIds - IDs de permisos ya asignados
     * @returns {string} HTML para el modal
     */
    const createPermissionsModalContent = (assignedPermissionIds) => {
        // Agrupar permisos por módulo
        const permissionsByModule = {};
        
        allPermissions.forEach(permission => {
            if (!permissionsByModule[permission.modulo]) {
                permissionsByModule[permission.modulo] = [];
            }
            permissionsByModule[permission.modulo].push(permission);
        });
        
        // Crear HTML
        let html = `
            <div class="row">
                <div class="col-12 mb-3">
                    <div class="alert alert-info">
                        <i class="fas fa-info-circle"></i> Seleccione los permisos que desea asignar a este rol.
                    </div>
                </div>
            </div>
            <div class="row">
        `;
        
        // Crear HTML para cada módulo
        Object.keys(permissionsByModule).sort().forEach(module => {
            html += `
                <div class="col-lg-6 col-12 mb-4">
                    <div class="card">
                        <div class="card-header d-flex justify-content-between align-items-center">
                            <h5 class="mb-0">${module}</h5>
                            <div class="form-check">
                                <input type="checkbox" class="form-check-input module-toggle" id="module-${module.replace(/\s/g, '-')}" 
                                       data-module="${module}" ${isAllModuleSelected(module, permissionsByModule[module], assignedPermissionIds) ? 'checked' : ''}>
                                <label class="form-check-label" for="module-${module.replace(/\s/g, '-')}">Seleccionar todos</label>
                            </div>
                        </div>
                        <div class="card-body">
                            <div class="row">
            `;
            
            // Crear checkbox para cada permiso
            permissionsByModule[module].forEach(permission => {
                const isSelected = assignedPermissionIds.includes(permission.id);
                html += `
                    <div class="col-lg-6 col-12 mb-2">
                        <div class="form-check">
                            <input type="checkbox" class="form-check-input permission-check" 
                                   id="permission-${permission.id}" 
                                   data-module="${module}"
                                   value="${permission.id}" ${isSelected ? 'checked' : ''}>
                            <label class="form-check-label" for="permission-${permission.id}" 
                                   title="${permission.descripcion || ''}">${permission.nombre}</label>
                        </div>
                    </div>
                `;
            });
            
            html += `
                            </div>
                        </div>
                    </div>
                </div>
            `;
        });
        
        html += `
            </div>
        `;
        
        return html;
    };

    /**
     * Verifica si todos los permisos de un módulo están seleccionados
     * @param {string} module - Nombre del módulo
     * @param {Array} modulePermissions - Permisos del módulo
     * @param {number[]} assignedPermissionIds - IDs de permisos asignados
     * @returns {boolean} true si todos están seleccionados
     */
    const isAllModuleSelected = (module, modulePermissions, assignedPermissionIds) => {
        return modulePermissions.every(permission => 
            assignedPermissionIds.includes(permission.id)
        );
    };

    /**
     * Configura los eventos para los checkboxes de permisos
     */
    const setupPermissionCheckboxes = () => {
        // Eventos para toggles de módulos
        document.querySelectorAll('.module-toggle').forEach(toggle => {
            toggle.addEventListener('change', (e) => {
                const module = e.target.dataset.module;
                const isChecked = e.target.checked;
                
                // Seleccionar/deseleccionar todos los permisos del módulo
                document.querySelectorAll(`.permission-check[data-module="${module}"]`).forEach(checkbox => {
                    checkbox.checked = isChecked;
                });
            });
        });
        
        // Eventos para checkboxes individuales
        document.querySelectorAll('.permission-check').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const module = e.target.dataset.module;
                
                // Verificar si todos los permisos del módulo están seleccionados
                const allChecks = document.querySelectorAll(`.permission-check[data-module="${module}"]`);
                const allChecked = Array.from(allChecks).every(check => check.checked);
                
                // Actualizar el estado del toggle del módulo
                document.getElementById(`module-${module.replace(/\s/g, '-')}`).checked = allChecked;
            });
        });
    };

    /**
     * Guarda los permisos asignados a un rol
     * @param {number} roleId - ID del rol
     */
    const saveRolePermissions = async (roleId) => {
        try {
            loadingOverlay(true, 'Guardando permisos...');
            
            // Obtener todos los checkboxes marcados
            const selectedPermissions = Array.from(
                document.querySelectorAll('.permission-check:checked')
            ).map(checkbox => parseInt(checkbox.value));
            
            // Iniciar transacción
            await database.beginTransaction();
            
            // Eliminar permisos actuales
            await database.query(`
                DELETE FROM rol_permisos WHERE rol_id = ?
            `, [roleId]);
            
            // Si hay permisos seleccionados, insertarlos
            if (selectedPermissions.length > 0) {
                // Crear consulta de inserción masiva
                const placeholders = selectedPermissions.map(() => '(?, ?)').join(', ');
                const values = [];
                
                selectedPermissions.forEach(permissionId => {
                    values.push(roleId, permissionId);
                });
                
                await database.query(`
                    INSERT INTO rol_permisos (rol_id, permiso_id)
                    VALUES ${placeholders}
                `, values);
            }
            
            // Confirmar transacción
            await database.commitTransaction();
            
            logger.info(`Permisos actualizados para rol ID ${roleId}. Permisos asignados: ${selectedPermissions.length}`);
            showNotification('success', 'Permisos actualizados correctamente');
            
            loadingOverlay(false);
        } catch (error) {
            // Revertir transacción en caso de error
            await database.rollbackTransaction();
            
            loadingOverlay(false);
            logger.error('Error al guardar permisos del rol', error);
            showNotification('error', 'Error al guardar los permisos');
        }
    };

    /**
     * Abre el módulo de roles en una nueva pestaña
     * @returns {Promise<void>}
     */
    const openRolesTab = async () => {
        try {
            // Verificar permisos
            if (!validatePermission('usuarios.roles.ver')) {
                showNotification('error', 'No tiene permisos para acceder a la gestión de roles');
                return;
            }
            
            // Abrir nueva pestaña
            await openTab({
                id: 'roles-tab',
                title: 'Gestión de Roles',
                icon: 'fa-user-tag',
                module: 'usuarios/roles',
                onLoad: initialize
            });
        } catch (error) {
            logger.error('Error al abrir pestaña de roles', error);
            showNotification('error', 'Error al abrir el módulo de roles');
        }
    };

    /**
     * Actualiza la interfaz y datos del módulo
     * @returns {Promise<void>}
     */
    const refresh = async () => {
        try {
            await Promise.all([
                loadRoles(),
                loadPermissions()
            ]);
        } catch (error) {
            logger.error('Error al actualizar el módulo de roles', error);
            showNotification('error', 'Error al actualizar los datos de roles');
        }
    };

    // API pública del módulo
    return {
        initialize,
        openRolesTab,
        refresh,
        loadRoles
    };
})();

 RolesModule

module.exports = RolesModule;