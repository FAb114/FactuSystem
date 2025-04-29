/**
 * Cliente.js - Gestión de clientes para el módulo de facturación
 * 
 * Este módulo maneja:
 * - Búsqueda rápida de clientes
 * - Creación rápida de clientes desde facturación
 * - Selección de clientes existentes
 * - Integración con la base de datos
 * - Validación de datos fiscales
 */

const { ipcRenderer } = require('electron');
const { db } = require('../../utils/database.js');
const { validateCUIT, validateDNI } = require('../../utils/validation.js');
const { createLogger } = require('../../utils/logger.js');
const { showNotification } = require('../../components/notifications.js');
const { whatsappAPI } = require('../../../integrations/whatsapp/api.js');
const { emailSender } = require('../../../integrations/email/sender.js');

const logger = createLogger('facturador:cliente');

class ClienteManager {
    constructor() {
        this.selectedClient = null;
        this.clientModal = null;
        this.searchResults = [];
        this.lastSearchQuery = '';
        this.currentUser = null;
        this.currentSucursal = null;
        
        // Elementos DOM
        this.clienteInput = null;
        this.clienteResultsList = null;
        this.clienteForm = null;
        
        // Inicializa cuando el DOM esté listo
        document.addEventListener('DOMContentLoaded', () => this.init());
    }

    /**
     * Inicializa el gestor de clientes
     */
    async init() {
        try {
            logger.info('Inicializando módulo de clientes para facturador');
            
            // Obtener usuario y sucursal actuales
            this.currentUser = await this.getCurrentUser();
            this.currentSucursal = await this.getCurrentSucursal();
            
            // Inicializar elementos DOM
            this.initDOMElements();
            
            // Configurar eventos
            this.setupEventListeners();
            
            // Inicializar modal de cliente
            this.initClientModal();
            
            logger.info('Módulo de clientes inicializado correctamente');
        } catch (error) {
            logger.error('Error al inicializar módulo de clientes', error);
            showNotification('Error al inicializar el módulo de clientes', 'error');
        }
    }

    /**
     * Inicializa los elementos DOM necesarios
     */
    initDOMElements() {
        this.clienteInput = document.getElementById('cliente-input');
        this.clienteResultsList = document.getElementById('cliente-results');
        this.clienteForm = document.getElementById('cliente-form');
        
        if (!this.clienteInput || !this.clienteResultsList) {
            throw new Error('No se encontraron los elementos DOM necesarios para el módulo de clientes');
        }
    }

    /**
     * Configura los listeners de eventos
     */
    setupEventListeners() {
        // Input de cliente para búsqueda en tiempo real
        this.clienteInput.addEventListener('input', (e) => this.handleClientSearch(e));
        
        // Tecla Enter en input de cliente sin datos = Consumidor Final
        this.clienteInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                if (!this.clienteInput.value.trim()) {
                    this.setConsumidorFinal();
                } else {
                    // Si hay texto, seleccionar el primer cliente de los resultados
                    if (this.searchResults.length > 0) {
                        this.selectClient(this.searchResults[0]);
                    }
                }
            }
            
            // F1 para abrir modal de nuevo cliente
            if (e.key === 'F1') {
                e.preventDefault();
                this.openNewClientModal();
            }
        });
        
        // Eventos delegados para la lista de resultados
        this.clienteResultsList.addEventListener('click', (e) => {
            const clientItem = e.target.closest('.cliente-item');
            if (clientItem) {
                const clientId = clientItem.dataset.clientId;
                const client = this.searchResults.find(c => c.id === parseInt(clientId));
                if (client) {
                    this.selectClient(client);
                }
            }
        });
        
        // Formulario de nuevo cliente
        if (this.clienteForm) {
            this.clienteForm.addEventListener('submit', (e) => this.handleClientFormSubmit(e));
        }
    }
    
    /**
     * Inicializa el modal de cliente
     */
    initClientModal() {
        // Crear modal dinámicamente si no existe
        if (!document.getElementById('cliente-modal')) {
            const modalHTML = `
                <div id="cliente-modal" class="modal">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h3>Datos del Cliente</h3>
                            <span class="close-modal">&times;</span>
                        </div>
                        <div class="modal-body">
                            <form id="cliente-form">
                                <div class="form-group">
                                    <label for="cliente-tipo-doc">Tipo de Documento</label>
                                    <select id="cliente-tipo-doc" required>
                                        <option value="DNI">DNI</option>
                                        <option value="CUIT">CUIT</option>
                                        <option value="CUIL">CUIL</option>
                                        <option value="PASAPORTE">PASAPORTE</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label for="cliente-doc">Número de Documento</label>
                                    <input type="text" id="cliente-doc" required>
                                    <span class="validation-message" id="doc-validation"></span>
                                </div>
                                <div class="form-group">
                                    <label for="cliente-nombre">Nombre / Razón Social</label>
                                    <input type="text" id="cliente-nombre" required>
                                </div>
                                <div class="form-group">
                                    <label for="cliente-direccion">Dirección</label>
                                    <input type="text" id="cliente-direccion">
                                </div>
                                <div class="form-group">
                                    <label for="cliente-iva">Condición frente al IVA</label>
                                    <select id="cliente-iva" required>
                                        <option value="CF">Consumidor Final</option>
                                        <option value="RI">Responsable Inscripto</option>
                                        <option value="MT">Monotributista</option>
                                        <option value="EX">Exento</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label for="cliente-telefono">Teléfono</label>
                                    <input type="tel" id="cliente-telefono">
                                </div>
                                <div class="form-group">
                                    <label for="cliente-email">Email</label>
                                    <input type="email" id="cliente-email">
                                </div>
                                <div class="form-group">
                                    <label for="cliente-sucursal">Sucursal Asignada</label>
                                    <select id="cliente-sucursal">
                                        <!-- Se cargará dinámicamente -->
                                    </select>
                                </div>
                                <div class="form-actions">
                                    <button type="submit" class="btn btn-primary">Guardar Cliente</button>
                                    <button type="button" class="btn btn-secondary cancel-modal">Cancelar</button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            `;
            
            const modalContainer = document.createElement('div');
            modalContainer.innerHTML = modalHTML;
            document.body.appendChild(modalContainer.firstElementChild);
            
            // Configurar eventos del modal
            const modal = document.getElementById('cliente-modal');
            const closeBtn = modal.querySelector('.close-modal');
            const cancelBtn = modal.querySelector('.cancel-modal');
            
            closeBtn.addEventListener('click', () => this.closeClientModal());
            cancelBtn.addEventListener('click', () => this.closeClientModal());
            
            window.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.closeClientModal();
                }
            });
            
            // Validación en tiempo real del documento
            const docInput = document.getElementById('cliente-doc');
            const tipoDocSelect = document.getElementById('cliente-tipo-doc');
            const docValidation = document.getElementById('doc-validation');
            
            docInput.addEventListener('input', () => {
                const tipoDoc = tipoDocSelect.value;
                const doc = docInput.value;
                
                if (tipoDoc === 'CUIT' || tipoDoc === 'CUIL') {
                    if (!validateCUIT(doc)) {
                        docValidation.textContent = 'CUIT/CUIL inválido';
                        docValidation.classList.add('error');
                    } else {
                        docValidation.textContent = 'CUIT/CUIL válido';
                        docValidation.classList.remove('error');
                        docValidation.classList.add('success');
                    }
                } else if (tipoDoc === 'DNI') {
                    if (!validateDNI(doc)) {
                        docValidation.textContent = 'DNI inválido';
                        docValidation.classList.add('error');
                    } else {
                        docValidation.textContent = 'DNI válido';
                        docValidation.classList.remove('error');
                        docValidation.classList.add('success');
                    }
                } else {
                    docValidation.textContent = '';
                }
            });
            
            // Actualizar validación cuando cambia el tipo de documento
            tipoDocSelect.addEventListener('change', () => {
                docInput.dispatchEvent(new Event('input'));
            });
            
            // Cargar sucursales
            this.loadSucursales();
            
            this.clientModal = modal;
            this.clienteForm = document.getElementById('cliente-form');
            
            // Evento para el formulario
            this.clienteForm.addEventListener('submit', (e) => this.handleClientFormSubmit(e));
        }
    }

    /**
     * Carga las sucursales disponibles en el select
     */
    async loadSucursales() {
        try {
            const sucursalSelect = document.getElementById('cliente-sucursal');
            if (!sucursalSelect) return;
            
            // Limpiar opciones existentes
            sucursalSelect.innerHTML = '';
            
            // Obtener sucursales de la base de datos
            const sucursales = await db.sucursales.toArray();
            
            // Crear opción por defecto (sucursal actual)
            const defaultOption = document.createElement('option');
            defaultOption.value = this.currentSucursal.id;
            defaultOption.textContent = `${this.currentSucursal.nombre} (Actual)`;
            sucursalSelect.appendChild(defaultOption);
            
            // Agregar el resto de sucursales
            sucursales.forEach(sucursal => {
                if (sucursal.id !== this.currentSucursal.id) {
                    const option = document.createElement('option');
                    option.value = sucursal.id;
                    option.textContent = sucursal.nombre;
                    sucursalSelect.appendChild(option);
                }
            });
        } catch (error) {
            logger.error('Error al cargar sucursales', error);
        }
    }

    /**
     * Abre el modal para crear un nuevo cliente
     */
    openNewClientModal() {
        // Resetear el formulario
        if (this.clienteForm) {
            this.clienteForm.reset();
            
            // Establecer sucursal actual por defecto
            const sucursalSelect = document.getElementById('cliente-sucursal');
            if (sucursalSelect && this.currentSucursal) {
                sucursalSelect.value = this.currentSucursal.id;
            }
        }
        
        // Mostrar el modal
        if (this.clientModal) {
            this.clientModal.style.display = 'block';
        }
    }

    /**
     * Cierra el modal de cliente
     */
    closeClientModal() {
        if (this.clientModal) {
            this.clientModal.style.display = 'none';
        }
    }

    /**
     * Maneja el envío del formulario de nuevo cliente
     */
    async handleClientFormSubmit(e) {
        e.preventDefault();
        
        try {
            // Obtener datos del formulario
            const tipoDoc = document.getElementById('cliente-tipo-doc').value;
            const numeroDoc = document.getElementById('cliente-doc').value;
            const nombre = document.getElementById('cliente-nombre').value;
            const direccion = document.getElementById('cliente-direccion').value;
            const condicionIVA = document.getElementById('cliente-iva').value;
            const telefono = document.getElementById('cliente-telefono').value;
            const email = document.getElementById('cliente-email').value;
            const sucursalId = parseInt(document.getElementById('cliente-sucursal').value);
            
            // Validaciones básicas
            if (!nombre || !numeroDoc) {
                showNotification('Por favor complete los campos obligatorios', 'warning');
                return;
            }
            
            // Validar documento según tipo
            if ((tipoDoc === 'CUIT' || tipoDoc === 'CUIL') && !validateCUIT(numeroDoc)) {
                showNotification('El CUIT/CUIL ingresado no es válido', 'error');
                return;
            }
            
            if (tipoDoc === 'DNI' && !validateDNI(numeroDoc)) {
                showNotification('El DNI ingresado no es válido', 'error');
                return;
            }
            
            // Verificar si ya existe un cliente con ese documento
            const existingClient = await db.clientes
                .where('numeroDocumento')
                .equals(numeroDoc)
                .first();
                
            if (existingClient) {
                // Confirmar si desea seleccionar el cliente existente
                if (confirm(`Ya existe un cliente con ese ${tipoDoc}. ¿Desea seleccionarlo?`)) {
                    this.selectClient(existingClient);
                    this.closeClientModal();
                    return;
                }
                return; // Si no confirma, no hacer nada
            }
            
            // Crear objeto de cliente
            const nuevoCliente = {
                tipoDocumento: tipoDoc,
                numeroDocumento: numeroDoc,
                nombre: nombre,
                direccion: direccion || '',
                condicionIVA: condicionIVA,
                telefono: telefono || '',
                email: email || '',
                sucursalId: sucursalId,
                fechaAlta: new Date(),
                usuarioAlta: this.currentUser.id,
                puntosFidelidad: 0, // Sistema de fidelización
                activo: true
            };
            
            // Guardar en la base de datos
            const clientId = await db.clientes.add(nuevoCliente);
            
            // Recuperar el cliente con su ID
            const clienteCreado = await db.clientes.get(clientId);
            
            logger.info(`Cliente creado: ${clientId} - ${nombre}`);
            
            // Notificar al usuario
            showNotification(`Cliente "${nombre}" creado exitosamente`, 'success');
            
            // Seleccionar el cliente recién creado
            this.selectClient(clienteCreado);
            
            // Cerrar el modal
            this.closeClientModal();
            
            // Disparar evento de cliente creado
            const event = new CustomEvent('cliente:created', { 
                detail: { cliente: clienteCreado } 
            });
            document.dispatchEvent(event);
            
        } catch (error) {
            logger.error('Error al crear cliente', error);
            showNotification('Error al crear el cliente', 'error');
        }
    }

    /**
     * Maneja la búsqueda de clientes en tiempo real
     */
    async handleClientSearch(e) {
        const query = e.target.value.trim();
        
        // No buscar si el texto es el mismo que la última búsqueda
        if (query === this.lastSearchQuery) return;
        
        this.lastSearchQuery = query;
        
        // Limpiar resultados si no hay texto
        if (!query) {
            this.searchResults = [];
            this.renderSearchResults();
            return;
        }
        
        try {
            // Buscar en la base de datos
            this.searchResults = await db.clientes
                .where('nombre')
                .startsWithIgnoreCase(query)
                .or('numeroDocumento')
                .startsWithIgnoreCase(query)
                .limit(5)
                .toArray();
                
            // Renderizar resultados
            this.renderSearchResults();
        } catch (error) {
            logger.error('Error al buscar clientes', error);
        }
    }

    /**
     * Renderiza los resultados de búsqueda
     */
    renderSearchResults() {
        // Limpiar resultados anteriores
        this.clienteResultsList.innerHTML = '';
        
        if (this.searchResults.length === 0) {
            // Ocultar si no hay resultados
            this.clienteResultsList.classList.remove('active');
            return;
        }
        
        // Mostrar contenedor de resultados
        this.clienteResultsList.classList.add('active');
        
        // Crear elementos para cada cliente
        this.searchResults.forEach(cliente => {
            const item = document.createElement('div');
            item.className = 'cliente-item';
            item.dataset.clientId = cliente.id;
            
            item.innerHTML = `
                <div class="cliente-info">
                    <div class="cliente-nombre">${cliente.nombre}</div>
                    <div class="cliente-doc">${cliente.tipoDocumento}: ${cliente.numeroDocumento}</div>
                </div>
                <div class="cliente-fiscal">${this.getCondicionIVALabel(cliente.condicionIVA)}</div>
            `;
            
            this.clienteResultsList.appendChild(item);
        });
    }

    /**
     * Obtiene la etiqueta para una condición de IVA
     */
    getCondicionIVALabel(condicion) {
        const condiciones = {
            'CF': 'Consumidor Final',
            'RI': 'Resp. Inscripto',
            'MT': 'Monotributista',
            'EX': 'Exento'
        };
        
        return condiciones[condicion] || condicion;
    }

    /**
     * Selecciona un cliente
     */
    selectClient(client) {
        // Guardar el cliente seleccionado
        this.selectedClient = client;
        
        // Actualizar el input con el nombre del cliente
        if (this.clienteInput) {
            this.clienteInput.value = client.nombre;
        }
        
        // Ocultar resultados
        if (this.clienteResultsList) {
            this.clienteResultsList.classList.remove('active');
        }
        
        // Disparar evento de cliente seleccionado
        const event = new CustomEvent('cliente:selected', { 
            detail: { cliente: client } 
        });
        document.dispatchEvent(event);
        
        logger.info(`Cliente seleccionado: ${client.id} - ${client.nombre}`);
    }

    /**
     * Establece el cliente como Consumidor Final
     */
    setConsumidorFinal() {
        const consumidorFinal = {
            id: 0,
            tipoDocumento: 'DNI',
            numeroDocumento: '0',
            nombre: 'Consumidor Final',
            direccion: '',
            condicionIVA: 'CF',
            telefono: '',
            email: '',
            sucursalId: this.currentSucursal ? this.currentSucursal.id : 1
        };
        
        this.selectClient(consumidorFinal);
    }

    /**
     * Obtiene el cliente seleccionado actualmente
     */
    getSelectedClient() {
        return this.selectedClient;
    }

    /**
     * Limpia la selección de cliente actual
     */
    clearSelectedClient() {
        this.selectedClient = null;
        
        if (this.clienteInput) {
            this.clienteInput.value = '';
        }
    }

    /**
     * Obtiene el usuario actual desde la base de datos o localStorage
     */
    async getCurrentUser() {
        try {
            // Intentar obtener del localStorage primero
            const userIdString = localStorage.getItem('currentUserId');
            
            if (!userIdString) {
                throw new Error('No hay usuario logueado');
            }
            
            const userId = parseInt(userIdString);
            
            // Obtener detalles del usuario
            const user = await db.usuarios.get(userId);
            
            if (!user) {
                throw new Error('Usuario no encontrado');
            }
            
            return user;
        } catch (error) {
            logger.error('Error al obtener usuario actual', error);
            return null;
        }
    }

    /**
     * Obtiene la sucursal actual desde la base de datos o localStorage
     */
    async getCurrentSucursal() {
        try {
            // Intentar obtener del localStorage primero
            const sucursalIdString = localStorage.getItem('currentSucursalId');
            
            if (!sucursalIdString) {
                throw new Error('No hay sucursal seleccionada');
            }
            
            const sucursalId = parseInt(sucursalIdString);
            
            // Obtener detalles de la sucursal
            const sucursal = await db.sucursales.get(sucursalId);
            
            if (!sucursal) {
                throw new Error('Sucursal no encontrada');
            }
            
            return sucursal;
        } catch (error) {
            logger.error('Error al obtener sucursal actual', error);
            return null;
        }
    }
    
    /**
     * Verifica si un cliente tiene facturas pendientes
     */
    async checkPendingInvoices(clientId) {
        try {
            const pendingInvoices = await db.facturas
                .where('clienteId')
                .equals(clientId)
                .and(factura => factura.pagado === false)
                .count();
                
            return pendingInvoices > 0;
        } catch (error) {
            logger.error('Error al verificar facturas pendientes', error);
            return false;
        }
    }
    
    /**
     * Envía un comprobante al cliente vía WhatsApp
     */
    async sendInvoiceByWhatsApp(clientId, invoiceId) {
        try {
            // Obtener cliente
            const cliente = await db.clientes.get(clientId);
            
            if (!cliente || !cliente.telefono) {
                showNotification('El cliente no tiene un teléfono registrado', 'warning');
                return false;
            }
            
            // Obtener factura
            const factura = await db.facturas.get(invoiceId);
            
            if (!factura) {
                showNotification('Factura no encontrada', 'error');
                return false;
            }
            
            // Generar PDF de la factura (esto dependerá de cómo manejes los PDFs)
            const pdfPath = await this.generateInvoicePDF(factura);
            
            // Enviar por WhatsApp
            const message = `Hola ${cliente.nombre}! Adjuntamos su comprobante de compra #${factura.numero}. Gracias por su compra!`;
            
            const sent = await whatsappAPI.sendDocument(
                cliente.telefono,
                pdfPath,
                message
            );
            
            if (sent) {
                showNotification('Comprobante enviado por WhatsApp exitosamente', 'success');
                
                // Registrar el envío
                await db.enviosDocumentos.add({
                    clienteId: clientId,
                    facturaId: invoiceId,
                    medio: 'whatsapp',
                    fechaEnvio: new Date(),
                    usuarioId: this.currentUser.id,
                    estado: 'enviado'
                });
                
                return true;
            } else {
                showNotification('No se pudo enviar el comprobante por WhatsApp', 'error');
                return false;
            }
        } catch (error) {
            logger.error('Error al enviar comprobante por WhatsApp', error);
            showNotification('Error al enviar comprobante por WhatsApp', 'error');
            return false;
        }
    }
    
    /**
     * Envía un comprobante al cliente vía Email
     */
    async sendInvoiceByEmail(clientId, invoiceId) {
        try {
            // Obtener cliente
            const cliente = await db.clientes.get(clientId);
            
            if (!cliente || !cliente.email) {
                showNotification('El cliente no tiene un email registrado', 'warning');
                return false;
            }
            
            // Obtener factura
            const factura = await db.facturas.get(invoiceId);
            
            if (!factura) {
                showNotification('Factura no encontrada', 'error');
                return false;
            }
            
            // Generar PDF de la factura
            const pdfPath = await this.generateInvoicePDF(factura);
            
            // Obtener datos de empresa
            const empresaConfig = await this.getEmpresaConfig();
            
            // Enviar por Email
            const emailData = {
                to: cliente.email,
                subject: `Comprobante de compra #${factura.numero} - ${empresaConfig.nombreComercial}`,
                template: 'invoice',
                context: {
                    clientName: cliente.nombre,
                    invoiceNumber: factura.numero,
                    invoiceDate: factura.fecha.toLocaleDateString(),
                    totalAmount: factura.total.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' }),
                    businessName: empresaConfig.nombreComercial
                },
                attachments: [
                    {
                        filename: `Comprobante_${factura.tipo}${factura.numero}.pdf`,
                        path: pdfPath
                    }
                ]
            };
            
            const sent = await emailSender.send(emailData);
            
            if (sent) {
                showNotification('Comprobante enviado por email exitosamente', 'success');
                
                // Registrar el envío
                await db.enviosDocumentos.add({
                    clienteId: clientId,
                    facturaId: invoiceId,
                    medio: 'email',
                    fechaEnvio: new Date(),
                    usuarioId: this.currentUser.id,
                    estado: 'enviado'
                });
                
                return true;
            } else {
                showNotification('No se pudo enviar el comprobante por email', 'error');
                return false;
            }
        } catch (error) {
            logger.error('Error al enviar comprobante por email', error);
            showNotification('Error al enviar comprobante por email', 'error');
            return false;
        }
    }
    
    /**
     * Genera un PDF de factura (ejemplo básico)
     * En la implementación real, esto debería usar el servicio de impresión
     */
    async generateInvoicePDF(factura) {
        try {
            // Esta es una versión simplificada
            // En un caso real, se usaría el servicio de impresión
            const pdfData = {
                facturaId: factura.id,
                tipo: factura.tipo,
                formato: 'A4' // o 'ticket'
            };
            
            // Utilizar IPC para comunicarse con el proceso principal de Electron
            const pdfPath = await ipcRenderer.invoke('print:invoice-to-pdf', pdfData);
            
            return pdfPath;
        } catch (error) {
            logger.error('Error al generar PDF', error);
            throw error;
        }
    }
    
    /**
     * Obtiene la configuración de la empresa
     */
    async getEmpresaConfig() {
        try {
            const config = await db.configuracion
                .where('tipo')
                .equals('empresa')
                .first();
                
            return config || {
                nombreComercial: 'Mi Empresa',
                razonSocial: 'Mi Empresa S.A.',
                cuit: '30000000000'
            };
        } catch (error) {
            logger.error('Error al obtener configuración de empresa', error);
            return {
                nombreComercial: 'Mi Empresa',
                razonSocial: 'Mi Empresa S.A.',
                cuit: '30000000000'
            };
        }
    }
    
    /**
     * Actualiza los puntos de fidelidad de un cliente
     */
    async updateClientLoyaltyPoints(clientId, amount) {
        try {
            if (clientId === 0) return; // No actualizar para Consumidor Final
            
            // Obtener cliente
            const cliente = await db.clientes.get(clientId);
            
            if (!cliente) return;
            
            // Obtener configuración de fidelización
            const fidelizacionConfig = await db.configuracion
                .where('tipo')
                .equals('fidelizacion')
                .first();
                
            if (!fidelizacionConfig || !fidelizacionConfig.activo) return;
            
            // Calcular puntos según la configuración
            // Por ejemplo: 1 punto por cada $100 gastados
            const puntosBase = fidelizacionConfig.puntosBase || 1;
            const montoPorPunto = fidelizacionConfig.montoPorPunto || 100;
            
            const puntosGanados = Math.floor((amount / montoPorPunto) * puntosBase);
            
            // Actualizar puntos
            const nuevoPuntos = cliente.puntosFidelidad + puntosGanados;
            
            await db.clientes.update(clientId, {
                puntosFidelidad: nuevoPuntos
            });
            
            logger.info(`Puntos de fidelidad actualizados para cliente ${clientId}: +${puntosGanados} (Total: ${nuevoPuntos})`);
            
            // Si alcanzó cierto umbral, mostrar notificación
            if (fidelizacionConfig.umbralNotificacion && 
                nuevoPuntos >= fidelizacionConfig.umbralNotificacion && 
                nuevoPuntos - puntosGanados < fidelizacionConfig.umbralNotificacion) {
                
                showNotification(`¡El cliente ${cliente.nombre} ha alcanzado ${nuevoPuntos} puntos de fidelidad! Puede canjearlos por descuentos.`, 'info');
                
                // Registrar notificación de fidelización
                await db.notificacionesCliente.add({
                    clienteId: clientId,
                    tipo: 'fidelizacion',
                    mensaje: `Ha alcanzado ${nuevoPuntos} puntos de fidelidad. Puede canjearlos por descuentos.`,
                    fecha: new Date(),
                    leido: false
                });
            }
            
            return nuevoPuntos;
        } catch (error) {
            logger.error('Error al actualizar puntos de fidelidad', error);
            return null;
        }
    }
    
    /**
     * Verificar si un cliente tiene descuentos disponibles por fidelidad
     */
    async checkClientLoyaltyDiscounts(clientId) {
        if (clientId === 0) return null; // No aplicar para Consumidor Final
        
        try {
            // Obtener cliente
            const cliente = await db.clientes.get(clientId);
            
            if (!cliente) return null;
            
            // Obtener configuración de fidelización
            const fidelizacionConfig = await db.configuracion
                .where('tipo')
                .equals('fidelizacion')
                .first();
                
            if (!fidelizacionConfig || !fidelizacionConfig.activo) return null;
            
            // Si no tiene suficientes puntos para un descuento mínimo
            if (cliente.puntosFidelidad < fidelizacionConfig.puntosMinimosDescuento) {
                return null;
            }
            
            // Calcular descuento disponible
            const porcentajeDescuento = Math.min(
                (cliente.puntosFidelidad / fidelizacionConfig.puntosPorPorcentaje) * fidelizacionConfig.porcentajePorRango,
                fidelizacionConfig.porcentajeMaximo
            );
            
            // Redondear a 2 decimales
            const descuentoRedondeado = Math.floor(porcentajeDescuento * 100) / 100;
            
            return {
                clienteId: clientId,
                puntos: cliente.puntosFidelidad,
                porcentajeDescuento: descuentoRedondeado,
                puntosNecesarios: {
                    total: cliente.puntosFidelidad,
                    minimos: fidelizacionConfig.puntosMinimosDescuento
                }
            };
        } catch (error) {
            logger.error('Error al verificar descuentos por fidelidad', error);
            return null;
        }
    }
    
    /**
     * Aplicar descuento por fidelidad
     */
    async applyLoyaltyDiscount(clientId, invoiceId, percentageToApply) {
        try {
            if (clientId === 0) return false; // No aplicar para Consumidor Final
            
            // Obtener cliente
            const cliente = await db.clientes.get(clientId);
            
            if (!cliente) return false;
            
            // Obtener configuración de fidelización
            const fidelizacionConfig = await db.configuracion
                .where('tipo')
                .equals('fidelizacion')
                .first();
                
            if (!fidelizacionConfig || !fidelizacionConfig.activo) return false;
            
            // Calcular puntos a descontar
            const puntosNecesarios = Math.ceil(
                (percentageToApply / fidelizacionConfig.porcentajePorRango) * 
                fidelizacionConfig.puntosPorPorcentaje
            );
            
            // Verificar si tiene suficientes puntos
            if (cliente.puntosFidelidad < puntosNecesarios) {
                showNotification(`El cliente no tiene suficientes puntos para aplicar ${percentageToApply}% de descuento`, 'warning');
                return false;
            }
            
            // Actualizar puntos del cliente
            await db.clientes.update(clientId, {
                puntosFidelidad: cliente.puntosFidelidad - puntosNecesarios
            });
            
            // Registrar el uso de puntos
            await db.movimientosPuntos.add({
                clienteId: clientId,
                facturaId: invoiceId,
                puntos: -puntosNecesarios,
                tipo: 'uso',
                descripcion: `Descuento ${percentageToApply}% en factura`,
                fecha: new Date(),
                usuarioId: this.currentUser.id
            });
            
            logger.info(`Descuento por fidelidad aplicado: ${percentageToApply}% para cliente ${clientId}, factura ${invoiceId}`);
            
            return {
                applied: true,
                discountPercentage: percentageToApply,
                pointsUsed: puntosNecesarios,
                remainingPoints: cliente.puntosFidelidad - puntosNecesarios
            };
        } catch (error) {
            logger.error('Error al aplicar descuento por fidelidad', error);
            return false;
        }
    }
    
    /**
     * Verificar si es el cumpleaños del cliente para aplicar descuento automático
     */
    async checkBirthdayDiscount(clientId) {
        if (clientId === 0) return null; // No aplicar para Consumidor Final
        
        try {
            // Obtener cliente
            const cliente = await db.clientes.get(clientId);
            
            if (!cliente || !cliente.fechaNacimiento) return null;
            
            // Convertir a Date
            const fechaNacimiento = new Date(cliente.fechaNacimiento);
            const hoy = new Date();
            
            // Verificar si es el cumpleaños (mismo mes y día)
            const esCumpleanos = 
                fechaNacimiento.getDate() === hoy.getDate() && 
                fechaNacimiento.getMonth() === hoy.getMonth();
                
            if (!esCumpleanos) return null;
            
            // Obtener configuración de fidelización
            const fidelizacionConfig = await db.configuracion
                .where('tipo')
                .equals('fidelizacion')
                .first();
                
            if (!fidelizacionConfig || !fidelizacionConfig.activoCumpleanos) return null;
            
            // Verificar si ya se aplicó descuento de cumpleaños este año
            const yaAplicado = await db.movimientosPuntos
                .where('clienteId')
                .equals(clientId)
                .and(item => 
                    item.tipo === 'cumpleanos' && 
                    item.fecha.getFullYear() === hoy.getFullYear()
                )
                .count() > 0;
                
            if (yaAplicado) return null;
            
            // Retornar información del descuento de cumpleaños
            return {
                clienteId: clientId,
                nombre: cliente.nombre,
                porcentajeDescuento: fidelizacionConfig.porcentajeCumpleanos || 10,
                mensaje: `¡Hoy es el cumpleaños de ${cliente.nombre}! Se aplicará un descuento automático del ${fidelizacionConfig.porcentajeCumpleanos || 10}%`
            };
        } catch (error) {
            logger.error('Error al verificar descuento de cumpleaños', error);
            return null;
        }
    }
    
    /**
     * Aplicar descuento de cumpleaños
     */
    async applyBirthdayDiscount(clientId, invoiceId) {
        try {
            const birthdayInfo = await this.checkBirthdayDiscount(clientId);
            
            if (!birthdayInfo) return false;
            
            // Registrar el uso del descuento de cumpleaños
            await db.movimientosPuntos.add({
                clienteId: clientId,
                facturaId: invoiceId,
                puntos: 0, // No consume puntos
                tipo: 'cumpleanos',
                descripcion: `Descuento cumpleaños ${birthdayInfo.porcentajeDescuento}%`,
                fecha: new Date(),
                usuarioId: this.currentUser.id
            });
            
            logger.info(`Descuento de cumpleaños aplicado: ${birthdayInfo.porcentajeDescuento}% para cliente ${clientId}, factura ${invoiceId}`);
            
            return {
                applied: true,
                discountPercentage: birthdayInfo.porcentajeDescuento,
                isBirthday: true
            };
        } catch (error) {
            logger.error('Error al aplicar descuento de cumpleaños', error);
            return false;
        }
    }
    
    /**
     * Buscar clientes por diversos criterios para el modal de búsqueda avanzada
     */
    async searchClientsAdvanced(criterios) {
        try {
            let query = db.clientes.where('activo').equals(true);
            
            // Aplicar criterios de búsqueda
            if (criterios.nombre) {
                query = query.filter(cliente => 
                    cliente.nombre.toLowerCase().includes(criterios.nombre.toLowerCase())
                );
            }
            
            if (criterios.documento) {
                query = query.filter(cliente => 
                    cliente.numeroDocumento.includes(criterios.documento)
                );
            }
            
            if (criterios.tipoDocumento) {
                query = query.filter(cliente => 
                    cliente.tipoDocumento === criterios.tipoDocumento
                );
            }
            
            if (criterios.condicionIVA) {
                query = query.filter(cliente => 
                    cliente.condicionIVA === criterios.condicionIVA
                );
            }
            
            if (criterios.sucursalId) {
                query = query.filter(cliente => 
                    cliente.sucursalId === criterios.sucursalId
                );
            }
            
            // Ordenar resultados
            let resultados = await query.toArray();
            
            // Ordenar según el criterio especificado
            if (criterios.ordenarPor) {
                const campo = criterios.ordenarPor;
                const direccion = criterios.ordenDireccion || 'asc';
                
                resultados.sort((a, b) => {
                    if (direccion === 'asc') {
                        return a[campo] > b[campo] ? 1 : -1;
                    } else {
                        return a[campo] < b[campo] ? 1 : -1;
                    }
                });
            }
            
            // Limitar resultados si se especifica
            if (criterios.limite) {
                resultados = resultados.slice(0, criterios.limite);
            }
            
            return resultados;
        } catch (error) {
            logger.error('Error en búsqueda avanzada de clientes', error);
            return [];
        }
    }
    
    /**
     * Obtiene los detalles completos de un cliente, incluyendo estadísticas
     */
    async getClientDetails(clientId) {
        if (clientId === 0) return null; // No aplicar para Consumidor Final
        
        try {
            // Obtener datos básicos del cliente
            const cliente = await db.clientes.get(clientId);
            
            if (!cliente) return null;
            
            // Obtener estadísticas del cliente
            const totalFacturas = await db.facturas
                .where('clienteId')
                .equals(clientId)
                .count();
                
            const totalGastado = await db.facturas
                .where('clienteId')
                .equals(clientId)
                .toArray()
                .then(facturas => 
                    facturas.reduce((suma, factura) => suma + factura.total, 0)
                );
                
            const ultimaCompra = await db.facturas
                .where('clienteId')
                .equals(clientId)
                .reverse()
                .first();
                
            const facturasPendientes = await db.facturas
                .where('clienteId')
                .equals(clientId)
                .and(factura => factura.pagado === false)
                .count();
                
            // Calcular frecuencia de compra
            const todasLasFacturas = await db.facturas
                .where('clienteId')
                .equals(clientId)
                .toArray();
                
            let frecuenciaCompra = null;
            
            if (todasLasFacturas.length >= 2) {
                // Ordenar por fecha
                todasLasFacturas.sort((a, b) => a.fecha - b.fecha);
                
                // Calcular diferencia de tiempo entre compras
                let sumaDias = 0;
                for (let i = 1; i < todasLasFacturas.length; i++) {
                    const diffTime = Math.abs(todasLasFacturas[i].fecha - todasLasFacturas[i-1].fecha);
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                    sumaDias += diffDays;
                }
                
                frecuenciaCompra = {
                    diasPromedio: Math.round(sumaDias / (todasLasFacturas.length - 1)),
                    comprasPorMes: Math.round((30 / (sumaDias / (todasLasFacturas.length - 1))) * 100) / 100
                };
            }
            
            // Productos más comprados
            const productosFacturados = await db.detallesFactura
                .where('facturaId')
                .anyOf(todasLasFacturas.map(f => f.id))
                .toArray();
                
            const productosPorCantidad = {};
            for (const detalle of productosFacturados) {
                if (!productosPorCantidad[detalle.productoId]) {
                    productosPorCantidad[detalle.productoId] = {
                        cantidad: 0,
                        total: 0
                    };
                }
                productosPorCantidad[detalle.productoId].cantidad += detalle.cantidad;
                productosPorCantidad[detalle.productoId].total += detalle.subtotal;
            }
            
            // Obtener los 5 productos más comprados
            const topProductosIds = Object.keys(productosPorCantidad)
                .sort((a, b) => productosPorCantidad[b].cantidad - productosPorCantidad[a].cantidad)
                .slice(0, 5);
                
            const productosMasComprados = await Promise.all(
                topProductosIds.map(async id => {
                    const producto = await db.productos.get(parseInt(id));
                    return {
                        id: parseInt(id),
                        nombre: producto ? producto.nombre : 'Producto desconocido',
                        cantidad: productosPorCantidad[id].cantidad,
                        total: productosPorCantidad[id].total
                    };
                })
            );
            
            // Armar objeto con todos los detalles
            return {
                cliente: cliente,
                estadisticas: {
                    totalFacturas,
                    totalGastado,
                    ultimaCompra: ultimaCompra ? ultimaCompra.fecha : null,
                    facturasPendientes,
                    frecuenciaCompra,
                    productosMasComprados,
                    puntosFidelidad: cliente.puntosFidelidad || 0
                }
            };
        } catch (error) {
            logger.error('Error al obtener detalles del cliente', error);
            return null;
        }
    }
    
    /**
     * Exporta datos de clientes para el módulo de facturación
     */
    getClientExportData() {
        return {
            selectedClient: this.selectedClient,
            setConsumidorFinal: this.setConsumidorFinal.bind(this),
            selectClient: this.selectClient.bind(this),
            clearSelectedClient: this.clearSelectedClient.bind(this),
            openNewClientModal: this.openNewClientModal.bind(this),
            checkClientLoyaltyDiscounts: this.checkClientLoyaltyDiscounts.bind(this),
            applyLoyaltyDiscount: this.applyLoyaltyDiscount.bind(this),
            checkBirthdayDiscount: this.checkBirthdayDiscount.bind(this),
            applyBirthdayDiscount: this.applyBirthdayDiscount.bind(this),
            updateClientLoyaltyPoints: this.updateClientLoyaltyPoints.bind(this)
        };
    }
}

// Exportar una instancia única para uso en el módulo de facturación
const clienteManager = new ClienteManager();
 clienteManager

module.exports = clienteManager;