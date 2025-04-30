const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// Habilitar registro detallado
const log = (...args) => {
  console.log(new Date().toISOString(), ...args);
  
  // También guardar logs en un archivo para depuración
  try {
    const logPath = path.join(app.getPath('userData'), 'logs');
    if (!fs.existsSync(logPath)) {
      fs.mkdirSync(logPath, { recursive: true });
    }
    
    fs.appendFileSync(
      path.join(logPath, `factusystem-${new Date().toISOString().split('T')[0]}.log`),
      `${new Date().toISOString()} ${args.join(' ')}\n`
    );
  } catch (e) {
    console.error('Error al guardar log:', e);
  }
};

let mainWindow;

function createWindow() {
  log('Iniciando creación de ventana principal');

  // Crear la ventana del navegador.
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, 'assets/img/icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  log('Configuración de BrowserWindow completada');

  // Verificar que el archivo index.html existe
  const indexPath = path.join(__dirname, 'app', 'index.html');
  try {
    if (fs.existsSync(indexPath)) {
      log(`Archivo index.html encontrado en: ${indexPath}`);
    } else {
      log(`ADVERTENCIA: index.html no encontrado en: ${indexPath}`);
      
      // Intentar detectar la ubicación correcta de index.html
      const possiblePaths = [
        path.join(__dirname, 'index.html'),
        path.join(__dirname, 'src', 'index.html'),
        path.join(__dirname, 'public', 'index.html')
      ];
      
      let foundAlternative = false;
      for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
          log(`Alternativa encontrada: ${p}`);
          mainWindow.loadFile(p);
          foundAlternative = true;
          break;
        }
      }
      
      if (!foundAlternative) {
        // Crear una página HTML de error básica
        const errorHTML = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8">
            <title>FactuSystem - Error</title>
            <style>
              body { font-family: Arial, sans-serif; padding: 20px; background-color: #f0f0f0; }
              .error-container { max-width: 800px; margin: 0 auto; background: white; padding: 20px; border-radius: 5px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
              h1 { color: #d9534f; }
              pre { background: #f8f8f8; padding: 10px; border-radius: 3px; overflow: auto; }
              .btn { display: inline-block; padding: 10px 15px; background: #0275d8; color: white; border-radius: 3px; text-decoration: none; margin-top: 20px; }
            </style>
          </head>
          <body>
            <div class="error-container">
              <h1>Error al iniciar FactuSystem</h1>
              <p>No se ha podido encontrar el archivo principal de la aplicación (index.html).</p>
              <h2>Ubicaciones verificadas:</h2>
              <pre>${possiblePaths.join('\n')}</pre>
              <p>Comprueba la estructura de archivos de tu proyecto y asegúrate de que index.html esté en la ubicación correcta.</p>
              <button class="btn" onclick="window.electronAPI.openDevTools()">Abrir DevTools</button>
              <button class="btn" onclick="window.electronAPI.restart()">Reiniciar aplicación</button>
            </div>
            <script>
              // Informar al proceso principal del error
              if (window.electronAPI) {
                window.electronAPI.reportError('INDEX_NOT_FOUND');
              }
            </script>
          </body>
          </html>
        `;
        
        const errorPath = path.join(app.getPath('temp'), 'factusystem-error.html');
        fs.writeFileSync(errorPath, errorHTML);
        mainWindow.loadFile(errorPath);
      }
      return;
    }
  } catch (error) {
    log(`Error al verificar archivo index.html: ${error.message}`);
    dialog.showErrorBox('Error en FactuSystem', 
      'Ha ocurrido un error al iniciar la aplicación. Por favor, contacte con soporte.\n\n' + error.message);
  }

  // Cargar el archivo index.html de la aplicación.
  try {
    log(`Intentando cargar: ${indexPath}`);
    mainWindow.loadFile(indexPath);
  } catch (error) {
    log(`Error al cargar index.html: ${error.message}`);
    dialog.showErrorBox('Error en FactuSystem', 
      'Ha ocurrido un error al cargar la interfaz de la aplicación.\n\n' + error.message);
  }

  // Abrir las herramientas de desarrollo.
  mainWindow.webContents.openDevTools();

  mainWindow.webContents.on('did-finish-load', () => {
    log('La ventana ha terminado de cargar');
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    log(`Error al cargar la ventana: ${errorCode} - ${errorDescription}`);
    
    // Mostrar página de error
    const errorHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>FactuSystem - Error</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; background-color: #f0f0f0; }
          .error-container { max-width: 800px; margin: 0 auto; background: white; padding: 20px; border-radius: 5px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          h1 { color: #d9534f; }
          pre { background: #f8f8f8; padding: 10px; border-radius: 3px; overflow: auto; }
          .btn { display: inline-block; padding: 10px 15px; background: #0275d8; color: white; border-radius: 3px; text-decoration: none; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="error-container">
          <h1>Error al cargar FactuSystem</h1>
          <p>No se ha podido cargar correctamente la aplicación.</p>
          <h2>Detalles del error:</h2>
          <pre>Código: ${errorCode}\nDescripción: ${errorDescription}</pre>
          <button class="btn" onclick="window.electronAPI.reload()">Intentar de nuevo</button>
        </div>
      </body>
      </html>
    `;
    
    const errorPath = path.join(app.getPath('temp'), 'factusystem-error.html');
    fs.writeFileSync(errorPath, errorHTML);
    mainWindow.loadFile(errorPath);
  });

  mainWindow.on('closed', function () {
    log('Ventana principal cerrada');
    mainWindow = null;
  });
}

// Este método se llamará cuando Electron haya terminado
// la inicialización y esté listo para crear ventanas del navegador.
app.whenReady().then(() => {
  log('Aplicación lista - Electron inicializado');
  createWindow();

  app.on('activate', function () {
    // En macOS es común volver a crear una ventana en la aplicación cuando el
    // icono del dock es clicado y no hay otras ventanas abiertas.
    if (mainWindow === null) createWindow();
  });
});

// Salir cuando todas las ventanas estén cerradas.
app.on('window-all-closed', function () {
  log('Todas las ventanas cerradas, saliendo de la aplicación');
  // En macOS es común que las aplicaciones y su barra de menú
  // permanezcan activas hasta que el usuario salga explícitamente con Cmd + Q
  if (process.platform !== 'darwin') app.quit();
});

// Configurar canales IPC para comunicación con el proceso de renderizado
ipcMain.handle('app:getPath', (event, name) => {
  log(`Solicitada ruta: ${name}`);
  return app.getPath(name);
});

ipcMain.handle('app:restart', () => {
  log('Reiniciando aplicación...');
  app.relaunch();
  app.exit();
});

ipcMain.handle('app:showDialog', async (event, options) => {
  log('Mostrando diálogo:', options.type);
  return await dialog.show(options);
});

// Manejo de errores no capturados en el proceso principal
process.on('uncaughtException', (error) => {
  log(`Error no capturado: ${error.message}`);
  log(error.stack);
  
  dialog.showErrorBox(
    'Error en FactuSystem',
    `Ha ocurrido un error inesperado en la aplicación.\n\n${error.message}\n\nPor favor, contacte con soporte técnico.`
  );
});

log('Archivo main.js cargado completamente');