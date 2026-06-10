const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcrypt');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'baby_schedule.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initDb() {
  const database = getDb();

  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'caregiver' CHECK(role IN ('admin', 'caregiver')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sleep_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN ('morning_wake', 'nap1', 'nap2', 'nap3', 'nap4', 'night_sleep')),
      start_time TEXT NOT NULL,
      end_time TEXT,
      notes TEXT,
      date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS feeding_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount REAL NOT NULL,
      unit TEXT NOT NULL DEFAULT 'ml' CHECK(unit IN ('ml', 'oz')),
      time TEXT NOT NULL,
      notes TEXT,
      date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS diaper_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN ('wet', 'dirty', 'both')),
      time TEXT NOT NULL,
      notes TEXT,
      date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS medication_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      dosage TEXT NOT NULL,
      time_administered TEXT NOT NULL,
      next_dose_reminder TEXT,
      notes TEXT,
      date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Create admin user if not exists
  const adminUsername = process.env.ADMIN_USERNAME || 'admin';
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@babyscheduler.local';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

  const existing = database.prepare('SELECT id FROM users WHERE role = ?').get('admin');
  if (!existing) {
    const hash = bcrypt.hashSync(adminPassword, 10);
    database.prepare(
      'INSERT INTO users (username, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?)'
    ).run(adminUsername, adminEmail, hash, 'admin', 'approved');
    console.log(`Admin user created: ${adminUsername} / ${adminPassword}`);
  }

  return database;
}

// Users
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
  return getDb().prepare('SELECT id, username, email, role, status, created_at FROM users ORDER BY created_at DESC').all();
}

function getPendingUsers() {
  return getDb().prepare('SELECT id, username, email, role, status, created_at FROM users WHERE status = ?').all('pending');
}

function createUser(username, email, passwordHash) {
  return getDb().prepare(
    'INSERT INTO users (username, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?)'
  ).run(username, email, passwordHash, 'caregiver', 'pending');
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

// Sleep entries
function getSleepEntriesByDate(date) {
  return getDb().prepare(`
    SELECT s.*, u.username FROM sleep_entries s
    JOIN users u ON s.user_id = u.id
    WHERE s.date = ? ORDER BY s.start_time ASC
  `).all(date);
}

function createSleepEntry(userId, type, startTime, endTime, notes, date) {
  return getDb().prepare(
    'INSERT INTO sleep_entries (user_id, type, start_time, end_time, notes, date) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(userId, type, startTime, endTime || null, notes || null, date);
}

function updateSleepEntry(id, userId, type, startTime, endTime, notes) {
  return getDb().prepare(
    'UPDATE sleep_entries SET type = ?, start_time = ?, end_time = ?, notes = ? WHERE id = ? AND user_id = ?'
  ).run(type, startTime, endTime || null, notes || null, id, userId);
}

function deleteSleepEntry(id, userId, isAdmin) {
  if (isAdmin) {
    return getDb().prepare('DELETE FROM sleep_entries WHERE id = ?').run(id);
  }
  return getDb().prepare('DELETE FROM sleep_entries WHERE id = ? AND user_id = ?').run(id, userId);
}

// Feeding entries
function getFeedingEntriesByDate(date) {
  return getDb().prepare(`
    SELECT f.*, u.username FROM feeding_entries f
    JOIN users u ON f.user_id = u.id
    WHERE f.date = ? ORDER BY f.time ASC
  `).all(date);
}

function createFeedingEntry(userId, amount, unit, time, notes, date) {
  return getDb().prepare(
    'INSERT INTO feeding_entries (user_id, amount, unit, time, notes, date) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(userId, amount, unit, time, notes || null, date);
}

function updateFeedingEntry(id, userId, amount, unit, time, notes) {
  return getDb().prepare(
    'UPDATE feeding_entries SET amount = ?, unit = ?, time = ?, notes = ? WHERE id = ? AND user_id = ?'
  ).run(amount, unit, time, notes || null, id, userId);
}

function deleteFeedingEntry(id, userId, isAdmin) {
  if (isAdmin) {
    return getDb().prepare('DELETE FROM feeding_entries WHERE id = ?').run(id);
  }
  return getDb().prepare('DELETE FROM feeding_entries WHERE id = ? AND user_id = ?').run(id, userId);
}

// Diaper entries
function getDiaperEntriesByDate(date) {
  return getDb().prepare(`
    SELECT d.*, u.username FROM diaper_entries d
    JOIN users u ON d.user_id = u.id
    WHERE d.date = ? ORDER BY d.time ASC
  `).all(date);
}

function createDiaperEntry(userId, type, time, notes, date) {
  return getDb().prepare(
    'INSERT INTO diaper_entries (user_id, type, time, notes, date) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, type, time, notes || null, date);
}

function updateDiaperEntry(id, userId, type, time, notes) {
  return getDb().prepare(
    'UPDATE diaper_entries SET type = ?, time = ?, notes = ? WHERE id = ? AND user_id = ?'
  ).run(type, time, notes || null, id, userId);
}

function deleteDiaperEntry(id, userId, isAdmin) {
  if (isAdmin) {
    return getDb().prepare('DELETE FROM diaper_entries WHERE id = ?').run(id);
  }
  return getDb().prepare('DELETE FROM diaper_entries WHERE id = ? AND user_id = ?').run(id, userId);
}

// Medication entries
function getMedicationEntriesByDate(date) {
  return getDb().prepare(`
    SELECT m.*, u.username FROM medication_entries m
    JOIN users u ON m.user_id = u.id
    WHERE m.date = ? ORDER BY m.time_administered ASC
  `).all(date);
}

function getRecentMedicationByName(name, since) {
  return getDb().prepare(`
    SELECT m.*, u.username FROM medication_entries m
    JOIN users u ON m.user_id = u.id
    WHERE LOWER(m.name) = LOWER(?) AND m.time_administered >= ?
    ORDER BY m.time_administered DESC
  `).all(name, since);
}

function createMedicationEntry(userId, name, dosage, timeAdministered, nextDoseReminder, notes, date) {
  return getDb().prepare(
    'INSERT INTO medication_entries (user_id, name, dosage, time_administered, next_dose_reminder, notes, date) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(userId, name, dosage, timeAdministered, nextDoseReminder || null, notes || null, date);
}

function updateMedicationEntry(id, userId, name, dosage, timeAdministered, nextDoseReminder, notes) {
  return getDb().prepare(
    'UPDATE medication_entries SET name = ?, dosage = ?, time_administered = ?, next_dose_reminder = ?, notes = ? WHERE id = ? AND user_id = ?'
  ).run(name, dosage, timeAdministered, nextDoseReminder || null, notes || null, id, userId);
}

function deleteMedicationEntry(id, userId, isAdmin) {
  if (isAdmin) {
    return getDb().prepare('DELETE FROM medication_entries WHERE id = ?').run(id);
  }
  return getDb().prepare('DELETE FROM medication_entries WHERE id = ? AND user_id = ?').run(id, userId);
}

// Calendar: get dates that have entries within a month
function getDatesWithEntries(year, month) {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const db = getDb();
  const dates = new Set();

  ['sleep_entries', 'feeding_entries', 'diaper_entries', 'medication_entries'].forEach(table => {
    const col = table === 'sleep_entries' ? 'date' : 'date';
    const rows = db.prepare(`SELECT DISTINCT date FROM ${table} WHERE date LIKE ?`).all(`${prefix}%`);
    rows.forEach(r => dates.add(r.date));
  });

  return Array.from(dates);
}

// Upcoming medication reminders (next dose within 1 hour from now)
function getUpcomingMedicationReminders() {
  const now = new Date().toISOString();
  const oneHourLater = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  return getDb().prepare(`
    SELECT m.*, u.username FROM medication_entries m
    JOIN users u ON m.user_id = u.id
    WHERE m.next_dose_reminder IS NOT NULL
      AND m.next_dose_reminder >= ?
      AND m.next_dose_reminder <= ?
    ORDER BY m.next_dose_reminder ASC
  `).all(now, oneHourLater);
}

module.exports = {
  initDb,
  getDb,
  getUserById,
  getUserByUsername,
  getUserByEmail,
  getAllUsers,
  getPendingUsers,
  createUser,
  updateUserStatus,
  updateUserRole,
  deleteUser,
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
};
