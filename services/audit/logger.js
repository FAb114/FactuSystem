const fs = require("fs");
const path = require("path");
const os = require("os");

const LOG_FILE = path.join(__dirname, "..", "..", "logs", "audit.log");

// Asegura que la carpeta logs exista
if (!fs.existsSync(path.dirname(LOG_FILE))) {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
}

const Logger = {
  /**
   * Guarda un evento de auditoría
   * @param {string} level - Nivel del evento: info, warning, error, success, debug
   * @param {string} message - Descripción del evento
   * @param {object} details - Información adicional del evento
   * @returns {Promise<boolean>}
   */
  async logEvent(level = "info", message = "", details = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      user: details?.usuario || "sistema",
      module: details?.modulo || "general",
      context: details || {}
    };

    try {
      const logLine = JSON.stringify(logEntry) + os.EOL;
      fs.appendFileSync(LOG_FILE, logLine, "utf8");
      return true;
    } catch (err) {
      console.error("Error al guardar log de auditoría:", err);
      return false;
    }
  },

  /**
   * Devuelve todos los logs almacenados
   * @returns {Promise<array>}
   */
  async getAllLogs() {
    try {
      const data = fs.readFileSync(LOG_FILE, "utf8");
      return data
        .split(os.EOL)
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } catch (err) {
      console.error("No se pudieron leer los logs:", err);
      return [];
    }
  },

  /**
   * Filtra logs por fecha, nivel, usuario, módulo, etc.
   * @param {object} filtros
   * @returns {Promise<array>}
   */
  async filterLogs({ desde, hasta, nivel, usuario, modulo } = {}) {
    const logs = await this.getAllLogs();
    return logs.filter((entry) => {
      const fecha = new Date(entry.timestamp);
      if (desde && fecha < new Date(desde)) return false;
      if (hasta && fecha > new Date(hasta)) return false;
      if (nivel && entry.level !== nivel) return false;
      if (usuario && entry.user !== usuario) return false;
      if (modulo && entry.module !== modulo) return false;
      return true;
    });
  }
};

module.exports = Logger;
