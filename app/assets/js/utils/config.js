// app/assets/js/utils/config.js

const clientConfig = {
    //  URLs de la API
    api: {
        baseUrl: 'http://localhost:3000/api', //  ¡CAMBIAR EN PRODUCCIÓN!
        authUrl: 'http://localhost:3000/auth', //  ¡CAMBIAR EN PRODUCCIÓN!
        syncUrl: 'http://localhost:3000/sync', //  ¡CAMBIAR EN PRODUCCIÓN!
    },

    //  Opciones de Sincronización
    sync: {
        automaticSyncEnabled: true,
        syncInterval: 60000, //  1 minuto (en milisegundos)
        conflictResolutionStrategy: 'clientWins', //  o 'serverWins' o 'merge' (implementar lógica en sync.js)
    },

    //  Formato de Fechas (usado en toda la app para consistencia)
    dateFormat: 'YYYY-MM-DD',
    dateTimeFormat: 'YYYY-MM-DD HH:mm:ss',

    //  Moneda por Defecto
    defaultCurrency: 'ARS', //  Peso Argentino (ejemplo)

    //  Interfaz de Usuario
    ui: {
        defaultTheme: 'light', //  'light' o 'dark'
        notificationDuration: 5000, //  Milisegundos
        paginationPageSize: 20,
    },

    //  Impresión
    printing: {
        defaultPrinter: 'default', //  Nombre de la impresora por defecto o 'default' para la del sistema
        receiptTemplate: 'ticket.html', //  Nombre del archivo de la plantilla
        invoiceTemplate: 'a4.html',
    },

    //  Autenticación
    auth: {
        tokenExpiryWarning: 300, //  Segundos antes de la expiración del token para mostrar una advertencia
        twoFactorAuthEnabled: false, //  Si la autenticación de dos factores está habilitada
    },

    //  Almacenamiento Local (LocalStorage Keys)
    storageKeys: {
        authToken: 'factusystem_auth_token',
        currentUser: 'factusystem_current_user',
        lastSync: 'factusystem_last_sync',
        settings: 'factusystem_user_settings',
    },

    //  Versión de la Aplicación (útil para actualizaciones)
    appVersion: '1.0.0', //  ¡ACTUALIZAR CON CADA VERSIÓN!

    //  Modo de Desarrollo (útil para logs y features en desarrollo)
    devMode: false, // ¡CAMBIAR A false EN PRODUCCIÓN!
};

module.exports = clientConfig; //  Cambio clave para CommonJS