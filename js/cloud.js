/* =============================================================
   cloud.js — Firestore-backed store. Exposes the same interface
   as db.js, so app.js does not care which one it is talking to.

   Layout, all under the signed-in user so the security rules stay
   a single line:

     users/{uid}/items/{itemId}     one garment, photo included
     users/{uid}/outfits/{date}     one day, keyed YYYY-MM-DD
     users/{uid}/meta/settings      preferences

   Photos live in Firestore as data URLs rather than in Cloud
   Storage, because Storage now requires a billing account while
   Firestore's free tier does not. A 700px JPEG is ~60-120KB, so a
   large closet is a few MB against a 1 GiB allowance.
   ============================================================= */
const Cloud = (function () {

  const MAX_DOC_BYTES = 900000;   // Firestore's hard limit is 1 MiB per document

  let auth = null, db = null, user = null;
  let loadError = null;   // set when the SDK cannot be fetched at all
  let unsubscribes = [];
  let changeHandler = null;
  let statusHandler = null;

  // Snapshot-backed mirror of the user's data. Reads are served from here, so
  // they resolve instantly and always agree with what the listeners last saw.
  const cache = { items: [], outfits: [], settings: null };

  // Converting a data URL back into a Blob is async and happens on every
  // snapshot, so remember the ones we have already decoded.
  const blobCache = new Map();    // itemId -> { src, blob }

  const SDK_VERSION = '12.18.0';
  const SDK_PARTS = ['app', 'auth', 'firestore'];

  const filled = () =>
    typeof FIREBASE_CONFIG !== 'undefined' && FIREBASE_CONFIG && !!FIREBASE_CONFIG.apiKey;

  /**
   * Example values pasted in place of real ones. Left to run, Firebase happily
   * initialises and sends sign-in to a project that is not yours, and Google
   * answers with a bare "the requested action is invalid" that says nothing
   * about the cause. Catching it here turns that into a useful message.
   */
  function usingPlaceholders() {
    if (!filled()) return false;
    const values = [FIREBASE_CONFIG.apiKey, FIREBASE_CONFIG.authDomain,
                    FIREBASE_CONFIG.projectId, FIREBASE_CONFIG.appId].map(v => String(v || ''));
    return values.some(v => /your-project|\.\.\.|…|123456789:web:abc123|^AIzaSy\W*$/.test(v));
  }

  const configured = () => filled() && !usingPlaceholders();

  const available = () => configured() && typeof firebase !== 'undefined';

  /**
   * Pull in the Firebase SDK only when sync is actually switched on, so an
   * unconfigured install stays a dependency-free static page and costs nothing
   * at load. Tests intercept these URLs to serve the SDK locally.
   */
  function loadSdk() {
    if (typeof firebase !== 'undefined') return Promise.resolve();
    return SDK_PARTS.reduce((chain, part) => chain.then(() => new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = `https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-${part}-compat.js`;
      el.onload = resolve;
      el.onerror = () => reject(new Error(`Could not load the Firebase ${part} SDK.`));
      document.head.appendChild(el);
    })), Promise.resolve());
  }

  /* ---------------------- setup ---------------------- */

  /**
   * Initialise Firebase and resolve once the first auth state is known, so the
   * caller can decide which backend to load from before painting anything.
   */
  function boot() {
    if (!configured()) return Promise.resolve(null);
    return loadSdk().then(start).catch(err => {
      // Offline, or the CDN is unreachable. The app still runs on the local
      // store; the UI says so rather than quietly showing a stale closet.
      console.error(err);
      loadError = err;
      return null;
    });
  }

  const loadFailed = () => !!loadError;

  function start() {
    firebase.initializeApp(FIREBASE_CONFIG);
    auth = firebase.auth();
    db = firebase.firestore();

    if (typeof FIREBASE_USE_EMULATOR !== 'undefined' && FIREBASE_USE_EMULATOR) {
      auth.useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
      db.useEmulator('127.0.0.1', 8080);
    }

    // Offline persistence keeps the app working on a train and makes reads
    // instant. It fails harmlessly when several tabs are open.
    const persistence = db.enablePersistence({ synchronizeTabs: true })
      .catch(() => {});

    return persistence
      .then(() => auth.getRedirectResult().catch(() => null))
      .then(() => new Promise(resolve => {
        const stop = auth.onAuthStateChanged(u => {
          stop();
          resolve(u);
        });
      }))
      .then(u => attach(u).then(() => u));
  }

  /** Keep watching auth after boot, so a sign-out on another tab is noticed. */
  function onAuthChange(fn) {
    if (!auth) return;
    auth.onAuthStateChanged(u => {
      if ((u && u.uid) === (user && user.uid)) return;
      attach(u).then(() => fn(u));
    });
  }

  function attach(u) {
    detach();
    user = u || null;
    if (!user) return Promise.resolve();
    return watch(user.uid);
  }

  function detach() {
    unsubscribes.forEach(fn => { try { fn(); } catch (e) {} });
    unsubscribes = [];
    cache.items = [];
    cache.outfits = [];
    cache.settings = null;
    blobCache.clear();
  }

  const root = () => db.collection('users').doc(user.uid);

  /* ---------------------- live listeners ---------------------- */

  function watch(uid) {
    const base = db.collection('users').doc(uid);

    return new Promise(resolve => {
      const seen = { items: false, outfits: false, settings: false };
      const settle = key => {
        seen[key] = true;
        if (seen.items && seen.outfits && seen.settings) resolve();
      };

      unsubscribes.push(base.collection('items').onSnapshot(snap => {
        Promise.all(snap.docs.map(toItem)).then(items => {
          cache.items = items;
          settle('items');
          notify();
        });
      }, err => { console.error(err); settle('items'); }));

      unsubscribes.push(base.collection('outfits').onSnapshot(snap => {
        cache.outfits = snap.docs.map(d => Object.assign({ date: d.id }, d.data()));
        settle('outfits');
        notify();
      }, err => { console.error(err); settle('outfits'); }));

      unsubscribes.push(base.collection('meta').doc('settings').onSnapshot(doc => {
        cache.settings = doc.exists ? doc.data().value : null;
        settle('settings');
        notify();
      }, err => { console.error(err); settle('settings'); }));

      unsubscribes.push(db.collection('users').doc(uid)
        .onSnapshot({ includeMetadataChanges: true }, doc => {
          report(doc.metadata.hasPendingWrites ? 'saving'
               : doc.metadata.fromCache ? 'offline' : 'synced');
        }, () => {}));
    });
  }

  let notifyTimer = null;
  function notify() {
    if (!changeHandler) return;
    // Snapshots arrive per-collection; coalesce them into one re-render.
    clearTimeout(notifyTimer);
    notifyTimer = setTimeout(() => changeHandler(), 120);
  }

  function report(status) { if (statusHandler) statusHandler(status); }

  const onRemoteChange = fn => { changeHandler = fn; };
  const onStatus = fn => { statusHandler = fn; };

  /* ---------------------- image conversion ---------------------- */

  const blobToDataUrl = blob => new Promise(res => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.readAsDataURL(blob);
  });

  const dataUrlToBlob = url => fetch(url).then(r => r.blob());

  /**
   * Firestore rejects documents over 1 MiB. Photos are already downscaled on
   * capture so this effectively never fires, but an unusually detailed image
   * should degrade in quality rather than fail to save.
   */
  function fitDocument(dataUrl) {
    if (!dataUrl || dataUrl.length <= MAX_DOC_BYTES) return Promise.resolve(dataUrl);
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        let quality = 0.7, out = dataUrl;
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 600 / Math.max(img.width, img.height));
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        while (quality >= 0.3) {
          out = canvas.toDataURL('image/jpeg', quality);
          if (out.length <= MAX_DOC_BYTES) break;
          quality -= 0.15;
        }
        resolve(out);
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  function toItem(doc) {
    const data = doc.data();
    const item = Object.assign({ id: doc.id }, data);
    if (!data.image) { item.image = null; return Promise.resolve(item); }

    const cached = blobCache.get(doc.id);
    if (cached && cached.src === data.image) { item.image = cached.blob; return Promise.resolve(item); }

    return dataUrlToBlob(data.image).then(blob => {
      blobCache.set(doc.id, { src: data.image, blob });
      item.image = blob;
      return item;
    }).catch(() => { item.image = null; return item; });
  }

  /** Strip the Blob out for storage, putting the data URL in its place. */
  function toDoc(item) {
    const out = Object.assign({}, item);
    delete out.id;
    if (!item.image) { out.image = null; return Promise.resolve(out); }
    if (typeof item.image === 'string') return fitDocument(item.image).then(u => { out.image = u; return out; });
    return blobToDataUrl(item.image)
      .then(fitDocument)
      .then(url => { out.image = url; return out; });
  }

  /* ---------------------- reads ---------------------- */

  const getItems = () => Promise.resolve(cache.items.slice());
  const getItem = id => Promise.resolve(cache.items.find(i => i.id === id) || null);
  const getOutfits = () => Promise.resolve(cache.outfits.slice());
  const getOutfit = date => Promise.resolve(cache.outfits.find(o => o.date === date) || null);

  const getSettings = () =>
    Promise.resolve(Object.assign({}, DB.DEFAULT_SETTINGS, cache.settings || {}));

  /* ---------------------- writes ---------------------- */

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  function putItem(item) {
    if (!item.id) {
      item.id = uid();
      item.createdAt = Date.now();
      item.wearCount = item.wearCount || 0;
      item.lastWorn = item.lastWorn || null;
    }
    return toDoc(item)
      .then(doc => root().collection('items').doc(item.id).set(doc))
      .then(() => item);
  }

  const deleteItem = id => {
    blobCache.delete(id);
    return root().collection('items').doc(id).delete();
  };

  function putOutfit(outfit) {
    const doc = Object.assign({}, outfit);
    delete doc.date;
    return root().collection('outfits').doc(outfit.date).set(doc).then(() => outfit);
  }

  const deleteOutfit = date => root().collection('outfits').doc(date).delete();

  function saveSettings(patch) {
    return getSettings().then(current => {
      const value = Object.assign({}, current, patch);
      cache.settings = value;   // reflect immediately; the snapshot confirms
      return root().collection('meta').doc('settings')
        .set({ value }, { merge: true }).then(() => value);
    });
  }

  /* ---------------------- bulk ---------------------- */

  /** Firestore caps a batch at 500 operations. */
  function commitInChunks(operations) {
    const chunks = [];
    for (let i = 0; i < operations.length; i += 400) chunks.push(operations.slice(i, i + 400));
    return chunks.reduce((chain, chunk) => chain.then(() => {
      const batch = db.batch();
      chunk.forEach(op => op(batch));
      return batch.commit();
    }), Promise.resolve());
  }

  function clearHistory() {
    const ops = cache.outfits.map(o => b => b.delete(root().collection('outfits').doc(o.date)));
    cache.items.forEach(i => ops.push(b =>
      b.update(root().collection('items').doc(i.id), { wearCount: 0, lastWorn: null })));
    return commitInChunks(ops);
  }

  function clearAll() {
    const ops = cache.outfits.map(o => b => b.delete(root().collection('outfits').doc(o.date)))
      .concat(cache.items.map(i => b => b.delete(root().collection('items').doc(i.id))));
    ops.push(b => b.delete(root().collection('meta').doc('settings')));
    blobCache.clear();
    return commitInChunks(ops);
  }

  function exportAll() {
    return Promise.all(cache.items.map(i =>
      i.image ? blobToDataUrl(i.image).then(d => Object.assign({}, i, { image: d }))
              : Promise.resolve(Object.assign({}, i, { image: null }))
    )).then(items => getSettings().then(settings => ({
      format: 'workweek-outfits',
      version: 1,
      exportedAt: new Date().toISOString(),
      items,
      outfits: cache.outfits.slice(),
      settings
    })));
  }

  function importAll(payload, { replace = true } = {}) {
    if (!payload || payload.format !== 'workweek-outfits') {
      return Promise.reject(new Error('That file is not a Workweek backup.'));
    }
    return (replace ? clearAll() : Promise.resolve())
      .then(() => Promise.all((payload.items || []).map(i =>
        fitDocument(typeof i.image === 'string' ? i.image : null).then(image => {
          const doc = Object.assign({}, i, { image });
          const id = doc.id || uid();
          delete doc.id;
          return b => b.set(root().collection('items').doc(id), doc);
        })
      )))
      .then(itemOps => {
        const outfitOps = (payload.outfits || []).map(o => {
          const doc = Object.assign({}, o);
          delete doc.date;
          return b => b.set(root().collection('outfits').doc(o.date), doc);
        });
        return commitInChunks(itemOps.concat(outfitOps));
      })
      .then(() => payload.settings ? saveSettings(payload.settings) : null);
  }

  /* ---------------------- first sign-in migration ---------------------- */

  /**
   * Move whatever this browser already has into the cloud. Used the first time
   * someone signs in on a device that has been running locally.
   */
  function uploadLocal() {
    return DB.exportAll().then(payload => importAll(payload, { replace: false }));
  }

  const isEmpty = () => !cache.items.length && !cache.outfits.length;

  /* ---------------------- auth ---------------------- */

  function signIn() {
    const provider = new firebase.auth.GoogleAuthProvider();
    return auth.signInWithPopup(provider).catch(err => {
      // Popups are blocked or unsupported in some mobile browsers and in
      // standalone home-screen apps; a redirect always works.
      const fallback = ['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment',
                        'auth/cancelled-popup-request', 'auth/popup-closed-by-user'];
      if (err && fallback.includes(err.code)) return auth.signInWithRedirect(provider);
      throw err;
    });
  }

  const signOut = () => auth.signOut();
  const currentUser = () => user;

  return {
    configured, usingPlaceholders, available, loadFailed, boot, signIn, signOut, currentUser, onAuthChange,
    onRemoteChange, onStatus, uploadLocal, isEmpty,
    getItems, getItem, putItem, deleteItem,
    getOutfits, getOutfit, putOutfit, deleteOutfit,
    getSettings, saveSettings,
    clearHistory, clearAll, exportAll, importAll
  };
})();
