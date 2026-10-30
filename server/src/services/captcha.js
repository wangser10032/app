const crypto = require('node:crypto');
const { deflateSync } = require('node:zlib');
const db = require('../db');
const config = require('../config');
const { fail } = require('../utils/errors');

const TTL_MS = 5 * 60000;
const MAX_ACTIVE = 5000;
// A small raster font keeps the challenge self-contained. The response contains
// only PNG pixels, never selectable SVG text, an answer field, or a client secret.
const GLYPHS = {
  '2': ['01110','10001','00001','00010','00100','01000','11111'],
  '3': ['11110','00001','00001','01110','00001','00001','11110'],
  '4': ['00010','00110','01010','10010','11111','00010','00010'],
  '5': ['11111','10000','10000','11110','00001','00001','11110'],
  '6': ['01110','10000','10000','11110','10001','10001','01110'],
  '7': ['11111','00001','00010','00100','01000','01000','01000'],
  '8': ['01110','10001','10001','01110','10001','10001','01110'],
  '9': ['01110','10001','10001','01111','00001','00001','01110'],
  A: ['01110','10001','10001','11111','10001','10001','10001'],
  C: ['01111','10000','10000','10000','10000','10000','01111'],
  E: ['11111','10000','10000','11110','10000','10000','11111'],
  F: ['11111','10000','10000','11110','10000','10000','10000'],
  H: ['10001','10001','10001','11111','10001','10001','10001'],
  J: ['00111','00010','00010','00010','00010','10010','01100'],
  K: ['10001','10010','10100','11000','10100','10010','10001'],
  M: ['10001','11011','10101','10101','10001','10001','10001'],
  N: ['10001','11001','11001','10101','10011','10011','10001'],
  P: ['11110','10001','10001','11110','10000','10000','10000'],
  R: ['11110','10001','10001','11110','10100','10010','10001'],
  T: ['11111','00100','00100','00100','00100','00100','00100'],
  U: ['10001','10001','10001','10001','10001','10001','01110'],
  W: ['10001','10001','10001','10101','10101','10101','01010'],
  X: ['10001','10001','01010','00100','01010','10001','10001'],
  Y: ['10001','10001','01010','00100','00100','00100','00100'],
};
const ALPHABET = Object.keys(GLYPHS).join('');
const mac = value => crypto.createHmac('sha256', config.jwtSecret).update(`resihub:captcha:${value}`).digest('hex');
const answerHash = (id, purpose, answer) => mac(`answer:${id}:${purpose}:${answer}`);
const requesterHash = requester => mac(`requester:${requester || ''}`);

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let n = value;
  for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function chunk(type, contents) {
  const data = Buffer.concat([Buffer.from(type), contents]);
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(contents.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, data, checksum]);
}
function renderImage(answer) {
  const width = 196, height = 60, stride = width * 3 + 1;
  const pixels = Buffer.alloc(height * stride);
  const put = (x, y, rgb) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const offset = y * stride + 1 + x * 3;
    for (let c = 0; c < 3; c++) pixels[offset + c] = rgb[c];
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) put(x, y, [242, 246, 251]);
  for (let n = 0; n < 220; n++) put(crypto.randomInt(width), crypto.randomInt(height), [163, 183, 208]);
  [...answer].forEach((letter, index) => {
    const angle = crypto.randomInt(-12, 13) * Math.PI / 180;
    const originX = 14 + index * 35 + crypto.randomInt(-2, 3), originY = 13 + crypto.randomInt(-3, 4);
    const color = [crypto.randomInt(30, 65), crypto.randomInt(50, 85), crypto.randomInt(95, 140)];
    const glyph = GLYPHS[letter];
    for (let y = 0; y < 28; y++) for (let x = 0; x < 20; x++) {
      if (glyph[Math.floor(y / 4)][Math.floor(x / 4)] !== '1') continue;
      const dx = x - 10, dy = y - 14;
      put(originX + 10 + dx * Math.cos(angle) - dy * Math.sin(angle), originY + 14 + dx * Math.sin(angle) + dy * Math.cos(angle), color);
    }
  });
  for (let n = 0; n < 2; n++) {
    const start = crypto.randomInt(8, 50), slope = crypto.randomInt(-10, 11) / 100;
    for (let x = 4; x < width - 4; x++) put(x, start + x * slope, [134, 155, 182]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

function createCaptcha(purpose, requester) {
  const now = Date.now(), id = crypto.randomUUID();
  let answer = '';
  for (let i = 0; i < 5; i++) answer += ALPHABET[crypto.randomInt(ALPHABET.length)];
  const image = renderImage(answer);
  db.transaction(() => {
    db.prepare('DELETE FROM human_challenges WHERE expires_at<=?').run(now);
    if (db.prepare('SELECT COUNT(*) AS n FROM human_challenges').get().n >= MAX_ACTIVE) fail(429, 'RATE_LIMITED', '验证请求较多，请稍后再试');
    db.prepare('INSERT INTO human_challenges(id,purpose,answer_hash,requester_hash,expires_at) VALUES(?,?,?,?,?)')
      .run(id, purpose, answerHash(id, purpose, answer), requesterHash(requester), now + TTL_MS);
  })();
  return { id, image, expires_at: now + TTL_MS };
}

function consumeCaptcha(challenge, purpose, requester) {
  if (!challenge?.id || typeof challenge.answer !== 'string') fail(400, 'CAPTCHA_REQUIRED', '请先完成人机验证');
  // Take the row out before validation. Wrong answers, wrong purpose and replay
  // all consume the challenge, including concurrent attempts across processes.
  const row = db.transaction(() => {
    const item = db.prepare('SELECT * FROM human_challenges WHERE id=?').get(challenge.id);
    if (item) db.prepare('DELETE FROM human_challenges WHERE id=?').run(item.id);
    return item;
  })();
  if (!row) fail(400, 'CAPTCHA_INVALID', '图形验证码无效，请刷新后重试');
  if (row.expires_at <= Date.now()) fail(400, 'CAPTCHA_EXPIRED', '图形验证码已过期，请刷新后重试');
  const normalized = challenge.answer.trim().toUpperCase();
  const actual = answerHash(row.id, purpose, normalized);
  if (row.purpose !== purpose || row.requester_hash !== requesterHash(requester) || !crypto.timingSafeEqual(Buffer.from(row.answer_hash, 'hex'), Buffer.from(actual, 'hex'))) {
    fail(400, 'CAPTCHA_INVALID', '图形验证码错误，请重新输入');
  }
}

module.exports = { createCaptcha, consumeCaptcha };
