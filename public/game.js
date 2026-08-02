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
const waveEl = document.getElementById('wave');
const waveTimerEl = document.getElementById('waveTimer');
const playerCountEl = document.getElementById('playerCount');
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
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

roomInput.addEventListener('input', () => {
  roomInput.value = roomInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

// ---------- Classes ----------
const CLASSES = [
  { id: 'soldado', label: '🪖 Soldado', desc: 'Equilibrado, +10% dano' },
  { id: 'berserker', label: '🪓 Berserker', desc: 'Espada forte, menos vida' },
  { id: 'tanque', label: '🛡️ Tanque', desc: '+50% vida, mais lento' },
  { id: 'ninja', label: '🥷 Ninja', desc: 'Rápido e ágil, menos vida' },
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

let myId = null;
let myRoom = null;
let joined = false;
let latestState = null;
let lastShopRenderKey = null;
let chosenThisShop = false;
let roomListInterval = null;

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
    latestState = msg;
    updateShopUI();

  } else if (msg.type === 'chat_message') {
    addChatLine(msg.name, msg.color, msg.text, msg.system);
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
      ws.send(JSON.stringify({ type: 'join', room: r.code, name: nameInput.value.trim(), classId: selectedClass }));
    };
    row.appendChild(btn);
    roomListEl.appendChild(row);
  }
}

createBtn.onclick = () => {
  if (ws.readyState !== 1) return;
  lobbyMsg.textContent = '';
  ws.send(JSON.stringify({ type: 'create', name: nameInput.value.trim(), classId: selectedClass, isPublic }));
};

joinBtn.onclick = () => {
  if (ws.readyState !== 1) return;
  const code = roomInput.value.trim();
  if (code.length !== 4) {
    lobbyMsg.textContent = 'Digite o código de 4 caracteres da sala.';
    return;
  }
  lobbyMsg.textContent = '';
  ws.send(JSON.stringify({ type: 'join', room: code, name: nameInput.value.trim(), classId: selectedClass }));
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
  ctx.beginPath();
  ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
  ctx.fillStyle = p.color;
  ctx.fill();
  ctx.lineWidth = p.id === myId ? 3 : 1;
  ctx.strokeStyle = p.id === myId ? '#fff' : '#0008';
  ctx.stroke();

  const barW = 32;
  ctx.fillStyle = '#0008';
  ctx.fillRect(p.x - barW / 2, p.y - 26, barW, 5);
  ctx.fillStyle = '#5dff7d';
  ctx.fillRect(p.x - barW / 2, p.y - 26, barW * Math.max(0, p.hp / p.maxHp), 5);

  ctx.fillStyle = '#fff';
  ctx.font = '11px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(p.id === myId ? 'você' : p.name, p.x, p.y - 30);
  if (!p.alive) {
    ctx.fillStyle = '#ff5d5d';
    ctx.fillText('revivendo...', p.x, p.y + 28);
  }
  ctx.restore();
}

function drawEnemy(e) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(e.x, e.y, e.typeId === 'fast' ? 9 : 12, 0, Math.PI * 2);
  ctx.fillStyle = e.typeId === 'fast' ? '#ff9d5d' : '#ff5d5d';
  ctx.fill();
  ctx.strokeStyle = '#7a1010';
  ctx.stroke();

  const barW = 26;
  ctx.fillStyle = '#0008';
  ctx.fillRect(e.x - barW / 2, e.y - 20, barW, 4);
  ctx.fillStyle = '#ffd75d';
  ctx.fillRect(e.x - barW / 2, e.y - 20, barW * Math.max(0, e.hp / e.maxHp), 4);
  ctx.restore();
}

function drawBullet(b) {
  ctx.beginPath();
  ctx.arc(b.x, b.y, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#ffe98d';
  ctx.fill();
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
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
  }

  requestAnimationFrame(render);
}
requestAnimationFrame(render);
