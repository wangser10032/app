// Development-only bootstrap. This deliberately does not import config/db or start a server.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

const builtinPassword = 'Admin@123456';
// Match entire conventional template values; a custom secret merely containing
// words such as "placeholder" or "example" must never be silently rotated.
const placeholders = new Set(['change-me-to-a-long-random-string', 'dev-insecure-secret-change-me', 'change-me', 'changeme', 'replace-me', 'replace-with-a-long-random-string', 'your-jwt-secret', 'your_jwt_secret', 'your-secret', 'your_secret', 'jwt-secret', 'jwt_secret', 'placeholder', 'example', 'secret']);
const isPlaceholder = value => !value?.trim() || placeholders.has(value.trim().toLowerCase());
function writePrivate(file, contents) {
  const temporary = `${file}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    fs.writeFileSync(temporary, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, file);
    fs.chmodSync(file, 0o600);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function upsert(text, key, value) {
  const lines = text.split(/\r?\n/); const pattern = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`); let replaced = false;
  const result = lines.filter(line => {
    if (!pattern.test(line)) return true;
    if (replaced) return false;
    replaced = true; return true;
  }).map(line => pattern.test(line) ? `${key}=${JSON.stringify(String(value))}` : line);
  if (!replaced) { if (result.at(-1) === '') result.pop(); result.push(`${key}=${JSON.stringify(String(value))}`, ''); }
  return result.join('\n');
}
function initializeLocal(options = {}) {
  const environment = options.environment || process.env;
  if (environment.NODE_ENV === 'production') throw new Error('initialize-local 仅供开发环境使用，拒绝在 NODE_ENV=production 下执行');
  const serverRoot = options.serverRoot || path.resolve(__dirname, '..');
  const projectRoot = options.projectRoot || path.dirname(serverRoot);
  const envPath = path.join(serverRoot, '.env');
  const existed = fs.existsSync(envPath);
  let contents = fs.readFileSync(existed ? envPath : path.join(serverRoot, '.env.example'), 'utf8');
  const values = dotenv.parse(contents);
  if (values.NODE_ENV === 'production') throw new Error('initialize-local 拒绝修改 NODE_ENV=production 的 .env');
  const set = (key, value) => { values[key] = String(value); contents = upsert(contents, key, value); };
  // Use explicit startup overrides when present, matching dotenv's normal precedence.
  for (const key of ['JWT_SECRET', 'PROXY_CREDENTIAL_SECRET', 'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'DB_PATH']) {
    if (typeof environment[key] === 'string' && environment[key].trim()) set(key, environment[key]);
  }
  const jwtChanged = isPlaceholder(values.JWT_SECRET);
  if (jwtChanged) set('JWT_SECRET', crypto.randomBytes(32).toString('hex'));
  if (isPlaceholder(values.PROXY_CREDENTIAL_SECRET)) set('PROXY_CREDENTIAL_SECRET', crypto.randomBytes(32).toString('hex'));
  set('REGISTER_REQUIRE_CODE', 'true');
  if (!values.ADMIN_EMAIL?.trim()) set('ADMIN_EMAIL', 'admin@resihub.local');
  if (!values.ADMIN_PASSWORD || values.ADMIN_PASSWORD === builtinPassword) set('ADMIN_PASSWORD', crypto.randomBytes(24).toString('base64url'));
  // Match the seed's constraints before changing either the environment or database.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.ADMIN_EMAIL) || values.ADMIN_PASSWORD.length < 12 || Buffer.byteLength(values.ADMIN_PASSWORD) > 72) throw new Error('本地 ADMIN_EMAIL 或 ADMIN_PASSWORD 不符合初始化要求');
  if (!existed || contents !== fs.readFileSync(envPath, 'utf8')) writePrivate(envPath, contents);
  else fs.chmodSync(envPath, 0o600);

  const dbPath = path.isAbsolute(values.DB_PATH || '') ? values.DB_PATH : path.join(serverRoot, values.DB_PATH || 'data/resihub.db');
  let administrators = []; let databaseState = 'new'; let changedAdmins = 0;
  if (fs.existsSync(dbPath)) {
    const db = new Database(dbPath, { fileMustExist: true });
    try {
      db.pragma('busy_timeout = 5000');
      const hasUsers = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
      if (hasUsers) {
        const userCount = db.prepare('SELECT COUNT(*) n FROM users').get().n;
        databaseState = userCount ? 'existing' : 'new';
        if (userCount) {
          const columns = new Set(db.prepare('PRAGMA table_info(users)').all().map(row => row.name));
          // No seeding/migration/schema replacement here; only built-in default passwords may change.
          administrators = db.transaction(() => {
            const rows = db.prepare("SELECT id,email,password_hash,status FROM users WHERE role='admin' ORDER BY created_at,id").all();
            return rows.map(row => {
              let changed = false;
              if (bcrypt.compareSync(builtinPassword, row.password_hash)) {
                const hash = bcrypt.hashSync(values.ADMIN_PASSWORD, 12);
                const result = db.prepare(`UPDATE users SET password_hash=?${columns.has('token_version') ? ',token_version=token_version+1' : ''} WHERE id=? AND password_hash=?`).run(hash, row.id, row.password_hash);
                if (result.changes) { changed = true; changedAdmins++; row.password_hash = hash; }
              }
              return { email: row.email, status: row.status, known: bcrypt.compareSync(values.ADMIN_PASSWORD, row.password_hash), changed };
            });
          }).immediate();
        }
      }
    } finally { db.close(); }
  }
  if (databaseState === 'new') administrators = [{ email: values.ADMIN_EMAIL, status: 'active', known: true, pendingSeed: true }];
  const localDir = path.join(projectRoot, '.local');
  fs.mkdirSync(localDir, { recursive: true, mode: 0o700 }); fs.chmodSync(localDir, 0o700);
  const accessPath = path.join(localDir, 'ACCESS.md');
  const port = /^\d+$/.test(values.PORT || '') ? Number(values.PORT) : 8080;
  const blocks = administrators.map(admin => {
    const lines = [`### ${admin.email}`, '', `账号状态：${admin.status === 'active' ? '启用' : '停用，无法登录'}`];
    if (admin.known) {
      lines.push('', '```text', `邮箱：${admin.email}`, `密码：${values.ADMIN_PASSWORD}`, '```', '', admin.pendingSeed ? '上述管理员会在 API 首次启动时创建。' : admin.changed ? '已将内置默认密码替换为 .env 配置的凭据，原登录令牌已失效（数据库支持 token_version 时）。' : '已核对现有密码与 .env 中的 ADMIN_PASSWORD 一致。');
    } else lines.push('', '保留现有密码。该账号的密码与 .env 中的 ADMIN_PASSWORD 不一致；初始化程序未重置密码，.env 候选密码不能用于此账号登录。');
    return lines.join('\n');
  });
  if (!administrators.length) blocks.push('现有业务数据库没有管理员账号。初始化程序未创建账号，也未修改业务数据；.env 中的 ADMIN_PASSWORD 并不代表现有账号可用的登录凭据。');
  const access = ['# ResiHub 本机开发访问', '', `用户前台：http://localhost:${port}/`, `管理后台：http://localhost:${port}/admin/`, '', ...blocks, '', '注册已开启邮箱验证码验证。MAIL_MODE=mock 时验证码会显示在开发注册页面；模拟充值仅用于本机联调。', '', '此文件包含本机开发凭据，应留在被 Git 忽略的 .local 目录中。初始化程序不会将密码或 JWT 密钥输出到终端。', '', '运行方式：开发启动脚本会先执行本初始化，再启动 API。此脚本本身不会启动 API。', ''].join('\n');
  writePrivate(accessPath, access);
  return { envPath, accessPath, dbPath, databaseState, jwtChanged, changedAdmins, adminCount: administrators.length };
}
if (require.main === module) {
  try { initializeLocal(); console.log('[initialize-local] 本机开发环境已准备；访问说明位于 .local/ACCESS.md（未输出凭据）'); }
  catch (error) { console.error('[initialize-local] 初始化失败：', error.code || error.message); process.exitCode = 1; }
}
module.exports = { initializeLocal };
