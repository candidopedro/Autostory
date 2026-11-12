// Gera os stories (1080x1920) no canvas.
const Renderer = (() => {
  const W = 1080, H = 1920;
  const SAFE_TOP = 210, SAFE_BOTTOM = 260; // áreas cobertas pela interface do Instagram
  const FONT = "'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  const STORE_NAMES = { mercadolivre: 'Mercado Livre', olx: 'OLX', shopee: 'Shopee', amazon: 'Amazon' };
  const STYLES = ['card', 'polaroid', 'cover'];

  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  }

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

  // ---------- Background ----------
  function makeBg(bg) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    if (bg.type === 'image' && bg.img) {
      const { w, h } = fit(bg.img, W, H, 'cover');
      ctx.drawImage(bg.img, (W - w) / 2, (H - h) / 2, w, h);
    } else {
      drawPreset(ctx, bg.preset, W, H);
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
    return c;
  }

  // Painel de vidro: desfoca o fundo dentro do retângulo
  function glass(ctx, bgCanvas, x, y, w, h, r) {
    ctx.save();
    rr(ctx, x, y, w, h, r);
    ctx.clip();
    if ('filter' in ctx) {
      ctx.filter = 'blur(28px)';
      ctx.drawImage(bgCanvas, 0, 0);
      ctx.filter = 'none';
    }
    ctx.fillStyle = bgCanvas.light ? 'rgba(255,255,255,0.58)' : 'rgba(255,255,255,0.16)';
    ctx.fillRect(x, y, w, h);
    ctx.restore();
    ctx.save();
    rr(ctx, x + 1, y + 1, w - 2, h - 2, r);
    ctx.lineWidth = 3;
    ctx.strokeStyle = bgCanvas.light ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.38)';
    ctx.stroke();
    ctx.restore();
  }

  function wrap(ctx, text, maxW, maxLines) {
    // separa só em espaços comuns: "R$ 341,15" (espaço não separável) nunca quebra no meio
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

  function formatPrice(price, currency = 'BRL') {
    const n = parsePrice(price);
    if (!n) return '';
    try { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency || 'BRL' }).format(n); }
    catch { return 'R$ ' + n.toFixed(2).replace('.', ','); }
  }

  // ---------- Elementos de texto ----------
  function drawCaption(ctx, bgCanvas, text) {
    ctx.font = `800 54px ${FONT}`;
    const tw = Math.min(ctx.measureText(text).width, W - 200);
    const w = tw + 100, h = 104, x = (W - w) / 2, y = SAFE_TOP;
    glass(ctx, bgCanvas, x, y, w, h, h / 2);
    ctx.fillStyle = bgCanvas.light ? '#1d1730' : '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, W / 2, y + h / 2 + 2, W - 200);
    return y + h;
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

  // Painel inferior: loja, nome, "de" riscado, preço em destaque e condição de pagamento.
  // Monta uma lista de blocos (com alturas) usada tanto para medir quanto para desenhar.
  function infoBlocks(ctx, info, showTitle) {
    const inner = W - 140 - 100;
    const blocks = [];
    if (info.store && STORE_NAMES[info.store]) blocks.push({ type: 'store', h: 50 });
    if (showTitle && info.title) {
      ctx.font = `700 46px ${FONT}`;
      const lines = wrap(ctx, info.title, inner, 2);
      blocks.push({ type: 'title', lines, h: lines.length * 58 });
    }
    const price = formatPrice(info.price, info.currency);
    const oldN = parsePrice(info.oldPrice), priceN = parsePrice(info.price);
    if (oldN && (!priceN || oldN > priceN)) {
      blocks.push({ type: 'old', text: 'De ' + formatPrice(info.oldPrice, info.currency), off: priceN ? Math.round((1 - priceN / oldN) * 100) : 0, h: 70 });
    }
    if (price) blocks.push({ type: 'price', text: price, h: 134 });
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
  const hasInfo = (info, showTitle) => !!((showTitle && info?.title) || info?.price || info?.condition || info?.oldPrice);

  function infoHeight(ctx, info, showTitle) {
    return 100 + infoBlocks(ctx, info, showTitle).reduce((s, b) => s + b.h, 0);
  }

  function drawInfo(ctx, bgCanvas, info, showTitle) {
    const blocks = infoBlocks(ctx, info, showTitle);
    const h = 100 + blocks.reduce((s, b) => s + b.h, 0);
    const x = 70, w = W - 140, y = H - SAFE_BOTTOM - h, left = x + 50;
    glass(ctx, bgCanvas, x, y, w, h, 48);
    const dark = bgCanvas.light;
    const fg = dark ? '#1d1730' : '#ffffff';
    const muted = dark ? 'rgba(29,23,48,0.6)' : 'rgba(255,255,255,0.78)';
    let cy = y + 50;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const b of blocks) {
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
        ctx.fillText(b.text, left, cy + 28);
        ctx.fillRect(left - 4, cy + 28, tw + 8, 4); // risco
        if (b.off > 0) {
          const label = `-${b.off}%`;
          ctx.font = `800 34px ${FONT}`;
          const lw = ctx.measureText(label).width + 36;
          rr(ctx, left + tw + 24, cy + 3, lw, 50, 25);
          ctx.fillStyle = '#16a34a';
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.fillText(label, left + tw + 42, cy + 29);
        }
      } else if (b.type === 'price') {
        ctx.font = `800 84px ${FONT}`;
        const pw = ctx.measureText(b.text).width;
        const g = ctx.createLinearGradient(left, 0, left + pw + 80, 0);
        g.addColorStop(0, '#f9ce34'); g.addColorStop(0.5, '#ee2a7b'); g.addColorStop(1, '#6228d7');
        rr(ctx, left - 14, cy + 8, pw + 76, 104, 52);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillText(b.text, left + 24, cy + 64);
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
    return y;
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

  /**
   * opts: { bg, images, mode: 'collage'|'multi', info: { store, title, price, oldPrice, condition, currency }, showTitle, caption, variant }
   * Retorna uma lista de canvas 1080x1920.
   */
  function render(opts) {
    const bgCanvas = makeBg(opts.bg);
    const variant = opts.variant || 0;
    const style = STYLES[variant % STYLES.length];
    const pattern = Math.floor(variant / STYLES.length) % 2;
    const rand = rng(variant * 7919 + 17);
    const groups = opts.mode === 'multi' ? opts.images.map((i) => [i]) : [opts.images.slice(0, 9)];

    return groups.map((imgs) => {
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const ctx = c.getContext('2d');
      ctx.drawImage(bgCanvas, 0, 0);

      let top = SAFE_TOP - 40;
      if (opts.caption) top = drawCaption(ctx, bgCanvas, opts.caption) + 50;
      let bottom = H - SAFE_BOTTOM + 40;
      const withInfo = hasInfo(opts.info, opts.showTitle);
      if (withInfo) bottom = H - SAFE_BOTTOM - infoHeight(ctx, opts.info, opts.showTitle) - 50;

      const area = { x: 80, y: top, w: W - 160, h: bottom - top };
      if (imgs.length === 1) drawPhoto(ctx, imgs[0], singleCell(imgs[0], area, style), style, rand);
      else {
        // na colagem, o "gerar novamente" também reorganiza as fotos
        const order = variant ? imgs.map((im, i) => [im, rand() + (i === 0 ? -0.3 : 0)]).sort((a, b) => a[1] - b[1]).map((p) => p[0]) : imgs;
        collageCells(order.length, area, pattern).forEach((cell, i) => drawPhoto(ctx, order[i], cell, style, rand));
      }
      if (withInfo) drawInfo(ctx, bgCanvas, opts.info, opts.showTitle);
      return c;
    });
  }

  const toBlob = (canvas) => new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92));

  return { render, toBlob, formatPrice, parsePrice, W, H, STORE_NAMES };
})();
