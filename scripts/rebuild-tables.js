/**
 * Rebuilds entry tables without broken FK references.
 * Run via Railway console: node scripts/rebuild-tables.js
 */
const path = require('path');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../baby_schedule.db');
const Database = require('better-sqlite3');
const db = new Database(DB_PATH);

db.prepare('PRAGMA foreign_keys=OFF').run();

const rebuild = db.transaction(() => {
  const tables = {
    sleep_entries: {
      ddl: `id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, group_id INTEGER NOT NULL,
            type TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT, notes TEXT,
            date TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))`,
      cols: ['id','user_id','group_id','type','start_time','end_time','notes','date','created_at']
    },
    feeding_entries: {
      ddl: `id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, group_id INTEGER NOT NULL,
            amount REAL NOT NULL, unit TEXT NOT NULL DEFAULT 'ml', time TEXT NOT NULL, notes TEXT,
            date TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))`,
      cols: ['id','user_id','group_id','amount','unit','time','notes','date','created_at']
    },
    diaper_entries: {
      ddl: `id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, group_id INTEGER NOT NULL,
            type TEXT NOT NULL, time TEXT NOT NULL, notes TEXT,
            date TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))`,
      cols: ['id','user_id','group_id','type','time','notes','date','created_at']
    },
    medication_entries: {
      ddl: `id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, group_id INTEGER NOT NULL,
            name TEXT NOT NULL, dosage TEXT NOT NULL, time_administered TEXT NOT NULL,
            next_dose_reminder TEXT, notes TEXT,
            date TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))`,
      cols: ['id','user_id','group_id','name','dosage','time_administered','next_dose_reminder','notes','date','created_at']
    },
  };

  for (const [table, { ddl, cols }] of Object.entries(tables)) {
    // Read existing data (only columns that exist in both old and new schema)
    const existing = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
    const safeCols = cols.filter(c => existing.includes(c));
    const rows = db.prepare(`SELECT ${safeCols.join(',')} FROM ${table}`).all();

    db.prepare(`DROP TABLE ${table}`).run();
    db.prepare(`CREATE TABLE ${table} (${ddl})`).run();

    if (rows.length > 0) {
      const placeholders = safeCols.map(() => '?').join(',');
      const insert = db.prepare(`INSERT INTO ${table} (${safeCols.join(',')}) VALUES (${placeholders})`);
      for (const row of rows) insert.run(safeCols.map(c => row[c] ?? null));
    }

    console.log(`Rebuilt ${table}: ${rows.length} rows preserved`);
  }
});

try {
  rebuild();
  console.log('\nSuccess! All entry tables rebuilt without broken FK references.');
} catch (e) {
  console.error('Failed:', e.message);
  process.exit(1);
}
