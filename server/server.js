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

const ROLES = ['Raja', 'Rani', 'Mantri', 'Sipahi', 'Police', 'Thirudan'];
const POINTS = {
  'Raja': 1000,
  'Rani': 800,
  'Mantri': 700,
  'Sipahi': 500,
  'Police': 500,
  'Thirudan': 0
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
    // Raja, Rani, Mantri, Sipahi, Police, Thirudan
    let roles = ['Raja', 'Rani', 'Sipahi', 'Thirudan']; // Default 4

    if (count === 5) roles = ['Raja', 'Rani', 'Mantri', 'Sipahi', 'Thirudan'];
    if (count === 6) roles = ['Raja', 'Rani', 'Mantri', 'Sipahi', 'Police', 'Thirudan'];

    // Fisher-Yates Shuffle for true randomness
    for (let i = roles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [roles[i], roles[j]] = [roles[j], roles[i]];
    }

    room.players.forEach((p, i) => {
      p.role = roles[i];
      p.isFinished = false;
    });

    const raja = room.players.find(p => p.role === 'Raja');

    // Reset round state
    room.gameState = {
      stage: 'RAJAS_TURN',
      currentGuesser: raja.id,
      revealedRoles: [
        { playerId: raja.id, role: 'Raja' }
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

    if (guesser.id !== room.gameState.currentGuesser) return;

    const STAGE_TARGETS = {
      'RAJAS_TURN': 'Rani',
      'RANIS_TURN': 'Mantri',
      'MANTRIS_TURN': 'Sipahi',
      'SIPAHIS_TURN': 'Police',
      'POLICES_TURN': 'Thirudan'
    };

    // Dynamic targets based on player count
    const count = room.players.length;
    if (room.gameState.stage === 'RAJAS_TURN' && count === 4) STAGE_TARGETS['RAJAS_TURN'] = 'Rani'; // Stay Rani
    if (room.gameState.stage === 'RANIS_TURN' && count === 4) STAGE_TARGETS['RANIS_TURN'] = 'Sipahi';
    if (room.gameState.stage === 'SIPAHIS_TURN') STAGE_TARGETS['SIPAHIS_TURN'] = 'Thirudan';

    if (count === 5) {
      if (room.gameState.stage === 'MANTRIS_TURN') STAGE_TARGETS['MANTRIS_TURN'] = 'Sipahi';
      if (room.gameState.stage === 'SIPAHIS_TURN') STAGE_TARGETS['SIPAHIS_TURN'] = 'Thirudan';
    }

    const targetRole = STAGE_TARGETS[room.gameState.stage];
    if (!targetRole) return;

    if (target.role === targetRole) {
      // SUCCESS
      room.gameState.revealedRoles.push({ playerId: targetPlayerId, role: targetRole });
      guesser.isFinished = true;
      guesser.totalScore += (POINTS[guesser.role] || 0);

      let nextStage = 'END';
      const stages = ['RAJAS_TURN', 'RANIS_TURN', 'MANTRIS_TURN', 'SIPAHIS_TURN', 'POLICES_TURN'];
      const currentIndex = stages.indexOf(room.gameState.stage);

      // Find next valid stage based on player count
      for (let i = currentIndex + 1; i < stages.length; i++) {
        const roleNeeded = stages[i].split('_')[0].charAt(0).toUpperCase() + stages[i].split('_')[0].slice(1, -1).toLowerCase();
        if (room.players.some(p => p.role === roleNeeded)) {
          nextStage = stages[i];
          break;
        }
      }

      room.gameState.stage = nextStage;

      if (nextStage === 'END') {
        endRound(roomId);
      } else {
        const nextGuesserId = targetPlayerId; // Person found becomes the next guesser
        room.gameState.currentGuesser = nextGuesserId;
        io.to(roomId).emit('guess_success', room);
      }
    } else {
      // FAILURE - ROLE SWAP
      const oldGuesserRole = guesser.role;
      const oldTargetRole = target.role;

      // Swap roles
      guesser.role = oldTargetRole;
      target.role = oldGuesserRole;

      // Update revealed roles: 
      // 1. Remove the old Raja (who is now oldTargetRole)
      // 2. Add the NEW Raja (target who was oldTargetRole)
      // We essentially just need to make sure 'Raja' role is always mapped to the right person

      const newRaja = room.players.find(p => p.role === 'Raja');

      // Update revealedRoles array
      // Remove any 'Raja' entry and add the new one. 
      // Also keep any other revealed roles (like previously found Rani etc).
      room.gameState.revealedRoles = room.gameState.revealedRoles.filter(r => r.role !== 'Raja');
      room.gameState.revealedRoles.push({ playerId: newRaja.id, role: 'Raja' });

      // Maintain current stage but change guesser
      room.gameState.currentGuesser = target.id;

      io.to(roomId).emit('guess_wrong', {
        room,
        message: `Oops! ${target.name} was ${oldTargetRole}. Now roles are swapped! ${target.name} is now ${oldGuesserRole} and must find ${targetRole}!`
      });
    }
  });

  function endRound(roomId) {
    const room = ROOMS[roomId];
    if (!room) return;
    room.status = 'round_ended';

    // Everyone who wasn't caught gets their role points if they didn't already
    room.players.forEach(p => {
      if (!p.isFinished && p.role !== 'Thirudan') {
        p.totalScore += (POINTS[p.role] || 0);
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
