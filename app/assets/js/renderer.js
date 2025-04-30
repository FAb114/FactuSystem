// Este archivo se carga en el proceso de renderizado
// Usando la API expuesta por preload.js

document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM completamente cargado');
  
  // Configuración de navegación
  setupNavigation();
  
  // Inicializar los formularios y eventos
  setupClientesForm();
  setupProductosForm();
  setupFacturasForm();
  
  // Cargar datos iniciales
  cargarClientes();
  cargarProductos();
  cargarFacturas();


// Variables globales para facturas
let itemsFactura = [];
let productosDisponibles = [];

// Configuración del formulario de facturas
function setupFacturasForm() {
  const formFactura = document.getElementById('form-factura');
  if (!formFactura) return;
  
  // Cargar productos disponibles para facturas
  window.api.receive('productos-cargados', (response) => {
    if (response.success) {
      productosDisponibles = response.productos;
    }
  });
  
  // Agregar item a la factura
  const btnAgregarItem = document.getElementById('agregar-item');
  if (btnAgregarItem) {
    btnAgregarItem.addEventListener('click', () => {
      const productoId = document.getElementById('producto-factura').value;
      const cantidad = parseInt(document.getElementById('cantidad-producto').value);
      
      if (!productoId || isNaN(cantidad) || cantidad <= 0) {
        alert('Seleccione un producto y una cantidad válida');
        return;
      }
      
      const producto = productosDisponibles.find(p => p.id === productoId);
      if (!producto) {
        alert('Producto no encontrado');
        return;
      }
      
      const itemFactura = {
        productoId,
        nombre: producto.nombre,
        precio: producto.precio,
        cantidad,
        subtotal: producto.precio * cantidad
      };
      
      itemsFactura.push(itemFactura);
      actualizarTablaFactura();
      
      // Limpiar selección
      document.getElementById('producto-factura').value = '';
      document.getElementById('cantidad-producto').value = '';
    });
  }
  
  // Guardar factura completa
  formFactura.addEventListener('submit', (e) => {
    e.preventDefault();
    
    if (itemsFactura.length === 0) {
      alert('Agregue al menos un producto a la factura');
      return;
    }
    
    const clienteId = document.getElementById('cliente-factura').value;
    if (!clienteId) {
      alert('Seleccione un cliente');
      return;
    }
    
    const total = itemsFactura.reduce((sum, item) => sum + item.subtotal, 0);
    
    const facturaData = {
      clienteId,
      items: itemsFactura,
      total
    };
    
    window.api.send('guardar-factura', facturaData);
  });
  
  // Respuesta a guardar factura
  window.api.receive('factura-guardada', (response) => {
    if (response.success) {
      alert('Factura guardada correctamente');
      formFactura.reset();
      itemsFactura = [];
      actualizarTablaFactura();
      cargarFacturas(); // Recargar la lista de facturas
    } else {
      alert('Error al guardar factura: ' + response.error);
    }
  });
}

// Actualizar la tabla de items de factura
function actualizarTablaFactura() {
  const tablaItems = document.getElementById('items-factura');
  if (!tablaItems) return;
  
  tablaItems.innerHTML = '';
  
  itemsFactura.forEach((item, index) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${item.nombre}</td>
      <td>${item.cantidad}</td>
      <td>${item.precio.toFixed(2)}</td>
      <td>${item.subtotal.toFixed(2)}</td>
      <td>
        <button class="btn-eliminar" data-index="${index}">Eliminar</button>
      </td>
    `;
    tablaItems.appendChild(row);
  });
  
  // Actualizar total
  const totalFactura = document.getElementById('total-factura');
  if (totalFactura) {
    const total = itemsFactura.reduce((sum, item) => sum + item.subtotal, 0);
    totalFactura.textContent = `${total.toFixed(2)}`;
  }
  
  // Agregar eventos para eliminar items
  document.querySelectorAll('.btn-eliminar').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const index = parseInt(e.target.getAttribute('data-index'));
      itemsFactura.splice(index, 1);
      actualizarTablaFactura();
    });
  });
}

// Cargar y mostrar facturas
function cargarFacturas() {
  // Eliminar listeners anteriores para evitar duplicados
  window.api.removeAllListeners('facturas-cargadas');
  
  window.api.send('cargar-facturas');
  
  window.api.receive('facturas-cargadas', (response) => {
    if (response.success) {
      const listaFacturas = document.getElementById('lista-facturas');
      if (!listaFacturas) return;
      
      listaFacturas.innerHTML = '';
      
      response.facturas.forEach(factura => {
        const item = document.createElement('div');
        item.className = 'factura-item';
        
        // Formatear fecha
        const fecha = new Date(factura.fecha);
        const fechaFormateada = `${fecha.getDate()}/${fecha.getMonth() + 1}/${fecha.getFullYear()}`;
        
        item.innerHTML = `
          <h4>Factura #${factura.id}</h4>
          <p>Fecha: ${fechaFormateada}</p>
          <p>Cliente ID: ${factura.clienteId}</p>
          <p>Total: ${factura.total.toFixed(2)}</p>
          <p>Items: ${factura.items.length}</p>
          <button class="btn-ver-detalle" data-id="${factura.id}">Ver Detalle</button>
        `;
        listaFacturas.appendChild(item);
      });
      
      // Agregar eventos para ver detalles
      document.querySelectorAll('.btn-ver-detalle').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const facturaId = e.target.getAttribute('data-id');
          const factura = response.facturas.find(f => f.id === facturaId);
          
          if (factura) {
            mostrarDetalleFactura(factura);
          }
        });
      });
    } else {
      console.error('Error al cargar facturas:', response.error);
    }
  });
}

// Mostrar detalle de factura
function mostrarDetalleFactura(factura) {
  // Crear una ventana modal o actualizar un div con los detalles
  const detalleContainer = document.getElementById('detalle-factura');
  if (!detalleContainer) return;
  
  // Formatear fecha
  const fecha = new Date(factura.fecha);
  const fechaFormateada = `${fecha.getDate()}/${fecha.getMonth() + 1}/${fecha.getFullYear()}`;
  
  let itemsHTML = '';
  factura.items.forEach(item => {
    itemsHTML += `
      <tr>
        <td>${item.nombre}</td>
        <td>${item.cantidad}</td>
        <td>${item.precio.toFixed(2)}</td>
        <td>${item.subtotal.toFixed(2)}</td>
      </tr>
    `;
  });
  
  detalleContainer.innerHTML = `
    <div class="modal">
      <div class="modal-content">
        <span class="close-modal">&times;</span>
        <h3>Factura #${factura.id}</h3>
        <p>Fecha: ${fechaFormateada}</p>
        <p>Cliente ID: ${factura.clienteId}</p>
        
        <h4>Items:</h4>
        <table>
          <thead>
            <tr>
              <th>Producto</th>
              <th>Cantidad</th>
              <th>Precio</th>
              <th>Subtotal</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHTML}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="3"><strong>Total</strong></td>
              <td><strong>${factura.total.toFixed(2)}</strong></td>
            </tr>
          </tfoot>
        </table>
        
        <button id="imprimir-factura">Imprimir</button>
      </div>
    </div>
  `;
  
  detalleContainer.style.display = 'block';
  
  // Cerrar modal
  document.querySelector('.close-modal').addEventListener('click', () => {
    detalleContainer.style.display = 'none';
  });
  
  // Imprimir factura
  document.getElementById('imprimir-factura')?.addEventListener('click', () => {
    // Implementar funcionalidad de impresión
    alert('Funcionalidad de impresión no implementada');
  });
}
});

// Configuración de navegación de la aplicación
function setupNavigation() {
  const menuLinks = document.querySelectorAll('.nav-link');
  const contenedores = document.querySelectorAll('.contenedor');
  
  menuLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      
      // Ocultar todos los contenedores
      contenedores.forEach(cont => {
        cont.style.display = 'none';
      });
      
      // Mostrar el contenedor seleccionado
      const targetId = link.getAttribute('data-target');
      const targetContainer = document.getElementById(targetId);
      if (targetContainer) {
        targetContainer.style.display = 'block';
      }
      
      // Marcar el enlace activo
      menuLinks.forEach(ml => ml.classList.remove('active'));
      link.classList.add('active');
    });
  });
  
  // Mostrar la sección inicial por defecto (dashboard)
  if (document.getElementById('dashboard')) {
    document.getElementById('dashboard').style.display = 'block';
  }
}

// Configuración del formulario de clientes
function setupClientesForm() {
  const formCliente = document.getElementById('form-cliente');
  if (!formCliente) return;
  
  formCliente.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const clienteData = {
      nombre: document.getElementById('nombre-cliente').value,
      email: document.getElementById('email-cliente').value,
      telefono: document.getElementById('telefono-cliente').value,
      direccion: document.getElementById('direccion-cliente').value
    };
    
    window.api.send('guardar-cliente', clienteData);
  });
  
  // Respuesta a guardar cliente
  window.api.receive('cliente-guardado', (response) => {
    if (response.success) {
      alert('Cliente guardado correctamente');
      formCliente.reset();
      cargarClientes(); // Recargar la lista de clientes
    } else {
      alert('Error al guardar cliente: ' + response.error);
    }
  });
}

// Cargar y mostrar clientes
function cargarClientes() {
  // Eliminar listeners anteriores para evitar duplicados
  window.api.removeAllListeners('clientes-cargados');
  
  window.api.send('cargar-clientes');
  
  window.api.receive('clientes-cargados', (response) => {
    if (response.success) {
      const listaClientes = document.getElementById('lista-clientes');
      if (!listaClientes) return;
      
      listaClientes.innerHTML = '';
      
      response.clientes.forEach(cliente => {
        const item = document.createElement('div');
        item.className = 'cliente-item';
        item.innerHTML = `
          <h4>${cliente.nombre}</h4>
          <p>Email: ${cliente.email}</p>
          <p>Teléfono: ${cliente.telefono}</p>
          <p>Dirección: ${cliente.direccion}</p>
        `;
        listaClientes.appendChild(item);
      });
      
      // También actualizar selectores de clientes para facturas si existen
      const selectorCliente = document.getElementById('cliente-factura');
      if (selectorCliente) {
        selectorCliente.innerHTML = '<option value="">Seleccione un cliente</option>';
        
        response.clientes.forEach(cliente => {
          const option = document.createElement('option');
          option.value = cliente.id;
          option.textContent = cliente.nombre;
          selectorCliente.appendChild(option);
        });
      }
    } else {
      console.error('Error al cargar clientes:', response.error);
    }
  });
}

// Configuración del formulario de productos
function setupProductosForm() {
  const formProducto = document.getElementById('form-producto');
  if (!formProducto) return;
  
  formProducto.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const productoData = {
      nombre: document.getElementById('nombre-producto').value,
      descripcion: document.getElementById('descripcion-producto').value,
      precio: parseFloat(document.getElementById('precio-producto').value),
      stock: parseInt(document.getElementById('stock-producto').value)
    };
    
    window.api.send('guardar-producto', productoData);
  });
  
  // Respuesta a guardar producto
  window.api.receive('producto-guardado', (response) => {
    if (response.success) {
      alert('Producto guardado correctamente');
      formProducto.reset();
      cargarProductos(); // Recargar la lista de productos
    } else {
      alert('Error al guardar producto: ' + response.error);
    }
  });
}

// Cargar y mostrar productos
function cargarProductos() {
  // Eliminar listeners anteriores para evitar duplicados
  window.api.removeAllListeners('productos-cargados');
  
  window.api.send('cargar-productos');
  
  window.api.receive('productos-cargados', (response) => {
    if (response.success) {
      const listaProductos = document.getElementById('lista-productos');
      if (!listaProductos) return;
      
      listaProductos.innerHTML = '';
      
      response.productos.forEach(producto => {
        const item = document.createElement('div');
        item.className = 'producto-item';
        item.innerHTML = `
          <h4>${producto.nombre}</h4>
          <p>${producto.descripcion}</p>
          <p>Precio: ${producto.precio.toFixed(2)}</p>
          <p>Stock: ${producto.stock}</p>
        `;
        listaProductos.appendChild(item);
      });
      
      // También actualizar selectores de productos para facturas si existen
      const selectorProducto = document.getElementById('producto-factura');
      if (selectorProducto) {
        selectorProducto.innerHTML = '<option value="">Seleccione un producto</option>';
        
        response.productos.forEach(producto => {
          const option = document.createElement('option');
          option.value = producto.id;
          option.textContent = `${producto.nombre} - ${producto.precio.toFixed(2)}`;
          selectorProducto.appendChild(option);
        });
      }
    } else {
      console.error('Error al cargar productos:', response.error);
    }
  });
}