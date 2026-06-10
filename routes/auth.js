const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db');
const router = express.Router();

// GET /login
router.get('/login', (req, res) => {
  if (req.session && req.session.userId) {
    return res.redirect('/');
  }
  res.sendFile('login.html', { root: require('path').join(__dirname, '../public') });
});

// POST /api/auth/login
router.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const user = db.getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Super-admin: no group required
    if (user.role === 'super_admin') {
      if (user.status !== 'approved') {
        return res.status(403).json({ error: 'Account not approved' });
      }
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.userRole = user.role;
      req.session.userStatus = user.status;
      req.session.groupId = null;
      req.session.groupInfo = null;
      return res.json({
        success: true,
        user: { id: user.id, username: user.username, role: user.role, status: user.status, groupId: null },
      });
    }

    // group_admin / caregiver: check group status AND user status
    if (!user.group_id) {
      return res.status(403).json({ error: 'No group associated with this account' });
    }

    const group = db.getGroupById(user.group_id);
    if (!group) {
      return res.status(403).json({ error: 'Group not found' });
    }
    if (group.status !== 'approved') {
      return res.status(403).json({ error: 'Your group registration is pending super-admin approval' });
    }
    if (user.status !== 'approved') {
      return res.status(403).json({ error: 'Your account is pending approval' });
    }

    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.userRole = user.role;
    req.session.userStatus = user.status;
    req.session.groupId = user.group_id;
    req.session.groupInfo = { id: group.id, name: group.name, babyName: group.baby_name };

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        status: user.status,
        groupId: user.group_id,
        groupInfo: req.session.groupInfo,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/register
// Creates a new group + group_admin user, both pending approval
router.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password, groupName, babyName } = req.body;
    if (!username || !email || !password || !groupName || !babyName) {
      return res.status(400).json({ error: 'Username, email, password, group name, and baby name are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existingUser = db.getUserByUsername(username);
    if (existingUser) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    const existingEmail = db.getUserByEmail(email);
    if (existingEmail) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Create the group (pending)
    const groupResult = db.createGroup(groupName.trim(), babyName.trim());
    const groupId = groupResult.lastInsertRowid;

    // Create the group_admin user (pending)
    const hash = await bcrypt.hash(password, 10);
    db.createUser(username, email, hash, 'group_admin', groupId);

    res.json({
      success: true,
      message: 'Your group registration is pending super-admin approval. You will be able to log in once approved.',
    });
  } catch (err) {
    console.error('Register error:', err);
    if (err.message && err.message.includes('UNIQUE constraint failed: groups.name')) {
      return res.status(409).json({ error: 'A group with that name already exists' });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/logout
router.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

// GET /api/auth/me
router.get('/api/auth/me', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.json({
    id: req.session.userId,
    username: req.session.username,
    role: req.session.userRole,
    status: req.session.userStatus,
    groupId: req.session.groupId || null,
    groupInfo: req.session.groupInfo || null,
  });
});

module.exports = router;
