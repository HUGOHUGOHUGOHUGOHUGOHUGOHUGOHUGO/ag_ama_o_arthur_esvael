// ---------- Elementos ----------
const lobby = document.getElementById('lobby');
const gameScreen = document.getElementById('gameScreen');
const nameInput = document.getElementById('nameInput');
const roomInput = document.getElementById('roomInput');
const createBtn = document.getElementById('createBtn');
const joinBtn = document.getElementById('joinBtn');
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

roomInput.addEventListener('input', () => {
  roomInput.value = roomInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

let myId = null;
let myRoom = null;
let joined = false;
let latestState = null;
let lastShopRenderKey = null;
let chosenThisShop = false;

// ---------- WebSocket ----------
const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
const ws = new WebSocket(proto + location.host);

ws.onopen = () => {
  lobbyStatus.textContent = 'Conectado. Crie uma sala ou entre em uma existente.';
};
ws.onclose = () => {
  lobbyStatus.textContent = 'Desconectado do servidor.';
  statusEl.textContent = 'Conexão perdida.';
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
    roomCodeEl.textContent = myRoom;
    lobby.style.display = 'none';
    gameScreen.style.display = 'flex';
    statusEl.textContent = 'Na sala ' + myRoom + '.';

  } else if (msg.type === 'error') {
    lobbyMsg.textContent = msg.message;

  } else if (msg.type === 'state') {
    latestState = msg;
    updateShopUI();
  }
};

createBtn.onclick = () => {
  if (ws.readyState !== 1) return;
  lobbyMsg.textContent = '';
  ws.send(JSON.stringify({ type: 'create', name: nameInput.value.trim() }));
};

joinBtn.onclick = () => {
  if (ws.readyState !== 1) return;
  const code = roomInput.value.trim();
  if (code.length !== 4) {
    lobbyMsg.textContent = 'Digite o código de 4 caracteres da sala.';
    return;
  }
  lobbyMsg.textContent = '';
  ws.send(JSON.stringify({ type: 'join', room: code, name: nameInput.value.trim() }));
};

roomInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinBtn.click(); });
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') createBtn.click(); });

// ---------- Input: teclado ----------
const keys = { up: false, down: false, left: false, right: false };
const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
};
window.addEventListener('keydown', (e) => {
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
const JOY_MAX = 40; // raio máximo que o manche se afasta do centro (px)
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
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  setJoyFromDelta(e.clientX - cx, e.clientY - cy);
});
joystick.addEventListener('pointermove', (e) => {
  if (!joyActive || e.pointerId !== joyPointerId) return;
  const rect = joystick.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  setJoyFromDelta(e.clientX - cx, e.clientY - cy);
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
  ctx.arc(e.x, e.y, 12, 0, Math.PI * 2);
  ctx.fillStyle = '#ff5d5d';
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
      ? 'na loja'
      : Math.ceil(latestState.waveTimeLeft / 1000);
  }

  requestAnimationFrame(render);
}
requestAnimationFrame(render);
