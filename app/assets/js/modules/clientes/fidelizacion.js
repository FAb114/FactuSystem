const { obtenerFidelizacionStats, obtenerTopClientesPuntos, obtenerProximosCumpleanos, obtenerMovimientosPuntos, obtenerBeneficiosDisponibles, registrarCanjePuntos, ajustarPuntosCliente, obtenerConfigFidelizacion, guardarConfigFidelizacion } = require('../../utils/database.js');
const { abrirModal, cerrarModal } = require('../../components/modals.js');
const { mostrarNotificacion } = require('../../components/notifications.js');

// Inicializa toda la sección de fidelización
function inicializarFidelizacion
module.exports.inicializarFidelizacion = inicializarFidelizacion() {
    cargarDashboardFidelizacion();
    configurarEventosFidelizacion();
}

// Carga stats generales y top clientes
async function cargarDashboardFidelizacion() {
    const stats = await obtenerFidelizacionStats();
    const topClientes = await obtenerTopClientesPuntos();
    const cumpleanos = await obtenerProximosCumpleanos();

    document.getElementById('clientesActivos').innerText = stats.activos;
    document.getElementById('puntosOtorgados').innerText = stats.puntosOtorgados;
    document.getElementById('puntosCanjeados').innerText = stats.puntosCanjeados;
    document.getElementById('descuentosAplicados').innerText = `$${stats.descuentosAplicados}`;

    cargarTopClientes(topClientes);
    cargarCumpleanos(cumpleanos);
}

// Renderiza tabla de top clientes
function cargarTopClientes(lista) {
    const tbody = document.getElementById('topClientesPuntos');
    tbody.innerHTML = '';
    lista.forEach(cliente => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${cliente.nombre}</td>
            <td>${cliente.puntos}</td>
            <td>${cliente.nivel}</td>
            <td>
                <button class="btn-icon" data-id="${cliente.id}"><i class="fas fa-eye"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Renderiza tabla de cumpleaños próximos
function cargarCumpleanos(lista) {
    const tbody = document.getElementById('proximosCumpleanos');
    tbody.innerHTML = '';
    lista.forEach(c => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${c.nombre}</td>
            <td>${c.fecha}</td>
            <td>${c.diasRestantes}</td>
            <td>
                <button class="btn-icon btn-saludo" data-id="${c.id}"><i class="fas fa-envelope"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Carga detalles de fidelización por cliente (modal detalle)
export async function cargarStatsFidelizacion(cliente) {
    document.getElementById('fidelizacionPuntosActuales').innerText = cliente.puntos || 0;
    document.getElementById('fidelizacionPuntosCanjeados').innerText = cliente.puntosCanjeados || 0;
    document.getElementById('fidelizacionNivel').innerText = cliente.nivel || 'Regular';
    document.getElementById('fidelizacionProgresoNivel').style.width = cliente.progresoNivel + '%';
    document.querySelector('.progress-text').innerText = `${cliente.progresoNivel}%`;

    const movimientos = await obtenerMovimientosPuntos(cliente.id);
    const beneficios = await obtenerBeneficiosDisponibles(cliente.puntos || 0);

    renderizarMovimientos(movimientos);
    renderizarBeneficios(beneficios, cliente.puntos);
}

// Renderiza movimientos de puntos
function renderizarMovimientos(lista) {
    const tbody = document.getElementById('clienteMovimientosPuntos');
    tbody.innerHTML = '';
    lista.forEach(mov => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${mov.fecha}</td>
            <td>${mov.concepto}</td>
            <td>${mov.ganados}</td>
            <td>${mov.canjeados}</td>
            <td>${mov.saldo}</td>
        `;
        tbody.appendChild(tr);
    });
}

// Renderiza beneficios canjeables
function renderizarBeneficios(lista, puntosDisponibles) {
    const contenedor = document.querySelector('.beneficios-container');
    contenedor.innerHTML = '';
    lista.forEach(b => {
        const card = document.createElement('div');
        card.className = `beneficio-card ${puntosDisponibles >= b.puntos ? 'disponible' : ''}`;
        card.innerHTML = `
            <div class="beneficio-icon"><i class="fas fa-gift"></i></div>
            <div class="beneficio-info">
                <h5>${b.nombre}</h5>
                <p>${b.puntos} puntos</p>
            </div>
            <button class="btn btn-small" ${puntosDisponibles >= b.puntos ? '' : 'disabled'} data-beneficio="${b.id}">Canjear</button>
        `;
        contenedor.appendChild(card);
    });

    // Agregar listeners de canje
    contenedor.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', async () => {
            const idBeneficio = btn.dataset.beneficio;
            const resultado = await registrarCanjePuntos(idBeneficio);
            mostrarNotificacion(resultado.mensaje, resultado.ok ? 'success' : 'error');
            if (resultado.ok) location.reload();
        });
    });
}

// Configura eventos de botones generales
function configurarEventosFidelizacion() {
    document.getElementById('btnConfigFidelizacion').addEventListener('click', abrirModalConfigFidelizacion);
    document.getElementById('btnCanjearPuntos').addEventListener('click', () => abrirModal('modalCanjearPuntos'));
    document.getElementById('btnAjustePuntos').addEventListener('click', abrirModalAjustePuntos);

    document.getElementById('formConfigFidelizacion').addEventListener('submit', guardarConfiguracionFidelizacion);
}

// Configuración del programa
async function abrirModalConfigFidelizacion() {
    const config = await obtenerConfigFidelizacion();
    document.getElementById('configActivarPrograma').checked = config.activo;
    document.getElementById('configNombrePrograma').value = config.nombre;
    document.getElementById('configPuntosPorPeso').value = config.puntosPorPeso;
    document.getElementById('configRedondeo').value = config.redondeo;
    document.getElementById('configPuntosCaducidad').value = config.caducidad;
    document.getElementById('configMinimoPuntos').value = config.minimoCanje;
    document.getElementById('configNotificarPuntos').checked = config.notificaciones;
    document.getElementById('configMedioEmail').checked = config.viaEmail;
    document.getElementById('configMedioWhatsApp').checked = config.viaWhatsApp;

    abrirModal('modalConfigFidelizacion');
}

// Guardar configuración general
async function guardarConfiguracionFidelizacion(e) {
    e.preventDefault();
    const config = {
        activo: document.getElementById('configActivarPrograma').checked,
        nombre: document.getElementById('configNombrePrograma').value,
        puntosPorPeso: parseInt(document.getElementById('configPuntosPorPeso').value),
        redondeo: document.getElementById('configRedondeo').value,
        caducidad: parseInt(document.getElementById('configPuntosCaducidad').value),
        minimoCanje: parseInt(document.getElementById('configMinimoPuntos').value),
        notificaciones: document.getElementById('configNotificarPuntos').checked,
        viaEmail: document.getElementById('configMedioEmail').checked,
        viaWhatsApp: document.getElementById('configMedioWhatsApp').checked,
    };
    const resultado = await guardarConfigFidelizacion(config);
    mostrarNotificacion(resultado.mensaje, resultado.ok ? 'success' : 'error');
    if (resultado.ok) cerrarModal('modalConfigFidelizacion');
}

// Ajuste de puntos (desde botón en modal cliente)
function abrirModalAjustePuntos() {
    const puntos = prompt("Ingrese el nuevo saldo de puntos:");
    if (!isNaN(puntos)) {
        ajustarPuntosCliente(parseInt(puntos)).then(r => {
            mostrarNotificacion(r.mensaje, r.ok ? 'success' : 'error');
            if (r.ok) location.reload();
        });
    }
}
