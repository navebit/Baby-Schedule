/**
 * One-time cleanup: deletes all groups, non-super_admin users, and all entries.
 * Run via Railway console: node scripts/cleanup-reset.js
 */
const path = require('path');
process.env.DB_PATH = process.env.DB_PATH || path.join(__dirname, '../baby_schedule.db');

const Database = require('better-sqlite3');
const db = new Database(process.env.DB_PATH);

const superAdmin = db.prepare("SELECT id, username, email FROM users WHERE role = 'super_admin'").get();
if (!superAdmin) {
  console.error('No super_admin found — aborting.');
  process.exit(1);
}
console.log(`Keeping super_admin: ${superAdmin.username} (${superAdmin.email})`);

db.exec('BEGIN');
try {
  const r1 = db.prepare('DELETE FROM sleep_entries').run();
  const r2 = db.prepare('DELETE FROM feeding_entries').run();
  const r3 = db.prepare('DELETE FROM diaper_entries').run();
  const r4 = db.prepare('DELETE FROM medication_entries').run();
  const r5 = db.prepare("DELETE FROM users WHERE role != 'super_admin'").run();
  const r6 = db.prepare('DELETE FROM groups').run();
  // Detach super_admin from any group
  db.prepare("UPDATE users SET group_id = NULL WHERE role = 'super_admin'").run();

  db.exec('COMMIT');
  console.log(`Deleted: ${r1.changes} sleep, ${r2.changes} feeding, ${r3.changes} diaper, ${r4.changes} medication entries`);
  console.log(`Deleted: ${r5.changes} users, ${r6.changes} groups`);
  console.log('Done. Super_admin preserved.');
} catch (e) {
  db.exec('ROLLBACK');
  console.error('Error — rolled back:', e.message);
  process.exit(1);
}
