(() => {
  const TYPES = ['Tinto', 'Branco', 'Rosé', 'Verde', 'Espumante', 'Porto', 'Madeira', 'Moscatel', 'Licoroso', 'Outro'];
  const MAX_PHOTO = 1400; // px, lado maior
  const MAX_THUMB = 360;

  const $ = (sel, root = document) => root.querySelector(sel);
  const views = { list: $('#view-list'), detail: $('#view-detail'), form: $('#view-form') };
  const form = $('#wine-form');

  let wines = [];
  let editing = null;          // vinho em edição (ou null para novo)
  let pendingPhoto;            // { photo, thumb } | null (remover) | undefined (sem alteração)
  let currentRating = 0;
  let dirty = false;           // formulário com alterações por guardar
  let currentHash = location.hash;
  let currentView = 'list';
  let favOnly = false;         // filtro "Só favoritos"
  const urlCache = new Map();  // Blob -> object URL

  // ---------- utilitários ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const today = () => new Date().toISOString().slice(0, 10);
  const blobUrl = (blob) => {
    if (!blob) return '';
    if (!urlCache.has(blob)) urlCache.set(blob, URL.createObjectURL(blob));
    return urlCache.get(blob);
  };
  const stars = (n) => '★'.repeat(n || 0) + '☆'.repeat(5 - (n || 0));
  const RATING_TEXT = ['Sem avaliação', 'Fraco', 'Razoável', 'Bom', 'Muito bom', 'Excelente'];
  const starsHtml = (n, cls = '') => (n
    ? `<span class="stars ${cls}" role="img" aria-label="${n} de 5 estrelas: ${RATING_TEXT[n]}">${stars(n)}</span>`
    : `<span class="stars none">${RATING_TEXT[0]}</span>`);
  const fmtDate = (d) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('pt-PT', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const fmtPrice = (p) => (p || p === 0 ? Number(p).toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' }) : '');

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.hidden = true), 2500);
  }

  async function resizeImage(file, max, quality = 0.85) {
    let source;
    try {
      source = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      source = await new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = rej;
        img.src = URL.createObjectURL(file);
      });
    }
    const w = source.width, h = source.height;
    const scale = Math.min(1, max / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
    return new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
  }

  // ---------- navegação ----------
  function show(name, title, back) {
    currentView = name;
    Object.entries(views).forEach(([k, el]) => (el.hidden = k !== name));
    $('#title').textContent = title;
    $('#btn-back').hidden = !back;
    $('#menu').hidden = true;
    const navKey = name === 'list' ? 'list' : location.hash === '#/novo' ? 'new' : '';
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === navKey));
    window.scrollTo(0, 0);
  }

  const confirmDiscard = () => !dirty || confirm('Tem alterações por guardar. Sair sem guardar?');

  // Navega sem acumular histórico (ex.: anterior/seguinte), para o "voltar" regressar à lista.
  function go(hash, { replace = false } = {}) {
    if (hash === location.hash) return route();
    if (replace) location.replace(hash); else location.hash = hash;
  }

  // Destino do botão "voltar" de cada ecrã.
  function backTarget() {
    const [, page, id] = location.hash.split('/');
    if (page === 'editar' && id) return `#/vinho/${id}`;
    return '#/';
  }

  function route() {
    // Proteção contra perda de alterações ao sair do formulário.
    if (currentView === 'form' && location.hash !== currentHash && !confirmDiscard()) {
      history.replaceState(null, '', currentHash || '#/');
      return;
    }
    dirty = false;
    currentHash = location.hash;
    const [, page, id] = location.hash.split('/');
    if (page === 'novo') return openForm(null);
    if (page === 'editar' && id) return openForm(wines.find((w) => w.id === id));
    if (page === 'vinho' && id) return openDetail(id);
    renderList();
    show('list', 'Os Meus Vinhos', false);
  }

  // ---------- anterior / seguinte ----------
  function pager(id, mode) {
    const ids = visibleWines().map((w) => w.id);
    const i = ids.indexOf(id);
    if (i < 0) return '';
    const prev = ids[i - 1], next = ids[i + 1];
    const href = (x) => (mode === 'edit' ? `#/editar/${x}` : `#/vinho/${x}`);
    const btn = (x, label, cls) => x
      ? `<a class="pager-btn ${cls}" href="${href(x)}" data-pager>${label}</a>`
      : `<span class="pager-btn ${cls} disabled" aria-disabled="true">${label}</span>`;
    return `<div class="pager">
      ${btn(prev, '‹ Anterior', 'prev')}
      <span class="pager-pos">${i + 1} de ${ids.length}</span>
      ${btn(next, 'Seguinte ›', 'next')}
    </div>`;
  }

  function adjacent(step) {
    const [, page, id] = location.hash.split('/');
    if (!id || (page !== 'vinho' && page !== 'editar')) return;
    const ids = visibleWines().map((w) => w.id);
    const target = ids[ids.indexOf(id) + step];
    if (target) go(`#/${page}/${target}`, { replace: true });
  }

  // ---------- lista ----------
  // Vinhos visíveis segundo a pesquisa, filtro e ordenação atuais (usado também no anterior/seguinte).
  function visibleWines() {
    const q = $('#search').value.trim().toLowerCase();
    const type = $('#filter-type').value;
    const sort = $('#sort').value;

    let items = wines.filter((w) => {
      if (type && w.type !== type) return false;
      if (favOnly && !w.favorite) return false;
      if (!q) return true;
      return [w.name, w.producer, w.region, w.country, w.grapes, w.notes, w.whereToBuy, w.year]
        .some((v) => String(v ?? '').toLowerCase().includes(q));
    });

    const cmp = {
      'date-desc': (a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt,
      'rating-desc': (a, b) => (b.rating || 0) - (a.rating || 0),
      'year-desc': (a, b) => (b.year || 0) - (a.year || 0),
      'year-asc': (a, b) => (a.year || 9999) - (b.year || 9999),
      'name-asc': (a, b) => a.name.localeCompare(b.name, 'pt'),
    }[sort];
    return items.sort(cmp);
  }

  function renderList() {
    const items = visibleWines();
    const list = $('#wine-list');
    list.innerHTML = items.map((w) => `
      <li class="wine-item">
        ${favButton(w, 'card')}
        <a href="#/vinho/${w.id}" class="wine-card">
          ${w.thumb ? `<img src="${blobUrl(w.thumb)}" alt="" loading="lazy">` : `<div class="no-photo">🍷</div>`}
          <div class="wine-info">
            <strong>${esc(w.name)}</strong>
            <span class="meta">${esc([w.year, w.type, w.region].filter(Boolean).join(' · '))}</span>
            ${w.producer ? `<span class="meta">${esc(w.producer)}</span>` : ''}
            ${starsHtml(w.rating)}
          </div>
        </a>
      </li>`).join('');

    $('#empty').hidden = wines.length > 0;
    $('#no-results').hidden = !(wines.length > 0 && items.length === 0);
    const rated = wines.filter((w) => w.rating);
    const avg = rated.length ? (rated.reduce((s, w) => s + w.rating, 0) / rated.length).toFixed(1) : null;
    const favs = wines.filter((w) => w.favorite).length;
    $('#stats').textContent = wines.length
      ? `${items.length === wines.length ? wines.length : `${items.length} de ${wines.length}`} ${wines.length === 1 ? 'vinho' : 'vinhos'}${favs ? ` · ${favs} ♥` : ''}${avg ? ` · média ${avg} ★` : ''}`
      : '';
    const chip = $('#filter-fav');
    chip.setAttribute('aria-pressed', favOnly);
    chip.textContent = favOnly ? '♥ Só favoritos' : '♡ Só favoritos';
    chip.hidden = wines.length === 0;
  }

  // ---------- favoritos ----------
  function favButton(w, where) {
    const on = !!w.favorite;
    return `<button type="button" class="fav-btn fav-${where}${on ? ' on' : ''}" data-fav="${w.id}"
      aria-pressed="${on}" aria-label="${on ? 'Remover dos favoritos' : 'Marcar como favorito'}"
      title="${on ? 'Remover dos favoritos' : 'Marcar como favorito'}">${on ? '♥' : '♡'}</button>`;
  }

  async function toggleFavorite(id) {
    const w = wines.find((x) => x.id === id);
    if (!w) return;
    const updated = { ...w, favorite: !w.favorite, updatedAt: Date.now() };
    try {
      await WineDB.put(updated);
    } catch (err) {
      console.error(err);
      return toast('Erro ao guardar');
    }
    wines[wines.indexOf(w)] = updated;
    toast(updated.favorite ? 'Adicionado aos favoritos ♥' : 'Removido dos favoritos');
    if (currentView === 'list') renderList();
    document.querySelectorAll(`[data-fav="${id}"]`).forEach((b) => {
      const where = b.classList.contains('fav-detail') ? 'detail' : 'card';
      b.outerHTML = favButton(updated, where);
    });
  }

  // ---------- detalhe ----------
  function openDetail(id) {
    const w = wines.find((x) => x.id === id);
    if (!w) return go('#/', { replace: true });
    const field = (label, value) => (value ? `<div class="field"><span>${label}</span><strong>${esc(value)}</strong></div>` : '');
    $('#detail').innerHTML = `
      ${w.photo ? `<button type="button" class="photo-zoom" data-zoom aria-label="Ver foto em ecrã inteiro">
        <img class="detail-photo" src="${blobUrl(w.photo)}" alt="Foto de ${esc(w.name)}">
        <span class="zoom-hint" aria-hidden="true">⤢ Ampliar</span>
      </button>` : ''}
      <div class="detail-body">
        <div class="title-row">
          <h2>${esc(w.name)}</h2>
          ${favButton(w, 'detail')}
        </div>
        <div class="rating-big">${starsHtml(w.rating, 'big')}</div>
        <div class="fields">
          ${field('Ano', w.year)}
          ${field('Tipo', w.type)}
          ${field('Produtor', w.producer)}
          ${field('Região', w.region)}
          ${field('País', w.country)}
          ${field('Castas', w.grapes)}
          ${field('Preço', fmtPrice(w.price))}
          ${field('Provado em', fmtDate(w.date))}
          ${field('Onde comprar', w.whereToBuy)}
          ${w.buyAgain ? field('Voltaria a comprar', 'Sim 👍') : ''}
        </div>
        ${w.notes ? `<h3>Notas</h3><p class="notes">${esc(w.notes)}</p>` : ''}
        <div class="form-actions">
          <button class="btn btn-danger" id="btn-delete">Apagar</button>
          <a class="btn" href="#/editar/${w.id}">Editar</a>
        </div>
      </div>`;
    $('#btn-delete').onclick = async () => {
      if (!confirm(`Apagar "${w.name}"?`)) return;
      await WineDB.remove(w.id);
      wines = wines.filter((x) => x.id !== w.id);
      toast('Vinho apagado');
      go('#/', { replace: true });
    };
    $('#detail-pager').innerHTML = pager(w.id, 'detail');
    show('detail', 'Detalhe', true);
  }

  // ---------- formulário ----------
  function setRating(n) {
    currentRating = n;
    [...$('#rating-input').children].forEach((b, i) => {
      b.classList.toggle('on', i < n);
      b.setAttribute('aria-checked', i + 1 === n);
    });
    $('#rating-text').textContent = RATING_TEXT[n];
  }

  function setPreview(blob) {
    const img = $('#photo-preview');
    img.hidden = !blob;
    $('#photo-placeholder').hidden = !!blob;
    $('#photo-remove').hidden = !blob;
    if (blob) img.src = blobUrl(blob);
  }

  function openForm(wine) {
    if (location.hash.startsWith('#/editar') && !wine) return go('#/', { replace: true });
    editing = wine || null;
    pendingPhoto = undefined;
    form.reset();
    const w = wine || { date: today(), type: 'Tinto', country: 'Portugal' };
    for (const el of form.elements) {
      if (!el.name) continue;
      if (el.type === 'checkbox') el.checked = !!w[el.name];
      else el.value = w[el.name] ?? '';
    }
    setRating(w.rating || 0);
    setYearError('');
    setPreview(w.photo || null);
    fillDatalists();
    $('#form-pager').innerHTML = wine ? pager(wine.id, 'edit') : '';
    dirty = false;
    show('form', wine ? 'Editar vinho' : 'Novo vinho', true);
  }

  function fillDatalists() {
    for (const key of ['producer', 'region', 'country', 'whereToBuy']) {
      const values = [...new Set(wines.map((w) => w[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt'));
      $(`#dl-${key}`).innerHTML = values.map((v) => `<option value="${esc(v)}">`).join('');
    }
  }

  function setYearError(msg) {
    const el = $('#year-error');
    el.textContent = msg;
    el.hidden = !msg;
    form.elements.year.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }

  async function onPhotoChosen(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const [photo, thumb] = await Promise.all([resizeImage(file, MAX_PHOTO), resizeImage(file, MAX_THUMB, 0.8)]);
      pendingPhoto = { photo, thumb };
      dirty = true;
      setPreview(photo);
    } catch (err) {
      console.error(err);
      toast('Não foi possível ler a imagem');
    }
  }

  async function onSubmit(e) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    data.name = (data.name || '').trim();
    if (!data.name) {
      form.elements.name.focus();
      return toast('Indique o nome do vinho');
    }
    // Se o campo não existir (ex.: página de uma versão antiga em cache), mantém o valor guardado.
    const checked = (n) => (form.elements[n] ? form.elements[n].checked : !!(editing && editing[n]));
    const year = data.year ? parseInt(data.year, 10) : null;
    const maxYear = new Date().getFullYear() + 1;
    if (data.year && (!year || year < 1900 || year > maxYear)) {
      setYearError(`Indique um ano entre 1900 e ${maxYear}.`);
      form.elements.year.focus();
      return;
    }
    setYearError('');
    const wine = {
      ...(editing || { id: uid(), createdAt: Date.now() }),
      name: data.name,
      producer: data.producer.trim(),
      year,
      type: data.type,
      region: data.region.trim(),
      country: data.country.trim(),
      grapes: data.grapes.trim(),
      price: data.price !== '' ? parseFloat(data.price) : null,
      date: data.date,
      whereToBuy: data.whereToBuy.trim(),
      notes: data.notes.trim(),
      buyAgain: checked('buyAgain'),
      favorite: checked('favorite'),
      rating: currentRating,
      updatedAt: Date.now(),
    };
    delete wine.place; // campo antigo "Onde / com quem", já não usado
    if (pendingPhoto === null) { wine.photo = null; wine.thumb = null; }
    else if (pendingPhoto) { wine.photo = pendingPhoto.photo; wine.thumb = pendingPhoto.thumb; }

    try {
      await WineDB.put(wine);
    } catch (err) {
      console.error(err);
      return toast('Erro ao guardar');
    }
    const i = wines.findIndex((w) => w.id === wine.id);
    if (i >= 0) wines[i] = wine; else wines.push(wine);
    toast('Vinho guardado');
    dirty = false;
    currentView = 'saving';
    go(`#/vinho/${wine.id}`, { replace: true });
  }

  // ---------- exportar / importar ----------
  const blobToDataURL = (blob) => new Promise((res) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.readAsDataURL(blob);
  });
  const dataURLToBlob = async (url) => (url ? (await fetch(url)).blob() : null);

  async function exportData() {
    const out = [];
    for (const w of wines) {
      out.push({
        ...w,
        photo: w.photo ? await blobToDataURL(w.photo) : null,
        thumb: w.thumb ? await blobToDataURL(w.thumb) : null,
      });
    }
    const blob = new Blob([JSON.stringify({ app: 'winelist', version: 1, exportedAt: new Date().toISOString(), wines: out })], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `os-meus-vinhos-${today()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Cópia de segurança exportada');
  }

  async function importData(file) {
    try {
      const json = JSON.parse(await file.text());
      const list = Array.isArray(json) ? json : json.wines;
      if (!Array.isArray(list)) throw new Error('formato inválido');
      let n = 0;
      for (const item of list) {
        if (!item || !item.name) continue;
        const wine = {
          ...item,
          id: item.id || uid(),
          photo: await dataURLToBlob(item.photo),
          thumb: await dataURLToBlob(item.thumb),
        };
        await WineDB.put(wine);
        n++;
      }
      wines = await WineDB.all();
      initTypeFilter();
      route();
      toast(`${n} vinhos importados`);
    } catch (err) {
      console.error(err);
      toast('Ficheiro inválido');
    }
  }

  // ---------- arranque ----------
  // ---------- preferências (ordenação e filtro) ----------
  const PREFS_KEY = 'winelist-prefs';
  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ sort: $('#sort').value, type: $('#filter-type').value, favOnly }));
    } catch { /* armazenamento indisponível: ignora */ }
  }
  function loadPrefs() {
    let prefs = {};
    try { prefs = JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { /* ignora */ }
    const apply = (sel, value) => {
      if (value != null && [...sel.options].some((o) => o.value === value)) sel.value = value;
    };
    apply($('#sort'), prefs.sort);
    apply($('#filter-type'), prefs.type);
    favOnly = prefs.favOnly === true;
  }

  // ---------- foto em ecrã inteiro ----------
  const viewer = $('#viewer');
  function openViewer(src, alt) {
    $('#viewer-img').src = src;
    $('#viewer-img').alt = alt || '';
    viewer.hidden = false;
    document.body.classList.add('no-scroll');
    history.pushState({ viewer: true }, '', location.hash); // "voltar" do telemóvel fecha a foto
    $('#viewer-close').focus();
  }
  function hideViewer() {
    viewer.hidden = true;
    document.body.classList.remove('no-scroll');
  }
  function closeViewer() {
    if (viewer.hidden) return;
    if (history.state && history.state.viewer) history.back(); else hideViewer();
  }

  function initTypeFilter() {
    const used = new Set(wines.map((w) => w.type).filter(Boolean));
    const all = [...TYPES, ...[...used].filter((t) => !TYPES.includes(t))];
    const sel = $('#filter-type');
    const cur = sel.value;
    sel.innerHTML = '<option value="">Todos os tipos</option>' + all.map((t) => `<option>${esc(t)}</option>`).join('');
    sel.value = cur;
    form.elements.type.innerHTML = all.map((t) => `<option>${esc(t)}</option>`).join('');
  }

  function bind() {
    const ri = $('#rating-input');
    for (let i = 1; i <= 5; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = '★';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', `${i} estrela${i > 1 ? 's' : ''}`);
      b.onclick = () => { setRating(currentRating === i ? 0 : i); dirty = true; };
      ri.appendChild(b);
    }

    $('#photo-camera').onchange = onPhotoChosen;
    $('#photo-gallery').onchange = onPhotoChosen;
    $('#photo-remove').onclick = () => { pendingPhoto = null; dirty = true; setPreview(null); };
    form.onsubmit = onSubmit;
    form.addEventListener('input', (e) => { dirty = true; if (e.target.name === 'year') setYearError(''); });
    $('#btn-clear-filters').onclick = () => {
      $('#search').value = '';
      $('#filter-type').value = '';
      favOnly = false;
      savePrefs();
      renderList();
    };

    // Favoritos: coração na lista e no detalhe, e filtro "Só favoritos".
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-fav]');
      if (b) { e.preventDefault(); toggleFavorite(b.dataset.fav); }
    });
    $('#filter-fav').onclick = () => { favOnly = !favOnly; savePrefs(); renderList(); };

    // Foto em ecrã inteiro (detalhe e pré-visualização do formulário).
    document.addEventListener('click', (e) => {
      const z = e.target.closest('[data-zoom]');
      if (z) { const img = z.querySelector('img'); openViewer(img.src, img.alt); }
    });
    $('#photo-preview').addEventListener('click', (e) => openViewer(e.target.src, 'Foto do rótulo'));
    $('#viewer-close').onclick = closeViewer;
    viewer.addEventListener('click', (e) => { if (e.target === viewer) closeViewer(); });
    window.addEventListener('popstate', () => { if (!viewer.hidden) hideViewer(); });
    $('#btn-cancel').onclick = () => go(backTarget(), { replace: true });
    $('#btn-back').onclick = () => go(backTarget(), { replace: true });

    // Anterior/seguinte sem encher o histórico.
    document.addEventListener('click', (e) => {
      const a = e.target.closest('[data-pager]');
      if (!a) return;
      e.preventDefault();
      go(a.getAttribute('href'), { replace: true });
    });

    // Setas do teclado no detalhe.
    document.addEventListener('keydown', (e) => {
      if (!viewer.hidden) { if (e.key === 'Escape') closeViewer(); return; }
      if (currentView !== 'detail' || e.target.closest('input, textarea, select')) return;
      if (e.key === 'ArrowLeft') adjacent(-1);
      if (e.key === 'ArrowRight') adjacent(1);
    });

    // Deslizar o dedo no detalhe: esquerda = seguinte, direita = anterior.
    let touch = null;
    views.detail.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      touch = e.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null;
    }, { passive: true });
    views.detail.addEventListener('touchend', (e) => {
      if (!touch) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - touch.x, dy = t.clientY - touch.y;
      touch = null;
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) adjacent(dx < 0 ? 1 : -1);
    }, { passive: true });

    window.addEventListener('beforeunload', (e) => {
      if (currentView === 'form' && dirty) { e.preventDefault(); e.returnValue = ''; }
    });
    ['input', 'change'].forEach((ev) => {
      $('#search').addEventListener(ev, renderList);
      $('#filter-type').addEventListener(ev, () => { savePrefs(); renderList(); });
      $('#sort').addEventListener(ev, () => { savePrefs(); renderList(); });
    });

    $('#btn-menu').onclick = (e) => { e.stopPropagation(); $('#menu').hidden = !$('#menu').hidden; };
    document.addEventListener('click', (e) => { if (!$('#menu').contains(e.target)) $('#menu').hidden = true; });
    $('[data-action="export"]').onclick = exportData;
    $('#import-file').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; $('#menu').hidden = true; if (f) importData(f); };

    window.addEventListener('hashchange', route);
  }

  async function init() {
    bind();
    try {
      wines = await WineDB.all();
    } catch (err) {
      console.error(err);
      toast('Armazenamento indisponível neste navegador');
    }
    initTypeFilter();
    loadPrefs();
    route();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      const hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.register('sw.js').catch(() => {});
      // Quando uma nova versão da app fica ativa, recarrega para usar todos os ficheiros novos
      // (exceto se houver um formulário com alterações por guardar).
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (hadController && !(currentView === 'form' && dirty)) location.reload();
      });
    }
  }

  init();
})();
