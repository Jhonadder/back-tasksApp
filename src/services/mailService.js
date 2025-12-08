// src/services/mailService.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: false, // true si usás 465
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});
//funcion envia mail a usuario asignado
async function sendTaskAssignedEmail({ toEmail, toName, task, assignedBy }) {
  if (!toEmail) return;

  // Deep link a la app (expo / producción)
  const appDeepLink = `${process.env.APP_DEEP_LINK_SCHEME || 'mytaskapp'}://task/${task.Id}`;

  // Link web opcional (si algún día tenés un front web)
  const webBaseUrl = process.env.APP_WEB_URL || 'https://example.com';
  const webLink = `${webBaseUrl}/task/${task.Id}`;

  const subject = `Nueva tarea asignada: ${task.Title}`;

  const html = `
  <div style="font-family: Arial, sans-serif; background-color:#f3f4f6; padding:20px;">
    <div style="max-width:600px; margin:0 auto; background-color:#ffffff; border-radius:8px; padding:20px; border:1px solid #e5e7eb;">
      <h2 style="color:#111827; margin-top:0;">Tienes una nueva tarea asignada</h2>
      <p style="color:#374151;">Hola <strong>${toName || ''}</strong>,</p>
      <p style="color:#374151;">
        <strong>${assignedBy?.Name || 'Un usuario'}</strong> te asignó la siguiente tarea:
      </p>

      <div style="background-color:#f9fafb; border-radius:6px; padding:12px; border:1px solid #e5e7eb; margin:16px 0;">
        <p style="margin:4px 0;"><strong>Título:</strong> ${task.Title}</p>
        ${task.Description ? `<p style="margin:4px 0;"><strong>Descripción:</strong> ${task.Description}</p>` : ''}
        ${task.Priority ? `<p style="margin:4px 0;"><strong>Prioridad:</strong> ${task.Priority}</p>` : ''}
        ${task.DueDate ? `<p style="margin:4px 0;"><strong>Fecha límite:</strong> ${new Date(task.DueDate).toLocaleString('es-AR')}</p>` : ''}
      </div>

      <p style="color:#374151;">Podés ver los detalles y actualizar el estado desde la aplicación:</p>

      <div style="text-align:center; margin:20px 0;">
        <a href="${appDeepLink}"
           style="display:inline-block; background-color:#4f46e5; color:#ffffff; padding:12px 24px; border-radius:999px; text-decoration:none; font-weight:600;">
          Abrir tarea en la app
        </a>
      </div>

      <p style="color:#6b7280; font-size:12px; margin-top:20px;">
        Si el botón no funciona, copiá y pegá este enlace en tu dispositivo:
        <br/>
        <span style="color:#4b5563;">${appDeepLink}</span>
      </p>

      <p style="color:#9ca3af; font-size:11px; margin-top:12px; border-top:1px solid #e5e7eb; padding-top:8px;">
        Este es un mensaje automático. Por favor, no respondas a este correo.
      </p>
    </div>
  </div>
  `;

  await transporter.sendMail({
    from: process.env.MAIL_FROM || `"Task Daily" <no-reply@example.com>`,
    to: toEmail,
    subject,
    html
  });
}

function buildDueTasksHtml(userName, tasksForToday) {
  const rows = tasksForToday.map(t => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${t.Title}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${t.DueDateFormatted}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${t.Priority || '-'}</td>
    </tr>
  `).join('');

  return `
  <div style="font-family:system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color:#111827;">
    <h2 style="color:#111827;">⏰ Recordatorio de tareas con vencimiento hoy</h2>
    <p>Hola ${userName || ''},</p>
    <p>Estas son tus tareas que <strong>vencen hoy</strong>:</p>
    <table style="border-collapse:collapse;width:100%;margin-top:10px;">
      <thead>
        <tr style="background:#f3f4f6;">
          <th style="padding:8px;text-align:left;">Tarea</th>
          <th style="padding:8px;text-align:left;">Vence</th>
          <th style="padding:8px;text-align:left;">Prioridad</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
    <p style="margin-top:16px;">Abrí la app para ver el detalle y marcar el progreso ✔</p>
  </div>
  `;
}
//funcion envia mail a usuario si vence hoy
async function sendDueTasksEmail(to, userName, tasksForToday) {
  if (!to || tasksForToday.length === 0) return;

  const html = buildDueTasksHtml(userName, tasksForToday);

  await transporter.sendMail({
    from: process.env.MAIL_FROM || 'tareas@tuapp.com',
    to,
    subject: '⏰ Tareas que vencen hoy',
    html
  });
}
module.exports = {
  sendTaskAssignedEmail,
  sendDueTasksEmail 
};
