const XLSX = require('xlsx');
const { guardarProducto } = require('../../utils/database.js');
const { mostrarNotificacion } = require('../../components/notifications.js');

// Botones principales
document.getElementById('btn-descargar-plantilla').addEventListener('click', descargarPlantillaExcel);
document.getElementById('input-importar-excel').addEventListener('change', manejarImportacionExcel);

// Descarga plantilla Excel con columnas base
function descargarPlantillaExcel() {
    const encabezados = [
        "codigo", "nombre", "descripcion", "precio", "iva",
        "categoria", "proveedor", "grupo", "subgrupo", "familia",
        "tipo", "stockInicial", "costo"
    ];

    const ws = XLSX.utils.aoa_to_sheet([encabezados]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Productos');

    XLSX.writeFile(wb, 'plantilla_productos_factusystem.xlsx');
}

// Procesa archivo Excel importado
async function manejarImportacionExcel(e) {
    const archivo = e.target.files[0];
    if (!archivo) return;

    try {
        const data = await archivo.arrayBuffer();
        const workbook = XLSX.read(data, { type: 'array' });
        const hoja = workbook.Sheets[workbook.SheetNames[0]];
        const productos = XLSX.utils.sheet_to_json(hoja);

        if (!validarEstructura(productos)) {
            mostrarNotificacion('La plantilla no contiene las columnas esperadas.', 'error');
            return;
        }

        const resultados = await importarProductos(productos);
        mostrarResumenImportacion(resultados);

    } catch (err) {
        console.error(err);
        mostrarNotificacion('Error al procesar el archivo Excel.', 'error');
    } finally {
        e.target.value = ''; // Limpiar input para permitir reimportación
    }
}

// Valida que las columnas requeridas estén presentes
function validarEstructura(lista) {
    if (!lista.length) return false;
    const esperado = ["codigo", "nombre", "descripcion", "precio", "iva", "categoria", "proveedor", "grupo", "subgrupo", "familia", "tipo", "stockInicial", "costo"];
    const columnas = Object.keys(lista[0]);
    return esperado.every(col => columnas.includes(col));
}

// Importa productos uno por uno
async function importarProductos(lista) {
    const resultados = {
        exitosos: [],
        fallidos: []
    };

    for (let i = 0; i < lista.length; i++) {
        const row = lista[i];

        const producto = {
            codigo: row.codigo?.toString().trim(),
            nombre: row.nombre?.toString().trim(),
            descripcion: row.descripcion || '',
            precio: parseFloat(row.precio) || 0,
            iva: parseInt(row.iva) || 21,
            categoria: row.categoria || '',
            proveedor: row.proveedor || '',
            grupo: row.grupo || '',
            subgrupo: row.subgrupo || '',
            familia: row.familia || '',
            tipo: row.tipo || '',
            stockInicial: parseInt(row.stockInicial) || 0,
            costo: parseFloat(row.costo) || 0,
            imagen: null // Se puede agregar en futuras versiones
        };

        // Validación mínima
        if (!producto.codigo || !producto.nombre || producto.precio <= 0) {
            resultados.fallidos.push({ ...producto, motivo: 'Datos inválidos' });
            continue;
        }

        const resultado = await guardarProducto(producto);
        if (resultado.ok) {
            resultados.exitosos.push(producto);
        } else {
            resultados.fallidos.push({ ...producto, motivo: resultado.mensaje || 'Error desconocido' });
        }
    }

    return resultados;
}

// Muestra resumen luego de la importación
function mostrarResumenImportacion(resultados) {
    const total = resultados.exitosos.length + resultados.fallidos.length;
    const msg = `Importación finalizada.\nProductos cargados: ${resultados.exitosos.length}\nErrores: ${resultados.fallidos.length}`;

    mostrarNotificacion(msg, resultados.fallidos.length ? 'warning' : 'success');

    if (resultados.fallidos.length) {
        console.warn('Productos con errores:', resultados.fallidos);
        alert(`Algunos productos no se cargaron correctamente.\nVer consola para más detalles.`);
    }

    const evento = new CustomEvent('productoGuardado');
    window.dispatchEvent(evento);
}
