const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const router = express.Router();

// All routes require admin
router.use(requireAdmin);

// GET /api/admin/users - list all users
router.get('/users', (req, res) => {
  try {
    const users = db.getAllUsers();
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/users/pending
router.get('/users/pending', (req, res) => {
  try {
    const users = db.getPendingUsers();
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/admin/users/:id/status
router.put('/users/:id/status', (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    // Prevent admin from changing their own status
    if (parseInt(id) === req.session.userId) {
      return res.status(400).json({ error: 'Cannot change your own status' });
    }
    db.updateUserStatus(parseInt(id), status);

    // Emit socket event if io is available
    if (req.app.get('io')) {
      req.app.get('io').emit('user:statusChanged', { userId: parseInt(id), status });
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/admin/users/:id/role
router.put('/users/:id/role', (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    if (!['admin', 'caregiver'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    if (parseInt(id) === req.session.userId) {
      return res.status(400).json({ error: 'Cannot change your own role' });
    }
    db.updateUserRole(parseInt(id), role);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', (req, res) => {
  try {
    const { id } = req.params;
    if (parseInt(id) === req.session.userId) {
      return res.status(400).json({ error: 'Cannot delete yourself' });
    }
    db.deleteUser(parseInt(id));
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
