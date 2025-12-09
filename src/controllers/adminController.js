// src/controllers/adminController.js
const { query } = require('mssql');
const { getPool, sql } = require('../config/db');
const { sendStatusReportEmail } = require('../services/mailService');
// Helper: parsear fecha YYYY-MM-DD a Date
function parseDateOnly(str) {
  if (!str) return null;
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// GET /api/admin/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
async function getSummary(req, res) {
  try {
    const pool = await getPool();

    const { from, to } = req.query;

    // Rango por defecto: últimos 30 días
    const now = new Date();
    const defaultTo = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const defaultFrom = new Date(defaultTo.getTime() - 30 * 24 * 60 * 60 * 1000);

    const fromDate = parseDateOnly(from) || defaultFrom;
    const toDate = parseDateOnly(to) || defaultTo;

    const result = await pool.request()
      .input('From', sql.DateTime2, fromDate)
      .input('To', sql.DateTime2, toDate)
      .query(`
        SELECT
          COUNT(*) AS Total,
          SUM(CASE WHEN UPPER(Status) IN ('PENDING','PENDIENTE') THEN 1 ELSE 0 END) AS PendingCount,
          SUM(CASE WHEN UPPER(Status) IN ('IN_PROGRESS','EN_PROGRESO') THEN 1 ELSE 0 END) AS InProgressCount,
          SUM(CASE WHEN UPPER(Status) IN ('DONE','FINALIZADO') THEN 1 ELSE 0 END) AS DoneCount,
          SUM(CASE WHEN Priority = 'ALTA'  THEN 1 ELSE 0 END) AS HighPriorityCount,
          SUM(CASE WHEN Priority = 'MEDIA' THEN 1 ELSE 0 END) AS MediumPriorityCount,
          SUM(CASE WHEN Priority = 'BAJA'  THEN 1 ELSE 0 END) AS LowPriorityCount,
          SUM(CASE WHEN DueDate IS NOT NULL THEN 1 ELSE 0 END) AS WithDueDateCount
        FROM Tasks
        WHERE CreatedAt >= @From AND CreatedAt < @To;
      `);

    const row = result.recordset[0] || {};

    res.json({
      range: {
        from: fromDate,
        to: toDate
      },
      status: {
        pending: row.PendingCount || 0,
        inProgress: row.InProgressCount || 0,
        done: row.DoneCount || 0
      },
      priority: {
        high: row.HighPriorityCount || 0,
        medium: row.MediumPriorityCount || 0,
        low: row.LowPriorityCount || 0
      },
      totals: {
        totalTasks: row.Total || 0,
        tasksWithDueDate: row.WithDueDateCount || 0
      }
    });
  } catch (err) {
    console.error('Error getSummary', err);
    res.status(500).json({ message: 'Error obteniendo resumen' });
  }
}

// GET /api/admin/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD
async function getCalendar(req, res) {
  try {
    const pool = await getPool();
    const { from, to } = req.query;

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const fromDate = parseDateOnly(from) || monthStart;
    const toDate = parseDateOnly(to) || monthEnd;

    const result = await pool.request()
      .input('From', sql.DateTime2, fromDate)
      .input('To', sql.DateTime2, toDate)
      .query(`
        SELECT
          CONVERT(date, DueDate) AS DueDate,
          COUNT(*) AS TaskCount
        FROM Tasks
        WHERE DueDate IS NOT NULL
          AND DueDate >= @From
          AND DueDate < @To
        GROUP BY CONVERT(date, DueDate)
        ORDER BY CONVERT(date, DueDate);
      `);

    const data = result.recordset.map(r => ({
      date: r.DueDate.toISOString().slice(0, 10), // YYYY-MM-DD
      count: r.TaskCount
    }));

    res.json({ items: data });
  } catch (err) {
    console.error('Error getCalendar', err);
    res.status(500).json({ message: 'Error obteniendo datos de calendario' });
  }
}

// GET /api/admin/tasks-by-date?date=YYYY-MM-DD
async function getTasksByDate(req, res) {
  try {
    const { date } = req.query; // formato esperado: YYYY-MM-DD

    if (!date) {
      return res.status(400).json({ message: 'Parámetro "date" requerido (YYYY-MM-DD)' });
    }

    const pool = await getPool();

    const result = await pool.request()
      // usamos tipo DATE, solo día/mes/año
      .input('Date', sql.Date, date)
      .query(`
        SELECT
          t.Id,
          t.Title,
          t.Description,
          t.Status,
          t.Priority,
          t.CreatedAt,
          t.DueDate,
          u.Name AS AssignedToName
        FROM Tasks t
        LEFT JOIN Users u ON t.AssignedToUserId = u.Id
        WHERE
          CONVERT(date, t.DueDate) = @Date
        ORDER BY
          t.Priority DESC,
          t.CreatedAt ASC
      `);

    console.log('[TASKS-BY-DATE]', {
      date,
      count: result.recordset.length
    });

    return res.json(result.recordset);
  } catch (err) {
    console.error('Error en getTasksByDate', err);
    return res.status(500).json({ message: 'Error al obtener tareas del día' });
  }
}

// GET /api/admin/tasks-by-status?status=PENDING&from=YYYY-MM-DD&to=YYYY-MM-DD
async function getTasksByStatus(req, res) {
  try {
    const pool = await getPool();
    const { status, from, to } = req.query;

    if (!status) {
      return res
        .status(400)
        .json({ message: 'status es requerido (PENDING | IN_PROGRESS | DONE)' });
    }

    const now = new Date();
    const defaultTo = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const defaultFrom = new Date(defaultTo.getTime() - 30 * 24 * 60 * 60 * 1000);

    const fromDate = parseDateOnly(from) || defaultFrom;
    const toDate = parseDateOnly(to) || defaultTo;

    const upperStatus = status.toUpperCase();

    const result = await pool.request()
      .input('From', sql.DateTime2, fromDate)
      .input('To', sql.DateTime2, toDate)
      .input('Status', sql.NVarChar, upperStatus)
      .query(`
        SELECT
          t.Id,
          t.Title,
          t.Description,
          t.Status,
          t.Priority,
          t.CreatedAt,
          t.DueDate,
          u.Name AS AssignedToName,
          u.Email AS AssignedToEmail
        FROM Tasks t
        LEFT JOIN Users u ON t.AssignedToUserId = u.Id
        WHERE
          t.CreatedAt >= @From AND t.CreatedAt < @To
          AND (
            (@Status = 'PENDING' AND UPPER(t.Status) IN ('PENDING', 'PENDIENTE')) OR
            (@Status = 'IN_PROGRESS' AND UPPER(t.Status) IN ('IN_PROGRESS', 'EN_PROGRESO')) OR
            (@Status = 'DONE' AND UPPER(t.Status) IN ('DONE', 'FINALIZADO'))
          )
        ORDER BY t.CreatedAt DESC;
      `);

    res.json(result.recordset);
  } catch (err) {
    console.error('Error getTasksByStatus', err);
    res.status(500).json({ message: 'Error obteniendo tareas por estado' });
  }
}

// POST /api/admin/tasks-by-status/send-email
async function sendTasksStatusReportEmail(req, res) {
  try {
    const { status, from, to, toEmail } = req.body;
    if (!status || !toEmail) {
      return res.status(400).json({ message: 'status y toEmail son requeridos' });
    }

    const now = new Date();
    const defaultTo = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const defaultFrom = new Date(defaultTo.getTime() - 30 * 24 * 60 * 60 * 1000);

    const fromDate = parseDateOnly(from) || defaultFrom;
    const toDate = parseDateOnly(to) || defaultTo;

    const upperStatus = status.toUpperCase();

    const pool = await getPool();
    const result = await pool.request()
      .input('From', sql.DateTime2, fromDate)
      .input('To', sql.DateTime2, toDate)
      .input('Status', sql.NVarChar, upperStatus)
      .query(`
        SELECT
          t.Id,
          t.Title,
          t.Status,
          t.Priority,
          t.DueDate,
          u.Name AS AssignedToName
        FROM Tasks t
        LEFT JOIN Users u ON t.AssignedToUserId = u.Id
        WHERE
          t.CreatedAt >= @From AND t.CreatedAt < @To
          AND (
            (@Status = 'PENDING' AND UPPER(t.Status) IN ('PENDING', 'PENDIENTE')) OR
            (@Status = 'IN_PROGRESS' AND UPPER(t.Status) IN ('IN_PROGRESS', 'EN_PROGRESO')) OR
            (@Status = 'DONE' AND UPPER(t.Status) IN ('DONE', 'FINALIZADO'))
          )
        ORDER BY t.CreatedAt DESC;
      `);

    const tasks = result.recordset || [];

    const statusLabel =
      upperStatus === 'PENDING'
        ? 'Pendientes'
        : upperStatus === 'IN_PROGRESS'
        ? 'En progreso'
        : upperStatus === 'DONE'
        ? 'Finalizadas'
        : upperStatus;

    const userName = req.user?.name || req.user?.Name || 'Usuario';

    await sendStatusReportEmail(toEmail.trim(), userName, statusLabel, tasks, fromDate, toDate);

    res.json({ message: 'Reporte enviado correctamente' });
  } catch (err) {
    console.error('Error sendTasksStatusReportEmail', err);
    res.status(500).json({ message: 'Error enviando el reporte por mail' });
  }
}
module.exports = {
  getSummary,
  getCalendar,
  getTasksByDate,
  getTasksByStatus,   // 👈 asegurate de exportarlo
  sendTasksStatusReportEmail
};