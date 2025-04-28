/**
 * movimientos.js - Módulo para gestionar movimientos de caja en FactuSystem
 * 
 * Este módulo maneja:
 * - Registro de ingresos, egresos y ventas
 * - Obtención y filtrado de movimientos por tipo y fecha
 * - Cálculo de totales por tipo
 * - Sincronización con el servidor
 * - Auditoría de cada movimiento
 */

const database = require('../../utils/database');
const auth = require('../../utils/auth');
const sync = require('../../utils/sync');
const logger = require('../../utils/logger');
const format = require('../../utils/format');

/**
 * Registra un nuevo movimiento de caja
 * @param {Object} movimiento - Datos del movimiento
 * @returns {Promise<Object>}
 */
async function registrarMovimiento(movimiento) {
    try {
        const now = new Date();

        const nuevoMovimiento = {
            caja_id: movimiento.cajaId,
            sucursal_id: movimiento.sucursalId,
            usuario_id: movimiento.usuarioId,
            tipo: movimiento.tipo,                     // ingreso | egreso | venta
            monto: parseFloat(movimiento.monto),
            categoria: movimiento.categoria || null,
            concepto: movimiento.concepto || '',
            observaciones: movimiento.observaciones || '',
            fecha: now.toISOString(),
            venta_id: movimiento.ventaId || null,
            factura: movimiento.factura || null,
            cliente: movimiento.cliente || null
        };

        const resultado = await database.insert('caja_movimientos', nuevoMovimiento);

        // Audit log
        await logger.audit(`caja.movimiento.${movimiento.tipo}`, {
            usuario_id: movimiento.usuarioId,
            sucursal_id: movimiento.sucursalId,
            caja_id: movimiento.cajaId,
            monto: movimiento.monto,
            categoria: movimiento.categoria,
            concepto: movimiento.concepto,
            fecha: now.toISOString()
        });

        // Intentar sincronización si estamos online
        if (await sync.isOnline()) {
            sync.pushData('caja_movimientos', resultado.id);
        }

        return { ...nuevoMovimiento, id: resultado.id };
    } catch (error) {
        logger.error(`Error al registrar movimiento de tipo ${movimiento.tipo}`, { error: error.message });
        throw new Error('No se pudo registrar el movimiento');
    }
}

/**
 * Devuelve todos los movimientos de una caja
 * @param {number} cajaId
 * @returns {Promise<Array>}
 */
async function obtenerMovimientos(cajaId) {
    try {
        const movimientos = await database.query(`
            SELECT * FROM caja_movimientos WHERE caja_id = ?
        `, [cajaId]);
        return movimientos;
    } catch (error) {
        logger.error('Error al obtener movimientos de caja', { error: error.message });
        return [];
    }
}

/**
 * Devuelve los movimientos filtrados por fecha y tipo
 * @param {number} cajaId 
 * @param {Date|null} desde 
 * @param {Date|null} hasta 
 * @param {string|null} tipo 
 * @returns {Promise<Array>}
 */
async function filtrarMovimientos(cajaId, desde = null, hasta = null, tipo = null) {
    try {
        let query = `SELECT * FROM caja_movimientos WHERE caja_id = ?`;
        const params = [cajaId];

        if (desde) {
            query += ` AND fecha >= ?`;
            params.push(desde.toISOString());
        }

        if (hasta) {
            query += ` AND fecha <= ?`;
            params.push(hasta.toISOString());
        }

        if (tipo) {
            query += ` AND tipo = ?`;
            params.push(tipo);
        }

        const resultados = await database.query(query, params);
        return resultados;
    } catch (error) {
        logger.error('Error al filtrar movimientos', { error: error.message });
        return [];
    }
}

/**
 * Devuelve los totales acumulados por tipo de movimiento
 * @param {number} cajaId
 * @returns {Promise<Object>} - { ingreso: 0, egreso: 0, venta: 0 }
 */
async function obtenerTotalesPorTipo(cajaId) {
    try {
        const resultados = await database.query(`
            SELECT tipo, SUM(monto) as total 
            FROM caja_movimientos 
            WHERE caja_id = ?
            GROUP BY tipo
        `, [cajaId]);

        const totales = { ingreso: 0, egreso: 0, venta: 0 };
        resultados.forEach(r => {
            totales[r.tipo] = parseFloat(r.total);
        });

        return totales;
    } catch (error) {
        logger.error('Error al calcular totales por tipo de movimiento', { error: error.message });
        return { ingreso: 0, egreso: 0, venta: 0 };
    }
}

module.exports = {
    registrarMovimiento,
    obtenerMovimientos,
    filtrarMovimientos,
    obtenerTotalesPorTipo
};
