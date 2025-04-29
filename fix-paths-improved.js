const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const readFileAsync = promisify(fs.readFile);
const writeFileAsync = promisify(fs.writeFile);
const readdirAsync = promisify(fs.readdir);
const statAsync = promisify(fs.stat);

// Directorios a excluir
const excludeDirs = ['node_modules', '.git', 'public', 'dist'];

// Extensiones a procesar
const extensions = ['.js'];

// Lista de archivos problemáticos mencionados en el error
const problematicFiles = [
  'app/assets/js/utils/auth.js',
  'app/assets/js/utils/sync.js',
  'controllers/backup/cloudSync.js',
  'services/backup/autoBackup.js',
  'services/sync/scheduler.js',
  'services/sync/offline.js',
  'services/auth/login.js',
  'main.js'
];

// Función para corregir las rutas de require en un archivo
async function fixRequirePaths(filePath) {
  try {
    const content = await readFileAsync(filePath, 'utf8');
    
    // Arreglar el problema de doble extensión (./database.js)
    let newContent = content.replace(/\.js\.js/g, '.js');
    
    // Ahora corregir require sin extensión .js, pero evitando las que ya la tienen
    newContent = newContent.replace(
      /require\(['"]([^'"]*\/[^'"]*?)['"](?!\.[a-zA-Z]+['"])\)/g, 
      (match, p1) => {
        // Si ya termina en .js, no hacemos nada
        if (p1.endsWith('.js')) {
          return match;
        }
        // Si no, añadimos la extensión .js
        return `require('${p1}.js')`;
      }
    );
    
    // Verificar si hay cambios
    if (content !== newContent) {
      console.log(`Corrigiendo rutas en: ${filePath}`);
      await writeFileAsync(filePath, newContent, 'utf8');
      return true;
    }
    return false;
  } catch (error) {
    console.error(`Error procesando ${filePath}:`, error);
    return false;
  }
}

// Busca y reemplaza todas las instancias de database.js
async function fixDoubleExtension(filePath) {
  try {
    const content = await readFileAsync(filePath, 'utf8');
    if (content.includes('database.js')) {
      console.log(`Corrigiendo doble extensión en: ${filePath}`);
      const newContent = content.replace(/database\.js\.js/g, 'database.js');
      await writeFileAsync(filePath, newContent, 'utf8');
    }
  } catch (error) {
    console.error(`Error corrigiendo ${filePath}:`, error);
  }
}

// Procesar un archivo específico
async function processSpecificFile(filePath) {
  const fullPath = path.resolve(filePath);
  if (fs.existsSync(fullPath)) {
    await fixRequirePaths(fullPath);
    await fixDoubleExtension(fullPath);
  } else {
    console.error(`Archivo no encontrado: ${fullPath}`);
  }
}

// Función recursiva para recorrer directorios
async function processDirectory(dirPath) {
  try {
    const entries = await readdirAsync(dirPath);
    
    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry);
      
      // Saltar directorios excluidos
      if (excludeDirs.includes(entry)) {
        continue;
      }
      
      const stats = await statAsync(entryPath);
      
      if (stats.isDirectory()) {
        await processDirectory(entryPath);
      } else if (stats.isFile() && extensions.includes(path.extname(entryPath))) {
        await fixRequirePaths(entryPath);
        await fixDoubleExtension(entryPath);
      }
    }
  } catch (error) {
    console.error(`Error procesando directorio ${dirPath}:`, error);
  }
}

// Punto de entrada principal
async function main() {
  // Opción 1: Procesar solo los archivos problemáticos
  if (process.argv.includes('--fix-problematic')) {
    console.log('Corrigiendo solo archivos problemáticos...');
    for (const file of problematicFiles) {
      await processSpecificFile(file);
    }
  } 
  // Opción 2: Procesar todo el proyecto
  else {
    const rootDir = process.argv[2] || '.';
    console.log(`Corrigiendo rutas de require en: ${rootDir}`);
    await processDirectory(rootDir);
  }
  
  console.log('Corrección de rutas completada');
}

main().catch(console.error);