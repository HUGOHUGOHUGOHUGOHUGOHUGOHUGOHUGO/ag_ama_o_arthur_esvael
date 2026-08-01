const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ---------- Config ----------
const ARENA_W = 900;
const ARENA_H = 600;
const TICK_MS = 50; // 20 ticks/s
const PLAYER_SPEED = 3.2;
const PLAYER_RADIUS = 14;
const PLAYER_MAX_HP = 100;
const RESPAWN_MS = 3000;

const ENEMY_RADIUS = 12;
const ENEMY_SPEED = 1.1;
const ENEMY_CONTACT_DMG = 8;
const ENEMY_CONTACT_COOLDOWN = 600;

const WAVE_INTERVAL_MS = 15000;

const PISTOL_COOLDOWN = 450;
const PISTOL_DMG = 8;
const PISTOL_RANGE = 420;
const BULLET_SPEED = 7;
const BULLET_RADIUS = 4;

const MELEE_COOLDOWN = 900;
const MELEE_DMG = 16;
const MELEE_RADIUS = 55;

const COLORS = ['#ff5d5d', '#5dd8ff', '#8dff5d', '#ffd75d', '#c07dff', '#ff9d5d'];
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O/1/I pra evitar confusão

// ---------- Rooms ----------
// rooms[code] = { players, enemies, bullets, wave, waveTimer, enemyIdCounter, bulletIdCounter, colorIdx }
const rooms = {};

function generateRoomCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)]).join('');
  } while (rooms[code]);
  return code;
}

function createRoom() {
  return {
    players: {},
    enemies: [],
    bullets: [],
    wave: 0,
    waveTimer: 0,
    enemyIdCounter: 0,
    bulletIdCounter: 0,
    colorIdx: 0,
  };
}

function randEdgePosition() {
  const side = Math.floor(Math.random() * 4);
  if (side === 0) return { x: Math.random() * ARENA_W, y: -20 };
  if (side === 1) return { x: Math.random() * ARENA_W, y: ARENA_H + 20 };
  if (side === 2) return { x: -20, y: Math.random() * ARENA_H };
  return { x: ARENA_W + 20, y: Math.random() * ARENA_H };
}

function spawnWave(room) {
  room.wave += 1;
  const count = 3 + room.wave * 2;
  const hp = 20 + room.wave * 6;
  for (let i = 0; i < count; i++) {
    const pos = randEdgePosition();
    room.enemyIdCounter += 1;
    room.enemies.push({ id: room.enemyIdCounter, x: pos.x, y: pos.y, hp, maxHp: hp, lastContact: 0 });
  }
  room.waveTimer = WAVE_INTERVAL_MS;
}

function nearestEnemy(room, x, y, maxRange) {
  let best = null, bestDist = Infinity;
  for (const e of room.enemies) {
    const d = Math.hypot(e.x - x, e.y - y);
    if (d < bestDist && (!maxRange || d <= maxRange)) { bestDist = d; best = e; }
  }
  return best;
}

function alivePlayers(room) {
  return Object.values(room.players).filter((p) => p.alive);
}

function nearestPlayer(room, x, y) {
  let best = null, bestDist = Infinity;
  for (const p of alivePlayers(room)) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestDist) { bestDist = d; best = p; }
  }
  return best;
}

function tickRoom(room, code) {
  const now = Date.now();

  room.waveTimer -= TICK_MS;
  if (room.waveTimer <= 0) spawnWave(room);

  for (const p of Object.values(room.players)) {
    if (!p.alive) {
      if (now >= p.respawnAt) {
        p.alive = true;
        p.hp = PLAYER_MAX_HP;
        p.x = ARENA_W / 2 + (Math.random() - 0.5) * 100;
        p.y = ARENA_H / 2 + (Math.random() - 0.5) * 100;
      }
      continue;
    }

    let dx = 0, dy = 0;
    if (p.input.up) dy -= 1;
    if (p.input.down) dy += 1;
    if (p.input.left) dx -= 1;
    if (p.input.right) dx += 1;
    if (dx !== 0 || dy !== 0) {
      const len = Math.hypot(dx, dy);
      p.x += (dx / len) * PLAYER_SPEED;
      p.y += (dy / len) * PLAYER_SPEED;
      p.x = Math.max(PLAYER_RADIUS, Math.min(ARENA_W - PLAYER_RADIUS, p.x));
      p.y = Math.max(PLAYER_RADIUS, Math.min(ARENA_H - PLAYER_RADIUS, p.y));
    }

    if (now - p.lastShot >= PISTOL_COOLDOWN) {
      const target = nearestEnemy(room, p.x, p.y, PISTOL_RANGE);
      if (target) {
        const ang = Math.atan2(target.y - p.y, target.x - p.x);
        room.bulletIdCounter += 1;
        room.bullets.push({
          id: room.bulletIdCounter, x: p.x, y: p.y,
          vx: Math.cos(ang) * BULLET_SPEED, vy: Math.sin(ang) * BULLET_SPEED, owner: p.id,
        });
        p.lastShot = now;
      }
    }

    if (now - p.lastMelee >= MELEE_COOLDOWN) {
      let hit = false;
      for (const e of room.enemies) {
        if (Math.hypot(e.x - p.x, e.y - p.y) <= MELEE_RADIUS) { e.hp -= MELEE_DMG; hit = true; }
      }
      if (hit) p.lastMelee = now;
    }
  }

  room.bullets = room.bullets.filter((b) => {
    b.x += b.vx; b.y += b.vy;
    if (b.x < 0 || b.x > ARENA_W || b.y < 0 || b.y > ARENA_H) return false;
    for (const e of room.enemies) {
      if (Math.hypot(e.x - b.x, e.y - b.y) <= ENEMY_RADIUS + BULLET_RADIUS) {
        e.hp -= PISTOL_DMG;
        return false;
      }
    }
    return true;
  });

  for (const e of room.enemies) {
    const target = nearestPlayer(room, e.x, e.y);
    if (target) {
      const ang = Math.atan2(target.y - e.y, target.x - e.x);
      e.x += Math.cos(ang) * ENEMY_SPEED;
      e.y += Math.sin(ang) * ENEMY_SPEED;
      const d = Math.hypot(target.x - e.x, target.y - e.y);
      if (d <= PLAYER_RADIUS + ENEMY_RADIUS && now - e.lastContact >= ENEMY_CONTACT_COOLDOWN) {
        target.hp -= ENEMY_CONTACT_DMG;
        e.lastContact = now;
        if (target.hp <= 0) { target.alive = false; target.respawnAt = now + RESPAWN_MS; }
      }
    }
  }

  room.enemies = room.enemies.filter((e) => e.hp > 0);

  broadcastRoom(room, code);
}

function broadcastRoom(room, code) {
  const state = {
    type: 'state',
    room: code,
    wave: room.wave,
    waveTimeLeft: Math.max(0, room.waveTimer),
    arena: { w: ARENA_W, h: ARENA_H },
    players: Object.values(room.players).map((p) => ({
      id: p.id, x: p.x, y: p.y, hp: p.hp, maxHp: PLAYER_MAX_HP,
      color: p.color, name: p.name, alive: p.alive,
    })),
    enemies: room.enemies.map((e) => ({ id: e.id, x: e.x, y: e.y, hp: e.hp, maxHp: e.maxHp })),
    bullets: room.bullets.map((b) => ({ id: b.id, x: b.x, y: b.y })),
  };
  const msg = JSON.stringify(state);
  for (const client of wss.clients) {
    if (client.readyState === 1 && client.roomCode === code) client.send(msg);
  }
}

function addPlayerToRoom(ws, code, name) {
  const room = rooms[code];
  const id = 'p' + Math.random().toString(36).slice(2, 9);
  const color = COLORS[room.colorIdx % COLORS.length];
  room.colorIdx += 1;

  room.players[id] = {
    id,
    x: ARENA_W / 2 + (Math.random() - 0.5) * 100,
    y: ARENA_H / 2 + (Math.random() - 0.5) * 100,
    hp: PLAYER_MAX_HP,
    color,
    name: (name && name.slice(0, 16)) || 'Player-' + id.slice(1, 4),
    input: { up: false, down: false, left: false, right: false },
    lastShot: 0,
    lastMelee: 0,
    alive: true,
    respawnAt: 0,
  };

  ws.roomCode = code;
  ws.playerId = id;
  ws.send(JSON.stringify({ type: 'joined', id, color, room: code }));
}

wss.on('connection', (ws) => {
  ws.roomCode = null;
  ws.playerId = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'create') {
      const code = generateRoomCode();
      rooms[code] = createRoom();
      addPlayerToRoom(ws, code, msg.name);

    } else if (msg.type === 'join') {
      const code = (msg.room || '').toUpperCase().trim();
      if (!rooms[code]) {
        ws.send(JSON.stringify({ type: 'error', message: 'Sala não encontrada. Confira o código.' }));
        return;
      }
      addPlayerToRoom(ws, code, msg.name);

    } else if (msg.type === 'input') {
      if (ws.roomCode && rooms[ws.roomCode] && rooms[ws.roomCode].players[ws.playerId]) {
        rooms[ws.roomCode].players[ws.playerId].input = {
          up: !!msg.up, down: !!msg.down, left: !!msg.left, right: !!msg.right,
        };
      }
    }
  });

  ws.on('close', () => {
    if (ws.roomCode && rooms[ws.roomCode]) {
      delete rooms[ws.roomCode].players[ws.playerId];
      if (Object.keys(rooms[ws.roomCode].players).length === 0) {
        delete rooms[ws.roomCode]; // sala vazia é removida
      }
    }
  });
});

setInterval(() => {
  for (const code of Object.keys(rooms)) {
    tickRoom(rooms[code], code);
  }
}, TICK_MS);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
