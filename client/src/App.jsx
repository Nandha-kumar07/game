import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import Peer from 'peerjs';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, LogIn, Crown, Shield, User, Ghost, Trophy, Mic, MicOff, RefreshCw, Award, Search, HelpCircle, AlertCircle } from 'lucide-react';

import successMp3 from './assets/valthukal-valthuka.mp3';

const BACKEND_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const socket = io(BACKEND_URL);

function App() {
  const [playerName, setPlayerName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [room, setRoom] = useState(null);
  const [isJoined, setIsJoined] = useState(false);
  // Derive localRole from room to stay in sync after swaps
  const localRole = room?.players?.find(p => p.id === socket.id)?.role || null;
  const [message, setMessage] = useState('Waiting for players...');
  const [micOn, setMicOn] = useState(false);
  const [popup, setPopup] = useState(null);

  const peerRef = useRef(null);
  const myStreamRef = useRef(null);
  const peersRef = useRef({});
  const audioRefs = useRef({});

  const successSound = useRef(new Audio(successMp3));
  const errorSound = useRef(new Audio('/sounds/nagarjuna.mp3'));

  useEffect(() => {
    socket.on('room_update', (updatedRoom) => setRoom(updatedRoom));

    socket.on('start_round', (updatedRoom) => {
      setRoom(updatedRoom);
      const me = updatedRoom.players.find(p => p.id === socket.id);
      setMessage(`You are ${me.role}! Let's find your target.`);
    });

    socket.on('guess_success', (updatedRoom) => {
      setRoom(updatedRoom);
      setPopup({ type: 'success', text: 'Valthukal Valthukal!' });
      successSound.current.play().catch(() => { });
      setTimeout(() => setPopup(null), 3000);
    });

    socket.on('guess_wrong', ({ room: updatedRoom, message: msg }) => {
      setRoom(updatedRoom);
      setMessage(msg);
      setPopup({ type: 'error', text: 'Oops! Role Swapped.' });
      errorSound.current.play().catch(() => { });
      setTimeout(() => setPopup(null), 3500);
    });

    socket.on('round_ended', (updatedRoom) => {
      setRoom(updatedRoom);
      setMessage('Round Over! Final Rankings below.');
    });

    return () => {
      socket.off('room_update');
      socket.off('start_round');
      socket.off('guess_success');
      socket.off('guess_wrong');
      socket.off('round_ended');
      if (peerRef.current) peerRef.current.destroy();
    };
  }, []);

  useEffect(() => {
    if (micOn && !peerRef.current && isJoined) initVoice();
    else if (!micOn && peerRef.current) stopVoice();
  }, [micOn, isJoined]);

  const initVoice = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      myStreamRef.current = stream;
      const peer = new Peer(socket.id, {
        config: { 'iceServers': [{ 'urls': 'stun:stun.l.google.com:19302' }] }
      });
      peerRef.current = peer;

      peer.on('call', (call) => {
        call.answer(stream);
        call.on('stream', (remoteStream) => addRemoteAudio(call.peer, remoteStream));
      });

      room.players.forEach(p => {
        if (p.id !== socket.id) {
          const call = peer.call(p.id, stream);
          call.on('stream', (remoteStream) => addRemoteAudio(p.id, remoteStream));
          peersRef.current[p.id] = call;
        }
      });
    } catch (err) {
      console.error('Mic Error:', err);
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
    if (myStreamRef.current) myStreamRef.current.getTracks().forEach(t => t.stop());
    if (peerRef.current) peerRef.current.destroy();
    peerRef.current = null;
    Object.values(audioRefs.current).forEach(a => { a.pause(); a.srcObject = null; });
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
    if (isMyTurn) socket.emit('make_guess', { roomId, targetPlayerId: targetId });
  };

  const isMyTurn = room?.gameState?.currentGuesser === socket.id;

  if (!isJoined) return (
    <div className="glass">
      <motion.h1 initial={{ y: -20 }} animate={{ y: 0 }} style={{ marginBottom: 32, textAlign: 'center', fontSize: 40, fontWeight: 900 }}>👑 Raja Rani</motion.h1>
      <input className="input-field" placeholder="Your Amazing Name" value={playerName} onChange={e => setPlayerName(e.target.value)} />
      <input className="input-field" placeholder="Room ID (e.g. 1234)" value={roomId} onChange={e => setRoomId(e.target.value)} />
      <button className="btn" onClick={joinRoom}><LogIn size={20} /> Join Realm</button>
    </div>
  );

  if (!room || room.status === 'waiting') return (
    <div className="glass">
      <h2 style={{ marginBottom: 20, fontSize: 28, fontWeight: 800 }}>🏰 Lounge: {roomId}</h2>
      <div className="status-text">
        {room?.players.length < 4 ? <RefreshCw className="animate-spin" size={24} style={{ margin: '0 auto 10px' }} /> : <Users size={24} style={{ margin: '0 auto 10px', color: '#4ade80' }} />}
        Waiting for Challengers... ({room?.players.length || 0}/6)
      </div>
      <div style={{ marginTop: 20 }}>
        {room?.players?.map(p => (
          <motion.div initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} key={p.id} className="scoreboard-item" style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <User size={18} /> {p.name} {p.id === socket.id && '(You)'}
            </div>
            {p.id === socket.id && <Crown size={16} color="#fbbf24" />}
          </motion.div>
        ))}
      </div>
      {room?.players?.length >= 4 && (
        <button className="btn" style={{ marginTop: 24, background: 'var(--accent)', color: 'black' }} onClick={() => socket.emit('start_game_manual', roomId)}>
          Start Game
        </button>
      )}
    </div>
  );

  return (
    <div className="glass">
      <AnimatePresence>
        {popup && (
          <motion.div initial={{ scale: 0, y: 50, opacity: 0 }} animate={{ scale: 1.1, y: 0, opacity: 1 }} exit={{ scale: 0, opacity: 0 }} className={`popup-overlay ${popup.type}`}
            style={{ position: 'absolute', top: '25%', left: '5%', right: '5%', zIndex: 100, padding: 40, borderRadius: 24, textAlign: 'center', background: popup.type === 'success' ? 'var(--raja)' : 'var(--thirudan)', border: '4px solid white' }}>
            <div style={{ fontSize: 64 }}>{popup.type === 'success' ? '🏆' : '🎭'}</div>
            <div style={{ fontSize: 24, fontWeight: 900, marginTop: 16 }}>{popup.text}</div>
          </motion.div>
        )}
      </AnimatePresence>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h3 style={{ fontSize: 18, opacity: 0.8 }}>Realm: {roomId}</h3>
        <button onClick={() => setMicOn(!micOn)} style={{ background: micOn ? 'var(--primary-glow)' : 'transparent', border: '1px solid var(--card-border)', borderRadius: '50%', padding: 10, color: micOn ? '#4ade80' : '#94a3b8', cursor: 'pointer' }}>
          {micOn ? <Mic size={24} /> : <MicOff size={24} />}
        </button>
      </div>

      {room.status === 'playing' && (
        <div className="status-text" style={{ fontSize: 16 }}>
          {isMyTurn ? <span className="highlight">🌟 Your Turn to Seek!</span> : <span>{message}</span>}
          <div style={{ fontSize: 10, opacity: 0.6, marginTop: 4 }}>(Roles of others are hidden until found)</div>
        </div>
      )}

      <div className="card-grid">
        {room.players.map(p => {
          const isRevealed = room.gameState.revealedRoles.find(r => r.playerId === p.id);
          const isMe = p.id === socket.id;
          const showRole = isRevealed || (isMe && !p.isFinished);
          const canClick = isMyTurn && !isRevealed && !isMe;

          return (
            <motion.div key={p.id} whileTap={{ scale: 0.95 }} className={`game-card ${p.isFinished ? 'finished' : ''}`}
              onClick={() => canClick && handleGuess(p.id)} style={{ border: canClick ? '2px dashed var(--accent)' : '1px solid var(--card-border)' }}>
              <div style={{ marginBottom: 12, fontWeight: 600, fontSize: 14, opacity: 0.9 }}>
                {p.name} {isMe && <span style={{ color: 'var(--accent)', fontSize: 10 }}>(You)</span>}
              </div>
              <AnimatePresence mode="wait">
                {showRole ? (
                  <motion.div key="role" initial={{ rotateY: 90 }} animate={{ rotateY: 0 }} className={`role-badge badge-${p.role?.toLowerCase().replace(/\s+/g, '-')}`}>
                    {p.role === 'Raja' && <Crown size={14} />}
                    {p.role === 'Rani' && <User size={14} />}
                    {p.role === 'Mantri' && <Trophy size={14} />}
                    {p.role === 'Sipahi' && <Shield size={14} />}
                    {p.role === 'Police' && <Shield size={14} />}
                    {p.role === 'Thirudan' && <Ghost size={14} />}
                    <span style={{ marginLeft: 4 }}>{p.role}</span>
                  </motion.div>
                ) : (
                  <motion.div key="hidden" style={{ fontSize: 32 }}>❓</motion.div>
                )}
              </AnimatePresence>
              {canClick && <motion.div animate={{ opacity: [0.5, 1, 0.5] }} transition={{ repeat: Infinity }} style={{ position: 'absolute', bottom: 8 }}><Search size={16} color="var(--accent)" /></motion.div>}
            </motion.div>
          );
        })}
      </div>

      {room.status === 'round_ended' && (
        <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="glass" style={{ border: 'none', background: 'rgba(255,255,255,0.05)', marginTop: 24 }}>
          <h3 style={{ textAlign: 'center', marginBottom: 20, fontSize: 20, fontWeight: 800 }}>👑 Final Standings</h3>
          <div className="scoreboard-list">
            {(room?.players || []).slice().sort((a, b) => b.totalScore - a.totalScore).map((p, i) => (
              <div key={p.id} className="scoreboard-item" style={{ borderLeft: `4px solid ${i === 0 ? '#ffd700' : 'transparent'}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 24 }}>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '🎖️'}</span>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 16 }}>{p.name}</div>
                    <div style={{ fontSize: 12, opacity: 0.6 }}>{p.role}</div>
                  </div>
                </div>
                <div className="score-val">{p.totalScore}</div>
              </div>
            ))}
          </div>
          <button className="btn" style={{ marginTop: 24, background: 'var(--primary)' }} onClick={() => socket.emit('next_round', roomId)}>Next Realm</button>
        </motion.div>
      )}
    </div>
  );
}

export default App;
