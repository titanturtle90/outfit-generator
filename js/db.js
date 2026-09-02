/* =============================================================
   db.js — IndexedDB persistence. Everything (including the
   photos) lives in this browser; nothing is uploaded anywhere.
   ============================================================= */
const DB = (function () {
  const NAME = 'workweek-outfits';
  const VERSION = 1;
  let db = null;

  const DEFAULT_SETTINGS = {
    workDays: [1, 2, 3, 4],   // Mon-Thu (JS day numbers)
    minGapDays: 10,           // soft floor before an item repeats
    pairGapDays: 90           // soft floor before a shirt+pants pairing repeats
  };

  function open() {
    if (db) return Promise.resolve(db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = e => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('items')) {
          const s = d.createObjectStore('items', { keyPath: 'id' });
          s.createIndex('category', 'category');
        }
        if (!d.objectStoreNames.contains('outfits')) {
          const s = d.createObjectStore('outfits', { keyPath: 'date' }); // one per YYYY-MM-DD
          s.createIndex('status', 'status');
        }
        if (!d.objectStoreNames.contains('meta')) {
          d.createObjectStore('meta', { keyPath: 'key' });
        }
      };
      req.onsuccess = e => { db = e.target.result; resolve(db); };
      req.onerror = () => reject(req.error);
    });
  }

  function tx(store, mode, fn) {
    return open().then(d => new Promise((resolve, reject) => {
      const t = d.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => resolve(req && req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  /* ---------------------- items ---------------------- */

  const getItems = () => tx('items', 'readonly', s => s.getAll()).then(r => r || []);

  function putItem(item) {
    if (!item.id) {
      item.id = uid();
      item.createdAt = Date.now();
      item.wearCount = item.wearCount || 0;
      item.lastWorn = item.lastWorn || null;
    }
    return tx('items', 'readwrite', s => s.put(item)).then(() => item);
  }

  const getItem = id => tx('items', 'readonly', s => s.get(id));
  const deleteItem = id => tx('items', 'readwrite', s => s.delete(id));

  /* ---------------------- outfits ---------------------- */

  const getOutfits = () => tx('outfits', 'readonly', s => s.getAll()).then(r => r || []);
  const getOutfit = date => tx('outfits', 'readonly', s => s.get(date));
  const putOutfit = o => tx('outfits', 'readwrite', s => s.put(o)).then(() => o);
  const deleteOutfit = date => tx('outfits', 'readwrite', s => s.delete(date));

  /* ---------------------- settings ---------------------- */

  function getSettings() {
    return tx('meta', 'readonly', s => s.get('settings'))
      .then(row => Object.assign({}, DEFAULT_SETTINGS, row ? row.value : {}));
  }

  function saveSettings(patch) {
    return getSettings().then(current => {
      const value = Object.assign({}, current, patch);
      return tx('meta', 'readwrite', s => s.put({ key: 'settings', value })).then(() => value);
    });
  }

  /* ---------------------- bulk ---------------------- */

  function clearStore(store) {
    return tx(store, 'readwrite', s => s.clear());
  }

  /** Clear wear history: drop worn outfits and reset per-item counters. */
  function clearHistory() {
    return getOutfits()
      .then(all => Promise.all(all.map(o => deleteOutfit(o.date))))
      .then(getItems)
      .then(items => Promise.all(items.map(i =>
        putItem(Object.assign(i, { wearCount: 0, lastWorn: null })))));
  }

  const clearAll = () =>
    Promise.all(['items', 'outfits', 'meta'].map(clearStore));

  /* ---------------------- import / export ---------------------- */

  const blobToDataUrl = blob => new Promise(res => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.readAsDataURL(blob);
  });

  const dataUrlToBlob = url => fetch(url).then(r => r.blob());

  function exportAll() {
    return Promise.all([getItems(), getOutfits(), getSettings()])
      .then(([items, outfits, settings]) =>
        Promise.all(items.map(i =>
          i.image ? blobToDataUrl(i.image).then(d => Object.assign({}, i, { image: d }))
                  : Promise.resolve(Object.assign({}, i, { image: null }))
        )).then(withImages => ({
          format: 'workweek-outfits',
          version: 1,
          exportedAt: new Date().toISOString(),
          items: withImages,
          outfits,
          settings
        })));
  }

  function importAll(payload, { replace = true } = {}) {
    if (!payload || payload.format !== 'workweek-outfits') {
      return Promise.reject(new Error('That file is not a Workweek backup.'));
    }
    const start = replace ? clearAll().then(() => { db = null; return open(); }) : Promise.resolve();
    return start
      .then(() => Promise.all((payload.items || []).map(i => {
        const item = Object.assign({}, i);
        return (typeof item.image === 'string' && item.image.startsWith('data:')
          ? dataUrlToBlob(item.image)
          : Promise.resolve(null)
        ).then(blob => { item.image = blob; return tx('items', 'readwrite', s => s.put(item)); });
      })))
      .then(() => Promise.all((payload.outfits || []).map(putOutfit)))
      .then(() => payload.settings ? saveSettings(payload.settings) : null);
  }

  return {
    DEFAULT_SETTINGS,
    getItems, getItem, putItem, deleteItem,
    getOutfits, getOutfit, putOutfit, deleteOutfit,
    getSettings, saveSettings,
    clearHistory, clearAll,
    exportAll, importAll
  };
})();
