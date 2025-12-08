const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getPool, sql } = require('../config/db');
require('dotenv').config();

async function register(req, res) {
  try {
    const { name, email, password, role } = req.body;
    const pool = await getPool();

    const hashed = await bcrypt.hash(password, 10);

    const result = await pool.request()
      .input('Name', sql.NVarChar, name)
      .input('Email', sql.NVarChar, email)
      .input('PasswordHash', sql.NVarChar, hashed)
      .input('Role', sql.NVarChar, role || 'USER')
      .query(`
        INSERT INTO Users (Name, Email, PasswordHash, Role)
        VALUES (@Name, @Email, @PasswordHash, @Role);
        SELECT SCOPE_IDENTITY() AS Id;
      `);

    const userId = result.recordset[0].Id;

    const token = jwt.sign(
      { id: userId, email, role: role || 'USER' },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({ token });
  } catch (err) {
    console.error(err);
    if (err.originalError && err.originalError.info && err.originalError.info.number === 2627) {
      return res.status(400).json({ message: 'Email ya registrado' });
    }
    res.status(500).json({ message: 'Error en registro' });
  }
}

async function login(req, res) {
  try {
    const { identifier, password } = req.body; // antes era email, ahora "identifier"
    //console.log(req.body);
    
    if (!identifier || !password) {
      return res.status(400).json({ message: 'Nombre/Email y contraseña son requeridos' });
    }

    const pool = await getPool();

    // Permitimos loguearse tanto con Name como con Email
    const result = await pool.request()
      .input('Identifier', sql.NVarChar, identifier)
      .query(`
        SELECT TOP 1 *
        FROM Users
        WHERE Name = @Identifier OR Email = @Identifier
      `);

    if (result.recordset.length === 0) {
      return res.status(401).json({ message: 'Usuario o contraseña incorrectos' });
      //console.log('status 401');
      
    }

    const user = result.recordset[0];

    const isMatch = await bcrypt.compare(password, user.PasswordHash);
    if (!isMatch) {
      return res.status(401).json({ message: 'Usuario o contraseña incorrectos' });
    }

    const token = jwt.sign(
      {
        id: user.Id,
        name: user.Name,
        email: user.Email,
        role: user.Role
      },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );
//console.log('status 200');
    res.json({
      token,
      user: {
        id: user.Id,
        name: user.Name,
        email: user.Email,
        role: user.Role
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error en login' });
  }
}
// async function login(req, res) {
//   try {
//     const { email, password } = req.body;
//     const pool = await getPool();

//     const result = await pool.request()
//       .input('Email', sql.NVarChar, email)
//       .query(`SELECT * FROM Users WHERE Email = @Email`);

//     if (result.recordset.length === 0) {
//       return res.status(400).json({ message: 'Credenciales inválidas' });
//     }

//     const user = result.recordset[0];
//     const isMatch = await bcrypt.compare(password, user.PasswordHash);

//     if (!isMatch) {
//       return res.status(400).json({ message: 'Credenciales inválidas' });
//     }

//     const token = jwt.sign(
//       { id: user.Id, email: user.Email, role: user.Role },
//       process.env.JWT_SECRET,
//       { expiresIn: '7d' }
//     );

//     res.json({ token });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: 'Error en login' });
//   }
// }

module.exports = { register, login };
