/**
 * Módulo de Facturación - FactuSystem
 * @file app/assets/js/modules/facturador/facturador.js
 * @description Maneja toda la lógica del proceso de facturación, incluyendo selección de cliente,
 * productos, descuentos, pagos e integración con servicios externos.
 */

// Importaciones de utilidades y servicios
const { db } = require('../../../utils/database.js');
const { validateForm } = require('../../../utils/validation.js');
const { printTicket, printInvoice } = require('../../../../services/print/printer.js');
const { generatePDF } = require('../../../../services/print/pdf.js');
const { logger } = require('../../../utils/logger.js');
const { authCheck } = require('../../../utils/auth.js');
const { syncData } = require('../../../utils/sync.js');
const { createBackup } = require('../../../utils/backup.js');

// Importaciones de servicios para integraciones externas
const { mercadoPagoQR, checkMPPayment } = require('../../../../integrations/mercadoPago/api.js');
const { generateInvoice as arcaGenerateInvoice } = require('../../../../integrations/arca/facturacion.js');
const { sendWhatsApp } = require('../../../../integrations/whatsapp/mensajes.js');
const { sendEmail } = require('../../../../integrations/email/sender.js');
const { bankPayment } = require('../../../../integrations/bancos/api.js');

// Importaciones de módulos relacionados
const { getClienteData, createCliente } = require('./cliente.js');
const { getProductData, updateStock } = require('./productos.js');
const { registerPayment } = require('./pagos.js');

// Constantes y configuraciones
const TIPOS_COMPROBANTE = {
    FACTURA_A: 'A',
    FACTURA_B: 'B',
    FACTURA_C: 'C',
    FACTURA_X: 'X',
    PRESUPUESTO: 'P'
};

const METODOS_PAGO = {
    EFECTIVO: 'efectivo',
    TARJETA_DEBITO: 'tarjeta_debito',
    TARJETA_CREDITO: 'tarjeta_credito',
    TRANSFERENCIA: 'transferencia',
    MERCADO_PAGO: 'mercado_pago'
};

// Estado local del facturador
let facturadorState = {
    cliente: null,
    tipoComprobante: TIPOS_COMPROBANTE.FACTURA_B,
    productos: [],
    descuento: 0,
    recargo: 0,
    aplicarIVA: true,
    metodoPago: null,
    detallesPago: {},
    sucursal: null,
    usuario: null,
    fechaHora: null
};

/**
 * Inicializa el módulo de facturación
 */
function initFacturador
module.exports.initFacturador = initFacturador() {
    // Comprobar autenticación y permisos
    if (!authCheck('facturador:access')) {
        showMessage('No tiene permisos para acceder al facturador', 'error');
        return false;
    }

    // Obtener información de la sesión actual
    facturadorState.sucursal = getSucursalActual();
    facturadorState.usuario = getUserData();
    facturadorState.fechaHora = new Date();

    // Inicializar interfaz
    setupEventListeners();
    resetFacturador();
    checkCajaAbierta();
    
    logger.info('Módulo facturador inicializado', { 
        usuario: facturadorState.usuario.id, 
        sucursal: facturadorState.sucursal.id 
    });

    return true;
}

/**
 * Configura los listeners de eventos para la interfaz
 */
function setupEventListeners() {
    // Cliente
    document.getElementById('clienteInput').addEventListener('keydown', handleClienteKeyDown);
    document.getElementById('btnBuscarCliente').addEventListener('click', showClienteModal);
    
    // Tipo de comprobante
    document.getElementById('tipoComprobanteSelect').addEventListener('change', handleTipoComprobanteChange);
    
    // Productos
    document.getElementById('productoInput').addEventListener('keydown', handleProductoKeyDown);
    document.getElementById('btnBuscarProducto').addEventListener('click', showProductoModal);
    document.getElementById('listaProductos').addEventListener('click', handleListaProductosClick);
    
    // Descuentos y recargos
    document.getElementById('descuentoInput').addEventListener('input', handleDescuentoInput);
    
    // IVA
    document.getElementById('aplicarIVACheck').addEventListener('change', handleIVAChange);
    
    // Métodos de pago
    document.getElementById('btnPagoEfectivo').addEventListener('click', () => showMetodoPagoModal(METODOS_PAGO.EFECTIVO));
    document.getElementById('btnPagoTarjetaDebito').addEventListener('click', () => showMetodoPagoModal(METODOS_PAGO.TARJETA_DEBITO));
    document.getElementById('btnPagoTarjetaCredito').addEventListener('click', () => showMetodoPagoModal(METODOS_PAGO.TARJETA_CREDITO));
    document.getElementById('btnPagoTransferencia').addEventListener('click', () => showMetodoPagoModal(METODOS_PAGO.TRANSFERENCIA));
    document.getElementById('btnPagoMercadoPago').addEventListener('click', () => showMetodoPagoModal(METODOS_PAGO.MERCADO_PAGO));
    
    // Facturación
    document.getElementById('btnFacturarAFIP').addEventListener('click', handleFacturarAFIP);
    document.getElementById('btnGenerarFactura').addEventListener('click', handleGenerarFactura);
    
    // Botones auxiliares
    document.getElementById('btnLimpiarFactura').addEventListener('click', resetFacturador);
    document.getElementById('btnGuardarPresupuesto').addEventListener('click', guardarPresupuesto);
}

/**
 * Verifica si la caja está abierta para la sucursal actual
 */
function checkCajaAbierta() {
    return db.caja.findOne({ 
        sucursal_id: facturadorState.sucursal.id,
        fecha: new Date().toISOString().split('T')[0],
        estado: 'abierta'
    }).then(caja => {
        if (!caja) {
            showModalAperturaCaja();
            return false;
        }
        return true;
    }).catch(error => {
        logger.error('Error al verificar caja abierta', { error });
        showMessage('Error al verificar estado de caja', 'error');
        return false;
    });
}

/**
 * Muestra modal para apertura de caja
 */
function showModalAperturaCaja() {
    const modal = document.getElementById('modalAperturaCaja');
    modal.classList.remove('hidden');
    
    document.getElementById('btnConfirmarAperturaCaja').addEventListener('click', () => {
        const montoInicial = parseFloat(document.getElementById('montoInicialCaja').value);
        if (isNaN(montoInicial) || montoInicial < 0) {
            showMessage('Ingrese un monto inicial válido', 'error');
            return;
        }
        
        // Registrar apertura de caja
        db.caja.insert({
            sucursal_id: facturadorState.sucursal.id,
            usuario_id: facturadorState.usuario.id,
            fecha: new Date().toISOString().split('T')[0],
            hora_apertura: new Date().toTimeString().split(' ')[0],
            monto_inicial: montoInicial,
            estado: 'abierta'
        }).then(() => {
            modal.classList.add('hidden');
            showMessage('Caja abierta exitosamente', 'success');
        }).catch(error => {
            logger.error('Error al abrir caja', { error });
            showMessage('Error al abrir caja', 'error');
        });
    });
}

/**
 * Maneja la tecla presionada en el campo de cliente
 * @param {KeyboardEvent} event - Evento de teclado
 */
function handleClienteKeyDown(event) {
    const clienteInput = event.target;
    
    // Si presiona Enter sin datos = Consumidor Final
    if (event.key === 'Enter' && !clienteInput.value.trim()) {
        setClienteConsumidorFinal();
    }
    // Si presiona F1 = Modal para búsqueda/creación de cliente
    else if (event.key === 'F1') {
        showClienteModal();
    }
    // Si presiona Enter con datos = Buscar cliente por DNI/CUIT o nombre
    else if (event.key === 'Enter' && clienteInput.value.trim()) {
        buscarCliente(clienteInput.value.trim());
    }
}

/**
 * Establece el cliente como Consumidor Final
 */
function setClienteConsumidorFinal() {
    facturadorState.cliente = {
        id: null,
        nombre: 'Consumidor Final',
        documento: '00000000',
        condicionIVA: 'Consumidor Final',
        direccion: '',
        telefono: '',
        email: ''
    };
    
    document.getElementById('clienteInput').value = 'Consumidor Final';
    document.getElementById('clienteDetalles').innerHTML = `
        <div>Consumidor Final</div>
        <div>DNI/CUIT: 00000000</div>
    `;
    
    // Actualizar tipo de comprobante según cliente
    actualizarTipoComprobantePorCliente();
}

/**
 * Muestra el modal de búsqueda/creación de cliente
 */
function showClienteModal() {
    const modal = document.getElementById('modalCliente');
    modal.classList.remove('hidden');
    
    // Limpiar formulario
    document.getElementById('formCliente').reset();
    document.getElementById('resultadosBusquedaCliente').innerHTML = '';
    
    // Configurar búsqueda de clientes
    document.getElementById('btnBuscarClienteModal').addEventListener('click', () => {
        const termino = document.getElementById('busquedaClienteInput').value.trim();
        if (termino) {
            buscarClientesParaModal(termino);
        }
    });
    
    // Configurar creación de nuevo cliente
    document.getElementById('btnGuardarCliente').addEventListener('click', guardarNuevoCliente);
    
    // Cerrar modal
    document.getElementById('btnCerrarModalCliente').addEventListener('click', () => {
        modal.classList.add('hidden');
    });
}

/**
 * Busca clientes para mostrar en el modal
 * @param {string} termino - Término de búsqueda
 */
function buscarClientesParaModal(termino) {
    db.clientes.find({
        $or: [
            { nombre: { $regex: new RegExp(termino, 'i') } },
            { documento: { $regex: new RegExp(termino, 'i') } }
        ]
    }).then(clientes => {
        const resultadosDiv = document.getElementById('resultadosBusquedaCliente');
        resultadosDiv.innerHTML = '';
        
        if (clientes.length === 0) {
            resultadosDiv.innerHTML = '<p>No se encontraron clientes. Complete el formulario para crear uno nuevo.</p>';
            return;
        }
        
        clientes.forEach(cliente => {
            const clienteDiv = document.createElement('div');
            clienteDiv.className = 'cliente-item';
            clienteDiv.innerHTML = `
                <div class="cliente-nombre">${cliente.nombre}</div>
                <div class="cliente-info">
                    <span>${cliente.condicionIVA}</span>
                    <span>${cliente.documento}</span>
                </div>
            `;
            
            clienteDiv.addEventListener('click', () => {
                seleccionarCliente(cliente);
                document.getElementById('modalCliente').classList.add('hidden');
            });
            
            resultadosDiv.appendChild(clienteDiv);
        });
    }).catch(error => {
        logger.error('Error al buscar clientes', { error, termino });
        showMessage('Error al buscar clientes', 'error');
    });
}

/**
 * Guarda un nuevo cliente desde el modal
 */
function guardarNuevoCliente() {
    const formCliente = document.getElementById('formCliente');
    
    // Validar formulario
    if (!validateForm(formCliente)) {
        showMessage('Complete todos los campos obligatorios', 'error');
        return;
    }
    
    const nuevoCliente = {
        nombre: document.getElementById('nombreCliente').value.trim(),
        documento: document.getElementById('documentoCliente').value.trim(),
        condicionIVA: document.getElementById('condicionIVACliente').value,
        direccion: document.getElementById('direccionCliente').value.trim(),
        telefono: document.getElementById('telefonoCliente').value.trim(),
        email: document.getElementById('emailCliente').value.trim(),
        sucursal_id: facturadorState.sucursal.id,
        creado_por: facturadorState.usuario.id,
        fecha_creacion: new Date()
    };
    
    // Guardar cliente en base de datos
    createCliente(nuevoCliente)
        .then(clienteCreado => {
            seleccionarCliente(clienteCreado);
            document.getElementById('modalCliente').classList.add('hidden');
            showMessage('Cliente creado exitosamente', 'success');
        })
        .catch(error => {
            logger.error('Error al crear cliente', { error, cliente: nuevoCliente });
            showMessage('Error al crear cliente', 'error');
        });
}

/**
 * Busca un cliente por DNI/CUIT o nombre
 * @param {string} termino - Término de búsqueda
 */
function buscarCliente(termino) {
    getClienteData(termino)
        .then(cliente => {
            if (cliente) {
                seleccionarCliente(cliente);
            } else {
                showMessage('Cliente no encontrado', 'warning');
                showClienteModal();
            }
        })
        .catch(error => {
            logger.error('Error al buscar cliente', { error, termino });
            showMessage('Error al buscar cliente', 'error');
        });
}

/**
 * Selecciona un cliente para la factura actual
 * @param {Object} cliente - Cliente seleccionado
 */
function seleccionarCliente(cliente) {
    facturadorState.cliente = cliente;
    
    // Actualizar interfaz
    document.getElementById('clienteInput').value = cliente.nombre;
    document.getElementById('clienteDetalles').innerHTML = `
        <div>${cliente.nombre}</div>
        <div>${cliente.condicionIVA} - ${cliente.documento}</div>
        <div>${cliente.direccion || ''}</div>
    `;
    
    // Actualizar tipo de comprobante según cliente
    actualizarTipoComprobantePorCliente();
    
    logger.info('Cliente seleccionado', { 
        clienteId: cliente.id, 
        facturaId: generarIdTemporal() 
    });
}

/**
 * Actualiza el tipo de comprobante según la condición de IVA del cliente
 */
function actualizarTipoComprobantePorCliente() {
    if (!facturadorState.cliente) return;
    
    const tipoComprobanteSelect = document.getElementById('tipoComprobanteSelect');
    
    // Determinar tipo de factura basado en la condición de IVA del cliente
    if (facturadorState.cliente.condicionIVA === 'Responsable Inscripto') {
        facturadorState.tipoComprobante = TIPOS_COMPROBANTE.FACTURA_A;
        tipoComprobanteSelect.value = TIPOS_COMPROBANTE.FACTURA_A;
    } else {
        facturadorState.tipoComprobante = TIPOS_COMPROBANTE.FACTURA_B;
        tipoComprobanteSelect.value = TIPOS_COMPROBANTE.FACTURA_B;
    }
    
    // Actualizar estado y cálculos
    handleTipoComprobanteChange({ target: tipoComprobanteSelect });
}

/**
 * Maneja el cambio de tipo de comprobante
 * @param {Event} event - Evento change
 */
function handleTipoComprobanteChange(event) {
    facturadorState.tipoComprobante = event.target.value;
    
    // Actualizar interfaz basada en tipo de comprobante
    const esPresupuesto = facturadorState.tipoComprobante === TIPOS_COMPROBANTE.PRESUPUESTO;
    const btnGenerarFactura = document.getElementById('btnGenerarFactura');
    const btnFacturarAFIP = document.getElementById('btnFacturarAFIP');
    
    if (esPresupuesto) {
        btnGenerarFactura.textContent = 'Generar Presupuesto';
        btnFacturarAFIP.style.display = 'none';
        document.getElementById('btnGuardarPresupuesto').style.display = 'block';
    } else {
        btnGenerarFactura.textContent = 'Generar Factura';
        btnFacturarAFIP.style.display = 'block';
        document.getElementById('btnGuardarPresupuesto').style.display = 'none';
    }
    
    // Actualizar numeración anticipada
    actualizarNumeracionComprobante();
    
    // Recalcular totales
    calcularTotales();
}

/**
 * Actualiza la numeración del comprobante según tipo y sucursal
 */
function actualizarNumeracionComprobante() {
    // Obtener último número para el tipo de comprobante y sucursal
    db.comprobantes.findOne({
        tipo: facturadorState.tipoComprobante,
        sucursal_id: facturadorState.sucursal.id
    }, { sort: { numero: -1 } }).then(ultimoComprobante => {
        const ultimoNumero = ultimoComprobante ? ultimoComprobante.numero : 0;
        const nuevoNumero = ultimoNumero + 1;
        
        document.getElementById('numeroComprobanteSpan').textContent = 
            `${facturadorState.sucursal.codigo.padStart(4, '0')}-${nuevoNumero.toString().padStart(8, '0')}`;
    });
}

/**
 * Maneja la tecla presionada en el campo de producto
 * @param {KeyboardEvent} event - Evento de teclado
 */
function handleProductoKeyDown(event) {
    // Si presiona Enter = Buscar producto por código o nombre
    if (event.key === 'Enter') {
        const codigo = event.target.value.trim();
        if (codigo) {
            buscarProducto(codigo);
        }
    }
    // Si presiona F1 = Modal para búsqueda avanzada de producto
    else if (event.key === 'F1') {
        showProductoModal();
    }
}

/**
 * Busca un producto por código de barras o nombre
 * @param {string} codigo - Código de barras o nombre
 */
function buscarProducto(codigo) {
    getProductData(codigo)
        .then(producto => {
            if (producto) {
                agregarProductoALista(producto);
                // Limpiar campo de búsqueda
                document.getElementById('productoInput').value = '';
            } else {
                showMessage('Producto no encontrado', 'warning');
                showModalProductoManual();
            }
        })
        .catch(error => {
            logger.error('Error al buscar producto', { error, codigo });
            showMessage('Error al buscar producto', 'error');
        });
}

/**
 * Muestra el modal de búsqueda avanzada de producto
 */
function showProductoModal() {
    const modal = document.getElementById('modalProducto');
    modal.classList.remove('hidden');
    
    // Limpiar búsqueda previa
    document.getElementById('busquedaProductoInput').value = '';
    document.getElementById('resultadosBusquedaProducto').innerHTML = '';
    
    // Configurar búsqueda de productos
    document.getElementById('btnBuscarProductoModal').addEventListener('click', () => {
        const termino = document.getElementById('busquedaProductoInput').value.trim();
        const filtroTipo = document.getElementById('filtroTipoProducto').value;
        
        if (termino || filtroTipo !== 'todos') {
            buscarProductosParaModal(termino, filtroTipo);
        }
    });
    
    // Cerrar modal
    document.getElementById('btnCerrarModalProducto').addEventListener('click', () => {
        modal.classList.add('hidden');
    });
}

/**
 * Busca productos para mostrar en el modal
 * @param {string} termino - Término de búsqueda
 * @param {string} filtroTipo - Filtro por tipo de producto
 */
function buscarProductosParaModal(termino, filtroTipo) {
    // Construir consulta
    const query = {};
    
    if (termino) {
        query.$or = [
            { nombre: { $regex: new RegExp(termino, 'i') } },
            { codigo: { $regex: new RegExp(termino, 'i') } }
        ];
    }
    
    if (filtroTipo !== 'todos') {
        query.tipo = filtroTipo;
    }
    
    // Consultar base de datos
    db.productos.find(query).then(productos => {
        const resultadosDiv = document.getElementById('resultadosBusquedaProducto');
        resultadosDiv.innerHTML = '';
        
        if (productos.length === 0) {
            resultadosDiv.innerHTML = '<p>No se encontraron productos.</p>';
            return;
        }
        
        // Crear tabla de resultados
        const table = document.createElement('table');
        table.className = 'tabla-productos';
        
        // Cabecera
        const thead = document.createElement('thead');
        thead.innerHTML = `
            <tr>
                <th>Código</th>
                <th>Nombre</th>
                <th>Precio</th>
                <th>Stock</th>
                <th></th>
            </tr>
        `;
        table.appendChild(thead);
        
        // Cuerpo
        const tbody = document.createElement('tbody');
        productos.forEach(producto => {
            const tr = document.createElement('tr');
            
            // Verificar stock en esta sucursal
            const stockSucursal = producto.stock?.find(s => s.sucursal_id === facturadorState.sucursal.id);
            const stockActual = stockSucursal ? stockSucursal.cantidad : 0;
            const stockClass = stockActual <= 0 ? 'stock-agotado' : (stockActual < 5 ? 'stock-bajo' : '');
            
            tr.innerHTML = `
                <td>${producto.codigo}</td>
                <td>${producto.nombre}</td>
                <td>$${producto.precio.toFixed(2)}</td>
                <td class="${stockClass}">${stockActual}</td>
                <td><button class="btn-agregar">Agregar</button></td>
            `;
            
            // Agregar producto al hacer clic en el botón
            tr.querySelector('.btn-agregar').addEventListener('click', () => {
                agregarProductoALista(producto);
                document.getElementById('modalProducto').classList.add('hidden');
            });
            
            tbody.appendChild(tr);
        });
        
        table.appendChild(tbody);
        resultadosDiv.appendChild(table);
    }).catch(error => {
        logger.error('Error al buscar productos', { error, termino });
        showMessage('Error al buscar productos', 'error');
    });
}

/**
 * Muestra el modal para ingresar un producto manualmente
 */
function showModalProductoManual() {
    const modal = document.getElementById('modalProductoManual');
    modal.classList.remove('hidden');
    
    // Limpiar formulario
    document.getElementById('formProductoManual').reset();
    
    // Configurar creación de producto manual
    document.getElementById('btnGuardarProductoManual').addEventListener('click', () => {
        const formProductoManual = document.getElementById('formProductoManual');
        
        // Validar formulario
        if (!validateForm(formProductoManual)) {
            showMessage('Complete todos los campos obligatorios', 'error');
            return;
        }
        
        const productoManual = {
            nombre: document.getElementById('nombreProductoManual').value.trim(),
            precio: parseFloat(document.getElementById('precioProductoManual').value),
            iva: parseFloat(document.getElementById('ivaProductoManual').value) || 21,
            codigo: 'MANUAL-' + Date.now().toString().substring(6),
            creado_manualmente: true,
            creado_por: facturadorState.usuario.id,
            fecha_creacion: new Date()
        };
        
        // Agregar a la lista
        agregarProductoALista(productoManual);
        modal.classList.add('hidden');
    });
    
    // Cerrar modal
    document.getElementById('btnCerrarModalProductoManual').addEventListener('click', () => {
        modal.classList.add('hidden');
    });
}

/**
 * Agrega un producto a la lista de la factura actual
 * @param {Object} producto - Producto a agregar
 * @param {number} cantidad - Cantidad del producto (default: 1)
 */
function agregarProductoALista(producto, cantidad = 1) {
    // Verificar stock (excepto para productos manuales)
    if (!producto.creado_manualmente) {
        const stockSucursal = producto.stock?.find(s => s.sucursal_id === facturadorState.sucursal.id);
        const stockDisponible = stockSucursal ? stockSucursal.cantidad : 0;
        
        if (stockDisponible < cantidad) {
            showMessage(`Stock insuficiente. Disponible: ${stockDisponible}`, 'warning');
            return false;
        }
    }
    
    // Verificar si el producto ya está en la lista
    const productoExistente = facturadorState.productos.find(p => p.id === producto.id || p.codigo === producto.codigo);
    
    if (productoExistente) {
        // Incrementar cantidad
        productoExistente.cantidad += cantidad;
        // Actualizar subtotal
        productoExistente.subtotal = productoExistente.precio * productoExistente.cantidad;
        
        // Actualizar interfaz para este producto
        const filaProducto = document.querySelector(`#listaProductos tr[data-codigo="${producto.codigo}"]`);
        filaProducto.querySelector('.cantidad').textContent = productoExistente.cantidad;
        filaProducto.querySelector('.subtotal').textContent = `$${productoExistente.subtotal.toFixed(2)}`;
    } else {
        // Agregar nuevo producto
        const nuevoProducto = {
            id: producto.id || null,
            codigo: producto.codigo,
            nombre: producto.nombre,
            precio: producto.precio,
            cantidad: cantidad,
            subtotal: producto.precio * cantidad,
            iva: producto.iva || 21,
            imagen: producto.imagen || null,
            creado_manualmente: producto.creado_manualmente || false
        };
        
        facturadorState.productos.push(nuevoProducto);
        
        // Agregar a la interfaz
        const listaProductos = document.getElementById('listaProductos').getElementsByTagName('tbody')[0];
        const tr = document.createElement('tr');
        tr.dataset.codigo = nuevoProducto.codigo;
        
        tr.innerHTML = `
            <td class="producto-info">
                ${nuevoProducto.imagen ? `<img src="${nuevoProducto.imagen}" class="producto-imagen" alt="${nuevoProducto.nombre}">` : ''}
                <div>
                    <div class="producto-nombre">${nuevoProducto.nombre}</div>
                    <div class="producto-codigo">${nuevoProducto.codigo}</div>
                </div>
            </td>
            <td class="cantidad">${nuevoProducto.cantidad}</td>
            <td class="precio">$${nuevoProducto.precio.toFixed(2)}</td>
            <td class="subtotal">$${nuevoProducto.subtotal.toFixed(2)}</td>
            <td class="acciones">
                <button class="btn-editar" title="Editar cantidad o precio"><i class="icon-edit"></i></button>
                <button class="btn-eliminar" title="Eliminar producto"><i class="icon-trash"></i></button>
            </td>
        `;
        
        // Configurar botones de acciones
        tr.querySelector('.btn-editar').addEventListener('click', () => editarProductoEnLista(nuevoProducto.codigo));
        tr.querySelector('.btn-eliminar').addEventListener('click', () => eliminarProductoDeLista(nuevoProducto.codigo));
        
        // Añadir fila a la tabla
        listaProductos.appendChild(tr);
        
        // Mostrar imagen por unos segundos
        if (nuevoProducto.imagen) {
            mostrarImagenProductoTemporalmente(nuevoProducto);
        }
    }
    
    // Actualizar totales
    calcularTotales();
    
    // Sonido de confirmación (bip)
    reproducirSonidoBip();
    
    return true;
}

/**
 * Muestra la imagen del producto temporalmente en grande
 * @param {Object} producto - Producto con imagen
 */
function mostrarImagenProductoTemporalmente(producto) {
    if (!producto.imagen) return;
    
    const imgContainer = document.createElement('div');
    imgContainer.className = 'producto-imagen-grande';
    imgContainer.innerHTML = `<img src="${producto.imagen}" alt="${producto.nombre}">`;
    
    document.body.appendChild(imgContainer);
    
    // Remover después de 2 segundos
    setTimeout(() => {
        imgContainer.classList.add('fadeout');
        setTimeout(() => {
            document.body.removeChild(imgContainer);
        }, 500);
    }, 2000);
}

/**
 * Reproduce un sonido de bip para confirmación
 */
function reproducirSonidoBip() {
    const audio = new Audio('../../../assets/sounds/beep.mp3');
    audio.volume = 0.5;
    audio.play().catch(err => console.log('No se pudo reproducir el sonido'));
}

/**
 * Maneja clicks en la lista de productos
 * @param {Event} event - Evento click
 */
function handleListaProductosClick(event) {
    if (event.target.closest('.btn-editar')) {
        const tr = event.target.closest('tr');
        const codigo = tr.dataset.codigo;
        editarProductoEnLista(codigo);
    } else if (event.target.closest('.btn-eliminar')) {
        const tr = event.target.closest('tr');
        const codigo = tr.dataset.codigo;
        eliminarProductoDeLista(codigo);
    }
}

/**
 * Abre modal para editar cantidad o precio de un producto en la lista
 * @param {string} codigo - Código del producto
 */
function editarProductoEnLista(codigo) {
    const producto = facturadorState.productos.find(p => p.codigo === codigo);
    if (!producto) return;
    
    const modal = document.getElementById('modalEditarProducto');
    modal.classList.remove('hidden');
    
    // Prellenar formulario
    document.getElementById('editarProductoNombre').textContent = producto.nombre;
    document.getElementById('editarProductoCantidad').value = producto.cantidad;
    document.getElementById('editarProductoPrecio').value = producto.precio.toFixed(2);
    
    // Configurar botón de guardar
    document.getElementById('btnGuardarEdicionProducto').onclick = () => {
        const nuevaCantidad = parseInt(document.getElementById('editarProductoCantidad').value) || 1;
        const nuevoPrecio = parseFloat(document.getElementById('editarProductoPrecio').value) || producto.precio;
        
        // Verificar stock si aumenta cantidad
        if (!producto.creado_manualmente && nuevaCantidad > producto.cantidad) {
            // Obtener stock actual
            getProductData(codigo).then(productoActual => {
                const stockSucursal = productoActual.stock?.find(s => s.sucursal_id === facturadorState.sucursal.id);
                const stockDisponible = stockSucursal ? stockSucursal.cantidad : 0;
                
                // Calcular la diferencia que se va a agregar
                const diferencia = nuevaCantidad - producto.cantidad;
                
                if (stockDisponible < diferencia) {
                    showMessage(`Stock insuficiente. Disponible: ${stockDisponible}`, 'warning');
                    return;
                }
                
                actualizarProductoEnLista(codigo, nuevaCantidad, nuevoPrecio);
                modal.classList.add('hidden');
            });
        } else {
            actualizarProductoEnLista(codigo, nuevaCantidad, nuevoPrecio);
            modal.classList.add('hidden');
        }
    };
    
    // Configurar botón de cancelar
    document.getElementById('btnCancelarEdicionProducto').onclick = () => {
        modal.classList.add('hidden');
    };
}

/**
 * Actualiza un producto en la lista
 * @param {string} codigo - Código del producto
 * @param {number} cantidad - Nueva cantidad
 * @param {number} precio - Nuevo precio
 */
function actualizarProductoEnLista(codigo, cantidad, precio) {
    const producto = facturadorState.productos.find(p => p.codigo === codigo);
    if (!producto) return;
    
    // Actualizar estado
    producto.cantidad = cantidad;
    producto.precio = precio;
    producto.subtotal = cantidad * precio;
    
    // Actualizar interfaz
    const filaProducto = document.querySelector(`#listaProductos tr[data-codigo="${codigo}"]`);
    filaProducto.querySelector('.cantidad').textContent = cantidad;
    filaProducto.querySelector('.precio').textContent = `$${precio.toFixed(2)}`;
    filaProducto.querySelector('.subtotal').textContent = `$${producto.subtotal.toFixed(2)}`;
    
    // Recalcular totales
    calcularTotales();
}

/**
 * Elimina un producto de la lista
 * @param {string} codigo - Código del producto
 */
function eliminarProductoDeLista(codigo) {
    // Actualizar estado
    facturadorState.productos = facturadorState.productos.filter(p => p.codigo !== codigo);
    
    // Actualizar interfaz
    const filaProducto = document.querySelector(`#listaProductos tr[data-codigo="${codigo}"]`);
    filaProducto.remove();
    
    // Recalcular totales
    calcularTotales();
}

/**
 * Maneja la entrada de descuento o recargo
 * @param {Event} event - Evento input
 */
function handleDescuentoInput(event) {
    const valor = event.target.value.trim();
    
    if (!valor) {
        facturadorState.descuento = 0;
        facturadorState.recargo = 0;
    } else if (valor.startsWith('-')) {
        // Es un descuento
        facturadorState.descuento = parseFloat(valor.substring(1)) || 0;
        facturadorState.recargo = 0;
    } else if (valor.startsWith('+')) {
        // Es un recargo
        facturadorState.recargo = parseFloat(valor.substring(1)) || 0;
        facturadorState.descuento = 0;
    } else {
        // Si no tiene signo, asumimos que es descuento
        facturadorState.descuento = parseFloat(valor) || 0;
        facturadorState.recargo = 0;
    }
    
    // Recalcular totales
    calcularTotales();
}

/**
 * Maneja el cambio en la aplicación de IVA
 * @param {Event} event - Evento change
 */
function handleIVAChange(event) {
    facturadorState.aplicarIVA = event.target.checked;
    calcularTotales();
}

/**
 * Muestra el modal para el método de pago seleccionado
 * @param {string} metodoPago - Método de pago
 */
function showMetodoPagoModal(metodoPago) {
    // Si no hay productos, no permitir pago
    if (facturadorState.productos.length === 0) {
        showMessage('Agregue productos antes de seleccionar método de pago', 'warning');
        return;
    }
    
    const modal = document.getElementById('modalMetodoPago');
    modal.classList.remove('hidden');
    
    // Limpiar contenido anterior
    const contenidoModal = document.getElementById('contenidoModalMetodoPago');
    contenidoModal.innerHTML = '';
    
    // Título del modal según método
    document.getElementById('tituloModalMetodoPago').textContent = getTituloPorMetodoPago(metodoPago);
    
    // Contenido específico según método de pago
    switch (metodoPago) {
        case METODOS_PAGO.EFECTIVO:
            mostrarFormularioEfectivo(contenidoModal);
            break;
        case METODOS_PAGO.TARJETA_DEBITO:
        case METODOS_PAGO.TARJETA_CREDITO:
            mostrarFormularioTarjeta(contenidoModal, metodoPago);
            break;
        case METODOS_PAGO.TRANSFERENCIA:
            mostrarFormularioTransferencia(contenidoModal);
            break;
        case METODOS_PAGO.MERCADO_PAGO:
            mostrarFormularioMercadoPago(contenidoModal);
            break;
    }
    
    // Configurar botón de cancelar
    document.getElementById('btnCancelarMetodoPago').onclick = () => {
        modal.classList.add('hidden');
    };
}

/**
 * Obtiene el título para el modal según método de pago
 * @param {string} metodoPago - Método de pago
 * @returns {string} Título del modal
 */
function getTituloPorMetodoPago(metodoPago) {
    switch (metodoPago) {
        case METODOS_PAGO.EFECTIVO:
            return 'Pago en Efectivo';
        case METODOS_PAGO.TARJETA_DEBITO:
            return 'Pago con Tarjeta de Débito';
        case METODOS_PAGO.TARJETA_CREDITO:
            return 'Pago con Tarjeta de Crédito';
        case METODOS_PAGO.TRANSFERENCIA:
            return 'Pago por Transferencia';
        case METODOS_PAGO.MERCADO_PAGO:
            return 'Pago con Mercado Pago';
        default:
            return 'Método de Pago';
    }
}

/**
 * Muestra el formulario para pago en efectivo
 * @param {HTMLElement} contenedor - Contenedor del formulario
 */
function mostrarFormularioEfectivo(contenedor) {
    const totalFactura = calcularTotalFinal();
    
    // Crear formulario
    contenedor.innerHTML = `
        <div class="form-group">
            <label for="montoRecibido">Monto recibido:</label>
            <div class="input-with-prefix">
                <span class="input-prefix">$</span>
                <input type="number" id="montoRecibido" class="form-control" value="${totalFactura.toFixed(2)}" step="0.01">
            </div>
        </div>
        <div class="form-group">
            <label for="cambio">Vuelto a entregar:</label>
            <div class="input-with-prefix readonly">
                <span class="input-prefix">$</span>
                <input type="text" id="cambio" class="form-control" value="0.00" readonly>
            </div>
        </div>
        <div class="total-a-pagar">
            <div class="label">Total a cobrar:</div>
            <div class="monto">$${totalFactura.toFixed(2)}</div>
        </div>
        <button id="btnConfirmarPagoEfectivo" class="btn btn-success btn-block">Confirmar Pago</button>
    `;
    
    // Calcular cambio cuando cambie el monto recibido
    document.getElementById('montoRecibido').addEventListener('input', (event) => {
        const montoRecibido = parseFloat(event.target.value) || 0;
        const cambio = Math.max(0, montoRecibido - totalFactura);
        document.getElementById('cambio').value = cambio.toFixed(2);
    });
    
    // Disparar el evento input para inicializar el cambio
    document.getElementById('montoRecibido').dispatchEvent(new Event('input'));
    
    // Configurar botón de confirmar
    document.getElementById('btnConfirmarPagoEfectivo').addEventListener('click', () => {
        const montoRecibido = parseFloat(document.getElementById('montoRecibido').value) || 0;
        
        if (montoRecibido < totalFactura) {
            showMessage('El monto recibido es menor al total a pagar', 'error');
            return;
        }
        
        const detallesPago = {
            tipo: METODOS_PAGO.EFECTIVO,
            monto: totalFactura,
            montoRecibido: montoRecibido,
            cambio: montoRecibido - totalFactura
        };
        
        registrarMetodoPago(METODOS_PAGO.EFECTIVO, detallesPago);
    });
}

/**
 * Muestra el formulario para pago con tarjeta
 * @param {HTMLElement} contenedor - Contenedor del formulario
 * @param {string} tipoTarjeta - Tipo de tarjeta (débito o crédito)
 */
function mostrarFormularioTarjeta(contenedor, tipoTarjeta) {
    const totalFactura = calcularTotalFinal();
    const esDebito = tipoTarjeta === METODOS_PAGO.TARJETA_DEBITO;
    
    // Crear formulario
    contenedor.innerHTML = `
        <div class="form-group">
            <label for="tipoTarjeta">Tipo de tarjeta:</label>
            <select id="tipoTarjeta" class="form-control">
                ${esDebito ? 
                `<option value="visa_debito">Visa Débito</option>
                <option value="mastercard_debito">Mastercard Débito</option>
                <option value="maestro">Maestro</option>` : 
                `<option value="visa_credito">Visa Crédito</option>
                <option value="mastercard_credito">Mastercard Crédito</option>
                <option value="american_express">American Express</option>
                <option value="naranja">Naranja</option>
                <option value="cabal">Cabal</option>`}
            </select>
        </div>
        ${!esDebito ? `
        <div class="form-group">
            <label for="cuotas">Cuotas:</label>
            <select id="cuotas" class="form-control">
                <option value="1">1 cuota</option>
                <option value="3">3 cuotas</option>
                <option value="6">6 cuotas</option>
                <option value="12">12 cuotas</option>
            </select>
        </div>` : ''}
        <div class="form-group">
            <label for="numeroTarjeta">Últimos 4 dígitos (opcional):</label>
            <input type="text" id="numeroTarjeta" class="form-control" maxlength="4" pattern="[0-9]*">
        </div>
        <div class="total-a-pagar">
            <div class="label">Total a cobrar:</div>
            <div class="monto">$${totalFactura.toFixed(2)}</div>
        </div>
        <button id="btnConfirmarPagoTarjeta" class="btn btn-success btn-block">Confirmar Pago</button>
    `;
    
    // Configurar botón de confirmar
    document.getElementById('btnConfirmarPagoTarjeta').addEventListener('click', () => {
        const tipoTarjetaSeleccionada = document.getElementById('tipoTarjeta').value;
        const ultimosDigitos = document.getElementById('numeroTarjeta').value.trim();
        
        const detallesPago = {
            tipo: tipoTarjeta,
            subTipo: tipoTarjetaSeleccionada,
            monto: totalFactura,
            ultimosDigitos: ultimosDigitos || null
        };
        
        // Si es crédito, agregar cuotas
        if (!esDebito) {
            detallesPago.cuotas = parseInt(document.getElementById('cuotas').value) || 1;
        }
        
        registrarMetodoPago(tipoTarjeta, detallesPago);
    });
}

/**
 * Muestra el formulario para pago por transferencia
 * @param {HTMLElement} contenedor - Contenedor del formulario
 */
function mostrarFormularioTransferencia(contenedor) {
    const totalFactura = calcularTotalFinal();
    
    // Obtener bancos configurados
    db.configuracion.findOne({ 
        tipo: 'bancos', 
        sucursal_id: facturadorState.sucursal.id 
    }).then(config => {
        const bancos = config?.bancos || [
            { id: 'banco_default', nombre: 'Banco Principal' }
        ];
        
        // Crear formulario
        contenedor.innerHTML = `
            <div class="form-group">
                <label for="bancoTransferencia">Banco:</label>
                <select id="bancoTransferencia" class="form-control">
                    ${bancos.map(banco => `<option value="${banco.id}">${banco.nombre}</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label for="comprobantePago">Comprobante de pago (opcional):</label>
                <input type="text" id="comprobantePago" class="form-control" placeholder="Número de operación">
            </div>
            <div class="total-a-pagar">
                <div class="label">Total a cobrar:</div>
                <div class="monto">$${totalFactura.toFixed(2)}</div>
            </div>
            <div class="verification-options">
                <button id="btnVerificarTransferencia" class="btn btn-primary">Verificar transferencia</button>
                <button id="btnPagoManual" class="btn btn-secondary">Ingreso manual</button>
            </div>
            <div id="estadoVerificacion" class="verificacion-estado hidden"></div>
            <button id="btnConfirmarPagoTransferencia" class="btn btn-success btn-block" disabled>Confirmar Pago</button>
        `;
        
        // Configurar botón de verificación
        document.getElementById('btnVerificarTransferencia').addEventListener('click', () => {
            const bancoId = document.getElementById('bancoTransferencia').value;
            verificarTransferenciaBanco(bancoId, totalFactura);
        });
        
        // Configurar botón de ingreso manual
        document.getElementById('btnPagoManual').addEventListener('click', () => {
            document.getElementById('estadoVerificacion').innerHTML = `
                <div class="verificacion-manual">
                    <i class="icon-warning"></i>
                    <span>Verificación manual. Confirme que ha recibido el pago.</span>
                </div>
            `;
            document.getElementById('estadoVerificacion').classList.remove('hidden');
            document.getElementById('btnConfirmarPagoTransferencia').disabled = false;
        });
        
        // Configurar botón de confirmar
        document.getElementById('btnConfirmarPagoTransferencia').addEventListener('click', () => {
            const bancoId = document.getElementById('bancoTransferencia').value;
            const comprobante = document.getElementById('comprobantePago').value.trim();
            const banco = bancos.find(b => b.id === bancoId);
            
            const detallesPago = {
                tipo: METODOS_PAGO.TRANSFERENCIA,
                banco: banco?.nombre || 'Banco no especificado',
                bancoId: bancoId,
                monto: totalFactura,
                comprobante: comprobante || null,
                verificado: document.getElementById('estadoVerificacion').classList.contains('verificado')
            };
            
            registrarMetodoPago(METODOS_PAGO.TRANSFERENCIA, detallesPago);
        });
    });
}

/**
 * Verifica una transferencia bancaria
 * @param {string} bancoId - ID del banco
 * @param {number} monto - Monto a verificar
 */
function verificarTransferenciaBanco(bancoId, monto) {
    const estadoVerificacion = document.getElementById('estadoVerificacion');
    estadoVerificacion.innerHTML = `
        <div class="verificacion-en-progreso">
            <i class="icon-spinner"></i>
            <span>Verificando transferencia...</span>
        </div>
    `;
    estadoVerificacion.classList.remove('hidden');
    
    // Intentar verificar con la API del banco
    bankPayment.verificarTransferencia(bancoId, monto)
        .then(resultado => {
            if (resultado.verificado) {
                estadoVerificacion.innerHTML = `
                    <div class="verificacion-exitosa">
                        <i class="icon-check"></i>
                        <span>Transferencia verificada correctamente.</span>
                    </div>
                `;
                estadoVerificacion.classList.add('verificado');
                document.getElementById('btnConfirmarPagoTransferencia').disabled = false;
            } else {
                estadoVerificacion.innerHTML = `
                    <div class="verificacion-fallida">
                        <i class="icon-times"></i>
                        <span>No se encontró la transferencia. Intente nuevamente o use ingreso manual.</span>
                    </div>
                `;
            }
        })
        .catch(error => {
            logger.error('Error al verificar transferencia', { error, bancoId, monto });
            estadoVerificacion.innerHTML = `
                <div class="verificacion-fallida">
                    <i class="icon-times"></i>
                    <span>Error al conectar con el banco. Use ingreso manual.</span>
                </div>
            `;
        });
}

/**
 * Muestra el formulario para pago con Mercado Pago
 * @param {HTMLElement} contenedor - Contenedor del formulario
 */
function mostrarFormularioMercadoPago(contenedor) {
    const totalFactura = calcularTotalFinal();
    
    // Crear formulario
    contenedor.innerHTML = `
        <div class="qr-container">
            <div id="qrCodeContainer">
                <i class="icon-spinner icon-spin"></i>
                <span>Generando código QR...</span>
            </div>
        </div>
        <div class="instrucciones-qr">
            <p>1. Escanee el código QR con la app de Mercado Pago</p>
            <p>2. Complete el pago en su dispositivo</p>
            <p>3. El sistema detectará automáticamente el pago</p>
        </div>
        <div class="total-a-pagar">
            <div class="label">Total a cobrar:</div>
            <div class="monto">$${totalFactura.toFixed(2)}</div>
        </div>
        <div id="estadoPagoMP" class="estado-pago-mp">
            <i class="icon-clock"></i>
            <span>Esperando pago...</span>
        </div>
        <button id="btnCancelarPagoMP" class="btn btn-outline-danger">Cancelar</button>
        <button id="btnConfirmarPagoMP" class="btn btn-success" disabled>Confirmar Pago</button>
    `;
    
    // Configurar botón de cancelar específico
    document.getElementById('btnCancelarPagoMP').addEventListener('click', () => {
        // Detener el intervalo de verificación
        if (window.checkMPInterval) {
            clearInterval(window.checkMPInterval);
        }
        document.getElementById('modalMetodoPago').classList.add('hidden');
    });
    
    // Generar código QR
    const idOperacion = `factura_${Date.now()}`;
    
    mercadoPagoQR.generarQR(totalFactura, idOperacion, facturadorState.sucursal.id)
        .then(resultado => {
            if (resultado.qrBase64) {
                // Mostrar QR
                document.getElementById('qrCodeContainer').innerHTML = `
                    <img src="data:image/png;base64,${resultado.qrBase64}" alt="Código QR para pago">
                `;
                
                // Iniciar verificación periódica
                iniciarVerificacionMP(idOperacion);
            } else {
                document.getElementById('qrCodeContainer').innerHTML = `
                    <i class="icon-times"></i>
                    <span>Error al generar QR. Intente con otro método de pago.</span>
                `;
            }
        })
        .catch(error => {
            logger.error('Error al generar QR de Mercado Pago', { error });
            document.getElementById('qrCodeContainer').innerHTML = `
                <i class="icon-times"></i>
                <span>Error al conectar con Mercado Pago. Intente con otro método de pago.</span>
            `;
        });
}

/**
 * Inicia la verificación periódica de pago de Mercado Pago
 * @param {string} idOperacion - ID de la operación a verificar
 */
function iniciarVerificacionMP(idOperacion) {
    // Limpiar intervalo anterior si existe
    if (window.checkMPInterval) {
        clearInterval(window.checkMPInterval);
    }
    
    const estadoPagoMP = document.getElementById('estadoPagoMP');
    const btnConfirmarPagoMP = document.getElementById('btnConfirmarPagoMP');
    
    // Verificar cada 3 segundos
    window.checkMPInterval = setInterval(() => {
        checkMPPayment(idOperacion)
            .then(resultado => {
                if (resultado.pagado) {
                    // Pago exitoso
                    clearInterval(window.checkMPInterval);
                    
                    estadoPagoMP.innerHTML = `
                        <i class="icon-check"></i>
                        <span>¡Pago recibido correctamente!</span>
                    `;
                    estadoPagoMP.classList.add('pago-exitoso');
                    
                    // Habilitar botón de confirmar
                    btnConfirmarPagoMP.disabled = false;
                    
                    // Configurar botón de confirmar
                    btnConfirmarPagoMP.onclick = () => {
                        const totalFactura = calcularTotalFinal();
                        
                        const detallesPago = {
                            tipo: METODOS_PAGO.MERCADO_PAGO,
                            monto: totalFactura,
                            idOperacion: idOperacion,
                            datosMP: resultado.datos
                        };
                        
                        registrarMetodoPago(METODOS_PAGO.MERCADO_PAGO, detallesPago);
                    };
                }
            })
            .catch(error => {
                console.error('Error al verificar pago MP:', error);
            });
    }, 3000);
}

/**
 * Registra el método de pago seleccionado
 * @param {string} metodoPago - Método de pago
 * @param {Object} detalles - Detalles del pago
 */
function registrarMetodoPago(metodoPago, detalles) {
    facturadorState.metodoPago = metodoPago;
    facturadorState.detallesPago = detalles;
    
    // Actualizar interfaz
    document.querySelectorAll('.metodo-pago-btn').forEach(btn => {
        btn.classList.remove('selected');
    });
    
    document.getElementById(`btn${metodoPagoAId(metodoPago)}`).classList.add('selected');
    
    // Mostrar botón de AFIP si corresponde
    const btnFacturarAFIP = document.getElementById('btnFacturarAFIP');
    
    if (facturadorState.tipoComprobante !== TIPOS_COMPROBANTE.PRESUPUESTO &&
        metodoPago !== METODOS_PAGO.EFECTIVO) {
        btnFacturarAFIP.classList.remove('hidden');
    } else {
        btnFacturarAFIP.classList.add('hidden');
    }
    
    // Cerrar modal
    document.getElementById('modalMetodoPago').classList.add('hidden');
    
    // Si había verificación de MP en curso, detenerla
    if (window.checkMPInterval) {
        clearInterval(window.checkMPInterval);
    }
    
    showMessage(`Método de pago: ${getMetodoPagoLabel(metodoPago)}`, 'success');
}

/**
 * Convierte el método de pago en un ID para el selector CSS
 * @param {string} metodoPago - Método de pago
 * @returns {string} ID para selector
 */
function metodoPagoAId(metodoPago) {
    switch (metodoPago) {
        case METODOS_PAGO.EFECTIVO:
            return 'PagoEfectivo';
        case METODOS_PAGO.TARJETA_DEBITO:
            return 'PagoTarjetaDebito';
        case METODOS_PAGO.TARJETA_CREDITO:
            return 'PagoTarjetaCredito';
        case METODOS_PAGO.TRANSFERENCIA:
            return 'PagoTransferencia';
        case METODOS_PAGO.MERCADO_PAGO:
            return 'PagoMercadoPago';
        default:
            return '';
    }
}

/**
 * Obtiene la etiqueta descriptiva del método de pago
 * @param {string} metodoPago - Método de pago
 * @returns {string} Etiqueta descriptiva
 */
function getMetodoPagoLabel(metodoPago) {
    switch (metodoPago) {
        case METODOS_PAGO.EFECTIVO:
            return 'Efectivo';
        case METODOS_PAGO.TARJETA_DEBITO:
            return 'Tarjeta de débito';
        case METODOS_PAGO.TARJETA_CREDITO:
            return 'Tarjeta de crédito';
        case METODOS_PAGO.TRANSFERENCIA:
            return 'Transferencia bancaria';
        case METODOS_PAGO.MERCADO_PAGO:
            return 'Mercado Pago';
        default:
            return 'Método de pago no especificado';
    }
}

/**
 * Maneja el botón de facturación con AFIP
 */
function handleFacturarAFIP() {
    // Verificar si hay productos
    if (facturadorState.productos.length === 0) {
        showMessage('Agregue productos antes de facturar', 'error');
        return;
    }
    
    // Verificar si hay cliente seleccionado
    if (!facturadorState.cliente) {
        showMessage('Seleccione un cliente antes de facturar', 'error');
        return;
    }
    
    // Verificar si hay método de pago seleccionado (excepto para efectivo, que es opcional)
    if (!facturadorState.metodoPago && facturadorState.metodoPago !== METODOS_PAGO.EFECTIVO) {
        showMessage('Seleccione un método de pago antes de facturar', 'error');
        return;
    }
    
    // Mostrar modal de facturación con AFIP
    const modal = document.getElementById('modalFacturarAFIP');
    modal.classList.remove('hidden');
    
    const modalContent = document.getElementById('modalFacturarAFIPContent');
    modalContent.innerHTML = `
        <div class="modal-spinner">
            <i class="icon-spinner icon-spin"></i>
            <span>Conectando con ARCA...</span>
        </div>
    `;
    
    // Preparar datos para la factura
    const datosFactura = prepararDatosFactura();
    
    // Llamar a la API de ARCA
    arcaGenerateInvoice(datosFactura)
    .then(resultado => {
        if (resultado.exito) {
            // Mostrar información de éxito
            modalContent.innerHTML = `
                <div class="modal-success">
                    <i class="icon-check-circle"></i>
                    <h3>Factura generada exitosamente</h3>
                    <div class="factura-datos">
                        <p><strong>Número:</strong> ${resultado.numeroFactura}</p>
                        <p><strong>CAE:</strong> ${resultado.cae}</p>
                        <p><strong>Vencimiento CAE:</strong> ${resultado.vencimientoCae}</p>
                    </div>
                    <div class="factura-acciones">
                        <button id="btnDescargarFactura" class="btn btn-primary">
                            <i class="icon-download"></i> Descargar PDF
                        </button>
                        <button id="btnEnviarEmail" class="btn btn-secondary">
                            <i class="icon-envelope"></i> Enviar por Email
                        </button>
                        <button id="btnEnviarWhatsapp" class="btn btn-secondary">
                            <i class="icon-whatsapp"></i> Enviar por WhatsApp
                        </button>
                    </div>
                </div>
            `;
            
            // Guardar resultado en el estado
            facturadorState.facturaGenerada = resultado;
            
            // Registrar factura en la base de datos
            guardarFacturaEnDB(resultado);
            
            // Actualizar stock de productos
            actualizarStockProductos();
            
            // Registrar pago
            registrarPagoEnSistema();
            
            // Configurar botones de acciones
            document.getElementById('btnDescargarFactura').addEventListener('click', () => {
                descargarFacturaPDF(resultado.pdfBase64);
            });
            
            document.getElementById('btnEnviarEmail').addEventListener('click', () => {
                enviarFacturaPorEmail();
            });
            
            document.getElementById('btnEnviarWhatsapp').addEventListener('click', () => {
                enviarFacturaPorWhatsApp();
            });
            
            // Imprimir automáticamente si está configurado
            if (facturadorState.sucursal.imprimirAutomaticamente) {
                printInvoice(resultado);
            }
        } else {
            // Mostrar error
            modalContent.innerHTML = `
                <div class="modal-error">
                    <i class="icon-times-circle"></i>
                    <h3>Error al generar factura</h3>
                    <p>${resultado.error || 'No se pudo conectar con AFIP'}</p>
                    <button id="btnReintentar" class="btn btn-primary">Reintentar</button>
                </div>
            `;
            
            document.getElementById('btnReintentar').addEventListener('click', () => {
                handleFacturarAFIP();
            });
            
            logger.error('Error al generar factura AFIP', { 
                error: resultado.error, 
                datosFactura 
            });
        }
    })
    .catch(error => {
        logger.error('Error al conectar con ARCA', { error });
        
        modalContent.innerHTML = `
            <div class="modal-error">
                <i class="icon-times-circle"></i>
                <h3>Error de conexión</h3>
                <p>No se pudo conectar con el servicio de facturación. Verifique su conexión a internet.</p>
                <button id="btnReintentar" class="btn btn-primary">Reintentar</button>
                <button id="btnFacturacionOffline" class="btn btn-secondary">Facturar sin AFIP</button>
            </div>
        `;
        
        document.getElementById('btnReintentar').addEventListener('click', () => {
            handleFacturarAFIP();
        });
        
        document.getElementById('btnFacturacionOffline').addEventListener('click', () => {
            handleGenerarFactura();
            modal.classList.add('hidden');
        });
    });
    
    // Configurar botón de cerrar
    document.getElementById('btnCerrarModalAFIP').addEventListener('click', () => {
        modal.classList.add('hidden');
    });
}

/**
 * Prepara los datos para generar la factura
 * @returns {Object} Datos de la factura
 */
function prepararDatosFactura() {
    const totalNeto = calcularTotalNeto();
    const totalIVA = calcularTotalIVA();
    const totalFactura = calcularTotalFinal();
    
    return {
        fecha: new Date(),
        tipoComprobante: facturadorState.tipoComprobante,
        sucursal: {
            id: facturadorState.sucursal.id,
            codigo: facturadorState.sucursal.codigo,
            nombre: facturadorState.sucursal.nombre,
            cuit: facturadorState.sucursal.cuit,
            direccion: facturadorState.sucursal.direccion
        },
        cliente: {
            id: facturadorState.cliente.id,
            nombre: facturadorState.cliente.nombre,
            documento: facturadorState.cliente.documento,
            condicionIVA: facturadorState.cliente.condicionIVA,
            direccion: facturadorState.cliente.direccion || '',
            email: facturadorState.cliente.email || ''
        },
        productos: facturadorState.productos.map(p => ({
            codigo: p.codigo,
            nombre: p.nombre,
            cantidad: p.cantidad,
            precioUnitario: p.precio,
            subtotal: p.subtotal,
            iva: p.iva
        })),
        totales: {
            subtotal: totalNeto,
            iva: totalIVA,
            descuento: facturadorState.descuento,
            recargo: facturadorState.recargo,
            total: totalFactura
        },
        pago: {
            metodo: facturadorState.metodoPago,
            detalles: facturadorState.detallesPago
        },
        usuario: {
            id: facturadorState.usuario.id,
            nombre: facturadorState.usuario.nombre
        }
    };
}

/**
 * Guarda la factura generada en la base de datos
 * @param {Object} resultado - Resultado de la generación de factura
 */
function guardarFacturaEnDB(resultado) {
    const datosFactura = prepararDatosFactura();
    
    const facturaDB = {
        ...datosFactura,
        numeroFactura: resultado.numeroFactura,
        cae: resultado.cae,
        vencimientoCae: resultado.vencimientoCae,
        fechaCreacion: new Date(),
        estado: 'emitida'
    };
    
    db.facturas.insert(facturaDB)
        .then(facturaGuardada => {
            logger.info('Factura guardada en DB', { 
                id: facturaGuardada.id,
                numeroFactura: facturaGuardada.numeroFactura
            });
            
            // Crear copia de seguridad
            createBackup('facturas');
            
            // Sincronizar con la nube si está disponible
            syncData('facturas');
        })
        .catch(error => {
            logger.error('Error al guardar factura en DB', { error });
        });
}

/**
 * Actualiza el stock de los productos facturados
 */
function actualizarStockProductos() {
    facturadorState.productos.forEach(producto => {
        // No actualizar stock para productos manuales
        if (producto.creado_manualmente) return;
        
        // Actualizar stock en la base de datos
        updateStock(producto.codigo, -producto.cantidad, facturadorState.sucursal.id)
            .catch(error => {
                logger.error('Error al actualizar stock', { 
                    error, 
                    producto: producto.codigo,
                    cantidad: producto.cantidad
                });
            });
    });
}

/**
 * Registra el pago en el sistema
 */
function registrarPagoEnSistema() {
    const datosFactura = prepararDatosFactura();
    const datosPago = {
        fecha: new Date(),
        sucursal_id: facturadorState.sucursal.id,
        usuario_id: facturadorState.usuario.id,
        tipo_operacion: 'factura',
        referencia: datosFactura.totales.total,
        metodo: facturadorState.metodoPago,
        detalles: facturadorState.detallesPago,
        monto: datosFactura.totales.total
    };
    
    registerPayment(datosPago)
        .catch(error => {
            logger.error('Error al registrar pago', { error, datosPago });
        });
}

/**
 * Descarga el PDF de la factura
 * @param {string} pdfBase64 - PDF en formato base64
 */
function descargarFacturaPDF(pdfBase64) {
    if (!pdfBase64) {
        showMessage('No hay PDF disponible para descargar', 'error');
        return;
    }
    
    const linkElement = document.createElement('a');
    linkElement.href = `data:application/pdf;base64,${pdfBase64}`;
    linkElement.download = `Factura_${facturadorState.facturaGenerada.numeroFactura}.pdf`;
    linkElement.click();
}

/**
 * Envía la factura por email
 */
function enviarFacturaPorEmail() {
    // Verificar si el cliente tiene email
    if (!facturadorState.cliente.email) {
        showModalEmailManual();
        return;
    }
    
    // Mostrar confirmación
    const modal = document.getElementById('modalEnvioEmail');
    modal.classList.remove('hidden');
    
    document.getElementById('emailDestinatario').value = facturadorState.cliente.email;
    
    document.getElementById('btnConfirmarEnvioEmail').addEventListener('click', () => {
        const email = document.getElementById('emailDestinatario').value.trim();
        const incluirPDF = document.getElementById('incluirPDFEmail').checked;
        const incluirXML = document.getElementById('incluirXMLEmail').checked;
        
        if (!email || !validateEmail(email)) {
            showMessage('Ingrese un email válido', 'error');
            return;
        }
        
        const contenidoEmail = document.getElementById('contenidoEmail').value.trim();
        const asuntoEmail = `Factura ${facturadorState.facturaGenerada.numeroFactura} - ${facturadorState.sucursal.nombre}`;
        
        // Enviar email
        sendEmail({
            destinatario: email,
            asunto: asuntoEmail,
            contenido: contenidoEmail,
            adjuntos: {
                pdf: incluirPDF ? facturadorState.facturaGenerada.pdfBase64 : null,
                xml: incluirXML ? facturadorState.facturaGenerada.xmlData : null
            }
        })
        .then(() => {
            modal.classList.add('hidden');
            showMessage('Email enviado correctamente', 'success');
        })
        .catch(error => {
            logger.error('Error al enviar email', { error });
            showMessage('Error al enviar email. Intente nuevamente', 'error');
        });
    });
    
    document.getElementById('btnCancelarEnvioEmail').addEventListener('click', () => {
        modal.classList.add('hidden');
    });
}

/**
 * Envía la factura por WhatsApp
 */
function enviarFacturaPorWhatsApp() {
    // Verificar si el cliente tiene teléfono
    if (!facturadorState.cliente.telefono) {
        showModalWhatsAppManual();
        return;
    }
    
    // Mostrar confirmación
    const modal = document.getElementById('modalEnvioWhatsApp');
    modal.classList.remove('hidden');
    
    document.getElementById('whatsappDestinatario').value = facturadorState.cliente.telefono;
    
    document.getElementById('btnConfirmarEnvioWhatsApp').addEventListener('click', () => {
        const telefono = document.getElementById('whatsappDestinatario').value.trim();
        const incluirPDF = document.getElementById('incluirPDFWhatsApp').checked;
        
        if (!telefono) {
            showMessage('Ingrese un número de teléfono válido', 'error');
            return;
        }
        
        const mensaje = document.getElementById('contenidoWhatsApp').value.trim();
        
        // Enviar WhatsApp
        sendWhatsApp({
            destinatario: telefono,
            mensaje: mensaje,
            adjuntoPDF: incluirPDF ? facturadorState.facturaGenerada.pdfBase64 : null
        })
        .then(() => {
            modal.classList.add('hidden');
            showMessage('WhatsApp enviado correctamente', 'success');
        })
        .catch(error => {
            logger.error('Error al enviar WhatsApp', { error });
            showMessage('Error al enviar WhatsApp. Intente nuevamente', 'error');ra
        });
    });
    
    document.getElementById('btnCancelarEnvioWhatsApp').addEventListener('click', () => {
        modal.classList.add('hidden');
    });
}

/**
 * Muestra el modal para ingresar email manualmente
 */
function showModalEmailManual() {
    const modal = document.getElementById('modalEmailManual');
    modal.classList.remove('hidden');
    
    document.getElementById('btnGuardarEmailManual').addEventListener('click', () => {
        const email = document.getElementById('emailManual').value.trim();
        
        if (!email || !validateEmail(email)) {
            showMessage('Ingrese un email válido', 'error');
            return;
        }
        
        // Actualizar cliente en memoria
        facturadorState.cliente.email = email;
        
        // Si el cliente existe en la BD, actualizar
        if (facturadorState.cliente.id) {
            db.clientes.update(
                { id: facturadorState.cliente.id },
                { $set: { email: email } }
            );
        }
        
        modal.classList.add('hidden');
        
        // Continuar con el envío
        enviarFacturaPorEmail();
    });
    
    document.getElementById('btnCancelarEmailManual').addEventListener('click', () => {
        modal.classList.add('hidden');
    });
}

/**
 * Muestra el modal para ingresar teléfono manualmente
 */
function showModalWhatsAppManual() {
    const modal = document.getElementById('modalWhatsAppManual');
    modal.classList.remove('hidden');
    
    document.getElementById('btnGuardarTelefonoManual').addEventListener('click', () => {
        const telefono = document.getElementById('telefonoManual').value.trim();
        
        if (!telefono) {
            showMessage('Ingrese un número de teléfono válido', 'error');
            return;
        }
        
        // Actualizar cliente en memoria
        facturadorState.cliente.telefono = telefono;
        
        // Si el cliente existe en la BD, actualizar
        if (facturadorState.cliente.id) {
            db.clientes.update(
                { id: facturadorState.cliente.id },
                { $set: { telefono: telefono } }
            );
        }
        
        modal.classList.add('hidden');
        
        // Continuar con el envío
        enviarFacturaPorWhatsApp();
    });
    
    document.getElementById('btnCancelarTelefonoManual').addEventListener('click', () => {
        modal.classList.add('hidden');
    });
}

/**
 * Maneja la generación de factura sin AFIP
 */
function handleGenerarFactura() {
    // Verificar si hay productos
    if (facturadorState.productos.length === 0) {
        showMessage('Agregue productos antes de generar factura', 'error');
        return;
    }
    
    // Verificar si hay cliente seleccionado
    if (!facturadorState.cliente) {
        showMessage('Seleccione un cliente antes de generar factura', 'error');
        return;
    }
    
    // Preparar datos para la factura
    const datosFactura = prepararDatosFactura();
    
    // Para presupuestos no necesitamos método de pago
    const esPresupuesto = facturadorState.tipoComprobante === TIPOS_COMPROBANTE.PRESUPUESTO;
    
    // Verificar si hay método de pago seleccionado (excepto para presupuestos)
    if (!esPresupuesto && !facturadorState.metodoPago) {
        showMessage('Seleccione un método de pago antes de generar factura', 'error');
        return;
    }
    
    // Mostrar modal de generación
    const modal = document.getElementById('modalGenerarFactura');
    modal.classList.remove('hidden');
    
    const modalContent = document.getElementById('modalGenerarFacturaContent');
    modalContent.innerHTML = `
        <div class="modal-spinner">
            <i class="icon-spinner icon-spin"></i>
            <span>Generando ${esPresupuesto ? 'presupuesto' : 'factura'}...</span>
        </div>
    `;
    
    // Generar siguiente número de comprobante
    db.comprobantes.findOne({
        tipo: facturadorState.tipoComprobante,
        sucursal_id: facturadorState.sucursal.id
    }, { sort: { numero: -1 } }).then(ultimoComprobante => {
        const ultimoNumero = ultimoComprobante ? ultimoComprobante.numero : 0;
        const nuevoNumero = ultimoNumero + 1;
        
        const numeroFormateado = `${facturadorState.sucursal.codigo.padStart(4, '0')}-${nuevoNumero.toString().padStart(8, '0')}`;
        
        // Generar PDF
        generatePDF({
            ...datosFactura,
            numeroFactura: numeroFormateado
        }).then(pdfBase64 => {
            // Guardar en base de datos
            const comprobanteDB = {
                ...datosFactura,
                numero: nuevoNumero,
                numeroFormateado: numeroFormateado,
                fechaCreacion: new Date(),
                estado: esPresupuesto ? 'presupuesto' : 'emitida',
                pdfBase64: pdfBase64
            };
            
            db.comprobantes.insert(comprobanteDB)
                .then(comprobanteGuardado => {
                    // Actualizar estado
                    facturadorState.facturaGenerada = {
                        ...comprobanteGuardado,
                        pdfBase64: pdfBase64
                    };
                    
                    // Actualizar interface de éxito
                    modalContent.innerHTML = `
                        <div class="modal-success">
                            <i class="icon-check-circle"></i>
                            <h3>${esPresupuesto ? 'Presupuesto' : 'Factura'} generado exitosamente</h3>
                            <div class="factura-datos">
                                <p><strong>Número:</strong> ${numeroFormateado}</p>
                                <p><strong>Fecha:</strong> ${new Date().toLocaleDateString()}</p>
                            </div>
                            <div class="factura-acciones">
                                <button id="btnDescargarComprobante" class="btn btn-primary">
                                    <i class="icon-download"></i> Descargar PDF
                                </button>
                                <button id="btnImprimirComprobante" class="btn btn-secondary">
                                    <i class="icon-print"></i> Imprimir
                                </button>
                                <button id="btnEnviarEmailComprobante" class="btn btn-secondary">
                                    <i class="icon-envelope"></i> Enviar por Email
                                </button>
                            </div>
                        </div>
                    `;
                    
                    // Si no es presupuesto, actualizar stock y registrar pago
                    if (!esPresupuesto) {
                        actualizarStockProductos();
                        registrarPagoEnSistema();
                    }
                    
                    // Configurar botones
                    document.getElementById('btnDescargarComprobante').addEventListener('click', () => {
                        descargarFacturaPDF(pdfBase64);
                    });
                    
                    document.getElementById('btnImprimirComprobante').addEventListener('click', () => {
                        if (esPresupuesto) {
                            printTicket(comprobanteGuardado);
                        } else {
                            printInvoice(comprobanteGuardado);
                        }
                    });
                    
                    document.getElementById('btnEnviarEmailComprobante').addEventListener('click', () => {
                        enviarFacturaPorEmail();
                    });
                    
                    // Imprimir automáticamente si está configurado
                    if (facturadorState.sucursal.imprimirAutomaticamente) {
                        if (esPresupuesto) {
                            printTicket(comprobanteGuardado);
                        } else {
                            printInvoice(comprobanteGuardado);
                        }
                    }
                    
                    // Resetear facturador después de generar comprobante exitosamente
                    resetFacturador();
                })
                .catch(error => {
                    logger.error('Error al guardar comprobante', { error });
                    
                    modalContent.innerHTML = `
                        <div class="modal-error">
                            <i class="icon-times-circle"></i>
                            <h3>Error al guardar comprobante</h3>
                            <p>No se pudo guardar el comprobante en la base de datos.</p>
                            <button id="btnReintentar" class="btn btn-primary">Reintentar</button>
                        </div>
                    `;
                    
                    document.getElementById('btnReintentar').addEventListener('click', () => {
                        handleGenerarFactura();
                    });
                });
        }).catch(error => {
            logger.error('Error al generar PDF', { error });
            
            modalContent.innerHTML = `
                <div class="modal-error">
                    <i class="icon-times-circle"></i>
                    <h3>Error al generar PDF</h3>
                    <p>No se pudo generar el PDF del comprobante.</p>
                    <button id="btnReintentar" class="btn btn-primary">Reintentar</button>
                </div>
            `;
            
            document.getElementById('btnReintentar').addEventListener('click', () => {
                handleGenerarFactura();
            });
        });
    });
    
    // Configurar botón de cerrar
    document.getElementById('btnCerrarModalGenerar').addEventListener('click', () => {
        modal.classList.add('hidden');
    });
}

/**
 * Guarda un presupuesto para uso futuro
 */
function guardarPresupuesto() {
    // Verificar si hay productos
    if (facturadorState.productos.length === 0) {
        showMessage('Agregue productos antes de guardar presupuesto', 'error');
        return;
    }
    
    // Verificar si hay cliente seleccionado
    if (!facturadorState.cliente) {
        showMessage('Seleccione un cliente antes de guardar presupuesto', 'error');
        return;
    }
    
    // Mostrar modal para guardar presupuesto
    const modal = document.getElementById('modalGuardarPresupuesto');
    modal.classList.remove('hidden');
    
    document.getElementById('btnConfirmarGuardarPresupuesto').addEventListener('click', () => {
        const nombrePresupuesto = document.getElementById('nombrePresupuesto').value.trim() || 
            `Presupuesto ${facturadorState.cliente.nombre} - ${new Date().toLocaleDateString()}`;
        
        const validoHasta = document.getElementById('validezPresupuesto').value;
        
        // Preparar datos
        const datosPresupuesto = {
            ...prepararDatosFactura(),
            nombre: nombrePresupuesto,
            validoHasta: validoHasta ? new Date(validoHasta) : null,
            tipoComprobante: TIPOS_COMPROBANTE.PRESUPUESTO,
            fechaCreacion: new Date(),
            estado: 'guardado'
        };
        
        // Guardar en base de datos
        db.presupuestos.insert(datosPresupuesto)
            .then(() => {
                modal.classList.add('hidden');
                showMessage('Presupuesto guardado exitosamente', 'success');
                
                // Opcional: resetear facturador
                if (document.getElementById('resetearDespuesGuardar').checked) {
                    resetFacturador();
                }
            })
            .catch(error => {
                logger.error('Error al guardar presupuesto', { error });
                showMessage('Error al guardar presupuesto', 'error');
            });
    });
    
    document.getElementById('btnCancelarGuardarPresupuesto').addEventListener('click', () => {
        modal.classList.add('hidden');
    });
}

/**
 * Calcula el total neto (sin IVA)
 * @returns {number} Total neto
 */
function calcularTotalNeto() {
    let total = facturadorState.productos.reduce((sum, producto) => sum + producto.subtotal, 0);
    
    // Aplicar descuento o recargo
    if (facturadorState.descuento > 0) {
        total -= (total * facturadorState.descuento / 100);
    } else if (facturadorState.recargo > 0) {
        total += (total * facturadorState.recargo / 100);
    }
    
    return total;
}

/**
 * Calcula el total de IVA
 * @returns {number} Total de IVA
 */
function calcularTotalIVA() {
    if (!facturadorState.aplicarIVA) {
        return 0;
    }
    
    let totalIVA = 0;
    
    // Calcular IVA para cada producto
    facturadorState.productos.forEach(producto => {
        const subtotal = producto.subtotal;
        const tasaIVA = producto.iva / 100;
        
        totalIVA += subtotal * tasaIVA;
    });
    
    // Ajustar por descuento o recargo
    if (facturadorState.descuento > 0) {
        totalIVA -= (totalIVA * facturadorState.descuento / 100);
    } else if (facturadorState.recargo > 0) {
        totalIVA += (totalIVA * facturadorState.recargo / 100);
    }
    
    return totalIVA;
}

/**
 * Calcula el total final de la factura
 * @returns {number} Total final
 */
function calcularTotalFinal() {
    const totalNeto = calcularTotalNeto();
    const totalIVA = calcularTotalIVA();
    
    return totalNeto + totalIVA;
}

/**
 * Calcula y actualiza los totales en la interfaz
 */
function calcularTotales() {
    const subtotal = facturadorState.productos.reduce((sum, producto) => sum + producto.subtotal, 0);
    let totalNeto = subtotal;
    
    // Aplicar descuento/recargo al subtotal
    const descuentoRecargo = document.getElementById('descuentoInput').value.trim();
    if (descuentoRecargo.startsWith('-')) {
        const descuento = parseFloat(descuentoRecargo.substring(1)) || 0;
        totalNeto -= (subtotal * descuento / 100);
    } else if (descuentoRecargo.startsWith('+')) {
        const recargo = parseFloat(descuentoRecargo.substring(1)) || 0;
        totalNeto += (subtotal * recargo / 100);
    } else if (descuentoRecargo) {
        const descuento = parseFloat(descuentoRecargo) || 0;
        totalNeto -= (subtotal * descuento / 100);
    }
    
    // Calcular IVA
    const aplicarIVA = document.getElementById('aplicarIVACheck').checked;
    let totalIVA = 0;
    
    if (aplicarIVA) {
        facturadorState.productos.forEach(producto => {
            totalIVA += producto.subtotal * (producto.iva / 100);
        });
        
        // Ajustar IVA por descuento/recargo
        if (descuentoRecargo.startsWith('-')) {
            const descuento = parseFloat(descuentoRecargo.substring(1)) || 0;
            totalIVA -= (totalIVA * descuento / 100);
        } else if (descuentoRecargo.startsWith('+')) {
            const recargo = parseFloat(descuentoRecargo.substring(1)) || 0;
            totalIVA += (totalIVA * recargo / 100);
        } else if (descuentoRecargo) {
            const descuento = parseFloat(descuentoRecargo) || 0;
            totalIVA -= (totalIVA * descuento / 100);
        }
    }
    
    const totalFinal = totalNeto + totalIVA;
    
    // Actualizar interfaz
    document.getElementById('subtotalSpan').textContent = `$${subtotal.toFixed(2)}`;
    document.getElementById('ivaSpan').textContent = `$${totalIVA.toFixed(2)}`;
    document.getElementById('totalSpan').textContent = `$${totalFinal.toFixed(2)}`;
    
    // Actualizar texto detallado
    const detalleIVA = document.getElementById('detalleIVA');
    
    if (aplicarIVA) {
        const detalleHTML = facturadorState.productos
            .filter(p => p.iva > 0)
            .reduce((grupos, producto) => {
                const tasa = producto.iva;
                const subtotal = producto.subtotal;
                
                if (!grupos[tasa]) {
                    grupos[tasa] = 0;
                }
                
                grupos[tasa] += subtotal;
                
return grupos;
            }, {});
            
        let detalleTexto = '';
        for (const tasa in detalleHTML) {
            const montoBase = detalleHTML[tasa];
            const montoIVA = montoBase * (tasa / 100);
            detalleTexto += `IVA ${tasa}%: $${montoIVA.toFixed(2)} (base: $${montoBase.toFixed(2)})<br>`;
        }
        
        detalleIVA.innerHTML = detalleTexto;
        detalleIVA.classList.remove('hidden');
    } else {
        detalleIVA.innerHTML = '';
        detalleIVA.classList.add('hidden');
    }
    
    // Actualizar estado del facturador
    facturadorState.subtotal = subtotal;
    facturadorState.aplicarIVA = aplicarIVA;
    
    if (descuentoRecargo.startsWith('-')) {
        facturadorState.descuento = parseFloat(descuentoRecargo.substring(1)) || 0;
        facturadorState.recargo = 0;
    } else if (descuentoRecargo.startsWith('+')) {
        facturadorState.recargo = parseFloat(descuentoRecargo.substring(1)) || 0;
        facturadorState.descuento = 0;
    } else if (descuentoRecargo) {
        facturadorState.descuento = parseFloat(descuentoRecargo) || 0;
        facturadorState.recargo = 0;
    } else {
        facturadorState.descuento = 0;
        facturadorState.recargo = 0;
    }
}

/**
 * Resetea el facturador para una nueva venta
 */
function resetFacturador() {
    // Limpiar productos
    facturadorState.productos = [];
    actualizarTablaProductos();
    
    // Limpiar cliente
    facturadorState.cliente = null;
    document.getElementById('clienteInfo').innerHTML = '<span class="text-muted">Seleccione un cliente</span>';
    
    // Limpiar descuento/recargo
    document.getElementById('descuentoInput').value = '';
    
    // Restablecer IVA
    document.getElementById('aplicarIVACheck').checked = true;
    facturadorState.aplicarIVA = true;
    
    // Limpiar método de pago
    facturadorState.metodoPago = null;
    facturadorState.detallesPago = null;
    document.getElementById('metodoPagoInfo').innerHTML = '<span class="text-muted">Seleccione método de pago</span>';
    
    // Calcular totales (ahora vacíos)
    calcularTotales();
    
    // Limpiar búsqueda de productos
    document.getElementById('buscarProductoInput').value = '';
    
    // Restablecer tipo de comprobante
    facturadorState.tipoComprobante = TIPOS_COMPROBANTE.FACTURA_B;
    document.getElementById('tipoComprobanteSelect').value = TIPOS_COMPROBANTE.FACTURA_B;
    
    // Limpiar factura generada
    facturadorState.facturaGenerada = null;
    
    // Mostrar mensaje
    showMessage('Facturador restablecido', 'info');
}

/**
 * Valida una dirección de email
 * @param {string} email - Email a validar
 * @returns {boolean} Resultado de la validación
 */
function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

/**
 * Imprime una factura
 * @param {Object} factura - Datos de la factura a imprimir
 */
function printInvoice(factura) {
    if (facturadorState.sucursal.impresora) {
        // Usar impresora configurada
        sendToPrinter({
            printer: facturadorState.sucursal.impresora,
            data: factura.pdfBase64,
            type: 'pdf'
        })
        .then(() => {
            showMessage('Factura enviada a impresora', 'success');
        })
        .catch(error => {
            logger.error('Error al imprimir factura', { error });
            showMessage('Error al imprimir factura', 'error');
            
            // Intentar imprimir con el diálogo del sistema
            printPDF(factura.pdfBase64);
        });
    } else {
        // Usar diálogo de impresión del sistema
        printPDF(factura.pdfBase64);
    }
}

/**
 * Imprime un ticket o presupuesto
 * @param {Object} comprobante - Datos del comprobante a imprimir
 */
function printTicket(comprobante) {
    if (facturadorState.sucursal.impresoraTicket) {
        // Generar contenido del ticket
        const ticketData = generateTicketData(comprobante);
        
        // Enviar a impresora
        sendToPrinter({
            printer: facturadorState.sucursal.impresoraTicket,
            data: ticketData,
            type: 'raw'
        })
        .then(() => {
            showMessage('Ticket enviado a impresora', 'success');
        })
        .catch(error => {
            logger.error('Error al imprimir ticket', { error });
            showMessage('Error al imprimir ticket', 'error');
            
            // Intentar imprimir PDF como alternativa
            printPDF(comprobante.pdfBase64);
        });
    } else {
        // Usar PDF como alternativa
        printPDF(comprobante.pdfBase64);
    }
}

/**
 * Genera los datos para imprimir un ticket
 * @param {Object} comprobante - Datos del comprobante
 * @returns {string} Datos formateados para la impresora
 */
function generateTicketData(comprobante) {
    // Configuración del ticket
    const ancho = 40; // Caracteres por línea
    
    // Cabecera
    let ticket = '\x1B\x40'; // Inicializar impresora
    ticket += '\x1B\x61\x01'; // Centrado
    ticket += '\x1B\x21\x30'; // Doble altura y ancho
    ticket += `${facturadorState.sucursal.nombre}\n`;
    ticket += '\x1B\x21\x00'; // Texto normal
    ticket += `${facturadorState.sucursal.direccion}\n`;
    ticket += `CUIT: ${facturadorState.sucursal.cuit}\n`;
    ticket += '-'.repeat(ancho) + '\n';
    
    // Tipo de comprobante
    ticket += '\x1B\x21\x10'; // Negrita
    const esPresupuesto = comprobante.tipoComprobante === TIPOS_COMPROBANTE.PRESUPUESTO;
    ticket += `${esPresupuesto ? 'PRESUPUESTO' : 'COMPROBANTE NO FISCAL'}\n`;
    ticket += '\x1B\x21\x00'; // Texto normal
    
    // Número y fecha
    ticket += `Nro: ${comprobante.numeroFormateado}\n`;
    ticket += `Fecha: ${new Date(comprobante.fecha).toLocaleDateString()}\n`;
    
    // Cliente
    ticket += '-'.repeat(ancho) + '\n';
    ticket += `Cliente: ${comprobante.cliente.nombre}\n`;
    ticket += `${comprobante.cliente.condicionIVA}\n`;
    if (comprobante.cliente.documento) {
        ticket += `${comprobante.cliente.documento}\n`;
    }
    ticket += '-'.repeat(ancho) + '\n';
    
    // Productos
    ticket += '\x1B\x21\x10'; // Negrita
    ticket += 'PRODUCTO               CANT  PRECIO  TOTAL\n';
    ticket += '\x1B\x21\x00'; // Texto normal
    
    comprobante.productos.forEach(producto => {
        // Formato: nombre (25) + cantidad (5) + precio (8) + total (8)
        const nombre = producto.nombre.substring(0, 20).padEnd(20, ' ');
        const cantidad = producto.cantidad.toString().padStart(5, ' ');
        const precio = producto.precioUnitario.toFixed(2).padStart(8, ' ');
        const total = producto.subtotal.toFixed(2).padStart(8, ' ');
        
        ticket += `${nombre} ${cantidad} ${precio} ${total}\n`;
    });
    
    ticket += '-'.repeat(ancho) + '\n';
    
    // Totales
    if (comprobante.totales.descuento > 0) {
        ticket += `Subtotal: $${comprobante.totales.subtotal.toFixed(2)}\n`;
        ticket += `Descuento ${comprobante.totales.descuento}%: $${(comprobante.totales.subtotal * comprobante.totales.descuento / 100).toFixed(2)}\n`;
    } else if (comprobante.totales.recargo > 0) {
        ticket += `Subtotal: $${comprobante.totales.subtotal.toFixed(2)}\n`;
        ticket += `Recargo ${comprobante.totales.recargo}%: $${(comprobante.totales.subtotal * comprobante.totales.recargo / 100).toFixed(2)}\n`;
    }
    
    if (comprobante.totales.iva > 0) {
        ticket += `IVA: $${comprobante.totales.iva.toFixed(2)}\n`;
    }
    
    // Total final
    ticket += '\x1B\x21\x30'; // Doble altura y ancho
    ticket += `TOTAL: $${comprobante.totales.total.toFixed(2)}\n`;
    ticket += '\x1B\x21\x00'; // Texto normal
    
    // Información adicional
    if (esPresupuesto && comprobante.validoHasta) {
        ticket += '-'.repeat(ancho) + '\n';
        ticket += `Presupuesto válido hasta: ${new Date(comprobante.validoHasta).toLocaleDateString()}\n`;
    }
    
    if (!esPresupuesto) {
        ticket += '-'.repeat(ancho) + '\n';
        ticket += `Forma de pago: ${comprobante.pago.metodo}\n`;
    }
    
    // Pie de ticket
    ticket += '\x1B\x61\x01'; // Centrado
    ticket += '-'.repeat(ancho) + '\n';
    ticket += 'Gracias por su compra\n';
    ticket += '\x1B\x61\x00'; // Alineación izquierda
    
    // Cortar papel
    ticket += '\x1D\x56\x41'; // Corte completo
    
    return ticket;
}

// Inicializar los eventos
document.addEventListener('DOMContentLoaded', () => {
    initFacturador();
});