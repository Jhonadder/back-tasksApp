const sql = require('mssql');
require('dotenv').config();

const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER, // "localhost\\SQLEXPRESS" por ejemplo
  database: process.env.DB_NAME,
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};

async function getPool() {
  if (!global.connectionPool) {
    global.connectionPool = await sql.connect(dbConfig);
  }
  return global.connectionPool;
}

module.exports = {
  sql,
  getPool
};
