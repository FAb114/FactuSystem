import { db } from "../../utils/database.js";
import { mostrarNotificacion } from "../../components/notifications.js";
import { auditoria } from "../../utils/logger.js";

const tablaCompras = new DataTable("#tabla-compras");
const tablaContactos = new DataTable("#tabla-contactos");

const selects = {
    compras: document.getElementById("select-proveedor-compras"),
    facturas: document.getElementById("select-proveedor-facturas"),
    contactos: document.getElementById("select-proveedor-contactos")
};

const modalFactura = new bootstrap.Modal(document.getElementById("modalSubirFactura"));
const modalVerFactura = new bootstrap.Modal(document.getElementById("modalVerFactura"));
const modalContacto = new bootstrap.Modal(document.getElementById("modalContacto"));

const btnAgregarContacto = document.getElementById("btn-agregar-contacto");

// ---------------------- PROVEEDORES ----------------------------

async function cargarProveedoresSelect() {
    const proveedores = await db.proveedores.listar();

    Object.values(selects).forEach(select => {
        select.innerHTML = `<option value="">Seleccione un proveedor</option>`;
        proveedores.forEach(p => {
            const option = document.createElement("option");
            option.value = p.id;
            option.textContent = `${p.razon_social} (${p.cuit})`;
            select.appendChild(option);
        });
    });
}

// -------------------- HISTORIAL COMPRAS ------------------------

selects.compras.addEventListener("change", async e => {
    const proveedorId = e.target.value;
    if (!proveedorId) return;
    const compras = await db.compras.listarPorProveedor(proveedorId);
    tablaCompras.clear().rows.add(compras).draw();
});

// -------------------- FACTURAS RECIBIDAS -----------------------

selects.facturas.addEventListener("change", async e => {
    const proveedorId = e.target.value;
    const contenedor = document.getElementById("facturas-container");
    contenedor.innerHTML = "";

    if (!proveedorId) {
        contenedor.innerHTML = `
            <div class="col-12 text-center py-5 empty-state">
                <i class="bi bi-file-earmark-text display-4 text-muted"></i>
                <p class="mt-3">Seleccione un proveedor para ver sus facturas</p>
            </div>`;
        return;
    }

    const facturas = await db.facturasProveedor.listarPorProveedor(proveedorId);

    if (!facturas.length) {
        contenedor.innerHTML = `<div class="col-12 text-center py-5 empty-state">
                <i class="bi bi-file-earmark-x display-4 text-muted"></i>
                <p class="mt-3">Este proveedor no tiene facturas registradas.</p>
            </div>`;
        return;
    }

    facturas.forEach(factura => {
        const div = document.createElement("div");
        div.className = "col-md-4";
        div.innerHTML = `
            <div class="card mb-3 shadow-sm">
                <div class="card-body">
                    <h6 class="card-title">${factura.numero} - ${factura.tipo}</h6>
                    <p class="mb-1"><strong>Fecha:</strong> ${factura.fecha}</p>
                    <p class="mb-1"><strong>Total:</strong> $${factura.total}</p>
                    <div class="d-flex justify-content-end gap-2 mt-2">
                        <button class="btn btn-sm btn-outline-primary" onclick="verFactura('${factura.id}')"><i class="bi bi-eye"></i></button>
                        <button class="btn btn-sm btn-outline-danger" onclick="eliminarFactura('${factura.id}')"><i class="bi bi-trash"></i></button>
                    </div>
                </div>
            </div>`;
        contenedor.appendChild(div);
    });
});

// Subir Factura
document.getElementById("btn-guardar-factura").addEventListener("click", async () => {
    const data = {
        proveedor_id: document.getElementById("select-proveedor-facturas").value,
        numero: document.getElementById("factura-numero").value,
        fecha: document.getElementById("factura-fecha").value,
        total: parseFloat(document.getElementById("factura-total").value),
        tipo: document.getElementById("factura-tipo").value,
        observaciones: document.getElementById("factura-observaciones").value,
        archivo: document.getElementById("factura-archivo").files[0] || null
    };

    if (!data.numero || !data.fecha || isNaN(data.total)) {
        mostrarNotificacion("Complete los datos obligatorios", "error");
        return;
    }

    try {
        await db.facturasProveedor.subir(data);
        mostrarNotificacion("Factura subida correctamente.", "success");
        auditoria.log("factura_subida", data);
        modalFactura.hide();
        selects.facturas.dispatchEvent(new Event("change"));
    } catch (err) {
        console.error(err);
        mostrarNotificacion("Error al subir factura", "error");
    }
});

// Función para ver factura
async function verFactura(id) {
    const factura = await db.facturasProveedor.obtener(id);
    document.getElementById("detalle-factura-numero").textContent = factura.numero;
    document.getElementById("detalle-factura-fecha").textContent = factura.fecha;
    document.getElementById("detalle-factura-tipo").textContent = factura.tipo;
    document.getElementById("detalle-factura-total").textContent = `$${factura.total}`;
    document.getElementById("detalle-factura-proveedor").textContent = factura.razon_social;
    document.getElementById("detalle-factura-cuit").textContent = factura.cuit;
    document.getElementById("detalle-factura-usuario").textContent = factura.usuario;
    document.getElementById("detalle-factura-observaciones").textContent = factura.observaciones;

    const visualizador = document.getElementById("detalle-factura-visualizador");
    visualizador.innerHTML = "";

    if (factura.archivo && factura.archivo.endsWith(".pdf")) {
        visualizador.innerHTML = `<iframe src="${factura.archivo}" width="100%" height="400px"></iframe>`;
    } else if (factura.archivo) {
        visualizador.innerHTML = `<img src="${factura.archivo}" class="img-fluid" alt="Factura">`;
    }

    modalVerFactura.show();
}

// Función para eliminar factura
async function eliminarFactura(id) {
    if (!confirm("¿Eliminar esta factura?")) return;
    await db.facturasProveedor.eliminar(id);
    mostrarNotificacion("Factura eliminada", "info");
    selects.facturas.dispatchEvent(new Event("change"));
}

// -------------------- CONTACTOS -----------------------

selects.contactos.addEventListener("change", async e => {
    const id = e.target.value;
    btnAgregarContacto.disabled = !id;
    const contactos = await db.contactosProveedor.listarPorProveedor(id);
    tablaContactos.clear().rows.add(contactos).draw();
});

// Agregar contacto
btnAgregarContacto.addEventListener("click", () => {
    const proveedorId = selects.contactos.value;
    if (!proveedorId) return;

    document.getElementById("form-contacto").reset();
    document.getElementById("contacto-id").value = "";
    document.getElementById("contacto-proveedor-id").value = proveedorId;
    modalContacto.show();
});

document.getElementById("btn-guardar-contacto").addEventListener("click", async () => {
    const data = {
        id: document.getElementById("contacto-id").value || null,
        proveedor_id: document.getElementById("contacto-proveedor-id").value,
        nombre: document.getElementById("contacto-nombre").value,
        cargo: document.getElementById("contacto-cargo").value,
        telefono: document.getElementById("contacto-telefono").value,
        email: document.getElementById("contacto-email").value,
        departamento: document.getElementById("contacto-departamento").value,
        observaciones: document.getElementById("contacto-observaciones").value,
        principal: document.getElementById("contacto-principal").checked
    };

    try {
        if (data.id) {
            await db.contactosProveedor.actualizar(data);
        } else {
            await db.contactosProveedor.crear(data);
        }
        mostrarNotificacion("Contacto guardado", "success");
        modalContacto.hide();
        selects.contactos.dispatchEvent(new Event("change"));
    } catch (e) {
        console.error(e);
        mostrarNotificacion("Error al guardar contacto", "error");
    }
});

// -------------------- FUNCIONES GLOBALES -----------------------

window.verFactura = verFactura;
window.eliminarFactura = eliminarFactura;

// -------------------- INICIALIZACIÓN FINAL --------------------

(async function init() {
    await cargarProveedoresSelect();
})();
