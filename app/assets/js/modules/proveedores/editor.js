const { db } = require('../../utils/database.js');
const { validarFormulario } = require('../../utils/validation.js');
const { mostrarNotificacion } = require('../../components/notifications.js');
const { auditoria } = require('../../utils/logger.js');

const formProveedor = document.getElementById("form-proveedor");
const btnGuardar = document.getElementById("btn-guardar-proveedor");
const modalProveedor = new bootstrap.Modal(document.getElementById("modalProveedor"));
const checkboxCredito = document.getElementById("proveedor-credito");
const limiteCreditoContainer = document.getElementById("limite-credito-container");

document.getElementById("btn-nuevo-proveedor").addEventListener("click", () => {
    limpiarFormulario();
    modalProveedor.show();
});

// Mostrar/ocultar campos de crédito
checkboxCredito.addEventListener("change", () => {
    limiteCreditoContainer.style.display = checkboxCredito.checked ? "flex" : "none";
});

// Guardar proveedor
btnGuardar.addEventListener("click", async () => {
    if (!validarFormulario(formProveedor)) {
        mostrarNotificacion("Por favor complete los campos obligatorios.", "error");
        return;
    }

    const data = obtenerDatosFormulario();
    try {
        if (data.id) {
            await db.proveedores.actualizar(data);
            mostrarNotificacion("Proveedor actualizado exitosamente.", "success");
            auditoria.log("actualizar_proveedor", data);
        } else {
            await db.proveedores.crear(data);
            mostrarNotificacion("Proveedor creado exitosamente.", "success");
            auditoria.log("nuevo_proveedor", data);
        }

        modalProveedor.hide();
        document.dispatchEvent(new Event("proveedorActualizado"));

    } catch (error) {
        console.error(error);
        mostrarNotificacion("Error al guardar el proveedor.", "error");
    }
});

// Limpia el formulario del modal
function limpiarFormulario() {
    formProveedor.reset();
    document.getElementById("proveedor-id").value = "";
    checkboxCredito.checked = false;
    limiteCreditoContainer.style.display = "none";
}

// Obtiene los datos del formulario como objeto
function obtenerDatosFormulario() {
    return {
        id: document.getElementById("proveedor-id").value || null,
        cuit: document.getElementById("proveedor-cuit").value.trim(),
        razon_social: document.getElementById("proveedor-razon-social").value.trim(),
        condicion_iva: document.getElementById("proveedor-condicion-iva").value,
        categoria: document.getElementById("proveedor-categoria").value,
        telefono: document.getElementById("proveedor-telefono").value,
        email: document.getElementById("proveedor-email").value,
        direccion: document.getElementById("proveedor-direccion").value,
        ciudad: document.getElementById("proveedor-ciudad").value,
        provincia: document.getElementById("proveedor-provincia").value,
        codigo_postal: document.getElementById("proveedor-codigo-postal").value,
        web: document.getElementById("proveedor-web").value,
        estado: document.getElementById("proveedor-estado").value,
        observaciones: document.getElementById("proveedor-observaciones").value,
        habilitado_credito: checkboxCredito.checked,
        limite_credito: parseFloat(document.getElementById("proveedor-limite-credito").value || 0),
        dias_credito: parseInt(document.getElementById("proveedor-dias-credito").value || 0),
        sucursales: obtenerSucursalesSeleccionadas()
    };
}

// Carga inicial de categorías de proveedor
async function cargarCategorias() {
    const select = document.getElementById("proveedor-categoria");
    const filtro = document.getElementById("filtro-categoria");
    const categorias = await db.categoriasProveedores.listar();

    select.innerHTML = `<option value="">Seleccione categoría</option>`;
    filtro.innerHTML = `<option value="">Todas las categorías</option>`;

    categorias.forEach(cat => {
        const opt1 = document.createElement("option");
        opt1.value = cat.nombre;
        opt1.textContent = cat.nombre;
        select.appendChild(opt1);

        const opt2 = document.createElement("option");
        opt2.value = cat.nombre;
        opt2.textContent = cat.nombre;
        filtro.appendChild(opt2);
    });
}

// Carga de sucursales disponibles
async function cargarSucursales() {
    const contenedor = document.getElementById("sucursales-container");
    const sucursales = await db.sucursales.listar();
    contenedor.innerHTML = "";

    sucursales.forEach(sucursal => {
        const col = document.createElement("div");
        col.className = "col-md-4";

        col.innerHTML = `
            <div class="form-check">
                <input class="form-check-input" type="checkbox" id="sucursal-${sucursal.id}" value="${sucursal.id}">
                <label class="form-check-label" for="sucursal-${sucursal.id}">${sucursal.nombre}</label>
            </div>
        `;
        contenedor.appendChild(col);
    });
}

// Devuelve array con los IDs de las sucursales seleccionadas
function obtenerSucursalesSeleccionadas() {
    return Array.from(document.querySelectorAll("#sucursales-container input[type='checkbox']:checked"))
                .map(cb => cb.value);
}

// Rellena el modal con datos de un proveedor (para edición)
export async function editarProveedor(idProveedor) {
    const proveedor = await db.proveedores.obtener(idProveedor);
    document.getElementById("proveedor-id").value = proveedor.id;
    document.getElementById("proveedor-cuit").value = proveedor.cuit;
    document.getElementById("proveedor-razon-social").value = proveedor.razon_social;
    document.getElementById("proveedor-condicion-iva").value = proveedor.condicion_iva || "";
    document.getElementById("proveedor-categoria").value = proveedor.categoria || "";
    document.getElementById("proveedor-telefono").value = proveedor.telefono || "";
    document.getElementById("proveedor-email").value = proveedor.email || "";
    document.getElementById("proveedor-direccion").value = proveedor.direccion || "";
    document.getElementById("proveedor-ciudad").value = proveedor.ciudad || "";
    document.getElementById("proveedor-provincia").value = proveedor.provincia || "";
    document.getElementById("proveedor-codigo-postal").value = proveedor.codigo_postal || "";
    document.getElementById("proveedor-web").value = proveedor.web || "";
    document.getElementById("proveedor-estado").value = proveedor.estado || "active";
    document.getElementById("proveedor-observaciones").value = proveedor.observaciones || "";
    document.getElementById("proveedor-credito").checked = proveedor.habilitado_credito;
    document.getElementById("proveedor-limite-credito").value = proveedor.limite_credito || "";
    document.getElementById("proveedor-dias-credito").value = proveedor.dias_credito || "";

    await cargarSucursales();
    proveedor.sucursales.forEach(id => {
        const chk = document.getElementById(`sucursal-${id}`);
        if (chk) chk.checked = true;
    });

    limiteCreditoContainer.style.display = proveedor.habilitado_credito ? "flex" : "none";

    modalProveedor.show();
}

// Inicializar al cargar
(async function init() {
    await cargarCategorias();
    await cargarSucursales();
})();
