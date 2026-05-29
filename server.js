const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));

// rooms: roomId -> { host: ws, guest: ws }
const rooms = new Map();

function generateRoomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

wss.on('connection', (ws) => {
  ws.roomId = null;
  ws.role = null;

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    switch (msg.type) {
      case 'create-room': {
        const roomId = generateRoomId();
        rooms.set(roomId, { host: ws, guest: null });
        ws.roomId = roomId;
        ws.role = 'host';
        ws.send(JSON.stringify({ type: 'room-created', roomId }));
        break;
      }

      case 'join-room': {
        const roomId = msg.roomId?.toUpperCase();
        const room = rooms.get(roomId);
        if (!room) {
          ws.send(JSON.stringify({ type: 'error', message: '房间不存在' }));
          return;
        }
        if (room.guest) {
          ws.send(JSON.stringify({ type: 'error', message: '房间已满' }));
          return;
        }
        room.guest = ws;
        ws.roomId = roomId;
        ws.role = 'guest';
        ws.send(JSON.stringify({ type: 'joined', roomId }));
        // notify host that guest joined
        room.host.send(JSON.stringify({ type: 'guest-joined' }));
        break;
      }

      // WebRTC signaling relay
      case 'offer':
      case 'answer':
      case 'ice-candidate': {
        const room = rooms.get(ws.roomId);
        if (!room) return;
        const target = ws.role === 'host' ? room.guest : room.host;
        if (target && target.readyState === 1) {
          target.send(JSON.stringify(msg));
        }
        break;
      }

      case 'leave': {
        handleLeave(ws);
        break;
      }
    }
  });

  ws.on('close', () => handleLeave(ws));
});

function handleLeave(ws) {
  if (!ws.roomId) return;
  const room = rooms.get(ws.roomId);
  if (!room) return;

  const other = ws.role === 'host' ? room.guest : room.host;
  if (other && other.readyState === 1) {
    other.send(JSON.stringify({ type: 'peer-left' }));
  }

  if (ws.role === 'host') {
    rooms.delete(ws.roomId);
  } else {
    room.guest = null;
  }
  ws.roomId = null;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
