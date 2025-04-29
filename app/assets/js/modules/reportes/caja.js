/**
 * Módulo de Reportes de Caja
 * app/assets/js/modules/reportes/caja.js
 * 
 * Este módulo maneja la generación, visualización y exportación de reportes de caja.
 * Incluye filtros por fecha, usuario, sucursal y tipo de movimiento.
 */

// Importaciones
const { database } = require('../../../utils/database.js');
const { auth } = require('../../../utils/auth.js');
const { printer } = require('../../../utils/printer.js');
const { validation } = require('../../../utils/validation.js');
const { logger } = require('../../../utils/logger.js');

class CajaReportes {
    constructor() {
        // Referencias a elementos DOM
        this.reportContainer = document.getElementById('reportesCajaContainer');
        this.dateRangeStart = document.getElementById('reporteCajaFechaInicio');
        this.dateRangeEnd = document.getElementById('reporteCajaFechaFin');
        this.userSelector = document.getElementById('reporteCajaUsuario');
        this.sucursalSelector = document.getElementById('reporteCajaSucursal');
        this.tipoMovimientoSelector = document.getElementById('reporteCajaTipoMovimiento');
        this.generateButton = document.getElementById('generarReporteCaja');
        this.exportPdfButton = document.getElementById('exportarPdfCaja');
        this.exportExcelButton = document.getElementById('exportarExcelCaja');
        this.printButton = document.getElementById('imprimirReporteCaja');
        this.chartContainer = document.getElementById('cajaTotalesChart');
        this.tableContainer = document.getElementById('cajaMovimientosTable');
        
        // Estado del reporte
        this.currentReportData = null;
        this.isLoading = false;
        this.currentUser = null;
        this.userPermissions = null;
        this.selectedSucursal = null;
        this.currentUserSucursales = [];
        
        // Configuración de gráficos
        this.chartOptions = {
            ingresos: {
                color: '#4CAF50',
                label: 'Ingresos'
            },
            egresos: {
                color: '#F44336',
                label: 'Egresos'
            },
            balance: {
                color: '#2196F3',
                label: 'Balance'
            }
        };
        
        // Inicializar
        this.init();
    }
    
    /**
     * Inicializa el módulo de reportes de caja
     */
    async init() {
        try {
            // Verificar autenticación
            this.currentUser = await auth.getCurrentUser();
            if (!this.currentUser) {
                window.location.href = '../../views/login.html';
                return;
            }
            
            // Verificar permisos
            this.userPermissions = await auth.getUserPermissions(this.currentUser.id);
            if (!this.userPermissions.reportes.caja.ver) {
                this.showMessage('No tienes permisos para acceder a los reportes de caja', 'error');
                return;
            }
            
            // Configurar fecha predeterminada (último mes)
            const today = new Date();
            const lastMonth = new Date();
            lastMonth.setMonth(today.getMonth() - 1);
            
            this.dateRangeStart.valueAsDate = lastMonth;
            this.dateRangeEnd.valueAsDate = today;
            
            // Cargar sucursales disponibles
            await this.loadSucursales();
            
            // Cargar usuarios
            await this.loadUsuarios();
            
            // Configurar eventos
            this.setupEventListeners();
            
            // Generar reporte inicial
            await this.generateReport();
            
            // Registrar actividad
            logger.log({
                tipo: 'acceso',
                modulo: 'reportes_caja',
                usuario: this.currentUser.id,
                descripcion: 'Acceso al módulo de reportes de caja'
            });
        } catch (error) {
            console.error('Error al inicializar reportes de caja:', error);
            this.showMessage('Error al cargar el módulo de reportes de caja', 'error');
            logger.log({
                tipo: 'error',
                modulo: 'reportes_caja',
                usuario: this.currentUser?.id || 'desconocido',
                descripcion: `Error al inicializar: ${error.message}`,
                error: error.stack
            });
        }
    }
    
    /**
     * Configura los listeners de eventos para los controles
     */
    setupEventListeners() {
        // Botón generar reporte
        this.generateButton.addEventListener('click', async () => {
            await this.generateReport();
        });
        
        // Exportar a PDF
        this.exportPdfButton.addEventListener('click', () => {
            this.exportToPdf();
        });
        
        // Exportar a Excel
        this.exportExcelButton.addEventListener('click', () => {
            this.exportToExcel();
        });
        
        // Imprimir reporte
        this.printButton.addEventListener('click', () => {
            this.printReport();
        });
        
        // Selector de sucursal
        this.sucursalSelector.addEventListener('change', () => {
            this.selectedSucursal = this.sucursalSelector.value;
            // Actualizar lista de usuarios según la sucursal
            if (this.selectedSucursal !== 'todas') {
                this.loadUsuariosBySucursal(this.selectedSucursal);
            } else {
                this.loadUsuarios();
            }
        });

        // Validación fechas
        this.dateRangeStart.addEventListener('change', () => {
            if (new Date(this.dateRangeStart.value) > new Date(this.dateRangeEnd.value)) {
                this.dateRangeEnd.valueAsDate = new Date(this.dateRangeStart.value);
            }
            validation.validateDateRange(this.dateRangeStart, this.dateRangeEnd);
        });

        this.dateRangeEnd.addEventListener('change', () => {
            if (new Date(this.dateRangeEnd.value) < new Date(this.dateRangeStart.value)) {
                this.dateRangeStart.valueAsDate = new Date(this.dateRangeEnd.value);
            }
            validation.validateDateRange(this.dateRangeStart, this.dateRangeEnd);
        });
    }
    
    /**
     * Carga la lista de sucursales disponibles para el usuario
     */
    async loadSucursales() {
        try {
            // Limpiar selector
            this.sucursalSelector.innerHTML = '';
            
            // Opción para todas las sucursales
            const allOption = document.createElement('option');
            allOption.value = 'todas';
            allOption.textContent = 'Todas las sucursales';
            this.sucursalSelector.appendChild(allOption);
            
            // Obtener sucursales según permisos
            if (this.userPermissions.admin || this.userPermissions.reportes.caja.todasSucursales) {
                // Administrador ve todas las sucursales
                const sucursales = await database.getAll('sucursales');
                this.currentUserSucursales = sucursales;
                
                sucursales.forEach(sucursal => {
                    const option = document.createElement('option');
                    option.value = sucursal.id;
                    option.textContent = sucursal.nombre;
                    this.sucursalSelector.appendChild(option);
                });
            } else {
                // Usuario normal solo ve sus sucursales asignadas
                const userSucursales = await database.query('usuario_sucursal', 
                    { usuario_id: this.currentUser.id });
                
                const sucursalesIds = userSucursales.map(us => us.sucursal_id);
                const sucursales = await database.getByIds('sucursales', sucursalesIds);
                this.currentUserSucursales = sucursales;
                
                sucursales.forEach(sucursal => {
                    const option = document.createElement('option');
                    option.value = sucursal.id;
                    option.textContent = sucursal.nombre;
                    this.sucursalSelector.appendChild(option);
                });
                
                // Si solo tiene una sucursal, seleccionarla por defecto
                if (sucursales.length === 1) {
                    this.sucursalSelector.value = sucursales[0].id;
                    this.selectedSucursal = sucursales[0].id;
                    
                    // Deshabilitar selector si solo tiene una opción
                    if (!this.userPermissions.reportes.caja.todasSucursales) {
                        this.sucursalSelector.disabled = true;
                    }
                }
            }
        } catch (error) {
            console.error('Error al cargar sucursales:', error);
            this.showMessage('Error al cargar las sucursales disponibles', 'error');
            logger.log({
                tipo: 'error',
                modulo: 'reportes_caja', 
                usuario: this.currentUser?.id || 'desconocido',
                descripcion: `Error al cargar sucursales: ${error.message}`,
                error: error.stack
            });
        }
    }
    
    /**
     * Carga todos los usuarios según los permisos
     */
    async loadUsuarios() {
        try {
            // Limpiar selector
            this.userSelector.innerHTML = '';
            
            // Opción para todos los usuarios
            const allOption = document.createElement('option');
            allOption.value = 'todos';
            allOption.textContent = 'Todos los usuarios';
            this.userSelector.appendChild(allOption);
            
            // Obtener usuarios según permisos
            let usuarios = [];
            
            if (this.userPermissions.admin || this.userPermissions.reportes.caja.todosUsuarios) {
                // Administrador ve todos los usuarios
                usuarios = await database.getAll('usuarios');
            } else {
                // Usuario normal solo se ve a sí mismo
                usuarios = [this.currentUser];
                this.userSelector.value = this.currentUser.id;
                this.userSelector.disabled = true;
            }
            
            usuarios.forEach(usuario => {
                const option = document.createElement('option');
                option.value = usuario.id;
                option.textContent = `${usuario.nombre} ${usuario.apellido}`;
                this.userSelector.appendChild(option);
            });
        } catch (error) {
            console.error('Error al cargar usuarios:', error);
            this.showMessage('Error al cargar los usuarios disponibles', 'error');
            logger.log({
                tipo: 'error',
                modulo: 'reportes_caja',
                usuario: this.currentUser?.id || 'desconocido',
                descripcion: `Error al cargar usuarios: ${error.message}`,
                error: error.stack
            });
        }
    }
    
    /**
     * Carga los usuarios asignados a una sucursal específica
     * @param {string} sucursalId - ID de la sucursal
     */
    async loadUsuariosBySucursal(sucursalId) {
        try {
            // Limpiar selector
            this.userSelector.innerHTML = '';
            
            // Opción para todos los usuarios
            const allOption = document.createElement('option');
            allOption.value = 'todos';
            allOption.textContent = 'Todos los usuarios';
            this.userSelector.appendChild(allOption);
            
            // Obtener usuarios asociados a la sucursal
            const userSucursales = await database.query('usuario_sucursal', 
                { sucursal_id: sucursalId });
            
            const userIds = userSucursales.map(us => us.usuario_id);
            
            if (userIds.length > 0) {
                const usuarios = await database.getByIds('usuarios', userIds);
                
                usuarios.forEach(usuario => {
                    const option = document.createElement('option');
                    option.value = usuario.id;
                    option.textContent = `${usuario.nombre} ${usuario.apellido}`;
                    this.userSelector.appendChild(option);
                });
            }
            
            // Si el usuario actual no tiene permiso para ver todos los usuarios,
            // y no está en la lista, deshabilitar el selector
            if (!this.userPermissions.admin && !this.userPermissions.reportes.caja.todosUsuarios) {
                if (!userIds.includes(this.currentUser.id)) {
                    this.userSelector.value = 'todos';
                    this.userSelector.disabled = true;
                } else {
                    this.userSelector.value = this.currentUser.id;
                    this.userSelector.disabled = true;
                }
            }
        } catch (error) {
            console.error('Error al cargar usuarios por sucursal:', error);
            this.showMessage('Error al cargar los usuarios de la sucursal', 'error');
            logger.log({
                tipo: 'error',
                modulo: 'reportes_caja',
                usuario: this.currentUser?.id || 'desconocido',
                descripcion: `Error al cargar usuarios por sucursal: ${error.message}`,
                error: error.stack
            });
        }
    }
    
    /**
     * Genera el reporte de caja según los filtros seleccionados
     */
    async generateReport() {
        try {
            this.isLoading = true;
            this.showLoading(true);
            
            // Obtener filtros
            const fechaInicio = this.dateRangeStart.value;
            const fechaFin = this.dateRangeEnd.value;
            const usuarioId = this.userSelector.value;
            const sucursalId = this.sucursalSelector.value;
            const tipoMovimiento = this.tipoMovimientoSelector.value;
            
            // Validar fechas
            if (!fechaInicio || !fechaFin) {
                this.showMessage('Debe seleccionar un rango de fechas válido', 'warning');
                this.showLoading(false);
                this.isLoading = false;
                return;
            }
            
            // Construir query para movimientos de caja
            const query = {
                fecha: {
                    $gte: new Date(fechaInicio + 'T00:00:00'),
                    $lte: new Date(fechaFin + 'T23:59:59')
                }
            };
            
            // Filtrar por usuario
            if (usuarioId !== 'todos') {
                query.usuario_id = usuarioId;
            }
            
            // Filtrar por sucursal
            if (sucursalId !== 'todas') {
                query.sucursal_id = sucursalId;
            }
            
            // Filtrar por tipo de movimiento
            if (tipoMovimiento !== 'todos') {
                query.tipo = tipoMovimiento;
            }
            
            // Obtener datos de caja
            const movimientosCaja = await database.queryWithRange('movimientos_caja', query, {
                sort: { fecha: 1 } // Ordenar por fecha ascendente
            });
            
            // Obtener detalles de aperturas y cierres
            const aperturaCierreIds = movimientosCaja
                .filter(m => m.tipo === 'apertura' || m.tipo === 'cierre')
                .map(m => m.detalle_id);
            
            const aperturaCierreDetalles = aperturaCierreIds.length > 0 
                ? await database.getByIds('apertura_cierre_caja', aperturaCierreIds)
                : [];
            
            // Obtener detalles de facturas relacionadas
            const facturaIds = movimientosCaja
                .filter(m => m.tipo === 'venta' && m.detalle_id)
                .map(m => m.detalle_id);
            
            const facturas = facturaIds.length > 0 
                ? await database.getByIds('facturas', facturaIds)
                : [];
            
            // Obtener detalles de gastos
            const gastoIds = movimientosCaja
                .filter(m => m.tipo === 'gasto' && m.detalle_id)
                .map(m => m.detalle_id);
            
            const gastos = gastoIds.length > 0 
                ? await database.getByIds('gastos', gastoIds)
                : [];
            
            // Obtener nombres de usuarios
            const usuarioIds = [...new Set(movimientosCaja.map(m => m.usuario_id))];
            const usuarios = usuarioIds.length > 0 
                ? await database.getByIds('usuarios', usuarioIds)
                : [];
            
            const usuariosMap = usuarios.reduce((map, user) => {
                map[user.id] = `${user.nombre} ${user.apellido}`;
                return map;
            }, {});
            
            // Obtener nombres de sucursales
            const sucursalIds = [...new Set(movimientosCaja.map(m => m.sucursal_id))];
            const sucursales = sucursalIds.length > 0 
                ? await database.getByIds('sucursales', sucursalIds)
                : [];
            
            const sucursalesMap = sucursales.reduce((map, sucursal) => {
                map[sucursal.id] = sucursal.nombre;
                return map;
            }, {});
            
            // Enriquecer datos con detalles
            const movimientosEnriquecidos = movimientosCaja.map(movimiento => {
                const enriched = {
                    ...movimiento,
                    usuario_nombre: usuariosMap[movimiento.usuario_id] || 'Desconocido',
                    sucursal_nombre: sucursalesMap[movimiento.sucursal_id] || 'Desconocida',
                    detalle: {}
                };
                
                // Agregar detalles según tipo
                switch (movimiento.tipo) {
                    case 'apertura':
                    case 'cierre':
                        const aperturaCierre = aperturaCierreDetalles.find(ac => ac.id === movimiento.detalle_id);
                        if (aperturaCierre) {
                            enriched.detalle = aperturaCierre;
                        }
                        break;
                    case 'venta':
                        const factura = facturas.find(f => f.id === movimiento.detalle_id);
                        if (factura) {
                            enriched.detalle = factura;
                        }
                        break;
                    case 'gasto':
                        const gasto = gastos.find(g => g.id === movimiento.detalle_id);
                        if (gasto) {
                            enriched.detalle = gasto;
                        }
                        break;
                }
                
                return enriched;
            });
            
            // Calcular totales
            const totales = this.calcularTotales(movimientosEnriquecidos);
            
            // Guardar datos del reporte actual
            this.currentReportData = {
                movimientos: movimientosEnriquecidos,
                totales,
                filtros: {
                    fechaInicio,
                    fechaFin,
                    usuarioId,
                    sucursalId,
                    tipoMovimiento
                },
                sucursalesMap,
                usuariosMap
            };
            
            // Renderizar reporte
            this.renderReport();
            
            // Registrar actividad
            logger.log({
                tipo: 'reporte',
                modulo: 'reportes_caja',
                usuario: this.currentUser.id,
                descripcion: `Generó reporte de caja con filtros: ${JSON.stringify(this.currentReportData.filtros)}`
            });
            
            this.showLoading(false);
            this.isLoading = false;
        } catch (error) {
            console.error('Error al generar reporte de caja:', error);
            this.showMessage('Error al generar el reporte de caja', 'error');
            logger.log({
                tipo: 'error',
                modulo: 'reportes_caja',
                usuario: this.currentUser?.id || 'desconocido',
                descripcion: `Error al generar reporte: ${error.message}`,
                error: error.stack
            });
            this.showLoading(false);
            this.isLoading = false;
        }
    }
    
    /**
     * Calcula los totales para el reporte de caja
     * @param {Array} movimientos - Lista de movimientos de caja
     * @returns {Object} Totales calculados
     */
    calcularTotales(movimientos) {
        // Inicializar totales
        const totales = {
            ingresos: 0,
            egresos: 0,
            balance: 0,
            efectivo: {
                ingresos: 0,
                egresos: 0,
                balance: 0
            },
            tarjeta: {
                ingresos: 0,
                egresos: 0,
                balance: 0
            },
            transferencia: {
                ingresos: 0,
                egresos: 0,
                balance: 0
            },
            mercadoPago: {
                ingresos: 0,
                egresos: 0,
                balance: 0
            },
            otrosMedios: {
                ingresos: 0,
                egresos: 0,
                balance: 0
            },
            porTipo: {
                apertura: 0,
                cierre: 0,
                venta: 0,
                gasto: 0,
                ingreso_extra: 0,
                retiro: 0,
                ajuste: 0
            },
            porDia: {},
            porUsuario: {},
            porSucursal: {}
        };

        // Procesar cada movimiento
        movimientos.forEach(movimiento => {
            const esIngreso = ['apertura', 'venta', 'ingreso_extra', 'ajuste_positivo'].includes(movimiento.tipo);
            const esEgreso = ['cierre', 'gasto', 'retiro', 'ajuste_negativo'].includes(movimiento.tipo);
            const monto = Math.abs(movimiento.monto);
            
            // Actualizar totales generales
            if (esIngreso) {
                totales.ingresos += monto;
            } else if (esEgreso) {
                totales.egresos += monto;
            }
            
            // Actualizar por tipo de movimiento
            if (totales.porTipo.hasOwnProperty(movimiento.tipo)) {
                totales.porTipo[movimiento.tipo] += monto;
            }
            
            // Actualizar por método de pago
            const metodoPago = movimiento.metodo_pago || 'efectivo';
            
            if (metodoPago === 'efectivo') {
                if (esIngreso) totales.efectivo.ingresos += monto;
                if (esEgreso) totales.efectivo.egresos += monto;
            } else if (metodoPago.includes('tarjeta')) {
                if (esIngreso) totales.tarjeta.ingresos += monto;
                if (esEgreso) totales.tarjeta.egresos += monto;
            } else if (metodoPago === 'transferencia') {
                if (esIngreso) totales.transferencia.ingresos += monto;
                if (esEgreso) totales.transferencia.egresos += monto;
            } else if (metodoPago === 'mercadopago') {
                if (esIngreso) totales.mercadoPago.ingresos += monto;
                if (esEgreso) totales.mercadoPago.egresos += monto;
            } else {
                if (esIngreso) totales.otrosMedios.ingresos += monto;
                if (esEgreso) totales.otrosMedios.egresos += monto;
            }
            
            // Actualizar por día
            const fecha = movimiento.fecha.toISOString().split('T')[0];
            if (!totales.porDia[fecha]) {
                totales.porDia[fecha] = {
                    ingresos: 0,
                    egresos: 0,
                    balance: 0
                };
            }
            
            if (esIngreso) totales.porDia[fecha].ingresos += monto;
            if (esEgreso) totales.porDia[fecha].egresos += monto;
            
            // Actualizar por usuario
            const usuarioId = movimiento.usuario_id;
            if (!totales.porUsuario[usuarioId]) {
                totales.porUsuario[usuarioId] = {
                    ingresos: 0,
                    egresos: 0,
                    balance: 0,
                    nombre: movimiento.usuario_nombre
                };
            }
            
            if (esIngreso) totales.porUsuario[usuarioId].ingresos += monto;
            if (esEgreso) totales.porUsuario[usuarioId].egresos += monto;
            
            // Actualizar por sucursal
            const sucursalId = movimiento.sucursal_id;
            if (!totales.porSucursal[sucursalId]) {
                totales.porSucursal[sucursalId] = {
                    ingresos: 0,
                    egresos: 0,
                    balance: 0,
                    nombre: movimiento.sucursal_nombre
                };
            }
            
            if (esIngreso) totales.porSucursal[sucursalId].ingresos += monto;
            if (esEgreso) totales.porSucursal[sucursalId].egresos += monto;
        });
        
        // Calcular balances
        totales.balance = totales.ingresos - totales.egresos;
        totales.efectivo.balance = totales.efectivo.ingresos - totales.efectivo.egresos;
        totales.tarjeta.balance = totales.tarjeta.ingresos - totales.tarjeta.egresos;
        totales.transferencia.balance = totales.transferencia.ingresos - totales.transferencia.egresos;
        totales.mercadoPago.balance = totales.mercadoPago.ingresos - totales.mercadoPago.egresos;
        totales.otrosMedios.balance = totales.otrosMedios.ingresos - totales.otrosMedios.egresos;
        
        // Calcular balances por día
        Object.keys(totales.porDia).forEach(fecha => {
            totales.porDia[fecha].balance = 
                totales.porDia[fecha].ingresos - totales.porDia[fecha].egresos;
        });
        
        // Calcular balances por usuario
        Object.keys(totales.porUsuario).forEach(usuarioId => {
            totales.porUsuario[usuarioId].balance = 
                totales.porUsuario[usuarioId].ingresos - totales.porUsuario[usuarioId].egresos;
        });
        
        // Calcular balances por sucursal
        Object.keys(totales.porSucursal).forEach(sucursalId => {
            totales.porSucursal[sucursalId].balance = 
                totales.porSucursal[sucursalId].ingresos - totales.porSucursal[sucursalId].egresos;
        });
        
        return totales;
    }
    
    /**
     * Renderiza el reporte en la UI
     */
    renderReport() {
        if (!this.currentReportData) {
            this.tableContainer.innerHTML = '<p class="no-data">No hay datos para mostrar</p>';
            this.chartContainer.innerHTML = '<p class="no-data">No hay datos para mostrar</p>';
            return;
        }
        
        const { movimientos, totales, filtros } = this.currentReportData;
        
        // Renderizar encabezado del reporte
        this.renderReportHeader();
        
        // Renderizar gráficos
        this.renderCharts();
        
        // Renderizar tabla de movimientos
        this.renderMovimientosTable();
        
        // Renderizar resumen por método de pago
        this.renderMediosPagoSummary();
        
        // Renderizar resumen por usuario
        this.renderUsuariosSummary();
        
        // Renderizar resumen por sucursal
        this.renderSucursalesSummary();
        
        // Actualizar botones de exportación
        this.updateExportButtons();
    }
    
    /**
     * Renderiza el encabezado del reporte con información de filtros
     */
    renderReportHeader() {
        const { filtros, totales } = this.currentReportData;
        
        const headerContainer = document.createElement('div');
        headerContainer.className = 'reporte-header';
        
        const dateFormat = { year: 'numeric', month: 'long', day: 'numeric' };
        const fechaInicio = new Date(filtros.fechaInicio).toLocaleDateString('es-AR', dateFormat);
        const fechaFin = new Date(filtros.fechaFin).toLocaleDateString('es-AR', dateFormat);
        
        // Título y fechas
        headerContainer.innerHTML = `
            <h2>Reporte de Caja</h2>
            <div class="reporte-periodo">
                <span>Período: ${fechaInicio} al ${fechaFin}</span>
            </div>
            <div class="reporte-filtros">
                <span>Sucursal: ${filtros.sucursalId === 'todas' ? 'Todas las sucursales' : 
                    this.currentReportData.sucursalesMap[filtros.sucursalId]}</span>
                <span>Usuario: ${filtros.usuarioId === 'todos' ? 'Todos los usuarios' : 
                    this.currentReportData.usuariosMap[filtros.usuarioId]}</span>
                <span>Tipo: ${filtros.tipoMovimiento === 'todos' ? 'Todos los movimientos' : 
                    this.formatTipoMovimiento(filtros.tipoMovimiento)}</span>
            </div>
            <div class="reporte-totales-header">
                <div class="total-item ingresos">
                    <span class="total-label">Total Ingresos:</span>
                    <span class="total-value">$${this.formatCurrency(totales.ingresos)}</span>
                    </div>
                <div class="total-item egresos">
                    <span class="total-label">Total Egresos:</span>
                    <span class="total-value">$${this.formatCurrency(totales.egresos)}</span>
                </div>
                <div class="total-item balance ${totales.balance >= 0 ? 'positivo' : 'negativo'}">
                    <span class="total-label">Balance:</span>
                    <span class="total-value">$${this.formatCurrency(totales.balance)}</span>
                </div>
            </div>
        `;
        
        // Reemplazar el contenido anterior
        const oldHeader = this.reportContainer.querySelector('.reporte-header');
        if (oldHeader) {
            this.reportContainer.replaceChild(headerContainer, oldHeader);
        } else {
            this.reportContainer.prepend(headerContainer);
        }
    }
    
    /**
     * Renderiza los gráficos del reporte
     */
    renderCharts() {
        const { totales } = this.currentReportData;
        
        // Crear contenedor para los gráficos si no existe
        let chartsContainer = this.reportContainer.querySelector('.reporte-charts');
        if (!chartsContainer) {
            chartsContainer = document.createElement('div');
            chartsContainer.className = 'reporte-charts';
            this.chartContainer.innerHTML = '';
            this.chartContainer.appendChild(chartsContainer);
        }
        
        // Limpiar contenedor de gráficos
        chartsContainer.innerHTML = '';
        
        // Crear contenedor para el gráfico de ingresos/egresos
        const balanceChartContainer = document.createElement('div');
        balanceChartContainer.className = 'chart-container';
        balanceChartContainer.innerHTML = '<h3>Ingresos y Egresos</h3>';
        const balanceCanvas = document.createElement('canvas');
        balanceCanvas.id = 'balanceChart';
        balanceChartContainer.appendChild(balanceCanvas);
        chartsContainer.appendChild(balanceChartContainer);
        
        // Crear contenedor para el gráfico por día
        const dailyChartContainer = document.createElement('div');
        dailyChartContainer.className = 'chart-container';
        dailyChartContainer.innerHTML = '<h3>Evolución por Fecha</h3>';
        const dailyCanvas = document.createElement('canvas');
        dailyCanvas.id = 'dailyChart';
        dailyChartContainer.appendChild(dailyCanvas);
        chartsContainer.appendChild(dailyChartContainer);
        
        // Crear contenedor para el gráfico por método de pago
        const paymentMethodChartContainer = document.createElement('div');
        paymentMethodChartContainer.className = 'chart-container';
        paymentMethodChartContainer.innerHTML = '<h3>Distribución por Método de Pago</h3>';
        const paymentMethodCanvas = document.createElement('canvas');
        paymentMethodCanvas.id = 'paymentMethodChart';
        paymentMethodChartContainer.appendChild(paymentMethodCanvas);
        chartsContainer.appendChild(paymentMethodChartContainer);
        
        // Importar Chart.js dinámicamente
        Promise.resolve(require('https://cdnjs.cloudflare.com/ajax/libs/Chart.js/3.7.0/chart.min.js'))
            .then(Chart => {
                // Crear gráfico de balance (ingresos/egresos)
                this.createBalanceChart(balanceCanvas, totales);
                
                // Crear gráfico de evolución diaria
                this.createDailyChart(dailyCanvas, totales.porDia);
                
                // Crear gráfico de métodos de pago
                this.createPaymentMethodChart(paymentMethodCanvas, totales);
            })
            .catch(error => {
                console.error('Error al cargar Chart.js:', error);
                chartsContainer.innerHTML = '<p class="error">Error al cargar los gráficos</p>';
            });
    }
    
    /**
     * Crea un gráfico de barras comparando ingresos y egresos
     * @param {HTMLElement} canvas - Elemento canvas para el gráfico
     * @param {Object} totales - Datos de totales
     */
    createBalanceChart(canvas, totales) {
        const ctx = canvas.getContext('2d');
        
        // Datos para el gráfico
        const data = {
            labels: ['Totales'],
            datasets: [
                {
                    label: 'Ingresos',
                    data: [totales.ingresos],
                    backgroundColor: this.chartOptions.ingresos.color,
                    borderColor: this.chartOptions.ingresos.color,
                    borderWidth: 1
                },
                {
                    label: 'Egresos',
                    data: [totales.egresos],
                    backgroundColor: this.chartOptions.egresos.color,
                    borderColor: this.chartOptions.egresos.color,
                    borderWidth: 1
                },
                {
                    label: 'Balance',
                    data: [totales.balance],
                    backgroundColor: this.chartOptions.balance.color,
                    borderColor: this.chartOptions.balance.color,
                    borderWidth: 1
                }
            ]
        };
        
        // Opciones del gráfico
        const options = {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: (value) => `$${this.formatCurrency(value)}`
                    }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            const label = context.dataset.label || '';
                            const value = context.raw;
                            return `${label}: $${this.formatCurrency(value)}`;
                        }
                    }
                },
                legend: {
                    position: 'top'
                }
            }
        };
        
        // Crear gráfico
        new Chart(ctx, {
            type: 'bar',
            data: data,
            options: options
        });
    }
    
    /**
     * Crea un gráfico de línea mostrando la evolución diaria
     * @param {HTMLElement} canvas - Elemento canvas para el gráfico
     * @param {Object} datosPorDia - Datos agrupados por día
     */
    createDailyChart(canvas, datosPorDia) {
        const ctx = canvas.getContext('2d');
        
        // Ordenar fechas
        const fechas = Object.keys(datosPorDia).sort();
        
        // Datos para el gráfico
        const data = {
            labels: fechas.map(fecha => {
                const date = new Date(fecha);
                return date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
            }),
            datasets: [
                {
                    label: 'Ingresos',
                    data: fechas.map(fecha => datosPorDia[fecha].ingresos),
                    borderColor: this.chartOptions.ingresos.color,
                    backgroundColor: 'rgba(76, 175, 80, 0.1)',
                    fill: true,
                    tension: 0.3
                },
                {
                    label: 'Egresos',
                    data: fechas.map(fecha => datosPorDia[fecha].egresos),
                    borderColor: this.chartOptions.egresos.color,
                    backgroundColor: 'rgba(244, 67, 54, 0.1)',
                    fill: true,
                    tension: 0.3
                },
                {
                    label: 'Balance',
                    data: fechas.map(fecha => datosPorDia[fecha].balance),
                    borderColor: this.chartOptions.balance.color,
                    backgroundColor: 'rgba(33, 150, 243, 0.1)',
                    fill: true,
                    tension: 0.3
                }
            ]
        };
        
        // Opciones del gráfico
        const options = {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            scales: {
                y: {
                    ticks: {
                        callback: (value) => `$${this.formatCurrency(value)}`
                    }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            const label = context.dataset.label || '';
                            const value = context.raw;
                            return `${label}: $${this.formatCurrency(value)}`;
                        },
                        title: (context) => {
                            const fecha = fechas[context[0].dataIndex];
                            return new Date(fecha).toLocaleDateString('es-AR', {
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric'
                            });
                        }
                    }
                },
                legend: {
                    position: 'top'
                }
            }
        };
        
        // Crear gráfico
        new Chart(ctx, {
            type: 'line',
            data: data,
            options: options
        });
    }
    
    /**
     * Crea un gráfico de dona para los métodos de pago
     * @param {HTMLElement} canvas - Elemento canvas para el gráfico
     * @param {Object} totales - Datos de totales
     */
    createPaymentMethodChart(canvas, totales) {
        const ctx = canvas.getContext('2d');
        
        // Datos para el gráfico
        const data = {
            labels: ['Efectivo', 'Tarjeta', 'Transferencia', 'Mercado Pago', 'Otros'],
            datasets: [{
                data: [
                    totales.efectivo.ingresos,
                    totales.tarjeta.ingresos,
                    totales.transferencia.ingresos,
                    totales.mercadoPago.ingresos,
                    totales.otrosMedios.ingresos
                ],
                backgroundColor: [
                    '#4CAF50', // Verde
                    '#FF9800', // Naranja
                    '#2196F3', // Azul
                    '#9C27B0', // Púrpura
                    '#607D8B'  // Gris
                ],
                borderWidth: 1
            }]
        };
        
        // Opciones del gráfico
        const options = {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right'
                },
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            const label = context.label || '';
                            const value = context.raw;
                            const percentage = (value / totales.ingresos * 100).toFixed(2);
                            return `${label}: $${this.formatCurrency(value)} (${percentage}%)`;
                        }
                    }
                }
            }
        };
        
        // Crear gráfico
        new Chart(ctx, {
            type: 'doughnut',
            data: data,
            options: options
        });
    }
    
    /**
     * Renderiza la tabla con todos los movimientos
     */
    renderMovimientosTable() {
        const { movimientos } = this.currentReportData;
        
        // Crear contenedor para la tabla si no existe
        let tableWrapper = this.reportContainer.querySelector('.movimientos-table-wrapper');
        if (!tableWrapper) {
            tableWrapper = document.createElement('div');
            tableWrapper.className = 'movimientos-table-wrapper';
            this.tableContainer.innerHTML = '';
            this.tableContainer.appendChild(tableWrapper);
        }
        
        // Crear tabla
        tableWrapper.innerHTML = `
            <h3>Detalle de Movimientos</h3>
            <div class="table-scroll">
                <table class="movimientos-table">
                    <thead>
                        <tr>
                            <th>Fecha</th>
                            <th>Hora</th>
                            <th>Tipo</th>
                            <th>Descripción</th>
                            <th>Usuario</th>
                            <th>Sucursal</th>
                            <th>Método</th>
                            <th>Ingreso</th>
                            <th>Egreso</th>
                            <th>Acciones</th>
                        </tr>
                    </thead>
                    <tbody id="movimientosCajaTableBody">
                        ${movimientos.length === 0 ? 
                            '<tr><td colspan="10" class="no-data">No hay movimientos en el período seleccionado</td></tr>' : 
                            this.generateMovimientosRows(movimientos)
                        }
                    </tbody>
                </table>
            </div>
        `;
        
        // Agregar eventos a los botones de acciones
        const verDetalleButtons = tableWrapper.querySelectorAll('.ver-detalle-btn');
        verDetalleButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                const movimientoId = e.target.dataset.id;
                this.mostrarDetalleMovimiento(movimientoId);
            });
        });
    }
    
    /**
     * Genera las filas para la tabla de movimientos
     * @param {Array} movimientos - Lista de movimientos
     * @returns {string} HTML de las filas
     */
    generateMovimientosRows(movimientos) {
        return movimientos.map(movimiento => {
            const fecha = new Date(movimiento.fecha);
            const formattedDate = fecha.toLocaleDateString('es-AR');
            const formattedTime = fecha.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
            const esIngreso = ['apertura', 'venta', 'ingreso_extra', 'ajuste_positivo'].includes(movimiento.tipo);
            const esEgreso = ['cierre', 'gasto', 'retiro', 'ajuste_negativo'].includes(movimiento.tipo);
            
            return `
                <tr data-id="${movimiento.id}" class="movimiento-row ${movimiento.tipo}">
                    <td>${formattedDate}</td>
                    <td>${formattedTime}</td>
                    <td>${this.formatTipoMovimiento(movimiento.tipo)}</td>
                    <td>${this.getMovimientoDescripcion(movimiento)}</td>
                    <td>${movimiento.usuario_nombre}</td>
                    <td>${movimiento.sucursal_nombre}</td>
                    <td>${this.formatMetodoPago(movimiento.metodo_pago || 'efectivo')}</td>
                    <td class="monto ${esIngreso ? 'ingreso' : ''}">${esIngreso ? '$' + this.formatCurrency(movimiento.monto) : '-'}</td>
                    <td class="monto ${esEgreso ? 'egreso' : ''}">${esEgreso ? '$' + this.formatCurrency(movimiento.monto) : '-'}</td>
                    <td>
                        <button class="ver-detalle-btn" data-id="${movimiento.id}" title="Ver detalle">
                            <i class="fa fa-eye"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    }
    
    /**
     * Renderiza el resumen por método de pago
     */
    renderMediosPagoSummary() {
        const { totales } = this.currentReportData;
        
        // Crear contenedor para el resumen
        const summaryContainer = document.createElement('div');
        summaryContainer.className = 'medios-pago-summary';
        summaryContainer.innerHTML = `
            <h3>Resumen por Método de Pago</h3>
            <div class="summary-table-wrapper">
                <table class="summary-table">
                    <thead>
                        <tr>
                            <th>Método de Pago</th>
                            <th>Ingresos</th>
                            <th>Egresos</th>
                            <th>Balance</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>Efectivo</td>
                            <td class="monto ingreso">$${this.formatCurrency(totales.efectivo.ingresos)}</td>
                            <td class="monto egreso">$${this.formatCurrency(totales.efectivo.egresos)}</td>
                            <td class="monto ${totales.efectivo.balance >= 0 ? 'ingreso' : 'egreso'}">$${this.formatCurrency(totales.efectivo.balance)}</td>
                        </tr>
                        <tr>
                            <td>Tarjeta</td>
                            <td class="monto ingreso">$${this.formatCurrency(totales.tarjeta.ingresos)}</td>
                            <td class="monto egreso">$${this.formatCurrency(totales.tarjeta.egresos)}</td>
                            <td class="monto ${totales.tarjeta.balance >= 0 ? 'ingreso' : 'egreso'}">$${this.formatCurrency(totales.tarjeta.balance)}</td>
                        </tr>
                        <tr>
                            <td>Transferencia</td>
                            <td class="monto ingreso">$${this.formatCurrency(totales.transferencia.ingresos)}</td>
                            <td class="monto egreso">$${this.formatCurrency(totales.transferencia.egresos)}</td>
                            <td class="monto ${totales.transferencia.balance >= 0 ? 'ingreso' : 'egreso'}">$${this.formatCurrency(totales.transferencia.balance)}</td>
                        </tr>
                        <tr>
                            <td>Mercado Pago</td>
                            <td class="monto ingreso">$${this.formatCurrency(totales.mercadoPago.ingresos)}</td>
                            <td class="monto egreso">$${this.formatCurrency(totales.mercadoPago.egresos)}</td>
                            <td class="monto ${totales.mercadoPago.balance >= 0 ? 'ingreso' : 'egreso'}">$${this.formatCurrency(totales.mercadoPago.balance)}</td>
                        </tr>
                        <tr>
                            <td>Otros</td>
                            <td class="monto ingreso">$${this.formatCurrency(totales.otrosMedios.ingresos)}</td>
                            <td class="monto egreso">$${this.formatCurrency(totales.otrosMedios.egresos)}</td>
                            <td class="monto ${totales.otrosMedios.balance >= 0 ? 'ingreso' : 'egreso'}">$${this.formatCurrency(totales.otrosMedios.balance)}</td>
                        </tr>
                        <tr class="total-row">
                            <td><strong>TOTAL</strong></td>
                            <td class="monto ingreso"><strong>$${this.formatCurrency(totales.ingresos)}</strong></td>
                            <td class="monto egreso"><strong>$${this.formatCurrency(totales.egresos)}</strong></td>
                            <td class="monto ${totales.balance >= 0 ? 'ingreso' : 'egreso'}"><strong>$${this.formatCurrency(totales.balance)}</strong></td>
                        </tr>
                    </tbody>
                </table>
            </div>
        `;
        
        // Agregar al contenedor de la tabla
        const oldSummary = this.tableContainer.querySelector('.medios-pago-summary');
        if (oldSummary) {
            this.tableContainer.replaceChild(summaryContainer, oldSummary);
        } else {
            this.tableContainer.appendChild(summaryContainer);
        }
    }
    
    /**
     * Renderiza el resumen por usuarios
     */
    renderUsuariosSummary() {
        const { totales } = this.currentReportData;
        const usuarios = Object.keys(totales.porUsuario);
        
        if (usuarios.length <= 1) {
            return; // No mostrar si solo hay un usuario
        }
        
        // Crear contenedor para el resumen
        const summaryContainer = document.createElement('div');
        summaryContainer.className = 'usuarios-summary';
        
        let usuariosRows = '';
        usuarios.forEach(usuarioId => {
            const usuario = totales.porUsuario[usuarioId];
            usuariosRows += `
                <tr>
                    <td>${usuario.nombre}</td>
                    <td class="monto ingreso">$${this.formatCurrency(usuario.ingresos)}</td>
                    <td class="monto egreso">$${this.formatCurrency(usuario.egresos)}</td>
                    <td class="monto ${usuario.balance >= 0 ? 'ingreso' : 'egreso'}">$${this.formatCurrency(usuario.balance)}</td>
                </tr>
            `;
        });
        
        summaryContainer.innerHTML = `
            <h3>Resumen por Usuario</h3>
            <div class="summary-table-wrapper">
                <table class="summary-table">
                    <thead>
                        <tr>
                            <th>Usuario</th>
                            <th>Ingresos</th>
                            <th>Egresos</th>
                            <th>Balance</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${usuariosRows}
                    </tbody>
                </table>
            </div>
        `;
        
        // Agregar al contenedor de la tabla
        const oldSummary = this.tableContainer.querySelector('.usuarios-summary');
        if (oldSummary) {
            this.tableContainer.replaceChild(summaryContainer, oldSummary);
        } else {
            this.tableContainer.appendChild(summaryContainer);
        }
    }
    
    /**
     * Renderiza el resumen por sucursales
     */
    renderSucursalesSummary() {
        const { totales, filtros } = this.currentReportData;
        const sucursales = Object.keys(totales.porSucursal);
        
        if (sucursales.length <= 1 || filtros.sucursalId !== 'todas') {
            return; // No mostrar si solo hay una sucursal o se filtró por una específica
        }
        
        // Crear contenedor para el resumen
        const summaryContainer = document.createElement('div');
        summaryContainer.className = 'sucursales-summary';
        
        let sucursalesRows = '';
        sucursales.forEach(sucursalId => {
            const sucursal = totales.porSucursal[sucursalId];
            sucursalesRows += `
                <tr>
                    <td>${sucursal.nombre}</td>
                    <td class="monto ingreso">$${this.formatCurrency(sucursal.ingresos)}</td>
                    <td class="monto egreso">$${this.formatCurrency(sucursal.egresos)}</td>
                    <td class="monto ${sucursal.balance >= 0 ? 'ingreso' : 'egreso'}">$${this.formatCurrency(sucursal.balance)}</td>
                </tr>
            `;
        });
        
        summaryContainer.innerHTML = `
            <h3>Resumen por Sucursal</h3>
            <div class="summary-table-wrapper">
                <table class="summary-table">
                    <thead>
                        <tr>
                            <th>Sucursal</th>
                            <th>Ingresos</th>
                            <th>Egresos</th>
                            <th>Balance</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${sucursalesRows}
                    </tbody>
                </table>
            </div>
        `;
        
        // Agregar al contenedor de la tabla
        const oldSummary = this.tableContainer.querySelector('.sucursales-summary');
        if (oldSummary) {
            this.tableContainer.replaceChild(summaryContainer, oldSummary);
        } else {
            this.tableContainer.appendChild(summaryContainer);
        }
    }
    
    /**
     * Actualiza el estado de los botones de exportación
     */
    updateExportButtons() {
        const hasData = this.currentReportData && this.currentReportData.movimientos.length > 0;
        
        this.exportPdfButton.disabled = !hasData;
        this.exportExcelButton.disabled = !hasData;
        this.printButton.disabled = !hasData;
        
        if (hasData) {
            this.exportPdfButton.classList.remove('disabled');
            this.exportExcelButton.classList.remove('disabled');
            this.printButton.classList.remove('disabled');
        } else {
            this.exportPdfButton.classList.add('disabled');
            this.exportExcelButton.classList.add('disabled');
            this.printButton.classList.add('disabled');
        }
    }
    
    /**
     * Muestra el detalle de un movimiento específico
     * @param {string} movimientoId - ID del movimiento
     */
    async mostrarDetalleMovimiento(movimientoId) {
        try {
            // Buscar el movimiento en los datos actuales
            const movimiento = this.currentReportData.movimientos.find(m => m.id === movimientoId);
            
            if (!movimiento) {
                this.showMessage('No se encontró el detalle del movimiento', 'error');
                return;
            }
            
            // Crear modal para mostrar detalles
            const modal = document.createElement('div');
            modal.className = 'modal fade';
            modal.id = 'detalleMovimientoModal';
            modal.setAttribute('tabindex', '-1');
            modal.setAttribute('role', 'dialog');
            modal.setAttribute('aria-labelledby', 'detalleMovimientoLabel');
            modal.setAttribute('aria-hidden', 'true');
            
            let contenidoDetalle = '';
            
            // Contenido según tipo de movimiento
            switch (movimiento.tipo) {
                case 'apertura':
                    contenidoDetalle = this.generarDetalleApertura(movimiento);
                    break;
                case 'cierre':
                    contenidoDetalle = this.generarDetalleCierre(movimiento);
                    break;
                case 'venta':
                    contenidoDetalle = await this.generarDetalleVenta(movimiento);
                    break;
                case 'gasto':
                    contenidoDetalle = this.generarDetalleGasto(movimiento);
                    break;
                case 'ingreso_extra':
                    contenidoDetalle = this.generarDetalleIngresoExtra(movimiento);
                    break;
                case 'retiro':
                    contenidoDetalle = this.generarDetalleRetiro(movimiento);
                    break;
                default:
                    contenidoDetalle = this.generarDetalleGenerico(movimiento);
            }
            
            modal.innerHTML = `
                <div class="modal-dialog modal-lg" role="document">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title" id="detalleMovimientoLabel">
                                Detalle de ${this.formatTipoMovimiento(movimiento.tipo)}
                            </h5>
                            <button type="button" class="close" data-dismiss="modal" aria-label="Cerrar">
                                <span aria-hidden="true">&times;</span>
                            </button>
                        </div>
                        <div class="modal-body">
                            ${contenidoDetalle}
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-dismiss="modal">Cerrar</button>
                            ${this.generarBotonesAccionesModal(movimiento)}
                        </div>
                    </div>
                </div>
            `;
            
            // Agregar modal al DOM
            document.body.appendChild(modal);
            
            // Mostrar modal usando Bootstrap
            $(modal).modal('show');
            
            // Cuando se cierre, eliminar del DOM
            $(modal).on('hidden.bs.modal', () => {
                document.body.removeChild(modal);
            });
            
            // Configurar botones de acciones
            this.configurarBotonesAccionesModal(movimiento);
        } catch (error) {
            console.error('Error al mostrar detalle de movimiento:', error);
            this.showMessage('Error al cargar el detalle del movimiento', 'error');
        }
    }
    
    /**
     * Genera HTML para detalles de apertura de caja
     * @param {Object} movimiento - Datos del movimiento
     * @returns {string} HTML del detalle
     */
    generarDetalleApertura(movimiento) {
        const fecha = new Date(movimiento.fecha);
        const formattedDate = fecha.toLocaleDateString('es-AR', { 
            year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' 
        });
        
        const detalle = movimiento.detalle || {};
        
        return `
            <div class="detalle-apertura">
                <div class="row">
                    <div class="col-md-6">
                        <p><strong>Fecha:</strong> ${formattedDate}</p>
                        <p><strong>Usuario:</strong> ${movimiento.usuario_nombre}</p>
                        <p><strong>Sucursal:</strong> ${movimiento.sucursal_nombre}</p>
                    </div>
                    <div class="col-md-6">
                        <p><strong>Monto inicial:</strong> $${this.formatCurrency(movimiento.monto)}</p>
                        <p><strong>Caja:</strong> ${detalle.caja_id || 'Principal'}</p>
                        <p><strong>Observaciones:</strong> ${detalle.observaciones || 'Sin observaciones'}</p>
                    </div>
                </div>
            </div>
        `;
    }
    
    /**
     * Genera HTML para detalles de cierre de caja
     * @param {Object} movimiento - Datos del movimiento
     * @returns {string} HTML del detalle
     */
    generarDetalleCierre(movimiento) {
        const fecha = new Date(movimiento.fecha);
        const formattedDate = fecha.toLocaleDateString('es-AR', { 
            year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' 
        });
        
        const detalle = movimiento.detalle || {};
        
        return `
            <div class="detalle-cierre">
                <div class="row">
                    <div class="col-md-6">
                        <p><strong>Fecha:</strong> ${formattedDate}</p>
                        <p><strong>Usuario:</strong> ${movimiento.usuario_nombre}</p>
                        <p><strong>Sucursal:</strong> ${movimiento.sucursal_nombre}</p>
                    </div>
                    <div class="col-md-6">
                        <p><strong>Monto cierre:</strong> $${this.formatCurrency(movimiento.monto)}</p>
                        <p><strong>Caja:</strong> ${detalle.caja_id || 'Principal'}</p>
                        <p><strong>Observaciones:</strong> ${detalle.observaciones || 'Sin observaciones'}</p>
                    </div>
                </div>
                
                <h4>Desglose de cierre</h4>
                <div class="row">
                    <div class="col-md-6">
                        <p><strong>Efectivo:</strong> $${this.formatCurrency(detalle.montos?.efectivo || 0)}</p>
                        <p><strong>Tarjetas:</strong> $${this.formatCurrency(detalle.montos?.tarjeta || 0)}</p>
                        <p><strong>Transferencias:</strong> $${this.formatCurrency(detalle.montos?.transferencia || 0)}</p>
                    </div>
                    <div class="col-md-6">
                        <p><strong>Mercado Pago:</strong> $${this.formatCurrency(detalle.montos?.mercadopago || 0)}</p>
                        <p><strong>Otros:</strong> $${this.formatCurrency(detalle.montos?.otros || 0)}</p>
                        <p><strong>Diferencia:</strong> <span class="${(detalle.diferencia || 0) >= 0 ? 'text-success' : 'text-danger'}">$${this.formatCurrency(detalle.diferencia || 0)}</span></p>
                    </div>
                </div>
            </div>
        `;
    }
    
    /**
     * Genera HTML para detalles de venta
     * @param {Object} movimiento - Datos del movimiento
     * @returns {string} HTML del detalle
     */
    async generarDetalleVenta(movimiento) {
        try {
            const fecha = new Date(movimiento.fecha);
            const formattedDate = fecha.toLocaleDateString('es-AR', { 
                year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' 
            });
            
            const detalle = movimiento.detalle || {};
            
            // Si necesitamos detalles adicionales de la factura
            let itemsHtml = '';
            if (detalle.id && detalle.items?.length) {
                // Los items ya están en la factura
                itemsHtml = this.generarItemsFacturaHtml(detalle.items);
            } else if (detalle.id) {
                // Si no tenemos los items, pero tenemos el ID de la factura
                try {
                    const factura = await database.getById('facturas', detalle.id);
                    if (factura && factura.items) {
                        itemsHtml = this.generarItemsFacturaHtml(factura.items);
                    }
                } catch (error) {
                    console.error('Error al obtener detalles de factura:', error);
                    itemsHtml = '<p class="text-danger">No se pudieron cargar los detalles de la factura</p>';
                }
            }
            
            return `
                <div class="detalle-venta">
                    <div class="row">
                        <div class="col-md-6">
                            <p><strong>Fecha:</strong> ${formattedDate}</p>
                            <p><strong>Usuario:</strong> ${movimiento.usuario_nombre}</p>
                            <p><strong>Sucursal:</strong> ${movimiento.sucursal_nombre}</p>
                        </div>
                        <div class="col-md-6">
                            <p><strong>Factura N°:</strong> ${detalle.numero || 'Sin número'}</p>
                            <p><strong>Cliente:</strong> ${detalle.cliente?.nombre || 'Consumidor Final'}</p>
                            <p><strong>Método de pago:</strong> ${this.formatMetodoPago(movimiento.metodo_pago)}</p>
                            <p><strong>Monto:</strong> $${this.formatCurrency(movimiento.monto)}</p>
                        </div>
                    </div>
                    
                    <h4>Detalles de la venta</h4>
                    ${itemsHtml}
                </div>
            `;
        } catch (error) {
            console.error('Error al generar detalle de venta:', error);
            return `<p class="text-danger">Error al cargar los detalles de la venta: ${error.message}</p>`;
        }
    }
    
    /**
     * Genera HTML para la lista de items de una factura
     * @param {Array} items - Items de la factura
     * @returns {string} HTML con los items
     */
    generarItemsFacturaHtml(items) {
        if (!items || items.length === 0) {
            return '<p>No hay detalles disponibles</p>';
        }
        
        const itemsRows = items.map(item => `
            <tr>
                <td>${item.cantidad}</td>
                <td>${item.descripcion}</td>
                <td>$${this.formatCurrency(item.precio_unitario)}</td>
                <td>$${this.formatCurrency(item.subtotal)}</td>
            </tr>
        `).join('');
        
        return `
            <div class="table-responsive">
                <table class="table table-sm">
                    <thead>
                        <tr>
                            <th>Cantidad</th>
                            <th>Descripción</th>
                            <th>Precio Unitario</th>
                            <th>Subtotal</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${itemsRows}
                    </tbody>
                </table>
            </div>
        `;
    }
    
    /**
     * Genera HTML para detalles de gasto
     * @param {Object} movimiento - Datos del movimiento
     * @returns {string} HTML del detalle
     */
    generarDetalleGasto(movimiento) {
        const fecha = new Date(movimiento.fecha);
        const formattedDate = fecha.toLocaleDateString('es-AR', { 
            year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' 
        });
        
        const detalle = movimiento.detalle || {};
        
        return `
            <div class="detalle-gasto">
                <div class="row">
                    <div class="col-md-6">
                        <p><strong>Fecha:</strong> ${formattedDate}</p>
                        <p><strong>Usuario:</strong> ${movimiento.usuario_nombre}</p>
                        <p><strong>Sucursal:</strong> ${movimiento.sucursal_nombre}</p>
                    </div>
                    <div class="col-md-6">
                        <p><strong>Categoría:</strong> ${detalle.categoria || 'Sin categoría'}</p>
                        <p><strong>Proveedor:</strong> ${detalle.proveedor || 'No especificado'}</p>
                        <p><strong>Método de pago:</strong> ${this.formatMetodoPago(movimiento.metodo_pago)}</p>
                        <p><strong>Monto:</strong> $${this.formatCurrency(movimiento.monto)}</p>
                    </div>
                </div>
                
                <div class="row">
                    <div class="col-12">
                        <p><strong>Descripción:</strong> ${detalle.descripcion || 'Sin descripción'}</p>
                        <p><strong>Observaciones:</strong> ${detalle.observaciones || 'Sin observaciones'}</p>
                    </div>
                </div>
                
                ${detalle.comprobante ? `
                <div class="row mt-3">
                    <div class="col-12">
                        <p><strong>Comprobante:</strong> ${detalle.comprobante}</p>
                        <p><strong>N° Comprobante:</strong> ${detalle.numero_comprobante || 'No especificado'}</p>
                    </div>
                </div>
                ` : ''}
            </div>
        `;
    }
    
    /**
     * Genera HTML para detalles de ingreso extra
     * @param {Object} movimiento - Datos del movimiento
     * @returns {string} HTML del detalle
     */
    generarDetalleIngresoExtra(movimiento) {
        const fecha = new Date(movimiento.fecha);
        const formattedDate = fecha.toLocaleDateString('es-AR', { 
            year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' 
        });
        
        const detalle = movimiento.detalle || {};
        
        return `
            <div class="detalle-ingreso-extra">
                <div class="row">
                    <div class="col-md-6">
                        <p><strong>Fecha:</strong> ${formattedDate}</p>
                        <p><strong>Usuario:</strong> ${movimiento.usuario_nombre}</p>
                        <p><strong>Sucursal:</strong> ${movimiento.sucursal_nombre}</p>
                    </div>
                    <div class="col-md-6">
                        <p><strong>Categoría:</strong> ${detalle.categoria || 'Sin categoría'}</p>
                        <p><strong>Método de pago:</strong> ${this.formatMetodoPago(movimiento.metodo_pago)}</p>
                        <p><strong>Monto:</strong> $${this.formatCurrency(movimiento.monto)}</p>
                    </div>
                </div>
                
                <div class="row">
                    <div class="col-12">
                        <p><strong>Descripción:</strong> ${detalle.descripcion || 'Sin descripción'}</p>
                        <p><strong>Observaciones:</strong> ${detalle.observaciones || 'Sin observaciones'}</p>
                    </div>
                </div>
            </div>
        `;
    }
    
    /**
     * Genera HTML para detalles de retiro de caja
     * @param {Object} movimiento - Datos del movimiento
     * @returns {string} HTML del detalle
     */
    generarDetalleRetiro(movimiento) {
        const fecha = new Date(movimiento.fecha);
        const formattedDate = fecha.toLocaleDateString('es-AR', { 
            year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' 
        });
        
        const detalle = movimiento.detalle || {};
        
        return `
            <div class="detalle-retiro">
                <div class="row">
                    <div class="col-md-6">
                        <p><strong>Fecha:</strong> ${formattedDate}</p>
                        <p><strong>Usuario:</strong> ${movimiento.usuario_nombre}</p>
                        <p><strong>Sucursal:</strong> ${movimiento.sucursal_nombre}</p>
                    </div>
                    <div class="col-md-6">
                        <p><strong>Destinatario:</strong> ${detalle.destinatario || 'No especificado'}</p>
                        <p><strong>Método de pago:</strong> ${this.formatMetodoPago(movimiento.metodo_pago)}</p>
                        <p><strong>Monto:</strong> $${this.formatCurrency(movimiento.monto)}</p>
                    </div>
                </div>
                
                <div class="row">
                    <div class="col-12">
                        <p><strong>Motivo:</strong> ${detalle.motivo || 'Sin motivo especificado'}</p>
                        <p><strong>Autorizado por:</strong> ${detalle.autorizado_por || 'No especificado'}</p>
                        <p><strong>Observaciones:</strong> ${detalle.observaciones || 'Sin observaciones'}</p>
                    </div>
                </div>
            </div>
        `;
    }
    
    /**
     * Genera HTML para detalles de movimiento genérico
     * @param {Object} movimiento - Datos del movimiento
     * @returns {string} HTML del detalle
     */
    generarDetalleGenerico(movimiento) {
        const fecha = new Date(movimiento.fecha);
        const formattedDate = fecha.toLocaleDateString('es-AR', { 
            year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' 
        });
        
        return `
            <div class="detalle-generico">
                <div class="row">
                    <div class="col-md-6">
                        <p><strong>Fecha:</strong> ${formattedDate}</p>
                        <p><strong>Usuario:</strong> ${movimiento.usuario_nombre}</p>
                        <p><strong>Sucursal:</strong> ${movimiento.sucursal_nombre}</p>
                    </div>
                    <div class="col-md-6">
                        <p><strong>Tipo:</strong> ${this.formatTipoMovimiento(movimiento.tipo)}</p>
                        <p><strong>Método de pago:</strong> ${this.formatMetodoPago(movimiento.metodo_pago)}</p>
                        <p><strong>Monto:</strong> $${this.formatCurrency(movimiento.monto)}</p>
                    </div>
                </div>
                
                <div class="row">
                    <div class="col-12">
                        <p><strong>Descripción:</strong> ${movimiento.descripcion || 'Sin descripción'}</p>
                        <p><strong>Observaciones:</strong> ${movimiento.observaciones || 'Sin observaciones'}</p>
                    </div>
                </div>
            </div>
        `;
    }
    
    /**
     * Genera los botones de acción para el modal de detalle
     * @param {Object} movimiento - Datos del movimiento
     * @returns {string} HTML con los botones
     */
    generarBotonesAccionesModal(movimiento) {
        const permisosExportacion = this.userPermissions.reportes.caja.exportar;
        
        let botonesHtml = '';
        
        if (permisosExportacion) {
            // Botón para imprimir detalle
            botonesHtml += `
                <button type="button" class="btn btn-info" id="imprimirDetalleBtn">
                    <i class="fa fa-print"></i> Imprimir
                </button>
            `;
            
            // Botón para exportar detalle a PDF
            botonesHtml += `
                <button type="button" class="btn btn-danger" id="exportarDetallePdfBtn">
                    <i class="fa fa-file-pdf-o"></i> Exportar PDF
                </button>
            `;
        }
        
        return botonesHtml;
    }
    
    /**
     * Configura los eventos para los botones de acción del modal
     * @param {Object} movimiento - Datos del movimiento
     */
    configurarBotonesAccionesModal(movimiento) {
        // Botón imprimir detalle
        const imprimirBtn = document.getElementById('imprimirDetalleBtn');
        if (imprimirBtn) {
            imprimirBtn.addEventListener('click', () => {
                this.imprimirDetalleMovimiento(movimiento);
            });
        }
        
        // Botón exportar detalle a PDF
        const exportarPdfBtn = document.getElementById('exportarDetallePdfBtn');
        if (exportarPdfBtn) {
            exportarPdfBtn.addEventListener('click', () => {
                this.exportarDetallePdf(movimiento);
            });
        }
    }
    
    /**
     * Exporta el reporte completo a PDF
     */
    exportToPdf() {
        try {
            if (!this.currentReportData) {
                this.showMessage('No hay datos para exportar', 'warning');
                return;
            }
            
            this.showLoading(true);
            
            // Verificar permisos
            if (!this.userPermissions.reportes.caja.exportar) {
                this.showMessage('No tienes permisos para exportar reportes', 'error');
                this.showLoading(false);
                return;
            }
            
            const { filtros, totales } = this.currentReportData;
            
            // Formato de fecha para el nombre del archivo
            const fechaArchivo = new Date().toISOString().split('T')[0];
            const nombreArchivo = `reporte_caja_${fechaArchivo}.pdf`;
            
            // Crear documento PDF
            const docDefinition = {
                info: {
                    title: 'Reporte de Caja',
                    author: this.currentUser.nombre + ' ' + this.currentUser.apellido,
                    subject: 'Reporte de movimientos de caja',
                    keywords: 'caja, reporte, movimientos',
                    creator: 'Sistema de Gestión',
                    producer: 'Sistema de Gestión'
                },
                content: [
                    // Encabezado
                    {
                        text: 'Reporte de Caja',
                        style: 'header',
                        alignment: 'center'
                    },
                    {
                        text: `Período: ${new Date(filtros.fechaInicio).toLocaleDateString('es-AR')} al ${new Date(filtros.fechaFin).toLocaleDateString('es-AR')}`,
                        style: 'subheader',
                        alignment: 'center'
                    },
                    {
                        text: `Generado: ${new Date().toLocaleDateString('es-AR', { 
                            year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' 
                        })}`,
                        style: 'subheader',
                        alignment: 'center'
                    },
                    
                    // Filtros aplicados
                    {
                        text: 'Filtros aplicados:',
                        style: 'subheader',
                        margin: [0, 20, 0, 10]
                    },
                    {
                        columns: [
                            { text: `Sucursal: ${filtros.sucursalId === 'todas' ? 'Todas las sucursales' : this.currentReportData.sucursalesMap[filtros.sucursalId]}` },
                            { text: `Usuario: ${filtros.usuarioId === 'todos' ? 'Todos los usuarios' : this.currentReportData.usuariosMap[filtros.usuarioId]}` },
                            { text: `Tipo: ${filtros.tipoMovimiento === 'todos' ? 'Todos los movimientos' : this.formatTipoMovimiento(filtros.tipoMovimiento)}` }
                        ]
                    },
                    
                    // Totales
                    {
                        text: 'Resumen General:',
                        style: 'subheader',
                        margin: [0, 20, 0, 10]
                    },
                    {
                        columns: [
                            { text: `Total Ingresos: $${this.formatCurrency(totales.ingresos)}`, style: 'totales' },
                            { text: `Total Egresos: $${this.formatCurrency(totales.egresos)}`, style: 'totales' },
                            { text: `Balance: $${this.formatCurrency(totales.balance)}`, style: 'totales' }
                        ]
                    },
                    
                    // Resumen por método de pago
                    {
                        text: 'Resumen por Método de Pago:',
                        style: 'subheader',
                        margin: [0, 20, 0, 10]
                    },
                    this.generarTablaPdfMediosPago(),
                    
                    // Tabla de movimientos
                    {
                        text: 'Detalle de Movimientos:',
                        style: 'subheader',
                        margin: [0, 20, 0, 10]
                    },
                    this.generarTablaPdfMovimientos()
                ],
                styles: {
                    header: {
                        fontSize: 22,
                        bold: true,
                        margin: [0, 0, 0, 10]
                    },
                    subheader: {
                        fontSize: 16,
                        bold: true,
                        margin: [0, 10, 0, 5]
                    },
                    totales: {
                        fontSize: 14,
                        bold: true
                    },
                    tableHeader: {
                        bold: true,
                        fontSize: 12,
                        color: 'black'
                    }
                },
                defaultStyle: {
                    fontSize: 10
                },
                footer: function(currentPage, pageCount) {
                    return {
                        text: `Página ${currentPage} de ${pageCount}`,
                        alignment: 'center',
                        margin: [0, 10, 0, 0]
                    };
                }
            };
            
            // Si hay datos por usuario, agregar tabla
            if (Object.keys(totales.porUsuario).length > 1) {
                docDefinition.content.push(
                    {
                        text: 'Resumen por Usuario:',
                        style: 'subheader',
                        margin: [0, 20, 0, 10]
                    },
                    this.generarTablaPdfUsuarios()
                );
            }
            
            // Si hay datos por sucursal, agregar tabla
            if (Object.keys(totales.porSucursal).length > 1 && filtros.sucursalId === 'todas') {
                docDefinition.content.push(
                    {
                        text: 'Resumen por Sucursal:',
                        style: 'subheader',
                        margin: [0, 20, 0, 10]
                    },
                    this.generarTablaPdfSucursales()
                );
            }
            
            // Generar PDF y descargar
            printer.generatePdf(docDefinition, nombreArchivo)
                .then(() => {
                    this.showMessage('Reporte exportado correctamente', 'success');
                    
                    // Registrar actividad
                    logger.log({
                        tipo: 'exportacion',
                        modulo: 'reportes_caja',
                        usuario: this.currentUser.id,
                        descripcion: `Exportó reporte de caja a PDF`
                    });
                })
                .catch(error => {
                    console.error('Error al exportar PDF:', error);
                    this.showMessage('Error al exportar el reporte a PDF', 'error');
                })
                .finally(() => {
                    this.showLoading(false);
                });
        } catch (error) {
            console.error('Error al exportar a PDF:', error);
            this.showMessage('Error al exportar el reporte a PDF', 'error');
            this.showLoading(false);
        }
    }
    
    /**
     * Exporta el reporte completo a Excel
     */
    exportToExcel() {
        try {
            if (!this.currentReportData) {
                this.showMessage('No hay datos para exportar', 'warning');
                return;
            }
            
            this.showLoading(true);
            
            // Verificar permisos
            if (!this.userPermissions.reportes.caja.exportar) {
                this.showMessage('No tienes permisos para exportar reportes', 'error');
                this.showLoading(false);
                return;
            }
            
            const { movimientos, totales, filtros } = this.currentReportData;
            
            // Formato de fecha para el nombre del archivo
            const fechaArchivo = new Date().toISOString().split('T')[0];
            const nombreArchivo = `reporte_caja_${fechaArchivo}.xlsx`;
            
            // Crear libro de Excel
            const wb = XLSX.utils.book_new();
            wb.Props = {
                Title: "Reporte de Caja",
                Subject: "Movimientos de Caja",
                Author: this.currentUser.nombre + ' ' + this.currentUser.apellido,
                CreatedDate: new Date()
            };
            
            // Crear hoja de resumen
            const resumenData = [
                ["Reporte de Caja"],
                [`Período: ${new Date(filtros.fechaInicio).toLocaleDateString('es-AR')} al ${new Date(filtros.fechaFin).toLocaleDateString('es-AR')}`],
                [`Generado: ${new Date().toLocaleDateString('es-AR')}`],
                [],
                ["Filtros aplicados:"],
                [`Sucursal: ${filtros.sucursalId === 'todas' ? 'Todas las sucursales' : this.currentReportData.sucursalesMap[filtros.sucursalId]}`],
                [`Usuario: ${filtros.usuarioId === 'todos' ? 'Todos los usuarios' : this.currentReportData.usuariosMap[filtros.usuarioId]}`],
                [`Tipo: ${filtros.tipoMovimiento === 'todos' ? 'Todos los movimientos' : this.formatTipoMovimiento(filtros.tipoMovimiento)}`],
                [],
                ["Resumen General:"],
                [`Total Ingresos: $${this.formatCurrency(totales.ingresos)}`],
                [`Total Egresos: $${this.formatCurrency(totales.egresos)}`],
                [`Balance: $${this.formatCurrency(totales.balance)}`]
            ];
            
            const wsResumen = XLSX.utils.aoa_to_sheet(resumenData);
            XLSX.utils.book_append_sheet(wb, wsResumen, "Resumen");
            
            // Crear hoja de movimientos
            const movimientosData = [
                ["Fecha", "Hora", "Tipo", "Descripción", "Usuario", "Sucursal", "Método de Pago", "Ingreso", "Egreso"]
            ];
            
            // Agregar filas de movimientos
            movimientos.forEach(movimiento => {
                const fecha = new Date(movimiento.fecha);
                const formattedDate = fecha.toLocaleDateString('es-AR');
                const formattedTime = fecha.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
                const esIngreso = ['apertura', 'venta', 'ingreso_extra', 'ajuste_positivo'].includes(movimiento.tipo);
                const esEgreso = ['cierre', 'gasto', 'retiro', 'ajuste_negativo'].includes(movimiento.tipo);
                
                movimientosData.push([
                    formattedDate,
                    formattedTime,
                    this.formatTipoMovimiento(movimiento.tipo),
                    this.getMovimientoDescripcion(movimiento),
                    movimiento.usuario_nombre,
                    movimiento.sucursal_nombre,
                    this.formatMetodoPago(movimiento.metodo_pago || 'efectivo'),
                    esIngreso ? movimiento.monto : '',
                    esEgreso ? movimiento.monto : ''
                ]);
            });
            
            const wsMovimientos = XLSX.utils.aoa_to_sheet(movimientosData);
            XLSX.utils.book_append_sheet(wb, wsMovimientos, "Movimientos");
            
            // Crear hoja de métodos de pago
            const mediosPagoData = [
                ["Método de Pago", "Ingresos", "Egresos", "Balance"]
            ];
            
            mediosPagoData.push(
                ["Efectivo", totales.efectivo.ingresos, totales.efectivo.egresos, totales.efectivo.balance],
                ["Tarjeta", totales.tarjeta.ingresos, totales.tarjeta.egresos, totales.tarjeta.balance],
                ["Transferencia", totales.transferencia.ingresos, totales.transferencia.egresos, totales.transferencia.balance],
                ["Mercado Pago", totales.mercadoPago.ingresos, totales.mercadoPago.egresos, totales.mercadoPago.balance],
                ["Otros", totales.otrosMedios.ingresos, totales.otrosMedios.egresos, totales.otrosMedios.balance],
                ["TOTAL", totales.ingresos, totales.egresos, totales.balance]
            );
            
            const wsMediosPago = XLSX.utils.aoa_to_sheet(mediosPagoData);
            XLSX.utils.book_append_sheet(wb, wsMediosPago, "Métodos de Pago");
            
            // Si hay datos por usuario, crear hoja
            if (Object.keys(totales.porUsuario).length > 1) {const usuariosData = [
                ["Usuario", "Ingresos", "Egresos", "Balance"]
            ];
            
            Object.keys(totales.porUsuario).forEach(usuarioId => {
                const usuario = totales.porUsuario[usuarioId];
                usuariosData.push([
                    this.currentReportData.usuariosMap[usuarioId] || 'Usuario desconocido',
                    usuario.ingresos,
                    usuario.egresos,
                    usuario.balance
                ]);
            });
            
            const wsUsuarios = XLSX.utils.aoa_to_sheet(usuariosData);
            XLSX.utils.book_append_sheet(wb, wsUsuarios, "Por Usuario");
        }
        
        // Si hay datos por sucursal, crear hoja
        if (Object.keys(totales.porSucursal).length > 1 && filtros.sucursalId === 'todas') {
            const sucursalesData = [
                ["Sucursal", "Ingresos", "Egresos", "Balance"]
            ];
            
            Object.keys(totales.porSucursal).forEach(sucursalId => {
                const sucursal = totales.porSucursal[sucursalId];
                sucursalesData.push([
                    this.currentReportData.sucursalesMap[sucursalId] || 'Sucursal desconocida',
                    sucursal.ingresos,
                    sucursal.egresos,
                    sucursal.balance
                ]);
            });
            
            const wsSucursales = XLSX.utils.aoa_to_sheet(sucursalesData);
            XLSX.utils.book_append_sheet(wb, wsSucursales, "Por Sucursal");
        }
        
        // Exportar archivo Excel
        XLSX.writeFile(wb, nombreArchivo);
        
        this.showMessage('Reporte exportado correctamente', 'success');
        
        // Registrar actividad
        logger.log({
            tipo: 'exportacion',
            modulo: 'reportes_caja',
            usuario: this.currentUser.id,
            descripcion: `Exportó reporte de caja a Excel`
        });
        
        this.showLoading(false);
    } catch (error) {
        console.error('Error al exportar a Excel:', error);
        this.showMessage('Error al exportar el reporte a Excel', 'error');
        this.showLoading(false);
    }
}

/**
 * Genera una tabla para PDF con los medios de pago
 * @returns {Object} Definición de tabla para pdfmake
 */
generarTablaPdfMediosPago() {
    if (!this.currentReportData) return {};
    
    const { totales } = this.currentReportData;
    
    return {
        table: {
            headerRows: 1,
            widths: ['*', 'auto', 'auto', 'auto'],
            body: [
                [
                    { text: 'Método de Pago', style: 'tableHeader' },
                    { text: 'Ingresos', style: 'tableHeader', alignment: 'right' },
                    { text: 'Egresos', style: 'tableHeader', alignment: 'right' },
                    { text: 'Balance', style: 'tableHeader', alignment: 'right' }
                ],
                [
                    'Efectivo',
                    { text: `$${this.formatCurrency(totales.efectivo.ingresos)}`, alignment: 'right' },
                    { text: `$${this.formatCurrency(totales.efectivo.egresos)}`, alignment: 'right' },
                    { text: `$${this.formatCurrency(totales.efectivo.balance)}`, alignment: 'right' }
                ],
                [
                    'Tarjeta',
                    { text: `$${this.formatCurrency(totales.tarjeta.ingresos)}`, alignment: 'right' },
                    { text: `$${this.formatCurrency(totales.tarjeta.egresos)}`, alignment: 'right' },
                    { text: `$${this.formatCurrency(totales.tarjeta.balance)}`, alignment: 'right' }
                ],
                [
                    'Transferencia',
                    { text: `$${this.formatCurrency(totales.transferencia.ingresos)}`, alignment: 'right' },
                    { text: `$${this.formatCurrency(totales.transferencia.egresos)}`, alignment: 'right' },
                    { text: `$${this.formatCurrency(totales.transferencia.balance)}`, alignment: 'right' }
                ],
                [
                    'Mercado Pago',
                    { text: `$${this.formatCurrency(totales.mercadoPago.ingresos)}`, alignment: 'right' },
                    { text: `$${this.formatCurrency(totales.mercadoPago.egresos)}`, alignment: 'right' },
                    { text: `$${this.formatCurrency(totales.mercadoPago.balance)}`, alignment: 'right' }
                ],
                [
                    'Otros',
                    { text: `$${this.formatCurrency(totales.otrosMedios.ingresos)}`, alignment: 'right' },
                    { text: `$${this.formatCurrency(totales.otrosMedios.egresos)}`, alignment: 'right' },
                    { text: `$${this.formatCurrency(totales.otrosMedios.balance)}`, alignment: 'right' }
                ],
                [
                    { text: 'TOTAL', style: 'tableHeader' },
                    { text: `$${this.formatCurrency(totales.ingresos)}`, style: 'tableHeader', alignment: 'right' },
                    { text: `$${this.formatCurrency(totales.egresos)}`, style: 'tableHeader', alignment: 'right' },
                    { text: `$${this.formatCurrency(totales.balance)}`, style: 'tableHeader', alignment: 'right' }
                ]
            ]
        },
        layout: 'lightHorizontalLines'
    };
}

/**
 * Genera una tabla para PDF con los usuarios
 * @returns {Object} Definición de tabla para pdfmake
 */
generarTablaPdfUsuarios() {
    if (!this.currentReportData) return {};
    
    const { totales } = this.currentReportData;
    
    const usuariosRows = Object.keys(totales.porUsuario).map(usuarioId => {
        const usuario = totales.porUsuario[usuarioId];
        return [
            this.currentReportData.usuariosMap[usuarioId] || 'Usuario desconocido',
            { text: `$${this.formatCurrency(usuario.ingresos)}`, alignment: 'right' },
            { text: `$${this.formatCurrency(usuario.egresos)}`, alignment: 'right' },
            { text: `$${this.formatCurrency(usuario.balance)}`, alignment: 'right' }
        ];
    });
    
    // Agregar fila de totales
    usuariosRows.push([
        { text: 'TOTAL', style: 'tableHeader' },
        { text: `$${this.formatCurrency(totales.ingresos)}`, style: 'tableHeader', alignment: 'right' },
        { text: `$${this.formatCurrency(totales.egresos)}`, style: 'tableHeader', alignment: 'right' },
        { text: `$${this.formatCurrency(totales.balance)}`, style: 'tableHeader', alignment: 'right' }
    ]);
    
    return {
        table: {
            headerRows: 1,
            widths: ['*', 'auto', 'auto', 'auto'],
            body: [
                [
                    { text: 'Usuario', style: 'tableHeader' },
                    { text: 'Ingresos', style: 'tableHeader', alignment: 'right' },
                    { text: 'Egresos', style: 'tableHeader', alignment: 'right' },
                    { text: 'Balance', style: 'tableHeader', alignment: 'right' }
                ],
                ...usuariosRows
            ]
        },
        layout: 'lightHorizontalLines'
    };
}

/**
 * Genera una tabla para PDF con las sucursales
 * @returns {Object} Definición de tabla para pdfmake
 */
generarTablaPdfSucursales() {
    if (!this.currentReportData) return {};
    
    const { totales } = this.currentReportData;
    
    const sucursalesRows = Object.keys(totales.porSucursal).map(sucursalId => {
        const sucursal = totales.porSucursal[sucursalId];
        return [
            this.currentReportData.sucursalesMap[sucursalId] || 'Sucursal desconocida',
            { text: `$${this.formatCurrency(sucursal.ingresos)}`, alignment: 'right' },
            { text: `$${this.formatCurrency(sucursal.egresos)}`, alignment: 'right' },
            { text: `$${this.formatCurrency(sucursal.balance)}`, alignment: 'right' }
        ];
    });
    
    // Agregar fila de totales
    sucursalesRows.push([
        { text: 'TOTAL', style: 'tableHeader' },
        { text: `$${this.formatCurrency(totales.ingresos)}`, style: 'tableHeader', alignment: 'right' },
        { text: `$${this.formatCurrency(totales.egresos)}`, style: 'tableHeader', alignment: 'right' },
        { text: `$${this.formatCurrency(totales.balance)}`, style: 'tableHeader', alignment: 'right' }
    ]);
    
    return {
        table: {
            headerRows: 1,
            widths: ['*', 'auto', 'auto', 'auto'],
            body: [
                [
                    { text: 'Sucursal', style: 'tableHeader' },
                    { text: 'Ingresos', style: 'tableHeader', alignment: 'right' },
                    { text: 'Egresos', style: 'tableHeader', alignment: 'right' },
                    { text: 'Balance', style: 'tableHeader', alignment: 'right' }
                ],
                ...sucursalesRows
            ]
        },
        layout: 'lightHorizontalLines'
    };
}

/**
 * Genera una tabla para PDF con los movimientos
 * @returns {Object} Definición de tabla para pdfmake
 */
generarTablaPdfMovimientos() {
    if (!this.currentReportData) return {};
    
    const { movimientos } = this.currentReportData;
    
    const movimientosRows = movimientos.map(movimiento => {
        const fecha = new Date(movimiento.fecha);
        const formattedDate = fecha.toLocaleDateString('es-AR');
        const formattedTime = fecha.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
        const esIngreso = ['apertura', 'venta', 'ingreso_extra', 'ajuste_positivo'].includes(movimiento.tipo);
        const esEgreso = ['cierre', 'gasto', 'retiro', 'ajuste_negativo'].includes(movimiento.tipo);
        
        return [
            formattedDate,
            formattedTime,
            this.formatTipoMovimiento(movimiento.tipo),
            this.getMovimientoDescripcion(movimiento),
            movimiento.usuario_nombre,
            this.formatMetodoPago(movimiento.metodo_pago || 'efectivo'),
            { 
                text: esIngreso ? `$${this.formatCurrency(movimiento.monto)}` : '', 
                alignment: 'right'
            },
            { 
                text: esEgreso ? `$${this.formatCurrency(movimiento.monto)}` : '', 
                alignment: 'right'
            }
        ];
    });
    
    return {
        table: {
            headerRows: 1,
            widths: ['auto', 'auto', 'auto', '*', 'auto', 'auto', 'auto', 'auto'],
            body: [
                [
                    { text: 'Fecha', style: 'tableHeader' },
                    { text: 'Hora', style: 'tableHeader' },
                    { text: 'Tipo', style: 'tableHeader' },
                    { text: 'Descripción', style: 'tableHeader' },
                    { text: 'Usuario', style: 'tableHeader' },
                    { text: 'Método', style: 'tableHeader' },
                    { text: 'Ingreso', style: 'tableHeader', alignment: 'right' },
                    { text: 'Egreso', style: 'tableHeader', alignment: 'right' }
                ],
                ...movimientosRows
            ]
        },
        layout: 'lightHorizontalLines'
    };
}

/**
 * Imprime el detalle de un movimiento
 * @param {Object} movimiento - Datos del movimiento
 */
imprimirDetalleMovimiento(movimiento) {
    try {
        if (!movimiento) {
            this.showMessage('No hay datos para imprimir', 'warning');
            return;
        }
        
        this.showLoading(true);
        
        // Verificar permisos
        if (!this.userPermissions.reportes.caja.exportar) {
            this.showMessage('No tienes permisos para imprimir reportes', 'error');
            this.showLoading(false);
            return;
        }
        
        // Obtener el tipo de movimiento y contenido HTML
        const htmlContent = document.getElementById('detalleMovimientoContent').innerHTML;
        
        // Crear ventana de impresión
        const printWindow = window.open('', '_blank');
        
        if (!printWindow) {
            this.showMessage('Error: No se pudo abrir la ventana de impresión. Verifica que no esté bloqueada por el navegador.', 'error');
            this.showLoading(false);
            return;
        }
        
        // Título según tipo de movimiento
        const tituloMovimiento = this.formatTipoMovimiento(movimiento.tipo);
        
        // Escribir contenido en la ventana
        printWindow.document.write(`
            <!DOCTYPE html>
            <html lang="es">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Detalle de ${tituloMovimiento}</title>
                <link rel="stylesheet" href="/assets/css/bootstrap.min.css">
                <link rel="stylesheet" href="/assets/css/print.css">
                <style>
                    body {
                        padding: 20px;
                        font-family: Arial, sans-serif;
                    }
                    .logo {
                        text-align: center;
                        margin-bottom: 20px;
                    }
                    .logo img {
                        max-height: 80px;
                    }
                    .header {
                        text-align: center;
                        margin-bottom: 20px;
                        border-bottom: 1px solid #ddd;
                        padding-bottom: 10px;
                    }
                    .footer {
                        margin-top: 30px;
                        text-align: center;
                        font-size: 12px;
                        color: #666;
                        border-top: 1px solid #ddd;
                        padding-top: 10px;
                    }
                    @media print {
                        body {
                            padding: 0;
                            margin: 0;
                        }
                        .no-print {
                            display: none !important;
                        }
                    }
                </style>
            </head>
            <body>
                <div class="logo">
                    <img src="/assets/img/logo.png" alt="Logo">
                </div>
                <div class="header">
                    <h2>Detalle de ${tituloMovimiento}</h2>
                    <p>Sistema de Gestión - ${new Date().toLocaleDateString('es-AR')}</p>
                </div>
                
                <div class="content">
                    ${htmlContent}
                </div>
                
                <div class="footer">
                    <p>Generado por: ${this.currentUser.nombre} ${this.currentUser.apellido} - ${new Date().toLocaleString('es-AR')}</p>
                </div>
                
                <div class="no-print text-center mt-4">
                    <button class="btn btn-primary" onclick="window.print()">Imprimir</button>
                    <button class="btn btn-secondary ml-2" onclick="window.close()">Cerrar</button>
                </div>
            </body>
            </html>
        `);
        
        // Cerrar el documento para finalizar la escritura
        printWindow.document.close();
        
        // Registrar actividad
        logger.log({
            tipo: 'impresion',
            modulo: 'reportes_caja',
            usuario: this.currentUser.id,
            descripcion: `Imprimió detalle de ${tituloMovimiento}`
        });
        
        this.showLoading(false);
    } catch (error) {
        console.error('Error al imprimir detalle:', error);
        this.showMessage('Error al imprimir el detalle del movimiento', 'error');
        this.showLoading(false);
    }
}

/**
 * Exporta el detalle de un movimiento a PDF
 * @param {Object} movimiento - Datos del movimiento
 */
exportarDetallePdf(movimiento) {
    try {
        if (!movimiento) {
            this.showMessage('No hay datos para exportar', 'warning');
            return;
        }
        
        this.showLoading(true);
        
        // Verificar permisos
        if (!this.userPermissions.reportes.caja.exportar) {
            this.showMessage('No tienes permisos para exportar reportes', 'error');
            this.showLoading(false);
            return;
        }
        
        // Título según tipo de movimiento
        const tituloMovimiento = this.formatTipoMovimiento(movimiento.tipo);
        
        // Formato de fecha para el nombre del archivo
        const fechaArchivo = new Date(movimiento.fecha).toISOString().split('T')[0];
        const nombreArchivo = `${movimiento.tipo}_${fechaArchivo}_${movimiento.id}.pdf`;
        
        // Obtener el contenido HTML
        const htmlElement = document.getElementById('detalleMovimientoContent');
        
        // Crear configuración del PDF
        const pdfOptions = {
            margin: 10,
            filename: nombreArchivo,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2 },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };
        
        // Generar PDF usando html2pdf
        html2pdf().from(htmlElement).set(pdfOptions).save()
            .then(() => {
                this.showMessage('Detalle exportado correctamente', 'success');
                
                // Registrar actividad
                logger.log({
                    tipo: 'exportacion',
                    modulo: 'reportes_caja',
                    usuario: this.currentUser.id,
                    descripcion: `Exportó detalle de ${tituloMovimiento} a PDF`
                });
            })
            .catch(error => {
                console.error('Error al exportar PDF:', error);
                this.showMessage('Error al exportar el detalle a PDF', 'error');
            })
            .finally(() => {
                this.showLoading(false);
            });
    } catch (error) {
        console.error('Error al exportar detalle a PDF:', error);
        this.showMessage('Error al exportar el detalle a PDF', 'error');
        this.showLoading(false);
    }
}

/**
 * Obtiene una descripción formateada del movimiento
 * @param {Object} movimiento - Datos del movimiento
 * @returns {string} Descripción formateada
 */
getMovimientoDescripcion(movimiento) {
    const detalle = movimiento.detalle || {};
    
    switch (movimiento.tipo) {
        case 'apertura':
            return `Apertura de caja ${detalle.caja_id || 'Principal'}`;
        case 'cierre':
            return `Cierre de caja ${detalle.caja_id || 'Principal'}`;
        case 'venta':
            return `Venta ${detalle.numero ? `N° ${detalle.numero}` : ''} ${detalle.cliente?.nombre ? `- Cliente: ${detalle.cliente.nombre}` : ''}`;
        case 'gasto':
            return `${detalle.categoria || 'Gasto'} ${detalle.proveedor ? `- Prov: ${detalle.proveedor}` : ''}`;
        case 'ingreso_extra':
            return `${detalle.categoria || 'Ingreso extra'} - ${detalle.descripcion || ''}`;
        case 'retiro':
            return `Retiro ${detalle.destinatario ? `para ${detalle.destinatario}` : ''} - ${detalle.motivo || ''}`;
        case 'ajuste_positivo':
            return `Ajuste positivo - ${movimiento.descripcion || ''}`;
        case 'ajuste_negativo':
            return `Ajuste negativo - ${movimiento.descripcion || ''}`;
        default:
            return movimiento.descripcion || 'Sin descripción';
    }
}

/**
 * Formatea un tipo de movimiento para su visualización
 * @param {string} tipo - Tipo de movimiento
 * @returns {string} Tipo formateado
 */
formatTipoMovimiento(tipo) {
    const tiposMap = {
        'apertura': 'Apertura de Caja',
        'cierre': 'Cierre de Caja',
        'venta': 'Venta',
        'gasto': 'Gasto',
        'ingreso_extra': 'Ingreso Extra',
        'retiro': 'Retiro de Caja',
        'ajuste_positivo': 'Ajuste Positivo',
        'ajuste_negativo': 'Ajuste Negativo',
        'todos': 'Todos los Movimientos'
    };
    
    return tiposMap[tipo] || tipo;
}

/**
 * Formatea un método de pago para su visualización
 * @param {string} metodo - Método de pago
 * @returns {string} Método formateado
 */
formatMetodoPago(metodo) {
    const metodosMap = {
        'efectivo': 'Efectivo',
        'tarjeta': 'Tarjeta',
        'transferencia': 'Transferencia',
        'mercadopago': 'Mercado Pago',
        'otros': 'Otros',
        'todos': 'Todos'
    };
    
    return metodosMap[metodo] || metodo;
}

/**
 * Formatea un valor numérico como moneda
 * @param {number} value - Valor a formatear
 * @returns {string} Valor formateado
 */
formatCurrency(value) {
    if (value === undefined || value === null) return '0,00';
    return new Intl.NumberFormat('es-AR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(parseFloat(value));
}
}

// Exportar la clase
 CajaReportes

module.exports = CajaReportes;