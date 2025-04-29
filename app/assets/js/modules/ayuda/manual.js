/**
 * @file manual.js
 * @description Módulo para gestionar la funcionalidad del manual de usuario
 * @author Claude
 * @version 1.0.0
 * @copyright FactuSystem
 */

const { showAlert } = require('../../helpers/alerts.js');
const { fetchData } = require('../../helpers/api.js');

/**
 * Clase que maneja toda la funcionalidad del manual de usuario
 */
class Manual {
  /**
   * Constructor de la clase
   */
  constructor() {
    this.sections = [];
    this.currentSection = null;
    this.container = document.getElementById('manual-content');
    this.sidebarContainer = document.getElementById('manual-sidebar');
    this.searchInput = document.getElementById('manual-search');
    this.printButton = document.getElementById('manual-print');
    
    this.initialize();
  }

  /**
   * Inicializa el módulo de manual
   */
  async initialize() {
    try {
      this.bindEvents();
      await this.loadSections();
      this.renderSidebar();
      
      // Cargar la primera sección por defecto
      if (this.sections.length > 0) {
        this.loadSection(this.sections[0].id);
      }
    } catch (error) {
      console.error('Error al inicializar el manual:', error);
      showAlert('Error al cargar el manual de usuario', 'error');
    }
  }

  /**
   * Vincula los eventos de los elementos del DOM
   */
  bindEvents() {
    if (this.searchInput) {
      this.searchInput.addEventListener('input', this.handleSearch.bind(this));
    }
    
    if (this.printButton) {
      this.printButton.addEventListener('click', this.printManual.bind(this));
    }
    
    // Evento para interceptar clics en el sidebar
    if (this.sidebarContainer) {
      this.sidebarContainer.addEventListener('click', (e) => {
        const sectionLink = e.target.closest('[data-section-id]');
        if (sectionLink) {
          e.preventDefault();
          const sectionId = sectionLink.dataset.sectionId;
          this.loadSection(sectionId);
        }
      });
    }
  }

  /**
   * Carga las secciones del manual desde el servidor
   */
  async loadSections() {
    try {
      // Obtener las secciones del manual desde el servidor
      const response = await fetchData('api/ayuda/secciones', 'GET');
      
      if (response.success) {
        this.sections = response.data;
      } else {
        throw new Error(response.message || 'Error al cargar las secciones del manual');
      }
    } catch (error) {
      console.error('Error cargando secciones del manual:', error);
      // Si hay un error, cargar secciones predeterminadas
      this.loadDefaultSections();
    }
  }

  /**
   * Carga secciones predeterminadas en caso de error con la API
   */
  loadDefaultSections() {
    this.sections = [
      { id: 'introduccion', title: 'Introducción', order: 1 },
      { id: 'inicio-sesion', title: 'Inicio de Sesión', order: 2 },
      { id: 'dashboard', title: 'Panel Principal', order: 3 },
      { id: 'clientes', title: 'Gestión de Clientes', order: 4 },
      { id: 'productos', title: 'Gestión de Productos', order: 5 },
      { id: 'facturas', title: 'Emisión de Facturas', order: 6 },
      { id: 'reportes', title: 'Reportes y Estadísticas', order: 7 },
      { id: 'configuracion', title: 'Configuración del Sistema', order: 8 },
      { id: 'usuarios', title: 'Gestión de Usuarios', order: 9 },
      { id: 'respaldo', title: 'Respaldo y Recuperación', order: 10 }
    ];
  }

  /**
   * Renderiza el sidebar con las secciones del manual
   */
  renderSidebar() {
    if (!this.sidebarContainer) return;
    
    // Ordena las secciones por el campo 'order'
    const orderedSections = [...this.sections].sort((a, b) => a.order - b.order);
    
    let html = '<ul class="manual-nav">';
    
    orderedSections.forEach(section => {
      html += `
        <li>
          <a href="#" data-section-id="${section.id}" class="manual-nav-item">
            ${section.title}
          </a>
        </li>
      `;
    });
    
    html += '</ul>';
    this.sidebarContainer.innerHTML = html;
  }

  /**
   * Carga una sección específica del manual
   * @param {string} sectionId - Identificador de la sección a cargar
   */
  async loadSection(sectionId) {
    try {
      if (!this.container) return;
      
      // Marcar la sección activa en el sidebar
      this.highlightActiveSection(sectionId);
      
      // Mostrar un indicador de carga
      this.container.innerHTML = '<div class="loading">Cargando contenido...</div>';
      
      // Obtener el contenido de la sección desde el servidor
      const response = await fetchData(`api/ayuda/seccion/${sectionId}`, 'GET');
      
      if (response.success) {
        this.currentSection = response.data;
        this.renderSection(response.data);
      } else {
        throw new Error(response.message || 'Error al cargar la sección del manual');
      }
    } catch (error) {
      console.error(`Error cargando sección ${sectionId}:`, error);
      // Cargar contenido por defecto para la sección
      this.loadDefaultSection(sectionId);
    }
  }

  /**
   * Carga contenido predeterminado para una sección
   * @param {string} sectionId - Identificador de la sección
   */
  loadDefaultSection(sectionId) {
    const section = this.sections.find(s => s.id === sectionId);
    
    if (!section) {
      this.container.innerHTML = '<div class="error">Sección no encontrada</div>';
      return;
    }
    
    const defaultContent = {
      id: section.id,
      title: section.title,
      content: `<h2>${section.title}</h2><p>Contenido de ejemplo para la sección ${section.title}. Esta es una sección de prueba generada automáticamente.</p><p>Para más información, contacte al administrador del sistema.</p>`
    };
    
    this.currentSection = defaultContent;
    this.renderSection(defaultContent);
  }

  /**
   * Renderiza el contenido de una sección en el contenedor principal
   * @param {object} section - Datos de la sección a renderizar
   */
  renderSection(section) {
    if (!this.container) return;
    
    let html = `
      <div class="manual-section" id="section-${section.id}">
        <h1 class="manual-title">${section.title}</h1>
        <div class="manual-content">
          ${section.content}
        </div>
      </div>
    `;
    
    this.container.innerHTML = html;
  }

  /**
   * Resalta la sección activa en el sidebar
   * @param {string} sectionId - Identificador de la sección activa
   */
  highlightActiveSection(sectionId) {
    if (!this.sidebarContainer) return;
    
    // Eliminar la clase activa de todos los elementos
    const items = this.sidebarContainer.querySelectorAll('.manual-nav-item');
    items.forEach(item => item.classList.remove('active'));
    
    // Agregar la clase activa al elemento seleccionado
    const activeItem = this.sidebarContainer.querySelector(`[data-section-id="${sectionId}"]`);
    if (activeItem) {
      activeItem.classList.add('active');
    }
  }

  /**
   * Maneja la búsqueda en el manual
   * @param {Event} e - Evento de input
   */
  async handleSearch(e) {
    const searchTerm = e.target.value.trim().toLowerCase();
    
    if (searchTerm.length < 3) {
      this.renderSidebar();
      return;
    }
    
    try {
      // Buscar en las secciones del manual
      const response = await fetchData('api/ayuda/buscar', 'POST', { term: searchTerm });
      
      if (response.success) {
        this.renderSearchResults(response.data, searchTerm);
      } else {
        // Búsqueda local como fallback
        this.performLocalSearch(searchTerm);
      }
    } catch (error) {
      console.error('Error en la búsqueda:', error);
      // Fallback a búsqueda local
      this.performLocalSearch(searchTerm);
    }
  }

  /**
   * Realiza una búsqueda local en las secciones cargadas
   * @param {string} searchTerm - Término de búsqueda
   */
  performLocalSearch(searchTerm) {
    const filteredSections = this.sections.filter(
      section => section.title.toLowerCase().includes(searchTerm)
    );
    
    this.renderSearchResults(filteredSections, searchTerm);
  }

  /**
   * Renderiza los resultados de la búsqueda
   * @param {Array} results - Resultados de la búsqueda
   * @param {string} searchTerm - Término de búsqueda
   */
  renderSearchResults(results, searchTerm) {
    if (!this.sidebarContainer) return;
    
    if (results.length === 0) {
      this.sidebarContainer.innerHTML = `
        <div class="no-results">
          No se encontraron resultados para "${searchTerm}"
        </div>
      `;
      return;
    }
    
    let html = `
      <div class="search-results">
        <h3>Resultados para "${searchTerm}":</h3>
        <ul class="manual-nav">
    `;
    
    results.forEach(result => {
      html += `
        <li>
          <a href="#" data-section-id="${result.id}" class="manual-nav-item">
            ${result.title}
          </a>
        </li>
      `;
    });
    
    html += '</ul></div>';
    this.sidebarContainer.innerHTML = html;
  }

  /**
   * Imprime el manual completo o la sección actual
   */
  printManual() {
    if (this.currentSection) {
      const printWindow = window.open('', '_blank');
      
      if (!printWindow) {
        showAlert('Por favor, permita las ventanas emergentes para imprimir el manual', 'warning');
        return;
      }
      
      const printContent = `
        <!DOCTYPE html>
        <html lang="es">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>FactuSystem - Manual de Usuario: ${this.currentSection.title}</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            h1 { color: #2c3e50; border-bottom: 1px solid #eee; padding-bottom: 10px; }
            h2 { color: #3498db; margin-top: 25px; }
            .footer { margin-top: 30px; font-size: 12px; color: #7f8c8d; text-align: center; }
            @media print {
              .no-print { display: none; }
            }
          </style>
        </head>
        <body>
          <header>
            <h1>FactuSystem - Manual de Usuario</h1>
          </header>
          <main>
            <h2>${this.currentSection.title}</h2>
            <div>${this.currentSection.content}</div>
          </main>
          <footer class="footer">
            <p>© ${new Date().getFullYear()} FactuSystem - Todos los derechos reservados</p>
          </footer>
          <script>
            window.onload = function() {
              setTimeout(function() {
                window.print();
              }, 500);
            }
          </script>
        </body>
        </html>
      `;
      
      printWindow.document.write(printContent);
      printWindow.document.close();
    }
  }
  
  /**
   * Exporta el manual completo en formato PDF
   */
  exportPDF() {
    // Implementar la exportación a PDF si es necesario
    showAlert('La exportación a PDF estará disponible próximamente', 'info');
  }
}

// Exportar la clase principal
 Manual

module.exports = Manual;

// Inicializar el módulo cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
  // Verificar si estamos en la página del manual
  if (document.getElementById('manual-content')) {
    window.manualInstance = new Manual();
  }
});