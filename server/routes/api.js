const express = require('express');
const router = express.Router();
const { authenticateToken, checkPermission } = require('../config/security.js');
const dataController = require('../controllers/dataController.js');
const backupController = require('../controllers/backupController.js');

/**
 * Rutas principales de la API de FactuSystem
 * 
 * Este archivo define todas las rutas para interactuar con los datos
 * y funcionalidades del sistema desde las sucursales.
 */

/**
 * Rutas para gestión de productos
 */
router.get('/products', authenticateToken, dataController.getProducts);
router.get('/products/:id', authenticateToken, dataController.getProductById);
router.post('/products', authenticateToken, checkPermission('products.create'), dataController.createProduct);
router.put('/products/:id', authenticateToken, checkPermission('products.update'), dataController.updateProduct);
router.delete('/products/:id', authenticateToken, checkPermission('products.delete'), dataController.deleteProduct);
router.get('/products/barcode/:code', authenticateToken, dataController.getProductByBarcode);
router.get('/products/stock', authenticateToken, dataController.getProductsWithLowStock);
router.post('/products/import', authenticateToken, checkPermission('products.import'), dataController.importProducts);
router.get('/products/export', authenticateToken, checkPermission('products.export'), dataController.exportProducts);
router.post('/products/generate-barcodes', authenticateToken, checkPermission('products.manage'), dataController.generateBarcodes);

/**
 * Rutas para gestión de clientes
 */
router.get('/clients', authenticateToken, dataController.getClients);
router.get('/clients/:id', authenticateToken, dataController.getClientById);
router.post('/clients', authenticateToken, checkPermission('clients.create'), dataController.createClient);
router.put('/clients/:id', authenticateToken, checkPermission('clients.update'), dataController.updateClient);
router.delete('/clients/:id', authenticateToken, checkPermission('clients.delete'), dataController.deleteClient);
router.get('/clients/search/:term', authenticateToken, dataController.searchClients);
router.get('/clients/:id/invoices', authenticateToken, dataController.getClientInvoices);
router.get('/clients/:id/points', authenticateToken, dataController.getClientLoyaltyPoints);
router.post('/clients/:id/points', authenticateToken, checkPermission('clients.manage'), dataController.addClientLoyaltyPoints);
router.post('/clients/import', authenticateToken, checkPermission('clients.import'), dataController.importClients);
router.get('/clients/export', authenticateToken, checkPermission('clients.export'), dataController.exportClients);

/**
 * Rutas para gestión de ventas y facturación
 */
router.get('/invoices', authenticateToken, dataController.getInvoices);
router.get('/invoices/:id', authenticateToken, dataController.getInvoiceById);
router.post('/invoices', authenticateToken, checkPermission('invoices.create'), dataController.createInvoice);
router.put('/invoices/:id', authenticateToken, checkPermission('invoices.update'), dataController.updateInvoice);
router.get('/invoices/:id/pdf', authenticateToken, dataController.generateInvoicePdf);
router.get('/invoices/:id/ticket', authenticateToken, dataController.generateInvoiceTicket);
router.post('/invoices/:id/send-email', authenticateToken, dataController.sendInvoiceEmail);
router.post('/invoices/:id/send-whatsapp', authenticateToken, dataController.sendInvoiceWhatsapp);
router.get('/invoices/stats/daily', authenticateToken, dataController.getDailyInvoiceStats);
router.get('/invoices/stats/monthly', authenticateToken, dataController.getMonthlyInvoiceStats);
router.get('/invoices/stats/products', authenticateToken, dataController.getTopProductsStats);
router.get('/invoices/export', authenticateToken, checkPermission('invoices.export'), dataController.exportInvoices);

/**
 * Rutas para AFIP / ARCA (Facturación electrónica)
 */
router.get('/arca/status', authenticateToken, dataController.getArcaStatus);
router.post('/arca/authenticate', authenticateToken, checkPermission('arca.manage'), dataController.authenticateArca);
router.post('/arca/generate', authenticateToken, checkPermission('invoices.create'), dataController.generateArcaInvoice);
router.get('/arca/invoices', authenticateToken, dataController.getArcaInvoices);
router.get('/arca/invoices/:id', authenticateToken, dataController.getArcaInvoiceById);
router.post('/arca/cae-test', authenticateToken, checkPermission('arca.manage'), dataController.testArcaCAE);

/**
 * Rutas para gestión de compras
 */
router.get('/purchases', authenticateToken, dataController.getPurchases);
router.get('/purchases/:id', authenticateToken, dataController.getPurchaseById);
router.post('/purchases', authenticateToken, checkPermission('purchases.create'), dataController.createPurchase);
router.put('/purchases/:id', authenticateToken, checkPermission('purchases.update'), dataController.updatePurchase);
router.delete('/purchases/:id', authenticateToken, checkPermission('purchases.delete'), dataController.deletePurchase);
router.get('/purchases/stats/monthly', authenticateToken, dataController.getMonthlyPurchaseStats);
router.get('/purchases/stats/providers', authenticateToken, dataController.getTopProvidersStats);
router.post('/purchases/:id/upload-invoice', authenticateToken, checkPermission('purchases.manage'), dataController.uploadPurchaseInvoice);
router.get('/purchases/export', authenticateToken, checkPermission('purchases.export'), dataController.exportPurchases);

/**
 * Rutas para gestión de proveedores
 */
router.get('/providers', authenticateToken, dataController.getProviders);
router.get('/providers/:id', authenticateToken, dataController.getProviderById);
router.post('/providers', authenticateToken, checkPermission('providers.create'), dataController.createProvider);
router.put('/providers/:id', authenticateToken, checkPermission('providers.update'), dataController.updateProvider);
router.delete('/providers/:id', authenticateToken, checkPermission('providers.delete'), dataController.deleteProvider);
router.get('/providers/:id/purchases', authenticateToken, dataController.getProviderPurchases);
router.post('/providers/import', authenticateToken, checkPermission('providers.import'), dataController.importProviders);
router.get('/providers/export', authenticateToken, checkPermission('providers.export'), dataController.exportProviders);

/**
 * Rutas para gestión de caja
 */
router.get('/cash', authenticateToken, dataController.getCashMovements);
router.post('/cash/open', authenticateToken, checkPermission('cash.manage'), dataController.openCash);
router.post('/cash/close', authenticateToken, checkPermission('cash.manage'), dataController.closeCash);
router.post('/cash/movement', authenticateToken, checkPermission('cash.manage'), dataController.registerCashMovement);
router.get('/cash/current', authenticateToken, dataController.getCurrentCashStatus);
router.get('/cash/history', authenticateToken, dataController.getCashHistory);
router.get('/cash/report/:date', authenticateToken, dataController.getCashReportByDate);
router.get('/cash/export/:date', authenticateToken, checkPermission('cash.export'), dataController.exportCashReport);

/**
 * Rutas para gestión de stock
 */
router.get('/stock', authenticateToken, dataController.getStockStatus);
router.get('/stock/:productId', authenticateToken, dataController.getProductStock);
router.post('/stock/adjust', authenticateToken, checkPermission('stock.manage'), dataController.adjustStock);
router.get('/stock/low', authenticateToken, dataController.getLowStock);
router.post('/stock/transfer', authenticateToken, checkPermission('stock.manage'), dataController.transferStock);
router.get('/stock/history/:productId', authenticateToken, dataController.getStockHistory);
router.get('/stock/export', authenticateToken, checkPermission('stock.export'), dataController.exportStockReport);

/**
 * Rutas para documentos (remitos, notas de crédito/débito)
 */
router.get('/documents', authenticateToken, dataController.getDocuments);
router.get('/documents/:id', authenticateToken, dataController.getDocumentById);
router.post('/documents/receipt', authenticateToken, checkPermission('documents.create'), dataController.createReceipt);
router.post('/documents/creditnote', authenticateToken, checkPermission('documents.create'), dataController.createCreditNote);
router.post('/documents/debitnote', authenticateToken, checkPermission('documents.create'), dataController.createDebitNote);
router.get('/documents/:id/pdf', authenticateToken, dataController.generateDocumentPdf);
router.post('/documents/:id/send-email', authenticateToken, dataController.sendDocumentEmail);
router.post('/documents/:id/send-whatsapp', authenticateToken, dataController.sendDocumentWhatsapp);

/**
 * Rutas para cuotificador
 */
router.get('/installments/options', authenticateToken, dataController.getInstallmentOptions);
router.post('/installments/simulate', authenticateToken, dataController.simulateInstallments);
router.get('/installments/rates', authenticateToken, dataController.getInstallmentRates);
router.put('/installments/rates', authenticateToken, checkPermission('installments.manage'), dataController.updateInstallmentRates);

/**
 * Rutas para reportes
 */
router.get('/reports/sales', authenticateToken, dataController.getSalesReport);
router.get('/reports/purchases', authenticateToken, dataController.getPurchasesReport);
router.get('/reports/cash', authenticateToken, dataController.getCashReport);
router.get('/reports/stock', authenticateToken, dataController.getStockReport);
router.get('/reports/taxes', authenticateToken, checkPermission('reports.taxes'), dataController.getTaxReport);
router.get('/reports/products/performance', authenticateToken, dataController.getProductPerformanceReport);
router.get('/reports/clients/performance', authenticateToken, dataController.getClientPerformanceReport);
router.post('/reports/custom', authenticateToken, checkPermission('reports.create'), dataController.generateCustomReport);

/**
 * Rutas para integración con MercadoPago
 */
router.get('/mercadopago/status', authenticateToken, dataController.getMercadoPagoStatus);
router.post('/mercadopago/authenticate', authenticateToken, checkPermission('mercadopago.manage'), dataController.authenticateMercadoPago);
router.get('/mercadopago/qr', authenticateToken, dataController.getMercadoPagoQR);
router.post('/mercadopago/qr/generate', authenticateToken, checkPermission('mercadopago.manage'), dataController.generateMercadoPagoQR);
router.get('/mercadopago/payments', authenticateToken, dataController.getMercadoPagoPayments);
router.get('/mercadopago/payments/:id', authenticateToken, dataController.getMercadoPagoPaymentById);

/**
 * Rutas para integración con bancos
 */
router.get('/banks/status', authenticateToken, dataController.getBanksStatus);
router.post('/banks/authenticate', authenticateToken, checkPermission('banks.manage'), dataController.authenticateBanks);
router.get('/banks/transactions', authenticateToken, dataController.getBankTransactions);
router.post('/banks/transaction/confirm', authenticateToken, checkPermission('banks.manage'), dataController.confirmBankTransaction);
router.get('/banks/accounts', authenticateToken, dataController.getBankAccounts);

/**
 * Rutas específicas para cada banco
 */
// Galicia
router.post('/banks/galicia/authenticate', authenticateToken, checkPermission('banks.manage'), dataController.authenticateGalicia);
router.get('/banks/galicia/transactions', authenticateToken, dataController.getGaliciaTransactions);

// Getnet
router.post('/banks/getnet/authenticate', authenticateToken, checkPermission('banks.manage'), dataController.authenticateGetnet);
router.get('/banks/getnet/transactions', authenticateToken, dataController.getGetnetTransactions);

// BBVA
router.post('/banks/bbva/authenticate', authenticateToken, checkPermission('banks.manage'), dataController.authenticateBBVA);
router.get('/banks/bbva/transactions', authenticateToken, dataController.getBBVATransactions);

// Payway
router.post('/banks/payway/authenticate', authenticateToken, checkPermission('banks.manage'), dataController.authenticatePayway);
router.get('/banks/payway/transactions', authenticateToken, dataController.getPaywayTransactions);

/**
 * Rutas para integración con WhatsApp
 */
router.get('/whatsapp/status', authenticateToken, dataController.getWhatsappStatus);
router.post('/whatsapp/authenticate', authenticateToken, checkPermission('whatsapp.manage'), dataController.authenticateWhatsapp);
router.post('/whatsapp/send', authenticateToken, checkPermission('whatsapp.send'), dataController.sendWhatsappMessage);
router.get('/whatsapp/messages', authenticateToken, dataController.getWhatsappMessages);

/**
 * Rutas para integración con Email
 */
router.get('/email/status', authenticateToken, dataController.getEmailStatus);
router.post('/email/configure', authenticateToken, checkPermission('email.manage'), dataController.configureEmail);
router.post('/email/send', authenticateToken, checkPermission('email.send'), dataController.sendEmail);
router.get('/email/templates', authenticateToken, dataController.getEmailTemplates);
router.post('/email/templates', authenticateToken, checkPermission('email.manage'), dataController.createEmailTemplate);
router.put('/email/templates/:id', authenticateToken, checkPermission('email.manage'), dataController.updateEmailTemplate);

/**
 * Rutas para configuraciones
 */
router.get('/settings/company', authenticateToken, dataController.getCompanySettings);
router.put('/settings/company', authenticateToken, checkPermission('settings.manage'), dataController.updateCompanySettings);
router.get('/settings/visual', authenticateToken, dataController.getVisualSettings);
router.put('/settings/visual', authenticateToken, checkPermission('settings.manage'), dataController.updateVisualSettings);
router.get('/settings/printing', authenticateToken, dataController.getPrintingSettings);
router.put('/settings/printing', authenticateToken, checkPermission('settings.manage'), dataController.updatePrintingSettings);
router.get('/settings/backups', authenticateToken, dataController.getBackupSettings);
router.put('/settings/backups', authenticateToken, checkPermission('settings.manage'), dataController.updateBackupSettings);
router.get('/settings/security', authenticateToken, dataController.getSecuritySettings);
router.put('/settings/security', authenticateToken, checkPermission('settings.manage'), dataController.updateSecuritySettings);

/**
 * Rutas para sucursales
 */
router.get('/branches', authenticateToken, dataController.getBranches);
router.get('/branches/:id', authenticateToken, dataController.getBranchById);
router.post('/branches', authenticateToken, checkPermission('branches.manage'), dataController.createBranch);
router.put('/branches/:id', authenticateToken, checkPermission('branches.manage'), dataController.updateBranch);
router.delete('/branches/:id', authenticateToken, checkPermission('branches.manage'), dataController.deleteBranch);
router.get('/branches/:id/stats', authenticateToken, dataController.getBranchStats);
router.get('/branches/:id/stock', authenticateToken, dataController.getBranchStock);
router.get('/branches/:id/cash', authenticateToken, dataController.getBranchCash);

/**
 * Rutas para usuarios
 */
router.get('/users', authenticateToken, checkPermission('users.view'), dataController.getUsers);
router.get('/users/:id', authenticateToken, checkPermission('users.view'), dataController.getUserById);
router.post('/users', authenticateToken, checkPermission('users.manage'), dataController.createUser);
router.put('/users/:id', authenticateToken, checkPermission('users.manage'), dataController.updateUser);
router.delete('/users/:id', authenticateToken, checkPermission('users.manage'), dataController.deleteUser);
router.put('/users/:id/password', authenticateToken, checkPermission('users.manage'), dataController.updateUserPassword);
router.get('/users/:id/activity', authenticateToken, checkPermission('users.view'), dataController.getUserActivity);
router.put('/users/:id/permissions', authenticateToken, checkPermission('users.manage'), dataController.updateUserPermissions);
router.put('/users/:id/branch', authenticateToken, checkPermission('users.manage'), dataController.updateUserBranch);

/**
 * Rutas para roles y permisos
 */
router.get('/roles', authenticateToken, checkPermission('roles.view'), dataController.getRoles);
router.get('/roles/:id', authenticateToken, checkPermission('roles.view'), dataController.getRoleById);
router.post('/roles', authenticateToken, checkPermission('roles.manage'), dataController.createRole);
router.put('/roles/:id', authenticateToken, checkPermission('roles.manage'), dataController.updateRole);
router.delete('/roles/:id', authenticateToken, checkPermission('roles.manage'), dataController.deleteRole);
router.get('/permissions', authenticateToken, checkPermission('roles.view'), dataController.getAllPermissions);

/**
 * Rutas para backups
 */
router.get('/backups', authenticateToken, checkPermission('backups.view'), backupController.getBackups);
router.post('/backups/create', authenticateToken, checkPermission('backups.manage'), backupController.createBackup);
router.post('/backups/restore/:id', authenticateToken, checkPermission('backups.manage'), backupController.restoreBackup);
router.delete('/backups/:id', authenticateToken, checkPermission('backups.manage'), backupController.deleteBackup);
router.get('/backups/download/:id', authenticateToken, checkPermission('backups.view'), backupController.downloadBackup);
router.get('/backups/auto/config', authenticateToken, checkPermission('backups.view'), backupController.getAutoBackupConfig);
router.put('/backups/auto/config', authenticateToken, checkPermission('backups.manage'), backupController.updateAutoBackupConfig);

/**
 * Rutas para auditoría
 */
router.get('/audit/logs', authenticateToken, checkPermission('audit.view'), dataController.getAuditLogs);
router.get('/audit/logs/:id', authenticateToken, checkPermission('audit.view'), dataController.getAuditLogById);
router.get('/audit/logs/user/:userId', authenticateToken, checkPermission('audit.view'), dataController.getAuditLogsByUser);
router.get('/audit/logs/entity/:entity', authenticateToken, checkPermission('audit.view'), dataController.getAuditLogsByEntity);
router.get('/audit/logs/export', authenticateToken, checkPermission('audit.view'), dataController.exportAuditLogs);

/**
 * Rutas para ayuda/soporte
 */
router.get('/help/articles', authenticateToken, dataController.getHelpArticles);
router.get('/help/articles/:id', authenticateToken, dataController.getHelpArticleById);
router.get('/help/tutorials', authenticateToken, dataController.getHelpTutorials);
router.get('/help/tutorials/:id', authenticateToken, dataController.getHelpTutorialById);
router.post('/help/support-ticket', authenticateToken, dataController.createSupportTicket);
router.get('/help/faqs', authenticateToken, dataController.getFaqs);

/**
 * Rutas para verificación de salud del sistema
 */
router.get('/health', dataController.getSystemHealth);
router.get('/health/database', authenticateToken, checkPermission('system.admin'), dataController.getDatabaseHealth);
router.get('/health/services', authenticateToken, checkPermission('system.admin'), dataController.getServicesHealth);
router.post('/health/diagnose', authenticateToken, checkPermission('system.admin'), dataController.diagnoseSystem);

/**
 * Rutas para información del sistema
 */
router.get('/system/info', authenticateToken, dataController.getSystemInfo);
router.get('/system/resources', authenticateToken, checkPermission('system.admin'), dataController.getSystemResources);
router.get('/system/updates', authenticateToken, dataController.checkForUpdates);
router.post('/system/updates/install', authenticateToken, checkPermission('system.admin'), dataController.installUpdate);

module.exports = router;