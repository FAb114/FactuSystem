/**
 * FactuSystem - Módulo Cuotificador: Simulador
 * Permite simular pagos en cuotas para diferentes tarjetas y bancos
 * Muestra cuotas, intereses y totales, y permite llevar la simulación al facturador
 */

// Importaciones
const { getTasasInteres } = require('./tasas.js'); 
const { agregarProductosFacturador } = require('../facturador/facturador.js');
const { showNotification } = require('../../components/notifications.js');
const { createTab } = require('../../components/tabs.js');
const { getProductById, searchProducts } = require('../productos/index.js');
const { formatCurrency, calculateInterest } = require('../../utils/validation.js');
const { saveSimulacion } = require('../../utils/database.js');

// Estado local del simulador
let simuladorState = {
    productosSeleccionados: [],
    subtotal: 0,
    banco: '',
    tarjeta: '',
    cuotas: 1,
    totalConInteres: 0,
    montoPorCuota: 0,
    tasaInteres: 0,
    clienteId: null
};

/**
 * Inicializa el simulador de cuotas
 */
function initSimulador
module.exports.initSimulador = initSimulador() {
    // Agregar listeners a los elementos del DOM
    document.getElementById('buscador-productos').addEventListener('input', handleBusquedaProductos);
    document.getElementById('lista-resultados').addEventListener('click', handleSeleccionProducto);
    document.getElementById('lista-productos-seleccionados').addEventListener('click', handleQuitarProducto);
    document.getElementById('selector-banco').addEventListener('change', handleCambioMetodoPago);
    document.getElementById('selector-tarjeta').addEventListener('change', handleCambioMetodoPago);
    document.getElementById('selector-cuotas').addEventListener('change', handleCambioCuotas);
    document.getElementById('buscar-cliente').addEventListener('click', abrirModalClientes);
    document.getElementById('btn-enviar-facturador').addEventListener('click', enviarAFacturador);
    document.getElementById('btn-guardar-simulacion').addEventListener('click', guardarSimulacion);
    document.getElementById('btn-limpiar-simulador').addEventListener('click', limpiarSimulador);

    // Cargar las opciones de bancos y tarjetas
    cargarOpcionesBancosYTarjetas();
    
    // Actualizar la UI
    actualizarInterfaz();
}

/**
 * Maneja la búsqueda de productos en tiempo real
 * @param {Event} event - Evento de input del buscador
 */
async function handleBusquedaProductos(event) {
    const query = event.target.value.trim();
    if (query.length < 3) {
        document.getElementById('lista-resultados').innerHTML = '';
        return;
    }

    try {
        const productos = await searchProducts(query);
        mostrarResultadosBusqueda(productos);
    } catch (error) {
        console.error('Error al buscar productos:', error);
        showNotification('Error al buscar productos', 'error');
    }
}

/**
 * Muestra los resultados de búsqueda de productos
 * @param {Array} productos - Productos encontrados
 */
function mostrarResultadosBusqueda(productos) {
    const listaResultados = document.getElementById('lista-resultados');
    listaResultados.innerHTML = '';

    if (!productos.length) {
        listaResultados.innerHTML = '<li class="sin-resultados">No se encontraron productos</li>';
        return;
    }

    productos.forEach(producto => {
        const li = document.createElement('li');
        li.className = 'resultado-producto';
        li.dataset.id = producto.id;

        const imgSrc = producto.imagen ? producto.imagen : '../assets/img/products/default.png';
        
        li.innerHTML = `
            <div class="producto-preview">
                <img src="${imgSrc}" alt="${producto.nombre}" class="mini-preview">
                <div class="producto-info">
                    <span class="producto-nombre">${producto.nombre}</span>
                    <span class="producto-precio">${formatCurrency(producto.precio)}</span>
                </div>
            </div>
            <button class="btn-agregar" data-id="${producto.id}">Agregar</button>
        `;

        listaResultados.appendChild(li);
    });
}

/**
 * Maneja la selección de un producto de la lista de resultados
 * @param {Event} event - Evento de click
 */
async function handleSeleccionProducto(event) {
    if (!event.target.matches('.btn-agregar')) return;
    
    const productoId = event.target.dataset.id;
    
    try {
        const producto = await getProductById(productoId);
        
        // Verificar si el producto ya está en la lista
        const productoExistente = simuladorState.productosSeleccionados.find(p => p.id === productoId);
        
        if (productoExistente) {
            productoExistente.cantidad++;
        } else {
            simuladorState.productosSeleccionados.push({
                ...producto,
                cantidad: 1
            });
        }
        
        // Actualizar la interfaz
        actualizarProductosSeleccionados();
        calcularTotales();
        
        // Limpiar la búsqueda
        document.getElementById('buscador-productos').value = '';
        document.getElementById('lista-resultados').innerHTML = '';
        
        showNotification('Producto agregado al simulador', 'success');
    } catch (error) {
        console.error('Error al agregar producto:', error);
        showNotification('Error al agregar el producto', 'error');
    }
}

/**
 * Maneja la eliminación de un producto de la lista de seleccionados
 * @param {Event} event - Evento de click
 */
function handleQuitarProducto(event) {
    if (!event.target.matches('.btn-quitar')) return;
    
    const productoId = event.target.dataset.id;
    
    simuladorState.productosSeleccionados = simuladorState.productosSeleccionados.filter(
        p => p.id !== productoId
    );
    
    actualizarProductosSeleccionados();
    calcularTotales();
    
    showNotification('Producto eliminado del simulador', 'info');
}

/**
 * Actualiza la lista de productos seleccionados en la interfaz
 */
function actualizarProductosSeleccionados() {
    const listaProductos = document.getElementById('lista-productos-seleccionados');
    listaProductos.innerHTML = '';
    
    if (!simuladorState.productosSeleccionados.length) {
        listaProductos.innerHTML = '<li class="sin-productos">No hay productos seleccionados</li>';
        return;
    }
    
    simuladorState.productosSeleccionados.forEach(producto => {
        const li = document.createElement('li');
        li.className = 'producto-seleccionado';
        
        const subtotal = producto.precio * producto.cantidad;
        
        li.innerHTML = `
            <div class="producto-info">
                <span class="producto-nombre">${producto.nombre}</span>
                <div class="producto-detalles">
                    <span class="producto-precio">${formatCurrency(producto.precio)}</span>
                    <div class="control-cantidad">
                        <button class="btn-decrementar" data-id="${producto.id}">-</button>
                        <span class="cantidad">${producto.cantidad}</span>
                        <button class="btn-incrementar" data-id="${producto.id}">+</button>
                    </div>
                    <span class="producto-subtotal">${formatCurrency(subtotal)}</span>
                </div>
            </div>
            <button class="btn-quitar" data-id="${producto.id}">×</button>
        `;
        
        listaProductos.appendChild(li);
    });
    
    // Agregar listeners para los botones de cantidad
    document.querySelectorAll('.btn-decrementar').forEach(btn => {
        btn.addEventListener('click', decrementarCantidad);
    });
    
    document.querySelectorAll('.btn-incrementar').forEach(btn => {
        btn.addEventListener('click', incrementarCantidad);
    });
}

/**
 * Decrementa la cantidad de un producto
 * @param {Event} event - Evento de click
 */
function decrementarCantidad(event) {
    const productoId = event.target.dataset.id;
    const producto = simuladorState.productosSeleccionados.find(p => p.id === productoId);
    
    if (producto.cantidad > 1) {
        producto.cantidad--;
        actualizarProductosSeleccionados();
        calcularTotales();
    }
}

/**
 * Incrementa la cantidad de un producto
 * @param {Event} event - Evento de click
 */
function incrementarCantidad(event) {
    const productoId = event.target.dataset.id;
    const producto = simuladorState.productosSeleccionados.find(p => p.id === productoId);
    
    producto.cantidad++;
    actualizarProductosSeleccionados();
    calcularTotales();
}

/**
 * Calcula los totales de la simulación
 */
function calcularTotales() {
    // Calcular subtotal
    simuladorState.subtotal = simuladorState.productosSeleccionados.reduce(
        (total, producto) => total + (producto.precio * producto.cantidad), 
        0
    );
    
    // Si hay banco y tarjeta seleccionados, calcular intereses
    if (simuladorState.banco && simuladorState.tarjeta && simuladorState.cuotas > 1) {
        calcularIntereses();
    } else {
        simuladorState.totalConInteres = simuladorState.subtotal;
        simuladorState.montoPorCuota = simuladorState.subtotal;
        simuladorState.tasaInteres = 0;
    }
    
    actualizarResumenCuotas();
}

/**
 * Calcula los intereses según banco, tarjeta y cuotas seleccionadas
 */
async function calcularIntereses() {
    try {
        const tasas = await getTasasInteres();
        
        // Buscar la tasa correspondiente
        const tasaConfig = tasas.find(t => 
            t.banco === simuladorState.banco && 
            t.tarjeta === simuladorState.tarjeta && 
            t.cuotas === parseInt(simuladorState.cuotas)
        );
        
        if (tasaConfig) {
            simuladorState.tasaInteres = tasaConfig.tasa;
            
            // Calcular total con interés y monto por cuota
            const resultado = calculateInterest(
                simuladorState.subtotal, 
                simuladorState.tasaInteres, 
                simuladorState.cuotas
            );
            
            simuladorState.totalConInteres = resultado.totalConInteres;
            simuladorState.montoPorCuota = resultado.montoPorCuota;
        } else {
            // Si no hay tasa configurada para esta combinación
            simuladorState.tasaInteres = 0;
            simuladorState.totalConInteres = simuladorState.subtotal;
            simuladorState.montoPorCuota = simuladorState.subtotal / simuladorState.cuotas;
        }
    } catch (error) {
        console.error('Error al calcular intereses:', error);
        showNotification('Error al calcular intereses', 'error');
        
        // Valores por defecto en caso de error
        simuladorState.tasaInteres = 0;
        simuladorState.totalConInteres = simuladorState.subtotal;
        simuladorState.montoPorCuota = simuladorState.subtotal / simuladorState.cuotas;
    }
}

/**
 * Actualiza el resumen de cuotas en la interfaz
 */
function actualizarResumenCuotas() {
    const resumenElement = document.getElementById('resumen-cuotas');
    
    resumenElement.innerHTML = `
        <div class="resumen-item">
            <span class="resumen-label">Subtotal:</span>
            <span class="resumen-valor">${formatCurrency(simuladorState.subtotal)}</span>
        </div>
        <div class="resumen-item ${simuladorState.tasaInteres > 0 ? 'con-interes' : ''}">
            <span class="resumen-label">Tasa de interés:</span>
            <span class="resumen-valor">${simuladorState.tasaInteres}%</span>
        </div>
        <div class="resumen-item total">
            <span class="resumen-label">Total con interés:</span>
            <span class="resumen-valor">${formatCurrency(simuladorState.totalConInteres)}</span>
        </div>
        <div class="resumen-item cuota">
            <span class="resumen-label">${simuladorState.cuotas > 1 ? `${simuladorState.cuotas} cuotas de:` : 'Pago único de:'}</span>
            <span class="resumen-valor">${formatCurrency(simuladorState.montoPorCuota)}</span>
        </div>
    `;
    
    // Actualizar estado del botón para enviar al facturador
    const btnEnviarFacturador = document.getElementById('btn-enviar-facturador');
    btnEnviarFacturador.disabled = simuladorState.productosSeleccionados.length === 0;
    
    // Actualizar estado del botón para guardar simulación
    const btnGuardarSimulacion = document.getElementById('btn-guardar-simulacion');
    btnGuardarSimulacion.disabled = simuladorState.productosSeleccionados.length === 0;
}

/**
 * Maneja el cambio en banco o tarjeta
 */
function handleCambioMetodoPago() {
    const bancoSelect = document.getElementById('selector-banco');
    const tarjetaSelect = document.getElementById('selector-tarjeta');
    
    simuladorState.banco = bancoSelect.value;
    simuladorState.tarjeta = tarjetaSelect.value;
    
    // Actualizar opciones de cuotas según banco y tarjeta
    actualizarOpcionesCuotas();
    
    // Recalcular totales
    calcularTotales();
}

/**
 * Maneja el cambio en la cantidad de cuotas
 */
function handleCambioCuotas() {
    const cuotasSelect = document.getElementById('selector-cuotas');
    simuladorState.cuotas = parseInt(cuotasSelect.value);
    
    // Recalcular totales
    calcularTotales();
}

/**
 * Actualiza las opciones de cuotas según el banco y tarjeta seleccionados
 */
async function actualizarOpcionesCuotas() {
    const cuotasSelect = document.getElementById('selector-cuotas');
    cuotasSelect.innerHTML = '';
    
    // Si no hay banco o tarjeta seleccionados, solo permitir 1 cuota
    if (!simuladorState.banco || !simuladorState.tarjeta) {
        const option = document.createElement('option');
        option.value = '1';
        option.textContent = '1 cuota';
        cuotasSelect.appendChild(option);
        simuladorState.cuotas = 1;
        return;
    }
    
    try {
        const tasas = await getTasasInteres();
        
        // Filtrar cuotas disponibles para el banco y tarjeta seleccionados
        const cuotasDisponibles = tasas
            .filter(t => t.banco === simuladorState.banco && t.tarjeta === simuladorState.tarjeta)
            .map(t => t.cuotas)
            .sort((a, b) => a - b);
        
        // Si no hay cuotas configuradas, solo permitir 1 cuota
        if (!cuotasDisponibles.length) {
            const option = document.createElement('option');
            option.value = '1';
            option.textContent = '1 cuota';
            cuotasSelect.appendChild(option);
            simuladorState.cuotas = 1;
            return;
        }
        
        // Agregar opción de 1 cuota si no está en la lista
        if (!cuotasDisponibles.includes(1)) {
            const option = document.createElement('option');
            option.value = '1';
            option.textContent = '1 cuota';
            cuotasSelect.appendChild(option);
        }
        
        // Agregar las cuotas disponibles
        cuotasDisponibles.forEach(cuota => {
            const option = document.createElement('option');
            option.value = cuota.toString();
            option.textContent = `${cuota} ${cuota === 1 ? 'cuota' : 'cuotas'}`;
            cuotasSelect.appendChild(option);
        });
        
        // Seleccionar la primera opción por defecto
        simuladorState.cuotas = parseInt(cuotasSelect.options[0].value);
        cuotasSelect.value = simuladorState.cuotas.toString();
    } catch (error) {
        console.error('Error al actualizar opciones de cuotas:', error);
        showNotification('Error al cargar opciones de cuotas', 'error');
        
        // En caso de error, permitir solo 1 cuota
        const option = document.createElement('option');
        option.value = '1';
        option.textContent = '1 cuota';
        cuotasSelect.appendChild(option);
        simuladorState.cuotas = 1;
    }
}

/**
 * Carga las opciones de bancos y tarjetas
 */
async function cargarOpcionesBancosYTarjetas() {
    try {
        const tasas = await getTasasInteres();
        
        const bancosUnicos = [...new Set(tasas.map(t => t.banco))];
        const tarjetasUnicas = [...new Set(tasas.map(t => t.tarjeta))];
        
        const bancoSelect = document.getElementById('selector-banco');
        const tarjetaSelect = document.getElementById('selector-tarjeta');
        
        // Limpiar selectores
        bancoSelect.innerHTML = '<option value="">Seleccionar banco</option>';
        tarjetaSelect.innerHTML = '<option value="">Seleccionar tarjeta</option>';
        
        // Agregar opciones de bancos
        bancosUnicos.forEach(banco => {
            const option = document.createElement('option');
            option.value = banco;
            option.textContent = banco;
            bancoSelect.appendChild(option);
        });
        
        // Agregar opciones de tarjetas
        tarjetasUnicas.forEach(tarjeta => {
            const option = document.createElement('option');
            option.value = tarjeta;
            option.textContent = tarjeta;
            tarjetaSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Error al cargar opciones de bancos y tarjetas:', error);
        showNotification('Error al cargar opciones de pago', 'error');
    }
}

/**
 * Abre el modal para seleccionar un cliente
 */
function abrirModalClientes() {
    // Importar dinámicamente el módulo de clientes
    Promise.resolve(require('../clientes/index.js')).then(clientesModule => {
        clientesModule.abrirSelectorClientes(seleccionarCliente);
    }).catch(error => {
        console.error('Error al cargar el módulo de clientes:', error);
        showNotification('Error al abrir el selector de clientes', 'error');
    });
}

/**
 * Callback para cuando se selecciona un cliente
 * @param {Object} cliente - Cliente seleccionado
 */
function seleccionarCliente(cliente) {
    simuladorState.clienteId = cliente.id;
    
    // Actualizar la interfaz con el cliente seleccionado
    const clienteInfoElement = document.getElementById('cliente-seleccionado');
    clienteInfoElement.innerHTML = `
        <div class="cliente-info">
            <span class="cliente-nombre">${cliente.nombre}</span>
            <span class="cliente-documento">${cliente.tipoDocumento}: ${cliente.numeroDocumento}</span>
        </div>
        <button id="btn-cambiar-cliente" class="btn-secundario">Cambiar</button>
    `;
    
    // Mostrar la sección de cliente
    clienteInfoElement.classList.remove('hidden');
    
    // Agregar listener al botón de cambiar cliente
    document.getElementById('btn-cambiar-cliente').addEventListener('click', abrirModalClientes);
    
    showNotification(`Cliente ${cliente.nombre} seleccionado`, 'success');
}

/**
 * Envía los productos y configuración al facturador
 */
function enviarAFacturador() {
    if (simuladorState.productosSeleccionados.length === 0) {
        showNotification('No hay productos seleccionados para facturar', 'warning');
        return;
    }
    
    // Crear objeto con la información para el facturador
    const datosFacturacion = {
        productos: simuladorState.productosSeleccionados,
        clienteId: simuladorState.clienteId,
        formaPago: {
            tipo: 'tarjeta',
            banco: simuladorState.banco,
            tarjeta: simuladorState.tarjeta,
            cuotas: simuladorState.cuotas,
            tasaInteres: simuladorState.tasaInteres,
            totalConInteres: simuladorState.totalConInteres,
            montoPorCuota: simuladorState.montoPorCuota
        }
    };
    
    // Abrir el facturador con los datos precargados
    try {
        // Crear una nueva pestaña con el facturador
        createTab('Facturador', 'facturador.html', () => {
            // Callback para cuando la pestaña está cargada
            setTimeout(() => {
                // Enviar los datos al facturador
                agregarProductosFacturador(datosFacturacion);
            }, 500);
        });
        
        showNotification('Productos enviados al facturador', 'success');
    } catch (error) {
        console.error('Error al enviar al facturador:', error);
        showNotification('Error al abrir el facturador', 'error');
    }
}

/**
 * Guarda la simulación actual
 */
async function guardarSimulacion() {
    if (simuladorState.productosSeleccionados.length === 0) {
        showNotification('No hay productos seleccionados para guardar', 'warning');
        return;
    }
    
    try {
        // Crear objeto con la simulación
        const simulacion = {
            fecha: new Date(),
            clienteId: simuladorState.clienteId,
            productos: simuladorState.productosSeleccionados,
            banco: simuladorState.banco,
            tarjeta: simuladorState.tarjeta,
            cuotas: simuladorState.cuotas,
            subtotal: simuladorState.subtotal,
            tasaInteres: simuladorState.tasaInteres,
            totalConInteres: simuladorState.totalConInteres,
            montoPorCuota: simuladorState.montoPorCuota
        };
        
        // Guardar en la base de datos
        await saveSimulacion(simulacion);
        
        showNotification('Simulación guardada correctamente', 'success');
    } catch (error) {
        console.error('Error al guardar la simulación:', error);
        showNotification('Error al guardar la simulación', 'error');
    }
}

/**
 * Limpia el simulador
 */
function limpiarSimulador() {
    // Reiniciar el estado
    simuladorState = {
        productosSeleccionados: [],
        subtotal: 0,
        banco: '',
        tarjeta: '',
        cuotas: 1,
        totalConInteres: 0,
        montoPorCuota: 0,
        tasaInteres: 0,
        clienteId: null
    };
    
    // Limpiar la interfaz
    document.getElementById('buscador-productos').value = '';
    document.getElementById('lista-resultados').innerHTML = '';
    document.getElementById('selector-banco').value = '';
    document.getElementById('selector-tarjeta').value = '';
    
    // Actualizar productos y totales
    actualizarProductosSeleccionados();
    actualizarResumenCuotas();
    
    // Ocultar la sección de cliente
    document.getElementById('cliente-seleccionado').classList.add('hidden');
    document.getElementById('cliente-seleccionado').innerHTML = '';
    
    showNotification('Simulador reiniciado', 'info');
}

/**
 * Actualiza toda la interfaz del simulador
 */
function actualizarInterfaz() {
    actualizarProductosSeleccionados();
    calcularTotales();
}

/**
 * Exporta la simulación como PDF
 */
export async function exportarSimulacionPDF() {
    if (simuladorState.productosSeleccionados.length === 0) {
        showNotification('No hay simulación para exportar', 'warning');
        return;
    }
    
    try {
        // Importar dinámicamente el servicio de PDF
        const { generarPDFSimulacion } = await Promise.resolve(require('../../utils/pdf.js'));
        
        // Obtener datos del cliente si existe
        let clienteData = null;
        if (simuladorState.clienteId) {
            const { getClienteById } = await Promise.resolve(require('../clientes/index.js'));
            clienteData = await getClienteById(simuladorState.clienteId);
        }
        
        // Generar el PDF
        await generarPDFSimulacion({
            ...simuladorState,
            cliente: clienteData
        });
        
        showNotification('Simulación exportada a PDF', 'success');
    } catch (error) {
        console.error('Error al exportar simulación:', error);
        showNotification('Error al exportar la simulación', 'error');
    }
}

/**
 * Carga una simulación guardada
 * @param {Object} simulacion - Datos de la simulación guardada
 */
function cargarSimulacion
module.exports.cargarSimulacion = cargarSimulacion(simulacion) {
    // Restaurar el estado desde la simulación guardada
    simuladorState = {
        productosSeleccionados: [...simulacion.productos],
        subtotal: simulacion.subtotal,
        banco: simulacion.banco,
        tarjeta: simulacion.tarjeta,
        cuotas: simulacion.cuotas,
        totalConInteres: simulacion.totalConInteres,
        montoPorCuota: simulacion.montoPorCuota,
        tasaInteres: simulacion.tasaInteres,
        clienteId: simulacion.clienteId
    };
    
    // Cargar opciones de bancos y tarjetas
    cargarOpcionesBancosYTarjetas().then(() => {
        // Seleccionar banco y tarjeta
        document.getElementById('selector-banco').value = simuladorState.banco;
        document.getElementById('selector-tarjeta').value = simuladorState.tarjeta;
        
        // Actualizar opciones de cuotas y seleccionar la guardada
        actualizarOpcionesCuotas().then(() => {
            document.getElementById('selector-cuotas').value = simuladorState.cuotas.toString();
        });
    });
    
    // Si hay cliente, cargar sus datos
    if (simuladorState.clienteId) {
        Promise.resolve(require('../clientes/index.js')).then(async clientesModule => {
            const cliente = await clientesModule.getClienteById(simuladorState.clienteId);
            seleccionarCliente(cliente);
        });
    }
    
    // Actualizar la interfaz
    actualizarInterfaz();
    
    showNotification('Simulación cargada correctamente', 'success');
}

/**
 * Obtiene productos por IDs y los carga en el simulador
 * @param {Array} productosIds - IDs de productos a cargar
 */
export async function cargarProductosPorIds(productosIds) {
    if (!productosIds || !productosIds.length) return;
    
    try {
        // Limpiar simulador primero
        limpiarSimulador();
        
        // Cargar cada producto
        for (const id of productosIds) {
            const producto = await getProductById(id);
            if (producto) {
                simuladorState.productosSeleccionados.push({
                    ...producto,
                    cantidad: 1
                });
            }
        }
        
        // Actualizar la interfaz
        actualizarInterfaz();
        
        showNotification('Productos cargados en el simulador', 'success');
    } catch (error) {
        console.error('Error al cargar productos por IDs:', error);
        showNotification('Error al cargar los productos', 'error');
    }
}

// Exportar funciones principales
export default {
    initSimulador,
    cargarSimulacion,
    exportarSimulacionPDF,
    cargarProductosPorIds
};