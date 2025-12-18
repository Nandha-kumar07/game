import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import Peer from 'peerjs';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, LogIn, Crown, Shield, User, Ghost, Trophy, Mic, MicOff, RefreshCw, Volume2 } from 'lucide-react';

const BACKEND_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const socket = io(BACKEND_URL);

function App() {
  const [playerName, setPlayerName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [room, setRoom] = useState(null);
  const [isJoined, setIsJoined] = useState(false);
  const [localRole, setLocalRole] = useState(null);
  const [message, setMessage] = useState('Waiting for players...');
  const [micOn, setMicOn] = useState(false);

  // Voice Chat Refs
  const peerRef = useRef(null);
  const myStreamRef = useRef(null);
  const peersRef = useRef({}); // playerSocketId -> call
  const audioRefs = useRef({}); // playerSocketId -> HTMLAudioElement

  // Sound Refs
  const successSound = useRef(new Audio('/sounds/success.mp3'));
  const catchSound = useRef(new Audio('/sounds/catch.mp3'));
  const errorSound = useRef(new Audio('/sounds/error.mp3'));

  useEffect(() => {
    socket.on('room_update', (updatedRoom) => {
      setRoom(updatedRoom);
    });

    socket.on('start_round', (updatedRoom) => {
      setRoom(updatedRoom);
      const me = updatedRoom.players.find(p => p.id === socket.id);
      setLocalRole(me.role);
      setMessage(`Round Started! You are ${me.role}`);
      // Start voice if mic was previously toggled? 
      // Better to wait for deliberate click to avoid echo/spam
    });

    socket.on('raja_success', (updatedRoom) => {
      setRoom(updatedRoom);
      setMessage('Raja found Rani! Now Sipahi must find Chor.');
      successSound.current.play().catch(e => console.log('Audio wait user interaction'));
    });

    socket.on('raja_wrong', ({ room: updatedRoom, message: msg }) => {
      setRoom(updatedRoom);
      setMessage(msg);
      errorSound.current.play().catch(e => console.log('Audio wait user interaction'));
    });

    socket.on('round_ended', (updatedRoom) => {
      setRoom(updatedRoom);
      setMessage('Round Over! See the scores.');
      catchSound.current.play().catch(e => console.log('Audio wait user interaction'));
    });

    return () => {
      socket.off('room_update');
      socket.off('start_round');
      socket.off('raja_success');
      socket.off('raja_wrong');
      socket.off('round_ended');
      if (peerRef.current) peerRef.current.destroy();
    };
  }, []);

  // Voice Chat Logic
  useEffect(() => {
    if (micOn && !peerRef.current && isJoined) {
      initVoice();
    } else if (!micOn && peerRef.current) {
      stopVoice();
    }
  }, [micOn, isJoined]);

  const initVoice = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      myStreamRef.current = stream;

      const peer = new Peer(socket.id);
      peerRef.current = peer;

      peer.on('call', (call) => {
        call.answer(stream);
        call.on('stream', (remoteStream) => {
          addRemoteAudio(call.peer, remoteStream);
        });
      });

      // Call everyone already in room
      room.players.forEach(p => {
        if (p.id !== socket.id) {
          const call = peer.call(p.id, stream);
          call.on('stream', (remoteStream) => {
            addRemoteAudio(p.id, remoteStream);
          });
          peersRef.current[p.id] = call;
        }
      });
    } catch (err) {
      console.error('Failed to get local stream', err);
      setMicOn(false);
    }
  };

  const addRemoteAudio = (peerId, stream) => {
    if (!audioRefs.current[peerId]) {
      const audio = new Audio();
      audio.srcObject = stream;
      audio.play();
      audioRefs.current[peerId] = audio;
    }
  };

  const stopVoice = () => {
    if (myStreamRef.current) {
      myStreamRef.current.getTracks().forEach(track => track.stop());
    }
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }
    Object.values(audioRefs.current).forEach(a => {
      a.pause();
      a.srcObject = null;
    });
    audioRefs.current = {};
    peersRef.current = {};
  };

  const joinRoom = () => {
    if (playerName && roomId) {
      socket.emit('join_room', { roomId, playerName });
      setIsJoined(true);
    }
  };

  const handleGuess = (targetId) => {
    if (!room) return;

    // Stage check
    if (room.gameState.stage === 'RAJAS_TURN' && room.gameState.currentGuesser === socket.id) {
      socket.emit('raja_find_rani', { roomId, targetPlayerId: targetId });
    } else if (room.gameState.stage === 'SIPAHIS_TURN' && localRole === 'Sipahi') {
      socket.emit('sipahi_find_chor', { roomId, targetPlayerId: targetId });
    }
  };

  const startGame = () => {
    socket.emit('start_game_manual', roomId);
  };

  const nextRound = () => {
    socket.emit('next_round', roomId);
  };

  if (!isJoined) {
    return (
      <div className="glass">
        <h1 style={{ marginBottom: 24, textAlign: 'center' }}>👑 Raja Rani</h1>
        <input
          className="input-field"
          placeholder="Enter Your Name"
          value={playerName}
          onChange={(e) => setPlayerName(e.target.value)}
        />
        <input
          className="input-field"
          placeholder="Room ID"
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
        />
        <button className="btn" onClick={joinRoom}>
          <LogIn size={20} /> Join Game
        </button>
      </div>
    );
  }

  if (!room || room.status === 'waiting') {
    return (
      <div className="glass">
        <h2 style={{ marginBottom: 16 }}>Lobby: {roomId}</h2>
        <div className="status-text">
          {room?.players.length < 4 ? <RefreshCw className="animate-spin" size={24} style={{ margin: '0 auto 10px' }} /> : <Users size={24} style={{ margin: '0 auto 10px', color: '#4ade80' }} />}
          Players ({room?.players.length || 0}/6)
          <div style={{ fontSize: 14, marginTop: 4 }}>Minimum 4 required to start</div>
        </div>
        <div style={{ marginTop: 20 }}>
          {room?.players.map(p => (
            <div key={p.id} className="glass" style={{ padding: 12, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
              <User size={18} /> {p.name} {p.id === socket.id && '(You)'}
            </div>
          ))}
        </div>
        {room?.players.length >= 4 && (
          <button className="btn" style={{ marginTop: 20, background: '#10b981' }} onClick={startGame}>
            Start Game Now
          </button>
        )}
      </div>
    );
  }

  const isMyTurn = (room.gameState.stage === 'RAJAS_TURN' && room.gameState.currentGuesser === socket.id) ||
    (room.gameState.stage === 'SIPAHIS_TURN' && localRole === 'Sipahi');

  return (
    <div className="glass">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2>Room: {roomId}</h2>
        <button
          onClick={() => setMicOn(!micOn)}
          style={{ background: 'none', border: 'none', color: micOn ? '#4ade80' : '#94a3b8', cursor: 'pointer' }}
        >
          {micOn ? <Mic size={24} /> : <MicOff size={24} />}
        </button>
      </div>

      <div className="status-text">
        {isMyTurn ? <span className="highlight">It's Your Turn!</span> : message}
      </div>

      <div className="card-grid">
        {room.players.map(player => {
          const isRevealed = room.gameState.revealedRoles.find(r => r.playerId === player.id);
          const isMe = player.id === socket.id;
          const showRole = isRevealed || (isMe && room.status === 'playing');

          return (
            <motion.div
              key={player.id}
              whileHover={{ scale: isMyTurn && !isRevealed && !isMe ? 1.05 : 1 }}
              whileTap={{ scale: 0.95 }}
              className={`game-card ${isRevealed ? player.role.toLowerCase() : ''}`}
              onClick={() => isMyTurn && !isRevealed && !isMe && handleGuess(player.id)}
            >
              <div style={{ marginBottom: 8, fontWeight: 600 }}>{player.name}</div>

              <AnimatePresence mode="wait">
                {showRole ? (
                  <motion.div
                    initial={{ rotateY: 90 }}
                    animate={{ rotateY: 0 }}
                    className={`role-badge badge-${player.role?.toLowerCase()}`}
                  >
                    {player.role === 'Raja' && <Crown size={16} />}
                    {player.role === 'Rani' && <User size={16} />}
                    {player.role === 'Sipahi' && <Shield size={16} />}
                    {player.role === 'Chor' && <Ghost size={16} />}
                    <span style={{ marginLeft: 4 }}>{player.role}</span>
                  </motion.div>
                ) : (
                  <div key="hidden" style={{ fontSize: 24 }}>❓</div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>

      {room.status === 'round_ended' && (
        <div style={{ marginTop: 24 }}>
          <h3 style={{ marginBottom: 12 }}>Scoreboard</h3>
          {room.players.sort((a, b) => b.totalScore - a.totalScore).map(p => (
            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
              <span>{p.name}</span>
              <span className="highlight">{p.totalScore} pts</span>
            </div>
          ))}
          <button className="btn" style={{ marginTop: 20 }} onClick={nextRound}>
            Next Round
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
