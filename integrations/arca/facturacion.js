/**
 * @file facturacion.js
 * @description Módulo para integración con ARCA (Facturación Electrónica AFIP)
 * 
 * Este módulo maneja la comunicación con el servicio de ARCA para:
 * - Generar comprobantes electrónicos (Facturas A/B/C, Notas de Crédito/Débito)
 * - Consultar estado de comprobantes
 * - Obtener datos fiscales de un CUIT/DNI
 * - Manejar errores de comunicación con AFIP
 */

const { ipcRenderer } = require('electron');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const logger = require('../../services/audit/logger.js');
const api = require('./api.js');
const { getConfiguracion } = require('../../app/assets/js/modules/configuraciones/empresa.js');

// Definición de constantes para tipos de comprobantes
const TIPOS_COMPROBANTE = {
    FACTURA_A: 1,
    FACTURA_B: 6,
    FACTURA_C: 11,
    NOTA_CREDITO_A: 3,
    NOTA_CREDITO_B: 8,
    NOTA_CREDITO_C: 13,
    NOTA_DEBITO_A: 2,
    NOTA_DEBITO_B: 7,
    NOTA_DEBITO_C: 12,
};

// Definición de constantes para tipos de conceptos
const TIPOS_CONCEPTO = {
    PRODUCTOS: 1,
    SERVICIOS: 2,
    PRODUCTOS_Y_SERVICIOS: 3
};

// Definición de constantes para códigos de IVA
const ALICUOTAS_IVA = {
    '0': 3, // 0%
    '10.5': 4, // 10.5%
    '21': 5, // 21%
    '27': 6 // 27%
};

/**
 * Formatea un objeto de datos para adaptarlo al formato esperado por ARCA
 * @param {Object} datos - Datos de la factura a enviar
 * @returns {Object} - Datos formateados según formato ARCA
 */
function formatearDatosParaARCA(datos) {
    try {
        // Extraer los datos relevantes
        const {
            tipoComprobante,
            puntoVenta,
            cliente,
            productos,
            fechaEmision,
            conceptos,
            metodoPago,
            importeTotal,
            importeNeto,
            importeIVA,
            descuentoRecargo
        } = datos;

        // Obtener condición frente a IVA del cliente
        const condicionIVA = cliente.condicionIVA || 'ConsumidorFinal';
        
        // Mapear tipo de documento según condición del cliente
        let tipoDocumento = 96; // DNI por defecto
        if (cliente.cuit && cliente.cuit.length === 11) {
            tipoDocumento = 80; // CUIT
        }

        // Determinar tipo de comprobante según condición IVA del cliente
        let tipoComprobanteARCA;
        switch (tipoComprobante) {
            case 'A':
                tipoComprobanteARCA = TIPOS_COMPROBANTE.FACTURA_A;
                break;
            case 'B':
                tipoComprobanteARCA = TIPOS_COMPROBANTE.FACTURA_B;
                break;
            case 'C':
                tipoComprobanteARCA = TIPOS_COMPROBANTE.FACTURA_C;
                break;
            default:
                tipoComprobanteARCA = TIPOS_COMPROBANTE.FACTURA_B;
        }
        
        // Preparar los items (productos) para ARCA
        const items = productos.map((producto, index) => {
            // Determinando alícuota IVA para este producto
            const alicuotaIVA = producto.alicuotaIVA || 21;
            const codigoIVA = ALICUOTAS_IVA[String(alicuotaIVA)] || ALICUOTAS_IVA['21'];
            
            return {
                producto: {
                    descripcion: producto.nombre,
                    codigo: producto.codigo || String(index + 1),
                    unidad: producto.unidad || 'unidades'
                },
                cantidad: producto.cantidad,
                precio_unitario: producto.precioUnitario,
                bonificacion: producto.descuento || 0,
                subtotal: producto.subtotal,
                alicuota: codigoIVA
            };
        });

        // Preparar objeto de datos para ARCA
        const datosARCA = {
            comprobante: {
                tipo: tipoComprobanteARCA,
                punto_venta: Number(puntoVenta),
                concepto: conceptos?.tipo || TIPOS_CONCEPTO.PRODUCTOS,
                fecha_emision: fechaEmision || new Date().toISOString().split('T')[0]
            },
            cliente: {
                tipo_documento: tipoDocumento,
                documento: cliente.cuit || cliente.dni || '0',
                nombre: cliente.razonSocial || `${cliente.nombre || ''} ${cliente.apellido || ''}`.trim(),
                domicilio: cliente.direccion || '',
                condicion_iva: mapearCondicionIVA(condicionIVA),
                email: cliente.email || ''
            },
            items: items,
            importes: {
                neto_gravado: importeNeto,
                iva: importeIVA,
                total: importeTotal
            },
            metodo_pago: metodoPago || 'EFECTIVO',
            // Si hay descuento o recargo global
            ...(descuentoRecargo && {
                descuento_global: descuentoRecargo < 0 ? Math.abs(descuentoRecargo) : 0,
                recargo_global: descuentoRecargo > 0 ? descuentoRecargo : 0
            })
        };

        return datosARCA;
    } catch (error) {
        logger.error(`Error al formatear datos para ARCA: ${error.message}`, { error });
        throw new Error(`Error al formatear datos para ARCA: ${error.message}`);
    }
}

/**
 * Mapea la condición frente al IVA al formato que espera ARCA
 * @param {string} condicion - Condición IVA del cliente
 * @returns {number} - Código de condición IVA para ARCA
 */
function mapearCondicionIVA(condicion) {
    const mapa = {
        'ResponsableInscripto': 1,
        'Monotributista': 4,
        'ExentoIVA': 3,
        'ConsumidorFinal': 5,
        'ResponsableNoInscripto': 2,
        'NoAlcanzado': 7,
        'SujetoNoCategorizado': 0
    };
    
    return mapa[condicion] || 5; // 5 = Consumidor Final por defecto
}

/**
 * Genera un comprobante electrónico utilizando ARCA
 * @param {Object} datosFactura - Datos de la factura a generar
 * @returns {Promise<Object>} - Resultado de la operación con CAE y datos del comprobante
 */
async function generarComprobante(datosFactura) {
    try {
        logger.info('Iniciando generación de comprobante electrónico', { datos: datosFactura });
        
        // Obtener configuración de ARCA
        const configuracion = await getConfiguracion('arca');
        if (!configuracion || !configuracion.apiKey) {
            throw new Error('No se encontró la configuración de ARCA o falta la API Key');
        }
        
        // Formatear datos para ARCA
        const datosFormateados = formatearDatosParaARCA(datosFactura);
        
        // Enviar solicitud a ARCA
        const respuesta = await api.enviarFactura(datosFormateados, configuracion);
        
        // Si hay error en la respuesta de ARCA
        if (respuesta.error) {
            logger.error('Error al generar comprobante en ARCA', { 
                error: respuesta.error,
                codigoError: respuesta.codigo || 'desconocido'
            });
            throw new Error(`Error al generar comprobante en ARCA: ${respuesta.error}`);
        }
        
        // Formatear y guardar respuesta
        const resultado = {
            success: true,
            cae: respuesta.cae,
            fechaVencimientoCAE: respuesta.fechaVencimiento,
            numeroComprobante: respuesta.numeroComprobante,
            codigoBarras: respuesta.codigoBarras,
            fechaEmision: respuesta.fechaEmision || datosFactura.fechaEmision,
            comprobanteUrl: respuesta.pdfUrl || null,
            datosOriginales: datosFactura,
            respuestaAFIP: respuesta.datosAFIP || {}
        };
        
        // Guardar registro de la operación
        await guardarRegistroComprobante(resultado);
        
        logger.info('Comprobante electrónico generado exitosamente', { resultado });
        return resultado;
    } catch (error) {
        logger.error(`Error al generar comprobante electrónico: ${error.message}`, { error });
        
        // Determinar si es un error de conectividad
        const esErrorConexion = error.message.includes('ECONNREFUSED') || 
                               error.message.includes('timeout') ||
                               error.message.includes('Network Error');
        
        return {
            success: false,
            error: error.message,
            esErrorConexion,
            datosOriginales: datosFactura
        };
    }
}

/**
 * Guarda un registro del comprobante generado
 * @param {Object} datosComprobante - Datos del comprobante generado
 * @returns {Promise<void>}
 */
async function guardarRegistroComprobante(datosComprobante) {
    try {
        // Obtener directorio de datos de la aplicación
        const dataPath = ipcRenderer.sendSync('get-app-data-path');
        const directorioRegistros = path.join(dataPath, 'registros', 'comprobantes');
        
        // Crear directorio si no existe
        if (!fs.existsSync(directorioRegistros)) {
            fs.mkdirSync(directorioRegistros, { recursive: true });
        }
        
        // Crear nombre de archivo con fecha y número de comprobante
        const fechaActual = new Date().toISOString().replace(/:/g, '-').split('.')[0];
        const nombreArchivo = `comprobante_${datosComprobante.numeroComprobante}_${fechaActual}.json`;
        
        // Guardar datos en archivo JSON
        const rutaArchivo = path.join(directorioRegistros, nombreArchivo);
        fs.writeFileSync(rutaArchivo, JSON.stringify(datosComprobante, null, 2));
        
        logger.info(`Registro de comprobante guardado: ${rutaArchivo}`);
    } catch (error) {
        logger.error(`Error al guardar registro de comprobante: ${error.message}`, { error });
        // No lanzamos excepción para no interrumpir el flujo principal
    }
}

/**
 * Consulta un comprobante existente por tipo, punto de venta y número
 * @param {number} tipo - Tipo de comprobante según AFIP
 * @param {number} puntoVenta - Punto de venta
 * @param {number} numero - Número de comprobante
 * @returns {Promise<Object>} - Datos del comprobante consultado
 */
async function consultarComprobante(tipo, puntoVenta, numero) {
    try {
        logger.info('Consultando comprobante existente', { tipo, puntoVenta, numero });
        
        // Obtener configuración de ARCA
        const configuracion = await getConfiguracion('arca');
        if (!configuracion || !configuracion.apiKey) {
            throw new Error('No se encontró la configuración de ARCA o falta la API Key');
        }
        
        // Enviar consulta a ARCA
        const respuesta = await api.consultarComprobante(tipo, puntoVenta, numero, configuracion);
        
        if (respuesta.error) {
            logger.error('Error al consultar comprobante en ARCA', { 
                error: respuesta.error,
                datos: { tipo, puntoVenta, numero }
            });
            throw new Error(`Error al consultar comprobante: ${respuesta.error}`);
        }
        
        return {
            success: true,
            comprobante: respuesta.comprobante,
            estado: respuesta.estado
        };
    } catch (error) {
        logger.error(`Error al consultar comprobante: ${error.message}`, { error });
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Consulta datos fiscales de un contribuyente por CUIT
 * @param {string} cuit - CUIT a consultar
 * @returns {Promise<Object>} - Datos fiscales del contribuyente
 */
async function consultarDatosFiscales(cuit) {
    try {
        logger.info('Consultando datos fiscales', { cuit });
        
        // Validar formato del CUIT
        if (!validarCUIT(cuit)) {
            throw new Error('Formato de CUIT inválido');
        }
        
        // Obtener configuración de ARCA
        const configuracion = await getConfiguracion('arca');
        if (!configuracion || !configuracion.apiKey) {
            throw new Error('No se encontró la configuración de ARCA o falta la API Key');
        }
        
        // Enviar consulta a ARCA
        const respuesta = await api.consultarDatosFiscales(cuit, configuracion);
        
        if (respuesta.error) {
            logger.error('Error al consultar datos fiscales en ARCA', { 
                error: respuesta.error,
                cuit
            });
            throw new Error(`Error al consultar datos fiscales: ${respuesta.error}`);
        }
        
        return {
            success: true,
            datos: {
                razonSocial: respuesta.razonSocial,
                condicionIVA: mapearCondicionIVAInverso(respuesta.condicionIVA),
                domicilio: respuesta.domicilio,
                condicionIVACodigo: respuesta.condicionIVA
            }
        };
    } catch (error) {
        logger.error(`Error al consultar datos fiscales: ${error.message}`, { error, cuit });
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Mapea el código de condición IVA de AFIP a texto legible
 * @param {number} codigo - Código de condición IVA
 * @returns {string} - Texto de condición IVA
 */
function mapearCondicionIVAInverso(codigo) {
    const mapa = {
        1: 'ResponsableInscripto',
        2: 'ResponsableNoInscripto',
        3: 'ExentoIVA',
        4: 'Monotributista',
        5: 'ConsumidorFinal',
        6: 'SujetoNoCategorizado',
        7: 'NoAlcanzado',
        8: 'ImportadorServicio',
        9: 'ClienteExterior',
        10: 'IVALiberado'
    };
    
    return mapa[codigo] || 'Desconocido';
}

/**
 * Valida el formato y dígito verificador de un CUIT
 * @param {string} cuit - CUIT a validar
 * @returns {boolean} - true si el CUIT es válido
 */
function validarCUIT(cuit) {
    if (!cuit) return false;
    
    // Eliminar guiones y espacios
    cuit = cuit.replace(/[-\s]/g, '');
    
    // Verificar longitud
    if (cuit.length !== 11) return false;
    
    // Verificar que sean solo dígitos
    if (!/^\d+$/.test(cuit)) return false;
    
    // Validar dígito verificador
    const factores = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    let suma = 0;
    
    for (let i = 0; i < 10; i++) {
        suma += parseInt(cuit.charAt(i)) * factores[i];
    }
    
    const resto = suma % 11;
    const digitoVerificador = 11 - resto;
    
    // Si el dígito verificador es 11, debe ser 0
    const dv = digitoVerificador === 11 ? 0 : digitoVerificador;
    
    return dv === parseInt(cuit.charAt(10));
}

/**
 * Genera una nota de crédito o débito electrónica
 * @param {Object} datosNota - Datos de la nota a generar
 * @param {Object} facturaOriginal - Datos de la factura original
 * @returns {Promise<Object>} - Resultado de la operación
 */
async function generarNota(datosNota, facturaOriginal) {
    try {
        logger.info('Iniciando generación de nota de crédito/débito', { datos: datosNota });
        
        // Determinar tipo de comprobante (crédito o débito)
        const tipoFacturaOriginal = facturaOriginal.tipoComprobante;
        const esCredito = datosNota.tipoNota === 'credito';
        
        let tipoComprobanteNota;
        
        // Determinar el tipo de comprobante para la nota según el tipo de factura original
        if (tipoFacturaOriginal === 'A') {
            tipoComprobanteNota = esCredito ? TIPOS_COMPROBANTE.NOTA_CREDITO_A : TIPOS_COMPROBANTE.NOTA_DEBITO_A;
        } else if (tipoFacturaOriginal === 'B') {
            tipoComprobanteNota = esCredito ? TIPOS_COMPROBANTE.NOTA_CREDITO_B : TIPOS_COMPROBANTE.NOTA_DEBITO_B;
        } else {
            tipoComprobanteNota = esCredito ? TIPOS_COMPROBANTE.NOTA_CREDITO_C : TIPOS_COMPROBANTE.NOTA_DEBITO_C;
        }
        
        // Crear estructura de datos similar a la factura pero con los datos de la nota
        const datosCompletoNota = {
            ...datosNota,
            tipoComprobante: tipoComprobanteNota,
            // Agregar referencia a la factura original
            comprobanteAsociado: {
                tipo: facturaOriginal.tipoComprobante === 'A' ? TIPOS_COMPROBANTE.FACTURA_A : 
                     (facturaOriginal.tipoComprobante === 'B' ? TIPOS_COMPROBANTE.FACTURA_B : TIPOS_COMPROBANTE.FACTURA_C),
                puntoVenta: facturaOriginal.puntoVenta,
                numero: facturaOriginal.numeroComprobante
            }
        };
        
        // Generar el comprobante usando la misma función de facturación
        return await generarComprobante(datosCompletoNota);
    } catch (error) {
        logger.error(`Error al generar nota de crédito/débito: ${error.message}`, { error });
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Obtiene el último número de comprobante para un tipo y punto de venta
 * @param {number} tipo - Tipo de comprobante según AFIP
 * @param {number} puntoVenta - Punto de venta
 * @returns {Promise<Object>} - Último número de comprobante
 */
async function obtenerUltimoNumeroComprobante(tipo, puntoVenta) {
    try {
        logger.info('Consultando último número de comprobante', { tipo, puntoVenta });
        
        // Obtener configuración de ARCA
        const configuracion = await getConfiguracion('arca');
        if (!configuracion || !configuracion.apiKey) {
            throw new Error('No se encontró la configuración de ARCA o falta la API Key');
        }
        
        // Enviar consulta a ARCA
        const respuesta = await api.obtenerUltimoComprobante(tipo, puntoVenta, configuracion);
        
        if (respuesta.error) {
            logger.error('Error al consultar último número en ARCA', { 
                error: respuesta.error,
                datos: { tipo, puntoVenta }
            });
            throw new Error(`Error al consultar último número: ${respuesta.error}`);
        }
        
        return {
            success: true,
            ultimoNumero: respuesta.numero
        };
    } catch (error) {
        logger.error(`Error al obtener último número de comprobante: ${error.message}`, { error });
        return {
            success: false,
            error: error.message,
            ultimoNumero: 0
        };
    }
}

/**
 * Verifica el estado de conexión con AFIP a través de ARCA
 * @returns {Promise<Object>} - Estado de la conexión
 */
async function verificarConexion() {
    try {
        // Obtener configuración de ARCA
        const configuracion = await getConfiguracion('arca');
        if (!configuracion || !configuracion.apiKey) {
            throw new Error('No se encontró la configuración de ARCA o falta la API Key');
        }
        
        // Verificar conexión
        const respuesta = await api.verificarConexion(configuracion);
        
        return {
            success: true,
            estadoAfip: respuesta.estado,
            mensaje: respuesta.mensaje
        };
    } catch (error) {
        logger.error(`Error al verificar conexión con AFIP: ${error.message}`, { error });
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Obtiene una lista de puntos de venta habilitados
 * @returns {Promise<Object>} - Puntos de venta disponibles
 */
async function obtenerPuntosVenta() {
    try {
        // Obtener configuración de ARCA
        const configuracion = await getConfiguracion('arca');
        if (!configuracion || !configuracion.apiKey) {
            throw new Error('No se encontró la configuración de ARCA o falta la API Key');
        }
        
        // Consultar puntos de venta
        const respuesta = await api.obtenerPuntosVenta(configuracion);
        
        if (respuesta.error) {
            logger.error('Error al consultar puntos de venta en ARCA', { error: respuesta.error });
            throw new Error(`Error al consultar puntos de venta: ${respuesta.error}`);
        }
        
        return {
            success: true,
            puntosVenta: respuesta.puntosVenta
        };
    } catch (error) {
        logger.error(`Error al obtener puntos de venta: ${error.message}`, { error });
        return {
            success: false,
            error: error.message,
            puntosVenta: []
        };
    }
}

/**
 * Genera libros de IVA (ventas/compras) para un período
 * @param {string} tipo - Tipo de libro ('ventas' o 'compras')
 * @param {Object} periodo - Objeto con fechaDesde y fechaHasta
 * @returns {Promise<Object>} - Datos del libro generado
 */
async function generarLibroIVA(tipo, periodo) {
    try {
        logger.info(`Generando libro IVA ${tipo}`, { periodo });
        
        // Validar tipo
        if (tipo !== 'ventas' && tipo !== 'compras') {
            throw new Error('Tipo de libro inválido. Debe ser "ventas" o "compras"');
        }
        
        // Validar período
        if (!periodo || !periodo.fechaDesde || !periodo.fechaHasta) {
            throw new Error('Período inválido. Se requiere fechaDesde y fechaHasta');
        }
        
        // Obtener configuración de ARCA
        const configuracion = await getConfiguracion('arca');
        if (!configuracion || !configuracion.apiKey) {
            throw new Error('No se encontró la configuración de ARCA o falta la API Key');
        }
        
        // Solicitar libro a ARCA
        const respuesta = await api.generarLibroIVA(tipo, periodo, configuracion);
        
        if (respuesta.error) {
            logger.error(`Error al generar libro IVA ${tipo}`, { 
                error: respuesta.error,
                periodo
            });
            throw new Error(`Error al generar libro IVA ${tipo}: ${respuesta.error}`);
        }
        
        return {
            success: true,
            libro: respuesta.libro,
            urlDescarga: respuesta.urlDescarga
        };
    } catch (error) {
        logger.error(`Error al generar libro IVA: ${error.message}`, { error });
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Genera un informe de impuestos para un período
 * @param {Object} periodo - Objeto con fechaDesde y fechaHasta
 * @returns {Promise<Object>} - Datos del informe generado
 */
async function generarInformeImpuestos(periodo) {
    try {
        logger.info('Generando informe de impuestos', { periodo });
        
        // Validar período
        if (!periodo || !periodo.fechaDesde || !periodo.fechaHasta) {
            throw new Error('Período inválido. Se requiere fechaDesde y fechaHasta');
        }
        
        // Obtener configuración de ARCA
        const configuracion = await getConfiguracion('arca');
        if (!configuracion || !configuracion.apiKey) {
            throw new Error('No se encontró la configuración de ARCA o falta la API Key');
        }
        
        // Solicitar informe a ARCA
        const respuesta = await api.generarInformeImpuestos(periodo, configuracion);
        
        if (respuesta.error) {
            logger.error('Error al generar informe de impuestos', { 
                error: respuesta.error,
                periodo
            });
            throw new Error(`Error al generar informe de impuestos: ${respuesta.error}`);
        }
        
        return {
            success: true,
            informe: respuesta.informe,
            urlDescarga: respuesta.urlDescarga
        };
    } catch (error) {
        logger.error(`Error al generar informe de impuestos: ${error.message}`, { error });
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Maneja errores comunes de AFIP y proporciona mensajes más amigables
 * @param {string} codigoError - Código de error devuelto por AFIP
 * @returns {string} - Mensaje de error amigable
 */
function manejarErrorAFIP(codigoError) {
    const erroresComunes = {
        '01': 'La CUIT informada no existe en los padrones de AFIP',
        '02': 'El comprobante ya fue autorizado anteriormente',
        '03': 'La numeración del comprobante ya existe',
        '04': 'El punto de venta no se encuentra autorizado',
        '05': 'La fecha del comprobante es anterior a la fecha actual',
        '06': 'El formato del CAE devuelto es inválido',
        '07': 'No se pudo establecer conexión con AFIP',
        '08': 'Error en el certificado digital',
        '09': 'Los importes informados no son válidos',
        '10': 'La CUIT emisora no está autorizada para emitir este tipo de comprobante',
        // Agregar más códigos según documentación de AFIP/ARCA
    };
    
    return erroresComunes[codigoError] || `Error no especificado (código: ${codigoError})`;
}

// Exportar funciones del módulo
module.exports = {
    generarComprobante,
    consultarComprobante,
    consultarDatosFiscales,
    generarNota,
    obtenerUltimoNumeroComprobante,
    verificarConexion,
    obtenerPuntosVenta,
    generarLibroIVA,
    generarInformeImpuestos,
    // Constantes exportadas para uso en otros módulos
    TIPOS_COMPROBANTE,
    TIPOS_CONCEPTO,
    ALICUOTAS_IVA
};