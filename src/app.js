// src/app.js
const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
//para cron de envio mail x vencimiento
const cron = require('node-cron');
const { getPool, sql } = require('./config/db');
const { sendDueTasksEmail } = require('./services/mailService');
//rutas
const authRoutes = require('./routes/authRoutes');
const taskRoutes = require('./routes/taskRoutes');
const adminRoutes = require('./routes/adminRoutes'); // <--- NUEVO

const app = express();

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/auth', authRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/admin', adminRoutes); // <--- NUEVO

// Endpoint simple de health-check
app.get('/api/health', async (req, res) => {
  try {
    // opcional: testear conexión a la DB
    // const pool = await getPool();
    // await pool.request().query('SELECT 1 AS ok');

    res.json({
      status: 'ok',
      message: 'API activa',
      time: new Date().toISOString()
    });
    console.log('respuesta Server Activo');
    
  } catch (err) {
    console.error('[HEALTH] Error', err);
    res.status(500).json({ status: 'error', message: 'API o DB no disponible' });
  }
});

app.get('/', (req, res) => {
    res.send('Task App API funcionando');
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`Servidor escuchando en puerto ${PORT}`);
});

//
// Todos los días a las 9am hora del servidor
cron.schedule('* 9 * * *', async () => {
    console.log('[CRON] Buscando tareas que vencen hoy...');

    try {
        const pool = await getPool();
        {
            timezone: 'America/Argentina/Buenos_Aires'
        }
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

        const result = await pool.request()
            .input('Start', sql.DateTime2, start)
            .input('End', sql.DateTime2, end)
            .query(`
        SELECT
          t.Id,
          t.Title,
          t.DueDate,
          t.Priority,
          t.Status,
          u.Email,
          u.Name AS UserName
        FROM Tasks t
        JOIN Users u ON t.AssignedToUserId = u.Id
        WHERE
          t.DueDate >= @Start
          AND t.DueDate < @End
          AND (UPPER(t.Status) <> 'DONE' AND UPPER(t.Status) <> 'FINALIZADO')
      `);

        if (result.recordset.length === 0) {
            console.log('[CRON] No hay tareas que venzan hoy.');
            return;
        }

        // agrupar por usuario
        const byUser = {};
        result.recordset.forEach(row => {
            const email = row.Email;
            if (!email) return;
            if (!byUser[email]) {
                byUser[email] = {
                    name: row.UserName,
                    tasks: []
                };
            }
            byUser[email].tasks.push({
                Title: row.Title,
                DueDateFormatted: row.DueDate.toLocaleString('es-AR'),
                Priority: row.Priority
            });
        });

        for (const [email, data] of Object.entries(byUser)) {
            await sendDueTasksEmail(email, data.name, data.tasks);
            console.log(`[CRON] Email de vencimientos enviado a ${email}`);
        }
    } catch (err) {
        console.error('[CRON] Error al enviar recordatorios de tareas', err);
    }
});