/**
 * Módulo de Soporte Técnico
 * Gestiona las funcionalidades de soporte y ayuda para FactuSystem
 * 
 * @module Soporte
 * @author FactuSystem
 * @version 1.0
 */

const { showLoading, hideLoading, showMessage } = require('../../utils/ui.js');
const { API } = require('../../services/api.js');
const { Validation } = require('../../utils/validation.js');

class Soporte
module.exports.Soporte = Soporte {
    constructor() {
        this.api = new API();
        this.validation = new Validation();
        this.initEvents();
    }

    /**
     * Inicializa los eventos del módulo
     */
    initEvents() {
        // Evento para enviar ticket de soporte
        document.querySelector('#formSoporte')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.enviarTicketSoporte();
        });

        // Evento para mostrar FAQ
        document.querySelector('#btnFAQ')?.addEventListener('click', () => {
            this.mostrarFAQ();
        });

        // Evento para buscar en la base de conocimientos
        document.querySelector('#formBuscarAyuda')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.buscarAyuda();
        });

        // Evento para mostrar historial de tickets
        document.querySelector('#btnHistorialTickets')?.addEventListener('click', () => {
            this.cargarHistorialTickets();
        });
    }

    /**
     * Envía un nuevo ticket de soporte técnico
     */
    async enviarTicketSoporte() {
        try {
            const formData = new FormData(document.querySelector('#formSoporte'));
            
            // Validaciones
            const asunto = formData.get('asunto');
            const descripcion = formData.get('descripcion');
            const prioridad = formData.get('prioridad');
            const categoria = formData.get('categoria');
            
            if (!this.validation.isNotEmpty(asunto)) {
                return showMessage('Debe ingresar un asunto', 'error');
            }
            
            if (!this.validation.isNotEmpty(descripcion)) {
                return showMessage('Debe ingresar una descripción', 'error');
            }

            if (!this.validation.isNotEmpty(prioridad)) {
                return showMessage('Debe seleccionar una prioridad', 'error');
            }

            if (!this.validation.isNotEmpty(categoria)) {
                return showMessage('Debe seleccionar una categoría', 'error');
            }
            
            // Procesar archivos adjuntos si existen
            const archivo = formData.get('archivo');
            if (archivo && archivo.name) {
                const validExtensions = ['jpg', 'png', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt'];
                const extension = archivo.name.split('.').pop().toLowerCase();
                
                if (!validExtensions.includes(extension)) {
                    return showMessage('Formato de archivo no permitido. Formatos permitidos: jpg, png, pdf, doc, docx, xls, xlsx, txt', 'error');
                }
                
                if (archivo.size > 5242880) { // 5MB en bytes
                    return showMessage('El archivo no debe superar los 5MB', 'error');
                }
            }
            
            showLoading();
            
            const response = await this.api.post('soporte/ticket', formData);
            
            if (response.success) {
                document.querySelector('#formSoporte').reset();
                showMessage('Ticket enviado correctamente. Nos pondremos en contacto a la brevedad.', 'success');
                
                // Actualizar la lista de tickets si está visible
                if (document.querySelector('#historialTickets').style.display !== 'none') {
                    this.cargarHistorialTickets();
                }
            } else {
                showMessage(response.message || 'Error al enviar el ticket de soporte', 'error');
            }
        } catch (error) {
            console.error('Error al enviar ticket de soporte:', error);
            showMessage('Ocurrió un error al procesar la solicitud', 'error');
        } finally {
            hideLoading();
        }
    }

    /**
     * Carga y muestra las preguntas frecuentes
     */
    async mostrarFAQ() {
        try {
            showLoading();
            
            const faqContainer = document.querySelector('#faqContainer');
            if (!faqContainer) return;
            
            const response = await this.api.get('soporte/faq');
            
            if (response.success && response.data) {
                let html = '<div class="accordion" id="accordionFAQ">';
                
                response.data.forEach((faq, index) => {
                    html += `
                        <div class="accordion-item">
                            <h2 class="accordion-header">
                                <button class="accordion-button ${index > 0 ? 'collapsed' : ''}" type="button" data-bs-toggle="collapse" data-bs-target="#collapse${index}" aria-expanded="${index === 0 ? 'true' : 'false'}" aria-controls="collapse${index}">
                                    ${faq.pregunta}
                                </button>
                            </h2>
                            <div id="collapse${index}" class="accordion-collapse collapse ${index === 0 ? 'show' : ''}" data-bs-parent="#accordionFAQ">
                                <div class="accordion-body">
                                    ${faq.respuesta}
                                </div>
                            </div>
                        </div>
                    `;
                });
                
                html += '</div>';
                faqContainer.innerHTML = html;
                
                // Mostrar el contenedor
                document.querySelector('#faqSection').classList.remove('d-none');
                document.querySelector('#ticketSection').classList.add('d-none');
                document.querySelector('#historialTickets').classList.add('d-none');
                document.querySelector('#baseConocimiento').classList.add('d-none');
            } else {
                faqContainer.innerHTML = '<div class="alert alert-info">No hay preguntas frecuentes disponibles en este momento.</div>';
            }
        } catch (error) {
            console.error('Error al cargar FAQ:', error);
            document.querySelector('#faqContainer').innerHTML = '<div class="alert alert-danger">Error al cargar las preguntas frecuentes.</div>';
        } finally {
            hideLoading();
        }
    }

    /**
     * Busca información en la base de conocimientos
     */
    async buscarAyuda() {
        try {
            const searchTerm = document.querySelector('#searchAyuda').value.trim();
            
            if (!this.validation.isNotEmpty(searchTerm)) {
                return showMessage('Ingrese un término para buscar', 'error');
            }
            
            showLoading();
            
            const response = await this.api.get(`soporte/base-conocimiento?q=${encodeURIComponent(searchTerm)}`);
            
            const resultadosContainer = document.querySelector('#resultadosBusqueda');
            
            if (response.success && response.data && response.data.length > 0) {
                let html = '<div class="list-group mt-3">';
                
                response.data.forEach(item => {
                    html += `
                        <a href="javascript:void(0)" class="list-group-item list-group-item-action" 
                           onclick="window.soporteInstance.mostrarArticulo(${item.id})">
                            <div class="d-flex w-100 justify-content-between">
                                <h5 class="mb-1">${item.titulo}</h5>
                                <small>${item.fecha}</small>
                            </div>
                            <p class="mb-1">${item.resumen}</p>
                            <small>Categoría: ${item.categoria}</small>
                        </a>
                    `;
                });
                
                html += '</div>';
                resultadosContainer.innerHTML = html;
            } else {
                resultadosContainer.innerHTML = '<div class="alert alert-info mt-3">No se encontraron resultados para su búsqueda.</div>';
            }
            
            // Mostrar sección de resultados
            document.querySelector('#baseConocimiento').classList.remove('d-none');
            document.querySelector('#faqSection').classList.add('d-none');
            document.querySelector('#ticketSection').classList.add('d-none');
            document.querySelector('#historialTickets').classList.add('d-none');
            
        } catch (error) {
            console.error('Error al buscar en la base de conocimientos:', error);
            document.querySelector('#resultadosBusqueda').innerHTML = '<div class="alert alert-danger mt-3">Error al procesar la búsqueda.</div>';
        } finally {
            hideLoading();
        }
    }

    /**
     * Muestra un artículo específico de la base de conocimientos
     * @param {number} id - ID del artículo
     */
    async mostrarArticulo(id) {
        try {
            showLoading();
            
            const response = await this.api.get(`soporte/articulo/${id}`);
            
            if (response.success && response.data) {
                const articulo = response.data;
                
                document.querySelector('#articuloTitulo').textContent = articulo.titulo;
                document.querySelector('#articuloFecha').textContent = articulo.fecha;
                document.querySelector('#articuloCategoria').textContent = articulo.categoria;
                document.querySelector('#articuloContenido').innerHTML = articulo.contenido;
                
                // Mostrar el modal de artículo
                const articuloModal = new bootstrap.Modal(document.querySelector('#articuloModal'));
                articuloModal.show();
            } else {
                showMessage('No se pudo cargar el artículo solicitado', 'error');
            }
        } catch (error) {
            console.error('Error al cargar artículo:', error);
            showMessage('Error al procesar la solicitud', 'error');
        } finally {
            hideLoading();
        }
    }

    /**
     * Carga el historial de tickets del usuario
     */
    async cargarHistorialTickets() {
        try {
            showLoading();
            
            const historialContainer = document.querySelector('#historialTicketsContainer');
            if (!historialContainer) return;
            
            const response = await this.api.get('soporte/tickets');
            
            if (response.success && response.data) {
                let html = `
                    <div class="table-responsive">
                        <table class="table table-striped table-hover">
                            <thead>
                                <tr>
                                    <th>#Ticket</th>
                                    <th>Asunto</th>
                                    <th>Categoría</th>
                                    <th>Fecha</th>
                                    <th>Estado</th>
                                    <th>Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                `;
                
                if (response.data.length > 0) {
                    response.data.forEach(ticket => {
                        // Definir clase según estado
                        let estadoClass = '';
                        switch (ticket.estado.toLowerCase()) {
                            case 'abierto':
                                estadoClass = 'badge bg-success';
                                break;
                            case 'en proceso':
                                estadoClass = 'badge bg-warning text-dark';
                                break;
                            case 'cerrado':
                                estadoClass = 'badge bg-secondary';
                                break;
                            case 'urgente':
                                estadoClass = 'badge bg-danger';
                                break;
                            default:
                                estadoClass = 'badge bg-info';
                        }
                        
                        html += `
                            <tr>
                                <td>${ticket.numero}</td>
                                <td>${ticket.asunto}</td>
                                <td>${ticket.categoria}</td>
                                <td>${ticket.fecha}</td>
                                <td><span class="${estadoClass}">${ticket.estado}</span></td>
                                <td>
                                    <button class="btn btn-sm btn-info" onclick="window.soporteInstance.verDetalleTicket(${ticket.id})">
                                        <i class="fas fa-eye"></i> Ver
                                    </button>
                                </td>
                            </tr>
                        `;
                    });
                } else {
                    html += `
                        <tr>
                            <td colspan="6" class="text-center">No hay tickets registrados</td>
                        </tr>
                    `;
                }
                
                html += `
                            </tbody>
                        </table>
                    </div>
                `;
                
                historialContainer.innerHTML = html;
            } else {
                historialContainer.innerHTML = '<div class="alert alert-info">No se encontraron tickets registrados.</div>';
            }
            
            // Mostrar sección de historial
            document.querySelector('#historialTickets').classList.remove('d-none');
            document.querySelector('#faqSection').classList.add('d-none');
            document.querySelector('#ticketSection').classList.add('d-none');
            document.querySelector('#baseConocimiento').classList.add('d-none');
            
        } catch (error) {
            console.error('Error al cargar historial de tickets:', error);
            document.querySelector('#historialTicketsContainer').innerHTML = '<div class="alert alert-danger">Error al cargar el historial de tickets.</div>';
        } finally {
            hideLoading();
        }
    }

    /**
     * Muestra los detalles de un ticket específico
     * @param {number} id - ID del ticket
     */
    async verDetalleTicket(id) {
        try {
            showLoading();
            
            const response = await this.api.get(`soporte/ticket/${id}`);
            
            if (response.success && response.data) {
                const ticket = response.data;
                
                document.querySelector('#detalleTicketNumero').textContent = ticket.numero;
                document.querySelector('#detalleTicketAsunto').textContent = ticket.asunto;
                document.querySelector('#detalleTicketEstado').innerHTML = `<span class="badge ${this.getEstadoClass(ticket.estado)}">${ticket.estado}</span>`;
                document.querySelector('#detalleTicketFecha').textContent = ticket.fecha;
                document.querySelector('#detalleTicketCategoria').textContent = ticket.categoria;
                document.querySelector('#detalleTicketPrioridad').textContent = ticket.prioridad;
                document.querySelector('#detalleTicketDescripcion').textContent = ticket.descripcion;
                
                // Cargar mensajes
                const mensajesContainer = document.querySelector('#detalleTicketMensajes');
                
                if (ticket.mensajes && ticket.mensajes.length > 0) {
                    let mensajesHtml = '';
                    
                    ticket.mensajes.forEach(mensaje => {
                        const isUsuario = mensaje.tipo === 'usuario';
                        
                        mensajesHtml += `
                            <div class="mensaje ${isUsuario ? 'mensaje-usuario' : 'mensaje-soporte'}">
                                <div class="mensaje-header">
                                    <strong>${isUsuario ? 'Yo' : 'Soporte Técnico'}</strong>
                                    <span class="mensaje-fecha">${mensaje.fecha}</span>
                                </div>
                                <div class="mensaje-contenido">
                                    ${mensaje.contenido}
                                </div>
                                ${mensaje.adjunto ? `<div class="mensaje-adjunto"><a href="${mensaje.adjunto}" target="_blank"><i class="fas fa-paperclip"></i> Ver adjunto</a></div>` : ''}
                            </div>
                        `;
                    });
                    
                    mensajesContainer.innerHTML = mensajesHtml;
                } else {
                    mensajesContainer.innerHTML = '<div class="alert alert-info">No hay mensajes en este ticket.</div>';
                }
                
                // Mostrar o esconder formulario de respuesta según estado del ticket
                const formRespuesta = document.querySelector('#formRespuestaTicket');
                if (ticket.estado.toLowerCase() === 'cerrado') {
                    formRespuesta.classList.add('d-none');
                    document.querySelector('#ticketCerradoMsg').classList.remove('d-none');
                } else {
                    formRespuesta.classList.remove('d-none');
                    document.querySelector('#ticketCerradoMsg').classList.add('d-none');
                    
                    // Asignar ID del ticket al formulario
                    document.querySelector('#respuestaTicketId').value = ticket.id;
                }
                
                // Mostrar el modal
                const detalleModal = new bootstrap.Modal(document.querySelector('#detalleTicketModal'));
                detalleModal.show();
            } else {
                showMessage('No se pudo cargar el detalle del ticket', 'error');
            }
        } catch (error) {
            console.error('Error al cargar detalle del ticket:', error);
            showMessage('Error al procesar la solicitud', 'error');
        } finally {
            hideLoading();
        }
    }

    /**
     * Devuelve la clase CSS según el estado del ticket
     * @param {string} estado - Estado del ticket
     * @returns {string} - Clase CSS para el estado
     */
    getEstadoClass(estado) {
        switch (estado.toLowerCase()) {
            case 'abierto':
                return 'bg-success';
            case 'en proceso':
                return 'bg-warning text-dark';
            case 'cerrado':
                return 'bg-secondary';
            case 'urgente':
                return 'bg-danger';
            default:
                return 'bg-info';
        }
    }

    /**
     * Envía una respuesta a un ticket existente
     */
    async responderTicket() {
        try {
            const formData = new FormData(document.querySelector('#formRespuestaTicket'));
            
            const mensaje = formData.get('mensaje');
            const ticketId = formData.get('ticketId');
            
            if (!this.validation.isNotEmpty(mensaje)) {
                return showMessage('Debe ingresar un mensaje', 'error');
            }
            
            // Procesar archivo adjunto si existe
            const archivo = formData.get('archivoRespuesta');
            if (archivo && archivo.name) {
                const validExtensions = ['jpg', 'png', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt'];
                const extension = archivo.name.split('.').pop().toLowerCase();
                
                if (!validExtensions.includes(extension)) {
                    return showMessage('Formato de archivo no permitido. Formatos permitidos: jpg, png, pdf, doc, docx, xls, xlsx, txt', 'error');
                }
                
                if (archivo.size > 5242880) { // 5MB en bytes
                    return showMessage('El archivo no debe superar los 5MB', 'error');
                }
            }
            
            showLoading();
            
            const response = await this.api.post('soporte/ticket/respuesta', formData);
            
            if (response.success) {
                document.querySelector('#formRespuestaTicket').reset();
                showMessage('Respuesta enviada correctamente', 'success');
                
                // Actualizar vista del ticket
                this.verDetalleTicket(ticketId);
            } else {
                showMessage(response.message || 'Error al enviar la respuesta', 'error');
            }
        } catch (error) {
            console.error('Error al responder ticket:', error);
            showMessage('Ocurrió un error al procesar la solicitud', 'error');
        } finally {
            hideLoading();
        }
    }

    /**
     * Cambia a la vista de nuevo ticket
     */
    mostrarNuevoTicket() {
        document.querySelector('#ticketSection').classList.remove('d-none');
        document.querySelector('#faqSection').classList.add('d-none');
        document.querySelector('#historialTickets').classList.add('d-none');
        document.querySelector('#baseConocimiento').classList.add('d-none');
    }

    /**
     * Inicializa el módulo al cargarse la página
     */
    static init() {
        window.soporteInstance = new Soporte();
        return window.soporteInstance;
    }
}

// Exportamos la clase para su uso
 Soporte

module.exports = Soporte;

// Inicializamos cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', Soporte.init);