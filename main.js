const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const url = require('url');
const fs = require('fs');

// Mantener una referencia global del objeto window
let mainWindow;

function createWindow() {
  // Crear la ventana del navegador
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Cargar el archivo index.html
  mainWindow.loadURL(url.format({
    pathname: path.join(__dirname, 'app/views/index.html'),
    protocol: 'file:',
    slashes: true
  }));

  // Configurar menú y otras opciones del navegador
  mainWindow.setMenu(null);
  
  // Abrir DevTools en desarrollo (comentar en producción)
  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', function() {
    mainWindow = null;
  });
}

app.on('ready', createWindow);

app.on('window-all-closed', function() {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', function() {
  if (mainWindow === null) {
    createWindow();
  }
});

// Asegúrate de que los directorios de datos existan
function ensureDirectoriesExist() {
  const dataDir = path.join(__dirname, 'app/data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

// Crear directorios al inicio
ensureDirectoriesExist();

// Manejadores de IPC para comunicación entre procesos
ipcMain.on('guardar-cliente', (event, clienteData) => {
  try {
    const clientesPath = path.join(__dirname, 'app/data/clientes.json');
    let clientes = [];
    
    // Leer archivo existente si existe
    if (fs.existsSync(clientesPath)) {
      const data = fs.readFileSync(clientesPath, 'utf8');
      clientes = JSON.parse(data);
    }
    
    // Añadir nuevo cliente con ID único
    const nuevoCliente = {
      id: Date.now().toString(),
      ...clienteData
    };
    
    clientes.push(nuevoCliente);
    
    // Guardar datos actualizados
    fs.writeFileSync(clientesPath, JSON.stringify(clientes, null, 2));
    
    event.reply('cliente-guardado', { success: true, cliente: nuevoCliente });
  } catch (error) {
    console.error('Error al guardar cliente:', error);
    event.reply('cliente-guardado', { success: false, error: error.message });
  }
});

ipcMain.on('cargar-clientes', (event) => {
  try {
    const clientesPath = path.join(__dirname, 'app/data/clientes.json');
    
    if (fs.existsSync(clientesPath)) {
      const data = fs.readFileSync(clientesPath, 'utf8');
      const clientes = JSON.parse(data);
      event.reply('clientes-cargados', { success: true, clientes });
    } else {
      event.reply('clientes-cargados', { success: true, clientes: [] });
    }
  } catch (error) {
    console.error('Error al cargar clientes:', error);
    event.reply('clientes-cargados', { success: false, error: error.message });
  }
});

ipcMain.on('guardar-producto', (event, productoData) => {
  try {
    const productosPath = path.join(__dirname, 'app/data/productos.json');
    let productos = [];
    
    if (fs.existsSync(productosPath)) {
      const data = fs.readFileSync(productosPath, 'utf8');
      productos = JSON.parse(data);
    }
    
    const nuevoProducto = {
      id: Date.now().toString(),
      ...productoData
    };
    
    productos.push(nuevoProducto);
    fs.writeFileSync(productosPath, JSON.stringify(productos, null, 2));
    
    event.reply('producto-guardado', { success: true, producto: nuevoProducto });
  } catch (error) {
    console.error('Error al guardar producto:', error);
    event.reply('producto-guardado', { success: false, error: error.message });
  }
});

ipcMain.on('cargar-productos', (event) => {
  try {
    const productosPath = path.join(__dirname, 'app/data/productos.json');
    
    if (fs.existsSync(productosPath)) {
      const data = fs.readFileSync(productosPath, 'utf8');
      const productos = JSON.parse(data);
      event.reply('productos-cargados', { success: true, productos });
    } else {
      event.reply('productos-cargados', { success: true, productos: [] });
    }
  } catch (error) {
    console.error('Error al cargar productos:', error);
    event.reply('productos-cargados', { success: false, error: error.message });
  }
});

ipcMain.on('guardar-factura', (event, facturaData) => {
  try {
    const facturasPath = path.join(__dirname, 'app/data/facturas.json');
    let facturas = [];
    
    if (fs.existsSync(facturasPath)) {
      const data = fs.readFileSync(facturasPath, 'utf8');
      facturas = JSON.parse(data);
    }
    
    const nuevaFactura = {
      id: Date.now().toString(),
      fecha: new Date().toISOString(),
      ...facturaData
    };
    
    facturas.push(nuevaFactura);
    fs.writeFileSync(facturasPath, JSON.stringify(facturas, null, 2));
    
    event.reply('factura-guardada', { success: true, factura: nuevaFactura });
  } catch (error) {
    console.error('Error al guardar factura:', error);
    event.reply('factura-guardada', { success: false, error: error.message });
  }
});

ipcMain.on('cargar-facturas', (event) => {
  try {
    const facturasPath = path.join(__dirname, 'app/data/facturas.json');
    
    if (fs.existsSync(facturasPath)) {
      const data = fs.readFileSync(facturasPath, 'utf8');
      const facturas = JSON.parse(data);
      event.reply('facturas-cargadas', { success: true, facturas });
    } else {
      event.reply('facturas-cargadas', { success: true, facturas: [] });
    }
  } catch (error) {
    console.error('Error al cargar facturas:', error);
    event.reply('facturas-cargadas', { success: false, error: error.message });
  }
});

// Manejador para seleccionar directorios
ipcMain.on('seleccionar-directorio', (event) => {
  dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  }).then(result => {
    if (!result.canceled) {
      event.reply('directorio-seleccionado', result.filePaths[0]);
    }
  }).catch(err => {
    console.error(err);
    event.reply('directorio-seleccionado', null);
  });
});