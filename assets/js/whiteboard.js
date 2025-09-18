
(function(){
  'use strict';

  const CODE_LENGTH = 6;
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const PRESENCE_THROTTLE = 120;
  const CURSOR_TIMEOUT = 7000;
  const COLOR_PALETTE = ['#F97316', '#10B981', '#6366F1', '#EC4899', '#F59E0B', '#0EA5E9', '#8B5CF6', '#14B8A6', '#E11D48', '#F472B6', '#FB7185', '#38BDF8', '#64748B', '#22D3EE'];

  const noop = ()=>{};

  function clamp(v, min, max){ return Math.min(Math.max(v, min), max); }

  function showToast(msg, duration){
    if(typeof window.showToast === 'function') window.showToast(msg, duration||3200);
    else if(window.console) console.info(msg);
  }

  function cleanCode(value){
    return (value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
  }

  function generateCode(){
    let code = '';
    for(let i=0;i<CODE_LENGTH;i++){ code += CODE_CHARS[Math.floor(Math.random()*CODE_CHARS.length)]; }
    return code;
  }

  function safeDisplayName(user){
    if(!user) return 'Unknown';
    if(user.displayName) return user.displayName;
    if(user.email) return user.email.split('@')[0];
    return 'User';
  }

  function colorForUid(uid){
    if(!uid) return COLOR_PALETTE[0];
    let hash = 0;
    for(let i=0;i<uid.length;i++){ hash = ((hash << 5) - hash) + uid.charCodeAt(i); hash |= 0; }
    const index = Math.abs(hash) % COLOR_PALETTE.length;
    return COLOR_PALETTE[index];
  }

  function formatRelative(ts){
    if(!ts) return '';
    let ms = null;
    if(typeof ts === 'number') ms = ts;
    else if(ts && typeof ts === 'object'){
      if(typeof ts.toMillis === 'function') ms = ts.toMillis();
      else if(typeof ts.seconds === 'number') ms = ts.seconds * 1000 + Math.floor((ts.nanoseconds || 0)/1e6);
    }
    if(!ms) return '';
    const diff = Date.now() - ms;
    if(diff < 1000) return 'just now';
    const units = [
      { limit: 60*1000, divisor: 1000, label: 's' },
      { limit: 60*60*1000, divisor: 60*1000, label: 'm' },
      { limit: 24*60*60*1000, divisor: 60*60*1000, label: 'h' },
      { limit: 7*24*60*60*1000, divisor: 24*60*60*1000, label: 'd' }
    ];
    for(const u of units){
      if(diff < u.limit){
        const value = Math.max(1, Math.round(diff / u.divisor));
        const suffix = u.label;
        return `${value}${suffix} ago`;
      }
    }
    const days = Math.round(diff / (24*60*60*1000));
    return `${days}d ago`;
  }

  function isFirebaseReady(){
    return typeof window !== 'undefined'
      && window.firebase
      && typeof window.firebase.getFirestore === 'function'
      && (window.firebase._firestore || window.firebase._app || window.__FIREBASE_CONFIG__);
  }

  function lucideRefresh(root){
    try{
      if(window.lucide && typeof window.lucide.createIcons === 'function'){
        window.lucide.createIcons({ root: root || document });
      }
    }catch(err){ /* ignore */ }
  }

  const Whiteboard = {
    initialized:false,
    currentUser:null,
    firestore:null,
    boards:[],
    boardsLoading:false,
    boardRefreshTimer:null,
    currentBoard:null,
    boardData:null,
    isAdmin:false,
    strokes:[],
    ctx:null,
    canvasWidth:0,
    canvasHeight:0,
    stageSize:{ width:1, height:1 },
    dpr:window.devicePixelRatio || 1,
    pendingStroke:null,
    pendingResize:false,
    unsubBoard:null,
    unsubStrokes:null,
    unsubPresence:null,
    presenceDocRef:null,
    lastPresenceWrite:0,
    cursors:new Map(),
    presenceData:new Map(),
    state:{ tool:'pen', color:'#2e2e2e', size:6, drawing:false },
    dom:{},

    init(){
      if(this.initialized) return;
      this.dom.page = document.getElementById('whiteboardPage');
      if(!this.dom.page) return; // page not present
      this.dom.list = document.getElementById('whiteboardList');
      this.dom.createBtn = document.getElementById('createWhiteboardBtn');
      this.dom.joinInput = document.getElementById('whiteboardJoinInput');
      this.dom.joinBtn = document.getElementById('joinWhiteboardBtn');
      this.dom.shareBtn = document.getElementById('whiteboardShareBtn');
      this.dom.leaveBtn = document.getElementById('whiteboardLeaveBtn');
      this.dom.title = document.getElementById('whiteboardTitle');
      this.dom.meta = document.getElementById('whiteboardMeta');
      this.dom.code = document.getElementById('whiteboardCode');
      this.dom.participants = document.getElementById('whiteboardParticipants');
      this.dom.toolbar = document.getElementById('whiteboardToolbar');
      this.dom.toolButtons = Array.from((this.dom.toolbar && this.dom.toolbar.querySelectorAll('.whiteboard-tool[data-tool]')) || []);
      this.dom.colorInput = document.getElementById('whiteboardColor');
      this.dom.sizeInput = document.getElementById('whiteboardSize');
      this.dom.clearBtn = document.getElementById('whiteboardClearBtn');
      this.dom.fitBtn = document.getElementById('whiteboardFitBtn');
      this.dom.stage = document.getElementById('whiteboardStage');
      this.dom.canvas = document.getElementById('whiteboardCanvas');
      this.dom.overlay = document.getElementById('whiteboardOverlay');
      this.dom.overlayMessage = document.getElementById('whiteboardEmptyState');
      this.dom.overlayText = this.dom.overlayMessage ? this.dom.overlayMessage.querySelector('p') : null;
      this.dom.cursors = document.getElementById('whiteboardCursors');

      if(!this.dom.canvas || !this.dom.stage) return;

      this.ctx = this.dom.canvas.getContext('2d');
      if(!this.ctx) return;

      this.bindUI();
      this.resizeCanvas(true);
      window.addEventListener('resize', ()=> this.resizeCanvas());
      this.initialized = true;
      this.renderBoards();
      this.updateToolbarUI();
      this.setOverlayVisible(true, this.currentUser ? 'Select or create a whiteboard to start' : 'Sign in to create a whiteboard');
    },

    bindUI(){
      const self = this;
      if(this.dom.createBtn){
        this.dom.createBtn.addEventListener('click', ()=> self.createBoard());
      }
      if(this.dom.joinBtn){
        this.dom.joinBtn.addEventListener('click', ()=> self.joinBoard());
      }
      if(this.dom.joinInput){
        this.dom.joinInput.addEventListener('input', (evt)=>{ evt.target.value = cleanCode(evt.target.value); });
        this.dom.joinInput.addEventListener('keyup', (evt)=>{
          if(evt.key === 'Enter'){ self.joinBoard(); }
        });
      }
      if(this.dom.shareBtn){
        this.dom.shareBtn.addEventListener('click', ()=> self.copyShareCode());
      }
      if(this.dom.leaveBtn){
        this.dom.leaveBtn.addEventListener('click', ()=> self.leaveBoard());
      }
      if(this.dom.clearBtn){
        this.dom.clearBtn.addEventListener('click', ()=> self.clearBoard());
      }
      if(this.dom.fitBtn){
        this.dom.fitBtn.addEventListener('click', ()=> self.resizeCanvas(true));
      }
      if(this.dom.toolButtons && this.dom.toolButtons.length){
        this.dom.toolButtons.forEach(btn=>{
          btn.addEventListener('click', ()=>{
            const tool = btn.dataset.tool;
            if(!tool) return;
            self.state.tool = tool;
            self.dom.toolButtons.forEach(b=> b.classList.toggle('active', b === btn));
            if(tool === 'eraser'){
              self.dom.colorInput.disabled = true;
            } else {
              self.dom.colorInput.disabled = false;
            }
          });
        });
      }
      if(this.dom.colorInput){
        this.dom.colorInput.addEventListener('input', (evt)=>{
          self.state.color = evt.target.value || '#2e2e2e';
          self.updateToolbarUI();
        });
      }
      if(this.dom.sizeInput){
        this.dom.sizeInput.addEventListener('input', (evt)=>{
          const val = parseInt(evt.target.value, 10);
          if(!Number.isNaN(val)) self.state.size = clamp(val, 2, 48);
          self.updateToolbarUI();
        });
      }
      if(this.dom.list){
        this.dom.list.addEventListener('click', (evt)=>{
          const item = evt.target.closest('[data-board-code]');
          if(item){
            const code = item.getAttribute('data-board-code');
            if(code) self.selectBoard(code);
          }
        });
      }

      ['handlePointerDown','handlePointerMove','handlePointerUp','handlePointerLeave'].forEach(name=>{
        this[name] = this[name].bind(this);
      });

      this.dom.canvas.addEventListener('pointerdown', this.handlePointerDown);
      this.dom.canvas.addEventListener('pointermove', this.handlePointerMove);
      this.dom.canvas.addEventListener('pointerup', this.handlePointerUp);
      this.dom.canvas.addEventListener('pointercancel', this.handlePointerUp);
      this.dom.canvas.addEventListener('pointerleave', this.handlePointerLeave);
    },

    updateToolbarUI(){
      if(this.dom.sizeInput){
        this.dom.sizeInput.value = this.state.size;
      }
      if(this.dom.colorInput && !this.dom.colorInput.disabled){
        this.dom.colorInput.value = this.state.color;
      }
    },

    setOverlayVisible(visible, message){
      if(!this.dom.overlay) return;
      if(typeof message === 'string' && this.dom.overlayText){
        this.dom.overlayText.textContent = message;
      }
      this.dom.overlay.classList.toggle('hidden', !visible);
    },

    resizeCanvas(force){
      if(!this.dom.stage || !this.dom.canvas) return;
      const rect = this.dom.stage.getBoundingClientRect();
      if((rect.width || 0) < 10 || (rect.height || 0) < 10){
        this.pendingResize = true;
        return;
      }
      this.pendingResize = false;
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if(force || this.dom.canvas.width !== width || this.dom.canvas.height !== height){
        this.dom.canvas.width = width;
        this.dom.canvas.height = height;
        this.dom.canvas.style.width = `${rect.width}px`;
        this.dom.canvas.style.height = `${rect.height}px`;
        this.canvasWidth = width;
        this.canvasHeight = height;
        this.stageSize = { width: rect.width, height: rect.height };
        this.dpr = dpr;
        if(this.ctx){
          this.ctx.lineCap = 'round';
          this.ctx.lineJoin = 'round';
        }
        this.redrawAllStrokes();
      }
    },

    handlePointerDown(evt){
      if(!this.currentBoard || !this.currentUser || !this.boardData) return;
      if(evt.pointerType === 'touch'){ evt.preventDefault(); }
      this.dom.canvas.setPointerCapture(evt.pointerId);
      this.state.drawing = true;
      const point = this.eventToPoint(evt);
      this.pendingStroke = {
        tool: this.state.tool,
        color: this.state.tool === 'eraser' ? '#000000' : this.state.color,
        size: this.state.size,
        points: [point]
      };
      this.drawDot(point, this.pendingStroke);
      this.sendPresence(point);
    },

    handlePointerMove(evt){
      if(!this.currentBoard || !this.currentUser) return;
      const point = this.eventToPoint(evt);
      if(this.state.drawing && this.pendingStroke){
        const pts = this.pendingStroke.points;
        const last = pts[pts.length-1];
        if(!last || Math.hypot(point.x - last.x, point.y - last.y) > 0.0015){
          pts.push(point);
          this.drawSegment(last || point, point, this.pendingStroke);
        }
      }
      this.sendPresence(point);
    },

    handlePointerUp(evt){
      if(this.state.drawing){
        this.state.drawing = false;
        this.dom.canvas.releasePointerCapture(evt.pointerId);
        const stroke = this.pendingStroke;
        this.pendingStroke = null;
        if(stroke && stroke.points && stroke.points.length){
          this.pushStrokeToServer(stroke);
        }
      }
      this.sendPresence(null);
    },

    handlePointerLeave(){
      if(!this.state.drawing){
        this.sendPresence(null);
      }
    },

    eventToPoint(evt){
      const rect = this.dom.stage.getBoundingClientRect();
      const x = clamp((evt.clientX - rect.left) / rect.width, 0, 1);
      const y = clamp((evt.clientY - rect.top) / rect.height, 0, 1);
      return { x, y };
    },

    normalizedToCanvas(pt){
      return { x: pt.x * this.canvasWidth, y: pt.y * this.canvasHeight };
    },

    drawSegment(start, end, stroke){
      if(!this.ctx || !start || !end) return;
      this.ctx.save();
      if(stroke.tool === 'eraser'){
        this.ctx.globalCompositeOperation = 'destination-out';
        this.ctx.strokeStyle = '#000';
        this.ctx.lineWidth = Math.max(1, stroke.size * this.dpr);
      } else {
        this.ctx.globalCompositeOperation = 'source-over';
        this.ctx.strokeStyle = stroke.color || this.state.color;
        this.ctx.globalAlpha = stroke.tool === 'highlighter' ? 0.35 : 1;
        const factor = stroke.tool === 'highlighter' ? 1.8 : 1;
        this.ctx.lineWidth = Math.max(1, stroke.size * factor * this.dpr);
      }
      this.ctx.beginPath();
      const s = this.normalizedToCanvas(start);
      const e = this.normalizedToCanvas(end);
      this.ctx.moveTo(s.x, s.y);
      this.ctx.lineTo(e.x, e.y);
      this.ctx.stroke();
      this.ctx.restore();
      this.ctx.globalAlpha = 1;
      this.ctx.globalCompositeOperation = 'source-over';
    },

    drawDot(point, stroke){
      if(!this.ctx || !point) return;
      this.ctx.save();
      if(stroke.tool === 'eraser'){
        this.ctx.globalCompositeOperation = 'destination-out';
        this.ctx.fillStyle = '#000';
      } else {
        this.ctx.globalCompositeOperation = 'source-over';
        this.ctx.fillStyle = stroke.color || this.state.color;
        this.ctx.globalAlpha = stroke.tool === 'highlighter' ? 0.35 : 1;
      }
      const pos = this.normalizedToCanvas(point);
      const radius = Math.max(1, (stroke.size * (stroke.tool === 'highlighter' ? 1.6 : 1)) * this.dpr / 2);
      this.ctx.beginPath();
      this.ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();
      this.ctx.globalAlpha = 1;
      this.ctx.globalCompositeOperation = 'source-over';
    },

    redrawAllStrokes(){
      if(!this.ctx) return;
      this.ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
      if(!this.strokes || !this.strokes.length) return;
      this.strokes.forEach(stroke=>{
        if(!stroke || !stroke.points) return;
        if(stroke.points.length === 1) this.drawDot(stroke.points[0], stroke);
        else {
          for(let i=1;i<stroke.points.length;i++){
            this.drawSegment(stroke.points[i-1], stroke.points[i], stroke);
          }
        }
      });
    },

    sendPresence(point){
      if(!this.presenceDocRef || !this.currentUser) return;
      const now = Date.now();
      if(point && (now - this.lastPresenceWrite) < PRESENCE_THROTTLE) return;
      if(!point && (now - this.lastPresenceWrite) < PRESENCE_THROTTLE) return;
      this.lastPresenceWrite = now;
      const payload = {
        uid: this.currentUser.uid,
        displayName: safeDisplayName(this.currentUser),
        color: this.memberColor || this.state.color,
        updatedAt: now
      };
      if(point){
        payload.x = Number(point.x.toFixed(4));
        payload.y = Number(point.y.toFixed(4));
        payload.tool = this.state.tool;
      } else {
        payload.x = null;
        payload.y = null;
      }
      try{
        window.firebase.firestore.setDoc(this.presenceDocRef, payload, { merge: true }).catch(noop);
      }catch(err){
        /* ignore presence failures */
      }
    },

    clearPresence(){
      if(this.presenceDocRef){
        try{ window.firebase.firestore.deleteDoc(this.presenceDocRef).catch(noop); }catch(err){ }
      }
      this.presenceDocRef = null;
      this.lastPresenceWrite = 0;
      this.presenceData.clear();
      this.cursors.forEach(el=> el.remove());
      this.cursors.clear();
    },

    handleAuth(user){
      this.currentUser = user;
      if(!this.initialized) this.init();
      if(!user){
        this.detachBoardListeners();
        this.boards = [];
        this.currentBoard = null;
        this.boardData = null;
        this.isAdmin = false;
        this.renderBoards();
        this.toggleBoardActions();
        this.setOverlayVisible(true, 'Sign in to create a collaborative whiteboard');
        return;
      }
      if(isFirebaseReady()){
        try{ this.firestore = window.firebase.getFirestore(window.firebase._app); }catch(err){ this.firestore = null; }
      }
      this.memberColor = colorForUid(user.uid);
      this.loadBoards(true);
      this.toggleBoardActions();
    },

    onActivated(){
      if(!this.initialized) this.init();
      if(this.pendingResize) this.resizeCanvas(true);
      if(!this.currentUser){
        this.setOverlayVisible(true, 'Sign in to create a collaborative whiteboard');
        if(typeof window.requestSignIn === 'function') window.requestSignIn();
      } else if(!this.currentBoard){
        this.setOverlayVisible(true, 'Select or create a whiteboard to start drawing');
      }
    },

    toggleBoardActions(){
      const hasBoard = !!this.currentBoard && !!this.boardData;
      if(this.dom.shareBtn){ this.dom.shareBtn.disabled = !hasBoard; }
      if(this.dom.leaveBtn){ this.dom.leaveBtn.disabled = !hasBoard; }
      if(this.dom.clearBtn){ this.dom.clearBtn.disabled = !(hasBoard && this.isAdmin); }
      if(!hasBoard){
        if(this.dom.title){ this.dom.title.textContent = this.currentUser ? 'Select a whiteboard' : 'Sign in to start drawing'; }
        if(this.dom.meta){ this.dom.meta.textContent = ''; }
        if(this.dom.code){ this.dom.code.textContent = ''; }
        if(this.dom.participants){ this.dom.participants.innerHTML = ''; }
        this.strokes = [];
        this.redrawAllStrokes();
        this.setOverlayVisible(true, this.currentUser ? 'Select or create a whiteboard to start drawing' : 'Sign in to create a collaborative whiteboard');
      }
    },

    loadBoards(force){
      if(!this.currentUser || !isFirebaseReady()){
        this.boards = [];
        this.renderBoards();
        return;
      }
      if(this.boardsLoading && !force) return;
      this.boardsLoading = true;
      const uid = this.currentUser.uid;
      let fs = this.firestore;
      if(!fs){
        try{ fs = window.firebase.getFirestore(window.firebase._app); this.firestore = fs; }
        catch(err){ this.boardsLoading = false; showToast('Firebase not initialised for whiteboard'); return; }
      }
      const coll = window.firebase.firestore.collection(fs, 'whiteboards');
      const query = window.firebase.firestore.query(coll, window.firebase.firestore.where('participantIds', 'array-contains', uid));
      window.firebase.firestore.getDocs(query)
        .then((snap)=>{
          const boards = [];
          snap.forEach(docSnap=>{
            const data = docSnap.data() || {};
            boards.push({
              code: docSnap.id,
              title: data.title || 'Untitled board',
              updatedAt: data.updatedAt || data.createdAt || null,
              memberCount: data.participantIds ? data.participantIds.length : (data.members ? Object.keys(data.members).length : 0),
              ownerId: data.ownerId || null
            });
          });
          boards.sort((a,b)=>{
            const tA = a.updatedAt && typeof a.updatedAt.toMillis === 'function' ? a.updatedAt.toMillis() : 0;
            const tB = b.updatedAt && typeof b.updatedAt.toMillis === 'function' ? b.updatedAt.toMillis() : 0;
            return tB - tA;
          });
          this.boards = boards;
          this.renderBoards();
          if(!this.currentBoard && boards.length){ this.selectBoard(boards[0].code); }
        })
        .catch((err)=>{
          console.warn('Failed to load whiteboards', err);
          showToast('Unable to load whiteboards. Check your connection.');
        })
        .finally(()=>{ this.boardsLoading = false; });
    },

    renderBoards(){
      if(!this.dom.list) return;
      this.dom.list.innerHTML = '';
      if(!this.currentUser){
        const info = document.createElement('div');
        info.className = 'whiteboard-empty-list';
        info.textContent = 'Sign in to create and access your whiteboards.';
        this.dom.list.appendChild(info);
        return;
      }
      if(!this.boards || !this.boards.length){
        const empty = document.createElement('div');
        empty.className = 'whiteboard-empty-list';
        empty.textContent = 'No whiteboards yet. Create one to get started.';
        this.dom.list.appendChild(empty);
        return;
      }
      this.boards.forEach(board=>{
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'whiteboard-item';
        item.setAttribute('data-board-code', board.code);
        item.setAttribute('role', 'option');
        if(board.code === this.currentBoard){
          item.classList.add('active');
          item.setAttribute('aria-selected', 'true');
        } else {
          item.setAttribute('aria-selected', 'false');
        }
        const title = document.createElement('span');
        title.textContent = board.title || `Board ${board.code}`;
        const meta = document.createElement('small');
        const members = board.memberCount || 0;
        const rel = formatRelative(board.updatedAt);
        meta.textContent = `${board.code} - ${members} member${members === 1 ? '' : 's'}${rel ? ` - ${rel}` : ''}`;
        item.appendChild(title);
        item.appendChild(meta);
        this.dom.list.appendChild(item);
      });
    },

    createBoard: async function(){
      if(!this.currentUser){ showToast('Please sign in to create a whiteboard.'); if(window.requestSignIn) window.requestSignIn(); return; }
      if(!isFirebaseReady()){ showToast('Firebase is not configured.'); return; }
      const btn = this.dom.createBtn;
      if(btn) btn.disabled = true;
      try{
        const fs = this.firestore || window.firebase.getFirestore(window.firebase._app);
        this.firestore = fs;
        let code = generateCode();
        let attempts = 0;
        while(attempts < 5){
          const docRef = window.firebase.firestore.doc(fs, 'whiteboards', code);
          const exists = await window.firebase.firestore.getDoc(docRef);
          if(!exists.exists()) break;
          code = generateCode();
          attempts++;
        }
        const boardRef = window.firebase.firestore.doc(fs, 'whiteboards', code);
        const displayName = safeDisplayName(this.currentUser);
        const baseName = (displayName.split(' ')[0] || 'My').trim() || 'My';
        const boardTitle = baseName.endsWith('s') ? `${baseName}' board` : `${baseName}'s board`;
        const memberEntry = {
          displayName,
          role: 'admin',
          color: this.memberColor || colorForUid(this.currentUser.uid),
          photoURL: this.currentUser.photoURL || null,
          joinedAt: window.firebase.serverTimestamp(),
          lastActiveAt: window.firebase.serverTimestamp()
        };
        await window.firebase.firestore.setDoc(boardRef, {
          code,
          title: boardTitle,
          ownerId: this.currentUser.uid,
          createdAt: window.firebase.serverTimestamp(),
          updatedAt: window.firebase.serverTimestamp(),
          participantIds: [this.currentUser.uid],
          members: { [this.currentUser.uid]: memberEntry }
        });
        this.currentBoard = code;
        this.boards.unshift({ code, title: boardTitle, updatedAt: null, memberCount: 1, ownerId: this.currentUser.uid });
        this.renderBoards();
        await this.selectBoard(code);
        showToast('Whiteboard created');
      }catch(err){
        console.error('Create board failed', err);
        showToast('Could not create whiteboard. Try again.');
      }finally{
        if(btn) btn.disabled = false;
      }
    },

    joinBoard: async function(){
      if(!this.currentUser){ showToast('Please sign in to join a whiteboard.'); if(window.requestSignIn) window.requestSignIn(); return; }
      if(!isFirebaseReady()){ showToast('Firebase is not configured.'); return; }
      if(!this.dom.joinInput) return;
      const raw = this.dom.joinInput.value || '';
      const code = cleanCode(raw);
      if(code.length !== CODE_LENGTH){ showToast('Enter a valid 6-character code.'); return; }
      const fs = this.firestore || window.firebase.getFirestore(window.firebase._app);
      const boardRef = window.firebase.firestore.doc(fs, 'whiteboards', code);
      try{
        const snap = await window.firebase.firestore.getDoc(boardRef);
        if(!snap.exists()){
          showToast('No whiteboard found for that code.');
          return;
        }
        const data = snap.data() || {};
        const updates = {
          updatedAt: window.firebase.serverTimestamp(),
          participantIds: window.firebase.arrayUnion(this.currentUser.uid),
        };
        const memberPath = `members.${this.currentUser.uid}`;
        updates[memberPath] = {
          displayName: safeDisplayName(this.currentUser),
          role: data.ownerId === this.currentUser.uid ? 'admin' : 'member',
          color: colorForUid(this.currentUser.uid),
          photoURL: this.currentUser.photoURL || null,
          joinedAt: window.firebase.serverTimestamp(),
          lastActiveAt: window.firebase.serverTimestamp()
        };
        await window.firebase.firestore.updateDoc(boardRef, updates);
        this.dom.joinInput.value = '';
        this.currentBoard = code;
        const existing = this.boards.find(b=> b.code === code);
        if(!existing){
          this.boards.unshift({ code, title: data.title || 'Untitled board', updatedAt: data.updatedAt || null, memberCount: data.participantIds ? data.participantIds.length + 1 : 1, ownerId: data.ownerId });
          this.renderBoards();
        }
        await this.selectBoard(code);
        showToast('Joined whiteboard');
      }catch(err){
        console.error('Join board failed', err);
        showToast('Could not join whiteboard.');
      }
    },

    selectBoard: async function(code){
      if(!code || code === this.currentBoard) return;
      if(!isFirebaseReady() || !this.currentUser){
        showToast('Firebase not ready.');
        return;
      }
      this.currentBoard = code;
      this.boardData = null;
      this.isAdmin = false;
      this.detachBoardListeners();
      this.toggleBoardActions();
      this.highlightBoard(code);

      const fs = this.firestore || window.firebase.getFirestore(window.firebase._app);
      this.firestore = fs;
      const boardRef = window.firebase.firestore.doc(fs, 'whiteboards', code);
      this.boardRef = boardRef;
      this.setOverlayVisible(true, 'Loading whiteboard...');
      try{
        const snap = await window.firebase.firestore.getDoc(boardRef);
        if(!snap.exists()){
          showToast('Whiteboard not found.');
          this.currentBoard = null;
          this.toggleBoardActions();
          return;
        }
        this.applyBoardSnapshot(snap);
      }catch(err){
        console.error('Failed to open board', err);
        showToast('Unable to open whiteboard.');
        return;
      }

      this.unsubBoard = window.firebase.firestore.onSnapshot(boardRef, (snap)=> this.applyBoardSnapshot(snap), (err)=>{
        console.warn('Board listener error', err);
        showToast('Connection issue on whiteboard.');
      });
      const strokesRef = window.firebase.firestore.collection(boardRef, 'strokes');
      this.unsubStrokes = window.firebase.firestore.onSnapshot(window.firebase.firestore.query(strokesRef, window.firebase.firestore.orderBy('createdAt', 'asc')), (snap)=> this.applyStrokesSnapshot(snap), (err)=>{
        console.warn('Stroke listener error', err);
      });
      const presenceRef = window.firebase.firestore.collection(boardRef, 'presence');
      this.unsubPresence = window.firebase.firestore.onSnapshot(presenceRef, (snap)=> this.applyPresenceSnapshot(snap), noop);
      this.presenceDocRef = window.firebase.firestore.doc(boardRef, 'presence', this.currentUser.uid);
      this.sendPresence(null);
      this.toggleBoardActions();
    },

    highlightBoard(code){
      if(!this.dom.list) return;
      this.dom.list.querySelectorAll('[data-board-code]').forEach(el=>{
        const selected = el.getAttribute('data-board-code') === code;
        el.classList.toggle('active', selected);
        el.setAttribute('aria-selected', selected ? 'true' : 'false');
      });
    },

    applyBoardSnapshot(snap){
      if(!snap.exists()){
        showToast('Whiteboard removed by owner.');
        const removedCode = this.currentBoard;
        this.currentBoard = null;
        this.boardData = null;
        this.isAdmin = false;
        this.toggleBoardActions();
        this.detachBoardListeners();
        this.boards = this.boards.filter(b=> b.code !== removedCode);
        this.renderBoards();
        return;
      }
      const data = snap.data() || {};
      this.boardData = Object.assign({ code: snap.id }, data);
      const members = data.members || {};
      const participantIds = Array.isArray(data.participantIds) ? data.participantIds : Object.keys(members);
      if(!participantIds.includes(this.currentUser.uid)){
        showToast('You no longer have access to this whiteboard.');
        this.currentBoard = null;
        this.boardData = null;
        this.isAdmin = false;
        this.toggleBoardActions();
        this.detachBoardListeners();
        this.loadBoards(true);
        return;
      }
      this.isAdmin = data.ownerId === this.currentUser.uid || (members[this.currentUser.uid] && members[this.currentUser.uid].role === 'admin');
      this.memberColor = (members[this.currentUser.uid] && members[this.currentUser.uid].color) || colorForUid(this.currentUser.uid);
      if(this.dom.title) this.dom.title.textContent = data.title || 'Untitled whiteboard';
      if(this.dom.meta){
        const ownerName = members[data.ownerId] ? members[data.ownerId].displayName : 'Owner';
        const rel = formatRelative(data.updatedAt || data.createdAt);
        this.dom.meta.textContent = `${participantIds.length} member${participantIds.length === 1 ? '' : 's'} - Owner: ${ownerName}${rel ? ` - ${rel}` : ''}`;
      }
      if(this.dom.code) this.dom.code.textContent = `Share code: ${snap.id}`;
      this.renderParticipants(members);
      this.toggleBoardActions();
      this.setOverlayVisible(false);
      lucideRefresh(this.dom.page);
    },

    renderParticipants(members){
      if(!this.dom.participants) return;
      this.dom.participants.innerHTML = '';
      const entries = Object.entries(members || {}).map(([uid, info])=>({ uid, info: info || {} }));
      entries.sort((a,b)=>{
        const roleOrder = { admin: 0, member: 1 };
        const aRole = roleOrder[a.info.role] ?? 1;
        const bRole = roleOrder[b.info.role] ?? 1;
        if(aRole !== bRole) return aRole - bRole;
        return (a.info.displayName || '').localeCompare(b.info.displayName || '');
      });
      entries.forEach(({ uid, info })=>{
        const item = document.createElement('div');
        item.className = 'whiteboard-participant';
        if(uid === this.currentUser.uid) item.classList.add('self');
        if(info.role === 'admin') item.classList.add('admin');
        const name = document.createElement('span');
        name.textContent = info.displayName || 'Member';
        item.appendChild(name);
        const role = document.createElement('small');
        role.textContent = info.role === 'admin' ? 'Owner' : 'Collaborator';
        item.appendChild(role);
        if(this.isAdmin && uid !== this.currentUser.uid){
          const removeBtn = document.createElement('button');
          removeBtn.type = 'button';
          removeBtn.className = 'remove';
          removeBtn.textContent = '×';
          removeBtn.title = `Remove ${info.displayName || 'member'}`;
          removeBtn.addEventListener('click', (evt)=>{
            evt.stopPropagation();
            this.removeMember(uid, info.displayName);
          });
          item.appendChild(removeBtn);
        }
        this.dom.participants.appendChild(item);
      });
    },

    applyStrokesSnapshot(snap){
      const strokes = [];
      snap.forEach(docSnap=>{
        const data = docSnap.data() || {};
        if(!Array.isArray(data.points)) return;
        strokes.push({
          id: docSnap.id,
          tool: data.tool || 'pen',
          color: data.color || '#2e2e2e',
          size: data.size || 6,
          points: data.points.map(p=>({ x: Number(p.x || 0), y: Number(p.y || 0) }))
        });
      });
      this.strokes = strokes;
      this.redrawAllStrokes();
    },

    applyPresenceSnapshot(snap){
      const now = Date.now();
      const seen = new Set();
      snap.forEach(docSnap=>{
        const data = docSnap.data() || {};
        const uid = docSnap.id;
        seen.add(uid);
        const updated = data.updatedAt || 0;
        if(!data || data.uid !== uid) return;
        if(now - updated > CURSOR_TIMEOUT || data.x == null || data.y == null){
          this.removeCursor(uid);
          return;
        }
        this.upsertCursor(uid, data);
      });
      Array.from(this.cursors.keys()).forEach(uid=>{
        if(!seen.has(uid)) this.removeCursor(uid);
      });
    },

    upsertCursor(uid, data){
      if(!this.dom.cursors) return;
      let el = this.cursors.get(uid);
      if(!el){
        el = document.createElement('div');
        el.className = 'whiteboard-cursor';
        const label = document.createElement('div');
        label.className = 'label';
        const dot = document.createElement('div');
        dot.className = 'dot';
        el.appendChild(label);
        el.appendChild(dot);
        this.dom.cursors.appendChild(el);
        this.cursors.set(uid, el);
      }
      const label = el.querySelector('.label');
      const dot = el.querySelector('.dot');
      if(label) label.textContent = data.displayName || 'User';
      const color = data.color || colorForUid(uid);
      if(dot){
        dot.style.background = color;
        dot.style.borderColor = color;
      }
      el.style.left = `${data.x * 100}%`;
      el.style.top = `${data.y * 100}%`;
      el.style.opacity = uid === this.currentUser.uid ? 0.45 : 1;
    },

    removeCursor(uid){
      const el = this.cursors.get(uid);
      if(el){ el.remove(); this.cursors.delete(uid); }
    },

    detachBoardListeners(){
      if(typeof this.unsubBoard === 'function'){ this.unsubBoard(); }
      if(typeof this.unsubStrokes === 'function'){ this.unsubStrokes(); }
      if(typeof this.unsubPresence === 'function'){ this.unsubPresence(); }
      this.unsubBoard = this.unsubStrokes = this.unsubPresence = null;
      this.clearPresence();
    },

    pushStrokeToServer(stroke){
      if(!this.boardRef || !isFirebaseReady()) return;
      const payload = {
        userId: this.currentUser ? this.currentUser.uid : null,
        tool: stroke.tool,
        color: stroke.tool === 'eraser' ? '#000000' : stroke.color,
        size: stroke.size,
        points: stroke.points.map(p=>({ x: Number(p.x.toFixed(4)), y: Number(p.y.toFixed(4)) })),
        createdAt: window.firebase.serverTimestamp()
      };
      const strokesRef = window.firebase.firestore.collection(this.boardRef, 'strokes');
      window.firebase.firestore.addDoc(strokesRef, payload).catch(err=>{
        console.warn('Failed to save stroke', err);
      });
      window.firebase.firestore.updateDoc(this.boardRef, { updatedAt: window.firebase.serverTimestamp(), lastStrokeAt: window.firebase.serverTimestamp() }).catch(noop);
    },

    copyShareCode(){
      if(!this.currentBoard){ showToast('Select a whiteboard first.'); return; }
      const text = this.currentBoard;
      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(text).then(()=> showToast('Share code copied')).catch(()=>{
          this.fallbackCopy(text);
        });
      } else {
        this.fallbackCopy(text);
      }
    },

    fallbackCopy(text){
      try{
        const temp = document.createElement('textarea');
        temp.value = text;
        temp.style.position = 'fixed';
        temp.style.left = '-9999px';
        document.body.appendChild(temp);
        temp.select();
        document.execCommand('copy');
        document.body.removeChild(temp);
        showToast('Share code copied');
      }catch(err){ showToast('Share code: ' + text); }
    },

    leaveBoard: async function(){
      if(!this.currentBoard || !this.boardRef) return;
      if(!this.currentUser){ return; }
      if(this.boardData && this.boardData.ownerId === this.currentUser.uid){
        showToast('Transfer ownership before leaving this whiteboard.');
        return;
      }
      try{
        await window.firebase.firestore.updateDoc(this.boardRef, {
          participantIds: window.firebase.arrayRemove(this.currentUser.uid),
          [`members.${this.currentUser.uid}`]: window.firebase.deleteField(),
          updatedAt: window.firebase.serverTimestamp()
        });
        await window.firebase.firestore.deleteDoc(window.firebase.firestore.doc(this.boardRef, 'presence', this.currentUser.uid)).catch(noop);
        showToast('Left whiteboard');
      }catch(err){
        console.warn('Leave board failed', err);
        showToast('Could not leave the whiteboard.');
        return;
      }
      this.currentBoard = null;
      this.boardData = null;
      this.isAdmin = false;
      this.detachBoardListeners();
      this.loadBoards(true);
      this.toggleBoardActions();
    },

    removeMember: async function(uid, name){
      if(!this.isAdmin || !this.boardRef || uid === this.currentUser.uid) return;
      if(!confirm(`Remove ${name || 'this member'} from the whiteboard?`)) return;
      try{
        await window.firebase.firestore.updateDoc(this.boardRef, {
          participantIds: window.firebase.arrayRemove(uid),
          [`members.${uid}`]: window.firebase.deleteField(),
          updatedAt: window.firebase.serverTimestamp()
        });
        await window.firebase.firestore.deleteDoc(window.firebase.firestore.doc(this.boardRef, 'presence', uid)).catch(noop);
        showToast('Member removed');
      }catch(err){
        console.warn('Remove member failed', err);
        showToast('Could not remove member.');
      }
    },

    clearBoard: async function(){
      if(!this.boardRef || !this.isAdmin){ showToast('Only the owner can clear the whiteboard.'); return; }
      if(!confirm('Clear the whiteboard for everyone? This cannot be undone.')) return;
      const strokesRef = window.firebase.firestore.collection(this.boardRef, 'strokes');
      try{
        const snap = await window.firebase.firestore.getDocs(strokesRef);
        if(snap.empty){ showToast('Whiteboard already empty.'); return; }
        let batch = window.firebase.writeBatch(this.firestore);
        let count = 0;
        for(const docSnap of snap.docs){
          batch.delete(docSnap.ref);
          count++;
          if(count % 400 === 0){ await batch.commit(); batch = window.firebase.writeBatch(this.firestore); }
        }
        await batch.commit();
        await window.firebase.firestore.updateDoc(this.boardRef, { updatedAt: window.firebase.serverTimestamp() });
        showToast('Whiteboard cleared');
      }catch(err){
        console.warn('Clear board failed', err);
        showToast('Could not clear whiteboard.');
      }
    }
  };

  window.Whiteboard = Whiteboard;

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', ()=> Whiteboard.init());
  } else {
    Whiteboard.init();
  }
})();
















