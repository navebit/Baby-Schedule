const express = require('express');
const db = require('../db');
const { requireAdmin, requireSuperAdmin } = require('../middleware/auth');
const router = express.Router();

// All routes require at least admin (super_admin or group_admin)
router.use(requireAdmin);

// ===== SUPER-ADMIN: Group management =====

// GET /api/admin/groups - list all groups (super_admin only)
router.get('/groups', requireSuperAdmin, (req, res) => {
  try {
    const groups = db.getAllGroups();
    res.json(groups);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/groups/pending - list pending groups (super_admin only)
router.get('/groups/pending', requireSuperAdmin, (req, res) => {
  try {
    const groups = db.getPendingGroups();
    res.json(groups);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/admin/groups/:id/status - approve or reject a group (super_admin only)
router.put('/groups/:id/status', requireSuperAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    db.updateGroupStatus(parseInt(id), status);

    // When approving a group, also approve the group_admin user
    if (status === 'approved') {
      const group = db.getGroupById(parseInt(id));
      if (group) {
        const users = db.getUsersByGroup(parseInt(id));
        for (const u of users) {
          if (u.role === 'group_admin' && u.status === 'pending') {
            db.updateUserStatus(u.id, 'approved');
          }
        }
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/groups/:id/users - list users in a group (super_admin only)
router.get('/groups/:id/users', requireSuperAdmin, (req, res) => {
  try {
    const users = db.getUsersByGroup(parseInt(req.params.id));
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/groups/:id/approve (convenience alias)
router.post('/groups/:id/approve', requireSuperAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    db.updateGroupStatus(id, 'approved');
    const users = db.getUsersByGroup(id);
    for (const u of users) {
      if (u.role === 'group_admin' && u.status === 'pending') {
        db.updateUserStatus(u.id, 'approved');
        if (req.app.get('io')) req.app.get('io').emit('user:statusChanged', { userId: u.id, status: 'approved' });
      }
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/groups/:id/reject (convenience alias)
router.post('/groups/:id/reject', requireSuperAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    db.updateGroupStatus(id, 'rejected');
    const users = db.getUsersByGroup(id);
    for (const u of users) {
      if (u.role === 'group_admin') {
        db.updateUserStatus(u.id, 'rejected');
        if (req.app.get('io')) req.app.get('io').emit('user:statusChanged', { userId: u.id, status: 'rejected' });
      }
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ===== GROUP-ADMIN: User management within their own group =====

// GET /api/admin/users - list users in group (group_admin sees own group; super_admin sees all)
router.get('/users', (req, res) => {
  try {
    let users;
    if (req.session.userRole === 'super_admin') {
      users = db.getAllUsers();
    } else {
      users = db.getUsersByGroup(req.session.groupId);
    }
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/users/pending - list pending users
router.get('/users/pending', (req, res) => {
  try {
    let users;
    if (req.session.userRole === 'super_admin') {
      users = db.getPendingUsers();
    } else {
      users = db.getPendingUsersByGroup(req.session.groupId);
    }
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
    if (parseInt(id) === req.session.userId) {
      return res.status(400).json({ error: 'Cannot change your own status' });
    }

    // group_admin can only modify users in their own group
    if (req.session.userRole === 'group_admin') {
      const target = db.getUserById(parseInt(id));
      if (!target || target.group_id !== req.session.groupId) {
        return res.status(403).json({ error: 'Cannot modify users outside your group' });
      }
    }

    db.updateUserStatus(parseInt(id), status);

    if (req.app.get('io')) {
      req.app.get('io').to(`group:${req.session.groupId || 'super'}`).emit('user:statusChanged', { userId: parseInt(id), status });
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
    if (parseInt(id) === req.session.userId) {
      return res.status(400).json({ error: 'Cannot change your own role' });
    }

    // group_admin can only assign caregiver or group_admin within their group
    if (req.session.userRole === 'group_admin') {
      if (!['caregiver', 'group_admin'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
      }
      const target = db.getUserById(parseInt(id));
      if (!target || target.group_id !== req.session.groupId) {
        return res.status(403).json({ error: 'Cannot modify users outside your group' });
      }
    } else {
      // super_admin can assign any valid role
      if (!['super_admin', 'group_admin', 'caregiver'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
      }
    }

    db.updateUserRole(parseInt(id), role);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/users/:id/remove-from-group (super_admin only)
router.post('/users/:id/remove-from-group', requireSuperAdmin, (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    if (userId === req.session.userId) {
      return res.status(400).json({ error: 'Cannot remove yourself' });
    }
    db.getDb().prepare("UPDATE users SET group_id = NULL, role = 'caregiver', status = 'rejected' WHERE id = ?").run(userId);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/admin/groups/:id/rename (super_admin only)
router.put('/groups/:id/rename', requireSuperAdmin, (req, res) => {
  try {
    const { name, baby_name } = req.body;
    if (!name && !baby_name) return res.status(400).json({ error: 'Nothing to update' });
    const id = parseInt(req.params.id);
    if (name) db.getDb().prepare('UPDATE groups SET name = ? WHERE id = ?').run(name, id);
    if (baby_name) db.getDb().prepare('UPDATE groups SET baby_name = ? WHERE id = ?').run(baby_name, id);
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

    // group_admin can only delete users in their own group
    if (req.session.userRole === 'group_admin') {
      const target = db.getUserById(parseInt(id));
      if (!target || target.group_id !== req.session.groupId) {
        return res.status(403).json({ error: 'Cannot delete users outside your group' });
      }
    }

    db.deleteUser(parseInt(id));
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/invite — generate invite link for current group
router.post('/invite', (req, res) => {
  try {
    const groupId = req.session.groupId;
    if (!groupId) {
      return res.status(400).json({ error: 'No group associated with your account' });
    }
    const { token } = db.createInvite(groupId, req.session.userId);
    const url = `${req.protocol}://${req.get('host')}/register?invite=${token}`;
    res.json({ token, url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/my-group — super_admin creates their own group
router.post('/my-group', requireSuperAdmin, (req, res) => {
  try {
    const { name, baby_name } = req.body;
    if (!name || !baby_name) return res.status(400).json({ error: 'Name and baby name required' });
    const result = db.createGroup(name, baby_name);
    const groupId = result.lastInsertRowid;
    db.updateGroupStatus(groupId, 'approved');
    db.getDb().prepare("UPDATE users SET group_id = ? WHERE id = ?").run(groupId, req.session.userId);
    // Update session
    req.session.groupId = groupId;
    req.session.groupInfo = { id: groupId, name, babyName: baby_name };
    res.json({ success: true, groupId, name, babyName: baby_name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
