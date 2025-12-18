const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const rawClientUrl = process.env.CLIENT_URL || "*";
const clientUrl = rawClientUrl.endsWith('/') ? rawClientUrl.slice(0, -1) : rawClientUrl;

const app = express();
app.use(cors({
  origin: clientUrl,
  methods: ["GET", "POST"]
}));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: clientUrl,
    methods: ["GET", "POST"]
  }
});

// Existing ROOMS and logic below...
const ROOMS = {};

const ROLES = ['Raja', 'Rani', 'Mantri', 'Sipahi', 'Police', 'Thridan'];
const POINTS = {
  'Raja': 1000,
  'Rani': 800,
  'Mantri': 700,
  'Sipahi': 500,
  'Police': 500,
  'Thridan': 0
};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join_room', ({ roomId, playerName }) => {
    if (!ROOMS[roomId]) {
      ROOMS[roomId] = {
        id: roomId,
        players: [],
        status: 'waiting',
        gameState: {
          stage: 'WAITING',
          currentGuesser: null,
          revealedRoles: [],
          wrongGuesses: []
        },
        maxPlayers: 4 // Default
      };
    }

    const room = ROOMS[roomId];
    if (room.players.length < 6) {
      room.players.push({
        id: socket.id,
        name: playerName,
        role: null,
        totalScore: 0
      });
      socket.join(roomId);
      io.to(roomId).emit('room_update', room);

      // Start if 4, but wait for more if they want? 
      // Let's add a "start_game" trigger or auto-start at 6.
      // User said "min 4 max 6". I'll add a manual start or auto-start at 6.
      if (room.players.length === 6) {
        startRound(roomId);
      }
    } else {
      socket.emit('error', 'Room is full');
    }
  });

  socket.on('start_game_manual', (roomId) => {
    const room = ROOMS[roomId];
    if (room.players.length >= 4) {
      startRound(roomId);
    }
  });

  function startRound(roomId) {
    const room = ROOMS[roomId];
    room.status = 'playing';

    const count = room.players.length;
    let roles = ['Raja', 'Rani', 'Sipahi', 'Thridan'];

    if (count === 5) roles.push('Mantri');
    if (count === 6) roles.push('Mantri', 'Police');

    // Shuffle roles
    const shuffledRoles = [...roles].sort(() => Math.random() - 0.5);
    room.players.forEach((p, i) => {
      p.role = shuffledRoles[i];
    });

    // Reset round state
    room.gameState = {
      stage: 'RAJAS_TURN',
      currentGuesser: room.players.find(p => p.role === 'Raja').id,
      revealedRoles: [
        { playerId: room.players.find(p => p.role === 'Raja').id, role: 'Raja' }
      ],
      wrongGuesses: []
    };

    io.to(roomId).emit('start_round', room);
  }

  socket.on('raja_find_rani', ({ roomId, targetPlayerId }) => {
    const room = ROOMS[roomId];
    const targetPlayer = room.players.find(p => p.id === targetPlayerId);

    if (targetPlayer.role === 'Rani') {
      room.gameState.revealedRoles.push({ playerId: targetPlayerId, role: 'Rani' });
      room.gameState.stage = 'SIPAHIS_TURN';
      const sipahi = room.players.find(p => p.role === 'Sipahi');
      room.gameState.revealedRoles.push({ playerId: sipahi.id, role: 'Sipahi' });
      io.to(roomId).emit('raja_success', room);
    } else {
      room.gameState.revealedRoles.push({ playerId: targetPlayerId, role: targetPlayer.role });
      room.gameState.wrongGuesses.push(targetPlayerId);
      room.gameState.currentGuesser = targetPlayerId;
      io.to(roomId).emit('raja_wrong', {
        room,
        message: `${targetPlayer.name} is not Rani. Now ${targetPlayer.name} will find Rani!`
      });
    }
  });

  socket.on('sipahi_find_chor', ({ roomId, targetPlayerId }) => {
    const room = ROOMS[roomId];
    if (!room) return;

    const targetPlayer = room.players.find(p => p.id === targetPlayerId);
    const isSuccess = targetPlayer.role === 'Thridan';

    // Award Points
    room.players.forEach(p => {
      if (p.role === 'Raja') p.totalScore += POINTS['Raja'];
      if (p.role === 'Rani') p.totalScore += POINTS['Rani'];
      if (p.role === 'Mantri') p.totalScore += POINTS['Mantri'];

      if (p.role === 'Sipahi' || p.role === 'Police') {
        p.totalScore += isSuccess ? POINTS['Sipahi'] : 0;
      }

      if (p.role === 'Thridan') {
        p.totalScore += isSuccess ? 0 : POINTS['Sipahi'];
      }
    });

    room.status = 'round_ended';
    room.gameState.revealedRoles = room.players.map(p => ({ playerId: p.id, role: p.role }));
    io.to(roomId).emit('round_ended', room);
  });

  socket.on('next_round', (roomId) => {
    startRound(roomId);
  });

  socket.on('disconnect', () => {
    for (const roomId in ROOMS) {
      ROOMS[roomId].players = ROOMS[roomId].players.filter(p => p.id !== socket.id);
      if (ROOMS[roomId].players.length === 0) {
        delete ROOMS[roomId];
      } else {
        io.to(roomId).emit('room_update', ROOMS[roomId]);
      }
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
