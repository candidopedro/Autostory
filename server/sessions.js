// Sessões simples: cookie aleatório + armazenamento em arquivo (data/sessions.json).
// Para muitos usuários, troque por Redis/banco de dados.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const COOKIE = 'as_sid';
const MAX_AGE = 60 * 24 * 3600 * 1000; // 60 dias (validade do token longo do Instagram)
const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'sessions.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

let store = {};
try {
  store = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch {}

let timer;
function persist() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const now = Date.now();
    for (const [k, v] of Object.entries(store)) if (v.expires < now) delete store[k];
    fs.writeFileSync(FILE, JSON.stringify(store), { mode: 0o600 });
  }, 200);
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))])
  );
}

function middleware(req, res, next) {
  const sid = parseCookies(req.headers.cookie)[COOKIE];
  const existing = sid && store[sid] && store[sid].expires > Date.now() ? store[sid] : null;
  req.sessionId = existing ? sid : null;
  req.session = existing ? existing.data : {};
  req._res = res;
  next();
}

function save(req) {
  if (!req.sessionId) {
    req.sessionId = crypto.randomBytes(32).toString('hex');
    const secure = req.secure ? '; Secure' : '';
    req._res.append(
      'Set-Cookie',
      `${COOKIE}=${req.sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE / 1000}${secure}`
    );
  }
  store[req.sessionId] = { data: req.session, expires: Date.now() + MAX_AGE };
  persist();
}

function destroy(req, res) {
  if (req.sessionId) delete store[req.sessionId];
  res.append('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  persist();
}

module.exports = { middleware, save, destroy };
