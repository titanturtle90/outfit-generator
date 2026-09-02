/* =============================================================
   firebase-config.js — paste your own Firebase project's config
   here to turn on cross-device sync. Leave it as-is and the app
   runs exactly as before: local to this browser, no sync, no
   sign-in. See the "Syncing across devices" section of README.md
   for the five-minute setup.

   These values are NOT secrets. Firebase web config is public in
   every web app that uses it; what protects your data is the
   security rules in firestore.rules, which only let a signed-in
   person read and write their own closet.
   ============================================================= */
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAS8lJKU9xfNENPYTDyNuWrtcTxp6_ET5U',
  authDomain: 'workweek-17eaa.firebaseapp.com',
  projectId: 'workweek-17eaa',
  appId: '1:615522068883:web:a4a545d1eb309cf0246066'
};

/* Set to true only when running against the local Firebase emulators. */
const FIREBASE_USE_EMULATOR = false;
