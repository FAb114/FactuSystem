/**
 * dataController.js
 * Controlador para la gestión de datos entre servidor y clientes en FactuSystem
 * Maneja operaciones CRUD, consultas avanzadas y sincronización entre sucursales
 */

const path = require('path');
const fs = require('fs');
const { validationResult } = require('express-validator');
const database = require('../config/database');
const securityConfig = require('../config/security');
const syncUtil = require('../utils/syncUtil');
const logger = require('../../services/audit/logger');

// Módulos para las diferentes entidades del sistema
const entitiesMap = {
  'ventas': require('../models/ventas'),
  'compras': require('../models/compras'),
  'productos': require('../models/productos'),
  'clientes': require('../models/clientes'),
  'proveedores': require('../models/proveedores'),
  'usuarios': require('../models/usuarios'),
  'caja': require('../models/caja'),
  'sucursales': require('../models/sucursales'),
  'configuraciones': require('../models/configuraciones'),
  'documentos': require('../models/documentos'),
  'cuotificador': require('../models/cuotificador')
};

/**
 * Obtiene datos de una entidad con filtros y paginación
 * @param {Object} req - Solicitud HTTP
 * @param {Object} res - Respuesta HTTP
 */
exports.getData = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { entidad, filtros = {}, pagina = 1, porPagina = 50, ordenarPor = 'id', orden = 'DESC' } = req.body;
    const sucursalId = req.body.sucursalId || req.sucursalId;

    if (!entitiesMap[entidad]) {
      return res.status(404).json({ mensaje: `Entidad ${entidad} no encontrada` });
    }

    // Verificar que el usuario tenga acceso a la sucursal
    if (req.usuario.rol !== 'administrador' && req.usuario.sucursalId !== sucursalId) {
      return res.status(403).json({ mensaje: 'No tiene permisos para acceder a los datos de esta sucursal' });
    }

    // Añadir filtro de sucursal si corresponde
    const filtrosAplicados = { ...filtros };
    if (entidad !== 'sucursales' && entidad !== 'configuraciones') {
      filtrosAplicados.sucursalId = sucursalId;
    }

    const resultado = await entitiesMap[entidad].obtener(filtrosAplicados, {
      pagina,
      porPagina,
      ordenarPor,
      orden
    });

    // Registrar la consulta en el log de auditoría
    logger.info(`Consulta de datos: ${entidad}`, {
      usuario: req.usuario.id,
      sucursal: sucursalId,
      filtros: filtrosAplicados,
      resultado: { total: resultado.total }
    });

    return res.status(200).json({
      datos: resultado.datos,
      paginacion: {
        total: resultado.total,
        pagina,
        porPagina,
        paginas: Math.ceil(resultado.total / porPagina)
      }
    });
  } catch (error) {
    logger.error(`Error al obtener datos de ${req.body.entidad}`, { error: error.message, stack: error.stack });
    return res.status(500).json({ mensaje: 'Error al obtener datos', error: error.message });
  }
};

/**
 * Obtiene un registro específico por ID
 * @param {Object} req - Solicitud HTTP
 * @param {Object} res - Respuesta HTTP
 */
exports.getById = async (req, res) => {
  try {
    const { entidad, id } = req.params;
    const sucursalId = req.query.sucursalId || req.sucursalId;

    if (!entitiesMap[entidad]) {
      return res.status(404).json({ mensaje: `Entidad ${entidad} no encontrada` });
    }

    const registro = await entitiesMap[entidad].obtenerPorId(id);

    if (!registro) {
      return res.status(404).json({ mensaje: `Registro no encontrado` });
    }

    // Verificar permisos de acceso a datos de sucursal
    if (registro.sucursalId && 
        registro.sucursalId !== sucursalId && 
        req.usuario.rol !== 'administrador') {
      return res.status(403).json({ mensaje: 'No tiene permisos para acceder a este registro' });
    }

    return res.status(200).json(registro);
  } catch (error) {
    logger.error(`Error al obtener registro por ID`, { 
      entidad: req.params.entidad, 
      id: req.params.id,
      error: error.message 
    });
    return res.status(500).json({ mensaje: 'Error al obtener registro', error: error.message });
  }
};

/**
 * Crea un nuevo registro
 * @param {Object} req - Solicitud HTTP
 * @param {Object} res - Respuesta HTTP
 */
exports.crear = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { entidad } = req.params;
    const datos = req.body;
    const sucursalId = datos.sucursalId || req.sucursalId;

    if (!entitiesMap[entidad]) {
      return res.status(404).json({ mensaje: `Entidad ${entidad} no encontrada` });
    }

    // Verificar permisos para crear en esta sucursal
    if (req.usuario.rol !== 'administrador' && req.usuario.sucursalId !== sucursalId) {
      return res.status(403).json({ mensaje: 'No tiene permisos para crear registros en esta sucursal' });
    }

    // Añadir metadatos de auditoría
    datos.creadoPor = req.usuario.id;
    datos.fechaCreacion = new Date();
    datos.sucursalId = sucursalId;

    // Encriptar datos sensibles si corresponde
    if (entidad === 'clientes' || entidad === 'usuarios') {
      securityConfig.encriptarDatosSensibles(datos);
    }

    const resultado = await entitiesMap[entidad].crear(datos);

    // Marcar para sincronización
    syncUtil.marcarParaSincronizacion(entidad, resultado.id, 'create', sucursalId);

    // Registrar en audit log
    logger.info(`Creación de registro: ${entidad}`, {
      usuario: req.usuario.id,
      sucursal: sucursalId,
      resultado: { id: resultado.id }
    });

    return res.status(201).json(resultado);
  } catch (error) {
    logger.error(`Error al crear registro en ${req.params.entidad}`, { 
      error: error.message, 
      datos: req.body 
    });
    return res.status(500).json({ mensaje: 'Error al crear registro', error: error.message });
  }
};

/**
 * Actualiza un registro existente
 * @param {Object} req - Solicitud HTTP
 * @param {Object} res - Respuesta HTTP
 */
exports.actualizar = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { entidad, id } = req.params;
    const datos = req.body;

    if (!entitiesMap[entidad]) {
      return res.status(404).json({ mensaje: `Entidad ${entidad} no encontrada` });
    }

    // Obtener el registro actual para verificar permisos
    const registroActual = await entitiesMap[entidad].obtenerPorId(id);
    
    if (!registroActual) {
      return res.status(404).json({ mensaje: 'Registro no encontrado' });
    }

    const sucursalId = registroActual.sucursalId;

    // Verificar permisos para actualizar en esta sucursal
    if (req.usuario.rol !== 'administrador' && req.usuario.sucursalId !== sucursalId) {
      return res.status(403).json({ mensaje: 'No tiene permisos para actualizar registros en esta sucursal' });
    }

    // Añadir metadatos de auditoría
    datos.actualizadoPor = req.usuario.id;
    datos.fechaActualizacion = new Date();

    // Encriptar datos sensibles si corresponde
    if (entidad === 'clientes' || entidad === 'usuarios') {
      securityConfig.encriptarDatosSensibles(datos);
    }

    const resultado = await entitiesMap[entidad].actualizar(id, datos);

    // Marcar para sincronización
    syncUtil.marcarParaSincronizacion(entidad, id, 'update', sucursalId);

    // Registrar en audit log
    logger.info(`Actualización de registro: ${entidad}`, {
      usuario: req.usuario.id,
      sucursal: sucursalId,
      id: id
    });

    return res.status(200).json(resultado);
  } catch (error) {
    logger.error(`Error al actualizar registro en ${req.params.entidad}`, { 
      id: req.params.id,
      error: error.message
    });
    return res.status(500).json({ mensaje: 'Error al actualizar registro', error: error.message });
  }
};

/**
 * Elimina un registro
 * @param {Object} req - Solicitud HTTP
 * @param {Object} res - Respuesta HTTP
 */
exports.eliminar = async (req, res) => {
  try {
    const { entidad, id } = req.params;

    if (!entitiesMap[entidad]) {
      return res.status(404).json({ mensaje: `Entidad ${entidad} no encontrada` });
    }

    // Obtener el registro para verificar permisos
    const registro = await entitiesMap[entidad].obtenerPorId(id);
    
    if (!registro) {
      return res.status(404).json({ mensaje: 'Registro no encontrado' });
    }

    const sucursalId = registro.sucursalId;

    // Verificar permisos para eliminar en esta sucursal
    if (req.usuario.rol !== 'administrador' && req.usuario.sucursalId !== sucursalId) {
      return res.status(403).json({ mensaje: 'No tiene permisos para eliminar registros en esta sucursal' });
    }

    // En lugar de eliminar físicamente, marcar como eliminado (soft delete)
    await entitiesMap[entidad].softDelete(id, req.usuario.id);

    // Marcar para sincronización
    syncUtil.marcarParaSincronizacion(entidad, id, 'delete', sucursalId);

    // Registrar en audit log
    logger.info(`Eliminación de registro: ${entidad}`, {
      usuario: req.usuario.id,
      sucursal: sucursalId,
      id: id
    });

    return res.status(200).json({ mensaje: 'Registro eliminado correctamente' });
  } catch (error) {
    logger.error(`Error al eliminar registro en ${req.params.entidad}`, { 
      id: req.params.id,
      error: error.message
    });
    return res.status(500).json({ mensaje: 'Error al eliminar registro', error: error.message });
  }
};

/**
 * Realiza operaciones masivas (creación o actualización)
 * @param {Object} req - Solicitud HTTP
 * @param {Object} res - Respuesta HTTP
 */
exports.operacionMasiva = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { entidad, operacion } = req.params;
    const { datos, filtro } = req.body;
    const sucursalId = req.body.sucursalId || req.sucursalId;

    if (!entitiesMap[entidad]) {
      return res.status(404).json({ mensaje: `Entidad ${entidad} no encontrada` });
    }

    // Verificar permisos
    if (req.usuario.rol !== 'administrador' && req.usuario.sucursalId !== sucursalId) {
      return res.status(403).json({ mensaje: 'No tiene permisos para realizar operaciones masivas en esta sucursal' });
    }

    let resultado;

    switch (operacion) {
      case 'crear':
        // Añadir metadatos a cada registro
        const registrosConMetadata = datos.map(registro => ({
          ...registro,
          sucursalId,
          creadoPor: req.usuario.id,
          fechaCreacion: new Date()
        }));
        
        if (entidad === 'clientes' || entidad === 'usuarios') {
          registrosConMetadata.forEach(registro => {
            securityConfig.encriptarDatosSensibles(registro);
          });
        }
        
        resultado = await entitiesMap[entidad].crearMultiple(registrosConMetadata);
        
        // Marcar todos para sincronización
        resultado.ids.forEach(id => {
          syncUtil.marcarParaSincronizacion(entidad, id, 'create', sucursalId);
        });
        break;
        
      case 'actualizar':
        // Añadir metadatos a la actualización
        const datosActualizacion = {
          ...datos,
          actualizadoPor: req.usuario.id,
          fechaActualizacion: new Date()
        };
        
        if (entidad === 'clientes' || entidad === 'usuarios') {
          securityConfig.encriptarDatosSensibles(datosActualizacion);
        }
        
        // Añadir filtro de sucursal
        const filtroCompleto = { 
          ...filtro,
          sucursalId 
        };
        
        resultado = await entitiesMap[entidad].actualizarMultiple(filtroCompleto, datosActualizacion);
        
        // Los registros afectados deben marcarse para sincronización
        if (resultado.ids && resultado.ids.length > 0) {
          resultado.ids.forEach(id => {
            syncUtil.marcarParaSincronizacion(entidad, id, 'update', sucursalId);
          });
        }
        break;
        
      default:
        return res.status(400).json({ mensaje: 'Operación no válida' });
    }

    // Registrar en audit log
    logger.info(`Operación masiva: ${operacion} en ${entidad}`, {
      usuario: req.usuario.id,
      sucursal: sucursalId,
      registrosAfectados: resultado.count
    });

    return res.status(200).json(resultado);
  } catch (error) {
    logger.error(`Error en operación masiva ${req.params.operacion} en ${req.params.entidad}`, { 
      error: error.message,
      datos: req.body
    });
    return res.status(500).json({ mensaje: 'Error al realizar operación masiva', error: error.message });
  }
};

/**
 * Consultas avanzadas personalizadas
 * @param {Object} req - Solicitud HTTP
 * @param {Object} res - Respuesta HTTP
 */
exports.consultaAvanzada = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { tipo } = req.params;
    const { parametros } = req.body;
    const sucursalId = req.body.sucursalId || req.sucursalId;

    // Verificar permisos
    if (req.usuario.rol !== 'administrador' && req.usuario.sucursalId !== sucursalId) {
      return res.status(403).json({ mensaje: 'No tiene permisos para realizar esta consulta' });
    }

    let resultado;

    // Consultas específicas para distintos reportes y análisis
    switch (tipo) {
      case 'ventas-por-periodo':
        resultado = await entitiesMap['ventas'].reportePorPeriodo({
          ...parametros,
          sucursalId
        });
        break;
        
      case 'stock-critico':
        resultado = await entitiesMap['productos'].reporteStockCritico({
          ...parametros,
          sucursalId
        });
        break;
        
      case 'movimientos-caja':
        resultado = await entitiesMap['caja'].reporteMovimientos({
          ...parametros,
          sucursalId
        });
        break;
        
      case 'productos-mas-vendidos':
        resultado = await entitiesMap['ventas'].productosMasVendidos({
          ...parametros,
          sucursalId
        });
        break;
        
      case 'rendimiento-sucursales':
        // Solo administradores pueden ver comparativas entre sucursales
        if (req.usuario.rol !== 'administrador') {
          return res.status(403).json({ mensaje: 'No tiene permisos para acceder a este reporte' });
        }
        resultado = await entitiesMap['ventas'].comparativaSucursales(parametros);
        break;
        
      case 'reporte-iva':
        resultado = await entitiesMap['ventas'].reporteIVA({
          ...parametros,
          sucursalId
        });
        break;
        
      case 'historial-cliente':
        resultado = await entitiesMap['clientes'].historialCompras({
          ...parametros,
          sucursalId
        });
        break;
        
      case 'balance-proveedor':
        resultado = await entitiesMap['proveedores'].balanceCompras({
          ...parametros,
          sucursalId
        });
        break;

      default:
        return res.status(400).json({ mensaje: 'Tipo de consulta no válida' });
    }

    // Registrar en audit log
    logger.info(`Consulta avanzada: ${tipo}`, {
      usuario: req.usuario.id,
      sucursal: sucursalId,
      parametros
    });

    return res.status(200).json(resultado);
  } catch (error) {
    logger.error(`Error en consulta avanzada ${req.params.tipo}`, { 
      error: error.message,
      parametros: req.body.parametros
    });
    return res.status(500).json({ mensaje: 'Error al realizar consulta avanzada', error: error.message });
  }
};

/**
 * Gestión de archivos adjuntos
 * @param {Object} req - Solicitud HTTP
 * @param {Object} res - Respuesta HTTP
 */
exports.gestionarAdjunto = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ mensaje: 'No se proporcionó ningún archivo' });
    }

    const { entidad, id } = req.params;
    const sucursalId = req.query.sucursalId || req.sucursalId;

    if (!entitiesMap[entidad]) {
      // Eliminar el archivo subido
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ mensaje: `Entidad ${entidad} no encontrada` });
    }

    // Obtener el registro para verificar permisos
    const registro = await entitiesMap[entidad].obtenerPorId(id);
    
    if (!registro) {
      // Eliminar el archivo subido
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ mensaje: 'Registro no encontrado' });
    }

    // Verificar permisos
    if (req.usuario.rol !== 'administrador' && 
        (registro.sucursalId && registro.sucursalId !== sucursalId)) {
      // Eliminar el archivo subido
      fs.unlinkSync(req.file.path);
      return res.status(403).json({ mensaje: 'No tiene permisos para adjuntar archivos a este registro' });
    }

    // Renombrar y mover el archivo a la ubicación final
    const extension = path.extname(req.file.originalname);
    const nuevoNombre = `${entidad}_${id}_${Date.now()}${extension}`;
    const rutaFinal = path.join(__dirname, '../../uploads', nuevoNombre);
    
    fs.renameSync(req.file.path, rutaFinal);

    // Actualizar el registro con la referencia al archivo
    await entitiesMap[entidad].adjuntarArchivo(id, {
      nombreArchivo: nuevoNombre,
      nombreOriginal: req.file.originalname,
      tipo: req.file.mimetype,
      tamano: req.file.size,
      rutaRelativa: `/uploads/${nuevoNombre}`,
      subidoPor: req.usuario.id,
      fechaSubida: new Date()
    });

    // Marcar para sincronización
    syncUtil.marcarParaSincronizacion(entidad, id, 'update', sucursalId);

    // Registrar en audit log
    logger.info(`Archivo adjunto: ${entidad}`, {
      usuario: req.usuario.id,
      sucursal: sucursalId,
      id: id,
      archivo: nuevoNombre
    });

    return res.status(200).json({ 
      mensaje: 'Archivo adjuntado correctamente',
      nombreArchivo: nuevoNombre,
      rutaRelativa: `/uploads/${nuevoNombre}`
    });
  } catch (error) {
    // Si hay un archivo subido, eliminarlo
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    logger.error(`Error al adjuntar archivo a ${req.params.entidad}`, { 
      id: req.params.id,
      error: error.message
    });
    return res.status(500).json({ mensaje: 'Error al adjuntar archivo', error: error.message });
  }
};

/**
 * Sincroniza datos entre sucursales
 * @param {Object} req - Solicitud HTTP
 * @param {Object} res - Respuesta HTTP
 */
exports.sincronizar = async (req, res) => {
  try {
    const { sucursalId } = req.params;
    const { ultimaSincronizacion } = req.body;

    // Solo administradores o usuarios de la sucursal central pueden sincronizar
    if (req.usuario.rol !== 'administrador' && req.usuario.sucursalId !== 1) {
      return res.status(403).json({ mensaje: 'No tiene permisos para sincronizar datos' });
    }

    // Obtener cambios desde la última sincronización
    const cambios = await syncUtil.obtenerCambiosDesde(sucursalId, ultimaSincronizacion);

    // Registrar en audit log
    logger.info(`Sincronización de datos con sucursal`, {
      usuario: req.usuario.id,
      sucursal: sucursalId,
      cambiosEnviados: cambios.length
    });

    return res.status(200).json({
      mensaje: 'Datos sincronizados correctamente',
      cambios,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error(`Error en sincronización con sucursal ${req.params.sucursalId}`, { 
      error: error.message,
      ultimaSincronizacion: req.body.ultimaSincronizacion
    });
    return res.status(500).json({ mensaje: 'Error al sincronizar datos', error: error.message });
  }
};

/**
 * Recibe y procesa datos sincronizados de otra sucursal
 * @param {Object} req - Solicitud HTTP
 * @param {Object} res - Respuesta HTTP
 */
exports.recibirSincronizacion = async (req, res) => {
  try {
    const { cambios } = req.body;
    const sucursalDestinoId = req.sucursalId;

    if (!Array.isArray(cambios) || cambios.length === 0) {
      return res.status(400).json({ mensaje: 'No hay cambios para aplicar' });
    }

    // Verificar permisos
    if (req.usuario.rol !== 'administrador' && req.usuario.sucursalId !== sucursalDestinoId) {
      return res.status(403).json({ mensaje: 'No tiene permisos para recibir datos sincronizados' });
    }

    // Aplicar los cambios recibidos
    const resultado = await syncUtil.aplicarCambios(cambios, sucursalDestinoId);

    // Registrar en audit log
    logger.info(`Recepción de sincronización`, {
      usuario: req.usuario.id,
      sucursal: sucursalDestinoId,
      cambiosRecibidos: cambios.length,
      cambiosAplicados: resultado.aplicados,
      conflictos: resultado.conflictos
    });

    return res.status(200).json({
      mensaje: 'Sincronización recibida y procesada',
      resultado,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error(`Error al procesar datos sincronizados`, { 
      error: error.message,
      sucursal: req.sucursalId
    });
    return res.status(500).json({ mensaje: 'Error al procesar datos sincronizados', error: error.message });
  }
};

/**
 * Busca registros por término en una o varias entidades
 * @param {Object} req - Solicitud HTTP
 * @param {Object} res - Respuesta HTTP
 */
exports.buscar = async (req, res) => {
  try {
    const { termino } = req.params;
    const { entidades, filtros = {} } = req.body;
    const sucursalId = req.body.sucursalId || req.sucursalId;

    if (!termino || termino.trim().length < 3) {
      return res.status(400).json({ mensaje: 'El término de búsqueda debe tener al menos 3 caracteres' });
    }

    const resultados = {};

    // Si no se especifican entidades, buscar en todas
    const entidadesABuscar = entidades && entidades.length > 0 
      ? entidades.filter(e => entitiesMap[e]) 
      : Object.keys(entitiesMap);

    // Verificar permisos
    if (req.usuario.rol !== 'administrador' && req.usuario.sucursalId !== sucursalId) {
      return res.status(403).json({ mensaje: 'No tiene permisos para buscar en esta sucursal' });
    }

    // Realizar búsqueda en cada entidad
    for (const entidad of entidadesABuscar) {
      // Añadir filtro de sucursal si corresponde
      const filtrosAplicados = { ...filtros };
      if (entidad !== 'sucursales' && entidad !== 'configuraciones') {
        filtrosAplicados.sucursalId = sucursalId;
      }
      
      const resultadoEntidad = await entitiesMap[entidad].buscar(termino, filtrosAplicados);
      
      if (resultadoEntidad && resultadoEntidad.length > 0) {
        resultados[entidad] = resultadoEntidad;
      }
    }

    // Registrar en audit log
    logger.info(`Búsqueda global: "${termino}"`, {
      usuario: req.usuario.id,
      sucursal: sucursalId,
      entidades: entidadesABuscar,
      resultadosEncontrados: Object.values(resultados).reduce((acc, curr) => acc + curr.length, 0)
    });

    return res.status(200).json({
      resultados,
      meta: {
        termino,
        entidades: entidadesABuscar,
        totalResultados: Object.values(resultados).reduce((acc, curr) => acc + curr.length, 0)
      }
    });
  } catch (error) {
    logger.error(`Error en búsqueda global: "${req.params.termino}"`, { 
      error: error.message
    });
    return res.status(500).json({ mensaje: 'Error al realizar la búsqueda', error: error.message });
  }
};

/**
 * Exporta datos de una entidad en formato Excel o CSV
 * @param {Object} req - Solicitud HTTP
 * @param {Object} res - Respuesta HTTP
 */
exports.exportar = async (req, res) => {
  try {
    const { entidad, formato } = req.params;
    const { filtros = {} } = req.body;
    const sucursalId = req.body.sucursalId || req.sucursalId;

    if (!entitiesMap[entidad]) {
      return res.status(404).json({ mensaje: `Entidad ${entidad} no encontrada` });
    }

    if (!['excel', 'csv'].includes(formato)) {
      return res.status(400).json({ mensaje: 'Formato no soportado. Use excel o csv' });
    }

    // Verificar permisos
    if (req.usuario.rol !== 'administrador' && req.usuario.sucursalId !== sucursalId) {
      return res.status(403).json({ mensaje: 'No tiene permisos para exportar datos de esta sucursal' });
    }

    // Añadir filtro de sucursal si corresponde
    const filtrosAplicados = { ...filtros };
    if (entidad !== 'sucursales' && entidad !== 'configuraciones') {
      filtrosAplicados.sucursalId = sucursalId;
    }

    // Generar archivo para exportación
    const { archivo, nombreArchivo } = await entitiesMap[entidad].exportar(filtrosAplicados, formato);

    // Registrar en audit log
    logger.info(`Exportación de datos: ${entidad} en formato ${formato}`, {
        usuario: req.usuario.id,
        sucursal: sucursalId,
        filtros: filtrosAplicados
      });
  
      // Configurar cabeceras según el formato
      if (formato === 'excel') {
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      } else {
        res.setHeader('Content-Type', 'text/csv');
      }
      
      res.setHeader('Content-Disposition', `attachment; filename=${nombreArchivo}`);
      res.setHeader('Content-Length', archivo.length);
      
      return res.send(archivo);
    } catch (error) {
      logger.error(`Error al exportar datos de ${req.params.entidad}`, { 
        formato: req.params.formato,
        error: error.message
      });
      return res.status(500).json({ mensaje: 'Error al exportar datos', error: error.message });
    }
  };
  
  /**
   * Importa datos a una entidad desde un archivo Excel o CSV
   * @param {Object} req - Solicitud HTTP
   * @param {Object} res - Respuesta HTTP
   */
  exports.importar = async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ mensaje: 'No se proporcionó ningún archivo' });
      }
  
      const { entidad } = req.params;
      const sucursalId = req.query.sucursalId || req.sucursalId;
      const { opcionesImportacion = {} } = req.body;
  
      if (!entitiesMap[entidad]) {
        // Eliminar el archivo subido
        fs.unlinkSync(req.file.path);
        return res.status(404).json({ mensaje: `Entidad ${entidad} no encontrada` });
      }
  
      // Verificar permisos
      if (req.usuario.rol !== 'administrador' && req.usuario.sucursalId !== sucursalId) {
        // Eliminar el archivo subido
        fs.unlinkSync(req.file.path);
        return res.status(403).json({ mensaje: 'No tiene permisos para importar datos a esta sucursal' });
      }
  
      // Procesar el archivo
      const resultado = await entitiesMap[entidad].importar(req.file.path, {
        ...opcionesImportacion,
        sucursalId,
        usuarioId: req.usuario.id
      });
  
      // Eliminar archivo temporal
      fs.unlinkSync(req.file.path);
  
      // Marcar registros para sincronización
      if (resultado.idsCreados && resultado.idsCreados.length > 0) {
        resultado.idsCreados.forEach(id => {
          syncUtil.marcarParaSincronizacion(entidad, id, 'create', sucursalId);
        });
      }
  
      // Registrar en audit log
      logger.info(`Importación de datos: ${entidad}`, {
        usuario: req.usuario.id,
        sucursal: sucursalId,
        archivo: req.file.originalname,
        registrosCreados: resultado.creados,
        registrosActualizados: resultado.actualizados,
        errores: resultado.errores.length
      });
  
      return res.status(200).json({
        mensaje: 'Datos importados correctamente',
        resultado
      });
    } catch (error) {
      // Si hay un archivo subido, eliminarlo
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      
      logger.error(`Error al importar datos a ${req.params.entidad}`, { 
        error: error.message
      });
      return res.status(500).json({ mensaje: 'Error al importar datos', error: error.message });
    }
  };
  
  /**
   * Genera reportes y documentos fiscales
   * @param {Object} req - Solicitud HTTP
   * @param {Object} res - Respuesta HTTP
   */
  exports.generarDocumento = async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
  
      const { tipoDocumento } = req.params;
      const { datos, formato = 'pdf' } = req.body;
      const sucursalId = req.body.sucursalId || req.sucursalId;
  
      // Verificar permisos
      if (req.usuario.rol !== 'administrador' && req.usuario.sucursalId !== sucursalId) {
        return res.status(403).json({ mensaje: 'No tiene permisos para generar documentos para esta sucursal' });
      }
  
      // Validar formato
      if (!['pdf', 'html', 'ticket'].includes(formato)) {
        return res.status(400).json({ mensaje: 'Formato no soportado. Use pdf, html o ticket' });
      }
  
      let resultado;
  
      switch (tipoDocumento) {
        case 'factura':
          resultado = await entitiesMap['documentos'].generarFactura(datos, formato, sucursalId);
          break;
          
        case 'remito':
          resultado = await entitiesMap['documentos'].generarRemito(datos, formato, sucursalId);
          break;
          
        case 'nota-credito':
          resultado = await entitiesMap['documentos'].generarNotaCredito(datos, formato, sucursalId);
          break;
          
        case 'nota-debito':
          resultado = await entitiesMap['documentos'].generarNotaDebito(datos, formato, sucursalId);
          break;
          
        case 'recibo':
          resultado = await entitiesMap['documentos'].generarRecibo(datos, formato, sucursalId);
          break;
          
        case 'presupuesto':
          resultado = await entitiesMap['documentos'].generarPresupuesto(datos, formato, sucursalId);
          break;
          
        case 'orden-compra':
          resultado = await entitiesMap['documentos'].generarOrdenCompra(datos, formato, sucursalId);
          break;
  
        default:
          return res.status(400).json({ mensaje: 'Tipo de documento no válido' });
      }
  
      // Registrar en audit log
      logger.info(`Generación de documento: ${tipoDocumento}`, {
        usuario: req.usuario.id,
        sucursal: sucursalId,
        formato,
        documentoId: resultado.id || null
      });
  
      // Si se generó un documento físico, almacenar referencia
      if (resultado.id) {
        await entitiesMap['documentos'].registrarDocumento({
          tipo: tipoDocumento,
          formato,
          documentoId: resultado.id,
          nombreArchivo: resultado.nombreArchivo,
          sucursalId,
          usuarioId: req.usuario.id,
          fechaCreacion: new Date()
        });
  
        // Marcar para sincronización
        syncUtil.marcarParaSincronizacion('documentos', resultado.id, 'create', sucursalId);
      }
  
      // Si es formato PDF o ticket, enviar el archivo
      if (formato === 'pdf' || formato === 'ticket') {
        res.setHeader('Content-Type', formato === 'pdf' ? 'application/pdf' : 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename=${resultado.nombreArchivo}`);
        res.setHeader('Content-Length', resultado.archivo.length);
        return res.send(resultado.archivo);
      }
  
      // Para HTML, devolver el contenido renderizado
      if (formato === 'html') {
        return res.status(200).json({
          contenido: resultado.contenido,
          nombreArchivo: resultado.nombreArchivo
        });
      }
    } catch (error) {
      logger.error(`Error al generar documento ${req.params.tipoDocumento}`, { 
        error: error.message,
        datos: req.body.datos
      });
      return res.status(500).json({ mensaje: 'Error al generar documento', error: error.message });
    }
  };
  
  /**
   * Obtiene estadísticas y métricas del sistema
   * @param {Object} req - Solicitud HTTP
   * @param {Object} res - Respuesta HTTP
   */
  exports.obtenerEstadisticas = async (req, res) => {
    try {
      const { tipo } = req.params;
      const { periodo, filtros = {} } = req.body;
      const sucursalId = req.body.sucursalId || req.sucursalId;
  
      // Verificar permisos
      if (req.usuario.rol !== 'administrador' && req.usuario.sucursalId !== sucursalId) {
        return res.status(403).json({ mensaje: 'No tiene permisos para ver estadísticas de esta sucursal' });
      }
  
      let resultado;
  
      // Añadir filtro de sucursal
      const filtrosAplicados = { ...filtros, sucursalId };
  
      switch (tipo) {
        case 'dashboard':
          // Estadísticas generales para el dashboard
          resultado = await Promise.all([
            entitiesMap['ventas'].obtenerMetricas(filtrosAplicados, periodo),
            entitiesMap['productos'].obtenerMetricas(filtrosAplicados, periodo),
            entitiesMap['caja'].obtenerEstadoActual(sucursalId),
            entitiesMap['clientes'].obtenerEstadisticas(filtrosAplicados, periodo)
          ]);
          
          resultado = {
            ventas: resultado[0],
            productos: resultado[1],
            caja: resultado[2],
            clientes: resultado[3]
          };
          break;
          
        case 'ventas-periodo':
          resultado = await entitiesMap['ventas'].estadisticasPorPeriodo(filtrosAplicados, periodo);
          break;
          
        case 'productos-rendimiento':
          resultado = await entitiesMap['productos'].estadisticasRendimiento(filtrosAplicados, periodo);
          break;
          
        case 'ganancias':
          resultado = await entitiesMap['ventas'].analisisGanancias(filtrosAplicados, periodo);
          break;
          
        case 'clientes-fidelidad':
          resultado = await entitiesMap['clientes'].analisisFidelidad(filtrosAplicados, periodo);
          break;
          
        default:
          return res.status(400).json({ mensaje: 'Tipo de estadística no válido' });
      }
  
      // Registrar en audit log
      logger.info(`Consulta de estadísticas: ${tipo}`, {
        usuario: req.usuario.id,
        sucursal: sucursalId,
        periodo
      });
  
      return res.status(200).json(resultado);
    } catch (error) {
      logger.error(`Error al obtener estadísticas ${req.params.tipo}`, { 
        error: error.message,
        periodo: req.body.periodo
      });
      return res.status(500).json({ mensaje: 'Error al obtener estadísticas', error: error.message });
    }
  };
  
  /**
   * Procesa acciones relacionadas con el cuotificador
   * @param {Object} req - Solicitud HTTP
   * @param {Object} res - Respuesta HTTP
   */
  exports.procesarCuotas = async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
  
      const { accion } = req.params;
      const { datos } = req.body;
      const sucursalId = req.body.sucursalId || req.sucursalId;
  
      // Verificar permisos
      if (req.usuario.rol !== 'administrador' && req.usuario.sucursalId !== sucursalId) {
        return res.status(403).json({ mensaje: 'No tiene permisos para realizar esta acción' });
      }
  
      let resultado;
  
      switch (accion) {
        case 'simular':
          resultado = await entitiesMap['cuotificador'].simularPlan(datos);
          break;
          
        case 'crear-plan':
          datos.creadoPor = req.usuario.id;
          datos.sucursalId = sucursalId;
          datos.fechaCreacion = new Date();
          
          resultado = await entitiesMap['cuotificador'].crearPlan(datos);
          
          // Marcar para sincronización
          syncUtil.marcarParaSincronizacion('cuotificador', resultado.id, 'create', sucursalId);
          break;
          
        case 'registrar-pago':
          datos.registradoPor = req.usuario.id;
          datos.sucursalId = sucursalId;
          datos.fechaRegistro = new Date();
          
          resultado = await entitiesMap['cuotificador'].registrarPago(datos);
          
          // Marcar para sincronización
          syncUtil.marcarParaSincronizacion('cuotificador', datos.planId, 'update', sucursalId);
          break;
          
        case 'anular-plan':
          datos.anuladoPor = req.usuario.id;
          datos.fechaAnulacion = new Date();
          
          resultado = await entitiesMap['cuotificador'].anularPlan(datos.planId, datos);
          
          // Marcar para sincronización
          syncUtil.marcarParaSincronizacion('cuotificador', datos.planId, 'update', sucursalId);
          break;
  
        default:
          return res.status(400).json({ mensaje: 'Acción no válida' });
      }
  
      // Registrar en audit log
      logger.info(`Cuotificador - ${accion}`, {
        usuario: req.usuario.id,
        sucursal: sucursalId,
        datos: {
          planId: datos.planId || resultado.id || null,
          cliente: datos.clienteId || null,
          monto: datos.monto || null
        }
      });
  
      return res.status(200).json(resultado);
    } catch (error) {
      logger.error(`Error en cuotificador - ${req.params.accion}`, { 
        error: error.message,
        datos: req.body.datos
      });
      return res.status(500).json({ mensaje: 'Error al procesar operación de cuotas', error: error.message });
    }
  };
  
  /**
   * Gestiona la configuración del sistema
   * @param {Object} req - Solicitud HTTP
   * @param {Object} res - Respuesta HTTP
   */
  exports.gestionarConfiguracion = async (req, res) => {
    try {
      const { seccion, clave } = req.params;
      const { valor, sucursalId } = req.body;
      const sucursalObjetivo = sucursalId || req.sucursalId;
  
      // Solo administradores pueden modificar configuraciones
      if (req.usuario.rol !== 'administrador' && 
          (seccion !== 'usuario' || req.usuario.sucursalId !== sucursalObjetivo)) {
        return res.status(403).json({ mensaje: 'No tiene permisos para modificar la configuración' });
      }
  
      // Si es GET, devolver configuración
      if (req.method === 'GET') {
        let configuracion;
        
        if (clave) {
          // Obtener una clave específica
          configuracion = await entitiesMap['configuraciones'].obtenerValor(seccion, clave, sucursalObjetivo);
        } else {
          // Obtener todas las claves de una sección
          configuracion = await entitiesMap['configuraciones'].obtenerSeccion(seccion, sucursalObjetivo);
        }
        
        if (!configuracion) {
          return res.status(404).json({ mensaje: 'Configuración no encontrada' });
        }
        
        return res.status(200).json(configuracion);
      }
  
      // Si es PUT, actualizar configuración
      if (req.method === 'PUT') {
        if (!valor && valor !== false && valor !== 0) {
          return res.status(400).json({ mensaje: 'Valor de configuración no especificado' });
        }
        
        const resultado = await entitiesMap['configuraciones'].actualizarValor(
          seccion, 
          clave, 
          valor, 
          sucursalObjetivo, 
          req.usuario.id
        );
        
        // Marcar para sincronización
        syncUtil.marcarParaSincronizacion('configuraciones', `${seccion}:${clave}`, 'update', sucursalObjetivo);
        
        // Registrar en audit log
        logger.info(`Actualización de configuración: ${seccion}.${clave}`, {
          usuario: req.usuario.id,
          sucursal: sucursalObjetivo,
          valorAnterior: resultado.valorAnterior,
          valorNuevo: valor
        });
        
        return res.status(200).json({ mensaje: 'Configuración actualizada correctamente', resultado });
      }
  
      // Si es DELETE, eliminar configuración (restaurar a valor por defecto)
      if (req.method === 'DELETE') {
        const resultado = await entitiesMap['configuraciones'].restaurarDefecto(
          seccion, 
          clave, 
          sucursalObjetivo, 
          req.usuario.id
        );
        
        // Marcar para sincronización
        syncUtil.marcarParaSincronizacion('configuraciones', `${seccion}:${clave}`, 'delete', sucursalObjetivo);
        
        // Registrar en audit log
        logger.info(`Restauración de configuración: ${seccion}.${clave}`, {
          usuario: req.usuario.id,
          sucursal: sucursalObjetivo,
          valorAnterior: resultado.valorAnterior,
          valorDefecto: resultado.valorDefecto
        });
        
        return res.status(200).json({ mensaje: 'Configuración restaurada a valor por defecto', resultado });
      }
  
      return res.status(405).json({ mensaje: 'Método no permitido' });
    } catch (error) {
      logger.error(`Error en gestión de configuración ${req.params.seccion}.${req.params.clave}`, { 
        error: error.message,
        metodo: req.method
      });
      return res.status(500).json({ mensaje: 'Error al gestionar configuración', error: error.message });
    }
  };
  
  module.exports = exports;