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

const ROLES = ['Raja', 'Rani', 'Sipahi', 'Chor'];
const POINTS = {
  'Raja': 1000,
  'Rani': 800,
  'Sipahi': 500,
  'Chor': 0
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
    let roles = ['Raja', 'Rani', 'Sipahi', 'Chor'];

    if (count === 5) roles.push('Mantri');
    if (count === 6) roles.push('Mantri', 'Sipahi 2');

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
    const targetPlayer = room.players.find(p => p.id === targetPlayerId);
    const sipahiPlayer = room.players.find(p => p.role === 'Sipahi');
    const chorPlayer = room.players.find(p => p.role === 'Chor');

    if (targetPlayer.role === 'Chor') {
      sipahiPlayer.totalScore += POINTS['Sipahi'];
    } else {
      chorPlayer.totalScore += POINTS['Sipahi'];
      sipahiPlayer.totalScore += 0;
    }

    room.players.find(p => p.role === 'Raja').totalScore += POINTS['Raja'];
    room.players.find(p => p.role === 'Rani').totalScore += POINTS['Rani'];

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
