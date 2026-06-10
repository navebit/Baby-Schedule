const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'baby_schedule.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    // foreign_keys left OFF — app logic enforces referential integrity,
    // and ON breaks inserts when old migrations left stale FK references.
  }
  return db;
}

function initDb() {
  const database = getDb();

  // Create groups table
  database.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      baby_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Create users table with new schema (role supports super_admin, group_admin, caregiver)
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'caregiver' CHECK(role IN ('super_admin', 'group_admin', 'caregiver', 'admin')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
      group_id INTEGER REFERENCES groups(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Safe cleanup: drop any leftover users_old from failed past migrations
  try {
    const hasOld = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users_old'").get();
    if (hasOld) {
      database.prepare("INSERT OR IGNORE INTO users (id,username,email,password_hash,role,status,created_at) SELECT id,username,email,password_hash,role,status,created_at FROM users_old").run();
      database.prepare("DROP TABLE users_old").run();
      console.log('Dropped leftover users_old');
    }
  } catch (e) { console.error('users_old cleanup error:', e.message); }

  // Migrations: add group_id to users if missing
  try {
    database.exec('ALTER TABLE users ADD COLUMN group_id INTEGER REFERENCES groups(id)');
  } catch (_) { /* column already exists */ }

  // Create entry tables (no FK on user_id to avoid stale references from old migrations)
  database.exec(`
    CREATE TABLE IF NOT EXISTS sleep_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      group_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('morning_wake', 'nap1', 'nap2', 'nap3', 'nap4', 'night_sleep')),
      start_time TEXT NOT NULL,
      end_time TEXT,
      notes TEXT,
      date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS feeding_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      group_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      unit TEXT NOT NULL DEFAULT 'ml',
      time TEXT NOT NULL,
      notes TEXT,
      date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS diaper_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      group_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('wet', 'dirty', 'both')),
      time TEXT NOT NULL,
      notes TEXT,
      date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS medication_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      group_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      dosage TEXT NOT NULL,
      time_administered TEXT NOT NULL,
      next_dose_reminder TEXT,
      notes TEXT,
      date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migrations: add group_id to entry tables if missing
  for (const table of ['sleep_entries', 'feeding_entries', 'diaper_entries', 'medication_entries']) {
    try {
      database.exec(`ALTER TABLE ${table} ADD COLUMN group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE`);
    } catch (_) { /* column already exists */ }
  }

  // Migration: ensure a default group exists for any legacy users without group_id
  const ungroupedUsers = database.prepare(
    "SELECT id FROM users WHERE group_id IS NULL AND role != 'super_admin'"
  ).all();

  if (ungroupedUsers.length > 0) {
    let defaultGroup = database.prepare("SELECT id FROM groups WHERE name = 'Default Group'").get();
    if (!defaultGroup) {
      const res = database.prepare(
        "INSERT INTO groups (name, baby_name, status) VALUES ('Default Group', 'Baby', 'approved')"
      ).run();
      defaultGroup = { id: res.lastInsertRowid };
    }
    for (const u of ungroupedUsers) {
      database.prepare("UPDATE users SET group_id = ? WHERE id = ?").run(defaultGroup.id, u.id);
    }
    // Update existing entries with no group_id
    for (const table of ['sleep_entries', 'feeding_entries', 'diaper_entries', 'medication_entries']) {
      database.prepare(`UPDATE ${table} SET group_id = ? WHERE group_id IS NULL`).run(defaultGroup.id);
    }
  }

  // Create invites table
  database.exec(`
    CREATE TABLE IF NOT EXISTS invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      created_by INTEGER NOT NULL REFERENCES users(id),
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migrate existing 'admin' role users to 'group_admin'
  try {
    database.prepare("UPDATE users SET role = 'group_admin' WHERE role = 'admin'").run();
  } catch (_) { /* ignore */ }

  // Create super-admin user if not exists
  const adminUsername = process.env.ADMIN_USERNAME || 'admin';
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@babyscheduler.local';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

  const existing = database.prepare("SELECT id, role FROM users WHERE role = 'super_admin' OR username = ? OR email = ?").get(adminUsername, adminEmail);
  if (existing && existing.role !== 'super_admin') {
    // Upgrade existing user to super_admin — keep their group_id so they can still log entries
    database.prepare("UPDATE users SET role = 'super_admin' WHERE id = ?").run(existing.id);
    console.log(`Upgraded existing user to super_admin`);
  } else if (!existing) {
    const hash = bcrypt.hashSync(adminPassword, 10);
    database.prepare(
      'INSERT INTO users (username, email, password_hash, role, status, group_id) VALUES (?, ?, ?, ?, ?, NULL)'
    ).run(adminUsername, adminEmail, hash, 'super_admin', 'approved');
    console.log(`Super-admin user created: ${adminUsername} / ${adminPassword}`);
  }

  return database;
}

// ===== GROUPS =====

function createGroup(name, babyName) {
  return getDb().prepare(
    "INSERT INTO groups (name, baby_name, status) VALUES (?, ?, 'pending')"
  ).run(name, babyName);
}

function getGroupById(id) {
  return getDb().prepare('SELECT * FROM groups WHERE id = ?').get(id);
}

function getAllGroups() {
  return getDb().prepare(`
    SELECT g.*, u.username as admin_username, u.email as admin_email, u.id as admin_user_id
    FROM groups g
    LEFT JOIN users u ON u.group_id = g.id AND u.role = 'group_admin'
    ORDER BY g.created_at DESC
  `).all();
}

function getPendingGroups() {
  return getDb().prepare(`
    SELECT g.*, u.username as admin_username, u.email as admin_email, u.id as admin_user_id
    FROM groups g
    LEFT JOIN users u ON u.group_id = g.id AND u.role = 'group_admin'
    WHERE g.status = 'pending'
    ORDER BY g.created_at DESC
  `).all();
}

function updateGroupStatus(id, status) {
  return getDb().prepare('UPDATE groups SET status = ? WHERE id = ?').run(status, id);
}

// ===== USERS =====

function getUserById(id) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function getUserByUsername(username) {
  return getDb().prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function getUserByEmail(email) {
  return getDb().prepare('SELECT * FROM users WHERE email = ?').get(email);
}

function getAllUsers() {
  return getDb().prepare('SELECT id, username, email, role, status, group_id, created_at FROM users ORDER BY created_at DESC').all();
}

function getPendingUsers() {
  return getDb().prepare("SELECT id, username, email, role, status, group_id, created_at FROM users WHERE status = 'pending'").all();
}

function getUsersByGroup(groupId) {
  return getDb().prepare(
    "SELECT id, username, email, role, status, group_id, created_at FROM users WHERE group_id = ? AND role != 'super_admin' ORDER BY created_at DESC"
  ).all(groupId);
}

function getPendingUsersByGroup(groupId) {
  return getDb().prepare(
    "SELECT id, username, email, role, status, group_id, created_at FROM users WHERE group_id = ? AND status = 'pending' AND role != 'super_admin' ORDER BY created_at DESC"
  ).all(groupId);
}

function createUser(username, email, passwordHash, role, groupId) {
  return getDb().prepare(
    'INSERT INTO users (username, email, password_hash, role, status, group_id) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(username, email, passwordHash, role || 'caregiver', 'pending', groupId || null);
}

function updateUserStatus(id, status) {
  return getDb().prepare('UPDATE users SET status = ? WHERE id = ?').run(status, id);
}

function updateUserRole(id, role) {
  return getDb().prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
}

function deleteUser(id) {
  return getDb().prepare('DELETE FROM users WHERE id = ?').run(id);
}

// ===== SLEEP ENTRIES =====

function getSleepEntriesByDate(date, groupId) {
  return getDb().prepare(`
    SELECT s.*, u.username FROM sleep_entries s
    JOIN users u ON s.user_id = u.id
    WHERE s.date = ? AND s.group_id = ? ORDER BY s.start_time ASC
  `).all(date, groupId);
}

function createSleepEntry(userId, groupId, type, startTime, endTime, notes, date) {
  return getDb().prepare(
    'INSERT INTO sleep_entries (user_id, group_id, type, start_time, end_time, notes, date) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(userId, groupId, type, startTime, endTime || null, notes || null, date);
}

function updateSleepEntry(id, userId, groupId, type, startTime, endTime, notes, isPrivileged) {
  if (isPrivileged) {
    return getDb().prepare(
      'UPDATE sleep_entries SET type = ?, start_time = ?, end_time = ?, notes = ? WHERE id = ? AND group_id = ?'
    ).run(type, startTime, endTime || null, notes || null, id, groupId);
  }
  return getDb().prepare(
    'UPDATE sleep_entries SET type = ?, start_time = ?, end_time = ?, notes = ? WHERE id = ? AND user_id = ? AND group_id = ?'
  ).run(type, startTime, endTime || null, notes || null, id, userId, groupId);
}

function deleteSleepEntry(id, userId, groupId, isPrivileged) {
  if (isPrivileged) {
    return getDb().prepare('DELETE FROM sleep_entries WHERE id = ? AND group_id = ?').run(id, groupId);
  }
  return getDb().prepare('DELETE FROM sleep_entries WHERE id = ? AND user_id = ? AND group_id = ?').run(id, userId, groupId);
}

// ===== FEEDING ENTRIES =====

function getFeedingEntriesByDate(date, groupId) {
  return getDb().prepare(`
    SELECT f.*, u.username FROM feeding_entries f
    JOIN users u ON f.user_id = u.id
    WHERE f.date = ? AND f.group_id = ? ORDER BY f.time ASC
  `).all(date, groupId);
}

function createFeedingEntry(userId, groupId, amount, unit, time, notes, date) {
  return getDb().prepare(
    'INSERT INTO feeding_entries (user_id, group_id, amount, unit, time, notes, date) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(userId, groupId, amount, unit, time, notes || null, date);
}

function updateFeedingEntry(id, userId, groupId, amount, unit, time, notes, isPrivileged) {
  if (isPrivileged) {
    return getDb().prepare(
      'UPDATE feeding_entries SET amount = ?, unit = ?, time = ?, notes = ? WHERE id = ? AND group_id = ?'
    ).run(amount, unit, time, notes || null, id, groupId);
  }
  return getDb().prepare(
    'UPDATE feeding_entries SET amount = ?, unit = ?, time = ?, notes = ? WHERE id = ? AND user_id = ? AND group_id = ?'
  ).run(amount, unit, time, notes || null, id, userId, groupId);
}

function deleteFeedingEntry(id, userId, groupId, isPrivileged) {
  if (isPrivileged) {
    return getDb().prepare('DELETE FROM feeding_entries WHERE id = ? AND group_id = ?').run(id, groupId);
  }
  return getDb().prepare('DELETE FROM feeding_entries WHERE id = ? AND user_id = ? AND group_id = ?').run(id, userId, groupId);
}

// ===== DIAPER ENTRIES =====

function getDiaperEntriesByDate(date, groupId) {
  return getDb().prepare(`
    SELECT d.*, u.username FROM diaper_entries d
    JOIN users u ON d.user_id = u.id
    WHERE d.date = ? AND d.group_id = ? ORDER BY d.time ASC
  `).all(date, groupId);
}

function createDiaperEntry(userId, groupId, type, time, notes, date) {
  return getDb().prepare(
    'INSERT INTO diaper_entries (user_id, group_id, type, time, notes, date) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(userId, groupId, type, time, notes || null, date);
}

function updateDiaperEntry(id, userId, groupId, type, time, notes, isPrivileged) {
  if (isPrivileged) {
    return getDb().prepare(
      'UPDATE diaper_entries SET type = ?, time = ?, notes = ? WHERE id = ? AND group_id = ?'
    ).run(type, time, notes || null, id, groupId);
  }
  return getDb().prepare(
    'UPDATE diaper_entries SET type = ?, time = ?, notes = ? WHERE id = ? AND user_id = ? AND group_id = ?'
  ).run(type, time, notes || null, id, userId, groupId);
}

function deleteDiaperEntry(id, userId, groupId, isPrivileged) {
  if (isPrivileged) {
    return getDb().prepare('DELETE FROM diaper_entries WHERE id = ? AND group_id = ?').run(id, groupId);
  }
  return getDb().prepare('DELETE FROM diaper_entries WHERE id = ? AND user_id = ? AND group_id = ?').run(id, userId, groupId);
}

// ===== MEDICATION ENTRIES =====

function getMedicationEntriesByDate(date, groupId) {
  return getDb().prepare(`
    SELECT m.*, u.username FROM medication_entries m
    JOIN users u ON m.user_id = u.id
    WHERE m.date = ? AND m.group_id = ? ORDER BY m.time_administered ASC
  `).all(date, groupId);
}

function getRecentMedicationByName(name, since, groupId) {
  return getDb().prepare(`
    SELECT m.*, u.username FROM medication_entries m
    JOIN users u ON m.user_id = u.id
    WHERE LOWER(m.name) = LOWER(?) AND m.time_administered >= ? AND m.group_id = ?
    ORDER BY m.time_administered DESC
  `).all(name, since, groupId);
}

function createMedicationEntry(userId, groupId, name, dosage, timeAdministered, nextDoseReminder, notes, date) {
  return getDb().prepare(
    'INSERT INTO medication_entries (user_id, group_id, name, dosage, time_administered, next_dose_reminder, notes, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(userId, groupId, name, dosage, timeAdministered, nextDoseReminder || null, notes || null, date);
}

function updateMedicationEntry(id, userId, groupId, name, dosage, timeAdministered, nextDoseReminder, notes, isPrivileged) {
  if (isPrivileged) {
    return getDb().prepare(
      'UPDATE medication_entries SET name = ?, dosage = ?, time_administered = ?, next_dose_reminder = ?, notes = ? WHERE id = ? AND group_id = ?'
    ).run(name, dosage, timeAdministered, nextDoseReminder || null, notes || null, id, groupId);
  }
  return getDb().prepare(
    'UPDATE medication_entries SET name = ?, dosage = ?, time_administered = ?, next_dose_reminder = ?, notes = ? WHERE id = ? AND user_id = ? AND group_id = ?'
  ).run(name, dosage, timeAdministered, nextDoseReminder || null, notes || null, id, userId, groupId);
}

function deleteMedicationEntry(id, userId, groupId, isPrivileged) {
  if (isPrivileged) {
    return getDb().prepare('DELETE FROM medication_entries WHERE id = ? AND group_id = ?').run(id, groupId);
  }
  return getDb().prepare('DELETE FROM medication_entries WHERE id = ? AND user_id = ? AND group_id = ?').run(id, userId, groupId);
}

// ===== INVITES =====

function createInvite(groupId, createdBy) {
  const token = crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  getDb().prepare(
    'INSERT INTO invites (token, group_id, created_by, expires_at) VALUES (?, ?, ?, ?)'
  ).run(token, groupId, createdBy, expiresAt);
  return { token, groupId };
}

function getInviteByToken(token) {
  return getDb().prepare('SELECT * FROM invites WHERE token = ?').get(token);
}

function markInviteUsed(token) {
  return getDb().prepare('UPDATE invites SET used = 1 WHERE token = ?').run(token);
}

// ===== CALENDAR =====

function getDatesWithEntries(year, month, groupId) {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const database = getDb();
  const dates = new Set();

  ['sleep_entries', 'feeding_entries', 'diaper_entries', 'medication_entries'].forEach(table => {
    const rows = database.prepare(`SELECT DISTINCT date FROM ${table} WHERE date LIKE ? AND group_id = ?`).all(`${prefix}%`, groupId);
    rows.forEach(r => dates.add(r.date));
  });

  return Array.from(dates);
}

// ===== MEDICATION REMINDERS =====

function getUpcomingMedicationReminders(groupId) {
  const now = new Date().toISOString();
  const oneHourLater = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  return getDb().prepare(`
    SELECT m.*, u.username FROM medication_entries m
    JOIN users u ON m.user_id = u.id
    WHERE m.next_dose_reminder IS NOT NULL
      AND m.next_dose_reminder >= ?
      AND m.next_dose_reminder <= ?
      AND m.group_id = ?
    ORDER BY m.next_dose_reminder ASC
  `).all(now, oneHourLater, groupId);
}

module.exports = {
  initDb,
  getDb,
  // Groups
  createGroup,
  getGroupById,
  getAllGroups,
  getPendingGroups,
  updateGroupStatus,
  // Users
  getUserById,
  getUserByUsername,
  getUserByEmail,
  getAllUsers,
  getPendingUsers,
  getUsersByGroup,
  getPendingUsersByGroup,
  createUser,
  updateUserStatus,
  updateUserRole,
  deleteUser,
  // Entries
  getSleepEntriesByDate,
  createSleepEntry,
  updateSleepEntry,
  deleteSleepEntry,
  getFeedingEntriesByDate,
  createFeedingEntry,
  updateFeedingEntry,
  deleteFeedingEntry,
  getDiaperEntriesByDate,
  createDiaperEntry,
  updateDiaperEntry,
  deleteDiaperEntry,
  getMedicationEntriesByDate,
  getRecentMedicationByName,
  createMedicationEntry,
  updateMedicationEntry,
  deleteMedicationEntry,
  getDatesWithEntries,
  getUpcomingMedicationReminders,
  // Invites
  createInvite,
  getInviteByToken,
  markInviteUsed,
};
