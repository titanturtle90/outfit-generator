/* =============================================================
   app.js — UI wiring: closet management, week rendering, history.
   ============================================================= */
(function () {
  'use strict';

  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  const state = {
    items: [],
    outfits: [],          // every outfit ever generated or worn, keyed by date
    settings: null,
    viewMonday: Outfit.weekStart(new Date()),
    editingId: null,
    pendingImage: null,   // resized Blob for the item being added
    colorTouched: false,  // user has set the colour by hand; auto-detect must not overwrite it
    queue: [],            // extra files dropped in one go, added one at a time
    filter: 'all'
  };

  const objectUrls = new Map();
  function urlFor(item) {
    if (!item.image) return null;
    if (!objectUrls.has(item.id)) objectUrls.set(item.id, URL.createObjectURL(item.image));
    return objectUrls.get(item.id);
  }
  function forgetUrl(id) {
    if (objectUrls.has(id)) { URL.revokeObjectURL(objectUrls.get(id)); objectUrls.delete(id); }
  }

  const byId = id => state.items.find(i => i.id === id);

  /* ---------------------- boot ---------------------- */

  Promise.all([DB.getItems(), DB.getOutfits(), DB.getSettings()])
    .then(([items, outfits, settings]) => {
      state.items = items;
      state.outfits = outfits;
      state.settings = settings;
      hydrateSettingsForm();
      bindEvents();
      renderAll();
      ensureWeek();
    })
    .catch(err => {
      console.error(err);
      toast('Could not open local storage. Try a normal (non-private) window.', 6000);
    });

  function renderAll() {
    renderWeek();
    renderCloset();
    renderHistory();
  }

  /* ---------------------- navigation ---------------------- */

  function bindEvents() {
    $('#tabs').addEventListener('click', e => {
      const tab = e.target.closest('.tab');
      if (tab) showView(tab.dataset.view);
    });
    document.body.addEventListener('click', e => {
      const goto = e.target.closest('[data-goto]');
      if (goto) showView(goto.dataset.goto);
    });

    $('#week-prev').addEventListener('click', () => shiftWeek(-7));
    $('#week-next').addEventListener('click', () => shiftWeek(7));
    $('#week-today').addEventListener('click', () => {
      state.viewMonday = Outfit.weekStart(new Date());
      renderWeek(); ensureWeek();
    });
    $('#regenerate').addEventListener('click', () => buildWeek({ force: true }));

    const slider = $('#weight-slider');
    slider.addEventListener('input', () => {
      state.settings.colorWeight = Number(slider.value) / 100;
    });
    slider.addEventListener('change', () => {
      DB.saveSettings({ colorWeight: state.settings.colorWeight })
        .then(() => buildWeek({ force: true }));
    });

    bindClosetEvents();
    bindSettingsEvents();
  }

  function showView(name) {
    $$('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.view === name));
    $$('.view').forEach(v => v.classList.toggle('is-active', v.id === 'view-' + name));
    window.scrollTo({ top: 0 });
  }

  function shiftWeek(days) {
    const d = new Date(state.viewMonday);
    d.setDate(d.getDate() + days);
    state.viewMonday = d;
    renderWeek();
    ensureWeek();
  }

  /* ---------------------- week ---------------------- */

  const currentDates = () => Outfit.workDatesFor(state.viewMonday, state.settings.workDays);

  const outfitFor = dateKey => state.outfits.find(o => o.date === dateKey);

  /**
   * Re-plan the visible week after the closet changes. Days the user locked or
   * already marked worn are left alone; everything else is re-cut so newly
   * added clothes are usable immediately instead of next week.
   */
  function replanWeek() {
    if (!currentDates().length) return;
    buildWeek({ force: true });
  }

  /** Generate the visible week if it has no outfits yet. */
  function ensureWeek() {
    const dates = currentDates();
    if (!dates.length) return;
    const missing = dates.some(d => !outfitFor(Outfit.toKey(d)));
    if (missing) buildWeek({ force: false });
  }

  function buildWeek({ force }) {
    const dates = currentDates();
    if (!dates.length) { renderWeek(); return; }

    // Locked days and days already worn are never regenerated.
    const locked = {};
    for (const d of dates) {
      const key = Outfit.toKey(d);
      const existing = outfitFor(key);
      if (!existing) continue;
      if (existing.status === 'worn' || existing.locked) locked[key] = existing;
      else if (!force) locked[key] = existing;
    }

    const res = Outfit.generateWeek({
      dates,
      items: state.items,
      outfits: state.outfits.filter(o => o.status === 'worn'),
      settings: state.settings,
      locked
    });

    if (res.error) { renderWeek(res.error); return; }

    const writes = res.days
      .filter(day => !locked[day.date])
      .map(day => {
        upsertOutfit(day);
        return DB.putOutfit(day);
      });

    Promise.all(writes).then(() => renderWeek());
  }

  function upsertOutfit(day) {
    const idx = state.outfits.findIndex(o => o.date === day.date);
    if (idx >= 0) state.outfits[idx] = day; else state.outfits.push(day);
  }

  function renderWeek(errorMessage) {
    const error = typeof errorMessage === 'string' ? errorMessage : null;
    const dates = currentDates();
    const monday = state.viewMonday;
    const thisMonday = Outfit.weekStart(new Date());
    const diff = Math.round((monday - thisMonday) / 86400000 / 7);

    $('#week-title').textContent =
      diff === 0 ? 'This week' : diff === 1 ? 'Next week' : diff === -1 ? 'Last week'
      : diff > 0 ? `In ${diff} weeks` : `${Math.abs(diff)} weeks ago`;

    const fmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
    const end = new Date(monday); end.setDate(end.getDate() + 6);
    $('#week-range').textContent = `${fmt.format(monday)} – ${fmt.format(end)}`;
    $('#weight-slider').value = Math.round((1 - state.settings.colorWeight) * 100);

    const grid = $('#day-grid');
    const empty = $('#week-empty');

    const shirts = state.items.filter(i => i.category === 'shirt' && i.inRotation !== false);
    const pantsList = state.items.filter(i => i.category === 'pants' && i.inRotation !== false);

    if (error || !shirts.length || !pantsList.length) {
      empty.classList.remove('hidden');
      $('#week-empty-msg').textContent = error ||
        'Add at least one shirt and one pair of pants to start generating outfits.';
      grid.innerHTML = '';
      return;
    }
    empty.classList.add('hidden');

    if (!dates.length) {
      grid.innerHTML = '<p class="empty muted">No work days selected. Pick some in Settings.</p>';
      return;
    }

    const todayKey = Outfit.toKey(new Date());
    grid.innerHTML = '';

    for (const date of dates) {
      const key = Outfit.toKey(date);
      const outfit = outfitFor(key);
      grid.appendChild(dayCard(date, key, outfit, key === todayKey));
    }
  }

  function dayCard(date, key, outfit, isToday) {
    const card = document.createElement('article');
    card.className = 'day-card' + (isToday ? ' is-today' : '');
    if (outfit && outfit.status === 'worn') card.classList.add('is-worn');

    const fmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
    const head = document.createElement('header');
    head.className = 'day-head';
    head.innerHTML =
      `<div><h3>${Outfit.DAY_NAMES[date.getDay()]}</h3>
       <span class="muted">${fmt.format(date)}${isToday ? ' · today' : ''}</span></div>`;

    if (outfit) {
      const badge = document.createElement('div');
      badge.className = 'badges';
      badge.innerHTML =
        `<span class="badge" title="Color harmony">${outfit.colorScore}<em>color</em></span>` +
        `<span class="badge" title="How overdue these pieces are">${outfit.varietyScore}<em>fresh</em></span>`;
      head.appendChild(badge);
    }
    card.appendChild(head);

    if (!outfit) {
      const p = document.createElement('p');
      p.className = 'muted pad';
      p.textContent = 'No outfit yet.';
      card.appendChild(p);
      return card;
    }

    const pieces = document.createElement('div');
    pieces.className = 'pieces';
    [['shirtId', 'Shirt'], ['pantsId', 'Pants'], ['shoesId', 'Shoes']].forEach(([field, label]) => {
      const item = byId(outfit[field]);
      if (!item) return;
      pieces.appendChild(pieceEl(item, label));
    });
    card.appendChild(pieces);

    if (outfit.notes && outfit.notes.length) {
      const why = document.createElement('ul');
      why.className = 'why';
      outfit.notes.slice(0, 3).forEach(n => {
        const li = document.createElement('li');
        li.textContent = n;
        why.appendChild(li);
      });
      card.appendChild(why);
    }

    const actions = document.createElement('div');
    actions.className = 'day-actions';

    if (outfit.status === 'worn') {
      const worn = document.createElement('span');
      worn.className = 'worn-flag';
      worn.textContent = '✓ Worn';
      actions.appendChild(worn);

      const undo = button('Undo', 'btn-ghost', () => unmarkWorn(outfit));
      actions.appendChild(undo);
    } else {
      actions.appendChild(button('Shuffle', 'btn-ghost', () => shuffleDay(date)));
      actions.appendChild(button(outfit.locked ? '🔒 Locked' : 'Lock', 'btn-ghost', () => {
        outfit.locked = !outfit.locked;
        DB.putOutfit(outfit).then(() => renderWeek());
      }));
      actions.appendChild(button('Mark worn', 'btn-primary', () => markWorn(outfit)));
    }
    card.appendChild(actions);
    return card;
  }

  function pieceEl(item, label) {
    const el = document.createElement('div');
    el.className = 'piece';
    const url = urlFor(item);
    el.innerHTML =
      `<div class="thumb" style="background:${item.color}">` +
        (url ? `<img src="${url}" alt="${escapeHtml(item.name)}">` : '') +
      `</div>` +
      `<div class="piece-meta">` +
        `<span class="piece-label">${label}</span>` +
        `<strong>${escapeHtml(item.name)}</strong>` +
        `<span class="muted">${Color.name(item.color)} · worn ${item.wearCount || 0}×</span>` +
      `</div>`;
    return el;
  }

  function shuffleDay(date) {
    const res = Outfit.regenerateDay({
      date,
      items: state.items,
      outfits: state.outfits.filter(o => o.status === 'worn'),
      settings: state.settings,
      weekOutfits: currentDates().map(d => outfitFor(Outfit.toKey(d))).filter(Boolean)
    });
    if (res.error || !res.days.length) { toast(res.error || 'Nothing to shuffle.'); return; }
    const day = res.days[0];
    upsertOutfit(day);
    DB.putOutfit(day).then(() => renderWeek());
  }

  function markWorn(outfit) {
    outfit.status = 'worn';
    outfit.wornAt = Date.now();

    const updates = ['shirtId', 'pantsId', 'shoesId']
      .map(f => byId(outfit[f]))
      .filter(Boolean)
      .map(item => {
        item.wearCount = (item.wearCount || 0) + 1;
        item.lastWorn = outfit.date;
        return DB.putItem(item);
      });

    Promise.all(updates.concat(DB.putOutfit(outfit)))
      .then(() => { renderWeek(); renderCloset(); renderHistory(); toast('Logged.'); });
  }

  function unmarkWorn(outfit) {
    outfit.status = 'planned';
    delete outfit.wornAt;

    const updates = ['shirtId', 'pantsId', 'shoesId']
      .map(f => byId(outfit[f]))
      .filter(Boolean)
      .map(item => {
        item.wearCount = Math.max(0, (item.wearCount || 0) - 1);
        // Fall back to the most recent other outfit that used this item.
        const prior = state.outfits
          .filter(o => o.status === 'worn' && o.date !== outfit.date &&
                       [o.shirtId, o.pantsId, o.shoesId].includes(item.id))
          .map(o => o.date).sort();
        item.lastWorn = prior.length ? prior[prior.length - 1] : null;
        return DB.putItem(item);
      });

    Promise.all(updates.concat(DB.putOutfit(outfit)))
      .then(() => { renderWeek(); renderCloset(); renderHistory(); });
  }

  /* ---------------------- closet ---------------------- */

  function bindClosetEvents() {
    const zone = $('#drop-zone');
    const input = $('#file-input');

    zone.addEventListener('click', () => input.click());
    zone.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, e => {
      e.preventDefault(); zone.classList.add('is-over');
    }));
    ['dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, e => {
      e.preventDefault(); zone.classList.remove('is-over');
    }));
    zone.addEventListener('drop', e => handleFiles(e.dataTransfer.files));
    input.addEventListener('change', () => { handleFiles(input.files); input.value = ''; });

    $('#item-color').addEventListener('input', e => {
      state.colorTouched = true;
      $('#color-name').textContent = Color.name(e.target.value);
    });

    $('#add-form').addEventListener('submit', e => { e.preventDefault(); saveItem(); });
    $('#cancel-edit').addEventListener('click', resetForm);

    $$('.closet-filters .chip').forEach(chip => chip.addEventListener('click', () => {
      state.filter = chip.dataset.filter;
      $$('.closet-filters .chip').forEach(c => c.classList.toggle('is-active', c === chip));
      renderCloset();
    }));

    $('#closet-grid').addEventListener('click', e => {
      const card = e.target.closest('.item-card');
      if (!card) return;
      const item = byId(card.dataset.id);
      if (!item) return;

      if (e.target.closest('[data-action="delete"]')) return removeItem(item);
      if (e.target.closest('[data-action="edit"]')) return editItem(item);
      if (e.target.closest('[data-action="rotation"]')) {
        item.inRotation = item.inRotation === false;
        return DB.putItem(item).then(() => { renderCloset(); replanWeek(); });
      }
    });
  }

  function handleFiles(fileList) {
    const files = Array.from(fileList).filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    state.queue = files.slice(1);
    loadIntoForm(files[0]);
    renderQueue();
  }

  /** Downscale on the way in — full-resolution phone photos would blow up storage. */
  function prepareImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const MAX = 700;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);

        const palette = Color.extractPalette(img, 4);
        canvas.toBlob(blob => {
          URL.revokeObjectURL(url);
          resolve({ blob, palette, preview: canvas.toDataURL('image/jpeg', 0.8) });
        }, 'image/jpeg', 0.82);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
      img.src = url;
    });
  }

  function loadIntoForm(file) {
    state.colorTouched = false;
    prepareImage(file).then(({ blob, palette, preview }) => {
      state.pendingImage = blob;
      const img = $('#preview');
      img.src = preview;
      img.classList.remove('hidden');
      $('#drop-hint').classList.add('hidden');

      // Extraction finished after the user already chose a colour — leave it alone.
      if (!state.colorTouched) {
        $('#item-color').value = palette[0];
        $('#color-name').textContent = Color.name(palette[0]);
      }
      renderSuggestions(palette);

      if (!$('#item-name').value) {
        const base = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
        $('#item-name').value = base ? base.charAt(0).toUpperCase() + base.slice(1) : '';
      }
      $('#item-name').focus();
    }).catch(err => toast(err.message));
  }

  function renderSuggestions(palette) {
    const wrap = $('#swatch-suggestions');
    wrap.innerHTML = '';
    palette.forEach(hex => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.style.background = hex;
      b.title = Color.name(hex);
      b.addEventListener('click', () => {
        state.colorTouched = true;
        $('#item-color').value = hex;
        $('#color-name').textContent = Color.name(hex);
      });
      wrap.appendChild(b);
    });
  }

  function renderQueue() {
    const wrap = $('#closet-queue');
    if (!state.queue.length) { wrap.classList.add('hidden'); wrap.innerHTML = ''; return; }
    wrap.classList.remove('hidden');
    wrap.innerHTML = `<span class="muted">${state.queue.length} more photo${state.queue.length === 1 ? '' : 's'} queued — they'll load in one at a time as you save.</span>`;
  }

  function saveItem() {
    const name = $('#item-name').value.trim();
    if (!name) { toast('Give it a name.'); return; }

    const base = state.editingId ? byId(state.editingId) : {};
    const item = Object.assign({}, base, {
      name,
      category: $('#item-category').value,
      color: $('#item-color').value,
      inRotation: $('#item-rotation').checked
    });
    if (state.pendingImage) item.image = state.pendingImage;

    DB.putItem(item).then(saved => {
      forgetUrl(saved.id);
      const idx = state.items.findIndex(i => i.id === saved.id);
      if (idx >= 0) state.items[idx] = saved; else state.items.push(saved);

      const next = state.queue.shift();
      resetForm();
      renderCloset();
      replanWeek();
      toast(`${saved.name} saved.`);

      if (next) { loadIntoForm(next); renderQueue(); }
      else { renderQueue(); }
    });
  }

  function editItem(item) {
    state.editingId = item.id;
    state.pendingImage = null;
    state.colorTouched = true;
    $('#item-name').value = item.name;
    $('#item-category').value = item.category;
    $('#item-color').value = item.color;
    $('#color-name').textContent = Color.name(item.color);
    $('#item-rotation').checked = item.inRotation !== false;
    $('#save-item').textContent = 'Save changes';
    $('#cancel-edit').classList.remove('hidden');

    const img = $('#preview');
    const url = urlFor(item);
    if (url) { img.src = url; img.classList.remove('hidden'); $('#drop-hint').classList.add('hidden'); }
    $('#add-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function resetForm() {
    state.editingId = null;
    state.pendingImage = null;
    state.colorTouched = false;
    $('#add-form').reset();
    $('#item-rotation').checked = true;
    $('#preview').classList.add('hidden');
    $('#preview').src = '';
    $('#drop-hint').classList.remove('hidden');
    $('#swatch-suggestions').innerHTML = '';
    $('#color-name').textContent = '—';
    $('#save-item').textContent = 'Add to closet';
    $('#cancel-edit').classList.add('hidden');
  }

  function removeItem(item) {
    if (!confirm(`Delete "${item.name}"? Outfits already worn keep their record.`)) return;

    // Planned outfits referencing this item are no longer valid.
    const orphaned = state.outfits.filter(o =>
      o.status !== 'worn' && [o.shirtId, o.pantsId, o.shoesId].includes(item.id));

    Promise.all([DB.deleteItem(item.id)].concat(orphaned.map(o => DB.deleteOutfit(o.date))))
      .then(() => {
        forgetUrl(item.id);
        state.items = state.items.filter(i => i.id !== item.id);
        state.outfits = state.outfits.filter(o => !orphaned.includes(o));
        renderCloset();
        replanWeek();
      });
  }

  function renderCloset() {
    const grid = $('#closet-grid');
    const list = state.items
      .filter(i => state.filter === 'all' || i.category === state.filter)
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

    $('#closet-empty').classList.toggle('hidden', list.length > 0);
    grid.innerHTML = '';

    const todayKey = Outfit.toKey(new Date());
    for (const item of list) {
      const url = urlFor(item);
      const el = document.createElement('article');
      el.className = 'item-card' + (item.inRotation === false ? ' is-benched' : '');
      el.dataset.id = item.id;

      const since = item.lastWorn ? Outfit.daysBetween(item.lastWorn, todayKey) : null;
      const lastText = item.lastWorn
        ? (since <= 0 ? 'worn today' : `${since}d ago`)
        : 'never worn';

      el.innerHTML =
        `<div class="item-thumb" style="background:${item.color}">` +
          (url ? `<img src="${url}" alt="${escapeHtml(item.name)}">` : '') +
        `</div>` +
        `<div class="item-body">` +
          `<strong>${escapeHtml(item.name)}</strong>` +
          `<span class="muted">${item.category} · ${Color.name(item.color)}</span>` +
          `<span class="muted small">${plural(item.wearCount || 0, 'wear')} · ${lastText}</span>` +
        `</div>` +
        `<div class="item-actions">` +
          `<button class="icon-btn" data-action="rotation" title="${item.inRotation === false ? 'Return to rotation' : 'Bench this item'}">${item.inRotation === false ? '☾' : '✓'}</button>` +
          `<button class="icon-btn" data-action="edit" title="Edit">✎</button>` +
          `<button class="icon-btn" data-action="delete" title="Delete">🗑</button>` +
        `</div>`;
      grid.appendChild(el);
    }
  }

  /* ---------------------- history ---------------------- */

  function renderHistory() {
    const worn = state.outfits.filter(o => o.status === 'worn').sort((a, b) => b.date.localeCompare(a.date));
    const list = $('#history-list');
    const stats = $('#wear-stats');

    const inRotation = state.items.filter(i => i.inRotation !== false);
    const unworn = inRotation.filter(i => !i.wearCount);
    const totalWears = state.items.reduce((sum, i) => sum + (i.wearCount || 0), 0);
    const coverage = inRotation.length
      ? Math.round(100 * (inRotation.length - unworn.length) / inRotation.length) : 0;

    stats.innerHTML =
      statTile(worn.length, worn.length === 1 ? 'outfit logged' : 'outfits logged') +
      statTile(coverage + '%', 'of your rotation worn') +
      statTile(unworn.length, unworn.length === 1 ? 'piece still unworn' : 'pieces still unworn') +
      statTile(totalWears, 'total wears');

    if (!worn.length) {
      list.innerHTML = '<p class="empty muted">Nothing logged yet. Mark an outfit as worn and it shows up here.</p>';
      return;
    }

    const fmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    list.innerHTML = '';
    for (const o of worn.slice(0, 60)) {
      const row = document.createElement('div');
      row.className = 'history-row';
      const names = ['shirtId', 'pantsId', 'shoesId']
        .map(f => byId(o[f]))
        .filter(Boolean);

      row.innerHTML =
        `<div class="history-date">${fmt.format(Outfit.fromKey(o.date))}</div>` +
        `<div class="history-swatches">` +
          names.map(i => `<span class="dot" style="background:${i.color}" title="${escapeHtml(i.name)}"></span>`).join('') +
        `</div>` +
        `<div class="history-names">${names.map(i => escapeHtml(i.name)).join(' · ') || '<em class="muted">deleted items</em>'}</div>` +
        `<div class="history-score muted">${o.colorScore ?? '—'}</div>`;
      list.appendChild(row);
    }
  }

  const statTile = (value, label) =>
    `<div class="stat"><strong>${value}</strong><span class="muted">${label}</span></div>`;

  /* ---------------------- settings ---------------------- */

  function hydrateSettingsForm() {
    const wrap = $('#day-toggles');
    wrap.innerHTML = '';
    [1, 2, 3, 4, 5, 6, 0].forEach(day => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (state.settings.workDays.includes(day) ? ' is-active' : '');
      b.textContent = Outfit.DAY_NAMES[day].slice(0, 3);
      b.dataset.day = day;
      wrap.appendChild(b);
    });
    $('#min-gap').value = state.settings.minGapDays;
    $('#pair-gap').value = state.settings.pairGapDays;
    $('#weight-slider').value = Math.round((1 - state.settings.colorWeight) * 100);
  }

  function bindSettingsEvents() {
    $('#day-toggles').addEventListener('click', e => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      const day = Number(chip.dataset.day);
      const days = new Set(state.settings.workDays);
      days.has(day) ? days.delete(day) : days.add(day);
      state.settings.workDays = [...days].sort();
      chip.classList.toggle('is-active');
      DB.saveSettings({ workDays: state.settings.workDays }).then(() => {
        renderWeek(); ensureWeek();
      });
    });

    const numeric = (sel, key) => $(sel).addEventListener('change', e => {
      const v = Math.max(0, Number(e.target.value) || 0);
      state.settings[key] = v;
      e.target.value = v;
      DB.saveSettings({ [key]: v });
    });
    numeric('#min-gap', 'minGapDays');
    numeric('#pair-gap', 'pairGapDays');

    $('#export-btn').addEventListener('click', () => {
      const btn = $('#export-btn');
      btn.disabled = true;
      toast('Packing up your closet…', 8000);

      DB.exportAll().then(payload => {
        const json = JSON.stringify(payload, null, 2);
        const filename = `workweek-backup-${Outfit.toKey(new Date())}.json`;
        const file = new File([json], filename, { type: 'application/json' });
        const size = (json.length / 1048576).toFixed(1);

        // On a phone, sharing beats downloading: the backup can go straight to
        // AirDrop, Messages or a cloud drive instead of landing in Files for the
        // user to dig out again. Everywhere else, download it.
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          return navigator.share({ files: [file], title: filename })
            .then(() => toast(`Sent — ${payload.items.length} items, ${size} MB.`))
            .catch(err => {
              if (err && err.name === 'AbortError') { toast('Export cancelled.'); return; }
              downloadFile(file, filename);
              toast(`Downloaded — ${payload.items.length} items, ${size} MB.`);
            });
        }
        downloadFile(file, filename);
        toast(`Downloaded — ${payload.items.length} items, ${size} MB.`);
      })
      .catch(err => { console.error(err); toast('Export failed. Try again.'); })
      .then(() => { btn.disabled = false; });
    });

    $('#import-btn').addEventListener('click', () => $('#import-input').click());
    $('#import-input').addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      if (!confirm('Importing replaces the closet and history in this browser. Continue?')) {
        e.target.value = ''; return;
      }
      file.text()
        .then(text => DB.importAll(JSON.parse(text)))
        .then(reloadFromDb)
        .then(() => toast('Backup imported.'))
        .catch(err => toast(err.message || 'Could not read that file.'))
        .then(() => { e.target.value = ''; });
    });

    $('#clear-history').addEventListener('click', () => {
      if (!confirm('Clear all wear history and reset every wear count?')) return;
      DB.clearHistory().then(reloadFromDb).then(() => toast('History cleared.'));
    });

    $('#clear-all').addEventListener('click', () => {
      if (!confirm('Delete the entire closet, history and settings? This cannot be undone.')) return;
      DB.clearAll().then(reloadFromDb).then(() => toast('Everything deleted.'));
    });
  }

  function reloadFromDb() {
    objectUrls.forEach(url => URL.revokeObjectURL(url));
    objectUrls.clear();
    return Promise.all([DB.getItems(), DB.getOutfits(), DB.getSettings()])
      .then(([items, outfits, settings]) => {
        state.items = items;
        state.outfits = outfits;
        state.settings = settings;
        hydrateSettingsForm();
        renderAll();
        ensureWeek();
      });
  }

  /* ---------------------- misc ---------------------- */

  function downloadFile(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);   // Safari ignores a click on a detached anchor
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function button(label, cls, onClick) {
    const b = document.createElement('button');
    b.className = 'btn ' + cls;
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  let toastTimer;
  function toast(msg, ms = 2600) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-visible'), ms);
  }
})();
