/**
 * Módulo Cuotificador - FactuSystem
 * Permite simular pagos en cuotas con diferentes tarjetas y bancos
 * Incluye cálculo de intereses, cuotas y visualización de resultados
 */

// Importar utilidades necesarias
import { database } from '../../../utils/database.js';
import { validateForm } from '../../../utils/validation.js';
import { auth } from '../../../utils/auth.js';
import { logger } from '../../../utils/logger.js';

// Definir clase principal del Cuotificador
class Cuotificador {
    constructor() {
        // Propiedades del cuotificador
        this.user = null;
        this.tasasInteres = {};
        this.selectedProducts = [];
        this.totalAmount = 0;
        this.selectedBank = null;
        this.selectedCard = null;
        this.selectedInstallments = 1;
        this.interestRate = 0;
        this.totalWithInterest = 0;
        this.installmentAmount = 0;
        
        // Elementos DOM
        this.elements = {
            productList: document.getElementById('product-list'),
            productSearchInput: document.getElementById('product-search'),
            productSearchResults: document.getElementById('search-results'),
            addProductBtn: document.getElementById('add-product-btn'),
            productListContainer: document.getElementById('selected-products'),
            totalAmountDisplay: document.getElementById('total-amount'),
            bankSelector: document.getElementById('bank-selector'),
            cardSelector: document.getElementById('card-selector'),
            installmentsSelector: document.getElementById('installments-selector'),
            interestRateDisplay: document.getElementById('interest-rate'),
            totalWithInterestDisplay: document.getElementById('total-with-interest'),
            installmentAmountDisplay: document.getElementById('installment-amount'),
            simulateBtn: document.getElementById('simulate-btn'),
            resetBtn: document.getElementById('reset-btn'),
            goToFacturadorBtn: document.getElementById('go-to-facturador')
        };
        
        // Inicializar el módulo
        this.init();
    }
    
    /**
     * Inicializa el módulo de cuotificador
     */
    async init() {
        try {
            // Verificar autenticación
            this.user = await auth.getCurrentUser();
            if (!this.user) {
                window.location.href = '../../../views/login.html';
                return;
            }
            
            // Cargar tasas de interés desde la base de datos
            await this.loadInterestRates();
            
            // Inicializar selectores
            this.initBankSelector();
            this.initCardSelector();
            this.initInstallmentsSelector();
            
            // Configurar eventos
            this.setupEventListeners();
            
            // Registrar actividad
            logger.logActivity('cuotificador', 'access', this.user.id);
            
            console.log('Cuotificador inicializado correctamente');
        } catch (error) {
            console.error('Error al inicializar el cuotificador:', error);
            this.showError('Error al inicializar el cuotificador');
        }
    }
    
    /**
     * Carga las tasas de interés desde la base de datos
     */
    async loadInterestRates() {
        try {
            const rates = await database.query('SELECT * FROM tasas_interes');
            
            // Organizar las tasas por banco, tarjeta y cuotas
            rates.forEach(rate => {
                if (!this.tasasInteres[rate.banco_id]) {
                    this.tasasInteres[rate.banco_id] = {};
                }
                
                if (!this.tasasInteres[rate.banco_id][rate.tarjeta_id]) {
                    this.tasasInteres[rate.banco_id][rate.tarjeta_id] = {};
                }
                
                this.tasasInteres[rate.banco_id][rate.tarjeta_id][rate.cuotas] = rate.tasa;
            });
            
            console.log('Tasas de interés cargadas:', this.tasasInteres);
        } catch (error) {
            console.error('Error al cargar tasas de interés:', error);
            this.showError('No se pudieron cargar las tasas de interés');
        }
    }
    
    /**
     * Inicializa el selector de bancos
     */
    async initBankSelector() {
        try {
            const banks = await database.query('SELECT * FROM bancos WHERE activo = 1');
            const selector = this.elements.bankSelector;
            
            // Limpiar selector
            selector.innerHTML = '<option value="">Seleccione un banco</option>';
            
            // Agregar bancos al selector
            banks.forEach(bank => {
                const option = document.createElement('option');
                option.value = bank.id;
                option.textContent = bank.nombre;
                selector.appendChild(option);
            });
        } catch (error) {
            console.error('Error al inicializar selector de bancos:', error);
        }
    }
    
    /**
     * Inicializa el selector de tarjetas
     */
    async initCardSelector() {
        try {
            const cards = await database.query('SELECT * FROM tarjetas WHERE activo = 1');
            const selector = this.elements.cardSelector;
            
            // Limpiar selector
            selector.innerHTML = '<option value="">Seleccione una tarjeta</option>';
            
            // Agregar tarjetas al selector
            cards.forEach(card => {
                const option = document.createElement('option');
                option.value = card.id;
                option.textContent = card.nombre;
                selector.appendChild(option);
            });
            
            // Deshabilitar hasta que se seleccione un banco
            selector.disabled = true;
        } catch (error) {
            console.error('Error al inicializar selector de tarjetas:', error);
        }
    }
    
    /**
     * Inicializa el selector de cuotas
     */
    initInstallmentsSelector() {
        const selector = this.elements.installmentsSelector;
        
        // Limpiar selector
        selector.innerHTML = '<option value="">Seleccione cuotas</option>';
        
        // Agregar opciones de cuotas (1 a 24)
        for (let i = 1; i <= 24; i++) {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = `${i} cuota${i > 1 ? 's' : ''}`;
            selector.appendChild(option);
        }
        
        // Deshabilitar hasta que se seleccione una tarjeta
        selector.disabled = true;
    }
    
    /**
     * Configura los event listeners para los elementos de la interfaz
     */
    setupEventListeners() {
        // Búsqueda de productos
        this.elements.productSearchInput.addEventListener('input', this.handleProductSearch.bind(this));
        this.elements.productSearchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.handleProductSelect();
            }
        });
        
        // Botón para agregar productos
        this.elements.addProductBtn.addEventListener('click', this.handleAddProduct.bind(this));
        
        // Selectores para simulación
        this.elements.bankSelector.addEventListener('change', this.handleBankChange.bind(this));
        this.elements.cardSelector.addEventListener('change', this.handleCardChange.bind(this));
        this.elements.installmentsSelector.addEventListener('change', this.handleInstallmentsChange.bind(this));
        
        // Botones de acción
        this.elements.simulateBtn.addEventListener('click', this.simulatePayment.bind(this));
        this.elements.resetBtn.addEventListener('click', this.resetSimulation.bind(this));
        this.elements.goToFacturadorBtn.addEventListener('click', this.goToFacturador.bind(this));
        
        // Escuchar clics en resultados de búsqueda
        this.elements.productSearchResults.addEventListener('click', (e) => {
            if (e.target.classList.contains('product-result-item')) {
                const productId = e.target.dataset.id;
                this.selectProductFromSearch(productId);
            }
        });
    }
    
    /**
     * Maneja la búsqueda de productos
     */
    async handleProductSearch(e) {
        const searchTerm = e.target.value.trim();
        
        if (searchTerm.length < 3) {
            this.elements.productSearchResults.innerHTML = '';
            this.elements.productSearchResults.style.display = 'none';
            return;
        }
        
        try {
            // Buscar productos que coincidan con el término de búsqueda
            const products = await database.query(
                `SELECT id, nombre, codigo_barra, precio, imagen_url 
                 FROM productos 
                 WHERE (nombre LIKE ? OR codigo_barra LIKE ?) 
                 AND activo = 1 
                 LIMIT 10`,
                [`%${searchTerm}%`, `%${searchTerm}%`]
            );
            
            // Mostrar resultados
            this.renderSearchResults(products);
        } catch (error) {
            console.error('Error al buscar productos:', error);
        }
    }
    
    /**
     * Renderiza los resultados de búsqueda de productos
     */
    renderSearchResults(products) {
        const resultsContainer = this.elements.productSearchResults;
        
        // Limpiar resultados anteriores
        resultsContainer.innerHTML = '';
        
        if (products.length === 0) {
            resultsContainer.innerHTML = '<div class="no-results">No se encontraron productos</div>';
            resultsContainer.style.display = 'block';
            return;
        }
        
        // Crear elementos para cada producto
        products.forEach(product => {
            const productElement = document.createElement('div');
            productElement.classList.add('product-result-item');
            productElement.dataset.id = product.id;
            
            // Formatear precio con separador de miles
            const formattedPrice = new Intl.NumberFormat('es-AR', {
                style: 'currency',
                currency: 'ARS'
            }).format(product.precio);
            
            productElement.innerHTML = `
                <div class="product-result-image">
                    <img src="${product.imagen_url || '../../../assets/img/products/default.png'}" alt="${product.nombre}">
                </div>
                <div class="product-result-info">
                    <div class="product-result-name">${product.nombre}</div>
                    <div class="product-result-code">${product.codigo_barra || 'Sin código'}</div>
                    <div class="product-result-price">${formattedPrice}</div>
                </div>
            `;
            
            resultsContainer.appendChild(productElement);
        });
        
        resultsContainer.style.display = 'block';
    }
    
    /**
     * Selecciona un producto de los resultados de búsqueda
     */
    async selectProductFromSearch(productId) {
        try {
            // Obtener detalles del producto
            const [product] = await database.query(
                'SELECT * FROM productos WHERE id = ?',
                [productId]
            );
            
            if (!product) {
                console.error('Producto no encontrado');
                return;
            }
            
            // Agregar el producto a la lista de seleccionados
            this.addProductToSelection(product);
            
            // Limpiar búsqueda y resultados
            this.elements.productSearchInput.value = '';
            this.elements.productSearchResults.innerHTML = '';
            this.elements.productSearchResults.style.display = 'none';
            
        } catch (error) {
            console.error('Error al seleccionar producto:', error);
        }
    }
    
    /**
     * Maneja la selección manual de productos
     */
    async handleProductSelect() {
        const searchTerm = this.elements.productSearchInput.value.trim();
        
        if (searchTerm.length === 0) return;
        
        try {
            // Buscar producto por código de barras o nombre exacto
            const [product] = await database.query(
                `SELECT * FROM productos 
                 WHERE codigo_barra = ? OR nombre = ? 
                 AND activo = 1 
                 LIMIT 1`,
                [searchTerm, searchTerm]
            );
            
            if (product) {
                this.addProductToSelection(product);
                
                // Limpiar búsqueda y resultados
                this.elements.productSearchInput.value = '';
                this.elements.productSearchResults.innerHTML = '';
                this.elements.productSearchResults.style.display = 'none';
            } else {
                this.showError('Producto no encontrado');
            }
        } catch (error) {
            console.error('Error al seleccionar producto:', error);
        }
    }
    
    /**
     * Maneja la adición manual de productos
     */
    handleAddProduct() {
        this.handleProductSelect();
    }
    
    /**
     * Agrega un producto a la lista de seleccionados
     */
    addProductToSelection(product) {
        // Verificar si el producto ya está en la lista
        const existingProduct = this.selectedProducts.find(p => p.id === product.id);
        
        if (existingProduct) {
            // Incrementar cantidad si ya existe
            existingProduct.cantidad += 1;
            existingProduct.subtotal = existingProduct.cantidad * existingProduct.precio;
            
            // Actualizar elemento en la interfaz
            const productElement = document.getElementById(`product-${product.id}`);
            if (productElement) {
                const quantityElement = productElement.querySelector('.product-quantity');
                const subtotalElement = productElement.querySelector('.product-subtotal');
                
                quantityElement.textContent = existingProduct.cantidad;
                subtotalElement.textContent = new Intl.NumberFormat('es-AR', {
                    style: 'currency',
                    currency: 'ARS'
                }).format(existingProduct.subtotal);
            }
        } else {
            // Agregar nuevo producto
            const newProduct = {
                id: product.id,
                nombre: product.nombre,
                codigo_barra: product.codigo_barra || 'Sin código',
                precio: product.precio,
                imagen_url: product.imagen_url || '../../../assets/img/products/default.png',
                cantidad: 1,
                subtotal: product.precio
            };
            
            this.selectedProducts.push(newProduct);
            
            // Crear elemento en la interfaz
            this.renderProductElement(newProduct);
        }
        
        // Actualizar total
        this.updateTotal();
    }
    
    /**
     * Renderiza un elemento de producto en la lista
     */
    renderProductElement(product) {
        const productElement = document.createElement('div');
        productElement.id = `product-${product.id}`;
        productElement.classList.add('selected-product-item');
        
        // Formatear precio con separador de miles
        const formattedPrice = new Intl.NumberFormat('es-AR', {
            style: 'currency',
            currency: 'ARS'
        }).format(product.precio);
        
        const formattedSubtotal = new Intl.NumberFormat('es-AR', {
            style: 'currency',
            currency: 'ARS'
        }).format(product.subtotal);
        
        productElement.innerHTML = `
            <div class="product-image">
                <img src="${product.imagen_url}" alt="${product.nombre}">
            </div>
            <div class="product-info">
                <div class="product-name">${product.nombre}</div>
                <div class="product-code">${product.codigo_barra}</div>
                <div class="product-price">${formattedPrice}</div>
            </div>
            <div class="product-controls">
                <button class="decrement-btn" data-id="${product.id}">-</button>
                <span class="product-quantity">${product.cantidad}</span>
                <button class="increment-btn" data-id="${product.id}">+</button>
            </div>
            <div class="product-subtotal">${formattedSubtotal}</div>
            <button class="remove-product-btn" data-id="${product.id}">×</button>
        `;
        
        // Agregar event listeners para botones
        productElement.querySelector('.decrement-btn').addEventListener('click', () => {
            this.decrementProductQuantity(product.id);
        });
        
        productElement.querySelector('.increment-btn').addEventListener('click', () => {
            this.incrementProductQuantity(product.id);
        });
        
        productElement.querySelector('.remove-product-btn').addEventListener('click', () => {
            this.removeProduct(product.id);
        });
        
        this.elements.productListContainer.appendChild(productElement);
    }
    
    /**
     * Incrementa la cantidad de un producto
     */
    incrementProductQuantity(productId) {
        const product = this.selectedProducts.find(p => p.id === productId);
        
        if (product) {
            product.cantidad += 1;
            product.subtotal = product.cantidad * product.precio;
            
            // Actualizar interfaz
            const productElement = document.getElementById(`product-${productId}`);
            if (productElement) {
                const quantityElement = productElement.querySelector('.product-quantity');
                const subtotalElement = productElement.querySelector('.product-subtotal');
                
                quantityElement.textContent = product.cantidad;
                subtotalElement.textContent = new Intl.NumberFormat('es-AR', {
                    style: 'currency',
                    currency: 'ARS'
                }).format(product.subtotal);
            }
            
            // Actualizar total
            this.updateTotal();
        }
    }
    
    /**
     * Decrementa la cantidad de un producto
     */
    decrementProductQuantity(productId) {
        const product = this.selectedProducts.find(p => p.id === productId);
        
        if (product && product.cantidad > 1) {
            product.cantidad -= 1;
            product.subtotal = product.cantidad * product.precio;
            
            // Actualizar interfaz
            const productElement = document.getElementById(`product-${productId}`);
            if (productElement) {
                const quantityElement = productElement.querySelector('.product-quantity');
                const subtotalElement = productElement.querySelector('.product-subtotal');
                
                quantityElement.textContent = product.cantidad;
                subtotalElement.textContent = new Intl.NumberFormat('es-AR', {
                    style: 'currency',
                    currency: 'ARS'
                }).format(product.subtotal);
            }
            
            // Actualizar total
            this.updateTotal();
        } else if (product && product.cantidad === 1) {
            // Si la cantidad llega a 0, eliminar el producto
            this.removeProduct(productId);
        }
    }
    
    /**
     * Elimina un producto de la lista
     */
    removeProduct(productId) {
        // Eliminar del array
        this.selectedProducts = this.selectedProducts.filter(p => p.id !== productId);
        
        // Eliminar de la interfaz
        const productElement = document.getElementById(`product-${productId}`);
        if (productElement) {
            productElement.remove();
        }
        
        // Actualizar total
        this.updateTotal();
    }
    
    /**
     * Actualiza el total de la compra
     */
    updateTotal() {
        this.totalAmount = this.selectedProducts.reduce((sum, product) => sum + product.subtotal, 0);
        
        // Mostrar total en la interfaz
        this.elements.totalAmountDisplay.textContent = new Intl.NumberFormat('es-AR', {
            style: 'currency',
            currency: 'ARS'
        }).format(this.totalAmount);
        
        // Si ya hay simulación, actualizarla
        if (this.selectedBank && this.selectedCard && this.selectedInstallments) {
            this.simulatePayment();
        }
    }
    
    /**
     * Maneja el cambio de banco
     */
    handleBankChange(e) {
        this.selectedBank = e.target.value;
        
        // Habilitar selector de tarjetas
        this.elements.cardSelector.disabled = !this.selectedBank;
        
        // Reiniciar selectores dependientes
        this.elements.cardSelector.value = '';
        this.elements.installmentsSelector.value = '';
        this.elements.installmentsSelector.disabled = true;
        
        // Reiniciar resultados
        this.resetResults();
    }
    
    /**
     * Maneja el cambio de tarjeta
     */
    handleCardChange(e) {
        this.selectedCard = e.target.value;
        
        // Habilitar selector de cuotas
        this.elements.installmentsSelector.disabled = !this.selectedCard;
        
        // Reiniciar valores dependientes
        this.elements.installmentsSelector.value = '';
        
        // Reiniciar resultados
        this.resetResults();
    }
    
    /**
     * Maneja el cambio de cuotas
     */
    handleInstallmentsChange(e) {
        this.selectedInstallments = parseInt(e.target.value);
        
        // Simular automáticamente cuando se seleccionan las cuotas
        if (this.selectedBank && this.selectedCard && this.selectedInstallments) {
            this.simulatePayment();
        }
    }
    
    /**
     * Simula el pago en cuotas
     */
    simulatePayment() {
        if (!this.validateSimulation()) {
            return;
        }
        
        try {
            // Obtener tasa de interés correspondiente
            const interestRate = this.getInterestRate(this.selectedBank, this.selectedCard, this.selectedInstallments);
            this.interestRate = interestRate;
            
            // Calcular total con interés
            this.totalWithInterest = this.totalAmount * (1 + (interestRate / 100));
            
            // Calcular valor de cada cuota
            this.installmentAmount = this.totalWithInterest / this.selectedInstallments;
            
            // Mostrar resultados en la interfaz
            this.displayResults();
            
            // Habilitar botón para ir al facturador
            this.elements.goToFacturadorBtn.disabled = false;
            
        } catch (error) {
            console.error('Error al simular pago:', error);
            this.showError('Error al simular el pago');
        }
    }
    
    /**
     * Valida que se puedan realizar los cálculos de simulación
     */
    validateSimulation() {
        // Verificar que haya productos seleccionados
        if (this.selectedProducts.length === 0) {
            this.showError('Debe seleccionar al menos un producto');
            return false;
        }
        
        // Verificar que se haya seleccionado banco, tarjeta y cuotas
        if (!this.selectedBank || !this.selectedCard || !this.selectedInstallments) {
            this.showError('Debe seleccionar banco, tarjeta y cantidad de cuotas');
            return false;
        }
        
        return true;
    }
    
    /**
     * Obtiene la tasa de interés para una combinación específica
     */
    getInterestRate(bankId, cardId, installments) {
        try {
            // Buscar tasa en la estructura de datos
            if (this.tasasInteres[bankId] && 
                this.tasasInteres[bankId][cardId] && 
                this.tasasInteres[bankId][cardId][installments] !== undefined) {
                return this.tasasInteres[bankId][cardId][installments];
            }
            
            // Si no se encuentra la tasa específica, buscar una tasa por defecto
            if (this.tasasInteres['default'] && 
                this.tasasInteres['default'][cardId] && 
                this.tasasInteres['default'][cardId][installments] !== undefined) {
                return this.tasasInteres['default'][cardId][installments];
            }
            
            // Si no hay tasa específica ni por defecto, usar una tasa estándar según las cuotas
            if (installments === 1) {
                return 0; // Sin interés para pago en 1 cuota
            } else if (installments <= 3) {
                return 10; // 10% para hasta 3 cuotas
            } else if (installments <= 6) {
                return 15; // 15% para hasta 6 cuotas
            } else if (installments <= 12) {
                return 25; // 25% para hasta 12 cuotas
            } else {
                return 40; // 40% para más de 12 cuotas
            }
        } catch (error) {
            console.error('Error al obtener tasa de interés:', error);
            return 0;
        }
    }
    
    /**
     * Muestra los resultados de la simulación
     */
    displayResults() {
        // Mostrar tasa de interés
        this.elements.interestRateDisplay.textContent = `${this.interestRate.toFixed(2)}%`;
        
        // Mostrar total con interés
        this.elements.totalWithInterestDisplay.textContent = new Intl.NumberFormat('es-AR', {
            style: 'currency',
            currency: 'ARS'
        }).format(this.totalWithInterest);
        
        // Mostrar valor de cada cuota
        this.elements.installmentAmountDisplay.textContent = new Intl.NumberFormat('es-AR', {
            style: 'currency',
            currency: 'ARS'
        }).format(this.installmentAmount);
        
        // Mostrar mensaje de resultado
        const resultModal = document.getElementById('result-modal');
        if (resultModal) {
            const bankName = this.elements.bankSelector.options[this.elements.bankSelector.selectedIndex].text;
            const cardName = this.elements.cardSelector.options[this.elements.cardSelector.selectedIndex].text;
            
            document.getElementById('modal-bank-card').textContent = `${bankName} - ${cardName}`;
            document.getElementById('modal-installments').textContent = `${this.selectedInstallments} cuota${this.selectedInstallments > 1 ? 's' : ''}`;
            document.getElementById('modal-interest-rate').textContent = `${this.interestRate.toFixed(2)}%`;
            document.getElementById('modal-total-amount').textContent = new Intl.NumberFormat('es-AR', {
                style: 'currency',
                currency: 'ARS'
            }).format(this.totalAmount);
            document.getElementById('modal-total-with-interest').textContent = new Intl.NumberFormat('es-AR', {
                style: 'currency',
                currency: 'ARS'
            }).format(this.totalWithInterest);
            document.getElementById('modal-installment-amount').textContent = new Intl.NumberFormat('es-AR', {
                style: 'currency',
                currency: 'ARS'
            }).format(this.installmentAmount);
            
            resultModal.classList.add('show');
            
            // Agregar evento para cerrar modal
            document.getElementById('close-modal').addEventListener('click', () => {
                resultModal.classList.remove('show');
            });
        }
    }
    
    /**
     * Reinicia los resultados de la simulación
     */
    resetResults() {
        this.interestRate = 0;
        this.totalWithInterest = 0;
        this.installmentAmount = 0;
        
        // Limpiar elementos en la interfaz
        this.elements.interestRateDisplay.textContent = '0.00%';
        this.elements.totalWithInterestDisplay.textContent = '$0.00';
        this.elements.installmentAmountDisplay.textContent = '$0.00';
        
        // Deshabilitar botón para ir al facturador
        this.elements.goToFacturadorBtn.disabled = true;
    }
    
    /**
     * Reinicia toda la simulación
     */
    resetSimulation() {
        // Limpiar productos seleccionados
        this.selectedProducts = [];
        this.elements.productListContainer.innerHTML = '';
        
        // Resetear selectores
        this.elements.bankSelector.value = '';
        this.elements.cardSelector.value = '';
        this.elements.installmentsSelector.value = '';
        
        // Deshabilitar selectores dependientes
        this.elements.cardSelector.disabled = true;
        this.elements.installmentsSelector.disabled = true;
        
        // Resetear resultados
        this.totalAmount = 0;
        this.elements.totalAmountDisplay.textContent = '$0.00';
        this.resetResults();
        
        // Limpiar campo de búsqueda
        this.elements.productSearchInput.value = '';
        this.elements.productSearchResults.innerHTML = '';
        this.elements.productSearchResults.style.display = 'none';
    }
    
    /**
     * Redirige al facturador con los productos seleccionados
     */
    goToFacturador() {
        if (this.selectedProducts.length === 0) {
            this.showError('No hay productos seleccionados para facturar');
            return;
        }
        
        try {
            // Almacenar datos de simulación en sessionStorage para que los recoja el facturador
            const simulationData = {
                products: this.selectedProducts,
                paymentInfo: {
                    bank: {
                        id: this.selectedBank,
                        name: this.elements.bankSelector.options[this.elements.bankSelector.selectedIndex].text
                    },
                    card: {
                        id: this.selectedCard,
                        name: this.elements.cardSelector.options[this.elements.cardSelector.selectedIndex].text
                    },
                    installments: this.selectedInstallments,
                    interestRate: this.interestRate,
                    totalAmount: this.totalAmount,
                    totalWithInterest: this.totalWithInterest,
                    installmentAmount: this.installmentAmount
                }
            };
            
            sessionStorage.setItem('cuotificadorData', JSON.stringify(simulationData));
            
            // Registrar actividad
            logger.logActivity('cuotificador', 'redirect_to_facturador', this.user.id, {
                productCount: this.selectedProducts.length,
                totalAmount: this.totalAmount,
                bankId: this.selectedBank,
                cardId: this.selectedCard,
                installments: this.selectedInstallments
            });
            
            // Redirigir al facturador
            window.location.href = '../../../views/facturador.html?from=cuotificador';
        } catch (error) {
            console.error('Error al redirigir al facturador:', error);
            this.showError('No se pudo redirigir al facturador');
        }
    }
    
    /**
     * Muestra un mensaje de error
     */
    showError(message) {
        const errorContainer = document.getElementById('error-container');
        if (errorContainer) {
            errorContainer.textContent = message;
            errorContainer.style.display = 'block';
            
            // Ocultar después de 3 segundos
            setTimeout(() => {
                errorContainer.style.display = 'none';
            }, 3000);
        } else {
            alert(message);
        }
    }
    
    /**
     * Compara tasas de interés entre diferentes bancos
     * para ayudar al usuario a tomar decisiones
     */
    compareBankRates() {
        try {
            const installments = this.selectedInstallments;
            const cardId = this.selectedCard;
            
            if (!installments || !cardId) {
                this.showError('Seleccione tarjeta y cuotas para comparar tasas');
                return;
            }
            
            // Recopilar tasas de todos los bancos para la misma tarjeta y cuotas
            const comparisons = [];
            
            for (const bankId in this.tasasInteres) {
                if (this.tasasInteres[bankId][cardId] && 
                    this.tasasInteres[bankId][cardId][installments] !== undefined) {
                    
                    comparisons.push({
                        bankId: bankId,
                        rate: this.tasasInteres[bankId][cardId][installments]
                    });
                }
            }
            
            // Ordenar por tasa (de menor a mayor)
            comparisons.sort((a, b) => a.rate - b.rate);
            
            // Mostrar comparación en un modal
            this.displayBankComparison(comparisons, installments);
            
        } catch (error) {
            console.error('Error al comparar tasas:', error);
        }
    }
    
    /**
     * Muestra la comparación de tasas entre bancos
     */
    async displayBankComparison(comparisons, installments) {
        try {
            // Obtener nombres de bancos
            const banksData = await database.query('SELECT id, nombre FROM bancos WHERE activo = 1');
            const banksMap = {};
            
            banksData.forEach(bank => {
                banksMap[bank.id] = bank.nombre;
            });
            
            // Crear modal para mostrar comparación
            const modalContainer = document.createElement('div');
            modalContainer.className = 'comparison-modal';
            
            let modalContent = `
                <div class="comparison-modal-content">
                    <div class="comparison-modal-header">
                        <h3>Comparación de Tasas para ${installments} cuota${installments > 1 ? 's' : ''}</h3>
                        <button class="close-comparison-modal">×</button>
                    </div>
                    <div class="comparison-modal-body">
                        <table class="comparison-table">
                            <thead>
                                <tr>
                                    <th>Banco</th>
                                    <th>Tasa de Interés</th>
                                    <th>Total para $${this.totalAmount.toFixed(2)}</th>
                                    <th>Valor Cuota</th>
                                </tr>
                            </thead>
                            <tbody>
            `;
            
            // Agregar filas para cada banco
            comparisons.forEach(comp => {
                const bankName = banksMap[comp.bankId] || `Banco ID: ${comp.bankId}`;
                const totalWithInterest = this.totalAmount * (1 + (comp.rate / 100));
                const installmentAmount = totalWithInterest / installments;
                
                modalContent += `
                    <tr>
                        <td>${bankName}</td>
                        <td>${comp.rate.toFixed(2)}%</td>
                        <td>${new Intl.NumberFormat('es-AR', {
                            style: 'currency',
                            currency: 'ARS'
                        }).format(totalWithInterest)}</td>
                        <td>${new Intl.NumberFormat('es-AR', {
                            style: 'currency',
                            currency: 'ARS'
                        }).format(installmentAmount)}</td>
                    </tr>
                `;
            });
            
            modalContent += `
                            </tbody>
                        </table>
                    </div>
                    <div class="comparison-modal-footer">
                        <button class="select-best-rate">Seleccionar Mejor Tasa</button>
                    </div>
                </div>
            `;
            
            modalContainer.innerHTML = modalContent;
            document.body.appendChild(modalContainer);
            
            // Mostrar modal con animación
            setTimeout(() => {
                modalContainer.classList.add('show');
            }, 10);
            
            // Evento para cerrar modal
            modalContainer.querySelector('.close-comparison-modal').addEventListener('click', () => {
                modalContainer.classList.remove('show');
                setTimeout(() => {
                    modalContainer.remove();
                }, 300);
            });
            
            // Evento para seleccionar la mejor tasa
            if (comparisons.length > 0) {
                modalContainer.querySelector('.select-best-rate').addEventListener('click', () => {
                    // Seleccionar el banco con menor tasa
                    const bestBank = comparisons[0].bankId;
                    
                    // Actualizar el selector de banco
                    this.elements.bankSelector.value = bestBank;
                    this.selectedBank = bestBank;
                    
                    // Simular el pago
                    this.simulatePayment();
                    
                    // Cerrar modal
                    modalContainer.classList.remove('show');
                    setTimeout(() => {
                        modalContainer.remove();
                    }, 300);
                });
            }
            
        } catch (error) {
            console.error('Error al mostrar comparación de bancos:', error);
        }
    }
    
    /**
     * Genera un informe detallado de la simulación actual
     */
    generateReport() {
        if (!this.validateSimulation()) {
            return;
        }
        
        try {
            // Crear contenido del informe
            const reportData = {
                fecha: new Date().toLocaleDateString('es-AR'),
                hora: new Date().toLocaleTimeString('es-AR'),
                usuario: this.user.nombre + ' ' + this.user.apellido,
                productos: this.selectedProducts,
                banco: this.elements.bankSelector.options[this.elements.bankSelector.selectedIndex].text,
                tarjeta: this.elements.cardSelector.options[this.elements.cardSelector.selectedIndex].text,
                cuotas: this.selectedInstallments,
                tasa: this.interestRate.toFixed(2) + '%',
                montoTotal: this.totalAmount,
                totalConInteres: this.totalWithInterest,
                valorCuota: this.installmentAmount
            };
            
            // Guardar informe en base de datos
            this.saveReportToDatabase(reportData);
            
            // Generar PDF del informe
            this.generateReportPDF(reportData);
            
        } catch (error) {
            console.error('Error al generar informe:', error);
            this.showError('No se pudo generar el informe');
        }
    }
    
    /**
     * Guarda el informe en la base de datos
     */
    async saveReportToDatabase(reportData) {
        try {
            // Insertar registro en tabla de simulaciones
            const simulacionId = await database.insert('simulaciones_cuotas', {
                usuario_id: this.user.id,
                fecha: new Date().toISOString(),
                banco_id: this.selectedBank,
                tarjeta_id: this.selectedCard,
                cuotas: this.selectedInstallments,
                tasa_interes: this.interestRate,
                monto_total: this.totalAmount,
                total_con_interes: this.totalWithInterest,
                valor_cuota: this.installmentAmount
            });
            
            // Insertar detalle de productos
            for (const product of this.selectedProducts) {
                await database.insert('simulaciones_cuotas_detalle', {
                    simulacion_id: simulacionId,
                    producto_id: product.id,
                    cantidad: product.cantidad,
                    precio_unitario: product.precio,
                    subtotal: product.subtotal
                });
            }
            
            console.log('Simulación guardada con ID:', simulacionId);
            return simulacionId;
            
        } catch (error) {
            console.error('Error al guardar simulación en base de datos:', error);
            throw error;
        }
    }
    
    /**
     * Genera un PDF con el informe detallado
     */
    async generateReportPDF(reportData) {
        try {
            // Importar servicio de generación de PDF
            const { pdf } = await import('../../../services/print/pdf.js');
            
            // Construir contenido del PDF
            const content = {
                title: 'Informe de Simulación de Cuotas',
                date: reportData.fecha + ' ' + reportData.hora,
                user: reportData.usuario,
                sections: [
                    {
                        title: 'Datos de Financiación',
                        items: [
                            { label: 'Banco', value: reportData.banco },
                            { label: 'Tarjeta', value: reportData.tarjeta },
                            { label: 'Cuotas', value: reportData.cuotas },
                            { label: 'Tasa de Interés', value: reportData.tasa }
                        ]
                    },
                    {
                        title: 'Productos',
                        table: {
                            headers: ['Producto', 'Cantidad', 'Precio Unit.', 'Subtotal'],
                            rows: reportData.productos.map(p => [
                                p.nombre,
                                p.cantidad.toString(),
                                new Intl.NumberFormat('es-AR', {
                                    style: 'currency',
                                    currency: 'ARS'
                                }).format(p.precio),
                                new Intl.NumberFormat('es-AR', {
                                    style: 'currency',
                                    currency: 'ARS'
                                }).format(p.subtotal)
                            ])
                        }
                    },
                    {
                        title: 'Totales',
                        items: [
                            { 
                                label: 'Total sin interés', 
                                value: new Intl.NumberFormat('es-AR', {
                                    style: 'currency',
                                    currency: 'ARS'
                                }).format(reportData.montoTotal)
                            },
                            { 
                                label: 'Total con interés', 
                                value: new Intl.NumberFormat('es-AR', {
                                    style: 'currency',
                                    currency: 'ARS'
                                }).format(reportData.totalConInteres)
                            },
                            { 
                                label: `Valor de cada cuota (${reportData.cuotas})`, 
                                value: new Intl.NumberFormat('es-AR', {
                                    style: 'currency',
                                    currency: 'ARS'
                                }).format(reportData.valorCuota)
                            }
                        ]
                    }
                ],
                footer: 'Esta simulación es informativa y está sujeta a cambios según políticas bancarias.'
            };
            
            // Generar PDF
            const pdfBlob = await pdf.generate(content, 'simulacion_cuotas');
            
            // Mostrar opciones para guardar o imprimir
            const actionsModal = document.createElement('div');
            actionsModal.className = 'pdf-actions-modal';
            
            actionsModal.innerHTML = `
                <div class="pdf-actions-modal-content">
                    <div class="pdf-actions-modal-header">
                        <h3>Informe Generado</h3>
                        <button class="close-pdf-modal">×</button>
                    </div>
                    <div class="pdf-actions-modal-body">
                        <p>El informe de simulación ha sido generado correctamente.</p>
                        <div class="pdf-actions-buttons">
                            <button class="download-pdf-btn">Descargar PDF</button>
                            <button class="print-pdf-btn">Imprimir</button>
                            <button class="email-pdf-btn">Enviar por Email</button>
                            <button class="whatsapp-pdf-btn">Enviar por WhatsApp</button>
                        </div>
                    </div>
                </div>
            `;
            
            document.body.appendChild(actionsModal);
            
            // Mostrar modal con animación
            setTimeout(() => {
                actionsModal.classList.add('show');
            }, 10);
            
            // Evento para descargar PDF
            actionsModal.querySelector('.download-pdf-btn').addEventListener('click', () => {
                const downloadLink = document.createElement('a');
                downloadLink.href = URL.createObjectURL(pdfBlob);
                downloadLink.download = 'Simulacion_Cuotas.pdf';
                document.body.appendChild(downloadLink);
                downloadLink.click();
                document.body.removeChild(downloadLink);
            });
            
            // Evento para imprimir PDF
            actionsModal.querySelector('.print-pdf-btn').addEventListener('click', async () => {
                try {
                    // Importar servicio de impresión
                    const { printer } = await import('../../../services/print/printer.js');
                    printer.printPDF(pdfBlob);
                } catch (error) {
                    console.error('Error al imprimir PDF:', error);
                    this.showError('No se pudo imprimir el informe');
                }
            });
            
            // Evento para enviar por email
            actionsModal.querySelector('.email-pdf-btn').addEventListener('click', async () => {
                try {
                    // Mostrar modal para ingresar correo
                    this.showEmailModal(pdfBlob);
                    
                    // Cerrar modal de acciones
                    actionsModal.classList.remove('show');
                    setTimeout(() => {
                        actionsModal.remove();
                    }, 300);
                } catch (error) {
                    console.error('Error al preparar envío por email:', error);
                    this.showError('No se pudo preparar el envío por email');
                }
            });
            
            // Evento para enviar por WhatsApp
            actionsModal.querySelector('.whatsapp-pdf-btn').addEventListener('click', async () => {
                try {
                    // Mostrar modal para ingresar número de teléfono
                    this.showWhatsAppModal(pdfBlob);
                    
                    // Cerrar modal de acciones
                    actionsModal.classList.remove('show');
                    setTimeout(() => {
                        actionsModal.remove();
                    }, 300);
                } catch (error) {
                    console.error('Error al preparar envío por WhatsApp:', error);
                    this.showError('No se pudo preparar el envío por WhatsApp');
                }
            });
            
            // Evento para cerrar modal
            actionsModal.querySelector('.close-pdf-modal').addEventListener('click', () => {
                actionsModal.classList.remove('show');
                setTimeout(() => {
                    actionsModal.remove();
                }, 300);
            });
            
        } catch (error) {
            console.error('Error al generar PDF:', error);
            this.showError('No se pudo generar el informe PDF');
        }
    }
    
    /**
     * Muestra un modal para enviar el informe por email
     */
    showEmailModal(pdfBlob) {
        const emailModal = document.createElement('div');
        emailModal.className = 'email-modal';
        
        emailModal.innerHTML = `
            <div class="email-modal-content">
                <div class="email-modal-header">
                    <h3>Enviar por Email</h3>
                    <button class="close-email-modal">×</button>
                </div>
                <div class="email-modal-body">
                    <form id="email-form">
                        <div class="form-group">
                            <label for="email-recipient">Correo electrónico:</label>
                            <input type="email" id="email-recipient" required>
                        </div>
                        <div class="form-group">
                            <label for="email-subject">Asunto:</label>
                            <input type="text" id="email-subject" value="Simulación de Cuotas - FactuSystem" required>
                        </div>
                        <div class="form-group">
                            <label for="email-message">Mensaje:</label>
                            <textarea id="email-message" rows="4">Adjunto encontrará la simulación de cuotas solicitada. Saludos cordiales.</textarea>
                        </div>
                        <button type="submit" class="send-email-btn">Enviar</button>
                    </form>
                </div>
            </div>
        `;
        
        document.body.appendChild(emailModal);
        
        // Mostrar modal con animación
        setTimeout(() => {
            emailModal.classList.add('show');
        }, 10);
        
        // Evento para cerrar modal
        emailModal.querySelector('.close-email-modal').addEventListener('click', () => {
            emailModal.classList.remove('show');
            setTimeout(() => {
                emailModal.remove();
            }, 300);
        });
        
        // Evento para enviar email
        emailModal.querySelector('#email-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const recipient = emailModal.querySelector('#email-recipient').value;
            const subject = emailModal.querySelector('#email-subject').value;
            const message = emailModal.querySelector('#email-message').value;
            
            try {
                // Importar servicio de email
                const { email } = await import('../../../integrations/email/sender.js');
                
                // Enviar email
                await email.sendWithAttachment(recipient, subject, message, pdfBlob, 'Simulacion_Cuotas.pdf');
                
                // Mostrar mensaje de éxito
                this.showSuccess('Email enviado correctamente');
                
                // Cerrar modal
                emailModal.classList.remove('show');
                setTimeout(() => {
                    emailModal.remove();
                }, 300);
                
            } catch (error) {
                console.error('Error al enviar email:', error);
                this.showError('No se pudo enviar el email');
            }
        });
    }
    
    /**
     * Muestra un modal para enviar el informe por WhatsApp
     */
    showWhatsAppModal(pdfBlob) {
        const whatsappModal = document.createElement('div');
        whatsappModal.className = 'whatsapp-modal';
        
        whatsappModal.innerHTML = `
            <div class="whatsapp-modal-content">
                <div class="whatsapp-modal-header">
                    <h3>Enviar por WhatsApp</h3>
                    <button class="close-whatsapp-modal">×</button>
                </div>
                <div class="whatsapp-modal-body">
                    <form id="whatsapp-form">
                        <div class="form-group">
                            <label for="whatsapp-number">Número de teléfono:</label>
                            <input type="tel" id="whatsapp-number" placeholder="Ej: 1155667788" required>
                        </div>
                        <div class="form-group">
                            <label for="whatsapp-message">Mensaje:</label>
                            <textarea id="whatsapp-message" rows="4">Adjunto encontrará la simulación de cuotas solicitada. Saludos cordiales.</textarea>
                        </div>
                        <button type="submit" class="send-whatsapp-btn">Enviar</button>
                    </form>
                </div>
            </div>
        `;
        
        document.body.appendChild(whatsappModal);
        
        // Mostrar modal con animación
        setTimeout(() => {
            whatsappModal.classList.add('show');
        }, 10);
        
        // Evento para cerrar modal
        whatsappModal.querySelector('.close-whatsapp-modal').addEventListener('click', () => {
            whatsappModal.classList.remove('show');
            setTimeout(() => {
                whatsappModal.remove();
            }, 300);
        });
        
        // Evento para enviar WhatsApp
        whatsappModal.querySelector('#whatsapp-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const phoneNumber = whatsappModal.querySelector('#whatsapp-number').value;
            const message = whatsappModal.querySelector('#whatsapp-message').value;
            
            try {
                // Importar servicio de WhatsApp
                const { whatsapp } = await import('../../../integrations/whatsapp/api.js');
                
                // Enviar por WhatsApp
                await whatsapp.sendFile(phoneNumber, message, pdfBlob, 'Simulacion_Cuotas.pdf');
                
                // Mostrar mensaje de éxito
                this.showSuccess('Archivo enviado por WhatsApp correctamente');
                
                // Cerrar modal
                whatsappModal.classList.remove('show');
                setTimeout(() => {
                    whatsappModal.remove();
                }, 300);
                
            } catch (error) {
                console.error('Error al enviar por WhatsApp:', error);
                this.showError('No se pudo enviar el archivo por WhatsApp');
            }
        });
    }
    
    /**
     * Muestra un mensaje de éxito
     */
    showSuccess(message) {
        const successContainer = document.getElementById('success-container');
        if (successContainer) {
            successContainer.textContent = message;
            successContainer.style.display = 'block';
            
            // Ocultar después de 3 segundos
            setTimeout(() => {
                successContainer.style.display = 'none';
            }, 3000);
        } else {
            alert(message);
        }
    }
}

// Instanciar el cuotificador cuando se carga la página
document.addEventListener('DOMContentLoaded', () => {
    const cuotificador = new Cuotificador();
    
    // Exponer la instancia globalmente para debug
    window.cuotificador = cuotificador;
    
    // Comprobar si hay datos previos en sessionStorage (volviendo del facturador)
    const prevSessionData = sessionStorage.getItem('facturadorToCuotificador');
    if (prevSessionData) {
        try {
            const data = JSON.parse(prevSessionData);
            
            // Restaurar productos si existen
            if (data.products && Array.isArray(data.products)) {
                data.products.forEach(product => {
                    cuotificador.addProductToSelection(product);
                });
            }
            
            // Eliminar datos de session para no reutilizarlos
            sessionStorage.removeItem('facturadorToCuotificador');
        } catch (error) {
            console.error('Error al recuperar datos previos:', error);
        }
    }
    
    // Agregar listeners para botones adicionales
    const compareRatesBtn = document.getElementById('compare-rates-btn');
    if (compareRatesBtn) {
        compareRatesBtn.addEventListener('click', () => {
            cuotificador.compareBankRates();
        });
    }
    
    const generateReportBtn = document.getElementById('generate-report-btn');
    if (generateReportBtn) {
        generateReportBtn.addEventListener('click', () => {
            cuotificador.generateReport();
        });
    }
});

// Exportar la clase para uso en otros módulos
export default Cuotificador;