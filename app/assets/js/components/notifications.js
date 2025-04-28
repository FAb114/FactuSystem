/**
 * notifications.js
 * Sistema de notificaciones para FactuSystem
 * 
 * Este componente maneja la lógica para mostrar diferentes tipos de notificaciones 
 * (éxito, error, advertencia, información) en la interfaz de usuario.
 * Incluye capacidades para:
 * - Mostrar notificaciones temporales tipo toast
 * - Notificaciones persistentes
 * - Alertas de sistema
 * - Notificaciones de sincronización
 * - Gestión de múltiples notificaciones simultáneas
 */

class NotificationSystem {
    constructor() {
        this.container = null;
        this.queue = [];
        this.maxVisibleNotifications = 5;
        this.visibleNotifications = 0;
        this.defaultDuration = 5000; // 5 segundos
        this.positions = {
            topRight: 'top-right',
            topLeft: 'top-left',
            bottomRight: 'bottom-right',
            bottomLeft: 'bottom-left',
            center: 'center'
        };
        this.defaultPosition = this.positions.topRight;
        this.eventListeners = {};
        
        this.types = {
            SUCCESS: 'success',
            ERROR: 'error',
            WARNING: 'warning',
            INFO: 'info',
            SYNC: 'sync',
            SYSTEM: 'system'
        };
        
        this.init();
    }
    
    /**
     * Inicializa el sistema de notificaciones creando el contenedor principal
     */
    init() {
        // Crear el contenedor principal de notificaciones si no existe
        if (!document.getElementById('factuSystem-notification-container')) {
            this.container = document.createElement('div');
            this.container.id = 'factuSystem-notification-container';
            this.container.className = 'notification-container';
            document.body.appendChild(this.container);
            
            // Crear contenedores para cada posición
            Object.values(this.positions).forEach(position => {
                const posContainer = document.createElement('div');
                posContainer.className = `notification-position ${position}`;
                posContainer.id = `notification-position-${position}`;
                this.container.appendChild(posContainer);
            });
            
            // Cargar estilos dinámicamente si no están ya incluidos
            this.loadStyles();
        } else {
            this.container = document.getElementById('factuSystem-notification-container');
        }
        
        // Suscribirse a eventos del sistema
        this.subscribeToSystemEvents();
    }
    
    /**
     * Carga los estilos CSS dinámicamente si no están ya incluidos
     */
    loadStyles() {
        if (!document.getElementById('factuSystem-notification-styles')) {
            const styles = document.createElement('style');
            styles.id = 'factuSystem-notification-styles';
            styles.textContent = `
                .notification-container {
                    position: fixed;
                    z-index: 9999;
                    pointer-events: none;
                    width: 100%;
                    height: 100%;
                    top: 0;
                    left: 0;
                    overflow: hidden;
                }
                
                .notification-position {
                    position: absolute;
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    max-width: 320px;
                    max-height: 100%;
                    overflow-y: auto;
                    pointer-events: none;
                }
                
                .notification-position.top-right {
                    top: 15px;
                    right: 15px;
                }
                
                .notification-position.top-left {
                    top: 15px;
                    left: 15px;
                }
                
                .notification-position.bottom-right {
                    bottom: 15px;
                    right: 15px;
                    flex-direction: column-reverse;
                }
                
                .notification-position.bottom-left {
                    bottom: 15px;
                    left: 15px;
                    flex-direction: column-reverse;
                }
                
                .notification-position.center {
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    align-items: center;
                }
                
                .notification {
                    width: 100%;
                    padding: 12px 15px;
                    border-radius: 6px;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                    display: flex;
                    align-items: flex-start;
                    gap: 12px;
                    animation: notification-slide-in 0.3s ease-out forwards;
                    pointer-events: auto;
                    transition: opacity 0.3s ease, transform 0.3s ease;
                    max-width: 100%;
                    box-sizing: border-box;
                }
                
                .notification.hide {
                    animation: notification-slide-out 0.3s forwards;
                }
                
                .notification-icon {
                    flex-shrink: 0;
                    width: 20px;
                    height: 20px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                
                .notification-content {
                    flex-grow: 1;
                    display: flex;
                    flex-direction: column;
                }
                
                .notification-title {
                    font-weight: bold;
                    margin-bottom: 4px;
                    font-size: 14px;
                }
                
                .notification-message {
                    font-size: 13px;
                    line-height: 1.4;
                }
                
                .notification-close {
                    flex-shrink: 0;
                    background: none;
                    border: none;
                    cursor: pointer;
                    width: 16px;
                    height: 16px;
                    padding: 0;
                    opacity: 0.7;
                    transition: opacity 0.2s;
                    font-size: 16px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: inherit;
                }
                
                .notification-close:hover {
                    opacity: 1;
                }
                
                .notification-progress {
                    position: absolute;
                    bottom: 0;
                    left: 0;
                    width: 100%;
                    height: 3px;
                    transform-origin: left;
                }
                
                .notification.success {
                    background-color: #e7f7ee;
                    border-left: 4px solid #28a745;
                    color: #0f5724;
                }
                
                .notification.error {
                    background-color: #fbe7e9;
                    border-left: 4px solid #dc3545;
                    color: #8b1522;
                }
                
                .notification.warning {
                    background-color: #fff8e6;
                    border-left: 4px solid #ffc107;
                    color: #856404;
                }
                
                .notification.info {
                    background-color: #e6f5ff;
                    border-left: 4px solid #0d6efd;
                    color: #084298;
                }
                
                .notification.sync {
                    background-color: #e6f5ff;
                    border-left: 4px solid #0dcaf0;
                    color: #055160;
                }
                
                .notification.system {
                    background-color: #efefef;
                    border-left: 4px solid #6c757d;
                    color: #343a40;
                }
                
                .notification.success .notification-progress {
                    background-color: #28a745;
                }
                
                .notification.error .notification-progress {
                    background-color: #dc3545;
                }
                
                .notification.warning .notification-progress {
                    background-color: #ffc107;
                }
                
                .notification.info .notification-progress {
                    background-color: #0d6efd;
                }
                
                .notification.sync .notification-progress {
                    background-color: #0dcaf0;
                }
                
                .notification.system .notification-progress {
                    background-color: #6c757d;
                }
                
                @keyframes notification-slide-in {
                    from {
                        transform: translateX(100%);
                        opacity: 0;
                    }
                    to {
                        transform: translateX(0);
                        opacity: 1;
                    }
                }
                
                @keyframes notification-slide-out {
                    from {
                        transform: translateX(0);
                        opacity: 1;
                    }
                    to {
                        transform: translateX(100%);
                        opacity: 0;
                    }
                }
                
                /* Para animaciones en otras posiciones */
                .top-left .notification {
                    animation: notification-slide-in-left 0.3s ease-out forwards;
                }
                
                .top-left .notification.hide {
                    animation: notification-slide-out-left 0.3s forwards;
                }
                
                @keyframes notification-slide-in-left {
                    from {
                        transform: translateX(-100%);
                        opacity: 0;
                    }
                    to {
                        transform: translateX(0);
                        opacity: 1;
                    }
                }
                
                @keyframes notification-slide-out-left {
                    from {
                        transform: translateX(0);
                        opacity: 1;
                    }
                    to {
                        transform: translateX(-100%);
                        opacity: 0;
                    }
                }
                
                /* Estilos para el centro */
                .center .notification {
                    animation: notification-fade-in 0.3s ease-out forwards;
                }
                
                .center .notification.hide {
                    animation: notification-fade-out 0.3s forwards;
                }
                
                @keyframes notification-fade-in {
                    from {
                        transform: translateY(-20px);
                        opacity: 0;
                    }
                    to {
                        transform: translateY(0);
                        opacity: 1;
                    }
                }
                
                @keyframes notification-fade-out {
                    from {
                        transform: translateY(0);
                        opacity: 1;
                    }
                    to {
                        transform: translateY(-20px);
                        opacity: 0;
                    }
                }
            `;
            document.head.appendChild(styles);
        }
    }
    
    /**
     * Suscribe el sistema de notificaciones a eventos del sistema
     */
    subscribeToSystemEvents() {
        // Eventos de sincronización
        window.addEventListener('sync-start', () => {
            this.showSync('Sincronización en progreso...', 'Actualizando datos con el servidor');
        });
        
        window.addEventListener('sync-complete', (event) => {
            if (event.detail && event.detail.success) {
                this.success('Sincronización completada', 'Los datos se han sincronizado correctamente');
            } else {
                this.error('Error de sincronización', 'No se pudo sincronizar con el servidor');
            }
        });
        
        // Eventos de autenticación
        window.addEventListener('auth-timeout', () => {
            this.warning('Sesión a punto de expirar', 'Su sesión expirará pronto. ¿Desea continuar?', {
                actions: [
                    {
                        text: 'Continuar sesión',
                        callback: () => {
                            // Llamar a la función para renovar la sesión desde auth.js
                            if (window.FactuSystem && window.FactuSystem.auth) {
                                window.FactuSystem.auth.renewSession();
                            }
                        }
                    }
                ],
                duration: 0 // Persistente hasta que se tome acción
            });
        });
        
        // Eventos de sistema
        window.addEventListener('update-available', () => {
            this.showSystem('Nueva actualización disponible', 'Hay una nueva versión de FactuSystem disponible', {
                actions: [
                    {
                        text: 'Actualizar ahora',
                        callback: () => {
                            // Llamar a la función para actualizar desde app.js
                            if (window.FactuSystem) {
                                window.FactuSystem.app.updateNow();
                            }
                        }
                    },
                    {
                        text: 'Más tarde',
                        callback: () => {}
                    }
                ],
                duration: 0 // Persistente hasta que se tome acción
            });
        });
        
        // Eventos de base de datos
        window.addEventListener('db-error', (event) => {
            const detail = event.detail || {};
            this.error('Error en la base de datos', detail.message || 'Se produjo un error en la base de datos');
        });
    }
    
    /**
     * Añade un evento personalizado al sistema de notificaciones
     * @param {string} eventName - Nombre del evento
     * @param {Function} callback - Función a ejecutar cuando ocurra el evento
     */
    on(eventName, callback) {
        if (!this.eventListeners[eventName]) {
            this.eventListeners[eventName] = [];
        }
        this.eventListeners[eventName].push(callback);
    }
    
    /**
     * Dispara un evento personalizado
     * @param {string} eventName - Nombre del evento
     * @param {any} data - Datos para pasar al callback
     */
    emit(eventName, data) {
        if (this.eventListeners[eventName]) {
            this.eventListeners[eventName].forEach(callback => {
                callback(data);
            });
        }
    }
    
    /**
     * Genera un ID único para cada notificación
     * @returns {string} - ID único
     */
    generateId() {
        return `notification-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    }
    
    /**
     * Muestra una notificación en la interfaz
     * @param {Object} options - Opciones de la notificación
     * @returns {string} - ID de la notificación
     */
    show(options) {
        const defaultOptions = {
            id: this.generateId(),
            title: '',
            message: '',
            type: this.types.INFO,
            duration: this.defaultDuration,
            position: this.defaultPosition,
            closable: true,
            actions: [],
            progress: true,
            onClose: null,
            onClick: null
        };
        
        const notifOptions = { ...defaultOptions, ...options };
        
        // Enqueue notification if too many are visible
        if (this.visibleNotifications >= this.maxVisibleNotifications) {
            this.queue.push(notifOptions);
            return notifOptions.id;
        }
        
        this.visibleNotifications++;
        
        // Get container for specified position
        const positionContainer = document.getElementById(`notification-position-${notifOptions.position}`);
        
        // Create notification element
        const notificationEl = document.createElement('div');
        notificationEl.className = `notification ${notifOptions.type}`;
        notificationEl.id = notifOptions.id;
        notificationEl.setAttribute('role', 'alert');
        
        // Create notification content
        let iconHtml = '';
        switch (notifOptions.type) {
            case this.types.SUCCESS:
                iconHtml = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>';
                break;
            case this.types.ERROR:
                iconHtml = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>';
                break;
            case this.types.WARNING:
                iconHtml = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>';
                break;
            case this.types.INFO:
                iconHtml = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>';
                break;
            case this.types.SYNC:
                iconHtml = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>';
                break;
            case this.types.SYSTEM:
                iconHtml = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M15 9H9v6h6V9zm-2 4h-2v-2h2v2zm8-2V9h-2V7c0-1.1-.9-2-2-2h-2V3h-2v2h-2V3H9v2H7c-1.1 0-2 .9-2 2v2H3v2h2v2H3v2h2v2c0 1.1.9 2 2 2h2v2h2v-2h2v2h2v-2h2c1.1 0 2-.9 2-2v-2h2v-2h-2v-2h2zm-4 6H7V7h10v10z"/></svg>';
                break;
        }
        
        let actionsHtml = '';
        if (notifOptions.actions && notifOptions.actions.length) {
            actionsHtml = '<div class="notification-actions">';
            notifOptions.actions.forEach((action, index) => {
                actionsHtml += `<button type="button" class="notification-action-btn" data-action-index="${index}">${action.text}</button>`;
            });
            actionsHtml += '</div>';
        }
        
        let contentHtml = `
            <div class="notification-icon">${iconHtml}</div>
            <div class="notification-content">
                ${notifOptions.title ? `<div class="notification-title">${notifOptions.title}</div>` : ''}
                ${notifOptions.message ? `<div class="notification-message">${notifOptions.message}</div>` : ''}
                ${actionsHtml}
            </div>
        `;
        
        if (notifOptions.closable) {
            contentHtml += `
                <button type="button" class="notification-close" aria-label="Cerrar">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>
                    </svg>
                </button>
            `;
        }
        
        if (notifOptions.progress && notifOptions.duration > 0) {
            contentHtml += `<div class="notification-progress"></div>`;
        }
        
        notificationEl.innerHTML = contentHtml;
        
        // Add to DOM
        positionContainer.appendChild(notificationEl);
        
        // Setup event listeners
        if (notifOptions.closable) {
            const closeBtn = notificationEl.querySelector('.notification-close');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => {
                    this.close(notifOptions.id);
                });
            }
        }
        
        if (notifOptions.onClick) {
            notificationEl.addEventListener('click', (e) => {
                // Don't trigger onClick if clicking on action buttons or close button
                if (!e.target.closest('.notification-action-btn') && !e.target.closest('.notification-close')) {
                    notifOptions.onClick();
                }
            });
        }
        
        // Setup action buttons
        if (notifOptions.actions && notifOptions.actions.length) {
            const actionButtons = notificationEl.querySelectorAll('.notification-action-btn');
            actionButtons.forEach(btn => {
                btn.addEventListener('click', () => {
                    const actionIndex = parseInt(btn.getAttribute('data-action-index'));
                    if (notifOptions.actions[actionIndex] && typeof notifOptions.actions[actionIndex].callback === 'function') {
                        notifOptions.actions[actionIndex].callback();
                    }
                    // Close notification after action unless specified
                    if (notifOptions.actions[actionIndex].closeOnClick !== false) {
                        this.close(notifOptions.id);
                    }
                });
            });
        }
        
        // Setup progress animation
        if (notifOptions.progress && notifOptions.duration > 0) {
            const progressBar = notificationEl.querySelector('.notification-progress');
            if (progressBar) {
                progressBar.style.animation = `notification-progress ${notifOptions.duration / 1000}s linear forwards`;
                progressBar.style.animationPlayState = 'running';
                
                // Pause animation on hover
                notificationEl.addEventListener('mouseenter', () => {
                    if (progressBar) {
                        progressBar.style.animationPlayState = 'paused';
                    }
                });
                
                notificationEl.addEventListener('mouseleave', () => {
                    if (progressBar) {
                        progressBar.style.animationPlayState = 'running';
                    }
                });
            }
        }
        
        // Auto close after duration
        if (notifOptions.duration > 0) {
            setTimeout(() => {
                this.close(notifOptions.id);
            }, notifOptions.duration);
        }
        
        this.emit('show', { id: notifOptions.id, options: notifOptions });
        return notifOptions.id;
    }
    
    /**
     * Cierra una notificación específica
     * @param {string} id - ID de la notificación a cerrar
     */
    close(id) {
        const notification = document.getElementById(id);
        if (!notification) return;
        
        // Add hide class for animation
        notification.classList.add('hide');
        
        // Remove from DOM after animation
        setTimeout(() => {
            if (notification && notification.parentNode) {
                notification.parentNode.removeChild(notification);
                this.visibleNotifications--;
                
                // Process queue if there are pending notifications
                if (this.queue.length > 0 && this.visibleNotifications < this.maxVisibleNotifications) {
                    const next = this.queue.shift();
                    this.show(next);
                }
                
                // Find corresponding options and call onClose if available
                const onClose = notification.onClose;
                if (typeof onClose === 'function') {
                    onClose();
                }
                
                this.emit('close', { id });
            }
        }, 300); // Match the animation duration
    }
    
    /**
     * Cierra todas las notificaciones activas
     */
    closeAll() {
        const notifications = this.container.querySelectorAll('.notification');
        notifications.forEach(notification => {
            this.close(notification.id);
        });
        
        // Clear queue
        this.queue = [];
        this.emit('closeAll');
    }
    
    /**
     * Muestra una notificación de éxito
     * @param {string} title - Título de la notificación
     * @param {string} message - Mensaje de la notificación
     * @param {Object} options - Opciones adicionales
     * @returns {string} - ID de la notificación
     */
    success(title, message, options = {}) {
        return this.show({
            title,
            message,
            type: this.types.SUCCESS,
            ...options
        });
    }
    
    /**
     * Muestra una notificación de error
     * @param {string} title - Título de la notificación
     * @param {string} message - Mensaje de la notificación
     * @param {Object} options - Opciones adicionales
     * @returns {string} - ID de la notificación
     */
    error(title, message, options = {}) {
        return this.show({
            title,
            message,
            type: this.types.ERROR,
            duration: 0, // Errores persistentes por defecto
            ...options
        });
    }
    
    /**
     * Muestra una notificación de advertencia
     * @param {string} title - Título de la notificación
     * @param {string} message - Mensaje de la notificación
     * @param {Object} options - Opciones adicionales
     * @returns {string} - ID de la notificación
     */
    warning(title, message, options = {}) {
        return this.show({
            title,
            message,
            type: this.types.WARNING,
            ...options
        });
    }
    
    /**
     * Muestra una notificación informativa
     * @param {string} title - Título de la notificación
     * @param {string} message - Mensaje de la notificación
     * @param {Object} options - Opciones adicionales
     * @returns {string} - ID de la notificación
     */
    info(title, message, options = {}) {
        return this.show({
            title,
            message,
            type: this.types.INFO,
            ...options
        });
    }
    
    /**
     * Muestra una notificación de sincronización
     * @param {string} title - Título de la notificación
     * @param {string} message - Mensaje de la notificación
     * @param {Object} options - Opciones adicionales
     * @returns {string} - ID de la notificación
     */
    showSync(title, message, options = {}) {
        return this.show({
            title,
            message,
            type: this.types.SYNC,
            ...options
        });
    }
    
    /**
     * Muestra una notificación de sistema
     * @param {string} title - Título de la notificación
     * @param {string} message - Mensaje de la notificación
     * @param {Object} options - Opciones adicionales
     * @returns {string} - ID de la notificación
     */
    showSystem(title, message, options = {}) {
        return this.show({
            title,
            message,
            type: this.types.SYSTEM,
            ...options
        });
    }
    
    /**
     * Comprueba si hay una notificación con el ID especificado
     * @param {string} id - ID de la notificación
     * @returns {boolean} - True si existe, false si no
     */
    exists(id) {
        return !!document.getElementById(id);
    }
    
    /**
     * Actualiza una notificación existente
     * @param {string} id - ID de la notificación
     * @param {Object} options - Opciones a actualizar
     * @returns {boolean} - True si se actualizó, false si no existe
     */
    update(id, options = {}) {
        const notification = document.getElementById(id);
        if (!notification) return false;
        
        if (options.title) {
            const titleEl = notification.querySelector('.notification-title');
            if (titleEl) {
                titleEl.textContent = options.title;
            }
        }
        
        if (options.message) {
            const messageEl = notification.querySelector('.notification-message');
            if (messageEl) {
                messageEl.textContent = options.message;
            }
        }
        
        if (options.type && options.type !== notification.getAttribute('data-type')) {
            // Cambiar tipo de notificación
            const oldType = notification.getAttribute('data-type');
            notification.classList.remove(oldType);
            notification.classList.add(options.type);
            notification.setAttribute('data-type', options.type);
        }
        
        this.emit('update', { id, options });
        return true;
    }
    
    /**
     * Muestra un mensaje de confirmación
     * @param {string} title - Título de la confirmación
     * @param {string} message - Mensaje de la confirmación
     * @param {Function} onConfirm - Callback al confirmar
     * @param {Function} onCancel - Callback al cancelar
     * @param {Object} options - Opciones adicionales
     * @returns {string} - ID de la notificación
     */
    confirm(title, message, onConfirm, onCancel, options = {}) {
        return this.show({
            title,
            message,
            type: options.type || this.types.INFO,
            duration: 0, // No auto-close
            actions: [
                {
                    text: options.confirmText || 'Confirmar',
                    callback: onConfirm
                },
                {
                    text: options.cancelText || 'Cancelar',
                    callback: onCancel
                }
            ],
            ...options
        });
    }
    
    /**
     * Muestra una notificación de progreso con una barra actualizable
     * @param {string} title - Título de la notificación
     * @param {string} message - Mensaje inicial
     * @param {Object} options - Opciones adicionales
     * @returns {Object} - Objeto con métodos para actualizar la notificación
     */
    progress(title, message, options = {}) {
        const id = this.generateId();
        const defaultOptions = {
            type: this.types.INFO,
            duration: 0, // No auto-close para progress
            progress: false, // Desactivar la barra de progreso automática
            closable: true,
            position: this.defaultPosition
        };
        
        const notifOptions = { ...defaultOptions, ...options };
        
        // Crear el elemento
        const notifOptions2 = {
            id,
            title,
            message,
            ...notifOptions
        };
        
        this.show(notifOptions2);
        
        // Crear un elemento de progreso personalizado
        setTimeout(() => {
            const notification = document.getElementById(id);
            if (notification) {
                const progressContainer = document.createElement('div');
                progressContainer.className = 'notification-custom-progress-container';
                progressContainer.style.width = '100%';
                progressContainer.style.height = '6px';
                progressContainer.style.backgroundColor = 'rgba(0,0,0,0.1)';
                progressContainer.style.borderRadius = '3px';
                progressContainer.style.overflow = 'hidden';
                progressContainer.style.marginTop = '8px';
                
                const progressBar = document.createElement('div');
                progressBar.className = 'notification-custom-progress-bar';
                progressBar.style.height = '100%';
                progressBar.style.width = '0%';
                progressBar.style.backgroundColor = options.progressColor || '#0d6efd';
                progressBar.style.transition = 'width 0.3s ease';
                
                progressContainer.appendChild(progressBar);
                
                const content = notification.querySelector('.notification-content');
                if (content) {
                    content.appendChild(progressContainer);
                }
            }
        }, 10);
        
        // Devolver un controlador para actualizar el progreso
        return {
            id,
            /**
             * Actualiza el progreso de la notificación
             * @param {number} percent - Porcentaje de progreso (0-100)
             * @param {string} message - Nuevo mensaje opcional
             * @returns {Object} - La instancia del controlador
             */
            update: (percent, message) => {
                const notification = document.getElementById(id);
                if (notification) {
                    // Actualizar la barra de progreso
                    const progressBar = notification.querySelector('.notification-custom-progress-bar');
                    if (progressBar) {
                        progressBar.style.width = `${Math.min(Math.max(0, percent), 100)}%`;
                    }
                    
                    // Actualizar mensaje si se proporciona
                    if (message) {
                        const messageEl = notification.querySelector('.notification-message');
                        if (messageEl) {
                            messageEl.textContent = message;
                        }
                    }
                }
                return this;
            },
            /**
             * Marca el progreso como completado
             * @param {string} completeMessage - Mensaje de finalización
             * @param {Object} completeOptions - Opciones para la notificación de finalización
             */
            complete: (completeMessage, completeOptions = {}) => {
                // Cerrar la notificación de progreso
                this.close(id);
                
                // Mostrar notificación de éxito
                if (completeMessage) {
                    this.success(title, completeMessage, {
                        duration: this.defaultDuration,
                        ...completeOptions
                    });
                }
            },
            /**
             * Marca el progreso como fallido
             * @param {string} errorMessage - Mensaje de error
             * @param {Object} errorOptions - Opciones para la notificación de error
             */
            error: (errorMessage, errorOptions = {}) => {
                // Cerrar la notificación de progreso
                this.close(id);
                
                // Mostrar notificación de error
                if (errorMessage) {
                    this.error(title, errorMessage, {
                        duration: this.defaultDuration,
                        ...errorOptions
                    });
                }
            },
            /**
             * Cierra la notificación de progreso
             */
            close: () => {
                this.close(id);
            }
        };
    }
    
    /**
     * Muestra un mensaje de procesamiento/carga (spinner)
     * @param {string} title - Título de la notificación
     * @param {string} message - Mensaje de la notificación
     * @param {Object} options - Opciones adicionales
     * @returns {Object} - Controlador con método para detener el spinner
     */
    loading(title, message, options = {}) {
        const id = this.generateId();
        const spinnerHtml = `
            <div class="notification-spinner" style="
                display: inline-block;
                width: 20px;
                height: 20px;
                border: 2px solid rgba(0,0,0,0.1);
                border-radius: 50%;
                border-top-color: currentColor;
                animation: notification-spinner 0.8s linear infinite;
            "></div>
            <style>
                @keyframes notification-spinner {
                    to {transform: rotate(360deg);}
                }
            </style>
        `;
        
        // Reemplazar el icono normal con el spinner
        const notifOptions = {
            id,
            title,
            message,
            type: options.type || this.types.INFO,
            duration: 0, // No auto-close
            closable: options.closable !== undefined ? options.closable : false,
            customIcon: spinnerHtml,
            ...options
        };
        
        this.show({
            ...notifOptions,
            // Sobreescribir el HTML normal
            customHtml: `
                <div class="notification-icon">${spinnerHtml}</div>
                <div class="notification-content">
                    ${notifOptions.title ? `<div class="notification-title">${notifOptions.title}</div>` : ''}
                    ${notifOptions.message ? `<div class="notification-message">${notifOptions.message}</div>` : ''}
                </div>
                ${notifOptions.closable ? `
                    <button type="button" class="notification-close" aria-label="Cerrar">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>
                        </svg>
                    </button>
                ` : ''}
            `
        });
        
        // Devolver controlador
        return {
            id,
            /**
             * Actualiza el mensaje del indicador de carga
             * @param {string} newMessage - Nuevo mensaje
             */
            updateMessage: (newMessage) => {
                const notification = document.getElementById(id);
                if (notification) {
                    const messageEl = notification.querySelector('.notification-message');
                    if (messageEl) {
                        messageEl.textContent = newMessage;
                    }
                }
            },
            /**
             * Finaliza el spinner y muestra un mensaje de éxito
             * @param {string} successMessage - Mensaje de éxito
             * @param {Object} successOptions - Opciones para notificación de éxito
             */
            success: (successMessage, successOptions = {}) => {
                this.close(id);
                if (successMessage) {
                    this.success(title, successMessage, {
                        duration: this.defaultDuration,
                        ...successOptions
                    });
                }
            },
            /**
             * Finaliza el spinner y muestra un mensaje de error
             * @param {string} errorMessage - Mensaje de error
             * @param {Object} errorOptions - Opciones para notificación de error
             */
            error: (errorMessage, errorOptions = {}) => {
                this.close(id);
                if (errorMessage) {
                    this.error(title, errorMessage, {
                        duration: this.defaultDuration,
                        ...errorOptions
                    });
                }
            },
            /**
             * Cierra la notificación de carga
             */
            close: () => {
                this.close(id);
            }
        };
    }
    
    /**
     * Muestra un tostado simple con texto
     * @param {string} message - Mensaje a mostrar
     * @param {Object} options - Opciones adicionales
     * @returns {string} - ID de la notificación
     */
    toast(message, options = {}) {
        return this.show({
            message,
            title: '',
            type: options.type || this.types.INFO,
            closable: options.closable !== undefined ? options.closable : true,
            duration: options.duration || 3000,
            position: options.position || this.positions.bottomLeft,
            ...options
        });
    }
    
    /**
     * Método para integrar con el módulo logger
     * Muestra una notificación y registra en el log al mismo tiempo
     * @param {string} title - Título del mensaje
     * @param {string} message - Contenido del mensaje
     * @param {string} level - Nivel de log ('info', 'warn', 'error')
     * @param {Object} options - Opciones adicionales
     * @returns {string} - ID de la notificación
     */
    logAndNotify(title, message, level = 'info', options = {}) {
        // Mapeo de niveles de log a tipos de notificación
        const logLevelToType = {
            'info': this.types.INFO,
            'warn': this.types.WARNING,
            'error': this.types.ERROR,
            'success': this.types.SUCCESS
        };
        
        // Registrar en el log
        if (window.FactuSystem && window.FactuSystem.logger) {
            window.FactuSystem.logger.log(level, `${title}: ${message}`);
        }
        
        // Mostrar notificación
        return this.show({
            title,
            message,
            type: logLevelToType[level] || this.types.INFO,
            ...options
        });
    }
    
    /**
     * Establece la posición predeterminada para las notificaciones
     * @param {string} position - Posición ('topRight', 'topLeft', 'bottomRight', 'bottomLeft', 'center')
     */
    setDefaultPosition(position) {
        if (this.positions[position]) {
            this.defaultPosition = this.positions[position];
        }
    }
    
    /**
     * Establece la duración predeterminada para las notificaciones
     * @param {number} duration - Duración en milisegundos
     */
    setDefaultDuration(duration) {
        if (typeof duration === 'number' && duration >= 0) {
            this.defaultDuration = duration;
        }
    }
    
    /**
     * Establece el número máximo de notificaciones visibles
     * @param {number} max - Número máximo
     */
    setMaxVisibleNotifications(max) {
        if (typeof max === 'number' && max > 0) {
            this.maxVisibleNotifications = max;
        }
    }
}

// Crear una instancia global
const notifications = new NotificationSystem();

// Exportar la instancia y la clase
export { notifications as default, NotificationSystem };

// Para compatibilidad con otros módulos que no usen ES modules
if (typeof window !== 'undefined') {
    // Añadir al namespace global de FactuSystem
    if (!window.FactuSystem) {
        window.FactuSystem = {};
    }
    
    window.FactuSystem.notifications = notifications;
}