const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
async function main() {
  const source = require('../src/config').dbPath;
  const destination = process.argv[2];
  if (!destination || path.resolve(source) === path.resolve(destination)) throw new Error('Provide a separate backup destination');
  fs.mkdirSync(path.dirname(path.resolve(destination)), { recursive: true });
  const db = new Database(source, { readonly: true });
  try { await db.backup(destination); console.log(`Backup completed: ${destination}`); } finally { db.close(); }
}
main().catch(err => { console.error(err.message); process.exitCode = 1; });
