/**
 * @fileoverview Módulo de integración con Banco Galicia para FactuSystem
 * @description Gestiona la autenticación, configuración y operaciones con la API del Banco Galicia
 * @requires electron
 * @requires ../../../../../../utils/database
 * @requires ../../../../../../utils/logger
 * @requires ../api
 */

// Importaciones
const { ipcRenderer } = require('electron');
const database = require('../../../../../../utils/database');
const logger = require('../../../../../../utils/logger');
const BancoAPI = require('../api');

/**
 * Clase para gestionar la integración con el Banco Galicia
 * @class GaliciaIntegracion
 * @extends BancoAPI
 */
class GaliciaIntegracion extends BancoAPI {
    /**
     * Crea una instancia de la integración con Banco Galicia
     * @constructor
     */
    constructor() {
        super('galicia');
        this.baseUrl = 'https://api.bancogalicia.com.ar/v1';
        this.tokenExpirationTime = null;
        this.accessToken = null;
        this.refreshToken = null;
        this.certificadoPath = null;
        this.isConfigured = false;
        this.configurationForm = null;
        this.loadingElement = null;
        this.errorMessageElement = null;
        this.successMessageElement = null;
        this.testConnectionBtn = null;
        this.saveConfigBtn = null;
    }

    /**
     * Inicializa la configuración de la integración
     * @param {HTMLElement} containerElement - Elemento donde se cargará la interfaz de configuración
     */
    async initialize(containerElement) {
        if (!containerElement) {
            logger.error('GaliciaIntegracion: Container element not provided');
            return;
        }

        this.container = containerElement;
        this.loadConfig();
        this.renderConfigurationForm();
        this.attachEventListeners();
    }

    /**
     * Carga la configuración guardada en la base de datos
     * @async
     */
    async loadConfig() {
        try {
            const config = await database.getConfig('banco_galicia');
            
            if (config) {
                this.clientId = config.clientId || '';
                this.clientSecret = config.clientSecret || '';
                this.merchantId = config.merchantId || '';
                this.certificadoPath = config.certificadoPath || '';
                this.ambiente = config.ambiente || 'test';
                this.isConfigured = !!config.clientId && !!config.clientSecret;
                
                // Si estamos en producción, cambiamos la URL base
                if (this.ambiente === 'produccion') {
                    this.baseUrl = 'https://api.bancogalicia.com.ar/v1';
                } else {
                    this.baseUrl = 'https://api-sandbox.bancogalicia.com.ar/v1';
                }
                
                logger.info('GaliciaIntegracion: Configuración cargada correctamente');
            } else {
                logger.warn('GaliciaIntegracion: No se encontró configuración guardada');
                this.isConfigured = false;
            }
        } catch (error) {
            logger.error('GaliciaIntegracion: Error al cargar la configuración', error);
            this.isConfigured = false;
        }
    }

    /**
     * Renderiza el formulario de configuración en el contenedor especificado
     */
    renderConfigurationForm() {
        const formHTML = `
            <div class="banco-config-container">
                <h3>Configuración Banco Galicia</h3>
                
                <div class="status-indicator ${this.isConfigured ? 'configured' : 'not-configured'}">
                    <span class="status-icon"></span>
                    <span class="status-text">${this.isConfigured ? 'Configurado' : 'No configurado'}</span>
                </div>
                
                <div class="loading-indicator" style="display: none;">
                    <div class="spinner"></div>
                    <span>Procesando...</span>
                </div>
                
                <div class="message error-message" style="display: none;"></div>
                <div class="message success-message" style="display: none;"></div>
                
                <form id="galicia-config-form" class="banco-config-form">
                    <div class="form-group">
                        <label for="galicia-ambiente">Ambiente</label>
                        <select id="galicia-ambiente" name="ambiente" class="form-control">
                            <option value="test" ${this.ambiente === 'test' ? 'selected' : ''}>Pruebas (Sandbox)</option>
                            <option value="produccion" ${this.ambiente === 'produccion' ? 'selected' : ''}>Producción</option>
                        </select>
                    </div>
                    
                    <div class="form-group">
                        <label for="galicia-client-id">Client ID</label>
                        <input type="text" id="galicia-client-id" name="clientId" class="form-control" value="${this.clientId || ''}" required>
                        <small class="form-text text-muted">Proporcionado por Banco Galicia para autenticación OAuth</small>
                    </div>
                    
                    <div class="form-group">
                        <label for="galicia-client-secret">Client Secret</label>
                        <input type="password" id="galicia-client-secret" name="clientSecret" class="form-control" value="${this.clientSecret || ''}" required>
                        <small class="form-text text-muted">Clave secreta proporcionada por Banco Galicia</small>
                    </div>
                    
                    <div class="form-group">
                        <label for="galicia-merchant-id">ID de Comercio</label>
                        <input type="text" id="galicia-merchant-id" name="merchantId" class="form-control" value="${this.merchantId || ''}" required>
                        <small class="form-text text-muted">ID único de comercio asignado por Banco Galicia</small>
                    </div>
                    
                    <div class="form-group">
                        <label for="galicia-certificado">Certificado Digital</label>
                        <div class="certificate-selector">
                            <input type="text" id="galicia-certificado-path" class="form-control" value="${this.certificadoPath || ''}" readonly>
                            <button type="button" id="galicia-select-certificate" class="btn btn-secondary">Seleccionar...</button>
                        </div>
                        <small class="form-text text-muted">Certificado digital (.p12) para conexión segura</small>
                    </div>
                    
                    <div class="form-actions">
                        <button type="button" id="galicia-test-connection" class="btn btn-secondary" ${!this.isConfigured ? 'disabled' : ''}>
                            Probar Conexión
                        </button>
                        <button type="submit" id="galicia-save-config" class="btn btn-primary">Guardar Configuración</button>
                    </div>
                </form>
                
                <div class="integration-info">
                    <h4>Información sobre la integración con Banco Galicia</h4>
                    <p>Esta integración le permite:</p>
                    <ul>
                        <li>Consultar saldos y movimientos de cuenta</li>
                        <li>Verificar transferencias recibidas</li>
                        <li>Generar informes de conciliación</li>
                        <li>Vincular pagos con facturas emitidas</li>
                    </ul>
                    <p>Para obtener las credenciales, deberá comunicarse con su ejecutivo de cuenta del Banco Galicia
                       o registrarse como desarrollador en el portal <a href="https://developers.bancogalicia.com.ar" target="_blank">Galicia Developers</a>.</p>
                </div>
            </div>
        `;

        this.container.innerHTML = formHTML;
        
        // Guardar referencias a elementos del DOM
        this.configurationForm = document.getElementById('galicia-config-form');
        this.loadingElement = this.container.querySelector('.loading-indicator');
        this.errorMessageElement = this.container.querySelector('.error-message');
        this.successMessageElement = this.container.querySelector('.success-message');
        this.testConnectionBtn = document.getElementById('galicia-test-connection');
        this.saveConfigBtn = document.getElementById('galicia-save-config');
    }

    /**
     * Adjunta los event listeners a los elementos del formulario
     */
    attachEventListeners() {
        if (!this.configurationForm) return;

        // Botón para seleccionar certificado
        const selectCertificateBtn = document.getElementById('galicia-select-certificate');
        if (selectCertificateBtn) {
            selectCertificateBtn.addEventListener('click', () => this.selectCertificate());
        }

        // Botón para probar conexión
        if (this.testConnectionBtn) {
            this.testConnectionBtn.addEventListener('click', () => this.testConnection());
        }

        // Formulario para guardar configuración
        this.configurationForm.addEventListener('submit', (event) => {
            event.preventDefault();
            this.saveConfiguration();
        });

        // Cambio de ambiente
        const ambienteSelect = document.getElementById('galicia-ambiente');
        if (ambienteSelect) {
            ambienteSelect.addEventListener('change', (event) => {
                this.ambiente = event.target.value;
                if (this.ambiente === 'produccion') {
                    this.baseUrl = 'https://api.bancogalicia.com.ar/v1';
                } else {
                    this.baseUrl = 'https://api-sandbox.bancogalicia.com.ar/v1';
                }
            });
        }
    }

    /**
     * Abre un diálogo para seleccionar el certificado digital
     */
    async selectCertificate() {
        try {
            const result = await ipcRenderer.invoke('open-file-dialog', {
                title: 'Seleccionar Certificado Digital',
                filters: [
                    { name: 'Certificados', extensions: ['p12', 'pfx'] }
                ],
                properties: ['openFile']
            });

            if (!result.canceled && result.filePaths.length > 0) {
                const certificadoPath = result.filePaths[0];
                document.getElementById('galicia-certificado-path').value = certificadoPath;
                this.certificadoPath = certificadoPath;
            }
        } catch (error) {
            logger.error('GaliciaIntegracion: Error al seleccionar certificado', error);
            this.showError('Error al seleccionar el certificado. Inténtelo nuevamente.');
        }
    }

    /**
     * Prueba la conexión con los parámetros actuales
     * @async
     */
    async testConnection() {
        try {
            this.showLoading(true);
            this.clearMessages();

            // Intentar obtener un token de autenticación
            const result = await this.authenticate();
            
            if (result.success) {
                this.showSuccess('Conexión exitosa. La autenticación con Banco Galicia funciona correctamente.');
                this.isConfigured = true;
                if (this.testConnectionBtn) {
                    this.testConnectionBtn.disabled = false;
                }
            } else {
                this.showError(`Error al conectar: ${result.error}`);
            }
        } catch (error) {
            logger.error('GaliciaIntegracion: Error durante la prueba de conexión', error);
            this.showError('Error en la conexión. Verifique sus credenciales e intente nuevamente.');
        } finally {
            this.showLoading(false);
        }
    }

    /**
     * Guarda la configuración en la base de datos
     * @async
     */
    async saveConfiguration() {
        try {
            this.showLoading(true);
            this.clearMessages();

            // Obtener valores del formulario
            const clientId = document.getElementById('galicia-client-id').value;
            const clientSecret = document.getElementById('galicia-client-secret').value;
            const merchantId = document.getElementById('galicia-merchant-id').value;
            const ambiente = document.getElementById('galicia-ambiente').value;

            // Validar campos requeridos
            if (!clientId || !clientSecret || !merchantId) {
                this.showError('Todos los campos son obligatorios.');
                return;
            }

            // Preparar objeto de configuración
            const config = {
                clientId,
                clientSecret,
                merchantId,
                certificadoPath: this.certificadoPath,
                ambiente,
                lastUpdated: new Date().toISOString()
            };

            // Guardar en la base de datos
            await database.saveConfig('banco_galicia', config);

            // Actualizar propiedades
            this.clientId = clientId;
            this.clientSecret = clientSecret;
            this.merchantId = merchantId;
            this.ambiente = ambiente;
            this.isConfigured = true;

            // Actualizar URL base según ambiente
            if (this.ambiente === 'produccion') {
                this.baseUrl = 'https://api.bancogalicia.com.ar/v1';
            } else {
                this.baseUrl = 'https://api-sandbox.bancogalicia.com.ar/v1';
            }

            // Habilitar botón de prueba
            if (this.testConnectionBtn) {
                this.testConnectionBtn.disabled = false;
            }

            // Actualizar indicador de estado
            const statusIndicator = this.container.querySelector('.status-indicator');
            if (statusIndicator) {
                statusIndicator.className = 'status-indicator configured';
                statusIndicator.querySelector('.status-text').textContent = 'Configurado';
            }

            this.showSuccess('Configuración guardada correctamente.');
            logger.info('GaliciaIntegracion: Configuración guardada exitosamente');
        } catch (error) {
            logger.error('GaliciaIntegracion: Error al guardar la configuración', error);
            this.showError('Error al guardar la configuración. Inténtelo nuevamente.');
        } finally {
            this.showLoading(false);
        }
    }

    /**
     * Autentica con la API del Banco Galicia
     * @async
     * @returns {Object} Resultado de la autenticación
     */
    async authenticate() {
        if (!this.clientId || !this.clientSecret) {
            return { success: false, error: 'Faltan credenciales de autenticación' };
        }

        try {
            // Preparar datos para la solicitud OAuth
            const authData = new URLSearchParams();
            authData.append('grant_type', 'client_credentials');
            authData.append('client_id', this.clientId);
            authData.append('client_secret', this.clientSecret);
            authData.append('scope', 'accounts payments');

            // Si el token actual es válido, lo devolvemos directamente
            if (this.accessToken && this.tokenExpirationTime && new Date() < this.tokenExpirationTime) {
                return { success: true, token: this.accessToken };
            }

            // Realizar la solicitud de autenticación
            const response = await fetch(`${this.baseUrl}/oauth2/token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json'
                },
                body: authData
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => null);
                const errorMessage = errorData?.error_description || `Error HTTP ${response.status}`;
                return { success: false, error: errorMessage };
            }

            const tokenData = await response.json();
            
            // Guardar tokens y calcular tiempo de expiración
            this.accessToken = tokenData.access_token;
            this.refreshToken = tokenData.refresh_token;
            
            // Calcular tiempo de expiración (restar 1 minuto para margen de seguridad)
            const expiresInMs = (tokenData.expires_in - 60) * 1000;
            this.tokenExpirationTime = new Date(Date.now() + expiresInMs);
            
            return { success: true, token: this.accessToken };
        } catch (error) {
            logger.error('GaliciaIntegracion: Error durante la autenticación', error);
            return { success: false, error: error.message || 'Error de conexión' };
        }
    }

    /**
     * Consulta el saldo de la cuenta
     * @async
     * @returns {Object} Información del saldo
     */
    async consultarSaldo() {
        try {
            const authResult = await this.authenticate();
            if (!authResult.success) {
                return { success: false, error: authResult.error };
            }

            const response = await fetch(`${this.baseUrl}/accounts/balance`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${authResult.token}`,
                    'Accept': 'application/json',
                    'X-Merchant-ID': this.merchantId
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                return { success: false, error: `Error HTTP ${response.status}: ${errorText}` };
            }

            const saldoData = await response.json();
            return { success: true, data: saldoData };
        } catch (error) {
            logger.error('GaliciaIntegracion: Error al consultar saldo', error);
            return { success: false, error: error.message || 'Error de conexión' };
        }
    }

    /**
     * Consulta los movimientos de la cuenta
     * @async
     * @param {string} fechaDesde - Fecha de inicio (YYYY-MM-DD)
     * @param {string} fechaHasta - Fecha de fin (YYYY-MM-DD)
     * @returns {Object} Lista de movimientos
     */
    async consultarMovimientos(fechaDesde, fechaHasta) {
        try {
            const authResult = await this.authenticate();
            if (!authResult.success) {
                return { success: false, error: authResult.error };
            }

            const params = new URLSearchParams();
            if (fechaDesde) params.append('fromDate', fechaDesde);
            if (fechaHasta) params.append('toDate', fechaHasta);

            const response = await fetch(`${this.baseUrl}/accounts/transactions?${params.toString()}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${authResult.token}`,
                    'Accept': 'application/json',
                    'X-Merchant-ID': this.merchantId
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                return { success: false, error: `Error HTTP ${response.status}: ${errorText}` };
            }

            const movimientosData = await response.json();
            return { success: true, data: movimientosData };
        } catch (error) {
            logger.error('GaliciaIntegracion: Error al consultar movimientos', error);
            return { success: false, error: error.message || 'Error de conexión' };
        }
    }

    /**
     * Verifica si una transferencia ha sido recibida
     * @async
     * @param {string} referencia - Número de referencia o ID de transacción
     * @param {number} monto - Monto esperado de la transferencia
     * @param {string} fechaDesde - Fecha desde la que buscar (YYYY-MM-DD)
     * @returns {Object} Resultado de la verificación
     */
    async verificarTransferencia(referencia, monto, fechaDesde = null) {
        try {
            // Si no hay fecha desde, usar la fecha actual
            if (!fechaDesde) {
                const hoy = new Date();
                fechaDesde = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
            }

            // Consultar movimientos del período
            const movimientosResult = await this.consultarMovimientos(fechaDesde, null);
            if (!movimientosResult.success) {
                return { success: false, error: movimientosResult.error };
            }

            // Buscar la transferencia por referencia y monto
            const transferencia = movimientosResult.data.transactions.find(mov => 
                (mov.reference === referencia || mov.description.includes(referencia)) && 
                parseFloat(mov.amount) === parseFloat(monto) && 
                mov.type === 'CREDIT'
            );

            if (transferencia) {
                return { 
                    success: true, 
                    found: true, 
                    transaction: transferencia 
                };
            } else {
                return { 
                    success: true, 
                    found: false, 
                    message: 'No se encontró la transferencia con los parámetros especificados' 
                };
            }
        } catch (error) {
            logger.error('GaliciaIntegracion: Error al verificar transferencia', error);
            return { success: false, error: error.message || 'Error al verificar la transferencia' };
        }
    }

    /**
     * Genera un informe de conciliación para un rango de fechas
     * @async
     * @param {string} fechaDesde - Fecha de inicio (YYYY-MM-DD)
     * @param {string} fechaHasta - Fecha de fin (YYYY-MM-DD)
     * @returns {Object} Datos del informe de conciliación
     */
    async generarInformeConciliacion(fechaDesde, fechaHasta) {
        try {
            const movimientosResult = await this.consultarMovimientos(fechaDesde, fechaHasta);
            if (!movimientosResult.success) {
                return { success: false, error: movimientosResult.error };
            }

            const movimientos = movimientosResult.data.transactions;

            // Calcular totales
            let totalCreditos = 0;
            let totalDebitos = 0;
            let cantidadCreditos = 0;
            let cantidadDebitos = 0;

            movimientos.forEach(mov => {
                if (mov.type === 'CREDIT') {
                    totalCreditos += parseFloat(mov.amount);
                    cantidadCreditos++;
                } else if (mov.type === 'DEBIT') {
                    totalDebitos += parseFloat(mov.amount);
                    cantidadDebitos++;
                }
            });

            return {
                success: true,
                data: {
                    periodo: {
                        desde: fechaDesde,
                        hasta: fechaHasta
                    },
                    resumen: {
                        totalCreditos,
                        totalDebitos,
                        cantidadCreditos,
                        cantidadDebitos,
                        balance: totalCreditos - totalDebitos
                    },
                    movimientos: movimientos
                }
            };
        } catch (error) {
            logger.error('GaliciaIntegracion: Error al generar informe de conciliación', error);
            return { success: false, error: error.message || 'Error al generar el informe' };
        }
    }

    /**
     * Vincula un pago recibido con una factura emitida
     * @async
     * @param {string} idFactura - ID de la factura en el sistema
     * @param {string} idTransaccion - ID de la transacción bancaria
     * @returns {Object} Resultado de la vinculación
     */
    async vincularPagoConFactura(idFactura, idTransaccion) {
        try {
            // Verificar que exista la factura
            const factura = await database.getFacturaById(idFactura);
            if (!factura) {
                return { success: false, error: 'Factura no encontrada' };
            }

            // Guardar vinculación en la base de datos
            await database.vincularPagoFactura({
                idFactura,
                idTransaccion,
                metodoPago: 'transferencia_galicia',
                fechaVinculacion: new Date().toISOString(),
                estado: 'confirmado'
            });

            // Actualizar estado de la factura
            await database.actualizarEstadoFactura(idFactura, 'pagada');

            logger.info(`GaliciaIntegracion: Pago vinculado con factura ${idFactura}`);
            return { success: true, message: 'Pago vinculado correctamente con la factura' };
        } catch (error) {
            logger.error('GaliciaIntegracion: Error al vincular pago con factura', error);
            return { success: false, error: error.message || 'Error al vincular el pago' };
        }
    }

    /**
     * Muestra el indicador de carga
     * @param {boolean} show - Indica si mostrar u ocultar
     */
    showLoading(show) {
        if (this.loadingElement) {
            this.loadingElement.style.display = show ? 'flex' : 'none';
        }
    }

    /**
     * Muestra un mensaje de error
     * @param {string} message - Mensaje a mostrar
     */
    showError(message) {
        if (this.errorMessageElement) {
            this.errorMessageElement.textContent = message;
            this.errorMessageElement.style.display = 'block';
        }
    }

    /**
     * Muestra un mensaje de éxito
     * @param {string} message - Mensaje a mostrar
     */
    showSuccess(message) {
        if (this.successMessageElement) {
            this.successMessageElement.textContent = message;
            this.successMessageElement.style.display = 'block';
        }
    }

    /**
     * Limpia todos los mensajes
     */
    clearMessages() {
        if (this.errorMessageElement) {
            this.errorMessageElement.style.display = 'none';
        }
        if (this.successMessageElement) {
            this.successMessageElement.style.display = 'none';
        }
    }
}

// Exportar una instancia única
const galiciaIntegracion = new GaliciaIntegracion();
module.exports = galiciaIntegracion;