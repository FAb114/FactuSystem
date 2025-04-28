// /app/assets/js/utils/validation.js
// Módulo de validación de datos y formularios para FactuSystem
// Asegura integridad antes de persistir y sincronizar datos

const database = require('./database');
const logger = require('./logger');

class Validation {
  constructor() {}

  /**
   * Valida campos obligatorios
   * @param {Object} data - Objeto con datos a validar
   * @param {Array<string>} fields - Nombre de campos requeridos
   * @returns {Object} Errores encontrados
   */
  validateRequired(data, fields) {
    const errors = {};
    fields.forEach(field => {
      if (data[field] === undefined || data[field] === null || data[field].toString().trim() === '') {
        errors[field] = `${field} es obligatorio.`;
      }
    });
    return errors;
  }

  /**
   * Valida formato de email
   * @param {string} email
   * @returns {boolean}
   */
  isEmail(email) {
    const re = /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@(([^<>()[\]\\.,;:\s@\"]+\.)+[^<>()[\]\\.,;:\s@\"]{2,})$/i;
    return re.test(email);
  }

  /**
   * Valida número de teléfono (solo dígitos, 8-15 caracteres)
   * @param {string} phone
   * @returns {boolean}
   */
  isPhone(phone) {
    const re = /^[0-9]{8,15}$/;
    return re.test(phone);
  }

  /**
   * Valida que sea número y opcionalmente dentro de un rango
   * @param {any} value
   * @param {number} [min]
   * @param {number} [max]
   * @returns {boolean}
   */
  isNumber(value, min = null, max = null) {
    const num = parseFloat(value);
    if (isNaN(num)) return false;
    if (min !== null && num < min) return false;
    if (max !== null && num > max) return false;
    return true;
  }

  /**
   * Valida formato de fecha ISO (YYYY-MM-DD)
   * @param {string} dateStr
   * @returns {boolean}
   */
  isDate(dateStr) {
    const date = new Date(dateStr);
    return !isNaN(date.getTime()) && /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
  }

  /**
   * Validación específica para clientes
   * - Campos: nombre, email
   * - Email único
   */
  async validateCliente(cliente) {
    const errors = this.validateRequired(cliente, ['nombre', 'email']);

    if (cliente.email && !this.isEmail(cliente.email)) {
      errors.email = 'Formato de email inválido.';
    }

    // Verificar unicidad de email
    try {
      const existing = await database.find('clientes', { email: cliente.email });
      if (existing && existing.id !== cliente.id) {
        errors.email = 'Email ya registrado para otro cliente.';
      }
    } catch (err) {
      logger.error('Validation: Error al validar unicidad de email', err);
    }

    return errors;
  }

  /**
   * Validación específica para productos
   * - Campos: nombre, codigo, precio
   * - Código único
   */
  async validateProducto(producto) {
    const errors = this.validateRequired(producto, ['nombre', 'codigo', 'precio']);

    if (producto.precio && !this.isNumber(producto.precio, 0)) {
      errors.precio = 'Precio debe ser un número positivo.';
    }

    // Verificar unicidad de código
    try {
      const existing = await database.find('productos', { codigo: producto.codigo });
      if (existing && existing.id !== producto.id) {
        errors.codigo = 'Código de producto ya existe.';
      }
    } catch (err) {
      logger.error('Validation: Error al validar unicidad de código', err);
    }

    return errors;
  }

  /**
   * Validación de facturas
   * - Campos: clienteId, productos, total
   */
  validateFactura(factura) {
    const errors = this.validateRequired(factura, ['clienteId', 'productos', 'total']);

    if (factura.productos && (!Array.isArray(factura.productos) || factura.productos.length === 0)) {
      errors.productos = 'Debe incluir al menos un producto.';
    }

    if (factura.total && !this.isNumber(factura.total, 0)) {
      errors.total = 'Total debe ser un número positivo.';
    }

    return errors;
  }

  /**
   * Validación de remitos
   * - Campos: clienteId, productos
   */
  validateRemito(remito) {
    const errors = this.validateRequired(remito, ['clienteId', 'productos']);

    if (remito.productos && (!Array.isArray(remito.productos) || remito.productos.length === 0)) {
      errors.productos = 'Debe incluir al menos un ítem en el remito.';
    }

    return errors;
  }

  /**
   * Validación de notas (crédito/débito)
   * - Campos: clienteId, monto
   */
  validateNota(nota) {
    const errors = this.validateRequired(nota, ['clienteId', 'monto']);

    if (nota.monto && !this.isNumber(nota.monto, 0)) {
      errors.monto = 'Monto debe ser un número positivo.';
    }

    return errors;
  }

  /**
   * Validación de reportes (ej: fechas)
   */
  validateReporte(reporte) {
    const errors = {};
    if (reporte.fechaInicio && !this.isDate(reporte.fechaInicio)) {
      errors.fechaInicio = 'Fecha de inicio inválida.';
    }
    if (reporte.fechaFin && !this.isDate(reporte.fechaFin)) {
      errors.fechaFin = 'Fecha de fin inválida.';
    }
    return errors;
  }
}

// Exportar instancia única
module.exports = new Validation();
