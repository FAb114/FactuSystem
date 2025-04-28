/**
 * @file fiscales.js
 * @description Módulo para generación de reportes fiscales (Libros IVA, informes para AFIP, etc.)
 * @module reportes/fiscales
 */

// Importaciones de utilidades y servicios
import { Database } from '../../../utils/database.js';
import { exportToPDF } from '../../../utils/exportPDF.js';
import { formatCurrency, formatDate, parseDate } from '../../../utils/formatters.js';
import { showNotification } from '../../../components/notifications.js';
import { validateDateRange } from '../../../utils/validation.js';
import { printDocument } from '../../../../services/print/printer.js';
import { openModal, closeModal } from '../../../components/modal.js';
import { ARCAService } from '../../../../integrations/arca/api.js';
import { addTabToView } from '../../../components/tabs.js';
import { getCurrentSucursal } from '../../../utils/auth.js';
import { Logger } from '../../../utils/logger.js';

// Constantes para tipos de libros e informes
const TIPO_LIBRO = {
    IVA_VENTAS: 'iva_ventas',
    IVA_COMPRAS: 'iva_compras',
    RETENCIONES: 'retenciones',
    PERCEPCIONES: 'percepciones'
};

class ReportesFiscales {
    constructor() {
        this.db = new Database();
        this.arcaService = new ARCAService();
        this.logger = new Logger('ReportesFiscales');
        this.currentSucursal = getCurrentSucursal();
        this.filters = {
            dateFrom: null,
            dateTo: null,
            tipoLibro: TIPO_LIBRO.IVA_VENTAS,
            incluirAnuladas: false,
            desgloseIVA: true,
            formatoExportacion: 'pdf'
        };
        
        // Inicializar elementos del DOM cuando se cargue la vista
        this.initDOMElements();
    }

    /**
     * Inicializa los elementos del DOM y configura los event listeners
     */
    initDOMElements() {
        // Verificar si el contenedor del reporte fiscal existe
        if (!document.getElementById('reportes-fiscales-container')) {
            return;
        }

        // Referencias a elementos del DOM
        this.dateFromEl = document.getElementById('fiscal-date-from');
        this.dateToEl = document.getElementById('fiscal-date-to');
        this.tipoLibroEl = document.getElementById('fiscal-tipo-libro');
        this.incluirAnuladasEl = document.getElementById('fiscal-incluir-anuladas');
        this.desgloseIVAEl = document.getElementById('fiscal-desglose-iva');
        this.formatoExportacionEl = document.getElementById('fiscal-formato-exportacion');
        this.generarReporteBtn = document.getElementById('generar-reporte-fiscal-btn');
        this.exportarReporteBtn = document.getElementById('exportar-reporte-fiscal-btn');
        this.exportarAfipBtn = document.getElementById('exportar-afip-btn');
        this.previewContainer = document.getElementById('reporte-fiscal-preview');
        
        // Configurar valores iniciales
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        
        this.dateFromEl.value = formatDate(firstDay, 'yyyy-MM-dd');
        this.dateToEl.value = formatDate(today, 'yyyy-MM-dd');
        
        // Configurar event listeners
        this.generarReporteBtn.addEventListener('click', () => this.generarReporte());
        this.exportarReporteBtn.addEventListener('click', () => this.exportarReporte());
        this.exportarAfipBtn.addEventListener('click', () => this.exportarParaAFIP());
        
        this.tipoLibroEl.addEventListener('change', () => {
            this.filters.tipoLibro = this.tipoLibroEl.value;
            this.updateUIBasedOnTipoLibro();
        });
        
        // Inicializar la interfaz
        this.updateUIBasedOnTipoLibro();
    }

    /**
     * Actualiza la interfaz según el tipo de libro seleccionado
     */
    updateUIBasedOnTipoLibro() {
        // Mostrar/ocultar opciones específicas según el tipo de libro
        const esLibroIVA = this.filters.tipoLibro === TIPO_LIBRO.IVA_VENTAS || 
                          this.filters.tipoLibro === TIPO_LIBRO.IVA_COMPRAS;
        
        if (this.desgloseIVAEl) {
            this.desgloseIVAEl.parentElement.style.display = esLibroIVA ? 'block' : 'none';
        }
        
        // Actualizar texto de los botones según el tipo
        if (this.generarReporteBtn) {
            this.generarReporteBtn.textContent = `Generar ${this.getTipoLibroText()}`;
        }
        
        if (this.exportarAfipBtn) {
            this.exportarAfipBtn.style.display = esLibroIVA ? 'inline-block' : 'none';
        }
    }

    /**
     * Obtiene el texto descriptivo del tipo de libro seleccionado
     * @returns {string} Texto descriptivo
     */
    getTipoLibroText() {
        switch (this.filters.tipoLibro) {
            case TIPO_LIBRO.IVA_VENTAS:
                return 'Libro IVA Ventas';
            case TIPO_LIBRO.IVA_COMPRAS:
                return 'Libro IVA Compras';
            case TIPO_LIBRO.RETENCIONES:
                return 'Informe de Retenciones';
            case TIPO_LIBRO.PERCEPCIONES:
                return 'Informe de Percepciones';
            default:
                return 'Reporte Fiscal';
        }
    }

    /**
     * Actualiza los filtros con los valores actuales de la UI
     */
    updateFilters() {
        this.filters.dateFrom = this.dateFromEl.value;
        this.filters.dateTo = this.dateToEl.value;
        this.filters.tipoLibro = this.tipoLibroEl.value;
        this.filters.incluirAnuladas = this.incluirAnuladasEl.checked;
        this.filters.desgloseIVA = this.desgloseIVAEl.checked;
        this.filters.formatoExportacion = this.formatoExportacionEl.value;
    }

    /**
     * Valida los filtros ingresados
     * @returns {boolean} True si los filtros son válidos
     */
    validateFilters() {
        // Validar rango de fechas
        if (!validateDateRange(this.filters.dateFrom, this.filters.dateTo)) {
            showNotification('La fecha desde debe ser anterior o igual a la fecha hasta', 'error');
            return false;
        }
        
        return true;
    }

    /**
     * Genera el reporte fiscal según los filtros configurados
     */
    async generarReporte() {
        try {
            // Actualizar filtros desde la UI
            this.updateFilters();
            
            // Validar filtros
            if (!this.validateFilters()) {
                return;
            }
            
            // Mostrar loader
            this.previewContainer.innerHTML = '<div class="loading">Generando reporte...</div>';
            
            // Obtener datos según el tipo de reporte
            let datos = [];
            let totales = {};
            
            switch (this.filters.tipoLibro) {
                case TIPO_LIBRO.IVA_VENTAS:
                    ({ datos, totales } = await this.getLibroIVAVentas());
                    break;
                case TIPO_LIBRO.IVA_COMPRAS:
                    ({ datos, totales } = await this.getLibroIVACompras());
                    break;
                case TIPO_LIBRO.RETENCIONES:
                    ({ datos, totales } = await this.getInformeRetenciones());
                    break;
                case TIPO_LIBRO.PERCEPCIONES:
                    ({ datos, totales } = await this.getInformePercepciones());
                    break;
            }
            
            // Renderizar el reporte
            this.renderReporte(datos, totales);
            
            // Habilitar botón de exportación
            this.exportarReporteBtn.disabled = false;
            
            // Log de la acción
            this.logger.log('info', `Reporte fiscal generado: ${this.getTipoLibroText()}`, {
                dateFrom: this.filters.dateFrom,
                dateTo: this.filters.dateTo,
                sucursal: this.currentSucursal.nombre
            });
            
        } catch (error) {
            console.error('Error al generar el reporte fiscal:', error);
            this.previewContainer.innerHTML = '<div class="error">Error al generar el reporte. Intente nuevamente.</div>';
            this.logger.log('error', 'Error al generar reporte fiscal', { error: error.message });
            showNotification('Error al generar el reporte fiscal', 'error');
        }
    }

    /**
     * Obtiene los datos para el Libro IVA Ventas
     * @returns {Object} Objeto con datos y totales
     */
    async getLibroIVAVentas() {
        const query = `
            SELECT 
                f.fecha, f.tipo_comprobante, f.punto_venta, f.numero, 
                c.razon_social, c.documento, c.tipo_documento, c.condicion_iva,
                f.total_neto, f.total_iva, f.total, f.anulada,
                json_extract(f.detalles_iva, '$') as detalles_iva
            FROM facturas f
            LEFT JOIN clientes c ON f.cliente_id = c.id
            WHERE f.fecha BETWEEN ? AND ?
                AND f.sucursal_id = ?
                ${this.filters.incluirAnuladas ? '' : 'AND f.anulada = 0'}
            ORDER BY f.fecha, f.tipo_comprobante, f.numero
        `;
        
        const params = [
            this.filters.dateFrom, 
            this.filters.dateTo, 
            this.currentSucursal.id
        ];
        
        const facturas = await this.db.all(query, params);
        
        // Procesar facturas para desgloses de IVA si es necesario
        let datos = facturas.map(factura => {
            // Convertir la cadena JSON a objeto si es necesario
            let detallesIVA = factura.detalles_iva;
            if (typeof detallesIVA === 'string') {
                try {
                    detallesIVA = JSON.parse(detallesIVA);
                } catch (e) {
                    detallesIVA = [];
                }
            }
            
            // Agregar campos procesados
            return {
                ...factura,
                detalles_iva: detallesIVA,
                fecha_formateada: formatDate(factura.fecha, 'dd/MM/yyyy'),
                comprobante: `${factura.tipo_comprobante} ${factura.punto_venta.toString().padStart(5, '0')}-${factura.numero.toString().padStart(8, '0')}`,
                total_formateado: formatCurrency(factura.total),
                total_neto_formateado: formatCurrency(factura.total_neto),
                total_iva_formateado: formatCurrency(factura.total_iva),
                anulada_texto: factura.anulada ? 'ANULADA' : ''
            };
        });
        
        // Calcular totales
        const totales = datos.reduce((acc, factura) => {
            // No contar anuladas para los totales
            if (factura.anulada) return acc;
            
            acc.total_neto += parseFloat(factura.total_neto || 0);
            acc.total_iva += parseFloat(factura.total_iva || 0);
            acc.total += parseFloat(factura.total || 0);
            
            // Procesar detalles de IVA si están disponibles
            if (Array.isArray(factura.detalles_iva)) {
                factura.detalles_iva.forEach(detalle => {
                    const tasa = detalle.tasa || detalle.porcentaje || 0;
                    const clave = `iva_${tasa}`;
                    
                    if (!acc.por_alicuota[clave]) {
                        acc.por_alicuota[clave] = {
                            tasa,
                            base: 0,
                            importe: 0
                        };
                    }
                    
                    acc.por_alicuota[clave].base += parseFloat(detalle.base_imponible || 0);
                    acc.por_alicuota[clave].importe += parseFloat(detalle.importe || 0);
                });
            }
            
            return acc;
        }, { 
            total_neto: 0, 
            total_iva: 0, 
            total: 0,
            por_alicuota: {}
        });
        
        // Formatear totales
        totales.total_neto_formateado = formatCurrency(totales.total_neto);
        totales.total_iva_formateado = formatCurrency(totales.total_iva);
        totales.total_formateado = formatCurrency(totales.total);
        
        // Formatear alícuotas
        Object.keys(totales.por_alicuota).forEach(key => {
            const alicuota = totales.por_alicuota[key];
            alicuota.base_formateada = formatCurrency(alicuota.base);
            alicuota.importe_formateado = formatCurrency(alicuota.importe);
        });
        
        return { datos, totales };
    }

    /**
     * Obtiene los datos para el Libro IVA Compras
     * @returns {Object} Objeto con datos y totales
     */
    async getLibroIVACompras() {
        const query = `
            SELECT 
                c.fecha, c.tipo_comprobante, c.punto_venta, c.numero, 
                p.razon_social, p.cuit, p.condicion_iva,
                c.total_neto, c.total_iva, c.total, c.anulada,
                json_extract(c.detalles_iva, '$') as detalles_iva
            FROM compras c
            LEFT JOIN proveedores p ON c.proveedor_id = p.id
            WHERE c.fecha BETWEEN ? AND ?
                AND c.sucursal_id = ?
                ${this.filters.incluirAnuladas ? '' : 'AND c.anulada = 0'}
            ORDER BY c.fecha, c.tipo_comprobante, c.numero
        `;
        
        const params = [
            this.filters.dateFrom, 
            this.filters.dateTo, 
            this.currentSucursal.id
        ];
        
        const compras = await this.db.all(query, params);
        
        // Procesar compras para desgloses de IVA si es necesario
        let datos = compras.map(compra => {
            // Convertir la cadena JSON a objeto si es necesario
            let detallesIVA = compra.detalles_iva;
            if (typeof detallesIVA === 'string') {
                try {
                    detallesIVA = JSON.parse(detallesIVA);
                } catch (e) {
                    detallesIVA = [];
                }
            }
            
            // Agregar campos procesados
            return {
                ...compra,
                detalles_iva: detallesIVA,
                fecha_formateada: formatDate(compra.fecha, 'dd/MM/yyyy'),
                comprobante: `${compra.tipo_comprobante} ${compra.punto_venta.toString().padStart(5, '0')}-${compra.numero.toString().padStart(8, '0')}`,
                total_formateado: formatCurrency(compra.total),
                total_neto_formateado: formatCurrency(compra.total_neto),
                total_iva_formateado: formatCurrency(compra.total_iva),
                anulada_texto: compra.anulada ? 'ANULADA' : ''
            };
        });
        
        // Calcular totales (similar a ventas pero adaptado para compras)
        const totales = datos.reduce((acc, compra) => {
            // No contar anuladas para los totales
            if (compra.anulada) return acc;
            
            acc.total_neto += parseFloat(compra.total_neto || 0);
            acc.total_iva += parseFloat(compra.total_iva || 0);
            acc.total += parseFloat(compra.total || 0);
            
            // Procesar detalles de IVA si están disponibles
            if (Array.isArray(compra.detalles_iva)) {
                compra.detalles_iva.forEach(detalle => {
                    const tasa = detalle.tasa || detalle.porcentaje || 0;
                    const clave = `iva_${tasa}`;
                    
                    if (!acc.por_alicuota[clave]) {
                        acc.por_alicuota[clave] = {
                            tasa,
                            base: 0,
                            importe: 0
                        };
                    }
                    
                    acc.por_alicuota[clave].base += parseFloat(detalle.base_imponible || 0);
                    acc.por_alicuota[clave].importe += parseFloat(detalle.importe || 0);
                });
            }
            
            return acc;
        }, { 
            total_neto: 0, 
            total_iva: 0, 
            total: 0,
            por_alicuota: {}
        });
        
        // Formatear totales
        totales.total_neto_formateado = formatCurrency(totales.total_neto);
        totales.total_iva_formateado = formatCurrency(totales.total_iva);
        totales.total_formateado = formatCurrency(totales.total);
        
        // Formatear alícuotas
        Object.keys(totales.por_alicuota).forEach(key => {
            const alicuota = totales.por_alicuota[key];
            alicuota.base_formateada = formatCurrency(alicuota.base);
            alicuota.importe_formateado = formatCurrency(alicuota.importe);
        });
        
        return { datos, totales };
    }

    /**
     * Obtiene los datos para el informe de retenciones
     * @returns {Object} Objeto con datos y totales
     */
    async getInformeRetenciones() {
        const query = `
            SELECT 
                r.fecha, r.tipo, r.numero_certificado,
                p.razon_social as retenido, p.cuit as cuit_retenido,
                r.base_imponible, r.importe, r.compra_id,
                c.tipo_comprobante, c.punto_venta, c.numero as numero_compra
            FROM retenciones r
            LEFT JOIN proveedores p ON r.proveedor_id = p.id
            LEFT JOIN compras c ON r.compra_id = c.id
            WHERE r.fecha BETWEEN ? AND ?
                AND r.sucursal_id = ?
            ORDER BY r.fecha, r.tipo
        `;
        
        const params = [
            this.filters.dateFrom, 
            this.filters.dateTo, 
            this.currentSucursal.id
        ];
        
        const retenciones = await this.db.all(query, params);
        
        // Procesar datos
        let datos = retenciones.map(retencion => {
            return {
                ...retencion,
                fecha_formateada: formatDate(retencion.fecha, 'dd/MM/yyyy'),
                comprobante_asociado: retencion.tipo_comprobante ? 
                    `${retencion.tipo_comprobante} ${retencion.punto_venta.toString().padStart(5, '0')}-${retencion.numero_compra.toString().padStart(8, '0')}` : 
                    'N/A',
                base_imponible_formateada: formatCurrency(retencion.base_imponible),
                importe_formateado: formatCurrency(retencion.importe)
            };
        });
        
        // Calcular totales
        const totales = datos.reduce((acc, retencion) => {
            acc.base_imponible += parseFloat(retencion.base_imponible || 0);
            acc.importe += parseFloat(retencion.importe || 0);
            
            // Agrupar por tipo de retención
            const tipo = retencion.tipo || 'SIN_TIPO';
            if (!acc.por_tipo[tipo]) {
                acc.por_tipo[tipo] = {
                    base_imponible: 0,
                    importe: 0
                };
            }
            
            acc.por_tipo[tipo].base_imponible += parseFloat(retencion.base_imponible || 0);
            acc.por_tipo[tipo].importe += parseFloat(retencion.importe || 0);
            
            return acc;
        }, { 
            base_imponible: 0, 
            importe: 0,
            por_tipo: {}
        });
        
        // Formatear totales
        totales.base_imponible_formateada = formatCurrency(totales.base_imponible);
        totales.importe_formateado = formatCurrency(totales.importe);
        
        // Formatear por tipo
        Object.keys(totales.por_tipo).forEach(tipo => {
            const datos = totales.por_tipo[tipo];
            datos.base_imponible_formateada = formatCurrency(datos.base_imponible);
            datos.importe_formateado = formatCurrency(datos.importe);
        });
        
        return { datos, totales };
    }

    /**
     * Obtiene los datos para el informe de percepciones
     * @returns {Object} Objeto con datos y totales
     */
    async getInformePercepciones() {
        const query = `
            SELECT 
                p.fecha, p.tipo, p.numero_certificado,
                c.razon_social as percibido, c.documento as cuit_percibido,
                p.base_imponible, p.importe, p.factura_id,
                f.tipo_comprobante, f.punto_venta, f.numero as numero_factura
            FROM percepciones p
            LEFT JOIN clientes c ON p.cliente_id = c.id
            LEFT JOIN facturas f ON p.factura_id = f.id
            WHERE p.fecha BETWEEN ? AND ?
                AND p.sucursal_id = ?
            ORDER BY p.fecha, p.tipo
        `;
        
        const params = [
            this.filters.dateFrom, 
            this.filters.dateTo, 
            this.currentSucursal.id
        ];
        
        const percepciones = await this.db.all(query, params);
        
        // Procesar datos
        let datos = percepciones.map(percepcion => {
            return {
                ...percepcion,
                fecha_formateada: formatDate(percepcion.fecha, 'dd/MM/yyyy'),
                comprobante_asociado: percepcion.tipo_comprobante ? 
                    `${percepcion.tipo_comprobante} ${percepcion.punto_venta.toString().padStart(5, '0')}-${percepcion.numero_factura.toString().padStart(8, '0')}` : 
                    'N/A',
                base_imponible_formateada: formatCurrency(percepcion.base_imponible),
                importe_formateado: formatCurrency(percepcion.importe)
            };
        });
        
        // Calcular totales (similar a retenciones)
        const totales = datos.reduce((acc, percepcion) => {
            acc.base_imponible += parseFloat(percepcion.base_imponible || 0);
            acc.importe += parseFloat(percepcion.importe || 0);
            
            // Agrupar por tipo de percepción
            const tipo = percepcion.tipo || 'SIN_TIPO';
            if (!acc.por_tipo[tipo]) {
                acc.por_tipo[tipo] = {
                    base_imponible: 0,
                    importe: 0
                };
            }
            
            acc.por_tipo[tipo].base_imponible += parseFloat(percepcion.base_imponible || 0);
            acc.por_tipo[tipo].importe += parseFloat(percepcion.importe || 0);
            
            return acc;
        }, { 
            base_imponible: 0, 
            importe: 0,
            por_tipo: {}
        });
        
        // Formatear totales
        totales.base_imponible_formateada = formatCurrency(totales.base_imponible);
        totales.importe_formateado = formatCurrency(totales.importe);
        
        // Formatear por tipo
        Object.keys(totales.por_tipo).forEach(tipo => {
            const datos = totales.por_tipo[tipo];
            datos.base_imponible_formateada = formatCurrency(datos.base_imponible);
            datos.importe_formateado = formatCurrency(datos.importe);
        });
        
        return { datos, totales };
    }

    /**
     * Renderiza el reporte en el contenedor de vista previa
     * @param {Array} datos Datos del reporte
     * @param {Object} totales Totales calculados
     */
    renderReporte(datos, totales) {
        // Limpiar contenedor
        this.previewContainer.innerHTML = '';
        
        // Crear contenedor del reporte
        const reporteContainer = document.createElement('div');
        reporteContainer.className = 'reporte-fiscal';
        
        // Agregar encabezado
        const header = document.createElement('div');
        header.className = 'reporte-header';
        header.innerHTML = `
            <h2>${this.getTipoLibroText()}</h2>
            <h3>${this.currentSucursal.nombre}</h3>
            <p>Período: ${formatDate(this.filters.dateFrom, 'dd/MM/yyyy')} al ${formatDate(this.filters.dateTo, 'dd/MM/yyyy')}</p>
        `;
        reporteContainer.appendChild(header);
        
        // Crear tabla según el tipo de reporte
        const table = document.createElement('table');
        table.className = 'reporte-table';
        
        // Renderizar según tipo de libro
        switch (this.filters.tipoLibro) {
            case TIPO_LIBRO.IVA_VENTAS:
                this.renderTablaLibroIVAVentas(table, datos, totales);
                break;
            case TIPO_LIBRO.IVA_COMPRAS:
                this.renderTablaLibroIVACompras(table, datos, totales);
                break;
            case TIPO_LIBRO.RETENCIONES:
                this.renderTablaRetenciones(table, datos, totales);
                break;
            case TIPO_LIBRO.PERCEPCIONES:
                this.renderTablaPercepciones(table, datos, totales);
                break;
        }
        
        reporteContainer.appendChild(table);
        
        // Agregar resumen de totales
        const resumen = document.createElement('div');
        resumen.className = 'reporte-resumen';
        
        switch (this.filters.tipoLibro) {
            case TIPO_LIBRO.IVA_VENTAS:
            case TIPO_LIBRO.IVA_COMPRAS:
                resumen.innerHTML = `
                    <h3>Resumen por Alícuotas</h3>
                    <table class="resumen-table">
                        <thead>
                            <tr>
                                <th>Alícuota</th>
                                <th>Base Imponible</th>
                                <th>Importe IVA</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${Object.entries(totales.por_alicuota).map(([key, alicuota]) => `
                                <tr>
                                    <td>${alicuota.tasa}%</td>
                                    <td class="text-right">${alicuota.base_formateada}</td>
                                    <td class="text-right">${alicuota.importe_formateado}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                        <tfoot>
                            <tr>
                                <th>Totales</th>
                                <th class="text-right">${totales.total_neto_formateado}</th>
                                <th class="text-right">${totales.total_iva_formateado}</th>
                            </tr>
                        </tfoot>
                    </table>
                    <div class="totales-finales">
                        <div class="total-item">
                            <span>Total Neto:</span>
                            <span>${totales.total_neto_formateado}</span>
                        </div>
                        <div class="total-item">
                            <span>Total IVA:</span>
                            <span>${totales.total_iva_formateado}</span>
                        </div>
                        <div class="total-item total-final">
                            <span>Total:</span>
                            <span>${totales.total_formateado}</span>
                        </div>
                    </div>
                `;
                break;
                
                case TIPO_LIBRO.RETENCIONES:
                    case TIPO_LIBRO.PERCEPCIONES:
                        const tipoTexto = this.filters.tipoLibro === TIPO_LIBRO.RETENCIONES ? 'Retenciones' : 'Percepciones';
                        resumen.innerHTML = `
                            <h3>Resumen por Tipo de ${tipoTexto}</h3>
                            <table class="resumen-table">
                                <thead>
                                    <tr>
                                        <th>Tipo</th>
                                        <th>Base Imponible</th>
                                        <th>Importe</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${Object.entries(totales.por_tipo).map(([tipo, datos]) => `
                                        <tr>
                                            <td>${tipo}</td>
                                            <td class="text-right">${datos.base_imponible_formateada}</td>
                                            <td class="text-right">${datos.importe_formateado}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                                <tfoot>
                                    <tr>
                                        <th>Totales</th>
                                        <th class="text-right">${totales.base_imponible_formateada}</th>
                                        <th class="text-right">${totales.importe_formateado}</th>
                                    </tr>
                                </tfoot>
                            </table>
                            <div class="totales-finales">
                                <div class="total-item">
                                    <span>Base Imponible Total:</span>
                                    <span>${totales.base_imponible_formateada}</span>
                                </div>
                                <div class="total-item total-final">
                                    <span>Importe Total:</span>
                                    <span>${totales.importe_formateado}</span>
                                </div>
                            </div>
                        `;
                        break;
                }
                
                reporteContainer.appendChild(resumen);
                
                // Agregar notas al pie
                const footer = document.createElement('div');
                footer.className = 'reporte-footer';
                footer.innerHTML = `
                    <p>Reporte generado el ${formatDate(new Date(), 'dd/MM/yyyy HH:mm')} por ${getCurrentUser().nombre}</p>
                    <p>Este reporte es para uso interno y no reemplaza las declaraciones oficiales en AFIP.</p>
                `;
                reporteContainer.appendChild(footer);
                
                // Agregar todo al contenedor principal
                this.previewContainer.appendChild(reporteContainer);
            }
        
            /**
             * Renderiza la tabla para el Libro IVA Ventas
             * @param {HTMLElement} table Elemento tabla
             * @param {Array} datos Datos del reporte
             * @param {Object} totales Totales calculados
             */
            renderTablaLibroIVAVentas(table, datos, totales) {
                const thead = document.createElement('thead');
                thead.innerHTML = `
                    <tr>
                        <th>Fecha</th>
                        <th>Comprobante</th>
                        <th>Cliente</th>
                        <th>CUIT/DNI</th>
                        <th>Cond. IVA</th>
                        <th>Neto Grav.</th>
                        ${this.filters.desgloseIVA ? '<th>IVA</th>' : ''}
                        <th>Total</th>
                        <th>Estado</th>
                    </tr>
                `;
                table.appendChild(thead);
                
                const tbody = document.createElement('tbody');
                datos.forEach(factura => {
                    const tr = document.createElement('tr');
                    tr.className = factura.anulada ? 'row-anulada' : '';
                    
                    tr.innerHTML = `
                        <td>${factura.fecha_formateada}</td>
                        <td>${factura.comprobante}</td>
                        <td>${factura.razon_social || 'Consumidor Final'}</td>
                        <td>${factura.documento || '-'}</td>
                        <td>${factura.condicion_iva || '-'}</td>
                        <td class="text-right">${factura.total_neto_formateado}</td>
                        ${this.filters.desgloseIVA ? `<td class="text-right">${factura.total_iva_formateado}</td>` : ''}
                        <td class="text-right">${factura.total_formateado}</td>
                        <td class="estado">${factura.anulada_texto}</td>
                    `;
                    
                    tbody.appendChild(tr);
                });
                table.appendChild(tbody);
                
                const tfoot = document.createElement('tfoot');
                tfoot.innerHTML = `
                    <tr>
                        <th colspan="5">Totales</th>
                        <th class="text-right">${totales.total_neto_formateado}</th>
                        ${this.filters.desgloseIVA ? `<th class="text-right">${totales.total_iva_formateado}</th>` : ''}
                        <th class="text-right">${totales.total_formateado}</th>
                        <th></th>
                    </tr>
                `;
                table.appendChild(tfoot);
            }
        
            /**
             * Renderiza la tabla para el Libro IVA Compras
             * @param {HTMLElement} table Elemento tabla
             * @param {Array} datos Datos del reporte
             * @param {Object} totales Totales calculados
             */
            renderTablaLibroIVACompras(table, datos, totales) {
                const thead = document.createElement('thead');
                thead.innerHTML = `
                    <tr>
                        <th>Fecha</th>
                        <th>Comprobante</th>
                        <th>Proveedor</th>
                        <th>CUIT</th>
                        <th>Cond. IVA</th>
                        <th>Neto Grav.</th>
                        ${this.filters.desgloseIVA ? '<th>IVA</th>' : ''}
                        <th>Total</th>
                        <th>Estado</th>
                    </tr>
                `;
                table.appendChild(thead);
                
                const tbody = document.createElement('tbody');
                datos.forEach(compra => {
                    const tr = document.createElement('tr');
                    tr.className = compra.anulada ? 'row-anulada' : '';
                    
                    tr.innerHTML = `
                        <td>${compra.fecha_formateada}</td>
                        <td>${compra.comprobante}</td>
                        <td>${compra.razon_social || '-'}</td>
                        <td>${compra.cuit || '-'}</td>
                        <td>${compra.condicion_iva || '-'}</td>
                        <td class="text-right">${compra.total_neto_formateado}</td>
                        ${this.filters.desgloseIVA ? `<td class="text-right">${compra.total_iva_formateado}</td>` : ''}
                        <td class="text-right">${compra.total_formateado}</td>
                        <td class="estado">${compra.anulada_texto}</td>
                    `;
                    
                    tbody.appendChild(tr);
                });
                table.appendChild(tbody);
                
                const tfoot = document.createElement('tfoot');
                tfoot.innerHTML = `
                    <tr>
                        <th colspan="5">Totales</th>
                        <th class="text-right">${totales.total_neto_formateado}</th>
                        ${this.filters.desgloseIVA ? `<th class="text-right">${totales.total_iva_formateado}</th>` : ''}
                        <th class="text-right">${totales.total_formateado}</th>
                        <th></th>
                    </tr>
                `;
                table.appendChild(tfoot);
            }
        
            /**
             * Renderiza la tabla para el Informe de Retenciones
             * @param {HTMLElement} table Elemento tabla
             * @param {Array} datos Datos del reporte
             * @param {Object} totales Totales calculados
             */
            renderTablaRetenciones(table, datos, totales) {
                const thead = document.createElement('thead');
                thead.innerHTML = `
                    <tr>
                        <th>Fecha</th>
                        <th>Tipo</th>
                        <th>Certificado</th>
                        <th>Proveedor</th>
                        <th>CUIT</th>
                        <th>Comprobante</th>
                        <th>Base Imp.</th>
                        <th>Importe</th>
                    </tr>
                `;
                table.appendChild(thead);
                
                const tbody = document.createElement('tbody');
                datos.forEach(retencion => {
                    const tr = document.createElement('tr');
                    
                    tr.innerHTML = `
                        <td>${retencion.fecha_formateada}</td>
                        <td>${retencion.tipo || '-'}</td>
                        <td>${retencion.numero_certificado || '-'}</td>
                        <td>${retencion.retenido || '-'}</td>
                        <td>${retencion.cuit_retenido || '-'}</td>
                        <td>${retencion.comprobante_asociado}</td>
                        <td class="text-right">${retencion.base_imponible_formateada}</td>
                        <td class="text-right">${retencion.importe_formateado}</td>
                    `;
                    
                    tbody.appendChild(tr);
                });
                table.appendChild(tbody);
                
                const tfoot = document.createElement('tfoot');
                tfoot.innerHTML = `
                    <tr>
                        <th colspan="6">Totales</th>
                        <th class="text-right">${totales.base_imponible_formateada}</th>
                        <th class="text-right">${totales.importe_formateado}</th>
                    </tr>
                `;
                table.appendChild(tfoot);
            }
        
            /**
             * Renderiza la tabla para el Informe de Percepciones
             * @param {HTMLElement} table Elemento tabla
             * @param {Array} datos Datos del reporte
             * @param {Object} totales Totales calculados
             */
            renderTablaPercepciones(table, datos, totales) {
                const thead = document.createElement('thead');
                thead.innerHTML = `
                    <tr>
                        <th>Fecha</th>
                        <th>Tipo</th>
                        <th>Certificado</th>
                        <th>Cliente</th>
                        <th>CUIT/DNI</th>
                        <th>Comprobante</th>
                        <th>Base Imp.</th>
                        <th>Importe</th>
                    </tr>
                `;
                table.appendChild(thead);
                
                const tbody = document.createElement('tbody');
                datos.forEach(percepcion => {
                    const tr = document.createElement('tr');
                    
                    tr.innerHTML = `
                        <td>${percepcion.fecha_formateada}</td>
                        <td>${percepcion.tipo || '-'}</td>
                        <td>${percepcion.numero_certificado || '-'}</td>
                        <td>${percepcion.percibido || '-'}</td>
                        <td>${percepcion.cuit_percibido || '-'}</td>
                        <td>${percepcion.comprobante_asociado}</td>
                        <td class="text-right">${percepcion.base_imponible_formateada}</td>
                        <td class="text-right">${percepcion.importe_formateado}</td>
                    `;
                    
                    tbody.appendChild(tr);
                });
                table.appendChild(tbody);
                
                const tfoot = document.createElement('tfoot');
                tfoot.innerHTML = `
                    <tr>
                        <th colspan="6">Totales</th>
                        <th class="text-right">${totales.base_imponible_formateada}</th>
                        <th class="text-right">${totales.importe_formateado}</th>
                    </tr>
                `;
                table.appendChild(tfoot);
            }
        
            /**
             * Exporta el reporte según el formato seleccionado
             */
            async exportarReporte() {
                try {
                    const nombreArchivo = `${this.getTipoLibroText().replace(/\s+/g, '_')}_${this.filters.dateFrom}_${this.filters.dateTo}`;
                    
                    switch (this.filters.formatoExportacion) {
                        case 'pdf':
                            await this.exportarPDF(nombreArchivo);
                            break;
                        case 'excel':
                            await this.exportarExcel(nombreArchivo);
                            break;
                        case 'txt':
                            await this.exportarTXT(nombreArchivo);
                            break;
                    }
                    
                    this.logger.log('info', `Reporte fiscal exportado: ${nombreArchivo}.${this.filters.formatoExportacion}`, {
                        tipo: this.filters.tipoLibro,
                        formato: this.filters.formatoExportacion
                    });
                    
                    showNotification(`Reporte exportado exitosamente como ${nombreArchivo}.${this.filters.formatoExportacion}`, 'success');
                } catch (error) {
                    console.error('Error al exportar el reporte:', error);
                    this.logger.log('error', 'Error al exportar reporte fiscal', { error: error.message });
                    showNotification('Error al exportar el reporte', 'error');
                }
            }
        
            /**
             * Exporta el reporte a formato PDF
             * @param {string} nombreArchivo Nombre del archivo sin extensión
             */
            async exportarPDF(nombreArchivo) {
                // Obtener el contenido HTML del reporte
                const reporteHTML = this.previewContainer.innerHTML;
                
                // Obtener el estilo CSS necesario
                const stylesheets = Array.from(document.styleSheets)
                    .filter(sheet => sheet.href && (sheet.href.includes('main.css') || sheet.href.includes('reportes.css')));
                
                let css = '';
                for (const sheet of stylesheets) {
                    try {
                        const rules = Array.from(sheet.cssRules || sheet.rules);
                        css += rules.map(rule => rule.cssText).join('\n');
                    } catch (e) {
                        console.warn('No se pudo acceder a reglas CSS:', e);
                    }
                }
                
                // Crear contenido HTML completo
                const contenidoCompleto = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <title>${this.getTipoLibroText()}</title>
                        <style>
                            @page {
                                margin: 1cm;
                            }
                            body {
                                font-family: Arial, sans-serif;
                                font-size: 10pt;
                            }
                            table {
                                width: 100%;
                                border-collapse: collapse;
                                margin-bottom: 15px;
                            }
                            th, td {
                                border: 1px solid #ddd;
                                padding: 4px 6px;
                            }
                            th {
                                background-color: #f2f2f2;
                            }
                            .text-right {
                                text-align: right;
                            }
                            .row-anulada {
                                background-color: #ffeeee;
                                text-decoration: line-through;
                                color: #888;
                            }
                            .reporte-header {
                                margin-bottom: 20px;
                            }
                            .reporte-header h2 {
                                margin: 0;
                                color: #333;
                            }
                            .reporte-header h3 {
                                margin: 5px 0;
                                color: #555;
                            }
                            .reporte-footer {
                                margin-top: 20px;
                                font-size: 8pt;
                                color: #777;
                                border-top: 1px solid #ddd;
                                padding-top: 10px;
                            }
                            .totales-finales {
                                margin-top: 15px;
                            }
                            .total-item {
                                display: flex;
                                justify-content: space-between;
                                margin: 5px 0;
                            }
                            .total-final {
                                font-weight: bold;
                                font-size: 12pt;
                                border-top: 1px solid #ddd;
                                padding-top: 5px;
                            }
                            ${css}
                        </style>
                    </head>
                    <body>
                        ${reporteHTML}
                    </body>
                    </html>
                `;
                
                // Usar el servicio de exportación a PDF
                await exportToPDF(contenidoCompleto, `${nombreArchivo}.pdf`);
            }
        
            /**
             * Exporta el reporte a formato Excel
             * @param {string} nombreArchivo Nombre del archivo sin extensión
             */
            async exportarExcel(nombreArchivo) {
                // Preparar datos para exportación según tipo de libro
                let datos = [];
                let encabezados = [];
                
                switch (this.filters.tipoLibro) {
                    case TIPO_LIBRO.IVA_VENTAS:
                        ({ datos, encabezados } = await this.prepararDatosExcelIVAVentas());
                        break;
                    case TIPO_LIBRO.IVA_COMPRAS:
                        ({ datos, encabezados } = await this.prepararDatosExcelIVACompras());
                        break;
                    case TIPO_LIBRO.RETENCIONES:
                        ({ datos, encabezados } = await this.prepararDatosExcelRetenciones());
                        break;
                    case TIPO_LIBRO.PERCEPCIONES:
                        ({ datos, encabezados } = await this.prepararDatosExcelPercepciones());
                        break;
                }
                
                // Utilizar el módulo exportExcel que debe ser implementado en utils
                const { exportToExcel } = await import('../../../utils/exportExcel.js');
                await exportToExcel(datos, encabezados, nombreArchivo);
            }
        
            /**
             * Prepara los datos para exportación a Excel para Libro IVA Ventas
             * @returns {Object} Objeto con datos y encabezados
             */
            async prepararDatosExcelIVAVentas() {
                const { datos } = await this.getLibroIVAVentas();
                
                const encabezados = [
                    'Fecha', 'Tipo', 'Punto Venta', 'Número', 'Cliente', 
                    'CUIT/DNI', 'Condición IVA', 'Neto Gravado', 'IVA', 'Total', 'Anulada'
                ];
                
                // Convertir los datos al formato requerido para Excel
                const datosExcel = datos.map(factura => [
                    factura.fecha,
                    factura.tipo_comprobante,
                    factura.punto_venta,
                    factura.numero,
                    factura.razon_social || 'Consumidor Final',
                    factura.documento || '',
                    factura.condicion_iva || '',
                    parseFloat(factura.total_neto || 0),
                    parseFloat(factura.total_iva || 0),
                    parseFloat(factura.total || 0),
                    factura.anulada ? 'SI' : 'NO'
                ]);
                
                return { datos: datosExcel, encabezados };
            }
        
            /**
             * Prepara los datos para exportación a Excel para Libro IVA Compras
             * @returns {Object} Objeto con datos y encabezados
             */
            async prepararDatosExcelIVACompras() {
                const { datos } = await this.getLibroIVACompras();
                
                const encabezados = [
                    'Fecha', 'Tipo', 'Punto Venta', 'Número', 'Proveedor', 
                    'CUIT', 'Condición IVA', 'Neto Gravado', 'IVA', 'Total', 'Anulada'
                ];
                
                // Convertir los datos al formato requerido para Excel
                const datosExcel = datos.map(compra => [
                    compra.fecha,
                    compra.tipo_comprobante,
                    compra.punto_venta,
                    compra.numero,
                    compra.razon_social || '',
                    compra.cuit || '',
                    compra.condicion_iva || '',
                    parseFloat(compra.total_neto || 0),
                    parseFloat(compra.total_iva || 0),
                    parseFloat(compra.total || 0),
                    compra.anulada ? 'SI' : 'NO'
                ]);
                
                return { datos: datosExcel, encabezados };
            }
        
            /**
             * Prepara los datos para exportación a Excel para Informe de Retenciones
             * @returns {Object} Objeto con datos y encabezados
             */
            async prepararDatosExcelRetenciones() {
                const { datos } = await this.getInformeRetenciones();
                
                const encabezados = [
                    'Fecha', 'Tipo', 'Número Certificado', 'Proveedor', 'CUIT', 
                    'Comprobante Asociado', 'Base Imponible', 'Importe'
                ];
                
                // Convertir los datos al formato requerido para Excel
                const datosExcel = datos.map(retencion => [
                    retencion.fecha,
                    retencion.tipo || '',
                    retencion.numero_certificado || '',
                    retencion.retenido || '',
                    retencion.cuit_retenido || '',
                    retencion.comprobante_asociado,
                    parseFloat(retencion.base_imponible || 0),
                    parseFloat(retencion.importe || 0)
                ]);
                
                return { datos: datosExcel, encabezados };
            }
        
            /**
             * Prepara los datos para exportación a Excel para Informe de Percepciones
             * @returns {Object} Objeto con datos y encabezados
             */
            async prepararDatosExcelPercepciones() {
                const { datos } = await this.getInformePercepciones();
                
                const encabezados = [
                    'Fecha', 'Tipo', 'Número Certificado', 'Cliente', 'CUIT/DNI', 
                    'Comprobante Asociado', 'Base Imponible', 'Importe'
                ];
                
                // Convertir los datos al formato requerido para Excel
                const datosExcel = datos.map(percepcion => [
                    percepcion.fecha,
                    percepcion.tipo || '',
                    percepcion.numero_certificado || '',
                    percepcion.percibido || '',
                    percepcion.cuit_percibido || '',
                    percepcion.comprobante_asociado,
                    parseFloat(percepcion.base_imponible || 0),
                    parseFloat(percepcion.importe || 0)
                ]);
                
                return { datos: datosExcel, encabezados };
            }
        
            /**
             * Exporta el reporte a formato TXT (para importación en sistemas contables)
             * @param {string} nombreArchivo Nombre del archivo sin extensión
             */
            async exportarTXT(nombreArchivo) {
                let contenido = '';
                
                switch (this.filters.tipoLibro) {
                    case TIPO_LIBRO.IVA_VENTAS:
                        contenido = await this.generarTXTIVAVentas();
                        break;
                    case TIPO_LIBRO.IVA_COMPRAS:
                        contenido = await this.generarTXTIVACompras();
                        break;
                    case TIPO_LIBRO.RETENCIONES:
                        contenido = await this.generarTXTRetenciones();
                        break;
                    case TIPO_LIBRO.PERCEPCIONES:
                        contenido = await this.generarTXTPercepciones();
                        break;
                }
                
                // Crear y descargar el archivo TXT
                const blob = new Blob([contenido], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                
                const a = document.createElement('a');
                a.href = url;
                a.download = `${nombreArchivo}.txt`;
                document.body.appendChild(a);
                a.click();
                
                // Limpiar
                setTimeout(() => {
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                }, 0);
            }
        
            /**
             * Genera contenido TXT para Libro IVA Ventas
             * @returns {string} Contenido del archivo TXT
             */
            async generarTXTIVAVentas() {
                const { datos } = await this.getLibroIVAVentas();
                
                // Formato: Fecha|Tipo|PtoVta|Numero|CUIT|RazonSocial|Neto|IVA|Total
                let contenido = datos
                    .filter(factura => !factura.anulada) // Excluir anuladas
                    .map(factura => {
                        const fecha = formatDate(factura.fecha, 'yyyyMMdd');
                        const ptoVta = factura.punto_venta.toString().padStart(5, '0');
                        const numero = factura.numero.toString().padStart(8, '0');
                        const cuit = (factura.documento || '').replace(/\D/g, '').padStart(11, '0');
                        const razonSocial = (factura.razon_social || 'Consumidor Final').replace(/\|/g, ' ');
                        const neto = parseFloat(factura.total_neto || 0).toFixed(2);
                        const iva = parseFloat(factura.total_iva || 0).toFixed(2);
                        const total = parseFloat(factura.total || 0).toFixed(2);
                        
                        return `${fecha}|${factura.tipo_comprobante}|${ptoVta}|${numero}|${cuit}|${razonSocial}|${neto}|${iva}|${total}`;
                    })
                    .join('\r\n');
                
                return contenido;
            }
        
            /**
             * Genera contenido TXT para Libro IVA Compras
             * @returns {string} Contenido del archivo TXT
             */
            async generarTXTIVACompras() {
                const { datos } = await this.getLibroIVACompras();
                
                // Formato: Fecha|Tipo|PtoVta|Numero|CUIT|RazonSocial|Neto|IVA|Total
                let contenido = datos
                    .filter(compra => !compra.anulada) // Excluir anuladas
                    .map(compra => {
                        const fecha = formatDate(compra.fecha, 'yyyyMMdd');
                        const ptoVta = compra.punto_venta.toString().padStart(5, '0');
                        const numero = compra.numero.toString().padStart(8, '0');
                        const cuit = (compra.cuit || '').replace(/\D/g, '').padStart(11, '0');
                        const razonSocial = (compra.razon_social || '').replace(/\|/g, ' ');
                        const neto = parseFloat(compra.total_neto || 0).toFixed(2);
                        const iva = parseFloat(compra.total_iva || 0).toFixed(2);
                        const total = parseFloat(compra.total || 0).toFixed(2);
                        
                        return `${fecha}|${compra.tipo_comprobante}|${ptoVta}|${numero}|${cuit}|${razonSocial}|${neto}|${iva}|${total}`;
                    })
                    .join('\r\n');
                
                return contenido;
            }
        
            /**
             * Genera contenido TXT para Informe de Retenciones
             * @returns {string} Contenido del archivo TXT
             */
            async generarTXTRetenciones() {
                const { datos } = await this.getInformeRetenciones();
                
                // Formato: Fecha|Tipo|NroCertificado|CUIT|RazonSocial|BaseImponible|Importe
                let contenido = datos.map(retencion => {
                    const fecha = formatDate(retencion.fecha, 'yyyyMMdd');
                    const nroCertificado = (retencion.numero_certificado || '').padStart(12, '0');
                    const cuit = (retencion.cuit_retenido || '').replace(/\D/g, '').padStart(11, '0');
                    const razonSocial = (retencion.retenido || '').replace(/\|/g, ' ');
                    const baseImponible = parseFloat(retencion.base_imponible || 0).toFixed(2);
                    const importe = parseFloat(retencion.importe || 0).toFixed(2);
                    
                    return `${fecha}|${retencion.tipo || ''}|${nroCertificado}|${cuit}|${razonSocial}|${baseImponible}|${importe}`;
                }).join('\r\n');
                
                return contenido;
            }
        
            /**
             * Genera contenido TXT para Informe de Percepciones
             * @returns {string} Contenido del archivo TXT
             */
            async generarTXTPercepciones() {
                const { datos } = await this.getInformePercepciones();
                
                // Formato: Fecha|Tipo|NroCertificado|CUIT|RazonSocial|BaseImponible|Importe
                let contenido = datos.map(percepcion => {
                    const fecha = formatDate(percepcion.fecha, 'yyyyMMdd');
                    const nroCertificado = (percepcion.numero_certificado || '').padStart(12, '0');
                    const cuit = (percepcion.cuit_percibido || '').replace(/\D/g, '').padStart(11, '0');
                    const razonSocial = (percepcion.percibido || '').replace(/\|/g, ' ');
                    const baseImponible = parseFloat(percepcion.base_imponible || 0).toFixed(2);
                    const importe = parseFloat(percepcion.importe || 0).toFixed(2);
                    
                    return `${fecha}|${percepcion.tipo || ''}|${nroCertificado}|${cuit}|${razonSocial}|${baseImponible}|${importe}`;
                }).join('\r\n');
                
                return contenido;
            }
        }
            
