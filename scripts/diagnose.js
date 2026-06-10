const path = require('path');
process.env.DB_PATH = process.env.DB_PATH || path.join(__dirname, '../baby_schedule.db');
const Database = require('better-sqlite3');
const db = new Database(process.env.DB_PATH);

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
console.log('\n=== Tables ===');
console.log(tables.join(', '));

for (const t of ['sleep_entries','feeding_entries','diaper_entries','medication_entries','users','groups']) {
  if (!tables.includes(t)) { console.log(`\nMISSING TABLE: ${t}`); continue; }
  const cols = db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
  console.log(`\n${t}: ${cols.join(', ')}`);
}

console.log('\n=== Users ===');
db.prepare("SELECT id, username, role, status, group_id FROM users").all().forEach(u =>
  console.log(` - ${u.username} | ${u.role} | ${u.status} | group_id=${u.group_id}`));

console.log('\n=== Groups ===');
db.prepare("SELECT id, name, baby_name, status FROM groups").all().forEach(g =>
  console.log(` - [${g.id}] ${g.name} / ${g.baby_name} | ${g.status}`));
