/**
 * @file exportacion.js
 * @description Módulo para la exportación de reportes en diferentes formatos (PDF, Excel, CSV) para FactuSystem
 * @module reportes/exportacion
 */

// Importaciones de utilidades necesarias
const { createPDF } = require('../../../utils/printer.js');
const { logger } = require('../../../utils/logger.js');
const { getConfiguracion } = require('../../configuraciones/index.js');
const { Database } = require('../../../utils/database.js');
const { formatearFecha, formatearMoneda } = require('../../../utils/validation.js');
const { ipcRenderer } = require('../../../renderer.js');

// Import templates
const { loadTemplate } = require('../../../utils/database.js');

/**
 * Clase principal para gestionar la exportación de reportes
 */
class ExportacionReportes {
    constructor() {
        this.db = new Database();
        this.configuracion = null;
        this.templates = {
            ventas: null,
            compras: null,
            caja: null,
            stock: null,
            fiscales: null
        };
        
        // Formatos soportados
        this.formatos = {
            PDF: 'pdf',
            EXCEL: 'xlsx',
            CSV: 'csv'
        };
        
        // Inicializar
        this.init();
    }
    
    /**
     * Inicializa el módulo cargando configuración y templates
     */
    async init() {
        try {
            // Cargar configuración de la empresa
            this.configuracion = await getConfiguracion();
            
            // Cargar templates
            await this.cargarTemplates();
            
            // Registrar eventos
            this.registrarEventos();
            
            logger.info('Módulo de exportación de reportes inicializado correctamente');
        } catch (error) {
            logger.error('Error al inicializar el módulo de exportación de reportes', error);
            throw new Error('No se pudo inicializar el módulo de exportación');
        }
    }
    
    /**
     * Carga las plantillas HTML para los reportes
     */
    async cargarTemplates() {
        try {
            this.templates.ventas = await loadTemplate('../templates/reportes/ventas.html');
            this.templates.compras = await loadTemplate('../templates/reportes/compras.html');
            this.templates.caja = await loadTemplate('../templates/reportes/caja.html');
            this.templates.stock = await loadTemplate('../templates/reportes/stock.html');
            this.templates.fiscales = await loadTemplate('../templates/reportes/fiscales.html');
            
            logger.info('Templates de reportes cargados correctamente');
        } catch (error) {
            logger.error('Error al cargar templates de reportes', error);
            throw new Error('No se pudieron cargar las plantillas de reportes');
        }
    }
    
    /**
     * Registra eventos para la UI
     */
    registrarEventos() {
        document.addEventListener('click', (event) => {
            // Botones de exportación
            if (event.target.closest('.btn-exportar-pdf')) {
                const tipo = event.target.closest('.btn-exportar-pdf').dataset.tipoReporte;
                const filtros = this.obtenerFiltrosActivos(tipo);
                this.exportarPDF(tipo, filtros);
            }
            
            if (event.target.closest('.btn-exportar-excel')) {
                const tipo = event.target.closest('.btn-exportar-excel').dataset.tipoReporte;
                const filtros = this.obtenerFiltrosActivos(tipo);
                this.exportarExcel(tipo, filtros);
            }
            
            if (event.target.closest('.btn-exportar-csv')) {
                const tipo = event.target.closest('.btn-exportar-csv').dataset.tipoReporte;
                const filtros = this.obtenerFiltrosActivos(tipo);
                this.exportarCSV(tipo, filtros);
            }
        });
    }
    
    /**
     * Obtiene los filtros activos para un tipo de reporte
     * @param {string} tipoReporte - Tipo de reporte (ventas, compras, caja, stock, fiscales)
     * @returns {Object} Objeto con los filtros aplicados
     */
    obtenerFiltrosActivos(tipoReporte) {
        const container = document.querySelector(`.filtros-${tipoReporte}`);
        if (!container) return {};
        
        const filtros = {};
        
        // Fecha inicio y fin
        const fechaInicio = container.querySelector('.fecha-inicio')?.value;
        const fechaFin = container.querySelector('.fecha-fin')?.value;
        
        if (fechaInicio) filtros.fechaInicio = fechaInicio;
        if (fechaFin) filtros.fechaFin = fechaFin;
        
        // Usuario
        const usuario = container.querySelector('.filtro-usuario')?.value;
        if (usuario && usuario !== 'todos') filtros.usuario = usuario;
        
        // Sucursal
        const sucursal = container.querySelector('.filtro-sucursal')?.value;
        if (sucursal && sucursal !== 'todas') filtros.sucursal = sucursal;
        
        // Filtros específicos según tipo de reporte
        switch (tipoReporte) {
            case 'ventas':
                const cliente = container.querySelector('.filtro-cliente')?.value;
                const tipoComprobante = container.querySelector('.filtro-tipo-comprobante')?.value;
                const metodoPago = container.querySelector('.filtro-metodo-pago')?.value;
                
                if (cliente && cliente !== 'todos') filtros.cliente = cliente;
                if (tipoComprobante && tipoComprobante !== 'todos') filtros.tipoComprobante = tipoComprobante;
                if (metodoPago && metodoPago !== 'todos') filtros.metodoPago = metodoPago;
                break;
                
            case 'compras':
                const proveedor = container.querySelector('.filtro-proveedor')?.value;
                if (proveedor && proveedor !== 'todos') filtros.proveedor = proveedor;
                break;
                
            case 'stock':
                const categoria = container.querySelector('.filtro-categoria')?.value;
                const stockMinimo = container.querySelector('.filtro-stock-minimo')?.checked || false;
                
                if (categoria && categoria !== 'todas') filtros.categoria = categoria;
                if (stockMinimo) filtros.stockMinimo = true;
                break;
        }
        
        return filtros;
    }
    
    /**
     * Consulta datos para un reporte específico
     * @param {string} tipoReporte - Tipo de reporte
     * @param {Object} filtros - Filtros a aplicar
     * @returns {Promise<Array>} Datos del reporte
     */
    async consultarDatos(tipoReporte, filtros) {
        try {
            let query = '';
            const params = [];
            
            switch (tipoReporte) {
                case 'ventas':
                    query = this.construirQueryVentas(filtros, params);
                    break;
                case 'compras':
                    query = this.construirQueryCompras(filtros, params);
                    break;
                case 'caja':
                    query = this.construirQueryCaja(filtros, params);
                    break;
                case 'stock':
                    query = this.construirQueryStock(filtros, params);
                    break;
                case 'fiscales':
                    query = this.construirQueryFiscales(filtros, params);
                    break;
                default:
                    throw new Error(`Tipo de reporte no válido: ${tipoReporte}`);
            }
            
            const result = await this.db.query(query, params);
            logger.info(`Consultados datos para reporte ${tipoReporte}: ${result.length} registros`);
            return result;
        } catch (error) {
            logger.error(`Error al consultar datos para reporte ${tipoReporte}`, error);
            throw new Error(`Error al obtener datos para el reporte de ${tipoReporte}`);
        }
    }
    
    /**
     * Construye la consulta SQL para reporte de ventas
     * @param {Object} filtros - Filtros a aplicar
     * @param {Array} params - Array de parámetros para la consulta
     * @returns {string} Consulta SQL
     */
    construirQueryVentas(filtros, params) {
        let query = `
            SELECT v.id, v.fecha, v.numero_factura, v.tipo_comprobante, 
            v.total, v.metodo_pago, c.nombre as cliente, u.nombre as usuario,
            s.nombre as sucursal
            FROM ventas v
            LEFT JOIN clientes c ON v.cliente_id = c.id
            LEFT JOIN usuarios u ON v.usuario_id = u.id
            LEFT JOIN sucursales s ON v.sucursal_id = s.id
            WHERE 1=1
        `;
        
        if (filtros.fechaInicio) {
            query += ` AND v.fecha >= ?`;
            params.push(filtros.fechaInicio);
        }
        
        if (filtros.fechaFin) {
            query += ` AND v.fecha <= ?`;
            params.push(filtros.fechaFin);
        }
        
        if (filtros.usuario) {
            query += ` AND v.usuario_id = ?`;
            params.push(filtros.usuario);
        }
        
        if (filtros.sucursal) {
            query += ` AND v.sucursal_id = ?`;
            params.push(filtros.sucursal);
        }
        
        if (filtros.cliente) {
            query += ` AND v.cliente_id = ?`;
            params.push(filtros.cliente);
        }
        
        if (filtros.tipoComprobante) {
            query += ` AND v.tipo_comprobante = ?`;
            params.push(filtros.tipoComprobante);
        }
        
        if (filtros.metodoPago) {
            query += ` AND v.metodo_pago = ?`;
            params.push(filtros.metodoPago);
        }
        
        query += ` ORDER BY v.fecha DESC`;
        
        return query;
    }
    
    /**
     * Construye la consulta SQL para reporte de compras
     * @param {Object} filtros - Filtros a aplicar
     * @param {Array} params - Array de parámetros para la consulta
     * @returns {string} Consulta SQL
     */
    construirQueryCompras(filtros, params) {
        let query = `
            SELECT c.id, c.fecha, c.numero_factura, c.total, 
            p.nombre as proveedor, u.nombre as usuario,
            s.nombre as sucursal
            FROM compras c
            LEFT JOIN proveedores p ON c.proveedor_id = p.id
            LEFT JOIN usuarios u ON c.usuario_id = u.id
            LEFT JOIN sucursales s ON c.sucursal_id = s.id
            WHERE 1=1
        `;
        
        if (filtros.fechaInicio) {
            query += ` AND c.fecha >= ?`;
            params.push(filtros.fechaInicio);
        }
        
        if (filtros.fechaFin) {
            query += ` AND c.fecha <= ?`;
            params.push(filtros.fechaFin);
        }
        
        if (filtros.usuario) {
            query += ` AND c.usuario_id = ?`;
            params.push(filtros.usuario);
        }
        
        if (filtros.sucursal) {
            query += ` AND c.sucursal_id = ?`;
            params.push(filtros.sucursal);
        }
        
        if (filtros.proveedor) {
            query += ` AND c.proveedor_id = ?`;
            params.push(filtros.proveedor);
        }
        
        query += ` ORDER BY c.fecha DESC`;
        
        return query;
    }
    
    /**
     * Construye la consulta SQL para reporte de caja
     * @param {Object} filtros - Filtros a aplicar
     * @param {Array} params - Array de parámetros para la consulta
     * @returns {string} Consulta SQL
     */
    construirQueryCaja(filtros, params) {
        let query = `
            SELECT c.id, c.fecha_apertura, c.fecha_cierre, 
            c.monto_inicial, c.monto_final, c.diferencia,
            u.nombre as usuario, s.nombre as sucursal
            FROM caja c
            LEFT JOIN usuarios u ON c.usuario_id = u.id
            LEFT JOIN sucursales s ON c.sucursal_id = s.id
            WHERE 1=1
        `;
        
        if (filtros.fechaInicio) {
            query += ` AND c.fecha_apertura >= ?`;
            params.push(filtros.fechaInicio);
        }
        
        if (filtros.fechaFin) {
            query += ` AND c.fecha_apertura <= ?`;
            params.push(filtros.fechaFin);
        }
        
        if (filtros.usuario) {
            query += ` AND c.usuario_id = ?`;
            params.push(filtros.usuario);
        }
        
        if (filtros.sucursal) {
            query += ` AND c.sucursal_id = ?`;
            params.push(filtros.sucursal);
        }
        
        query += ` ORDER BY c.fecha_apertura DESC`;
        
        return query;
    }
    
    /**
     * Construye la consulta SQL para reporte de stock
     * @param {Object} filtros - Filtros a aplicar
     * @param {Array} params - Array de parámetros para la consulta
     * @returns {string} Consulta SQL
     */
    construirQueryStock(filtros, params) {
        let query = `
            SELECT p.id, p.codigo_barras, p.nombre, p.precio, 
            ps.cantidad as stock, ps.stock_minimo,
            s.nombre as sucursal
            FROM productos p
            LEFT JOIN producto_stock ps ON p.id = ps.producto_id
            LEFT JOIN sucursales s ON ps.sucursal_id = s.id
            WHERE 1=1
        `;
        
        if (filtros.sucursal) {
            query += ` AND ps.sucursal_id = ?`;
            params.push(filtros.sucursal);
        }
        
        if (filtros.categoria) {
            query += ` AND p.categoria_id = ?`;
            params.push(filtros.categoria);
        }
        
        if (filtros.stockMinimo) {
            query += ` AND ps.cantidad <= ps.stock_minimo`;
        }
        
        query += ` ORDER BY p.nombre ASC`;
        
        return query;
    }
    
    /**
     * Construye la consulta SQL para reporte fiscal
     * @param {Object} filtros - Filtros a aplicar
     * @param {Array} params - Array de parámetros para la consulta
     * @returns {string} Consulta SQL
     */
    construirQueryFiscales(filtros, params) {
        let query = `
            SELECT v.id, v.fecha, v.numero_factura, v.tipo_comprobante, 
            v.subtotal, v.iva_monto, v.total, c.nombre as cliente, 
            c.cuit, c.condicion_iva,
            s.nombre as sucursal
            FROM ventas v
            LEFT JOIN clientes c ON v.cliente_id = c.id
            LEFT JOIN sucursales s ON v.sucursal_id = s.id
            WHERE v.tipo_comprobante IN ('A', 'B', 'C')
        `;
        
        if (filtros.fechaInicio) {
            query += ` AND v.fecha >= ?`;
            params.push(filtros.fechaInicio);
        }
        
        if (filtros.fechaFin) {
            query += ` AND v.fecha <= ?`;
            params.push(filtros.fechaFin);
        }
        
        if (filtros.sucursal) {
            query += ` AND v.sucursal_id = ?`;
            params.push(filtros.sucursal);
        }
        
        query += ` ORDER BY v.fecha ASC`;
        
        return query;
    }
    
    /**
     * Exporta un reporte en formato PDF
     * @param {string} tipoReporte - Tipo de reporte
     * @param {Object} filtros - Filtros aplicados
     */
    async exportarPDF(tipoReporte, filtros) {
        try {
            // Mostrar indicador de carga
            this.mostrarLoadingExportacion(true);
            
            // Obtener datos
            const datos = await this.consultarDatos(tipoReporte, filtros);
            
            if (!datos || datos.length === 0) {
                this.mostrarMensaje('No hay datos para exportar con los filtros seleccionados', 'warning');
                this.mostrarLoadingExportacion(false);
                return;
            }
            
            // Crear contenido HTML a partir del template
            const contenidoHTML = this.generarContenidoHTML(tipoReporte, datos, filtros);
            
            // Opciones para el PDF
            const opciones = {
                titulo: `Reporte de ${this.obtenerNombreReporte(tipoReporte)}`,
                nombreArchivo: `reporte_${tipoReporte}_${this.generarFechaArchivo()}.pdf`,
                encabezado: this.configuracion.nombreEmpresa,
                piePagina: `Generado el ${formatearFecha(new Date(), true)} | FactuSystem`
            };
            
            // Generar y guardar PDF
            await createPDF(contenidoHTML, opciones);
            
            logger.info(`Reporte de ${tipoReporte} exportado a PDF correctamente`);
            this.mostrarMensaje(`Reporte de ${this.obtenerNombreReporte(tipoReporte)} exportado correctamente`, 'success');
            
            // Registrar en historial de auditoría
            this.registrarExportacion(tipoReporte, 'PDF', filtros);
        } catch (error) {
            logger.error(`Error al exportar reporte ${tipoReporte} a PDF`, error);
            this.mostrarMensaje(`Error al exportar: ${error.message}`, 'error');
        } finally {
            this.mostrarLoadingExportacion(false);
        }
    }
    
    /**
     * Exporta un reporte en formato Excel
     * @param {string} tipoReporte - Tipo de reporte
     * @param {Object} filtros - Filtros aplicados
     */
    async exportarExcel(tipoReporte, filtros) {
        try {
            // Mostrar indicador de carga
            this.mostrarLoadingExportacion(true);
            
            // Obtener datos
            const datos = await this.consultarDatos(tipoReporte, filtros);
            
            if (!datos || datos.length === 0) {
                this.mostrarMensaje('No hay datos para exportar con los filtros seleccionados', 'warning');
                this.mostrarLoadingExportacion(false);
                return;
            }
            
            // Configurar encabezados según tipo de reporte
            const encabezados = this.obtenerEncabezadosExcel(tipoReporte);
            
            // Preparar datos para Excel
            const datosFormateados = this.formatearDatosParaExcel(datos, tipoReporte);
            
            // Nombre de archivo
            const nombreArchivo = `reporte_${tipoReporte}_${this.generarFechaArchivo()}.xlsx`;
            
            // Usar IPC para procesar la exportación en el proceso principal
            const resultado = await ipcRenderer.invoke('exportar-excel', {
                encabezados,
                datos: datosFormateados,
                nombreArchivo,
                titulo: `Reporte de ${this.obtenerNombreReporte(tipoReporte)}`
            });
            
            if (resultado.success) {
                logger.info(`Reporte de ${tipoReporte} exportado a Excel correctamente`);
                this.mostrarMensaje(`Reporte de ${this.obtenerNombreReporte(tipoReporte)} exportado correctamente`, 'success');
                
                // Registrar en historial de auditoría
                this.registrarExportacion(tipoReporte, 'Excel', filtros);
            } else {
                throw new Error(resultado.error);
            }
        } catch (error) {
            logger.error(`Error al exportar reporte ${tipoReporte} a Excel`, error);
            this.mostrarMensaje(`Error al exportar: ${error.message}`, 'error');
        } finally {
            this.mostrarLoadingExportacion(false);
        }
    }
    
    /**
     * Exporta un reporte en formato CSV
     * @param {string} tipoReporte - Tipo de reporte
     * @param {Object} filtros - Filtros aplicados
     */
    async exportarCSV(tipoReporte, filtros) {
        try {
            // Mostrar indicador de carga
            this.mostrarLoadingExportacion(true);
            
            // Obtener datos
            const datos = await this.consultarDatos(tipoReporte, filtros);
            
            if (!datos || datos.length === 0) {
                this.mostrarMensaje('No hay datos para exportar con los filtros seleccionados', 'warning');
                this.mostrarLoadingExportacion(false);
                return;
            }
            
            // Configurar encabezados según tipo de reporte
            const encabezados = this.obtenerEncabezadosExcel(tipoReporte);
            
            // Preparar datos para CSV (mismo formato que Excel)
            const datosFormateados = this.formatearDatosParaExcel(datos, tipoReporte);
            
            // Nombre de archivo
            const nombreArchivo = `reporte_${tipoReporte}_${this.generarFechaArchivo()}.csv`;
            
            // Usar IPC para procesar la exportación en el proceso principal
            const resultado = await ipcRenderer.invoke('exportar-csv', {
                encabezados,
                datos: datosFormateados,
                nombreArchivo
            });
            
            if (resultado.success) {
                logger.info(`Reporte de ${tipoReporte} exportado a CSV correctamente`);
                this.mostrarMensaje(`Reporte de ${this.obtenerNombreReporte(tipoReporte)} exportado correctamente`, 'success');
                
                // Registrar en historial de auditoría
                this.registrarExportacion(tipoReporte, 'CSV', filtros);
            } else {
                throw new Error(resultado.error);
            }
        } catch (error) {
            logger.error(`Error al exportar reporte ${tipoReporte} a CSV`, error);
            this.mostrarMensaje(`Error al exportar: ${error.message}`, 'error');
        } finally {
            this.mostrarLoadingExportacion(false);
        }
    }
    
    /**
     * Obtiene los encabezados para Excel según tipo de reporte
     * @param {string} tipoReporte - Tipo de reporte
     * @returns {Array} Array de encabezados
     */
    obtenerEncabezadosExcel(tipoReporte) {
        switch (tipoReporte) {
            case 'ventas':
                return [
                    'ID', 'Fecha', 'Nº Factura', 'Tipo', 'Total', 
                    'Método Pago', 'Cliente', 'Usuario', 'Sucursal'
                ];
            case 'compras':
                return [
                    'ID', 'Fecha', 'Nº Factura', 'Total', 
                    'Proveedor', 'Usuario', 'Sucursal'
                ];
            case 'caja':
                return [
                    'ID', 'Fecha Apertura', 'Fecha Cierre', 
                    'Monto Inicial', 'Monto Final', 'Diferencia',
                    'Usuario', 'Sucursal'
                ];
            case 'stock':
                return [
                    'ID', 'Código', 'Producto', 'Precio', 
                    'Stock Actual', 'Stock Mínimo', 'Sucursal'
                ];
            case 'fiscales':
                return [
                    'ID', 'Fecha', 'Nº Factura', 'Tipo', 
                    'Subtotal', 'IVA', 'Total', 'Cliente', 
                    'CUIT', 'Cond. IVA', 'Sucursal'
                ];
            default:
                return [];
        }
    }
    
    /**
     * Formatea los datos para exportación a Excel según tipo de reporte
     * @param {Array} datos - Datos a formatear
     * @param {string} tipoReporte - Tipo de reporte
     * @returns {Array} Datos formateados
     */
    formatearDatosParaExcel(datos, tipoReporte) {
        return datos.map(item => {
            switch (tipoReporte) {
                case 'ventas':
                    return [
                        item.id,
                        formatearFecha(item.fecha),
                        item.numero_factura,
                        item.tipo_comprobante,
                        formatearMoneda(item.total),
                        item.metodo_pago,
                        item.cliente || 'Consumidor Final',
                        item.usuario,
                        item.sucursal
                    ];
                case 'compras':
                    return [
                        item.id,
                        formatearFecha(item.fecha),
                        item.numero_factura,
                        formatearMoneda(item.total),
                        item.proveedor,
                        item.usuario,
                        item.sucursal
                    ];
                case 'caja':
                    return [
                        item.id,
                        formatearFecha(item.fecha_apertura, true),
                        item.fecha_cierre ? formatearFecha(item.fecha_cierre, true) : 'Abierta',
                        formatearMoneda(item.monto_inicial),
                        formatearMoneda(item.monto_final || 0),
                        formatearMoneda(item.diferencia || 0),
                        item.usuario,
                        item.sucursal
                    ];
                case 'stock':
                    return [
                        item.id,
                        item.codigo_barras,
                        item.nombre,
                        formatearMoneda(item.precio),
                        item.stock,
                        item.stock_minimo,
                        item.sucursal
                    ];
                case 'fiscales':
                    return [
                        item.id,
                        formatearFecha(item.fecha),
                        item.numero_factura,
                        item.tipo_comprobante,
                        formatearMoneda(item.subtotal),
                        formatearMoneda(item.iva_monto),
                        formatearMoneda(item.total),
                        item.cliente || 'Consumidor Final',
                        item.cuit || '-',
                        item.condicion_iva || '-',
                        item.sucursal
                    ];
                default:
                    return [];
            }
        });
    }
    
    /**
     * Genera el contenido HTML para el reporte PDF
     * @param {string} tipoReporte - Tipo de reporte
     * @param {Array} datos - Datos del reporte
     * @param {Object} filtros - Filtros aplicados
     * @returns {string} Contenido HTML
     */
    generarContenidoHTML(tipoReporte, datos, filtros) {
        // Obtener template correspondiente
        let template = this.templates[tipoReporte];
        
        if (!template) {
            throw new Error(`No se encontró template para el reporte ${tipoReporte}`);
        }
        
        // Reemplazar variables básicas
        template = template.replace(/{{nombreEmpresa}}/g, this.configuracion.nombreEmpresa);
        template = template.replace(/{{logoEmpresa}}/g, this.configuracion.logoBase64 || '');
        template = template.replace(/{{fechaReporte}}/g, formatearFecha(new Date(), true));
        template = template.replace(/{{tituloReporte}}/g, `Reporte de ${this.obtenerNombreReporte(tipoReporte)}`);
        
        // Reemplazar filtros aplicados
        let filtrosText = '';
        if (filtros.fechaInicio && filtros.fechaFin) {
            filtrosText += `<p>Período: ${formatearFecha(filtros.fechaInicio)} al ${formatearFecha(filtros.fechaFin)}</p>`;
        }
        
        if (filtros.sucursal) {
            filtrosText += `<p>Sucursal: ${filtros.sucursal}</p>`;
        }
        
        if (filtros.usuario) {
            filtrosText += `<p>Usuario: ${filtros.usuario}</p>`;
        }
        
        // Filtros específicos por tipo
        switch (tipoReporte) {
            case 'ventas':
                if (filtros.cliente) filtrosText += `<p>Cliente: ${filtros.cliente}</p>`;
                if (filtros.tipoComprobante) filtrosText += `<p>Tipo Comprobante: ${filtros.tipoComprobante}</p>`;
                if (filtros.metodoPago) filtrosText += `<p>Método de Pago: ${filtros.metodoPago}</p>`;
                break;
            case 'compras':
                if (filtros.proveedor) filtrosText += `<p>Proveedor: ${filtros.proveedor}</p>`;
                break;
            case 'stock':
                if (filtros.categoria) filtrosText += `<p>Categoría: ${filtros.categoria}</p>`;
                if (filtros.stockMinimo) filtrosText += `<p>Solo Stock bajo mínimo</p>`;
                break;
        }
        
        template = template.replace(/{{filtrosAplicados}}/g, filtrosText);

        // Generar contenido de tabla según tipo de reporte
        let contenidoTabla = '';
        
        switch (tipoReporte) {
            case 'ventas':
                contenidoTabla = this.generarTablaVentas(datos);
                break;
            case 'compras':
                contenidoTabla = this.generarTablaCompras(datos);
                break;
            case 'caja':
                contenidoTabla = this.generarTablaCaja(datos);
                break;
            case 'stock':
                contenidoTabla = this.generarTablaStock(datos);
                break;
            case 'fiscales':
                contenidoTabla = this.generarTablaFiscales(datos);
                break;
        }
        
        template = template.replace(/{{contenidoTabla}}/g, contenidoTabla);
        
        // Generar totales si aplican
        const totales = this.calcularTotales(datos, tipoReporte);
        template = template.replace(/{{totales}}/g, totales);
        
        return template;
    }
    
    /**
     * Genera la tabla HTML para reporte de ventas
     * @param {Array} datos - Datos de ventas
     * @returns {string} HTML de la tabla
     */
    generarTablaVentas(datos) {
        let html = `
            <table class="tabla-reporte">
                <thead>
                    <tr>
                        <th>Fecha</th>
                        <th>Nº Factura</th>
                        <th>Tipo</th>
                        <th>Cliente</th>
                        <th>Método Pago</th>
                        <th>Usuario</th>
                        <th>Sucursal</th>
                        <th>Total</th>
                    </tr>
                </thead>
                <tbody>
        `;
        
        datos.forEach(venta => {
            html += `
                <tr>
                    <td>${formatearFecha(venta.fecha)}</td>
                    <td>${venta.numero_factura}</td>
                    <td>${venta.tipo_comprobante}</td>
                    <td>${venta.cliente || 'Consumidor Final'}</td>
                    <td>${venta.metodo_pago}</td>
                    <td>${venta.usuario}</td>
                    <td>${venta.sucursal}</td>
                    <td class="text-right">${formatearMoneda(venta.total)}</td>
                </tr>
            `;
        });
        
        html += `
                </tbody>
            </table>
        `;
        
        return html;
    }
    
    /**
     * Genera la tabla HTML para reporte de compras
     * @param {Array} datos - Datos de compras
     * @returns {string} HTML de la tabla
     */
    generarTablaCompras(datos) {
        let html = `
            <table class="tabla-reporte">
                <thead>
                    <tr>
                        <th>Fecha</th>
                        <th>Nº Factura</th>
                        <th>Proveedor</th>
                        <th>Usuario</th>
                        <th>Sucursal</th>
                        <th>Total</th>
                    </tr>
                </thead>
                <tbody>
        `;
        
        datos.forEach(compra => {
            html += `
                <tr>
                    <td>${formatearFecha(compra.fecha)}</td>
                    <td>${compra.numero_factura}</td>
                    <td>${compra.proveedor}</td>
                    <td>${compra.usuario}</td>
                    <td>${compra.sucursal}</td>
                    <td class="text-right">${formatearMoneda(compra.total)}</td>
                </tr>
            `;
        });
        
        html += `
                </tbody>
            </table>
        `;
        
        return html;
    }
    
    /**
     * Genera la tabla HTML para reporte de caja
     * @param {Array} datos - Datos de caja
     * @returns {string} HTML de la tabla
     */
    generarTablaCaja(datos) {
        let html = `
            <table class="tabla-reporte">
                <thead>
                    <tr>
                        <th>Apertura</th>
                        <th>Cierre</th>
                        <th>Monto Inicial</th>
                        <th>Monto Final</th>
                        <th>Diferencia</th>
                        <th>Usuario</th>
                        <th>Sucursal</th>
                    </tr>
                </thead>
                <tbody>
        `;
        
        datos.forEach(caja => {
            html += `
                <tr>
                    <td>${formatearFecha(caja.fecha_apertura, true)}</td>
                    <td>${caja.fecha_cierre ? formatearFecha(caja.fecha_cierre, true) : 'Abierta'}</td>
                    <td class="text-right">${formatearMoneda(caja.monto_inicial)}</td>
                    <td class="text-right">${formatearMoneda(caja.monto_final || 0)}</td>
                    <td class="text-right ${caja.diferencia < 0 ? 'text-danger' : ''}">${formatearMoneda(caja.diferencia || 0)}</td>
                    <td>${caja.usuario}</td>
                    <td>${caja.sucursal}</td>
                </tr>
            `;
        });
        
        html += `
                </tbody>
            </table>
        `;
        
        return html;
    }
    
    /**
     * Genera la tabla HTML para reporte de stock
     * @param {Array} datos - Datos de stock
     * @returns {string} HTML de la tabla
     */
    generarTablaStock(datos) {
        let html = `
            <table class="tabla-reporte">
                <thead>
                    <tr>
                        <th>Código</th>
                        <th>Producto</th>
                        <th>Precio</th>
                        <th>Stock Actual</th>
                        <th>Stock Mínimo</th>
                        <th>Sucursal</th>
                        <th>Estado</th>
                    </tr>
                </thead>
                <tbody>
        `;
        
        datos.forEach(producto => {
            // Calcular estado del stock
            let estado = 'Normal';
            let claseEstado = '';
            
            if (producto.cantidad <= 0) {
                estado = 'Sin Stock';
                claseEstado = 'text-danger';
            } else if (producto.cantidad <= producto.stock_minimo) {
                estado = 'Stock Bajo';
                claseEstado = 'text-warning';
            }
            
            html += `
                <tr>
                    <td>${producto.codigo_barras}</td>
                    <td>${producto.nombre}</td>
                    <td class="text-right">${formatearMoneda(producto.precio)}</td>
                    <td class="text-right">${producto.stock}</td>
                    <td class="text-right">${producto.stock_minimo}</td>
                    <td>${producto.sucursal}</td>
                    <td class="${claseEstado}">${estado}</td>
                </tr>
            `;
        });
        
        html += `
                </tbody>
            </table>
        `;
        
        return html;
    }
    
    /**
     * Genera la tabla HTML para reporte fiscal
     * @param {Array} datos - Datos fiscales
     * @returns {string} HTML de la tabla
     */
    generarTablaFiscales(datos) {
        let html = `
            <table class="tabla-reporte">
                <thead>
                    <tr>
                        <th>Fecha</th>
                        <th>Nº Factura</th>
                        <th>Tipo</th>
                        <th>Cliente</th>
                        <th>CUIT</th>
                        <th>Cond. IVA</th>
                        <th>Subtotal</th>
                        <th>IVA</th>
                        <th>Total</th>
                    </tr>
                </thead>
                <tbody>
        `;
        
        datos.forEach(factura => {
            html += `
                <tr>
                    <td>${formatearFecha(factura.fecha)}</td>
                    <td>${factura.numero_factura}</td>
                    <td>${factura.tipo_comprobante}</td>
                    <td>${factura.cliente || 'Consumidor Final'}</td>
                    <td>${factura.cuit || '-'}</td>
                    <td>${factura.condicion_iva || '-'}</td>
                    <td class="text-right">${formatearMoneda(factura.subtotal)}</td>
                    <td class="text-right">${formatearMoneda(factura.iva_monto)}</td>
                    <td class="text-right">${formatearMoneda(factura.total)}</td>
                </tr>
            `;
        });
        
        html += `
                </tbody>
            </table>
        `;
        
        return html;
    }
    
    /**
     * Calcula totales para reportes que lo requieran
     * @param {Array} datos - Datos del reporte
     * @param {string} tipoReporte - Tipo de reporte
     * @returns {string} HTML con los totales
     */
    calcularTotales(datos, tipoReporte) {
        let html = '';
        
        switch (tipoReporte) {
            case 'ventas': {
                const totalVentas = datos.reduce((sum, item) => sum + parseFloat(item.total), 0);
                
                // Calcular totales por método de pago
                const totalesPorMetodo = {};
                datos.forEach(venta => {
                    const metodo = venta.metodo_pago;
                    if (!totalesPorMetodo[metodo]) {
                        totalesPorMetodo[metodo] = 0;
                    }
                    totalesPorMetodo[metodo] += parseFloat(venta.total);
                });
                
                html = `
                    <div class="totales-reporte">
                        <h3>Totales</h3>
                        <p class="total-principal">Total ventas: ${formatearMoneda(totalVentas)}</p>
                        <div class="desglose-totales">
                            <h4>Desglose por método de pago:</h4>
                            <ul>
                `;
                
                for (const metodo in totalesPorMetodo) {
                    html += `<li>${metodo}: ${formatearMoneda(totalesPorMetodo[metodo])}</li>`;
                }
                
                html += `
                            </ul>
                        </div>
                    </div>
                `;
                break;
            }
            
            case 'compras': {
                const totalCompras = datos.reduce((sum, item) => sum + parseFloat(item.total), 0);
                
                html = `
                    <div class="totales-reporte">
                        <h3>Totales</h3>
                        <p class="total-principal">Total compras: ${formatearMoneda(totalCompras)}</p>
                    </div>
                `;
                break;
            }
            
            case 'caja': {
                const totalInicial = datos.reduce((sum, item) => sum + parseFloat(item.monto_inicial), 0);
                const totalFinal = datos.reduce((sum, item) => sum + parseFloat(item.monto_final || 0), 0);
                const totalDiferencia = datos.reduce((sum, item) => sum + parseFloat(item.diferencia || 0), 0);
                
                html = `
                    <div class="totales-reporte">
                        <h3>Totales</h3>
                        <p>Total monto inicial: ${formatearMoneda(totalInicial)}</p>
                        <p>Total monto final: ${formatearMoneda(totalFinal)}</p>
                        <p class="total-principal ${totalDiferencia < 0 ? 'text-danger' : ''}">
                            Total diferencia: ${formatearMoneda(totalDiferencia)}
                        </p>
                    </div>
                `;
                break;
            }
            
            case 'fiscales': {
                const totalSubtotal = datos.reduce((sum, item) => sum + parseFloat(item.subtotal), 0);
                const totalIva = datos.reduce((sum, item) => sum + parseFloat(item.iva_monto), 0);
                const totalFinal = datos.reduce((sum, item) => sum + parseFloat(item.total), 0);
                
                html = `
                    <div class="totales-reporte">
                        <h3>Totales</h3>
                        <p>Total neto: ${formatearMoneda(totalSubtotal)}</p>
                        <p>Total IVA: ${formatearMoneda(totalIva)}</p>
                        <p class="total-principal">Total facturado: ${formatearMoneda(totalFinal)}</p>
                    </div>
                `;
                break;
            }
        }
        
        return html;
    }
    
    /**
     * Obtiene el nombre legible del tipo de reporte
     * @param {string} tipoReporte - Tipo de reporte
     * @returns {string} Nombre legible
     */
    obtenerNombreReporte(tipoReporte) {
        const nombres = {
            ventas: 'Ventas',
            compras: 'Compras',
            caja: 'Caja',
            stock: 'Stock',
            fiscales: 'Libros Fiscales'
        };
        
        return nombres[tipoReporte] || tipoReporte;
    }
    
    /**
     * Genera una cadena de fecha para el nombre de archivo
     * @returns {string} Fecha con formato para nombre de archivo
     */
    generarFechaArchivo() {
        const fecha = new Date();
        const anio = fecha.getFullYear();
        const mes = String(fecha.getMonth() + 1).padStart(2, '0');
        const dia = String(fecha.getDate()).padStart(2, '0');
        const hora = String(fecha.getHours()).padStart(2, '0');
        const min = String(fecha.getMinutes()).padStart(2, '0');
        
        return `${anio}${mes}${dia}_${hora}${min}`;
    }
    
    /**
     * Registra la exportación en el historial de auditoría
     * @param {string} tipoReporte - Tipo de reporte
     * @param {string} formato - Formato de exportación
     * @param {Object} filtros - Filtros aplicados
     */
    async registrarExportacion(tipoReporte, formato, filtros) {
        try {
            // Obtener información del usuario actual
            const usuarioActual = await ipcRenderer.invoke('get-current-user');
            
            // Preparar datos para el registro
            const datos = {
                usuario_id: usuarioActual.id,
                accion: 'EXPORTAR_REPORTE',
                modulo: 'reportes',
                detalles: JSON.stringify({
                    tipoReporte,
                    formato,
                    filtros
                }),
                fecha: new Date()
            };
            
            // Insertar en el historial
            await this.db.insert('historial_auditoria', datos);
            
            logger.info(`Exportación registrada en auditoría: ${tipoReporte} a ${formato}`);
        } catch (error) {
            logger.error('Error al registrar exportación en auditoría', error);
            // No lanzamos el error para no interrumpir el flujo principal
        }
    }
    
    /**
     * Muestra u oculta indicador de carga durante la exportación
     * @param {boolean} mostrar - Indica si mostrar o no el indicador
     */
    mostrarLoadingExportacion(mostrar) {
        const contenedor = document.querySelector('.contenedor-exportacion');
        
        if (!contenedor) return;
        
        if (mostrar) {
            // Crear y mostrar overlay de carga si no existe
            let overlay = contenedor.querySelector('.overlay-carga');
            
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.className = 'overlay-carga';
                overlay.innerHTML = `
                    <div class="spinner"></div>
                    <p>Generando reporte...</p>
                `;
                contenedor.appendChild(overlay);
            } else {
                overlay.style.display = 'flex';
            }
        } else {
            // Ocultar overlay si existe
            const overlay = contenedor.querySelector('.overlay-carga');
            if (overlay) {
                overlay.style.display = 'none';
            }
        }
    }
    
    /**
     * Muestra un mensaje al usuario
     * @param {string} mensaje - Texto del mensaje
     * @param {string} tipo - Tipo de mensaje (success, error, warning, info)
     */
    mostrarMensaje(mensaje, tipo = 'info') {
        // Usar el componente de notificaciones del sistema
        if (window.notificaciones) {
            window.notificaciones.mostrar(mensaje, tipo);
            return;
        }
        
        // Si no está disponible el componente, usar alert
        alert(mensaje);
    }
    
    /**
     * Inicializa los selectores de fechas en los formularios de filtros
     */
    inicializarDatepickers() {
        const dateInputs = document.querySelectorAll('.fecha-input');
        
        dateInputs.forEach(input => {
            // Usar librería de datepicker instalada en el sistema
            if (window.flatpickr) {
                window.flatpickr(input, {
                    dateFormat: 'd/m/Y',
                    locale: 'es',
                    allowInput: true
                });
            }
        });
    }
    
    /**
     * Aplica eventos a botones y controles de filtrado
     * @param {string} tipoReporte - Tipo de reporte
     */
    aplicarControlFiltros(tipoReporte) {
        const container = document.querySelector(`.filtros-${tipoReporte}`);
        
        if (!container) return;
        
        // Botón para limpiar filtros
        const btnLimpiar = container.querySelector('.btn-limpiar-filtros');
        if (btnLimpiar) {
            btnLimpiar.addEventListener('click', () => {
                const inputs = container.querySelectorAll('input, select');
                inputs.forEach(input => {
                    if (input.type === 'checkbox') {
                        input.checked = false;
                    } else {
                        input.value = input.type === 'select-one' ? 'todos' : '';
                    }
                });
            });
        }
        
        // Botón para aplicar filtros y actualizar vista previa
        const btnAplicar = container.querySelector('.btn-aplicar-filtros');
        if (btnAplicar) {
            btnAplicar.addEventListener('click', async () => {
                const filtros = this.obtenerFiltrosActivos(tipoReporte);
                
                // Actualizar vista previa si existe
                if (typeof window.actualizarVistaPrevia === 'function') {
                    try {
                        const datos = await this.consultarDatos(tipoReporte, filtros);
                        window.actualizarVistaPrevia(tipoReporte, datos);
                    } catch (error) {
                        logger.error('Error al actualizar vista previa', error);
                        this.mostrarMensaje(`Error al actualizar vista previa: ${error.message}`, 'error');
                    }
                }
            });
        }
    }
    
    /**
     * Carga los filtros predefinidos para un usuario
     * @param {string} tipoReporte - Tipo de reporte
     */
    async cargarFiltrosPredefinidos(tipoReporte) {
        try {
            // Obtener usuario actual
            const usuario = await ipcRenderer.invoke('get-current-user');
            
            // Consultar filtros guardados
            const filtrosGuardados = await this.db.queryOne(
                'SELECT filtros FROM usuario_preferencias WHERE usuario_id = ? AND modulo = ? AND tipo = ?',
                [usuario.id, 'reportes', tipoReporte]
            );
            
            if (!filtrosGuardados || !filtrosGuardados.filtros) {
                return;
            }
            
            const filtros = JSON.parse(filtrosGuardados.filtros);
            const container = document.querySelector(`.filtros-${tipoReporte}`);
            
            if (!container || !filtros) return;
            
            // Aplicar cada filtro a su control correspondiente
            Object.entries(filtros).forEach(([key, value]) => {
                const control = container.querySelector(`[name="${key}"], .filtro-${key}`);
                if (control) {
                    if (control.type === 'checkbox') {
                        control.checked = value;
                    } else {
                        control.value = value;
                    }
                }
            });
            
            logger.info(`Filtros predefinidos cargados para reporte ${tipoReporte}`);
        } catch (error) {
            logger.error(`Error al cargar filtros predefinidos para ${tipoReporte}`, error);
        }
    }
    
    /**
     * Guarda los filtros actuales como predefinidos para el usuario
     * @param {string} tipoReporte - Tipo de reporte
     */
    async guardarFiltrosPredefinidos(tipoReporte) {
        try {
            // Obtener filtros activos
            const filtros = this.obtenerFiltrosActivos(tipoReporte);
            
            // Obtener usuario actual
            const usuario = await ipcRenderer.invoke('get-current-user');
            
            // Guardar en la base de datos
            await this.db.upsert(
                'usuario_preferencias',
                {
                    usuario_id: usuario.id,
                    modulo: 'reportes',
                    tipo: tipoReporte,
                    filtros: JSON.stringify(filtros)
                },
                ['usuario_id', 'modulo', 'tipo']
            );
            
            logger.info(`Filtros guardados como predefinidos para reporte ${tipoReporte}`);
            this.mostrarMensaje('Filtros guardados correctamente', 'success');
        } catch (error) {
            logger.error(`Error al guardar filtros predefinidos para ${tipoReporte}`, error);
            this.mostrarMensaje('Error al guardar filtros', 'error');
        }
    }
    
    /**
     * Implementa la funcionalidad para programar la generación automática de reportes
     * @param {string} tipoReporte - Tipo de reporte
     * @param {Object} configuracion - Configuración de programación
     */
    async programarReporteAutomatico(tipoReporte, configuracion) {
        try {
            // Validar configuración
            if (!configuracion.frecuencia || !configuracion.formato) {
                throw new Error('La configuración de programación es incompleta');
            }
            
            // Obtener usuario actual
            const usuario = await ipcRenderer.invoke('get-current-user');
            
            // Guardar programación en la base de datos
            await this.db.upsert(
                'reportes_programados',
                {
                    usuario_id: usuario.id,
                    tipo_reporte: tipoReporte,
                    filtros: JSON.stringify(configuracion.filtros || {}),
                    formato: configuracion.formato,
                    frecuencia: configuracion.frecuencia,
                    dia_semana: configuracion.diaSemana || null,
                    dia_mes: configuracion.diaMes || null,
                    hora: configuracion.hora || '08:00',
                    email: configuracion.email || usuario.email,
                    activo: true,
                    creado: new Date()
                },
                ['usuario_id', 'tipo_reporte']
            );
            
            logger.info(`Reporte programado para ${tipoReporte} con frecuencia ${configuracion.frecuencia}`);
            this.mostrarMensaje('Reporte programado correctamente', 'success');
            
            // Registrar en historial de auditoría
            this.registrarAccionAuditoria('PROGRAMAR_REPORTE', {
                tipoReporte,
                frecuencia: configuracion.frecuencia,
                formato: configuracion.formato
            });
            
            return true;
        } catch (error) {
            logger.error('Error al programar reporte automático', error);
            this.mostrarMensaje(`Error al programar reporte: ${error.message}`, 'error');
            return false;
        }
    }
    
    /**
     * Registra una acción en el historial de auditoría
     * @param {string} accion - Tipo de acción
     * @param {Object} detalles - Detalles de la acción
     */
    async registrarAccionAuditoria(accion, detalles) {
        try {
            // Obtener información del usuario actual
            const usuarioActual = await ipcRenderer.invoke('get-current-user');
            
            // Preparar datos para el registro
            const datos = {
                usuario_id: usuarioActual.id,
                accion: accion,
                modulo: 'reportes',
                detalles: JSON.stringify(detalles),
                fecha: new Date()
            };
            
            // Insertar en el historial
            await this.db.insert('historial_auditoria', datos);
            
            logger.info(`Acción registrada en auditoría: ${accion}`);
        } catch (error) {
            logger.error('Error al registrar acción en auditoría', error);
        }
    }
}

// Exportar la instancia para uso global
const exportacionReportes = new ExportacionReportes();

// Exponer la API para uso desde otros módulos
 exportacionReportes

module.exports = exportacionReportes;

// Exponer métodos específicos para uso público
const exportarReportePDF
module.exports.exportarReportePDF = exportarReportePDF = (tipoReporte, filtros) => exportacionReportes.exportarPDF(tipoReporte, filtros);
const exportarReporteExcel
module.exports.exportarReporteExcel = exportarReporteExcel = (tipoReporte, filtros) => exportacionReportes.exportarExcel(tipoReporte, filtros);
const exportarReporteCSV
module.exports.exportarReporteCSV = exportarReporteCSV = (tipoReporte, filtros) => exportacionReportes.exportarCSV(tipoReporte, filtros);
const consultarDatosReporte
module.exports.consultarDatosReporte = consultarDatosReporte = (tipoReporte, filtros) => exportacionReportes.consultarDatos(tipoReporte, filtros);
const programarReporte
module.exports.programarReporte = programarReporte = (tipoReporte, config) => exportacionReportes.programarReporteAutomatico(tipoReporte, config);