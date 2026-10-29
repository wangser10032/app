const db = require('../db');
const getSettings = () => Object.fromEntries(db.prepare("SELECT key,value FROM settings WHERE key IN ('site_name','announcement')").all().map(r => [r.key, r.value]));
function setSettings(data) {
  db.transaction(() => {
    const put = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    for (const [key, value] of Object.entries(data)) put.run(key, String(value));
  })();
  return getSettings();
}
module.exports = { getSettings, setSettings };
