/**
 * Módulo principal de Reportes - FactuSystem
 * Gestiona la visualización y generación de informes del sistema
 * 
 * @module app/assets/js/modules/reportes/index
 */

// Importación de submódulos de reportes
import ventasReportes from './ventas.js';
import comprasReportes from './compras.js';
import cajaReportes from './caja.js';
import stockReportes from './stock.js';
import fiscalesReportes from './fiscales.js';
import exportacionReportes from './exportacion.js';

// Importación de utilidades necesarias
import { database } from '../../utils/database.js';
import { auth } from '../../utils/auth.js';
import { logger } from '../../utils/logger.js';
import { validation } from '../../utils/validation.js';
import { backup } from '../../utils/backup.js';

// Componentes compartidos de UI
import { notifications } from '../../components/notifications.js';
import { tabs } from '../../components/tabs.js';

/**
 * Clase principal del módulo de Reportes
 */
class ReportesModule {
  constructor() {
    this.currentReport = null;
    this.filters = {
      dateRange: {
        start: null,
        end: null
      },
      user: null,
      sucursal: null,
      customFilters: {}
    };
    
    // Referencia a los submódulos
    this.reportes = {
      ventas: ventasReportes,
      compras: comprasReportes,
      caja: cajaReportes,
      stock: stockReportes,
      fiscales: fiscalesReportes,
      exportacion: exportacionReportes
    };
    
    this.containerEl = null;
    this.filterFormEl = null;
    this.reportContainerEl = null;
    this.exportBtnEl = null;
    
    // Permisos del usuario actual
    this.userPermissions = {};
  }

  /**
   * Inicializa el módulo de reportes
   * @param {HTMLElement} container - Elemento contenedor para el módulo
   */
  async init(container) {
    try {
      logger.info('Inicializando módulo de reportes');
      this.containerEl = container;
      
      // Verificar permisos de usuario
      const currentUser = auth.getCurrentUser();
      this.userPermissions = await auth.getUserPermissions(currentUser.id);
      
      if (!this.userPermissions.reportes.view) {
        notifications.show({
          title: 'Acceso denegado',
          message: 'No tienes permisos para acceder al módulo de reportes',
          type: 'error'
        });
        return false;
      }
      
      // Obtener la sucursal actual
      const currentSucursal = await database.getSucursalData();
      this.filters.sucursal = currentSucursal.id;
      
      // Cargar la interfaz principal
      this.loadUI();
      
      // Inicializar submódulos
      await this.initializeSubModules();
      
      // Cargar filtros por defecto
      this.setDefaultFilters();
      
      logger.info('Módulo de reportes inicializado correctamente');
      return true;
    } catch (error) {
      logger.error('Error al inicializar módulo de reportes', error);
      notifications.show({
        title: 'Error',
        message: 'No se pudo inicializar el módulo de reportes',
        type: 'error',
        details: error.message
      });
      return false;
    }
  }
  
  /**
   * Carga la interfaz de usuario del módulo
   */
  loadUI() {
    // Limpiar contenedor
    this.containerEl.innerHTML = '';
    
    // Estructura básica
    const moduleHtml = `
      <div class="reportes-module">
        <div class="module-header">
          <h2>Reportes del Sistema</h2>
          <div class="module-actions">
            <button id="reportes-refresh-btn" class="btn btn-outline">
              <i class="fas fa-sync"></i> Actualizar
            </button>
            <button id="reportes-export-btn" class="btn btn-primary" disabled>
              <i class="fas fa-file-export"></i> Exportar
            </button>
          </div>
        </div>
        
        <div class="reportes-navigation">
          <ul class="nav-tabs" id="reportes-tabs">
            ${this.generateTabsHtml()}
          </ul>
        </div>
        
        <div class="reportes-container">
          <div class="reportes-filters" id="reportes-filters">
            <form id="reportes-filter-form">
              <div class="form-row">
                <div class="form-group">
                  <label for="date-range-start">Desde</label>
                  <input type="date" id="date-range-start" name="dateStart" class="form-control">
                </div>
                <div class="form-group">
                  <label for="date-range-end">Hasta</label>
                  <input type="date" id="date-range-end" name="dateEnd" class="form-control">
                </div>
                <div class="form-group">
                  <label for="user-filter">Usuario</label>
                  <select id="user-filter" name="user" class="form-control">
                    <option value="">Todos los usuarios</option>
                  </select>
                </div>
                <div class="form-group">
                  <label for="sucursal-filter">Sucursal</label>
                  <select id="sucursal-filter" name="sucursal" class="form-control">
                    <option value="">Todas las sucursales</option>
                  </select>
                </div>
              </div>
              <div id="custom-filters-container" class="form-row">
                <!-- Aquí se cargarán filtros específicos del reporte seleccionado -->
              </div>
              <div class="form-actions">
                <button type="submit" class="btn btn-primary">
                  <i class="fas fa-filter"></i> Aplicar filtros
                </button>
                <button type="button" id="clear-filters-btn" class="btn btn-outline">
                  <i class="fas fa-eraser"></i> Limpiar filtros
                </button>
              </div>
            </form>
          </div>
          
          <div class="report-view-container" id="report-container">
            <!-- Aquí se cargará el reporte -->
            <div class="report-placeholder">
              <i class="fas fa-chart-bar placeholder-icon"></i>
              <p>Selecciona un tipo de reporte y aplica los filtros para generar el informe</p>
            </div>
          </div>
        </div>
      </div>
    `;
    
    this.containerEl.innerHTML = moduleHtml;
    
    // Referencias a elementos DOM
    this.filterFormEl = document.getElementById('reportes-filter-form');
    this.reportContainerEl = document.getElementById('report-container');
    this.exportBtnEl = document.getElementById('reportes-export-btn');
    
    // Configuración de listeners de eventos
    this.setupEventListeners();
  }
  
  /**
   * Genera el HTML para las pestañas según los permisos del usuario
   * @returns {string} HTML para las pestañas de navegación
   */
  generateTabsHtml() {
    const { reportes } = this.userPermissions;
    
    const availableTabs = [
      { id: 'ventas', label: 'Ventas', icon: 'fa-receipt', permission: reportes.ventas },
      { id: 'compras', label: 'Compras', icon: 'fa-shopping-cart', permission: reportes.compras },
      { id: 'caja', label: 'Caja', icon: 'fa-cash-register', permission: reportes.caja },
      { id: 'stock', label: 'Stock', icon: 'fa-boxes', permission: reportes.stock },
      { id: 'fiscales', label: 'Fiscales', icon: 'fa-file-invoice-dollar', permission: reportes.fiscales },
      { id: 'exportacion', label: 'Exportación', icon: 'fa-file-export', permission: reportes.exportacion }
    ];
    
    return availableTabs
      .filter(tab => tab.permission)
      .map((tab, index) => `
        <li class="nav-item">
          <a href="#" class="nav-link ${index === 0 ? 'active' : ''}" data-report-type="${tab.id}">
            <i class="fas ${tab.icon}"></i> ${tab.label}
          </a>
        </li>
      `).join('');
  }
  
  /**
   * Configura los event listeners para la UI
   */
  setupEventListeners() {
    // Manejo de pestañas
    const tabLinks = this.containerEl.querySelectorAll('.nav-link');
    tabLinks.forEach(tabLink => {
      tabLink.addEventListener('click', (e) => {
        e.preventDefault();
        
        // Actualizar clases activas
        tabLinks.forEach(link => link.classList.remove('active'));
        tabLink.classList.add('active');
        
        // Cambiar tipo de reporte activo
        const reportType = tabLink.getAttribute('data-report-type');
        this.changeReportType(reportType);
      });
    });
    
    // Manejo del formulario de filtros
    this.filterFormEl.addEventListener('submit', (e) => {
      e.preventDefault();
      this.applyFilters();
    });
    
    // Botón limpiar filtros
    const clearFiltersBtn = document.getElementById('clear-filters-btn');
    clearFiltersBtn.addEventListener('click', () => {
      this.clearFilters();
    });
    
    // Botón refrescar
    const refreshBtn = document.getElementById('reportes-refresh-btn');
    refreshBtn.addEventListener('click', () => {
      this.refreshReport();
    });
    
    // Botón exportar
    this.exportBtnEl.addEventListener('click', () => {
      this.exportCurrentReport();
    });
  }
  
  /**
   * Inicializa todos los submódulos de reportes
   */
  async initializeSubModules() {
    try {
      for (const [name, module] of Object.entries(this.reportes)) {
        if (this.userPermissions.reportes[name]) {
          await module.init();
        }
      }
      
      // Activar el primer reporte disponible
      const firstTab = this.containerEl.querySelector('.nav-link');
      if (firstTab) {
        const firstReportType = firstTab.getAttribute('data-report-type');
        this.changeReportType(firstReportType);
      }
    } catch (error) {
      logger.error('Error al inicializar submódulos de reportes', error);
    }
  }
  
  /**
   * Establece filtros por defecto (últimos 30 días)
   */
  setDefaultFilters() {
    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);
    
    // Formatear fechas para inputs date
    const formatDate = (date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    
    // Establecer valores en los inputs
    const startDateInput = document.getElementById('date-range-start');
    const endDateInput = document.getElementById('date-range-end');
    
    startDateInput.value = formatDate(thirtyDaysAgo);
    endDateInput.value = formatDate(today);
    
    // Actualizar filtros en el objeto
    this.filters.dateRange = {
      start: thirtyDaysAgo,
      end: today
    };
    
    // Cargar usuarios y sucursales en los selectores
    this.loadUsersIntoFilter();
    this.loadSucursalesIntoFilter();
  }
  
  /**
   * Carga la lista de usuarios en el filtro
   */
  async loadUsersIntoFilter() {
    try {
      const userFilter = document.getElementById('user-filter');
      const users = await database.getUsers();
      
      users.forEach(user => {
        const option = document.createElement('option');
        option.value = user.id;
        option.textContent = `${user.nombre} ${user.apellido}`;
        userFilter.appendChild(option);
      });
    } catch (error) {
      logger.error('Error al cargar usuarios en filtro', error);
    }
  }
  
  /**
   * Carga la lista de sucursales en el filtro
   */
  async loadSucursalesIntoFilter() {
    try {
      const sucursalFilter = document.getElementById('sucursal-filter');
      const currentSucursal = await database.getSucursalData();
      const sucursales = await database.getSucursales();
      
      sucursales.forEach(sucursal => {
        const option = document.createElement('option');
        option.value = sucursal.id;
        option.textContent = sucursal.nombre;
        
        // Seleccionar por defecto la sucursal actual
        if (sucursal.id === currentSucursal.id) {
          option.selected = true;
        }
        
        sucursalFilter.appendChild(option);
      });
    } catch (error) {
      logger.error('Error al cargar sucursales en filtro', error);
    }
  }
  
  /**
   * Cambia el tipo de reporte activo
   * @param {string} reportType - Tipo de reporte a activar
   */
  async changeReportType(reportType) {
    if (!reportType || !this.reportes[reportType]) {
      logger.error(`Tipo de reporte no válido: ${reportType}`);
      return;
    }
    
    try {
      this.currentReport = reportType;
      
      // Limpiar filtros personalizados
      const customFiltersContainer = document.getElementById('custom-filters-container');
      customFiltersContainer.innerHTML = '';
      this.filters.customFilters = {};
      
      // Cargar filtros personalizados para este tipo de reporte
      const customFilters = await this.reportes[reportType].getCustomFilters();
      if (customFilters && customFilters.html) {
        customFiltersContainer.innerHTML = customFilters.html;
        
        // Configurar event listeners para filtros personalizados
        if (customFilters.setup && typeof customFilters.setup === 'function') {
          customFilters.setup(customFiltersContainer);
        }
      }
      
      // Mostrar placeholder hasta que se apliquen filtros
      this.reportContainerEl.innerHTML = `
        <div class="report-placeholder">
          <i class="fas fa-chart-bar placeholder-icon"></i>
          <p>Configura los filtros y haz clic en "Aplicar filtros" para generar el reporte de ${reportType}</p>
        </div>
      `;
      
      // Deshabilitar botón de exportación hasta que haya un reporte generado
      this.exportBtnEl.disabled = true;
      
      logger.info(`Tipo de reporte cambiado a: ${reportType}`);
    } catch (error) {
      logger.error(`Error al cambiar tipo de reporte a ${reportType}`, error);
      notifications.show({
        title: 'Error',
        message: `No se pudo cambiar al reporte de ${reportType}`,
        type: 'error'
      });
    }
  }
  
  /**
   * Recoge los valores de los filtros del formulario
   */
  collectFilterValues() {
    const startDateInput = document.getElementById('date-range-start');
    const endDateInput = document.getElementById('date-range-end');
    const userFilter = document.getElementById('user-filter');
    const sucursalFilter = document.getElementById('sucursal-filter');
    
    // Actualizar filtros básicos
    this.filters.dateRange = {
      start: startDateInput.value ? new Date(startDateInput.value) : null,
      end: endDateInput.value ? new Date(endDateInput.value) : null
    };
    
    this.filters.user = userFilter.value || null;
    this.filters.sucursal = sucursalFilter.value || null;
    
    // Recoger filtros personalizados según el tipo de reporte actual
    if (this.currentReport && this.reportes[this.currentReport].collectCustomFilterValues) {
      this.filters.customFilters = this.reportes[this.currentReport].collectCustomFilterValues();
    }
  }
  
  /**
   * Aplica los filtros y genera el reporte
   */
  async applyFilters() {
    if (!this.currentReport) {
      notifications.show({
        title: 'Información',
        message: 'Selecciona primero un tipo de reporte',
        type: 'info'
      });
      return;
    }
    
    try {
      // Mostrar indicador de carga
      this.reportContainerEl.innerHTML = `
        <div class="loading-container">
          <div class="spinner"></div>
          <p>Generando reporte, por favor espera...</p>
        </div>
      `;
      
      // Recolectar valores de filtros
      this.collectFilterValues();
      
      // Validar filtros
      const validationResult = await this.reportes[this.currentReport].validateFilters(this.filters);
      if (!validationResult.valid) {
        notifications.show({
          title: 'Error de validación',
          message: validationResult.message || 'Los filtros no son válidos',
          type: 'warning'
        });
        
        // Restaurar placeholder
        this.reportContainerEl.innerHTML = `
          <div class="report-placeholder">
            <i class="fas fa-exclamation-triangle placeholder-icon"></i>
            <p>${validationResult.message || 'Revisa los filtros e intenta nuevamente'}</p>
          </div>
        `;
        return;
      }
      
      // Generar reporte
      const reportResult = await this.reportes[this.currentReport].generateReport(this.filters);
      
      // Mostrar reporte
      this.reportContainerEl.innerHTML = reportResult.html;
      
      // Configurar comportamiento adicional del reporte si es necesario
      if (reportResult.setup && typeof reportResult.setup === 'function') {
        reportResult.setup(this.reportContainerEl);
      }
      
      // Habilitar botón de exportación
      this.exportBtnEl.disabled = false;
      
      // Registrar acción en el log
      logger.info(`Reporte de ${this.currentReport} generado correctamente`, {
        filters: this.filters,
        userId: auth.getCurrentUser().id
      });
      
    } catch (error) {
      logger.error(`Error al generar reporte de ${this.currentReport}`, error);
      
      notifications.show({
        title: 'Error',
        message: `No se pudo generar el reporte: ${error.message}`,
        type: 'error'
      });
      
      // Mostrar mensaje de error en el contenedor
      this.reportContainerEl.innerHTML = `
        <div class="error-container">
          <i class="fas fa-exclamation-circle error-icon"></i>
          <h3>Error al generar el reporte</h3>
          <p>${error.message}</p>
          <button class="btn btn-outline retry-btn">
            <i class="fas fa-sync"></i> Reintentar
          </button>
        </div>
      `;
      
      // Configurar botón de reintento
      const retryBtn = this.reportContainerEl.querySelector('.retry-btn');
      if (retryBtn) {
        retryBtn.addEventListener('click', () => {
          this.applyFilters();
        });
      }
    }
  }
  
  /**
   * Limpia todos los filtros establecidos
   */
  clearFilters() {
    // Resetear filtros básicos
    const startDateInput = document.getElementById('date-range-start');
    const endDateInput = document.getElementById('date-range-end');
    const userFilter = document.getElementById('user-filter');
    const sucursalFilter = document.getElementById('sucursal-filter');
    
    // Volver a valores por defecto
    this.setDefaultFilters();
    
    // Resetear filtros personalizados específicos del reporte
    if (this.currentReport && this.reportes[this.currentReport].resetCustomFilters) {
      this.reportes[this.currentReport].resetCustomFilters();
    }
    
    notifications.show({
      title: 'Filtros restablecidos',
      message: 'Se han restablecido todos los filtros a sus valores por defecto',
      type: 'info'
    });
  }
  
  /**
   * Actualiza el reporte actual
   */
  refreshReport() {
    if (this.currentReport) {
      this.applyFilters();
      
      notifications.show({
        title: 'Reporte actualizado',
        message: 'Se ha actualizado el reporte con los datos más recientes',
        type: 'success'
      });
    }
  }
  
  /**
   * Exporta el reporte actual
   */
  async exportCurrentReport() {
    if (!this.currentReport) {
      notifications.show({
        title: 'Error',
        message: 'No hay ningún reporte para exportar',
        type: 'error'
      });
      return;
    }
    
    try {
      // Mostrar modal de opciones de exportación
      const exportOptions = {
        formats: ['pdf', 'excel', 'csv'],
        includeGraphics: true,
        includeDetails: true
      };
      
      // Usar el módulo de exportación
      const exportResult = await this.reportes.exportacion.exportReport(
        this.currentReport,
        this.filters,
        exportOptions
      );
      
      if (exportResult.success) {
        notifications.show({
          title: 'Exportación exitosa',
          message: `El reporte se ha exportado correctamente como ${exportResult.format}`,
          type: 'success'
        });
        
        // Registrar en el log
        logger.info(`Reporte de ${this.currentReport} exportado como ${exportResult.format}`, {
          userId: auth.getCurrentUser().id,
          filters: this.filters
        });
      } else {
        throw new Error(exportResult.message || 'Error desconocido en la exportación');
      }
    } catch (error) {
      logger.error(`Error al exportar reporte de ${this.currentReport}`, error);
      
      notifications.show({
        title: 'Error de exportación',
        message: error.message,
        type: 'error'
      });
    }
  }
  
  /**
   * Imprime el reporte actual
   */
  async printCurrentReport() {
    if (!this.currentReport) {
      notifications.show({
        title: 'Error',
        message: 'No hay ningún reporte para imprimir',
        type: 'error'
      });
      return;
    }
    
    try {
      const printResult = await this.reportes[this.currentReport].printReport(this.filters);
      
      if (printResult.success) {
        notifications.show({
          title: 'Impresión enviada',
          message: 'El reporte se ha enviado a imprimir correctamente',
          type: 'success'
        });
      } else {
        throw new Error(printResult.message || 'Error desconocido en la impresión');
      }
    } catch (error) {
      logger.error(`Error al imprimir reporte de ${this.currentReport}`, error);
      
      notifications.show({
        title: 'Error de impresión',
        message: error.message,
        type: 'error'
      });
    }
  }
}

// Crear y exportar la instancia del módulo
const reportesModule = new ReportesModule();
export default reportesModule;