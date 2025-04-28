 // /app/assets/js/modules/compras/index.js

import { initRegistrarCompra, resetFormularioCompra } from './registrar.js';
import { initHistorialCompras, cargarCompras } from './historial.js';
import { initAnalisisCompras, generarAnalisisCompras } from './analisis.js';
import { syncDataIfNeeded } from '../../utils/sync.js';
import { logEvent } from '../../utils/logger.js';

// Función principal de inicialización del módulo de Compras
export function initComprasModule() {
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
