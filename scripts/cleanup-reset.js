/**
 * One-time cleanup: deletes all groups, non-super_admin users, and all entries.
 * Run via Railway console: node scripts/cleanup-reset.js
 */
const path = require('path');
process.env.DB_PATH = process.env.DB_PATH || path.join(__dirname, '../baby_schedule.db');

const Database = require('better-sqlite3');
const db = new Database(process.env.DB_PATH);
db.pragma('foreign_keys = OFF');

// Show all tables for diagnostics
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
console.log('Tables found:', tables.join(', '));

// Fix leftover migration artifact: if users_old exists but users doesn't, rename it back
if (tables.includes('users_old') && !tables.includes('users')) {
  console.log('Repairing: renaming users_old -> users');
  db.exec('ALTER TABLE users_old RENAME TO users');
}

const superAdmin = db.prepare("SELECT id, username, email FROM users WHERE role = 'super_admin'").get();
if (!superAdmin) {
  // Try finding any admin-level user
  const anyAdmin = db.prepare("SELECT id, username, email, role FROM users WHERE role IN ('super_admin','admin','group_admin') LIMIT 1").get();
  if (anyAdmin) {
    console.log(`No super_admin found, upgrading ${anyAdmin.username} (${anyAdmin.role}) to super_admin`);
    db.prepare("UPDATE users SET role = 'super_admin' WHERE id = ?").run(anyAdmin.id);
  } else {
    console.error('No admin user found at all — aborting.');
    process.exit(1);
  }
}

const admin = db.prepare("SELECT id, username, email FROM users WHERE role = 'super_admin'").get();
console.log(`Keeping super_admin: ${admin.username} (${admin.email})`);

db.exec('BEGIN');
try {
  const tables2 = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);

  let r1 = { changes: 0 }, r2 = { changes: 0 }, r3 = { changes: 0 }, r4 = { changes: 0 };
  if (tables2.includes('sleep_entries'))      r1 = db.prepare('DELETE FROM sleep_entries').run();
  if (tables2.includes('feeding_entries'))    r2 = db.prepare('DELETE FROM feeding_entries').run();
  if (tables2.includes('diaper_entries'))     r3 = db.prepare('DELETE FROM diaper_entries').run();
  if (tables2.includes('medication_entries')) r4 = db.prepare('DELETE FROM medication_entries').run();

  const r5 = db.prepare("DELETE FROM users WHERE role != 'super_admin'").run();

  let r6 = { changes: 0 };
  if (tables2.includes('groups')) r6 = db.prepare('DELETE FROM groups').run();

  // Detach super_admin from any group so they start fresh
  db.prepare("UPDATE users SET group_id = NULL WHERE role = 'super_admin'").run();

  // Drop leftover users_old if present
  if (tables2.includes('users_old')) db.exec('DROP TABLE users_old');

  db.exec('COMMIT');
  console.log(`Deleted: ${r1.changes} sleep, ${r2.changes} feeding, ${r3.changes} diaper, ${r4.changes} medication entries`);
  console.log(`Deleted: ${r5.changes} users, ${r6.changes} groups`);
  console.log('Done. Super_admin preserved. You can now log out and back in.');
} catch (e) {
  db.exec('ROLLBACK');
  console.error('Error — rolled back:', e.message);
  process.exit(1);
}
