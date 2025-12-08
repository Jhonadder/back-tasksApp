const { getPool, sql } = require('../config/db');
const { sendTaskAssignedEmail } = require('../services/mailService');
const fs = require('fs');
const path = require('path');

async function getTaskById(req, res) {
  try {
    const { id } = req.params;
    const pool = await getPool();

    const taskResult = await pool.request()
      .input('Id', sql.Int, id)
      .query(`
        SELECT t.*,
               uC.Name AS CreatedByName,
               uA.Name AS AssignedToName
        FROM Tasks t
        LEFT JOIN Users uC ON t.CreatedByUserId = uC.Id
        LEFT JOIN Users uA ON t.AssignedToUserId = uA.Id
        WHERE t.Id = @Id;
      `);

    if (taskResult.recordset.length === 0) {
      return res.status(404).json({ message: 'Tarea no encontrada' });
    }

    const task = taskResult.recordset[0];

    const attachResult = await pool.request()
      .input('TaskId', sql.Int, id)
      .query(`
        SELECT Id, FilePath, FileType
        FROM TaskAttachments
        WHERE TaskId = @TaskId;
      `);

    task.Attachments = attachResult.recordset;

    res.json(task);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener tarea' });
  }
}

async function createTask(req, res) {
  try {
    const { title, description, priority, dueDate, assignedToUserId } = req.body;
    const userId = req.user.id;

    const pool = await getPool();

    const result = await pool.request()
      .input('Title', sql.NVarChar, title)
      .input('Description', sql.NVarChar, description || null)
      .input('Priority', sql.NVarChar, priority || 'MEDIA')
      .input('DueDate', sql.DateTime2, dueDate || null)
      .input('CreatedByUserId', sql.Int, userId)
      .input('AssignedToUserId', sql.Int, assignedToUserId ? parseInt(assignedToUserId, 10) : null)
      .query(`
        INSERT INTO Tasks (Title, Description, Priority, DueDate, CreatedByUserId, AssignedToUserId)
        VALUES (@Title, @Description, @Priority, @DueDate, @CreatedByUserId, @AssignedToUserId);
        SELECT SCOPE_IDENTITY() AS Id;
      `);

    const taskId = result.recordset[0].Id;

    // Archivos adjuntos (fotos/videos)
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        await pool.request()
          .input('TaskId', sql.Int, taskId)
          .input('FilePath', sql.NVarChar, file.path)
          .input('FileType', sql.NVarChar, file.mimetype)
          .query(`
            INSERT INTO TaskAttachments (TaskId, FilePath, FileType)
            VALUES (@TaskId, @FilePath, @FileType);
          `);
      }
    }

    // 🔔 Enviar mail si la tarea se asignó a alguien
    if (assignedToUserId) {
      try {
        const assignedResult = await pool.request()
          .input('AssignedId', sql.Int, parseInt(assignedToUserId, 10))
          .query(`SELECT Id, Name, Email FROM Users WHERE Id = @AssignedId`);

        const creatorResult = await pool.request()
          .input('CreatorId', sql.Int, userId)
          .query(`SELECT Id, Name, Email FROM Users WHERE Id = @CreatorId`);

        const assignedUser = assignedResult.recordset[0];
        const creatorUser = creatorResult.recordset[0];

        if (assignedUser && assignedUser.Email) {
          await sendTaskAssignedEmail({
            toEmail: assignedUser.Email,
            toName: assignedUser.Name,
            assignedBy: creatorUser,
            task: {
              Id: taskId,
              Title: title,
              Description: description,
              Priority: priority,
              DueDate: dueDate
            }
          });
        }
      } catch (mailErr) {
        console.error('Error enviando mail de tarea asignada:', mailErr);
        // No rompas la respuesta por mail, solo loguealo
      }
    }

    res.status(201).json({ id: taskId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al crear tarea' });
  }
}

async function getTasks(req, res) {
  try {
    const userId = req.user.id;
    const role = req.user.role;
    const pool = await getPool();

    let query = `
      SELECT t.*, 
             u1.Name AS CreatedByName,
             u2.Name AS AssignedToName
      FROM Tasks t
      INNER JOIN Users u1 ON t.CreatedByUserId = u1.Id
      LEFT JOIN Users u2 ON t.AssignedToUserId = u2.Id
    `;

    if (role !== 'ADMIN') {
      query += `
        WHERE t.Status!='DONE' AND (t.CreatedByUserId = @UserId
           OR t.AssignedToUserId = @UserId)
      `;
    }
    else {
      query += `
        WHERE t.Status!='DONE'
      `;
    }

    const request = pool.request().input('UserId', sql.Int, userId);
    const result = await request.query(query);

    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener tareas' });
  }
}

async function updateTask(req, res) {
  try {
    const { id } = req.params;
    const { title, description, priority, status, dueDate, assignedToUserId, closureNote } = req.body;
    const userId = req.user.id;
    const role = req.user.role;
    const pool = await getPool();

    // Traer la tarea
    const taskResult = await pool.request()
      .input('Id', sql.Int, id)
      .query(`SELECT * FROM Tasks WHERE Id = @Id`);

    if (taskResult.recordset.length === 0) {
      return res.status(404).json({ message: 'Tarea no encontrada' });
    }

    const task = taskResult.recordset[0];

    const isCreator = task.CreatedByUserId === userId;
    const isAssigned = task.AssignedToUserId === userId;

    if (role !== 'ADMIN') {
      if (!isCreator) {
        // Si no es creador y está asignado: solo puede marcar FINALIZADA
        if (!isAssigned) {
          return res.status(403).json({ message: 'No tenés permisos para editar esta tarea' });
        }
        if (status !== 'FINALIZADA') {
          return res.status(403).json({ message: 'Solo podés marcar como FINALIZADA' });
        }
      }
    }

    const oldTaskRes = await pool.request()
      .input('Id', sql.Int, id)
      .query('SELECT * FROM Tasks WHERE Id = @Id');

    const oldTask = oldTaskRes.recordset[0] || null;

    await pool.request()
      .input('Id', sql.Int, id)
      .input('Title', sql.NVarChar, title || task.Title)
      .input('Description', sql.NVarChar, description || task.Description)
      .input('Priority', sql.NVarChar, priority || task.Priority)
      .input('Status', sql.NVarChar, status || task.Status)
      .input('DueDate', sql.DateTime2, dueDate || task.DueDate)
      .input('AssignedToUserId', sql.Int,
        assignedToUserId !== undefined && assignedToUserId !== null
          ? parseInt(assignedToUserId, 10)
          : task.AssignedToUserId
      )
      .input('ClosureNote', sql.NVarChar, closureNote || null) // 👈,
      .query(`
        UPDATE Tasks
        SET Title = @Title,
            Description = @Description,
            Priority = @Priority,
            Status = @Status,
            DueDate = @DueDate,
            AssignedToUserId = @AssignedToUserId,
            ClosureNote = @ClosureNote
        WHERE Id = @Id;
      `);

    await pool.request()
      .input('TaskId', sql.Int, id)
      .input('Action', sql.NVarChar, 'UPDATE')
      .input('PerformedByUserId', sql.Int, userId)
      .input('PerformedAt', sql.DateTime2, new Date())
      .input('OldValues', sql.NVarChar, oldTask ? JSON.stringify({
        Title: oldTask.Title,
        Description: oldTask.Description,
        Priority: oldTask.Priority,
        Status: oldTask.Status,
        DueDate: oldTask.DueDate,
        AssignedToUserId: oldTask.AssignedToUserId,
        ClosureNote: oldTask.ClosureNote
      }) : null)
      .input('NewValues', sql.NVarChar, JSON.stringify({
        Title: title,
        Description: description,
        Priority: priority,
        Status: status,
        DueDate: dueDate,
        AssignedToUserId: assignedToUserId,
        ClosureNote: closureNote
      }))
      .query(`
    INSERT INTO TaskAuditLogs
      (TaskId, Action, PerformedByUserId, PerformedAt, OldValues, NewValues)
    VALUES
      (@TaskId, @Action, @PerformedByUserId, @PerformedAt, @OldValues, @NewValues);
  `);


    res.json({ message: 'Tarea actualizada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al actualizar tarea' });
  }
}

// async function updateTask(req, res) {
//   console(req)
//   try {
//     const { id } = req.params;
//     const {
//       title,
//       description,
//       priority,
//       assignedToUserId,
//       status,
//       dueDate,
//       closureNote   // 👈 nuevo
//     } = req.body;
//     const userId = req.user.id;

//     const pool = await getPool();

//     await pool.request()
//       .input('Id', sql.Int, id)
//       .input('Title', sql.NVarChar, title || null)
//       .input('Description', sql.NVarChar, description || null)
//       .input('Priority', sql.NVarChar, priority || null)
//       .input('AssignedToUserId', sql.Int, assignedToUserId || null)
//       .input('Status', sql.NVarChar, status || null)
//       .input('DueDate', sql.DateTime2, dueDate || null)
//       .input('ClosureNote', sql.NVarChar, closureNote || null) // 👈
//       .query(`
//         UPDATE Tasks
//         SET
//           Title = @Title,
//           Description = @Description,
//           Priority = @Priority,
//           AssignedToUserId = @AssignedToUserId,
//           Status = @Status,
//           DueDate = @DueDate,
//           ClosureNote = @ClosureNote
//         WHERE Id = @Id;
//       `);

//     res.json({ message: 'Tarea actualizada' });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: 'Error al actualizar tarea' });
//   }
// }

async function addComment(req, res) {
  try {
    const { id } = req.params;
    const { text } = req.body;
    const userId = req.user.id;

    const pool = await getPool();

    const result = await pool.request()
      .input('TaskId', sql.Int, id)
      .input('Text', sql.NVarChar, text || null)
      .input('CreatedByUserId', sql.Int, userId)
      .query(`
        INSERT INTO TaskComments (TaskId, CommentText, CreatedAt, UserId)
        VALUES (@TaskId, @Text, SYSDATETIME(), @CreatedByUserId);
        SELECT SCOPE_IDENTITY() AS Id;
      `);

    const commentId = result.recordset[0].Id;

    // Adjuntos del comentario
    let attachments = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const r = await pool.request()
          .input('CommentId', sql.Int, commentId)
          .input('FilePath', sql.NVarChar, file.path)
          .input('FileType', sql.NVarChar, file.mimetype)
          .query(`
            INSERT INTO TaskCommentAttachments (CommentId, FilePath, FileType)
            VALUES (@CommentId, @FilePath, @FileType);
            SELECT SCOPE_IDENTITY() AS Id;
          `);

        attachments.push({
          Id: r.recordset[0].Id,
          FilePath: file.path,
          FileType: file.mimetype
        });
      }
    }

    res.status(201).json({
      Id: commentId,
      TaskId: parseInt(id, 10),
      Text: text || null,
      CreatedByUserId: userId,
      Attachments: attachments
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al agregar comentario' });
  }
}

async function getComments(req, res) {
  try {
    const { id } = req.params;
    const pool = await getPool();

    const commentsResult = await pool.request()
      .input('TaskId', sql.Int, id)
      .query(`
        SELECT c.Id,
               c.TaskId,
               c.CommentText,
               c.CreatedAt,
               c.UserId,
               u.Name AS CreatedByName
        FROM TaskComments c
        LEFT JOIN Users u ON c.UserId = u.Id
        WHERE c.TaskId = @TaskId
        ORDER BY c.CreatedAt DESC;
      `);

    const comments = commentsResult.recordset;

    if (comments.length === 0) {
      return res.json([]);
    }

    const commentIds = comments.map((c) => c.Id).join(',');

    const attachResult = await pool.request()
      .query(`
        SELECT Id, CommentId, FilePath, FileType
        FROM TaskCommentAttachments
        WHERE CommentId IN (${commentIds});
      `);

    const attachments = attachResult.recordset;

    const commentsWithAttach = comments.map((c) => ({
      ...c,
      Attachments: attachments.filter((a) => a.CommentId === c.Id)
    }));

    res.json(commentsWithAttach);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener comentarios' });
  }
}

// NUEVO: listar usuarios para asignar tareas
async function getUsers(req, res) {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT Id, Name
      FROM Users
      ORDER BY Name ASC;
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener usuarios' });
  }
}

async function deleteTask(req, res) {
  try {
    const { id } = req.params;
    const pool = await getPool();

    // 1) Verificar que exista y no esté finalizada
    const taskRes = await pool.request()
      .input('Id', sql.Int, id)
      .query('SELECT Id, Status FROM Tasks WHERE Id = @Id');

    if (taskRes.recordset.length === 0) {
      return res.status(404).json({ message: 'Tarea no encontrada' });
    }

    const oldTaskRes = await pool.request()
      .input('Id', sql.Int, id)
      .query('SELECT * FROM Tasks WHERE Id = @Id');

    const oldTask = oldTaskRes.recordset[0] || null;

    const status = (taskRes.recordset[0].Status || '').toUpperCase();
    if (status === 'DONE' || status === 'FINALIZADO') {
      return res
        .status(400)
        .json({ message: 'No se puede eliminar una tarea finalizada' });
    }
    await pool.request()
      .input('TaskId', sql.Int, id)
      .input('Action', sql.NVarChar, 'DELETE')
      .input('PerformedByUserId', sql.Int, req.user.id)
      .input('PerformedAt', sql.DateTime2, new Date())
      .input('OldValues', sql.NVarChar, JSON.stringify(oldTaskRes.recordset[0]))
      .input('NewValues', sql.NVarChar, null)
      .query(`
    INSERT INTO TaskAuditLogs
      (TaskId, Action, PerformedByUserId, PerformedAt, OldValues, NewValues)
    VALUES
      (@TaskId, @Action, @PerformedByUserId, @PerformedAt, @OldValues, @NewValues);
  `);
    // 2) Obtener paths de adjuntos de la tarea
    const attachRes = await pool.request()
      .input('TaskId', sql.Int, id)
      .query('SELECT FilePath FROM TaskAttachments WHERE TaskId = @TaskId');

    // 3) Obtener paths de adjuntos de comentarios
    const commentAttachRes = await pool.request()
      .input('TaskId', sql.Int, id)
      .query(`
        SELECT a.FilePath
        FROM TaskCommentAttachments a
        JOIN TaskComments c ON a.CommentId = c.Id
        WHERE c.TaskId = @TaskId;
      `);

    const filePaths = [
      ...attachRes.recordset.map(r => r.FilePath),
      ...commentAttachRes.recordset.map(r => r.FilePath)
    ];

    // 4) Borrar registros relacionados en DB
    await pool.request()
      .input('TaskId', sql.Int, id)
      .query(`
        DELETE a
        FROM TaskCommentAttachments a
        JOIN TaskComments c ON a.CommentId = c.Id
        WHERE c.TaskId = @TaskId;

        DELETE FROM TaskComments WHERE TaskId = @TaskId;
        DELETE FROM TaskAttachments WHERE TaskId = @TaskId;
        DELETE FROM Tasks WHERE Id = @TaskId;
      `);

    // 5) Borrar archivos del disco (ignorar errores si no existen)
    filePaths.forEach(fp => {
      if (!fp) return;
      fs.unlink(fp, (err) => {
        if (err) {
          console.error('Error deleting file', fp, err.message);
        }
      });
    });

    res.json({ message: 'Tarea eliminada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al eliminar tarea' });
  }
}

module.exports = {
  createTask,
  getTasks,
  updateTask,
  addComment,
  getComments,
  getUsers,
  getTaskById,
  deleteTask
};
