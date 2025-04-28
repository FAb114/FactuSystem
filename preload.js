const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('factuSystem', {
  auth: {
    login: (credentials) => ipcRenderer.invoke('login', credentials),
    logout: () => ipcRenderer.invoke('logout'),
    checkAuth: () => ipcRenderer.invoke('check-auth'),
    getCurrentUser: () => ipcRenderer.invoke('get-current-user'),
    checkPermission: (permission) => ipcRenderer.invoke('check-permission', { permission }),
    setupTwoFactor: () => ipcRenderer.invoke('setup-two-factor'),
    verifyTwoFactor: (code) => ipcRenderer.invoke('verify-two-factor', { code }),
    disableTwoFactor: (password) => ipcRenderer.invoke('disable-two-factor', { password })
  },

  navigation: {
    navigate: (route, params) => ipcRenderer.send('navigate', { route, params })
  },

  print: {
    printDocument: (type, data, options) => ipcRenderer.invoke('print-document', { type, data, options }),
    previewDocument: (type, data, options) => ipcRenderer.invoke('preview-document', { type, data, options }),
    getPrinters: () => ipcRenderer.invoke('get-printers'),
    setDefaultPrinter: (printerName) => ipcRenderer.invoke('set-default-printer', { printerName })
  },

  backup: {
    createBackup: (includeConfigs = true) => ipcRenderer.invoke('create-backup', { includeConfigs }),
    restoreBackup: (backupPath, restoreConfigs = false) => ipcRenderer.invoke('restore-backup', { backupPath, restoreConfigs }),
    getBackups: () => ipcRenderer.invoke('get-backups'),
    verifyBackup: (backupPath) => ipcRenderer.invoke('verify-backup', { backupPath }),
    cloudBackupNow: () => ipcRenderer.invoke('cloud-backup-now'),
    configureCloudBackup: (config) => ipcRenderer.invoke('configure-cloud-backup', { config })
  },

  sync: {
    syncNow: () => ipcRenderer.invoke('sync-now'),
    getSyncStatus: () => ipcRenderer.invoke('get-sync-status'),
    configureBranch: (config) => ipcRenderer.invoke('configure-branch', { config }),
    getConflicts: () => ipcRenderer.invoke('get-conflicts'),
    resolveConflict: (conflictId, resolution) => ipcRenderer.invoke('resolve-conflict', { conflictId, resolution })
  },

  settings: {
    get: () => ipcRenderer.invoke('get-settings'),
    save: (settings) => ipcRenderer.invoke('save-settings', { settings })
  },

  integrations: {
    get: (integration) => ipcRenderer.invoke('get-integration-settings', { integration }),
    save: (integration, settings) => ipcRenderer.invoke('save-integration-settings', { integration, settings }),
    test: (integration, testData) => ipcRenderer.invoke('test-integration', { integration, testData })
  },

  updates: {
    check: () => ipcRenderer.invoke('check-for-updates')
  },

  fileSystem: {
    getAppPath: (name) => ipcRenderer.invoke('get-app-path', { name }),
    openExternal: (url) => ipcRenderer.invoke('open-external', { url }),
    openFolder: (path) => ipcRenderer.invoke('open-folder', { path }),
    selectDirectory: () => ipcRenderer.invoke('select-directory'),
    selectFile: (title, filters) => ipcRenderer.invoke('select-file', { title, filters }),
    saveFile: (title, defaultPath, filters) => ipcRenderer.invoke('save-file', { title, defaultPath, filters })
  },

  audit: {
    logEvent: (level, message, details) => ipcRenderer.invoke('log-event', { level, message, details }),
    getLogs: (startDate, endDate, userId, events) => ipcRenderer.invoke('get-audit-logs', { startDate, endDate, userId, events }),
    exportLogs: (startDate, endDate, userId, events, format) => ipcRenderer.invoke('export-audit-logs', { startDate, endDate, userId, events, format })
  },

  email: {
    send: (to, subject, template, data, attachments) => ipcRenderer.invoke('send-email', { to, subject, template, data, attachments })
  },

  whatsapp: {
    send: (to, message, attachments) => ipcRenderer.invoke('send-whatsapp', { to, message, attachments })
  },

  facturaElectronica: {
    generateInvoice: (invoiceData) => ipcRenderer.invoke('generate-invoice', { invoiceData }),
    getStatus: (invoiceId) => ipcRenderer.invoke('get-invoice-status', { invoiceId }),
    generateCreditNote: (noteData) => ipcRenderer.invoke('generate-credit-note', { noteData }),
    generateDebitNote: (noteData) => ipcRenderer.invoke('generate-debit-note', { noteData })
  }
});
