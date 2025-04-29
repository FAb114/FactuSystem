/**
 * reportes.js - Módulo para generar reportes de caja en FactuSystem
 * 
 * Este módulo permite:
 * - Generar reportes detallados por fecha, usuario, sucursal
 * - Exportar en PDF o Excel
 * - Resumen gráfico y textual
 * - Registro de auditoría
 */

const database = require('../../utils/database.js');
const logger = require('../../utils/logger.js');
const sync = require('../../utils/sync.js');
const format = require('../../utils/format.js');
const printer = require('../../utils/printer.js');
const auth = require('../../utils/auth.js');
const fs = require('fs');
const path = require('path');

/**
 * Genera un objeto con los datos del reporte de caja
 * @param {Object} opciones - { desde: Date, hasta: Date, sucursalId?: number, usuarioId?: number }
 * @returns {Promise<Object>}
 */
async function generarReporteCaja(opciones = {}) {
    try {
        const { desde, hasta, sucursalId, usuarioId } = opciones;

        let query = `SELECT * FROM caja_movimientos WHERE 1=1`;
        const params = [];

        if (desde) {
            query += ` AND fecha >= ?`;
            params.push(desde.toISOString());
        }

        if (hasta) {
            query += ` AND fecha <= ?`;
            params.push(hasta.toISOString());
        }

        if (sucursalId) {
            query += ` AND sucursal_id = ?`;
            params.push(sucursalId);
        }

        if (usuarioId) {
            query += ` AND usuario_id = ?`;
            params.push(usuarioId);
        }

        query += ` ORDER BY fecha ASC`;

        const movimientos = await database.query(query, params);

        const resumen = { ingreso: 0, egreso: 0, venta: 0, total: 0 };

        movimientos.forEach(mov => {
            resumen[mov.tipo] += parseFloat(mov.monto);
            resumen.total += (mov.tipo === 'egreso') ? -mov.monto : mov.monto;
        });

        return {
            desde,
            hasta,
            sucursalId,
            usuarioId,
            movimientos,
            resumen,
            generado: new Date()
        };

    } catch (error) {
        logger.error('Error al generar datos del reporte de caja', { error: error.message });
        throw new Error('No se pudo generar el reporte');
    }
}

/**
 * Exporta el reporte de caja a PDF usando la plantilla HTML
 * @param {Object} datos - Obtenidos desde generarReporteCaja
 */
async function exportarReportePDF(datos) {
    try {
        const templatePath = path.join(__dirname, '../../../templates/reportes/caja.html');
        const htmlTemplate = fs.readFileSync(templatePath, 'utf8');

        const contenido = htmlTemplate
            .replace('{{fechaGeneracion}}', format.formatDate(datos.generado))
            .replace('{{rango}}', `${format.formatDate(datos.desde)} al ${format.formatDate(datos.hasta)}`)
            .replace('{{totalIngresos}}', format.formatCurrency(datos.resumen.ingreso))
            .replace('{{totalVentas}}', format.formatCurrency(datos.resumen.venta))
            .replace('{{totalEgresos}}', format.formatCurrency(datos.resumen.egreso))
            .replace('{{saldoFinal}}', format.formatCurrency(datos.resumen.total))
            .replace('{{tablaMovimientos}}', generarTablaHTML(datos.movimientos));

        await printer.generarPDFDesdeHTML(contenido, `Reporte_Caja_${Date.now()}.pdf`);

        await logger.audit('reporte.caja.pdf', {
            desde: datos.desde,
            hasta: datos.hasta,
            sucursal: datos.sucursalId,
            usuario: datos.usuarioId
        });

    } catch (error) {
        logger.error('Error al exportar reporte de caja a PDF', { error: error.message });
        throw new Error('No se pudo exportar el PDF');
    }
}

/**
 * Exporta el reporte de caja a Excel
 * @param {Object} datos - Obtenidos desde generarReporteCaja
 */
async function exportarReporteExcel(datos) {
    try {
        const headers = ['Fecha', 'Hora', 'Tipo', 'Categoría', 'Concepto', 'Monto'];

        const rows = datos.movimientos.map(mov => [
            format.formatDate(mov.fecha),
            new Date(mov.fecha).toLocaleTimeString(),
            mov.tipo,
            mov.categoria || '',
            mov.concepto || '',
            mov.monto
        ]);

        await printer.generarExcel({
            nombreArchivo: `Caja_${Date.now()}.xlsx`,
            headers,
            rows
        });

        await logger.audit('reporte.caja.excel', {
            desde: datos.desde,
            hasta: datos.hasta,
            sucursal: datos.sucursalId,
            usuario: datos.usuarioId
        });

    } catch (error) {
        logger.error('Error al exportar reporte de caja a Excel', { error: error.message });
        throw new Error('No se pudo exportar el Excel');
    }
}

/**
 * Genera HTML para la tabla de movimientos
 * @param {Array} movimientos 
 * @returns {string}
 */
function generarTablaHTML(movimientos) {
    return movimientos.map(mov => `
        <tr>
            <td>${format.formatDate(mov.fecha)}</td>
            <td>${new Date(mov.fecha).toLocaleTimeString()}</td>
            <td>${mov.tipo}</td>
            <td>${mov.categoria || '-'}</td>
            <td>${mov.concepto || '-'}</td>
            <td>${format.formatCurrency(mov.monto)}</td>
        </tr>
    `).join('');
}

module.exports = {
    generarReporteCaja,
    exportarReportePDF,
    exportarReporteExcel
};
