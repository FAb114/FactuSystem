/**
 * Módulo para gestión de tasas de interés para el cuotificador
 * 
 * Este módulo permite:
 * - Obtener tasas de interés para diferentes bancos y tarjetas
 * - Guardar y editar configuraciones de tasas
 * - Calcular intereses y cuotas basados en las tasas configuradas
 * - Integración con diferentes bancos para actualización automática (opcional)
 */

// Importamos módulos necesarios
const database = require('../../../utils/database.js');
const logger = require('../../../utils/logger.js');
const auth = require('../../../utils/auth.js');
const { ipcRenderer } = require('electron');

// Definimos la clase principal para gestión de tasas
class TasasManager {
    constructor() {
        this.tasas = null;
        this.bancos = null;
        this.tarjetas = null;
        this.loaded = false;
        
        // Bindings para mantener el contexto
        this.cargarTasas = this.cargarTasas.bind(this);
        this.obtenerTasaPorBancoTarjetaCuotas = this.obtenerTasaPorBancoTarjetaCuotas.bind(this);
        this.guardarTasa = this.guardarTasa.bind(this);
        this.eliminarTasa = this.eliminarTasa.bind(this);
        this.actualizarTasasDesdeAPI = this.actualizarTasasDesdeAPI.bind(this);
        this.calcularCuotas = this.calcularCuotas.bind(this);
    }

    /**
     * Carga todas las tasas de interés desde la base de datos
     * @returns {Promise} - Promesa con las tasas cargadas
     */
    async cargarTasas() {
        try {
            const conn = await database.getConnection();
            
            // Cargamos los bancos
            this.bancos = await conn.all('SELECT * FROM bancos ORDER BY nombre');
            
            // Cargamos las tarjetas
            this.tarjetas = await conn.all('SELECT * FROM tarjetas ORDER BY nombre');
            
            // Cargamos todas las tasas configuradas
            this.tasas = await conn.all(`
                SELECT t.*, b.nombre as banco_nombre, tj.nombre as tarjeta_nombre 
                FROM tasas_interes t
                LEFT JOIN bancos b ON t.banco_id = b.id
                LEFT JOIN tarjetas tj ON t.tarjeta_id = tj.id
                ORDER BY b.nombre, tj.nombre, t.cuotas
            `);
            
            this.loaded = true;
            logger.log('info', 'Tasas de interés cargadas correctamente', { 
                modulo: 'cuotificador', 
                accion: 'cargarTasas', 
                usuario: auth.getCurrentUser().username 
            });
            
            return {
                tasas: this.tasas,
                bancos: this.bancos,
                tarjetas: this.tarjetas
            };
        } catch (error) {
            logger.log('error', 'Error al cargar tasas de interés', { 
                modulo: 'cuotificador', 
                accion: 'cargarTasas', 
                error: error.message,
                usuario: auth.getCurrentUser().username 
            });
            throw new Error(`Error al cargar tasas: ${error.message}`);
        }
    }

    /**
     * Obtiene la tasa de interés para un banco, tarjeta y cantidad de cuotas específicos
     * @param {Number} bancoId - ID del banco
     * @param {Number} tarjetaId - ID de la tarjeta
     * @param {Number} cuotas - Cantidad de cuotas
     * @returns {Object|null} - Objeto con la tasa encontrada o null si no existe
     */
    async obtenerTasaPorBancoTarjetaCuotas(bancoId, tarjetaId, cuotas) {
        if (!this.loaded) {
            await this.cargarTasas();
        }
        
        // Buscamos la tasa específica
        const tasa = this.tasas.find(t => 
            t.banco_id === bancoId && 
            t.tarjeta_id === tarjetaId && 
            t.cuotas === cuotas
        );
        
        // Si no encontramos tasa específica, intentamos con una genérica para esa cantidad de cuotas
        if (!tasa) {
            const tasaGenerica = this.tasas.find(t => 
                t.banco_id === 0 && 
                t.tarjeta_id === tarjetaId && 
                t.cuotas === cuotas
            );
            
            if (tasaGenerica) {
                return tasaGenerica;
            }
            
            // Retornamos null si no hay configuración para esas cuotas
            return null;
        }
        
        return tasa;
    }

    /**
     * Guarda o actualiza una tasa de interés
     * @param {Object} tasa - Datos de la tasa a guardar
     * @returns {Promise} - Promesa con el resultado de la operación
     */
    async guardarTasa(tasa) {
        try {
            const conn = await database.getConnection();
            const usuario = auth.getCurrentUser();
            
            // Verificamos si el usuario tiene permisos
            if (!auth.hasPermission('cuotificador.configurar_tasas')) {
                throw new Error('No tiene permisos para configurar tasas de interés');
            }
            
            let result;
            
            // Si tiene ID, actualizamos, sino insertamos
            if (tasa.id) {
                result = await conn.run(`
                    UPDATE tasas_interes 
                    SET banco_id = ?, tarjeta_id = ?, cuotas = ?, 
                        tasa = ?, recargo_fijo = ?, actualizado_por = ?, 
                        actualizado_en = CURRENT_TIMESTAMP
                    WHERE id = ?
                `, [
                    tasa.banco_id, 
                    tasa.tarjeta_id, 
                    tasa.cuotas, 
                    tasa.tasa, 
                    tasa.recargo_fijo || 0, 
                    usuario.id,
                    tasa.id
                ]);
                
                logger.log('info', 'Tasa de interés actualizada', { 
                    modulo: 'cuotificador', 
                    accion: 'actualizarTasa', 
                    tasa_id: tasa.id,
                    usuario: usuario.username 
                });
            } else {
                // Verificamos si ya existe una configuración para este banco/tarjeta/cuotas
                const existente = await conn.get(`
                    SELECT id FROM tasas_interes 
                    WHERE banco_id = ? AND tarjeta_id = ? AND cuotas = ?
                `, [tasa.banco_id, tasa.tarjeta_id, tasa.cuotas]);
                
                if (existente) {
                    throw new Error('Ya existe una configuración para este banco, tarjeta y cantidad de cuotas');
                }
                
                result = await conn.run(`
                    INSERT INTO tasas_interes (
                        banco_id, tarjeta_id, cuotas, tasa, recargo_fijo,
                        creado_por, creado_en
                    ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                `, [
                    tasa.banco_id, 
                    tasa.tarjeta_id, 
                    tasa.cuotas, 
                    tasa.tasa, 
                    tasa.recargo_fijo || 0, 
                    usuario.id
                ]);
                
                logger.log('info', 'Tasa de interés creada', { 
                    modulo: 'cuotificador', 
                    accion: 'crearTasa', 
                    tasa_id: result.lastID,
                    usuario: usuario.username 
                });
            }
            
            // Recargamos las tasas para mantener actualizada la caché
            await this.cargarTasas();
            
            return {
                success: true, 
                message: tasa.id ? 'Tasa actualizada correctamente' : 'Tasa creada correctamente',
                tasas: this.tasas
            };
        } catch (error) {
            logger.log('error', 'Error al guardar tasa de interés', { 
                modulo: 'cuotificador', 
                accion: 'guardarTasa', 
                error: error.message,
                usuario: auth.getCurrentUser().username 
            });
            throw new Error(`Error al guardar tasa: ${error.message}`);
        }
    }

    /**
     * Elimina una tasa de interés
     * @param {Number} tasaId - ID de la tasa a eliminar
     * @returns {Promise} - Promesa con el resultado de la operación
     */
    async eliminarTasa(tasaId) {
        try {
            // Verificamos permisos
            if (!auth.hasPermission('cuotificador.configurar_tasas')) {
                throw new Error('No tiene permisos para eliminar tasas de interés');
            }
            
            const conn = await database.getConnection();
            const usuario = auth.getCurrentUser();
            
            await conn.run('DELETE FROM tasas_interes WHERE id = ?', [tasaId]);
            
            logger.log('info', 'Tasa de interés eliminada', { 
                modulo: 'cuotificador', 
                accion: 'eliminarTasa', 
                tasa_id: tasaId,
                usuario: usuario.username 
            });
            
            // Recargamos las tasas para mantener actualizada la caché
            await this.cargarTasas();
            
            return {
                success: true, 
                message: 'Tasa eliminada correctamente',
                tasas: this.tasas
            };
        } catch (error) {
            logger.log('error', 'Error al eliminar tasa de interés', { 
                modulo: 'cuotificador', 
                accion: 'eliminarTasa', 
                error: error.message,
                usuario: auth.getCurrentUser().username 
            });
            throw new Error(`Error al eliminar tasa: ${error.message}`);
        }
    }

    /**
     * Actualiza tasas desde APIs de bancos (si están configuradas)
     * @param {String} bancoId - ID del banco para actualizar (opcional, si no se especifica actualiza todos)
     * @returns {Promise} - Promesa con el resultado de la actualización
     */
    async actualizarTasasDesdeAPI(bancoId = null) {
        try {
            if (!auth.hasPermission('cuotificador.actualizar_tasas_api')) {
                throw new Error('No tiene permisos para actualizar tasas desde APIs');
            }
            
            const conn = await database.getConnection();
            const usuario = auth.getCurrentUser();
            
            // Obtenemos los bancos a actualizar
            let bancosActualizar = [];
            if (bancoId) {
                bancosActualizar = this.bancos.filter(b => b.id === bancoId && b.api_habilitada === 1);
            } else {
                bancosActualizar = this.bancos.filter(b => b.api_habilitada === 1);
            }
            
            if (bancosActualizar.length === 0) {
                return {
                    success: false,
                    message: bancoId ? 'El banco seleccionado no tiene API configurada' : 'No hay bancos con API configurada'
                };
            }
            
            // Resultados de la actualización
            const resultados = [];
            
            // Para cada banco, intentamos actualizar sus tasas
            for (const banco of bancosActualizar) {
                try {
                    // Llamamos al IPC para que el proceso principal haga la solicitud HTTP
                    // ya que en Electron es más seguro hacer las solicitudes desde el proceso principal
                    const apiResult = await ipcRenderer.invoke('banco-api-get-tasas', {
                        banco: banco.codigo,
                        config: {
                            apiKey: banco.api_key,
                            apiUrl: banco.api_url
                        }
                    });
                    
                    if (!apiResult.success) {
                        resultados.push({
                            banco: banco.nombre,
                            success: false,
                            message: apiResult.message
                        });
                        continue;
                    }
                    
                    // Procesamos las tasas recibidas
                    for (const tasaApi of apiResult.tasas) {
                        // Buscamos la tarjeta correspondiente
                        const tarjeta = this.tarjetas.find(t => 
                            t.codigo.toLowerCase() === tasaApi.tarjeta.toLowerCase()
                        );
                        
                        if (!tarjeta) continue;
                        
                        // Buscamos si ya existe esta tasa
                        const tasaExistente = await conn.get(`
                            SELECT id FROM tasas_interes 
                            WHERE banco_id = ? AND tarjeta_id = ? AND cuotas = ?
                        `, [banco.id, tarjeta.id, tasaApi.cuotas]);
                        
                        if (tasaExistente) {
                            // Actualizamos la tasa existente
                            await conn.run(`
                                UPDATE tasas_interes 
                                SET tasa = ?, recargo_fijo = ?, actualizado_por = ?, 
                                    actualizado_en = CURRENT_TIMESTAMP,
                                    ultima_actualizacion_api = CURRENT_TIMESTAMP
                                WHERE id = ?
                            `, [
                                tasaApi.tasa,
                                tasaApi.recargo_fijo || 0,
                                usuario.id,
                                tasaExistente.id
                            ]);
                        } else {
                            // Creamos la nueva tasa
                            await conn.run(`
                                INSERT INTO tasas_interes (
                                    banco_id, tarjeta_id, cuotas, tasa, recargo_fijo,
                                    creado_por, creado_en, ultima_actualizacion_api
                                ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                            `, [
                                banco.id,
                                tarjeta.id,
                                tasaApi.cuotas,
                                tasaApi.tasa,
                                tasaApi.recargo_fijo || 0,
                                usuario.id
                            ]);
                        }
                    }
                    
                    resultados.push({
                        banco: banco.nombre,
                        success: true,
                        message: 'Tasas actualizadas correctamente',
                        tasas_actualizadas: apiResult.tasas.length
                    });
                    
                    logger.log('info', 'Tasas actualizadas desde API', { 
                        modulo: 'cuotificador', 
                        accion: 'actualizarTasasAPI', 
                        banco: banco.nombre,
                        tasas_actualizadas: apiResult.tasas.length,
                        usuario: usuario.username 
                    });
                } catch (bancoError) {
                    resultados.push({
                        banco: banco.nombre,
                        success: false,
                        message: `Error: ${bancoError.message}`
                    });
                    
                    logger.log('error', 'Error al actualizar tasas desde API', { 
                        modulo: 'cuotificador', 
                        accion: 'actualizarTasasAPI', 
                        banco: banco.nombre,
                        error: bancoError.message,
                        usuario: usuario.username 
                    });
                }
            }
            
            // Recargamos las tasas para mantener actualizada la caché
            await this.cargarTasas();
            
            return {
                success: true,
                message: 'Proceso de actualización completado',
                resultados
            };
        } catch (error) {
            logger.log('error', 'Error en el proceso de actualización de tasas', { 
                modulo: 'cuotificador', 
                accion: 'actualizarTasasDesdeAPI', 
                error: error.message,
                usuario: auth.getCurrentUser().username 
            });
            throw new Error(`Error al actualizar tasas desde API: ${error.message}`);
        }
    }

    /**
     * Calcula las cuotas para un monto dado
     * @param {Number} monto - Monto a financiar
     * @param {Number} bancoId - ID del banco
     * @param {Number} tarjetaId - ID de la tarjeta
     * @param {Number} cuotas - Cantidad de cuotas
     * @returns {Object} - Información de las cuotas calculadas
     */
    async calcularCuotas(monto, bancoId, tarjetaId, cuotas) {
        try {
            if (!this.loaded) {
                await this.cargarTasas();
            }
            
            // Obtenemos la tasa correspondiente
            const tasa = await this.obtenerTasaPorBancoTarjetaCuotas(bancoId, tarjetaId, cuotas);
            
            if (!tasa) {
                throw new Error('No se encontró configuración de tasa para los parámetros seleccionados');
            }
            
            // Calculamos el monto con interés
            const tasaPct = tasa.tasa / 100;
            const recargoFijo = tasa.recargo_fijo || 0;
            
            // Calculamos interés (fórmula: monto * (1 + tasa * cuotas / 12))
            const montoConInteres = monto * (1 + (tasaPct * cuotas) / 12) + recargoFijo;
            
            // Calculamos valor de cada cuota
            const valorCuota = montoConInteres / cuotas;
            
            // Calculamos el costo financiero total
            const cft = ((montoConInteres / monto - 1) * 12 / cuotas * 100).toFixed(2);
            
            // Obtenemos info del banco y tarjeta
            const banco = this.bancos.find(b => b.id === bancoId) || { nombre: 'Genérico' };
            const tarjeta = this.tarjetas.find(t => t.id === tarjetaId);
            
            if (!tarjeta) {
                throw new Error('Tarjeta no encontrada');
            }
            
            // Generamos el detalle de cuotas
            const detalleCuotas = [];
            for (let i = 1; i <= cuotas; i++) {
                detalleCuotas.push({
                    numero: i,
                    monto: valorCuota.toFixed(2)
                });
            }
            
            return {
                success: true,
                datos: {
                    banco: banco.nombre,
                    tarjeta: tarjeta.nombre,
                    monto_original: parseFloat(monto).toFixed(2),
                    monto_con_interes: montoConInteres.toFixed(2),
                    cantidad_cuotas: cuotas,
                    valor_cuota: valorCuota.toFixed(2),
                    tasa_nominal_anual: tasa.tasa.toFixed(2) + '%',
                    costo_financiero_total: cft + '%',
                    recargo_fijo: recargoFijo.toFixed(2),
                    detalle_cuotas: detalleCuotas
                }
            };
        } catch (error) {
            logger.log('error', 'Error al calcular cuotas', { 
                modulo: 'cuotificador', 
                accion: 'calcularCuotas', 
                error: error.message,
                monto, bancoId, tarjetaId, cuotas,
                usuario: auth.getCurrentUser().username 
            });
            return {
                success: false,
                message: error.message
            };
        }
    }
    
    /**
     * Crea una nueva tarjeta en el sistema
     * @param {Object} tarjeta - Datos de la tarjeta
     * @returns {Promise} - Promesa con el resultado
     */
    async crearTarjeta(tarjeta) {
        try {
            if (!auth.hasPermission('cuotificador.gestionar_tarjetas')) {
                throw new Error('No tiene permisos para gestionar tarjetas');
            }
            
            const conn = await database.getConnection();
            const usuario = auth.getCurrentUser();
            
            // Validamos que tenga los campos requeridos
            if (!tarjeta.nombre || !tarjeta.codigo) {
                throw new Error('Falta el nombre o código de la tarjeta');
            }
            
            // Verificamos que no exista una tarjeta con el mismo nombre o código
            const tarjetaExistente = await conn.get(
                'SELECT id FROM tarjetas WHERE nombre = ? OR codigo = ?',
                [tarjeta.nombre, tarjeta.codigo]
            );
            
            if (tarjetaExistente) {
                throw new Error('Ya existe una tarjeta con ese nombre o código');
            }
            
            // Creamos la tarjeta
            const result = await conn.run(`
                INSERT INTO tarjetas (
                    nombre, codigo, tipo, activo, creado_por, creado_en
                ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `, [
                tarjeta.nombre,
                tarjeta.codigo,
                tarjeta.tipo || 'credito',
                tarjeta.activo === false ? 0 : 1,
                usuario.id
            ]);
            
            logger.log('info', 'Tarjeta creada', { 
                modulo: 'cuotificador', 
                accion: 'crearTarjeta', 
                tarjeta_id: result.lastID,
                usuario: usuario.username 
            });
            
            // Recargamos las tarjetas
            await this.cargarTasas();
            
            return {
                success: true,
                message: 'Tarjeta creada correctamente',
                tarjeta_id: result.lastID,
                tarjetas: this.tarjetas
            };
        } catch (error) {
            logger.log('error', 'Error al crear tarjeta', { 
                modulo: 'cuotificador', 
                accion: 'crearTarjeta', 
                error: error.message,
                usuario: auth.getCurrentUser().username 
            });
            throw new Error(`Error al crear tarjeta: ${error.message}`);
        }
    }
    
    /**
     * Crea un nuevo banco en el sistema
     * @param {Object} banco - Datos del banco
     * @returns {Promise} - Promesa con el resultado
     */
    async crearBanco(banco) {
        try {
            if (!auth.hasPermission('cuotificador.gestionar_bancos')) {
                throw new Error('No tiene permisos para gestionar bancos');
            }
            
            const conn = await database.getConnection();
            const usuario = auth.getCurrentUser();
            
            // Validamos que tenga los campos requeridos
            if (!banco.nombre || !banco.codigo) {
                throw new Error('Falta el nombre o código del banco');
            }
            
            // Verificamos que no exista un banco con el mismo nombre o código
            const bancoExistente = await conn.get(
                'SELECT id FROM bancos WHERE nombre = ? OR codigo = ?',
                [banco.nombre, banco.codigo]
            );
            
            if (bancoExistente) {
                throw new Error('Ya existe un banco con ese nombre o código');
            }
            
            // Creamos el banco
            const result = await conn.run(`
                INSERT INTO bancos (
                    nombre, codigo, activo, api_habilitada, api_url, api_key,
                    creado_por, creado_en
                ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `, [
                banco.nombre,
                banco.codigo,
                banco.activo === false ? 0 : 1,
                banco.api_habilitada === true ? 1 : 0,
                banco.api_url || null,
                banco.api_key || null,
                usuario.id
            ]);
            
            logger.log('info', 'Banco creado', { 
                modulo: 'cuotificador', 
                accion: 'crearBanco', 
                banco_id: result.lastID,
                usuario: usuario.username 
            });
            
            // Recargamos los bancos
            await this.cargarTasas();
            
            return {
                success: true,
                message: 'Banco creado correctamente',
                banco_id: result.lastID,
                bancos: this.bancos
            };
        } catch (error) {
            logger.log('error', 'Error al crear banco', { 
                modulo: 'cuotificador', 
                accion: 'crearBanco', 
                error: error.message,
                usuario: auth.getCurrentUser().username 
            });
            throw new Error(`Error al crear banco: ${error.message}`);
        }
    }
    
    /**
     * Obtiene datos para poblar el selector de cuotas según banco y tarjeta
     * @param {Number} bancoId - ID del banco
     * @param {Number} tarjetaId - ID de la tarjeta
     * @returns {Promise} - Promesa con las opciones de cuotas disponibles
     */
    async obtenerOpcionesCuotas(bancoId, tarjetaId) {
        try {
            if (!this.loaded) {
                await this.cargarTasas();
            }
            
            // Filtramos las tasas que coinciden con el banco y tarjeta
            const tasasDisponibles = this.tasas.filter(t => 
                (t.banco_id === bancoId || t.banco_id === 0) && 
                t.tarjeta_id === tarjetaId
            );
            
            // Si no hay tasas específicas para ese banco/tarjeta, retornamos error
            if (tasasDisponibles.length === 0) {
                return {
                    success: false,
                    message: 'No hay planes de cuotas configurados para esta combinación de banco y tarjeta'
                };
            }
            
            // Agrupamos por cantidad de cuotas para evitar duplicados
            const cuotasUnicas = [...new Set(tasasDisponibles.map(t => t.cuotas))];
            cuotasUnicas.sort((a, b) => a - b); // Ordenamos de menor a mayor
            
            // Formateamos para el selector
            const opciones = cuotasUnicas.map(cuota => ({
                value: cuota,
                label: cuota === 1 ? '1 cuota' : `${cuota} cuotas`
            }));
            
            return {
                success: true,
                opciones
            };
        } catch (error) {
            logger.log('error', 'Error al obtener opciones de cuotas', { 
                modulo: 'cuotificador', 
                accion: 'obtenerOpcionesCuotas', 
                error: error.message,
                bancoId, tarjetaId,
                usuario: auth.getCurrentUser().username 
            });
            return {
                success: false,
                message: `Error al obtener opciones de cuotas: ${error.message}`
            };
        }
    }
    
    /**
     * Importa tasas masivamente desde un archivo CSV
     * @param {Array} tasasData - Array con los datos de tasas a importar
     * @returns {Promise} - Promesa con el resultado de la importación
     */
    async importarTasasDesdeCSV(tasasData) {
        try {
            if (!auth.hasPermission('cuotificador.importar_tasas')) {
                throw new Error('No tiene permisos para importar tasas');
            }
            
            const conn = await database.getConnection();
            const usuario = auth.getCurrentUser();
            
            let importadas = 0;
            let errores = 0;
            const detalleErrores = [];
            
            // Para cada tasa en el CSV
            for (const filaTasa of tasasData) {
                try {
                    // Buscamos el banco por código
                    const banco = this.bancos.find(b => 
                        b.codigo.toLowerCase() === filaTasa.banco_codigo.toLowerCase() ||
                        b.nombre.toLowerCase() === filaTasa.banco_codigo.toLowerCase()
                    );
                    
                    if (!banco) {
                        detalleErrores.push(`Banco no encontrado: ${filaTasa.banco_codigo}`);
                        errores++;
                        continue;
                    }
                    
                    // Buscamos la tarjeta por código
                    const tarjeta = this.tarjetas.find(t => 
                        t.codigo.toLowerCase() === filaTasa.tarjeta_codigo.toLowerCase() ||
                        t.nombre.toLowerCase() === filaTasa.tarjeta_codigo.toLowerCase()
                    );
                    
                    if (!tarjeta) {
                        detalleErrores.push(`Tarjeta no encontrada: ${filaTasa.tarjeta_codigo}`);
                        errores++;
                        continue;
                    }
                    
                    // Validamos la tasa
                    const cuotas = parseInt(filaTasa.cuotas);
                    const tasa = parseFloat(filaTasa.tasa);
                    const recargoFijo = parseFloat(filaTasa.recargo_fijo || 0);
                    
                    if (isNaN(cuotas) || cuotas <= 0) {
                        detalleErrores.push(`Cantidad de cuotas inválida: ${filaTasa.cuotas}`);
                        errores++;
                        continue;
                    }
                    
                    if (isNaN(tasa) || tasa < 0) {
                        detalleErrores.push(`Tasa inválida: ${filaTasa.tasa}`);
                        errores++;
                        continue;
                    }
                    
                    // Buscamos si ya existe esta combinación
                    const existente = await conn.get(`
                        SELECT id FROM tasas_interes 
                        WHERE banco_id = ? AND tarjeta_id = ? AND cuotas = ?
                    `, [banco.id, tarjeta.id, cuotas]);
                    
                    if (existente) {
                        // Actualizamos
                        await conn.run(`
                            UPDATE tasas_interes 
                            SET tasa = ?, recargo_fijo = ?,
                                actualizado_por = ?, actualizado_en = CURRENT_TIMESTAMP
                            WHERE id = ?
                        `, [
                            tasa,
                            recargoFijo,
                            usuario.id,
                            existente.id
                        ]);
                        
                        importadas++;
                    } else {
                        // Insertamos nueva tasa
                        await conn.run(`
                            INSERT INTO tasas_interes (
                                banco_id, tarjeta_id, cuotas, tasa, recargo_fijo,
                                creado_por, creado_en
                            ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                        `, [
                            banco.id,
                            tarjeta.id,
                            cuotas,
                            tasa,
                            recargoFijo,
                            usuario.id
                        ]);
                        
                        importadas++;
                    }
                } catch (rowError) {
                    detalleErrores.push(`Error en fila ${importadas + errores + 1}: ${rowError.message}`);
                    errores++;
                }
            }
            
            logger.log('info', 'Importación de tasas completada', { 
                modulo: 'cuotificador', 
                accion: 'importarTasasDesdeCSV', 
                importadas,
                errores,
                usuario: usuario.username 
            });
            
            // Recargamos las tasas
            await this.cargarTasas();
            
            return {
                success: true,
                message: `Importación completada: ${importadas} tasas importadas, ${errores} errores`,
                importadas,
                errores,
                detalleErrores: detalleErrores.length > 0 ? detalleErrores : null
            };
        } catch (error) {
            logger.log('error', 'Error en importación masiva de tasas', { 
                modulo: 'cuotificador', 
                accion: 'importarTasasDesdeCSV', 
                error: error.message,
                usuario: auth.getCurrentUser().username 
            });
            throw new Error(`Error en importación de tasas: ${error.message}`);
        }
    }
    
    /**
     * Exporta todas las tasas configuradas en formato CSV
     * @returns {Promise} - Promesa con los datos CSV
     */
    async exportarTasasCSV() {
        try {
            if (!this.loaded) {
                await this.cargarTasas();
            }
            
            // Generamos los datos para CSV
            const csvData = [];
            
            // Encabezados
            csvData.push([
                'banco_codigo',
                'banco_nombre',
                'tarjeta_codigo',
                'tarjeta_nombre',
                'cuotas',
                'tasa',
                'recargo_fijo',
                'ultima_actualizacion'
            ]);
            
            // Filas de datos
            for (const tasa of this.tasas) {
                const banco = this.bancos.find(b => b.id === tasa.banco_id);
                const tarjeta = this.tarjetas.find(t => t.id === tasa.tarjeta_id);
                
                if (!banco || !tarjeta) continue;
                
                csvData.push([
                    banco.codigo,
                    banco.nombre,
                    tarjeta.codigo,
                    tarjeta.nombre,
                    tasa.cuotas,
                    tasa.tasa,
                    tasa.recargo_fijo || 0,
                    tasa.actualizado_en || tasa.creado_en
                ]);
            }
            
            logger.log('info', 'Exportación de tasas a CSV', { 
                modulo: 'cuotificador', 
                accion: 'exportarTasasCSV', 
                cantidad: csvData.length - 1,
                usuario: auth.getCurrentUser().username 
            });
            
            return {
                success: true,
                csvData,
                message: `Se exportaron ${csvData.length - 1} tasas de interés`
            };
        } catch (error) {
            logger.log('error', 'Error al exportar tasas a CSV', { 
                modulo: 'cuotificador', 
                accion: 'exportarTasasCSV', 
                error: error.message,
                usuario: auth.getCurrentUser().username 
            });
            return {
                success: false,
                message: `Error al exportar tasas: ${error.message}`
            };
        }
    }
    
    /**
     * Actualiza una tarjeta existente
     * @param {Object} tarjeta - Datos de la tarjeta a actualizar
     * @returns {Promise} - Promesa con el resultado
     */
    async actualizarTarjeta(tarjeta) {
        try {
            if (!auth.hasPermission('cuotificador.gestionar_tarjetas')) {
                throw new Error('No tiene permisos para gestionar tarjetas');
            }
            
            const conn = await database.getConnection();
            const usuario = auth.getCurrentUser();
            
            // Validamos que tenga ID y campos requeridos
            if (!tarjeta.id) {
                throw new Error('Se requiere el ID de la tarjeta para actualizarla');
            }
            
            if (!tarjeta.nombre || !tarjeta.codigo) {
                throw new Error('Falta el nombre o código de la tarjeta');
            }
            
            // Verificamos que no exista otra tarjeta con el mismo nombre o código
            const tarjetaExistente = await conn.get(`
                SELECT id FROM tarjetas 
                WHERE (nombre = ? OR codigo = ?) AND id != ?
            `, [tarjeta.nombre, tarjeta.codigo, tarjeta.id]);
            
            if (tarjetaExistente) {
                throw new Error('Ya existe otra tarjeta con ese nombre o código');
            }
            
            // Actualizamos la tarjeta
            await conn.run(`
                UPDATE tarjetas
                SET nombre = ?, codigo = ?, tipo = ?, activo = ?,
                    actualizado_por = ?, actualizado_en = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [
                tarjeta.nombre,
                tarjeta.codigo,
                tarjeta.tipo || 'credito',
                tarjeta.activo === false ? 0 : 1,
                usuario.id,
                tarjeta.id
            ]);
            
            logger.log('info', 'Tarjeta actualizada', { 
                modulo: 'cuotificador', 
                accion: 'actualizarTarjeta', 
                tarjeta_id: tarjeta.id,
                usuario: usuario.username 
            });
            
            // Recargamos las tarjetas
            await this.cargarTasas();
            
            return {
                success: true,
                message: 'Tarjeta actualizada correctamente',
                tarjetas: this.tarjetas
            };
        } catch (error) {
            logger.log('error', 'Error al actualizar tarjeta', { 
                modulo: 'cuotificador', 
                accion: 'actualizarTarjeta', 
                error: error.message,
                usuario: auth.getCurrentUser().username 
            });
            throw new Error(`Error al actualizar tarjeta: ${error.message}`);
        }
    }
    
    /**
     * Actualiza un banco existente
     * @param {Object} banco - Datos del banco a actualizar
     * @returns {Promise} - Promesa con el resultado
     */
    async actualizarBanco(banco) {
        try {
            if (!auth.hasPermission('cuotificador.gestionar_bancos')) {
                throw new Error('No tiene permisos para gestionar bancos');
            }
            
            const conn = await database.getConnection();
            const usuario = auth.getCurrentUser();
            
            // Validamos que tenga ID y campos requeridos
            if (!banco.id) {
                throw new Error('Se requiere el ID del banco para actualizarlo');
            }
            
            if (!banco.nombre || !banco.codigo) {
                throw new Error('Falta el nombre o código del banco');
            }
            
            // Verificamos que no exista otro banco con el mismo nombre o código
            const bancoExistente = await conn.get(`
                SELECT id FROM bancos 
                WHERE (nombre = ? OR codigo = ?) AND id != ?
            `, [banco.nombre, banco.codigo, banco.id]);
            
            if (bancoExistente) {
                throw new Error('Ya existe otro banco con ese nombre o código');
            }
            
            // Actualizamos el banco
            await conn.run(`
                UPDATE bancos
                SET nombre = ?, codigo = ?, activo = ?, 
                    api_habilitada = ?, api_url = ?, api_key = ?,
                    actualizado_por = ?, actualizado_en = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [
                banco.nombre,
                banco.codigo,
                banco.activo === false ? 0 : 1,
                banco.api_habilitada === true ? 1 : 0,
                banco.api_url || null,
                banco.api_key || null,
                usuario.id,
                banco.id
            ]);
            
            logger.log('info', 'Banco actualizado', { 
                modulo: 'cuotificador', 
                accion: 'actualizarBanco', 
                banco_id: banco.id,
                usuario: usuario.username 
            });
            
            // Recargamos los bancos
            await this.cargarTasas();
            
            return {
                success: true,
                message: 'Banco actualizado correctamente',
                bancos: this.bancos
            };
        } catch (error) {
            logger.log('error', 'Error al actualizar banco', { 
                modulo: 'cuotificador', 
                accion: 'actualizarBanco', 
                error: error.message,
                usuario: auth.getCurrentUser().username 
            });
            throw new Error(`Error al actualizar banco: ${error.message}`);
        }
    }
    
    /**
     * Obtiene datos para el dashboard de tasas
     * @returns {Promise} - Promesa con los datos del dashboard
     */
    async obtenerDashboardTasas() {
        try {
            if (!this.loaded) {
                await this.cargarTasas();
            }
            
            // Obtenemos banco y tarjeta con más tasas configuradas
            const bancosPorCantidad = {};
            const tarjetasPorCantidad = {};
            
            for (const tasa of this.tasas) {
                // Contamos por banco
                if (tasa.banco_id !== 0) { // Excluimos el banco genérico
                    bancosPorCantidad[tasa.banco_id] = (bancosPorCantidad[tasa.banco_id] || 0) + 1;
                }
                
                // Contamos por tarjeta
                tarjetasPorCantidad[tasa.tarjeta_id] = (tarjetasPorCantidad[tasa.tarjeta_id] || 0) + 1;
            }
            
            // Encontramos el banco con más tasas
            let bancoConMasTasas = null;
            let maxTasasBanco = 0;
            
            for (const bancoId in bancosPorCantidad) {
                if (bancosPorCantidad[bancoId] > maxTasasBanco) {
                    maxTasasBanco = bancosPorCantidad[bancoId];
                    bancoConMasTasas = this.bancos.find(b => b.id === parseInt(bancoId));
                }
            }
            
            // Encontramos la tarjeta con más tasas
            let tarjetaConMasTasas = null;
            let maxTasasTarjeta = 0;
            
            for (const tarjetaId in tarjetasPorCantidad) {
                if (tarjetasPorCantidad[tarjetaId] > maxTasasTarjeta) {
                    maxTasasTarjeta = tarjetasPorCantidad[tarjetaId];
                    tarjetaConMasTasas = this.tarjetas.find(t => t.id === parseInt(tarjetaId));
                }
            }
            
            // Estadísticas generales
            const estadisticas = {
                total_tasas: this.tasas.length,
                total_bancos: this.bancos.length,
                total_tarjetas: this.tarjetas.length,
                banco_con_mas_tasas: bancoConMasTasas ? {
                    nombre: bancoConMasTasas.nombre,
                    cantidad: maxTasasBanco
                } : null,
                tarjeta_con_mas_tasas: tarjetaConMasTasas ? {
                    nombre: tarjetaConMasTasas.nombre,
                    cantidad: maxTasasTarjeta
                } : null,
                promedio_tasa: this.tasas.reduce((sum, tasa) => sum + tasa.tasa, 0) / this.tasas.length,
                maxima_tasa: Math.max(...this.tasas.map(tasa => tasa.tasa)),
                minima_tasa: Math.min(...this.tasas.map(tasa => tasa.tasa))
            };
            
            // Datos para gráficos
            const datosTasasPorBanco = [];
            const bancosProcesados = new Set();
            
            for (const tasa of this.tasas) {
                // Solo incluimos una vez cada banco y excluimos el genérico
                if (tasa.banco_id !== 0 && !bancosProcesados.has(tasa.banco_id)) {
                    const banco = this.bancos.find(b => b.id === tasa.banco_id);
                    if (banco) {
                        datosTasasPorBanco.push({
                            banco: banco.nombre,
                            cantidad: bancosPorCantidad[tasa.banco_id] || 0
                        });
                        bancosProcesados.add(tasa.banco_id);
                    }
                }
            }
            
            // Ordenamos por cantidad (mayor a menor)
            datosTasasPorBanco.sort((a, b) => b.cantidad - a.cantidad);
            
            // Datos para gráfico de cuotas más usadas
            const cuotasPorCantidad = {};
            for (const tasa of this.tasas) {
                cuotasPorCantidad[tasa.cuotas] = (cuotasPorCantidad[tasa.cuotas] || 0) + 1;
            }
            
            const datosCuotas = Object.keys(cuotasPorCantidad).map(cuotas => ({
                cuotas: parseInt(cuotas),
                cantidad: cuotasPorCantidad[cuotas]
            }));
            
            // Ordenamos por cantidad de cuotas (ascendente)
            datosCuotas.sort((a, b) => a.cuotas - b.cuotas);
            
            // Tasas actualizadas recientemente
            const tasasRecientes = this.tasas
                .filter(t => t.actualizado_en)
                .sort((a, b) => new Date(b.actualizado_en) - new Date(a.actualizado_en))
                .slice(0, 5)
                .map(t => {
                    const banco = this.bancos.find(b => b.id === t.banco_id) || { nombre: 'Genérico' };
                    const tarjeta = this.tarjetas.find(tj => tj.id === t.tarjeta_id) || { nombre: 'Desconocida' };
                    
                    return {
                        id: t.id,
                        banco: banco.nombre,
                        tarjeta: tarjeta.nombre,
                        cuotas: t.cuotas,
                        tasa: t.tasa,
                        actualizado_en: t.actualizado_en
                    };
                });
            
            return {
                success: true,
                estadisticas,
                grafico_bancos: datosTasasPorBanco,
                grafico_cuotas: datosCuotas,
                actualizaciones_recientes: tasasRecientes
            };
        } catch (error) {
            logger.log('error', 'Error al obtener dashboard de tasas', { 
                modulo: 'cuotificador', 
                accion: 'obtenerDashboardTasas', 
                error: error.message,
                usuario: auth.getCurrentUser().username 
            });
            return {
                success: false,
                message: `Error al cargar dashboard: ${error.message}`
            };
        }
    }
    
    /**
     * Obtiene tasas para mostrar en tabla con paginación y filtros
     * @param {Object} options - Opciones de filtrado y paginación
     * @returns {Promise} - Promesa con las tasas filtradas
     */
    async obtenerTasasTabla(options = {}) {
        try {
            if (!this.loaded) {
                await this.cargarTasas();
            }
            
            const {
                bancoId,
                tarjetaId,
                cuotasDesde,
                cuotasHasta,
                tasaDesde,
                tasaHasta,
                page = 1,
                limit = 20,
                sortBy = 'banco',
                sortDir = 'asc'
            } = options;
            
            // Aplicamos filtros
            let tasasFiltradas = [...this.tasas];
            
            if (bancoId) {
                tasasFiltradas = tasasFiltradas.filter(t => t.banco_id === bancoId);
            }
            
            if (tarjetaId) {
                tasasFiltradas = tasasFiltradas.filter(t => t.tarjeta_id === tarjetaId);
            }
            
            if (cuotasDesde) {
                tasasFiltradas = tasasFiltradas.filter(t => t.cuotas >= cuotasDesde);
            }
            
            if (cuotasHasta) {
                tasasFiltradas = tasasFiltradas.filter(t => t.cuotas <= cuotasHasta);
            }
            
            if (tasaDesde) {
                tasasFiltradas = tasasFiltradas.filter(t => t.tasa >= tasaDesde);
            }
            
            if (tasaHasta) {
                tasasFiltradas = tasasFiltradas.filter(t => t.tasa <= tasaHasta);
            }
            
            // Ordenamos
            tasasFiltradas.sort((a, b) => {
                let valorA, valorB;
                
                switch (sortBy) {
                    case 'banco':
                        valorA = a.banco_nombre || '';
                        valorB = b.banco_nombre || '';
                        break;
                    case 'tarjeta':
                        valorA = a.tarjeta_nombre || '';
                        valorB = b.tarjeta_nombre || '';
                        break;
                    case 'cuotas':
                        valorA = a.cuotas;
                        valorB = b.cuotas;
                        break;
                    case 'tasa':
                        valorA = a.tasa;
                        valorB = b.tasa;
                        break;
                    case 'recargo':
                        valorA = a.recargo_fijo || 0;
                        valorB = b.recargo_fijo || 0;
                        break;
                    default:
                        valorA = a.banco_nombre || '';
                        valorB = b.banco_nombre || '';
                }
                
                if (sortDir === 'asc') {
                    return valorA > valorB ? 1 : -1;
                } else {
                    return valorA < valorB ? 1 : -1;
                }
            });
            
            // Calculamos paginación
            const totalItems = tasasFiltradas.length;
            const totalPages = Math.ceil(totalItems / limit);
            const offset = (page - 1) * limit;
            
            // Obtenemos items de la página actual
            const items = tasasFiltradas.slice(offset, offset + limit);
            
            // Enriquecemos los datos con nombres de bancos y tarjetas
            const tasasConDetalles = items.map(tasa => {
                const banco = this.bancos.find(b => b.id === tasa.banco_id) || { nombre: 'Genérico' };
                const tarjeta = this.tarjetas.find(t => t.id === tasa.tarjeta_id);
                
                return {
                    ...tasa,
                    banco_nombre: banco.nombre,
                    tarjeta_nombre: tarjeta ? tarjeta.nombre : 'Desconocida'
                };
            });
            
            return {
                success: true,
                items: tasasConDetalles,
                pagination: {
                    total: totalItems,
                    page,
                    limit,
                    pages: totalPages
                }
            };
        } catch (error) {
            logger.log('error', 'Error al obtener tasas para tabla', { 
                modulo: 'cuotificador', 
                accion: 'obtenerTasasTabla', 
                error: error.message,
                options,
                usuario: auth.getCurrentUser().username 
            });
            return {
                success: false,
                message: `Error al obtener tasas: ${error.message}`
            };
        }
    }
}

// Creamos y exportamos una instancia única del gestor de tasas
const tasasManager = new TasasManager();
module.exports = tasasManager;