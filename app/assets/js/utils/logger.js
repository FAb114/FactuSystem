const Logger = (() => {
    const LEVELS = {
      INFO: "info",
      SUCCESS: "success",
      WARNING: "warning",
      ERROR: "error",
      DEBUG: "debug"
    };
  
    const log = async (level, message, context = {}) => {
      const timestamp = new Date().toISOString();
  
      const logEntry = {
        level,
        message,
        context,
        timestamp
      };
  
      // Mostrar en consola (opcional)
      console[level === "error" ? "error" : "log"](`[${level.toUpperCase()}] ${message}`, context);
  
      // Enviar al sistema de auditoría (back o local)
      try {
        await window.faktuSystem.audit.logEvent(level, message, context);
      } catch (err) {
        console.warn("No se pudo registrar el log en auditoría:", err.message);
      }
    };
  
    return {
      info: (msg, ctx) => log(LEVELS.INFO, msg, ctx),
      success: (msg, ctx) => log(LEVELS.SUCCESS, msg, ctx),
      warning: (msg, ctx) => log(LEVELS.WARNING, msg, ctx),
      error: (msg, ctx) => log(LEVELS.ERROR, msg, ctx),
      debug: (msg, ctx) => log(LEVELS.DEBUG, msg, ctx),
      custom: log // permite usar niveles personalizados si se necesita
    };
  })();
  
  export default Logger;
  