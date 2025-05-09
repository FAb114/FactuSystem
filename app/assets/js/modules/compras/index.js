 // /app/assets/js/modules/compras/index.js

const { initRegistrarCompra, resetFormularioCompra } = require('./registrar.js');
const { initHistorialCompras, cargarCompras } = require('./historial.js');
const { initAnalisisCompras, generarAnalisisCompras } = require('./analisis.js');
const { syncDataIfNeeded } = require('../../utils/sync.js');
const { logEvent } = require('../../utils/logger.js');

// Función principal de inicialización del módulo de Compras
function initComprasModule
module.exports.initComprasModule = initComprasModule() {
    console.log('[Compras] Módulo inicializado');

    // Inicializar pestaña Registrar (carga por defecto)
    initRegistrarCompra();

    // Manejar evento de tab activo
    const tabs = document.querySelectorAll('.compras-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabId = tab.getAttribute('data-tab');

            if (tabId === 'historial') {
                initHistorialCompras();
                cargarCompras(); // Cargar compras al abrir
            }

            if (tabId === 'analisis') {
                initAnalisisCompras();
                generarAnalisisCompras(); // Generar análisis inicial
            }

            logEvent('TabCompras', { tab: tabId });
        });
    });

    // Botón Nueva Compra desde encabezado
    const btnNuevaCompra = document.getElementById('btn-nueva-compra');
    if (btnNuevaCompra) {
        btnNuevaCompra.addEventListener('click', () => {
            const tabRegistrar = document.querySelector('[data-tab="registrar"]');
            if (tabRegistrar) tabRegistrar.click();
            resetFormularioCompra();
        });
    }

    // Sincronización offline/online si corresponde
    syncDataIfNeeded('compras');
}
