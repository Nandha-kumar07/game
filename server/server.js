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
    if (room && room.players.length >= 4) {
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

  socket.on('make_guess', ({ roomId, targetPlayerId }) => {
    const room = ROOMS[roomId];
    if (!room || room.status !== 'playing') return;

    const guesser = room.players.find(p => p.id === socket.id);
    const target = room.players.find(p => p.id === targetPlayerId);

    // Stage-based target mapping
    const STAGE_TARGETS = {
      'RAJAS_TURN': 'Rani',
      'RANIS_TURN': 'Mantri',
      'MANTRIS_TURN': 'Sipahi',
      'SIPAHIS_TURN': 'Police',
      'POLICES_TURN': 'Thridan'
    };

    // If only 4 players, Sipahi finds Thridan directly
    if (room.players.length === 4 && room.gameState.stage === 'SIPAHIS_TURN') {
      STAGE_TARGETS['SIPAHIS_TURN'] = 'Thridan';
    }
    // If 5 players, Sipahi finds Thridan directly
    if (room.players.length === 5 && room.gameState.stage === 'SIPAHIS_TURN') {
      STAGE_TARGETS['SIPAHIS_TURN'] = 'Thridan';
    }

    const targetRole = STAGE_TARGETS[room.gameState.stage];
    if (!targetRole) return;

    if (target.role === targetRole) {
      // SUCCESS
      room.gameState.revealedRoles.push({ playerId: targetPlayerId, role: targetRole });

      const count = room.players.length;
      let nextStage = 'END';

      if (room.gameState.stage === 'RAJAS_TURN') {
        nextStage = count >= 5 ? 'RANIS_TURN' : 'SIPAHIS_TURN';
      } else if (room.gameState.stage === 'RANIS_TURN') {
        nextStage = count >= 6 ? 'MANTRIS_TURN' : 'SIPAHIS_TURN';
      } else if (room.gameState.stage === 'MANTRIS_TURN') {
        nextStage = 'SIPAHIS_TURN';
      } else if (room.gameState.stage === 'SIPAHIS_TURN') {
        nextStage = count >= 6 ? 'POLICES_TURN' : 'END';
      } else if (room.gameState.stage === 'POLICES_TURN') {
        nextStage = 'END';
      }

      room.gameState.stage = nextStage;

      if (nextStage === 'END') {
        endRound(roomId);
      } else {
        // Set next guesser based on next stage
        const nextGuesserRole = nextStage.split('_')[0].slice(0, -1).charAt(0).toUpperCase() + nextStage.split('_')[0].slice(0, -1).slice(1).toLowerCase();
        const nextGuesser = room.players.find(p => p.role === nextGuesserRole);
        if (nextGuesser) room.gameState.currentGuesser = nextGuesser.id;

        io.to(roomId).emit('guess_success', room);
      }
    } else {
      // FAILURE - Person wrongly guessed becomes the guesser
      room.gameState.revealedRoles.push({ playerId: targetPlayerId, role: target.role });
      room.gameState.wrongGuesses.push(targetPlayerId);
      room.gameState.currentGuesser = targetPlayerId;

      io.to(roomId).emit('guess_wrong', {
        room,
        message: `${target.name} is not ${targetRole}. Now ${target.name} will find ${targetRole}!`
      });
    }
  });

  function endRound(roomId) {
    const room = ROOMS[roomId];
    if (!room) return;
    room.status = 'round_ended';

    // Award Points
    room.players.forEach(p => {
      // Basic logic: Everyone gets points except Thridan (who was caught)
      if (p.role !== 'Thridan') {
        p.totalScore += POINTS[p.role] || 500;
      }
    });

    room.gameState.revealedRoles = room.players.map(p => ({ playerId: p.id, role: p.role }));
    io.to(roomId).emit('round_ended', room);
  }

  socket.on('next_round', (roomId) => {
    if (ROOMS[roomId]) {
      startRound(roomId);
    }
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
