// /app/assets/js/modules/compras/registrar.js

const { guardarEnDB } = require('../../utils/database.js');
const { logEvent } = require('../../utils/logger.js');
const { validarCampos } = require('../../utils/validation.js');

let productos = [];

function initRegistrarCompra
module.exports.initRegistrarCompra = initRegistrarCompra() {
    console.log('[Compras] Registro inicializado');

    document.getElementById('btn-guardar-compra')?.addEventListener('click', guardarCompra);
    document.getElementById('btn-agregar-producto-manual')?.addEventListener('click', agregarProductoManual);
    document.getElementById('btn-nuevo-proveedor')?.addEventListener('click', () => {
        document.getElementById('modal-proveedor').style.display = 'none';
        document.getElementById('modal-nuevo-proveedor').style.display = 'block';
    });
    document.getElementById('btn-guardar-proveedor')?.addEventListener('click', guardarProveedor);

    // Recalcular totales automáticamente
    ['impuestos', 'descuentos'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', calcularTotal);
    });
}

function resetFormularioCompra
module.exports.resetFormularioCompra = resetFormularioCompra() {
    productos = [];
    const form = document.querySelector('.form-compra');
    form?.reset();

    document.getElementById('productos-compra').innerHTML = `
        <div class="empty-state">
            <i class="fas fa-shopping-cart"></i>
            <p>No hay productos agregados</p>
        </div>
    `;

    document.getElementById('preview-container').innerHTML = '';
    calcularTotal();
}

function calcularTotal() {
    const subtotal = productos.reduce((acc, p) => acc + (p.precio * p.cantidad), 0);
    const impuestos = parseFloat(document.getElementById('impuestos')?.value) || 0;
    const descuentos = parseFloat(document.getElementById('descuentos')?.value) || 0;
    const total = subtotal + impuestos - descuentos;

    document.getElementById('subtotal').value = subtotal.toFixed(2);
    document.getElementById('total').value = total.toFixed(2);
}

function cargarProveedores
module.exports.cargarProveedores = cargarProveedores() {
    const contenedor = document.getElementById('proveedores-list');
    contenedor.innerHTML = `
        <tr>
            <td>Ejemplo S.A.</td>
            <td>30-12345678-9</td>
            <td>11-5555-1234</td>
            <td>ejemplo@correo.com</td>
            <td><button class="btn btn-primary" onclick="seleccionarProveedor('Ejemplo S.A.')">Seleccionar</button></td>
        </tr>
    `;
}

function seleccionarProveedor
module.exports.seleccionarProveedor = seleccionarProveedor(nombre) {
    document.getElementById('proveedor').value = nombre;
    document.getElementById('modal-proveedor').style.display = 'none';
}

function guardarProveedor() {
    const nombre = document.getElementById('nombre-proveedor').value;
    const cuit = document.getElementById('cuit-proveedor').value;

    if (!nombre || !cuit) {
        alert('Complete nombre y CUIT');
        return;
    }

    seleccionarProveedor(nombre);
    document.getElementById('modal-nuevo-proveedor').style.display = 'none';
}

function cargarProductos
module.exports.cargarProductos = cargarProductos() {
    const contenedor = document.getElementById('productos-list');
    contenedor.innerHTML = `
        <tr>
            <td>001</td>
            <td>Producto de prueba</td>
            <td>General</td>
            <td>$100.00</td>
            <td>50</td>
            <td><button class="btn btn-primary" onclick="agregarProductoDesdeModal('Producto de prueba', 1, 100)">Agregar</button></td>
        </tr>
    `;
}

function agregarProductoDesdeModal
module.exports.agregarProductoDesdeModal = agregarProductoDesdeModal(nombre, cantidad, precio) {
    productos.push({ nombre, cantidad, precio });
    renderizarProductos();
    document.getElementById('modal-producto').style.display = 'none';
    calcularTotal();
}

function agregarProductoManual() {
    const nombre = document.getElementById('nombre-producto-manual').value;
    const cantidad = parseFloat(document.getElementById('cantidad-producto-manual').value);
    const precio = parseFloat(document.getElementById('precio-producto-manual').value);

    if (!nombre || isNaN(cantidad) || isNaN(precio)) {
        alert('Complete los campos requeridos del producto manual');
        return;
    }

    productos.push({ nombre, cantidad, precio });
    renderizarProductos();
    document.getElementById('modal-producto-manual').style.display = 'none';
    calcularTotal();
}

function renderizarProductos() {
    const container = document.getElementById('productos-compra');
    if (!productos.length) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-shopping-cart"></i>
                <p>No hay productos agregados</p>
            </div>
        `;
        return;
    }

    container.innerHTML = productos.map((p, i) => `
        <div class="producto-row">
            <span>${p.nombre}</span>
            <span>${p.cantidad} x $${p.precio.toFixed(2)}</span>
            <span>$${(p.cantidad * p.precio).toFixed(2)}</span>
            <button class="btn btn-danger btn-sm" onclick="eliminarProducto(${i})">
                <i class="fas fa-trash-alt"></i>
            </button>
        </div>
    `).join('');
}

window.eliminarProducto = function(index) {
    productos.splice(index, 1);
    renderizarProductos();
    calcularTotal();
};

function guardarCompra() {
    const proveedor = document.getElementById('proveedor').value;
    const fecha = document.getElementById('fecha-compra').value;
    const tipo = document.getElementById('tipo-comprobante').value;
    const numero = document.getElementById('numero-comprobante').value;
    const total = parseFloat(document.getElementById('total').value);
    const formaPago = document.getElementById('forma-pago').value;
    const estado = document.getElementById('estado-pago').value;
    const observaciones = document.getElementById('observaciones').value;

    if (!proveedor || !numero || !productos.length) {
        alert('Complete los datos obligatorios y agregue al menos un producto');
        return;
    }

    const compra = {
        proveedor,
        fecha,
        tipo,
        numero,
        productos,
        total,
        formaPago,
        estado,
        observaciones,
        createdAt: new Date().toISOString()
    };

    guardarEnDB('compras', compra)
        .then(() => {
            logEvent('CompraGuardada', compra);
            alert('Compra guardada correctamente');
            resetFormularioCompra();
        })
        .catch(err => {
            console.error('Error al guardar compra', err);
            alert('Error al guardar la compra');
        });
}
