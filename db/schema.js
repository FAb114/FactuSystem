/**
 * db/schema.js
 * Esquema principal de la base de datos para FactuSystem
 * Define todas las tablas y relaciones del sistema
 */

const { Sequelize, DataTypes } = require('sequelize');

// Configuración de la conexión con la base de datos
// La configuración real se importa del archivo de configuración
const config = require('../server/config/database');

// Inicializar Sequelize con la configuración
const sequelize = new Sequelize(config.database, config.username, config.password, {
  host: config.host,
  dialect: config.dialect,
  logging: config.logging,
  storage: config.storage, // Para SQLite
  pool: config.pool
});

// Definición de modelos
const models = {};

// Modelo de sucursales
models.Sucursal = sequelize.define('Sucursal', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  nombre: {
    type: DataTypes.STRING,
    allowNull: false
  },
  direccion: {
    type: DataTypes.STRING,
    allowNull: false
  },
  telefono: {
    type: DataTypes.STRING
  },
  email: {
    type: DataTypes.STRING
  },
  es_principal: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  punto_venta_afip: {
    type: DataTypes.INTEGER
  },
  estado: {
    type: DataTypes.ENUM('activo', 'inactivo'),
    defaultValue: 'activo'
  },
  ultima_sincronizacion: {
    type: DataTypes.DATE
  },
  configuracion: {
    type: DataTypes.JSON,
    defaultValue: {}
  }
}, {
  timestamps: true,
  paranoid: true // Soft delete
});

// Modelo de usuarios
models.Usuario = sequelize.define('Usuario', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  nombre: {
    type: DataTypes.STRING,
    allowNull: false
  },
  apellido: {
    type: DataTypes.STRING,
    allowNull: false
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: {
      isEmail: true
    }
  },
  username: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false
  },
  salt: {
    type: DataTypes.STRING,
    allowNull: false
  },
  token_2fa: {
    type: DataTypes.STRING
  },
  is_2fa_enabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  ultimo_login: {
    type: DataTypes.DATE
  },
  estado: {
    type: DataTypes.ENUM('activo', 'bloqueado', 'inactivo'),
    defaultValue: 'activo'
  },
  intentos_fallidos: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  avatar: {
    type: DataTypes.STRING
  }
}, {
  timestamps: true,
  paranoid: true // Soft delete
});

// Modelo de roles
models.Rol = sequelize.define('Rol', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  nombre: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  descripcion: {
    type: DataTypes.TEXT
  },
  is_admin: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  }
}, {
  timestamps: true
});

// Modelo de permisos
models.Permiso = sequelize.define('Permiso', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  nombre: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  descripcion: {
    type: DataTypes.TEXT
  },
  modulo: {
    type: DataTypes.STRING,
    allowNull: false
  },
  accion: {
    type: DataTypes.ENUM('leer', 'crear', 'actualizar', 'eliminar', 'imprimir', 'exportar'),
    allowNull: false
  }
}, {
  timestamps: true
});

// Modelo intermedio para relación N:M entre roles y permisos
models.RolPermiso = sequelize.define('RolPermiso', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  }
}, {
  timestamps: true
});

// Modelo para asignar sucursales a usuarios
models.UsuarioSucursal = sequelize.define('UsuarioSucursal', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  es_default: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  }
}, {
  timestamps: true
});

// Modelo para registro de actividad de usuarios
models.RegistroActividad = sequelize.define('RegistroActividad', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  tipo: {
    type: DataTypes.STRING,
    allowNull: false
  },
  descripcion: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  ip: {
    type: DataTypes.STRING
  },
  detalles: {
    type: DataTypes.JSON
  }
}, {
  timestamps: true,
  indexes: [
    {
      fields: ['usuario_id', 'createdAt']
    }
  ]
});

// Modelo de clientes
models.Cliente = sequelize.define('Cliente', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  nombre: {
    type: DataTypes.STRING,
    allowNull: false
  },
  apellido: {
    type: DataTypes.STRING
  },
  razon_social: {
    type: DataTypes.STRING
  },
  tipo_documento: {
    type: DataTypes.ENUM('DNI', 'CUIT', 'CUIL', 'PASAPORTE', 'OTRO'),
    defaultValue: 'DNI'
  },
  nro_documento: {
    type: DataTypes.STRING,
    allowNull: false
  },
  condicion_iva: {
    type: DataTypes.ENUM(
      'Consumidor Final',
      'Responsable Inscripto',
      'Monotributista',
      'Exento',
      'No Categorizado'
    ),
    defaultValue: 'Consumidor Final'
  },
  direccion: {
    type: DataTypes.STRING
  },
  localidad: {
    type: DataTypes.STRING
  },
  provincia: {
    type: DataTypes.STRING
  },
  codigo_postal: {
    type: DataTypes.STRING
  },
  telefono: {
    type: DataTypes.STRING
  },
  email: {
    type: DataTypes.STRING,
    validate: {
      isEmail: true
    }
  },
  fecha_nacimiento: {
    type: DataTypes.DATEONLY
  },
  notas: {
    type: DataTypes.TEXT
  },
  puntos_fidelidad: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  nivel_fidelidad: {
    type: DataTypes.ENUM('Bronce', 'Plata', 'Oro', 'Platino'),
    defaultValue: 'Bronce'
  },
  ultima_compra: {
    type: DataTypes.DATE
  },
  total_compras: {
    type: DataTypes.DECIMAL(15, 2),
    defaultValue: 0
  }
}, {
  timestamps: true,
  paranoid: true, // Soft delete
  indexes: [
    {
      fields: ['nro_documento']
    },
    {
      fields: ['email']
    }
  ]
});

// Modelo de productos
models.Producto = sequelize.define('Producto', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  codigo: {
    type: DataTypes.STRING,
    unique: true
  },
  codigo_barras: {
    type: DataTypes.STRING
  },
  nombre: {
    type: DataTypes.STRING,
    allowNull: false
  },
  descripcion: {
    type: DataTypes.TEXT
  },
  precio_costo: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false,
    defaultValue: 0
  },
  precio_venta: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false,
    defaultValue: 0
  },
  porcentaje_iva: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 21.0
  },
  porcentaje_ganancia: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 30.0
  },
  stock_minimo: {
    type: DataTypes.INTEGER,
    defaultValue: 1
  },
  unidad_medida: {
    type: DataTypes.STRING,
    defaultValue: 'unidad'
  },
  peso: {
    type: DataTypes.DECIMAL(10, 2)
  },
  es_servicio: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  imagen: {
    type: DataTypes.STRING
  },
  estado: {
    type: DataTypes.ENUM('activo', 'inactivo', 'discontinuado'),
    defaultValue: 'activo'
  },
  fecha_ultima_compra: {
    type: DataTypes.DATE
  },
  fecha_ultima_venta: {
    type: DataTypes.DATE
  }
}, {
  timestamps: true,
  paranoid: true, // Soft delete
  indexes: [
    {
      fields: ['codigo']
    },
    {
      fields: ['codigo_barras']
    },
    {
      fields: ['nombre']
    }
  ]
});

// Modelo para categorías de productos
models.CategoriaProducto = sequelize.define('CategoriaProducto', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  nombre: {
    type: DataTypes.STRING,
    allowNull: false
  },
  descripcion: {
    type: DataTypes.TEXT
  },
  tipo: {
    type: DataTypes.ENUM('grupo', 'subgrupo', 'familia', 'tipo'),
    defaultValue: 'grupo'
  },
  categoria_padre_id: {
    type: DataTypes.INTEGER,
    references: {
      model: 'CategoriaProducto',
      key: 'id'
    },
    allowNull: true
  }
}, {
  timestamps: true
});

// Modelo para stock de productos por sucursal
models.Stock = sequelize.define('Stock', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  cantidad: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false,
    defaultValue: 0
  },
  ubicacion: {
    type: DataTypes.STRING
  },
  lote: {
    type: DataTypes.STRING
  },
  fecha_vencimiento: {
    type: DataTypes.DATEONLY
  }
}, {
  timestamps: true,
  indexes: [
    {
      fields: ['producto_id', 'sucursal_id']
    }
  ]
});

// Modelo para movimientos de stock
models.MovimientoStock = sequelize.define('MovimientoStock', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  tipo: {
    type: DataTypes.ENUM('entrada', 'salida', 'ajuste', 'transferencia'),
    allowNull: false
  },
  cantidad: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false
  },
  cantidad_anterior: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false
  },
  cantidad_nueva: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false
  },
  motivo: {
    type: DataTypes.STRING
  },
  lote: {
    type: DataTypes.STRING
  },
  referencia: {
    type: DataTypes.STRING
  },
  documento_tipo: {
    type: DataTypes.STRING
  },
  documento_id: {
    type: DataTypes.INTEGER
  }
}, {
  timestamps: true,
  indexes: [
    {
      fields: ['producto_id', 'sucursal_id', 'createdAt']
    }
  ]
});

// Modelo de proveedores
models.Proveedor = sequelize.define('Proveedor', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  razon_social: {
    type: DataTypes.STRING,
    allowNull: false
  },
  nombre_fantasia: {
    type: DataTypes.STRING
  },
  tipo_documento: {
    type: DataTypes.ENUM('CUIT', 'CUIL', 'DNI', 'OTRO'),
    defaultValue: 'CUIT'
  },
  nro_documento: {
    type: DataTypes.STRING,
    allowNull: false
  },
  condicion_iva: {
    type: DataTypes.ENUM(
      'Responsable Inscripto',
      'Monotributista',
      'Exento',
      'No Categorizado'
    ),
    defaultValue: 'Responsable Inscripto'
  },
  direccion: {
    type: DataTypes.STRING
  },
  localidad: {
    type: DataTypes.STRING
  },
  provincia: {
    type: DataTypes.STRING
  },
  codigo_postal: {
    type: DataTypes.STRING
  },
  telefono: {
    type: DataTypes.STRING
  },
  email: {
    type: DataTypes.STRING,
    validate: {
      isEmail: true
    }
  },
  sitio_web: {
    type: DataTypes.STRING
  },
  contacto_nombre: {
    type: DataTypes.STRING
  },
  contacto_telefono: {
    type: DataTypes.STRING
  },
  contacto_email: {
    type: DataTypes.STRING
  },
  notas: {
    type: DataTypes.TEXT
  },
  estado: {
    type: DataTypes.ENUM('activo', 'inactivo'),
    defaultValue: 'activo'
  }
}, {
  timestamps: true,
  paranoid: true, // Soft delete
  indexes: [
    {
      fields: ['nro_documento']
    },
    {
      fields: ['razon_social']
    }
  ]
});

// Modelo para las cajas (aperturas y cierres)
models.Caja = sequelize.define('Caja', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  estado: {
    type: DataTypes.ENUM('abierta', 'cerrada', 'en_proceso'),
    defaultValue: 'abierta'
  },
  fecha_apertura: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  fecha_cierre: {
    type: DataTypes.DATE
  },
  monto_apertura: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false,
    defaultValue: 0
  },
  monto_cierre: {
    type: DataTypes.DECIMAL(15, 2)
  },
  monto_cierre_sistema: {
    type: DataTypes.DECIMAL(15, 2)
  },
  diferencia: {
    type: DataTypes.DECIMAL(15, 2)
  },
  observaciones_apertura: {
    type: DataTypes.TEXT
  },
  observaciones_cierre: {
    type: DataTypes.TEXT
  },
  arqueo: {
    type: DataTypes.JSON
  }
}, {
  timestamps: true,
  indexes: [
    {
      fields: ['sucursal_id', 'fecha_apertura']
    },
    {
      fields: ['usuario_id', 'fecha_apertura']
    }
  ]
});

// Modelo para movimientos de caja
models.MovimientoCaja = sequelize.define('MovimientoCaja', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  tipo: {
    type: DataTypes.ENUM('ingreso', 'egreso'),
    allowNull: false
  },
  concepto: {
    type: DataTypes.STRING,
    allowNull: false
  },
  monto: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false
  },
  medio_pago: {
    type: DataTypes.ENUM(
      'efectivo', 
      'tarjeta_credito', 
      'tarjeta_debito', 
      'transferencia', 
      'mercado_pago', 
      'cheque', 
      'otro'
    ),
    defaultValue: 'efectivo'
  },
  referencia: {
    type: DataTypes.STRING
  },
  documento_tipo: {
    type: DataTypes.STRING
  },
  documento_id: {
    type: DataTypes.INTEGER
  },
  observaciones: {
    type: DataTypes.TEXT
  }
}, {
  timestamps: true,
  indexes: [
    {
      fields: ['caja_id', 'createdAt']
    },
    {
      fields: ['medio_pago']
    }
  ]
});

// Modelo para facturas y otros comprobantes
models.Comprobante = sequelize.define('Comprobante', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  tipo: {
    type: DataTypes.ENUM('A', 'B', 'C', 'X', 'PRESUPUESTO', 'NOTA_CREDITO', 'NOTA_DEBITO', 'REMITO'),
    allowNull: false
  },
  numero: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  punto_venta: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  cae: {
    type: DataTypes.STRING
  },
  vencimiento_cae: {
    type: DataTypes.DATEONLY
  },
  fecha_emision: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  fecha_vencimiento: {
    type: DataTypes.DATEONLY
  },
  subtotal: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false,
    defaultValue: 0
  },
  importe_iva: {
    type: DataTypes.DECIMAL(15, 2),
    defaultValue: 0
  },
  importe_total: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false,
    defaultValue: 0
  },
  porcentaje_descuento: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0
  },
  importe_descuento: {
    type: DataTypes.DECIMAL(15, 2),
    defaultValue: 0
  },
  estado: {
    type: DataTypes.ENUM('emitida', 'pagada', 'anulada', 'pendiente'),
    defaultValue: 'emitida'
  },
  observaciones: {
    type: DataTypes.TEXT
  },
  forma_pago: {
    type: DataTypes.STRING
  },
  electronica: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  pdf_url: {
    type: DataTypes.STRING
  },
  comprobante_asociado_id: {
    type: DataTypes.INTEGER,
    references: {
      model: 'Comprobante',
      key: 'id'
    },
    allowNull: true
  }
}, {
  timestamps: true,
  indexes: [
    {
      fields: ['tipo', 'numero', 'punto_venta'],
      unique: true
    },
    {
      fields: ['cliente_id']
    },
    {
      fields: ['fecha_emision']
    },
    {
      fields: ['estado']
    }
  ]
});

// Modelo para los detalles de comprobante
models.ComprobanteDetalle = sequelize.define('ComprobanteDetalle', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  cantidad: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false,
    defaultValue: 1
  },
  descripcion: {
    type: DataTypes.STRING,
    allowNull: false
  },
  precio_unitario: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false
  },
  porcentaje_iva: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 21.0
  },
  importe_iva: {
    type: DataTypes.DECIMAL(15, 2),
    defaultValue: 0
  },
  subtotal: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false
  },
  porcentaje_descuento: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0
  },
  importe_descuento: {
    type: DataTypes.DECIMAL(15, 2),
    defaultValue: 0
  },
  total: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false
  }
});

// Modelo para compras a proveedores
models.Compra = sequelize.define('Compra', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  numero_factura: {
    type: DataTypes.STRING,
    allowNull: false
  },
  tipo_factura: {
    type: DataTypes.ENUM('A', 'B', 'C', 'OTRO'),
    allowNull: false,
    defaultValue: 'A'
  },
  fecha_compra: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  fecha_recepcion: {
    type: DataTypes.DATEONLY
  },
  subtotal: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false
  },
  iva: {
    type: DataTypes.DECIMAL(15, 2),
    defaultValue: 0
  },
  otros_impuestos: {
    type: DataTypes.DECIMAL(15, 2),
    defaultValue: 0
  },
  total: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false
  },
  estado: {
    type: DataTypes.ENUM('pendiente', 'recibida', 'pagada', 'anulada'),
    defaultValue: 'pendiente'
  },
  observaciones: {
    type: DataTypes.TEXT
  },
  factura_escaneada: {
    type: DataTypes.STRING
  }
}, {
  timestamps: true,
  indexes: [
    {
      fields: ['proveedor_id']
    },
    {
      fields: ['fecha_compra']
    },
    {
      fields: ['estado']
    }
  ]
});

// Modelo para los detalles de compra
models.CompraDetalle = sequelize.define('CompraDetalle', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  cantidad: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false
  },
  descripcion: {
    type: DataTypes.STRING,
    allowNull: false
  },
  precio_unitario: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false
  },
  porcentaje_iva: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 21.0
  },
  importe_iva: {
    type: DataTypes.DECIMAL(15, 2),
    defaultValue: 0
  },
  subtotal: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false
  },
  total: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false
  },
  actualiza_stock: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
});

// Modelo para pagos (de comprobantes y compras)
models.Pago = sequelize.define('Pago', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  tipo_entidad: {
    type: DataTypes.ENUM('comprobante', 'compra'),
    allowNull: false
  },
  entidad_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  fecha_pago: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  medio_pago: {
    type: DataTypes.ENUM(
      'efectivo', 
      'tarjeta_credito', 
      'tarjeta_debito', 
      'transferencia', 
      'mercado_pago', 
      'cheque', 
      'otro'
    ),
    allowNull: false
  },
  importe: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false
  },
  referencia: {
    type: DataTypes.STRING
  },
  datos_adicionales: {
    type: DataTypes.JSON
  },
  observaciones: {
    type: DataTypes.TEXT
  }
}, {
  timestamps: true,
  indexes: [
    {
      fields: ['tipo_entidad', 'entidad_id']
    },
    {
      fields: ['fecha_pago']
    }
  ]
});

// Modelo para datos de tarjetas
models.PagoTarjeta = sequelize.define('PagoTarjeta', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  tipo_tarjeta: {
    type: DataTypes.ENUM('credito', 'debito'),
    allowNull: false
  },
  marca: {
    type: DataTypes.STRING,
    allowNull: false
  },
  numero_ultimos_digitos: {
    type: DataTypes.STRING
  },
  numero_cuotas: {
    type: DataTypes.INTEGER,
    defaultValue: 1
  },
  monto_cuota: {
    type: DataTypes.DECIMAL(15, 2)
  },
  interes: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0
  },
  codigo_autorizacion: {
    type: DataTypes.STRING
  },
  titular: {
    type: DataTypes.STRING
  }
}, {
  timestamps: true
});

// Modelo para datos de transferencias
models.PagoTransferencia = sequelize.define('PagoTransferencia', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  banco: {
    type: DataTypes.STRING
  },
  comprobante: {
    type: DataTypes.STRING
  },
  numero_operacion: {
    type: DataTypes.STRING
  },
  cuenta_origen: {
    type: DataTypes.STRING
  },
  cuenta_destino: {
    type: DataTypes.STRING
  },
  titular: {
    type: DataTypes.STRING
  }
}, {
  timestamps: true
});

// Modelo para datos de pagos con Mercado Pago
models.PagoMercadoPago = sequelize.define('PagoMercadoPago', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  payment_id: {
    type: DataTypes.STRING
  },
  merchant_order_id: {
    type: DataTypes.STRING
  },
  preference_id: {
    type: DataTypes.STRING
  },
  status: {
    type: DataTypes.STRING
  },
  payment_type: {
    type: DataTypes.STRING
  },
  external_reference: {
    type: DataTypes.STRING
  },
  datos_completos: {
    type: DataTypes.JSON
  }
}, {
  timestamps: true,
  indexes: [
    {
      fields: ['payment_id']
    },
    {
      fields: ['status']
    }
  ]
});

// Modelo para configuración de la empresa
models.ConfiguracionEmpresa = sequelize.define('ConfiguracionEmpresa', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  razon_social: {
    type: DataTypes.STRING,
    allowNull: false
  },
  nombre_fantasia: {
    type: DataTypes.STRING
  },
  cuit: {
    type: DataTypes.STRING,
    allowNull: false
  },
  condicion_iva: {
    type: DataTypes.STRING,
    allowNull: false
  },
  direccion: {
    type: DataTypes.STRING,
    allowNull: false
  },
  localidad: {
    type: DataTypes.STRING
  },
  provincia: {
    type: DataTypes.STRING
  },
  codigo_postal: {
    type: DataTypes.STRING
  },
  telefono: {
    type: DataTypes.STRING
  },
  email: {
    type: DataTypes.STRING
  },
  sitio_web: {
    type: DataTypes.STRING
  },
  logo: {
    type: DataTypes.STRING
  },
  inicio_actividades: {
    type: DataTypes.DATEONLY
  },
  ingresos_brutos: {
    type: DataTypes.STRING
  },
  leyenda_factura: {
    type: DataTypes.TEXT
  }
}, {
  timestamps: true
});

// Modelo para configuración de AFIP/ARCA
models.ConfiguracionAfip = sequelize.define('ConfiguracionAfip', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  cuit: {
    type: DataTypes.STRING,
    allowNull: false
  },
  certificado: {
    type: DataTypes.TEXT
  },
  clave_privada: {
    type: DataTypes.TEXT
  },
  punto_venta: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  produccion: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  token: {
    type: DataTypes.TEXT
  },
  token_expira: {
    type: DataTypes.DATE
  },
  ultimo_numero_factura_a: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  ultimo_numero_factura_b: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  ultimo_numero_factura_c: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  ultimo_numero_nc_a: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  ultimo_numero_nc_b: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  ultimo_numero_nc_c: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  ultimo_numero_nd_a: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  ultimo_numero_nd_b: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  ultimo_numero_nd_c: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  sucursal_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  }
}, {
  timestamps: true
});

// Modelo para configuración de Mercado Pago
models.ConfiguracionMercadoPago = sequelize.define('ConfiguracionMercadoPago', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  public_key: {
    type: DataTypes.STRING
  },
  access_token: {
    type: DataTypes.STRING
  },
  client_id: {
    type: DataTypes.STRING
  },
  client_secret: {
    type: DataTypes.STRING
  },
  user_id: {
    type: DataTypes.STRING
  },
  externa_id: {
    type: DataTypes.STRING
  },
  qr_imagen: {
    type: DataTypes.STRING
  },
  store_id: {
    type: DataTypes.STRING
  },
  pos_id: {
    type: DataTypes.STRING
  },
  intervalo_verificacion: {
    type: DataTypes.INTEGER,
    defaultValue: 10 // segundos
  },
  notificacion_webhook: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  url_webhook: {
    type: DataTypes.STRING
  },
  sucursal_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  }
}, {
  timestamps: true
});

// Modelo para configuración de WhatsApp
models.ConfiguracionWhatsApp = sequelize.define('ConfiguracionWhatsApp', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  token: {
    type: DataTypes.STRING
  },
  numero_telefono: {
    type: DataTypes.STRING
  },
  phone_id: {
    type: DataTypes.STRING
  },
  activo: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  plantilla_factura: {
    type: DataTypes.TEXT
  },
  plantilla_presupuesto: {
    type: DataTypes.TEXT
  },
  sucursal_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  }
}, {
  timestamps: true
});

// Modelo para configuración de Email
models.ConfiguracionEmail = sequelize.define('ConfiguracionEmail', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  host: {
    type: DataTypes.STRING
  },
  port: {
    type: DataTypes.INTEGER
  },
  secure: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  user: {
    type: DataTypes.STRING
  },
  password: {
    type: DataTypes.STRING
  },
  from_email: {
    type: DataTypes.STRING
  },
  from_name: {
    type: DataTypes.STRING
  },
  activo: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  sucursal_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  }
}, {
  timestamps: true
});

// Modelo para configuración de bancos
models.ConfiguracionBanco = sequelize.define('ConfiguracionBanco', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  nombre_banco: {
    type: DataTypes.ENUM('galicia', 'getnet', 'bbva', 'payway', 'otro'),
    allowNull: false
  },
  tipo_integracion: {
    type: DataTypes.ENUM('api', 'manual'),
    defaultValue: 'manual'
  },
  api_key: {
    type: DataTypes.STRING
  },
  api_secret: {
    type: DataTypes.STRING
  },
  api_url: {
    type: DataTypes.STRING
  },
  username: {
    type: DataTypes.STRING
  },
  password: {
    type: DataTypes.STRING
  },
  numero_comercio: {
    type: DataTypes.STRING
  },
  numero_terminal: {
    type: DataTypes.STRING
  },
  cuenta_cbu: {
    type: DataTypes.STRING
  },
  cuenta_alias: {
    type: DataTypes.STRING
  },
  titular_cuenta: {
    type: DataTypes.STRING
  },
  sucursal_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  activo: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  datos_adicionales: {
    type: DataTypes.JSON
  }
}, {
  timestamps: true
});

// Modelo para tasas de interés por cuotas
models.TasaInteres = sequelize.define('TasaInteres', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  banco: {
    type: DataTypes.STRING,
    allowNull: false
  },
  marca_tarjeta: {
    type: DataTypes.STRING,
    allowNull: false
  },
  cuotas: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  tasa: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false
  },
  activo: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
}, {
  timestamps: true,
  indexes: [
    {
      fields: ['banco', 'marca_tarjeta', 'cuotas'],
      unique: true
    }
  ]
});

// Modelo para respaldos
models.Respaldo = sequelize.define('Respaldo', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  nombre: {
    type: DataTypes.STRING,
    allowNull: false
  },
  ruta: {
    type: DataTypes.STRING,
    allowNull: false
  },
  tipo: {
    type: DataTypes.ENUM('manual', 'automatico', 'nube'),
    defaultValue: 'manual'
  },
  tamaño: {
    type: DataTypes.INTEGER
  },
  creado_por: {
    type: DataTypes.INTEGER,
    references: {
      model: 'Usuario',
      key: 'id'
    },
    allowNull: true
  },
  restaurado: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  fecha_restauracion: {
    type: DataTypes.DATE
  },
  detalles: {
    type: DataTypes.JSON
  }
}, {
  timestamps: true
});

// Modelo para fidelización de clientes
models.FidelizacionCliente = sequelize.define('FidelizacionCliente', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  cliente_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'Cliente',
      key: 'id'
    }
  },
  tipo: {
    type: DataTypes.ENUM('puntos', 'descuento', 'regalo', 'promocion'),
    allowNull: false
  },
  puntos: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  porcentaje_descuento: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0
  },
  descripcion: {
    type: DataTypes.STRING
  },
  fecha_vencimiento: {
    type: DataTypes.DATEONLY
  },
  usado: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  fecha_uso: {
    type: DataTypes.DATE
  },
  comprobante_id: {
    type: DataTypes.INTEGER,
    references: {
      model: 'Comprobante',
      key: 'id'
    },
    allowNull: true
  }
}, {
  timestamps: true,
  indexes: [
    {
      fields: ['cliente_id']
    }
  ]
});

// Modelo para informes fiscales
models.InformeFiscal = sequelize.define('InformeFiscal', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  tipo: {
    type: DataTypes.ENUM('iva_ventas', 'iva_compras', 'ganancias', 'ingresos_brutos', 'otro'),
    allowNull: false
  },
  periodo: {
    type: DataTypes.STRING,
    allowNull: false
  },
  fecha_inicio: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  fecha_fin: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  total_neto: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false
  },
  total_iva: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false
  },
  total_otros_impuestos: {
    type: DataTypes.DECIMAL(15, 2),
    defaultValue: 0
  },
  total: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    references: {
      model: 'Usuario',
      key: 'id'
    },
    allowNull: false
  },
  sucursal_id: {
    type: DataTypes.INTEGER,
    references: {
      model: 'Sucursal',
      key: 'id'
    },
    allowNull: false
  },
  archivo: {
    type: DataTypes.STRING
  },
  datos: {
    type: DataTypes.JSON
  }
}, {
  timestamps: true,
  indexes: [
    {
      fields: ['tipo', 'periodo', 'sucursal_id'],
      unique: true
    }
  ]
});

// Modelo para configuración visual del sistema
models.ConfiguracionVisual = sequelize.define('ConfiguracionVisual', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  tema: {
    type: DataTypes.ENUM('claro', 'oscuro', 'personalizado'),
    defaultValue: 'claro'
  },
  color_primario: {
    type: DataTypes.STRING,
    defaultValue: '#3498db'
  },
  color_secundario: {
    type: DataTypes.STRING,
    defaultValue: '#2ecc71'
  },
  color_fondo: {
    type: DataTypes.STRING,
    defaultValue: '#ffffff'
  },
  color_texto: {
    type: DataTypes.STRING,
    defaultValue: '#333333'
  },
  logo_sistema: {
    type: DataTypes.STRING
  },
  icono_sistema: {
    type: DataTypes.STRING
  },
  mostrar_imagenes_productos: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  tamaño_fuente: {
    type: DataTypes.ENUM('pequeño', 'normal', 'grande'),
    defaultValue: 'normal'
  },
  sucursal_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'Sucursal',
      key: 'id'
    }
  }
}, {
  timestamps: true
});

// Modelo para sincronización de datos
models.Sincronizacion = sequelize.define('Sincronizacion', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  sucursal_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'Sucursal',
      key: 'id'
    }
  },
  tipo: {
    type: DataTypes.ENUM('enviada', 'recibida'),
    allowNull: false
  },
  entidad: {
    type: DataTypes.STRING,
    allowNull: false
  },
  entidad_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  accion: {
    type: DataTypes.ENUM('crear', 'actualizar', 'eliminar'),
    allowNull: false
  },
  estado: {
    type: DataTypes.ENUM('pendiente', 'completada', 'error', 'conflicto'),
    defaultValue: 'pendiente'
  },
  datos: {
    type: DataTypes.JSON
  },
  error_detalle: {
    type: DataTypes.TEXT
  },
  fecha_sincronizacion: {
    type: DataTypes.DATE
  }
}, {
  timestamps: true,
  indexes: [
    {
      fields: ['sucursal_id', 'entidad', 'entidad_id']
    },
    {
      fields: ['estado']
    }
  ]
});

// Modelo para conflictos de sincronización
models.ConflictoSincronizacion = sequelize.define('ConflictoSincronizacion', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  sincronizacion_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'Sincronizacion',
      key: 'id'
    }
  },
  entidad: {
    type: DataTypes.STRING,
    allowNull: false
  },
  entidad_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  datos_local: {
    type: DataTypes.JSON
  },
  datos_remoto: {
    type: DataTypes.JSON
  },
  resolucion: {
    type: DataTypes.ENUM('pendiente', 'local', 'remoto', 'mixto'),
    defaultValue: 'pendiente'
  },
  resolucion_detalles: {
    type: DataTypes.JSON
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    references: {
      model: 'Usuario',
      key: 'id'
    },
    allowNull: true
  }
}, {
  timestamps: true
});

// Modelo para configuración de impresoras
models.ConfiguracionImpresora = sequelize.define('ConfiguracionImpresora', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  nombre: {
    type: DataTypes.STRING,
    allowNull: false
  },
  tipo: {
    type: DataTypes.ENUM('termica', 'laser', 'tinta', 'matriz', 'otra'),
    allowNull: false,
    defaultValue: 'termica'
  },
  tamaño_papel: {
    type: DataTypes.ENUM('58mm', '80mm', 'a4', 'carta', 'otro'),
    allowNull: false,
    defaultValue: '80mm'
  },
  puerto: {
    type: DataTypes.STRING
  },
  ip: {
    type: DataTypes.STRING
  },
  compartida: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  nombre_compartido: {
    type: DataTypes.STRING
  },
  documento_default: {
    type: DataTypes.ENUM('factura', 'ticket', 'remito', 'otro'),
    defaultValue: 'ticket'
  },
  configuracion_adicional: {
    type: DataTypes.JSON
  },
  sucursal_id: {
    type: DataTypes.INTEGER,
    references: {
      model: 'Sucursal',
      key: 'id'
    },
    allowNull: false
  }
}, {
  timestamps: true
});

// Modelo para plantillas de documentos
models.PlantillaDocumento = sequelize.define('PlantillaDocumento', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  nombre: {
    type: DataTypes.STRING,
    allowNull: false
  },
  tipo: {
    type: DataTypes.ENUM('factura', 'ticket', 'remito', 'nota_credito', 'nota_debito', 'presupuesto', 'recibo', 'reporte'),
    allowNull: false
  },
  formato: {
    type: DataTypes.ENUM('a4', '58mm', '80mm', 'html', 'pdf'),
    allowNull: false
  },
  contenido: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  css: {
    type: DataTypes.TEXT
  },
  predeterminada: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  sucursal_id: {
    type: DataTypes.INTEGER,
    references: {
      model: 'Sucursal',
      key: 'id'
    },
    allowNull: false
  }
}, {
  timestamps: true
});

// Definir relaciones entre modelos

// Relaciones de Usuario
models.Usuario.belongsTo(models.Rol);
models.Rol.hasMany(models.Usuario);

models.Usuario.belongsToMany(models.Sucursal, { through: models.UsuarioSucursal });
models.Sucursal.belongsToMany(models.Usuario, { through: models.UsuarioSucursal });

models.Usuario.hasMany(models.RegistroActividad);
models.RegistroActividad.belongsTo(models.Usuario);

models.Usuario.hasMany(models.Caja);
models.Caja.belongsTo(models.Usuario);

// Relaciones de Roles y Permisos
models.Rol.belongsToMany(models.Permiso, { through: models.RolPermiso });
models.Permiso.belongsToMany(models.Rol, { through: models.RolPermiso });

// Relaciones de Productos
models.Producto.belongsTo(models.CategoriaProducto);
models.CategoriaProducto.hasMany(models.Producto);

models.CategoriaProducto.belongsTo(models.CategoriaProducto, { as: 'CategoriaPadre', foreignKey: 'categoria_padre_id' });
models.CategoriaProducto.hasMany(models.CategoriaProducto, { as: 'SubCategorias', foreignKey: 'categoria_padre_id' });

models.Producto.hasMany(models.Stock);
models.Stock.belongsTo(models.Producto);

models.Stock.belongsTo(models.Sucursal);
models.Sucursal.hasMany(models.Stock);

models.MovimientoStock.belongsTo(models.Producto);
models.MovimientoStock.belongsTo(models.Sucursal);
models.MovimientoStock.belongsTo(models.Usuario);

// Relaciones de Clientes
models.Cliente.belongsTo(models.Sucursal); // Sucursal primaria del cliente
models.Sucursal.hasMany(models.Cliente);

models.Cliente.hasMany(models.FidelizacionCliente);
models.FidelizacionCliente.belongsTo(models.Cliente);

// Relaciones de Comprobantes
models.Comprobante.belongsTo(models.Cliente);
models.Cliente.hasMany(models.Comprobante);

models.Comprobante.belongsTo(models.Sucursal);
models.Sucursal.hasMany(models.Comprobante);

models.Comprobante.belongsTo(models.Usuario);
models.Usuario.hasMany(models.Comprobante);

models.Comprobante.hasMany(models.ComprobanteDetalle);
models.ComprobanteDetalle.belongsTo(models.Comprobante);

models.ComprobanteDetalle.belongsTo(models.Producto);
models.Producto.hasMany(models.ComprobanteDetalle);

models.Comprobante.belongsTo(models.Comprobante, { as: 'ComprobanteAsociado', foreignKey: 'comprobante_asociado_id' });

// Relaciones de Compras
models.Compra.belongsTo(models.Proveedor);
models.Proveedor.hasMany(models.Compra);

models.Compra.belongsTo(models.Sucursal);
models.Sucursal.hasMany(models.Compra);

models.Compra.belongsTo(models.Usuario);
models.Usuario.hasMany(models.Compra);

models.Compra.hasMany(models.CompraDetalle);
models.CompraDetalle.belongsTo(models.Compra);

models.CompraDetalle.belongsTo(models.Producto);
models.Producto.hasMany(models.CompraDetalle);

// Relaciones de Pagos
models.Pago.belongsTo(models.Usuario);
models.Usuario.hasMany(models.Pago);

models.Pago.belongsTo(models.Caja);
models.Caja.hasMany(models.Pago);

models.Pago.hasOne(models.PagoTarjeta);
models.PagoTarjeta.belongsTo(models.Pago);

models.Pago.hasOne(models.PagoTransferencia);
models.PagoTransferencia.belongsTo(models.Pago);

models.Pago.hasOne(models.PagoMercadoPago);
models.PagoMercadoPago.belongsTo(models.Pago);

// Relaciones de Caja
models.Caja.belongsTo(models.Sucursal);
models.Sucursal.hasMany(models.Caja);

models.MovimientoCaja.belongsTo(models.Caja);
models.Caja.hasMany(models.MovimientoCaja);

models.MovimientoCaja.belongsTo(models.Usuario);
models.Usuario.hasMany(models.MovimientoCaja);

// Relaciones de Configuraciones
models.ConfiguracionAfip.belongsTo(models.Sucursal);
models.Sucursal.hasOne(models.ConfiguracionAfip);

models.ConfiguracionMercadoPago.belongsTo(models.Sucursal);
models.Sucursal.hasOne(models.ConfiguracionMercadoPago);

models.ConfiguracionWhatsApp.belongsTo(models.Sucursal);
models.Sucursal.hasOne(models.ConfiguracionWhatsApp);

models.ConfiguracionEmail.belongsTo(models.Sucursal);
models.Sucursal.hasOne(models.ConfiguracionEmail);

models.ConfiguracionBanco.belongsTo(models.Sucursal);
models.Sucursal.hasMany(models.ConfiguracionBanco);

models.ConfiguracionVisual.belongsTo(models.Sucursal);
models.Sucursal.hasOne(models.ConfiguracionVisual);

models.ConfiguracionImpresora.belongsTo(models.Sucursal);
models.Sucursal.hasMany(models.ConfiguracionImpresora);

models.PlantillaDocumento.belongsTo(models.Sucursal);
models.Sucursal.hasMany(models.PlantillaDocumento);

// Método para sincronizar el esquema con la base de datos
const sincronizarEsquema = async (opciones = {}) => {
  try {
    await sequelize.sync(opciones);
    console.log('Esquema de base de datos sincronizado correctamente');
    return true;
  } catch (error) {
    console.error('Error al sincronizar el esquema de la base de datos:', error);
    return false;
  }
};

// Método para verificar la conexión a la base de datos
const verificarConexion = async () => {
  try {
    await sequelize.authenticate();
    console.log('Conexión a la base de datos establecida correctamente');
    return true;
  } catch (error) {
    console.error('Error al conectar con la base de datos:', error);
    return false;
  }
};

// Exportar modelos y utilidades
module.exports = {
  sequelize,
  models,
  sincronizarEsquema,
  verificarConexion,
  DataTypes
};