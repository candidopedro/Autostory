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

// ---------- Leitura do HTML ----------
// Pega a melhor URL de um <img>/<source>: zoom > hi-res > maior do srcset > lazy > src
function bestFromSrcset(srcset) {
  if (!srcset) return null;
  const parts = srcset
    .split(',')
    .map((s) => s.trim().split(/\s+/))
    .filter((p) => p[0])
    .map(([u, d = '1x']) => [u, parseFloat(d) || 1]);
  parts.sort((a, b) => b[1] - a[1]);
  return parts[0]?.[0] || null;
}
function imgUrl($el) {
  return (
    $el.attr('data-zoom') ||
    $el.attr('data-old-hires') ||
    bestFromSrcset($el.attr('data-srcset') || $el.attr('srcset')) ||
    $el.attr('data-src') ||
    $el.attr('data-lazy') ||
    $el.attr('src') ||
    null
  );
}
function bgUrl(style) {
  const m = (style || '').match(/background-image\s*:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/i);
  return m ? m[1] : null;
}
// Coleta imagens de um seletor: o próprio elemento pode ser o <img> ou um contêiner dele
function collect($, selector, base) {
  const out = [];
  $(selector).each((_, el) => {
    const $el = $(el);
    const nodes = $el.is('img, source') ? [$el] : $el.find('img, source').toArray().map((n) => $(n));
    for (const $n of nodes) out.push(imgUrl($n));
    out.push(bgUrl($el.attr('style')));
    $el.find('[style*="background-image"]').each((_, n) => out.push(bgUrl($(n).attr('style'))));
  });
  return out
    .filter((u) => u && !u.startsWith('data:'))
    .map((u) => absolutize(decode(u), base))
    .filter(Boolean);
}
// Primeiro texto não vazio entre vários seletores
function text($, ...selectors) {
  for (const s of selectors) {
    const t = $(s).first().text().replace(/\s+/g, ' ').trim();
    if (t) return t;
  }
  return '';
}
// "R$ 1.299,90" -> "1299.90"
function money(t) {
  const m = String(t || '').match(/\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?/);
  if (!m) return '';
  let v = m[0];
  if (v.includes(',')) v = v.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(v)) v = v.replace(/\./g, '');
  return Number(v) > 0 ? v : '';
}
// Preço no formato andes (Mercado Livre): fração + centavos
function andesMoney($, root) {
  const $r = $(root).first();
  if (!$r.length) return '';
  const frac = $r.find('.andes-money-amount__fraction').first().text().replace(/\D/g, '');
  const cents = $r.find('.andes-money-amount__cents').first().text().replace(/\D/g, '');
  return frac ? `${frac}.${cents || '00'}` : '';
}

// ---------- Mercado Livre ----------
// Imagens: img.ui-pdp-image.ui-pdp-gallery__figure__image
function mercadolivre($, html, base) {
  let raw = collect($, 'img.ui-pdp-image.ui-pdp-gallery__figure__image', base);
  if (!raw.length) raw = collect($, '.ui-pdp-gallery img, figure.ui-pdp-gallery__figure img', base);
  // Converte para a versão em alta resolução (D_NQ_NP_2X_<id>-F)
  const re = /mlstatic\.com\/D_(?:N?Q_NP_)?(?:2X_)?(\d+-[A-Z]{3}\d+_\d+)-[A-Z]{1,2}\.(?:webp|jpg|jpeg|png)/;
  const images = raw.map((u) => {
    const m = u.match(re);
    return m ? `https://http2.mlstatic.com/D_NQ_NP_2X_${m[1]}-F.webp` : u;
  });
  const title = text($, 'h1.ui-pdp-title');
  const price =
    andesMoney($, '.ui-pdp-price__second-line') ||
    $('meta[itemprop="price"]').attr('content') ||
    money(text($, '.ui-pdp-price__second-line .andes-money-amount'));
  const oldPrice = andesMoney($, '.ui-pdp-price__original-value') || andesMoney($, 's.andes-money-amount--previous');
  return { images, title, price, oldPrice };
}

// ---------- Amazon ----------
// Imagens: .imgTagWrapper (imagem principal; data-old-hires / data-a-dynamic-image)
function amazon($, html, base) {
  const images = [];
  $('.imgTagWrapper img').each((_, el) => {
    const $el = $(el);
    images.push($el.attr('data-old-hires'));
    const dyn = $el.attr('data-a-dynamic-image');
    if (dyn) {
      try {
        const entries = Object.entries(JSON.parse(decode(dyn))).sort((a, b) => b[1][0] - a[1][0]);
        if (entries[0]) images.push(entries[0][0]);
      } catch {}
    }
    images.push(imgUrl($el));
  });
  // As demais fotos da galeria ficam no bloco colorImages do mesmo HTML
  const block = html.match(/'colorImages'\s*:\s*\{\s*'initial'\s*:\s*(\[[\s\S]*?\])\s*\}/);
  if (block) {
    try {
      JSON.parse(block[1]).forEach((i) => images.push(i.hiRes || i.large));
    } catch {}
  }
  // Normaliza para a maior resolução (remove modificadores ._AC_SX679_.)
  const norm = images
    .filter((u) => u && /^https?:/.test(u))
    .map((u) => u.replace(/\._[^/]*_\.(jpg|jpeg|png|webp)$/i, '.$1'));
  const title = text($, '#productTitle');
  let price = money(
    text($, '.priceToPay .a-offscreen', '#corePrice_feature_div .a-offscreen', '#corePriceDisplay_desktop_feature_div .a-offscreen', '.a-price .a-offscreen')
  );
  if (!price) {
    const whole = $('.a-price .a-price-whole').first().text().replace(/\D/g, '');
    const frac = $('.a-price .a-price-fraction').first().text().replace(/\D/g, '');
    price = whole ? `${whole}.${frac || '00'}` : '';
  }
  const oldPrice = money(text($, '.basisPrice .a-offscreen', '.a-price.a-text-price[data-a-strike="true"] .a-offscreen'));
  return { images: norm, title, price, oldPrice: oldPrice !== price ? oldPrice : '' };
}

// ---------- OLX ----------
// Imagens: .advc-gallery__image-wrap
function olx($, html, base) {
  let images = collect($, '.advc-gallery__image-wrap', base);
  if (!images.length) {
    // fallback: dados do anúncio embutidos no HTML
    const re = /https?:\\?\/\\?\/img\.olx\.com\.br\\?\/images\\?\/(\d+)\\?\/(\d+)\.(?:jpg|jpeg|webp|png)/g;
    const src = decode($('#__NEXT_DATA__').contents().text() || $('#initial-data').attr('data-json') || html);
    let m;
    while ((m = re.exec(src))) images.push(`https://img.olx.com.br/images/${m[1]}/${m[2]}.jpg`);
  }
  const title = text($, '[data-testid="ad-title"] h1', '#description-title h1', 'h1');
  let price = money(text($, '#price-box-container .olx-text--title-large', '#price-box-container h2', '[data-testid="ad-price-wrapper"] h2', '[data-testid="ad-price"]'));
  if (!price) {
    const m = decode($('#__NEXT_DATA__').contents().text() || html).match(/"price"\s*:\s*"?(R\$\s?)?([\d.,]+)"?/);
    price = m ? money(m[2]) : '';
  }
  const oldPrice = money(text($, '#price-box-container .olx-text--strikethrough', '#price-box-container s'));
  return { images, title, price, oldPrice };
}

// ---------- Shopee ----------
// Imagens: .i9ihcI (a Shopee gera nomes de classe aleatórios; mantemos alternativas)
function shopee($, html, base) {
  const raw = collect($, '.i9ihcI', base);
  const ids = [];
  const re = /(?:down-[a-z]{2}\.img\.susercontent\.com|cf\.shopee\.com\.br)\\?\/file\\?\/([a-z0-9-]+_?[a-z0-9]*)/i;
  for (const u of raw) {
    const m = u.match(re);
    ids.push(m ? m[1].replace(/_tn$/, '') : null);
  }
  const images = raw.map((u, i) => (ids[i] ? `https://down-br.img.susercontent.com/file/${ids[i]}` : u));
  if (!images.length) {
    const reAll = new RegExp(re.source, 'gi');
    let m;
    while ((m = reAll.exec(html))) images.push(`https://down-br.img.susercontent.com/file/${m[1].replace(/_tn$/, '')}`);
    const arr = html.match(/"images"\s*:\s*\[([^\]]+)\]/);
    if (arr) (arr[1].match(/"([a-z0-9-]{20,})"/gi) || []).forEach((s) => images.push(`https://down-br.img.susercontent.com/file/${s.replace(/"/g, '')}`));
  }
  // Na Shopee o preço costuma estar em JSON (valor x 100000)
  let price = '';
  const pm = html.match(/"price"\s*:\s*(\d{6,})/);
  if (pm) price = (Number(pm[1]) / 100000).toFixed(2);
  const om = html.match(/"price_before_discount"\s*:\s*(\d{6,})/);
  const oldPrice = om && Number(om[1]) > 0 ? (Number(om[1]) / 100000).toFixed(2) : '';
  return { images, title: '', price, oldPrice: oldPrice !== price ? oldPrice : '' };
}

// Mesma foto em tamanhos diferentes conta como uma só
function imageKey(u) {
  const ml = u.match(/mlstatic\.com\/D_(?:N?Q_NP_)?(?:2X_)?(\d+-[A-Z]{3}\d+_\d+)/);
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
  let specific = EXTRACTORS[store]($, html, finalUrl);
  let base = generic($, finalUrl);

  // Shopee e páginas protegidas: tenta de novo como crawler de preview
  if (!specific.images.length && !base.images.length) {
    const retry = await fetchHtml(finalUrl, PREVIEW_UA);
    $ = cheerio.load(retry.html);
    specific = EXTRACTORS[store]($, retry.html, retry.finalUrl);
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
    price: specific.price || money(base.price) || '',
    oldPrice: specific.oldPrice || '',
    currency: base.currency || 'BRL',
    images,
  };
}

module.exports = { extractProduct, detectStore };
