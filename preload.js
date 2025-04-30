// preload.js
const { contextBridge, ipcRenderer } = require('electron');

// Exponer métodos protegidos que permiten al proceso de renderizado
// usar ipcRenderer sin exponer el objeto completo
contextBridge.exposeInMainWorld(
  'api', {
    // Enviar mensajes al proceso principal
    send: (channel, data) => {
      // Lista blanca de canales permitidos
      const validChannels = [
        'guardar-cliente', 
        'cargar-clientes',
        'guardar-producto',
        'cargar-productos',
        'guardar-factura',
        'cargar-facturas',
        'seleccionar-directorio'
      ];
      
      if (validChannels.includes(channel)) {
        ipcRenderer.send(channel, data);
      }
    },
    
    // Recibir mensajes desde el proceso principal
    receive: (channel, func) => {
      const validChannels = [
        'cliente-guardado',
        'clientes-cargados',
        'producto-guardado',
        'productos-cargados',
        'factura-guardada',
        'facturas-cargadas',
        'directorio-seleccionado'
      ];
      
      if (validChannels.includes(channel)) {
        // Eliminar intencionadamente el evento ya que incluye 'sender'
        ipcRenderer.on(channel, (event, ...args) => func(...args));
      }
    },
    
    // Método de conveniencia para eliminar listeners
    removeAllListeners: (channel) => {
      const validChannels = [
        'cliente-guardado',
        'clientes-cargados',
        'producto-guardado',
        'productos-cargados',
        'factura-guardada',
        'facturas-cargadas',
        'directorio-seleccionado'
      ];
      
      if (validChannels.includes(channel)) {
        ipcRenderer.removeAllListeners(channel);
      }
    }
  }
);
// Añade este código al final de preload.js

// Comprobar si estamos en un entorno Electron
const isElectron = () => {
  return window && window.process && window.process.type === 'renderer';
};

// Exponer funciones de diagnóstico al proceso de renderizado
if (isElectron()) {
  // Asegurarse de que las API de Electron están disponibles
  try {
      window.electronAPI = {
          isElectronAvailable: true,
          nodeVersion: process.versions.node,
          electronVersion: process.versions.electron,
          chromeVersion: process.versions.chrome,
          diagnostics: {
              checkFS: async (path) => {
                  try {
                      const fs = require('fs');
                      const result = await fs.promises.readdir(path);
                      return { success: true, files: result };
                  } catch (error) {
                      return { success: false, error: error.message };
                  }
              }
          }
      };
      
      console.log('Electron API expuesta en preload.js:', window.electronAPI);
  } catch (error) {
      console.error('Error al configurar API de Electron:', error);
      window.electronAPI = {
          isElectronAvailable: false,
          error: error.message
      };
  }
} else {
  console.warn('No estamos en un entorno Electron');
  window.electronAPI = {
      isElectronAvailable: false
  };
}

// Notificar que preload.js se ha ejecutado completamente
console.log('preload.js cargado completamente');
window.preloadComplete = true;