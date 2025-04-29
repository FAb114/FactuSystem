/**
 * @file reportes.js
 * @description Módulo para generación de reportes de ventas en FactuSystem
 * @module modules/ventas/reportes
 */

// Importaciones de utilidades y servicios necesarios
const { ipcRenderer } = require('../../renderer.js');
const { Database } = require('../../utils/database.js');
const { auth } = require('../../utils/auth.js');
const { formatCurrency, formatDate, getFiscalPeriod } = require('../../utils/validation.js');
const { showNotification } = require('../../components/notifications.js');
const { printDocument } = require('../../utils/printer.js');

// Importaciones de componentes específicos para reportes
const { exportToPdf } = require('../../../services/print/pdf.js');
const { exportToExcel } = require('../reportes/exportacion.js');

class VentasReportes {
  constructor() {
    this.db = new Database();
    this.currentUser = auth.getCurrentUser();
    this.filters = {
      startDate: null,
      endDate: null,
      sucursal: 'todas',
      usuario: 'todos',
      tipoComprobante: 'todos',
      metodoPago: 'todos',
      cliente: '',
      minTotal: '',
      maxTotal: '',
    };
    this.reportData = {
      ventas: [],
      totales: {
        cantidad: 0,
        monto: 0,
        efectivo: 0,
        tarjeta: 0,
        transferencia: 0,
        mercadoPago: 0,
        otrosMedios: 0,
      },
      productos: [],
      clientes: [],
      estadisticas: {},
    };
    
    // Períodos predefinidos
    this.periodos = {
      hoy: {
        startDate: new Date(),
        endDate: new Date()
      },
      ayer: {
        startDate: new Date(new Date().setDate(new Date().getDate() - 1)),
        endDate: new Date(new Date().setDate(new Date().getDate() - 1))
      },
      semanaActual: this.calcularSemanaActual(),
      semanaAnterior: this.calcularSemanaAnterior(),
      mesActual: this.calcularMesActual(),
      mesAnterior: this.calcularMesAnterior(),
      ultimosTreinta: {
        startDate: new Date(new Date().setDate(new Date().getDate() - 30)),
        endDate: new Date()
      },
      ultimosNoventa: {
        startDate: new Date(new Date().setDate(new Date().getDate() - 90)),
        endDate: new Date()
      },
    };
    
    // Control de permisos
    this.permisos = {
      verTodosReportes: auth.hasPermission('reportes.ventas.verTodos'),
      exportarReportes: auth.hasPermission('reportes.ventas.exportar'),
      verDetallePago: auth.hasPermission('reportes.ventas.verDetallePago'),
      verDetalleImpuestos: auth.hasPermission('reportes.ventas.verDetalleImpuestos'),
    };
  }

  /**
   * Inicializa el módulo de reportes
   */
  async init() {
    this.initDefaultDateRange();
    this.setupEventListeners();
    await this.loadSucursales();
    await this.loadUsuarios();
    await this.loadClientes();
    await this.loadTiposComprobante();
    await this.loadMetodosPago();
    await this.generarReporte();
  }

  /**
   * Establece el rango de fechas predeterminado (mes actual)
   */
  initDefaultDateRange() {
    const { startDate, endDate } = this.periodos.mesActual;
    this.filters.startDate = startDate;
    this.filters.endDate = endDate;
    
    // Actualizar los campos de fecha en la UI
    document.getElementById('reportes-fecha-inicio').value = this.formatDateForInput(startDate);
    document.getElementById('reportes-fecha-fin').value = this.formatDateForInput(endDate);
  }

  /**
   * Configura los escuchadores de eventos en la interfaz
   */
  setupEventListeners() {
    // Filtros de fecha
    document.getElementById('reportes-fecha-inicio').addEventListener('change', (e) => {
      this.filters.startDate = new Date(e.target.value);
    });
    
    document.getElementById('reportes-fecha-fin').addEventListener('change', (e) => {
      this.filters.endDate = new Date(e.target.value);
    });
    
    // Selector de período predefinido
    document.getElementById('reportes-periodo').addEventListener('change', (e) => {
      const periodo = e.target.value;
      if (periodo !== 'personalizado') {
        const fechas = this.periodos[periodo];
        this.filters.startDate = fechas.startDate;
        this.filters.endDate = fechas.endDate;
        
        document.getElementById('reportes-fecha-inicio').value = this.formatDateForInput(fechas.startDate);
        document.getElementById('reportes-fecha-fin').value = this.formatDateForInput(fechas.endDate);
      }
    });
    
    // Filtros principales
    document.getElementById('reportes-sucursal').addEventListener('change', (e) => {
      this.filters.sucursal = e.target.value;
    });
    
    document.getElementById('reportes-usuario').addEventListener('change', (e) => {
      this.filters.usuario = e.target.value;
    });
    
    document.getElementById('reportes-tipo-comprobante').addEventListener('change', (e) => {
      this.filters.tipoComprobante = e.target.value;
    });
    
    document.getElementById('reportes-metodo-pago').addEventListener('change', (e) => {
      this.filters.metodoPago = e.target.value;
    });
    
    document.getElementById('reportes-cliente').addEventListener('input', (e) => {
      this.filters.cliente = e.target.value;
    });
    
    document.getElementById('reportes-min-total').addEventListener('input', (e) => {
      this.filters.minTotal = e.target.value;
    });
    
    document.getElementById('reportes-max-total').addEventListener('input', (e) => {
      this.filters.maxTotal = e.target.value;
    });
    
    // Botones de acción
    document.getElementById('btn-generar-reporte').addEventListener('click', () => {
      this.generarReporte();
    });
    
    document.getElementById('btn-exportar-pdf').addEventListener('click', () => {
      this.exportarPDF();
    });
    
    document.getElementById('btn-exportar-excel').addEventListener('click', () => {
      this.exportarExcel();
    });
    
    document.getElementById('btn-imprimir-reporte').addEventListener('click', () => {
      this.imprimirReporte();
    });
    
    // Pestañas del reporte
    document.querySelectorAll('.reporte-tab-btn').forEach(tabBtn => {
      tabBtn.addEventListener('click', (e) => {
        const tabId = e.target.dataset.tab;
        this.cambiarTab(tabId);
      });
    });
  }

  /**
   * Carga la lista de sucursales para el filtro
   */
  async loadSucursales() {
    try {
      const sucursales = await this.db.getAll('sucursales');
      const selectElement = document.getElementById('reportes-sucursal');
      
      // Opción por defecto (todas)
      selectElement.innerHTML = '<option value="todas">Todas las sucursales</option>';
      
      // Agregar cada sucursal
      sucursales.forEach(sucursal => {
        const option = document.createElement('option');
        option.value = sucursal.id;
        option.textContent = sucursal.nombre;
        selectElement.appendChild(option);
      });
      
      // Si el usuario no tiene permiso para ver todas las sucursales, restringir a su sucursal
      if (!this.permisos.verTodosReportes) {
        selectElement.value = this.currentUser.sucursalId;
        selectElement.disabled = true;
        this.filters.sucursal = this.currentUser.sucursalId;
      }
    } catch (error) {
      console.error('Error al cargar sucursales:', error);
      showNotification('Error al cargar la lista de sucursales', 'error');
    }
  }

  /**
   * Carga la lista de usuarios para el filtro
   */
  async loadUsuarios() {
    try {
      const usuarios = await this.db.getAll('usuarios');
      const selectElement = document.getElementById('reportes-usuario');
      
      // Opción por defecto (todos)
      selectElement.innerHTML = '<option value="todos">Todos los usuarios</option>';
      
      // Agregar cada usuario
      usuarios.forEach(usuario => {
        const option = document.createElement('option');
        option.value = usuario.id;
        option.textContent = `${usuario.nombre} ${usuario.apellido}`;
        selectElement.appendChild(option);
      });
      
      // Si el usuario no tiene permiso para ver todos los reportes, restringir a sus propias ventas
      if (!this.permisos.verTodosReportes) {
        selectElement.value = this.currentUser.id;
        selectElement.disabled = true;
        this.filters.usuario = this.currentUser.id;
      }
    } catch (error) {
      console.error('Error al cargar usuarios:', error);
      showNotification('Error al cargar la lista de usuarios', 'error');
    }
  }

  /**
   * Carga la lista de clientes para el filtro
   */
  async loadClientes() {
    try {
      const clientes = await this.db.getAll('clientes');
      const datalist = document.getElementById('clientes-list');
      
      // Limpiar datalist
      datalist.innerHTML = '';
      
      // Agregar cada cliente al datalist
      clientes.forEach(cliente => {
        const option = document.createElement('option');
        option.value = cliente.nombre;
        option.dataset.id = cliente.id;
        datalist.appendChild(option);
      });
    } catch (error) {
      console.error('Error al cargar clientes:', error);
      showNotification('Error al cargar la lista de clientes', 'error');
    }
  }

  /**
   * Carga los tipos de comprobante para el filtro
   */
  async loadTiposComprobante() {
    try {
      // Obtener tipos de comprobante desde la configuración
      const config = await this.db.get('configuracion', 'tipos_comprobante');
      const tipos = config?.tipos || ['Factura A', 'Factura B', 'Factura C', 'Factura X', 'Presupuesto'];
      
      const selectElement = document.getElementById('reportes-tipo-comprobante');
      
      // Opción por defecto (todos)
      selectElement.innerHTML = '<option value="todos">Todos los tipos</option>';
      
      // Agregar cada tipo
      tipos.forEach(tipo => {
        const option = document.createElement('option');
        option.value = tipo;
        option.textContent = tipo;
        selectElement.appendChild(option);
      });
    } catch (error) {
      console.error('Error al cargar tipos de comprobante:', error);
      showNotification('Error al cargar los tipos de comprobante', 'error');
    }
  }

  /**
   * Carga los métodos de pago para el filtro
   */
  async loadMetodosPago() {
    try {
      // Obtener métodos de pago desde la configuración
      const config = await this.db.get('configuracion', 'metodos_pago');
      const metodos = config?.metodos || ['Efectivo', 'Tarjeta de débito', 'Tarjeta de crédito', 'Transferencia', 'MercadoPago', 'Otro'];
      
      const selectElement = document.getElementById('reportes-metodo-pago');
      
      // Opción por defecto (todos)
      selectElement.innerHTML = '<option value="todos">Todos los métodos</option>';
      
      // Agregar cada método
      metodos.forEach(metodo => {
        const option = document.createElement('option');
        option.value = metodo;
        option.textContent = metodo;
        selectElement.appendChild(option);
      });
    } catch (error) {
      console.error('Error al cargar métodos de pago:', error);
      showNotification('Error al cargar los métodos de pago', 'error');
    }
  }

  /**
   * Genera el reporte de ventas según los filtros seleccionados
   */
  async generarReporte() {
    try {
      showNotification('Generando reporte...', 'info');
      document.getElementById('reporte-loading').classList.remove('hidden');
      
      // Construir consulta según filtros
      const query = this.buildQuery();
      
      // Obtener ventas filtradas
      const ventas = await this.db.query('ventas', query);
      this.reportData.ventas = ventas;
      
      // Calcular totales y estadísticas
      await this.calcularTotales(ventas);
      await this.calcularTopProductos(ventas);
      await this.calcularTopClientes(ventas);
      await this.generarEstadisticas(ventas);
      
      // Actualizar UI
      this.renderResumen();
      this.renderListadoVentas();
      this.renderGraficos();
      
      document.getElementById('reporte-loading').classList.add('hidden');
      showNotification('Reporte generado correctamente', 'success');
    } catch (error) {
      console.error('Error al generar reporte:', error);
      document.getElementById('reporte-loading').classList.add('hidden');
      showNotification('Error al generar el reporte', 'error');
    }
  }

  /**
   * Construye el objeto de consulta para la base de datos según los filtros
   * @returns {Object} Objeto de consulta para la BD
   */
  buildQuery() {
    const query = {
      where: []
    };
    
    // Filtro de fechas (siempre se aplica)
    query.where.push({
      field: 'fecha',
      operator: 'between',
      value: [
        this.filters.startDate.setHours(0, 0, 0, 0),
        this.filters.endDate.setHours(23, 59, 59, 999)
      ]
    });
    
    // Filtro de sucursal
    if (this.filters.sucursal !== 'todas') {
      query.where.push({
        field: 'sucursalId',
        operator: '=',
        value: this.filters.sucursal
      });
    }
    
    // Filtro de usuario
    if (this.filters.usuario !== 'todos') {
      query.where.push({
        field: 'usuarioId',
        operator: '=',
        value: this.filters.usuario
      });
    }
    
    // Filtro de tipo de comprobante
    if (this.filters.tipoComprobante !== 'todos') {
      query.where.push({
        field: 'tipoComprobante',
        operator: '=',
        value: this.filters.tipoComprobante
      });
    }
    
    // Filtro de método de pago
    if (this.filters.metodoPago !== 'todos') {
      query.where.push({
        field: 'metodoPago',
        operator: '=',
        value: this.filters.metodoPago
      });
    }
    
    // Filtro de cliente
    if (this.filters.cliente) {
      query.where.push({
        field: 'clienteNombre',
        operator: 'like',
        value: `%${this.filters.cliente}%`
      });
    }
    
    // Filtro de total mínimo
    if (this.filters.minTotal) {
      query.where.push({
        field: 'total',
        operator: '>=',
        value: parseFloat(this.filters.minTotal)
      });
    }
    
    // Filtro de total máximo
    if (this.filters.maxTotal) {
      query.where.push({
        field: 'total',
        operator: '<=',
        value: parseFloat(this.filters.maxTotal)
      });
    }
    
    // Ordenar por fecha descendente
    query.orderBy = { field: 'fecha', direction: 'desc' };
    
    return query;
  }

  /**
   * Calcula los totales de ventas por diferentes criterios
   * @param {Array} ventas Lista de ventas filtradas
   */
  async calcularTotales(ventas) {
    // Reiniciar totales
    this.reportData.totales = {
      cantidad: ventas.length,
      monto: 0,
      efectivo: 0,
      tarjeta: 0,
      transferencia: 0,
      mercadoPago: 0,
      otrosMedios: 0,
      iva: 0,
      impuestos: 0,
      neto: 0
    };
    
    // Calcular totales por método de pago y generales
    ventas.forEach(venta => {
      this.reportData.totales.monto += venta.total;
      
      // Sumar al método de pago correspondiente
      switch (venta.metodoPago) {
        case 'Efectivo':
          this.reportData.totales.efectivo += venta.total;
          break;
        case 'Tarjeta de débito':
        case 'Tarjeta de crédito':
          this.reportData.totales.tarjeta += venta.total;
          break;
        case 'Transferencia':
          this.reportData.totales.transferencia += venta.total;
          break;
        case 'MercadoPago':
          this.reportData.totales.mercadoPago += venta.total;
          break;
        default:
          this.reportData.totales.otrosMedios += venta.total;
          break;
      }
      
      // Sumar impuestos si tiene permiso
      if (this.permisos.verDetalleImpuestos) {
        this.reportData.totales.iva += venta.totalIva || 0;
        this.reportData.totales.impuestos += venta.totalImpuestos || 0;
        this.reportData.totales.neto += venta.totalNeto || 0;
      }
    });
  }

  /**
   * Calcula los productos más vendidos
   * @param {Array} ventas Lista de ventas filtradas
   */
  async calcularTopProductos(ventas) {
    // Mapa para contar productos y montos
    const productosMap = new Map();
    
    // Recorrer todas las ventas y sus items
    for (const venta of ventas) {
      try {
        // Obtener detalles de la venta
        const detalleVenta = await this.db.getAll('ventas_items', { ventaId: venta.id });
        
        for (const item of detalleVenta) {
          const productoId = item.productoId;
          const cantidad = item.cantidad;
          const subtotal = item.subtotal;
          
          if (productosMap.has(productoId)) {
            const producto = productosMap.get(productoId);
            producto.cantidad += cantidad;
            producto.total += subtotal;
          } else {
            // Obtener datos del producto
            const productoInfo = await this.db.get('productos', productoId);
            productosMap.set(productoId, {
              id: productoId,
              nombre: productoInfo?.nombre || 'Producto desconocido',
              cantidad: cantidad,
              total: subtotal,
              codigo: productoInfo?.codigo || '',
              categoria: productoInfo?.categoria || 'Sin categoría'
            });
          }
        }
      } catch (error) {
        console.error(`Error al procesar venta ID ${venta.id}:`, error);
      }
    }
    
    // Convertir el mapa a array y ordenar por cantidad vendida
    this.reportData.productos = Array.from(productosMap.values())
      .sort((a, b) => b.cantidad - a.cantidad)
      .slice(0, 10); // Top 10 productos
  }

  /**
   * Calcula los clientes con más compras
   * @param {Array} ventas Lista de ventas filtradas
   */
  async calcularTopClientes(ventas) {
    // Mapa para contar clientes y montos
    const clientesMap = new Map();
    
    // Recorrer todas las ventas
    for (const venta of ventas) {
      const clienteId = venta.clienteId;
      const total = venta.total;
      
      if (clientesMap.has(clienteId)) {
        const cliente = clientesMap.get(clienteId);
        cliente.cantidadCompras += 1;
        cliente.totalCompras += total;
      } else {
        try {
          // Obtener datos del cliente
          const clienteInfo = await this.db.get('clientes', clienteId);
          clientesMap.set(clienteId, {
            id: clienteId,
            nombre: clienteInfo?.nombre || 'Cliente desconocido',
            cantidadCompras: 1,
            totalCompras: total,
            telefono: clienteInfo?.telefono || '',
            email: clienteInfo?.email || ''
          });
        } catch (error) {
          console.error(`Error al obtener cliente ID ${clienteId}:`, error);
          clientesMap.set(clienteId, {
            id: clienteId,
            nombre: 'Cliente desconocido',
            cantidadCompras: 1,
            totalCompras: total,
            telefono: '',
            email: ''
          });
        }
      }
    }
    
    // Convertir el mapa a array y ordenar por total de compras
    this.reportData.clientes = Array.from(clientesMap.values())
      .sort((a, b) => b.totalCompras - a.totalCompras)
      .slice(0, 10); // Top 10 clientes
  }

  /**
   * Genera estadísticas adicionales para el reporte
   * @param {Array} ventas Lista de ventas filtradas
   */
  async generarEstadisticas(ventas) {
    // Inicializar objeto de estadísticas
    this.reportData.estadisticas = {
      ventasPorDia: {},
      ventasPorHora: {},
      ventasPorSucursal: {},
      ticketPromedio: 0,
      comparativaPeriodoAnterior: {
        cantidadVentas: 0,
        montoTotal: 0,
        variacionCantidad: 0,
        variacionMonto: 0
      }
    };
    
    // Ventas por día
    ventas.forEach(venta => {
      const fecha = new Date(venta.fecha).toISOString().split('T')[0];
      if (!this.reportData.estadisticas.ventasPorDia[fecha]) {
        this.reportData.estadisticas.ventasPorDia[fecha] = {
          cantidad: 0,
          monto: 0
        };
      }
      this.reportData.estadisticas.ventasPorDia[fecha].cantidad += 1;
      this.reportData.estadisticas.ventasPorDia[fecha].monto += venta.total;
    });
    
    // Ventas por hora
    ventas.forEach(venta => {
      const hora = new Date(venta.fecha).getHours();
      if (!this.reportData.estadisticas.ventasPorHora[hora]) {
        this.reportData.estadisticas.ventasPorHora[hora] = {
          cantidad: 0,
          monto: 0
        };
      }
      this.reportData.estadisticas.ventasPorHora[hora].cantidad += 1;
      this.reportData.estadisticas.ventasPorHora[hora].monto += venta.total;
    });
    
    // Ventas por sucursal
    if (this.filters.sucursal === 'todas') {
      const sucursalesMap = new Map();
      
      // Agrupar ventas por sucursal
      for (const venta of ventas) {
        const sucursalId = venta.sucursalId;
        
        if (sucursalesMap.has(sucursalId)) {
          const sucursal = sucursalesMap.get(sucursalId);
          sucursal.cantidad += 1;
          sucursal.monto += venta.total;
        } else {
          try {
            // Obtener datos de la sucursal
            const sucursalInfo = await this.db.get('sucursales', sucursalId);
            sucursalesMap.set(sucursalId, {
              id: sucursalId,
              nombre: sucursalInfo?.nombre || 'Sucursal desconocida',
              cantidad: 1,
              monto: venta.total
            });
          } catch (error) {
            console.error(`Error al obtener sucursal ID ${sucursalId}:`, error);
            sucursalesMap.set(sucursalId, {
              id: sucursalId,
              nombre: 'Sucursal desconocida',
              cantidad: 1,
              monto: venta.total
            });
          }
        }
      }
      
      // Convertir a objeto para estadísticas
      sucursalesMap.forEach(sucursal => {
        this.reportData.estadisticas.ventasPorSucursal[sucursal.nombre] = {
          cantidad: sucursal.cantidad,
          monto: sucursal.monto
        };
      });
    }
    
    // Ticket promedio
    if (ventas.length > 0) {
      this.reportData.estadisticas.ticketPromedio = this.reportData.totales.monto / ventas.length;
    }
    
    // Comparativa con período anterior
    await this.calcularComparativaPeriodoAnterior();
  }

  /**
   * Calcula comparativa con el período anterior
   */
  async calcularComparativaPeriodoAnterior() {
    try {
      // Calcular la duración del período actual en días
      const duracionPeriodo = Math.ceil((this.filters.endDate - this.filters.startDate) / (1000 * 60 * 60 * 24)) + 1;
      
      // Calcular fechas del período anterior
      const inicioAnterior = new Date(this.filters.startDate);
      inicioAnterior.setDate(inicioAnterior.getDate() - duracionPeriodo);
      
      const finAnterior = new Date(this.filters.endDate);
      finAnterior.setDate(finAnterior.getDate() - duracionPeriodo);
      
      // Construir consulta para período anterior
      const queryAnterior = {
        where: [
          {
            field: 'fecha',
            operator: 'between',
            value: [
              inicioAnterior.setHours(0, 0, 0, 0),
              finAnterior.setHours(23, 59, 59, 999)
            ]
          }
        ]
      };
      
      // Filtros adicionales que deben mantenerse constantes
      if (this.filters.sucursal !== 'todas') {
        queryAnterior.where.push({
          field: 'sucursalId',
          operator: '=',
          value: this.filters.sucursal
        });
      }
      
      if (this.filters.tipoComprobante !== 'todos') {
        queryAnterior.where.push({
          field: 'tipoComprobante',
          operator: '=',
          value: this.filters.tipoComprobante
        });
      }
      
      // Obtener ventas del período anterior
      const ventasAnteriores = await this.db.query('ventas', queryAnterior);
      
      // Calcular totales del período anterior
      let montoAnterior = 0;
      ventasAnteriores.forEach(venta => {
        montoAnterior += venta.total;
      });
      
      // Guardar datos para comparativa
      const comparativa = this.reportData.estadisticas.comparativaPeriodoAnterior;
      comparativa.cantidadVentas = ventasAnteriores.length;
      comparativa.montoTotal = montoAnterior;
      
      // Calcular variaciones porcentuales
      if (ventasAnteriores.length > 0) {
        comparativa.variacionCantidad = ((ventas.length - ventasAnteriores.length) / ventasAnteriores.length) * 100;
        comparativa.variacionMonto = ((this.reportData.totales.monto - montoAnterior) / montoAnterior) * 100;
      } else {
        comparativa.variacionCantidad = 100; // 100% de aumento si antes no había ventas
        comparativa.variacionMonto = 100;
      }
    } catch (error) {
      console.error('Error al calcular comparativa con período anterior:', error);
    }
  }

  /**
   * Renderiza el resumen del reporte en la UI
   */
  renderResumen() {
    const totales = this.reportData.totales;
    
    // Actualizar elementos del resumen
    document.getElementById('resumen-total-ventas').textContent = totales.cantidad;
    document.getElementById('resumen-monto-total').textContent = formatCurrency(totales.monto);
    document.getElementById('resumen-efectivo').textContent = formatCurrency(totales.efectivo);
    document.getElementById('resumen-tarjeta').textContent = formatCurrency(totales.tarjeta);
    document.getElementById('resumen-transferencia').textContent = formatCurrency(totales.transferencia);
    document.getElementById('resumen-mercado-pago').textContent = formatCurrency(totales.mercadoPago);
    document.getElementById('resumen-otros-medios').textContent = formatCurrency(totales.otrosMedios);
    
    // Mostrar datos de impuestos si tiene permiso
    const impuestosContainer = document.getElementById('resumen-impuestos-container');
    if (this.permisos.verDetalleImpuestos) {
      impuestosContainer.classList.remove('hidden');
      document.getElementById('resumen-neto').textContent = formatCurrency(totales.neto);
      document.getElementById('resumen-iva').textContent = formatCurrency(totales.iva);
      document.getElementById('resumen-otros-impuestos').textContent = formatCurrency(totales.impuestos);
    } else {
      impuestosContainer.classList.add('hidden');
    }
    
    // Ticket promedio
    document.getElementById('resumen-ticket-promedio').textContent = formatCurrency(this.reportData.estadisticas.ticketPromedio);
    
    // Comparativa con período anterior
    const comparativa = this.reportData.estadisticas.comparativaPeriodoAnterior;
    const compContainer = document.getElementById('comparativa-container');
    compContainer.innerHTML = '';
    
    if (comparativa) {
      const periodoDuracion = Math.ceil((this.filters.endDate - this.filters.startDate) / (1000 * 60 * 60 * 24)) + 1;
      
      const compElement = document.createElement('div');
      compElement.className = 'comparativa-info';
      compElement.innerHTML = `
        <h4>Comparativa con período anterior (${periodoDuracion} días)</h4>
        <div class="comp-row">
          <div class="comp-col">
            <span class="comp-label">Ventas anteriores:</span> 
            <span class="comp-value">${comparativa.cantidadVentas}</span>
          </div>
          <div class="comp-col">
            <span class="comp-label">Monto anterior:</span> 
            <span class="comp-value">${formatCurrency(comparativa.montoTotal)}</span>
          </div>
        </div>
        <div class="comp-row">
          <div class="comp-col">
            <span class="comp-label">Variación en cantidad:</span> 
            <span class="comp-value ${comparativa.variacionCantidad >= 0 ? 'positive' : 'negative'}">
              ${comparativa.variacionCantidad >= 0 ? '+' : ''}${comparativa.variacionCantidad.toFixed(2)}%
            </span>
          </div>
          <div class="comp-col">
            <span class="comp-label">Variación en monto:</span> 
            <span class="comp-value ${comparativa.variacionMonto >= 0 ? 'positive' : 'negative'}">
              ${comparativa.variacionMonto >= 0 ? '+' : ''}${comparativa.variacionMonto.toFixed(2)}%
            </span>
          </div>
        </div>
      `;
      
      compContainer.appendChild(compElement);
    }
    
    // Renderizar top productos y clientes
    this.renderTopProductos();
    this.renderTopClientes();
  }

  /**
   * Renderiza el top de productos vendidos
   */
  renderTopProductos() {
    const container = document.getElementById('top-productos-container');
    container.innerHTML = '';
    
    if (this.reportData.productos.length === 0) {
      container.innerHTML = '<p class="no-data">No hay datos de productos para mostrar</p>';
      return;
    }
    
    const table = document.createElement('table');
    table.className = 'reporte-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th>#</th>
          <th>Código</th>
          <th>Producto</th>
          <th>Categoría</th>
          <th>Unidades</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody id="top-productos-tbody"></tbody>
    `;
    
    container.appendChild(table);
    const tbody = document.getElementById('top-productos-tbody');
    
    this.reportData.productos.forEach((producto, index) => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${index + 1}</td>
        <td>${producto.codigo}</td>
        <td>${producto.nombre}</td>
        <td>${producto.categoria}</td>
        <td class="text-right">${producto.cantidad}</td>
        <td class="text-right">${formatCurrency(producto.total)}</td>
      `;
      tbody.appendChild(row);
    });
  }

  /**
   * Renderiza el top de clientes
   */
  renderTopClientes() {
    const container = document.getElementById('top-clientes-container');
    container.innerHTML = '';
    
    if (this.reportData.clientes.length === 0) {
      container.innerHTML = '<p class="no-data">No hay datos de clientes para mostrar</p>';
      return;
    }
    
    const table = document.createElement('table');
    table.className = 'reporte-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th>#</th>
          <th>Cliente</th>
          <th>Contacto</th>
          <th>Compras</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody id="top-clientes-tbody"></tbody>
    `;
    
    container.appendChild(table);
    const tbody = document.getElementById('top-clientes-tbody');
    
    this.reportData.clientes.forEach((cliente, index) => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${index + 1}</td>
        <td>${cliente.nombre}</td>
        <td>${cliente.telefono || ''} ${cliente.email ? `<br>${cliente.email}` : ''}</td>
        <td class="text-right">${cliente.cantidadCompras}</td>
        <td class="text-right">${formatCurrency(cliente.totalCompras)}</td>
      `;
      tbody.appendChild(row);
    });
  }

  /**
   * Renderiza el listado de ventas detallado
   */
  renderListadoVentas() {
    const container = document.getElementById('listado-ventas-container');
    container.innerHTML = '';
    
    if (this.reportData.ventas.length === 0) {
      container.innerHTML = '<p class="no-data">No hay ventas para el período seleccionado</p>';
      return;
    }
    
    const table = document.createElement('table');
    table.className = 'reporte-table ventas-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th>Fecha</th>
          <th>Comprobante</th>
          <th>Cliente</th>
          <th>Usuario</th>
          <th>Método de Pago</th>
          <th>Total</th>
          <th>Acciones</th>
        </tr>
      </thead>
      <tbody id="ventas-tbody"></tbody>
    `;
    
    container.appendChild(table);
    const tbody = document.getElementById('ventas-tbody');
    
    this.reportData.ventas.forEach(venta => {
      const row = document.createElement('tr');
      row.dataset.ventaId = venta.id;
      
      const fecha = new Date(venta.fecha);
      
      row.innerHTML = `
        <td>${formatDate(fecha)} ${fecha.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
        <td>${venta.tipoComprobante} ${venta.numeroComprobante || ''}</td>
        <td>${venta.clienteNombre}</td>
        <td>${venta.usuarioNombre || 'N/A'}</td>
        <td>${venta.metodoPago}</td>
        <td class="text-right">${formatCurrency(venta.total)}</td>
        <td class="actions-cell">
          <button class="btn-view-venta" title="Ver detalle"><i class="fa fa-eye"></i></button>
          <button class="btn-print-venta" title="Imprimir"><i class="fa fa-print"></i></button>
          ${venta.tipoComprobante !== 'Presupuesto' ? `<button class="btn-send-venta" title="Enviar"><i class="fa fa-paper-plane"></i></button>` : ''}
        </td>
      `;
      
      tbody.appendChild(row);
      
      // Agregar eventos a los botones
      row.querySelector('.btn-view-venta').addEventListener('click', () => {
        this.verDetalleVenta(venta.id);
      });
      
      row.querySelector('.btn-print-venta').addEventListener('click', () => {
        this.imprimirComprobante(venta.id);
      });
      
      if (venta.tipoComprobante !== 'Presupuesto') {
        row.querySelector('.btn-send-venta').addEventListener('click', () => {
          this.enviarComprobante(venta.id);
        });
      }
    });
  }

  /**
   * Renderiza los gráficos estadísticos
   */
  async renderGraficos() {
    try {
      // Asegurarse que Chart.js está cargado
      if (typeof Chart === 'undefined') {
        await this.loadChartJS();
      }
      
      // Destruir gráficos existentes para evitar duplicados
      this.destroyCharts();
      
      // Renderizar gráficos si hay datos
      if (this.reportData.ventas.length === 0) {
        document.getElementById('graficos-container').innerHTML = '<p class="no-data">No hay datos suficientes para generar gráficos</p>';
        return;
      }
      
      // Crear contenedores para gráficos
      const graficosContainer = document.getElementById('graficos-container');
      graficosContainer.innerHTML = `
        <div class="graficos-row">
          <div class="grafico-col">
            <div class="chart-container">
              <h4>Ventas por día</h4>
              <canvas id="chart-ventas-por-dia"></canvas>
            </div>
          </div>
          <div class="grafico-col">
            <div class="chart-container">
              <h4>Ventas por hora</h4>
              <canvas id="chart-ventas-por-hora"></canvas>
            </div>
          </div>
        </div>
        <div class="graficos-row">
          <div class="grafico-col">
            <div class="chart-container">
              <h4>Métodos de pago</h4>
              <canvas id="chart-metodos-pago"></canvas>
            </div>
          </div>
          <div class="grafico-col" id="sucursales-chart-container">
            <div class="chart-container">
              <h4>Ventas por sucursal</h4>
              <canvas id="chart-ventas-por-sucursal"></canvas>
            </div>
          </div>
        </div>
      `;
      
      // Ocultar gráfico de sucursales si solo hay una seleccionada
      if (this.filters.sucursal !== 'todas') {
        document.getElementById('sucursales-chart-container').style.display = 'none';
      }
      
      // Crear gráficos
      this.createVentasPorDiaChart();
      this.createVentasPorHoraChart();
      this.createMetodosPagoChart();
      
      if (this.filters.sucursal === 'todas') {
        this.createVentasPorSucursalChart();
      }
      
    } catch (error) {
      console.error('Error al renderizar gráficos:', error);
      document.getElementById('graficos-container').innerHTML = '<p class="error-message">Error al generar los gráficos</p>';
    }
  }

  /**
   * Carga Chart.js si no está disponible
   * @returns {Promise} Promesa que se resuelve cuando Chart.js está cargado
   */
  loadChartJS() {
    return new Promise((resolve, reject) => {
      if (typeof Chart !== 'undefined') {
        resolve();
        return;
      }
      
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/3.7.0/chart.min.js';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('No se pudo cargar Chart.js'));
      document.head.appendChild(script);
    });
  }

  /**
   * Destruye los gráficos existentes para evitar duplicados
   */
  destroyCharts() {
    window.reportCharts = window.reportCharts || {};
    
    Object.values(window.reportCharts).forEach(chart => {
      if (chart && typeof chart.destroy === 'function') {
        chart.destroy();
      }
    });
    
    window.reportCharts = {};
  }

  /**
   * Crea el gráfico de ventas por día
   */
  createVentasPorDiaChart() {
    const ctx = document.getElementById('chart-ventas-por-dia').getContext('2d');
    const ventasPorDia = this.reportData.estadisticas.ventasPorDia;
    
    // Ordenar fechas
    const fechas = Object.keys(ventasPorDia).sort();
    const datos = fechas.map(fecha => ventasPorDia[fecha].monto);
    const cantidades = fechas.map(fecha => ventasPorDia[fecha].cantidad);
    
    // Formatear fechas para mostrar
    const fechasFormateadas = fechas.map(fecha => {
      const parts = fecha.split('-');
      return `${parts[2]}/${parts[1]}`;
    });
    
    window.reportCharts.ventasPorDia = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: fechasFormateadas,
        datasets: [
          {
            label: 'Monto ($)',
            data: datos,
            backgroundColor: 'rgba(54, 162, 235, 0.5)',
            borderColor: 'rgba(54, 162, 235, 1)',
            borderWidth: 1,
            yAxisID: 'y'
          },
          {
            label: 'Cantidad de ventas',
            data: cantidades,
            type: 'line',
            fill: false,
            backgroundColor: 'rgba(255, 99, 132, 0.5)',
            borderColor: 'rgba(255, 99, 132, 1)',
            borderWidth: 2,
            tension: 0.1,
            yAxisID: 'y1'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true,
            position: 'left',
            title: {
              display: true,
              text: 'Monto ($)'
            }
          },
          y1: {
            beginAtZero: true,
            position: 'right',
            grid: {
              drawOnChartArea: false
            },
            title: {
              display: true,
              text: 'Cantidad'
            }
          }
        }
      }
    });
  }

  /**
   * Crea el gráfico de ventas por hora
   */
  createVentasPorHoraChart() {
    const ctx = document.getElementById('chart-ventas-por-hora').getContext('2d');
    const ventasPorHora = this.reportData.estadisticas.ventasPorHora;
    
    // Ordenar horas
    const horas = Array.from({ length: 24 }, (_, i) => i);
    const datos = horas.map(hora => (ventasPorHora[hora] || { monto: 0 }).monto);
    const cantidades = horas.map(hora => (ventasPorHora[hora] || { cantidad: 0 }).cantidad);
    
    // Formatear horas para mostrar (formato 24h)
    const horasFormateadas = horas.map(hora => `${hora}:00`);
    
    window.reportCharts.ventasPorHora = new Chart(ctx, {
      type: 'line',
      data: {
        labels: horasFormateadas,
        datasets: [
          {
            label: 'Monto ($)',
            data: datos,
            backgroundColor: 'rgba(75, 192, 192, 0.5)',
            borderColor: 'rgba(75, 192, 192, 1)',
            borderWidth: 2,
            tension: 0.3,
            yAxisID: 'y'
          },
          {
            label: 'Cantidad de ventas',
            data: cantidades,
            backgroundColor: 'rgba(153, 102, 255, 0.5)',
            borderColor: 'rgba(153, 102, 255, 1)',
            borderWidth: 2,
            tension: 0.3,
            yAxisID: 'y1'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true,
            position: 'left',
            title: {
              display: true,
              text: 'Monto ($)'
            }
          },
          y1: {
            beginAtZero: true,
            position: 'right',
            grid: {
              drawOnChartArea: false
            },
            title: {
              display: true,
              text: 'Cantidad'
            }
          }
        }
      }
    });
  }

  /**
   * Crea el gráfico circular de métodos de pago
   */
  createMetodosPagoChart() {
    const ctx = document.getElementById('chart-metodos-pago').getContext('2d');
    const totales = this.reportData.totales;
    
    const datos = [
      totales.efectivo,
      totales.tarjeta,
      totales.transferencia,
      totales.mercadoPago,
      totales.otrosMedios
    ];
    
    window.reportCharts.metodosPago = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Efectivo', 'Tarjetas', 'Transferencia', 'MercadoPago', 'Otros'],
        datasets: [{
          data: datos,
          backgroundColor: [
            'rgba(255, 206, 86, 0.7)',
            'rgba(54, 162, 235, 0.7)',
            'rgba(75, 192, 192, 0.7)',
            'rgba(153, 102, 255, 0.7)',
            'rgba(255, 159, 64, 0.7)'
          ],
          borderColor: [
            'rgba(255, 206, 86, 1)',
            'rgba(54, 162, 235, 1)',
            'rgba(75, 192, 192, 1)',
            'rgba(153, 102, 255, 1)',
            'rgba(255, 159, 64, 1)'
          ],
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          tooltip: {
            callbacks: {
              label: function(context) {
                const label = context.label || '';
                const value = context.raw;
                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                const percentage = Math.round((value / total) * 100);
                return `${label}: ${formatCurrency(value)} (${percentage}%)`;
              }
            }
          }
        }
      }
    });
  }

  /**
   * Crea el gráfico de ventas por sucursal
   */
  createVentasPorSucursalChart() {
    const ctx = document.getElementById('chart-ventas-por-sucursal').getContext('2d');
    const ventasPorSucursal = this.reportData.estadisticas.ventasPorSucursal;
    
    // Extraer datos
    const sucursales = Object.keys(ventasPorSucursal);
    const montos = sucursales.map(sucursal => ventasPorSucursal[sucursal].monto);
    const cantidades = sucursales.map(sucursal => ventasPorSucursal[sucursal].cantidad);
    
    window.reportCharts.ventasPorSucursal = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: sucursales,
        datasets: [
          {
            label: 'Monto ($)',
            data: montos,
            backgroundColor: 'rgba(255, 99, 132, 0.5)',
            borderColor: 'rgba(255, 99, 132, 1)',
            borderWidth: 1,
            yAxisID: 'y'
          },
          {
            label: 'Cantidad',
            data: cantidades,
            backgroundColor: 'rgba(255, 159, 64, 0.5)',
            borderColor: 'rgba(255, 159, 64, 1)',
            borderWidth: 1,
            yAxisID: 'y1'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true,
            position: 'left',
            title: {
              display: true,
              text: 'Monto ($)'
            }
          },
          y1: {
            beginAtZero: true,
            position: 'right',
            grid: {
              drawOnChartArea: false
            },
            title: {
              display: true,
              text: 'Cantidad'
            }
          }
        }
      }
    });
  }

  /**
   * Cambia entre pestañas de reporte
   * @param {string} tabId ID de la pestaña a mostrar
   */
  cambiarTab(tabId) {
    // Ocultar todas las pestañas
    document.querySelectorAll('.reporte-tab').forEach(tab => {
      tab.classList.add('hidden');
    });
    
    // Desactivar todos los botones
    document.querySelectorAll('.reporte-tab-btn').forEach(btn => {
      btn.classList.remove('active');
    });
    
    // Mostrar la pestaña seleccionada
    document.getElementById(`tab-${tabId}`).classList.remove('hidden');
    
    // Activar el botón correspondiente
    document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');
  }

  /**
   * Muestra el detalle de una venta específica
   * @param {string} ventaId ID de la venta a mostrar
   */
  async verDetalleVenta(ventaId) {
    try {
      showNotification('Cargando detalle de venta...', 'info');
      
      // Obtener datos de la venta
      const venta = await this.db.get('ventas', ventaId);
      if (!venta) {
        showNotification('Venta no encontrada', 'error');
        return;
      }
      
      // Obtener items de la venta
      const items = await this.db.getAll('ventas_items', { ventaId });
      
      // Crear modal
      const modalId = 'modal-detalle-venta';
      const modalContent = document.createElement('div');
      modalContent.className = 'modal-content';
      
      // Datos generales de la venta
      const fecha = new Date(venta.fecha);
      modalContent.innerHTML = `
        <div class="modal-header">
          <h3>Detalle de Venta #${venta.numeroComprobante || ventaId}</h3>
          <button class="close-modal">&times;</button>
        </div>
        <div class="modal-body">
          <div class="venta-info">
            <div class="venta-info-col">
              <p><strong>Fecha:</strong> ${formatDate(fecha)} ${fecha.toLocaleTimeString()}</p>
              <p><strong>Cliente:</strong> ${venta.clienteNombre}</p>
              <p><strong>Usuario:</strong> ${venta.usuarioNombre || 'N/A'}</p>
            </div>
            <div class="venta-info-col">
              <p><strong>Tipo:</strong> ${venta.tipoComprobante}</p>
              <p><strong>Método de pago:</strong> ${venta.metodoPago}</p>
              <p><strong>Sucursal:</strong> ${venta.sucursalNombre || 'N/A'}</p>
            </div>
          </div>
          
          <h4>Productos</h4>
          <table class="reporte-table items-table">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Cantidad</th>
                <th>Precio U.</th>
                <th>Descuento</th>
                <th>Subtotal</th>
              </tr>
            </thead>
            <tbody id="items-venta-tbody"></tbody>
          </table>
          
          <div class="venta-totales">
            <div class="venta-totales-row">
              <span>Subtotal:</span>
              <span>${formatCurrency(venta.subtotal || 0)}</span>
            </div>
            ${venta.descuento ? `
            <div class="venta-totales-row">
              <span>Descuento (${venta.descuentoPorcentaje || 0}%):</span>
              <span>-${formatCurrency(venta.descuento)}</span>
            </div>
            ` : ''}
            ${venta.recargo ? `
            <div class="venta-totales-row">
              <span>Recargo (${venta.recargoPorcentaje || 0}%):</span>
              <span>+${formatCurrency(venta.recargo)}</span>
            </div>
            ` : ''}
            ${this.permisos.verDetalleImpuestos && venta.totalIva ? `
            <div class="venta-totales-row">
              <span>IVA:</span>
              <span>${formatCurrency(venta.totalIva)}</span>
            </div>
            ` : ''}
            ${this.permisos.verDetalleImpuestos && venta.totalImpuestos ? `
            <div class="venta-totales-row">
              <span>Otros impuestos:</span>
              <span>${formatCurrency(venta.totalImpuestos)}</span>
            </div>
            ` : ''}
            <div class="venta-totales-row total">
              <span>TOTAL:</span>
              <span>${formatCurrency(venta.total)}</span>
            </div>
          </div>
          
          ${venta.observaciones ? `
          <div class="venta-observaciones">
            <h4>Observaciones</h4>
            <p>${venta.observaciones}</p>
          </div>
          ` : ''}
        </div>
        <div class="modal-footer">
          <button id="btn-imprimir-detalle" class="btn-primary">Imprimir</button>
          <button id="btn-enviar-detalle" class="btn-secondary">Enviar</button>
          <button class="btn-close">Cerrar</button>
        </div>
      `;
      
      // Crear modal en DOM
      const modal = this.createModal(modalId, modalContent);
      
      // Llenar tabla de items
      const tbody = document.getElementById('items-venta-tbody');
      items.forEach(item => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${item.productoNombre}</td>
          <td class="text-right">${item.cantidad}</td>
          <td class="text-right">${formatCurrency(item.precioUnitario)}</td>
          <td class="text-right">${item.descuento ? formatCurrency(item.descuento) : '-'}</td>
          <td class="text-right">${formatCurrency(item.subtotal)}</td>
        `;
        tbody.appendChild(row);
      });
      
      // Eventos para botones
      document.getElementById('btn-imprimir-detalle').addEventListener('click', () => {
        this.imprimirComprobante(ventaId);
      });
      
      document.getElementById('btn-enviar-detalle').addEventListener('click', () => {
        this.enviarComprobante(ventaId);
        modal.remove();
      });
      
      document.querySelector(`#${modalId} .btn-close`).addEventListener('click', () => {
        modal.remove();
      });
      
      document.querySelector(`#${modalId} .close-modal`).addEventListener('click', () => {
        modal.remove();
      });
    } catch (error) {
      console.error('Error al mostrar detalle de venta:', error);
      showNotification('Error al cargar el detalle de la venta', 'error');
    }
  }

  /**
   * Crea un modal en el DOM
   * @param {string} id ID para el modal
   * @param {HTMLElement} content Contenido del modal
   * @returns {HTMLElement} El elemento modal creado
   */
  createModal(id, content) {
    // Eliminar modal existente con el mismo ID si existe
    const existingModal = document.getElementById(id);
    if (existingModal) {
      existingModal.remove();
    }
    
    // Crear el contenedor modal
    const modal = document.createElement('div');
    modal.id = id;
    modal.className = 'modal';
    
    // Añadir contenido al modal
    modal.appendChild(content);
    
    // Añadir modal al DOM
    document.body.appendChild(modal);
    
    // Mostrar modal
    setTimeout(() => {
      modal.classList.add('show');
    }, 10);
    
    // Permitir cerrar haciendo clic fuera
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    });
    
    return modal;
  }

  /**
   * Imprime un comprobante de venta
   * @param {string} ventaId ID de la venta a imprimir
   */
  async imprimirComprobante(ventaId) {
    try {
      showNotification('Preparando impresión...', 'info');
      
      // Obtener datos de la venta
      const venta = await this.db.get('ventas', ventaId);
      if (!venta) {
        showNotification('Venta no encontrada', 'error');
        return;
      }
      
      // Obtener items de la venta
      const items = await this.db.getAll('ventas_items', { ventaId });
      
      // Enviar a imprimir
      await printDocument({
        tipo: 'comprobante',
        data: {
          venta,
          items,
          config: await this.getConfiguracionImpresion()
        }
      });
      
      showNotification('Comprobante enviado a la impresora', 'success');
    } catch (error) {
      console.error('Error al imprimir comprobante:', error);
      showNotification('Error al imprimir el comprobante', 'error');
    }
  }

  /**
   * Envía un comprobante por correo electrónico
   * @param {string} ventaId ID de la venta a enviar
   */
  async enviarComprobante(ventaId) {
    try {
      // Obtener datos de la venta
      const venta = await this.db.get('ventas', ventaId);
      if (!venta) {
        showNotification('Venta no encontrada', 'error');
        return;
      }
      
      // Verificar si el cliente tiene correo electrónico
      const cliente = await this.db.get('clientes', venta.clienteId);
      if (!cliente || !cliente.email) {
        showNotification('El cliente no tiene correo electrónico registrado', 'warning');
        return;
      }
      
      // Crear modal para confirmación
      const modalId = 'modal-enviar-comprobante';
      const modalContent = document.createElement('div');
      modalContent.className = 'modal-content';
      
      modalContent.innerHTML = `
        <div class="modal-header">
          <h3>Enviar Comprobante</h3>
          <button class="close-modal">&times;</button>
        </div>
        <div class="modal-body">
          <form id="form-enviar-comprobante">
            <div class="form-group">
              <label for="email-destino">Correo electrónico:</label>
              <input type="email" id="email-destino" value="${cliente.email}" required>
            </div>
            <div class="form-group">
              <label for="asunto-email">Asunto:</label>
              <input type="text" id="asunto-email" value="Comprobante ${venta.tipoComprobante} N° ${venta.numeroComprobante || ''}" required>
            </div>
            <div class="form-group">
              <label for="mensaje-email">Mensaje:</label>
              <textarea id="mensaje-email" rows="4">Estimado/a ${cliente.nombre},

Adjunto encontrará su comprobante de compra. Gracias por su preferencia.

Saludos cordiales,
${this.currentUser.nombre} ${this.currentUser.apellido}
${auth.getSucursalActual().nombre}</textarea>
            </div>
            <div class="form-check">
              <input type="checkbox" id="adjuntar-pdf" checked>
              <label for="adjuntar-pdf">Adjuntar comprobante en PDF</label>
            </div>
          </form>
        </div>
        <div class="modal-footer">
          <button id="btn-enviar-email" class="btn-primary">Enviar</button>
          <button class="btn-close">Cancelar</button>
        </div>
      `;
      
      // Crear modal en DOM
      const modal = this.createModal(modalId, modalContent);
      
      // Evento para enviar correo
      document.getElementById('btn-enviar-email').addEventListener('click', async () => {
        const emailDestino = document.getElementById('email-destino').value;
        const asunto = document.getElementById('asunto-email').value;
        const mensaje = document.getElementById('mensaje-email').value;
        const adjuntarPdf = document.getElementById('adjuntar-pdf').checked;
        
        if (!emailDestino || !asunto) {
          showNotification('Complete todos los campos obligatorios', 'warning');
          return;
        }
        
        try {
          showNotification('Enviando correo...', 'info');
          
          // Obtener items de la venta
          const items = await this.db.getAll('ventas_items', { ventaId });
          
          // Enviar correo utilizando el servicio de IPC
          await ipcRenderer.invoke('enviar-email', {
            para: emailDestino,
            asunto: asunto,
            mensaje: mensaje,
            adjunto: adjuntarPdf ? {
              tipo: 'comprobante',
              data: {
                venta,
                items,
                config: await this.getConfiguracionImpresion()
              }
            } : null
          });
          
          modal.remove();
          showNotification('Correo enviado correctamente', 'success');
        } catch (error) {
          console.error('Error al enviar correo:', error);
          showNotification('Error al enviar el correo electrónico', 'error');
        }
      });
      
      // Eventos para cerrar el modal
      document.querySelector(`#${modalId} .btn-close`).addEventListener('click', () => {
        modal.remove();
      });
      
      document.querySelector(`#${modalId} .close-modal`).addEventListener('click', () => {
        modal.remove();
      });
      
    } catch (error) {
      console.error('Error al preparar envío de comprobante:', error);
      showNotification('Error al preparar el envío del comprobante', 'error');
    }
  }

  /**
   * Obtiene la configuración de impresión
   * @returns {Object} Configuración de impresión
   */
  async getConfiguracionImpresion() {
    try {
      // Obtener configuración de impresión desde la BD
      const configuracion = await this.db.get('configuracion', 'impresion');
      
      // Si no existe, usar valores predeterminados
      if (!configuracion) {
        return {
          encabezado: {
            nombreEmpresa: 'FactuSystem',
            logoUrl: '',
            direccion: '',
            telefono: '',
            email: '',
            sitioWeb: ''
          },
          pieComprobante: 'Gracias por su compra',
          tamañoPapel: 'A4',
          mostrarLogo: true,
          formatoNumeroComprobante: '00000000',
          impresionDirecta: false,
          impresora: ''
        };
      }
      
      return configuracion;
    } catch (error) {
      console.error('Error al obtener configuración de impresión:', error);
      showNotification('Error al obtener la configuración de impresión', 'error');
      
      // Devolver configuración básica en caso de error
      return {
        encabezado: {
          nombreEmpresa: 'FactuSystem'
        },
        pieComprobante: 'Gracias por su compra',
        tamañoPapel: 'A4'
      };
    }
  }

  /**
   * Exporta el reporte a formato PDF
   */
  async exportarPDF() {
    try {
      // Verificar permisos
      if (!this.permisos.exportarReportes) {
        showNotification('No tiene permisos para exportar reportes', 'warning');
        return;
      }
      
      showNotification('Generando PDF...', 'info');
      
      // Preparar datos para exportación
      const reporteData = {
        titulo: 'Reporte de Ventas',
        periodo: {
          desde: formatDate(this.filters.startDate),
          hasta: formatDate(this.filters.endDate)
        },
        filtros: this.getDescripcionFiltros(),
        totales: this.reportData.totales,
        ventas: this.reportData.ventas,
        productos: this.reportData.productos,
        clientes: this.reportData.clientes,
        estadisticas: this.reportData.estadisticas,
        empresa: await this.getInfoEmpresa(),
        usuario: this.currentUser,
        fecha: new Date()
      };
      
      // Exportar a PDF
      const pdfPath = await exportToPdf('ventas', reporteData);
      
      showNotification(`PDF generado: ${pdfPath}`, 'success');
      
      // Abrir el archivo generado
      ipcRenderer.invoke('open-file', pdfPath);
      
    } catch (error) {
      console.error('Error al exportar a PDF:', error);
      showNotification('Error al generar el PDF', 'error');
    }
  }

  /**
   * Exporta el reporte a formato Excel
   */
  async exportarExcel() {
    try {
      // Verificar permisos
      if (!this.permisos.exportarReportes) {
        showNotification('No tiene permisos para exportar reportes', 'warning');
        return;
      }
      
      showNotification('Generando Excel...', 'info');
      
      // Preparar datos para exportación
      const reporteData = {
        titulo: 'Reporte de Ventas',
        periodo: {
          desde: formatDate(this.filters.startDate),
          hasta: formatDate(this.filters.endDate)
        },
        filtros: this.getDescripcionFiltros(),
        totales: this.reportData.totales,
        ventas: this.reportData.ventas,
        productos: this.reportData.productos,
        clientes: this.reportData.clientes,
        estadisticas: this.reportData.estadisticas,
        usuario: this.currentUser,
        fecha: new Date()
      };
      
      // Exportar a Excel
      const excelPath = await exportToExcel('ventas', reporteData);
      
      showNotification(`Excel generado: ${excelPath}`, 'success');
      
      // Abrir el archivo generado
      ipcRenderer.invoke('open-file', excelPath);
      
    } catch (error) {
      console.error('Error al exportar a Excel:', error);
      showNotification('Error al generar el Excel', 'error');
    }
  }

  /**
   * Imprime el reporte actual
   */
  async imprimirReporte() {
    try {
      showNotification('Preparando impresión...', 'info');
      
      // Preparar datos para impresión
      const reporteData = {
        titulo: 'Reporte de Ventas',
        periodo: {
          desde: formatDate(this.filters.startDate),
          hasta: formatDate(this.filters.endDate)
        },
        filtros: this.getDescripcionFiltros(),
        totales: this.reportData.totales,
        ventas: this.reportData.ventas,
        productos: this.reportData.productos,
        clientes: this.reportData.clientes,
        empresa: await this.getInfoEmpresa(),
        usuario: this.currentUser,
        fecha: new Date()
      };
      
      // Enviar a imprimir
      await printDocument({
        tipo: 'reporte',
        subTipo: 'ventas',
        data: reporteData
      });
      
      showNotification('Reporte enviado a la impresora', 'success');
    } catch (error) {
      console.error('Error al imprimir reporte:', error);
      showNotification('Error al imprimir el reporte', 'error');
    }
  }

  /**
   * Obtiene información de la empresa para reportes
   * @returns {Object} Información de la empresa
   */
  async getInfoEmpresa() {
    try {
      // Obtener información de la empresa desde la configuración
      const empresa = await this.db.get('configuracion', 'empresa');
      
      // Si no existe, devolver información básica
      if (!empresa) {
        return {
          nombre: 'FactuSystem',
          direccion: '',
          telefono: '',
          email: '',
          sitioWeb: '',
          logoUrl: ''
        };
      }
      
      return empresa;
    } catch (error) {
      console.error('Error al obtener información de la empresa:', error);
      
      // Devolver información básica en caso de error
      return { nombre: 'FactuSystem' };
    }
  }

  /**
   * Obtiene descripción textual de los filtros aplicados
   * @returns {string} Descripción de filtros
   */
  getDescripcionFiltros() {
    const filtrosAplicados = [];
    
    // Período
    filtrosAplicados.push(`Período: ${formatDate(this.filters.startDate)} al ${formatDate(this.filters.endDate)}`);
    
    // Otros filtros
    if (this.filters.sucursal !== 'todas') {
      const sucursal = document.querySelector(`#reportes-sucursal option[value="${this.filters.sucursal}"]`);
      filtrosAplicados.push(`Sucursal: ${sucursal ? sucursal.textContent : this.filters.sucursal}`);
    }
    
    if (this.filters.usuario !== 'todos') {
      const usuario = document.querySelector(`#reportes-usuario option[value="${this.filters.usuario}"]`);
      filtrosAplicados.push(`Usuario: ${usuario ? usuario.textContent : this.filters.usuario}`);
    }
    
    if (this.filters.tipoComprobante !== 'todos') {
      filtrosAplicados.push(`Tipo de comprobante: ${this.filters.tipoComprobante}`);
    }
    
    if (this.filters.metodoPago !== 'todos') {
      filtrosAplicados.push(`Método de pago: ${this.filters.metodoPago}`);
    }
    
    if (this.filters.cliente) {
      filtrosAplicados.push(`Cliente: ${this.filters.cliente}`);
    }
    
    if (this.filters.minTotal) {
      filtrosAplicados.push(`Monto mínimo: ${formatCurrency(this.filters.minTotal)}`);
    }
    
    if (this.filters.maxTotal) {
      filtrosAplicados.push(`Monto máximo: ${formatCurrency(this.filters.maxTotal)}`);
    }
    
    return filtrosAplicados.join(' | ');
  }

  /**
   * Formatea una fecha para input de tipo date
   * @param {Date} date Fecha a formatear
   * @returns {string} Fecha formateada (YYYY-MM-DD)
   */
  formatDateForInput(date) {
    if (!date) return '';
    
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    
    return `${year}-${month}-${day}`;
  }

  /**
   * Calcula el rango de fechas para la semana actual
   * @returns {Object} Objeto con fechas de inicio y fin
   */
  calcularSemanaActual() {
    const now = new Date();
    const diaSemana = now.getDay(); // 0 (Domingo) a 6 (Sábado)
    
    // Ajustar para que la semana comience en lunes (1) y termine en domingo (0)
    const inicioSemana = new Date(now);
    inicioSemana.setDate(now.getDate() - (diaSemana === 0 ? 6 : diaSemana - 1));
    inicioSemana.setHours(0, 0, 0, 0);
    
    const finSemana = new Date(inicioSemana);
    finSemana.setDate(inicioSemana.getDate() + 6);
    finSemana.setHours(23, 59, 59, 999);
    
    return {
      startDate: inicioSemana,
      endDate: finSemana
    };
  }

  /**
   * Calcula el rango de fechas para la semana anterior
   * @returns {Object} Objeto con fechas de inicio y fin
   */
  calcularSemanaAnterior() {
    const semanaActual = this.calcularSemanaActual();
    
    const inicioSemanaAnterior = new Date(semanaActual.startDate);
    inicioSemanaAnterior.setDate(inicioSemanaAnterior.getDate() - 7);
    
    const finSemanaAnterior = new Date(semanaActual.endDate);
    finSemanaAnterior.setDate(finSemanaAnterior.getDate() - 7);
    
    return {
      startDate: inicioSemanaAnterior,
      endDate: finSemanaAnterior
    };
  }

  /**
   * Calcula el rango de fechas para el mes actual
   * @returns {Object} Objeto con fechas de inicio y fin
   */
  calcularMesActual() {
    const now = new Date();
    
    const inicioMes = new Date(now.getFullYear(), now.getMonth(), 1);
    inicioMes.setHours(0, 0, 0, 0);
    
    const finMes = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    finMes.setHours(23, 59, 59, 999);
    
    return {
      startDate: inicioMes,
      endDate: finMes
    };
  }

  /**
   * Calcula el rango de fechas para el mes anterior
   * @returns {Object} Objeto con fechas de inicio y fin
   */
  calcularMesAnterior() {
    const now = new Date();
    
    const inicioMesAnterior = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    inicioMesAnterior.setHours(0, 0, 0, 0);
    
    const finMesAnterior = new Date(now.getFullYear(), now.getMonth(), 0);
    finMesAnterior.setHours(23, 59, 59, 999);
    
    return {
      startDate: inicioMesAnterior,
      endDate: finMesAnterior
    };
  }
}

// Exportar la clase para su uso en el módulo principal
 VentasReportes

module.exports = VentasReportes;