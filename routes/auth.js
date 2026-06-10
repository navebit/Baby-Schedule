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

    // Super-admin: load group if they have one (so they can also log entries)
    if (user.role === 'super_admin') {
      if (user.status !== 'approved') {
        return res.status(403).json({ error: 'Account not approved' });
      }
      const superGroup = user.group_id ? db.getGroupById(user.group_id) : null;
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.userRole = user.role;
      req.session.userStatus = user.status;
      req.session.groupId = superGroup ? superGroup.id : null;
      req.session.groupInfo = superGroup ? { id: superGroup.id, name: superGroup.name, babyName: superGroup.baby_name } : null;
      return res.json({
        success: true,
        user: { id: user.id, username: user.username, role: user.role, status: user.status, groupId: req.session.groupId, groupInfo: req.session.groupInfo },
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

// GET /api/auth/invite-info/:token — public, returns group info for a valid invite
router.get('/api/auth/invite-info/:token', (req, res) => {
  try {
    const invite = db.getInviteByToken(req.params.token);
    if (!invite) {
      return res.json({ valid: false, reason: 'Invite not found' });
    }
    if (invite.used) {
      return res.json({ valid: false, reason: 'Invite already used' });
    }
    if (new Date(invite.expires_at) < new Date()) {
      return res.json({ valid: false, reason: 'Invite has expired' });
    }
    const group = db.getGroupById(invite.group_id);
    if (!group) {
      return res.json({ valid: false, reason: 'Group not found' });
    }
    res.json({ valid: true, groupName: group.name, babyName: group.baby_name });
  } catch (err) {
    console.error('Invite-info error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/register
// Creates a new group + group_admin user, both pending approval
// If inviteToken is provided, joins existing group as an approved caregiver
router.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password, groupName, babyName, inviteToken } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, and password are required' });
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

    // Invite-based registration
    if (inviteToken) {
      const invite = db.getInviteByToken(inviteToken);
      if (!invite) {
        return res.status(400).json({ error: 'Invalid invite token' });
      }
      if (invite.used) {
        return res.status(400).json({ error: 'Invite link has already been used' });
      }
      if (new Date(invite.expires_at) < new Date()) {
        return res.status(400).json({ error: 'Invite link has expired' });
      }
      const group = db.getGroupById(invite.group_id);
      if (!group) {
        return res.status(400).json({ error: 'Group not found' });
      }

      const hash = await bcrypt.hash(password, 10);
      // createUser sets status to 'pending' by default; override to 'approved'
      const result = db.getDb().prepare(
        "INSERT INTO users (username, email, password_hash, role, status, group_id) VALUES (?, ?, ?, 'caregiver', 'approved', ?)"
      ).run(username, email, hash, invite.group_id);

      db.markInviteUsed(inviteToken);

      return res.json({ success: true, autoApproved: true });
    }

    // Normal registration: requires groupName + babyName
    if (!groupName || !babyName) {
      return res.status(400).json({ error: 'Username, email, password, group name, and baby name are required' });
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
