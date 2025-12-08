// src/controllers/adminController.js
const { getPool, sql } = require('../config/db');

// GET /api/admin/summary
// Resumen general para dashboard: por estado, por prioridad, vencidas, etc.
async function getSummary(req, res) {
  try {
    const pool = await getPool();

    // Tareas por estado
    const byStatusResult = await pool.request().query(`
      SELECT Status, COUNT(*) AS Count
      FROM Tasks
      GROUP BY Status;
    `);

    // Tareas por prioridad
    const byPriorityResult = await pool.request().query(`
      SELECT Priority, COUNT(*) AS Count
      FROM Tasks
      GROUP BY Priority;
    `);

    // Vencidas (dueDate < hoy y no finalizada)
    const overdueResult = await pool.request().query(`
      SELECT COUNT(*) AS OverdueCount
      FROM Tasks
      WHERE DueDate IS NOT NULL
        AND DueDate < SYSDATETIME()
        AND Status <> 'FINALIZADA';
    `);

    // Vencen hoy
    const dueTodayResult = await pool.request().query(`
      SELECT COUNT(*) AS DueTodayCount
      FROM Tasks
      WHERE DueDate IS NOT NULL
        AND CONVERT(date, DueDate) = CONVERT(date, SYSDATETIME());
    `);

    // Próximas 7 días
    const next7Result = await pool.request().query(`
      SELECT COUNT(*) AS Next7DaysCount
      FROM Tasks
      WHERE DueDate IS NOT NULL
        AND CONVERT(date, DueDate) > CONVERT(date, SYSDATETIME())
        AND CONVERT(date, DueDate) <= DATEADD(day, 7, CONVERT(date, SYSDATETIME()));
    `);

    res.json({
      byStatus: byStatusResult.recordset,
      byPriority: byPriorityResult.recordset,
      overdue: overdueResult.recordset[0]?.OverdueCount || 0,
      dueToday: dueTodayResult.recordset[0]?.DueTodayCount || 0,
      next7Days: next7Result.recordset[0]?.Next7DaysCount || 0
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error obteniendo resumen admin' });
  }
}

// GET /api/admin/tasks/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD
// Devuelve tareas entre un rango de fechas (por DueDate) para mostrar en calendario
async function getTasksForCalendar(req, res) {
  try {
    const { from, to } = req.query;
    const pool = await getPool();

    // Si no envían parámetros, tomamos de hoy -7 a hoy +30 como ejemplo
    let fromDate = from || null;
    let toDate = to || null;

    const request = pool.request();

    let query = `
      SELECT t.*,
             u1.Name AS CreatedByName,
             u2.Name AS AssignedToName
      FROM Tasks t
      INNER JOIN Users u1 ON t.CreatedByUserId = u1.Id
      LEFT JOIN Users u2 ON t.AssignedToUserId = u2.Id
      WHERE 1=1
    `;

    if (fromDate) {
      request.input('FromDate', sql.Date, fromDate);
      query += ` AND CONVERT(date, t.DueDate) >= @FromDate`;
    }

    if (toDate) {
      request.input('ToDate', sql.Date, toDate);
      query += ` AND CONVERT(date, t.DueDate) <= @ToDate`;
    }

    // Si no hay filtros, igual filtramos por DueDate no nulo
    query += ` AND t.DueDate IS NOT NULL`;

    const result = await request.query(query);

    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error obteniendo tareas para calendario' });
  }
}

module.exports = {
  getSummary,
  getTasksForCalendar
};
