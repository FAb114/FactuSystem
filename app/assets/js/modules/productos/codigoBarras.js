import JsBarcode from 'jsbarcode';
import { obtenerProductos, guardarCodigoBarras } from '../../utils/database.js';
import { abrirModal, cerrarModal } from '../../components/modals.js';
import { mostrarNotificacion } from '../../components/notifications.js';

let productosSeleccionados = [];

export function inicializarCodigosDeBarras() {
    document.getElementById('btn-generar-codigo').addEventListener('click', generarCodigoAleatorio);
    document.getElementById('btn-ver-codigos').addEventListener('click', mostrarModalCodigosBarras);
    document.getElementById('btn-imprimir-etiquetas').addEventListener('click', imprimirEtiquetasSeleccionadas);
    document.getElementById('btn-generar-etiquetas-lote').addEventListener('click', generarEtiquetasLote);
    document.getElementById('btn-cancelar-etiquetas').addEventListener('click', () => cerrarModal('modalCodigosBarras'));
}

// Abre el modal para imprimir etiquetas del producto actual
function mostrarModalCodigosBarras() {
    const idProducto = document.getElementById('producto-id').value;
    const nombre = document.getElementById('nombre').value;
    const codigo = document.getElementById('codigo').value;
    const precio = document.getElementById('precio').value;

    if (!codigo) {
        mostrarNotificacion('El producto no tiene código de barras asignado.', 'error');
        return;
    }

    const canvas = document.getElementById('barcode-preview');
    JsBarcode(canvas, codigo, {
        format: 'EAN13',
        displayValue: true,
        width: 2,
        height: 60,
        fontSize: 16
    });

    document.getElementById('codigo-barra-texto').innerText = codigo;
    document.getElementById('etiqueta-nombre-producto').innerText = nombre;
    document.getElementById('etiqueta-precio-producto').innerText = `$${parseFloat(precio).toFixed(2)}`;

    abrirModal('modalCodigosBarras');
}

// Genera un código EAN13 aleatorio válido
function generarCodigoAleatorio() {
    const base = Math.floor(100000000000 + Math.random() * 900000000000).toString();
    const checksum = calcularDigitoVerificadorEAN13(base);
    const completo = base + checksum;
    document.getElementById('codigo').value = completo;

    guardarCodigoBarras(document.getElementById('producto-id').value, completo)
        .then(() => mostrarNotificacion('Código de barras generado y asignado correctamente.', 'success'))
        .catch(() => mostrarNotificacion('Error al guardar el código en la base de datos.', 'error'));
}

// Imprime etiquetas del producto mostrado
function imprimirEtiquetasSeleccionadas() {
    const cantidad = parseInt(document.getElementById('cantidad-etiquetas').value);
    if (isNaN(cantidad) || cantidad <= 0) {
        mostrarNotificacion('Cantidad inválida.', 'error');
        return;
    }

    const codigo = document.getElementById('codigo-barra-texto').innerText;
    const nombre = document.getElementById('etiqueta-nombre-producto').innerText;
    const precio = document.getElementById('etiqueta-precio-producto').innerText;

    const ventana = window.open('', 'PRINT', 'height=400,width=600');
    ventana.document.write('<html><head><title>Etiquetas</title><style>');
    ventana.document.write('.etiqueta { margin: 10px; padding: 10px; border: 1px solid #333; display: inline-block; font-family: Arial; text-align: center; width: 150px; }');
    ventana.document.write('</style></head><body>');

    for (let i = 0; i < cantidad; i++) {
        ventana.document.write(`<div class="etiqueta"><div>${nombre}</div><div>${precio}</div><svg id="barcode-${i}"></svg></div>`);
    }

    ventana.document.write('</body></html>');
    ventana.document.close();

    ventana.onload = () => {
        for (let i = 0; i < cantidad; i++) {
            JsBarcode(ventana.document.getElementById(`barcode-${i}`), codigo, {
                format: 'EAN13',
                width: 1.8,
                height: 40,
                fontSize: 12,
                displayValue: true
            });
        }

        setTimeout(() => {
            ventana.focus();
            ventana.print();
        }, 500);
    };
}

// Genera etiquetas para varios productos seleccionados
async function generarEtiquetasLote() {
    const productos = await obtenerProductos();
    const seleccionados = productos.filter(p => p.imprimirEtiqueta); // Supón que hay un flag en base de datos o se filtra antes

    if (!seleccionados.length) {
        mostrarNotificacion('No hay productos seleccionados para generar etiquetas.', 'warning');
        return;
    }

    const ventana = window.open('', 'PRINT', 'height=600,width=800');
    ventana.document.write('<html><head><title>Etiquetas por lote</title><style>');
    ventana.document.write('.etiqueta { margin: 10px; padding: 10px; border: 1px solid #333; display: inline-block; font-family: Arial; text-align: center; width: 160px; }');
    ventana.document.write('</style></head><body>');

    seleccionados.forEach((prod, idx) => {
        ventana.document.write(`<div class="etiqueta"><div>${prod.nombre}</div><div>$${prod.precio.toFixed(2)}</div><svg id="barcode-lote-${idx}"></svg></div>`);
    });

    ventana.document.write('</body></html>');
    ventana.document.close();

    ventana.onload = () => {
        seleccionados.forEach((prod, idx) => {
            JsBarcode(ventana.document.getElementById(`barcode-lote-${idx}`), prod.codigo, {
                format: 'EAN13',
                width: 1.8,
                height: 40,
                fontSize: 12,
                displayValue: true
            });
        });

        setTimeout(() => {
            ventana.focus();
            ventana.print();
        }, 600);
    };
}

// Calcula dígito verificador para EAN13
function calcularDigitoVerificadorEAN13(base12) {
    const nums = base12.split('').map(Number);
    const suma = nums.reduce((acc, val, i) => acc + val * (i % 2 === 0 ? 1 : 3), 0);
    const mod = suma % 10;
    return mod === 0 ? 0 : 10 - mod;
}
