/**
 * FactuSystem - Componente de Sidebar
 * 
 * Maneja la funcionalidad completa de la barra lateral de navegación,
 * incluyendo menú desplegable, gestión de estados, navegación entre módulos
 * y sincronización del estado activo con el sistema de pestañas.
 */

class Sidebar {
    constructor() {
        this.sidebarElement = document.getElementById('sidebar');
        this.toggleButton = document.getElementById('sidebar-toggle');
        this.menuItems = document.querySelectorAll('.sidebar-menu-item');
        this.submenus = document.querySelectorAll('.sidebar-submenu');
        this.activeModule = null;
        this.collapsed = false;
        this.mobileBreakpoint = 768;
        this.tabsManager = window.FactuSystem.TabsManager;
        this.notificationsManager = window.FactuSystem.NotificationsManager;
        
        this.init();
    }

    /**
     * Inicializa el componente sidebar
     */
    init() {
        this.setupEventListeners();
        this.checkScreenSize();
        this.loadActiveStateFromStorage();
        this.updateUserInfo();
        this.setupNotificationBadges();
        
        // Actualizar estado inicial basado en la URL actual
        this.updateActiveStateFromUrl();
        
        // Aplicar configuración de tema guardada
        this.applyThemePreferences();
    }

    /**
     * Configura todos los event listeners del sidebar
     */
    setupEventListeners() {
        // Toggle para mostrar/ocultar sidebar
        if (this.toggleButton) {
            this.toggleButton.addEventListener('click', () => this.toggleSidebar());
        }

        // Expandir/colapsar submenús
        this.menuItems.forEach(item => {
            const submenuToggle = item.querySelector('.submenu-toggle');
            if (submenuToggle) {
                submenuToggle.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.toggleSubmenu(item);
                });
            }

            // Manejar clic en elementos del menú
            item.addEventListener('click', (e) => {
                const link = item.querySelector('a');
                if (link && link !== e.target && !e.target.classList.contains('submenu-toggle')) {
                    link.click();
                }
                
                // Si no tiene submenu, marcar como activo directamente
                if (!item.querySelector('.sidebar-submenu')) {
                    this.setActiveItem(item);
                }
            });
        });

        // Click en enlaces dentro del menú
        document.querySelectorAll('.sidebar-menu a:not(.submenu-toggle)').forEach(link => {
            link.addEventListener('click', (e) => {
                const moduleId = link.getAttribute('data-module');
                if (moduleId) {
                    e.preventDefault();
                    this.navigateTo(moduleId, link.getAttribute('href'), link.textContent.trim());
                }
            });
        });

        // Eventos para responsive
        window.addEventListener('resize', () => this.checkScreenSize());
        
        // Cierra sidebar en móvil al hacer clic fuera
        document.addEventListener('click', (e) => {
            if (window.innerWidth < this.mobileBreakpoint && 
                this.sidebarElement && 
                !this.sidebarElement.contains(e.target) && 
                !this.toggleButton.contains(e.target) &&
                !this.collapsed) {
                this.collapseSidebar();
            }
        });
        
        // Sincronización con pestañas
        document.addEventListener('tab-changed', (event) => {
            if (event.detail && event.detail.moduleId) {
                this.syncActiveStateWithTab(event.detail.moduleId);
            }
        });
        
        // Escuchar eventos de notificación
        document.addEventListener('notification-received', () => {
            this.updateNotificationBadges();
        });
    }

    /**
     * Alterna el estado del sidebar entre expandido y colapsado
     */
    toggleSidebar() {
        if (this.collapsed) {
            this.expandSidebar();
        } else {
            this.collapseSidebar();
        }
    }

    /**
     * Expande el sidebar
     */
    expandSidebar() {
        this.sidebarElement.classList.remove('collapsed');
        this.toggleButton.setAttribute('aria-expanded', 'true');
        this.collapsed = false;
        localStorage.setItem('sidebar-collapsed', 'false');
        
        // Emitir evento para que otros componentes se ajusten
        window.dispatchEvent(new CustomEvent('sidebar-expanded'));
    }

    /**
     * Colapsa el sidebar
     */
    collapseSidebar() {
        this.sidebarElement.classList.add('collapsed');
        this.toggleButton.setAttribute('aria-expanded', 'false');
        this.collapsed = true;
        localStorage.setItem('sidebar-collapsed', 'true');
        
        // Emitir evento para que otros componentes se ajusten
        window.dispatchEvent(new CustomEvent('sidebar-collapsed'));
    }

    /**
     * Alterna la visibilidad de un submenú
     * @param {HTMLElement} item - Elemento del menú con submenú
     */
    toggleSubmenu(item) {
        const submenu = item.querySelector('.sidebar-submenu');
        const icon = item.querySelector('.submenu-toggle i');
        
        if (!submenu) return;
        
        // Cerrar todos los demás submenús abiertos
        if (!submenu.classList.contains('active')) {
            this.submenus.forEach(sub => {
                if (sub !== submenu) {
                    sub.classList.remove('active');
                    sub.style.maxHeight = null;
                    
                    const parentItem = sub.closest('.sidebar-menu-item');
                    const parentIcon = parentItem?.querySelector('.submenu-toggle i');
                    if (parentIcon) {
                        parentIcon.classList.remove('rotate');
                    }
                }
            });
        }
        
        // Alternar estado del submenú actual
        submenu.classList.toggle('active');
        if (icon) {
            icon.classList.toggle('rotate');
        }
        
        // Animación de altura
        if (submenu.classList.contains('active')) {
            submenu.style.maxHeight = submenu.scrollHeight + 'px';
            
            // Guardar estado en localStorage
            const menuId = item.getAttribute('data-menu-id');
            if (menuId) {
                localStorage.setItem(`submenu-${menuId}-open`, 'true');
            }
        } else {
            submenu.style.maxHeight = null;
            
            // Guardar estado en localStorage
            const menuId = item.getAttribute('data-menu-id');
            if (menuId) {
                localStorage.setItem(`submenu-${menuId}-open`, 'false');
            }
        }
    }

    /**
     * Establece un elemento del menú como activo
     * @param {HTMLElement} item - Elemento a activar
     * @param {Boolean} skipTabSync - Si debe evitar sincronizar con pestañas
     */
    setActiveItem(item, skipTabSync = false) {
        // Remover activo de todos los elementos
        this.menuItems.forEach(menuItem => {
            menuItem.classList.remove('active');
            const submenuItems = menuItem.querySelectorAll('.sidebar-submenu-item');
            submenuItems.forEach(subItem => subItem.classList.remove('active'));
        });
        
        // Activar el elemento seleccionado
        item.classList.add('active');
        
        // Si es un elemento dentro de un submenu, también activar su padre
        const parentSubmenu = item.closest('.sidebar-submenu');
        if (parentSubmenu) {
            const parentMenuItem = parentSubmenu.closest('.sidebar-menu-item');
            if (parentMenuItem) {
                parentMenuItem.classList.add('active');
                
                // Asegurar que el submenu está abierto
                if (!parentSubmenu.classList.contains('active')) {
                    this.toggleSubmenu(parentMenuItem);
                }
            }
        }
        
        // Guardar estado en localStorage
        const moduleId = item.getAttribute('data-module') || 
                         item.querySelector('[data-module]')?.getAttribute('data-module');
        
        if (moduleId) {
            localStorage.setItem('active-module', moduleId);
            this.activeModule = moduleId;
            
            // Sincronizar con sistema de pestañas si es necesario
            if (!skipTabSync && this.tabsManager) {
                const link = item.querySelector('a');
                if (link) {
                    this.tabsManager.activateTab(
                        moduleId, 
                        link.getAttribute('href'), 
                        link.textContent.trim()
                    );
                }
            }
        }
    }

    /**
     * Navega a un módulo específico
     * @param {String} moduleId - ID del módulo
     * @param {String} url - URL del módulo
     * @param {String} title - Título para la pestaña
     */
    navigateTo(moduleId, url, title) {
        if (this.tabsManager) {
            this.tabsManager.openTab(moduleId, url, title);
        } else {
            // Fallback si no hay gestor de pestañas
            this.loadContent(url);
        }
        
        // En móvil, colapsar sidebar después de navegar
        if (window.innerWidth < this.mobileBreakpoint) {
            this.collapseSidebar();
        }
    }

    /**
     * Carga contenido directamente (fallback sin pestañas)
     * @param {String} url - URL a cargar
     */
    loadContent(url) {
        if (!url) return;
        
        const contentContainer = document.getElementById('main-content');
        if (!contentContainer) return;
        
        // Mostrar spinner de carga
        contentContainer.innerHTML = '<div class="loader-container"><div class="loader"></div></div>';
        
        // Cargar contenido via fetch
        fetch(url)
            .then(response => {
                if (!response.ok) {
                    throw new Error('Network response was not ok');
                }
                return response.text();
            })
            .then(html => {
                contentContainer.innerHTML = html;
                
                // Dispatch evento para inicializar scripts en el nuevo contenido
                window.dispatchEvent(new CustomEvent('content-loaded', {
                    detail: { url, container: contentContainer }
                }));
            })
            .catch(error => {
                contentContainer.innerHTML = `
                    <div class="error-container">
                        <h2>Error al cargar el contenido</h2>
                        <p>${error.message}</p>
                        <button class="btn btn-primary retry-btn">Reintentar</button>
                    </div>
                `;
                
                const retryBtn = contentContainer.querySelector('.retry-btn');
                if (retryBtn) {
                    retryBtn.addEventListener('click', () => this.loadContent(url));
                }
            });
    }

    /**
     * Sincroniza el estado activo con la pestaña actual
     * @param {String} moduleId - ID del módulo activo
     */
    syncActiveStateWithTab(moduleId) {
        if (!moduleId) return;
        
        const menuItem = document.querySelector(`[data-module="${moduleId}"]`);
        if (menuItem) {
            // Si es un enlace dentro de un elemento de menú
            const parentMenuItem = menuItem.closest('.sidebar-menu-item, .sidebar-submenu-item');
            if (parentMenuItem) {
                this.setActiveItem(parentMenuItem, true);
            } else if (menuItem.classList.contains('sidebar-menu-item') || 
                      menuItem.classList.contains('sidebar-submenu-item')) {
                this.setActiveItem(menuItem, true);
            }
        }
    }

    /**
     * Verifica el tamaño de la pantalla y ajusta el sidebar
     */
    checkScreenSize() {
        const isMobile = window.innerWidth < this.mobileBreakpoint;
        
        // En móvil, siempre colapsar por defecto
        if (isMobile) {
            this.collapseSidebar();
        } else {
            // En desktop, restaurar preferencia guardada
            const savedState = localStorage.getItem('sidebar-collapsed');
            if (savedState === 'true') {
                this.collapseSidebar();
            } else {
                this.expandSidebar();
            }
        }
    }

    /**
     * Restaura el estado activo desde localStorage
     */
    loadActiveStateFromStorage() {
        // Restaurar submenús abiertos
        this.menuItems.forEach(item => {
            const menuId = item.getAttribute('data-menu-id');
            if (menuId) {
                const isOpen = localStorage.getItem(`submenu-${menuId}-open`) === 'true';
                const submenu = item.querySelector('.sidebar-submenu');
                
                if (isOpen && submenu && !submenu.classList.contains('active')) {
                    this.toggleSubmenu(item);
                }
            }
        });
        
        // Restaurar módulo activo
        const activeModuleId = localStorage.getItem('active-module');
        if (activeModuleId) {
            const activeItem = document.querySelector(`[data-module="${activeModuleId}"]`);
            if (activeItem) {
                const parentMenuItem = activeItem.closest('.sidebar-menu-item, .sidebar-submenu-item');
                if (parentMenuItem) {
                    this.setActiveItem(parentMenuItem);
                } else if (activeItem.classList.contains('sidebar-menu-item') || 
                          activeItem.classList.contains('sidebar-submenu-item')) {
                    this.setActiveItem(activeItem);
                }
            }
        }
    }

    /**
     * Actualiza el estado activo basado en la URL actual
     */
    updateActiveStateFromUrl() {
        // Obtener la ruta actual
        const currentPath = window.location.pathname;
        
        // Buscar enlace que coincida con la ruta
        const matchingLink = document.querySelector(`.sidebar-menu a[href="${currentPath}"]`);
        if (matchingLink) {
            const menuItem = matchingLink.closest('.sidebar-menu-item, .sidebar-submenu-item');
            if (menuItem) {
                this.setActiveItem(menuItem);
            }
        }
    }

    /**
     * Actualiza la información del usuario en el sidebar
     */
    updateUserInfo() {
        const userInfoElement = document.getElementById('sidebar-user-info');
        if (!userInfoElement) return;
        
        // Intentar obtener información del usuario del localStorage o API
        const userInfo = JSON.parse(localStorage.getItem('user-info')) || {};
        
        if (userInfo.name) {
            const userNameElement = userInfoElement.querySelector('.user-name');
            if (userNameElement) {
                userNameElement.textContent = userInfo.name;
            }
        }
        
        if (userInfo.role) {
            const userRoleElement = userInfoElement.querySelector('.user-role');
            if (userRoleElement) {
                userRoleElement.textContent = userInfo.role;
            }
        }
        
        if (userInfo.avatar) {
            const userAvatarElement = userInfoElement.querySelector('.user-avatar');
            if (userAvatarElement) {
                userAvatarElement.src = userInfo.avatar;
            }
        }
        
        // Configurar menú de usuario
        const userMenuToggle = userInfoElement.querySelector('.user-menu-toggle');
        const userMenu = document.getElementById('user-menu');
        
        if (userMenuToggle && userMenu) {
            userMenuToggle.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                userMenu.classList.toggle('show');
                
                // Cerrar menú al hacer clic fuera
                const closeMenu = (event) => {
                    if (!userMenu.contains(event.target) && !userMenuToggle.contains(event.target)) {
                        userMenu.classList.remove('show');
                        document.removeEventListener('click', closeMenu);
                    }
                };
                
                if (userMenu.classList.contains('show')) {
                    setTimeout(() => {
                        document.addEventListener('click', closeMenu);
                    }, 0);
                }
            });
        }
    }

    /**
     * Configura las insignias de notificación en el sidebar
     */
    setupNotificationBadges() {
        // Inicializar contadores desde localStorage o API
        this.updateNotificationBadges();
        
        // Actualizar cada minuto (o según configuración)
        setInterval(() => this.updateNotificationBadges(), 60000);
    }

    /**
     * Actualiza los contadores de las insignias de notificación
     */
    updateNotificationBadges() {
        // Si existe el gestor de notificaciones, usarlo
        if (this.notificationsManager) {
            const counts = this.notificationsManager.getNotificationCounts();
            
            // Actualizar insignias para cada módulo
            for (const moduleId in counts) {
                this.updateBadgeForModule(moduleId, counts[moduleId]);
            }
        } else {
            // Fallback: usar datos del localStorage
            try {
                const notificationData = JSON.parse(localStorage.getItem('notification-counts')) || {};
                
                for (const moduleId in notificationData) {
                    this.updateBadgeForModule(moduleId, notificationData[moduleId]);
                }
            } catch (e) {
                console.error('Error al cargar contadores de notificaciones', e);
            }
        }
    }

    /**
     * Actualiza la insignia para un módulo específico
     * @param {String} moduleId - ID del módulo
     * @param {Number} count - Contador de notificaciones
     */
    updateBadgeForModule(moduleId, count) {
        const menuItem = document.querySelector(`[data-module="${moduleId}"]`);
        if (!menuItem) return;
        
        let badge = menuItem.querySelector('.notification-badge');
        
        // Si no hay insignia pero hay notificaciones, crear una
        if (!badge && count > 0) {
            badge = document.createElement('span');
            badge.className = 'notification-badge';
            menuItem.appendChild(badge);
        }
        
        // Actualizar o eliminar la insignia según el conteo
        if (badge) {
            if (count > 0) {
                badge.textContent = count > 99 ? '99+' : count;
                badge.classList.add('active');
            } else {
                badge.remove();
            }
        }
    }

    /**
     * Aplica las preferencias de tema guardadas
     */
    applyThemePreferences() {
        const theme = localStorage.getItem('app-theme') || 'light';
        const sidebarTheme = localStorage.getItem('sidebar-theme') || theme;
        
        if (this.sidebarElement) {
            // Eliminar clases de tema anteriores
            this.sidebarElement.classList.remove('theme-light', 'theme-dark', 'theme-custom');
            
            // Aplicar nuevo tema
            this.sidebarElement.classList.add(`theme-${sidebarTheme}`);
        }
    }
}

// Inicializar y exportar como parte del namespace global
window.FactuSystem = window.FactuSystem || {};
window.FactuSystem.Sidebar = new Sidebar();

// También exportar para uso con ES modules
 window

module.exports = window.FactuSystem.Sidebar;