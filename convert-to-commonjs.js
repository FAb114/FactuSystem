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
const extensions = ['.js', '.mjs'];

// Función para convertir código ES Module a CommonJS
function convertToCommonJS(content) {
  // Reemplazar importaciones
  let newContent = content
    // const defaultExport = require("module-name");
    .replace(/import\s+(\w+)\s+from\s+(['"])(.+?)(['"])\s*;?/g, 'const $1 = require($2$3$4);')
    
    // const name = require("module-name");
    .replace(/import\s+\*\s+as\s+(\w+)\s+from\s+(['"])(.+?)(['"])\s*;?/g, 'const $1 = require($2$3$4);')
    
    // const { export1, export2 } = require("module-name");
    .replace(/import\s+\{([^}]+)\}\s+from\s+(['"])(.+?)(['"])\s*;?/g, (match, imports, quote1, moduleName, quote2) => {
      const cleanedImports = imports.split(',').map(i => i.trim()).join(', ');
      return `const { ${cleanedImports} } = require(${quote1}${moduleName}${quote2});`;
    })
    
    //  function/class/object
    .replace(/export\s+default\s+(?:function\s+)?(\w+)/g, (match, name) => {
      // Si ya hay un module.exports = ... no lo dupliquemos
      if (content.includes('module.exports =')) {
        return match.replace('export default', '');
      } else {
        return match.replace('export default', '') + '\n\nmodule.exports = ' + name;
      }
    })
    
    //  expression;
    .replace(/export\s+default\s+(.+);/g, 'module.exports = $1;')
    
    // export const/let/var
    .replace(/export\s+(const|let|var)\s+(\w+)/g, '$1 $2\nmodule.exports.$2 = $2')
    
    // export function
    .replace(/export\s+function\s+(\w+)/g, 'function $1\nmodule.exports.$1 = $1')
    
    // export class
    .replace(/export\s+class\s+(\w+)/g, 'class $1\nmodule.exports.$1 = $1')
    
    // module.exports.name1 = name1;
module.exports.name2 = name2;
    .replace(/export\s+\{([^}]+)\}\s*;?/g, (match, exports) => {
      const names = exports.split(',').map(e => e.trim());
      return names.map(name => `module.exports.${name} = ${name};`).join('\n');
    })
    
    // Para expresiones  arrow functions o expresiones complejas
    .replace(/export\s+default\s+\(/g, 'module.exports = (');
  
  // Reemplazar import() dinámico con require() usando un enfoque para hacerlo compatible
  newContent = newContent.replace(/import\s*\(\s*(['"])(.+?)(['"])\s*\)/g, 
    'Promise.resolve(require($1$2$3))');

  return newContent;
}

// Función para procesar un archivo
async function processFile(filePath) {
  try {
    const content = await readFileAsync(filePath, 'utf8');
    
    // Verificar si contiene sintaxis de ES modules
    if (content.includes('import ') || content.includes('export ')) {
      console.log(`Convirtiendo: ${filePath}`);
      const convertedContent = convertToCommonJS(content);
      await writeFileAsync(filePath, convertedContent, 'utf8');
    } else {
      console.log(`Saltando (ya parece CommonJS): ${filePath}`);
    }
  } catch (error) {
    console.error(`Error procesando ${filePath}:`, error);
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
        await processFile(entryPath);
      }
    }
  } catch (error) {
    console.error(`Error procesando directorio ${dirPath}:`, error);
  }
}

// Punto de entrada principal
async function main() {
  const rootDir = process.argv[2] || '.';
  console.log(`Comenzando conversión a CommonJS en: ${rootDir}`);
  await processDirectory(rootDir);
  console.log('Conversión completada');
}

main().catch(console.error);