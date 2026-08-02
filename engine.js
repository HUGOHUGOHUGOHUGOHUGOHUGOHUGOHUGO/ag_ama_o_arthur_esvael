// engine.js — lógica de simulação de UMA sala, sem depender de Node nem de navegador.
// Usado por server.js (salas públicas) e por public/game.js (host de salas privadas P2P).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GameEngine = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const ARENA_W = 900;
  const ARENA_H = 600;
  const TICK_MS = 50;
  const PLAYER_SPEED = 3.2;
  const PLAYER_RADIUS = 14;
  const PLAYER_MAX_HP = 100;
  const RESPAWN_MS = 3000;

  const ENEMY_SPEED = 1.1;
  const ENEMY_CONTACT_DMG = 8;
  const ENEMY_CONTACT_COOLDOWN = 600;

  const WAVE_INTERVAL_MS = 60000;
  const SHOP_DURATION_MS = 12000;

  const PISTOL_COOLDOWN = 450;
  const PISTOL_DMG = 8;
  const PISTOL_RANGE = 420;
  const BULLET_SPEED = 7;
  const BULLET_RADIUS = 4;

  const MELEE_COOLDOWN = 900;
  const MELEE_DMG = 16;
  const MELEE_RADIUS = 55;

  const BOSS_BASE_HP = 500;
  const BOSS_EVERY_N_WAVES = 10;
  const BOSS_HP_GROWTH = 1.10;

  const COLORS = ['#ff5d5d', '#5dd8ff', '#8dff5d', '#ffd75d', '#c07dff', '#ff9d5d'];
  const AVATAR_MAX_LEN = 60000;

  const ENEMY_TYPES = {
    normal: { speedMult: 1, hpMult: 1, dmgMult: 1, radius: 12 },
    fast: { speedMult: 1.9, hpMult: 0.45, dmgMult: 0.6, radius: 9 },
    swarm: { speedMult: 1.35, hpMult: 0.28, dmgMult: 0.4, radius: 7 },
    tank: { speedMult: 0.6, hpMult: 2.4, dmgMult: 1.6, radius: 17 },
  };

  function pickEnemyType(wave) {
    const weights = { normal: 1 };
    if (wave >= 2) weights.swarm = 0.5;
    if (wave >= 4) weights.fast = Math.min(0.9, 0.3 + wave * 0.02);
    if (wave >= 6) weights.tank = Math.min(0.6, 0.15 + wave * 0.015);
    const entries = Object.entries(weights);
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let r = Math.random() * total;
    for (const [type, w] of entries) {
      if (r < w) return type;
      r -= w;
    }
    return 'normal';
  }

  const CLASSES = {
    soldado: { label: 'Soldado', desc: 'Equilibrado, +10% dano', apply: (p) => { p.stats.dmgMult *= 1.10; } },
    berserker: { label: 'Berserker', desc: 'Espada maior e mais forte, menos vida', apply: (p) => {
      p.stats.meleeRadiusMult *= 1.30; p.stats.dmgMult *= 1.15; p.maxHp = Math.round(p.maxHp * 0.85);
    }},
    tanque: { label: 'Tanque', desc: '+50% vida máxima, um pouco mais lento', apply: (p) => {
      p.maxHp = Math.round(p.maxHp * 1.5); p.stats.moveSpeedMult *= 0.85;
    }},
    ninja: { label: 'Ninja', desc: '+25% velocidade e ataque, menos vida', apply: (p) => {
      p.stats.moveSpeedMult *= 1.25; p.stats.atkSpeedMult *= 1.15; p.maxHp = Math.round(p.maxHp * 0.8);
    }},
    atirador: { label: 'Atirador', desc: '+35% alcance de pistola, +10% dano, menos vida', apply: (p) => {
      p.stats.rangeMult *= 1.35; p.stats.dmgMult *= 1.10; p.maxHp = Math.round(p.maxHp * 0.9);
    }},
    vampiro: { label: 'Vampiro', desc: 'Regenera vida com o tempo, começa mais frágil', apply: (p) => {
      p.stats.regenPerSec += p.maxHp * 0.015; p.maxHp = Math.round(p.maxHp * 0.9);
    }},
  };

  function applyClass(player, classId) {
    const entry = CLASSES[classId] ? CLASSES[classId] : CLASSES.soldado;
    entry.apply(player);
    player.hp = player.maxHp;
  }

  const UPGRADE_POOL = [
    { id: 'hp', label: '+20 Vida Máxima', desc: 'Aumenta o limite de vida e cura 20', apply: (p) => {
        p.stats.maxHpBonus += 20; p.maxHp += 20; p.hp = Math.min(p.maxHp, p.hp + 20);
    }},
    { id: 'dmg', label: '+15% Dano', desc: 'Pistola e espada causam mais dano', apply: (p) => { p.stats.dmgMult *= 1.15; }},
    { id: 'atkspeed', label: '+15% Vel. de Ataque', desc: 'Ataca com mais frequência', apply: (p) => { p.stats.atkSpeedMult *= 1.15; }},
    { id: 'movespeed', label: '+10% Vel. de Movimento', desc: 'Anda mais rápido pela arena', apply: (p) => { p.stats.moveSpeedMult *= 1.10; }},
    { id: 'melee', label: '+20% Raio da Espada', desc: 'Área de dano corpo-a-corpo maior', apply: (p) => { p.stats.meleeRadiusMult *= 1.20; }},
    { id: 'range', label: '+15% Alcance da Pistola', desc: 'Mira inimigos mais distantes', apply: (p) => { p.stats.rangeMult *= 1.15; }},
    { id: 'regen', label: 'Regeneração', desc: 'Recupera vida aos poucos com o tempo', apply: (p) => { p.stats.regenPerSec += p.maxHp * 0.02; }},
    { id: 'pierce', label: 'Balas Perfurantes', desc: 'Balas atravessam +1 inimigo', apply: (p) => { p.stats.pierce += 1; }},
    { id: 'thorns', label: 'Espinhos', desc: 'Reflete parte do dano de contato', apply: (p) => { p.stats.thorns += 0.3; }},
    { id: 'crit', label: 'Chance de Crítico', desc: '+15% de chance de causar dano dobrado', apply: (p) => { p.stats.critChance += 0.15; }},
    { id: 'lifesteal', label: 'Roubo de Vida', desc: 'Cura uma % do dano causado', apply: (p) => { p.stats.lifesteal += 0.08; }},
  ];

  function defaultStats() {
    return {
      dmgMult: 1, atkSpeedMult: 1, moveSpeedMult: 1, meleeRadiusMult: 1, rangeMult: 1,
      maxHpBonus: 0, regenPerSec: 0, pierce: 0, thorns: 0, critChance: 0, lifesteal: 0,
    };
  }

  function randomUpgrades(n) {
    const shuffled = [...UPGRADE_POOL].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, n).map((u) => ({ id: u.id, label: u.label, desc: u.desc }));
  }

  function applyUpgrade(player, upgradeId) {
    const u = UPGRADE_POOL.find((x) => x.id === upgradeId);
    if (u) u.apply(player);
  }

  function randEdgePosition() {
    const side = Math.floor(Math.random() * 4);
    if (side === 0) return { x: Math.random() * ARENA_W, y: -20 };
    if (side === 1) return { x: Math.random() * ARENA_W, y: ARENA_H + 20 };
    if (side === 2) return { x: -20, y: Math.random() * ARENA_H };
    return { x: ARENA_W + 20, y: Math.random() * ARENA_H };
  }

  function createEngine(opts) {
    opts = opts || {};
    const onSystem = opts.onSystem || function () {};
    const onChat = opts.onChat || function () {};

    const room = {
      players: {}, enemies: [], bullets: [], wave: 0, waveTimer: 0, phase: 'wave',
      shopTimer: 0, shopOptions: {}, shopChosen: new Set(),
      enemyIdCounter: 0, bulletIdCounter: 0, colorIdx: 0, bossSpawnCount: 0,
    };

    function nearestEnemy(x, y, maxRange) {
      let best = null, bestDist = Infinity;
      for (const e of room.enemies) {
        const d = Math.hypot(e.x - x, e.y - y);
        if (d < bestDist && (!maxRange || d <= maxRange)) { bestDist = d; best = e; }
      }
      return best;
    }
    function alivePlayers() {
      return Object.values(room.players).filter((p) => p.alive);
    }
    function nearestPlayer(x, y) {
      let best = null, bestDist = Infinity;
      for (const p of alivePlayers()) {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < bestDist) { bestDist = d; best = p; }
      }
      return best;
    }

    function spawnWave() {
      room.wave += 1;
      const isBossWave = room.wave % BOSS_EVERY_N_WAVES === 0;
      const numPlayers = Math.max(1, Object.keys(room.players).length);
      const baseCount = 4 + room.wave * 1.3;
      let count = Math.min(Math.round(baseCount * (0.55 + 0.45 * numPlayers)), 45);
      if (isBossWave) count = Math.round(count * 0.5);
      const baseHp = 16 + room.wave * 4.5;

      for (let i = 0; i < count; i++) {
        const pos = randEdgePosition();
        const typeId = pickEnemyType(room.wave);
        const type = ENEMY_TYPES[typeId];
        const hp = Math.max(6, Math.round(baseHp * type.hpMult));
        room.enemyIdCounter += 1;
        room.enemies.push({
          id: room.enemyIdCounter, x: pos.x, y: pos.y, hp, maxHp: hp, lastContact: 0,
          typeId, speed: ENEMY_SPEED * type.speedMult, radius: type.radius,
          contactDmg: ENEMY_CONTACT_DMG * type.dmgMult,
        });
      }

      if (isBossWave) {
        const bossHp = Math.round(BOSS_BASE_HP * Math.pow(BOSS_HP_GROWTH, room.bossSpawnCount));
        const pos = randEdgePosition();
        room.enemyIdCounter += 1;
        room.enemies.push({
          id: room.enemyIdCounter, x: pos.x, y: pos.y, hp: bossHp, maxHp: bossHp, lastContact: 0,
          typeId: 'boss', speed: ENEMY_SPEED * 0.55, radius: 28, contactDmg: ENEMY_CONTACT_DMG * 2.2,
        });
        room.bossSpawnCount += 1;
        onSystem(`⚠️ UM CHEFE APARECEU na onda ${room.wave}! (${bossHp} de vida)`);
      }

      room.waveTimer = WAVE_INTERVAL_MS;
      onSystem(`Onda ${room.wave} começou! (${room.enemies.length} inimigos)`);
    }

    function startShopPhase() {
      room.phase = 'shop';
      room.shopTimer = SHOP_DURATION_MS;
      room.shopChosen = new Set();
      room.shopOptions = {};
      for (const pid of Object.keys(room.players)) {
        room.shopOptions[pid] = randomUpgrades(3);
      }
      onSystem('A loja abriu — escolham seus upgrades!');
    }

    function endShopPhase() {
      room.phase = 'wave';
      room.shopOptions = {};
      room.shopChosen = new Set();
      spawnWave();
    }

    function tick() {
      const now = Date.now();

      if (room.phase === 'shop') {
        room.shopTimer -= TICK_MS;
        const ids = Object.keys(room.players);
        const allChosen = ids.length > 0 && ids.every((pid) => room.shopChosen.has(pid));
        if (room.shopTimer <= 0 || allChosen) endShopPhase();
        return snapshot();
      }

      room.waveTimer -= TICK_MS;
      if (room.waveTimer <= 0) {
        if (room.wave === 0) {
          spawnWave();
        } else {
          startShopPhase();
          return snapshot();
        }
      }

      for (const p of Object.values(room.players)) {
        if (!p.alive) {
          if (now >= p.respawnAt) {
            p.alive = true; p.hp = p.maxHp;
            p.x = ARENA_W / 2 + (Math.random() - 0.5) * 100;
            p.y = ARENA_H / 2 + (Math.random() - 0.5) * 100;
          }
          continue;
        }

        if (p.stats.regenPerSec > 0) {
          p.hp = Math.min(p.maxHp, p.hp + p.stats.regenPerSec * (TICK_MS / 1000));
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

        const wantsAttack = p.attackMode === 'manual' ? !!p.input.attack : true;

        if (p.weapon === 'pistol') {
          const pistolCooldown = PISTOL_COOLDOWN / p.stats.atkSpeedMult;
          if (wantsAttack && now - p.lastShot >= pistolCooldown) {
            const range = PISTOL_RANGE * p.stats.rangeMult;
            const target = nearestEnemy(p.x, p.y, range);
            if (target) {
              const ang = Math.atan2(target.y - p.y, target.x - p.x);
              let dmg = PISTOL_DMG * p.stats.dmgMult;
              if (p.stats.critChance > 0 && Math.random() < p.stats.critChance) dmg *= 2;
              room.bulletIdCounter += 1;
              room.bullets.push({
                id: room.bulletIdCounter, x: p.x, y: p.y,
                vx: Math.cos(ang) * BULLET_SPEED, vy: Math.sin(ang) * BULLET_SPEED,
                dmg, pierceLeft: p.stats.pierce, owner: p.id,
              });
              p.lastShot = now;
            }
          }
        } else {
          const meleeCooldown = MELEE_COOLDOWN / p.stats.atkSpeedMult;
          if (wantsAttack && now - p.lastMelee >= meleeCooldown) {
            const radius = MELEE_RADIUS * p.stats.meleeRadiusMult;
            let hit = false;
            for (const e of room.enemies) {
              if (Math.hypot(e.x - p.x, e.y - p.y) <= radius) {
                let dmg = MELEE_DMG * p.stats.dmgMult;
                if (p.stats.critChance > 0 && Math.random() < p.stats.critChance) dmg *= 2;
                e.hp -= dmg; hit = true;
                if (p.stats.lifesteal > 0) p.hp = Math.min(p.maxHp, p.hp + dmg * p.stats.lifesteal);
                if (e.hp <= 0 && !e.killCredited) { e.killCredited = true; p.kills += 1; }
              }
            }
            if (hit) p.lastMelee = now;
          }
        }
      }

      room.bullets = room.bullets.filter((b) => {
        b.x += b.vx; b.y += b.vy;
        if (b.x < 0 || b.x > ARENA_W || b.y < 0 || b.y > ARENA_H) return false;
        let consumed = false;
        for (const e of room.enemies) {
          if (b.hitIds && b.hitIds.has(e.id)) continue;
          if (Math.hypot(e.x - b.x, e.y - b.y) <= e.radius + BULLET_RADIUS) {
            e.hp -= b.dmg;
            const owner = room.players[b.owner];
            if (owner && owner.stats.lifesteal > 0) {
              owner.hp = Math.min(owner.maxHp, owner.hp + b.dmg * owner.stats.lifesteal);
            }
            if (e.hp <= 0 && !e.killCredited) { e.killCredited = true; if (owner) owner.kills += 1; }
            if (!b.hitIds) b.hitIds = new Set();
            b.hitIds.add(e.id);
            if (b.pierceLeft > 0) { b.pierceLeft -= 1; } else { consumed = true; }
            break;
          }
        }
        return !consumed;
      });

      for (const e of room.enemies) {
        const target = nearestPlayer(e.x, e.y);
        if (target) {
          const ang = Math.atan2(target.y - e.y, target.x - e.x);
          e.x += Math.cos(ang) * e.speed;
          e.y += Math.sin(ang) * e.speed;
          const d = Math.hypot(target.x - e.x, target.y - e.y);
          if (d <= PLAYER_RADIUS + e.radius && now - e.lastContact >= ENEMY_CONTACT_COOLDOWN) {
            target.hp -= e.contactDmg;
            e.lastContact = now;
            if (target.stats.thorns > 0) {
              e.hp -= e.contactDmg * target.stats.thorns;
              if (e.hp <= 0 && !e.killCredited) { e.killCredited = true; target.kills += 1; }
            }
            if (target.hp <= 0) { target.alive = false; target.respawnAt = now + RESPAWN_MS; }
          }
        }
      }

      room.enemies = room.enemies.filter((e) => e.hp > 0);

      if (room.wave >= 1 && room.enemies.length === 0) {
        onSystem('Todos os inimigos foram derrotados! Indo pra loja...');
        startShopPhase();
        return snapshot();
      }

      return snapshot();
    }

    function snapshot() {
      return {
        phase: room.phase,
        wave: room.wave,
        waveTimeLeft: Math.max(0, room.waveTimer),
        shopTimeLeft: room.phase === 'shop' ? Math.max(0, room.shopTimer) : 0,
        shopOptions: room.phase === 'shop' ? room.shopOptions : {},
        shopChosen: room.phase === 'shop' ? Array.from(room.shopChosen) : [],
        arena: { w: ARENA_W, h: ARENA_H },
        players: Object.values(room.players).map((p) => ({
          id: p.id, x: p.x, y: p.y, hp: p.hp, maxHp: p.maxHp,
          color: p.color, name: p.name, alive: p.alive, classId: p.classId, kills: p.kills,
          weapon: p.weapon, attackMode: p.attackMode,
        })),
        enemies: room.enemies.map((e) => ({
          id: e.id, x: e.x, y: e.y, hp: e.hp, maxHp: e.maxHp, typeId: e.typeId, radius: e.radius,
        })),
        bullets: room.bullets.map((b) => ({ id: b.id, x: b.x, y: b.y })),
      };
    }

    function addPlayer(opts2) {
      const id = opts2.id, name = opts2.name, classId = opts2.classId, avatar = opts2.avatar;
      const weapon = opts2.weapon === 'melee' ? 'melee' : 'pistol';
      const attackMode = opts2.attackMode === 'manual' ? 'manual' : 'auto';
      const color = COLORS[room.colorIdx % COLORS.length];
      room.colorIdx += 1;
      const resolvedClassId = CLASSES[classId] ? classId : 'soldado';
      const resolvedAvatar = (typeof avatar === 'string' && avatar.length > 0 && avatar.length < AVATAR_MAX_LEN && avatar.indexOf('data:image/') === 0)
        ? avatar : null;

      const player = {
        id,
        x: ARENA_W / 2 + (Math.random() - 0.5) * 100,
        y: ARENA_H / 2 + (Math.random() - 0.5) * 100,
        hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP, color,
        name: (name && name.slice(0, 16)) || 'Player-' + id.slice(0, 4),
        input: { up: false, down: false, left: false, right: false, attack: false },
        lastShot: 0, lastMelee: 0, alive: true, respawnAt: 0,
        stats: defaultStats(), classId: resolvedClassId, kills: 0, avatar: resolvedAvatar,
        weapon, attackMode,
      };
      applyClass(player, resolvedClassId);
      room.players[id] = player;

      if (room.phase === 'shop' && !room.shopOptions[id]) {
        room.shopOptions[id] = randomUpgrades(3);
      }
      onSystem(`${player.name} entrou na sala.`);
      return player;
    }

    function removePlayer(id) {
      const player = room.players[id];
      delete room.players[id];
      delete room.shopOptions[id];
      room.shopChosen.delete(id);
      if (player) onSystem(`${player.name} saiu da sala.`);
      return Object.keys(room.players).length === 0;
    }

    function setInput(id, input) {
      if (room.players[id]) {
        room.players[id].input = {
          up: !!input.up, down: !!input.down, left: !!input.left, right: !!input.right,
          attack: !!input.attack,
        };
      }
    }

    function chooseUpgrade(id, upgradeId) {
      if (room.phase !== 'shop' || !room.players[id] || room.shopChosen.has(id)) return false;
      const options = room.shopOptions[id] || [];
      const chosen = options.find((o) => o.id === upgradeId);
      if (!chosen) return false;
      applyUpgrade(room.players[id], chosen.id);
      room.shopChosen.add(id);
      return true;
    }

    function sendChat(id, text) {
      const player = room.players[id];
      if (!player || typeof text !== 'string') return;
      const trimmed = text.trim().slice(0, 200);
      if (trimmed.length === 0) return;
      onChat({ name: player.name, color: player.color, text: trimmed, system: false });
    }

    function getPlayer(id) { return room.players[id]; }
    function getPlayerIds() { return Object.keys(room.players); }
    function getSummary() { return { wave: room.wave, phase: room.phase, players: Object.keys(room.players).length }; }

    return { addPlayer, removePlayer, setInput, chooseUpgrade, sendChat, tick, getPlayer, getPlayerIds, getSummary };
  }

  return { createEngine, CLASSES, TICK_MS };
});
