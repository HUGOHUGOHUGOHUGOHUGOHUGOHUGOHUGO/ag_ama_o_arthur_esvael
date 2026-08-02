// ---------- Elementos ----------
const lobby = document.getElementById('lobby');
const gameScreen = document.getElementById('gameScreen');
const nameInput = document.getElementById('nameInput');
const roomInput = document.getElementById('roomInput');
const createBtn = document.getElementById('createBtn');
const joinBtn = document.getElementById('joinBtn');
const leaveBtn = document.getElementById('leaveBtn');
const lobbyMsg = document.getElementById('lobbyMsg');
const lobbyStatus = document.getElementById('lobbyStatus');
const roomCodeEl = document.getElementById('roomCode');
const statusEl = document.getElementById('status');
const scoreboardEl = document.getElementById('scoreboard');
const waveEl = document.getElementById('wave');
const waveTimerEl = document.getElementById('waveTimer');
const playerCountEl = document.getElementById('playerCount');
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// ---------- Textura do chão (ruído procedural, sem imagens externas) ----------
function createFloorTexture() {
  const size = 140;
  const off = document.createElement('canvas');
  off.width = size; off.height = size;
  const octx = off.getContext('2d');
  octx.fillStyle = '#202430';
  octx.fillRect(0, 0, size, size);
  for (let i = 0; i < 160; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const r = Math.random() * 1.5 + 0.3;
    octx.beginPath();
    octx.arc(x, y, r, 0, Math.PI * 2);
    octx.fillStyle = `rgba(255,255,255,${(Math.random() * 0.05 + 0.015).toFixed(3)})`;
    octx.fill();
  }
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const r = Math.random() * 1.3 + 0.3;
    octx.beginPath();
    octx.arc(x, y, r, 0, Math.PI * 2);
    octx.fillStyle = `rgba(0,0,0,${(Math.random() * 0.14 + 0.05).toFixed(3)})`;
    octx.fill();
  }
  return ctx.createPattern(off, 'repeat');
}
const floorTexture = createFloorTexture();
const shopOverlay = document.getElementById('shopOverlay');
const shopOptionsEl = document.getElementById('shopOptions');
const shopTimerEl = document.getElementById('shopTimer');
const shopWaitingEl = document.getElementById('shopWaiting');
const joystick = document.getElementById('joystick');
const joystickKnob = document.getElementById('joystickKnob');
const classGrid = document.getElementById('classGrid');
const visPrivateBtn = document.getElementById('visPrivate');
const visPublicBtn = document.getElementById('visPublic');
const roomListEl = document.getElementById('roomList');
const roomListEmptyEl = document.getElementById('roomListEmpty');
const refreshBtn = document.getElementById('refreshBtn');
const chatToggleBtn = document.getElementById('chatToggleBtn');
const chatPanel = document.getElementById('chatPanel');
const chatMessagesEl = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const chatSendBtn = document.getElementById('chatSendBtn');
const avatarInput = document.getElementById('avatarInput');
const avatarPreview = document.getElementById('avatarPreview');
const avatarClearBtn = document.getElementById('avatarClearBtn');

roomInput.addEventListener('input', () => {
  roomInput.value = roomInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

// ---------- Classes ----------
const CLASSES = [
  { id: 'soldado', label: '🪖 Soldado', desc: 'Equilibrado, +10% dano' },
  { id: 'berserker', label: '🪓 Berserker', desc: 'Espada forte, menos vida' },
  { id: 'tanque', label: '🛡️ Tanque', desc: '+50% vida, mais lento' },
  { id: 'ninja', label: '🥷 Ninja', desc: 'Rápido e ágil, menos vida' },
  { id: 'atirador', label: '🎯 Atirador', desc: '+alcance e dano, menos vida' },
  { id: 'vampiro', label: '🧛 Vampiro', desc: 'Regenera vida, começa frágil' },
];
let selectedClass = 'soldado';

function renderClassGrid() {
  classGrid.innerHTML = '';
  for (const c of CLASSES) {
    const card = document.createElement('div');
    card.className = 'classCard' + (c.id === selectedClass ? ' selected' : '');
    card.innerHTML = `<div class="cname">${c.label}</div><div class="cdesc">${c.desc}</div>`;
    card.onclick = () => { selectedClass = c.id; renderClassGrid(); };
    classGrid.appendChild(card);
  }
}
renderClassGrid();

// ---------- Público / Privado ----------
let isPublic = false;
visPrivateBtn.onclick = () => { isPublic = false; visPrivateBtn.classList.add('selected'); visPublicBtn.classList.remove('selected'); };
visPublicBtn.onclick = () => { isPublic = true; visPublicBtn.classList.add('selected'); visPrivateBtn.classList.remove('selected'); };

// ---------- Foto do jogador (skin) ----------
let selectedAvatar = null; // dataURL já redimensionado, ou null

function resizeImageToDataUrl(file, maxSize, cb) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const off = document.createElement('canvas');
      off.width = w; off.height = h;
      off.getContext('2d').drawImage(img, 0, 0, w, h);
      cb(off.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => cb(null);
    img.src = e.target.result;
  };
  reader.onerror = () => cb(null);
  reader.readAsDataURL(file);
}

avatarInput.addEventListener('change', () => {
  const file = avatarInput.files && avatarInput.files[0];
  if (!file) return;
  resizeImageToDataUrl(file, 96, (dataUrl) => {
    if (!dataUrl) { lobbyMsg.textContent = 'Não consegui ler essa imagem, tenta outra.'; return; }
    selectedAvatar = dataUrl;
    avatarPreview.style.backgroundImage = `url(${dataUrl})`;
  });
});
avatarClearBtn.onclick = () => {
  selectedAvatar = null;
  avatarInput.value = '';
  avatarPreview.style.backgroundImage = '';
};

let myId = null;
let myRoom = null;
let joined = false;
let latestState = null;
let lastShopRenderKey = null;
let chosenThisShop = false;
let prevEnemyHp = new Map(); // id -> hp do frame anterior
let floatingTexts = []; // números de dano flutuantes
let roomListInterval = null;
const avatarImages = new Map(); // playerId -> HTMLImageElement carregado

// ---------- WebSocket ----------
const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
const ws = new WebSocket(proto + location.host);

ws.onopen = () => {
  lobbyStatus.textContent = 'Conectado. Crie uma sala ou entre em uma existente.';
  requestRoomList();
  roomListInterval = setInterval(requestRoomList, 5000);
};
ws.onclose = () => {
  lobbyStatus.textContent = 'Desconectado do servidor.';
  statusEl.textContent = 'Conexão perdida.';
  if (roomListInterval) clearInterval(roomListInterval);
};
ws.onerror = () => {
  lobbyStatus.textContent = 'Erro ao conectar no servidor.';
};

ws.onmessage = (evt) => {
  const msg = JSON.parse(evt.data);

  if (msg.type === 'joined') {
    myId = msg.id;
    myRoom = msg.room;
    joined = true;
    if (roomListInterval) { clearInterval(roomListInterval); roomListInterval = null; }
    roomCodeEl.textContent = myRoom;
    lobby.style.display = 'none';
    gameScreen.style.display = 'flex';
    statusEl.textContent = 'Na sala ' + myRoom + (msg.isPublic ? ' (pública)' : ' (privada)') + '.';
    chatMessagesEl.innerHTML = '';
    chatPanel.classList.add('open'); // chat visível por padrão
    avatarImages.clear();

  } else if (msg.type === 'left') {
    joined = false;
    myId = null;
    myRoom = null;
    latestState = null;
    lastShopRenderKey = null;
    chatPanel.classList.remove('open');
    gameScreen.style.display = 'none';
    lobby.style.display = 'flex';
    lobbyStatus.textContent = 'Você saiu da sala.';
    requestRoomList();
    if (!roomListInterval) roomListInterval = setInterval(requestRoomList, 5000);

  } else if (msg.type === 'error') {
    lobbyMsg.textContent = msg.message;

  } else if (msg.type === 'room_list') {
    renderRoomList(msg.rooms);

  } else if (msg.type === 'state') {
    const newHp = new Map();
    for (const e of msg.enemies) {
      newHp.set(e.id, e.hp);
      const prev = prevEnemyHp.get(e.id);
      if (prev !== undefined && prev - e.hp > 0.5) {
        floatingTexts.push({ x: e.x, y: e.y, text: '-' + Math.round(prev - e.hp), start: performance.now(), duration: 650 });
      }
    }
    prevEnemyHp = newHp;
    latestState = msg;
    updateShopUI();

  } else if (msg.type === 'chat_message') {
    addChatLine(msg.name, msg.color, msg.text, msg.system);

  } else if (msg.type === 'avatar') {
    const img = new Image();
    img.onload = () => { avatarImages.set(msg.playerId, img); };
    img.src = msg.avatar;
  }
};

function requestRoomList() {
  if (ws.readyState === 1 && !joined) {
    ws.send(JSON.stringify({ type: 'list_rooms' }));
  }
}
refreshBtn.onclick = requestRoomList;

function renderRoomList(rooms) {
  roomListEl.innerHTML = '';
  if (!rooms || rooms.length === 0) {
    roomListEmptyEl.style.display = 'block';
    return;
  }
  roomListEmptyEl.style.display = 'none';
  for (const r of rooms) {
    const row = document.createElement('div');
    row.className = 'roomRow';
    const phaseLabel = r.phase === 'shop' ? 'na loja' : ('onda ' + r.wave);
    row.innerHTML = `<div class="rInfo"><span class="rCode">${r.code}</span> · ${r.players} jogador(es) · ${phaseLabel}</div>`;
    const btn = document.createElement('button');
    btn.textContent = 'Entrar';
    btn.onclick = () => {
      lobbyMsg.textContent = '';
      ws.send(JSON.stringify({ type: 'join', room: r.code, name: nameInput.value.trim(), classId: selectedClass, avatar: selectedAvatar }));
    };
    row.appendChild(btn);
    roomListEl.appendChild(row);
  }
}

createBtn.onclick = () => {
  if (ws.readyState !== 1) return;
  lobbyMsg.textContent = '';
  ws.send(JSON.stringify({ type: 'create', name: nameInput.value.trim(), classId: selectedClass, isPublic, avatar: selectedAvatar }));
};

joinBtn.onclick = () => {
  if (ws.readyState !== 1) return;
  const code = roomInput.value.trim();
  if (code.length !== 4) {
    lobbyMsg.textContent = 'Digite o código de 4 caracteres da sala.';
    return;
  }
  lobbyMsg.textContent = '';
  ws.send(JSON.stringify({ type: 'join', room: code, name: nameInput.value.trim(), classId: selectedClass, avatar: selectedAvatar }));
};

leaveBtn.onclick = () => {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'leave' }));
  }
};

roomInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinBtn.click(); });
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') createBtn.click(); });

// ---------- Chat ----------
chatToggleBtn.onclick = () => chatPanel.classList.toggle('open');

function addChatLine(name, color, text, isSystem) {
  const line = document.createElement('div');
  line.className = 'chatLine' + (isSystem ? ' system' : '');
  if (!isSystem) {
    const nameSpan = document.createElement('span');
    nameSpan.className = 'chatName';
    nameSpan.style.color = color || '#ccc';
    nameSpan.textContent = name + ':';
    line.appendChild(nameSpan);
    line.appendChild(document.createTextNode(' ' + text));
  } else {
    line.textContent = text;
  }
  chatMessagesEl.appendChild(line);
  while (chatMessagesEl.children.length > 100) {
    chatMessagesEl.removeChild(chatMessagesEl.firstChild);
  }
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

function sendChat() {
  const text = chatInput.value.trim();
  if (!text || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: 'chat', text }));
  chatInput.value = '';
}
chatSendBtn.onclick = sendChat;
chatInput.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') { e.preventDefault(); sendChat(); }
});

// ---------- Input: teclado ----------
const keys = { up: false, down: false, left: false, right: false };
const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
};
function isTypingTarget() {
  const el = document.activeElement;
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
}
window.addEventListener('keydown', (e) => {
  if (isTypingTarget()) return;
  const k = KEYMAP[e.code];
  if (k) keys[k] = true;
});
window.addEventListener('keyup', (e) => {
  const k = KEYMAP[e.code];
  if (k) keys[k] = false;
});

// ---------- Input: joystick virtual (touch/mouse) ----------
let joyActive = false;
let joyPointerId = null;
const JOY_MAX = 45;
const JOY_DEADZONE = 0.25;

function setJoyFromDelta(dx, dy) {
  const dist = Math.hypot(dx, dy);
  const clamped = Math.min(dist, JOY_MAX);
  const angle = Math.atan2(dy, dx);
  const kx = Math.cos(angle) * clamped;
  const ky = Math.sin(angle) * clamped;
  joystickKnob.style.transform = `translate(${kx}px, ${ky}px)`;

  const nx = dist > 0 ? (Math.cos(angle) * clamped) / JOY_MAX : 0;
  const ny = dist > 0 ? (Math.sin(angle) * clamped) / JOY_MAX : 0;
  keys.left = nx < -JOY_DEADZONE;
  keys.right = nx > JOY_DEADZONE;
  keys.up = ny < -JOY_DEADZONE;
  keys.down = ny > JOY_DEADZONE;
}
function resetJoy() {
  joystickKnob.style.transform = 'translate(0px, 0px)';
  keys.up = keys.down = keys.left = keys.right = false;
}
joystick.addEventListener('pointerdown', (e) => {
  joyActive = true;
  joyPointerId = e.pointerId;
  joystick.setPointerCapture(e.pointerId);
  const rect = joystick.getBoundingClientRect();
  setJoyFromDelta(e.clientX - (rect.left + rect.width / 2), e.clientY - (rect.top + rect.height / 2));
});
joystick.addEventListener('pointermove', (e) => {
  if (!joyActive || e.pointerId !== joyPointerId) return;
  const rect = joystick.getBoundingClientRect();
  setJoyFromDelta(e.clientX - (rect.left + rect.width / 2), e.clientY - (rect.top + rect.height / 2));
});
function endJoy(e) {
  if (e.pointerId !== joyPointerId) return;
  joyActive = false;
  joyPointerId = null;
  resetJoy();
}
joystick.addEventListener('pointerup', endJoy);
joystick.addEventListener('pointercancel', endJoy);

setInterval(() => {
  if (joined && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'input', ...keys }));
  }
}, 50);

// ---------- Loja entre rodadas ----------
function updateShopUI() {
  if (!latestState) return;

  if (latestState.phase !== 'shop') {
    shopOverlay.classList.remove('active');
    lastShopRenderKey = null;
    chosenThisShop = false;
    return;
  }

  shopOverlay.classList.add('active');
  shopTimerEl.textContent = Math.ceil(latestState.shopTimeLeft / 1000);

  const myOptions = (latestState.shopOptions && latestState.shopOptions[myId]) || [];
  const iChose = (latestState.shopChosen || []).includes(myId);
  const renderKey = myOptions.map((o) => o.id).join(',') + '|' + iChose;
  if (renderKey === lastShopRenderKey) return;
  lastShopRenderKey = renderKey;

  shopOptionsEl.innerHTML = '';
  if (iChose) {
    shopWaitingEl.textContent = 'Upgrade escolhido! Esperando o resto da galera...';
    return;
  }
  shopWaitingEl.textContent = '';

  for (const opt of myOptions) {
    const card = document.createElement('div');
    card.className = 'shopCard';
    card.innerHTML = `<div class="label">${opt.label}</div><div class="desc">${opt.desc}</div>`;
    card.onclick = () => {
      if (chosenThisShop) return;
      chosenThisShop = true;
      ws.send(JSON.stringify({ type: 'choose_upgrade', upgradeId: opt.id }));
    };
    shopOptionsEl.appendChild(card);
  }
}

// ---------- Render ----------
function drawPlayer(p) {
  ctx.save();
  ctx.globalAlpha = p.alive ? 1 : 0.25;

  const img = avatarImages.get(p.id);
  if (img) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
    ctx.save();
    ctx.clip();
    ctx.drawImage(img, p.x - 14, p.y - 14, 28, 28);
    ctx.restore();
  } else {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();

    // textura de relevo: brilho no canto superior-esquerdo, sombra embaixo
    const bevel = ctx.createRadialGradient(p.x - 5, p.y - 6, 1, p.x, p.y, 15);
    bevel.addColorStop(0, 'rgba(255,255,255,0.55)');
    bevel.addColorStop(0.5, 'rgba(255,255,255,0)');
    bevel.addColorStop(1, 'rgba(0,0,0,0.28)');
    ctx.beginPath();
    ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
    ctx.fillStyle = bevel;
    ctx.fill();
  }

  // anel com a cor do jogador — identifica quem é quem mesmo com foto
  ctx.beginPath();
  ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
  ctx.lineWidth = p.id === myId ? 3 : 2;
  ctx.strokeStyle = p.id === myId ? '#fff' : p.color;
  ctx.stroke();

  const barW = 32;
  ctx.fillStyle = '#0008';
  ctx.fillRect(p.x - barW / 2, p.y - 26, barW, 5);
  ctx.fillStyle = '#5dff7d';
  ctx.fillRect(p.x - barW / 2, p.y - 26, barW * Math.max(0, p.hp / p.maxHp), 5);

  ctx.fillStyle = '#fff';
  ctx.font = '11px Arial';
  ctx.textAlign = 'center';
  const label = (p.id === myId ? 'você' : p.name) + ' · ' + (p.kills || 0) + '☠';
  ctx.fillText(label, p.x, p.y - 30);
  if (!p.alive) {
    ctx.fillStyle = '#ff5d5d';
    ctx.fillText('revivendo...', p.x, p.y + 28);
  }
  ctx.restore();
}

const ENEMY_COLORS = {
  normal: '#ff5d5d',
  fast: '#ff9d5d',
  swarm: '#8dff5d',
  tank: '#7a5dff',
  boss: '#ff2fd0',
};
const ENEMY_RIM = {
  normal: '#7a1010', fast: '#7a1010', swarm: '#2f6b12', tank: '#2f1a7a', boss: '#6b0f5c',
};

function drawEnemy(e) {
  ctx.save();
  const r = e.radius || 12;
  const baseColor = ENEMY_COLORS[e.typeId] || '#ff5d5d';
  const rim = ENEMY_RIM[e.typeId] || '#7a1010';

  if (e.typeId === 'fast') {
    ctx.strokeStyle = 'rgba(255,157,93,0.45)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const off = 6 + i * 5;
      ctx.beginPath();
      ctx.moveTo(e.x - off, e.y - r / 2 + i * 3);
      ctx.lineTo(e.x - off - 6, e.y - r / 2 + i * 3);
      ctx.stroke();
    }
  } else if (e.typeId === 'normal' || e.typeId === 'tank' || e.typeId === 'boss') {
    const spikes = e.typeId === 'boss' ? 12 : (e.typeId === 'tank' ? 10 : 8);
    const spikeLen = e.typeId === 'boss' ? 9 : 5;
    ctx.fillStyle = rim;
    for (let i = 0; i < spikes; i++) {
      const ang = (i / spikes) * Math.PI * 2;
      const bx = e.x + Math.cos(ang) * r * 0.85, by = e.y + Math.sin(ang) * r * 0.85;
      const tx = e.x + Math.cos(ang) * (r + spikeLen), ty = e.y + Math.sin(ang) * (r + spikeLen);
      const perp = ang + Math.PI / 2;
      const w = e.typeId === 'boss' ? 3 : 2.2;
      ctx.beginPath();
      ctx.moveTo(bx + Math.cos(perp) * w, by + Math.sin(perp) * w);
      ctx.lineTo(tx, ty);
      ctx.lineTo(bx - Math.cos(perp) * w, by - Math.sin(perp) * w);
      ctx.closePath();
      ctx.fill();
    }
  }

  if (e.typeId === 'boss') {
    // brilho pulsante ao redor do chefe
    const pulse = 4 + Math.sin(performance.now() / 220) * 3;
    const glow = ctx.createRadialGradient(e.x, e.y, r, e.x, e.y, r + 14 + pulse);
    glow.addColorStop(0, 'rgba(255,47,208,0.35)');
    glow.addColorStop(1, 'rgba(255,47,208,0)');
    ctx.beginPath();
    ctx.arc(e.x, e.y, r + 14 + pulse, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();
  }

  ctx.beginPath();
  ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
  ctx.fillStyle = baseColor;
  ctx.fill();
  ctx.strokeStyle = rim;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const bevel = ctx.createRadialGradient(e.x - 3, e.y - 4, 1, e.x, e.y, r + 2);
  bevel.addColorStop(0, 'rgba(255,255,255,0.35)');
  bevel.addColorStop(0.55, 'rgba(255,255,255,0)');
  bevel.addColorStop(1, 'rgba(0,0,0,0.32)');
  ctx.beginPath();
  ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
  ctx.fillStyle = bevel;
  ctx.fill();

  if (e.typeId === 'boss') {
    ctx.fillStyle = '#ff2fd0';
    ctx.font = 'bold 11px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('☠ CHEFE ☠', e.x, e.y - r - 16);
  }

  const barW = Math.max(26, r * 2.1);
  ctx.fillStyle = '#0008';
  ctx.fillRect(e.x - barW / 2, e.y - r - 8, barW, 4);
  ctx.fillStyle = '#ffd75d';
  ctx.fillRect(e.x - barW / 2, e.y - r - 8, barW * Math.max(0, e.hp / e.maxHp), 4);
  ctx.restore();
}

function drawBullet(b) {
  const glow = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, 7);
  glow.addColorStop(0, 'rgba(255,247,214,0.9)');
  glow.addColorStop(0.45, 'rgba(255,233,141,0.6)');
  glow.addColorStop(1, 'rgba(255,233,141,0)');
  ctx.beginPath();
  ctx.arc(b.x, b.y, 7, 0, Math.PI * 2);
  ctx.fillStyle = glow;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(b.x, b.y, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = '#fff7d6';
  ctx.fill();
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (floorTexture) {
    ctx.fillStyle = floorTexture;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  ctx.strokeStyle = '#2a2f3d';
  ctx.lineWidth = 1;
  for (let x = 0; x < canvas.width; x += 40) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  for (let y = 0; y < canvas.height; y += 40) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }

  if (joined && latestState) {
    for (const b of latestState.bullets) drawBullet(b);
    for (const e of latestState.enemies) drawEnemy(e);
    for (const p of latestState.players) drawPlayer(p);

    waveEl.textContent = latestState.wave;
    playerCountEl.textContent = latestState.players.length;
    waveTimerEl.textContent = latestState.phase === 'shop'
      ? 'loja'
      : Math.ceil(latestState.waveTimeLeft / 1000);

    const sorted = [...latestState.players].sort((a, b) => (b.kills || 0) - (a.kills || 0));
    scoreboardEl.innerHTML = sorted.map((p) => {
      const label = (p.id === myId ? 'você' : p.name);
      return `<div class="scoreItem">${label}: <b>${p.kills || 0}</b> ☠</div>`;
    }).join('');
  }

  // números de dano flutuantes
  const now = performance.now();
  floatingTexts = floatingTexts.filter((f) => now - f.start < f.duration);
  for (const f of floatingTexts) {
    const t = (now - f.start) / f.duration;
    ctx.save();
    ctx.globalAlpha = 1 - t;
    ctx.fillStyle = '#fff7d6';
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(f.text, f.x, f.y - 20 - t * 22);
    ctx.restore();
  }

  // vinheta sutil nas bordas — dá profundidade sem escurecer o centro
  const vignette = ctx.createRadialGradient(
    canvas.width / 2, canvas.height / 2, canvas.height * 0.35,
    canvas.width / 2, canvas.height / 2, canvas.height * 0.85
  );
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  requestAnimationFrame(render);
}
requestAnimationFrame(render);
