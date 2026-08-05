const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const { createEngine, TICK_MS } = require('./engine');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O/1/I
const SYSTEM_COLOR = '#8992a4';

// rooms[code] = { isPublic, engine } — salas com jogo rodando NO SERVIDOR (sempre públicas hoje)
const rooms = {};
// p2pRooms[code] = { hostWs } — salas privadas: servidor só ajuda os PCs se acharem (sinalização),
// quem roda o jogo de verdade é o navegador de quem criou a sala.
const p2pRooms = {};

function generateRoomCode(registry) {
  let code;
  do {
    code = Array.from({ length: 4 }, () => ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)]).join('');
  } while (rooms[code] || p2pRooms[code]);
  return code;
}

// ---------- Chat / sistema (salas públicas) ----------
function broadcastToRoom(code, payload) {
  const msg = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === 1 && client.roomCode === code) client.send(msg);
  }
}
function broadcastChat(code, name, color, text, system) {
  broadcastToRoom(code, { type: 'chat_message', name, color, text, system: !!system, ts: Date.now() });
}
function broadcastAvatar(code, playerId, avatar) {
  broadcastToRoom(code, { type: 'avatar', playerId, avatar });
}

function createPublicRoom(code) {
  const engine = createEngine({
    onSystem: (text) => broadcastChat(code, 'Sistema', SYSTEM_COLOR, text, true),
    onChat: (payload) => broadcastChat(code, payload.name, payload.color, payload.text, false),
  });
  return { isPublic: true, engine };
}

function addPlayerToPublicRoom(ws, code, name, classId, avatar, weapon, attackMode) {
  const room = rooms[code];
  const id = 'p' + Math.random().toString(36).slice(2, 9);
  ws.roomCode = code;
  ws.playerId = id;
  const player = room.engine.addPlayer({ id, name, classId, avatar, weapon, attackMode });

  ws.send(JSON.stringify({ type: 'joined', id, color: player.color, room: code, classId: player.classId, isPublic: true, mode: 'server' }));

  for (const pid of room.engine.getPlayerIds()) {
    if (pid !== id) {
      const pl = room.engine.getPlayer(pid);
      if (pl && pl.avatar) ws.send(JSON.stringify({ type: 'avatar', playerId: pid, avatar: pl.avatar }));
    }
  }
  if (player.avatar) broadcastAvatar(code, id, player.avatar);
}

function removePlayerFromPublicRoom(ws) {
  const code = ws.roomCode;
  const room = rooms[code];
  if (room) {
    const empty = room.engine.removePlayer(ws.playerId);
    if (empty) delete rooms[code];
  }
  ws.roomCode = null;
  ws.playerId = null;
}

function sendRoomList(ws) {
  const list = Object.entries(rooms)
    .filter(([, r]) => r.isPublic)
    .map(([code, r]) => {
      const s = r.engine.getSummary();
      return { code, players: s.players, wave: s.wave, phase: s.phase };
    });
  ws.send(JSON.stringify({ type: 'room_list', rooms: list }));
}

wss.on('connection', (ws) => {
  ws.peerId = 'peer' + Math.random().toString(36).slice(2, 10);
  ws.roomCode = null;
  ws.playerId = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // ---------- Salas públicas: jogo roda aqui no servidor (como sempre) ----------
    if (msg.type === 'create') {
      const code = generateRoomCode();
      if (msg.isPublic) {
        rooms[code] = createPublicRoom(code);
        addPlayerToPublicRoom(ws, code, msg.name, msg.classId, msg.avatar, msg.weapon, msg.attackMode);
      } else {
        // sala privada: o CRIADOR vira o host. Servidor só registra o código
        // pra sinalização — nenhum jogo roda aqui.
        p2pRooms[code] = { hostWs: ws };
        ws.isP2pHost = true;
        ws.roomCode = code;
        ws.send(JSON.stringify({ type: 'p2p_host_ready', room: code, hostName: msg.name, hostClassId: msg.classId, hostAvatar: msg.avatar }));
      }

    } else if (msg.type === 'join') {
      const code = (msg.room || '').toUpperCase().trim();
      if (rooms[code]) {
        addPlayerToPublicRoom(ws, code, msg.name, msg.classId, msg.avatar, msg.weapon, msg.attackMode);
      } else if (p2pRooms[code]) {
        // sala privada: pede pro host abrir uma conexão WebRTC direta com quem entrou
        const host = p2pRooms[code].hostWs;
        if (!host || host.readyState !== 1) {
          ws.send(JSON.stringify({ type: 'error', message: 'O host dessa sala não está mais conectado.' }));
          return;
        }
        ws.roomCode = code;
        ws.send(JSON.stringify({ type: 'p2p_wait_host', room: code }));
        host.send(JSON.stringify({
          type: 'p2p_peer_join', peerId: ws.peerId, name: msg.name, classId: msg.classId, avatar: msg.avatar,
          weapon: msg.weapon, attackMode: msg.attackMode,
        }));
      } else {
        ws.send(JSON.stringify({ type: 'error', message: 'Sala não encontrada. Confira o código.' }));
      }

    } else if (msg.type === 'leave') {
      if (rooms[ws.roomCode]) {
        removePlayerFromPublicRoom(ws);
      } else if (p2pRooms[ws.roomCode]) {
        if (ws.isP2pHost) delete p2pRooms[ws.roomCode];
        ws.roomCode = null;
      }
      ws.send(JSON.stringify({ type: 'left' }));

    } else if (msg.type === 'list_rooms') {
      sendRoomList(ws);

    } else if (msg.type === 'input') {
      const room = rooms[ws.roomCode];
      if (room) room.engine.setInput(ws.playerId, msg);

    } else if (msg.type === 'choose_upgrade') {
      const room = rooms[ws.roomCode];
      if (room) room.engine.chooseUpgrade(ws.playerId, msg.upgradeId);

    } else if (msg.type === 'chat') {
      const room = rooms[ws.roomCode];
      if (room) room.engine.sendChat(ws.playerId, msg.text);

    } else if (msg.type === 'admin_login') {
      const room = rooms[ws.roomCode];
      if (room) {
        const ok = room.engine.loginAdmin(ws.playerId, msg.username, msg.password);
        ws.send(JSON.stringify({ type: 'admin_login_result', success: ok }));
      }

    } else if (msg.type === 'admin_spawn') {
      const room = rooms[ws.roomCode];
      if (room) room.engine.adminSpawnEnemy(ws.playerId, msg.typeId);

    } else if (msg.type === 'admin_upgrade') {
      const room = rooms[ws.roomCode];
      if (room) room.engine.adminGiveUpgrade(ws.playerId, msg.upgradeId);

    } else if (msg.type === 'admin_skip') {
      const room = rooms[ws.roomCode];
      if (room) room.engine.adminSkipPhase(ws.playerId);

    // ---------- Sinalização WebRTC (só isso passa pelo servidor em salas privadas) ----------
    } else if (msg.type === 'p2p_signal') {
      // encaminha oferta/resposta/ICE candidates entre o host e um peer específico,
      // sem o servidor entender ou guardar o conteúdo
      for (const client of wss.clients) {
        if (client.peerId === msg.targetPeerId) {
          client.send(JSON.stringify({ type: 'p2p_signal', fromPeerId: ws.peerId, data: msg.data }));
          break;
        }
      }
    }
  });

  ws.on('close', () => {
    if (rooms[ws.roomCode]) {
      removePlayerFromPublicRoom(ws);
    } else if (ws.isP2pHost && p2pRooms[ws.roomCode]) {
      delete p2pRooms[ws.roomCode];
    }
  });
});

setInterval(() => {
  for (const code of Object.keys(rooms)) {
    const room = rooms[code];
    const state = room.engine.tick();
    broadcastToRoom(code, { type: 'state', room: code, ...state });
  }
}, TICK_MS);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
