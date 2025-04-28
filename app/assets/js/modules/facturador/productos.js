/**
 * productos.js - Módulo de gestión de productos para el facturador
 * 
 * Este módulo maneja toda la lógica relacionada con la búsqueda, selección
 * y adición de productos al facturador, incluyendo:
 * - Búsqueda por código de barras o nombre con autocompletado
 * - Modal de búsqueda avanzada (F1)
 * - Modificación rápida de precio o cantidad (F2)
 * - Gestión de la lista de productos en la factura
 */

// Importaciones de utilidades y servicios necesarios
import { ipcRenderer } from '../../renderer.js';
import * as database from '../../utils/database.js';
import * as validation from '../../utils/validation.js';
import * as notifications from '../../components/notifications.js';
import * as tabsManager from '../../components/tabs.js';

// Variables globales para el módulo
let productosEnFactura = [];
let productosCache = []; // Cache para autocompletado
let indexProductoSeleccionado = -1;
let timeoutImagenProducto = null;
let lastBarcodeScan = '';
let scanningBarcode = false;
let barcodeBuffer = '';
let lastBarcodeTime = 0;

/**
 * Inicializa el módulo de productos en el facturador
 * @param {Object} options - Opciones de configuración
 */
export function init(options = {}) {
    loadEventListeners();
    cargarCacheProductos();
    
    // Si viene de una factura existente, cargar sus productos
    if (options.productosExistentes && Array.isArray(options.productosExistentes)) {
        productosEnFactura = options.productosExistentes;
        renderizarListaProductos();
        calcularTotales();
    }
}

/**
 * Configura los escuchadores de eventos para el módulo
 */
function loadEventListeners() {
    // Campo de búsqueda de productos
    const productoInput = document.getElementById('producto-input');
    if (productoInput) {
        productoInput.addEventListener('keydown', manejarTeclaProducto);
        productoInput.addEventListener('input', manejarInputProducto);
        productoInput.addEventListener('focus', () => {
            mostrarSugerencias();
        });
    }

    // Botón para abrir modal de búsqueda
    const btnBuscarProducto = document.getElementById('btn-buscar-producto');
    if (btnBuscarProducto) {
        btnBuscarProducto.addEventListener('click', abrirModalBusquedaProductos);
    }

    // Capturar eventos globales para teclas de función
    document.addEventListener('keydown', (e) => {
        // F1 abre modal de búsqueda de productos cuando el foco está en el campo de productos
        if (e.key === 'F1' && document.activeElement.id === 'producto-input') {
            e.preventDefault();
            abrirModalBusquedaProductos();
        }
        
        // F2 abre modal de edición rápida si hay un producto seleccionado
        if (e.key === 'F2' && indexProductoSeleccionado !== -1) {
            e.preventDefault();
            abrirModalEdicionRapida(indexProductoSeleccionado);
        }

        // Capturar lecturas de código de barras (secuencias rápidas)
        gestionarScannerCodigoBarras(e);
    });

    // Evento para el click fuera de las sugerencias
    document.addEventListener('click', (e) => {
        const suggestionBox = document.getElementById('sugerencias-productos');
        if (suggestionBox && !suggestionBox.contains(e.target) && e.target.id !== 'producto-input') {
            suggestionBox.style.display = 'none';
        }
    });
}

/**
 * Maneja las teclas presionadas en el campo de producto
 * @param {KeyboardEvent} e - Evento de teclado
 */
function manejarTeclaProducto(e) {
    const suggestionBox = document.getElementById('sugerencias-productos');
    
    // Enter para agregar producto o seleccionar sugerencia
    if (e.key === 'Enter') {
        e.preventDefault();
        const selectedSuggestion = suggestionBox?.querySelector('.suggestion-selected');
        
        if (selectedSuggestion) {
            const productoId = selectedSuggestion.dataset.id;
            buscarYAgregarProductoPorId(productoId);
        } else {
            procesarEntradaProducto(e.target.value);
        }
        
        if (suggestionBox) suggestionBox.style.display = 'none';
    }
    
    // Navegación por las sugerencias con flechas
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        
        if (suggestionBox && suggestionBox.children.length > 0) {
            const suggestions = Array.from(suggestionBox.children);
            let currentIndex = suggestions.findIndex(el => el.classList.contains('suggestion-selected'));
            
            // Quitar selección actual
            if (currentIndex !== -1) {
                suggestions[currentIndex].classList.remove('suggestion-selected');
            }
            
            // Calcular nuevo índice
            if (e.key === 'ArrowDown') {
                currentIndex = (currentIndex + 1) % suggestions.length;
            } else {
                currentIndex = (currentIndex - 1 + suggestions.length) % suggestions.length;
            }
            
            // Aplicar nueva selección
            suggestions[currentIndex].classList.add('suggestion-selected');
            suggestions[currentIndex].scrollIntoView({ block: 'nearest' });
        }
    }
    
    // Escape para cerrar sugerencias
    else if (e.key === 'Escape') {
        if (suggestionBox) suggestionBox.style.display = 'none';
    }
}

/**
 * Maneja los cambios en el campo de producto para mostrar sugerencias
 * @param {Event} e - Evento de input
 */
function manejarInputProducto(e) {
    const texto = e.target.value.trim();
    
    if (texto.length >= 2) {
        mostrarSugerencias(texto);
    } else {
        const suggestionBox = document.getElementById('sugerencias-productos');
        if (suggestionBox) suggestionBox.style.display = 'none';
    }
}

/**
 * Muestra sugerencias de productos basadas en el texto de búsqueda
 * @param {string} texto - Texto para filtrar productos
 */
function mostrarSugerencias(texto = '') {
    let suggestionBox = document.getElementById('sugerencias-productos');
    
    // Crear el contenedor de sugerencias si no existe
    if (!suggestionBox) {
        suggestionBox = document.createElement('div');
        suggestionBox.id = 'sugerencias-productos';
        suggestionBox.className = 'suggestion-box';
        document.getElementById('producto-input').parentNode.appendChild(suggestionBox);
    }
    
    // Limpiar sugerencias anteriores
    suggestionBox.innerHTML = '';
    
    // Si no hay texto, mostrar productos recientes o populares
    let productosFiltrados = [];
    if (!texto) {
        productosFiltrados = productosCache.slice(0, 5); // Mostrar los primeros 5 productos
    } else {
        // Filtrar productos por texto
        const textoLower = texto.toLowerCase();
        productosFiltrados = productosCache.filter(p => 
            p.nombre.toLowerCase().includes(textoLower) || 
            p.codigo.toLowerCase().includes(textoLower) ||
            p.codigoBarras?.toLowerCase().includes(textoLower)
        ).slice(0, 10); // Limitar a 10 resultados
    }
    
    // Generar elementos de sugerencia
    if (productosFiltrados.length > 0) {
        productosFiltrados.forEach((producto, index) => {
            const item = document.createElement('div');
            item.className = 'suggestion-item' + (index === 0 ? ' suggestion-selected' : '');
            item.dataset.id = producto.id;
            
            // Crear contenido de la sugerencia con formato
            const precio = parseFloat(producto.precio).toLocaleString('es-AR', {
                style: 'currency',
                currency: 'ARS'
            });
            
            item.innerHTML = `
                <div class="suggestion-main">
                    <span class="suggestion-name">${producto.nombre}</span>
                    <span class="suggestion-price">${precio}</span>
                </div>
                <div class="suggestion-details">
                    <span class="suggestion-code">${producto.codigo || ''}</span>
                    <span class="suggestion-stock">Stock: ${producto.stock || 0}</span>
                </div>
            `;
            
            // Evento para seleccionar sugerencia
            item.addEventListener('click', () => {
                buscarYAgregarProductoPorId(producto.id);
                suggestionBox.style.display = 'none';
                document.getElementById('producto-input').value = '';
                document.getElementById('producto-input').focus();
            });
            
            suggestionBox.appendChild(item);
        });
        
        suggestionBox.style.display = 'block';
    } else if (texto) {
        // Mostrar mensaje si no hay resultados
        const noResults = document.createElement('div');
        noResults.className = 'suggestion-no-results';
        noResults.textContent = 'No se encontraron productos. Pulse F1 para búsqueda avanzada.';
        suggestionBox.appendChild(noResults);
        suggestionBox.style.display = 'block';
    } else {
        suggestionBox.style.display = 'none';
    }
}

/**
 * Procesa la entrada del campo de producto (código de barras o texto)
 * @param {string} valor - Valor ingresado
 */
async function procesarEntradaProducto(valor) {
    if (!valor) return;
    
    try {
        // Primero intentar buscar por código de barras
        let producto = await buscarProductoPorCodigoBarras(valor);
        
        // Si no se encuentra, buscar por código interno
        if (!producto) {
            producto = await buscarProductoPorCodigo(valor);
        }
        
        // Si sigue sin encontrarse, buscar por nombre parcial
        if (!producto) {
            const productos = await buscarProductosPorNombre(valor);
            if (productos.length === 1) {
                producto = productos[0];
            } else if (productos.length > 1) {
                // Si hay múltiples resultados, abrir modal de búsqueda
                abrirModalBusquedaProductos(valor);
                return;
            }
        }
        
        // Si se encontró el producto, agregarlo a la factura
        if (producto) {
            agregarProductoAFactura(producto);
            document.getElementById('producto-input').value = '';
        } else {
            // Si no se encontró, preguntar si desea agregar manualmente
            confirmarIngresoManual(valor);
        }
    } catch (error) {
        console.error('Error al procesar producto:', error);
        notifications.mostrarError('Error al buscar el producto');
    }
}

/**
 * Busca un producto por código de barras
 * @param {string} codigoBarras - Código de barras a buscar
 * @returns {Promise<Object|null>} - Producto encontrado o null
 */
async function buscarProductoPorCodigoBarras(codigoBarras) {
    try {
        const producto = await database.query(
            'SELECT * FROM productos WHERE codigoBarras = ?',
            [codigoBarras]
        );
        return producto.length > 0 ? producto[0] : null;
    } catch (error) {
        console.error('Error al buscar por código de barras:', error);
        return null;
    }
}

/**
 * Busca un producto por su código interno
 * @param {string} codigo - Código interno del producto
 * @returns {Promise<Object|null>} - Producto encontrado o null
 */
async function buscarProductoPorCodigo(codigo) {
    try {
        const producto = await database.query(
            'SELECT * FROM productos WHERE codigo = ?',
            [codigo]
        );
        return producto.length > 0 ? producto[0] : null;
    } catch (error) {
        console.error('Error al buscar por código:', error);
        return null;
    }
}

/**
 * Busca productos por nombre (búsqueda parcial)
 * @param {string} nombre - Nombre o parte del nombre a buscar
 * @returns {Promise<Array>} - Lista de productos encontrados
 */
async function buscarProductosPorNombre(nombre) {
    try {
        return await database.query(
            'SELECT * FROM productos WHERE nombre LIKE ? LIMIT 10',
            [`%${nombre}%`]
        );
    } catch (error) {
        console.error('Error al buscar por nombre:', error);
        return [];
    }
}

/**
 * Busca un producto por ID y lo agrega a la factura
 * @param {string|number} id - ID del producto
 */
async function buscarYAgregarProductoPorId(id) {
    try {
        const producto = await database.query(
            'SELECT * FROM productos WHERE id = ?',
            [id]
        );
        
        if (producto.length > 0) {
            agregarProductoAFactura(producto[0]);
            document.getElementById('producto-input').value = '';
        }
    } catch (error) {
        console.error('Error al buscar producto por ID:', error);
        notifications.mostrarError('No se pudo cargar el producto');
    }
}

/**
 * Agrega un producto a la factura actual
 * @param {Object} producto - Datos del producto a agregar
 * @param {number} cantidad - Cantidad del producto (por defecto 1)
 */
function agregarProductoAFactura(producto, cantidad = 1) {
    // Verificar si el producto ya está en la factura
    const indexExistente = productosEnFactura.findIndex(p => p.id === producto.id);
    
    if (indexExistente !== -1) {
        // Si ya existe, aumentar cantidad
        productosEnFactura[indexExistente].cantidad += parseInt(cantidad, 10);
        productosEnFactura[indexExistente].subtotal = 
            productosEnFactura[indexExistente].precio * productosEnFactura[indexExistente].cantidad;
    } else {
        // Si no existe, agregar como nuevo
        const productoFactura = {
            id: producto.id,
            codigo: producto.codigo,
            codigoBarras: producto.codigoBarras,
            nombre: producto.nombre,
            precio: parseFloat(producto.precio),
            precioOriginal: parseFloat(producto.precio),
            porcentajeIva: producto.porcentajeIva || 21,
            cantidad: parseInt(cantidad, 10),
            subtotal: parseFloat(producto.precio) * parseInt(cantidad, 10),
            imagen: producto.imagen || null
        };
        
        productosEnFactura.push(productoFactura);
    }
    
    // Actualizar la lista visual y mostrar imagen del producto
    renderizarListaProductos();
    calcularTotales();
    mostrarImagenProductoTemporalmente(producto);
}

/**
 * Muestra la imagen del producto temporalmente
 * @param {Object} producto - Producto cuya imagen se mostrará
 */
function mostrarImagenProductoTemporalmente(producto) {
    if (!producto.imagen) return;
    
    // Limpiar timeout anterior si existe
    if (timeoutImagenProducto) {
        clearTimeout(timeoutImagenProducto);
    }
    
    // Crear o actualizar el elemento de imagen flotante
    let imagenFlotante = document.getElementById('imagen-producto-flotante');
    if (!imagenFlotante) {
        imagenFlotante = document.createElement('div');
        imagenFlotante.id = 'imagen-producto-flotante';
        document.body.appendChild(imagenFlotante);
    }
    
    // Configurar la imagen
    imagenFlotante.innerHTML = `
        <img src="${producto.imagen}" alt="${producto.nombre}" />
        <div class="producto-info">
            <div class="producto-nombre">${producto.nombre}</div>
            <div class="producto-precio">${parseFloat(producto.precio).toLocaleString('es-AR', {
                style: 'currency',
                currency: 'ARS'
            })}</div>
        </div>
    `;
    
    // Mostrar con animación
    imagenFlotante.style.display = 'block';
    setTimeout(() => {
        imagenFlotante.classList.add('visible');
    }, 10);
    
    // Ocultar después de un tiempo
    timeoutImagenProducto = setTimeout(() => {
        imagenFlotante.classList.remove('visible');
        setTimeout(() => {
            imagenFlotante.style.display = 'none';
        }, 300); // Tiempo de la transición
    }, 3000); // Mostrar por 3 segundos
}

/**
 * Renderiza la lista de productos en la factura
 */
function renderizarListaProductos() {
    const listaContainer = document.getElementById('lista-productos');
    if (!listaContainer) return;
    
    listaContainer.innerHTML = '';
    
    if (productosEnFactura.length === 0) {
        listaContainer.innerHTML = '<div class="lista-vacia">No hay productos en la factura</div>';
        return;
    }
    
    productosEnFactura.forEach((producto, index) => {
        const itemElement = document.createElement('div');
        itemElement.className = 'producto-item';
        if (index === indexProductoSeleccionado) {
            itemElement.classList.add('seleccionado');
        }
        
        const precioFormateado = producto.precio.toLocaleString('es-AR', {
            style: 'currency',
            currency: 'ARS'
        });
        
        const subtotalFormateado = producto.subtotal.toLocaleString('es-AR', {
            style: 'currency',
            currency: 'ARS'
        });
        
        itemElement.innerHTML = `
            <div class="producto-info-principal">
                <div class="producto-nombre">${producto.nombre}</div>
                <div class="producto-acciones">
                    <button class="btn-restar" title="Restar uno"><i class="fas fa-minus"></i></button>
                    <span class="producto-cantidad">${producto.cantidad}</span>
                    <button class="btn-sumar" title="Sumar uno"><i class="fas fa-plus"></i></button>
                    <button class="btn-editar" title="Editar (F2)"><i class="fas fa-edit"></i></button>
                    <button class="btn-eliminar" title="Eliminar"><i class="fas fa-trash"></i></button>
                </div>
            </div>
            <div class="producto-info-secundaria">
                <div class="producto-codigo">${producto.codigo || ''}</div>
                <div class="producto-precios">
                    <span class="producto-precio">${precioFormateado}</span>
                    <span class="producto-subtotal">${subtotalFormateado}</span>
                </div>
            </div>
        `;
        
        // Agregar eventos a los botones
        itemElement.querySelector('.btn-restar').addEventListener('click', () => {
            modificarCantidad(index, -1);
        });
        
        itemElement.querySelector('.btn-sumar').addEventListener('click', () => {
            modificarCantidad(index, 1);
        });
        
        itemElement.querySelector('.btn-editar').addEventListener('click', () => {
            abrirModalEdicionRapida(index);
        });
        
        itemElement.querySelector('.btn-eliminar').addEventListener('click', () => {
            eliminarProducto(index);
        });
        
        // Evento para seleccionar el producto
        itemElement.addEventListener('click', (e) => {
            // No ejecutar si el clic fue en un botón
            if (e.target.closest('button')) return;
            
            // Quitar selección anterior
            const itemSeleccionado = listaContainer.querySelector('.producto-item.seleccionado');
            if (itemSeleccionado) {
                itemSeleccionado.classList.remove('seleccionado');
            }
            
            // Aplicar nueva selección
            itemElement.classList.add('seleccionado');
            indexProductoSeleccionado = index;
        });
        
        listaContainer.appendChild(itemElement);
    });
}

/**
 * Modifica la cantidad de un producto en la factura
 * @param {number} index - Índice del producto en el array
 * @param {number} cambio - Cantidad a sumar (positivo) o restar (negativo)
 */
function modificarCantidad(index, cambio) {
    if (index < 0 || index >= productosEnFactura.length) return;
    
    const nuevaCantidad = productosEnFactura[index].cantidad + cambio;
    
    if (nuevaCantidad <= 0) {
        // Si la cantidad llega a cero, preguntar si desea eliminar
        if (confirm('¿Desea eliminar este producto de la factura?')) {
            eliminarProducto(index);
        }
    } else {
        productosEnFactura[index].cantidad = nuevaCantidad;
        productosEnFactura[index].subtotal = productosEnFactura[index].precio * nuevaCantidad;
        renderizarListaProductos();
        calcularTotales();
    }
}

/**
 * Elimina un producto de la factura
 * @param {number} index - Índice del producto a eliminar
 */
function eliminarProducto(index) {
    if (index < 0 || index >= productosEnFactura.length) return;
    
    productosEnFactura.splice(index, 1);
    
    // Actualizar el índice seleccionado
    if (indexProductoSeleccionado === index) {
        indexProductoSeleccionado = -1;
    } else if (indexProductoSeleccionado > index) {
        indexProductoSeleccionado--;
    }
    
    renderizarListaProductos();
    calcularTotales();
}

/**
 * Abre el modal para edición rápida de precio y cantidad (F2)
 * @param {number} index - Índice del producto a editar
 */
function abrirModalEdicionRapida(index) {
    if (index < 0 || index >= productosEnFactura.length) return;
    
    const producto = productosEnFactura[index];
    
    // Crear modal (se puede mejorar usando un sistema de modales)
    const modalHtml = `
        <div class="modal-header">
            <h3>Editar Producto</h3>
            <button class="btn-cerrar-modal"><i class="fas fa-times"></i></button>
        </div>
        <div class="modal-body">
            <h4>${producto.nombre}</h4>
            <div class="form-group">
                <label for="edit-precio">Precio:</label>
                <div class="input-group">
                    <span class="input-group-text">$</span>
                    <input type="number" id="edit-precio" value="${producto.precio}" step="0.01" min="0">
                </div>
                <div class="precio-original">
                    Precio original: ${producto.precioOriginal.toLocaleString('es-AR', {
                        style: 'currency',
                        currency: 'ARS'
                    })}
                    <button id="btn-restaurar-precio" class="btn-link">Restaurar</button>
                </div>
            </div>
            <div class="form-group">
                <label for="edit-cantidad">Cantidad:</label>
                <input type="number" id="edit-cantidad" value="${producto.cantidad}" min="1" step="1">
            </div>
            <div class="form-group">
                <label for="edit-porcentaje-iva">IVA %:</label>
                <input type="number" id="edit-porcentaje-iva" value="${producto.porcentajeIva}" min="0" max="100" step="0.01">
            </div>
            <div class="subtotal-container">
                <span>Subtotal:</span>
                <span id="edit-subtotal">${producto.subtotal.toLocaleString('es-AR', {
                    style: 'currency',
                    currency: 'ARS'
                })}</span>
            </div>
        </div>
        <div class="modal-footer">
            <button id="btn-confirmar-edicion" class="btn-primary">Confirmar</button>
            <button id="btn-cancelar-edicion" class="btn-secondary">Cancelar</button>
        </div>
    `;
    
    // Mostrar modal (usando un sistema de modales existente)
    const modal = showModal('Editar Producto', modalHtml);
    
    // Función para actualizar el subtotal en tiempo real
    const actualizarSubtotal = () => {
        const precio = parseFloat(document.getElementById('edit-precio').value) || 0;
        const cantidad = parseInt(document.getElementById('edit-cantidad').value) || 0;
        const subtotal = precio * cantidad;
        
        document.getElementById('edit-subtotal').textContent = subtotal.toLocaleString('es-AR', {
            style: 'currency',
            currency: 'ARS'
        });
    };
    
    // Eventos en el modal
    document.getElementById('edit-precio').addEventListener('input', actualizarSubtotal);
    document.getElementById('edit-cantidad').addEventListener('input', actualizarSubtotal);
    
    document.getElementById('btn-restaurar-precio').addEventListener('click', () => {
        document.getElementById('edit-precio').value = producto.precioOriginal;
        actualizarSubtotal();
    });
    
    document.getElementById('btn-confirmar-edicion').addEventListener('click', () => {
        const nuevoPrecio = parseFloat(document.getElementById('edit-precio').value) || 0;
        const nuevaCantidad = parseInt(document.getElementById('edit-cantidad').value) || 0;
        const nuevoPorcentajeIva = parseFloat(document.getElementById('edit-porcentaje-iva').value) || 0;
        
        if (nuevoPrecio <= 0) {
            notifications.mostrarError('El precio debe ser mayor a cero');
            return;
        }
        
        if (nuevaCantidad <= 0) {
            notifications.mostrarError('La cantidad debe ser mayor a cero');
            return;
        }
        
        // Actualizar datos del producto
        productosEnFactura[index].precio = nuevoPrecio;
        productosEnFactura[index].cantidad = nuevaCantidad;
        productosEnFactura[index].porcentajeIva = nuevoPorcentajeIva;
        productosEnFactura[index].subtotal = nuevoPrecio * nuevaCantidad;
        
        renderizarListaProductos();
        calcularTotales();
        closeModal(modal);
    });
    
    document.getElementById('btn-cancelar-edicion').addEventListener('click', () => {
        closeModal(modal);
    });
    
    // Seleccionar todo el texto al hacer foco
    const inputs = modal.querySelectorAll('input[type="number"]');
    inputs.forEach(input => {
        input.addEventListener('focus', function() {
            this.select();
        });
    });
    
    // Focus en el campo de precio
    document.getElementById('edit-precio').focus();
}

/**
 * Muestra un modal preguntando si se desea agregar el producto manualmente
 * @param {string} texto - Texto ingresado que no coincide con productos existentes
 */
function confirmarIngresoManual(texto) {
    // Crear contenido del modal
    const modalHtml = `
        <div class="modal-body">
            <p>No se encontró el producto con código o nombre: <strong>${texto}</strong></p>
            <p>¿Desea agregarlo manualmente a la factura?</p>
        </div>
        <div class="modal-footer">
            <button id="btn-agregar-manual" class="btn-primary">Agregar manual</button>
            <button id="btn-ir-productos" class="btn-secondary">Ir a Productos</button>
            <button id="btn-cancelar" class="btn-link">Cancelar</button>
        </div>
    `;
    
    // Mostrar modal
    const modal = showModal('Producto no encontrado', modalHtml);
    
    // Configurar eventos
    document.getElementById('btn-agregar-manual').addEventListener('click', () => {
        closeModal(modal);
        abrirModalProductoManual(texto);
    });
    
    document.getElementById('btn-ir-productos').addEventListener('click', () => {
        closeModal(modal);
        // Abrir pestaña de productos con búsqueda precargada
        tabsManager.abrirNuevaPestana('productos', { busqueda: texto });
    });
    
    document.getElementById('btn-cancelar').addEventListener('click', () => {
        closeModal(modal);
    });
}

/**
 * Abre modal para ingresar un producto manual a la factura
 * @param {string} textoInicial - Texto inicial para nombre del producto
 */
function abrirModalProductoManual(textoInicial = '') {
    // Crear contenido del modal
    const modalHtml = `
        <div class="modal-header">
            <h3>Agregar Producto Manual</h3>
            <button class="btn-cerrar-modal"><i class="fas fa-times"></i></button>
        </div>
        <div class="modal-body">
            <div class="form-group">
                <label for="manual-nombre">Nombre del producto:</label>
                <input type="text" id="manual-nombre" value="${textoInicial}" class="form-control">
            </div>
            <div class="form-group">
                <label for="manual-precio">Precio:</label>
                <div class="input-group">
                    <span class="input-group-text">$</span>
                    <input type="number" id="manual-precio" value="0" step="0.01" min="0" class="form-control">
                </div>
            </div>
            <div class="form-group">
                <label for="manual-cantidad">Cantidad:</label>
                <input type="number" id="manual-cantidad" value="1" min="1" step="1" class="form-control">
            </div>
            <div class="form-group">
                <label for="manual-porcentaje-iva">IVA %:</label>
                <input type="number" id="manual-porcentaje-iva" value="21" min="0" max="100" step="0.01" class="form-control">
            </div>
        </div>
        <div class="modal-footer">
            <button id="btn-confirmar-manual" class="btn-primary">Agregar a la factura</button>
            <button id="btn-cancelar-manual" class="btn-secondary">Cancelar</button>
        </div>
    `;
    
    // Mostrar modal
    const modal = showModal('Agregar Producto Manual', modalHtml);
    
    // Configurar eventos
    document.getElementById('btn-confirmar-manual').addEventListener('click', () => {
        const nombre = document.getElementById('manual-nombre').value.trim();
        const precio = parseFloat(document.getElementById('manual-precio').value) || 0;
        const cantidad = parseInt(document.getElementById('manual-cantidad').value) || 1;
        const porcentajeIva = parseFloat(document.getElementById('manual-porcentaje-iva').value) || 21;
        
        if (!nombre) {
            notifications.mostrarError('Debe ingresar un nombre para el producto');
            return;
        }
        
        if (precio <= 0) {
            notifications.mostrarError('El precio debe ser mayor a cero');
            return;
        }
        
        // Crear producto temporal para agregar a la factura
        const productoManual = {
            id: `temp-${Date.now()}`, // ID temporal
            codigo: 'MANUAL',
            nombre: nombre,
            precio: precio,
            precioOriginal: precio,
            porcentajeIva: porcentajeIva,
            cantidad: cantidad,
            subtotal: precio * cantidad,
            imagen: null,
            esManual: true
        };
        
        agregarProductoAFactura(productoManual, cantidad);
        closeModal(modal);
    });
    
    document.getElementById('btn-cancelar-manual').addEventListener('click', () => {
        closeModal(modal);
    });
    
    // Focus en el campo de nombre
    document.getElementById('manual-nombre').focus();
}

/**
 * Abre el modal de búsqueda avanzada de productos
 * @param {string} textoBusqueda - Texto inicial para la búsqueda
 */
function abrirModalBusquedaProductos(textoBusqueda = '') {
    // Crear estructura del modal
    const modalHtml = `
        <div class="modal-header">
            <h3>Búsqueda de Productos</h3>
            <button class="btn-cerrar-modal"><i class="fas fa-times"></i></button>
        </div>
        <div class="modal-body">
            <div class="search-container">
                <div class="input-group">
                    <input type="text" id="modal-busqueda" class="form-control" placeholder="Buscar por nombre, código o categoría" value="${textoBusqueda}">
                    <div class="input-group-append">
                        <button id="btn-buscar-modal" class="btn btn-primary">
                            <i class="fas fa-search"></i> Buscar
                        </button>
                    </div>
                </div>
                <div class="filtros-container">
                    <select id="filtro-categoria" class="form-select">
                        <option value="">Todas las categorías</option>
                        <!-- Se cargará dinámicamente -->
                    </select>
                    <select id="filtro-orden" class="form-select">
                        <option value="nombre">Ordenar por nombre</option>
                        <option value="precio-asc">Precio: menor a mayor</option>
                        <option value="precio-desc">Precio: mayor a menor</option>
                        <option value="stock">Stock disponible</option>
                    </select>
                </div>
            </div>
            <div class="resultados-container">
                <div id="tabla-resultados" class="table-responsive">
                    <table class="table table-hover">
                        <thead>
                            <tr>
                                <th>Código</th>
                                <th>Nombre</th>
                                <th>Precio</th>
                                <th>Stock</th>
                                <th>Acciones</th>
                            </tr>
                        </thead>
                        <tbody id="resultados-busqueda">
                            <!-- Resultados se cargarán aquí -->
                            <tr>
                                <td colspan="5" class="text-center">Ingrese un término de búsqueda</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <div id="paginacion" class="paginacion">
                    <!-- Paginación se generará aquí -->
                </div>
            </div>
        </div>
        <div class="modal-footer">
            <button id="btn-agregar-manual-modal" class="btn btn-secondary">Agregar Manual</button>
            <button id="btn-cerrar-busqueda" class="btn btn-link">Cerrar</button>
        </div>
    `;
    
    // Mostrar modal
    const modal = showModal('Búsqueda de Productos', modalHtml, { size: 'lg' });
    
    // Cargar categorías en el select
    cargarCategorias();
    
    // Si hay texto de búsqueda inicial, realizar búsqueda
    if (textoBusqueda) {
        buscarProductosModal(textoBusqueda, 1);
    }
    
    // Configurar eventos
    document.getElementById('modal-busqueda').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const texto = e.target.value.trim();
            if (texto) {
                buscarProductosModal(texto, 1);
            }
        }
    });
    
    document.getElementById('btn-buscar-modal').addEventListener('click', () => {
        const texto = document.getElementById('modal-busqueda').value.trim();
        if (texto) {
            buscarProductosModal(texto, 1);
        }
    });
    
    document.getElementById('filtro-categoria').addEventListener('change', () => {
        const texto = document.getElementById('modal-busqueda').value.trim();
        if (texto) {
            buscarProductosModal(texto, 1);
        }
    });
    
    document.getElementById('filtro-orden').addEventListener('change', () => {
        const texto = document.getElementById('modal-busqueda').value.trim();
        if (texto) {
            buscarProductosModal(texto, 1);
        }
    });
    
    document.getElementById('btn-agregar-manual-modal').addEventListener('click', () => {
        const texto = document.getElementById('modal-busqueda').value.trim();
        closeModal(modal);
        abrirModalProductoManual(texto);
    });
    
    document.getElementById('btn-cerrar-busqueda').addEventListener('click', () => {
        closeModal(modal);
    });
    
    // Focus en el campo de búsqueda
    document.getElementById('modal-busqueda').focus();
}

/**
 * Carga las categorías de productos para el filtro del modal
 */
async function cargarCategorias() {
    try {
        const categorias = await database.query(
            'SELECT DISTINCT grupo FROM productos WHERE grupo IS NOT NULL ORDER BY grupo'
        );
        
        const selectCategorias = document.getElementById('filtro-categoria');
        if (!selectCategorias) return;
        
        // Mantener la opción por defecto
        let html = '<option value="">Todas las categorías</option>';
        
        // Agregar las categorías
        categorias.forEach(categoria => {
            if (categoria.grupo) {
                html += `<option value="${categoria.grupo}">${categoria.grupo}</option>`;
            }
        });
        
        selectCategorias.innerHTML = html;
    } catch (error) {
        console.error('Error al cargar categorías:', error);
    }
}

/**
 * Realiza la búsqueda de productos en el modal
 * @param {string} texto - Texto de búsqueda
 * @param {number} pagina - Número de página para paginación
 */
async function buscarProductosModal(texto, pagina = 1) {
    try {
        const resultadosContainer = document.getElementById('resultados-busqueda');
        if (!resultadosContainer) return;
        
        // Mostrar cargando
        resultadosContainer.innerHTML = '<tr><td colspan="5" class="text-center">Cargando...</td></tr>';
        
        // Obtener filtros
        const categoria = document.getElementById('filtro-categoria').value;
        const orden = document.getElementById('filtro-orden').value;
        
        // Configurar ordenamiento SQL
        let ordenSql = 'nombre ASC';
        switch (orden) {
            case 'precio-asc':
                ordenSql = 'precio ASC';
                break;
            case 'precio-desc':
                ordenSql = 'precio DESC';
                break;
            case 'stock':
                ordenSql = 'stock DESC';
                break;
        }
        
        // Calcular offset para paginación
        const itemsPorPagina = 10;
        const offset = (pagina - 1) * itemsPorPagina;
        
        // Construir consulta base
        let query = `
            SELECT id, codigo, codigoBarras, nombre, precio, stock, imagen, grupo, porcentajeIva
            FROM productos
            WHERE (nombre LIKE ? OR codigo LIKE ? OR codigoBarras LIKE ?)
        `;
        
        let params = [`%${texto}%`, `%${texto}%`, `%${texto}%`];
        
        // Agregar filtro de categoría si está seleccionado
        if (categoria) {
            query += ' AND grupo = ?';
            params.push(categoria);
        }
        
        // Contar total de resultados para paginación
        const countQuery = query.replace('SELECT id, codigo, codigoBarras, nombre, precio, stock, imagen, grupo, porcentajeIva', 'SELECT COUNT(*) as total');
        const conteo = await database.query(countQuery, params);
        const totalResultados = conteo[0].total;
        
        // Agregar ordenamiento y paginación
        query += ` ORDER BY ${ordenSql} LIMIT ? OFFSET ?`;
        params.push(itemsPorPagina, offset);
        
        // Ejecutar consulta
        const productos = await database.query(query, params);
        
        // Si no hay resultados
        if (productos.length === 0) {
            resultadosContainer.innerHTML = '<tr><td colspan="5" class="text-center">No se encontraron productos</td></tr>';
            document.getElementById('paginacion').innerHTML = '';
            return;
        }
        
        // Generar HTML de resultados
        let html = '';
        productos.forEach(producto => {
            const precio = parseFloat(producto.precio).toLocaleString('es-AR', {
                style: 'currency',
                currency: 'ARS'
            });
            
            html += `
                <tr data-id="${producto.id}">
                    <td>${producto.codigo || ''}</td>
                    <td>${producto.nombre}</td>
                    <td>${precio}</td>
                    <td>${producto.stock || 0}</td>
                    <td>
                        <button class="btn btn-sm btn-primary btn-agregar-producto" title="Agregar a factura">
                            <i class="fas fa-plus"></i>
                        </button>
                        <button class="btn btn-sm btn-info btn-info-producto" title="Ver detalles">
                            <i class="fas fa-info-circle"></i>
                        </button>
                    </td>
                </tr>
            `;
        });
        
        resultadosContainer.innerHTML = html;
        
        // Generar paginación
        generarPaginacion(pagina, totalResultados, itemsPorPagina, texto);
        
        // Agregar eventos a los botones de agregar
        const botonesAgregar = document.querySelectorAll('.btn-agregar-producto');
        botonesAgregar.forEach(boton => {
            boton.addEventListener('click', (e) => {
                const id = e.target.closest('tr').dataset.id;
                buscarYAgregarProductoPorId(id);
            });
        });
        
        // Agregar eventos a los botones de info
        const botonesInfo = document.querySelectorAll('.btn-info-producto');
        botonesInfo.forEach(boton => {
            boton.addEventListener('click', (e) => {
                const id = e.target.closest('tr').dataset.id;
                mostrarDetallesProducto(id);
            });
        });
        
        // Evento doble clic en fila para agregar producto
        const filas = document.querySelectorAll('#resultados-busqueda tr');
        filas.forEach(fila => {
            fila.addEventListener('dblclick', (e) => {
                const id = fila.dataset.id;
                if (id) {
                    buscarYAgregarProductoPorId(id);
                }
            });
        });
    } catch (error) {
        console.error('Error al buscar productos:', error);
        const resultadosContainer = document.getElementById('resultados-busqueda');
        if (resultadosContainer) {
            resultadosContainer.innerHTML = '<tr><td colspan="5" class="text-center">Error al buscar productos</td></tr>';
        }
    }
}

/**
 * Genera la paginación para el modal de búsqueda
 * @param {number} paginaActual - Página actual
 * @param {number} totalItems - Total de items encontrados
 * @param {number} itemsPorPagina - Items por página
 * @param {string} textoBusqueda - Texto de búsqueda actual
 */
function generarPaginacion(paginaActual, totalItems, itemsPorPagina, textoBusqueda) {
    const paginacionContainer = document.getElementById('paginacion');
    if (!paginacionContainer) return;
    
    const totalPaginas = Math.ceil(totalItems / itemsPorPagina);
    
    if (totalPaginas <= 1) {
        paginacionContainer.innerHTML = '';
        return;
    }
    
    let html = '<ul class="pagination">';
    
    // Botón anterior
    html += `
        <li class="page-item ${paginaActual === 1 ? 'disabled' : ''}">
            <a class="page-link" href="#" data-pagina="${paginaActual - 1}">Anterior</a>
        </li>
    `;
    
    // Mostrar siempre primera página
    html += `
        <li class="page-item ${paginaActual === 1 ? 'active' : ''}">
            <a class="page-link" href="#" data-pagina="1">1</a>
        </li>
    `;
    
    // Puntos suspensivos iniciales si es necesario
    if (paginaActual > 3) {
        html += '<li class="page-item disabled"><span class="page-link">...</span></li>';
    }
    
    // Páginas alrededor de la actual
    for (let i = Math.max(2, paginaActual - 1); i <= Math.min(totalPaginas - 1, paginaActual + 1); i++) {
        html += `
            <li class="page-item ${paginaActual === i ? 'active' : ''}">
                <a class="page-link" href="#" data-pagina="${i}">${i}</a>
            </li>
        `;
    }
    
    // Puntos suspensivos finales si es necesario
    if (paginaActual < totalPaginas - 2) {
        html += '<li class="page-item disabled"><span class="page-link">...</span></li>';
    }
    
    // Mostrar siempre última página si hay más de una
    if (totalPaginas > 1) {
        html += `
            <li class="page-item ${paginaActual === totalPaginas ? 'active' : ''}">
                <a class="page-link" href="#" data-pagina="${totalPaginas}">${totalPaginas}</a>
            </li>
        `;
    }
    
    // Botón siguiente
    html += `
        <li class="page-item ${paginaActual === totalPaginas ? 'disabled' : ''}">
            <a class="page-link" href="#" data-pagina="${paginaActual + 1}">Siguiente</a>
        </li>
    `;
    
    html += '</ul>';
    
    paginacionContainer.innerHTML = html;
    
    // Agregar eventos a los enlaces de paginación
    const enlaces = paginacionContainer.querySelectorAll('.page-link');
    enlaces.forEach(enlace => {
        enlace.addEventListener('click', (e) => {
            e.preventDefault();
            const pagina = parseInt(e.target.dataset.pagina);
            if (!isNaN(pagina) && pagina > 0) {
                buscarProductosModal(textoBusqueda, pagina);
            }
        });
    });
}

/**
 * Muestra los detalles de un producto en un modal
 * @param {string|number} id - ID del producto
 */
async function mostrarDetallesProducto(id) {
    try {
        const producto = await database.query(
            'SELECT * FROM productos WHERE id = ?',
            [id]
        );
        
        if (producto.length === 0) {
            notifications.mostrarError('Producto no encontrado');
            return;
        }
        
        const item = producto[0];
        
        // Formatear precio
        const precio = parseFloat(item.precio).toLocaleString('es-AR', {
            style: 'currency',
            currency: 'ARS'
        });
        
        // Crear estructura del modal
        const modalHtml = `
            <div class="modal-header">
                <h3>Detalles del Producto</h3>
                <button class="btn-cerrar-modal"><i class="fas fa-times"></i></button>
            </div>
            <div class="modal-body">
                <div class="row">
                    <div class="col-md-4 text-center">
                        <img src="${item.imagen || '../assets/img/products/default.png'}" 
                             alt="${item.nombre}" 
                             class="img-producto-detalle">
                    </div>
                    <div class="col-md-8">
                        <h4>${item.nombre}</h4>
                        <div class="detalles-producto">
                            <div class="detalle-item">
                                <span class="label">Código:</span>
                                <span class="valor">${item.codigo || 'No definido'}</span>
                            </div>
                            <div class="detalle-item">
                                <span class="label">Código de Barras:</span>
                                <span class="valor">${item.codigoBarras || 'No definido'}</span>
                            </div>
                            <div class="detalle-item">
                                <span class="label">Precio:</span>
                                <span class="valor">${precio}</span>
                            </div>
                            <div class="detalle-item">
                                <span class="label">Stock:</span>
                                <span class="valor">${item.stock || 0}</span>
                            </div>
                            <div class="detalle-item">
                                <span class="label">IVA:</span>
                                <span class="valor">${item.porcentajeIva || 21}%</span>
                            </div>
                            <div class="detalle-item">
                                <span class="label">Categoría:</span>
                                <span class="valor">${item.grupo || 'No definida'}</span>
                            </div>
                            <div class="detalle-item">
                                <span class="label">Subcategoría:</span>
                                <span class="valor">${item.subgrupo || 'No definida'}</span>
                            </div>
                        </div>
                    </div>
                </div>
                ${item.descripcion ? `
                <div class="descripcion-producto">
                    <h5>Descripción</h5>
                    <p>${item.descripcion}</p>
                </div>
                ` : ''}
            </div>
            <div class="modal-footer">
                <div class="cantidad-container">
                    <label for="detalle-cantidad">Cantidad:</label>
                    <input type="number" id="detalle-cantidad" value="1" min="1" step="1" class="form-control">
                </div>
                <button id="btn-agregar-desde-detalle" class="btn btn-primary">Agregar a factura</button>
                <button id="btn-cerrar-detalle" class="btn btn-link">Cerrar</button>
            </div>
        `;
        
        // Mostrar modal
        const modal = showModal('Detalles del Producto', modalHtml, { size: 'md' });
        
        // Configurar eventos
        document.getElementById('btn-agregar-desde-detalle').addEventListener('click', () => {
            const cantidad = parseInt(document.getElementById('detalle-cantidad').value) || 1;
            buscarYAgregarProductoPorId(id, cantidad);
            closeModal(modal);
        });
        
        document.getElementById('btn-cerrar-detalle').addEventListener('click', () => {
            closeModal(modal);
        });
        
    } catch (error) {
        console.error('Error al mostrar detalles del producto:', error);
        notifications.mostrarError('No se pudieron cargar los detalles del producto');
    }
}

/**
 * Carga el cache de productos para autocompletado
 */
async function cargarCacheProductos() {
    try {
        // Cargar productos más vendidos o recientes
        productosCache = await database.query(
            `SELECT id, codigo, codigoBarras, nombre, precio, stock, porcentajeIva 
             FROM productos 
             ORDER BY ventas DESC, ultimaVenta DESC 
             LIMIT 500`
        );
    } catch (error) {
        console.error('Error al cargar cache de productos:', error);
        productosCache = [];
    }
}

/**
 * Calcula los totales de la factura y emite evento
 */
function calcularTotales() {
    if (!productosEnFactura.length) {
        // Emitir evento de actualización con valores en cero
        const evento = new CustomEvent('facturador:actualizacion-totales', {
            detail: {
                subtotal: 0,
                descuento: 0,
                iva: 0,
                total: 0,
                items: 0,
                productosEnFactura: []
            }
        });
        document.dispatchEvent(evento);
        return;
    }
    
    // Calcular totales
    let subtotal = 0;
    let montoIva = 0;
    let cantidadTotal = 0;
    
    productosEnFactura.forEach(producto => {
        subtotal += producto.subtotal;
        montoIva += producto.subtotal * (producto.porcentajeIva / 100);
        cantidadTotal += producto.cantidad;
    });
    
    // Obtener descuento/recargo general si existe
    const descuentoElement = document.getElementById('descuento-general');
    let descuento = 0;
    if (descuentoElement) {
        const valorDescuento = parseFloat(descuentoElement.value) || 0;
        descuento = subtotal * (Math.abs(valorDescuento) / 100) * (valorDescuento < 0 ? -1 : 1);
    }
    
    // Calcular total final
    const totalFinal = subtotal - descuento + montoIva;
    
    // Emitir evento para actualizar otros componentes
    const evento = new CustomEvent('facturador:actualizacion-totales', {
        detail: {
            subtotal: subtotal,
            descuento: descuento,
            iva: montoIva,
            total: totalFinal,
            items: cantidadTotal,
            productosEnFactura: productosEnFactura
        }
    });
    document.dispatchEvent(evento);
}

/**
 * Gestiona la lectura de códigos de barras desde un scanner
 * @param {KeyboardEvent} e - Evento de teclado
 */
function gestionarScannerCodigoBarras(e) {
    // Detectar si es una entrada de código de barras
    // Los scanners suelen enviar caracteres muy rápido y terminar con Enter
    const now = Date.now();
    const timeBetweenKeystrokes = now - lastBarcodeTime;
    lastBarcodeTime = now;
    
    // Si está enfocado en un input de texto, no procesar como scanner
    if (document.activeElement.tagName === 'INPUT' && 
        (document.activeElement.type === 'text' || document.activeElement.type === 'number')) {
        return;
    }
    
    // Si es un carácter imprimible, podría ser parte de un código de barras
    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        // Si el intervalo entre teclas es mayor a 100ms, probablemente no es un scanner
        if (timeBetweenKeystrokes > 100) {
            barcodeBuffer = '';
            scanningBarcode = false;
        }
        
        // Si empezamos a recibir caracteres rápido, iniciar captura
        if (timeBetweenKeystrokes < 50) {
            scanningBarcode = true;
            barcodeBuffer += e.key;
            e.preventDefault(); // Evitar que el carácter se escriba en otros campos
        }
    }
    
    // Si recibimos un Enter y estábamos escaneando un código de barras
    if (e.key === 'Enter' && scanningBarcode && barcodeBuffer.length > 3) {
        e.preventDefault();
        procesarCodigoBarras(barcodeBuffer);
        barcodeBuffer = '';
        scanningBarcode = false;
    }
    
    // Si pasa mucho tiempo sin completar el código, reiniciar
    if (scanningBarcode && timeBetweenKeystrokes > 200) {
        barcodeBuffer = '';
        scanningBarcode = false;
    }
}

/**
 * Procesa un código de barras escaneado
 * @param {string} codigo - Código de barras capturado
 */
async function procesarCodigoBarras(codigo) {
    // Evitar procesamiento repetido del mismo código
    if (codigo === lastBarcodeScan) {
        const now = Date.now();
        // Ignorar si el mismo código se escanea en menos de 2 segundos
        if (now - lastBarcodeTime < 2000) {
            return;
        }
    }
    
    lastBarcodeScan = codigo;
    
    try {
        // Buscar producto por código de barras
        const producto = await buscarProductoPorCodigoBarras(codigo);
        
        if (producto) {
            // Si se encuentra, agregarlo a la factura
            agregarProductoAFactura(producto);
            
            // Reproducir sonido de éxito (opcional)
            const audio = new Audio('../assets/sounds/beep-success.mp3');
            audio.play().catch(e => console.log('No se pudo reproducir el sonido de éxito'));
        } else {
            // Si no se encuentra, mostrar notificación
            notifications.mostrarError(`Producto con código ${codigo} no encontrado`);
            
            // Reproducir sonido de error (opcional)
            const audio = new Audio('../assets/sounds/beep-error.mp3');
            audio.play().catch(e => console.log('No se pudo reproducir el sonido de error'));
            
            // Preguntar si desea agregar el producto
            confirmarIngresoManual(codigo);
        }
    } catch (error) {
        console.error('Error al procesar código de barras:', error);
        notifications.mostrarError('Error al buscar el producto');
    }
}

/**
 * Función auxiliar para mostrar modales
 * @param {string} titulo - Título del modal
 * @param {string} contenido - Contenido HTML del modal
 * @param {Object} opciones - Opciones adicionales
 * @returns {HTMLElement} - Elemento del modal
 */
function showModal(titulo, contenido, opciones = {}) {
    // Esta función es un placeholder y debería usar el sistema de modales de la aplicación
    // En una implementación real, se usaría el sistema existente
    
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    document.body.appendChild(overlay);
    
    const modalElement = document.createElement('div');
    modalElement.className = `modal-container ${opciones.size ? `modal-${opciones.size}` : ''}`;
    modalElement.innerHTML = contenido;
    document.body.appendChild(modalElement);
    
    // Manejar cierre con botón X
    const btnCerrar = modalElement.querySelector('.btn-cerrar-modal');
    if (btnCerrar) {
        btnCerrar.addEventListener('click', () => {
            closeModal(modalElement);
        });
    }
    
    // Permitir cerrar con Escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeModal(modalElement);
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    return modalElement;
}

/**
 * Función auxiliar para cerrar modales
 * @param {HTMLElement} modal - Elemento del modal a cerrar
 */
function closeModal(modal) {
    // Esta función es un placeholder y debería usar el sistema de modales de la aplicación
    // En una implementación real, se usaría el sistema existente
    
    if (!modal) return;
    
    // Eliminar overlay
    const overlay = document.querySelector('.modal-overlay');
    if (overlay) {
        document.body.removeChild(overlay);
    }
    
    // Eliminar modal
    document.body.removeChild(modal);
}

/**
 * Obtiene la lista de productos en la factura actual
 * @returns {Array} - Lista de productos
 */
export function getProductosEnFactura() {
    return productosEnFactura;
}

/**
 * Obtiene la lista de productos en la factura actual
 * @returns {Array} - Lista de productos
 */
export function getProductosEnFactura() {
    return productosEnFactura;
}

/**
 * Establece la lista de productos en la factura
 * @param {Array} productos - Nueva lista de productos
 */
export function setProductosEnFactura(productos) {
    productosEnFactura = productos || [];
    actualizarTablaProductos();
    calcularTotales();
}

/**
 * Limpia todos los productos de la factura actual
 */
export function limpiarFactura() {
    productosEnFactura = [];
    actualizarTablaProductos();
    calcularTotales();
    notifications.mostrarExito('Factura limpiada correctamente');
}

/**
 * Confirma si el usuario desea ingresar un producto manualmente
 * @param {string} codigo - Código escaneado que no se encontró
 */
function confirmarIngresoManual(codigo) {
    const modalHtml = `
        <div class="modal-header">
            <h3>Producto no encontrado</h3>
            <button class="btn-cerrar-modal"><i class="fas fa-times"></i></button>
        </div>
        <div class="modal-body">
            <p>El producto con código <strong>${codigo}</strong> no existe en la base de datos.</p>
            <p>¿Desea crear un producto manual con este código?</p>
        </div>
        <div class="modal-footer">
            <button id="btn-crear-producto" class="btn btn-primary">Crear Producto</button>
            <button id="btn-producto-manual" class="btn btn-secondary">Agregar Manual</button>
            <button id="btn-cancelar" class="btn btn-link">Cancelar</button>
        </div>
    `;
    
    const modal = showModal('Producto no encontrado', modalHtml);
    
    document.getElementById('btn-crear-producto').addEventListener('click', () => {
        closeModal(modal);
        // Aquí debería redirigir al módulo de creación de productos
        // con el código prellenado
        window.location.href = `../productos/nuevo.html?codigo=${encodeURIComponent(codigo)}`;
    });
    
    document.getElementById('btn-producto-manual').addEventListener('click', () => {
        closeModal(modal);
        abrirModalProductoManual('', codigo);
    });
    
    document.getElementById('btn-cancelar').addEventListener('click', () => {
        closeModal(modal);
    });
}

/**
 * Inicializa el módulo de facturación
 */
export function inicializar() {
    // Cargar caché de productos
    cargarCacheProductos();
    
    // Inicializar tabla de productos
    actualizarTablaProductos();
    
    // Configurar evento de escaneo de código de barras
    document.addEventListener('keydown', gestionarScannerCodigoBarras);
    
    // Configurar evento de búsqueda en input
    const inputBusqueda = document.getElementById('busqueda-producto');
    if (inputBusqueda) {
        inputBusqueda.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const texto = inputBusqueda.value.trim();
                if (texto) {
                    abrirModalBusquedaProductos(texto);
                }
            }
        });
        
        // Botón de búsqueda
        const btnBuscar = document.getElementById('btn-buscar-producto');
        if (btnBuscar) {
            btnBuscar.addEventListener('click', () => {
                const texto = inputBusqueda.value.trim();
                if (texto) {
                    abrirModalBusquedaProductos(texto);
                }
            });
        }
    }
    
    // Botón para agregar producto manual
    const btnProductoManual = document.getElementById('btn-producto-manual');
    if (btnProductoManual) {
        btnProductoManual.addEventListener('click', () => {
            abrirModalProductoManual();
        });
    }
    
    // Configurar evento para descuento/recargo general
    const descuentoElement = document.getElementById('descuento-general');
    if (descuentoElement) {
        descuentoElement.addEventListener('change', () => {
            calcularTotales();
        });
    }
    
    // Escuchar eventos para limpiar factura
    const btnLimpiarFactura = document.getElementById('btn-limpiar-factura');
    if (btnLimpiarFactura) {
        btnLimpiarFactura.addEventListener('click', () => {
            if (productosEnFactura.length > 0) {
                // Pedir confirmación antes de limpiar
                const modalHtml = `
                    <div class="modal-header">
                        <h3>Confirmar acción</h3>
                        <button class="btn-cerrar-modal"><i class="fas fa-times"></i></button>
                    </div>
                    <div class="modal-body">
                        <p>¿Está seguro que desea eliminar todos los productos de la factura actual?</p>
                    </div>
                    <div class="modal-footer">
                        <button id="btn-confirmar-limpiar" class="btn btn-danger">Sí, limpiar factura</button>
                        <button id="btn-cancelar-limpiar" class="btn btn-secondary">Cancelar</button>
                    </div>
                `;
                
                const modal = showModal('Confirmar acción', modalHtml);
                
                document.getElementById('btn-confirmar-limpiar').addEventListener('click', () => {
                    limpiarFactura();
                    closeModal(modal);
                });
                
                document.getElementById('btn-cancelar-limpiar').addEventListener('click', () => {
                    closeModal(modal);
                });
            }
        });
    }
    
    // Calcular totales iniciales
    calcularTotales();
    
    console.log('Módulo de facturación inicializado');
}

// Exportar todas las funciones necesarias
export default {
    inicializar,
    agregarProductoAFactura,
    eliminarProductoDeFactura,
    actualizarCantidadProducto,
    getProductosEnFactura,
    setProductosEnFactura,
    limpiarFactura,
    buscarProductoPorNombre,
    buscarProductoPorCodigo,
    buscarProductoPorCodigoBarras,
    buscarYAgregarProductoPorId,
    abrirModalBusquedaProductos,
    abrirModalProductoManual,
    calcularTotales
};