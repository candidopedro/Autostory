// Extração de imagens, título e preço de produtos do Mercado Livre, OLX, Shopee e Amazon.
const cheerio = require('cheerio');

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
// Alguns sites (Shopee) só entregam meta tags completas para crawlers de preview.
const PREVIEW_UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';

const MAX_IMAGES = 10;

function detectStore(hostname) {
  const h = hostname.toLowerCase();
  if (/(^|\.)(mercadolivre|mercadolibre)\.|(^|\.)meli\.la$|mlstatic/.test(h)) return 'mercadolivre';
  if (/(^|\.)olx\./.test(h)) return 'olx';
  if (/(^|\.)shopee\.|(^|\.)shp\.ee$/.test(h)) return 'shopee';
  if (/(^|\.)amazon\.|(^|\.)amzn\.(to|eu|asia)$|(^|\.)a\.co$/.test(h)) return 'amazon';
  return null;
}

async function fetchHtml(url, ua = BROWSER_UA) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': ua,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
    },
    signal: AbortSignal.timeout(15000),
  });
  const html = await res.text();
  return { html, finalUrl: res.url, status: res.status };
}

const decode = (s) =>
  s
    .replace(/\\u002F/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&');

function uniq(list, keyFn = (x) => x) {
  const seen = new Set();
  return list.filter((x) => {
    if (!x) return false;
    const k = keyFn(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function absolutize(u, base) {
  try {
    if (u.startsWith('//')) return 'https:' + u;
    return new URL(u, base).href;
  } catch {
    return null;
  }
}

// ---------- Genérico (Open Graph + JSON-LD) ----------
function generic($, base) {
  const images = [];
  let title = $('meta[property="og:title"]').attr('content') || $('title').first().text() || '';
  let price = $('meta[property="product:price:amount"]').attr('content') || '';
  let currency = $('meta[property="product:price:currency"]').attr('content') || 'BRL';

  $('script[type="application/ld+json"]').each((_, el) => {
    let data;
    try {
      data = JSON.parse($(el).contents().text());
    } catch {
      return;
    }
    const nodes = [].concat(data['@graph'] || data);
    for (const n of nodes) {
      if (!n || !/product/i.test([].concat(n['@type']).join(','))) continue;
      if (n.name && !title) title = n.name;
      [].concat(n.image || []).forEach((img) => images.push(typeof img === 'string' ? img : img?.url));
      const offer = [].concat(n.offers || [])[0];
      if (offer) {
        price = price || offer.price || offer.lowPrice || '';
        currency = offer.priceCurrency || currency;
      }
    }
  });

  $('meta[property="og:image"], meta[property="og:image:secure_url"], meta[name="twitter:image"]').each((_, el) =>
    images.push($(el).attr('content'))
  );

  return {
    title: title.trim(),
    price: String(price || ''),
    currency,
    images: images.filter(Boolean).map((u) => absolutize(decode(u), base)),
  };
}

// ---------- Mercado Livre ----------
function mercadolivre($, html) {
  const ids = [];
  // Galeria: data-zoom / src com o padrão D_NQ_NP_<id>-<sufixo>
  const re = /https?:\/\/http2\.mlstatic\.com\/D_(?:NQ_NP_)?(?:2X_)?(\d+-[A-Z]{3}\d+_\d+)-[A-Z]{1,2}\.(?:webp|jpg|jpeg|png)/g;
  const gallery = [];
  $('.ui-pdp-gallery img, figure.ui-pdp-gallery__figure img').each((_, el) => {
    const u = $(el).attr('data-zoom') || $(el).attr('data-src') || $(el).attr('src');
    if (u) gallery.push(u);
  });
  for (const src of gallery.length ? gallery : [html]) {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(src))) ids.push(m[1]);
  }
  const images = uniq(ids).map((id) => `https://http2.mlstatic.com/D_NQ_NP_2X_${id}-F.webp`);
  const title = $('h1.ui-pdp-title').first().text().trim();
  const price = $('meta[itemprop="price"]').attr('content') || '';
  return { images, title, price };
}

// ---------- Amazon ----------
function amazon($, html) {
  const images = [];
  // Bloco colorImages / ImageBlockATF: "hiRes":"...", "large":"..."
  const block = html.match(/'colorImages'\s*:\s*\{\s*'initial'\s*:\s*(\[[\s\S]*?\])\s*\}/);
  if (block) {
    try {
      JSON.parse(block[1]).forEach((i) => images.push(i.hiRes || i.large));
    } catch {}
  }
  if (!images.length) {
    const re = /"hiRes"\s*:\s*"(https:[^"]+)"/g;
    let m;
    while ((m = re.exec(html))) images.push(m[1]);
  }
  const landing = $('#landingImage');
  if (landing.length) {
    images.push(landing.attr('data-old-hires'));
    const dyn = landing.attr('data-a-dynamic-image');
    if (dyn) {
      try {
        const entries = Object.entries(JSON.parse(dyn)).sort((a, b) => b[1][0] - a[1][0]);
        if (entries[0]) images.push(entries[0][0]);
      } catch {}
    }
  }
  // Normaliza para a maior resolução (remove modificadores ._AC_SX679_.)
  const norm = images
    .filter(Boolean)
    .map((u) => u.replace(/\._[^/]*_\.(jpg|jpeg|png|webp)$/i, '.$1'));
  const title = $('#productTitle').text().trim();
  const whole = $('.a-price .a-price-whole').first().text().replace(/[^\d]/g, '');
  const frac = $('.a-price .a-price-fraction').first().text().replace(/[^\d]/g, '');
  const price = whole ? `${whole}.${frac || '00'}` : '';
  return { images: uniq(norm, (u) => u.split('/').pop()), title, price };
}

// ---------- OLX ----------
function olx($, html) {
  const images = [];
  const next = $('#__NEXT_DATA__').contents().text();
  const sources = [next, $('#initial-data').attr('data-json') || '', html];
  const re = /https?:\\?\/\\?\/img\.olx\.com\.br\\?\/images\\?\/(\d+)\\?\/(\d+)\.(?:jpg|jpeg|webp|png)/g;
  for (const s of sources) {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(decode(s || '')))) images.push(`https://img.olx.com.br/images/${m[1]}/${m[2]}.jpg`);
    if (images.length) break;
  }
  const title = $('h1').first().text().trim();
  const priceMatch = decode(next || html).match(/"price"\s*:\s*"?R?\$?\s?([\d.,]+)"?/);
  return { images: uniq(images, (u) => u.split('/').pop()), title, price: priceMatch ? priceMatch[1] : '' };
}

// ---------- Shopee ----------
function shopee($, html) {
  const ids = [];
  const re = /https?:\\?\/\\?\/(?:down-[a-z]{2}\.img\.susercontent\.com|cf\.shopee\.com\.br)\\?\/file\\?\/([a-z0-9-]+_?[a-z0-9]*)/gi;
  let m;
  while ((m = re.exec(html))) ids.push(m[1].replace(/_tn$/, ''));
  // ids de imagem podem aparecer como "images":["abc123", ...]
  const arr = html.match(/"images"\s*:\s*\[([^\]]+)\]/);
  if (arr) (arr[1].match(/"([a-z0-9-]{20,})"/gi) || []).forEach((s) => ids.push(s.replace(/"/g, '')));
  const images = uniq(ids).map((id) => `https://down-br.img.susercontent.com/file/${id}`);
  return { images, title: '', price: '' };
}

// Mesma foto em tamanhos diferentes conta como uma só
function imageKey(u) {
  const ml = u.match(/mlstatic\.com\/D_(?:NQ_NP_)?(?:2X_)?(\d+-[A-Z]{3}\d+_\d+)/);
  if (ml) return 'ml:' + ml[1];
  const amz = u.match(/\/images\/I\/([\w+-]+?)(?:\.|$)/);
  if (amz) return 'amz:' + amz[1];
  const olx = u.match(/img\.olx\.com\.br\/.*\/(\d+)\.\w+$/);
  if (olx) return 'olx:' + olx[1];
  const sh = u.match(/susercontent\.com\/file\/([\w-]+?)(?:_tn)?$/);
  if (sh) return 'sh:' + sh[1];
  return u;
}

const EXTRACTORS = { mercadolivre, amazon, olx, shopee };

async function extractProduct(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw Object.assign(new Error('URL inválida.'), { status: 400 });
  }
  if (!/^https?:$/.test(url.protocol)) throw Object.assign(new Error('URL inválida.'), { status: 400 });
  if (!detectStore(url.hostname))
    throw Object.assign(new Error('Loja não suportada. Use Mercado Livre, OLX, Shopee ou Amazon.'), { status: 400 });

  let { html, finalUrl } = await fetchHtml(url.href);
  const store = detectStore(new URL(finalUrl).hostname) || detectStore(url.hostname);

  let $ = cheerio.load(html);
  let specific = EXTRACTORS[store]($, html);
  let base = generic($, finalUrl);

  // Shopee e páginas protegidas: tenta de novo como crawler de preview
  if (!specific.images.length && !base.images.length) {
    const retry = await fetchHtml(finalUrl, PREVIEW_UA);
    $ = cheerio.load(retry.html);
    specific = EXTRACTORS[store]($, retry.html);
    base = generic($, retry.finalUrl);
  }

  const images = uniq([...specific.images, ...base.images].filter((u) => u && /^https?:/.test(u)), imageKey).slice(0, MAX_IMAGES);
  if (!images.length)
    throw Object.assign(new Error('Não foi possível encontrar imagens nesse link. Você pode adicionar as fotos manualmente.'), {
      status: 422,
    });

  return {
    store,
    url: finalUrl,
    title: (specific.title || base.title || '').replace(/\s+/g, ' ').slice(0, 140),
    price: specific.price || base.price || '',
    currency: base.currency || 'BRL',
    images,
  };
}

module.exports = { extractProduct, detectStore };
