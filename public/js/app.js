// Autostory — lógica da interface
(() => {
  const $ = (s) => document.querySelector(s);
  const MAX_DEFAULT_SELECTED = 4;
  const MAX_COLLAGE = 9;

  const state = {
    bg: null,            // 'preset:<id>' | 'custom'
    customImg: null,     // HTMLImageElement do background enviado
    product: null,       // { store, title, price, currency, url }
    items: [],           // { src, img, on }
    mode: Store.get('mode', 'collage'),
    variant: 0,
    canvases: [],
    me: { loggedIn: false },
  };

  // ---------- Utilidades ----------
  function toast(msg, type = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    $('#toasts').append(el);
    setTimeout(() => el.remove(), type === 'error' ? 6000 : 3800);
  }
  function busy(btn, on) {
    btn.disabled = on;
    btn.classList.toggle('loading', on);
    btn.querySelector('.spinner')?.toggleAttribute('hidden', !on);
  }
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Falha ao carregar imagem'));
      img.src = src;
    });
  }
  const proxied = (u) => (/^(blob|data):/.test(u) ? u : '/api/image?url=' + encodeURIComponent(u));

  // Reduz imagens grandes do dispositivo (fotos de celular podem ter 4000px+)
  async function downscale(file, maxW = 1440, maxH = 2560) {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      const s = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * s);
      c.height = Math.round(img.naturalHeight * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // ---------- 1. Background ----------
  // 'auto' = fundo criado com a cor de destaque da foto do produto (padrão)
  const AUTO_BG = 'auto';
  async function initBackgrounds() {
    const blob = await Store.getBlob('customBg');
    if (blob) state.customImg = await loadImage(URL.createObjectURL(blob)).catch(() => null);
    let saved = Store.get('bg');
    // A partir desta versão o padrão é a cor do produto (o background enviado continua tendo prioridade)
    if (Store.get('bgV') !== 2) {
      if (saved !== 'custom') saved = null;
      Store.set('bgV', 2);
    }
    state.bg = saved === 'custom' && !state.customImg ? null : saved;
    if (!state.bg) state.bg = state.customImg ? 'custom' : AUTO_BG;
    buildBgSelect();
  }

  function buildBgSelect() {
    const sel = $('#bgSelect');
    sel.innerHTML = '';
    if (state.customImg) sel.add(new Option('⭐ Meu background', 'custom'));
    sel.add(new Option('🎨 Cor do produto (padrão)', AUTO_BG));
    for (const p of PRESETS) sel.add(new Option(p.name, 'preset:' + p.id));
    sel.value = state.bg;
    if (sel.value !== state.bg) state.bg = sel.value = AUTO_BG;
    $('#customNote').hidden = !state.customImg;
    updateBgThumb();
  }

  function updateBgThumb() {
    const t = $('#bgThumb');
    if (state.bg === 'custom' && state.customImg) t.style.backgroundImage = `url(${state.customImg.src})`;
    else if (state.bg === AUTO_BG)
      t.style.backgroundImage = state.accent
        ? `url(${presetThumb(Renderer.accentPreset(state.accent))})`
        : 'conic-gradient(from 200deg, #f43f5e, #f59e0b, #22c55e, #3b82f6, #a855f7, #f43f5e)';
    else t.style.backgroundImage = `url(${presetThumb(currentPreset())})`;
  }
  const currentPreset = () => PRESETS.find((p) => 'preset:' + p.id === state.bg) || PRESETS[0];
  function currentBg() {
    if (state.bg === 'custom' && state.customImg) return { type: 'image', img: state.customImg };
    if (state.bg === AUTO_BG) return state.accent ? { type: 'accent', color: state.accent } : { type: 'preset', preset: PRESETS[0] };
    return { type: 'preset', preset: currentPreset() };
  }

  $('#bgSelect').addEventListener('change', (e) => {
    state.bg = e.target.value;
    Store.set('bg', state.bg);
    updateBgThumb();
    rerender();
  });
  $('#bgUploadBtn').addEventListener('click', () => $('#bgFile').click());
  $('#bgFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const blob = await downscale(file);
      await Store.setBlob('customBg', blob);
      if (state.customImg) URL.revokeObjectURL(state.customImg.src);
      state.customImg = await loadImage(URL.createObjectURL(blob));
      state.bg = 'custom';
      Store.set('bg', 'custom');
      buildBgSelect();
      rerender();
      toast('Background salvo! Ele será o padrão das próximas postagens.', 'success');
    } catch {
      toast('Não foi possível usar essa imagem.', 'error');
    }
  });
  $('#bgDeleteBtn').addEventListener('click', async () => {
    await Store.delBlob('customBg');
    if (state.customImg) URL.revokeObjectURL(state.customImg.src);
    state.customImg = null;
    state.bg = AUTO_BG;
    Store.set('bg', state.bg);
    buildBgSelect();
    rerender();
    toast('Background excluído. Voltamos ao fundo com a cor do produto.');
  });

  // ---------- 2. Link ----------
  $('#pasteBtn').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      const url = (text.match(/https?:\/\/\S+/) || [text])[0].trim();
      $('#linkInput').value = url;
      if (/^https?:\/\//.test(url)) extract(url);
    } catch {
      $('#linkInput').focus();
      toast('Cole o link no campo (Ctrl+V / segurar e colar).');
    }
  });
  $('#linkInput').addEventListener('paste', () => {
    setTimeout(() => {
      const v = $('#linkInput').value.trim();
      if (/^https?:\/\/\S+$/.test(v)) extract(v);
    }, 0);
  });
  $('#linkForm').addEventListener('submit', (e) => {
    e.preventDefault();
    extract($('#linkInput').value.trim());
  });

  let extractSeq = 0;
  async function extract(url, restore) {
    if (!url) return;
    const seq = ++extractSeq;
    const btn = $('#extractBtn');
    busy(btn, true);
    try {
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha ao extrair.');
      if (seq !== extractSeq) return;

      state.product = { store: data.store, title: data.title, price: data.price, currency: data.currency, url: data.url };
      state.variant = restore?.variant || 0;
      $('#storeBadge').textContent = Renderer.STORE_NAMES[data.store] || data.store;
      $('#productTitle').textContent = data.title || 'Produto';
      $('#extracted').hidden = false;
      setPrices(restore?.price ?? data.price, restore?.oldPrice ?? data.oldPrice, restore?.cond);

      const loaded = await Promise.all(
        data.images.map((src) => loadImage(proxied(src)).then((img) => ({ src, img })).catch(() => null))
      );
      if (seq !== extractSeq) return;
      state.items = loaded.filter(Boolean).map((it, i) => ({
        ...it,
        on: restore?.selected ? restore.selected.includes(it.src) : i < MAX_DEFAULT_SELECTED,
      }));
      if (!state.items.length) toast('As imagens não puderam ser carregadas. Adicione fotos do dispositivo.', 'error');
      renderThumbs();
      rerender();
    } catch (err) {
      toast(err.message || 'Erro ao extrair o link.', 'error');
      $('#extracted').hidden = !state.items.length;
      if (!state.items.length) {
        // permite seguir com fotos manuais
        state.product = state.product || { store: '', title: '', price: '', url };
        $('#extracted').hidden = false;
        $('#storeBadge').textContent = 'Manual';
        $('#productTitle').textContent = 'Adicione as fotos do produto';
        setPrices('', '');
        renderThumbs();
      }
    } finally {
      if (seq === extractSeq) busy(btn, false);
    }
  }

  function renderThumbs() {
    const box = $('#thumbs');
    box.innerHTML = '';
    let order = 0;
    state.items.forEach((it, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'thumb-item' + (it.on ? ' on' : '');
      b.setAttribute('aria-pressed', it.on);
      b.setAttribute('aria-label', `Foto ${i + 1}`);
      b.innerHTML = `<img alt="" src="${it.img.src}"><span class="check"><svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg></span>${it.on ? `<span class="order">${++order}</span>` : ''}`;
      b.addEventListener('click', () => {
        const selected = state.items.filter((x) => x.on).length;
        if (!it.on && state.mode === 'collage' && selected >= MAX_COLLAGE) return toast(`A colagem aceita até ${MAX_COLLAGE} fotos.`);
        it.on = !it.on;
        renderThumbs();
        rerender();
      });
      box.append(b);
    });
    const n = state.items.filter((x) => x.on).length;
    $('#modeBox').hidden = n < 2;
  }

  $('#addPhotosBtn').addEventListener('click', () => $('#photosFile').click());
  $('#photosFile').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    for (const f of files) {
      try {
        const blob = await downscale(f, 1600, 1600);
        const img = await loadImage(URL.createObjectURL(blob));
        state.items.push({ src: img.src, img, on: true });
      } catch {}
    }
    renderThumbs();
    rerender();
  });

  document.querySelectorAll('#modeBox .segmented button').forEach((b) =>
    b.addEventListener('click', () => {
      state.mode = b.dataset.mode;
      Store.set('mode', state.mode);
      syncMode();
      rerender();
    })
  );
  function syncMode() {
    document.querySelectorAll('#modeBox .segmented button').forEach((b) => b.setAttribute('aria-checked', b.dataset.mode === state.mode));
  }

  const showTitle = $('#showTitle');
  showTitle.checked = Store.get('showTitle', true);
  showTitle.addEventListener('change', () => { Store.set('showTitle', showTitle.checked); rerender(); });

  // ---------- 3. Preço e condição de pagamento ----------
  const CHIP_GROUPS = ['parc', 'pix', 'frete'];
  let chips = Store.get('condChips', {}); // ex.: { parc: '12', pix: '10' } — lembrado entre postagens
  let condAuto = true; // texto da condição gerado pelas sugestões (recalcula ao mudar o preço)
  const money = (n) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
  const plain = (n) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

  function buildCondition() {
    const price = Renderer.parsePrice($('#priceInput').value);
    const parts = [];
    for (const g of CHIP_GROUPS) {
      const v = chips[g];
      if (!v) continue;
      const n = Number(v);
      if (g === 'parc') parts.push(price ? `${n}x de ${money(price / n)} sem juros` : `Em até ${n}x sem juros`);
      if (g === 'pix') parts.push(price ? `${money(price * (1 - n / 100))} no Pix (${n}% off)` : `${n}% de desconto no Pix`);
      if (g === 'frete') parts.push('Frete grátis');
    }
    return parts.join(' • ');
  }
  function syncChips() {
    document.querySelectorAll('#condChips .chip').forEach((c) =>
      c.setAttribute('aria-pressed', condAuto && chips[c.dataset.group] === c.dataset.value)
    );
  }
  function applyChips() {
    condAuto = true;
    $('#condInput').value = buildCondition();
    syncChips();
  }
  // Preenche os campos com o preço extraído do site (o usuário pode editar)
  function setPrices(price, oldPrice, cond) {
    const p = Renderer.parsePrice(price), o = Renderer.parsePrice(oldPrice);
    $('#priceInput').value = p ? plain(p) : '';
    $('#oldPriceInput').value = o && o > p ? plain(o) : '';
    if (cond !== undefined && cond !== null) {
      $('#condInput').value = cond;
      condAuto = cond === buildCondition();
      syncChips();
    } else if (condAuto) applyChips();
    $('#stepPrice').hidden = false;
  }
  document.querySelectorAll('#condChips .chip').forEach((c) =>
    c.addEventListener('click', () => {
      const { group, value } = c.dataset;
      if (condAuto && chips[group] === value) delete chips[group];
      else {
        if (!condAuto) chips = {};
        chips[group] = value;
      }
      Store.set('condChips', chips);
      applyChips();
      rerender();
    })
  );
  $('#condInput').addEventListener('input', () => {
    condAuto = false;
    chips = {};
    Store.set('condChips', chips);
    syncChips();
    rerenderSoon();
  });
  for (const id of ['#priceInput', '#oldPriceInput']) {
    const el = $(id);
    el.addEventListener('input', () => {
      if (id === '#priceInput' && condAuto) $('#condInput').value = buildCondition();
      rerenderSoon();
    });
    el.addEventListener('blur', () => {
      const n = Renderer.parsePrice(el.value);
      el.value = n ? plain(n) : '';
    });
  }
  let softTimer;
  function rerenderSoon() {
    clearTimeout(softTimer);
    softTimer = setTimeout(rerender, 200);
  }
  syncChips();
  let capTimer;
  $('#captionInput').value = Store.get('caption', '');
  $('#captionInput').addEventListener('input', () => {
    clearTimeout(capTimer);
    capTimer = setTimeout(() => { Store.set('caption', $('#captionInput').value); rerender(); }, 250);
  });

  // O que vai no lugar do preço: o preço, outro texto (PROMOÇÃO, 12x sem juros…) ou nada
  state.hlMode = Store.get('hlMode', 'price');
  $('#hlTextInput').value = Store.get('hlText', '');
  function syncHl() {
    document.querySelectorAll('#hlMode button').forEach((b) => b.setAttribute('aria-checked', b.dataset.hl === state.hlMode));
    $('#priceBox').hidden = state.hlMode !== 'price';
    $('#hlTextBox').hidden = state.hlMode !== 'text';
    const v = $('#hlTextInput').value.trim();
    document.querySelectorAll('#hlChips .chip').forEach((c) => c.setAttribute('aria-pressed', c.textContent.trim() === v));
  }
  document.querySelectorAll('#hlMode button').forEach((b) =>
    b.addEventListener('click', () => {
      state.hlMode = b.dataset.hl;
      Store.set('hlMode', state.hlMode);
      syncHl();
      if (state.hlMode === 'text' && !$('#hlTextInput').value) $('#hlTextInput').focus();
      rerender();
    })
  );
  $('#hlTextInput').addEventListener('input', () => {
    Store.set('hlText', $('#hlTextInput').value);
    syncHl();
    rerenderSoon();
  });
  document.querySelectorAll('#hlChips .chip').forEach((c) =>
    c.addEventListener('click', () => {
      $('#hlTextInput').value = c.textContent.trim();
      Store.set('hlText', $('#hlTextInput').value);
      syncHl();
      rerender();
    })
  );
  syncHl();

  // ---------- 4. Preview ----------
  let raf;
  function rerender() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(doRender);
  }
  function doRender() {
    const imgs = state.items.filter((x) => x.on).map((x) => x.img);
    const box = $('#previews');
    if (!imgs.length) {
      state.canvases = [];
      box.className = 'previews';
      box.innerHTML = `<div class="placeholder"><svg viewBox="0 0 24 24"><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 18h4"/></svg><span>${
        state.items.length ? 'Selecione ao menos uma foto' : 'Cole um link para gerar o story'
      }</span></div>`;
      $('#previewInfo').textContent = 'Seu story aparece aqui.';
      box.dataset.count = '0';
      $('#postBtn').disabled = $('#regenBtn').disabled = $('#editBtn').disabled = true;
      $('#editBar').hidden = true;
      return;
    }
    // Cor de destaque: primeira foto selecionada com cor marcante (base do fundo padrão)
    const accent = imgs.map((im) => Renderer.accentColor(im)).find((a) => !a.neutral) || Renderer.accentColor(imgs[0]);
    if (accent !== state.accent) {
      state.accent = accent;
      updateBgThumb();
    }
    const mode = imgs.length > 1 ? state.mode : 'multi';
    state.canvases = Renderer.render({
      bg: currentBg(),
      images: mode === 'collage' ? imgs.slice(0, MAX_COLLAGE) : imgs,
      mode,
      info: {
        ...(state.product || {}),
        price: $('#priceInput').value,
        oldPrice: $('#oldPriceInput').value,
        condition: $('#condInput').value.trim(),
        highlight: { mode: state.hlMode, text: $('#hlTextInput').value.trim() },
      },
      showTitle: showTitle.checked,
      caption: $('#captionInput').value.trim(),
      variant: state.variant,
      layout: state.layout,
    });
    // Os canvases exibidos são reaproveitados (permite arrastar sem recriar a página)
    const n = state.canvases.length;
    if (box.querySelectorAll('.story').length !== n || box.dataset.count !== String(n)) {
      box.innerHTML = '';
      box.dataset.count = n;
      for (let i = 0; i < n; i++) box.append(makeStory(i, n));
    }
    box.className = 'previews' + (n > 1 ? ' many' : '') + (state.editing ? ' editing' : '');
    box.querySelectorAll('.story').forEach((wrap, i) => {
      wrap.querySelector('canvas').getContext('2d').drawImage(state.canvases[i], 0, 0);
      drawBoxes(wrap.querySelector('.edit-layer'), state.canvases[i].boxes);
    });
    $('#previewInfo').textContent = n > 1 ? `${n} stories serão postados.` : mode === 'collage' ? `Colagem com ${imgs.length} fotos.` : '1 story será postado.';
    $('#postBtn').disabled = $('#regenBtn').disabled = $('#editBtn').disabled = false;
    updateEditBar();
  }

  function makeStory(i, n) {
    const wrap = document.createElement('div');
    wrap.className = 'story';
    const view = document.createElement('canvas');
    view.width = Renderer.W;
    view.height = Renderer.H;
    wrap.append(view);
    if (n > 1) wrap.insertAdjacentHTML('beforeend', `<span class="tag">${i + 1}/${n}</span>`);
    const layer = document.createElement('div');
    layer.className = 'edit-layer';
    // guias das áreas cobertas pela interface do Instagram (topo e campo de resposta)
    layer.innerHTML =
      `<div class="safe-zone" style="top:0;height:${(210 / Renderer.H) * 100}%"><span>Área coberta pelo Instagram</span></div>` +
      `<div class="safe-zone" style="bottom:0;height:${(260 / Renderer.H) * 100}%"><span>Área coberta pelo Instagram</span></div>`;
    wrap.append(layer);
    const dl = document.createElement('button');
    dl.className = 'dl';
    dl.title = 'Baixar imagem';
    dl.setAttribute('aria-label', 'Baixar imagem');
    dl.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 4v12m0 0-4-4m4 4 4-4M5 20h14"/></svg>';
    dl.addEventListener('click', async () => {
      const blob = await Renderer.toBlob(state.canvases[i]);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `autostory-${Date.now()}-${i + 1}.jpg`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
    wrap.append(dl);
    return wrap;
  }

  // Caixas clicáveis sobre o preview, uma por elemento (fotos, painel de preço, texto do topo)
  function drawBoxes(layer, boxes) {
    const ids = new Set(boxes.map((b) => b.id));
    layer.querySelectorAll('.el-box').forEach((el) => !ids.has(el.dataset.id) && el.remove());
    for (const b of boxes) {
      let el = layer.querySelector(`.el-box[data-id="${b.id}"]`);
      if (!el) {
        el = document.createElement('div');
        el.className = 'el-box';
        el.dataset.id = b.id;
        el.innerHTML = '<span class="el-tag"></span>';
        layer.append(el);
      }
      el.style.left = (b.x / Renderer.W) * 100 + '%';
      el.style.top = (b.y / Renderer.H) * 100 + '%';
      el.style.width = (b.w / Renderer.W) * 100 + '%';
      el.style.height = (b.h / Renderer.H) * 100 + '%';
      el.classList.toggle('selected', state.selected === b.id);
      el.classList.toggle('is-hidden', b.hidden);
      el.querySelector('.el-tag').textContent = b.label + (b.hidden ? ' (oculto)' : '');
    }
  }

  // ---------- Editar disposição (arrastar no preview) ----------
  state.layout = Store.get('layout', {});
  state.editing = false;
  state.selected = null;
  let drag = null;
  const saveLayout = () => Store.set('layout', state.layout);
  const selBox = () => state.canvases[0]?.boxes.find((b) => b.id === state.selected);

  function updateEditBar() {
    $('#editBar').hidden = !state.editing;
    const b = selBox();
    if (!b) state.selected = null;
    $('#editLabel').textContent = b ? b.label : 'Toque em um elemento e arraste';
    $('#elSmaller').disabled = $('#elBigger').disabled = !b;
    $('#elHide').disabled = !b || b.id === 'photos';
    $('#elHide').title = b?.hidden ? 'Mostrar' : 'Ocultar';
    $('#elHide').setAttribute('aria-label', $('#elHide').title);
  }

  $('#editBtn').addEventListener('click', () => {
    state.editing = !state.editing;
    $('#editBtn').setAttribute('aria-pressed', state.editing);
    if (!state.editing) state.selected = null;
    rerender();
  });

  const previews = $('#previews');
  previews.addEventListener('pointerdown', (e) => {
    if (!state.editing) return;
    const layer = e.target.closest('.edit-layer');
    if (!layer) return;
    const el = e.target.closest('.el-box');
    if (!el) {
      state.selected = null;
      return rerender();
    }
    e.preventDefault();
    const id = el.dataset.id;
    state.selected = id;
    const t = (state.layout[id] ||= {});
    const b = selBox();
    drag = {
      id, el, pointerId: e.pointerId,
      sx: e.clientX, sy: e.clientY,
      dx: t.dx || 0, dy: t.dy || 0,
      k: Renderer.W / layer.clientWidth,
      baseCx: b ? b.x + b.w / 2 - (t.dx || 0) : Renderer.W / 2,
    };
    layer.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    rerender();
  });
  previews.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const t = state.layout[drag.id];
    t.dx = drag.dx + (e.clientX - drag.sx) * drag.k;
    t.dy = drag.dy + (e.clientY - drag.sy) * drag.k;
    // "ímã" no centro horizontal do story
    if (Math.abs(drag.baseCx + t.dx - Renderer.W / 2) < 18) t.dx = Renderer.W / 2 - drag.baseCx;
    rerender();
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag.el.classList.remove('dragging');
    drag = null;
    saveLayout();
  };
  previews.addEventListener('pointerup', endDrag);
  previews.addEventListener('pointercancel', endDrag);

  function scaleSelected(f) {
    if (!state.selected) return;
    const t = (state.layout[state.selected] ||= {});
    t.s = Math.min(1.8, Math.max(0.5, (t.s || 1) * f));
    saveLayout();
    rerender();
  }
  $('#elSmaller').addEventListener('click', () => scaleSelected(1 / 1.1));
  $('#elBigger').addEventListener('click', () => scaleSelected(1.1));
  $('#elHide').addEventListener('click', () => {
    if (!state.selected || state.selected === 'photos') return;
    const t = (state.layout[state.selected] ||= {});
    t.hidden = !t.hidden;
    saveLayout();
    rerender();
  });
  $('#layoutReset').addEventListener('click', () => {
    state.layout = {};
    state.selected = null;
    Store.del('layout');
    rerender();
    toast('Disposição restaurada.');
  });

  $('#regenBtn').addEventListener('click', () => {
    state.variant++;
    rerender();
  });

  // ---------- Login / conta ----------
  async function refreshMe() {
    try {
      state.me = await (await fetch('/api/me', { cache: 'no-store' })).json();
    } catch {
      state.me = { loggedIn: false };
    }
    const label = $('#accountLabel'), av = $('#accountAvatar');
    label.textContent = state.me.loggedIn ? '@' + state.me.username : 'Entrar';
    if (state.me.loggedIn && state.me.picture) av.innerHTML = `<img alt="" src="${state.me.picture}">`;
    return state.me;
  }

  function savePending() {
    try {
      sessionStorage.setItem('autostory:pending', JSON.stringify({
        url: state.product?.url || $('#linkInput').value,
        selected: state.items.filter((x) => x.on).map((x) => x.src),
        variant: state.variant,
        price: $('#priceInput').value,
        oldPrice: $('#oldPriceInput').value,
        cond: $('#condInput').value,
      }));
    } catch {}
  }

  let loginResolve;
  function login() {
    return new Promise((resolve) => {
      loginResolve = resolve;
      $('#loginError').hidden = true;
      if (state.me.loginAvailable === false) {
        $('#loginError').textContent = 'O login com Instagram ainda não foi configurado no servidor.';
        $('#loginError').hidden = false;
      }
      $('#loginDialog').showModal();
    });
  }
  $('#loginDialog').addEventListener('close', () => {
    if (loginResolve && !state.me.loggedIn) loginResolve(false);
  });
  $('#loginGo').addEventListener('click', () => {
    savePending();
    const w = 520, h = 720;
    const popup = window.open('/auth/instagram', 'autostory-login', `width=${w},height=${h},left=${(screen.width - w) / 2},top=${(screen.height - h) / 2}`);
    if (!popup) return (location.href = '/auth/instagram'); // popup bloqueado: segue no mesmo separador
    const poll = setInterval(async () => {
      if (popup.closed) {
        clearInterval(poll);
        const me = await refreshMe();
        finishLogin(me.loggedIn);
      }
    }, 800);
  });
  window.addEventListener('message', async (e) => {
    if (e.origin !== location.origin || e.data?.type !== 'autostory-auth') return;
    const me = await refreshMe();
    if (!me.loggedIn && e.data.error) {
      $('#loginError').textContent = e.data.error;
      $('#loginError').hidden = false;
      return;
    }
    finishLogin(me.loggedIn);
  });
  function finishLogin(ok) {
    if (!ok) return;
    if ($('#loginDialog').open) $('#loginDialog').close();
    toast(`Conectado como @${state.me.username}`, 'success');
    loginResolve?.(true);
    loginResolve = null;
  }

  $('#accountBtn').addEventListener('click', async () => {
    if (!state.me.loggedIn) return login();
    $('#accountDialogName').textContent = '@' + state.me.username;
    $('#accountDialogAvatar').innerHTML = state.me.picture ? `<img alt="" src="${state.me.picture}">` : $('#accountAvatar').innerHTML;
    $('#accountDialog').showModal();
  });
  $('#logoutBtn').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    $('#accountDialog').close();
    $('#accountAvatar').innerHTML = '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg>';
    await refreshMe();
    toast('Você saiu da conta.');
  });

  // ---------- Postar ----------
  $('#postBtn').addEventListener('click', async () => {
    if (!state.canvases.length) return;
    await refreshMe();
    if (!state.me.loggedIn && !(await login())) return;
    const btn = $('#postBtn');
    busy(btn, true);
    $('#regenBtn').disabled = true;
    try {
      const fd = new FormData();
      for (const [i, c] of state.canvases.entries()) fd.append('images', await Renderer.toBlob(c), `story-${i + 1}.jpg`);
      fd.append('productUrl', state.product?.url || '');
      fd.append('title', state.product?.title || '');
      fd.append('price', $('#priceInput').value);
      fd.append('condition', $('#condInput').value.trim());
      fd.append('highlight', state.hlMode === 'text' ? $('#hlTextInput').value.trim() : state.hlMode === 'hide' ? '' : $('#priceInput').value);
      const res = await fetch('/api/post', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        await refreshMe();
        throw new Error('Sua sessão expirou. Entre novamente.');
      }
      if (!res.ok) throw new Error(data.error || 'Não foi possível postar.');
      toast(data.posted > 1 ? `${data.posted} stories enviados para o Instagram! 🎉` : 'Story enviado para o Instagram! 🎉', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      busy(btn, false);
      $('#regenBtn').disabled = false;
    }
  });

  // ---------- PWA (app do Chrome) ----------
  let deferredInstall;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    $('#installBtn').hidden = false;
  });
  $('#installBtn').addEventListener('click', async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    await deferredInstall.userChoice;
    deferredInstall = null;
    $('#installBtn').hidden = true;
  });
  window.addEventListener('appinstalled', () => ($('#installBtn').hidden = true));
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

  // ---------- Início ----------
  (async () => {
    syncMode();
    await initBackgrounds();
    await refreshMe();
    const params = new URLSearchParams(location.search);

    // Voltando de um login feito no mesmo separador
    if (params.has('resume')) {
      history.replaceState(null, '', '/');
      let pending = null;
      try { pending = JSON.parse(sessionStorage.getItem('autostory:pending')); sessionStorage.removeItem('autostory:pending'); } catch {}
      if (pending?.url) {
        $('#linkInput').value = pending.url;
        await extract(pending.url, pending);
        if (state.me.loggedIn) toast(`Conectado como @${state.me.username}. Toque em Postar.`, 'success');
      }
      return;
    }
    // Compartilhado de outro app (Android: "Compartilhar > Autostory")
    const shared = [params.get('url'), params.get('text'), params.get('title')].join(' ').match(/https?:\/\/\S+/);
    if (shared) {
      history.replaceState(null, '', '/');
      $('#linkInput').value = shared[0];
      extract(shared[0]);
    }
  })();
})();
