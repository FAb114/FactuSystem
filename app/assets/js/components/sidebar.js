/**
 * Clase para gestionar el comportamiento del sidebar en FactuSystem
 * Versión modificada con verificaciones para evitar errores cuando los elementos no existen
 */
class Sidebar {
    constructor() {
      this.isSidebarExpanded = false;
      this.isMobile = window.innerWidth < 768;
      this.isRTL = document.documentElement.getAttribute('dir') === 'rtl';
      this.sidebarElement = null;
      this.sidebarCollapseBtn = null;
      this.menuItems = [];
      this.activeMenuItem = null;
      this.STORAGE_KEY = 'factusystem-sidebar-state';
    }
  
    /**
     * Inicializa el sidebar cuando el DOM está completamente cargado
     */
    init() {
      // Asegurarse de que el DOM está completamente cargado
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.setupSidebar());
      } else {
        this.setupSidebar();
      }
    }
  
    /**
     * Configura el sidebar y todos sus elementos
     */
    setupSidebar() {
      this.sidebarElement = document.getElementById('sidebar');
      
      if (!this.sidebarElement) {
        console.warn('No se pudo inicializar el sidebar: elemento no encontrado');
        return;
      }
      
      this.sidebarCollapseBtn = document.getElementById('sidebarCollapseBtn');
      this.menuItems = document.querySelectorAll('.sidebar-menu-item');
      
      // Restaurar el estado del sidebar desde localStorage
      this.restoreSidebarState();
      
      // Configurar los event listeners
      this.setupEventListeners();
      
      // Configurar estado inicial basado en el tamaño de pantalla
      this.checkScreenSize();
      
      // Inicializar el ítem activo del menú según la URL actual
      this.setActiveMenuItem();
    }
  
    /**
     * Configura todos los event listeners necesarios
     */
    setupEventListeners() {
      // Solo agregar event listeners si los elementos existen
      if (this.sidebarCollapseBtn) {
        this.sidebarCollapseBtn.addEventListener('click', () => this.toggleSidebar());
      }
      
      // Event listeners para los ítems del menú
      this.menuItems.forEach(item => {
        const submenu = item.querySelector('.sidebar-submenu');
        const link = item.querySelector('.sidebar-link');
        
        if (link) {
          link.addEventListener('click', (e) => {
            if (submenu) {
              e.preventDefault();
              this.toggleSubmenu(item);
            }
          });
        }
      });
      
      // Event listener para el cambio de tamaño de la ventana
      window.addEventListener('resize', () => {
        this.checkScreenSize();
      });
      
      // Cerrar sidebar en móvil al hacer clic fuera
      document.addEventListener('click', (e) => {
        if (this.isMobile && this.isSidebarExpanded) {
          // Verificar si el clic fue fuera del sidebar
          if (this.sidebarElement && !this.sidebarElement.contains(e.target) && 
              (!this.sidebarCollapseBtn || !this.sidebarCollapseBtn.contains(e.target))) {
            this.collapseSidebar();
          }
        }
      });
    }
  
    /**
     * Expande el sidebar
     */
    expandSidebar() {
      if (!this.sidebarElement) {
        console.warn('El elemento sidebar no fue encontrado en el DOM');
        return;
      }
      
      this.sidebarElement.classList.add('expanded');
      
      if (this.sidebarCollapseBtn) {
        this.sidebarCollapseBtn.setAttribute('aria-expanded', 'true');
        
        if (this.isRTL) {
          this.sidebarCollapseBtn.querySelector('i').classList.replace('fa-chevron-left', 'fa-chevron-right');
        } else {
          this.sidebarCollapseBtn.querySelector('i').classList.replace('fa-chevron-right', 'fa-chevron-left');
        }
      }
      
      this.isSidebarExpanded = true;
      this.saveSidebarState();
      
      // Disparar evento personalizado
      document.dispatchEvent(new CustomEvent('sidebar:expanded'));
    }
  
    /**
     * Colapsa el sidebar
     */
    collapseSidebar() {
      if (!this.sidebarElement) {
        console.warn('El elemento sidebar no fue encontrado en el DOM');
        return;
      }
      
      this.sidebarElement.classList.remove('expanded');
      
      if (this.sidebarCollapseBtn) {
        this.sidebarCollapseBtn.setAttribute('aria-expanded', 'false');
        
        if (this.isRTL) {
          this.sidebarCollapseBtn.querySelector('i').classList.replace('fa-chevron-right', 'fa-chevron-left');
        } else {
          this.sidebarCollapseBtn.querySelector('i').classList.replace('fa-chevron-left', 'fa-chevron-right');
        }
      }
      
      this.isSidebarExpanded = false;
      this.saveSidebarState();
      
      // Disparar evento personalizado
      document.dispatchEvent(new CustomEvent('sidebar:collapsed'));
    }
  
    /**
     * Alterna el estado del sidebar entre expandido y colapsado
     */
    toggleSidebar() {
      if (this.isSidebarExpanded) {
        this.collapseSidebar();
      } else {
        this.expandSidebar();
      }
    }
  
    /**
     * Alterna el estado de un submenú
     * @param {HTMLElement} menuItem - El ítem del menú que contiene el submenú
     */
    toggleSubmenu(menuItem) {
      if (!menuItem) return;
      
      const submenu = menuItem.querySelector('.sidebar-submenu');
      if (!submenu) return;
      
      const isExpanded = submenu.classList.contains('show');
      
      // Cerrar todos los otros submenús primero
      this.menuItems.forEach(item => {
        if (item !== menuItem) {
          const otherSubmenu = item.querySelector('.sidebar-submenu');
          if (otherSubmenu && otherSubmenu.classList.contains('show')) {
            otherSubmenu.classList.remove('show');
            const link = item.querySelector('.sidebar-link');
            if (link) {
              link.setAttribute('aria-expanded', 'false');
              const icon = link.querySelector('.submenu-icon');
              if (icon) icon.classList.remove('rotate');
            }
          }
        }
      });
      
      // Alternar el estado del submenú actual
      if (isExpanded) {
        submenu.classList.remove('show');
        menuItem.querySelector('.sidebar-link').setAttribute('aria-expanded', 'false');
        const icon = menuItem.querySelector('.submenu-icon');
        if (icon) icon.classList.remove('rotate');
      } else {
        submenu.classList.add('show');
        menuItem.querySelector('.sidebar-link').setAttribute('aria-expanded', 'true');
        const icon = menuItem.querySelector('.submenu-icon');
        if (icon) icon.classList.add('rotate');
      }
    }
  
    /**
     * Establece el ítem activo del menú según la URL actual
     */
    setActiveMenuItem() {
      const currentPath = window.location.pathname;
      
      this.menuItems.forEach(item => {
        const link = item.querySelector('.sidebar-link');
        if (!link) return;
        
        const linkPath = link.getAttribute('href');
        
        // Si es un enlace a un submenú, revisar los enlaces del submenú
        if (link.getAttribute('data-toggle') === 'submenu') {
          const submenuLinks = item.querySelectorAll('.sidebar-submenu .submenu-item a');
          let hasActiveSubmenuItem = false;
          
          submenuLinks.forEach(submenuLink => {
            const submenuPath = submenuLink.getAttribute('href');
            if (submenuPath && currentPath.includes(submenuPath)) {
              submenuLink.parentElement.classList.add('active');
              hasActiveSubmenuItem = true;
            } else {
              submenuLink.parentElement.classList.remove('active');
            }
          });
          
          if (hasActiveSubmenuItem) {
            item.classList.add('active');
            this.toggleSubmenu(item); // Expandir el submenú si contiene el ítem activo
          } else {
            item.classList.remove('active');
          }
        } 
        // Si es un enlace directo
        else if (linkPath && currentPath.includes(linkPath)) {
          item.classList.add('active');
          this.activeMenuItem = item;
        } else {
          item.classList.remove('active');
        }
      });
    }
  
    /**
     * Guarda el estado actual del sidebar en localStorage
     */
    saveSidebarState() {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify({
          expanded: this.isSidebarExpanded
        }));
      }
    }
  
    /**
     * Restaura el estado del sidebar desde localStorage
     */
    restoreSidebarState() {
      if (typeof localStorage !== 'undefined') {
        try {
          const state = JSON.parse(localStorage.getItem(this.STORAGE_KEY));
          if (state) {
            if (state.expanded) {
              this.expandSidebar();
            } else {
              this.collapseSidebar();
            }
          }
        } catch (e) {
          console.warn('Error al restaurar el estado del sidebar:', e);
        }
      }
    }
  
    /**
     * Verifica el tamaño de la pantalla y ajusta el sidebar en consecuencia
     */
    checkScreenSize() {
      if (!this.sidebarElement) {
        console.warn('El elemento sidebar no fue encontrado para checkScreenSize');
        return;
      }
      
      const wasLargeScreen = !this.isMobile;
      this.isMobile = window.innerWidth < 768;
      
      // Si cambió entre móvil y escritorio
      if (this.isMobile !== !wasLargeScreen) {
        if (this.isMobile) {
          // Cambió a móvil
          this.sidebarElement.classList.add('mobile');
          this.collapseSidebar();
        } else {
          // Cambió a escritorio
          this.sidebarElement.classList.remove('mobile');
          // Restaurar el estado guardado para escritorio
          this.restoreSidebarState();
        }
      }
    }
  
    /**
     * Actualiza la dirección del sidebar según RTL/LTR
     * @param {boolean} isRTL - True si la dirección es RTL, false para LTR
     */
    updateDirection(isRTL) {
      this.isRTL = isRTL;
      
      if (!this.sidebarElement) return;
      
      if (isRTL) {
        this.sidebarElement.classList.add('rtl');
      } else {
        this.sidebarElement.classList.remove('rtl');
      }
      
      // Actualizar los iconos según la dirección
      if (this.sidebarCollapseBtn) {
        const icon = this.sidebarCollapseBtn.querySelector('i');
        if (icon) {
          if (this.isSidebarExpanded) {
            icon.className = isRTL ? 'fas fa-chevron-right' : 'fas fa-chevron-left';
          } else {
            icon.className = isRTL ? 'fas fa-chevron-left' : 'fas fa-chevron-right';
          }
        }
      }
    }
  }
  
  // Exportar la clase
  export default Sidebar;