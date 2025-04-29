/**
 * Módulo de Ayuda - FactuSystem
 * Este archivo contiene las funcionalidades para la sección de ayuda del sistema
 * 
 * @author FactuSystem
 * @version 1.0
 */

// Esperar a que el DOM esté completamente cargado
document.addEventListener('DOMContentLoaded', function() {
    // Inicializar el módulo
    AyudaModule.init();
});

/**
 * Módulo de Ayuda
 */
const AyudaModule = {
    // Propiedades del módulo
    selectorContenido: '#contenido-ayuda',
    selectorBuscador: '#buscador-ayuda',
    selectorCategorias: '#categorias-ayuda',
    selectorPreguntas: '.pregunta-frecuente',
    currentSection: null,

    /**
     * Inicializa el módulo de ayuda
     */
    init: function() {
        this.bindEvents();
        this.cargarContenidoInicial();
        console.log('Módulo de Ayuda inicializado');
    },

    /**
     * Asocia eventos a los elementos del DOM
     */
    bindEvents: function() {
        const self = this;

        // Evento para el buscador
        const buscador = document.querySelector(this.selectorBuscador);
        if (buscador) {
            buscador.addEventListener('keyup', function(e) {
                self.buscarAyuda(e.target.value);
            });
        }

        // Eventos para las categorías
        const categorias = document.querySelectorAll(this.selectorCategorias + ' .categoria-item');
        categorias.forEach(categoria => {
            categoria.addEventListener('click', function() {
                const idCategoria = this.getAttribute('data-id');
                self.cargarCategoria(idCategoria);
                
                // Actualizar categoría activa
                categorias.forEach(cat => cat.classList.remove('active'));
                this.classList.add('active');
            });
        });

        // Eventos para la expansión de preguntas frecuentes
        document.addEventListener('click', function(e) {
            if (e.target.closest(self.selectorPreguntas)) {
                const pregunta = e.target.closest(self.selectorPreguntas);
                self.togglePregunta(pregunta);
            }
        });

        // Botón para volver a la página anterior
        const btnVolver = document.querySelector('#btn-volver-ayuda');
        if (btnVolver) {
            btnVolver.addEventListener('click', function() {
                self.volverAtras();
            });
        }
    },

    /**
     * Carga el contenido inicial de la sección de ayuda
     */
    cargarContenidoInicial: function() {
        const contenedor = document.querySelector(this.selectorContenido);
        
        if (!contenedor) return;
        
        // Mostrar mensaje de bienvenida y temas principales
        this.renderizarContenidoInicial(contenedor);
        
        // Cargar preguntas frecuentes iniciales
        this.cargarPreguntasFrecuentes();
    },

    /**
     * Renderiza el contenido inicial de la sección de ayuda
     * @param {HTMLElement} contenedor - El contenedor donde insertar el contenido
     */
    renderizarContenidoInicial: function(contenedor) {
        contenedor.innerHTML = `
            <div class="card shadow-sm">
                <div class="card-body">
                    <h2 class="card-title text-center mb-4">Centro de Ayuda FactuSystem</h2>
                    <p class="text-center mb-4">
                        Bienvenido al centro de ayuda. Aquí encontrarás respuestas a las preguntas más frecuentes
                        y guías para utilizar el sistema de forma eficiente.
                    </p>
                    
                    <div class="temas-principales row mt-4">
                        <div class="col-md-4 mb-3">
                            <div class="card h-100 tema-card" data-tema="facturacion">
                                <div class="card-body text-center">
                                    <i class="fas fa-file-invoice fa-3x mb-3 text-primary"></i>
                                    <h5>Facturación</h5>
                                    <p class="card-text small">Aprende a crear y gestionar facturas electrónicas</p>
                                </div>
                            </div>
                        </div>
                        <div class="col-md-4 mb-3">
                            <div class="card h-100 tema-card" data-tema="clientes">
                                <div class="card-body text-center">
                                    <i class="fas fa-users fa-3x mb-3 text-success"></i>
                                    <h5>Clientes</h5>
                                    <p class="card-text small">Gestión de clientes y contactos</p>
                                </div>
                            </div>
                        </div>
                        <div class="col-md-4 mb-3">
                            <div class="card h-100 tema-card" data-tema="productos">
                                <div class="card-body text-center">
                                    <i class="fas fa-box fa-3x mb-3 text-warning"></i>
                                    <h5>Productos</h5>
                                    <p class="card-text small">Administración de catálogo de productos y servicios</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="card shadow-sm mt-4">
                <div class="card-body">
                    <h3 class="mb-3">Preguntas frecuentes</h3>
                    <div id="preguntas-frecuentes">
                        <div class="text-center">
                            <div class="spinner-border text-primary" role="status">
                                <span class="visually-hidden">Cargando...</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // Agregar eventos a las tarjetas de temas
        const temaCards = document.querySelectorAll('.tema-card');
        temaCards.forEach(card => {
            card.addEventListener('click', () => {
                const tema = card.getAttribute('data-tema');
                this.cargarTema(tema);
            });
        });
    },

    /**
     * Carga las preguntas frecuentes
     */
    cargarPreguntasFrecuentes: function() {
        const self = this;
        const contenedor = document.querySelector('#preguntas-frecuentes');
        
        if (!contenedor) return;
        
        // Simular carga de datos (en producción, esto vendría de una petición AJAX)
        setTimeout(() => {
            const preguntasFrecuentes = [
                {
                    id: 1,
                    pregunta: '¿Cómo crear una nueva factura?',
                    respuesta: 'Para crear una nueva factura, ve al menú "Facturación" y haz clic en "Nueva Factura". Completa los campos requeridos, agrega los productos o servicios y finaliza haciendo clic en "Guardar".'
                },
                {
                    id: 2,
                    pregunta: '¿Cómo registrar un nuevo cliente?',
                    respuesta: 'Para registrar un nuevo cliente, dirígete a la sección "Clientes" en el menú principal, luego haz clic en "Nuevo Cliente". Completa el formulario con la información del cliente y guarda los cambios.'
                },
                {
                    id: 3,
                    pregunta: '¿Puedo exportar mis facturas a PDF?',
                    respuesta: 'Sí, puedes exportar tus facturas a PDF. En la vista de detalle de la factura, encontrarás un botón "Exportar a PDF". Al hacer clic, se generará el archivo PDF que podrás descargar o imprimir.'
                },
                {
                    id: 4,
                    pregunta: '¿Cómo actualizar la información de mi empresa?',
                    respuesta: 'Para actualizar la información de tu empresa, ve a "Configuración" > "Datos de la Empresa". Ahí podrás modificar los datos como nombre, dirección, información fiscal y logotipo.'
                },
                {
                    id: 5,
                    pregunta: '¿El sistema genera reportes de ventas?',
                    respuesta: 'Sí, el sistema incluye un módulo de reportes donde puedes generar informes de ventas por periodo, cliente, producto, etc. Accede desde el menú "Reportes" y selecciona el tipo de informe que necesitas.'
                }
            ];

            let html = '';
            preguntasFrecuentes.forEach(item => {
                html += `
                    <div class="pregunta-frecuente mb-3" data-id="${item.id}">
                        <div class="pregunta d-flex justify-content-between align-items-center p-3 bg-light rounded">
                            <h6 class="mb-0">${item.pregunta}</h6>
                            <i class="fas fa-chevron-down"></i>
                        </div>
                        <div class="respuesta p-3 border-start border-end border-bottom rounded-bottom" style="display: none;">
                            <p class="mb-0">${item.respuesta}</p>
                        </div>
                    </div>
                `;
            });
            
            contenedor.innerHTML = html;
        }, 500);
    },

    /**
     * Muestra/Oculta la respuesta de una pregunta frecuente
     * @param {HTMLElement} elemento - El elemento de la pregunta
     */
    togglePregunta: function(elemento) {
        const respuesta = elemento.querySelector('.respuesta');
        const icono = elemento.querySelector('.fas');
        
        if (respuesta.style.display === 'none' || !respuesta.style.display) {
            respuesta.style.display = 'block';
            icono.classList.replace('fa-chevron-down', 'fa-chevron-up');
        } else {
            respuesta.style.display = 'none';
            icono.classList.replace('fa-chevron-up', 'fa-chevron-down');
        }
    },

    /**
     * Carga el contenido de un tema específico
     * @param {string} tema - Identificador del tema
     */
    cargarTema: function(tema) {
        const contenedor = document.querySelector(this.selectorContenido);
        this.currentSection = tema;
        
        // Simulación de carga de datos (en producción, esto vendría de una petición AJAX)
        let titulo, contenido, subtemas;
        
        switch (tema) {
            case 'facturacion':
                titulo = 'Guía de Facturación';
                contenido = 'Esta sección te ayudará a entender el proceso completo de facturación electrónica.';
                subtemas = [
                    {id: 'crear-factura', titulo: 'Crear nueva factura', icono: 'fa-file-invoice'},
                    {id: 'editar-factura', titulo: 'Editar facturas existentes', icono: 'fa-edit'},
                    {id: 'anular-factura', titulo: 'Anular facturas', icono: 'fa-ban'},
                    {id: 'enviar-factura', titulo: 'Enviar facturas por email', icono: 'fa-envelope'}
                ];
                break;
            case 'clientes':
                titulo = 'Gestión de Clientes';
                contenido = 'Aprende cómo administrar eficientemente tu cartera de clientes.';
                subtemas = [
                    {id: 'nuevo-cliente', titulo: 'Registrar nuevo cliente', icono: 'fa-user-plus'},
                    {id: 'editar-cliente', titulo: 'Modificar datos de cliente', icono: 'fa-user-edit'},
                    {id: 'historial-cliente', titulo: 'Historial de compras', icono: 'fa-history'},
                    {id: 'importar-clientes', titulo: 'Importar clientes desde Excel', icono: 'fa-file-import'}
                ];
                break;
            case 'productos':
                titulo = 'Catálogo de Productos';
                contenido = 'Guía para la gestión de tu inventario y catálogo de productos.';
                subtemas = [
                    {id: 'nuevo-producto', titulo: 'Agregar nuevo producto', icono: 'fa-plus-circle'},
                    {id: 'categorias', titulo: 'Gestión de categorías', icono: 'fa-tags'},
                    {id: 'precios', titulo: 'Actualización de precios', icono: 'fa-dollar-sign'},
                    {id: 'importar-productos', titulo: 'Importar productos', icono: 'fa-file-upload'}
                ];
                break;
            default:
                titulo = 'Tema no encontrado';
                contenido = 'Lo sentimos, el tema solicitado no está disponible.';
                subtemas = [];
        }
        
        let html = `
            <div class="card shadow-sm">
                <div class="card-body">
                    <div class="d-flex align-items-center mb-4">
                        <button id="btn-volver-ayuda" class="btn btn-sm btn-outline-secondary me-3">
                            <i class="fas fa-arrow-left"></i> Volver
                        </button>
                        <h2 class="mb-0">${titulo}</h2>
                    </div>
                    
                    <p class="lead">${contenido}</p>
                    
                    <div class="row mt-4">
        `;
        
        subtemas.forEach(subtema => {
            html += `
                <div class="col-md-6 mb-3">
                    <div class="card h-100 subtema-card" data-subtema="${subtema.id}">
                        <div class="card-body">
                            <div class="d-flex align-items-center">
                                <div class="subtema-icon me-3">
                                    <i class="fas ${subtema.icono} fa-2x text-primary"></i>
                                </div>
                                <div>
                                    <h5 class="mb-1">${subtema.titulo}</h5>
                                    <p class="text-muted small mb-0">Haz clic para ver detalles</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        });
        
        html += `
                    </div>
                </div>
            </div>
        `;
        
        contenedor.innerHTML = html;
        
        // Reiniciar eventos después de actualizar el DOM
        this.bindEvents();
        
        // Agregar eventos a los subtemas
        const subtemaCards = document.querySelectorAll('.subtema-card');
        subtemaCards.forEach(card => {
            card.addEventListener('click', () => {
                const subtema = card.getAttribute('data-subtema');
                this.cargarSubtema(tema, subtema);
            });
        });
    },

    /**
     * Carga el contenido de un subtema específico
     * @param {string} tema - Identificador del tema padre
     * @param {string} subtema - Identificador del subtema
     */
    cargarSubtema: function(tema, subtema) {
        const contenedor = document.querySelector(this.selectorContenido);
        
        // En producción, estos datos vendrían de una API
        let titulo, contenido, pasos = [];
        
        // Simulación de contenido para el subtema seleccionado
        if (tema === 'facturacion' && subtema === 'crear-factura') {
            titulo = 'Crear nueva factura';
            contenido = 'Sigue estos pasos para crear una nueva factura en el sistema:';
            pasos = [
                {
                    titulo: 'Acceder al módulo de facturación',
                    descripcion: 'Ve al menú principal y selecciona "Facturación" > "Nueva Factura".',
                    imagen: 'assets/img/ayuda/factura-paso1.jpg'
                },
                {
                    titulo: 'Seleccionar cliente',
                    descripcion: 'Busca y selecciona el cliente para la factura. Si es nuevo, puedes crearlo desde esta pantalla.',
                    imagen: 'assets/img/ayuda/factura-paso2.jpg'
                },
                {
                    titulo: 'Agregar productos o servicios',
                    descripcion: 'Busca y agrega los productos o servicios a facturar, especificando cantidad y precio si es necesario.',
                    imagen: 'assets/img/ayuda/factura-paso3.jpg'
                },
                {
                    titulo: 'Revisar y finalizar',
                    descripcion: 'Verifica los datos de la factura, aplica descuentos si corresponde y haz clic en "Guardar".',
                    imagen: 'assets/img/ayuda/factura-paso4.jpg'
                }
            ];
        } else {
            titulo = 'Guía no disponible';
            contenido = 'La guía para este tema aún está en desarrollo. Pronto estará disponible.';
        }
        
        let html = `
            <div class="card shadow-sm">
                <div class="card-body">
                    <div class="d-flex align-items-center mb-4">
                        <button id="btn-volver-ayuda" class="btn btn-sm btn-outline-secondary me-3">
                            <i class="fas fa-arrow-left"></i> Volver
                        </button>
                        <h2 class="mb-0">${titulo}</h2>
                    </div>
                    
                    <p class="lead">${contenido}</p>
        `;
        
        if (pasos.length > 0) {
            html += `<div class="pasos-guia mt-4">`;
            
            pasos.forEach((paso, index) => {
                html += `
                    <div class="paso-item mb-4">
                        <div class="paso-numero">
                            <span class="badge bg-primary rounded-circle p-2">${index + 1}</span>
                        </div>
                        <div class="paso-contenido">
                            <h4>${paso.titulo}</h4>
                            <p>${paso.descripcion}</p>
                            ${paso.imagen ? `
                                <div class="paso-imagen mt-2 mb-3">
                                    <img src="${paso.imagen}" class="img-fluid border rounded" alt="Paso ${index + 1}">
                                </div>
                            ` : ''}
                        </div>
                    </div>
                `;
            });
            
            html += `</div>`;
        }
        
        html += `
                </div>
            </div>
        `;
        
        contenedor.innerHTML = html;
        
        // Reiniciar eventos después de actualizar el DOM
        this.bindEvents();
    },

    /**
     * Carga el contenido de una categoría específica de ayuda
     * @param {string} idCategoria - ID de la categoría
     */
    cargarCategoria: function(idCategoria) {
        console.log(`Cargando categoría: ${idCategoria}`);
        // En producción, cargaría datos desde el servidor
    },

    /**
     * Busca contenido en la ayuda según el término ingresado
     * @param {string} termino - Término de búsqueda
     */
    buscarAyuda: function(termino) {
        if (termino.length < 3) return;
        
        console.log(`Buscando: ${termino}`);
        // En producción, realizaría una búsqueda en el servidor
        
        // Simulación de resultado de búsqueda
        const contenedor = document.querySelector(this.selectorContenido);
        
        setTimeout(() => {
            contenedor.innerHTML = `
                <div class="card shadow-sm">
                    <div class="card-body">
                        <h2 class="mb-4">Resultados de búsqueda para: "${termino}"</h2>
                        
                        <div class="resultados-busqueda">
                            <p class="text-muted">Se encontraron 3 resultados</p>
                            
                            <div class="resultado-item p-3 border-bottom">
                                <h5><a href="#" class="text-decoration-none">¿Cómo crear una nueva factura?</a></h5>
                                <p>Para crear una nueva factura, ve al menú "Facturación" y haz clic en "Nueva Factura". Completa los campos requeridos...</p>
                                <div class="small text-muted">Categoría: Facturación</div>
                            </div>
                            
                            <div class="resultado-item p-3 border-bottom">
                                <h5><a href="#" class="text-decoration-none">Guía paso a paso para crear facturas</a></h5>
                                <p>Esta guía te mostrará el proceso completo para generar facturas electrónicas válidas...</p>
                                <div class="small text-muted">Categoría: Tutoriales</div>
                            </div>
                            
                            <div class="resultado-item p-3">
                                <h5><a href="#" class="text-decoration-none">Campos obligatorios en las facturas</a></h5>
                                <p>Conoce cuáles son los campos obligatorios que debes completar para que tus facturas cumplan con la normativa...</p>
                                <div class="small text-muted">Categoría: Normativa</div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }, 300);
    },

    /**
     * Navega a la sección anterior
     */
    volverAtras: function() {
        if (this.currentSection) {
            this.currentSection = null;
            this.cargarContenidoInicial();
        }
    }
};

// Exportar el módulo para uso en otros archivos si es necesario
 AyudaModule

module.exports = AyudaModule;