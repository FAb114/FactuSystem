/**
 * Módulo de Actividad de Usuarios para FactuSystem
 * Gestiona la visualización y seguimiento de la actividad de usuarios
 * en el sistema, incluyendo facturas emitidas, operaciones de caja y acciones.
 */

// Importaciones de utilidades y servicios
const { getCurrentUser } = require('../../utils/auth.js');
const { getDatabase } = require('../../utils/database.js');
const { formatDate, formatCurrency, formatTime } = require('../../utils/format.js');
const { showNotification } = require('../../components/notifications.js');
const { generatePDF } = require('../../../services/print/pdf.js');
const { createTab } = require('../../components/tabs.js');
const { checkPermission } = require('../../../services/auth/permissions.js');

// Clase principal para gestionar la actividad de usuarios
class UserActivity {
    constructor() {
        this.db = getDatabase();
        this.currentUser = getCurrentUser();
        this.selectedUser = null;
        this.filters = {
            startDate: this.getDefaultStartDate(),
            endDate: new Date().toISOString().split('T')[0],
            sucursal: 'todas',
            tipoActividad: 'todas'
        };
        this.activitiesPerPage = 20;
        this.currentPage = 1;
        this.totalPages = 1;
        this.activityData = [];
        this.tiposActividad = [
            'login', 'logout', 'factura_emitida', 'presupuesto_emitido', 
            'producto_creado', 'producto_modificado', 'cliente_creado',
            'caja_apertura', 'caja_cierre', 'configuracion_modificada'
        ];
    }

    /**
     * Inicializa el módulo de actividad
     * @param {number} userId - ID del usuario a consultar (opcional)
     */
    async init(userId = null) {
        try {
            // Verificar permiso
            if (!checkPermission('ver_actividad_usuarios')) {
                showNotification('No tiene permisos para acceder a este módulo', 'error');
                return;
            }

            if (userId) {
                await this.loadUserData(userId);
            }
            
            this.renderFilters();
            this.attachEventListeners();
            await this.loadSucursales();
            await this.loadActivities();
        } catch (error) {
            console.error('Error al inicializar módulo de actividad:', error);
            showNotification('Error al cargar datos de actividad de usuarios', 'error');
        }
    }

    /**
     * Obtiene la fecha de inicio predeterminada (30 días atrás)
     */
    getDefaultStartDate() {
        const date = new Date();
        date.setDate(date.getDate() - 30);
        return date.toISOString().split('T')[0];
    }

    /**
     * Carga datos del usuario seleccionado
     * @param {number} userId - ID del usuario
     */
    async loadUserData(userId) {
        try {
            const user = await this.db.get('SELECT * FROM usuarios WHERE id = ?', [userId]);
            if (user) {
                this.selectedUser = user;
                document.getElementById('usuarioActividadTitle').textContent = 
                    `Actividad de Usuario: ${user.nombre} ${user.apellido}`;
            } else {
                showNotification('Usuario no encontrado', 'error');
            }
        } catch (error) {
            console.error('Error al cargar datos del usuario:', error);
            showNotification('Error al cargar datos del usuario', 'error');
        }
    }

    /**
     * Carga lista de sucursales disponibles
     */
    async loadSucursales() {
        try {
            const sucursales = await this.db.all('SELECT id, nombre FROM sucursales');
            const selectElement = document.getElementById('filtroSucursal');
            
            if (selectElement) {
                // Mantener la opción "Todas"
                let html = '<option value="todas">Todas las sucursales</option>';
                
                sucursales.forEach(sucursal => {
                    html += `<option value="${sucursal.id}">${sucursal.nombre}</option>`;
                });
                
                selectElement.innerHTML = html;
            }
        } catch (error) {
            console.error('Error al cargar sucursales:', error);
        }
    }

    /**
     * Renderiza los filtros de actividad
     */
    renderFilters() {
        const container = document.getElementById('actividadUsuarioContainer');
        if (!container) return;

        const titulo = this.selectedUser 
            ? `Actividad de Usuario: ${this.selectedUser.nombre} ${this.selectedUser.apellido}`
            : 'Actividad de Usuarios';

        container.innerHTML = `
            <div class="module-header">
                <h2 id="usuarioActividadTitle">${titulo}</h2>
                <div class="module-actions">
                    <button id="exportarActividadBtn" class="btn btn-secondary">
                        <i class="fas fa-file-export"></i> Exportar
                    </button>
                </div>
            </div>
            
            <div class="filter-section">
                <div class="filter-row">
                    <div class="filter-group">
                        <label for="filtroFechaInicio">Desde:</label>
                        <input type="date" id="filtroFechaInicio" value="${this.filters.startDate}">
                    </div>
                    <div class="filter-group">
                        <label for="filtroFechaFin">Hasta:</label>
                        <input type="date" id="filtroFechaFin" value="${this.filters.endDate}">
                    </div>
                    <div class="filter-group">
                        <label for="filtroSucursal">Sucursal:</label>
                        <select id="filtroSucursal">
                            <option value="todas">Todas las sucursales</option>
                            <!-- Se cargarán dinámicamente -->
                        </select>
                    </div>
                    <div class="filter-group">
                        <label for="filtroTipoActividad">Tipo:</label>
                        <select id="filtroTipoActividad">
                            <option value="todas">Todas las actividades</option>
                            <option value="login">Inicios de sesión</option>
                            <option value="factura_emitida">Facturas emitidas</option>
                            <option value="presupuesto_emitido">Presupuestos</option>
                            <option value="caja">Operaciones de caja</option>
                            <option value="producto">Gestión de productos</option>
                            <option value="cliente">Gestión de clientes</option>
                            <option value="configuracion">Configuraciones</option>
                        </select>
                    </div>
                    <button id="aplicarFiltrosBtn" class="btn btn-primary">
                        <i class="fas fa-filter"></i> Aplicar
                    </button>
                </div>
            </div>
            
            <div class="table-responsive">
                <table class="table" id="actividadUsuariosTable">
                    <thead>
                        <tr>
                            <th>Fecha/Hora</th>
                            <th>Usuario</th>
                            <th>Sucursal</th>
                            <th>Actividad</th>
                            <th>Detalles</th>
                            <th>Acciones</th>
                        </tr>
                    </thead>
                    <tbody id="actividadUsuariosBody">
                        <tr>
                            <td colspan="6" class="text-center">Cargando datos...</td>
                        </tr>
                    </tbody>
                </table>
            </div>
            
            <div class="pagination-container">
                <div class="pagination-info">
                    Mostrando <span id="paginaActual">1</span> de <span id="totalPaginas">1</span>
                </div>
                <div class="pagination-controls">
                    <button id="paginaAnterior" class="btn btn-sm btn-outline" disabled>
                        <i class="fas fa-chevron-left"></i> Anterior
                    </button>
                    <button id="paginaSiguiente" class="btn btn-sm btn-outline">
                        Siguiente <i class="fas fa-chevron-right"></i>
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * Asocia controladores de eventos a los elementos del DOM
     */
    attachEventListeners() {
        document.getElementById('aplicarFiltrosBtn').addEventListener('click', () => {
            this.currentPage = 1;
            this.updateFilters();
            this.loadActivities();
        });

        document.getElementById('exportarActividadBtn').addEventListener('click', () => {
            this.exportActivityReport();
        });

        document.getElementById('paginaAnterior').addEventListener('click', () => {
            if (this.currentPage > 1) {
                this.currentPage--;
                this.loadActivities();
            }
        });

        document.getElementById('paginaSiguiente').addEventListener('click', () => {
            if (this.currentPage < this.totalPages) {
                this.currentPage++;
                this.loadActivities();
            }
        });

        // Delegación de eventos para botones de acción
        document.getElementById('actividadUsuariosTable').addEventListener('click', (e) => {
            const target = e.target;
            const activityId = target.closest('tr').dataset.id;

            if (target.classList.contains('view-details-btn')) {
                this.viewActivityDetails(activityId);
            } else if (target.classList.contains('view-document-btn')) {
                this.viewRelatedDocument(activityId);
            }
        });
    }

    /**
     * Actualiza los filtros con los valores seleccionados
     */
    updateFilters() {
        this.filters.startDate = document.getElementById('filtroFechaInicio').value;
        this.filters.endDate = document.getElementById('filtroFechaFin').value;
        this.filters.sucursal = document.getElementById('filtroSucursal').value;
        this.filters.tipoActividad = document.getElementById('filtroTipoActividad').value;
    }

    /**
     * Carga actividades de usuario según filtros
     */
    async loadActivities() {
        try {
            const tbody = document.getElementById('actividadUsuariosBody');
            tbody.innerHTML = '<tr><td colspan="6" class="text-center"><div class="spinner"></div></td></tr>';

            // Construir la consulta SQL base
            let query = `
                SELECT a.id, a.fecha_hora, a.tipo_actividad, a.descripcion, a.detalles,
                       u.id as usuario_id, u.nombre as usuario_nombre, u.apellido as usuario_apellido,
                       s.id as sucursal_id, s.nombre as sucursal_nombre
                FROM actividad_usuario a
                JOIN usuarios u ON a.usuario_id = u.id
                JOIN sucursales s ON a.sucursal_id = s.id
                WHERE fecha_hora BETWEEN ? AND ?
            `;
            
            let params = [
                `${this.filters.startDate} 00:00:00`, 
                `${this.filters.endDate} 23:59:59`
            ];

            // Filtro de usuario específico
            if (this.selectedUser) {
                query += " AND a.usuario_id = ?";
                params.push(this.selectedUser.id);
            }

            // Filtro de sucursal
            if (this.filters.sucursal !== 'todas') {
                query += " AND a.sucursal_id = ?";
                params.push(this.filters.sucursal);
            }

            // Filtro de tipo de actividad
            if (this.filters.tipoActividad !== 'todas') {
                if (this.filters.tipoActividad === 'caja') {
                    query += " AND (a.tipo_actividad = 'caja_apertura' OR a.tipo_actividad = 'caja_cierre')";
                } else if (this.filters.tipoActividad === 'producto') {
                    query += " AND (a.tipo_actividad = 'producto_creado' OR a.tipo_actividad = 'producto_modificado')";
                } else if (this.filters.tipoActividad === 'cliente') {
                    query += " AND (a.tipo_actividad = 'cliente_creado' OR a.tipo_actividad = 'cliente_modificado')";
                } else {
                    query += " AND a.tipo_actividad = ?";
                    params.push(this.filters.tipoActividad);
                }
            }

            // Consulta para contar total de registros (paginación)
            const countQuery = query.replace('SELECT a.id, a.fecha_hora', 'SELECT COUNT(*) as total');
            const countResult = await this.db.get(countQuery, params);
            const totalRecords = countResult.total;
            this.totalPages = Math.ceil(totalRecords / this.activitiesPerPage);
            
            // Actualizar UI de paginación
            document.getElementById('paginaActual').textContent = this.currentPage;
            document.getElementById('totalPaginas').textContent = this.totalPages;
            document.getElementById('paginaAnterior').disabled = this.currentPage === 1;
            document.getElementById('paginaSiguiente').disabled = this.currentPage === this.totalPages;
            
            // Agregar límites para paginación
            query += " ORDER BY fecha_hora DESC LIMIT ? OFFSET ?";
            params.push(this.activitiesPerPage, (this.currentPage - 1) * this.activitiesPerPage);
            
            // Ejecutar consulta principal
            this.activityData = await this.db.all(query, params);
            
            // Renderizar resultados
            this.renderActivityTable();
        } catch (error) {
            console.error('Error al cargar actividades:', error);
            showNotification('Error al obtener datos de actividad', 'error');
            
            const tbody = document.getElementById('actividadUsuariosBody');
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="text-center text-danger">
                        Error al cargar datos. Intente nuevamente.
                    </td>
                </tr>
            `;
        }
    }

    /**
     * Renderiza la tabla de actividades
     */
    renderActivityTable() {
        const tbody = document.getElementById('actividadUsuariosBody');
        
        if (this.activityData.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="text-center">
                        No se encontraron registros de actividad con los filtros seleccionados
                    </td>
                </tr>
            `;
            return;
        }
        
        let html = '';
        this.activityData.forEach(activity => {
            const fechaHora = new Date(activity.fecha_hora);
            const fecha = formatDate(fechaHora);
            const hora = formatTime(fechaHora);
            
            let descripcion = this.getActivityDescription(activity);
            let accionesBtns = '';
            
            // Definir botones de acciones según tipo de actividad
            if (['factura_emitida', 'presupuesto_emitido', 'nota_credito_emitida', 'nota_debito_emitida'].includes(activity.tipo_actividad)) {
                accionesBtns = `<button class="btn btn-sm btn-outline view-document-btn"><i class="fas fa-file-alt"></i></button>`;
            }
            
            accionesBtns += `<button class="btn btn-sm btn-info view-details-btn"><i class="fas fa-info-circle"></i></button>`;
            
            html += `
                <tr data-id="${activity.id}">
                    <td>${fecha}<br><span class="text-muted">${hora}</span></td>
                    <td>${activity.usuario_nombre} ${activity.usuario_apellido}</td>
                    <td>${activity.sucursal_nombre}</td>
                    <td>${descripcion}</td>
                    <td>${this.formatActivityDetails(activity)}</td>
                    <td class="text-center">${accionesBtns}</td>
                </tr>
            `;
        });
        
        tbody.innerHTML = html;
    }

    /**
     * Obtiene la descripción formateada de una actividad
     * @param {Object} activity - Objeto de actividad
     * @return {string} Descripción formateada
     */
    getActivityDescription(activity) {
        switch (activity.tipo_actividad) {
            case 'login':
                return 'Inicio de sesión';
            case 'logout':
                return 'Cierre de sesión';
            case 'factura_emitida':
                return 'Emisión de factura';
            case 'presupuesto_emitido':
                return 'Emisión de presupuesto';
            case 'producto_creado':
                return 'Creación de producto';
            case 'producto_modificado':
                return 'Modificación de producto';
            case 'cliente_creado':
                return 'Alta de cliente';
            case 'cliente_modificado':
                return 'Modificación de cliente';
            case 'caja_apertura':
                return 'Apertura de caja';
            case 'caja_cierre':
                return 'Cierre de caja';
            case 'configuracion_modificada':
                return 'Cambio de configuración';
            default:
                return activity.descripcion || activity.tipo_actividad;
        }
    }

    /**
     * Formatea los detalles de la actividad para mostrar en la tabla
     * @param {Object} activity - Objeto de actividad
     * @return {string} HTML con detalles formateados
     */
    formatActivityDetails(activity) {
        try {
            if (!activity.detalles) return '';
            
            const detalles = typeof activity.detalles === 'string' 
                ? JSON.parse(activity.detalles) 
                : activity.detalles;
            
            switch (activity.tipo_actividad) {
                case 'login':
                    return `IP: ${detalles.ip || 'N/A'}`;
                
                case 'factura_emitida':
                    return `
                        ${detalles.tipo || ''} ${detalles.numero || ''}<br>
                        Cliente: ${detalles.cliente || 'Consumidor Final'}<br>
                        Total: ${formatCurrency(detalles.total || 0)}
                    `;
                
                case 'presupuesto_emitido':
                    return `
                        Presupuesto #${detalles.numero || ''}<br>
                        Cliente: ${detalles.cliente || 'Sin especificar'}<br>
                        Total: ${formatCurrency(detalles.total || 0)}
                    `;
                
                case 'caja_apertura':
                    return `Monto inicial: ${formatCurrency(detalles.monto_inicial || 0)}`;
                
                case 'caja_cierre':
                    return `
                        Monto cierre: ${formatCurrency(detalles.monto_cierre || 0)}<br>
                        Diferencia: ${formatCurrency(detalles.diferencia || 0)}
                    `;
                
                case 'producto_creado':
                case 'producto_modificado':
                    return `
                        Código: ${detalles.codigo || 'N/A'}<br>
                        Nombre: ${detalles.nombre || 'N/A'}
                    `;
                
                case 'cliente_creado':
                case 'cliente_modificado':
                    return `
                        ${detalles.dni_cuit ? 'DNI/CUIT: ' + detalles.dni_cuit + '<br>' : ''}
                        ${detalles.nombre || 'Sin nombre'}
                    `;
                
                default:
                    if (typeof detalles === 'object') {
                        // Convertir objeto a string resumido
                        const keys = Object.keys(detalles).slice(0, 2);
                        return keys.map(key => `${key}: ${detalles[key]}`).join('<br>');
                    }
                    return String(detalles).substring(0, 50);
            }
        } catch (error) {
            console.error('Error al formatear detalles:', error);
            return '<span class="text-danger">Error en formato</span>';
        }
    }

    /**
     * Muestra detalles de una actividad específica
     * @param {string} activityId - ID de la actividad
     */
    async viewActivityDetails(activityId) {
        try {
            const activity = this.activityData.find(a => a.id == activityId);
            
            if (!activity) {
                showNotification('No se encontró la actividad seleccionada', 'error');
                return;
            }
            
            let detalles = {};
            try {
                detalles = typeof activity.detalles === 'string' 
                    ? JSON.parse(activity.detalles) 
                    : activity.detalles;
            } catch (e) {
                detalles = { error: 'No se pudieron procesar los detalles' };
            }
            
            // Obtener información adicional según tipo de actividad
            let infoAdicional = '';
            
            if (activity.tipo_actividad === 'factura_emitida' && detalles.id) {
                const factura = await this.db.get(`
                    SELECT * FROM facturas WHERE id = ?
                `, [detalles.id]);
                
                if (factura) {
                    infoAdicional = `
                        <div class="info-section">
                            <h5>Información de Factura</h5>
                            <div class="info-grid">
                                <div class="info-item">
                                    <span class="info-label">Tipo:</span>
                                    <span class="info-value">${factura.tipo}</span>
                                </div>
                                <div class="info-item">
                                    <span class="info-label">Número:</span>
                                    <span class="info-value">${factura.numero}</span>
                                </div>
                                <div class="info-item">
                                    <span class="info-label">Fecha:</span>
                                    <span class="info-value">${formatDate(new Date(factura.fecha))}</span>
                                </div>
                                <div class="info-item">
                                    <span class="info-label">Cliente:</span>
                                    <span class="info-value">${factura.cliente_nombre || 'Consumidor Final'}</span>
                                </div>
                                <div class="info-item">
                                    <span class="info-label">Total:</span>
                                    <span class="info-value">${formatCurrency(factura.total)}</span>
                                </div>
                                <div class="info-item">
                                    <span class="info-label">Estado:</span>
                                    <span class="info-value">${factura.estado}</span>
                                </div>
                            </div>
                        </div>
                    `;
                }
            } else if (activity.tipo_actividad === 'caja_apertura' || activity.tipo_actividad === 'caja_cierre') {
                const cajaId = detalles.caja_id;
                if (cajaId) {
                    const caja = await this.db.get(`
                        SELECT * FROM caja WHERE id = ?
                    `, [cajaId]);
                    
                    if (caja) {
                        infoAdicional = `
                            <div class="info-section">
                                <h5>Información de Caja</h5>
                                <div class="info-grid">
                                    <div class="info-item">
                                        <span class="info-label">Fecha apertura:</span>
                                        <span class="info-value">${formatDate(new Date(caja.fecha_apertura))}</span>
                                    </div>
                                    ${caja.fecha_cierre ? `
                                    <div class="info-item">
                                        <span class="info-label">Fecha cierre:</span>
                                        <span class="info-value">${formatDate(new Date(caja.fecha_cierre))}</span>
                                    </div>
                                    ` : ''}
                                    <div class="info-item">
                                        <span class="info-label">Monto inicial:</span>
                                        <span class="info-value">${formatCurrency(caja.monto_inicial)}</span>
                                    </div>
                                    ${caja.monto_final ? `
                                    <div class="info-item">
                                        <span class="info-label">Monto final:</span>
                                        <span class="info-value">${formatCurrency(caja.monto_final)}</span>
                                    </div>
                                    ` : ''}
                                    <div class="info-item">
                                        <span class="info-label">Sucursal:</span>
                                        <span class="info-value">${activity.sucursal_nombre}</span>
                                    </div>
                                </div>
                            </div>
                        `;
                    }
                }
            }
            
            // Crear modal con los detalles
            const modal = document.createElement('div');
            modal.className = 'modal fade show';
            modal.style.display = 'block';
            modal.innerHTML = `
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">Detalles de Actividad</h5>
                            <button type="button" class="close" data-dismiss="modal">&times;</button>
                        </div>
                        <div class="modal-body">
                            <div class="info-section">
                                <h5>Información General</h5>
                                <div class="info-grid">
                                    <div class="info-item">
                                        <span class="info-label">Fecha:</span>
                                        <span class="info-value">${formatDate(new Date(activity.fecha_hora))}</span>
                                    </div>
                                    <div class="info-item">
                                        <span class="info-label">Hora:</span>
                                        <span class="info-value">${formatTime(new Date(activity.fecha_hora))}</span>
                                    </div>
                                    <div class="info-item">
                                        <span class="info-label">Usuario:</span>
                                        <span class="info-value">${activity.usuario_nombre} ${activity.usuario_apellido}</span>
                                    </div>
                                    <div class="info-item">
                                        <span class="info-label">Sucursal:</span>
                                        <span class="info-value">${activity.sucursal_nombre}</span>
                                    </div>
                                    <div class="info-item">
                                        <span class="info-label">Tipo de actividad:</span>
                                        <span class="info-value">${this.getActivityDescription(activity)}</span>
                                    </div>
                                </div>
                            </div>
                            
                            ${infoAdicional}
                            
                            <div class="info-section">
                                <h5>Detalles Completos</h5>
                                <pre class="json-details">${JSON.stringify(detalles, null, 2)}</pre>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-dismiss="modal">Cerrar</button>
                        </div>
                    </div>
                </div>
            `;
            
            document.body.appendChild(modal);
            
            // Evento para cerrar el modal
            modal.querySelector('[data-dismiss="modal"]').addEventListener('click', () => {
                document.body.removeChild(modal);
            });
            
        } catch (error) {
            console.error('Error al mostrar detalles de actividad:', error);
            showNotification('Error al mostrar detalles de actividad', 'error');
        }
    }

    /**
     * Ver documento relacionado con la actividad
     * @param {string} activityId - ID de la actividad
     */
    async viewRelatedDocument(activityId) {
        try {
            const activity = this.activityData.find(a => a.id == activityId);
            
            if (!activity) {
                showNotification('No se encontró la actividad seleccionada', 'error');
                return;
            }
            
            let detalles = {};
            try {
                detalles = typeof activity.detalles === 'string' 
                    ? JSON.parse(activity.detalles) 
                    : activity.detalles;
            } catch (e) {
                showNotification('Error al procesar detalles del documento', 'error');
                return;
            }
            
            // Tipo de documento y pestaña
            let moduleName = '';
            let documentId = null;
            
            switch (activity.tipo_actividad) {
                case 'factura_emitida':
                    moduleName = 'ventas';
                    documentId = detalles.id;
                    break;
                    
                case 'presupuesto_emitido':
                    moduleName = 'presupuestos';
                    documentId = detalles.id;
                    break;
                    
                case 'nota_credito_emitida':
                case 'nota_debito_emitida':
                    moduleName = 'documentos';
                    documentId = detalles.id;
                    break;
                    
                default:
                    showNotification('No hay documento asociado a esta actividad', 'warning');
                    return;
            }
            
            if (documentId) {
                // Crear tab con el módulo correspondiente
                createTab({
                    id: `${moduleName}-${documentId}`,
                    title: `${this.getActivityDescription(activity)}`,
                    module: moduleName,
                    params: { documentId }
                });
            } else {
                showNotification('No se pudo identificar el documento', 'error');
            }
            
        } catch (error) {
            console.error('Error al ver documento relacionado:', error);
            showNotification('Error al acceder al documento relacionado', 'error');
        }
    }

    /**
     * Exporta reporte de actividad en PDF
     */
    async exportActivityReport() {
        try {
            showNotification('Generando reporte...', 'info');
            
            // Obtener datos completos para el reporte (sin paginación)
            let query = `
                SELECT a.id, a.fecha_hora, a.tipo_actividad, a.descripcion, a.detalles,
                       u.id as usuario_id, u.nombre as usuario_nombre, u.apellido as usuario_apellido,
                       s.id as sucursal_id, s.nombre as sucursal_nombre
                FROM actividad_usuario a
                JOIN usuarios u ON a.usuario_id = u.id
                JOIN sucursales s ON a.sucursal_id = s.id
                WHERE fecha_hora BETWEEN ? AND ?
            `;
            
            let params = [
                `${this.filters.startDate} 00:00:00`, 
                `${this.filters.endDate} 23:59:59`
            ];

            // Filtro de usuario específico
            if (this.selectedUser) {
                query += " AND a.usuario_id = ?";
                params.push(this.selectedUser.id);
            }

            // Filtro de sucursal
            if (this.filters.sucursal !== 'todas') {
                query += " AND a.sucursal_id = ?";
                params.push(this.filters.sucursal);
            }

            // Filtro de tipo de actividad
            if (this.filters.tipoActividad !== 'todas') {
                if (this.filters.tipoActividad === 'caja') {
                    query += " AND (a.tipo_actividad = 'caja_apertura' OR a.tipo_actividad = 'caja_cierre')";
                } else if (this.filters.tipoActividad === 'producto') {
                    query += " AND (a.tipo_actividad = 'producto_creado' OR a.tipo_actividad = 'producto_modificado')";
                } else if (this.filters.tipoActividad === 'cliente') {
                    query += " AND (a.tipo_actividad = 'cliente_creado' OR a.tipo_actividad = 'cliente_modificado')";
                } else {
                    query += " AND a.tipo_actividad = ?";
                    params.push(this.filters.tipoActividad);
                }
            }
            
            query += " ORDER BY fecha_hora DESC";
            
            // Ejecutar consulta
            const reportData = await this.db.all(query, params);
            
            // Obtener información de la empresa para el encabezado
            const empresaInfo = await this.db.get('SELECT * FROM configuracion_empresa LIMIT 1');
            
            // Construir contenido HTML para el PDF
            let htmlContent = `
                <html>
                <head>
                    <style>
                        body { font-family: Arial, sans-serif; }
                        .header { text-align: center; margin-bottom: 20px; }
                        .logo { max-height: 60px; }
                        h1 { color: #333; font-size: 22px; margin: 5px 0; }
                        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                        th, td { border: 1px solid #ddd; padding: 8px; font-size: 12px; }
                        th { background-color: #f2f2f2; text-align: left; }
                        .footer { margin-top: 20px; font-size: 10px; color: #666; text-align: center; }
                        .filters { margin: 15px 0; padding: 10px; background-color: #f9f9f9; border-radius: 5px; }
                        .summary { margin: 15px 0; }
                    </style>
                </head>
                <body>
                    <div class="header">
                        ${empresaInfo?.logo ? `<img src="${empresaInfo.logo}" class="logo"><br>` : ''}
                        <h1>Reporte de Actividad de Usuarios</h1>
                        <p>${empresaInfo?.nombre_comercial || 'FactuSystem'}</p>
                    </div>
                    
                    <div class="filters">
                        <strong>Filtros aplicados:</strong><br>
                        Período: ${formatDate(new Date(this.filters.startDate))} al ${formatDate(new Date(this.filters.endDate))}<br>
                        ${this.selectedUser ? `Usuario: ${this.selectedUser.nombre} ${this.selectedUser.apellido}<br>` : ''}
                        ${this.filters.sucursal !== 'todas' ? `Sucursal: ${document.getElementById('filtroSucursal').options[document.getElementById('filtroSucursal').selectedIndex].text}<br>` : ''}
                        ${this.filters.tipoActividad !== 'todas' ? `Tipo de actividad: ${document.getElementById('filtroTipoActividad').options[document.getElementById('filtroTipoActividad').selectedIndex].text}` : ''}
                    </div>
                    
                    <div class="summary">
                        <strong>Total de registros:</strong> ${reportData.length}
                    </div>
                    
                    <table>
                        <thead>
                            <tr>
                                <th>Fecha/Hora</th>
                                <th>Usuario</th>
                                <th>Sucursal</th>
                                <th>Actividad</th>
                                <th>Detalles</th>
                            </tr>
                        </thead>
                        <tbody>
            `;
            
            // Agregar filas de datos
            if (reportData.length === 0) {
                htmlContent += `
                    <tr>
                        <td colspan="5" style="text-align: center;">No se encontraron registros</td>
                    </tr>
                `;
            } else {
                reportData.forEach(activity => {
                    const fechaHora = new Date(activity.fecha_hora);
                    
                    htmlContent += `
                        <tr>
                            <td>${formatDate(fechaHora)} ${formatTime(fechaHora)}</td>
                            <td>${activity.usuario_nombre} ${activity.usuario_apellido}</td>
                            <td>${activity.sucursal_nombre}</td>
                            <td>${this.getActivityDescription(activity)}</td>
                            <td>${this.formatActivityDetailsForReport(activity)}</td>
                        </tr>
                    `;
                });
            }
            
            // Cerrar tabla y documento
            htmlContent += `
                        </tbody>
                    </table>
                    
                    <div class="footer">
                        Reporte generado el ${formatDate(new Date())} a las ${formatTime(new Date())}
                        por ${this.currentUser.nombre} ${this.currentUser.apellido}
                    </div>
                </body>
                </html>
            `;
            
            // Generar nombre del archivo
            const fileName = `Actividad_Usuarios_${this.filters.startDate}_al_${this.filters.endDate}.pdf`;
            
            // Generar PDF
            await generatePDF({
                content: htmlContent,
                fileName: fileName,
                settings: {
                    format: 'A4',
                    orientation: 'portrait',
                    margin: { top: '20mm', right: '10mm', bottom: '20mm', left: '10mm' }
                }
            });
            
            showNotification('Reporte exportado correctamente', 'success');
            
        } catch (error) {
            console.error('Error al exportar reporte:', error);
            showNotification('Error al generar el reporte de actividad', 'error');
        }
    }

    /**
     * Formatea los detalles de actividad para el reporte PDF
     * @param {Object} activity - Objeto de actividad
     * @return {string} HTML formateado para el reporte
     */
    formatActivityDetailsForReport(activity) {
        try {
            if (!activity.detalles) return '';
            
            const detalles = typeof activity.detalles === 'string' 
                ? JSON.parse(activity.detalles) 
                : activity.detalles;
            
            switch (activity.tipo_actividad) {
                case 'login':
                    return `IP: ${detalles.ip || 'N/A'}`;
                
                case 'factura_emitida':
                    return `
                        ${detalles.tipo || ''} ${detalles.numero || ''}<br>
                        Cliente: ${detalles.cliente || 'Consumidor Final'}<br>
                        Total: ${formatCurrency(detalles.total || 0)}
                    `;
                
                case 'presupuesto_emitido':
                    return `
                        Presupuesto #${detalles.numero || ''}<br>
                        Cliente: ${detalles.cliente || 'Sin especificar'}<br>
                        Total: ${formatCurrency(detalles.total || 0)}
                    `;
                
                case 'caja_apertura':
                    return `Monto inicial: ${formatCurrency(detalles.monto_inicial || 0)}`;
                
                case 'caja_cierre':
                    return `
                        Monto cierre: ${formatCurrency(detalles.monto_cierre || 0)}<br>
                        Diferencia: ${formatCurrency(detalles.diferencia || 0)}
                    `;
                
                case 'producto_creado':
                case 'producto_modificado':
                    return `
                        Código: ${detalles.codigo || 'N/A'}<br>
                        Nombre: ${detalles.nombre || 'N/A'}
                    `;
                
                case 'cliente_creado':
                case 'cliente_modificado':
                    return `
                        ${detalles.dni_cuit ? 'DNI/CUIT: ' + detalles.dni_cuit + '<br>' : ''}
                        ${detalles.nombre || 'Sin nombre'}
                    `;
                
                default:
                    if (typeof detalles === 'object') {
                        // Convertir objeto a string resumido
                        const keys = Object.keys(detalles).slice(0, 3);
                        return keys.map(key => `${key}: ${detalles[key]}`).join('<br>');
                    }
                    return String(detalles).substring(0, 80);
            }
        } catch (error) {
            console.error('Error al formatear detalles para reporte:', error);
            return 'Error en formato';
        }
    }

    /**
     * Obtiene estadísticas de actividad por usuario
     * @param {number} userId - ID del usuario
     * @return {Promise<Object>} Estadísticas de actividad
     */
    async getUserActivityStats(userId) {
        try {
            const fechaInicio = new Date();
            fechaInicio.setDate(fechaInicio.getDate() - 30); // Últimos 30 días
            
            const stats = {
                total: 0,
                facturas: 0,
                presupuestos: 0,
                logins: 0,
                cajas: 0,
                ultimaActividad: null
            };
            
            // Total de actividades
            const total = await this.db.get(`
                SELECT COUNT(*) as total FROM actividad_usuario 
                WHERE usuario_id = ? AND fecha_hora >= ?
            `, [userId, fechaInicio.toISOString()]);
            
            stats.total = total.total;
            
            // Facturas emitidas
            const facturas = await this.db.get(`
                SELECT COUNT(*) as total FROM actividad_usuario 
                WHERE usuario_id = ? AND tipo_actividad = 'factura_emitida' AND fecha_hora >= ?
            `, [userId, fechaInicio.toISOString()]);
            
            stats.facturas = facturas.total;
            
            // Presupuestos emitidos
            const presupuestos = await this.db.get(`
                SELECT COUNT(*) as total FROM actividad_usuario 
                WHERE usuario_id = ? AND tipo_actividad = 'presupuesto_emitido' AND fecha_hora >= ?
            `, [userId, fechaInicio.toISOString()]);
            
            stats.presupuestos = presupuestos.total;
            
            // Inicios de sesión
            const logins = await this.db.get(`
                SELECT COUNT(*) as total FROM actividad_usuario 
                WHERE usuario_id = ? AND tipo_actividad = 'login' AND fecha_hora >= ?
            `, [userId, fechaInicio.toISOString()]);
            
            stats.logins = logins.total;
            
            // Operaciones de caja
            const cajas = await this.db.get(`
                SELECT COUNT(*) as total FROM actividad_usuario 
                WHERE usuario_id = ? AND (tipo_actividad = 'caja_apertura' OR tipo_actividad = 'caja_cierre') AND fecha_hora >= ?
            `, [userId, fechaInicio.toISOString()]);
            
            stats.cajas = cajas.total;
            
            // Última actividad
            const ultima = await this.db.get(`
                SELECT fecha_hora, tipo_actividad FROM actividad_usuario 
                WHERE usuario_id = ? 
                ORDER BY fecha_hora DESC LIMIT 1
            `, [userId]);
            
            if (ultima) {
                stats.ultimaActividad = {
                    fecha: formatDate(new Date(ultima.fecha_hora)),
                    hora: formatTime(new Date(ultima.fecha_hora)),
                    tipo: this.getActivityDescription({tipo_actividad: ultima.tipo_actividad})
                };
            }
            
            return stats;
            
        } catch (error) {
            console.error('Error al obtener estadísticas de actividad:', error);
            return {
                total: 0,
                facturas: 0,
                presupuestos: 0,
                logins: 0,
                cajas: 0,
                ultimaActividad: null,
                error: true
            };
        }
    }

    /**
     * Registra una acción en la actividad de usuario
     * @param {Object} datos - Datos de la actividad
     * @return {Promise<boolean>} Resultado de la operación
     */
    static async registrarActividad(datos) {
        try {
            if (!datos.tipo_actividad || !datos.usuario_id || !datos.sucursal_id) {
                console.error('Datos incompletos para registrar actividad');
                return false;
            }
            
            const db = getDatabase();
            const currentUser = getCurrentUser();
            
            // Preparar los datos para inserción
            const actividadData = {
                usuario_id: datos.usuario_id || currentUser.id,
                sucursal_id: datos.sucursal_id,
                fecha_hora: new Date().toISOString(),
                tipo_actividad: datos.tipo_actividad,
                descripcion: datos.descripcion || '',
                detalles: typeof datos.detalles === 'object' ? JSON.stringify(datos.detalles) : datos.detalles
            };
            
            // Insertar en la base de datos
            await db.run(`
                INSERT INTO actividad_usuario 
                (usuario_id, sucursal_id, fecha_hora, tipo_actividad, descripcion, detalles)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [
                actividadData.usuario_id,
                actividadData.sucursal_id,
                actividadData.fecha_hora,
                actividadData.tipo_actividad,
                actividadData.descripcion,
                actividadData.detalles
            ]);
            
            return true;
            
        } catch (error) {
            console.error('Error al registrar actividad de usuario:', error);
            return false;
        }
    }
}

// Exportar la clase para su uso en otros módulos
 UserActivity

module.exports = UserActivity;

// También exportar el método estático para registrar actividades desde cualquier parte del sistema
const registrarActividad
module.exports.registrarActividad = registrarActividad = UserActivity.registrarActividad;