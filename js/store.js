/* =============================================================
   store.js — the app talks to this, never to db.js or cloud.js
   directly. It points at local IndexedDB by default and swaps to
   Firestore once someone signs in, so every call site is unaware
   of which one is live.
   ============================================================= */
const Store = (function () {
  const METHODS = [
    'getItems', 'getItem', 'putItem', 'deleteItem',
    'getOutfits', 'getOutfit', 'putOutfit', 'deleteOutfit',
    'getSettings', 'saveSettings',
    'clearHistory', 'clearAll', 'exportAll', 'importAll'
  ];

  let backend = DB;

  const api = {
    useLocal: () => { backend = DB; },
    useCloud: () => { backend = Cloud; },
    isCloud: () => backend === Cloud,
    backendName: () => (backend === Cloud ? 'cloud' : 'local')
  };

  METHODS.forEach(m => {
    api[m] = function () { return backend[m].apply(backend, arguments); };
  });

  return api;
})();
