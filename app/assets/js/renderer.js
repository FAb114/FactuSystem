document.addEventListener("DOMContentLoaded", () => {
    const showNotification = (message, type = "info", duration = 3000) => {
      const notification = document.createElement("div");
      notification.className = `notification ${type}`;
      notification.textContent = message;
      document.body.appendChild(notification);
      setTimeout(() => {
        notification.remove();
      }, duration);
    };
  
    // Mostrar estado de sincronización al cargar
    window.faktuSystem.sync.getSyncStatus().then(status => {
      console.log("Estado de sincronización:", status);
      if (status?.error) {
        showNotification("Sincronización fallida", "error");
      } else if (status?.pending) {
        showNotification("Datos pendientes de sincronizar", "warning");
      } else {
        showNotification("Sistema sincronizado", "success");
      }
    });
  
    // Teclas rápidas (F1 = ayuda, F2 = búsqueda producto, F12 = DevTools)
    document.addEventListener("keydown", (e) => {
      if (e.key === "F1") {
        e.preventDefault();
        window.faktuSystem.navigation.navigate("ayuda");
      }
      if (e.key === "F2") {
        e.preventDefault();
        const searchEvent = new CustomEvent("abrir-buscador-producto");
        document.dispatchEvent(searchEvent);
      }
      if (e.key === "F12") {
        e.preventDefault();
        window.faktuSystem.fileSystem.openDevTools?.();
      }
    });
  
    // Eventos personalizados para otras integraciones (modales, errores)
    window.addEventListener("error", (event) => {
      console.error("Error global:", event.error);
      showNotification("Se ha producido un error inesperado", "error");
      window.faktuSystem.audit.logEvent("error", event.error.message, {
        stack: event.error.stack
      });
    });
  
    // Eventos desde preload/main → ejemplo: notificación de pago
    if (window.electronAPI?.on) {
      window.electronAPI.on("pago-recibido", (event, { metodo, monto }) => {
        showNotification(`Pago recibido por ${metodo}: $${monto}`, "success", 5000);
      });
  
      window.electronAPI.on("backup-completo", () => {
        showNotification("Respaldo generado con éxito", "success");
      });
  
      window.electronAPI.on("impresion-fallida", (event, error) => {
        showNotification("Error al imprimir documento", "error");
        window.faktuSystem.audit.logEvent("error", "Impresión fallida", error);
      });
    }
  
    // Comunicación directa con otros componentes del sistema
    document.addEventListener("solicitar-backup", async () => {
      const result = await window.faktuSystem.backup.createBackup(true);
      if (result.success) {
        showNotification("Backup generado correctamente", "success");
      } else {
        showNotification("Error al crear backup", "error");
      }
    });
  
    document.addEventListener("solicitar-impresion", async (e) => {
      const { tipo, datos } = e.detail;
      const result = await window.faktuSystem.print.printDocument(tipo, datos);
      if (!result.success) {
        showNotification("Error al imprimir", "error");
      }
    });
  
    // Mostrar bienvenida
    window.faktuSystem.auth.getCurrentUser().then(user => {
      if (user?.username) {
        showNotification(`Bienvenido, ${user.username}`, "success", 3000);
      }
    });
  });
  