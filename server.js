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
const SHOP_DURATION_MS = 12000;

const PISTOL_COOLDOWN = 450;
const PISTOL_DMG = 8;
const PISTOL_RANGE = 420;
const BULLET_SPEED = 7;
const BULLET_RADIUS = 4;

const MELEE_COOLDOWN = 900;
const MELEE_DMG = 16;
const MELEE_RADIUS = 55;

const COLORS = ['#ff5d5d', '#5dd8ff', '#8dff5d', '#ffd75d', '#c07dff', '#ff9d5d'];
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O/1/I

// ---------- Upgrades (loja entre rodadas) ----------
const UPGRADE_POOL = [
  { id: 'hp', label: '+20 Vida Máxima', desc: 'Aumenta o limite de vida e cura 20', apply: (p) => {
      p.stats.maxHpBonus += 20;
      p.maxHp = PLAYER_MAX_HP + p.stats.maxHpBonus;
      p.hp = Math.min(p.maxHp, p.hp + 20);
  }},
  { id: 'dmg', label: '+15% Dano', desc: 'Pistola e espada causam mais dano', apply: (p) => { p.stats.dmgMult *= 1.15; }},
  { id: 'atkspeed', label: '+15% Vel. de Ataque', desc: 'Ataca com mais frequência', apply: (p) => { p.stats.atkSpeedMult *= 1.15; }},
  { id: 'movespeed', label: '+10% Vel. de Movimento', desc: 'Anda mais rápido pela arena', apply: (p) => { p.stats.moveSpeedMult *= 1.10; }},
  { id: 'melee', label: '+20% Raio da Espada', desc: 'Área de dano corpo-a-corpo maior', apply: (p) => { p.stats.meleeRadiusMult *= 1.20; }},
  { id: 'range', label: '+15% Alcance da Pistola', desc: 'Mira inimigos mais distantes', apply: (p) => { p.stats.rangeMult *= 1.15; }},
];

function defaultStats() {
  return { dmgMult: 1, atkSpeedMult: 1, moveSpeedMult: 1, meleeRadiusMult: 1, rangeMult: 1, maxHpBonus: 0 };
}

function randomUpgrades(n) {
  const shuffled = [...UPGRADE_POOL].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n).map((u) => ({ id: u.id, label: u.label, desc: u.desc }));
}

function applyUpgrade(player, upgradeId) {
  const u = UPGRADE_POOL.find((x) => x.id === upgradeId);
  if (u) u.apply(player);
}

// ---------- Rooms ----------
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
    phase: 'wave', // 'wave' | 'shop'
    shopTimer: 0,
    shopOptions: {}, // playerId -> [{id,label,desc}]
    shopChosen: new Set(),
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

function startShopPhase(room) {
  room.phase = 'shop';
  room.shopTimer = SHOP_DURATION_MS;
  room.shopChosen = new Set();
  room.shopOptions = {};
  for (const pid of Object.keys(room.players)) {
    room.shopOptions[pid] = randomUpgrades(3);
  }
}

function endShopPhase(room) {
  room.phase = 'wave';
  room.shopOptions = {};
  room.shopChosen = new Set();
  spawnWave(room);
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

  // ---- fase de loja: tudo congela, só o timer/escolhas avançam ----
  if (room.phase === 'shop') {
    room.shopTimer -= TICK_MS;
    const ids = Object.keys(room.players);
    const allChosen = ids.length > 0 && ids.every((pid) => room.shopChosen.has(pid));
    if (room.shopTimer <= 0 || allChosen) {
      endShopPhase(room);
    }
    broadcastRoom(room, code);
    return;
  }

  // ---- fase de combate ----
  room.waveTimer -= TICK_MS;
  if (room.waveTimer <= 0) {
    if (room.wave === 0) {
      spawnWave(room);
    } else {
      startShopPhase(room);
      broadcastRoom(room, code);
      return;
    }
  }

  for (const p of Object.values(room.players)) {
    if (!p.alive) {
      if (now >= p.respawnAt) {
        p.alive = true;
        p.hp = p.maxHp;
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
      const speed = PLAYER_SPEED * p.stats.moveSpeedMult;
      p.x += (dx / len) * speed;
      p.y += (dy / len) * speed;
      p.x = Math.max(PLAYER_RADIUS, Math.min(ARENA_W - PLAYER_RADIUS, p.x));
      p.y = Math.max(PLAYER_RADIUS, Math.min(ARENA_H - PLAYER_RADIUS, p.y));
    }

    const pistolCooldown = PISTOL_COOLDOWN / p.stats.atkSpeedMult;
    if (now - p.lastShot >= pistolCooldown) {
      const range = PISTOL_RANGE * p.stats.rangeMult;
      const target = nearestEnemy(room, p.x, p.y, range);
      if (target) {
        const ang = Math.atan2(target.y - p.y, target.x - p.x);
        room.bulletIdCounter += 1;
        room.bullets.push({
          id: room.bulletIdCounter, x: p.x, y: p.y,
          vx: Math.cos(ang) * BULLET_SPEED, vy: Math.sin(ang) * BULLET_SPEED,
          dmg: PISTOL_DMG * p.stats.dmgMult, owner: p.id,
        });
        p.lastShot = now;
      }
    }

    const meleeCooldown = MELEE_COOLDOWN / p.stats.atkSpeedMult;
    if (now - p.lastMelee >= meleeCooldown) {
      const radius = MELEE_RADIUS * p.stats.meleeRadiusMult;
      const dmg = MELEE_DMG * p.stats.dmgMult;
      let hit = false;
      for (const e of room.enemies) {
        if (Math.hypot(e.x - p.x, e.y - p.y) <= radius) { e.hp -= dmg; hit = true; }
      }
      if (hit) p.lastMelee = now;
    }
  }

  room.bullets = room.bullets.filter((b) => {
    b.x += b.vx; b.y += b.vy;
    if (b.x < 0 || b.x > ARENA_W || b.y < 0 || b.y > ARENA_H) return false;
    for (const e of room.enemies) {
      if (Math.hypot(e.x - b.x, e.y - b.y) <= ENEMY_RADIUS + BULLET_RADIUS) {
        e.hp -= b.dmg;
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
    phase: room.phase,
    wave: room.wave,
    waveTimeLeft: Math.max(0, room.waveTimer),
    shopTimeLeft: room.phase === 'shop' ? Math.max(0, room.shopTimer) : 0,
    shopOptions: room.phase === 'shop' ? room.shopOptions : {},
    shopChosen: room.phase === 'shop' ? Array.from(room.shopChosen) : [],
    arena: { w: ARENA_W, h: ARENA_H },
    players: Object.values(room.players).map((p) => ({
      id: p.id, x: p.x, y: p.y, hp: p.hp, maxHp: p.maxHp,
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
    maxHp: PLAYER_MAX_HP,
    color,
    name: (name && name.slice(0, 16)) || 'Player-' + id.slice(1, 4),
    input: { up: false, down: false, left: false, right: false },
    lastShot: 0,
    lastMelee: 0,
    alive: true,
    respawnAt: 0,
    stats: defaultStats(),
  };

  // se entrar durante a loja, ganha opções também
  if (room.phase === 'shop' && !room.shopOptions[id]) {
    room.shopOptions[id] = randomUpgrades(3);
  }

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
      const room = rooms[ws.roomCode];
      if (room && room.players[ws.playerId]) {
        room.players[ws.playerId].input = {
          up: !!msg.up, down: !!msg.down, left: !!msg.left, right: !!msg.right,
        };
      }

    } else if (msg.type === 'choose_upgrade') {
      const room = rooms[ws.roomCode];
      if (room && room.phase === 'shop' && room.players[ws.playerId] && !room.shopChosen.has(ws.playerId)) {
        const options = room.shopOptions[ws.playerId] || [];
        const chosen = options.find((o) => o.id === msg.upgradeId);
        if (chosen) {
          applyUpgrade(room.players[ws.playerId], chosen.id);
          room.shopChosen.add(ws.playerId);
        }
      }
    }
  });

  ws.on('close', () => {
    const room = rooms[ws.roomCode];
    if (room) {
      delete room.players[ws.playerId];
      delete room.shopOptions[ws.playerId];
      room.shopChosen.delete(ws.playerId);
      if (Object.keys(room.players).length === 0) {
        delete rooms[ws.roomCode];
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
