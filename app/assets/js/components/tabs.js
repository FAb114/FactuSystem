/**
 * FactuSystem - Componente de Tabs (Pestañas)
 * 
 * Sistema de pestañas multitarea que permite al usuario trabajar en múltiples
 * módulos simultáneamente, con soporte para guardar/cerrar pestañas,
 * arrastrar y soltar para reordenar, y persistencia del estado.
 */

class TabsManager {
    constructor() {
        // Referencias DOM
        this.tabsContainer = document.getElementById('tabs-container');
        this.tabsContent = document.getElementById('tabs-content');
        this.tabsList = document.getElementById('tabs-list');
        this.tabsOverflowMenu = document.getElementById('tabs-overflow');
        this.newTabButton = document.getElementById('new-tab-button');
        
        // Estado
        this.tabs = [];
        this.activeTabId = null;
        this.draggingTab = null;
        this.maxTabs = 10; // Máximo número de pestañas permitidas
        this.tabCounter = 0; // Contador para generar IDs únicos
        
        // Configuración
        this.defaultTab = {
            id: 'dashboard',
            url: '/app/views/dashboard.html',
            title: 'Dashboard',
            moduleId: 'dashboard',
            pinned: true,
            closable: false
        };
        
        // Inicializar componente
        this.init();
    }

    /**
     * Inicializa el sistema de pestañas
     */
    init() {
        // Verificar si existen los elementos necesarios
        if (!this.tabsContainer || !this.tabsList || !this.tabsContent) {
            console.error('FactuSystem: No se encontraron los elementos necesarios para el sistema de pestañas');
            return;
        }

        // Configurar event listeners
        this.setupEventListeners();
        
        // Inicializar desde sessionStorage o crear pestaña predeterminada
        this.loadTabsFromStorage() || this.createDefaultTab();
        
        // Inicializar gestor de desbordamiento
        this.initOverflowHandler();
    }
    
    /**
     * Configura todos los event listeners necesarios
     */
    setupEventListeners() {
        // Listener para crear nueva pestaña
        if (this.newTabButton) {
            this.newTabButton.addEventListener('click', () => this.showTabsMenu());
        }
        
        // Event delegation para clicks en las pestañas
        if (this.tabsList) {
            this.tabsList.addEventListener('click', (e) => {
                const tabElement = e.target.closest('.tab-item');
                if (!tabElement) return;
                
                // Manejar clic en botón de cerrar
                if (e.target.closest('.tab-close')) {
                    e.stopPropagation();
                    const tabId = tabElement.getAttribute('data-tab-id');
                    this.closeTab(tabId);
                    return;
                }
                
                // Manejar clic en menú contextual
                if (e.target.closest('.tab-menu-trigger')) {
                    e.stopPropagation();
                    e.preventDefault();
                    this.showTabContextMenu(tabElement, e);
                    return;
                }
                
                // Manejar clic en la pestaña para activarla
                const tabId = tabElement.getAttribute('data-tab-id');
                if (tabId) {
                    this.activateTab(tabId);
                }
            });
            
            // Event listeners para drag and drop
            this.setupDragAndDrop();
        }
        
        // Escuchar eventos de resize para manejar overflow
        window.addEventListener('resize', () => {
            this.handleTabsOverflow();
        });
        
        // Escuchar evento de cierre de ventana para guardar el estado
        window.addEventListener('beforeunload', () => {
            this.saveTabsToStorage();
        });
        
        // Doble clic en área vacía de pestañas para crear una nueva
        this.tabsContainer.addEventListener('dblclick', (e) => {
            // Solo si el clic fue directamente en el contenedor y no en una pestaña
            if (e.target === this.tabsContainer || e.target === this.tabsList) {
                this.showTabsMenu();
            }
        });
        
        // Listeners para el menú de overflow
        if (this.tabsOverflowMenu) {
            this.tabsOverflowMenu.addEventListener('click', (e) => {
                const tabItem = e.target.closest('[data-tab-id]');
                if (tabItem) {
                    const tabId = tabItem.getAttribute('data-tab-id');
                    this.activateTab(tabId);
                    this.tabsOverflowMenu.classList.remove('show');
                }
            });
            
            // Cerrar menú al hacer clic fuera
            document.addEventListener('click', (e) => {
                if (!this.tabsOverflowMenu.contains(e.target) && 
                    !e.target.closest('#tabs-overflow-trigger')) {
                    this.tabsOverflowMenu.classList.remove('show');
                }
            });
        }
    }
    
    /**
     * Configura el sistema de arrastrar y soltar para reordenar pestañas
     */
    setupDragAndDrop() {
        this.tabsList.addEventListener('dragstart', (e) => {
            const tabElement = e.target.closest('.tab-item');
            if (!tabElement) return;
            
            // Solo permitir arrastrar si no es una pestaña fijada
            if (tabElement.classList.contains('pinned')) {
                e.preventDefault();
                return;
            }
            
            this.draggingTab = tabElement;
            e.dataTransfer.setData('text/plain', tabElement.getAttribute('data-tab-id'));
            e.dataTransfer.effectAllowed = 'move';
            
            // Agregar clase para efectos visuales
            setTimeout(() => {
                tabElement.classList.add('dragging');
            }, 0);
        });
        
        this.tabsList.addEventListener('dragend', (e) => {
            if (this.draggingTab) {
                this.draggingTab.classList.remove('dragging');
                this.draggingTab = null;
            }
        });
        
        this.tabsList.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            
            const tabElement = e.target.closest('.tab-item');
            if (!tabElement || tabElement === this.draggingTab || tabElement.classList.contains('pinned')) {
                return;
            }
            
            // Determinar si debe colocar antes o después del elemento
            const rect = tabElement.getBoundingClientRect();
            const relativeX = e.clientX - rect.left;
            const isAfter = relativeX > rect.width / 2;
            
            // Remover indicadores previos
            this.tabsList.querySelectorAll('.drop-before, .drop-after').forEach(el => {
                el.classList.remove('drop-before', 'drop-after');
            });
            
            // Agregar indicador visual
            tabElement.classList.add(isAfter ? 'drop-after' : 'drop-before');
        });
        
        this.tabsList.addEventListener('dragleave', (e) => {
            if (!e.target.closest('#tabs-list')) {
                this.tabsList.querySelectorAll('.drop-before, .drop-after').forEach(el => {
                    el.classList.remove('drop-before', 'drop-after');
                });
            }
        });
        
        this.tabsList.addEventListener('drop', (e) => {
            e.preventDefault();
            
            const targetTab = e.target.closest('.tab-item');
            if (!targetTab || targetTab === this.draggingTab || targetTab.classList.contains('pinned')) {
                return;
            }
            
            const draggedTabId = e.dataTransfer.getData('text/plain');
            const targetTabId = targetTab.getAttribute('data-tab-id');
            
            // Determinar la posición de colocación
            const rect = targetTab.getBoundingClientRect();
            const relativeX = e.clientX - rect.left;
            const placeAfter = relativeX > rect.width / 2;
            
            // Reordenar pestañas en el array
            this.reorderTabs(draggedTabId, targetTabId, placeAfter);
            
            // Limpiar indicadores visuales
            this.tabsList.querySelectorAll('.drop-before, .drop-after').forEach(el => {
                el.classList.remove('drop-before', 'drop-after');
            });
            
            // Actualizar el DOM
            this.renderTabs();
            this.saveTabsToStorage();
        });
    }
    
    /**
     * Reordena las pestañas tras una operación de arrastrar y soltar
     * @param {String} draggedTabId - ID de la pestaña arrastrada
     * @param {String} targetTabId - ID de la pestaña objetivo
     * @param {Boolean} placeAfter - Si se coloca después del objetivo
     */
    reorderTabs(draggedTabId, targetTabId, placeAfter) {
        const draggedIndex = this.tabs.findIndex(tab => tab.id === draggedTabId);
        const targetIndex = this.tabs.findIndex(tab => tab.id === targetTabId);
        
        if (draggedIndex === -1 || targetIndex === -1) return;
        
        // Remover la pestaña arrastrada
        const [draggedTab] = this.tabs.splice(draggedIndex, 1);
        
        // Calcular la nueva posición
        let newIndex = targetIndex;
        if (draggedIndex < targetIndex && !placeAfter) {
            newIndex--;
        } else if (draggedIndex > targetIndex && placeAfter) {
            newIndex++;
        }
        
        // Asegurarse de no colocar pestañas no fijadas antes de las fijadas
        const pinnedCount = this.tabs.filter(tab => tab.pinned).length;
        if (!draggedTab.pinned && newIndex < pinnedCount) {
            newIndex = pinnedCount;
        }
        
        // Insertar la pestaña en la nueva posición
        this.tabs.splice(newIndex, 0, draggedTab);
    }
    
    /**
     * Inicializa el manejador de desbordamiento de pestañas
     */
    initOverflowHandler() {
        // Crear botón de overflow si no existe
        if (!document.getElementById('tabs-overflow-trigger')) {
            const overflowTrigger = document.createElement('button');
            overflowTrigger.id = 'tabs-overflow-trigger';
            overflowTrigger.className = 'tabs-overflow-trigger';
            overflowTrigger.title = 'Mostrar todas las pestañas';
            overflowTrigger.innerHTML = '<i class="fas fa-chevron-down"></i> <span class="counter"></span>';
            this.tabsContainer.appendChild(overflowTrigger);
            
            // Event listener para mostrar menú
            overflowTrigger.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.toggleOverflowMenu();
            });
        }
        
        // Calcular inicialmente si hay overflow
        this.handleTabsOverflow();
    }
    
    /**
     * Maneja el desbordamiento de pestañas cuando no caben todas
     */
    handleTabsOverflow() {
        if (!this.tabsList || this.tabs.length === 0) return;
        
        const containerWidth = this.tabsContainer.clientWidth;
        const newTabButtonWidth = this.newTabButton ? this.newTabButton.offsetWidth : 0;
        const overflowTrigger = document.getElementById('tabs-overflow-trigger');
        const overflowTriggerWidth = overflowTrigger ? overflowTrigger.offsetWidth : 0;
        
        // Espacio disponible (restando botones)
        const availableWidth = containerWidth - newTabButtonWidth - 10;
        
        let totalWidth = 0;
        let visibleTabs = 0;
        let hiddenTabs = 0;
        
        // Hacer visibles todas las pestañas para medir
        this.tabsList.querySelectorAll('.tab-item').forEach(tab => {
            tab.style.display = '';
        });
        
        // Medir cada pestaña
        const tabElements = this.tabsList.querySelectorAll('.tab-item');
        tabElements.forEach((tab, index) => {
            // Siempre mostrar la pestaña activa y las fijadas si es posible
            const isActive = tab.classList.contains('active');
            const isPinned = tab.classList.contains('pinned');
            
            if ((totalWidth + tab.offsetWidth) < availableWidth || isActive || (isPinned && hiddenTabs === 0)) {
                totalWidth += tab.offsetWidth;
                visibleTabs++;
            } else {
                tab.style.display = 'none';
                hiddenTabs++;
            }
        });
        
        // Mostrar u ocultar botón de overflow
        if (overflowTrigger) {
            if (hiddenTabs > 0) {
                overflowTrigger.style.display = 'flex';
                overflowTrigger.querySelector('.counter').textContent = hiddenTabs;
            } else {
                overflowTrigger.style.display = 'none';
            }
        }
        
        // Si hay overflow, añadir clase al contenedor
        this.tabsContainer.classList.toggle('has-overflow', hiddenTabs > 0);
    }
    
    /**
     * Alterna la visibilidad del menú de overflow
     */
    toggleOverflowMenu() {
        if (!this.tabsOverflowMenu) return;
        
        const isVisible = this.tabsOverflowMenu.classList.contains('show');
        
        if (!isVisible) {
            // Actualizar contenido del menú
            this.updateOverflowMenu();
            
            // Posicionar y mostrar menú
            const trigger = document.getElementById('tabs-overflow-trigger');
            if (trigger) {
                const rect = trigger.getBoundingClientRect();
                this.tabsOverflowMenu.style.top = `${rect.bottom}px`;
                this.tabsOverflowMenu.style.right = `${window.innerWidth - rect.right}px`;
            }
        }
        
        this.tabsOverflowMenu.classList.toggle('show', !isVisible);
    }
    
    /**
     * Actualiza el contenido del menú de overflow
     */
    updateOverflowMenu() {
        if (!this.tabsOverflowMenu) return;
        
        // Limpiar contenido previo
        this.tabsOverflowMenu.innerHTML = '';
        
        // Obtener pestañas ocultas
        const hiddenTabs = Array.from(this.tabsList.querySelectorAll('.tab-item[style*="display: none"]'));
        
        // Si no hay pestañas ocultas, mostrar mensaje
        if (hiddenTabs.length === 0) {
            const emptyMessage = document.createElement('div');
            emptyMessage.className = 'overflow-empty-message';
            emptyMessage.textContent = 'No hay pestañas ocultas';
            this.tabsOverflowMenu.appendChild(emptyMessage);
            return;
        }
        
        // Crear lista de pestañas
        const menuList = document.createElement('ul');
        menuList.className = 'overflow-tabs-list';
        
        hiddenTabs.forEach(tabElement => {
            const tabId = tabElement.getAttribute('data-tab-id');
            const tab = this.tabs.find(t => t.id === tabId);
            if (!tab) return;
            
            const listItem = document.createElement('li');
            listItem.className = 'overflow-tab-item';
            listItem.setAttribute('data-tab-id', tabId);
            
            // Icono del módulo
            const moduleIcon = tabElement.querySelector('.tab-icon')?.innerHTML || '';
            
            // Crear contenido del item
            listItem.innerHTML = `
                <span class="overflow-tab-icon">${moduleIcon}</span>
                <span class="overflow-tab-title">${tab.title}</span>
                ${tab.closable ? '<button class="overflow-tab-close" title="Cerrar pestaña"><i class="fas fa-times"></i></button>' : ''}
            `;
            
            // Manejar clic en botón cerrar
            const closeButton = listItem.querySelector('.overflow-tab-close');
            if (closeButton) {
                closeButton.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.closeTab(tabId);
                    this.toggleOverflowMenu();
                });
            }
            
            menuList.appendChild(listItem);
        });
        
        this.tabsOverflowMenu.appendChild(menuList);
    }

    /**
     * Abre una nueva pestaña
     * @param {String} moduleId - ID del módulo
     * @param {String} url - URL a cargar
     * @param {String} title - Título de la pestaña
     * @param {Object} options - Opciones adicionales
     * @returns {String} ID de la pestaña creada
     */
    openTab(moduleId, url, title, options = {}) {
        // Verificar si ya existe una pestaña con este módulo
        const existingTab = this.tabs.find(tab => tab.moduleId === moduleId);
        if (existingTab) {
            this.activateTab(existingTab.id);
            return existingTab.id;
        }
        
        // Verificar límite de pestañas
        if (this.tabs.length >= this.maxTabs) {
            this.showMaxTabsWarning();
            return null;
        }
        
        // Generar ID único para la pestaña
        const tabId = `tab-${moduleId}-${Date.now()}`;
        
        // Crear objeto de la pestaña
        const newTab = {
            id: tabId,
            moduleId: moduleId,
            url: url,
            title: title || 'Nueva pestaña',
            icon: options.icon || this.getModuleIcon(moduleId),
            closable: options.closable !== undefined ? options.closable : true,
            pinned: options.pinned || false,
            timestamp: Date.now()
        };
        
        // Determinar posición para insertar la pestaña
        let insertPosition = this.tabs.length;
        
        // Si es una pestaña fijada, insertarla después de la última pestaña fijada
        if (newTab.pinned) {
            insertPosition = this.tabs.filter(tab => tab.pinned).length;
        }
        
        // Insertar la pestaña en la posición adecuada
        this.tabs.splice(insertPosition, 0, newTab);
        
        // Renderizar y activar la nueva pestaña
        this.renderTabs();
        this.activateTab(tabId);
        this.saveTabsToStorage();
        
        return tabId;
    }
    
    /**
     * Activa una pestaña específica
     * @param {String} tabId - ID de la pestaña a activar
     * @param {String} url - URL opcional para actualizar
     * @param {String} title - Título opcional para actualizar
     */
    activateTab(tabId, url = null, title = null) {
        // Buscar la pestaña
        const tabIndex = this.tabs.findIndex(tab => tab.id === tabId);
        if (tabIndex === -1) {
            // Si la pestaña no existe pero tenemos moduleId, url y title, crearla
            if (url && title) {
                return this.openTab(tabId, url, title);
            }
            return;
        }
        
        // Actualizar URL y título si se proporcionan
        if (url) this.tabs[tabIndex].url = url;
        if (title) this.tabs[tabIndex].title = title;
        
        // Actualizar estado activo
        this.activeTabId = tabId;
        
        // Actualizar clases en DOM
        if (this.tabsList) {
            this.tabsList.querySelectorAll('.tab-item').forEach(tab => {
                tab.classList.remove('active');
            });
            
            const activeTabElement = this.tabsList.querySelector(`[data-tab-id="${tabId}"]`);
            if (activeTabElement) {
                activeTabElement.classList.add('active');
                
                // Hacer scroll a la pestaña si está fuera de vista
                this.scrollTabIntoView(activeTabElement);
            }
        }
        
        // Cargar contenido
        this.loadTabContent(tabId);
        
        // Disparar evento de cambio de pestaña
        this.dispatchTabChangeEvent(tabId);
        
        // Guardar estado
        this.saveTabsToStorage();
    }
    
    /**
     * Hace scroll para mostrar la pestaña activa si está fuera de vista
     * @param {HTMLElement} tabElement - Elemento DOM de la pestaña
     */
    scrollTabIntoView(tabElement) {
        if (!tabElement || !this.tabsList) return;
        
        const containerRect = this.tabsList.getBoundingClientRect();
        const tabRect = tabElement.getBoundingClientRect();
        
        // Verificar si la pestaña está fuera de la vista
        const isTabOutOfView = (
            tabRect.left < containerRect.left || 
            tabRect.right > containerRect.right
        );
        
        if (isTabOutOfView) {
            // Calcular posición de scroll
            const scrollPos = tabElement.offsetLeft - (containerRect.width / 2) + (tabRect.width / 2);
            this.tabsList.scrollTo({
                left: Math.max(0, scrollPos),
                behavior: 'smooth'
            });
        }
    }
    
    /**
     * Cierra una pestaña
     * @param {String} tabId - ID de la pestaña a cerrar
     */
    closeTab(tabId) {
        const tabIndex = this.tabs.findIndex(tab => tab.id === tabId);
        if (tabIndex === -1) return;
        
        // No cerrar pestañas no cerrables
        if (!this.tabs[tabIndex].closable) return;
        
        // Si es la pestaña activa, activar otra
        const isActive = this.activeTabId === tabId;
        
        // Remover la pestaña
        this.tabs.splice(tabIndex, 1);
        
        // Si no quedan pestañas, crear pestaña por defecto
        if (this.tabs.length === 0) {
            this.createDefaultTab();
        } else if (isActive) {
            // Activar la pestaña que estaba a la derecha, o a la izquierda si era la última
            const newActiveIndex = Math.min(tabIndex, this.tabs.length - 1);
            this.activateTab(this.tabs[newActiveIndex].id);
        }
        
        // Actualizar DOM y guardar estado
        this.renderTabs();
        this.saveTabsToStorage();
    }
    
    /**
     * Cierra todas las pestañas excepto la activa
     */
    closeOtherTabs() {
        if (!this.activeTabId) return;
        
        // Conservar solo la pestaña activa y las no cerrables
        this.tabs = this.tabs.filter(tab => 
            tab.id === this.activeTabId || !tab.closable
        );
        
        // Actualizar DOM y guardar estado
        this.renderTabs();
        this.saveTabsToStorage();
    }
    
    /**
     * Cierra todas las pestañas a la derecha de la activa
     */
    closeTabsToRight() {
        if (!this.activeTabId) return;
        
        const activeIndex = this.tabs.findIndex(tab => tab.id === this.activeTabId);
        if (activeIndex === -1) return;
        
        // Mantener pestañas hasta la activa y eliminar las demás (excepto no cerrables)
        this.tabs = [
            ...this.tabs.slice(0, activeIndex + 1),
            ...this.tabs.slice(activeIndex + 1).filter(tab => !tab.closable)
        ];
        
        // Actualizar DOM y guardar estado
        this.renderTabs();
        this.saveTabsToStorage();
    }
    
    /**
     * Fija o desfija una pestaña
     * @param {String} tabId - ID de la pestaña
     */
    togglePinTab(tabId) {
        const tabIndex = this.tabs.findIndex(tab => tab.id === tabId);
        if (tabIndex === -1) return;
        
        const tab = this.tabs[tabIndex];
        
        // Cambiar estado
        tab.pinned = !tab.pinned;
        
        // Si se fija, moverla al principio entre las fijadas
        // Si se desfija, moverla al final de las fijadas
        if (tab.pinned) {
            // Remover de la posición actual
            this.tabs.splice(tabIndex, 1);
            
            // Contar pestañas fijadas
            const pinnedCount = this.tabs.filter(t => t.pinned).length;
            
            // Insertar después de la última pestaña fijada
            this.tabs.splice(pinnedCount, 0, tab);
        } else {
            // Remover de la posición actual
            this.tabs.splice(tabIndex, 1);
            
            // Contar pestañas fijadas
            const pinnedCount = this.tabs.filter(t => t.pinned).length;
            
            // Insertar después de la última pestaña fijada
            this.tabs.splice(pinnedCount, 0, tab);
        }
        
        // Actualizar DOM y guardar estado
        this.renderTabs();
        this.saveTabsToStorage();
    }
    
    /**
     * Duplica una pestaña
     * @param {String} tabId - ID de la pestaña a duplicar
     */
    duplicateTab(tabId) {
        const tab = this.tabs.find(tab => tab.id === tabId);
        if (!tab) return;
        
        // Verificar límite de pestañas
        if (this.tabs.length >= this.maxTabs) {
            this.showMaxTabsWarning();
            return;
        }
        
        // Crear nueva pestaña con los mismos datos pero ID diferente
        const newTabId = this.openTab(
            tab.moduleId,
            tab.url,
            `${tab.title} (copia)`,
            {
                icon: tab.icon,
                closable: tab.closable,
                pinned: false // La copia nunca está fijada
            }
        );
        
        return newTabId;
    }
    
    /**
     * Recarga el contenido de una pestaña
     * @param {String} tabId - ID de la pestaña a recargar
     */
    reloadTab(tabId) {
        const tab = this.tabs.find(tab => tab.id === tabId);
        if (!tab) return;
        
        // Simplemente volver a cargar el contenido
        this.loadTabContent(tabId, true);
    }
    
    /**
     * Carga el contenido de una pestaña en el área de contenido
     * @param {String} tabId - ID de la pestaña
     * @param {Boolean} forceReload - Forzar recarga aunque sea la misma URL
     */
    loadTabContent(tabId, forceReload = false) {
        if (!this.tabsContent) return;
        
        const tab = this.tabs.find(tab => tab.id === tabId);
        if (!tab) return;
        
        // Verificar si el contenido ya está cargado
        const existingContent = document.getElementById(`tab-content-${tabId}`);
        if (existingContent && !forceReload) {
            // Ocultar otros contenidos
            Array.from(this.tabsContent.children).forEach(child => {
                child.style.display = 'none';
            });
            
            // Mostrar este contenido
            existingContent.style.display = 'block';
            return;
        }
        
        // Mostrar indicador de carga
        this.showLoadingIndicator();
        
        // Crear contenedor para el contenido de la pestaña si no existe
        let contentContainer = existingContent;
        if (!contentContainer) {
            contentContainer = document.createElement('div');
            contentContainer.id = `tab-content-${tabId}`;
            contentContainer.className = 'tab-content-pane';
            this.tabsContent.appendChild(contentContainer);
        }
        
        // Ocultar otros contenidos
        Array.from(this.tabsContent.children).forEach(child => {
            child.style.display = 'none';
        });
        
        // Mostrar este contenido
        contentContainer.style.display = 'block';
        
        // Cargar contenido
        fetch(tab.url)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Error ${response.status}: ${response.statusText}`);
                }
                return response.text();
            })
            .then(html => {
                contentContainer.innerHTML = html;
                
                // Inicializar scripts en el contenido cargado
                this.initTabScripts(contentContainer, tab);
                
                // Ocultar indicador de carga
                this.hideLoadingIndicator();
                
                // Emitir evento de contenido cargado
                this.dispatchContentLoadedEvent(tabId, tab);
            })
            .catch(error => {
                console.error('Error al cargar contenido de pestaña:', error);
                
                // Mostrar mensaje de error
                contentContainer.innerHTML = `
                    <div class="tab-error-container">
                        <div class="tab-error-icon">
                            <i class="fas fa-exclamation-triangle"></i>
                        </div>
                        <h3>Error al cargar el contenido</h3>
                        <p>${error.message}</p>
                        <button class="btn btn-primary reload-tab-btn">
                            <i class="fas fa-sync-alt"></i> Intentar nuevamente
                        </button>
                    </div>
                `;
                
                // Configurar botón de recarga
                const reloadButton = contentContainer.querySelector('.reload-tab-btn');
                if (reloadButton) {
                    reloadButton.addEventListener('click', () => this.reloadTab(tabId));
                }
                
                // Ocultar indicador de carga
                this.hideLoadingIndicator();
            });
    }
    
    /**
 * Inicializa scripts en el contenido cargado de una pestaña
 * @param {HTMLElement} container - Contenedor del contenido
 * @param {Object} tab - Datos de la pestaña
 */
initTabScripts(container, tab) {
    // Buscar todos los scripts en el contenido cargado
    const scripts = container.querySelectorAll('script');
    
    // Ejecutar cada script
    scripts.forEach(oldScript => {
        const newScript = document.createElement('script');
        
        // Copiar atributos
        Array.from(oldScript.attributes).forEach(attr => {
            newScript.setAttribute(attr.name, attr.value);
        });
        
        // Copiar contenido del script
        newScript.textContent = oldScript.textContent;
        
        // Reemplazar el script viejo con el nuevo para que se ejecute
        oldScript.parentNode.replaceChild(newScript, oldScript);
    });
    
    // Añadir información de la pestaña al contenedor
    container.setAttribute('data-tab-id', tab.id);
    container.setAttribute('data-module-id', tab.moduleId);
    
    // Inicializar componentes y plugins específicos si existen
    if (window.FactuSystem && window.FactuSystem.initComponents) {
        window.FactuSystem.initComponents(container, tab);
    }
}

/**
 * Muestra un indicador de carga durante la carga de contenido
 */
showLoadingIndicator() {
    // Verificar si ya existe el indicador
    let loader = document.getElementById('tabs-content-loader');
    
    if (!loader) {
        // Crear el indicador
        loader = document.createElement('div');
        loader.id = 'tabs-content-loader';
        loader.className = 'tabs-content-loader';
        loader.innerHTML = `
            <div class="loader-spinner"></div>
            <span>Cargando contenido...</span>
        `;
        
        // Añadirlo al DOM
        document.body.appendChild(loader);
    }
    
    // Mostrar el indicador
    loader.classList.add('active');
}

/**
 * Oculta el indicador de carga
 */
hideLoadingIndicator() {
    const loader = document.getElementById('tabs-content-loader');
    if (loader) {
        loader.classList.remove('active');
    }
}

/**
 * Muestra una advertencia cuando se alcanza el límite de pestañas
 */
showMaxTabsWarning() {
    // Crear el elemento de alerta si no existe
    let alert = document.getElementById('max-tabs-alert');
    
    if (!alert) {
        alert = document.createElement('div');
        alert.id = 'max-tabs-alert';
        alert.className = 'system-alert max-tabs-alert';
        alert.innerHTML = `
            <div class="alert-icon">
                <i class="fas fa-exclamation-circle"></i>
            </div>
            <div class="alert-content">
                <h4>Límite de pestañas alcanzado</h4>
                <p>No puedes abrir más pestañas. Por favor, cierra alguna antes de continuar.</p>
            </div>
            <button class="alert-close">
                <i class="fas fa-times"></i>
            </button>
        `;
        
        // Añadir al DOM
        document.body.appendChild(alert);
        
        // Configurar botón de cierre
        const closeButton = alert.querySelector('.alert-close');
        if (closeButton) {
            closeButton.addEventListener('click', () => {
                alert.classList.remove('show');
                setTimeout(() => {
                    alert.style.display = 'none';
                }, 300);
            });
        }
    }
    
    // Mostrar alerta
    alert.style.display = 'flex';
    setTimeout(() => {
        alert.classList.add('show');
    }, 10);
    
    // Ocultar automáticamente después de 3 segundos
    setTimeout(() => {
        alert.classList.remove('show');
        setTimeout(() => {
            alert.style.display = 'none';
        }, 300);
    }, 3000);
}

/**
 * Muestra el menú de contexto de una pestaña
 * @param {HTMLElement} tabElement - Elemento DOM de la pestaña
 * @param {Event} event - Evento que desencadenó la acción
 */
showTabContextMenu(tabElement, event) {
    const tabId = tabElement.getAttribute('data-tab-id');
    const tab = this.tabs.find(tab => tab.id === tabId);
    if (!tab) return;
    
    // Verificar si ya existe un menú de contexto y eliminarlo
    const existingMenu = document.getElementById('tab-context-menu');
    if (existingMenu) {
        existingMenu.remove();
    }
    
    // Crear menú de contexto
    const contextMenu = document.createElement('div');
    contextMenu.id = 'tab-context-menu';
    contextMenu.className = 'tab-context-menu';
    
    // Definir opciones del menú
    const menuItems = [
        {
            label: tab.pinned ? 'Dejar de fijar' : 'Fijar pestaña',
            icon: tab.pinned ? 'fa-thumbtack fa-rotate-90' : 'fa-thumbtack',
            action: () => this.togglePinTab(tabId),
            disabled: false
        },
        {
            label: 'Recargar',
            icon: 'fa-sync-alt',
            action: () => this.reloadTab(tabId),
            disabled: false
        },
        {
            label: 'Duplicar',
            icon: 'fa-clone',
            action: () => this.duplicateTab(tabId),
            disabled: this.tabs.length >= this.maxTabs
        },
        { type: 'separator' },
        {
            label: 'Cerrar',
            icon: 'fa-times',
            action: () => this.closeTab(tabId),
            disabled: !tab.closable
        },
        {
            label: 'Cerrar otras pestañas',
            icon: 'fa-times-circle',
            action: () => this.closeOtherTabs(tabId),
            disabled: !this.tabs.some(t => t.id !== tabId && t.closable)
        },
        {
            label: 'Cerrar pestañas a la derecha',
            icon: 'fa-angle-double-right',
            action: () => this.closeTabsToRight(tabId),
            disabled: !this.hasClosableTabsToRight(tabId)
        }
    ];
    
    // Generar elementos del menú
    menuItems.forEach(item => {
        if (item.type === 'separator') {
            const separator = document.createElement('div');
            separator.className = 'menu-separator';
            contextMenu.appendChild(separator);
            return;
        }
        
        const menuItem = document.createElement('div');
        menuItem.className = `menu-item ${item.disabled ? 'disabled' : ''}`;
        menuItem.innerHTML = `
            <i class="menu-icon fas ${item.icon}"></i>
            <span class="menu-text">${item.label}</span>
        `;
        
        if (!item.disabled) {
            menuItem.addEventListener('click', () => {
                item.action();
                contextMenu.remove();
            });
        }
        
        contextMenu.appendChild(menuItem);
    });
    
    // Posicionar y mostrar menú
    document.body.appendChild(contextMenu);
    
    // Calcular posición
    const rect = tabElement.getBoundingClientRect();
    const menuWidth = contextMenu.offsetWidth;
    const menuHeight = contextMenu.offsetHeight;
    
    // Posición por defecto (debajo del elemento)
    let top = rect.bottom + 5;
    let left = rect.left;
    
    // Ajustar si se sale de los límites de la ventana
    if (top + menuHeight > window.innerHeight) {
        top = rect.top - menuHeight - 5;
    }
    
    if (left + menuWidth > window.innerWidth) {
        left = window.innerWidth - menuWidth - 5;
    }
    
    contextMenu.style.top = `${top}px`;
    contextMenu.style.left = `${left}px`;
    
    // Animación de entrada
    setTimeout(() => {
        contextMenu.classList.add('show');
    }, 10);
    
    // Cerrar menú al hacer clic fuera
    const closeMenu = (e) => {
        if (!contextMenu.contains(e.target) && e.target !== tabElement) {
            contextMenu.classList.remove('show');
            
            setTimeout(() => {
                contextMenu.remove();
                document.removeEventListener('click', closeMenu);
            }, 200);
        }
    };
    
    // Retrasar para evitar que se cierre inmediatamente
    setTimeout(() => {
        document.addEventListener('click', closeMenu);
    }, 10);
}

/**
 * Comprueba si hay pestañas cerrables a la derecha de la pestaña especificada
 * @param {String} tabId - ID de la pestaña de referencia
 * @returns {Boolean} True si hay pestañas cerrables a la derecha
 */
hasClosableTabsToRight(tabId) {
    const tabIndex = this.tabs.findIndex(tab => tab.id === tabId);
    if (tabIndex === -1 || tabIndex === this.tabs.length - 1) return false;
    
    return this.tabs.slice(tabIndex + 1).some(tab => tab.closable);
}

/**
 * Muestra el menú para crear nuevas pestañas
 */
showTabsMenu() {
    // Verificar si ya existe un menú y eliminarlo
    const existingMenu = document.getElementById('new-tab-menu');
    if (existingMenu) {
        existingMenu.remove();
        return;
    }
    
    // Crear menú
    const tabsMenu = document.createElement('div');
    tabsMenu.id = 'new-tab-menu';
    tabsMenu.className = 'new-tab-menu';
    
    // Obtener lista de módulos disponibles
    const modules = this.getAvailableModules();
    
    // Filtrar módulos ya abiertos si no permiten múltiples instancias
    const filteredModules = modules.filter(module => {
        if (module.allowMultiple) return true;
        return !this.tabs.some(tab => tab.moduleId === module.id);
    });
    
    // Mostrar mensaje si no hay módulos disponibles
    if (filteredModules.length === 0) {
        tabsMenu.innerHTML = `
            <div class="menu-empty-message">
                <i class="fas fa-info-circle"></i>
                <span>No hay módulos disponibles para abrir</span>
            </div>
        `;
    } else {
        // Agrupar módulos por categoría
        const groupedModules = {};
        filteredModules.forEach(module => {
            if (!groupedModules[module.category]) {
                groupedModules[module.category] = [];
            }
            groupedModules[module.category].push(module);
        });
        
        // Campo de búsqueda
        const searchBox = document.createElement('div');
        searchBox.className = 'menu-search-box';
        searchBox.innerHTML = `
            <i class="fas fa-search search-icon"></i>
            <input type="text" placeholder="Buscar módulo..." class="search-input">
        `;
        tabsMenu.appendChild(searchBox);
        
        // Lista de módulos
        const modulesList = document.createElement('div');
        modulesList.className = 'modules-list';
        
        // Generar lista por categorías
        Object.keys(groupedModules).sort().forEach(category => {
            const categoryGroup = document.createElement('div');
            categoryGroup.className = 'module-category';
            categoryGroup.innerHTML = `
                <div class="category-header">
                    <span>${category}</span>
                </div>
            `;
            
            const categoryItems = document.createElement('div');
            categoryItems.className = 'category-items';
            
            // Ordenar módulos por nombre
            const sortedModules = groupedModules[category].sort((a, b) => 
                a.name.localeCompare(b.name)
            );
            
            // Añadir cada módulo
            sortedModules.forEach(module => {
                const moduleItem = document.createElement('div');
                moduleItem.className = 'module-item';
                moduleItem.setAttribute('data-module-id', module.id);
                moduleItem.setAttribute('data-module-name', module.name.toLowerCase());
                moduleItem.innerHTML = `
                    <span class="module-icon">${module.icon}</span>
                    <span class="module-name">${module.name}</span>
                `;
                
                // Event listener para clic
                moduleItem.addEventListener('click', () => {
                    this.openTab(module.id, module.url, module.name, {
                        icon: module.icon,
                        closable: true
                    });
                    tabsMenu.remove();
                });
                
                categoryItems.appendChild(moduleItem);
            });
            
            categoryGroup.appendChild(categoryItems);
            modulesList.appendChild(categoryGroup);
        });
        
        tabsMenu.appendChild(modulesList);
        
        // Configurar evento de búsqueda
        const searchInput = searchBox.querySelector('.search-input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const searchTerm = e.target.value.toLowerCase().trim();
                
                // Filtrar módulos según término de búsqueda
                modulesList.querySelectorAll('.module-item').forEach(item => {
                    const moduleName = item.getAttribute('data-module-name');
                    if (moduleName.includes(searchTerm) || searchTerm === '') {
                        item.style.display = '';
                    } else {
                        item.style.display = 'none';
                    }
                });
                
                // Mostrar/ocultar categorías vacías
                modulesList.querySelectorAll('.module-category').forEach(category => {
                    const hasVisibleItems = Array.from(
                        category.querySelectorAll('.module-item')
                    ).some(item => item.style.display !== 'none');
                    
                    category.style.display = hasVisibleItems ? '' : 'none';
                });
            });
            
            // Focus en el campo de búsqueda
            setTimeout(() => searchInput.focus(), 10);
        }
    }
    
    // Añadir al DOM
    document.body.appendChild(tabsMenu);
    
    // Posicionar menú
    const buttonRect = this.newTabButton.getBoundingClientRect();
    
    tabsMenu.style.top = `${buttonRect.bottom + 5}px`;
    tabsMenu.style.right = `${window.innerWidth - buttonRect.right}px`;
    
    // Animación de entrada
    setTimeout(() => {
        tabsMenu.classList.add('show');
    }, 10);
    
    // Cerrar menú al hacer clic fuera
    const closeMenu = (e) => {
        if (!tabsMenu.contains(e.target) && e.target !== this.newTabButton) {
            tabsMenu.classList.remove('show');
            
            setTimeout(() => {
                tabsMenu.remove();
                document.removeEventListener('click', closeMenu);
            }, 200);
        }
    };
    
    // Retrasar para evitar que se cierre inmediatamente
    setTimeout(() => {
        document.addEventListener('click', closeMenu);
    }, 10);
}

/**
 * Obtiene los módulos disponibles para abrir en pestañas
 * @returns {Array} Lista de módulos disponibles
 */
getAvailableModules() {
    // Esta función debe ser personalizada según la estructura del sistema
    // Aquí se muestra un ejemplo con datos estáticos
    
    return [
        {
            id: 'dashboard',
            name: 'Dashboard',
            url: '/app/views/dashboard.html',
            icon: '<i class="fas fa-tachometer-alt"></i>',
            category: 'Principal',
            allowMultiple: false
        },
        {
            id: 'facturador',
            name: 'Facturación',
            url: '/app/views/facturador.html',
            icon: '<i class="fas fa-file-invoice-dollar"></i>',
            category: 'Ventas',
            allowMultiple: true
        },
        {
            id: 'ventas',
            name: 'Gestión de Ventas',
            url: '/app/views/ventas.html',
            icon: '<i class="fas fa-shopping-cart"></i>',
            category: 'Ventas',
            allowMultiple: false
        },
        {
            id: 'compras',
            name: 'Compras',
            url: '/app/views/compras.html',
            icon: '<i class="fas fa-truck-loading"></i>',
            category: 'Compras',
            allowMultiple: false
        },
        {
            id: 'productos',
            name: 'Productos',
            url: '/app/views/productos.html',
            icon: '<i class="fas fa-box"></i>',
            category: 'Inventario',
            allowMultiple: false
        },
        {
            id: 'stock',
            name: 'Control de Stock',
            url: '/app/views/productos.html?tab=stock',
            icon: '<i class="fas fa-boxes"></i>',
            category: 'Inventario',
            allowMultiple: false
        },
        {
            id: 'clientes',
            name: 'Clientes',
            url: '/app/views/clientes.html',
            icon: '<i class="fas fa-users"></i>',
            category: 'Contactos',
            allowMultiple: false
        },
        {
            id: 'proveedores',
            name: 'Proveedores',
            url: '/app/views/proveedores.html',
            icon: '<i class="fas fa-truck"></i>',
            category: 'Contactos',
            allowMultiple: false
        },
        {
            id: 'caja',
            name: 'Caja',
            url: '/app/views/caja.html',
            icon: '<i class="fas fa-cash-register"></i>',
            category: 'Finanzas',
            allowMultiple: false
        },
        {
            id: 'reportes',
            name: 'Reportes',
            url: '/app/views/reportes.html',
            icon: '<i class="fas fa-chart-bar"></i>',
            category: 'Reportes',
            allowMultiple: false
        },
        {
            id: 'configuraciones',
            name: 'Configuraciones',
            url: '/app/views/configuraciones.html',
            icon: '<i class="fas fa-cogs"></i>',
            category: 'Sistema',
            allowMultiple: false
        },
        {
            id: 'usuarios',
            name: 'Usuarios',
            url: '/app/views/usuarios.html',
            icon: '<i class="fas fa-user-shield"></i>',
            category: 'Sistema',
            allowMultiple: false
        },
        {
            id: 'ayuda',
            name: 'Ayuda',
            url: '/app/views/ayuda.html',
            icon: '<i class="fas fa-question-circle"></i>',
            category: 'Soporte',
            allowMultiple: false
        }
    ];
}

/**
 * Obtiene el ícono para un módulo específico
 * @param {String} moduleId - ID del módulo
 * @returns {String} HTML del ícono
 */
getModuleIcon(moduleId) {
    const modules = this.getAvailableModules();
    const module = modules.find(m => m.id === moduleId);
    
    return module ? module.icon : '<i class="fas fa-window-maximize"></i>';
}

/**
 * Renderiza las pestañas en el DOM
 */
renderTabs() {
    if (!this.tabsList) return;
    
    // Limpiar contenido previo
    this.tabsList.innerHTML = '';
    
    // Renderizar cada pestaña
    this.tabs.forEach(tab => {
        const tabElement = document.createElement('div');
        tabElement.className = `tab-item ${tab.pinned ? 'pinned' : ''} ${tab.id === this.activeTabId ? 'active' : ''}`;
        tabElement.setAttribute('data-tab-id', tab.id);
        tabElement.setAttribute('draggable', !tab.pinned);
        
        // HTML de la pestaña
        tabElement.innerHTML = `
            <div class="tab-icon">${tab.icon}</div>
            <div class="tab-title" title="${tab.title}">${tab.title}</div>
            ${tab.closable ? '<button class="tab-close" title="Cerrar pestaña"><i class="fas fa-times"></i></button>' : ''}
            <button class="tab-menu-trigger" title="Más opciones"><i class="fas fa-ellipsis-v"></i></button>
        `;
        
        // Añadir al DOM
        this.tabsList.appendChild(tabElement);
    });
    
    // Calcular overflow
    this.handleTabsOverflow();
}

/**
 * Crea la pestaña por defecto (Dashboard)
 */
createDefaultTab() {
    this.tabs = [this.defaultTab];
    this.activeTabId = this.defaultTab.id;
    this.renderTabs();
    this.loadTabContent(this.defaultTab.id);
}

/**
 * Guarda el estado de las pestañas en sessionStorage
 */
saveTabsToStorage() {
    if (!window.sessionStorage) return;
    
    try {
        // Crear objeto para guardar
        const tabsState = {
            tabs: this.tabs,
            activeTabId: this.activeTabId
        };
        
        // Guardar en sessionStorage
        sessionStorage.setItem('factuSystem_tabs', JSON.stringify(tabsState));
    } catch (error) {
        console.error('Error al guardar pestañas en sessionStorage:', error);
    }
}

/**
 * Carga el estado de las pestañas desde sessionStorage
 * @returns {Boolean} True si se cargaron pestañas correctamente
 */
loadTabsFromStorage() {
    if (!window.sessionStorage) return false;
    
    try {
        // Obtener datos guardados
        const savedState = sessionStorage.getItem('factuSystem_tabs');
        if (!savedState) return false;
        
        // Parsear JSON
        const tabsState = JSON.parse(savedState);
        
        // Verificar validez
        if (!tabsState || !tabsState.tabs || !Array.isArray(tabsState.tabs) || tabsState.tabs.length === 0) {
            return false;
        }
        
        // Restaurar estado
        this.tabs = tabsState.tabs;
        this.activeTabId = tabsState.activeTabId;
        
        // Asegurarse de que exista al menos la pestaña por defecto
        if (!this.tabs.some(tab => tab.id === this.defaultTab.id)) {
            this.tabs.unshift(this.defaultTab);
        }
        
        // Si no hay pestaña activa, activar la primera
        if (!this.activeTabId || !this.tabs.some(tab => tab.id === this.activeTabId)) {
            this.activeTabId = this.tabs[0].id;
        }
        
        // Renderizar pestañas
        this.renderTabs();
        this.loadTabContent(this.activeTabId);
        
        return true;
    } catch (error) {
        console.error('Error al cargar pestañas desde sessionStorage:', error);
        return false;
    }
}

/**
 * Dispara un evento cuando cambia la pestaña activa
 * @param {String} tabId - ID de la pestaña activada
 */
dispatchTabChangeEvent(tabId) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;
    
    const event = new CustomEvent('tabchange', {
        detail: {
            tabId: tab.id,
            moduleId: tab.moduleId,
            title: tab.title,
            url: tab.url
        }
    });
    
    this.tabsContainer.dispatchEvent(event);
    document.dispatchEvent(event);
}

/**
 * Dispara un evento cuando se carga el contenido de una pestaña
 * @param {String} tabId - ID de la pestaña
 * @param {Object} tab - Datos de la pestaña
 */
dispatchContentLoadedEvent(tabId, tab) {
    const event = new CustomEvent('tabcontentloaded', {
        detail: {
            tabId: tab.id,
            moduleId: tab.moduleId,
            element: document.getElementById(`tab-content-${tabId}`)
        }
    });
    
    this.tabsContainer.dispatchEvent(event);
    document.dispatchEvent(event);
}
}

// Exportar la clase para uso en otros módulos
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TabsManager;
} else if (window) {
    window.FactuSystem = window.FactuSystem || {};
    window.FactuSystem.TabsManager = TabsManager;
}