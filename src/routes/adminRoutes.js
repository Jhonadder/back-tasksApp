// src/routes/adminRoutes.js
const express = require('express');
const auth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');
const {
  getSummary,
  getCalendar,
  getTasksByDate,
  getTasksByStatus,
  sendTasksStatusReportEmail
} = require('../controllers/adminController');

const router = express.Router();

// Todas las rutas de admin requieren estar logueado y ser ADMIN
router.use(auth);
router.use(requireAdmin);

// GET /api/admin/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/summary', getSummary);

// GET /api/admin/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/calendar', getCalendar);

// GET /api/admin/tasks-by-date?date=YYYY-MM-DD
router.get('/tasks-by-date', getTasksByDate);

// GET /api/admin/tasks-by-status?status=PENDING&from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/tasks-by-status', getTasksByStatus);

// 👉 nuevo: enviar reporte por mail
router.post('/tasks-by-status/send-email', sendTasksStatusReportEmail);

module.exports = router;
