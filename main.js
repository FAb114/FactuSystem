const { app, BrowserWindow, ipcMain, Menu, dialog, shell, Tray, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const log = require('electron-log');
const Store = require('electron-store');
const isDev = require('electron-is-dev');

// Cargar autoUpdater solo si no estamos en desarrollo
let autoUpdater = null;
if (!isDev) {
  const { autoUpdater: updater } = require('electron-updater');
  autoUpdater = updater;
}

// Servicios de la aplicación
const authService = require('./services/auth/login.js');
const permissionsService = require('./services/auth/permissions.js');
const twoFactorService = require('./services/auth/twoFactor.js');
const backupService = require('./services/backup/autoBackup.js');
const cloudSyncService = require('./services/backup/cloudSync.js');
const recoveryService = require('./services/backup/recovery.js');
const printerService = require('./services/print/printer.js');
const pdfService = require('./services/print/pdf.js');
const ticketService = require('./services/print/ticket.js');
const syncService = require('./services/sync/offline.js');
const conflictService = require('./services/sync/conflict.js');
const schedulerService = require('./services/sync/scheduler.js');
const auditLogger = require('./services/audit/logger.js');
const auditReporter = require('./services/audit/reporter.js');

// Integraciones
const mercadoPagoApi = require('./integrations/mercadoPago/api.js');
const arcaApi = require('./integrations/arca/api.js');
const whatsappApi = require('./integrations/whatsapp/api.js');
const emailSender = require('./integrations/email/sender.js');
const bancosApi = require('./integrations/bancos/api.js');

// Esquema de la base de datos
const dbSchema = require('./db/schema.js');

// Configuración de Store para almacenamiento persistente
const store = new Store({
  encryptionKey: 'factusystem-secure-key-2025',
  schema: {
    settings: {
      type: 'object',
      properties: {
        theme: { type: 'string', default: 'light' },
        startMinimized: { type: 'boolean', default: false },
        backupPath: { type: 'string', default: path.join(app.getPath('documents'), 'FactuSystem', 'backups') },
        printConfig: { type: 'object', default: {} },
        syncInterval: { type: 'number', default: 15 }, // En minutos
        language: { type: 'string', default: 'es' },
        defaultPrinter: { type: 'string', default: '' },
        cloudBackup: { type: 'boolean', default: false },
        emailNotifications: { type: 'boolean', default: false },
        receiptFormat: { type: 'string', default: 'A4' }
      }
    },
    authData: {
      type: 'object',
      properties: {
        lastUser: { type: 'string', default: '' },
        rememberUser: { type: 'boolean', default: false },
        storeId: { type: 'string', default: '' },
        twoFactorEnabled: { type: 'boolean', default: false }
      }
    },
    serverConfig: {
      type: 'object',
      properties: {
        serverUrl: { type: 'string', default: 'http://localhost:3000' },
        apiKey: { type: 'string', default: '' },
        syncEnabled: { type: 'boolean', default: true },
        branchMode: { type: 'string', default: 'standalone' }, // standalone, main, branch
        mainServerUrl: { type: 'string', default: '' },
        branchId: { type: 'string', default: '' }
      }
    },
    integrations: {
      type: 'object',
      properties: {
        mercadoPago: { 
          type: 'object', 
          default: { 
            enabled: false, 
            clientId: '',
            clientSecret: '',
            accessToken: '',
            refreshToken: '',
            qrEnabled: false
          } 
        },
        arca: { 
          type: 'object', 
          default: { 
            enabled: false, 
            certificado: '',
            clave: '',
            cuit: '',
            puntoVenta: 1
          } 
        },
        whatsapp: { 
          type: 'object', 
          default: { 
            enabled: false, 
            apiKey: '',
            phoneNumber: ''
          } 
        },
        email: { 
          type: 'object', 
          default: { 
            smtpServer: '',
            port: 587,
            user: '',
            password: '',
            fromName: 'FactuSystem'
          } 
        },
        bancos: { 
          type: 'object', 
          default: {
            defaultBank: '',
            galicia: { enabled: false, credentials: {} },
            getnet: { enabled: false, credentials: {} },
            bbva: { enabled: false, credentials: {} },
            payway: { enabled: false, credentials: {} }
          } 
        }
      }
    }
  }
});

// Configuración de logs
log.transports.file.level = 'info';
log.transports.file.format = '{y}-{m}-{d} {h}:{i}:{s} [{level}] {text}';
log.transports.file.resolvePath = () => path.join(app.getPath('userData'), 'logs', 'main.log');

// Variables globales
let mainWindow;
let splashWindow;
let tray = null;
let isQuitting = false;
let dbInitialized = false;
let serverProcess = null;
let lastBackupDate = null;
let activeModules = new Set();
let updateDownloaded = false;

// Asegurar una sola instancia de la aplicación
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Alguien intentó ejecutar una segunda instancia, debemos enfocarnos en nuestra ventana
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      mainWindow.show();
    }
  });

  // Inicialización de la aplicación
  app.whenReady().then(() => {
    // Crear la ventana de carga
    createSplashWindow();
    
    // Inicializar servicios
    initializeServices()
      .then(() => {
        // Crear ventana principal después de inicializar servicios
        createMainWindow();
        createTray();
        setupIPC();
        setupAutoUpdater();
        
        // Verificar actualizaciones automáticamente
        if (!isDev) {
          autoUpdater.checkForUpdatesAndNotify();
          // Programar verificación periódica de actualizaciones
          setInterval(() => {
            autoUpdater.checkForUpdatesAndNotify();
          }, 6 * 60 * 60 * 1000); // Cada 6 horas
        }
      })
      .catch(error => {
        log.error('Error en la inicialización de la aplicación:', error);
        dialog.showErrorBox(
          'Error de inicialización',
          'Ha ocurrido un error al iniciar la aplicación. Por favor, contacte con soporte técnico.'
        );
        app.quit();
      });
  });
}

// Función para crear ventana de splash
function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 500,
    height: 300,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  splashWindow.loadFile(path.join(__dirname, 'app', 'views', 'splash.html'));
  splashWindow.center();
}

// Función para crear ventana principal
function createMainWindow() {
  const settings = store.get('settings');
  const { width, height } = require('electron').screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: Math.min(1280, width * 0.85),
    height: Math.min(768, height * 0.85),
    show: !settings.startMinimized,
    icon: path.join(__dirname, 'app', 'assets', 'img', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      spellcheck: true,
      sandbox: false,
      devTools: isDev
    }
  });

  // Cargar el tema guardado o el predeterminado del sistema
  setTheme(settings.theme || 'system');

  // Cargar la página de inicio
  const startPage = authService.isAuthenticated() ? 'index.html' : 'login.html';
  mainWindow.loadFile(path.join(__dirname, 'app', 'views', startPage));

  // Abre las herramientas de desarrollo si está en modo desarrollo
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  // Cerrar la ventana de splash cuando la ventana principal esté lista
  mainWindow.once('ready-to-show', () => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
      splashWindow = null;
    }
    // Solo mostrar si no está configurado para iniciar minimizado
    if (!settings.startMinimized) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // Manejar el cierre de la ventana
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      return false;
    }
    return true;
  });

  // Crear menú
  const menu = Menu.buildFromTemplate(getMenuTemplate());
  Menu.setApplicationMenu(menu);

  // Auditoría de inicio de sesión
  auditLogger.log({
    event: 'APP_START',
    userId: authService.getCurrentUserId() || 'SISTEMA',
    details: {
      os: `${os.platform()} ${os.release()}`,
      hostname: os.hostname(),
      appVersion: app.getVersion()
    }
  });
}

// Función para crear el icono en la bandeja del sistema
function createTray() {
  tray = new Tray(path.join(__dirname, 'app', 'assets', 'img', 'icon-tray.png'));
  const contextMenu = Menu.buildFromTemplate([
    { 
      label: 'Abrir FactuSystem', 
      click: () => {
        mainWindow.show();
      }
    },
    { 
      label: 'Crear nueva factura', 
      click: () => {
        mainWindow.show();
        mainWindow.webContents.send('navigate', { route: 'facturador' });
      }
    },
    { type: 'separator' },
    { 
      label: 'Realizar backup', 
      click: () => {
        backupService.createManualBackup()
          .then(path => {
            mainWindow.webContents.send('backup-created', { path });
            lastBackupDate = new Date();
          })
          .catch(error => {
            log.error('Error al crear backup manual:', error);
            dialog.showErrorBox('Error de Backup', 'No se pudo crear el backup. Verifique los permisos y el espacio disponible.');
          });
      }
    },
    { type: 'separator' },
    { 
      label: 'Configuración', 
      click: () => {
        mainWindow.show();
        mainWindow.webContents.send('navigate', { route: 'configuraciones' });
      }
    },
    { type: 'separator' },
    { 
      label: 'Salir', 
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
  
  tray.setToolTip('FactuSystem');
  tray.setContextMenu(contextMenu);
  
  tray.on('click', () => {
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });
}

// Función para inicializar servicios
async function initializeServices() {
  try {
    // Crear directorios necesarios
    const dirs = [
      path.join(app.getPath('userData'), 'db'),
      path.join(app.getPath('userData'), 'logs'),
      path.join(app.getPath('userData'), 'backups'),
      path.join(app.getPath('userData'), 'temp'),
      path.join(app.getPath('userData'), 'exports'),
      path.join(app.getPath('documents'), 'FactuSystem', 'backups'),
      path.join(app.getPath('documents'), 'FactuSystem', 'exports')
    ];
    
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    // Inicializar la base de datos
    log.info('Inicializando base de datos...');
    await dbSchema.initialize(path.join(app.getPath('userData'), 'db', 'factusystem.db'));
    
    // Aplicar migraciones si es necesario
    log.info('Verificando migraciones...');
    const migrationFiles = fs.readdirSync(path.join(__dirname, 'db', 'migrations')).sort();
    for (const migrationFile of migrationFiles) {
      if (migrationFile.endsWith('.js')) {
        log.info(`Aplicando migración: ${migrationFile}`);
        const migration = require(path.join(__dirname, 'db', 'migrations', migrationFile));
        await migration.up();
      }
    }
    
    dbInitialized = true;
    log.info('Base de datos inicializada correctamente.');

    // Iniciar servidor local para sincronización si está habilitado
    const serverConfig = store.get('serverConfig');
    if (serverConfig.syncEnabled && (serverConfig.branchMode === 'main' || serverConfig.branchMode === 'standalone')) {
      log.info('Iniciando servidor local para sincronización...');
      serverProcess = require('./server/index.js');
      await serverProcess.start();
    }

    // Iniciar servicio de sincronización
    await syncService.initialize();
    
    // Configurar backups automáticos
    backupService.scheduleAutoBackups();

    // Configurar sincronización en la nube si está habilitado
    const settings = store.get('settings');
    if (settings.cloudBackup) {
      await cloudSyncService.initialize();
    }

    // Cargar configuración de impresión
    await printerService.initialize();
    await pdfService.initialize();
    await ticketService.initialize();

    // Inicializar integraciones activas
    const integrations = store.get('integrations');
    
    if (integrations.mercadoPago.enabled) {
      await mercadoPagoApi.initialize(integrations.mercadoPago);
    }
    
    if (integrations.arca.enabled) {
      await arcaApi.initialize(integrations.arca);
    }
    
    if (integrations.whatsapp.enabled) {
      await whatsappApi.initialize(integrations.whatsapp);
    }
    
    if (integrations.email.smtpServer) {
      await emailSender.initialize(integrations.email);
    }
    
    if (integrations.bancos.defaultBank) {
      await bancosApi.initialize(integrations.bancos);
    }

    // Inicializar programador de tareas
    await schedulerService.initialize({
      syncInterval: serverConfig.syncEnabled ? serverConfig.syncInterval : 0,
      backupInterval: 24, // Backup diario
      reportInterval: 168 // Reportes semanales (en horas)
    });

    log.info('Todos los servicios inicializados correctamente.');
    return true;

  } catch (error) {
    log.error('Error al inicializar servicios:', error);
    throw error;
  }
}

// Configurar IPC (comunicación entre procesos)
function setupIPC() {
  // Autenticación
  ipcMain.handle('login', async (event, { username, password, storeId, twoFactorCode }) => {
    const authData = store.get('authData');
    let result;
    
    if (authData.twoFactorEnabled && !twoFactorCode) {
      // Primera fase de autenticación - validar credenciales
      result = await authService.validateCredentials(username, password, storeId);
      if (result.success) {
        return { requireTwoFactor: true, tempToken: result.tempToken };
      }
      return result;
    } else if (authData.twoFactorEnabled && twoFactorCode) {
      // Segunda fase - validar código 2FA
      result = await twoFactorService.verify(twoFactorCode);
      if (result.success) {
        return await authService.completeLogin(result.tempToken);
      }
      return result;
    } else {
      // Autenticación normal sin 2FA
      return await authService.login(username, password, storeId);
    }
  });

  ipcMain.handle('logout', async () => {
    return await authService.logout();
  });

  ipcMain.handle('check-auth', () => {
    return authService.isAuthenticated();
  });

  ipcMain.handle('get-current-user', () => {
    return authService.getCurrentUser();
  });

  ipcMain.handle('check-permission', (event, { permission }) => {
    return permissionsService.hasPermission(permission);
  });

  ipcMain.handle('setup-two-factor', async () => {
    return await twoFactorService.setup();
  });

  ipcMain.handle('verify-two-factor', async (event, { code }) => {
    return await twoFactorService.verify(code);
  });

  ipcMain.handle('disable-two-factor', async (event, { password }) => {
    return await twoFactorService.disable(password);
  });

  // Navegación
  ipcMain.on('navigate', (event, { route, params }) => {
    mainWindow.webContents.send('navigate', { route, params });
    
    // Registrar módulo activo para análisis de uso
    if (route) {
      activeModules.add(route);
      auditLogger.log({
        event: 'MODULE_NAVIGATE',
        userId: authService.getCurrentUserId() || 'SISTEMA',
        details: {
          route,
          params
        }
      });
    }
  });

  // Impresión
  ipcMain.handle('print-document', async (event, { type, data, options }) => {
    try {
      let result;
      
      // Determinar qué servicio de impresión utilizar según el tipo y opciones
      if (options && options.format === 'ticket') {
        result = await ticketService.printDocument(type, data, options);
      } else if (options && options.format === 'pdf') {
        result = await pdfService.generatePDF(type, data, options);
        
        // Si se solicita imprimir el PDF generado
        if (options.print && result.success) {
          await printerService.printPDF(result.filePath, options);
        }
      } else {
        result = await printerService.printDocument(type, data, options);
      }
      
      return result;
    } catch (error) {
      log.error('Error en la impresión:', error);
      return { 
        success: false, 
        error: error.message 
      };
    }
  });

  ipcMain.handle('get-printers', async () => {
    return await printerService.getPrinters();
  });

  ipcMain.handle('set-default-printer', async (event, { printerName }) => {
    const settings = store.get('settings');
    settings.defaultPrinter = printerName;
    store.set('settings', settings);
    await printerService.setDefaultPrinter(printerName);
    return true;
  });

  ipcMain.handle('preview-document', async (event, { type, data, options }) => {
    try {
      const result = await pdfService.generatePDF(type, data, options);
      
      if (result.success) {
        shell.openPath(result.filePath);
        return { success: true, filePath: result.filePath };
      }
      
      return result;
    } catch (error) {
      log.error('Error en la vista previa:', error);
      return { 
        success: false, 
        error: error.message 
      };
    }
  });

  // Backup y restauración
  ipcMain.handle('create-backup', async (event, { includeConfigs = true }) => {
    return await backupService.createManualBackup(includeConfigs);
  });

  ipcMain.handle('restore-backup', async (event, { backupPath, restoreConfigs = false }) => {
    return await backupService.restoreBackup(backupPath, restoreConfigs);
  });

  ipcMain.handle('get-backups', async () => {
    return await backupService.getBackups();
  });

  ipcMain.handle('verify-backup', async (event, { backupPath }) => {
    return await backupService.verifyBackup(backupPath);
  });

  ipcMain.handle('cloud-backup-now', async () => {
    if (!store.get('settings').cloudBackup) {
      return { success: false, error: 'El backup en la nube no está habilitado' };
    }
    return await cloudSyncService.syncNow();
  });

  ipcMain.handle('configure-cloud-backup', async (event, { config }) => {
    return await cloudSyncService.configure(config);
  });

  // Sincronización
  ipcMain.handle('sync-now', async () => {
    return await syncService.syncNow();
  });

  ipcMain.handle('get-sync-status', () => {
    return syncService.getStatus();
  });

  ipcMain.handle('configure-branch', async (event, { config }) => {
    const serverConfig = store.get('serverConfig');
    
    // Actualizar configuración
    Object.assign(serverConfig, config);
    store.set('serverConfig', serverConfig);
    
    // Reiniciar servicios de sincronización si es necesario
    if (serverProcess) {
      serverProcess.stop();
      serverProcess = null;
    }
    
    // Si es servidor principal o standalone, iniciar el servidor
    if (serverConfig.branchMode === 'main' || serverConfig.branchMode === 'standalone') {
      serverProcess = require('./server/index.js');
      await serverProcess.start();
    }
    
    // Reiniciar servicios de sincronización
    await syncService.reconfigure(serverConfig);
    
    return { success: true };
  });

  ipcMain.handle('resolve-conflict', async (event, { conflictId, resolution }) => {
    return await conflictService.resolveConflict(conflictId, resolution);
  });

  ipcMain.handle('get-conflicts', async () => {
    return await conflictService.getPendingConflicts();
  });

  // Sistema
  ipcMain.handle('get-app-path', (event, { name }) => {
    return app.getPath(name);
  });

  ipcMain.handle('get-settings', () => {
    return store.get('settings');
  });

  ipcMain.handle('save-settings', (event, { settings }) => {
    const oldSettings = store.get('settings');
    store.set('settings', settings);
    
    // Aplicar cambios de tema
    if (settings.theme !== oldSettings.theme) {
      setTheme(settings.theme);
    }
    
    // Aplicar cambios de intervalo de sincronización
    if (settings.syncInterval !== oldSettings.syncInterval) {
      syncService.updateSyncInterval(settings.syncInterval);
      schedulerService.updateIntervals({ syncInterval: settings.syncInterval });
    }
    
    // Configurar backup en la nube
    if (settings.cloudBackup !== oldSettings.cloudBackup) {
      if (settings.cloudBackup) {
        cloudSyncService.initialize();
      } else {
        cloudSyncService.disable();
      }
    }
    
    return true;
  });

  ipcMain.handle('get-integration-settings', (event, { integration }) => {
    const integrations = store.get('integrations');
    return integrations[integration] || null;
  });

  ipcMain.handle('save-integration-settings', (event, { integration, settings }) => {
    const integrations = store.get('integrations');
    integrations[integration] = settings;
    store.set('integrations', integrations);
    
    // Reiniciar la integración si es necesario
    switch (integration) {
      case 'mercadoPago':
        mercadoPagoApi.initialize(settings);
        break;
      case 'arca':
        arcaApi.initialize(settings);
        break;
      case 'whatsapp':
        whatsappApi.initialize(settings);
        break;
      case 'email':
        emailSender.initialize(settings);
        break;
      case 'bancos':
        bancosApi.initialize(settings);
        break;
    }
    
    return true;
  });

  ipcMain.handle('test-integration', async (event, { integration, testData }) => {
    try {
      let result = { success: false };
      
      switch (integration) {
        case 'mercadoPago':
          result = await mercadoPagoApi.testConnection(testData);
          break;
        case 'arca':
          result = await arcaApi.testConnection(testData);
          break;
        case 'whatsapp':
          result = await whatsappApi.testConnection(testData);
          break;
        case 'email':
          result = await emailSender.testConnection(testData);
          break;
        case 'bancos':
          result = await bancosApi.testConnection(testData);
          break;
      }
      
      return result;
    } catch (error) {
      log.error(`Error al probar la integración ${integration}:`, error);
      return { 
        success: false, 
        error: error.message 
      };
    }
  });

  ipcMain.handle('check-for-updates', () => {
    if (isDev) {
      return { updateAvailable: false, message: 'En modo desarrollo no se buscan actualizaciones.' };
    }
    autoUpdater.checkForUpdates();
    return { checking: true };
  });

  ipcMain.handle('open-external', (event, { url }) => {
    // Validar URL para seguridad
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return shell.openExternal(url);
    }
    return false;
  });

  ipcMain.handle('open-folder', (event, { path }) => {
    return shell.openPath(path);
  });

  ipcMain.handle('select-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    });
    return result.filePaths.length > 0 ? result.filePaths[0] : null;
  });

  ipcMain.handle('select-file', async (event, { title, filters }) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: title || 'Seleccionar archivo',
      properties: ['openFile'],
      filters: filters || [{ name: 'Todos los archivos', extensions: ['*'] }]
    });
    return result.filePaths.length > 0 ? result.filePaths[0] : null;
  });

  ipcMain.handle('save-file', async (event, { title, defaultPath, filters }) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: title || 'Guardar archivo',
      defaultPath: defaultPath,
      filters: filters || [{ name: 'Todos los archivos', extensions: ['*'] }]
    });
    return result.canceled ? null : result.filePath;
  });

  // Logs y auditoría
  ipcMain.handle('log-event', (event, { level, message, details }) => {
    auditLogger.log({
      event: message,
      userId: authService.getCurrentUserId() || 'SISTEMA',
      details: details || {}
    });
    return true;
  });

  ipcMain.handle('get-audit-logs', async (event, { startDate, endDate, userId, events }) => {
    return await auditReporter.getFilteredLogs(startDate, endDate, userId, events);
  });

  ipcMain.handle('export-audit-logs', async (event, { startDate, endDate, userId, events, format }) => {
    return await auditReporter.exportLogs(startDate, endDate, userId, events, format);
  });

  // Email
  ipcMain.handle('send-email', async (event, { to, subject, template, data, attachments }) => {
    try {
      return await emailSender.sendEmail(to, subject, template, data, attachments);
    } catch (error) {
      log.error('Error al enviar email:', error);
      return { 
        success: false, 
        error: error.message 
      };
    }
  });

  // WhatsApp
  ipcMain.handle('send-whatsapp', async (event, { to, message, attachments }) => {
    try {
      return await whatsappApi.sendMessage(to, message, attachments);
    } catch (error) {
      log.error('Error al enviar WhatsApp:', error);
      return { 
        success: false, 
        error: error.message 
      };
    }
  });

  // Facturación electrónica
  ipcMain.handle('generate-invoice', async (event, { invoiceData }) => {
    try {
      return await arcaApi.generateInvoice(invoiceData);
    } catch (error) {
      log.error('Error al generar factura electrónica:', error);
      return { 
        success: false, 
        error: error.message 
      };
    }
  });

  ipcMain.handle('get-invoice-status', async (event, { invoiceId }) => {
    try {
      return await arcaApi.getInvoiceStatus(invoiceId);
    } catch (error) {
      log.error('Error al consultar estado de factura:', error);
      return { 
        success: false, 
        error: error.message 
      };
    }
  });

  ipcMain.handle('generate-credit-note', async (event, { noteData }) => {
    try {
      return await arcaApi.generateCreditNote(noteData);
    } catch (error) {
      log.error('Error al generar nota de crédito:', error);
      return { 
        success: false, 
        error: error.message 
      };
    }
  });

  ipcMain.handle('generate-debit-note', async (event, { noteData }) => {
    try {
      return await arcaApi.generateDebitNote(noteData);
    } catch (error) {
      log.error('Error al generar nota de débito:', error);
      return { 
        success: false, 
        error: error.message 
      };
    }
  });
}

// Función para aplicar tema
function setTheme(theme) {
  switch (theme) {
    case 'dark':
      nativeTheme.themeSource = 'dark';
      break;
    case 'light':
      nativeTheme.themeSource = 'light';
      break;
    case 'system':
    default:
      nativeTheme.themeSource = 'system';
      break;
  }
}

// Evento para cerrar la aplicación correctamente
app.on('before-quit', () => {
  isQuitting = true;
  if (serverProcess && typeof serverProcess.stop === 'function') {
    serverProcess.stop();
  }
});

// Evento cuando todas las ventanas están cerradas
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});
