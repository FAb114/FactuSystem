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