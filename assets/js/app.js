// -------- Utilities --------
const $ = (q, el=document) => el.querySelector(q);
const $$ = (q, el=document) => Array.from(el.querySelectorAll(q));
const fmtDate = (d) => d.toISOString().split('T')[0];
const pad = (n) => n.toString().padStart(2, '0');
const toLocal = (dateStr) => new Date(dateStr.replace(' ', 'T'));
const sameDay = (a,b) => a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };
const startOfWeek = (d) => { const x=new Date(d); const day=(x.getDay()+6)%7; x.setDate(x.getDate()-day); x.setHours(0,0,0,0); return x; }; // Monday
const startOfMonth = (d) => { const x=new Date(d); x.setDate(1); x.setHours(0,0,0,0); return x; };

function showToast(msg, duration=3000){ try{
    const container = document.getElementById('toast'); if(!container){ console.info('Toast:', msg); return; }
    const t = document.createElement('div'); t.className='toast'; t.textContent = msg; container.appendChild(t); container.style.display='block';
    setTimeout(()=>{ t.style.opacity=1; }, 50);
    setTimeout(()=>{ t.style.opacity=0; t.addEventListener('transitionend', ()=>{ t.remove(); if(!container.children.length) container.style.display='none'; }); }, duration);
  }catch(e){ try{ console.info(msg); }catch(_){} }
}
// expose for any legacy callers
window.showToast = showToast;

// Ask the UI to show the sign-in splash (global helper)
function requestSignIn(){
  try{
    const splash = document.getElementById('authSplash');
    if(splash) { splash.classList.add('open'); }
    else { showToast('Please sign in to continue', 3000); }
  }catch(e){ showToast('Please sign in to continue', 3000); }
}
window.requestSignIn = requestSignIn;

function isPermissionDeniedError(err){
  if(!err) return false;
  const code = (typeof err === 'string') ? err : (err.code || err.message || err.toString());
  return typeof code === 'string' && code.toLowerCase().includes('permission_denied');
}

// -------- Data Layer --------
const DB = { firebaseConfigured:false, user:null, warnedMissingDb:false, whiteboardPersistDisabled:false,
  initFirebase(){
    try{
      if(window.firebase && typeof window.firebase.initializeApp === 'function'){
        try{
          const app = window.firebase._app || (window.__FIREBASE_CONFIG__ ? window.firebase.initializeApp(window.__FIREBASE_CONFIG__) : null);
          this.auth = window.firebase.getAuth ? window.firebase.getAuth(app) : (window.firebase.auth?window.firebase.auth(app):null);
          this.db = window.firebase.getDatabase ? window.firebase.getDatabase(app) : (window.firebase.database?window.firebase.database(app):null);
          this.firebaseConfigured = !!(this.auth && this.db);
        }catch(e){ console.warn('DB.initFirebase helper failed', e); }
      }
    }catch(e){ console.warn('Firebase init skipped', e); }
  },
  async signIn(email,pwd){
    if(!window.firebase || !window.firebase.signInWithEmailAndPassword){ alert('Using local mode (no Firebase config). Data saved to this browser.'); return; }
    try{
      const auth = window.firebase.getAuth ? window.firebase.getAuth(window.firebase._app) : (window.firebase.auth?window.firebase.auth(window.firebase._app):null);
      const cred = await window.firebase.signInWithEmailAndPassword(auth, email, pwd);
      this.user = cred.user;
      this.firebaseConfigured = true;
      await loadEvents();
    }catch(e){ alert('Sign in error: '+(e.message||e)); }
  },
  async signOut(){
    if(!window.firebase || !window.firebase.signOut) return;
    try{
      const auth = window.firebase.getAuth ? window.firebase.getAuth(window.firebase._app) : (window.firebase.auth?window.firebase.auth(window.firebase._app):null);
      await window.firebase.signOut(auth);
      this.user = null;
      this.firebaseConfigured = false;
      saveLocal(); renderAll(); try{ updateAuthUI(null); }catch(e){}
      showToast('Signed out', 2500);
    }catch(e){ console.warn('Sign out failed', e); showToast('Sign out failed', 3000); }
  },
  async save(events){
    // Try to persist to Realtime Database when available and properly configured.
    const uid = this.user && this.user.uid ? this.user.uid : null;
  const localKey = uid ? `studyflow_events_${uid}` : 'studyflow_events_unsaved';
    if(window.firebase && this.user){
      try{
        const db = window.firebase.getDatabase ? window.firebase.getDatabase(window.firebase._app) : (window.firebase.database?window.firebase.database(window.firebase._app):null);
        // If db is missing or app doesn't have a databaseURL, fallback to local per-user storage
        const hasDbUrl = window.firebase && window.firebase._app && window.firebase._app.options && window.firebase._app.options.databaseURL;
        if(!db || !hasDbUrl){ throw new Error('Realtime Database not configured (missing databaseURL)'); }
        const path = `users/${this.user.uid}/events`;
          await window.firebase.set(window.firebase.ref(db, path), events);
          // one-time info for debugging persistence target
          if(!this._loggedSave){ this._loggedSave = true; try{ console.info('DB.save: persisted events to Realtime Database for uid=' + (this.user && this.user.uid)); }catch(e){} }
        return;
      }catch(e){
        // Avoid spamming the console repeatedly when Realtime Database isn't configured.
        if(!this.warnedMissingDb){ this.warnedMissingDb = true; console.info('Firebase save unavailable, falling back to localStorage', e); }
        else { console.debug('Firebase save fallback (suppressed)', e); }
        localStorage.setItem(localKey, JSON.stringify(events));
      }
    } else {
      // When not signed in, keep an unsaved snapshot but do not write to the global shared key.
      localStorage.setItem('studyflow_events_unsaved', JSON.stringify(events));
    }
  },

  markWhiteboardPersistenceDisabled(reason){
    if(this.whiteboardPersistDisabled) return;
    this.whiteboardPersistDisabled = true;
    try{ console.info('Whiteboard persistence disabled; using local session storage instead.'); }catch(_){ }
    if(reason){ try{ console.debug('Whiteboard persistence error:', reason); }catch(_){ } }
    try{ showToast('Whiteboard sync unavailable; falling back to local mode for this session.', 4000); }catch(_){ }
  },

  async load(){
    const uid = this.user && this.user.uid ? this.user.uid : null;
    const localKey = uid ? ('studyflow_events_' + uid) : 'studyflow_events_unsaved';
    const readLocal = () => {
      try { return JSON.parse(localStorage.getItem(localKey) || '[]'); }
      catch(_) { return []; }
    };
    const ensureId = (evt, fallbackId) => {
      if(!evt || typeof evt !== 'object') return null;
      const copy = Object.assign({}, evt);
      if(copy.id){ return copy; }
      if(fallbackId){ copy.id = fallbackId; return copy; }
      if(typeof crypto !== 'undefined' && crypto.randomUUID){ copy.id = crypto.randomUUID(); return copy; }
      copy.id = 'evt_' + Math.random().toString(16).slice(2);
      return copy;
    };
    if(window.firebase && this.user){
      try{
        const db = window.firebase.getDatabase ? window.firebase.getDatabase(window.firebase._app) : (window.firebase.database?window.firebase.database(window.firebase._app):null);
        const hasDbUrl = window.firebase && window.firebase._app && window.firebase._app.options && window.firebase._app.options.databaseURL;
        if(!db || !hasDbUrl){ throw new Error('Realtime Database not configured (missing databaseURL)'); }
        const snap = await window.firebase.get(window.firebase.ref(db, 'users/' + this.user.uid + '/events'));
        const raw = snap && typeof snap.exists === 'function' ? (snap.exists()?snap.val():null) : (snap && typeof snap.val === 'function' ? snap.val() : null);
        let events = [];
        if(Array.isArray(raw)){
          events = raw.filter(Boolean).map((evt, idx)=> ensureId(evt, uid ? (uid + '_' + idx) : ('idx_' + idx))).filter(Boolean);
        } else if(raw && typeof raw === 'object'){
          events = Object.entries(raw).map(([key, value])=> ensureId(value, key)).filter(Boolean);
        }
        if(!this._loggedLoad){ this._loggedLoad = true; try{ console.info('DB.load: loaded events from Realtime Database for uid=' + (this.user && this.user.uid)); }catch(e){} }
        if((!events || !events.length)){
          const local = readLocal();
          if(local && local.length) return local;
        }
        return events;
      }catch(e){
        if(!this.warnedMissingDb){ this.warnedMissingDb = true; console.info('Firebase load unavailable, falling back to localStorage', e); }
        else { console.debug('Firebase load fallback (suppressed)', e); }
        return readLocal();
      }
    }
    return readLocal();
  },

  async persistBoardOwnership(boardId, extraMeta = {}){
    if(!boardId) return null;
    if(!this.user || !window.firebase || typeof window.firebase.getDatabase !== 'function') return null;
    try{
      const db = window.firebase.getDatabase(window.firebase._app);
      const hasDbUrl = window.firebase && window.firebase._app && window.firebase._app.options && window.firebase._app.options.databaseURL;
      if(!db || !hasDbUrl) return null;
      const uid = this.user.uid;
      const metaRef = window.firebase.ref(db, `whiteboards_meta/${boardId}`);
      let existing = null;
      try{
        const snap = await window.firebase.get(metaRef);
        const exists = snap && typeof snap.exists === 'function' ? snap.exists() : !!snap;
        if(exists){
          existing = typeof snap.val === 'function' ? snap.val() : (snap && typeof snap.val !== 'undefined' ? snap.val : null);
        }
      }catch(_){ }
      if(existing && existing.ownerId && existing.ownerId !== uid){
        return existing;
      }
      const now = Date.now();
      const ownerName = this.user.displayName || this.user.email || 'Owner';
      const updates = {};
      updates[`whiteboards_meta/${boardId}/boardId`] = boardId;
      updates[`whiteboards_meta/${boardId}/ownerId`] = uid;
      updates[`whiteboards_meta/${boardId}/ownerName`] = ownerName;
      updates[`whiteboards_meta/${boardId}/createdAt`] = existing && existing.createdAt ? existing.createdAt : now;
      updates[`whiteboards_meta/${boardId}/updatedAt`] = now;
      updates[`whiteboards_meta/${boardId}/members/${uid}`] = 'owner';
      if(!(existing && existing.lastActive)){
        updates[`whiteboards_meta/${boardId}/lastActive`] = now;
      }
      if(extraMeta && typeof extraMeta === 'object'){
        for(const [key, value] of Object.entries(extraMeta)){
          if(value === undefined) continue;
          updates[`whiteboards_meta/${boardId}/${key}`] = value;
        }
      }
      updates[`user_whiteboards/${uid}/${boardId}/role`] = 'owner';
      updates[`user_whiteboards/${uid}/${boardId}/createdAt`] = existing && existing.createdAt ? existing.createdAt : now;
      updates[`user_whiteboards/${uid}/${boardId}/updatedAt`] = now;
      await window.firebase.update(window.firebase.ref(db, '/'), updates);
      const merged = Object.assign({}, existing || {}, { boardId, ownerId: uid, ownerName, createdAt: existing && existing.createdAt ? existing.createdAt : now, updatedAt: now, lastActive: existing && existing.lastActive ? existing.lastActive : now });
      if(extraMeta && typeof extraMeta === 'object'){
        Object.assign(merged, extraMeta);
      }
      return merged;
    }catch(e){
      if(isPermissionDeniedError(e)){
        this.markWhiteboardPersistenceDisabled(e);
        return existing || null;
      }
      console.warn('DB.persistBoardOwnership failed', e);
      return existing || null;
    }
  },

  async recordBoardMembership(boardId, role = 'member'){
    if(!boardId) return;
    if(!this.user || !window.firebase || typeof window.firebase.getDatabase !== 'function') return;
    try{
      const db = window.firebase.getDatabase(window.firebase._app);
      const hasDbUrl = window.firebase && window.firebase._app && window.firebase._app.options && window.firebase._app.options.databaseURL;
      if(!db || !hasDbUrl) return;
      const uid = this.user.uid;
      const now = Date.now();
      const updates = {};
      updates[`user_whiteboards/${uid}/${boardId}/role`] = role;
      updates[`user_whiteboards/${uid}/${boardId}/updatedAt`] = now;
      if(role === 'owner'){
        updates[`user_whiteboards/${uid}/${boardId}/createdAt`] = now;
      } else {
        updates[`user_whiteboards/${uid}/${boardId}/joinedAt`] = now;
      }
      updates[`whiteboards_meta/${boardId}/members/${uid}`] = role;
      updates[`whiteboards_meta/${boardId}/updatedAt`] = now;
      await window.firebase.update(window.firebase.ref(db, '/'), updates);
    }catch(e){
      if(isPermissionDeniedError(e)){ this.markWhiteboardPersistenceDisabled(e); return; }
      console.warn('DB.recordBoardMembership failed', e);
    }
  },

  async loadOwnedBoards(){
    if(this.whiteboardPersistDisabled) return [];
    if(!this.user || !window.firebase || typeof window.firebase.getDatabase !== 'function') return [];
    try{
      const db = window.firebase.getDatabase(window.firebase._app);
      const hasDbUrl = window.firebase && window.firebase._app && window.firebase._app.options && window.firebase._app.options.databaseURL;
      if(!db || !hasDbUrl) return [];
      const ref = window.firebase.ref(db, `user_whiteboards/${this.user.uid}`);
      const snap = await window.firebase.get(ref);
      const result = [];
      if(snap){
        if(typeof snap.forEach === 'function'){
          snap.forEach((child)=>{
            try{
              if(!child) return;
              const val = typeof child.val === 'function' ? child.val() : (child && typeof child.val !== 'undefined' ? child.val : null);
              const role = val && typeof val === 'object' && 'role' in val ? val.role : val;
              if(role === 'owner' || role === true){ result.push(child.key); }
            }catch(_){ }
          });
        }
        if(!result.length){
          const raw = typeof snap.val === 'function' ? snap.val() : (snap && typeof snap.val !== 'undefined' ? snap.val : null);
          if(raw && typeof raw === 'object'){
            Object.keys(raw).forEach((code)=>{
              try{
                const val = raw[code];
                const role = val && typeof val === 'object' && 'role' in val ? val.role : val;
                if(role === 'owner' || role === true){ result.push(code); }
              }catch(_){ }
            });
          }
        }
      }
      return Array.from(new Set(result));
    }catch(e){
      if(isPermissionDeniedError(e)){ this.markWhiteboardPersistenceDisabled(e); return []; }
      console.warn('DB.loadOwnedBoards failed', e);
      return [];
    }
  },

  async fetchBoardMetadata(boardId){
    if(this.whiteboardPersistDisabled) return null;
    if(!boardId || !window.firebase || typeof window.firebase.getDatabase !== 'function') return null;
    try{
      const db = window.firebase.getDatabase(window.firebase._app);
      const hasDbUrl = window.firebase && window.firebase._app && window.firebase._app.options && window.firebase._app.options.databaseURL;
      if(!db || !hasDbUrl) return null;
      const ref = window.firebase.ref(db, `whiteboards_meta/${boardId}`);
      const snap = await window.firebase.get(ref);
      const exists = snap && typeof snap.exists === 'function' ? snap.exists() : !!snap;
      if(!exists) return null;
      const val = typeof snap.val === 'function' ? snap.val() : (snap && typeof snap.val !== 'undefined' ? snap.val : null);
      if(val && typeof val === 'object' && !val.boardId){ val.boardId = boardId; }
      return val;
    }catch(e){
      if(isPermissionDeniedError(e)){ this.markWhiteboardPersistenceDisabled(e); return null; }
      console.warn('DB.fetchBoardMetadata failed', e);
      return null;
    }
  }
}

// Schema: {id,title,startISO,endISO,color,recurringWeekly:boolean}
let EVENTS = [];
function saveLocal(){ DB.save(EVENTS) }
async function loadEvents(){ EVENTS = await DB.load(); renderAll(); }

// Merge local (unauthenticated) events with remote events on sign-in.
// Local events take precedence (new/additional ids), but we dedupe by id.
async function mergeLocalWithRemote(remoteEvents){
  // Merge two sources of local events:
  //  - unauthenticated generic: 'studyflow_events'
  //  - per-user fallback: 'studyflow_events_<uid>' (if present)
  // Only merge per-user fallback (do not use the global shared key)
  const perUserKey = DB.user && DB.user.uid ? `studyflow_events_${DB.user.uid}` : null;
  const perUserLocal = perUserKey ? JSON.parse(localStorage.getItem(perUserKey)||'[]') : [];
  const local = perUserLocal || [];
  const remoteList = Array.isArray(remoteEvents)
    ? remoteEvents.filter(Boolean)
    : (remoteEvents && typeof remoteEvents === 'object' ? Object.values(remoteEvents).filter(Boolean) : []);
  if(!local || !local.length) return remoteList;
  const map = new Map();
  const addToMap = (evt) => {
    if(!evt) return;
    let id = evt.id;
    if(!id){
      id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : 'evt_' + Math.random().toString(16).slice(2);
      evt = Object.assign({ id }, evt);
    }
    map.set(id, evt);
  };
  remoteList.forEach(addToMap);
  // Add/overwrite with local events (local wins)
  local.forEach(addToMap);
  const merged = Array.from(map.values());
  try{
    await DB.save(merged);
    // Clear per-user fallback (we now saved to remote)
    try{ if(perUserKey) localStorage.removeItem(perUserKey); }catch(_){ }
  }catch(e){ console.warn('Failed to persist merged events', e); }
  return merged;
}

// -------- State --------
let CURRENT_DATE = new Date();
let CURRENT_VIEW = 'weekly'; // 'weekly' or 'monthly'

// -------- Nav --------
function setActivePage(page){
  $$('#nav button').forEach(b=> b.classList.toggle('active', b.dataset.nav===page));
  $$('#homePage, #calendarPage, #askPage, #whiteboardPage').forEach(p=> p.classList.remove('active'));
  if(page==='home') $('#homePage').classList.add('active');
  if(page==='calendar') $('#calendarPage').classList.add('active');
  if(page==='ask') $('#askPage').classList.add('active');
  if(page==='whiteboard'){
    $('#whiteboardPage').classList.add('active');
    try{ if(window.Whiteboard && typeof window.Whiteboard.onActivated === 'function'){ window.Whiteboard.onActivated(); } }catch(e){}
  }
  const toggle = $('#viewToggle');
  if(toggle){
    toggle.style.display = (page==='home' || page==='calendar') ? 'flex' : 'none';
  }
  updateViewVisibility();
}

// -------- View Toggle --------
function setView(view){ CURRENT_VIEW=view; $$('#viewToggle button').forEach(b=> b.classList.toggle('active', b.dataset.view===view)); renderAll(); updateViewVisibility(); }
function updateViewVisibility(){
  // Home: read-only views
  $('#weeklyViewHome').style.display = CURRENT_VIEW==='weekly' ? 'block' : 'none';
  $('#monthlyViewHome').style.display = CURRENT_VIEW==='monthly' ? 'grid' : 'none';
  // Calendar: both exist; prefer CURRENT_VIEW
  $('#weeklyViewCal').style.display = CURRENT_VIEW==='weekly' ? 'block' : 'none';
  $('#monthlyView').style.display = CURRENT_VIEW==='monthly' ? 'grid' : 'none';
}

// -------- Weekly Render (supports editable flag) --------
function renderWeekly(containerId, editable=false){
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  const weekStart = startOfWeek(CURRENT_DATE);
  const days = Array.from({length:7}, (_,i)=> addDays(weekStart, i));
  const hours = Array.from({length:14}, (_,i)=> i+7); // 07:00–20:00

  const grid = document.createElement('div'); grid.className='week-grid';

  // Header
  const corner = document.createElement('div'); corner.className='col-head'; grid.appendChild(corner);
  const today = new Date();
  days.forEach(d=>{ const h=document.createElement('div'); h.className='col-head' + (sameDay(d,today)?' current':''); h.textContent=d.toLocaleDateString(undefined,{ weekday:'short', month:'short', day:'numeric'}); grid.appendChild(h); });

  // Time column
  const timeCol = document.createElement('div'); timeCol.className='time-col';
  hours.forEach(h=>{ const c=document.createElement('div'); c.className='slot'; c.textContent=`${pad(h)}:00`; c.style.display='grid'; c.style.placeItems='center'; c.style.fontWeight='700'; c.style.color='var(--muted)'; timeCol.appendChild(c); });
  grid.appendChild(timeCol);

  // Day columns
  days.forEach(day=>{
    const col = document.createElement('div'); col.className='day-col';
    hours.forEach(h=>{ const cell=document.createElement('div'); cell.className='slot' + (editable?' addable':'');
      if(editable){ cell.addEventListener('click', ()=> { const d=new Date(day); d.setHours(h,0,0,0); openModalFor(d); }); }
      col.appendChild(cell); });

    // Events
    const dayEvents = EVENTS.filter(e=>{ const s=toLocal(e.startISO); return sameDay(s, day) || (e.recurringWeekly && s.getDay()===day.getDay()); });
    dayEvents.forEach(evt=>{
      const s=toLocal(evt.startISO), e=toLocal(evt.endISO);
      const startIndex = Math.max(0, s.getHours()-7); const blocks = Math.max(1, Math.ceil((e-s)/(60*60*1000)));
      const target = col.children[startIndex]; if(!target) return;
      const chip = document.createElement('div'); chip.className='event-chip'; chip.style.background = evt.color || 'var(--chip-bg)';
      chip.innerHTML = `<div><div>${evt.title}</div><div class="meta">${pad(s.getHours())}:${pad(s.getMinutes())}–${pad(e.getHours())}:${pad(e.getMinutes())}</div></div>`;
      if(editable){
        const del=document.createElement('button'); del.className='icon-btn delete-btn';
        const trashSvg = (window.lucide && lucide.icons && lucide.icons.trash && typeof lucide.icons.trash.toSvg === 'function')
          ? lucide.icons.trash.toSvg({width:18, height:18})
          : '🗑';
        del.innerHTML = trashSvg; del.onclick=(ev)=>{ ev.stopPropagation(); deleteEvent(evt.id); };
        // Append as first child so it's visually on top of the chip
        chip.appendChild(del);
      }
      chip.style.height = (blocks*56 - 4) + 'px';
      target.style.position='relative'; target.classList.add('occupied');
      // Prevent clicks on the chip from bubbling to the slot (which would try to open add modal)
      chip.addEventListener('click', (ev)=> ev.stopPropagation());
      target.appendChild(chip);
    });

    grid.appendChild(col);
  });

  container.appendChild(grid);
}

// -------- Monthly Render (editable only in Calendar page) --------
function renderMonthly(containerId, editable=false){
  const grid = document.getElementById(containerId); grid.innerHTML='';
  const monthStart = startOfMonth(CURRENT_DATE);
  const firstDayIdx = (monthStart.getDay()+6)%7; // Monday
  const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth()+1, 0).getDate();
  if(containerId==='monthlyView'){ $('#monthLabel').textContent = monthStart.toLocaleDateString(undefined,{ month:'long', year:'numeric'}); }

  const headers = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  headers.forEach(h=>{ const head=document.createElement('div'); head.className='col-head'; head.textContent=h; grid.appendChild(head); })

  for(let i=0;i<firstDayIdx;i++){ grid.appendChild(document.createElement('div')); }

  for(let day=1; day<=daysInMonth; day++){
    const cell=document.createElement('div'); cell.className='day';
    const date=new Date(monthStart.getFullYear(), monthStart.getMonth(), day);
    const header=document.createElement('header');
    const plusHtml = (window.lucide && lucide.icons && lucide.icons.plus && typeof lucide.icons.plus.toSvg === 'function')
      ? lucide.icons.plus.toSvg({width:16, height:16})
      : '+';
    const addBtnHtml = editable ? `<button class="icon-btn" title="Add" aria-label="Add">${plusHtml}</button>` : '';
    header.innerHTML = `<span>${day}</span>${addBtnHtml}`;
    if(editable){ header.querySelector('button').onclick=()=> openModalFor(date); }
    cell.appendChild(header);

    const dayEvents = EVENTS.filter(e=>{ const s=toLocal(e.startISO); return sameDay(s,date) || (e.recurringWeekly && s.getDay()===date.getDay()); });
    dayEvents.forEach(evt=>{
      const pill=document.createElement('div'); pill.className='pill'; pill.style.background = evt.color || 'var(--chip-bg)';
      const s=toLocal(evt.startISO); pill.innerHTML = `${evt.title} <span class="meta">${pad(s.getHours())}:${pad(s.getMinutes())}</span>`;
      if(editable){
        const bin=document.createElement('button'); bin.className='icon-btn delete-btn';
        const trashSvg2 = (window.lucide && lucide.icons && lucide.icons.trash && typeof lucide.icons.trash.toSvg === 'function')
          ? lucide.icons.trash.toSvg({width:16, height:16})
          : '🗑';
        bin.innerHTML = trashSvg2; bin.onclick=()=> deleteEvent(evt.id);
        pill.appendChild(bin);
      }
      cell.appendChild(pill);
    });

    grid.appendChild(cell);
  }
}

// -------- CRUD --------
function openModalFor(date){
  // Require user to be signed in before allowing creation of events
  if(!DB.user){ requestSignIn(); return; }
  $('#evtTitle').value=''; $('#evtColor').value='#6ee7b7';
  // Populate new separate date/time inputs for better mobile pickers
  const dateStr = fmtDate(date);
  const startTime = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const end = new Date(date); end.setHours((date.getHours()+1)%24, date.getMinutes());
  const endTime = `${pad(end.getHours())}:${pad(end.getMinutes())}`;
  $('#evtStartDate').value = dateStr; $('#evtStartTime').value = startTime;
  $('#evtEndDate').value = dateStr; $('#evtEndTime').value = endTime;
  $('#evtRecurring').value='no';
  $('#modalBackdrop').classList.add('open');
}
function closeModal(){ $('#modalBackdrop').classList.remove('open') }
function saveEventFromModal(){
  if(!DB.user){ requestSignIn(); return; }
  const title=$('#evtTitle').value.trim(); const color=$('#evtColor').value||'#6ee7b7';
  // Build ISO-like strings from separate date & time inputs (mobile friendly)
  const startDate = $('#evtStartDate') ? $('#evtStartDate').value : null;
  const startTime = $('#evtStartTime') ? $('#evtStartTime').value : null;
  const endDate = $('#evtEndDate') ? $('#evtEndDate').value : null;
  const endTime = $('#evtEndTime') ? $('#evtEndTime').value : null;
  const recurringWeekly=$('#evtRecurring').value==='yes';

  // Fallback to old combined fields if present (for legacy compatibility)
  let startISO = '';
  let endISO = '';
  if(startDate && startTime){ startISO = `${startDate} ${startTime}`; }
  else if($('#evtStart')){ startISO = $('#evtStart').value.trim(); }
  if(endDate && endTime){ endISO = `${endDate} ${endTime}`; }
  else if($('#evtEnd')){ endISO = $('#evtEnd').value.trim(); }

  if(!title||!startISO||!endISO){ alert('Please fill all fields (date & time)'); return; }
  EVENTS.push({ id:crypto.randomUUID(), title, color, startISO, endISO, recurringWeekly });
  scheduleChanged(); closeModal(); renderAll();
}
function deleteEvent(id){
  if(!DB.user){ requestSignIn(); return; }
  if(!confirm('Delete this lesson?')) return;
  EVENTS = EVENTS.filter(e=> e.id!==id);
  scheduleChanged(); renderAll();
}

// Debounced autosave for schedules
let saveTimer = null;
function scheduleChanged(){
  // immediate UI update already handled by callers; debounce writes to DB
  if(saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(()=>{ DB.save(EVENTS).catch(e=>{ console.warn('Autosave failed', e); }); saveTimer = null; }, 500);
  // always keep a local copy as well (fast recovery)
  try{ localStorage.setItem('studyflow_events_unsaved', JSON.stringify(EVENTS)); }catch(e){}
}

// Flush on unload to minimize lost changes
window.addEventListener('beforeunload', ()=>{ if(saveTimer) { clearTimeout(saveTimer); try{ DB.save(EVENTS).catch(e=>{}); }catch(e){} } });

// -------- Ask AI (local rules; API key handled server-side/db) --------
async function askAI(){
  const q=$('#aiInput').value.trim(); if(!q) return; const box=$('#aiResponse'); box.style.display='block';
  // Try backend LLM endpoint first
  try{
    const now = new Date();
    const localStamp = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const payload = {
      text: q,
      nowISO: now.toISOString(),
      nowLocal: localStamp,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      offsetMinutes: now.getTimezoneOffset()
    };
    const resp = await fetch('/api/ai', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
  if(resp.ok){ const data = await resp.json(); if(data && data.action){
        if(data.action==='add' && Array.isArray(data.events) && data.events.length){
          // If the model produced an add action but some event fields are missing, prompt the user to complete them
          const ev = data.events[0];
          const missing = [];
          if(!ev.title) missing.push('title');
          if(!ev.startISO) missing.push('start time');
          if(!ev.endISO) missing.push('end time');
          if(missing.length){
            // Ask user to fill missing fields via the existing modal (pre-fill whatever we have)
            if(!DB.user){ requestSignIn(); box.textContent = 'Please sign in to add events.'; return; }
            openModalForPartialEvent(ev, data.reply || 'I need a bit more info to finish adding this event. Please confirm or edit the details.');
            return;
          }
          // All required fields present — add the events
          if(!DB.user){ requestSignIn(); box.textContent = 'Please sign in to add events.'; return; }
          const newEvents = data.events.map(ev2 => ({
            id: crypto.randomUUID(),
            title: ev2.title || 'Event',
            color: ev2.color || '#fef08a',
            startISO: ev2.startISO,
            endISO: ev2.endISO,
            recurringWeekly: !!(ev2.recurring || ev2.recurringWeekly)
          }));
          newEvents.forEach(evt => EVENTS.push(evt));
          scheduleChanged(); renderAll(); box.textContent = data.reply || `Added ${newEvents.length} event(s).`;
          try{
            if(window.firebase && typeof window.firebase.addEventForCurrentUser === 'function'){
              newEvents.forEach(async (evt)=>{
                try{
                  await window.firebase.addEventForCurrentUser(evt);
                }catch(err){ console.warn('Failed to persist AI-created event to Firebase', err); }
              });
            }
          }catch(e){ console.warn('Firebase auto-persist check failed', e); }
          return;
        }
        if(data.action==='find_hangout' && data.reply){ box.textContent = data.reply; return; }
        if(data.action==='none' && data.reply){ box.textContent = data.reply; return; }
        if(data.action==='error' && data.reply){ box.textContent = 'AI error: '+data.reply; return; }
      }
      // If backend returned unexpected shape, fall back
    } else {
      // Non-OK response from AI backend — show friendly message and fall back to local parser
      let bodyText = '';
      try{ bodyText = await resp.text(); }catch(e){}
      const errMsg = `AI backend returned ${resp.status}${bodyText?': '+bodyText:''} — falling back to local parser.`;
      console.info(errMsg);
      box.textContent = errMsg;
      // Allow execution to continue to the local parser fallback below
    }
  }catch(e){ console.warn('AI backend failed', e); }

  // Fallback to local parser if backend unavailable or returned invalid data
  const parsed=parseAICommand(q); let reply='';
  if(parsed.type==='add'){
    if(parsed.missing && parsed.missing.length){
      // Ask the user via modal to provide the missing pieces (pre-fill what we have)
      if(!DB.user){ requestSignIn(); reply='Please sign in to add events.'; }
      else { openModalForPartialEvent(parsed, 'I need some more details to add this lesson — please confirm or edit and save.'); reply='Please confirm the event details in the dialog.'; }
    } else {
      if(!DB.user){ requestSignIn(); reply='Please sign in to add events.'; }
  else { EVENTS.push({ id:crypto.randomUUID(), title:parsed.title, color:parsed.color||'#fef08a', startISO:parsed.startISO, endISO:parsed.endISO, recurringWeekly: !!parsed.recurring }); scheduleChanged(); renderAll(); reply=`Added: ${parsed.title} on ${parsed.startISO} → ${parsed.endISO}${parsed.recurring?' (recurring weekly)':''}.`; }
    }
  } else if(parsed.type==='hangout'){
    const result=findHangout(parsed);
    if(result.ok){ reply=`You can hang out on ${result.when.start} for ${parsed.durationHours||2}h.`; }
    else if(parsed.override){ const moved=forceHangout(parsed); if(moved && moved.when) reply=`Override accepted. Booked hangout on ${moved.when.start}. Rescheduled ${moved.movedCount} block(s).`; else reply=`Unable to reschedule all conflicts: ${moved && moved.reason?moved.reason:'unknown'}`; }
    else { reply=`Not ideal: ${result.reason}. Add "override" to force and auto-reschedule.`; }
  } else { reply='I can add lessons ("add lesson math on 2025-09-20 15:00-16:00 color #6ee7b7 recurring") or find hangout times ("can I hang out next Friday evening?").'; }
  box.textContent=reply;
}

// Open modal pre-filled with a partial event (used when AI asks follow-up)
function openModalForPartialEvent(ev, message){
  try{
    if(!DB.user){ requestSignIn(); return; }
    // Ev may be either AI event object with title/startISO/endISO or our parsed result
    const title = ev.title || ev.title || '';
    const startISO = ev.startISO || ev.startISO || ev.start || '';
    const endISO = ev.endISO || ev.endISO || ev.end || '';
    // Try to split into date/time fields
    let startDate=''; let startTime=''; let endDate=''; let endTime='';
    if(startISO && startISO.includes(' ')){ const [d,t]=startISO.split(' '); startDate=d; startTime=t; }
    if(endISO && endISO.includes(' ')){ const [d,t]=endISO.split(' '); endDate=d; endTime=t; }
    // Prefill modal inputs
    $('#evtTitle').value = title || '';
    if(startDate) $('#evtStartDate').value = startDate; if(startTime) $('#evtStartTime').value = startTime;
    if(endDate) $('#evtEndDate').value = endDate; if(endTime) $('#evtEndTime').value = endTime;
    $('#evtColor').value = ev.color || '#6ee7b7';
    $('#evtRecurring').value = (ev.recurring || ev.recurringWeekly) ? 'yes' : 'no';
    // Show a toast or message in aiResponse to explain
    showToast(message || 'Please confirm event details', 4000);
    $('#modalBackdrop').classList.add('open');
  }catch(e){ console.warn('openModalForPartialEvent failed', e); }
}

function parseAICommand(text){
  const t=text.toLowerCase();
  if(/add\s+(lesson|study|event)/.test(t)){
    const date=(text.match(/\d{4}-\d{2}-\d{2}/)||[])[0];
    const times=text.match(/(\d{1,2}:\d{2})\s*[-to]+\s*(\d{1,2}:\d{2})/i);
    const color=(text.match(/#([0-9a-f]{3,6})/i)||[])[0];
    const recurring=/recurring|repeat weekly/.test(t);
    const titleMatch=text.match(/add\s+(?:lesson|study|event)\s+([^\d\n]+?)\s+on/i);
    const title=titleMatch?titleMatch[1].trim().replace(/\s+$/,''):'Lesson';
    const missing=[];
    if(!date) missing.push('date');
    if(!times) missing.push('time range');
    const startISO = date ? `${date} ${times?times[1]:'15:00'}` : '';
    const endISO = date ? `${date} ${times?times[2]:'16:00'}` : '';
    if(!title) missing.push('title');
    return { type:'add', title, startISO, endISO, color, recurring, missing };
  }
  if(/hang\s*out/.test(t)){
    const dur=parseInt((text.match(/(\d+)\s*h/)||[])[1]||'2',10); const override=/override|force/.test(t);
    let targetDate=null; const date=(text.match(/\d{4}-\d{2}-\d{2}/)||[])[0];
    if(date){ targetDate=new Date(date+'T12:00:00'); } else {
      const days=['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
      for(let i=0;i<7;i++) if(t.includes(days[i])){ targetDate=nextDayOfWeek(new Date(), i); break; }
    }
    // If user asked about weekends specifically, mark a hint so higher-level logic can check weekend impact
    const askedWeekend = /weekend|saturday|sunday/.test(t);
    return{ type:'hangout', durationHours:dur, override, targetDate, askedWeekend };
  }
  return { type:'unknown' };
}

function nextDayOfWeek(d, dow){ const day=(d.getDay()+6)%7; const diff=(dow-day+7)%7 || 7; return addDays(d, diff); }
function busyIntervalsOn(date){ return EVENTS.filter(e=>{ const s=toLocal(e.startISO); return sameDay(s,date) || (e.recurringWeekly && s.getDay()===date.getDay()); }).map(e=>({ start:toLocal(e.startISO), end:toLocal(e.endISO), id:e.id })).sort((a,b)=> a.start-b.start); }
function findHangout({ durationHours=2, targetDate=null }){ const startDate=targetDate||new Date(); for(let offset=0; offset<21; offset++){ const day=addDays(startDate, offset); const intervals=busyIntervalsOn(day); let pointer=new Date(day); pointer.setHours(17,0,0,0); const endLimit=new Date(day); endLimit.setHours(22,0,0,0); for(const b of intervals){ if(pointer<b.end && pointer>=b.start){ pointer=new Date(b.end); } } const candidateEnd=new Date(pointer.getTime()+durationHours*60*60*1000); if(candidateEnd<=endLimit) return { ok:true, when:{ start:`${fmtDate(pointer)} ${pad(pointer.getHours())}:${pad(pointer.getMinutes())}` } }; } return { ok:false, reason:'No free evening slot found in the next 3 weeks.' }; }
function forceHangout({ durationHours=2, targetDate=null }){
  if(!DB.user){ requestSignIn(); return { ok:false, reason:'sign-in-required' }; }
  const day = targetDate || new Date();
  const start = new Date(day); start.setHours(19,0,0,0);
  const end = new Date(start.getTime() + durationHours*60*60*1000);
  let movedCount = 0;
  // Find conflicts overlapping the desired hangout slot
  const conflicts = EVENTS.filter(e => sameDay(toLocal(e.startISO), start) && !(toLocal(e.endISO) <= start || toLocal(e.startISO) >= end));
  // For each conflict, try to find a free slot later in the same week (Mon-Fri) that can fit the lesson duration
  const moved = [];
  for(const e of conflicts){
    const s = toLocal(e.startISO), ee = toLocal(e.endISO);
    const durationMs = ee - s;
    // Search for a free slot in the following days (up to 7 days) at the same time window (07:00-20:00)
    let placed = false;
    for(let d=1; d<=7 && !placed; d++){
      const candDay = addDays(s, d);
      // only place into weekdays by default, allow weekends if original was weekend
      const dayIdx = (candDay.getDay()+6)%7; // 0=Mon
      const intervals = busyIntervalsOn(candDay);
      // scan hours 7..20 for free contiguous block sized to durationMs
      for(let h=7; h<=20; h++){
        const candStart = new Date(candDay); candStart.setHours(h, s.getMinutes(), 0, 0);
        const candEnd = new Date(candStart.getTime()+durationMs);
        if(candEnd.getHours()>20) continue;
        // ensure no overlap with existing intervals
        const overlap = intervals.some(iv => !(iv.end <= candStart || iv.start >= candEnd));
        if(!overlap){
          // move event to this slot
          e.startISO = `${fmtDate(candStart)} ${pad(candStart.getHours())}:${pad(candStart.getMinutes())}`;
          e.endISO = `${fmtDate(candEnd)} ${pad(candEnd.getHours())}:${pad(candEnd.getMinutes())}`;
          moved.push(e);
          movedCount++;
          placed = true;
          break;
        }
      }
    }
    if(!placed){
      // Could not place this conflict safely — abort and revert any moves
      // Revert moved ones (they still reference original objects so we need to restore original times from moved array backup)
      // Note: to keep simple, we will reject the whole operation and report which couldn't be moved
      return { ok:false, reason: `Could not find free slot to move '${e.title || 'lesson'}' without conflict` };
    }
  }
  // If all conflicts were moved successfully, insert the hangout
  const newHangout = { id: crypto.randomUUID(), title: 'Hangout', color: '#c7d2fe', startISO: `${fmtDate(start)} ${pad(start.getHours())}:${pad(start.getMinutes())}`, endISO: `${fmtDate(end)} ${pad(end.getHours())}:${pad(end.getMinutes())}`, recurringWeekly: false };
  EVENTS.push(newHangout);
  scheduleChanged(); renderAll();
  // Best-effort persist hangout to Realtime Database if helper exists
  try{
    if(window.firebase && typeof window.firebase.addEventForCurrentUser === 'function'){
      (async ()=>{
        try{ await window.firebase.addEventForCurrentUser({ title: newHangout.title, color: newHangout.color, startISO: newHangout.startISO, endISO: newHangout.endISO, recurringWeekly: false }); }
        catch(err){ console.warn('Failed to persist hangout to Firebase', err); }
      })();
    }
  }catch(e){ console.warn('Persist hangout check failed', e); }
  return { when: { start: `${fmtDate(start)} ${pad(start.getHours())}:${pad(start.getMinutes())}` }, movedCount };
}

// -------- Render All --------
function renderAll(){
  // Weekly
  renderWeekly('weeklyViewHome', false);
  renderWeekly('weeklyViewCal', true);
  // Monthly
  renderMonthly('monthlyViewHome', false);
  renderMonthly('monthlyView', true);
}

// -------- Theme --------
function setTheme(v){ document.documentElement.setAttribute('data-theme', v); localStorage.setItem('studyflow_theme', v); }

// -------- Boot --------
function boot(){
  lucide.createIcons(); DB.initFirebase(); loadEvents();
  try{ if(window.Whiteboard && typeof window.Whiteboard.handleAuth === 'function'){ window.Whiteboard.handleAuth(DB.user); } }catch(e){}

  // --- Auth splash handlers ---
  const authSplash = $('#authSplash');
  const googleSignIn = $('#googleSignIn');

  function hideSplash(){ if(authSplash) authSplash.classList.remove('open'); }
  function showSplash(){ if(authSplash) authSplash.classList.add('open'); }

  // If firebase provides onAuthStateChanged, use it to toggle splash
  if(window.firebase && typeof window.firebase.onAuthStateChanged === 'function'){
    try{
      const auth = window.firebase.getAuth(window.firebase._app);
      window.firebase.onAuthStateChanged(auth, async (u)=>{
        if(u){
          DB.user = u;
          DB.firebaseConfigured = true;
          hideSplash();
          loadEvents();
          try{ updateAuthUI(DB.user); }catch(e){}
          try{ if(window.Whiteboard && typeof window.Whiteboard.handleAuth === 'function'){ window.Whiteboard.handleAuth(u); } }catch(e){}
          try{ await syncOwnedBoardsFromDb(true); }catch(err){ console.warn('Failed to sync owned whiteboards', err); }
        } else {
          DB.user = null;
          showSplash();
          try{ updateAuthUI(null); }catch(e){}
          try{ if(window.Whiteboard && typeof window.Whiteboard.handleAuth === 'function'){ window.Whiteboard.handleAuth(null); } }catch(e){}
          clearOwnedBoardState();
          _wbList = [];
          saveWbList();
          renderWhiteboardList();
          try{ if(window.Whiteboard && typeof window.Whiteboard.leave === 'function'){ window.Whiteboard.leave(); } }catch(_){ }
          setWhiteboardUIFor(null);
        }
      });
    }catch(e){ console.warn('Auth state listener failed', e); }
  }

  // (email/password sign-in removed) - only Google and guest are available

  // Google sign in (prevent duplicate popups)
  let googleFlowInProgress = false;
  // Heuristic: test whether a popup can be opened and whether we can access its properties.
  async function testPopupAvailable(){
    // Try to open a tiny, same-origin popup and see if we can read `closed` and `location`.
    return new Promise((resolve)=>{
      let win = null; try{ win = window.open('about:blank', '_blank', 'width=100,height=100'); }catch(e){ return resolve(false); }
      if(!win){ return resolve(false); }
      // Give the popup a moment to be navigable
      setTimeout(()=>{
        try{
          // Accessing win.closed can throw under COOP/COEP in some browsers
          const closed = !!win.closed;
          try{ win.close(); }catch(e){}
          resolve(typeof closed === 'boolean');
        }catch(e){ try{ win.close(); }catch(_){}; resolve(false); }
      }, 50);
    });
  }
  googleSignIn && googleSignIn.addEventListener('click', async ()=>{
    if(googleFlowInProgress) return; // already opening
    googleFlowInProgress = true; googleSignIn.disabled = true; googleSignIn.classList.add('disabled');
    try{
      const provider = new window.firebase.GoogleAuthProvider();
      const auth = window.firebase.getAuth(window.firebase._app);
      // Only use popup when it appears usable — otherwise fall back to redirect to avoid Firebase's internal polling warnings.
      const popupOk = await testPopupAvailable();
      let result = null;
      if(popupOk){ result = await window.firebase.signInWithPopup(auth, provider); }
      else {
        showToast('Popup unavailable — using redirect sign-in...', 2000);
        await window.firebase.signInWithRedirect(auth, provider);
        return;
      }
      DB.user = result.user; DB.firebaseConfigured = true; hideSplash();
      // Load server events and merge local changes
      try{
        const serverEvents = await DB.load();
        const merged = await mergeLocalWithRemote(serverEvents);
        EVENTS = merged || [];
        renderAll();
      }catch(e){ console.warn('Merge after sign-in failed', e); await loadEvents(); }
      try{ updateAuthUI(DB.user); }catch(e){}
      showToast(`Signed in as ${DB.user.displayName || DB.user.email}`, 3500);
    }catch(err){
      const code = err && err.code ? err.code : null;
      // If popup cannot be used due to COOP/COEP or browser policies, fall back to redirect.
      if(code === 'auth/cancelled-popup-request' || code === 'auth/popup-closed-by-user' || code === 'auth/popup-blocked' || (err && /Cross-Origin-Opener-Policy/.test(err.message))){
        try{
          showToast('Popup blocked — falling back to redirect sign-in...', 2500);
          const provider = new window.firebase.GoogleAuthProvider();
          const auth = window.firebase.getAuth(window.firebase._app);
          await window.firebase.signInWithRedirect(auth, provider);
          return; // redirect will navigate away
        }catch(rErr){ console.warn('Redirect fallback failed', rErr); showToast('Sign-in failed: '+(rErr.message||rErr), 5000); }
      } else {
        console.warn('Google sign-in error', err);
        showToast('Google sign-in error: '+(err.message||err), 5000);
      }
    }finally{ googleFlowInProgress = false; googleSignIn.disabled = false; googleSignIn.classList.remove('disabled'); }
  });

  // Sidebar toggle (desktop + mobile)
  $('#toggleSidebar').onclick = ()=>{
    if(window.innerWidth < 960){ $('#sidebar').classList.toggle('open'); }
    else { document.body.classList.toggle('sidebar-collapsed'); }
  };
  // Close drawer tap-out on mobile
  document.addEventListener('click', (e)=>{ if(window.innerWidth<960){ if(!$('#sidebar').contains(e.target) && !$('#toggleSidebar').contains(e.target)){ $('#sidebar').classList.remove('open'); } } });

  // Navigation
  $$('#nav button').forEach(b=> b.onclick = ()=> setActivePage(b.dataset.nav));

  // View toggle
  $$('#viewToggle button').forEach(b=> b.onclick = ()=> setView(b.dataset.view));

  // Profile menu + theme
  $('#profileBtn').onclick = ()=> $('#profileMenu').classList.toggle('open');
  $('#themeSelect').onchange = (e)=> setTheme(e.target.value);
  setTheme(localStorage.getItem('studyflow_theme')||'mint');

  // Pagination
  $('#prevWeek').onclick = ()=> { CURRENT_DATE = addDays(CURRENT_DATE, -7); renderAll(); };
  $('#nextWeek').onclick = ()=> { CURRENT_DATE = addDays(CURRENT_DATE, 7); renderAll(); };
  $('#todayBtn').onclick   = ()=> { CURRENT_DATE = new Date(); renderAll(); };
  $('#prevMonth').onclick = ()=> { CURRENT_DATE.setMonth(CURRENT_DATE.getMonth()-1); renderAll(); };
  $('#nextMonth').onclick = ()=> { CURRENT_DATE.setMonth(CURRENT_DATE.getMonth()+1); renderAll(); };

  // Modal
  $('#cancelEvt').onclick = closeModal; $('#saveEvt').onclick = saveEventFromModal;

  // Ask AI
  $('#askBtn').onclick = askAI;

  // Topbar email/password removed: only Google sign-in present in the splash

  // Initial visibility
  updateViewVisibility();

  // --- Whiteboard UI wiring ---
  // Registry: track active boards announced by owners (via BroadcastChannel)
  const REGISTRY_CH = 'whiteboard:registry';
  const registry = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(REGISTRY_CH) : null;
  const activeBoards = new Map(); // code -> { ownerId, lastTs }
  const ACTIVE_TTL_MS = 7000;
  function isBoardActive(code){ const e = activeBoards.get(code); return !!(e && (Date.now() - e.lastTs) <= ACTIVE_TTL_MS); }
  // Debounced sidebar stats updates
  let _wbStatsDirty = false;
  let _wbStatsTimer = null;
  const _WB_STATS_DEBOUNCE = 250; // ms
  function scheduleSidebarStatsUpdate(){
    _wbStatsDirty = true;
    if(_wbStatsTimer) return;
    _wbStatsTimer = setTimeout(()=>{
      _wbStatsTimer = null;
      if(!_wbStatsDirty) return;
      _wbStatsDirty = false;
      refreshWhiteboardItemTitles();
    }, _WB_STATS_DEBOUNCE);
  }
  function refreshWhiteboardItemTitles(){
    try{
      const list = document.getElementById('whiteboardList'); if(!list) return;
      const items = Array.from(list.querySelectorAll('.whiteboard-item'));
      for(const item of items){
        const codeEl = item.querySelector('span');
        const small = item.querySelector('small');
        if(!codeEl || !small) continue;
        const code = codeEl.textContent;
        const last = boardLastActive.get(code);
        if(last){ const dt = new Date(last); small.title = dt.toLocaleString(); }
        const meta = boardMetaCache.get(code);
        if(!last && meta && meta.lastActive){
          try{ boardLastActive.set(code, meta.lastActive); small.title = new Date(meta.lastActive).toLocaleString(); }catch(_){ }
        }
        // Also update Active/Inactive label without full re-render
        const hasOwner = ownerBoards.has(code) || (meta && meta.ownerId);
        const isActive = isBoardActive(code) || hasOwner;
        const info = ownerBoards.has(code) ? 'Owner' : (isActive ? 'Active' : 'Inactive');
        small.textContent = info;
      }
    }catch(_){}
  }
  if(registry){
    registry.onmessage = (ev)=>{
      const msg = ev && ev.data || ev; if(!msg || !msg.boardId) return;
      if(msg.type==='create' || msg.type==='heartbeat'){
        activeBoards.set(msg.boardId, { ownerId: msg.ownerId, lastTs: msg.ts||Date.now() });
        scheduleSidebarStatsUpdate();
      } else if(msg.type==='destroy'){
        activeBoards.delete(msg.boardId);
        scheduleSidebarStatsUpdate();
      }
    };
  }

  // Identity used by whiteboard networking (matches whiteboard.js selection)
  const myId = (DB.user && DB.user.uid) || (window.Whiteboard && typeof window.Whiteboard.getClientId==='function' ? window.Whiteboard.getClientId() : null) || 'anon';

  // --- Ownership/Participants helpers (must be defined before used) ---
  const ownerBoards = new Set(); // codes I own
  const boardMetaCache = new Map();
  let ownedBoardsLoaded = false;
  const heartbeats = new Map(); // code -> intervalId
  let currentBoard = null; // currently joined code
  let boardChannel = null; // BroadcastChannel for current board traffic
  const participants = new Map(); // userId -> {userId, name, color, idle, lastUpdate}

  // Board stats storage (declare before first use)
  const boardWatchers = new Map(); // code -> unsubscribe function(s)
  const boardLastActive = new Map();

  function normalizeBoardCode(code){
    return (code || '').trim().toUpperCase();
  }

  function firebaseDbReady(){
    try{
      if(DB.whiteboardPersistDisabled) return false;
      const fb = window.firebase;
      return !!(fb && typeof fb.getDatabase === 'function' && fb._app && fb._app.options && fb._app.options.databaseURL);
    }catch(_){ return false; }
  }

  function clearOwnedBoardState(){
    ownerBoards.clear();
    boardMetaCache.clear();
    ownedBoardsLoaded = false;
    boardLastActive.clear();
  }

  function mergeOwnedBoardsIntoList(codes){
    if(!Array.isArray(codes) || !codes.length) return;
    const seen = new Set();
    const next = [];
    codes.forEach((code)=>{
      const normalized = normalizeBoardCode(code);
      if(!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      next.push(normalized);
    });
    _wbList.forEach((code)=>{
      const normalized = normalizeBoardCode(code);
      if(!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      next.push(normalized);
    });
    if(next.length > 20) next.length = 20;
    const changed = next.length !== _wbList.length || next.some((code, idx)=> _wbList[idx] !== code);
    if(changed){
      _wbList = next;
      saveWbList();
    }
  }

  function rememberBoardLocally(code){
    const normalized = normalizeBoardCode(code);
    if(!normalized) return;
    if(!_wbList.includes(normalized)){
      _wbList.unshift(normalized);
      if(_wbList.length > 20) _wbList.length = 20;
      saveWbList();
    }
  }

  async function fetchBoardMetaCached(code){
    const normalized = normalizeBoardCode(code);
    if(!normalized) return null;
    if(boardMetaCache.has(normalized)) return boardMetaCache.get(normalized);
    if(!firebaseDbReady()) return null;
    try{
      const meta = await DB.fetchBoardMetadata(normalized);
      if(meta){
        boardMetaCache.set(normalized, meta);
        if(meta.lastActive){ try{ boardLastActive.set(normalized, meta.lastActive); }catch(_){ } }
      }
      return meta || null;
    }catch(e){
      console.warn('Failed to fetch board metadata', e);
      return null;
    }
  }

  async function syncOwnedBoardsFromDb(force=false){
    if(DB.whiteboardPersistDisabled) return;
    if(!DB.user || !firebaseDbReady()) return;
    if(ownedBoardsLoaded && !force) return;
    try{
      const codes = await DB.loadOwnedBoards();
      ownerBoards.clear();
      if(Array.isArray(codes)){
        codes.forEach((code)=>{
          const normalized = normalizeBoardCode(code);
          if(!normalized) return;
          ownerBoards.add(normalized);
          fetchBoardMetaCached(normalized).catch(()=>{});
        });
      }
      mergeOwnedBoardsIntoList(Array.from(ownerBoards));
    }catch(e){
      console.warn('Failed to load owned whiteboards', e);
    }finally{
      ownedBoardsLoaded = true;
      renderWhiteboardList();
    }
  }

  function generateBoardCode() {
    // Simple human-friendly 6-char code (A-Z0-9)
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let out = '';
    for (let i = 0; i < 6; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
    return out;
  }

  function setWhiteboardUIFor(boardId) {
    const title = $('#whiteboardTitle');
    const codeEl = $('#whiteboardCode');
    const shareBtn = $('#whiteboardShareBtn');
    const leaveBtn = $('#whiteboardLeaveBtn');
    const overlay = $('#whiteboardOverlay');
    const meta = $('#whiteboardMeta');
    currentBoard = boardId || null;
    if (boardId) {
      if (title) title.textContent = 'Board — ' + boardId;
      if (codeEl) codeEl.textContent = boardId;
      if (shareBtn) shareBtn.disabled = false;
      if (leaveBtn) leaveBtn.disabled = false;
      attachBoardChannel(boardId);
      if (overlay) overlay.classList.add('hidden');
      // Ensure members badge exists
      if (meta && !meta.querySelector('.wb-members')){
        const badge = document.createElement('span');
        badge.className = 'wb-members';
        badge.textContent = '0 members';
        meta.appendChild(badge);
      }
      updateMembersBadge();
    } else {
      if (title) title.textContent = 'Select a whiteboard';
      if (codeEl) codeEl.textContent = '';
      if (shareBtn) shareBtn.disabled = true;
      if (leaveBtn) leaveBtn.disabled = true;
      detachBoardChannel();
      if (overlay) overlay.classList.remove('hidden');
      if (meta) meta.innerHTML = '';
    }
  }

  // Keep a simple in-memory list of boards for this demo (persisted per-session)
  let _wbList = JSON.parse(sessionStorage.getItem('studyflow:whiteboards') || '[]');
  _wbList = Array.from(new Set((_wbList || []).map(normalizeBoardCode).filter(Boolean)));
  function saveWbList() {
    try {
      const unique = Array.from(new Set((_wbList || []).map(normalizeBoardCode).filter(Boolean)));
      sessionStorage.setItem('studyflow:whiteboards', JSON.stringify(unique));
      _wbList = unique;
    } catch(_){ }
  }

  function renderWhiteboardList() {
    const list = $('#whiteboardList');
    if (!list) return;
    list.innerHTML = '';
    if (!_wbList.length) {
      const empty = document.createElement('div');
      empty.className = 'whiteboard-empty-list';
      empty.textContent = 'No boards yet - create one to get started';
      list.appendChild(empty);
      return;
    }
    const codes = Array.from(new Set(_wbList.map(normalizeBoardCode).filter(Boolean)));
    codes.forEach(code => {
      const item = document.createElement('div');
      const meta = boardMetaCache.get(code);
      if(!meta && firebaseDbReady()){
        fetchBoardMetaCached(code).then((info)=>{ if(info) renderWhiteboardList(); }).catch(()=>{});
      }
      if(meta && DB.user && meta.ownerId === DB.user.uid){ ownerBoards.add(code); }
      const hasOwner = ownerBoards.has(code) || (meta && meta.ownerId);
      const isActive = isBoardActive(code) || hasOwner;
      item.className = 'whiteboard-item' + (currentBoard === code ? ' active' : '');
      const top = document.createElement('span');
      top.textContent = code;
      const sub = document.createElement('small');
      const last = boardLastActive.get(code);
      if (last) {
        try{ sub.title = new Date(last).toLocaleString(); }catch(_){ }
      } else if(meta && meta.updatedAt){
        try{ sub.title = new Date(meta.updatedAt).toLocaleString(); }catch(_){ }
        if(meta.lastActive){
          try{ boardLastActive.set(code, meta.lastActive); }catch(_){ }
        }
      }
      const info = ownerBoards.has(code) ? 'Owner' : (isActive ? 'Active' : 'Inactive');
      sub.textContent = info;
      item.appendChild(top);
      item.appendChild(sub);
      ensureBoardWatcher(code);
      item.onclick = () => { joinWhiteboardByCode(code).catch(()=>{}); };
      list.appendChild(item);
    });
    scheduleSidebarStatsUpdate();
  }
  async function joinWhiteboardByCode(rawCode, options = {}) {
    const code = normalizeBoardCode(rawCode);
    if(!code){
      if(!options.silent){ showToast('Enter a board code to join', 2000); }
      return false;
    }
    if(!DB.user){
      requestSignIn();
      return false;
    }
    let meta = boardMetaCache.get(code);
    if(!meta && firebaseDbReady()){
      try{ meta = await fetchBoardMetaCached(code); }catch(err){
        console.warn('Failed to fetch board metadata', err);
        // If permission errors prevent reading metadata, disable persistence for this session
        if(isPermissionDeniedError(err) || (err && err.code && err.code.toString().toLowerCase().includes('permission_denied'))){
          try{ DB.markWhiteboardPersistenceDisabled(err); }catch(_){ }
          if(!options.silent) showToast('Board metadata unavailable due to permissions — joining anyway but persistence is disabled for this session.', 4500);
          meta = null; // proceed with join using local session
        }
      }
    }
    if(firebaseDbReady() && !meta){
      // If DB is configured but metadata is missing AND we didn't just have a permission error, treat as not found
      if(!DB.whiteboardPersistDisabled){
        if(!options.silent){ showToast('Board not found', 2500); }
        return false;
      }
      // Otherwise, allow join (persistence disabled due to permissions)
    }
    if(meta){
      boardMetaCache.set(code, meta);
      if(DB.user && meta.ownerId === DB.user.uid){ ownerBoards.add(code); }
    }
    rememberBoardLocally(code);
    renderWhiteboardList();
    try{
      if(window.Whiteboard && typeof window.Whiteboard.join === 'function'){ window.Whiteboard.join(code); }
      setWhiteboardUIFor(code);
      const selfId = (DB.user && DB.user.uid) || myId;
      const selfName = (DB.user && (DB.user.displayName||DB.user.email)) || 'You';
      try{ upsertParticipant({ userId: selfId, name: selfName, color: '#2563eb', idle: false }); }catch(_){ }
      try{ renderParticipants(); }catch(_){ }
      if(options.toast !== false){
        const msg = options.toastMessage || ('Joined board ' + code);
        showToast(msg, 2000);
      }
    }catch(err){
      console.warn('Join failed', err);
      showToast('Failed to join board', 2000);
      return false;
    }
    if(firebaseDbReady() && DB.user){
      try{
        if(ownerBoards.has(code)){
          const updated = await DB.persistBoardOwnership(code);
          if(updated){ boardMetaCache.set(code, updated); }
        } else {
          await DB.recordBoardMembership(code, 'member');
          if(meta){
            const members = Object.assign({}, meta.members || {});
            members[DB.user.uid] = 'member';
            boardMetaCache.set(code, Object.assign({}, meta, { members }));
          }
        }
      }catch(err){ console.warn('Failed to sync board membership', err); }
    }
    if(ownerBoards.has(code)){
      mergeOwnedBoardsIntoList(Array.from(ownerBoards));
      renderWhiteboardList();
    }
    return true;
  }

  // New board
  const createBtn = $('#createWhiteboardBtn');
  if (createBtn) createBtn.onclick = async () => {
    if (!DB.user) { requestSignIn(); return; }
    const code = normalizeBoardCode(generateBoardCode());
    ownerBoards.add(code);
    rememberBoardLocally(code);
    renderWhiteboardList();
    try {
      markAsOwner(code);
    } catch(e){ console.warn('Failed to start owner heartbeat', e); }
    if (firebaseDbReady()) {
      try {
        const meta = await DB.persistBoardOwnership(code);
        if(meta){ boardMetaCache.set(code, meta); }
      } catch(err) { console.warn('Failed to persist board ownership', err); }
    }
    const joined = await joinWhiteboardByCode(code, { toastMessage: 'Created and joined board ' + code });
    if(!joined){
      return;
    }
    if (firebaseDbReady()) {
      try { await DB.recordBoardMembership(code, 'owner'); }catch(err){ console.warn('Failed to record owner membership', err); }
    }
  };

  // Join by code
  const joinInput = $('#whiteboardJoinInput');
  const joinBtn = $('#joinWhiteboardBtn');
  if (joinBtn && joinInput) joinBtn.onclick = async () => {
    const code = joinInput.value || '';
    const joined = await joinWhiteboardByCode(code);
    if(joined){ joinInput.value = ''; }
  };

  // Leave
  const leaveBtn = $('#whiteboardLeaveBtn');
  if (leaveBtn) leaveBtn.onclick = () => {
    try {
      const cur = currentBoard;
      if (!cur) { showToast('No board selected', 1500); return; }
      // If I am the owner of this board, announce destroy and stop heartbeat
      if (ownerBoards.has(cur)) {
        stopHeartbeat(cur, true);
      }
      window.Whiteboard.leave();
      setWhiteboardUIFor(null);
      showToast('Left whiteboard', 1500);
    } catch(e){ console.warn('Leave failed', e); }
  };

  // Clear board (clears remote cursors overlay only for now)
  const clearBtn = $('#whiteboardClearBtn');
  if (clearBtn) clearBtn.onclick = () => {
    try {
      const cur = (window.Whiteboard && typeof window.Whiteboard.getCurrentBoard === 'function') ? window.Whiteboard.getCurrentBoard() : null;
      if (!cur) { showToast('No board selected', 1500); return; }
      if (ownerBoards.has(cur)){
        // Owner clears: broadcast to all and wipe persistence
        if (window.Whiteboard && typeof window.Whiteboard.clearForAll === 'function') window.Whiteboard.clearForAll();
        if (window.Whiteboard && typeof window.Whiteboard.clearPersisted === 'function') window.Whiteboard.clearPersisted();
      } else {
        if (window.Whiteboard && typeof window.Whiteboard.clear === 'function') window.Whiteboard.clear();
      }
      showToast('Cleared board', 1500);
    } catch(e){ console.warn('Clear failed', e); }
  };

  // Share (copy code to clipboard)
  const shareBtn = $('#whiteboardShareBtn');
  if (shareBtn) shareBtn.onclick = async () => {
    const cur = (window.Whiteboard && typeof window.Whiteboard.getCurrentBoard === 'function') ? window.Whiteboard.getCurrentBoard() : null;
    if (!cur) { showToast('No board selected', 1500); return; }
    try { await navigator.clipboard.writeText(cur); showToast('Board code copied', 1500); } catch(e){ showToast('Copy failed', 1500); }
  };

  // Wire up initial list
  renderWhiteboardList();

  function markAsOwner(code){
    ownerBoards.add(code);
    // announce create and start heartbeat
    const announce = (type)=>{ if(!registry) return; try{ registry.postMessage({ type, boardId: code, ownerId: myId, ts: Date.now() }); }catch(_){} };
    announce('create');
    if(!heartbeats.has(code)){
      const id = setInterval(()=> announce('heartbeat'), 2000);
      heartbeats.set(code, id);
    }
  }

  function stopHeartbeat(code, announceDestroy=false){
    const id = heartbeats.get(code); if(id){ clearInterval(id); heartbeats.delete(code); }
    if(announceDestroy && registry){ try{ registry.postMessage({ type:'destroy', boardId: code, ownerId: myId, ts: Date.now() }); }catch(_){} }
  }

  function attachBoardChannel(code){
    detachBoardChannel();
    if(typeof BroadcastChannel === 'undefined') return;
    boardChannel = new BroadcastChannel('whiteboard:' + code);
    boardChannel.onmessage = (ev)=>{ handleBoardMessage(ev && ev.data || ev); };
    participants.clear();
    renderParticipants();
    // mark last-active now
    boardLastActive.set(code, Date.now());
  }

  function detachBoardChannel(){
    if(boardChannel){ try{ boardChannel.close(); }catch(_){} boardChannel = null; }
    participants.clear();
    renderParticipants();
  }

  function upsertParticipant(p){
    if(!p || !p.userId) return; const r = participants.get(p.userId) || { userId: p.userId };
    if(p.name) r.name = p.name; if(p.color) r.color = p.color; if(typeof p.idle==='boolean') r.idle = p.idle;
    r.lastUpdate = Date.now(); participants.set(p.userId, r);
    // bump last-active and badge
    if(currentBoard){ boardLastActive.set(currentBoard, Date.now()); updateMembersBadge(); }
  }

  function handleBoardMessage(msg){
    if(!msg || msg.boardId !== currentBoard) return;
    if(msg.type === 'presence'){
      const p = msg.payload || {}; const uid = p.userId; if(!uid) return;
      if(p.action === 'leave') { participants.delete(uid); }
      else if(p.action === 'idle') { upsertParticipant({ userId: uid, name: p.name, color: p.color, idle: true }); }
      else { upsertParticipant({ userId: uid, name: p.name, color: p.color, idle: false }); }
      renderParticipants();
      if(currentBoard){ boardLastActive.set(currentBoard, Date.now()); updateMembersBadge(); }
    } else if(msg.type === 'control'){
      const c = msg.payload || {};
      if(c.action === 'kick' && c.targetUserId === myId){
        try{ window.Whiteboard.leave(); }catch(_){}
        setWhiteboardUIFor(null);
        showToast('You were removed by the owner', 2500);
      }
    }
  }

  function renderParticipants(){
    const container = $('#whiteboardParticipants'); if(!container) return;
    container.innerHTML = '';
    if(!currentBoard) return;
    const iAmOwner = ownerBoards.has(currentBoard);
    participants.forEach((rec)=>{
      const row = document.createElement('div');
      row.className = 'whiteboard-participant' + (rec.userId === myId ? ' self' : '') + (iAmOwner && rec.userId === myId ? ' admin' : '');
      const name = document.createElement('span'); name.textContent = (rec.name || (rec.userId||'user').slice(-6)); row.appendChild(name);
      if(iAmOwner && rec.userId !== myId){
        const btn = document.createElement('button'); btn.className = 'remove'; btn.title = 'Remove user'; btn.innerText = '×';
        btn.onclick = ()=>{
          try{ if(boardChannel){ boardChannel.postMessage({ boardId: currentBoard, senderId: myId, type: 'control', payload: { action:'kick', targetUserId: rec.userId, requestedBy: myId, ts: Date.now() } }); } }catch(_){}
        };
        row.appendChild(btn);
      }
      container.appendChild(row);
    });
    updateMembersBadge();
  }

  // -------- Board stats: members count + last active --------
  function ensureBoardWatcher(code){
    if (boardWatchers.has(code)) return;
    // Watch owner heartbeats to update lastActive
    const reg = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(REGISTRY_CH) : null;
    const onReg = (ev)=>{
      const msg = ev && ev.data || ev; if(!msg || msg.boardId !== code) return;
      if(msg.type==='heartbeat' || msg.type==='create'){ boardLastActive.set(code, msg.ts || Date.now()); scheduleSidebarStatsUpdate(); }
      if(msg.type==='destroy'){ boardLastActive.set(code, Date.now()); scheduleSidebarStatsUpdate(); }
    };
    if (reg) reg.addEventListener('message', onReg);
    // Also listen to board channel passively to detect presence/strokes updates
    let bc = null; if(typeof BroadcastChannel !== 'undefined'){ bc = new BroadcastChannel('whiteboard:' + code); bc.addEventListener('message', ()=>{ boardLastActive.set(code, Date.now()); scheduleSidebarStatsUpdate(); }); }
    boardWatchers.set(code, ()=>{ try{ if(reg) reg.removeEventListener('message', onReg); }catch(_){} try{ if(bc) bc.close(); }catch(_){} });
  }
  function disposeBoardWatcher(code){ const fn = boardWatchers.get(code); if(fn){ try{ fn(); }catch(_){} boardWatchers.delete(code); } }
  function updateMembersBadge(){
    const meta = $('#whiteboardMeta'); if(!meta) return;
    const badge = meta.querySelector('.wb-members'); if(!badge) return;
    const count = participants.size;
    badge.textContent = `${count} member${count===1?'':'s'}`;
  }

  // Clean up on unload (owners announce destroy)
  window.addEventListener('beforeunload', ()=>{
    try{
      if(currentBoard && ownerBoards.has(currentBoard)){
        stopHeartbeat(currentBoard, true);
      }
    }catch(_){}
  });

  // Update auth UI based on user object (Firebase user or null)
  function updateAuthUI(user){
    const signedOut = $('#signedOutControls');
    const signedIn = $('#signedInControls');
    const displayNameEl = $('#displayName');
    const avatarEl = $('#avatar');
    const profileMenu = $('#profileMenu');
    const menuSignOut = $('#menuSignOut');

    if(user){
      // Hide signed-out inputs
      if(signedOut) signedOut.style.display='none';
      if(signedIn) signedIn.style.display='flex';
      // Name: prefer displayName, fall back to email
      const name = user.displayName || user.email || 'User';
      // Show 'Firstname L.' (first name + initial of surname)
  const parts = name.split(' ').filter(Boolean);
  let first = parts[0]||name; const lastInitial = parts[1]?parts[1][0].toUpperCase()+'.':'';
  // Capitalize first letter of first name
  first = first.charAt(0).toUpperCase() + first.slice(1);
  if(displayNameEl) displayNameEl.textContent = `${first} ${lastInitial}`.trim();

  // Avatar: prefer photoURL, else try providerData, else initial of name
  let photo = user.photoURL;
  try{ if(!photo && user.providerData && user.providerData.length){ photo = user.providerData.find(p=>p.photoURL && p.photoURL.length>0)?.photoURL; } }catch(e){}
  if(photo){ avatarEl.style.backgroundImage = `url(${photo})`; avatarEl.style.backgroundSize='cover'; avatarEl.textContent=''; }
      else { avatarEl.style.backgroundImage=''; avatarEl.textContent = (first[0]||'U').toUpperCase(); }

      // Wire sign out buttons
      if($('#signoutBtn')) $('#signoutBtn').onclick = ()=> DB.signOut();
      if(menuSignOut) menuSignOut.onclick = ()=> { DB.signOut(); profileMenu.classList.remove('open'); };
    } else {
      if(signedOut) signedOut.style.display='flex';
      if(signedIn) signedIn.style.display='none';
      if(displayNameEl) displayNameEl.textContent = '';
      if(avatarEl) { avatarEl.style.backgroundImage=''; avatarEl.textContent = 'U'; }
    }
  }

  // Ensure UI reflects current DB.user at boot
  try{ updateAuthUI(DB.user); }catch(e){ /* ignore */ }

  // (showToast is provided globally earlier)
}

document.addEventListener('DOMContentLoaded', boot);


















