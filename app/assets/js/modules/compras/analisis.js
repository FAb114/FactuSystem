// /app/assets/js/modules/compras/analisis.js

const { obtenerDeDB } = require('../../utils/database.js');
const { logEvent } = require('../../utils/logger.js');

let compras = [];
let chartCompras = null;
let chartDistribucion = null;

function initAnalisisCompras
module.exports.initAnalisisCompras = initAnalisisCompras() {
    document.getElementById('btn-generar-analisis')?.addEventListener('click', generarAnalisisCompras);
    document.getElementById('btn-exportar-analisis')?.addEventListener('click', exportarInformeAnalisis);
    generarAnalisisCompras();
}

function generarAnalisisCompras
module.exports.generarAnalisisCompras = generarAnalisisCompras() {
    obtenerDeDB('compras')
        .then(data => {
            compras = data || [];
            const desde = document.getElementById('analisis-fecha-desde').value;
            const hasta = document.getElementById('analisis-fecha-hasta').value;
            const tipo = document.getElementById('analisis-tipo').value;
            const agrupacion = document.getElementById('analisis-agrupacion').value;

            const filtradas = aplicarFiltroFechas(compras, desde, hasta);
            renderResumen(filtradas);
            renderDistribucion(filtradas, tipo);
            renderTendencia(filtradas, agrupacion);
            renderTopProveedores(filtradas);
            renderTopProductos(filtradas);

            logEvent('AnalisisGenerado', { tipo, agrupacion, desde, hasta });
        })
        .catch(err => console.error('Error cargando compras:', err));
}

function aplicarFiltroFechas(lista, desde, hasta) {
    return lista.filter(c => {
        const f = new Date(c.fecha);
        const fDesde = desde ? new Date(desde) : null;
        const fHasta = hasta ? new Date(hasta) : null;
        return (!fDesde || f >= fDesde) && (!fHasta || f <= fHasta);
    });
}

function renderResumen(lista) {
    const total = lista.reduce((acc, c) => acc + (c.total || 0), 0);
    const promedio = lista.length ? total / lista.length : 0;
    const pendiente = lista.filter(c => c.estado !== 'pagado').reduce((acc, c) => acc + c.total, 0);

    document.getElementById('total-compras').textContent = `$${total.toFixed(2)}`;
    document.getElementById('promedio-compras').textContent = `$${promedio.toFixed(2)}`;
    document.getElementById('cantidad-compras').textContent = lista.length;
    document.getElementById('pendiente-pago').textContent = `$${pendiente.toFixed(2)}`;
}

function renderDistribucion(lista, tipo) {
    const agrupado = {};

    lista.forEach(c => {
        let clave;
        if (tipo === 'proveedor') clave = c.proveedor;
        else if (tipo === 'categoria') clave = (c.productos[0]?.categoria || 'Sin categoría');
        else if (tipo === 'producto') clave = c.productos[0]?.nombre;
        else if (tipo === 'sucursal') clave = c.sucursal || 'Principal';

        agrupado[clave] = (agrupado[clave] || 0) + c.total;
    });

    const etiquetas = Object.keys(agrupado);
    const valores = Object.values(agrupado);

    if (chartDistribucion) chartDistribucion.destroy();
    const ctx = document.getElementById('chart-distribucion');
    chartDistribucion = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: etiquetas,
            datasets: [{ data: valores, backgroundColor: generarColores(etiquetas.length) }]
        },
        options: {
            plugins: { legend: { position: 'right' } }
        }
    });
}

function renderTendencia(lista, agrupacion) {
    const agrupado = {};

    lista.forEach(c => {
        const fecha = new Date(c.fecha);
        let clave;
        if (agrupacion === 'diario') clave = fecha.toISOString().split('T')[0];
        else if (agrupacion === 'mensual') clave = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`;
        else if (agrupacion === 'anual') clave = `${fecha.getFullYear()}`;
        else if (agrupacion === 'trimestral') clave = `${fecha.getFullYear()}-T${Math.floor(fecha.getMonth() / 3) + 1}`;
        else if (agrupacion === 'semanal') {
            const inicioSemana = new Date(fecha.setDate(fecha.getDate() - fecha.getDay()));
            clave = inicioSemana.toISOString().split('T')[0];
        }

        agrupado[clave] = (agrupado[clave] || 0) + c.total;
    });

    const etiquetas = Object.keys(agrupado).sort();
    const valores = etiquetas.map(e => agrupado[e]);

    if (chartCompras) chartCompras.destroy();
    const ctx = document.getElementById('chart-compras');
    chartCompras = new Chart(ctx, {
        type: 'line',
        data: {
            labels: etiquetas,
            datasets: [{
                label: 'Total de Compras',
                data: valores,
                borderColor: '#3498db',
                backgroundColor: 'rgba(52, 152, 219, 0.2)',
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: false }
            }
        }
    });
}

function renderTopProveedores(lista) {
    const tabla = document.getElementById('tabla-top-proveedores').querySelector('tbody');
    const resumen = {};

    lista.forEach(c => {
        const p = c.proveedor;
        if (!resumen[p]) resumen[p] = { total: 0, cantidad: 0, ultima: c.fecha };
        resumen[p].total += c.total;
        resumen[p].cantidad += 1;
        if (new Date(c.fecha) > new Date(resumen[p].ultima)) resumen[p].ultima = c.fecha;
    });

    const totalGlobal = lista.reduce((acc, c) => acc + c.total, 0);

    const top = Object.entries(resumen)
        .map(([proveedor, datos]) => ({
            proveedor,
            ...datos,
            porcentaje: (datos.total / totalGlobal) * 100
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);

    tabla.innerHTML = top.map(p => `
        <tr>
            <td>${p.proveedor}</td>
            <td>$${p.total.toFixed(2)}</td>
            <td>${p.porcentaje.toFixed(1)}%</td>
            <td>${p.cantidad}</td>
            <td>${p.ultima}</td>
        </tr>
    `).join('');
}

function renderTopProductos(lista) {
    const tabla = document.getElementById('tabla-top-productos').querySelector('tbody');
    const resumen = {};

    lista.forEach(c => {
        c.productos.forEach(p => {
            if (!resumen[p.nombre]) resumen[p.nombre] = { cantidad: 0, total: 0, ultima: c.fecha };
            resumen[p.nombre].cantidad += p.cantidad;
            resumen[p.nombre].total += p.cantidad * p.precio;
            if (new Date(c.fecha) > new Date(resumen[p.nombre].ultima)) resumen[p.nombre].ultima = c.fecha;
        });
    });

    const top = Object.entries(resumen)
        .map(([nombre, datos]) => ({
            nombre,
            ...datos,
            precioPromedio: datos.total / datos.cantidad
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);

    tabla.innerHTML = top.map(p => `
        <tr>
            <td>${p.nombre}</td>
            <td>${p.cantidad}</td>
            <td>$${p.total.toFixed(2)}</td>
            <td>$${p.precioPromedio.toFixed(2)}</td>
            <td>${p.ultima}</td>
        </tr>
    `).join('');
}

function generarColores(n) {
    const base = ['#3498db', '#e74c3c', '#f1c40f', '#2ecc71', '#9b59b6', '#1abc9c', '#e67e22', '#34495e'];
    return Array.from({ length: n }, (_, i) => base[i % base.length]);
}

function exportarInformeAnalisis() {
    alert('Función de exportar informe no implementada en esta demo.');
}
