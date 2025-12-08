const express = require('express');
const multer = require('multer');
const path = require('path');
const auth = require('../middleware/auth');
const {
  createTask,
  getTasks,
  getTaskById,
  updateTask,
  addComment,
  getComments,
  getUsers,
  deleteTask           
} = require('../controllers/taskController');

const router = express.Router();

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, '..', 'uploads'));
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({ storage });

// 🔐 todas las rutas requieren auth
router.use(auth);

// 👉 ESTA ruta es la que usa el front para llenar el combo de usuarios
// usuarios para asignar
router.get('/users/all', getUsers);

// tareas
router.get('/', getTasks);

// detalle de tarea (con adjuntos)
router.get('/:id', getTaskById);

// crear tarea con adjuntos
router.post('/', upload.array('files', 10), createTask);

// actualizar tarea (estado, prioridad, etc.)
router.put('/:id', updateTask);

// comentarios
router.get('/:id/comments', getComments);

// comentarios con adjuntos
router.post('/:id/comments', upload.array('files', 10), addComment);

// elimina la tarea
router.delete('/:id', deleteTask);

module.exports = router;
