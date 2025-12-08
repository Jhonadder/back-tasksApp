// src/routes/adminRoutes.js
const express = require('express');
const auth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');
const { getSummary, getTasksForCalendar } = require('../controllers/adminController');

const router = express.Router();

// Todas las rutas de admin requieren estar logueado y ser ADMIN
router.use(auth);
router.use(requireAdmin);

// GET /api/admin/summary
router.get('/summary', getSummary);

// GET /api/admin/tasks/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/tasks/calendar', getTasksForCalendar);

module.exports = router;
