/**
 * Módulo de Tutoriales para FactuSystem
 * Este módulo gestiona la visualización y funcionalidad de los tutoriales de ayuda
 * 
 * @author FactuSystem
 * @version 1.0.0
 */

'use strict';

// Importaciones necesarias (si hay algún módulo común requerido)
const { Notificacion } = require('../../common/notificacion.js');
const { Helpers } = require('../../common/helpers.js');

/**
 * Clase para gestionar los tutoriales del sistema
 */
class Tutoriales {
    /**
     * Constructor de la clase
     */
    constructor() {
        // Elementos DOM
        this.contenedorTutoriales = document.getElementById('contenedor-tutoriales');
        this.listaTutoriales = document.getElementById('lista-tutoriales');
        this.contenidoTutorial = document.getElementById('contenido-tutorial');
        this.btnAnterior = document.getElementById('btn-tutorial-anterior');
        this.btnSiguiente = document.getElementById('btn-tutorial-siguiente');
        this.filtroTutoriales = document.getElementById('filtro-tutoriales');
        
        // Variables de estado
        this.tutorialesData = [];
        this.tutorialActual = null;
        this.indiceActual = 0;
        
        // Inicializar el módulo
        this.inicializar();
    }
    
    /**
     * Inicializa el módulo de tutoriales
     */
    inicializar() {
        this.registrarEventos();
        this.cargarTutoriales();
    }
    
    /**
     * Registra los eventos de los elementos interactivos
     */
    registrarEventos() {
        if (this.filtroTutoriales) {
            this.filtroTutoriales.addEventListener('input', this.filtrarTutoriales.bind(this));
        }
        
        if (this.btnAnterior) {
            this.btnAnterior.addEventListener('click', this.mostrarTutorialAnterior.bind(this));
        }
        
        if (this.btnSiguiente) {
            this.btnSiguiente.addEventListener('click', this.mostrarTutorialSiguiente.bind(this));
        }
        
        // Evento para responsive (opcional)
        window.addEventListener('resize', this.ajustarVistaResponsive.bind(this));
    }
    
    /**
     * Carga los tutoriales desde el servidor
     */
    cargarTutoriales() {
        const url = '/api/ayuda/tutoriales';
        
        fetch(url)
            .then(response => {
                if (!response.ok) {
                    throw new Error('Error al cargar los tutoriales');
                }
                return response.json();
            })
            .then(data => {
                this.tutorialesData = data;
                this.renderizarListaTutoriales();
            })
            .catch(error => {
                console.error('Error:', error);
                Notificacion.mostrar({
                    tipo: 'error',
                    mensaje: 'No se pudieron cargar los tutoriales. ' + error.message
                });
                
                // Cargar datos de prueba en caso de error (para desarrollo)
                this.cargarDatosPrueba();
            });
    }
    
    /**
     * Carga datos de prueba para desarrollo
     */
    cargarDatosPrueba() {
        this.tutorialesData = [
            {
                id: 1,
                titulo: 'Primeros pasos en FactuSystem',
                categoria: 'Introducción',
                contenido: '<h2>Bienvenido a FactuSystem</h2><p>Este tutorial te guiará por las funciones básicas del sistema.</p><h3>Pasos iniciales</h3><ol><li>Configura tu empresa</li><li>Añade productos o servicios</li><li>Crea tu primera factura</li></ol>',
                orden: 1
            },
            {
                id: 2,
                titulo: 'Creación de facturas',
                categoria: 'Facturación',
                contenido: '<h2>Cómo crear facturas</h2><p>Aprende a generar facturas de forma rápida y sencilla.</p><h3>Proceso paso a paso</h3><ol><li>Accede al módulo de facturas</li><li>Haz clic en "Nueva factura"</li><li>Selecciona el cliente</li><li>Añade los productos o servicios</li><li>Configura impuestos y descuentos</li><li>Guarda y envía</li></ol>',
                orden: 2
            },
            {
                id: 3,
                titulo: 'Gestión de clientes',
                categoria: 'Clientes',
                contenido: '<h2>Administra tu cartera de clientes</h2><p>Aprende a gestionar la información de tus clientes de manera eficiente.</p><h3>Funcionalidades disponibles</h3><ul><li>Añadir nuevos clientes</li><li>Editar información de contacto</li><li>Visualizar historial de compras</li><li>Gestionar créditos y pagos pendientes</li></ul>',
                orden: 3
            },
            {
                id: 4,
                titulo: 'Reportes y estadísticas',
                categoria: 'Reportes',
                contenido: '<h2>Análisis y reportes financieros</h2><p>Descubre cómo generar informes detallados de tu negocio.</p><h3>Tipos de reportes</h3><ul><li>Ventas mensuales</li><li>Productos más vendidos</li><li>Estado de cuentas por cobrar</li><li>Resumen fiscal</li></ul><p>Puedes exportar estos reportes a Excel o PDF para compartirlos con tu equipo contable.</p>',
                orden: 4
            }
        ];
        
        this.renderizarListaTutoriales();
    }
    
    /**
     * Renderiza la lista de tutoriales en el sidebar
     */
    renderizarListaTutoriales() {
        if (!this.listaTutoriales) return;
        
        // Limpiar lista anterior
        this.listaTutoriales.innerHTML = '';
        
        // Agrupar tutoriales por categoría
        const tutorialesPorCategoria = this.agruparPorCategoria(this.tutorialesData);
        
        // Crear elementos para cada categoría y sus tutoriales
        for (const categoria in tutorialesPorCategoria) {
            // Crear encabezado de categoría
            const categoriaElement = document.createElement('div');
            categoriaElement.className = 'tutorial-categoria';
            categoriaElement.innerHTML = `<h4>${categoria}</h4>`;
            
            // Crear lista de tutoriales de esta categoría
            const listaTutorialesCategoria = document.createElement('ul');
            listaTutorialesCategoria.className = 'lista-tutoriales-categoria';
            
            // Añadir cada tutorial
            tutorialesPorCategoria[categoria].forEach(tutorial => {
                const tutorialItem = document.createElement('li');
                tutorialItem.className = 'tutorial-item';
                tutorialItem.innerHTML = `<a href="#" data-id="${tutorial.id}">${tutorial.titulo}</a>`;
                tutorialItem.querySelector('a').addEventListener('click', (e) => {
                    e.preventDefault();
                    this.mostrarTutorial(tutorial.id);
                });
                
                listaTutorialesCategoria.appendChild(tutorialItem);
            });
            
            categoriaElement.appendChild(listaTutorialesCategoria);
            this.listaTutoriales.appendChild(categoriaElement);
        }
        
        // Mostrar el primer tutorial por defecto
        if (this.tutorialesData.length > 0) {
            this.mostrarTutorial(this.tutorialesData[0].id);
        }
    }
    
    /**
     * Agrupa los tutoriales por categoría
     * @param {Array} tutoriales - Lista de tutoriales
     * @return {Object} Tutoriales agrupados por categoría
     */
    agruparPorCategoria(tutoriales) {
        return tutoriales.reduce((grupos, tutorial) => {
            const categoria = tutorial.categoria || 'General';
            if (!grupos[categoria]) {
                grupos[categoria] = [];
            }
            grupos[categoria].push(tutorial);
            return grupos;
        }, {});
    }
    
    /**
     * Muestra un tutorial específico
     * @param {number} id - ID del tutorial a mostrar
     */
    mostrarTutorial(id) {
        if (!this.contenidoTutorial) return;
        
        // Encontrar el tutorial
        const tutorial = this.tutorialesData.find(t => t.id === id);
        if (!tutorial) return;
        
        // Actualizar estado
        this.tutorialActual = tutorial;
        this.indiceActual = this.tutorialesData.indexOf(tutorial);
        
        // Mostrar contenido
        this.contenidoTutorial.innerHTML = `
            <h2 class="tutorial-titulo">${tutorial.titulo}</h2>
            <div class="tutorial-contenido">
                ${tutorial.contenido}
            </div>
        `;
        
        // Actualizar navegación
        this.actualizarNavegacion();
        
        // Marcar como activo en la lista
        this.marcarTutorialActivo(id);
        
        // Registrar la vista (analítica)
        this.registrarVisualizacion(id);
    }
    
    /**
     * Actualiza los botones de navegación según el tutorial actual
     */
    actualizarNavegacion() {
        if (!this.btnAnterior || !this.btnSiguiente) return;
        
        // Habilitar/deshabilitar botón anterior
        if (this.indiceActual > 0) {
            this.btnAnterior.disabled = false;
        } else {
            this.btnAnterior.disabled = true;
        }
        
        // Habilitar/deshabilitar botón siguiente
        if (this.indiceActual < this.tutorialesData.length - 1) {
            this.btnSiguiente.disabled = false;
        } else {
            this.btnSiguiente.disabled = true;
        }
    }
    
    /**
     * Marca el tutorial activo en la lista
     * @param {number} id - ID del tutorial activo
     */
    marcarTutorialActivo(id) {
        // Quitar la clase 'activo' de todos los items
        const items = document.querySelectorAll('.tutorial-item a');
        items.forEach(item => {
            item.classList.remove('activo');
        });
        
        // Añadir la clase 'activo' al tutorial seleccionado
        const tutorialActivo = document.querySelector(`.tutorial-item a[data-id="${id}"]`);
        if (tutorialActivo) {
            tutorialActivo.classList.add('activo');
        }
    }
    
    /**
     * Muestra el tutorial anterior
     */
    mostrarTutorialAnterior() {
        if (this.indiceActual > 0) {
            this.indiceActual--;
            this.mostrarTutorial(this.tutorialesData[this.indiceActual].id);
        }
    }
    
    /**
     * Muestra el tutorial siguiente
     */
    mostrarTutorialSiguiente() {
        if (this.indiceActual < this.tutorialesData.length - 1) {
            this.indiceActual++;
            this.mostrarTutorial(this.tutorialesData[this.indiceActual].id);
        }
    }
    
    /**
     * Filtra los tutoriales según el texto ingresado
     */
    filtrarTutoriales() {
        const filtro = this.filtroTutoriales.value.toLowerCase();
        
        if (!filtro) {
            // Si no hay filtro, mostrar todos los tutoriales
            this.renderizarListaTutoriales();
            return;
        }
        
        // Filtrar tutoriales que coincidan con el texto de búsqueda
        const tutorialesFiltrados = this.tutorialesData.filter(tutorial => {
            return tutorial.titulo.toLowerCase().includes(filtro) || 
                   tutorial.contenido.toLowerCase().includes(filtro) ||
                   tutorial.categoria.toLowerCase().includes(filtro);
        });
        
        // Actualizar la lista con los tutoriales filtrados
        if (!this.listaTutoriales) return;
        
        // Limpiar lista anterior
        this.listaTutoriales.innerHTML = '';
        
        // Si no hay resultados
        if (tutorialesFiltrados.length === 0) {
            this.listaTutoriales.innerHTML = '<div class="no-resultados">No se encontraron tutoriales que coincidan con la búsqueda.</div>';
            return;
        }
        
        // Agrupar tutoriales filtrados por categoría
        const tutorialesPorCategoria = this.agruparPorCategoria(tutorialesFiltrados);
        
        // Crear elementos para cada categoría y sus tutoriales
        for (const categoria in tutorialesPorCategoria) {
            // Crear encabezado de categoría
            const categoriaElement = document.createElement('div');
            categoriaElement.className = 'tutorial-categoria';
            categoriaElement.innerHTML = `<h4>${categoria}</h4>`;
            
            // Crear lista de tutoriales de esta categoría
            const listaTutorialesCategoria = document.createElement('ul');
            listaTutorialesCategoria.className = 'lista-tutoriales-categoria';
            
            // Añadir cada tutorial
            tutorialesPorCategoria[categoria].forEach(tutorial => {
                const tutorialItem = document.createElement('li');
                tutorialItem.className = 'tutorial-item';
                tutorialItem.innerHTML = `<a href="#" data-id="${tutorial.id}">${tutorial.titulo}</a>`;
                tutorialItem.querySelector('a').addEventListener('click', (e) => {
                    e.preventDefault();
                    this.mostrarTutorial(tutorial.id);
                });
                
                listaTutorialesCategoria.appendChild(tutorialItem);
            });
            
            categoriaElement.appendChild(listaTutorialesCategoria);
            this.listaTutoriales.appendChild(categoriaElement);
        }
        
        // Mostrar el primer tutorial filtrado
        if (tutorialesFiltrados.length > 0) {
            this.mostrarTutorial(tutorialesFiltrados[0].id);
        }
    }
    
    /**
     * Registra una visualización de tutorial (para análisis)
     * @param {number} id - ID del tutorial visualizado
     */
    registrarVisualizacion(id) {
        // Registrar la visualización del tutorial (analítica)
        // Esto podría enviar datos al servidor para tracking
        fetch('/api/ayuda/tutoriales/visualizacion', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ tutorialId: id })
        }).catch(error => {
            console.log('Error al registrar visualización:', error);
            // No mostrar error al usuario ya que esto es solo para analítica
        });
    }
    
    /**
     * Ajusta la vista para dispositivos móviles
     */
    ajustarVistaResponsive() {
        const isMobile = window.innerWidth < 768;
        
        if (this.contenedorTutoriales) {
            if (isMobile) {
                this.contenedorTutoriales.classList.add('vista-movil');
            } else {
                this.contenedorTutoriales.classList.remove('vista-movil');
            }
        }
    }
    
    /**
     * Exporta un tutorial específico a PDF
     * @param {number} id - ID del tutorial a exportar
     */
    exportarAPDF(id) {
        // Opcional: Implementar exportación a PDF
        const tutorial = this.tutorialesData.find(t => t.id === id);
        if (!tutorial) return;
        
        // Aquí vendría el código para generar un PDF con el contenido del tutorial
        alert(`Exportación a PDF del tutorial "${tutorial.titulo}" en desarrollo.`);
        
        // Ejemplo de uso de una biblioteca de PDF (simulado)
        /*
        const { generarPDF } = require('../../common/pdf-generator.js');
        
        generarPDF({
            titulo: tutorial.titulo,
            contenido: tutorial.contenido,
            nombreArchivo: `tutorial-${tutorial.id}.pdf`
        });
        */
    }
}

// Exportar la clase Tutoriales
 Tutoriales

module.exports = Tutoriales;

// Inicializar automáticamente cuando se cargue el DOM
document.addEventListener('DOMContentLoaded', () => {
    // Verificar si estamos en la página de tutoriales
    if (document.getElementById('contenedor-tutoriales')) {
        window.moduloTutoriales = new Tutoriales();
    }
});