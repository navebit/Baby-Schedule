function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    return res.redirect('/login');
  }
  next();
}

function requireApproved(req, res, next) {
  if (!req.session || !req.session.userId) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    return res.redirect('/login');
  }
  if (req.session.userStatus !== 'approved') {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(403).json({ error: 'Account pending approval' });
    }
    return res.redirect('/pending');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.userId) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    return res.redirect('/login');
  }
  // Allow both super_admin and group_admin to reach admin routes (further scoping is done in route handlers)
  const role = req.session.userRole;
  if (role !== 'super_admin' && role !== 'group_admin') {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    return res.status(403).send('Forbidden');
  }
  next();
}

function requireSuperAdmin(req, res, next) {
  if (!req.session || !req.session.userId) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    return res.redirect('/login');
  }
  if (req.session.userRole !== 'super_admin') {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(403).json({ error: 'Super-admin access required' });
    }
    return res.status(403).send('Forbidden');
  }
  next();
}

module.exports = { requireAuth, requireApproved, requireAdmin, requireSuperAdmin };
