function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'ADMIN') {
    return next();
  }
  return res.status(403).json({ message: 'Acceso solo para administradores' });
}

module.exports = { requireAdmin };
