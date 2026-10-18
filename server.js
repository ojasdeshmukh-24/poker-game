const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const RoomManager = require('./game/room-manager');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Room manager
const roomManager = new RoomManager();

// Track socket.id -> { playerId, roomId }
const socketMap = new Map();

// Track roomId -> turn timer Timeout
const turnTimers = new Map();

// Periodic cleanup of empty rooms (every 5 minutes)
setInterval(() => {
  roomManager.cleanupEmptyRooms();
}, 5 * 60 * 1000);

// Periodic tournament blinds check (every 5 seconds)
setInterval(() => {
  for (const [roomId, room] of roomManager.rooms) {
    const result = roomManager.checkTournamentBlinds(roomId);
    if (result.increased) {
      io.to(roomId).emit('room-update', { room: room.toJSON() });
      broadcastGameState(roomId);
      io.to(roomId).emit('chat-message', {
        playerName: 'Tournament Director',
        message: `🏆 LEVEL ${result.level} BLINDS! Small Blind: ${result.smallBlind.toLocaleString()} / Big Blind: ${result.bigBlind.toLocaleString()}.`,
        timestamp: Date.now()
      });
    }
  }
}, 5000);

/**
 * Sends personalized game state to each player in a room.
 * @param {string} roomId
 */
function broadcastGameState(roomId) {
  const room = roomManager.getRoom(roomId);
  if (!room || !room.game) return;

  // Send each player their personalized state, transformed for the frontend
  for (const player of room.players) {
    const rawState = room.game.getStateForPlayer(player.id);
    const socketId = getSocketIdForPlayer(player.id);
    if (!socketId) continue;

    // Find this player's index in the game
    const myIndex = rawState.players.findIndex(p => p.id === player.id);
    const myPlayer = myIndex >= 0 ? rawState.players[myIndex] : null;
    const isMyTurn = rawState.currentPlayerIndex === myIndex && rawState.roundInProgress;
    const availableActions = room.game.getAvailableActions(player.id);

    // Transform available actions to include callAmount
    const transformedActions = availableActions.map(a => {
      if (a.action === 'call' && myPlayer) {
        return { ...a, callAmount: a.amount || Math.min(rawState.currentBet - (myPlayer.bet || 0), myPlayer.chips) };
      }
      return a;
    });

    // Build frontend-shaped state
    const clientState = {
      phase: rawState.phase,
      communityCards: rawState.communityCards,
      pot: rawState.pot,
      currentBet: rawState.currentBet,
      dealerIndex: rawState.dealerIndex,
      currentPlayerIndex: rawState.currentPlayerIndex,
      roundInProgress: rawState.roundInProgress,
      hostId: room.hostId,
      isHost: (room.hostId === player.id),
      players: rawState.players.map(p => ({
        id: p.id,
        name: p.name,
        chips: p.chips,
        bet: p.bet,
        folded: p.folded,
        allIn: p.allIn,
        seatIndex: (room.players.find(rp => rp.id === p.id) || {}).seatIndex || 0,
        connected: (room.players.find(rp => rp.id === p.id) || {}).connected !== false,
        isBot: !!p.isBot,
        isSpectator: !!(room.players.find(rp => rp.id === p.id) || {}).isSpectator,
        hasCards: p.cards && p.cards.length > 0 && p.cards.some(c => c !== null)
      })),
      handStrength: rawState.handStrength || null,
      myCards: myPlayer ? myPlayer.cards : [],
      myIndex,
      myId: player.id,
      isMyTurn,
      availableActions: transformedActions
    };

    io.to(socketId).emit('game-state', { state: clientState });
  }
}

/**
 * Finds the socket ID for a given player ID.
 * @param {string} playerId
 * @returns {string|null}
 */
function getSocketIdForPlayer(playerId) {
  for (const [socketId, data] of socketMap) {
    if (data.playerId === playerId) {
      return socketId;
    }
  }
  return null;
}

/**
 * Sets up game event listeners for a PokerGame instance.
 * @param {PokerGame} game
 * @param {string} roomId
 */
function setupGameListeners(game, roomId) {
  // Remove any existing listeners
  game.removeAllListeners();

  game.on('stateUpdate', () => {
    broadcastGameState(roomId);

    // Turn timer management (Shot Clock & Bot handling)
    if (turnTimers.has(roomId)) {
      clearTimeout(turnTimers.get(roomId));
      turnTimers.delete(roomId);
    }

    const room = roomManager.getRoom(roomId);
    if (room && room.game && room.game.roundInProgress) {
      const currentIdx = room.game.currentPlayerIndex;
      if (currentIdx >= 0 && currentIdx < room.game.players.length) {
        const currentPlayer = room.game.players[currentIdx];

        // 1. Auto-fold disconnected human player
        const playerInRoom = room.players.find(p => p.id === currentPlayer.id);
        if (playerInRoom && !playerInRoom.connected && !currentPlayer.isBot) {
          console.log(`[Game] Auto-folding disconnected player ${currentPlayer.name}`);
          try {
            room.game.handleAction(currentPlayer.id, 'fold');
          } catch (e) {
            console.error(`[Game] Error auto-folding: ${e.message}`);
          }
          return;
        }

        // 2. Broadcast turn timer to clients
        const duration = (room.settings && room.settings.turnTimerSeconds) || 25;
        io.to(roomId).emit('turn-timer', {
          playerId: currentPlayer.id,
          playerName: currentPlayer.name,
          duration,
          startedAt: Date.now()
        });

        // 3. Automated bot move or Shot Clock countdown
        if (currentPlayer.isBot) {
          const botDelay = 1200 + Math.floor(Math.random() * 800);
          const botTimeout = setTimeout(() => {
            try {
              if (room.game && room.game.roundInProgress && room.game.currentPlayerIndex === currentIdx) {
                const { decideBotAction } = require('./game/bot-player');
                const botDecision = decideBotAction(room.game, currentPlayer);
                console.log(`[Bot] ${currentPlayer.name} plays ${botDecision.action} ${botDecision.amount || ''}`);
                room.game.handleAction(currentPlayer.id, botDecision.action, botDecision.amount);
              }
            } catch (err) {
              console.error(`[Bot] Error during bot action: ${err.message}`);
              try {
                room.game.handleAction(currentPlayer.id, 'fold');
              } catch (e) {}
            }
          }, botDelay);
          turnTimers.set(roomId, botTimeout);
        } else {
          // Human turn timeout
          const timeout = setTimeout(() => {
            try {
              if (room.game && room.game.roundInProgress && room.game.currentPlayerIndex === currentIdx) {
                const availableActions = room.game.getAvailableActions(currentPlayer.id);
                const canCheck = availableActions.some(a => a.action === 'check');
                const action = canCheck ? 'check' : 'fold';
                console.log(`[Timer] Player ${currentPlayer.name} timed out. Auto-${action}ing.`);

                room.game.handleAction(currentPlayer.id, action, 0);

                io.to(roomId).emit('chat-message', {
                  playerName: 'Shot Clock',
                  message: `⏱️ ${currentPlayer.name} ran out of time and ${action}ed.`,
                  timestamp: Date.now()
                });
              }
            } catch (err) {
              console.error(`[Timer] Error auto-acting on timeout: ${err.message}`);
            }
          }, duration * 1000);
          turnTimers.set(roomId, timeout);
        }
      } else {
        io.to(roomId).emit('turn-timer', null);
      }
    } else {
      io.to(roomId).emit('turn-timer', null);
    }
  });

  game.on('roundEnd', (result) => {
    if (turnTimers.has(roomId)) {
      clearTimeout(turnTimers.get(roomId));
      turnTimers.delete(roomId);
    }
    io.to(roomId).emit('turn-timer', null);

    console.log(`[Game] Round ended in room ${roomId}`);
    result.winners.forEach(w => {
      console.log(`[Game] Winner: ${w.name} won ${w.amount} chips${w.hand ? ' with ' + w.hand.name : ''}`);
    });

    // Update player chips in room
    const room = roomManager.getRoom(roomId);
    if (room && room.game) {
      for (const gamePlayer of room.game.players) {
        const roomPlayer = room.players.find(p => p.id === gamePlayer.id);
        if (roomPlayer) {
          roomPlayer.chips = gamePlayer.chips;
        }
      }
    }

    // Transform round result for frontend
    const { evaluateBestHand } = require('./game/hand-evaluator');
    const transformedWinners = result.winners.map(w => ({
      id: w.id,
      name: w.name,
      amount: w.amount,
      handName: w.hand ? w.hand.name : null
    }));

    // Transform showCards to include hand evaluation
    const transformedHands = {};
    if (result.showCards && result.communityCards && result.communityCards.length === 5) {
      for (const [playerId, cards] of Object.entries(result.showCards)) {
        try {
          const allCards = [...cards, ...result.communityCards];
          const hand = evaluateBestHand(allCards);
          transformedHands[playerId] = {
            cards,
            handName: hand.name,
            rank: hand.rank
          };
        } catch (e) {
          transformedHands[playerId] = { cards, handName: null, rank: null };
        }
      }
    } else if (result.showCards) {
      for (const [playerId, cards] of Object.entries(result.showCards)) {
        transformedHands[playerId] = { cards, handName: null, rank: null };
      }
    }

    io.to(roomId).emit('round-result', {
      winners: transformedWinners,
      playerHands: transformedHands,
      communityCards: result.communityCards
    });
  });

  game.on('gameEnd', (result) => {
    if (turnTimers.has(roomId)) {
      clearTimeout(turnTimers.get(roomId));
      turnTimers.delete(roomId);
    }
    io.to(roomId).emit('turn-timer', null);

    console.log(`[Game] Game ended in room ${roomId}. Winner: ${result.winner ? result.winner.name : 'none'}`);
    const room = roomManager.getRoom(roomId);
    if (room) {
      room.status = 'waiting';
      room.game = null;
    }
    io.to(roomId).emit('game-end', {
      winner: result.winner ? { id: result.winner.id, name: result.winner.name } : null
    });
  });
}

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);

  /**
   * Create a new room
   */
  socket.on('create-room', ({ playerName, settings }, callback) => {
    try {
      if (!playerName || typeof playerName !== 'string') {
        return callback({ success: false, error: 'Player name is required' });
      }

      const playerId = socket.id;
      const room = roomManager.createRoom(playerId, playerName.trim(), settings || {});

      socketMap.set(socket.id, { playerId, roomId: room.id });
      socket.join(room.id);

      callback({ success: true, roomId: room.id, playerId, room: room.toJSON() });
    } catch (error) {
      console.error(`[Socket] Error creating room: ${error.message}`);
      callback({ success: false, error: error.message });
    }
  });

  /**
   * Join an existing room
   */
  socket.on('join-room', ({ roomId, playerName }, callback) => {
    try {
      if (!roomId || typeof roomId !== 'string') {
        return callback({ success: false, error: 'Room ID is required' });
      }
      if (!playerName || typeof playerName !== 'string') {
        return callback({ success: false, error: 'Player name is required' });
      }

      const normalizedRoomId = roomId.trim().toUpperCase();
      const playerId = socket.id;

      const room = roomManager.joinRoom(normalizedRoomId, playerId, playerName.trim());

      socketMap.set(socket.id, { playerId, roomId: normalizedRoomId });
      socket.join(normalizedRoomId);

      // Notify all players in the room
      io.to(normalizedRoomId).emit('room-update', { room: room.toJSON() });

      // If game is in progress and this is a reconnecting player, send them the game state
      if (room.game) {
        const playerState = room.game.getStateForPlayer(playerId);
        socket.emit('game-state', { state: playerState });
      }

      callback({ success: true, roomId: normalizedRoomId, playerId, room: room.toJSON() });
    } catch (error) {
      console.error(`[Socket] Error joining room: ${error.message}`);
      callback({ success: false, error: error.message });
    }
  });

  /**
   * Start the game (host only)
   */
  socket.on('start-game', (callback) => {
    try {
      const socketData = socketMap.get(socket.id);
      if (!socketData) {
        return callback({ success: false, error: 'Not in a room' });
      }

      const { playerId, roomId } = socketData;
      const game = roomManager.startGame(roomId, playerId);

      setupGameListeners(game, roomId);
      game.startRound();

      callback({ success: true });
    } catch (error) {
      console.error(`[Socket] Error starting game: ${error.message}`);
      callback({ success: false, error: error.message });
    }
  });

  /**
   * Handle player action (fold, check, call, raise)
   */
  socket.on('player-action', ({ action, amount }, callback) => {
    try {
      const socketData = socketMap.get(socket.id);
      if (!socketData) {
        return callback({ success: false, error: 'Not in a room' });
      }

      const { playerId, roomId } = socketData;
      roomManager.handleAction(roomId, playerId, action, amount);

      callback({ success: true });
    } catch (error) {
      console.error(`[Socket] Error handling action: ${error.message}`);
      callback({ success: false, error: error.message });
    }
  });

  /**
   * Start a new round (after previous round ended)
   */
  socket.on('new-round', (callback) => {
    try {
      const socketData = socketMap.get(socket.id);
      if (!socketData) {
        return callback({ success: false, error: 'Not in a room' });
      }

      const { playerId, roomId } = socketData;
      const room = roomManager.getRoom(roomId);

      if (!room) {
        return callback({ success: false, error: 'Room not found' });
      }

      // Check if players have chips
      let playersWithChips = room.players.filter(p => p.connected && p.chips > 0);
      if (playersWithChips.length < 2) {
        // Automatically replenish chips if someone busted so they can keep playing
        for (const p of room.players) {
          p.chips = room.settings.startingChips;
        }
        playersWithChips = room.players.filter(p => p.connected);
      }

      if (playersWithChips.length < 2) {
        return callback({ success: false, error: 'Need at least 2 connected players' });
      }

      if (!room.game) {
        // Need to recreate the game if it was ended
        const PokerGame = require('./game/poker-game');
        room.game = new PokerGame(
          playersWithChips.map(p => ({ id: p.id, name: p.name, chips: p.chips })),
          room.settings.smallBlind,
          room.settings.bigBlind
        );
        room.status = 'playing';
        setupGameListeners(room.game, roomId);
      }

      if (room.game.roundInProgress) {
        return callback({ success: false, error: 'Round is already in progress' });
      }

      room.game.startRound();
      callback({ success: true });
    } catch (error) {
      console.error(`[Socket] Error starting new round: ${error.message}`);
      callback({ success: false, error: error.message });
    }
  });

  /**
   * Reset game (reset all chips to starting amount and deal fresh hand)
   */
  socket.on('reset-game', (callback) => {
    try {
      const socketData = socketMap.get(socket.id);
      if (!socketData) return callback({ success: false, error: 'Not in a room' });
      const { roomId } = socketData;
      const room = roomManager.getRoom(roomId);
      if (!room) return callback({ success: false, error: 'Room not found' });

      for (const p of room.players) {
        p.chips = room.settings.startingChips;
      }

      const connectedPlayers = room.players.filter(p => p.connected);
      if (connectedPlayers.length < 2) {
        return callback({ success: false, error: 'Need at least 2 connected players' });
      }

      const PokerGame = require('./game/poker-game');
      room.game = new PokerGame(
        connectedPlayers.map(p => ({ id: p.id, name: p.name, chips: p.chips })),
        room.settings.smallBlind,
        room.settings.bigBlind
      );
      room.status = 'playing';
      setupGameListeners(room.game, roomId);
      room.game.startRound();

      io.to(roomId).emit('room-update', { room: room.toJSON() });
      callback({ success: true });
    } catch (error) {
      console.error(`[Socket] Error resetting game: ${error.message}`);
      callback({ success: false, error: error.message });
    }
  });

  /**
   * Player rebuy / re-enter game
   */
  socket.on('player-rebuy', ({ amount }, callback) => {
    try {
      const socketData = socketMap.get(socket.id);
      if (!socketData) return callback({ success: false, error: 'Not in a room' });
      const { roomId, playerId } = socketData;
      const room = roomManager.getRoom(roomId);
      if (!room) return callback({ success: false, error: 'Room not found' });

      const rebuyAmount = parseInt(amount) || room.settings.startingChips || 1000;
      const result = roomManager.addChipsToPlayer(roomId, playerId, rebuyAmount, true);

      io.to(roomId).emit('room-update', { room: room.toJSON() });
      broadcastGameState(roomId);

      io.to(roomId).emit('chat-message', {
        playerName: 'System',
        message: `🔄 ${result.player.name} rebought for ${rebuyAmount.toLocaleString()} chips!`,
        timestamp: Date.now()
      });

      callback({ success: true, chips: result.newChips });
    } catch (error) {
      console.error(`[Socket] Error during rebuy: ${error.message}`);
      callback({ success: false, error: error.message });
    }
  });

  /**
   * Host Power: Add/grant chips to any player
   */
  socket.on('host-add-chips', ({ targetPlayerId, amount }, callback) => {
    try {
      const socketData = socketMap.get(socket.id);
      if (!socketData) return callback({ success: false, error: 'Not in a room' });
      const { roomId, playerId } = socketData;
      const room = roomManager.getRoom(roomId);
      if (!room) return callback({ success: false, error: 'Room not found' });
      if (room.hostId !== playerId) return callback({ success: false, error: 'Only the host can grant chips' });

      const chipAmount = parseInt(amount) || 1000;
      const result = roomManager.addChipsToPlayer(roomId, targetPlayerId, chipAmount);

      io.to(roomId).emit('room-update', { room: room.toJSON() });
      broadcastGameState(roomId);

      io.to(roomId).emit('chat-message', {
        playerName: 'Host Power',
        message: `👑 Host granted ${chipAmount.toLocaleString()} chips to ${result.player.name}!`,
        timestamp: Date.now()
      });

      callback({ success: true, chips: result.newChips });
    } catch (error) {
      console.error(`[Socket] Error granting chips: ${error.message}`);
      callback({ success: false, error: error.message });
    }
  });

  /**
   * Host Power: Kick a player
   */
  socket.on('host-kick-player', ({ targetPlayerId }, callback) => {
    try {
      const socketData = socketMap.get(socket.id);
      if (!socketData) return callback({ success: false, error: 'Not in a room' });
      const { roomId, playerId } = socketData;
      const room = roomManager.getRoom(roomId);
      if (!room) return callback({ success: false, error: 'Room not found' });
      if (room.hostId !== playerId) return callback({ success: false, error: 'Only the host can kick players' });

      const kickedPlayer = roomManager.kickPlayer(roomId, playerId, targetPlayerId);

      // Notify the kicked player's socket
      const targetSocketId = getSocketIdForPlayer(targetPlayerId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('kicked', { message: 'You were kicked from the room by the host.' });
        const targetSocket = io.sockets.sockets.get(targetSocketId);
        if (targetSocket) {
          targetSocket.leave(roomId);
          socketMap.delete(targetSocketId);
        }
      }

      io.to(roomId).emit('room-update', { room: room.toJSON() });
      broadcastGameState(roomId);

      io.to(roomId).emit('chat-message', {
        playerName: 'Host Power',
        message: `👑 ${kickedPlayer.name} was removed from the game by the host.`,
        timestamp: Date.now()
      });

      callback({ success: true });
    } catch (error) {
      console.error(`[Socket] Error kicking player: ${error.message}`);
      callback({ success: false, error: error.message });
    }
  });

  /**
   * Host Power: Change blinds
   */
  socket.on('host-change-blinds', ({ smallBlind, bigBlind }, callback) => {
    try {
      const socketData = socketMap.get(socket.id);
      if (!socketData) return callback({ success: false, error: 'Not in a room' });
      const { roomId, playerId } = socketData;
      const room = roomManager.getRoom(roomId);
      if (!room) return callback({ success: false, error: 'Room not found' });
      if (room.hostId !== playerId) return callback({ success: false, error: 'Only the host can change blinds' });

      const newSettings = roomManager.updateSettings(roomId, playerId, { smallBlind, bigBlind });

      io.to(roomId).emit('room-update', { room: room.toJSON() });
      broadcastGameState(roomId);

      io.to(roomId).emit('chat-message', {
        playerName: 'Host Power',
        message: `👑 Blinds updated to ${newSettings.smallBlind} / ${newSettings.bigBlind}`,
        timestamp: Date.now()
      });

      callback({ success: true, settings: newSettings });
    } catch (error) {
      console.error(`[Socket] Error updating blinds: ${error.message}`);
      callback({ success: false, error: error.message });
    }
  });

  /**
   * Host Power: Transfer host
   */
  socket.on('host-transfer', ({ targetPlayerId }, callback) => {
    try {
      const socketData = socketMap.get(socket.id);
      if (!socketData) return callback({ success: false, error: 'Not in a room' });
      const { roomId, playerId } = socketData;
      const room = roomManager.getRoom(roomId);
      if (!room) return callback({ success: false, error: 'Room not found' });
      if (room.hostId !== playerId) return callback({ success: false, error: 'Only the host can transfer host powers' });

      const newHost = roomManager.transferHost(roomId, playerId, targetPlayerId);

      io.to(roomId).emit('room-update', { room: room.toJSON() });
      broadcastGameState(roomId);

      io.to(roomId).emit('chat-message', {
        playerName: 'Host Power',
        message: `👑 Host powers transferred to ${newHost.name}!`,
        timestamp: Date.now()
      });

      callback({ success: true, newHostId: newHost.id });
    } catch (error) {
      console.error(`[Socket] Error transferring host: ${error.message}`);
      callback({ success: false, error: error.message });
    }
  });

  /**
   * Leave room
   */
  socket.on('leave-room', () => {
    handlePlayerDisconnect(socket);
  });

  /**
   * Chat message
   */
  socket.on('chat-message', ({ message }) => {
    const socketData = socketMap.get(socket.id);
    if (!socketData) return;

    const { roomId, playerId } = socketData;
    const room = roomManager.getRoom(roomId);
    if (!room) return;

    const player = room.players.find(p => p.id === playerId);
    if (!player) return;

    io.to(roomId).emit('chat-message', {
      playerName: player.name,
      message: message.substring(0, 200), // Limit message length
      timestamp: Date.now()
    });
  });

  /**
   * Table Reaction (Emoji / Emote)
   */
  socket.on('send-reaction', ({ reaction }) => {
    const socketData = socketMap.get(socket.id);
    if (!socketData) return;

    const { roomId, playerId } = socketData;
    const room = roomManager.getRoom(roomId);
    if (!room) return;

    const player = room.players.find(p => p.id === playerId);
    if (!player) return;

    const allowed = ['🔥', '💸', '🤡', '🚀', '🎣', '💀', '🍅', '🍻', '👏', '😱'];
    if (!allowed.includes(reaction)) return;

    io.to(roomId).emit('table-reaction', {
      playerId,
      playerName: player.name,
      seatIndex: player.seatIndex,
      reaction,
      timestamp: Date.now()
    });
  });

  /**
   * Get Session Ledger (Profit & Loss Tracker)
   */
  socket.on('get-ledger', (callback) => {
    try {
      const socketData = socketMap.get(socket.id);
      if (!socketData) return callback({ success: false, error: 'Not in a room' });
      const { roomId } = socketData;

      const ledger = roomManager.getLedger(roomId);
      callback({ success: true, ledger });
    } catch (e) {
      callback({ success: false, error: e.message });
    }
  });

  /**
   * Host Power: Add AI Bot
   */
  socket.on('host-add-bot', (callback) => {
    try {
      const socketData = socketMap.get(socket.id);
      if (!socketData) return callback({ success: false, error: 'Not in a room' });
      const { roomId, playerId } = socketData;
      const room = roomManager.getRoom(roomId);
      if (!room) return callback({ success: false, error: 'Room not found' });
      if (room.hostId !== playerId) return callback({ success: false, error: 'Only the host can add bots' });

      const bot = roomManager.addBot(roomId, playerId);

      io.to(roomId).emit('room-update', { room: room.toJSON() });
      broadcastGameState(roomId);

      io.to(roomId).emit('chat-message', {
        playerName: 'System',
        message: `🤖 Bot ${bot.name} was added to the table by the host!`,
        timestamp: Date.now()
      });

      callback({ success: true, bot });
    } catch (e) {
      console.error(`[Socket] Error adding bot: ${e.message}`);
      callback({ success: false, error: e.message });
    }
  });

  /**
   * Host Power: Remove AI Bot
   */
  socket.on('host-remove-bot', ({ botId }, callback) => {
    try {
      const socketData = socketMap.get(socket.id);
      if (!socketData) return callback({ success: false, error: 'Not in a room' });
      const { roomId, playerId } = socketData;
      const room = roomManager.getRoom(roomId);
      if (!room) return callback({ success: false, error: 'Room not found' });
      if (room.hostId !== playerId) return callback({ success: false, error: 'Only the host can remove bots' });

      const bot = room.players.find(p => p.id === botId && p.isBot);
      if (!bot) return callback({ success: false, error: 'Bot not found' });

      roomManager.removeBot(roomId, playerId, botId);

      io.to(roomId).emit('room-update', { room: room.toJSON() });
      broadcastGameState(roomId);

      io.to(roomId).emit('chat-message', {
        playerName: 'System',
        message: `🤖 ${bot.name} was removed from the table.`,
        timestamp: Date.now()
      });

      callback({ success: true });
    } catch (e) {
      console.error(`[Socket] Error removing bot: ${e.message}`);
      callback({ success: false, error: e.message });
    }
  });

  /**
   * Host Power: Toggle or configure Tournament Mode
   */
  socket.on('host-set-tournament', ({ enabled, increaseMinutes }, callback) => {
    try {
      const socketData = socketMap.get(socket.id);
      if (!socketData) return callback({ success: false, error: 'Not in a room' });
      const { roomId, playerId } = socketData;
      const room = roomManager.getRoom(roomId);
      if (!room) return callback({ success: false, error: 'Room not found' });
      if (room.hostId !== playerId) return callback({ success: false, error: 'Only the host can configure tournament mode' });

      room.settings.tournamentMode = !!enabled;
      if (increaseMinutes) room.settings.blindIncreaseMinutes = parseInt(increaseMinutes);
      room.nextBlindIncreaseTime = room.settings.tournamentMode
        ? Date.now() + (room.settings.blindIncreaseMinutes || 5) * 60 * 1000
        : null;

      io.to(roomId).emit('room-update', { room: room.toJSON() });

      io.to(roomId).emit('chat-message', {
        playerName: 'Tournament Director',
        message: room.settings.tournamentMode
          ? `🏆 Tournament Mode enabled! Blinds will double every ${room.settings.blindIncreaseMinutes} minutes.`
          : '🏆 Tournament Mode disabled.',
        timestamp: Date.now()
      });

      callback({ success: true, settings: room.settings });
    } catch (e) {
      callback({ success: false, error: e.message });
    }
  });

  /**
   * Handle disconnection
   */
  socket.on('disconnect', (reason) => {
    console.log(`[Socket] Client disconnected: ${socket.id} (${reason})`);
    handlePlayerDisconnect(socket);
  });
});

/**
 * Handles a player disconnecting from the server.
 * @param {Socket} socket
 */
function handlePlayerDisconnect(socket) {
  const socketData = socketMap.get(socket.id);
  if (!socketData) return;

  const { playerId, roomId } = socketData;
  const room = roomManager.getRoom(roomId);

  if (room) {
    const player = room.players.find(p => p.id === playerId);
    const playerName = player ? player.name : 'Unknown';

    roomManager.leaveRoom(roomId, playerId);

    // Notify remaining players
    io.to(roomId).emit('player-disconnected', { playerId, playerName });
    io.to(roomId).emit('room-update', { room: room.toJSON() });

    // If game is in progress and it's the disconnected player's turn, auto-fold
    if (room.game && room.game.roundInProgress) {
      const currentIdx = room.game.currentPlayerIndex;
      if (currentIdx >= 0 && room.game.players[currentIdx].id === playerId) {
        console.log(`[Game] Auto-folding disconnected player ${playerName}`);
        try {
          room.game.handleAction(playerId, 'fold');
        } catch (e) {
          console.error(`[Game] Error auto-folding: ${e.message}`);
        }
      }
    }

    // Schedule room cleanup if all players disconnected
    if (room.players.every(p => !p.connected)) {
      setTimeout(() => {
        const currentRoom = roomManager.getRoom(roomId);
        if (currentRoom && currentRoom.players.every(p => !p.connected)) {
          console.log(`[Room] Cleaning up room ${roomId} (all players disconnected)`);
          for (const p of currentRoom.players) {
            roomManager.playerRoomMap.delete(p.id);
          }
          roomManager.rooms.delete(roomId);
        }
      }, 60000); // 1 minute timeout
    }
  }

  socketMap.delete(socket.id);
  socket.leave(roomId);
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    rooms: roomManager.rooms.size,
    connections: socketMap.size
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`Poker server running at http://localhost:${PORT}`);
  console.log(`Share this URL with friends to play together!`);
});

module.exports = { app, server, io };
