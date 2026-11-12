// Gera os stories (1080x1920) no canvas.
const Renderer = (() => {
  const W = 1080, H = 1920;
  const SAFE_TOP = 210, SAFE_BOTTOM = 260; // áreas cobertas pela interface do Instagram
  const FONT = "'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  const STORE_NAMES = { mercadolivre: 'Mercado Livre', olx: 'OLX', shopee: 'Shopee', amazon: 'Amazon' };
  const STYLES = ['card', 'polaroid', 'cover'];
  const ELEMENT_LABELS = { photos: 'Fotos', panel: 'Preço e informações', caption: 'Texto em destaque' };

  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  }
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function fit(img, w, h, mode) {
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const s = mode === 'cover' ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih);
    return { w: iw * s, h: ih * s };
  }

  // ---------- Cor de destaque da foto ----------
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
  }

  const accentCache = new WeakMap();
  /**
   * Detecta a cor de destaque de uma foto de produto: ignora o fundo branco/preto e tons de cinza,
   * agrupa os pixels por matiz (24 faixas) e pesa pela saturação. Retorna { h, s, l, neutral, css }.
   */
  function accentColor(img) {
    if (accentCache.has(img)) return accentCache.get(img);
    const N = 64;
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, N, N);
    const d = ctx.getImageData(0, 0, N, N).data;
    const buckets = Array.from({ length: 24 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
    let counted = 0, sumL = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
      if (l > 0.93 || l < 0.07) continue; // fundo branco/preto
      counted++;
      sumL += l;
      if (s < 0.22) continue; // cinzas
      const w = s * s * (1 - Math.abs(l - 0.5));
      const bk = buckets[Math.floor(h / 15) % 24];
      bk.w += w; bk.r += d[i] * w; bk.g += d[i + 1] * w; bk.b += d[i + 2] * w;
    }
    // escolhe a faixa (somando as vizinhas para suavizar)
    let best = 0, bestScore = -1;
    for (let i = 0; i < 24; i++) {
      const score = buckets[i].w + 0.5 * (buckets[(i + 23) % 24].w + buckets[(i + 1) % 24].w);
      if (score > bestScore) { bestScore = score; best = i; }
    }
    let result;
    const bk = buckets[best];
    if (bk.w > 0 && bk.w > counted * 0.015) {
      const [h, s, l] = rgbToHsl(bk.r / bk.w, bk.g / bk.w, bk.b / bk.w);
      result = { h, s, l, neutral: false };
    } else {
      // produto sem cor marcante (preto, branco, cinza): fundo neutro
      result = { h: 250, s: 0.08, l: counted ? sumL / counted : 0.5, neutral: true };
    }
    result.css = `hsl(${Math.round(result.h)}, ${Math.round(result.s * 100)}%, ${Math.round(result.l * 100)}%)`;
    accentCache.set(img, result);
    return result;
  }

  // Fundo em degradê criado a partir da cor de destaque
  function accentPreset(color) {
    const h = Math.round(color.h);
    const s = color.neutral ? 8 : Math.round(clamp(color.s * 100, 35, 85));
    return {
      id: 'accent',
      name: 'Cor do produto',
      stops: [`hsl(${h}, ${s}%, 64%)`, `hsl(${h}, ${s}%, 45%)`, `hsl(${h}, ${Math.max(s - 10, 6)}%, 19%)`],
      angle: 165,
      glow: true,
    };
  }

  // ---------- Background ----------
  let bgCache = { key: null, canvas: null };
  function bgKey(bg) {
    if (bg.type === 'image') return 'img:' + bg.img.src;
    if (bg.type === 'accent') return 'acc:' + bg.color.css;
    return 'pre:' + bg.preset.id;
  }
  function makeBg(bg) {
    const key = bgKey(bg);
    if (bgCache.key === key) return bgCache.canvas;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    if (bg.type === 'image' && bg.img) {
      const { w, h } = fit(bg.img, W, H, 'cover');
      ctx.drawImage(bg.img, (W - w) / 2, (H - h) / 2, w, h);
    } else {
      drawPreset(ctx, bg.type === 'accent' ? accentPreset(bg.color) : bg.preset, W, H);
    }
    // luminância média para escolher cores de texto
    const t = document.createElement('canvas');
    t.width = t.height = 8;
    const tctx = t.getContext('2d');
    tctx.drawImage(c, 0, 0, 8, 8);
    const d = tctx.getImageData(0, 0, 8, 8).data;
    let lum = 0;
    for (let i = 0; i < d.length; i += 4) lum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    c.light = lum / (d.length / 4) > 165;
    bgCache = { key, canvas: c };
    return c;
  }

  // Painel de vidro: desfoca o fundo dentro do retângulo (funciona mesmo com o elemento movido/escalado)
  function glass(ctx, bgCanvas, x, y, w, h, r) {
    ctx.save();
    rr(ctx, x, y, w, h, r);
    ctx.clip();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if ('filter' in ctx) {
      ctx.filter = 'blur(28px)';
      ctx.drawImage(bgCanvas, 0, 0);
      ctx.filter = 'none';
    }
    ctx.fillStyle = bgCanvas.light ? 'rgba(255,255,255,0.58)' : 'rgba(255,255,255,0.16)';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    ctx.restore();
    ctx.save();
    rr(ctx, x + 1, y + 1, w - 2, h - 2, r);
    ctx.lineWidth = 3;
    ctx.strokeStyle = bgCanvas.light ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.38)';
    ctx.stroke();
    ctx.restore();
  }

  function wrap(ctx, text, maxW, maxLines) {
    // separa só em espaços comuns: "R$ 341,15" (espaço não separável) nunca quebra no meio
    const words = String(text).split(/[ \t\n]+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (let i = 0; i < words.length; i++) {
      const test = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(test).width <= maxW) { line = test; continue; }
      if (line) lines.push(line);
      line = words[i];
      if (lines.length === maxLines) break;
    }
    if (line && lines.length < maxLines) lines.push(line);
    const used = lines.join(' ').split(/[ \t\n]+/).length;
    if (used < words.length && lines.length) {
      let last = lines[lines.length - 1];
      while (last && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1);
      lines[lines.length - 1] = last.trimEnd() + '…';
    }
    return lines;
  }

  function parsePrice(price) {
    let p = String(price || '').replace(/[^\d.,]/g, '');
    if (!p) return 0;
    if (p.includes(',') && p.includes('.')) p = p.replace(/\./g, '').replace(',', '.');
    else if (p.includes(',')) p = p.replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(p)) p = p.replace(/\./g, '');
    const n = Number(p);
    return isFinite(n) && n > 0 ? n : 0;
  }

  function formatPrice(price, currency = 'BRL') {
    const n = parsePrice(price);
    if (!n) return '';
    try { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency || 'BRL' }).format(n); }
    catch { return 'R$ ' + n.toFixed(2).replace('.', ','); }
  }

  // ---------- Texto em destaque (topo) ----------
  function captionBox(ctx, text) {
    ctx.font = `800 54px ${FONT}`;
    const tw = Math.min(ctx.measureText(text).width, W - 200);
    const w = tw + 100, h = 104;
    return { x: (W - w) / 2, y: SAFE_TOP, w, h };
  }
  function drawCaption(ctx, bgCanvas, text, b) {
    glass(ctx, bgCanvas, b.x, b.y, b.w, b.h, b.h / 2);
    ctx.font = `800 54px ${FONT}`;
    ctx.fillStyle = bgCanvas.light ? '#1d1730' : '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, b.x + b.w / 2, b.y + b.h / 2 + 2, W - 200);
  }

  // ---------- Painel: loja, nome, preço (ou outro destaque) e condição ----------
  // info.highlight: { mode: 'price' | 'text' | 'hide', text }
  function infoBlocks(ctx, info, showTitle) {
    const inner = W - 140 - 100;
    const mode = info.highlight?.mode || 'price';
    const blocks = [];
    if (info.store && STORE_NAMES[info.store]) blocks.push({ type: 'store', h: 50 });
    if (showTitle && info.title) {
      ctx.font = `700 46px ${FONT}`;
      const lines = wrap(ctx, info.title, inner, 2);
      blocks.push({ type: 'title', lines, h: lines.length * 58 + 6 });
    }
    if (mode === 'price') {
      const price = formatPrice(info.price, info.currency);
      const oldN = parsePrice(info.oldPrice), priceN = parsePrice(info.price);
      if (oldN && (!priceN || oldN > priceN)) {
        blocks.push({ type: 'old', text: 'De ' + formatPrice(info.oldPrice, info.currency), off: priceN ? Math.round((1 - priceN / oldN) * 100) : 0, h: 66 });
      }
      if (price) blocks.push({ type: 'price', text: price, h: 132 });
    } else if (mode === 'text' && info.highlight.text) {
      ctx.font = `800 80px ${FONT}`;
      const lines = wrap(ctx, info.highlight.text, inner, 2);
      blocks.push({ type: 'headline', lines, h: lines.length * 92 + 24 });
    }
    if (info.condition) {
      ctx.font = `700 44px ${FONT}`;
      // cada condição (separadas por •) em sua própria linha; no máximo 3 linhas
      const lines = info.condition
        .split(/\s*[•|]\s*/)
        .filter(Boolean)
        .flatMap((part) => wrap(ctx, part, inner - 64, 2))
        .slice(0, 3);
      blocks.push({ type: 'cond', lines, h: lines.length * 54 + 40 + 18 });
    }
    return blocks;
  }
  function hasInfo(info, showTitle) {
    if (!info) return false;
    const mode = info.highlight?.mode || 'price';
    return !!(
      (showTitle && info.title) ||
      info.condition ||
      (mode === 'price' && (parsePrice(info.price) || parsePrice(info.oldPrice))) ||
      (mode === 'text' && info.highlight.text)
    );
  }
  function panelBox(ctx, info, showTitle) {
    const blocks = infoBlocks(ctx, info, showTitle);
    const h = 100 + blocks.reduce((s, b) => s + b.h, 0);
    return { x: 70, y: H - SAFE_BOTTOM - h, w: W - 140, h, blocks };
  }

  function drawPanel(ctx, bgCanvas, info, box) {
    const { x, y, w, h, blocks } = box;
    const left = x + 50;
    glass(ctx, bgCanvas, x, y, w, h, 48);
    const dark = bgCanvas.light;
    const fg = dark ? '#1d1730' : '#ffffff';
    const muted = dark ? 'rgba(29,23,48,0.6)' : 'rgba(255,255,255,0.78)';
    let cy = y + 50;
    ctx.textAlign = 'left';
    for (const b of blocks) {
      ctx.textBaseline = 'middle';
      if (b.type === 'store') {
        ctx.font = `800 28px ${FONT}`;
        ctx.fillStyle = muted;
        if ('letterSpacing' in ctx) ctx.letterSpacing = '4px';
        ctx.fillText(STORE_NAMES[info.store].toUpperCase(), left, cy + 18);
        if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
      } else if (b.type === 'title') {
        ctx.font = `700 46px ${FONT}`;
        ctx.fillStyle = fg;
        b.lines.forEach((l, i) => ctx.fillText(l, left, cy + 29 + i * 58));
      } else if (b.type === 'old') {
        ctx.font = `600 40px ${FONT}`;
        ctx.fillStyle = muted;
        const tw = ctx.measureText(b.text).width;
        ctx.fillText(b.text, left, cy + 30);
        ctx.fillRect(left - 4, cy + 30, tw + 8, 4); // risco
        if (b.off > 0) {
          const label = `-${b.off}%`;
          ctx.font = `800 34px ${FONT}`;
          const lw = ctx.measureText(label).width + 36;
          rr(ctx, left + tw + 24, cy + 5, lw, 50, 25);
          ctx.fillStyle = '#16a34a';
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.fillText(label, left + tw + 42, cy + 31);
        }
      } else if (b.type === 'price') {
        // preço sem fundo: "R$" menor + valor grande, alinhados pela base
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = fg;
        const base = cy + 108;
        const m = b.text.match(/^(\D*?)\s*([\d.,]+)$/);
        if (m && m[1]) {
          ctx.font = `700 56px ${FONT}`;
          ctx.fillText(m[1], left, base - 8);
          const pw = ctx.measureText(m[1]).width + 16;
          ctx.font = `800 120px ${FONT}`;
          ctx.fillText(m[2], left + pw, base);
        } else {
          ctx.font = `800 120px ${FONT}`;
          ctx.fillText(b.text, left, base);
        }
      } else if (b.type === 'headline') {
        ctx.font = `800 80px ${FONT}`;
        ctx.fillStyle = fg;
        b.lines.forEach((l, i) => ctx.fillText(l, left, cy + 54 + i * 92));
      } else if (b.type === 'cond') {
        ctx.font = `700 44px ${FONT}`;
        const tw = Math.max(...b.lines.map((l) => ctx.measureText(l).width));
        const ph = b.lines.length * 54 + 40;
        rr(ctx, left - 14, cy + 6, tw + 64, ph, ph > 100 ? 36 : ph / 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.fillStyle = '#1d1730';
        b.lines.forEach((l, i) => ctx.fillText(l, left + 18, cy + 6 + 20 + 27 + i * 54));
      }
      cy += b.h;
    }
  }

  // ---------- Fotos ----------
  function drawPhoto(ctx, img, cell, style, rand) {
    const { x, y, w, h } = cell;
    ctx.save();
    if (style === 'polaroid') {
      const rot = (rand() - 0.5) * 0.12;
      ctx.translate(x + w / 2, y + h / 2);
      ctx.rotate(rot);
      ctx.translate(-(x + w / 2), -(y + h / 2));
    }
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 50;
    ctx.shadowOffsetY = 20;
    // só recorta (cover) quando a proporção da foto é parecida com a da célula
    const ir = (img.naturalWidth || img.width) / (img.naturalHeight || img.height);
    if (style === 'cover' && Math.abs(Math.log(ir / (w / h))) > 0.3) style = 'card';
    if (style === 'cover') {
      rr(ctx, x, y, w, h, 44);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.clip();
      const f = fit(img, w, h, 'cover');
      ctx.drawImage(img, x + (w - f.w) / 2, y + (h - f.h) / 2, f.w, f.h);
    } else {
      const pad = style === 'polaroid' ? Math.min(w, h) * 0.05 : Math.min(w, h) * 0.07;
      const bottom = style === 'polaroid' ? pad * 2.6 : pad;
      rr(ctx, x, y, w, h, style === 'polaroid' ? 10 : 48);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.shadowColor = 'transparent';
      const iw = w - pad * 2, ih = h - pad - bottom;
      const f = fit(img, iw, ih, 'contain');
      ctx.drawImage(img, x + pad + (iw - f.w) / 2, y + pad + (ih - f.h) / 2, f.w, f.h);
    }
    ctx.restore();
  }

  // Célula única ajustada à proporção da foto (fica bonito com fotos quadradas)
  function singleCell(img, area, style) {
    if (style === 'cover') return area;
    const f = fit(img, area.w, area.h, 'contain');
    const w = Math.max(f.w, area.w * 0.75), h = Math.min(area.h, Math.max(f.h, w * 0.8));
    return { x: area.x + (area.w - w) / 2, y: area.y + (area.h - h) / 2, w, h };
  }

  function collageCells(n, area, pattern) {
    const G = 34, cells = [];
    const grid = (k, a) => {
      const cols = k <= 2 ? (a.w > a.h ? k : 1) : k <= 6 ? 2 : 3;
      const rows = Math.ceil(k / cols);
      const ch = (a.h - G * (rows - 1)) / rows;
      for (let r = 0; r < rows; r++) {
        const inRow = Math.min(cols, k - r * cols);
        const cw = (a.w - G * (inRow - 1)) / inRow;
        for (let c = 0; c < inRow; c++) cells.push({ x: a.x + c * (cw + G), y: a.y + r * (ch + G), w: cw, h: ch });
      }
    };
    if (n === 1) return [area];
    if (pattern === 0) {
      // destaque: primeira foto grande em cima
      const heroH = (area.h - G) * (n === 2 ? 0.58 : 0.55);
      cells.push({ x: area.x, y: area.y, w: area.w, h: heroH });
      const rest = { x: area.x, y: area.y + heroH + G, w: area.w, h: area.h - heroH - G };
      const k = n - 1;
      if (k <= 3) {
        const cw = (rest.w - G * (k - 1)) / k;
        for (let i = 0; i < k; i++) cells.push({ x: rest.x + i * (cw + G), y: rest.y, w: cw, h: rest.h });
      } else grid(k, rest);
    } else grid(n, area);
    return cells;
  }

  // ---------- Disposição dos elementos ----------
  // t = { dx, dy, s, hidden }: deslocamento e escala (em torno do centro) escolhidos pelo usuário
  function placed(box, t = {}) {
    const s = t.s || 1, dx = t.dx || 0, dy = t.dy || 0;
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    return {
      x: cx + dx - (box.w * s) / 2,
      y: cy + dy - (box.h * s) / 2,
      w: box.w * s,
      h: box.h * s,
      apply(ctx) {
        ctx.translate(cx + dx, cy + dy);
        ctx.scale(s, s);
        ctx.translate(-cx, -cy);
      },
    };
  }

  /**
   * opts: {
   *   bg, images, mode: 'collage'|'multi',
   *   info: { store, title, price, oldPrice, condition, currency, highlight: { mode, text } },
   *   showTitle, caption, variant,
   *   layout: { photos, panel, caption } — cada um { dx, dy, s, hidden }
   * }
   * Retorna uma lista de canvas 1080x1920. Cada canvas tem .boxes com a posição de cada elemento.
   */
  function render(opts) {
    const bgCanvas = makeBg(opts.bg);
    const variant = opts.variant || 0;
    const style = STYLES[variant % STYLES.length];
    const pattern = Math.floor(variant / STYLES.length) % 2;
    const L = opts.layout || {};
    const groups = opts.mode === 'multi' ? opts.images.map((i) => [i]) : [opts.images.slice(0, 9)];

    return groups.map((imgs) => {
      const rand = rng(variant * 7919 + 17);
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const ctx = c.getContext('2d');
      ctx.drawImage(bgCanvas, 0, 0);

      const capBox = opts.caption ? captionBox(ctx, opts.caption) : null;
      const pBox = hasInfo(opts.info, opts.showTitle) ? panelBox(ctx, opts.info, opts.showTitle) : null;
      const capShown = capBox && !L.caption?.hidden;
      const panelShown = pBox && !L.panel?.hidden;

      // A área das fotos ocupa o espaço livre entre o texto do topo e o painel
      const top = capShown ? capBox.y + capBox.h + 50 : SAFE_TOP - 40;
      const bottom = panelShown ? pBox.y - 50 : H - SAFE_BOTTOM + 40;
      const area = { x: 80, y: top, w: W - 160, h: bottom - top };
      const photosBox = imgs.length === 1 ? singleCell(imgs[0], area, style) : area;

      const boxes = [];
      const P = placed(photosBox, L.photos);
      ctx.save();
      P.apply(ctx);
      if (imgs.length === 1) drawPhoto(ctx, imgs[0], photosBox, style, rand);
      else {
        // na colagem, o "gerar novamente" também reorganiza as fotos
        const order = variant ? imgs.map((im, i) => [im, rand() + (i === 0 ? -0.3 : 0)]).sort((a, b) => a[1] - b[1]).map((p) => p[0]) : imgs;
        collageCells(order.length, area, pattern).forEach((cell, i) => drawPhoto(ctx, order[i], cell, style, rand));
      }
      ctx.restore();
      boxes.push({ id: 'photos', label: ELEMENT_LABELS.photos, x: P.x, y: P.y, w: P.w, h: P.h, hidden: false });

      if (pBox) {
        const Q = placed(pBox, L.panel);
        if (panelShown) {
          ctx.save();
          Q.apply(ctx);
          drawPanel(ctx, bgCanvas, opts.info, pBox);
          ctx.restore();
        }
        boxes.push({ id: 'panel', label: ELEMENT_LABELS.panel, x: Q.x, y: Q.y, w: Q.w, h: Q.h, hidden: !panelShown });
      }
      if (capBox) {
        const R = placed(capBox, L.caption);
        if (capShown) {
          ctx.save();
          R.apply(ctx);
          drawCaption(ctx, bgCanvas, opts.caption, capBox);
          ctx.restore();
        }
        boxes.push({ id: 'caption', label: ELEMENT_LABELS.caption, x: R.x, y: R.y, w: R.w, h: R.h, hidden: !capShown });
      }
      c.boxes = boxes;
      return c;
    });
  }

  const toBlob = (canvas) => new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92));

  return { render, toBlob, formatPrice, parsePrice, accentColor, accentPreset, W, H, STORE_NAMES, ELEMENT_LABELS };
})();
