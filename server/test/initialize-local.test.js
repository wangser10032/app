const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const Database = require('better-sqlite3');
const { initializeLocal } = require('../scripts/initialize-local');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'resihub-init-'));
after(() => fs.rmSync(temp, { recursive: true, force: true }));
let next = 0;
function setup(contents = 'JWT_SECRET=change-me-to-a-long-random-string\nADMIN_EMAIL=\nADMIN_PASSWORD=\nREGISTER_REQUIRE_CODE=false\nDB_PATH=./data/business.db\n') {
  const projectRoot = path.join(temp, String(++next)); const serverRoot = path.join(projectRoot, 'server'); fs.mkdirSync(serverRoot, { recursive: true });
  fs.writeFileSync(path.join(serverRoot, '.env.example'), contents); return { projectRoot, serverRoot, environment: { NODE_ENV: 'test' } };
}
function readEnv(options) { return dotenv.parse(fs.readFileSync(path.join(options.serverRoot, '.env'))); }
function existingDb(options, primaryPassword) {
  const dir = path.join(options.serverRoot, 'data'); fs.mkdirSync(dir);
  const db = new Database(path.join(dir, 'business.db'));
  db.exec('CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT,role TEXT,status TEXT,password_hash TEXT,balance_cents INTEGER,token_version INTEGER,created_at INTEGER); CREATE TABLE orders(id TEXT,amount_cents INTEGER);');
  db.prepare("INSERT INTO users VALUES('admin','admin@resihub.local','admin','active',?,321,7,1)").run(bcrypt.hashSync(primaryPassword, 4));
  db.prepare("INSERT INTO users VALUES('buyer','buyer@example.test','user','active',?,12345,2,2)").run(bcrypt.hashSync('Buyer-kept-password', 4));
  db.exec("INSERT INTO orders VALUES('real-order',990)"); db.close();
}
test('copies missing env, creates random local credentials, enables email codes and does not seed a DB', () => {
  const options = setup(); const result = initializeLocal(options); const values = readEnv(options);
  assert.match(values.JWT_SECRET, /^[a-f0-9]{64}$/); assert.ok(values.ADMIN_PASSWORD.length >= 20); assert.notEqual(values.ADMIN_PASSWORD, 'Admin@123456');
  assert.equal(values.ADMIN_EMAIL, 'admin@resihub.local'); assert.equal(values.REGISTER_REQUIRE_CODE, 'true'); assert.equal(fs.existsSync(result.dbPath), false);
  assert.equal(result.databaseState, 'new'); assert.match(fs.readFileSync(result.accessPath, 'utf8'), /首次启动时创建/);
  if (process.platform !== 'win32') { assert.equal(fs.statSync(result.envPath).mode & 0o777, 0o600); assert.equal(fs.statSync(result.accessPath).mode & 0o777, 0o600); }
  const again = initializeLocal(options); assert.deepEqual(readEnv(options), values); assert.equal(again.jwtChanged, false);
});
test('preserves custom secrets and unrelated configuration', () => {
  const options = setup('# comment\nJWT_SECRET=custom-non-placeholder-secret-abcdefghijklmnopqrstuvwxyz\nADMIN_EMAIL=custom@example.test\nADMIN_PASSWORD=CustomPassword@12345\nSMTP_FROM="ResiHub local <local@example.test>"\nREGISTER_REQUIRE_CODE=false\n');
  initializeLocal(options); const values = readEnv(options); assert.equal(values.JWT_SECRET, 'custom-non-placeholder-secret-abcdefghijklmnopqrstuvwxyz'); assert.equal(values.ADMIN_PASSWORD, 'CustomPassword@12345'); assert.equal(values.SMTP_FROM, 'ResiHub local <local@example.test>'); assert.equal(values.REGISTER_REQUIRE_CODE, 'true');
  assert.match(fs.readFileSync(path.join(options.serverRoot, '.env'), 'utf8'), /^# comment/m);
});
test('rotates only the existing built-in default administrator and preserves business records', () => {
  const options = setup(); existingDb(options, 'Admin@123456'); const result = initializeLocal(options); const values = readEnv(options);
  const db = new Database(result.dbPath); const admin = db.prepare("SELECT * FROM users WHERE id='admin'").get();
  assert.equal(bcrypt.compareSync(values.ADMIN_PASSWORD, admin.password_hash), true); assert.equal(admin.balance_cents, 321); assert.equal(admin.token_version, 8);
  const buyer = db.prepare("SELECT * FROM users WHERE id='buyer'").get(); assert.equal(bcrypt.compareSync('Buyer-kept-password', buyer.password_hash), true); assert.equal(buyer.balance_cents, 12345);
  assert.deepEqual(db.prepare('SELECT * FROM orders').get(), { id: 'real-order', amount_cents: 990 }); db.close(); assert.equal(result.changedAdmins, 1);
});
test('never resets a non-default admin or claims an unrelated generated password works', () => {
  const options = setup(); existingDb(options, 'AlreadyChanged@12345'); const result = initializeLocal(options);
  const db = new Database(result.dbPath); const admin = db.prepare("SELECT * FROM users WHERE id='admin'").get(); assert.equal(bcrypt.compareSync('AlreadyChanged@12345', admin.password_hash), true); assert.equal(admin.token_version, 7); db.close();
  const access = fs.readFileSync(result.accessPath, 'utf8'); assert.match(access, /保留现有密码/); assert.equal(access.includes(readEnv(options).ADMIN_PASSWORD), false); assert.equal(result.changedAdmins, 0);
});
test('recognizes an existing admin when env password matches without resetting its hash', () => {
  const options = setup('ADMIN_PASSWORD=AlreadyChanged@12345\n'); existingDb(options, 'AlreadyChanged@12345');
  // Use the fixture's explicit DB relative path, rather than the default resihub.db.
  options.environment.DB_PATH = './data/business.db'; const result = initializeLocal(options); const db = new Database(result.dbPath);
  assert.equal(db.prepare("SELECT token_version FROM users WHERE id='admin'").get().token_version, 7); db.close(); assert.match(fs.readFileSync(result.accessPath, 'utf8'), /已核对现有密码/);
});
test('refuses production before writing any file, including production defined inside env', () => {
  const options = setup(); options.environment.NODE_ENV = 'production'; assert.throws(() => initializeLocal(options), /production/); assert.equal(fs.existsSync(path.join(options.serverRoot, '.env')), false);
  const fromFile = setup('NODE_ENV=production\n'); assert.throws(() => initializeLocal(fromFile), /production/); assert.equal(fs.existsSync(path.join(fromFile.serverRoot, '.env')), false);
});
