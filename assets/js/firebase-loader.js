// firebase-loader.js
// Loads Firebase modular SDK as ESM and exposes a small compatibility shim on window.firebase
// Edit firebaseConfig in firebase-config.js (or replace here) with your project values.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut as fbSignOut, createUserWithEmailAndPassword, signInWithPopup, signInWithRedirect, GoogleAuthProvider, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js';
import { getDatabase, ref, set, get, push, onValue, update, remove, off, onChildAdded, onChildRemoved, onChildChanged } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-database.js';
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, updateDoc, addDoc, onSnapshot, query, where, orderBy, serverTimestamp, deleteDoc, deleteField, runTransaction, writeBatch, arrayUnion, arrayRemove, Timestamp } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js';
import { getAnalytics } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-analytics.js';

// Import user-provided config if present
let firebaseConfig = {};
try{
  // This file should set `window.__FIREBASE_CONFIG__` if you want to keep credentials separate
  if(window.__FIREBASE_CONFIG__){ firebaseConfig = window.__FIREBASE_CONFIG__; }
}catch(e){ /* ignore */ }

// Expose a small compatibility object that the non-module app code expects
window.firebase = window.firebase || {};
// Initialize if config present
let _app = null;
if(firebaseConfig && firebaseConfig.apiKey){
  try{
    _app = initializeApp(firebaseConfig);
    // attach initialized services
    const _auth = getAuth(_app);
    const _db = getDatabase(_app);
    const _firestore = getFirestore(_app);
    let _analytics = null;
    try{ _analytics = getAnalytics(_app); }catch(e){ /* analytics may not be available in some environments */ }
    window.firebase._app = _app;
    window.firebase._auth = _auth;
    window.firebase._db = _db;
    window.firebase._firestore = _firestore;
    window.firebase._analytics = _analytics;
  }catch(e){ console.warn('Firebase init failed', e); }
}

function ensureApp(){
  if(_app) return _app;
  // try to init from global config
  if(window.__FIREBASE_CONFIG__ && window.__FIREBASE_CONFIG__.apiKey){
    try{ _app = initializeApp(window.__FIREBASE_CONFIG__); window.firebase._app = _app; window.firebase._auth = getAuth(_app); window.firebase._db = getDatabase(_app); window.firebase._firestore = getFirestore(_app); try{ window.firebase._analytics = getAnalytics(_app); }catch(e){} return _app; }catch(e){ console.warn('Lazy firebase init failed', e); }
  }
  throw new Error('No Firebase App available. Call initializeApp(config) first.');
}

window.firebase.initializeApp = (cfg)=> { _app = initializeApp(cfg || firebaseConfig || window.__FIREBASE_CONFIG__); window.firebase._app = _app; window.firebase._auth = getAuth(_app); window.firebase._db = getDatabase(_app); window.firebase._firestore = getFirestore(_app); try{ window.firebase._analytics = getAnalytics(_app); }catch(e){} return _app; };
window.firebase.getAuth = (app)=> { try{ return app ? getAuth(app) : (window.firebase._auth || getAuth(ensureApp())); }catch(e){ return getAuth(ensureApp()); } };
window.firebase.signInWithEmailAndPassword = async (...args)=>{ ensureApp(); return signInWithEmailAndPassword(...args); };
window.firebase.createUserWithEmailAndPassword = async (...args)=>{ ensureApp(); return createUserWithEmailAndPassword(...args); };
window.firebase.signInWithPopup = async (...args)=>{ ensureApp(); return signInWithPopup(...args); };
window.firebase.signInWithRedirect = async (...args)=>{ ensureApp(); return signInWithRedirect(...args); };
window.firebase.GoogleAuthProvider = GoogleAuthProvider;
window.firebase.onAuthStateChanged = (auth, cb)=>{ try{ ensureApp(); return onAuthStateChanged(auth||window.firebase.getAuth(), cb); }catch(e){ console.warn('onAuthStateChanged failed', e); } };
window.firebase.signOut = async (...args)=>{ ensureApp(); return fbSignOut(...args); };
window.firebase.getDatabase = (app)=> { try{ return app ? getDatabase(app) : (window.firebase._db || getDatabase(ensureApp())); }catch(e){ return getDatabase(ensureApp()); } };
window.firebase.getFirestore = (app)=> { try{ return app ? getFirestore(app) : (window.firebase._firestore || getFirestore(ensureApp())); }catch(e){ return getFirestore(ensureApp()); } };
window.firebase.firestore = window.firebase.firestore || {};
Object.assign(window.firebase.firestore, { collection, doc, setDoc, getDoc, getDocs, updateDoc, addDoc, onSnapshot, query, where, orderBy, serverTimestamp, deleteDoc, deleteField, runTransaction, writeBatch, arrayUnion, arrayRemove, Timestamp });
window.firebase.arrayUnion = arrayUnion;
window.firebase.arrayRemove = arrayRemove;
window.firebase.serverTimestamp = serverTimestamp;
window.firebase.writeBatch = writeBatch;
window.firebase.deleteField = deleteField;
window.firebase.ref = ref;
window.firebase.set = set;
window.firebase.get = get;
window.firebase.push = push;
window.firebase.update = update;
window.firebase.remove = remove;
window.firebase.off = off;
window.firebase.onChildAdded = (r, cb)=> onChildAdded(r, cb);
window.firebase.onChildRemoved = (r, cb)=> onChildRemoved(r, cb);
window.firebase.onChildChanged = (r, cb)=> onChildChanged(r, cb);

// Provide compat helper functions used in legacy checks
window.firebase.auth = (app)=> getAuth(app);
window.firebase.database = (app)=> getDatabase(app);

// Convenience helpers: store events under users/{uid}/events to match your DB rules
window.firebase.addEventForCurrentUser = async (eventObj) => {
  const app = ensureApp();
  const auth = window.firebase.getAuth(app);
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');
  const db = window.firebase.getDatabase(app);
  const eventsRef = ref(db, `users/${user.uid}/events`);
  const newRef = push(eventsRef);
  const payload = Object.assign({}, eventObj || {});
  if (!payload.id) {
    payload.id = newRef.key || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'evt_' + Math.random().toString(16).slice(2));
  }
  await set(newRef, payload);
  return { ok: true, id: payload.id };
};

window.firebase.listenForUserEvents = (onChange) => {
  const app = ensureApp();
  const auth = window.firebase.getAuth(app);
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');
  const db = window.firebase.getDatabase(app);
  const userEventsRef = ref(db, `users/${user.uid}/events`);
  // onValue returns an unsubscribe function when used with modular SDK? We'll return the callback wrapper so caller can detach if needed
  const unsubscribe = onValue(userEventsRef, (snap) => onChange(snap.val()));
  return () => unsubscribe();
};

// Note: this loader only exposes the exact functions the app currently uses.
// If you need additional Firebase services (Firestore, Storage, etc.) import them here
// and attach them to `window.firebase` similarly.









