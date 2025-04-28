/**
 * Módulo de Caja - FactuSystem
 * 
 * Este módulo maneja todas las operaciones relacionadas con la gestión de caja:
 * - Apertura y cierre de caja
 * - Registro de movimientos (ventas, gastos, ingresos)
 * - Visualización de estado actual
 * - Generación de informes
 * 
 * @author FactuSystem
 * @version 1.0.0
 */

// Importaciones de los submódulos de caja
import { abrirCaja, verificarCajaAbierta, obtenerCajaActual } from './apertura.js';
import { cerrarCaja, verificarDiferencias } from './cierre.js';
import { 
    registrarMovimiento, 
    obtenerMovimientos, 
    filtrarMovimientos,
    obtenerTotalesPorTipo
} from './movimientos.js';
import { 
    generarReporteCaja, 
    exportarReportePDF, 
    exportarReporteExcel 
} from './reportes.js';

// Importaciones de utilidades
import { showNotification } from '../../components/notifications.js';
import { createTab, switchToTab } from '../../components/tabs.js';
import { formatCurrency, formatDate, getCurrentDateTime } from '../../utils/format.js';
import { validateNumericInput } from '../../utils/validation.js';
import { getCurrentUser } from '../../utils/auth.js';
import { getSucursalActual } from '../../modules/sucursales/index.js';
import { logAuditEvent } from '../../utils/logger.js';
import { chartColors } from '../../utils/constants.js';

// Bibliotecas para gráficos
import Chart from 'chart.js/auto';

// Cache de datos
let cajaActual = null;
let movimientosCaja = [];
let graficoFlujo = null;
let graficoTipos = null;

/**
 * Inicializa el módulo de caja
 */
export async function initCaja() {
    console.log('Inicializando módulo de caja...');
    
    // Registrar eventos para los elementos de la UI
    registerEventListeners();
    
    // Verificar si hay una caja abierta para la sucursal y usuario actual
    await verificarEstadoCaja();
    
    // Cargar datos iniciales
    await cargarDatosCaja();
    
    // Inicializar gráficos
    initCharts();
    
    console.log('Módulo de caja inicializado correctamente');
}

/**
 * Registra los eventos para la interfaz de usuario
 */
function registerEventListeners() {
    // Botón de apertura de caja
    document.getElementById('btn-abrir-caja')?.addEventListener('click', handleAbrirCaja);
    
    // Botón de cierre de caja
    document.getElementById('btn-cerrar-caja')?.addEventListener('click', handleCerrarCaja);
    
    // Botón para registrar ingreso
    document.getElementById('btn-registrar-ingreso')?.addEventListener('click', () => handleRegistrarMovimiento('ingreso'));
    
    // Botón para registrar egreso
    document.getElementById('btn-registrar-egreso')?.addEventListener('click', () => handleRegistrarMovimiento('egreso'));
    
    // Filtros de movimientos
    document.getElementById('filtro-fecha-inicio')?.addEventListener('change', aplicarFiltros);
    document.getElementById('filtro-fecha-fin')?.addEventListener('change', aplicarFiltros);
    document.getElementById('filtro-tipo-movimiento')?.addEventListener('change', aplicarFiltros);

    // Botones de exportación
    document.getElementById('btn-exportar-pdf')?.addEventListener('click', handleExportarPDF);
    document.getElementById('btn-exportar-excel')?.addEventListener('click', handleExportarExcel);
    
    // Botón de actualizar datos
    document.getElementById('btn-actualizar-caja')?.addEventListener('click', cargarDatosCaja);
}

/**
 * Verifica si existe una caja abierta para el usuario y sucursal actual
 */
async function verificarEstadoCaja() {
    try {
        const usuario = getCurrentUser();
        const sucursal = getSucursalActual();
        
        const cajaAbierta = await verificarCajaAbierta(usuario.id, sucursal.id);
        
        if (cajaAbierta) {
            cajaActual = await obtenerCajaActual(usuario.id, sucursal.id);
            actualizarUIConCajaAbierta();
        } else {
            actualizarUIConCajaCerrada();
        }
        
        return cajaAbierta;
    } catch (error) {
        console.error('Error al verificar estado de caja:', error);
        showNotification('Error al verificar el estado de la caja', 'error');
        return false;
    }
}

/**
 * Actualiza la UI para reflejar que hay una caja abierta
 */
function actualizarUIConCajaAbierta() {
    // Mostrar información de caja abierta
    document.getElementById('info-caja-cerrada')?.classList.add('hidden');
    document.getElementById('info-caja-abierta')?.classList.remove('hidden');
    
    // Actualizar datos de la caja
    document.getElementById('txt-fecha-apertura').textContent = formatDate(cajaActual.fechaApertura);
    document.getElementById('txt-hora-apertura').textContent = new Date(cajaActual.fechaApertura).toLocaleTimeString();
    document.getElementById('txt-monto-inicial').textContent = formatCurrency(cajaActual.montoInicial);
    document.getElementById('txt-usuario-apertura').textContent = cajaActual.usuario.nombre;
    
    // Habilitar/deshabilitar botones
    document.getElementById('btn-abrir-caja')?.setAttribute('disabled', 'disabled');
    document.getElementById('btn-cerrar-caja')?.removeAttribute('disabled');
    document.getElementById('btn-registrar-ingreso')?.removeAttribute('disabled');
    document.getElementById('btn-registrar-egreso')?.removeAttribute('disabled');
    
    // Mostrar sección de movimientos
    document.getElementById('seccion-movimientos')?.classList.remove('hidden');
}

/**
 * Actualiza la UI para reflejar que la caja está cerrada
 */
function actualizarUIConCajaCerrada() {
    // Mostrar información de caja cerrada
    document.getElementById('info-caja-abierta')?.classList.add('hidden');
    document.getElementById('info-caja-cerrada')?.classList.remove('hidden');
    
    // Habilitar/deshabilitar botones
    document.getElementById('btn-abrir-caja')?.removeAttribute('disabled');
    document.getElementById('btn-cerrar-caja')?.setAttribute('disabled', 'disabled');
    document.getElementById('btn-registrar-ingreso')?.setAttribute('disabled', 'disabled');
    document.getElementById('btn-registrar-egreso')?.setAttribute('disabled', 'disabled');
    
    // Ocultar sección de movimientos
    document.getElementById('seccion-movimientos')?.classList.add('hidden');
}

/**
 * Manejador para la apertura de caja
 */
async function handleAbrirCaja() {
    try {
        // Mostrar modal de apertura de caja
        const modalApertura = document.getElementById('modal-apertura-caja');
        modalApertura.classList.remove('hidden');
        
        // Enfocar el campo de monto inicial
        document.getElementById('input-monto-inicial').focus();
        
        // Manejar el evento de envío del formulario
        document.getElementById('form-apertura-caja').onsubmit = async (e) => {
            e.preventDefault();
            
            const montoInicial = parseFloat(document.getElementById('input-monto-inicial').value);
            
            if (isNaN(montoInicial) || montoInicial < 0) {
                showNotification('El monto inicial debe ser un número válido mayor o igual a cero', 'warning');
                return;
            }
            
            const usuario = getCurrentUser();
            const sucursal = getSucursalActual();
            const observaciones = document.getElementById('input-observaciones-apertura').value;
            
            modalApertura.classList.add('hidden');
            
            // Registrar apertura de caja
            cajaActual = await abrirCaja(usuario.id, sucursal.id, montoInicial, observaciones);
            
            // Registrar evento de auditoría
            logAuditEvent('CAJA_APERTURA', {
                usuario: usuario.id,
                sucursal: sucursal.id,
                montoInicial,
                fechaHora: getCurrentDateTime()
            });
            
            // Actualizar UI
            actualizarUIConCajaAbierta();
            
            // Cargar datos
            await cargarDatosCaja();
            
            showNotification('Caja abierta exitosamente', 'success');
        };
        
        // Manejar cancelación
        document.getElementById('btn-cancelar-apertura').onclick = () => {
            modalApertura.classList.add('hidden');
        };
        
    } catch (error) {
        console.error('Error al abrir caja:', error);
        showNotification('Error al abrir la caja', 'error');
    }
}

/**
 * Manejador para el cierre de caja
 */
async function handleCerrarCaja() {
    try {
        if (!cajaActual) {
            showNotification('No hay una caja abierta para cerrar', 'warning');
            return;
        }
        
        // Calcular totales y saldos
        const movimientos = await obtenerMovimientos(cajaActual.id);
        const totalesPorTipo = await obtenerTotalesPorTipo(cajaActual.id);
        
        const totalIngresos = totalesPorTipo.ingreso || 0;
        const totalEgresos = totalesPorTipo.egreso || 0;
        const totalVentas = totalesPorTipo.venta || 0;
        
        const saldoTeorico = cajaActual.montoInicial + totalIngresos + totalVentas - totalEgresos;
        
        // Mostrar modal de cierre de caja
        const modalCierre = document.getElementById('modal-cierre-caja');
        modalCierre.classList.remove('hidden');
        
        // Mostrar resumen de caja
        document.getElementById('txt-resumen-monto-inicial').textContent = formatCurrency(cajaActual.montoInicial);
        document.getElementById('txt-resumen-ingresos').textContent = formatCurrency(totalIngresos);
        document.getElementById('txt-resumen-ventas').textContent = formatCurrency(totalVentas);
        document.getElementById('txt-resumen-egresos').textContent = formatCurrency(totalEgresos);
        document.getElementById('txt-resumen-saldo-teorico').textContent = formatCurrency(saldoTeorico);
        
        // Enfocar campo de monto real
        const inputMontoReal = document.getElementById('input-monto-real');
        inputMontoReal.value = saldoTeorico.toFixed(2);
        inputMontoReal.focus();
        inputMontoReal.select();
        
        // Calcular diferencia al cambiar el monto real
        inputMontoReal.addEventListener('input', () => {
            const montoReal = parseFloat(inputMontoReal.value) || 0;
            const diferencia = montoReal - saldoTeorico;
            
            document.getElementById('txt-resumen-diferencia').textContent = formatCurrency(diferencia);
            
            // Resaltar diferencia si existe
            const txtDiferencia = document.getElementById('txt-resumen-diferencia');
            if (diferencia !== 0) {
                txtDiferencia.classList.remove('text-gray-700');
                txtDiferencia.classList.add(diferencia > 0 ? 'text-green-600' : 'text-red-600');
            } else {
                txtDiferencia.classList.remove('text-green-600', 'text-red-600');
                txtDiferencia.classList.add('text-gray-700');
            }
        });
        
        // Manejar el evento de envío del formulario
        document.getElementById('form-cierre-caja').onsubmit = async (e) => {
            e.preventDefault();
            
            const montoReal = parseFloat(inputMontoReal.value);
            
            if (isNaN(montoReal) || montoReal < 0) {
                showNotification('El monto real debe ser un número válido mayor o igual a cero', 'warning');
                return;
            }
            
            const observaciones = document.getElementById('input-observaciones-cierre').value;
            const diferencia = montoReal - saldoTeorico;
            
            modalCierre.classList.add('hidden');
            
            // Registrar cierre de caja
            await cerrarCaja(
                cajaActual.id, 
                montoReal, 
                diferencia, 
                observaciones,
                {
                    montoInicial: cajaActual.montoInicial,
                    ingresos: totalIngresos,
                    ventas: totalVentas,
                    egresos: totalEgresos,
                    saldoTeorico
                }
            );
            
            // Registrar evento de auditoría
            const usuario = getCurrentUser();
            const sucursal = getSucursalActual();
            
            logAuditEvent('CAJA_CIERRE', {
                usuario: usuario.id,
                sucursal: sucursal.id,
                cajaId: cajaActual.id,
                montoReal,
                diferencia,
                fechaHora: getCurrentDateTime()
            });
            
            // Actualizar UI
            cajaActual = null;
            actualizarUIConCajaCerrada();
            
            // Ofrecer impresión del reporte de cierre
            const imprimirReporte = confirm('¿Desea imprimir el reporte de cierre de caja?');
            if (imprimirReporte) {
                handleExportarPDF();
            }
            
            showNotification('Caja cerrada exitosamente', 'success');
        };
        
        // Manejar cancelación
        document.getElementById('btn-cancelar-cierre').onclick = () => {
            modalCierre.classList.add('hidden');
        };
        
    } catch (error) {
        console.error('Error al cerrar caja:', error);
        showNotification('Error al cerrar la caja', 'error');
    }
}

/**
 * Manejador para registrar un nuevo movimiento de caja
 * @param {string} tipo - Tipo de movimiento ('ingreso' o 'egreso')
 */
async function handleRegistrarMovimiento(tipo) {
    try {
        if (!cajaActual) {
            showNotification('No hay una caja abierta para registrar movimientos', 'warning');
            return;
        }
        
        // Mostrar modal para registrar movimiento
        const modalMovimiento = document.getElementById('modal-registrar-movimiento');
        modalMovimiento.classList.remove('hidden');
        
        // Actualizar título según tipo de movimiento
        document.getElementById('titulo-modal-movimiento').textContent = 
            tipo === 'ingreso' ? 'Registrar Ingreso' : 'Registrar Egreso';
        
        // Configurar clases y textos según tipo
        const btnConfirmar = document.getElementById('btn-confirmar-movimiento');
        btnConfirmar.className = tipo === 'ingreso' 
            ? 'btn btn-success' 
            : 'btn btn-danger';
        btnConfirmar.textContent = tipo === 'ingreso' 
            ? 'Registrar Ingreso' 
            : 'Registrar Egreso';
        
        // Enfocar campo de monto
        const inputMonto = document.getElementById('input-monto-movimiento');
        inputMonto.value = '';
        inputMonto.focus();
        
        // Cargar categorías según tipo
        const selectCategoria = document.getElementById('select-categoria-movimiento');
        selectCategoria.innerHTML = '';
        
        const categorias = tipo === 'ingreso' 
            ? ['Cobro pendiente', 'Depósito', 'Venta no facturada', 'Otro ingreso'] 
            : ['Pago a proveedor', 'Servicios', 'Sueldos', 'Impuestos', 'Otro egreso'];
        
        categorias.forEach(categoria => {
            const option = document.createElement('option');
            option.value = categoria;
            option.textContent = categoria;
            selectCategoria.appendChild(option);
        });
        
        // Manejar el evento de envío del formulario
        document.getElementById('form-registrar-movimiento').onsubmit = async (e) => {
            e.preventDefault();
            
            const monto = parseFloat(inputMonto.value);
            
            if (isNaN(monto) || monto <= 0) {
                showNotification('El monto debe ser un número válido mayor a cero', 'warning');
                return;
            }
            
            const categoria = selectCategoria.value;
            const concepto = document.getElementById('input-concepto-movimiento').value;
            const observaciones = document.getElementById('input-observaciones-movimiento').value;
            
            modalMovimiento.classList.add('hidden');
            
            // Registrar movimiento
            const movimiento = await registrarMovimiento({
                cajaId: cajaActual.id,
                tipo,
                monto,
                categoria,
                concepto,
                observaciones,
                usuarioId: getCurrentUser().id,
                sucursalId: getSucursalActual().id,
                fecha: new Date()
            });
            
            // Registrar evento de auditoría
            logAuditEvent(`CAJA_MOVIMIENTO_${tipo.toUpperCase()}`, {
                usuario: getCurrentUser().id,
                sucursal: getSucursalActual().id,
                cajaId: cajaActual.id,
                movimientoId: movimiento.id,
                monto,
                categoria,
                concepto,
                fechaHora: getCurrentDateTime()
            });
            
            // Actualizar datos
            await cargarDatosCaja();
            
            showNotification(`${tipo === 'ingreso' ? 'Ingreso' : 'Egreso'} registrado exitosamente`, 'success');
        };
        
        // Manejar cancelación
        document.getElementById('btn-cancelar-movimiento').onclick = () => {
            modalMovimiento.classList.add('hidden');
        };
        
    } catch (error) {
        console.error(`Error al registrar ${tipo}:`, error);
        showNotification(`Error al registrar ${tipo}`, 'error');
    }
}

/**
 * Carga los datos de caja y movimientos
 */
async function cargarDatosCaja() {
    try {
        // Verificar si hay una caja abierta
        if (!cajaActual && !(await verificarEstadoCaja())) {
            return;
        }
        
        // Cargar movimientos
        movimientosCaja = await obtenerMovimientos(cajaActual.id);
        
        // Actualizar tabla de movimientos
        actualizarTablaMovimientos(movimientosCaja);
        
        // Actualizar totales
        actualizarTotales();
        
        // Actualizar gráficos
        actualizarGraficos();
        
    } catch (error) {
        console.error('Error al cargar datos de caja:', error);
        showNotification('Error al cargar datos de caja', 'error');
    }
}

/**
 * Aplica filtros a los movimientos de caja
 */
async function aplicarFiltros() {
    try {
        const fechaInicio = document.getElementById('filtro-fecha-inicio').value;
        const fechaFin = document.getElementById('filtro-fecha-fin').value;
        const tipoMovimiento = document.getElementById('filtro-tipo-movimiento').value;
        
        // Aplicar filtros a los movimientos
        const movimientosFiltrados = await filtrarMovimientos(
            cajaActual.id,
            fechaInicio ? new Date(fechaInicio) : null,
            fechaFin ? new Date(fechaFin) : null,
            tipoMovimiento !== 'todos' ? tipoMovimiento : null
        );
        
        // Actualizar tabla con movimientos filtrados
        actualizarTablaMovimientos(movimientosFiltrados);
        
    } catch (error) {
        console.error('Error al aplicar filtros:', error);
        showNotification('Error al aplicar filtros', 'error');
    }
}

/**
 * Actualiza la tabla de movimientos con los datos proporcionados
 * @param {Array} movimientos - Lista de movimientos a mostrar
 */
function actualizarTablaMovimientos(movimientos) {
    const tbody = document.getElementById('tabla-movimientos-body');
    
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    if (movimientos.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td colspan="7" class="text-center py-4">No hay movimientos registrados</td>
        `;
        tbody.appendChild(tr);
        return;
    }
    
    // Ordenar movimientos por fecha (más recientes primero)
    movimientos.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    
    movimientos.forEach(movimiento => {
        const tr = document.createElement('tr');
        
        // Determinar clase de fila según tipo de movimiento
        let tipoClase = '';
        let tipoIcono = '';
        
        switch (movimiento.tipo) {
            case 'ingreso':
                tipoClase = 'text-green-600';
                tipoIcono = 'fas fa-arrow-down';
                break;
            case 'egreso':
                tipoClase = 'text-red-600';
                tipoIcono = 'fas fa-arrow-up';
                break;
            case 'venta':
                tipoClase = 'text-blue-600';
                tipoIcono = 'fas fa-shopping-cart';
                break;
            default:
                tipoClase = 'text-gray-600';
                tipoIcono = 'fas fa-exchange-alt';
        }
        
        tr.innerHTML = `
            <td class="py-2">${formatDate(movimiento.fecha)}</td>
            <td>${new Date(movimiento.fecha).toLocaleTimeString()}</td>
            <td class="${tipoClase}">
                <i class="${tipoIcono} mr-1"></i>
                ${movimiento.tipo.charAt(0).toUpperCase() + movimiento.tipo.slice(1)}
            </td>
            <td>${movimiento.categoria || '-'}</td>
            <td>${movimiento.concepto || '-'}</td>
            <td class="${tipoClase} font-semibold">
                ${tipoClase === 'text-red-600' ? '-' : ''}${formatCurrency(movimiento.monto)}
            </td>
            <td class="text-right">
                <button class="btn-ver-detalles" data-id="${movimiento.id}">
                    <i class="fas fa-eye text-blue-500"></i>
                </button>
            </td>
        `;
        
        tbody.appendChild(tr);
    });
    
    // Agregar eventos a los botones de ver detalles
    document.querySelectorAll('.btn-ver-detalles').forEach(btn => {
        btn.addEventListener('click', () => {
            mostrarDetallesMovimiento(btn.dataset.id);
        });
    });
}

/**
 * Muestra los detalles de un movimiento específico
 * @param {string} id - ID del movimiento
 */
function mostrarDetallesMovimiento(id) {
    const movimiento = movimientosCaja.find(m => m.id === id);
    
    if (!movimiento) return;
    
    // Mostrar modal con detalles
    const modalDetalles = document.getElementById('modal-detalles-movimiento');
    modalDetalles.classList.remove('hidden');
    
    // Llenar datos
    document.getElementById('detalle-fecha').textContent = formatDate(movimiento.fecha);
    document.getElementById('detalle-hora').textContent = new Date(movimiento.fecha).toLocaleTimeString();
    document.getElementById('detalle-tipo').textContent = movimiento.tipo.charAt(0).toUpperCase() + movimiento.tipo.slice(1);
    document.getElementById('detalle-categoria').textContent = movimiento.categoria || '-';
    document.getElementById('detalle-concepto').textContent = movimiento.concepto || '-';
    document.getElementById('detalle-monto').textContent = formatCurrency(movimiento.monto);
    document.getElementById('detalle-usuario').textContent = movimiento.usuario?.nombre || '-';
    document.getElementById('detalle-observaciones').textContent = movimiento.observaciones || '-';
    
    // Si es una venta, mostrar datos adicionales
    if (movimiento.tipo === 'venta' && movimiento.ventaId) {
        document.getElementById('seccion-detalles-venta').classList.remove('hidden');
        document.getElementById('detalle-factura').textContent = movimiento.factura || '-';
        document.getElementById('detalle-cliente').textContent = movimiento.cliente || 'Consumidor Final';
        
        // Agregar botón para ver factura
        document.getElementById('btn-ver-factura').onclick = () => {
            // Cerrar modal
            modalDetalles.classList.add('hidden');
            
            // Abrir pestaña de la factura
            createTab('ventas', { ventaId: movimiento.ventaId });
            switchToTab('ventas');
        };
    } else {
        document.getElementById('seccion-detalles-venta').classList.add('hidden');
    }
    
    // Botón para cerrar modal
    document.getElementById('btn-cerrar-detalles').onclick = () => {
        modalDetalles.classList.add('hidden');
    };
}

/**
 * Actualiza los totales de caja
 */
async function actualizarTotales() {
    try {
        if (!cajaActual) return;
        
        const totalesPorTipo = await obtenerTotalesPorTipo(cajaActual.id);
        
        const totalIngresos = totalesPorTipo.ingreso || 0;
        const totalEgresos = totalesPorTipo.egreso || 0;
        const totalVentas = totalesPorTipo.venta || 0;
        
        const saldoActual = cajaActual.montoInicial + totalIngresos + totalVentas - totalEgresos;
        
        // Actualizar totales en la UI
        document.getElementById('txt-total-ingresos').textContent = formatCurrency(totalIngresos);
        document.getElementById('txt-total-ventas').textContent = formatCurrency(totalVentas);
        document.getElementById('txt-total-egresos').textContent = formatCurrency(totalEgresos);
        document.getElementById('txt-saldo-actual').textContent = formatCurrency(saldoActual);
        
    } catch (error) {
        console.error('Error al actualizar totales:', error);
    }
}

/**
 * Inicializa los gráficos de caja
 */
function initCharts() {
    // Inicializar gráfico de flujo de efectivo
    const ctxFlujo = document.getElementById('grafico-flujo-efectivo')?.getContext('2d');
    
    if (ctxFlujo) {
        graficoFlujo = new Chart(ctxFlujo, {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    {
                        label: 'Saldo',
                        data: [],
                        backgroundColor: 'rgba(66, 135, 245, 0.2)',
                        borderColor: 'rgba(66, 135, 245, 1)',
                        borderWidth: 2,
                        tension: 0.3,
                        fill: true
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: {
                            color: 'rgba(0, 0, 0, 0.05)'
                        }
                    },
                    x: {
                        grid: {
                            display: false
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top'
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return `Saldo: ${formatCurrency(context.raw)}`;
                            }
                        }
                    }
                }
            }
        });
    }
    
    // Inicializar gráfico de distribución por tipo
    const ctxTipos = document.getElementById('grafico-distribucion-tipos')?.getContext('2d');
    
    if (ctxTipos) {
        graficoTipos = new Chart(ctxTipos, {
            type: 'doughnut',
            data: {
                labels: ['Ingresos', 'Ventas', 'Egresos'],
                datasets: [
                    {
                        data: [0, 0, 0],
                        backgroundColor: [
                            chartColors.green,
                            chartColors.blue,
                            chartColors.red
                        ],
                        borderWidth: 1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom'
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return `${context.label}: ${formatCurrency(context.raw)}`;
                            }
                        }
                    }
                }
            }
        });
    }
}

/**
 * Actualiza los gráficos con datos actuales
 */
async function actualizarGraficos() {
    try {
        if (!cajaActual || !movimientosCaja.length) return;

        // Ordenar movimientos por fecha
        const movimientosOrdenados = [...movimientosCaja].sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

        let saldo = cajaActual.montoInicial;
        const labels = [];
        const data = [];

        movimientosOrdenados.forEach(mov => {
            switch (mov.tipo) {
                case 'ingreso':
                case 'venta':
                    saldo += mov.monto;
                    break;
                case 'egreso':
                    saldo -= mov.monto;
                    break;
            }

            labels.push(formatDate(mov.fecha));
            data.push(saldo);
        });

        // Actualizar gráfico de flujo de efectivo
        if (graficoFlujo) {
            graficoFlujo.data.labels = labels;
            graficoFlujo.data.datasets[0].data = data;
            graficoFlujo.update();
        }

        // Totales por tipo para gráfico de distribución
        const totalesPorTipo = await obtenerTotalesPorTipo(cajaActual.id);
        if (graficoTipos) {
            graficoTipos.data.datasets[0].data = [
                totalesPorTipo.ingreso || 0,
                totalesPorTipo.venta || 0,
                totalesPorTipo.egreso || 0
            ];
            graficoTipos.update();
        }

    } catch (error) {
        console.error('Error al actualizar gráficos:', error);
    }
}
