/**
 * app/assets/js/modules/sucursales/index.js
 * Módulo principal para la gestión de sucursales en FactuSystem
 * Maneja la visualización, configuración y sincronización de múltiples sucursales
 */

// Importaciones de módulos relacionados
import { createTab, activateTab, closeTab } from '../../components/tabs.js';
import { showNotification } from '../../components/notifications.js';
import { validateSucursalData } from '../../utils/validation.js';
import { getCurrentUser } from '../../utils/auth.js';
import { updateSyncStatus } from '../../utils/sync.js';
import { logActivity } from '../../utils/logger.js';
import { database } from '../../utils/database.js';
import { exportToPDF } from '../../utils/printer.js';
import { syncSucursales } from './sincronizacion.js';
import { editSucursal } from './editor.js';
import { configureSucursal } from './configuracion.js';
import * as backupService from '../../../services/backup/autoBackup.js';

// Estado global del módulo
const state = {
    sucursales: [],
    selectedSucursalId: null,
    currentSucursal: null,
    currentUser: null,
    filtros: {
        estado: 'todos',
        orderBy: 'nombre',
        direction: 'asc'
    },
    lastSyncTime: null
};

/**
 * Inicializa el módulo de sucursales
 * @param {String} tabId - ID de la pestaña donde se cargará el módulo
 */
export async function initSucursales(tabId) {
    try {
        // Obtener el usuario actual y sus permisos
        state.currentUser = await getCurrentUser();
        
        if (!checkUserPermissions()) {
            showNotification('No tienes permisos para acceder a este módulo', 'error');
            closeTab(tabId);
            return;
        }

        // Cargar el HTML del módulo de sucursales en la pestaña
        const sucursalesTab = document.getElementById(tabId);
        sucursalesTab.innerHTML = await loadSucursalesView();
        
        // Inicializar los listeners de eventos
        initEventListeners(tabId);
        
        // Cargar datos de sucursales
        await loadSucursales();
        
        // Verificar sincronización
        checkSynchronizationStatus();
        
        // Registrar actividad
        logActivity('Acceso al módulo de sucursales', { userId: state.currentUser.id });
    } catch (error) {
        console.error('Error al inicializar el módulo de sucursales:', error);
        showNotification('Error al cargar el módulo de sucursales', 'error');
    }
}

/**
 * Carga la vista HTML del módulo
 * @returns {Promise<string>} HTML de la vista
 */
async function loadSucursalesView() {
    try {
        const response = await fetch('../views/sucursales.html');
        return await response.text();
    } catch (error) {
        console.error('Error al cargar la vista de sucursales:', error);
        return '<div class="error-container">Error al cargar la vista de sucursales</div>';
    }
}

/**
 * Verifica los permisos del usuario para acceder al módulo
 * @returns {Boolean} True si tiene permisos, false en caso contrario
 */
function checkUserPermissions() {
    // Verificar si el usuario tiene permisos para el módulo de sucursales
    return state.currentUser && (
        state.currentUser.isAdmin || 
        state.currentUser.permissions.includes('sucursales.view')
    );
}

/**
 * Inicializa todos los event listeners del módulo
 * @param {String} tabId - ID de la pestaña
 */
function initEventListeners(tabId) {
    // Botón para crear nueva sucursal
    document.getElementById('btn-nueva-sucursal').addEventListener('click', () => {
        crearNuevaSucursal(tabId);
    });
    
    // Filtros de búsqueda
    document.getElementById('sucursal-filtro-estado').addEventListener('change', (e) => {
        state.filtros.estado = e.target.value;
        renderSucursales();
    });
    
    // Ordenamiento
    document.getElementById('sucursal-orderby').addEventListener('change', (e) => {
        state.filtros.orderBy = e.target.value;
        renderSucursales();
    });
    
    // Dirección de ordenamiento
    document.getElementById('sucursal-direction').addEventListener('change', (e) => {
        state.filtros.direction = e.target.value;
        renderSucursales();
    });
    
    // Botón de sincronización manual
    document.getElementById('btn-sincronizar-sucursales').addEventListener('click', () => {
        sincronizarSucursales();
    });
    
    // Botón de exportar reporte
    document.getElementById('btn-exportar-sucursales').addEventListener('click', () => {
        exportarReporteSucursales();
    });
    
    // Campo de búsqueda
    document.getElementById('sucursal-search').addEventListener('input', (e) => {
        buscarSucursales(e.target.value);
    });
}

/**
 * Carga los datos de sucursales desde la base de datos
 */
async function loadSucursales() {
    try {
        // Obtener la sucursal actual del usuario
        const currentSucursalId = localStorage.getItem('currentSucursalId');
        
        // Consulta de sucursales
        state.sucursales = await database.getSucursales();
        
        // Encontrar la sucursal actual en la lista
        if (currentSucursalId) {
            state.currentSucursal = state.sucursales.find(s => s.id === parseInt(currentSucursalId));
        }
        
        // Actualizar última sincronización
        state.lastSyncTime = localStorage.getItem('lastSucursalSync') 
            ? new Date(localStorage.getItem('lastSucursalSync')) 
            : null;
        
        // Renderizar la lista de sucursales
        renderSucursales();
        
        // Mostrar estados de sincronización
        updateSyncStatusIndicators();
    } catch (error) {
        console.error('Error al cargar sucursales:', error);
        showNotification('Error al cargar datos de sucursales', 'error');
    }
}

/**
 * Renderiza la lista de sucursales en el DOM
 */
function renderSucursales() {
    const sucursalesTable = document.getElementById('sucursales-table-body');
    if (!sucursalesTable) return;
    
    // Filtra las sucursales según los criterios seleccionados
    let sucursalesFiltradas = [...state.sucursales];
    
    // Aplicar filtro por estado
    if (state.filtros.estado !== 'todos') {
        sucursalesFiltradas = sucursalesFiltradas.filter(s => s.estado === state.filtros.estado);
    }
    
    // Aplicar ordenamiento
    sucursalesFiltradas.sort((a, b) => {
        const factor = state.filtros.direction === 'asc' ? 1 : -1;
        
        if (state.filtros.orderBy === 'nombre') {
            return a.nombre.localeCompare(b.nombre) * factor;
        } else if (state.filtros.orderBy === 'creacion') {
            return (new Date(a.fechaCreacion) - new Date(b.fechaCreacion)) * factor;
        } else if (state.filtros.orderBy === 'ultimaSync') {
            const aSync = a.ultimaSincronizacion ? new Date(a.ultimaSincronizacion) : new Date(0);
            const bSync = b.ultimaSincronizacion ? new Date(b.ultimaSincronizacion) : new Date(0);
            return (aSync - bSync) * factor;
        }
        
        return 0;
    });
    
    // Limpiar tabla
    sucursalesTable.innerHTML = '';
    
    // Generar filas de la tabla
    sucursalesFiltradas.forEach(sucursal => {
        const row = document.createElement('tr');
        
        // Destacar la sucursal actual
        if (state.currentSucursal && sucursal.id === state.currentSucursal.id) {
            row.classList.add('sucursal-actual');
        }
        
        // Añadir clases según estado de sincronización
        if (sucursal.estadoSincronizacion === 'pendiente') {
            row.classList.add('sync-pending');
        } else if (sucursal.estadoSincronizacion === 'error') {
            row.classList.add('sync-error');
        }
        
        // Formatear fecha de última sincronización
        const ultimaSync = sucursal.ultimaSincronizacion 
            ? new Date(sucursal.ultimaSincronizacion).toLocaleString() 
            : 'Nunca';
        
        // Formatear fecha de creación
        const fechaCreacion = new Date(sucursal.fechaCreacion).toLocaleDateString();
        
        // Datos de la sucursal
        row.innerHTML = `
            <td>${sucursal.nombre}</td>
            <td>${sucursal.direccion}</td>
            <td>${sucursal.telefono || '-'}</td>
            <td>${sucursal.responsable || '-'}</td>
            <td>${fechaCreacion}</td>
            <td class="estado-sync ${sucursal.estadoSincronizacion}">${sucursal.estadoSincronizacion}</td>
            <td>${ultimaSync}</td>
            <td class="actions">
                <button class="btn-editar" data-id="${sucursal.id}" title="Editar sucursal">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn-config" data-id="${sucursal.id}" title="Configuración">
                    <i class="fas fa-cog"></i>
                </button>
                <button class="btn-sync" data-id="${sucursal.id}" title="Sincronizar">
                    <i class="fas fa-sync-alt"></i>
                </button>
                ${
                    sucursal.id !== state.currentSucursal?.id ?
                    `<button class="btn-select" data-id="${sucursal.id}" title="Seleccionar sucursal">
                        <i class="fas fa-check-circle"></i>
                    </button>` : ''
                }
                ${
                    sucursal.id !== state.currentSucursal?.id && checkUserPermissions('sucursales.delete') ?
                    `<button class="btn-delete" data-id="${sucursal.id}" title="Eliminar sucursal">
                        <i class="fas fa-trash-alt"></i>
                    </button>` : ''
                }
            </td>
        `;
        
        // Añadir eventos a los botones de acciones
        row.querySelectorAll('.btn-editar').forEach(btn => {
            btn.addEventListener('click', () => editarSucursal(btn.getAttribute('data-id')));
        });
        
        row.querySelectorAll('.btn-config').forEach(btn => {
            btn.addEventListener('click', () => configurarSucursal(btn.getAttribute('data-id')));
        });
        
        row.querySelectorAll('.btn-sync').forEach(btn => {
            btn.addEventListener('click', () => sincronizarSucursalIndividual(btn.getAttribute('data-id')));
        });
        
        row.querySelectorAll('.btn-select').forEach(btn => {
            btn.addEventListener('click', () => seleccionarSucursal(btn.getAttribute('data-id')));
        });
        
        row.querySelectorAll('.btn-delete').forEach(btn => {
            btn.addEventListener('click', () => eliminarSucursal(btn.getAttribute('data-id')));
        });
        
        sucursalesTable.appendChild(row);
    });
    
    // Actualizar contador de sucursales
    document.getElementById('sucursal-count').textContent = sucursalesFiltradas.length;
}

/**
 * Crear una nueva sucursal
 * @param {String} tabId - ID de la pestaña actual
 */
async function crearNuevaSucursal(tabId) {
    if (!checkUserPermissions('sucursales.create')) {
        showNotification('No tienes permisos para crear sucursales', 'error');
        return;
    }
    
    try {
        // Abrir una nueva pestaña para el editor de sucursales
        const newTabId = await createTab('Nueva Sucursal', 'sucursal-editor');
        
        // Inicializar el editor con datos vacíos
        await editSucursal(newTabId, null);
        
        // Activar la pestaña recién creada
        activateTab(newTabId);
    } catch (error) {
        console.error('Error al crear nueva sucursal:', error);
        showNotification('Error al abrir el editor de sucursales', 'error');
    }
}

/**
 * Editar una sucursal existente
 * @param {String|Number} sucursalId - ID de la sucursal a editar
 */
async function editarSucursal(sucursalId) {
    if (!checkUserPermissions('sucursales.edit')) {
        showNotification('No tienes permisos para editar sucursales', 'error');
        return;
    }
    
    try {
        // Obtener la sucursal por ID
        const sucursal = state.sucursales.find(s => s.id === parseInt(sucursalId));
        
        if (!sucursal) {
            showNotification('Sucursal no encontrada', 'error');
            return;
        }
        
        // Abrir una nueva pestaña con el editor
        const tabId = await createTab(`Editar Sucursal: ${sucursal.nombre}`, 'sucursal-editor');
        
        // Inicializar el editor con los datos de la sucursal
        await editSucursal(tabId, sucursal);
        
        // Activar la pestaña recién creada
        activateTab(tabId);
    } catch (error) {
        console.error('Error al editar sucursal:', error);
        showNotification('Error al abrir el editor de sucursales', 'error');
    }
}

/**
 * Configurar una sucursal existente
 * @param {String|Number} sucursalId - ID de la sucursal a configurar
 */
async function configurarSucursal(sucursalId) {
    if (!checkUserPermissions('sucursales.config')) {
        showNotification('No tienes permisos para configurar sucursales', 'error');
        return;
    }
    
    try {
        // Obtener la sucursal por ID
        const sucursal = state.sucursales.find(s => s.id === parseInt(sucursalId));
        
        if (!sucursal) {
            showNotification('Sucursal no encontrada', 'error');
            return;
        }
        
        // Abrir una nueva pestaña con el configurador
        const tabId = await createTab(`Configurar Sucursal: ${sucursal.nombre}`, 'sucursal-config');
        
        // Inicializar el configurador con los datos de la sucursal
        await configureSucursal(tabId, sucursal);
        
        // Activar la pestaña recién creada
        activateTab(tabId);
    } catch (error) {
        console.error('Error al configurar sucursal:', error);
        showNotification('Error al abrir el configurador de sucursales', 'error');
    }
}

/**
 * Seleccionar una sucursal como la actual
 * @param {String|Number} sucursalId - ID de la sucursal a seleccionar
 */
async function seleccionarSucursal(sucursalId) {
    try {
        // Obtener la sucursal
        const sucursal = state.sucursales.find(s => s.id === parseInt(sucursalId));
        
        if (!sucursal) {
            showNotification('Sucursal no encontrada', 'error');
            return;
        }
        
        // Mostrar modal de confirmación
        if (!confirm(`¿Estás seguro de cambiar a la sucursal "${sucursal.nombre}"? Se cerrará la sesión actual y se deberá iniciar sesión nuevamente.`)) {
            return;
        }
        
        // Actualizar sucursal actual en localStorage
        localStorage.setItem('currentSucursalId', sucursal.id);
        
        // Registrar actividad
        logActivity('Cambio de sucursal', { 
            userId: state.currentUser.id,
            fromSucursal: state.currentSucursal?.id,
            toSucursal: sucursal.id
        });
        
        // Recargar la aplicación
        showNotification('Cambiando a sucursal: ' + sucursal.nombre, 'info');
        setTimeout(() => {
            window.location.reload();
        }, 1500);
    } catch (error) {
        console.error('Error al seleccionar sucursal:', error);
        showNotification('Error al cambiar de sucursal', 'error');
    }
}

/**
 * Eliminar una sucursal
 * @param {String|Number} sucursalId - ID de la sucursal a eliminar
 */
async function eliminarSucursal(sucursalId) {
    if (!checkUserPermissions('sucursales.delete')) {
        showNotification('No tienes permisos para eliminar sucursales', 'error');
        return;
    }
    
    try {
        // Obtener la sucursal
        const sucursal = state.sucursales.find(s => s.id === parseInt(sucursalId));
        
        if (!sucursal) {
            showNotification('Sucursal no encontrada', 'error');
            return;
        }
        
        // Comprobar que no sea la sucursal actual
        if (state.currentSucursal && sucursal.id === state.currentSucursal.id) {
            showNotification('No puedes eliminar la sucursal actual', 'error');
            return;
        }
        
        // Mostrar modal de confirmación con doble verificación
        if (!confirm(`¿Estás seguro de eliminar la sucursal "${sucursal.nombre}"? Esta acción NO se puede deshacer.`)) {
            return;
        }
        
        const confirmName = prompt(`Para confirmar, escribe el nombre de la sucursal: "${sucursal.nombre}"`);
        if (confirmName !== sucursal.nombre) {
            showNotification('Nombre de sucursal incorrecto. Operación cancelada.', 'warning');
            return;
        }
        
        // Realizar un respaldo antes de eliminar
        await backupService.createBackup(`pre_delete_sucursal_${sucursal.id}`);
        
        // Eliminar la sucursal
        await database.deleteSucursal(sucursal.id);
        
        // Registrar actividad
        logActivity('Eliminación de sucursal', { 
            userId: state.currentUser.id,
            sucursalId: sucursal.id,
            sucursalName: sucursal.nombre
        });
        
        // Actualizar lista de sucursales
        await loadSucursales();
        
        showNotification(`Sucursal "${sucursal.nombre}" eliminada correctamente`, 'success');
    } catch (error) {
        console.error('Error al eliminar sucursal:', error);
        showNotification('Error al eliminar la sucursal', 'error');
    }
}

/**
 * Buscar sucursales por texto
 * @param {String} searchText - Texto de búsqueda
 */
function buscarSucursales(searchText) {
    if (!searchText || searchText.trim() === '') {
        loadSucursales(); // Recargar todas si no hay texto de búsqueda
        return;
    }
    
    const searchLower = searchText.toLowerCase().trim();
    
    // Filtrar sucursales por el texto de búsqueda
    const sucursalesFiltradas = state.sucursales.filter(sucursal => 
        sucursal.nombre.toLowerCase().includes(searchLower) ||
        sucursal.direccion.toLowerCase().includes(searchLower) ||
        (sucursal.responsable && sucursal.responsable.toLowerCase().includes(searchLower)) ||
        (sucursal.telefono && sucursal.telefono.includes(searchLower))
    );
    
    // Actualizar la lista de sucursales filtradas temporalmente
    const sucursalesOriginales = [...state.sucursales];
    state.sucursales = sucursalesFiltradas;
    
    // Renderizar la tabla filtrada
    renderSucursales();
    
    // Restaurar la lista original (para cuando se borre el texto de búsqueda)
    state.sucursales = sucursalesOriginales;
}

/**
 * Sincronizar todas las sucursales
 */
async function sincronizarSucursales() {
    if (!checkUserPermissions('sucursales.sync')) {
        showNotification('No tienes permisos para sincronizar sucursales', 'error');
        return;
    }
    
    try {
        // Mostrar mensaje de sincronización
        showNotification('Iniciando sincronización de sucursales...', 'info');
        
        // Actualizar UI para mostrar que está sincronizando
        document.getElementById('btn-sincronizar-sucursales').disabled = true;
        document.getElementById('sync-status').classList.add('syncing');
        
        // Llamar al servicio de sincronización
        const result = await syncSucursales();
        
        // Actualizar el estado de sincronización
        state.lastSyncTime = new Date();
        localStorage.setItem('lastSucursalSync', state.lastSyncTime.toISOString());
        
        // Actualizar la UI
        document.getElementById('btn-sincronizar-sucursales').disabled = false;
        document.getElementById('sync-status').classList.remove('syncing');
        updateSyncStatusIndicators();
        
        // Recargar sucursales para reflejar cambios
        await loadSucursales();
        
        // Mostrar resultado
        if (result.success) {
            showNotification(`Sincronización completada. Sucursales sincronizadas: ${result.syncedCount}`, 'success');
        } else {
            showNotification(`Sincronización parcial. Errores: ${result.errors}`, 'warning');
        }
    } catch (error) {
        console.error('Error al sincronizar sucursales:', error);
        document.getElementById('btn-sincronizar-sucursales').disabled = false;
        document.getElementById('sync-status').classList.remove('syncing');
        showNotification('Error al sincronizar sucursales', 'error');
    }
}

/**
 * Sincronizar una sucursal individual
 * @param {String|Number} sucursalId - ID de la sucursal a sincronizar
 */
async function sincronizarSucursalIndividual(sucursalId) {
    if (!checkUserPermissions('sucursales.sync')) {
        showNotification('No tienes permisos para sincronizar sucursales', 'error');
        return;
    }
    
    try {
        // Obtener la sucursal
        const sucursal = state.sucursales.find(s => s.id === parseInt(sucursalId));
        
        if (!sucursal) {
            showNotification('Sucursal no encontrada', 'error');
            return;
        }
        
        // Mostrar mensaje de sincronización
        showNotification(`Sincronizando sucursal "${sucursal.nombre}"...`, 'info');
        
        // Actualizar UI para mostrar que está sincronizando
        const btnSync = document.querySelector(`.btn-sync[data-id="${sucursalId}"]`);
        if (btnSync) {
            btnSync.disabled = true;
            btnSync.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        }
        
        // Llamar al servicio de sincronización individual
        const result = await syncSucursales([sucursal.id]);
        
        // Actualizar UI
        if (btnSync) {
            btnSync.disabled = false;
            btnSync.innerHTML = '<i class="fas fa-sync-alt"></i>';
        }
        
        // Recargar sucursales para reflejar cambios
        await loadSucursales();
        
        // Mostrar resultado
        if (result.success) {
            showNotification(`Sucursal "${sucursal.nombre}" sincronizada correctamente`, 'success');
        } else {
            showNotification(`Error al sincronizar sucursal "${sucursal.nombre}"`, 'error');
        }
    } catch (error) {
        console.error('Error al sincronizar sucursal individual:', error);
        showNotification('Error al sincronizar la sucursal', 'error');
        
        // Restaurar botón
        const btnSync = document.querySelector(`.btn-sync[data-id="${sucursalId}"]`);
        if (btnSync) {
            btnSync.disabled = false;
            btnSync.innerHTML = '<i class="fas fa-sync-alt"></i>';
        }
    }
}

/**
 * Verificar el estado de sincronización
 */
function checkSynchronizationStatus() {
    // Comprobar última sincronización
    const lastSyncTime = state.lastSyncTime;
    const now = new Date();
    
    // Si nunca se ha sincronizado o han pasado más de 12 horas
    if (!lastSyncTime || (now - lastSyncTime) > (12 * 60 * 60 * 1000)) {
        document.getElementById('sync-status').classList.add('warning');
        document.getElementById('sync-status-text').textContent = 'Sincronización pendiente';
    } else {
        document.getElementById('sync-status').classList.remove('warning');
        document.getElementById('sync-status-text').textContent = 'Sincronización OK';
    }
    
    // Actualizar información de última sincronización
    if (lastSyncTime) {
        document.getElementById('last-sync-time').textContent = lastSyncTime.toLocaleString();
    } else {
        document.getElementById('last-sync-time').textContent = 'Nunca';
    }
}

/**
 * Actualizar indicadores de estado de sincronización
 */
function updateSyncStatusIndicators() {
    // Actualizar el contador de sucursales con problemas de sincronización
    const sucursalesConProblemas = state.sucursales.filter(s => 
        s.estadoSincronizacion === 'error' || s.estadoSincronizacion === 'pendiente'
    );
    
    const syncProblemCount = document.getElementById('sync-problem-count');
    if (syncProblemCount) {
        syncProblemCount.textContent = sucursalesConProblemas.length.toString();
        
        if (sucursalesConProblemas.length > 0) {
            syncProblemCount.classList.add('warning');
        } else {
            syncProblemCount.classList.remove('warning');
        }
    }
    
    // Actualizar la información de última sincronización
    if (state.lastSyncTime) {
        const lastSyncEl = document.getElementById('last-sync-time');
        if (lastSyncEl) {
            lastSyncEl.textContent = state.lastSyncTime.toLocaleString();
        }
    }
}

/**
 * Exportar reporte de sucursales en PDF
 */
async function exportarReporteSucursales() {
    try {
        // Generar datos para el reporte
        const reportData = {
            title: 'Reporte de Sucursales',
            date: new Date().toLocaleString(),
            user: state.currentUser.nombre,
            sucursales: state.sucursales.map(s => ({
                nombre: s.nombre,
                direccion: s.direccion,
                telefono: s.telefono || '-',
                responsable: s.responsable || '-',
                fechaCreacion: new Date(s.fechaCreacion).toLocaleDateString(),
                estadoSincronizacion: s.estadoSincronizacion,
                ultimaSincronizacion: s.ultimaSincronizacion 
                    ? new Date(s.ultimaSincronizacion).toLocaleString() 
                    : 'Nunca'
            }))
        };
        
        // Generar y descargar el PDF
        await exportToPDF('sucursales', reportData, 'Reporte_Sucursales.pdf');
        
        showNotification('Reporte de sucursales exportado correctamente', 'success');
    } catch (error) {
        console.error('Error al exportar reporte de sucursales:', error);
        showNotification('Error al exportar reporte', 'error');
    }
}

/**
 * Verificar si el usuario tiene un permiso específico
 * @param {String} permission - Permiso a verificar
 * @returns {Boolean} True si tiene el permiso, false en caso contrario
 */
function checkUserPermissions(permission = null) {
    // Si no se especifica permiso, verificar acceso general
    if (!permission) {
        return state.currentUser && (
            state.currentUser.isAdmin || 
            state.currentUser.permissions.includes('sucursales.view')
        );
    }
    
    // Verificar permiso específico
    return state.currentUser && (
        state.currentUser.isAdmin || 
        state.currentUser.permissions.includes(permission)
    );
}

/**
 * Actualizar el módulo de sucursales después de una operación externa
 * @param {Object} data - Datos de actualización
 */
export async function updateSucursalesModule(data = {}) {
    // Si se especifica una sucursal, actualizar solo esa
    if (data.sucursalId) {
        const sucursalIndex = state.sucursales.findIndex(s => s.id === parseInt(data.sucursalId));
        
        if (sucursalIndex >= 0) {
            // Actualizar la sucursal individual
            const updatedSucursal = await database.getSucursal(data.sucursalId);
            
            if (updatedSucursal) {
                state.sucursales[sucursalIndex] = updatedSucursal;
                renderSucursales();
            }
        }
    } else {
        // Si no hay ID específica, recargar todas las sucursales
        await loadSucursales();
    }
    
    // Si se especifica que hubo una sincronización
    if (data.syncOcurred) {
        state.lastSyncTime = new Date();
        localStorage.setItem('lastSucursalSync', state.lastSyncTime.toISOString());
        updateSyncStatusIndicators();
    }
    
    // Actualizar indicadores de estado
    checkSynchronizationStatus();
}

/**
 * Maneja los cambios en el estado de conectividad online/offline
 * @param {Boolean} isOnline - Estado de conectividad
 */
export function handleConnectivityChange(isOnline) {
    const syncControls = document.getElementById('sync-controls');
    const offlineIndicator = document.getElementById('offline-indicator');
    
    if (!syncControls || !offlineIndicator) return;
    
    if (isOnline) {
        // En línea: habilitar controles de sincronización
        document.getElementById('btn-sincronizar-sucursales').disabled = false;
        offlineIndicator.classList.remove('active');
        
        // Verificar si hay cambios pendientes de sincronizar
        checkPendingSyncChanges();
    } else {
        // Fuera de línea: deshabilitar controles de sincronización
        document.getElementById('btn-sincronizar-sucursales').disabled = true;
        offlineIndicator.classList.add('active');
    }
}

/**
 * Comprueba si hay cambios pendientes de sincronizar
 */
async function checkPendingSyncChanges() {
    try {
        // Obtener cambios pendientes en la base de datos local
        const pendingChanges = await database.getPendingSyncChanges();
        
        // Actualizar UI según los cambios pendientes
        const pendingBadge = document.getElementById('pending-changes-badge');
        
        if (pendingChanges.length > 0) {
            pendingBadge.textContent = pendingChanges.length;
            pendingBadge.classList.add('active');
            
            // Notificar solo si es la primera vez que se detectan cambios
            if (!state.pendingChangesNotified) {
                showNotification(`Hay ${pendingChanges.length} cambios pendientes de sincronizar`, 'warning');
                state.pendingChangesNotified = true;
            }
        } else {
            pendingBadge.textContent = '0';
            pendingBadge.classList.remove('active');
            state.pendingChangesNotified = false;
        }
    } catch (error) {
        console.error('Error al verificar cambios pendientes:', error);
    }
}

/**
 * Actualiza el estado de conexión con el servidor central
 */
export async function updateServerConnectionStatus() {
    try {
        // Intentar conectar con el servidor central
        const serverStatus = await checkServerConnection();
        
        // Actualizar indicador en la UI
        const serverStatusIndicator = document.getElementById('server-status');
        const serverStatusText = document.getElementById('server-status-text');
        
        if (!serverStatusIndicator || !serverStatusText) return;
        
        if (serverStatus.connected) {
            serverStatusIndicator.classList.remove('error');
            serverStatusIndicator.classList.add('success');
            serverStatusText.textContent = 'Conectado';
            
            // Si hay conexión con el servidor, habilitar sincronización
            document.getElementById('btn-sincronizar-sucursales').disabled = false;
        } else {
            serverStatusIndicator.classList.remove('success');
            serverStatusIndicator.classList.add('error');
            serverStatusText.textContent = 'Desconectado';
            
            // Si no hay conexión, deshabilitar sincronización
            document.getElementById('btn-sincronizar-sucursales').disabled = true;
            
            // Mostrar mensaje solo si es la primera vez que se detecta
            if (!state.serverConnectionError) {
                showNotification('Error de conexión con el servidor central', 'error');
                state.serverConnectionError = true;
            }
        }
    } catch (error) {
        console.error('Error al verificar conexión con servidor:', error);
        
        // Actualizar UI para mostrar error
        const serverStatusIndicator = document.getElementById('server-status');
        const serverStatusText = document.getElementById('server-status-text');
        
        if (serverStatusIndicator && serverStatusText) {
            serverStatusIndicator.classList.remove('success');
            serverStatusIndicator.classList.add('error');
            serverStatusText.textContent = 'Error';
        }
    }
}

/**
 * Comprueba la conexión con el servidor central
 * @returns {Promise<Object>} Estado de la conexión
 */
async function checkServerConnection() {
    try {
        // Obtener URL del servidor configurada
        const config = await database.getConfiguracion('server');
        const serverUrl = config?.serverUrl || 'https://api.factusystem.com';
        
        // Intentar ping al servidor
        const response = await fetch(`${serverUrl}/api/ping`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'X-Sucursal-ID': state.currentSucursal?.id.toString() || '0',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            // Timeout corto para no bloquear la interfaz
            signal: AbortSignal.timeout(5000)
        });
        
        if (response.ok) {
            const data = await response.json();
            return { 
                connected: true, 
                serverTime: data.serverTime,
                version: data.version
            };
        }
        
        return { connected: false, error: 'Error de respuesta del servidor' };
    } catch (error) {
        console.error('Error al verificar conexión:', error);
        return { connected: false, error: error.message };
    }
}

/**
 * Inicia un intervalo para comprobar la sincronización automáticamente
 */
export function startSyncCheckInterval() {
    // Comprobar cada 5 minutos
    setInterval(() => {
        if (document.visibilityState === 'visible') {
            checkSynchronizationStatus();
            updateServerConnectionStatus();
        }
    }, 5 * 60 * 1000);
    
    // Comprobar cuando la ventana vuelve a estar activa
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            checkSynchronizationStatus();
            updateServerConnectionStatus();
        }
    });
    
    // Comprobar cambios en la conectividad
    window.addEventListener('online', () => handleConnectivityChange(true));
    window.addEventListener('offline', () => handleConnectivityChange(false));
}

/**
 * Resuelve conflictos de sincronización para una sucursal
 * @param {String|Number} sucursalId - ID de la sucursal con conflictos
 */
async function resolverConflictosSincronizacion(sucursalId) {
    if (!checkUserPermissions('sucursales.sync')) {
        showNotification('No tienes permisos para resolver conflictos de sincronización', 'error');
        return;
    }
    
    try {
        // Obtener la sucursal
        const sucursal = state.sucursales.find(s => s.id === parseInt(sucursalId));
        
        if (!sucursal) {
            showNotification('Sucursal no encontrada', 'error');
            return;
        }
        
        // Verificar si hay conflictos pendientes
        const conflicts = await database.getSyncConflicts(sucursalId);
        
        if (!conflicts || conflicts.length === 0) {
            showNotification('No hay conflictos pendientes para esta sucursal', 'info');
            return;
        }
        
        // Crear pestaña para resolver conflictos
        const tabId = await createTab(`Conflictos - ${sucursal.nombre}`, 'sync-conflicts');
        
        // Cargar la vista para resolver conflictos
        const conflictsTab = document.getElementById(tabId);
        conflictsTab.innerHTML = await loadConflictsView();
        
        // Inicializar la vista con los conflictos
        await initConflictResolutionView(tabId, sucursal, conflicts);
        
        // Activar la pestaña
        activateTab(tabId);
    } catch (error) {
        console.error('Error al resolver conflictos:', error);
        showNotification('Error al cargar la vista de resolución de conflictos', 'error');
    }
}

/**
 * Carga la vista para resolver conflictos
 * @returns {Promise<string>} HTML para la vista
 */
async function loadConflictsView() {
    try {
        const response = await fetch('../views/sync-conflicts.html');
        return await response.text();
    } catch (error) {
        console.error('Error al cargar vista de conflictos:', error);
        return '<div class="error-container">Error al cargar la vista de resolución de conflictos</div>';
    }
}

/**
 * Inicializa la vista de resolución de conflictos
 * @param {String} tabId - ID de la pestaña
 * @param {Object} sucursal - Sucursal con conflictos
 * @param {Array} conflicts - Lista de conflictos
 */
async function initConflictResolutionView(tabId, sucursal, conflicts) {
    const container = document.getElementById(tabId);
    
    // Configurar encabezado
    const header = container.querySelector('.conflict-header');
    if (header) {
        header.innerHTML = `
            <h2>Resolución de conflictos - ${sucursal.nombre}</h2>
            <p>Se encontraron ${conflicts.length} conflictos de sincronización que requieren resolución manual.</p>
        `;
    }
    
    // Configurar lista de conflictos
    const conflictsList = container.querySelector('.conflicts-list');
    if (conflictsList) {
        conflicts.forEach((conflict, index) => {
            // Crear elemento para el conflicto
            const conflictElement = document.createElement('div');
            conflictElement.className = 'conflict-item';
            conflictElement.innerHTML = `
                <div class="conflict-header">
                    <span class="conflict-number">#${index + 1}</span>
                    <span class="conflict-type">${conflict.entityType}</span>
                    <span class="conflict-id">ID: ${conflict.entityId}</span>
                    <span class="conflict-date">${new Date(conflict.detectedAt).toLocaleString()}</span>
                </div>
                <div class="conflict-content">
                    <div class="conflict-local">
                        <h4>Datos locales</h4>
                        <pre>${JSON.stringify(conflict.localData, null, 2)}</pre>
                    </div>
                    <div class="conflict-remote">
                        <h4>Datos del servidor</h4>
                        <pre>${JSON.stringify(conflict.remoteData, null, 2)}</pre>
                    </div>
                </div>
                <div class="conflict-actions">
                    <button class="btn btn-primary use-local" data-conflict-id="${conflict.id}">
                        Usar datos locales
                    </button>
                    <button class="btn btn-secondary use-remote" data-conflict-id="${conflict.id}">
                        Usar datos del servidor
                    </button>
                    <button class="btn btn-merge" data-conflict-id="${conflict.id}">
                        Combinar
                    </button>
                </div>
            `;
            
            // Añadir manejadores de eventos
            conflictElement.querySelector('.use-local').addEventListener('click', () => {
                resolveConflict(conflict.id, 'local');
            });
            
            conflictElement.querySelector('.use-remote').addEventListener('click', () => {
                resolveConflict(conflict.id, 'remote');
            });
            
            conflictElement.querySelector('.btn-merge').addEventListener('click', () => {
                openMergeDialog(conflict);
            });
            
            // Añadir a la lista
            conflictsList.appendChild(conflictElement);
        });
        
        // Botón para resolver todos los conflictos
        const resolveAllButton = document.createElement('button');
        resolveAllButton.className = 'btn btn-lg btn-primary resolve-all';
        resolveAllButton.textContent = 'Resolver todos usando servidor';
        resolveAllButton.addEventListener('click', () => {
            resolveAllConflicts(conflicts, sucursal.id);
        });
        
        conflictsList.appendChild(resolveAllButton);
    }
}

/**
 * Resuelve un conflicto individual
 * @param {String|Number} conflictId - ID del conflicto
 * @param {String} resolution - Tipo de resolución ('local', 'remote', 'merged')
 * @param {Object} mergedData - Datos combinados (solo para 'merged')
 */
async function resolveConflict(conflictId, resolution, mergedData = null) {
    try {
        let resolutionData = null;
        
        if (resolution === 'merged' && mergedData) {
            resolutionData = mergedData;
        }
        
        // Enviar resolución a la base de datos
        await database.resolveSyncConflict(conflictId, resolution, resolutionData);
        
        // Actualizar UI
        const conflictElement = document.querySelector(`.conflict-item [data-conflict-id="${conflictId}"]`).closest('.conflict-item');
        conflictElement.classList.add('resolved');
        conflictElement.innerHTML = `
            <div class="conflict-resolved">
                <i class="fas fa-check-circle"></i>
                <span>Conflicto resuelto utilizando datos ${
                    resolution === 'local' ? 'locales' : 
                    resolution === 'remote' ? 'del servidor' : 
                    'combinados'
                }</span>
            </div>
        `;
        
        showNotification('Conflicto resuelto correctamente', 'success');
        
        // Comprobar si todos los conflictos están resueltos
        const pendingConflicts = document.querySelectorAll('.conflict-item:not(.resolved)');
        if (pendingConflicts.length === 0) {
            // Si todos están resueltos, habilitar sincronización
            document.querySelector('.conflicts-resolved-actions').classList.add('active');
        }
    } catch (error) {
        console.error('Error al resolver conflicto:', error);
        showNotification('Error al resolver el conflicto', 'error');
    }
}

/**
 * Resuelve todos los conflictos de una sucursal
 * @param {Array} conflicts - Lista de conflictos
 * @param {String|Number} sucursalId - ID de la sucursal
 */
async function resolveAllConflicts(conflicts, sucursalId) {
    try {
        // Confirmar acción
        if (!confirm('¿Estás seguro de resolver todos los conflictos utilizando los datos del servidor? Esta acción no se puede deshacer.')) {
            return;
        }
        
        // Mostrar loader
        showNotification('Resolviendo conflictos...', 'info');
        
        // Resolver todos los conflictos
        await database.resolveAllSyncConflicts(sucursalId, 'remote');
        
        // Actualizar UI
        document.querySelectorAll('.conflict-item').forEach(item => {
            item.classList.add('resolved');
            item.innerHTML = `
                <div class="conflict-resolved">
                    <i class="fas fa-check-circle"></i>
                    <span>Conflicto resuelto utilizando datos del servidor</span>
                </div>
            `;
        });
        
        // Habilitar botón de sincronización
        document.querySelector('.conflicts-resolved-actions').classList.add('active');
        
        showNotification('Todos los conflictos han sido resueltos', 'success');
    } catch (error) {
        console.error('Error al resolver todos los conflictos:', error);
        showNotification('Error al resolver los conflictos', 'error');
    }
}

/**
 * Abre un diálogo para combinar datos en conflicto
 * @param {Object} conflict - Conflicto a resolver
 */
function openMergeDialog(conflict) {
    try {
        // Crear modal para combinar datos
        const modalId = `merge-modal-${conflict.id}`;
        
        // Verificar si ya existe el modal
        let modalElement = document.getElementById(modalId);
        
        if (!modalElement) {
            // Crear modal si no existe
            modalElement = document.createElement('div');
            modalElement.id = modalId;
            modalElement.className = 'modal merge-modal';
            
            // Generar contenido del modal
            modalElement.innerHTML = `
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>Combinar datos en conflicto</h3>
                        <span class="close-modal">&times;</span>
                    </div>
                    <div class="modal-body">
                        <p>Seleccione los campos que desea mantener de cada versión:</p>
                        <div class="merge-fields">
                            ${generateMergeFieldsHTML(conflict)}
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-secondary" data-action="cancel">Cancelar</button>
                        <button class="btn btn-primary" data-action="apply">Aplicar combinación</button>
                    </div>
                </div>
            `;
            
            // Añadir el modal al DOM
            document.body.appendChild(modalElement);
            
            // Eventos del modal
            modalElement.querySelector('.close-modal').addEventListener('click', () => {
                modalElement.style.display = 'none';
            });
            
            modalElement.querySelector('[data-action="cancel"]').addEventListener('click', () => {
                modalElement.style.display = 'none';
            });
            
            modalElement.querySelector('[data-action="apply"]').addEventListener('click', () => {
                // Recopilar datos combinados
                const mergedData = collectMergedData(modalElement, conflict);
                
                // Resolver conflicto con datos combinados
                resolveConflict(conflict.id, 'merged', mergedData);
                
                // Cerrar modal
                modalElement.style.display = 'none';
            });
            
            // Cerrar si se hace clic fuera del contenido
            window.addEventListener('click', (event) => {
                if (event.target === modalElement) {
                    modalElement.style.display = 'none';
                }
            });
        }
        
        // Mostrar el modal
        modalElement.style.display = 'block';
    } catch (error) {
        console.error('Error al abrir diálogo de combinación:', error);
        showNotification('Error al abrir el diálogo de combinación', 'error');
    }
}

/**
 * Genera HTML para los campos a combinar
 * @param {Object} conflict - Conflicto a resolver
 * @returns {String} HTML para campos
 */
function generateMergeFieldsHTML(conflict) {
    // Obtener todos los campos de ambas versiones
    const localData = conflict.localData;
    const remoteData = conflict.remoteData;
    
    // Combinar claves
    const allKeys = new Set([
        ...Object.keys(localData || {}), 
        ...Object.keys(remoteData || {})
    ]);
    
    let fieldsHTML = '';
    
    // Generar HTML para cada campo
    for (const key of allKeys) {
        const localValue = localData && localData[key] !== undefined ? localData[key] : null;
        const remoteValue = remoteData && remoteData[key] !== undefined ? remoteData[key] : null;
        
        // Determinar si los valores son diferentes
        const isDifferent = JSON.stringify(localValue) !== JSON.stringify(remoteValue);
        
        // Solo mostrar campos con diferencias o campos importantes
        if (isDifferent || key === 'id' || key === 'nombre') {
            const localValueStr = typeof localValue === 'object' ? JSON.stringify(localValue) : localValue;
            const remoteValueStr = typeof remoteValue === 'object' ? JSON.stringify(remoteValue) : remoteValue;
            
            fieldsHTML += `
                <div class="merge-field ${isDifferent ? 'different' : ''}">
                    <div class="field-name">${key}</div>
                    <div class="field-options">
                        <label class="field-option">
                            <input type="radio" name="field-${key}" value="local" ${!isDifferent || !remoteValue ? 'checked' : ''}>
                            <div class="field-value local-value">${localValueStr}</div>
                        </label>
                        <label class="field-option">
                            <input type="radio" name="field-${key}" value="remote" ${!localValue ? 'checked' : ''}>
                            <div class="field-value remote-value">${remoteValueStr}</div>
                        </label>
                    </div>
                </div>
            `;
        }
    }
    
    return fieldsHTML;
}

/**
 * Recopila los datos combinados del modal
 * @param {HTMLElement} modalElement - Elemento del modal
 * @param {Object} conflict - Conflicto original
 * @returns {Object} Datos combinados
 */
function collectMergedData(modalElement, conflict) {
    const mergedData = {};
    const localData = conflict.localData;
    const remoteData = conflict.remoteData;
    
    // Combinar claves
    const allKeys = new Set([
        ...Object.keys(localData || {}), 
        ...Object.keys(remoteData || {})
    ]);
    
    // Recopilar valores seleccionados
    for (const key of allKeys) {
        const radioSelector = modalElement.querySelector(`input[name="field-${key}"]:checked`);
        
        if (radioSelector) {
            const selectedSource = radioSelector.value;
            
            if (selectedSource === 'local' && localData) {
                mergedData[key] = localData[key];
            } else if (selectedSource === 'remote' && remoteData) {
                mergedData[key] = remoteData[key];
            }
        } else {
            // Si por alguna razón no hay selección, usar valor local o remoto (prioridad local)
            mergedData[key] = localData && localData[key] !== undefined ? localData[key] : remoteData[key];
        }
    }
    
    return mergedData;
}

// Exportar funciones adicionales para uso externo
export {
    checkSynchronizationStatus,
    updateSyncStatusIndicators,
    handleConnectivityChange,
    resolverConflictosSincronizacion
};