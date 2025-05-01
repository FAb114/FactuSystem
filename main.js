const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const url = require('url');

// Mantener referencias globales de las ventanas activas
const windows = {
  main: null,
  modules: {}
};

// Configuración de la aplicación
const appConfig = {
  minWidth: 1024,
  minHeight: 768,
  icon: path.join(__dirname, 'app/assets/img/logo.png')
};

// Crear la ventana principal
function createMainWindow() {
  windows.main = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: appConfig.minWidth,
    minHeight: appConfig.minHeight,
    icon: appConfig.icon,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    show: false, // No mostrar hasta que esté lista
    backgroundColor: '#f5f6fa' // Color de fondo durante la carga
  });

  // Cargar el archivo index.html
  windows.main.loadFile(path.join(__dirname, 'app/index.html'));

  // Mostrar una vez que esté lista
  windows.main.once('ready-to-show', () => {
    windows.main.show();
    windows.main.maximize();
  });

  // Cerrar todas las ventanas de módulos al cerrar la principal
  windows.main.on('closed', () => {
    for (const moduleId in windows.modules) {
      if (windows.modules[moduleId] && !windows.modules[moduleId].isDestroyed()) {
        windows.modules[moduleId].close();
      }
    }
    windows.main = null;
  });

  // Menú de desarrollo en modo desarrollo
  if (process.env.NODE_ENV === 'development') {
    windows.main.webContents.openDevTools();
  }

  // Configurar el menú de la aplicación
  createApplicationMenu();
}

// Crear ventana para un módulo específico
function createModuleWindow(moduleId) {
  // Verificar si la ventana ya existe y está abierta
  if (windows.modules[moduleId] && !windows.modules[moduleId].isDestroyed()) {
    windows.modules[moduleId].focus();
    return;
  }

  // Configuración de las ventanas de módulos
  const moduleConfig = {
    facturador: {
      title: 'FactuSystem - Facturador',
      width: 1200,
      height: 800,
      file: 'views/facturador.html'
    },
    ventas: {
      title: 'FactuSystem - Ventas',
      width: 1100,
      height: 750,
      file: 'views/ventas.html'
    },
    compras: {
      title: 'FactuSystem - Compras',
      width: 1100,
      height: 750,
      file: 'views/compras.html'
    },
    inventario: {
      title: 'FactuSystem - Inventario',
      width: 1100,
      height: 750,
      file: 'views/productos.html'
    },
    clientes: {
      title: 'FactuSystem - Clientes',
      width: 1000,
      height: 700,
      file: 'views/clientes.html'
    },
    proveedores: {
      title: 'FactuSystem - Proveedores',
      width: 1000,
      height: 700,
      file: 'views/proveedores.html'
    },
    usuarios: {
      title: 'FactuSystem - Usuarios',
      width: 1000,
      height: 700,
      file: 'views/usuarios.html'
    },
    caja: {
      title: 'FactuSystem - Caja',
      width: 1000,
      height: 700,
      file: 'views/caja.html'
    },
    reportes: {
      title: 'FactuSystem - Reportes',
      width: 1100,
      height: 750,
      file: 'views/reportes.html'
    },
    cuotificador: {
      title: 'FactuSystem - Cuotificador',
      width: 1000,
      height: 700,
      file: 'views/cuotificador.html'
    },
    documentos: {
      title: 'FactuSystem - Documentos',
      width: 1000,
      height: 700,
      file: 'views/documentos.html'
    },
    configuraciones: {
      title: 'FactuSystem - Configuración',
      width: 1000,
      height: 700,
      file: 'views/configuraciones.html'
    },
    sucursales: {
      title: 'FactuSystem - Sucursales',
      width: 1100,
      height: 750,
      file: 'views/sucursales.html'
    },
    ayuda: {
      title: 'FactuSystem - Ayuda',
      width: 1000,
      height: 700,
      file: 'views/ayuda.html'
    }
    
  };

  // Verificar si el módulo está configurado
  if (!moduleConfig[moduleId]) {
    console.error(`Módulo no configurado: ${moduleId}`);
    return;
  }

  const config = moduleConfig[moduleId];
  const moduleFilePath = path.join(__dirname, 'app', config.file);

  // Verificar si el archivo del módulo existe
  if (!fs.existsSync(moduleFilePath)) {
    console.error(`Archivo del módulo no encontrado: ${moduleFilePath}`);
    return;
  }

  // Crear la ventana del módulo
  windows.modules[moduleId] = new BrowserWindow({
    title: config.title,
    width: config.width,
    height: config.height,
    minWidth: appConfig.minWidth,
    minHeight: appConfig.minHeight,
    icon: appConfig.icon,
    parent: windows.main, // Ventana principal como padre
    modal: false, // No modal para permitir interacción con otras ventanas
    webPreferences: {
      nodeIntegration: true, 
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    show: false
  });

  // Cargar el archivo HTML del módulo
  windows.modules[moduleId].loadFile(moduleFilePath);

  // Mostrar cuando esté listo
  windows.modules[moduleId].once('ready-to-show', () => {
    windows.modules[moduleId].show();
  });

  // Limpiar la referencia cuando se cierre
  windows.modules[moduleId].on('closed', () => {
    windows.modules[moduleId] = null;
  });

  // Abrir DevTools en modo desarrollo
  if (process.env.NODE_ENV === 'development') {
    windows.modules[moduleId].webContents.openDevTools();
  }
}

// Crear el menú de la aplicación
function createApplicationMenu() {
  const template = [
    {
      label: 'Archivo',
      submenu: [
        {
          label: 'Dashboard',
          click: () => {
            if (windows.main) {
              windows.main.focus();
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Facturador',
          click: () => createModuleWindow('facturador')
        },
        { type: 'separator' },
        {
          label: 'Salir',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => app.quit()
        }
      ]
    },
    {
      label: 'Módulos',
      submenu: [
        {
          label: 'Ventas',
          click: () => createModuleWindow('ventas')
        },
        {
          label: 'Compras',
          click: () => createModuleWindow('compras')
        },
        {
          label: 'Inventario',
          click: () => createModuleWindow('inventario')
        },
        {
          label: 'Clientes',
          click: () => createModuleWindow('clientes')
        },
        {
          label: 'Proveedores',
          click: () => createModuleWindow('proveedores')
        },
        {
          label: 'Caja',
          click: () => createModuleWindow('caja')
        },
        {
          label: 'Reportes',
          click: () => createModuleWindow('reportes')
        },
        {
          label: 'Cuotificador',
          click: () => createModuleWindow('cuotificador')
        }
      ]
    },
    {
      label: 'Herramientas',
      submenu: [
        {
          label: 'Configuración',
          click: () => {
            // Aquí implementar apertura de configuración
          }
        },
        { type: 'separator' },
        {
          label: 'Recargar',
          accelerator: 'F5',
          click: (item, focusedWindow) => {
            if (focusedWindow) focusedWindow.reload();
          }
        }
      ]
    },
    {
      label: 'Ayuda',
      submenu: [
        {
          label: 'Documentación',
          click: () => {
            shell.openExternal('https://github.com/FAb114/FactuSystem');
          }
        },
        {
          label: 'Acerca de FactuSystem',
          click: () => {
            // Mostrar ventana acerca de
          }
        }
      ]
    }
  ];

  // Agregar menú para macOS
  if (process.platform === 'darwin') {
    template.unshift({
      label: app.getName(),
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideothers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    });
  }

  // Aplicar el menú
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Iniciar la aplicación cuando Electron esté listo
app.whenReady().then(() => {
  createMainWindow();

  // En macOS, recrear la ventana cuando se hace clic en el dock
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

// Cerrar la aplicación cuando todas las ventanas están cerradas (excepto en macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Manejar eventos IPC (comunicación entre procesos)
ipcMain.handle('open-module', (event, moduleId) => {
  createModuleWindow(moduleId);
});

// Función para obtener estadísticas del sistema (simuladas)
ipcMain.handle('get-system-stats', async () => {
  // Aquí podrías implementar la lógica real para obtener estadísticas
  // desde tu base de datos o sistema de archivos
  return {
    ventas: {
      hoy: Math.floor(Math.random() * 20000) + 5000,
      semana: Math.floor(Math.random() * 100000) + 30000,
      mes: Math.floor(Math.random() * 500000) + 150000
    },
    facturas: {
      pendientes: Math.floor(Math.random() * 30) + 5,
      completadas: Math.floor(Math.random() * 100) + 50,
      anuladas: Math.floor(Math.random() * 10) + 1
    },
    inventario: {
      total: Math.floor(Math.random() * 1000) + 200,
      bajoStock: Math.floor(Math.random() * 20) + 5,
      agotados: Math.floor(Math.random() * 10) + 1
    },
    clientes: {
      activos: Math.floor(Math.random() * 500) + 100,
      nuevos: Math.floor(Math.random() * 20) + 5
    }
  };
});

// Función para verificar actualizaciones de la aplicación
function checkForUpdates() {
  // Implementar lógica de verificación de actualizaciones
  console.log('Verificando actualizaciones...');
}

// Verificar actualizaciones al iniciar
app.whenReady().then(() => {
  // Verificar actualizaciones cada 24 horas
  checkForUpdates();
  setInterval(checkForUpdates, 24 * 60 * 60 * 1000);
});