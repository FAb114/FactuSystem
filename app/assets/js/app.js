document.addEventListener("DOMContentLoaded", () => {
    const tabsContainer = document.getElementById("tabs-container");
    const viewContainer = document.getElementById("view-container");
    const sidebar = document.getElementById("sidebar");
    const currentModuleLabel = document.getElementById("current-module");
    const toggleSidebarBtn = document.getElementById("toggle-sidebar");
    const logoutBtn = document.getElementById("logout-btn");
    const modalContainer = document.getElementById("modal-container");
    const modalClose = document.getElementById("modal-close");
  
    const openTabs = new Map(); // id -> { tab, view }
  
    // Mostrar usuario activo
    window.faktuSystem.auth.getCurrentUser().then(user => {
      const userInfo = document.getElementById("user-info");
      if (user && user.username) {
        userInfo.textContent = user.username;
      }
    });
  
    // Alternar sidebar
    toggleSidebarBtn.addEventListener("click", () => {
      sidebar.classList.toggle("hidden");
    });
  
    // Logout
    logoutBtn.addEventListener("click", async () => {
      await window.faktuSystem.auth.logout();
      window.location = "login.html";
    });
  
    // Cierre de modal global
    if (modalClose) {
      modalClose.addEventListener("click", () => {
        modalContainer.classList.add("hidden");
      });
    }
  
    // Cargar módulos al hacer clic en el sidebar
    sidebar.querySelectorAll("li[data-module]").forEach(item => {
      item.addEventListener("click", () => {
        const module = item.dataset.module;
        openModule(module);
      });
    });
  
    // Función para abrir un módulo (si ya está abierto, lo activa)
    function openModule(moduleName) {
      if (openTabs.has(moduleName)) {
        activateTab(moduleName);
        return;
      }
  
      // Crear tab y vista
      const tab = document.createElement("div");
      tab.classList.add("tab");
      tab.textContent = formatTitle(moduleName);
      tab.dataset.module = moduleName;
  
      const closeBtn = document.createElement("span");
      closeBtn.innerHTML = "&times;";
      closeBtn.classList.add("close-tab");
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        closeModule(moduleName);
      });
  
      tab.appendChild(closeBtn);
      tab.addEventListener("click", () => activateTab(moduleName));
      tabsContainer.appendChild(tab);
  
      const view = document.createElement("div");
      view.classList.add("module-view");
      view.dataset.module = moduleName;
      viewContainer.appendChild(view);
  
      // Registrar en mapa de pestañas abiertas
      openTabs.set(moduleName, { tab, view });
  
      // Activar y cargar módulo
      activateTab(moduleName);
      loadModuleJS(moduleName);
    }
  
    // Activar tab y vista
    function activateTab(moduleName) {
      openTabs.forEach(({ tab, view }, key) => {
        const isActive = key === moduleName;
        tab.classList.toggle("active", isActive);
        view.classList.toggle("active", isActive);
      });
  
      currentModuleLabel.textContent = formatTitle(moduleName);
    }
  
    // Cerrar módulo y su pestaña
    function closeModule(moduleName) {
      const { tab, view } = openTabs.get(moduleName);
      tab.remove();
      view.remove();
      openTabs.delete(moduleName);
  
      // Activar el último tab restante si hay
      if (openTabs.size > 0) {
        const lastOpened = Array.from(openTabs.keys()).pop();
        activateTab(lastOpened);
      } else {
        currentModuleLabel.textContent = "Dashboard";
      }
    }
  
    // Cargar archivo JS del módulo dinámicamente
    function loadModuleJS(moduleName) {
      const script = document.createElement("script");
      script.src = `assets/js/modules/${moduleName}/index.js`;
      script.defer = true;
      script.onerror = () => {
        console.error(`No se pudo cargar el módulo: ${moduleName}`);
      };
      document.body.appendChild(script);
    }
  
    // Formatear nombre de módulo para mostrar
    function formatTitle(name) {
      return name
        .replace(/([A-Z])/g, " $1")
        .replace(/_/g, " ")
        .replace(/^./, str => str.toUpperCase());
    }
  
    // Escuchar eventos desde preload para navegación externa
    window.electronAPI?.on?.("navigate", (event, { route, params }) => {
      openModule(route);
      // Pasar params si se necesitan en el módulo
      const view = viewContainer.querySelector(`[data-module="${route}"]`);
      if (view && view.loadWithParams) {
        view.loadWithParams(params);
      }
    });
  });
  