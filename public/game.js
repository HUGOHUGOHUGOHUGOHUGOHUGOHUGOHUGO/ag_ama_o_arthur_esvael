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

roomInput.addEventListener('input', () => {
  roomInput.value = roomInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

let myId = null;
let myRoom = null;
let joined = false;
let latestState = null;

// ---------- WebSocket ----------
const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
const ws = new WebSocket(proto + location.host);

ws.onopen = () => {
  lobbyStatus.textContent = 'Conectado. Crie uma sala ou entre em uma existente.';
  createBtn.disabled = false;
  joinBtn.disabled = false;
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

// ---------- Input do jogo ----------
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

setInterval(() => {
  if (joined && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'input', ...keys }));
  }
}, 50);

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
    waveTimerEl.textContent = Math.ceil(latestState.waveTimeLeft / 1000);
    playerCountEl.textContent = latestState.players.length;
  }

  requestAnimationFrame(render);
}
requestAnimationFrame(render);
