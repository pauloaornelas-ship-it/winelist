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
    Object.entries(views).forEach(([k, el]) => (el.hidden = k !== name));
    $('#title').textContent = title;
    $('#btn-back').hidden = !back;
    $('#menu').hidden = true;
    window.scrollTo(0, 0);
  }

  async function route() {
    const [, page, id] = location.hash.split('/');
    if (page === 'novo') return openForm(null);
    if (page === 'editar' && id) return openForm(wines.find((w) => w.id === id));
    if (page === 'vinho' && id) return openDetail(id);
    renderList();
    show('list', 'Os Meus Vinhos', false);
  }

  // ---------- lista ----------
  function renderList() {
    const q = $('#search').value.trim().toLowerCase();
    const type = $('#filter-type').value;
    const sort = $('#sort').value;

    let items = wines.filter((w) => {
      if (type && w.type !== type) return false;
      if (!q) return true;
      return [w.name, w.producer, w.region, w.country, w.grapes, w.notes, w.place, w.year]
        .some((v) => String(v ?? '').toLowerCase().includes(q));
    });

    const cmp = {
      'date-desc': (a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt,
      'rating-desc': (a, b) => (b.rating || 0) - (a.rating || 0),
      'year-desc': (a, b) => (b.year || 0) - (a.year || 0),
      'year-asc': (a, b) => (a.year || 9999) - (b.year || 9999),
      'name-asc': (a, b) => a.name.localeCompare(b.name, 'pt'),
    }[sort];
    items.sort(cmp);

    const list = $('#wine-list');
    list.innerHTML = items.map((w) => `
      <li>
        <a href="#/vinho/${w.id}" class="wine-card">
          ${w.thumb ? `<img src="${blobUrl(w.thumb)}" alt="" loading="lazy">` : `<div class="no-photo">🍷</div>`}
          <div class="wine-info">
            <strong>${esc(w.name)}</strong>
            <span class="meta">${esc([w.year, w.type, w.region].filter(Boolean).join(' · '))}</span>
            ${w.producer ? `<span class="meta">${esc(w.producer)}</span>` : ''}
            <span class="stars" aria-label="${w.rating || 0} de 5">${stars(w.rating)}</span>
          </div>
        </a>
      </li>`).join('');

    $('#empty').hidden = wines.length > 0;
    const rated = wines.filter((w) => w.rating);
    const avg = rated.length ? (rated.reduce((s, w) => s + w.rating, 0) / rated.length).toFixed(1) : null;
    $('#stats').textContent = wines.length
      ? `${items.length === wines.length ? wines.length : `${items.length} de ${wines.length}`} ${wines.length === 1 ? 'vinho' : 'vinhos'}${avg ? ` · média ${avg} ★` : ''}`
      : '';
  }

  // ---------- detalhe ----------
  function openDetail(id) {
    const w = wines.find((x) => x.id === id);
    if (!w) return (location.hash = '#/');
    const field = (label, value) => (value ? `<div class="field"><span>${label}</span><strong>${esc(value)}</strong></div>` : '');
    $('#detail').innerHTML = `
      ${w.photo ? `<img class="detail-photo" src="${blobUrl(w.photo)}" alt="Foto de ${esc(w.name)}">` : ''}
      <div class="detail-body">
        <h2>${esc(w.name)}</h2>
        <div class="stars big">${stars(w.rating)}</div>
        <div class="fields">
          ${field('Ano', w.year)}
          ${field('Tipo', w.type)}
          ${field('Produtor', w.producer)}
          ${field('Região', w.region)}
          ${field('País', w.country)}
          ${field('Castas', w.grapes)}
          ${field('Preço', fmtPrice(w.price))}
          ${field('Provado em', fmtDate(w.date))}
          ${field('Onde / com quem', w.place)}
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
      location.hash = '#/';
    };
    show('detail', 'Detalhe', true);
  }

  // ---------- formulário ----------
  function setRating(n) {
    currentRating = n;
    [...$('#rating-input').children].forEach((b, i) => {
      b.classList.toggle('on', i < n);
      b.setAttribute('aria-checked', i + 1 === n);
    });
  }

  function setPreview(blob) {
    const img = $('#photo-preview');
    img.hidden = !blob;
    $('#photo-placeholder').hidden = !!blob;
    $('#photo-remove').hidden = !blob;
    if (blob) img.src = blobUrl(blob);
  }

  function openForm(wine) {
    if (location.hash.startsWith('#/editar') && !wine) return (location.hash = '#/');
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
    setPreview(w.photo || null);
    fillDatalists();
    show('form', wine ? 'Editar vinho' : 'Novo vinho', true);
  }

  function fillDatalists() {
    for (const key of ['producer', 'region', 'country']) {
      const values = [...new Set(wines.map((w) => w[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt'));
      $(`#dl-${key}`).innerHTML = values.map((v) => `<option value="${esc(v)}">`).join('');
    }
  }

  async function onPhotoChosen(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const [photo, thumb] = await Promise.all([resizeImage(file, MAX_PHOTO), resizeImage(file, MAX_THUMB, 0.8)]);
      pendingPhoto = { photo, thumb };
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
    const wine = {
      ...(editing || { id: uid(), createdAt: Date.now() }),
      name: data.name,
      producer: data.producer.trim(),
      year: data.year ? parseInt(data.year, 10) : null,
      type: data.type,
      region: data.region.trim(),
      country: data.country.trim(),
      grapes: data.grapes.trim(),
      price: data.price !== '' ? parseFloat(data.price) : null,
      date: data.date,
      place: data.place.trim(),
      notes: data.notes.trim(),
      buyAgain: form.elements.buyAgain.checked,
      rating: currentRating,
      updatedAt: Date.now(),
    };
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
    location.hash = `#/vinho/${wine.id}`;
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
      b.onclick = () => setRating(currentRating === i ? 0 : i);
      ri.appendChild(b);
    }

    $('#photo-camera').onchange = onPhotoChosen;
    $('#photo-gallery').onchange = onPhotoChosen;
    $('#photo-remove').onclick = () => { pendingPhoto = null; setPreview(null); };
    form.onsubmit = onSubmit;
    $('#btn-cancel').onclick = () => history.back();
    $('#btn-add').onclick = () => (location.hash = '#/novo');
    $('#btn-back').onclick = () => (history.length > 1 ? history.back() : (location.hash = '#/'));
    ['input', 'change'].forEach((ev) => {
      $('#search').addEventListener(ev, renderList);
      $('#filter-type').addEventListener(ev, renderList);
      $('#sort').addEventListener(ev, renderList);
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
    route();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  init();
})();
