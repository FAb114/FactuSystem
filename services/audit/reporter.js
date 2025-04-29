/**
 * @file reporter.js
 * @description Sistema de generación de informes de auditoría para FactuSystem
 * Este archivo maneja la generación de reportes de auditoría basados en los
 * registros de eventos capturados por logger.js. Permite filtrar, exportar y
 * visualizar la actividad del sistema para fines de auditoría y seguridad.
 */

const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const moment = require('moment');
const logger = require('./logger.js');
const { getDatabase } = require('../../app/assets/js/utils/database.js');
const { getUserSettings } = require('../../app/assets/js/utils/auth.js');
const { getCompanyInfo } = require('../../app/assets/js/modules/configuraciones/empresa.js');

/**
 * Clase principal para el sistema de reportes de auditoría
 */
class AuditReporter {
  constructor() {
    // Inicializar listeners de IPC para comunicación con el renderer
    this.initIPCListeners();
  }

  /**
   * Inicializa los listeners de IPC para responder a solicitudes del renderer
   */
  initIPCListeners() {
    ipcMain.handle('audit:getReportData', async (event, filters) => {
      return await this.getAuditData(filters);
    });
    
    ipcMain.handle('audit:generatePDF', async (event, data) => {
      return await this.generatePDFReport(data);
    });
    
    ipcMain.handle('audit:generateExcel', async (event, data) => {
      return await this.generateExcelReport(data);
    });
    
    ipcMain.handle('audit:getActivityByUser', async (event, userId) => {
      return await this.getUserActivity(userId);
    });

    ipcMain.handle('audit:getSecurityEvents', async (event, filters) => {
      return await this.getSecurityEvents(filters);
    });
  }

  /**
   * Obtiene datos de auditoría de la base de datos según los filtros proporcionados
   * @param {Object} filters - Filtros para la consulta (fechas, tipos, usuarios, etc.)
   * @returns {Promise<Array>} - Registros de auditoría filtrados
   */
  async getAuditData(filters = {}) {
    try {
      const db = await getDatabase();
      
      // Construir la consulta base
      let query = 'SELECT * FROM audit_logs WHERE 1=1';
      const params = [];
      
      // Aplicar filtros si existen
      if (filters.startDate && filters.endDate) {
        query += ' AND timestamp BETWEEN ? AND ?';
        params.push(filters.startDate, filters.endDate);
      }
      
      if (filters.eventType) {
        query += ' AND event_type = ?';
        params.push(filters.eventType);
      }
      
      if (filters.userId) {
        query += ' AND user_id = ?';
        params.push(filters.userId);
      }
      
      if (filters.module) {
        query += ' AND module = ?';
        params.push(filters.module);
      }
      
      if (filters.sucursal) {
        query += ' AND sucursal = ?';
        params.push(filters.sucursal);
      }
      
      // Ordenar por fecha descendente
      query += ' ORDER BY timestamp DESC';
      
      // Limitar resultados si se especifica
      if (filters.limit) {
        query += ' LIMIT ?';
        params.push(filters.limit);
      }
      
      // Ejecutar la consulta
      const results = await db.all(query, params);
      
      // Enriquecer los resultados con nombres de usuario
      const enrichedResults = await this.enrichLogsWithUsernames(results);
      
      return enrichedResults;
    } catch (error) {
      logger.error('Error al obtener datos de auditoría', { error: error.message, stack: error.stack });
      throw new Error(`Error al obtener datos de auditoría: ${error.message}`);
    }
  }
  
  /**
   * Enriquece los registros de auditoría con nombres de usuario
   * @param {Array} logs - Registros de auditoría
   * @returns {Promise<Array>} - Registros enriquecidos
   */
  async enrichLogsWithUsernames(logs) {
    try {
      const db = await getDatabase();
      const userMap = new Map();
      
      // Obtener IDs de usuario únicos
      const userIds = [...new Set(logs.map(log => log.user_id))];
      
      // Consultar nombres de usuario
      for (const userId of userIds) {
        const user = await db.get('SELECT username, nombre, apellido FROM usuarios WHERE id = ?', [userId]);
        if (user) {
          userMap.set(userId, {
            username: user.username,
            fullName: `${user.nombre} ${user.apellido}`.trim()
          });
        }
      }
      
      // Enriquecer los logs con nombres de usuario
      return logs.map(log => ({
        ...log,
        username: userMap.get(log.user_id)?.username || 'Usuario desconocido',
        userFullName: userMap.get(log.user_id)?.fullName || 'Usuario desconocido'
      }));
    } catch (error) {
      logger.error('Error al enriquecer logs con nombres de usuario', { error: error.message });
      return logs; // Devolver logs originales si hay error
    }
  }

  /**
   * Genera un informe PDF de los eventos de auditoría
   * @param {Object} data - Datos y configuración para el informe
   * @returns {Promise<string>} - Ruta al archivo PDF generado
   */
  async generatePDFReport(data) {
    try {
      const companyInfo = await getCompanyInfo();
      const reportTitle = data.title || 'Informe de Auditoría';
      const currentDate = moment().format('YYYY-MM-DD_HH-mm-ss');
      const fileName = `auditoria_${currentDate}.pdf`;
      const outputPath = path.join(getReportDirectory(), fileName);
      
      // Crear documento PDF
      const doc = new PDFDocument({ margin: 50 });
      const stream = fs.createWriteStream(outputPath);
      
      doc.pipe(stream);
      
      // Encabezado con logo e información de la empresa
      if (companyInfo.logoPath && fs.existsSync(companyInfo.logoPath)) {
        doc.image(companyInfo.logoPath, 50, 45, { width: 100 });
        doc.moveDown();
      }
      
      doc.fontSize(20).text(reportTitle, { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Empresa: ${companyInfo.nombre}`);
      doc.fontSize(12).text(`Fecha de generación: ${moment().format('DD/MM/YYYY HH:mm:ss')}`);
      doc.moveDown();
      
      // Información de filtros aplicados
      doc.fontSize(14).text('Filtros aplicados', { underline: true });
      if (data.filters) {
        if (data.filters.startDate && data.filters.endDate) {
          doc.fontSize(10).text(`Período: ${moment(data.filters.startDate).format('DD/MM/YYYY')} - ${moment(data.filters.endDate).format('DD/MM/YYYY')}`);
        }
        if (data.filters.eventType) {
          doc.fontSize(10).text(`Tipo de evento: ${data.filters.eventType}`);
        }
        if (data.filters.userId) {
          doc.fontSize(10).text(`Usuario: ${data.filters.userId}`);
        }
        if (data.filters.module) {
          doc.fontSize(10).text(`Módulo: ${data.filters.module}`);
        }
        if (data.filters.sucursal) {
          doc.fontSize(10).text(`Sucursal: ${data.filters.sucursal}`);
        }
      }
      doc.moveDown();
      
      // Tabla de eventos
      const tableTop = 200;
      const tableHeaders = ['Fecha', 'Usuario', 'Tipo', 'Módulo', 'Descripción'];
      const tableColumnWidths = [80, 80, 70, 70, 200];
      
      // Dibujar encabezado de tabla
      doc.fontSize(10).font('Helvetica-Bold');
      let xPos = 50;
      
      tableHeaders.forEach((header, i) => {
        doc.text(header, xPos, tableTop);
        xPos += tableColumnWidths[i];
      });
      
      // Dibujar línea horizontal después del encabezado
      doc.moveTo(50, tableTop + 15)
         .lineTo(550, tableTop + 15)
         .stroke();
      
      // Dibujar datos de la tabla
      let yPos = tableTop + 25;
      doc.font('Helvetica');
      
      for (const event of data.events) {
        // Si yPos está cerca del final de la página, crear una nueva página
        if (yPos > 700) {
          doc.addPage();
          yPos = 50;
          
          // Repetir encabezado en la nueva página
          xPos = 50;
          doc.fontSize(10).font('Helvetica-Bold');
          tableHeaders.forEach((header, i) => {
            doc.text(header, xPos, yPos);
            xPos += tableColumnWidths[i];
          });
          
          doc.moveTo(50, yPos + 15)
             .lineTo(550, yPos + 15)
             .stroke();
          
          yPos += 25;
          doc.font('Helvetica');
        }
        
        xPos = 50;
        
        // Fecha formateada
        doc.text(moment(event.timestamp).format('DD/MM/YYYY HH:mm'), xPos, yPos, { width: tableColumnWidths[0] });
        xPos += tableColumnWidths[0];
        
        // Usuario
        doc.text(event.username || 'N/A', xPos, yPos, { width: tableColumnWidths[1] });
        xPos += tableColumnWidths[1];
        
        // Tipo de evento
        doc.text(event.event_type || 'N/A', xPos, yPos, { width: tableColumnWidths[2] });
        xPos += tableColumnWidths[2];
        
        // Módulo
        doc.text(event.module || 'N/A', xPos, yPos, { width: tableColumnWidths[3] });
        xPos += tableColumnWidths[3];
        
        // Descripción (limitar longitud para que no desborde)
        const description = event.description || 'N/A';
        doc.text(description.length > 100 ? description.substring(0, 97) + '...' : description, xPos, yPos, { width: tableColumnWidths[4] });
        
        yPos += 20;
      }
      
      // Pie de página
      doc.fontSize(8).text(`Este reporte fue generado automáticamente por FactuSystem el ${moment().format('DD/MM/YYYY HH:mm:ss')}`, 50, doc.page.height - 50, { align: 'center' });
      
      // Finalizar documento
      doc.end();
      
      return new Promise((resolve, reject) => {
        stream.on('finish', () => resolve(outputPath));
        stream.on('error', reject);
      });
    } catch (error) {
      logger.error('Error al generar informe PDF de auditoría', { error: error.message, stack: error.stack });
      throw new Error(`Error al generar informe PDF: ${error.message}`);
    }
  }

  /**
   * Genera un informe Excel de los eventos de auditoría
   * @param {Object} data - Datos y configuración para el informe
   * @returns {Promise<string>} - Ruta al archivo Excel generado
   */
  async generateExcelReport(data) {
    try {
      const companyInfo = await getCompanyInfo();
      const currentDate = moment().format('YYYY-MM-DD_HH-mm-ss');
      const fileName = `auditoria_${currentDate}.xlsx`;
      const outputPath = path.join(getReportDirectory(), fileName);
      
      // Crear workbook y worksheet
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'FactuSystem';
      workbook.lastModifiedBy = data.generatedBy || 'Sistema';
      workbook.created = new Date();
      workbook.modified = new Date();
      
      const worksheet = workbook.addWorksheet('Auditoría', {
        properties: { tabColor: { argb: '6495ED' } }
      });
      
      // Estilos
      const headerStyle = {
        font: { bold: true, color: { argb: 'FFFFFF' } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: '4F81BD' } },
        alignment: { horizontal: 'center', vertical: 'middle' }
      };
      
      // Información de la empresa y reporte
      worksheet.mergeCells('A1:F1');
      worksheet.getCell('A1').value = 'INFORME DE AUDITORÍA';
      worksheet.getCell('A1').font = { size: 16, bold: true };
      worksheet.getCell('A1').alignment = { horizontal: 'center' };
      
      worksheet.mergeCells('A2:F2');
      worksheet.getCell('A2').value = companyInfo.nombre;
      worksheet.getCell('A2').font = { size: 12, bold: true };
      worksheet.getCell('A2').alignment = { horizontal: 'center' };
      
      worksheet.mergeCells('A3:F3');
      worksheet.getCell('A3').value = `Generado el: ${moment().format('DD/MM/YYYY HH:mm:ss')}`;
      worksheet.getCell('A3').alignment = { horizontal: 'center' };
      
      // Información de filtros
      worksheet.getCell('A5').value = 'Filtros aplicados:';
      worksheet.getCell('A5').font = { bold: true };
      
      let filterRow = 6;
      if (data.filters) {
        if (data.filters.startDate && data.filters.endDate) {
          worksheet.getCell(`A${filterRow}`).value = `Período: ${moment(data.filters.startDate).format('DD/MM/YYYY')} - ${moment(data.filters.endDate).format('DD/MM/YYYY')}`;
          filterRow++;
        }
        if (data.filters.eventType) {
          worksheet.getCell(`A${filterRow}`).value = `Tipo de evento: ${data.filters.eventType}`;
          filterRow++;
        }
        if (data.filters.userId) {
          worksheet.getCell(`A${filterRow}`).value = `Usuario: ${data.filters.userId}`;
          filterRow++;
        }
        if (data.filters.module) {
          worksheet.getCell(`A${filterRow}`).value = `Módulo: ${data.filters.module}`;
          filterRow++;
        }
        if (data.filters.sucursal) {
          worksheet.getCell(`A${filterRow}`).value = `Sucursal: ${data.filters.sucursal}`;
          filterRow++;
        }
      }
      
      // Encabezados de tabla
      const tableStartRow = filterRow + 2;
      worksheet.getRow(tableStartRow).values = [
        'ID', 'Fecha', 'Usuario', 'Tipo de Evento', 'Módulo', 'Acción', 'Descripción', 'IP', 'Sucursal', 'Detalles'
      ];
      
      // Aplicar estilos a los encabezados
      for (let col = 1; col <= 10; col++) {
        const cell = worksheet.getCell(tableStartRow, col);
        Object.assign(cell, headerStyle);
      }
      
      // Datos de la tabla
      let rowIndex = tableStartRow + 1;
      for (const event of data.events) {
        worksheet.getRow(rowIndex).values = [
          event.id,
          moment(event.timestamp).format('DD/MM/YYYY HH:mm:ss'),
          event.username || 'N/A',
          event.event_type || 'N/A',
          event.module || 'N/A',
          event.action || 'N/A',
          event.description || 'N/A',
          event.ip_address || 'N/A',
          event.sucursal || 'N/A',
          event.details || 'N/A'
        ];
        
        rowIndex++;
      }
      
      // Ajustar anchos de columna
      worksheet.columns.forEach((column, index) => {
        let maxLength = 0;
        column.eachCell({ includeEmpty: true }, (cell, rowNumber) => {
          if (rowNumber >= tableStartRow) {
            const columnLength = cell.value ? cell.value.toString().length : 10;
            if (columnLength > maxLength) {
              maxLength = columnLength;
            }
          }
        });
        column.width = maxLength < 10 ? 10 : maxLength + 2;
      });
      
      // Guardar archivo
      await workbook.xlsx.writeFile(outputPath);
      return outputPath;
    } catch (error) {
      logger.error('Error al generar informe Excel de auditoría', { error: error.message, stack: error.stack });
      throw new Error(`Error al generar informe Excel: ${error.message}`);
    }
  }

  /**
   * Obtiene la actividad de un usuario específico
   * @param {number} userId - ID del usuario
   * @returns {Promise<Array>} - Eventos del usuario
   */
  async getUserActivity(userId) {
    try {
      return await this.getAuditData({ userId });
    } catch (error) {
      logger.error('Error al obtener actividad del usuario', { userId, error: error.message });
      throw new Error(`Error al obtener actividad del usuario: ${error.message}`);
    }
  }

  /**
   * Obtiene eventos de seguridad (login, cambios de permisos, etc.)
   * @param {Object} filters - Filtros para la consulta
   * @returns {Promise<Array>} - Eventos de seguridad
   */
  async getSecurityEvents(filters = {}) {
    try {
      return await this.getAuditData({
        ...filters,
        eventType: 'security'
      });
    } catch (error) {
      logger.error('Error al obtener eventos de seguridad', { error: error.message });
      throw new Error(`Error al obtener eventos de seguridad: ${error.message}`);
    }
  }
  
  /**
   * Genera un informe de actividad por módulo
   * @param {string} module - Nombre del módulo
   * @param {Object} filters - Filtros adicionales
   * @returns {Promise<Object>} - Estadísticas de uso del módulo
   */
  async getModuleUsageReport(module, filters = {}) {
    try {
      const events = await this.getAuditData({
        ...filters,
        module
      });
      
      // Agrupar eventos por tipo
      const eventsByType = {};
      const userActivity = {};
      
      events.forEach(event => {
        // Contar por tipo de evento
        if (!eventsByType[event.event_type]) {
          eventsByType[event.event_type] = 0;
        }
        eventsByType[event.event_type]++;
        
        // Contar por usuario
        if (!userActivity[event.user_id]) {
          userActivity[event.user_id] = {
            userId: event.user_id,
            username: event.username || 'Usuario desconocido',
            userFullName: event.userFullName || 'Usuario desconocido',
            count: 0
          };
        }
        userActivity[event.user_id].count++;
      });
      
      // Convertir a arrays para ordenar
      const eventTypes = Object.entries(eventsByType).map(([type, count]) => ({ type, count }));
      const users = Object.values(userActivity).sort((a, b) => b.count - a.count);
      
      return {
        module,
        totalEvents: events.length,
        eventTypes,
        topUsers: users.slice(0, 5), // Top 5 usuarios más activos
        timeRange: {
          start: filters.startDate || 'Inicio',
          end: filters.endDate || 'Fin'
        }
      };
    } catch (error) {
      logger.error('Error al generar informe de uso por módulo', { module, error: error.message });
      throw new Error(`Error al generar informe de uso por módulo: ${error.message}`);
    }
  }
  
  /**
   * Obtiene estadísticas generales del sistema
   * @param {Object} filters - Filtros para las estadísticas
   * @returns {Promise<Object>} - Estadísticas del sistema
   */
  async getSystemStatistics(filters = {}) {
    try {
      const db = await getDatabase();
      
      // Rango de fechas para las consultas
      let dateFilter = '';
      const params = [];
      
      if (filters.startDate && filters.endDate) {
        dateFilter = ' AND timestamp BETWEEN ? AND ?';
        params.push(filters.startDate, filters.endDate);
      }
      
      // Contar eventos por tipo
      const eventTypesQuery = `
        SELECT event_type, COUNT(*) as count 
        FROM audit_logs 
        WHERE 1=1${dateFilter}
        GROUP BY event_type 
        ORDER BY count DESC
      `;
      const eventTypes = await db.all(eventTypesQuery, params);
      
      // Contar eventos por módulo
      const modulesQuery = `
        SELECT module, COUNT(*) as count 
        FROM audit_logs 
        WHERE module IS NOT NULL${dateFilter}
        GROUP BY module 
        ORDER BY count DESC
      `;
      const modules = await db.all(modulesQuery, params);
      
      // Contar eventos por usuario
      const usersQuery = `
        SELECT user_id, COUNT(*) as count 
        FROM audit_logs 
        WHERE 1=1${dateFilter}
        GROUP BY user_id 
        ORDER BY count DESC 
        LIMIT 10
      `;
      const userCounts = await db.all(usersQuery, params);
      
      // Enriquecer datos de usuario
      const usersWithNames = [];
      for (const user of userCounts) {
        const userData = await db.get('SELECT username, nombre, apellido FROM usuarios WHERE id = ?', [user.user_id]);
        usersWithNames.push({
          userId: user.user_id,
          username: userData ? userData.username : 'Usuario desconocido',
          fullName: userData ? `${userData.nombre} ${userData.apellido}`.trim() : 'Usuario desconocido',
          count: user.count
        });
      }
      
      // Contar eventos por sucursal
      const sucursalesQuery = `
        SELECT sucursal, COUNT(*) as count 
        FROM audit_logs 
        WHERE sucursal IS NOT NULL${dateFilter}
        GROUP BY sucursal 
        ORDER BY count DESC
      `;
      const sucursales = await db.all(sucursalesQuery, params);
      
      // Total de eventos
      const totalQuery = `
        SELECT COUNT(*) as total FROM audit_logs WHERE 1=1${dateFilter}
      `;
      const { total } = await db.get(totalQuery, params);
      
      // Eventos por día (para gráficos de actividad)
      const activityByDayQuery = `
        SELECT 
          date(timestamp) as day, 
          COUNT(*) as count 
        FROM audit_logs 
        WHERE 1=1${dateFilter}
        GROUP BY date(timestamp) 
        ORDER BY day
      `;
      const activityByDay = await db.all(activityByDayQuery, params);
      
      return {
        total,
        eventTypes,
        modules,
        topUsers: usersWithNames,
        sucursales,
        activityByDay
      };
    } catch (error) {
      logger.error('Error al obtener estadísticas del sistema', { error: error.message });
      throw new Error(`Error al obtener estadísticas del sistema: ${error.message}`);
    }
  }
}

/**
 * Obtiene el directorio para guardar los informes
 * @returns {string} - Ruta al directorio de informes
 */
function getReportDirectory() {
  const userDataPath = process.env.APPDATA || (
    process.platform === 'darwin' 
      ? process.env.HOME + '/Library/Application Support' 
      : process.env.HOME + "/.local/share"
  );
  
  const reportDir = path.join(userDataPath, 'FactuSystem', 'reports');
  
  // Crear directorio si no existe
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }
  
  return reportDir;
}

// Exportar una instancia única para todo el sistema
const auditReporter = new AuditReporter();
module.exports = auditReporter;