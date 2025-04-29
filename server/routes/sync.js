const express = require('express');
const router = express.Router();
const syncController = require('../controllers/syncController.js');
const { authenticateToken, checkSyncPermission } = require('../config/security.js');

/**
 * Rutas para la sincronización entre sucursales
 * 
 * Este archivo maneja todas las rutas relacionadas con la sincronización
 * de datos entre el servidor central y las sucursales locales.
 */

/**
 * @route   GET /api/sync/status
 * @desc    Verificar estado de conexión y última sincronización
 * @access  Private
 */
router.get('/status', authenticateToken, syncController.getSyncStatus);

/**
 * @route   POST /api/sync/pull
 * @desc    Obtener datos nuevos o actualizados desde el servidor
 * @access  Private
 */
router.post('/pull', authenticateToken, syncController.pullData);

/**
 * @route   POST /api/sync/push
 * @desc    Enviar datos locales al servidor
 * @access  Private
 */
router.post('/push', authenticateToken, syncController.pushData);

/**
 * @route   POST /api/sync/resolve-conflicts
 * @desc    Resolver conflictos de sincronización
 * @access  Private
 */
router.post('/resolve-conflicts', authenticateToken, syncController.resolveConflicts);

/**
 * @route   GET /api/sync/changes
 * @desc    Obtener lista de cambios pendientes de sincronización
 * @access  Private
 */
router.get('/changes', authenticateToken, syncController.getPendingChanges);

/**
 * @route   POST /api/sync/initial-setup
 * @desc    Realizar sincronización inicial completa para una nueva sucursal
 * @access  Private (Admin)
 */
router.post('/initial-setup', authenticateToken, checkSyncPermission('admin'), syncController.initialSetup);

/**
 * @route   GET /api/sync/branches
 * @desc    Obtener lista de sucursales activas y su estado de sincronización
 * @access  Private (Admin)
 */
router.get('/branches', authenticateToken, checkSyncPermission('admin'), syncController.getBranchesStatus);

/**
 * @route   POST /api/sync/force
 * @desc    Forzar sincronización completa entre servidor y sucursal
 * @access  Private (Admin)
 */
router.post('/force', authenticateToken, checkSyncPermission('admin'), syncController.forceSync);

/**
 * Rutas específicas por entidad
 */

/**
 * @route   POST /api/sync/products
 * @desc    Sincronizar solo productos
 * @access  Private
 */
router.post('/products', authenticateToken, syncController.syncProducts);

/**
 * @route   POST /api/sync/clients
 * @desc    Sincronizar solo clientes
 * @access  Private
 */
router.post('/clients', authenticateToken, syncController.syncClients);

/**
 * @route   POST /api/sync/invoices
 * @desc    Sincronizar solo facturas
 * @access  Private
 */
router.post('/invoices', authenticateToken, syncController.syncInvoices);

/**
 * @route   POST /api/sync/stock
 * @desc    Sincronizar solo stock
 * @access  Private
 */
router.post('/stock', authenticateToken, syncController.syncStock);

/**
 * @route   POST /api/sync/cash
 * @desc    Sincronizar solo movimientos de caja
 * @access  Private
 */
router.post('/cash', authenticateToken, syncController.syncCash);

/**
 * @route   POST /api/sync/purchases
 * @desc    Sincronizar solo compras
 * @access  Private
 */
router.post('/purchases', authenticateToken, syncController.syncPurchases);

/**
 * @route   POST /api/sync/providers
 * @desc    Sincronizar solo proveedores
 * @access  Private
 */
router.post('/providers', authenticateToken, syncController.syncProviders);

/**
 * @route   POST /api/sync/users
 * @desc    Sincronizar solo usuarios (solo admin)
 * @access  Private (Admin)
 */
router.post('/users', authenticateToken, checkSyncPermission('admin'), syncController.syncUsers);

/**
 * @route   POST /api/sync/configurations
 * @desc    Sincronizar solo configuraciones
 * @access  Private (Admin)
 */
router.post('/configurations', authenticateToken, checkSyncPermission('admin'), syncController.syncConfigurations);

/**
 * Webhooks para integraciones
 */

/**
 * @route   POST /api/sync/webhook/mercadopago
 * @desc    Recibir notificaciones de MercadoPago y sincronizar con sucursales
 * @access  Public (con validación de firma)
 */
router.post('/webhook/mercadopago', syncController.mercadopagoWebhook);

/**
 * @route   POST /api/sync/webhook/arca
 * @desc    Recibir notificaciones de ARCA (AFIP) y sincronizar con sucursales
 * @access  Public (con validación de firma)
 */
router.post('/webhook/arca', syncController.arcaWebhook);

/**
 * @route   POST /api/sync/webhook/bank
 * @desc    Recibir notificaciones bancarias y sincronizar con sucursales
 * @access  Public (con validación de firma)
 */
router.post('/webhook/bank', syncController.bankWebhook);

/**
 * Utilidades de sincronización
 */

/**
 * @route   POST /api/sync/validate-data
 * @desc    Validar integridad de datos entre servidor y sucursal
 * @access  Private
 */
router.post('/validate-data', authenticateToken, syncController.validateData);

/**
 * @route   POST /api/sync/logs
 * @desc    Obtener logs de sincronización para auditoría
 * @access  Private (Admin)
 */
router.get('/logs', authenticateToken, checkSyncPermission('admin'), syncController.getSyncLogs);

/**
 * @route   POST /api/sync/repair
 * @desc    Reparar inconsistencias de datos
 * @access  Private (Admin)
 */
router.post('/repair', authenticateToken, checkSyncPermission('admin'), syncController.repairData);

/**
 * @route   GET /api/sync/bandwidth-stats
 * @desc    Obtener estadísticas de uso de ancho de banda por sucursal
 * @access  Private (Admin)
 */
router.get('/bandwidth-stats', authenticateToken, checkSyncPermission('admin'), syncController.getBandwidthStats);

/**
 * @route   POST /api/sync/optimize
 * @desc    Optimizar la sincronización para reducir uso de datos
 * @access  Private (Admin)
 */
router.post('/optimize', authenticateToken, checkSyncPermission('admin'), syncController.optimizeSync);

/**
 * Control de versiones y actualizaciones
 */

/**
 * @route   GET /api/sync/version
 * @desc    Verificar versión de la aplicación y disponibilidad de actualizaciones
 * @access  Private
 */
router.get('/version', authenticateToken, syncController.checkVersion);

/**
 * @route   POST /api/sync/update
 * @desc    Descargar actualizaciones de la aplicación
 * @access  Private
 */
router.post('/update', authenticateToken, syncController.downloadUpdate);

module.exports = router;