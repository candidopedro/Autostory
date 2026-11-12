// Autostory tool v1.0 — servidor
require('./env');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { extractProduct } = require('./extract');
const sessions = require('./sessions');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || '';
const N8N_WEBHOOK_SECRET = process.env.N8N_WEBHOOK_SECRET || '';
const IG_APP_ID = process.env.IG_APP_ID || '';
const IG_APP_SECRET = process.env.IG_APP_SECRET || '';
const IG_REDIRECT_URI = process.env.IG_REDIRECT_URI || `${PUBLIC_BASE_URL}/auth/instagram/callback`;
const DEV_FAKE_LOGIN = process.env.DEV_FAKE_LOGIN === '1';
const GRAPH = 'https://graph.instagram.com/v21.0';

const GENERATED_DIR = path.join(__dirname, '..', 'generated');
fs.mkdirSync(GENERATED_DIR, { recursive: true });

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));
app.use(sessions.middleware);

app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));
// Imagens geradas precisam de URL pública: a API do Instagram baixa a imagem por URL.
app.use('/generated', express.static(GENERATED_DIR, { maxAge: '1h' }));

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error(err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Erro interno. Tente novamente.' });
  });

// ---------------- Extração ----------------
app.post(
  '/api/extract',
  wrap(async (req, res) => {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: 'Informe o link do produto.' });
    res.json(await extractProduct(url));
  })
);

// Proxy de imagens: o canvas precisa de imagens com CORS liberado.
// Restrito aos CDNs das lojas para não virar um proxy aberto.
const IMAGE_HOSTS = [
  /(^|\.)mlstatic\.com$/,
  /(^|\.)media-amazon\.com$/,
  /(^|\.)ssl-images-amazon\.com$/,
  /(^|\.)images-amazon\.com$/,
  /(^|\.)olx\.com\.br$/,
  /(^|\.)olxcdn\.com$/,
  /(^|\.)susercontent\.com$/,
  /(^|\.)shopee\.com\.br$/,
  /(^|\.)shopeemobile\.com$/,
];
app.get(
  '/api/image',
  wrap(async (req, res) => {
    let target;
    try {
      target = new URL(String(req.query.url || ''));
    } catch {
      return res.status(400).end();
    }
    if (target.protocol !== 'https:' || !IMAGE_HOSTS.some((re) => re.test(target.hostname))) return res.status(403).end();
    const upstream = await fetch(target.href, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36' },
      signal: AbortSignal.timeout(15000),
    });
    const type = upstream.headers.get('content-type') || '';
    if (!upstream.ok || !type.startsWith('image/')) return res.status(502).end();
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length > 15 * 1024 * 1024) return res.status(413).end();
    res.set({ 'Content-Type': type, 'Cache-Control': 'public, max-age=86400' }).send(buf);
  })
);

// ---------------- Login com Instagram ----------------
app.get('/api/me', (req, res) => {
  const ig = req.session.instagram;
  res.json({
    loggedIn: !!ig,
    username: ig?.username || null,
    picture: ig?.picture || null,
    loginAvailable: !!(IG_APP_ID && IG_APP_SECRET) || DEV_FAKE_LOGIN,
    postingAvailable: !!N8N_WEBHOOK_URL,
  });
});

app.get('/auth/instagram', (req, res) => {
  if (DEV_FAKE_LOGIN && !IG_APP_ID) {
    req.session.instagram = { userId: 'dev', username: 'conta_teste', accessToken: 'dev-token', picture: null };
    sessions.save(req);
    return res.redirect('/auth/done.html');
  }
  if (!IG_APP_ID || !IG_APP_SECRET) return res.status(503).send('Login com Instagram não configurado (IG_APP_ID / IG_APP_SECRET).');
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  sessions.save(req);
  const u = new URL('https://www.instagram.com/oauth/authorize');
  u.search = new URLSearchParams({
    client_id: IG_APP_ID,
    redirect_uri: IG_REDIRECT_URI,
    response_type: 'code',
    scope: 'instagram_business_basic,instagram_business_content_publish',
    state,
  });
  res.redirect(u.href);
});

app.get(
  '/auth/instagram/callback',
  wrap(async (req, res) => {
    const { code, state, error_description } = req.query;
    if (!code) return res.redirect('/auth/done.html?error=' + encodeURIComponent(error_description || 'Login cancelado.'));
    if (!state || state !== req.session.oauthState) return res.redirect('/auth/done.html?error=' + encodeURIComponent('Sessão de login inválida.'));
    delete req.session.oauthState;

    // 1) code -> token de curta duração
    const shortRes = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: IG_APP_ID,
        client_secret: IG_APP_SECRET,
        grant_type: 'authorization_code',
        redirect_uri: IG_REDIRECT_URI,
        code: String(code).replace(/#_$/, ''),
      }),
    });
    const shortJson = await shortRes.json();
    const short = shortJson.data?.[0] || shortJson;
    if (!short.access_token) throw Object.assign(new Error('Falha no login com Instagram.'), { status: 502 });

    // 2) token de longa duração (60 dias)
    const longRes = await fetch(
      `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(
        IG_APP_SECRET
      )}&access_token=${encodeURIComponent(short.access_token)}`
    );
    const long = await longRes.json();
    const accessToken = long.access_token || short.access_token;

    // 3) perfil
    const meRes = await fetch(`${GRAPH}/me?fields=user_id,username,profile_picture_url&access_token=${encodeURIComponent(accessToken)}`);
    const me = await meRes.json();

    req.session.instagram = {
      userId: String(me.user_id || short.user_id),
      username: me.username || '',
      picture: me.profile_picture_url || null,
      accessToken,
      expiresAt: long.expires_in ? Date.now() + long.expires_in * 1000 : null,
    };
    sessions.save(req);
    res.redirect('/auth/done.html');
  })
);

app.post('/api/logout', (req, res) => {
  sessions.destroy(req, res);
  res.json({ ok: true });
});

// ---------------- Postagem (via n8n) ----------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype === 'image/jpeg'),
});

app.post(
  '/api/post',
  upload.array('images', 10),
  wrap(async (req, res) => {
    const ig = req.session.instagram;
    if (!ig) return res.status(401).json({ error: 'Faça login no Instagram para postar.' });
    if (!N8N_WEBHOOK_URL) return res.status(503).json({ error: 'Webhook do n8n não configurado (N8N_WEBHOOK_URL).' });
    if (!req.files?.length) return res.status(400).json({ error: 'Nenhuma imagem recebida.' });

    const imageUrls = req.files.map((f) => {
      const name = `${Date.now()}-${crypto.randomBytes(12).toString('hex')}.jpg`;
      fs.writeFileSync(path.join(GENERATED_DIR, name), f.buffer);
      return `${PUBLIC_BASE_URL}/generated/${name}`;
    });

    const headers = { 'Content-Type': 'application/json' };
    if (N8N_WEBHOOK_SECRET) headers['X-Autostory-Secret'] = N8N_WEBHOOK_SECRET;
    const n8nRes = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        type: 'instagram_story',
        images: imageUrls,
        product: {
          url: req.body.productUrl || '',
          title: req.body.title || '',
          price: req.body.price || '',
          condition: req.body.condition || '',
        },
        instagram: { userId: ig.userId, username: ig.username, accessToken: ig.accessToken },
      }),
      signal: AbortSignal.timeout(120000),
    });
    let data = {};
    try {
      data = await n8nRes.json();
    } catch {}
    if (!n8nRes.ok || data.ok === false)
      return res.status(502).json({ error: data.error || `O fluxo do n8n retornou erro (${n8nRes.status}).` });
    res.json({ ok: true, posted: imageUrls.length, result: data });
  })
);

// Limpeza: apaga imagens geradas com mais de 24h
setInterval(() => {
  const limit = Date.now() - 24 * 3600 * 1000;
  for (const f of fs.readdirSync(GENERATED_DIR)) {
    const p = path.join(GENERATED_DIR, f);
    if (fs.statSync(p).mtimeMs < limit) fs.unlinkSync(p);
  }
}, 3600 * 1000).unref();

app.listen(PORT, () => console.log(`Autostory rodando em http://localhost:${PORT}`));
