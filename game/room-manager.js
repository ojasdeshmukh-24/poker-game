const PokerGame = require('./poker-game');
const { BOT_NAMES } = require('./bot-player');

/**
 * Generates a random 6-character uppercase alphanumeric room code.
 * @returns {string}
 */
function generateRoomId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

class Room {
  /**
   * @param {string} id - 6-char alphanumeric code
   * @param {string} hostId - ID of the host player
   * @param {object} settings
   */
  constructor(id, hostId, settings = {}) {
    this.id = id;
    this.hostId = hostId;
    this.players = [];
    this.game = null;
    this.status = 'waiting'; // 'waiting' | 'playing'
    this.settings = {
      smallBlind: settings.smallBlind || 10,
      bigBlind: settings.bigBlind || 20,
      startingChips: settings.startingChips || 1000,
      maxPlayers: settings.maxPlayers || 8,
      turnTimerSeconds: settings.turnTimerSeconds || 25,
      tournamentMode: !!settings.tournamentMode,
      blindIncreaseMinutes: settings.blindIncreaseMinutes || 5
    };
    this.blindLevel = 1;
    this.nextBlindIncreaseTime = this.settings.tournamentMode
      ? Date.now() + this.settings.blindIncreaseMinutes * 60 * 1000
      : null;
    this.createdAt = Date.now();
  }

  /**
   * Gets the next available seat index (0-7).
   * @returns {number} Available seat index, or -1 if full.
   */
  getNextAvailableSeat() {
    const takenSeats = new Set(this.players.filter(p => !p.isSpectator).map(p => p.seatIndex));
    for (let i = 0; i < this.settings.maxPlayers; i++) {
      if (!takenSeats.has(i)) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Returns a serialized version of the room for sending to clients.
   * @returns {object}
   */
  toJSON() {
    return {
      id: this.id,
      hostId: this.hostId,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        chips: p.chips,
        seatIndex: p.seatIndex,
        connected: p.connected,
        isBot: !!p.isBot,
        isSpectator: !!p.isSpectator,
        totalBuyIn: p.totalBuyIn || this.settings.startingChips,
        rebuys: p.rebuys || 0
      })),
      status: this.status,
      settings: { ...this.settings },
      tournament: {
        enabled: !!this.settings.tournamentMode,
        level: this.blindLevel,
        nextIncreaseTime: this.nextBlindIncreaseTime,
        minutes: this.settings.blindIncreaseMinutes
      },
      createdAt: this.createdAt
    };
  }
}

class RoomManager {
  constructor() {
    /** @type {Map<string, Room>} */
    this.rooms = new Map();

    /** @type {Map<string, string>} playerIdToRoomId */
    this.playerRoomMap = new Map();
  }

  /**
   * Creates a new room.
   * @param {string} hostId
   * @param {string} hostName
   * @param {object} settings
   * @returns {Room}
   */
  createRoom(hostId, hostName, settings = {}) {
    // Generate unique room ID
    let roomId;
    do {
      roomId = generateRoomId();
    } while (this.rooms.has(roomId));

    const room = new Room(roomId, hostId, settings);

    // Add host as first player
    const seatIndex = room.getNextAvailableSeat();
    room.players.push({
      id: hostId,
      name: hostName,
      chips: room.settings.startingChips,
      seatIndex,
      connected: true,
      totalBuyIn: room.settings.startingChips,
      rebuys: 0,
      isBot: false,
      isSpectator: false
    });

    this.rooms.set(roomId, room);
    this.playerRoomMap.set(hostId, roomId);

    console.log(`[Room] Created room ${roomId} by ${hostName} (${hostId})`);
    return room;
  }

  /**
   * Adds a player to an existing room.
   * @param {string} roomId
   * @param {string} playerId
   * @param {string} playerName
   * @returns {Room}
   */
  joinRoom(roomId, playerId, playerName) {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error('Room not found');
    }

    // Check if player is already in this room (reconnect)
    const existingPlayer = room.players.find(p => p.id === playerId);
    if (existingPlayer) {
      existingPlayer.connected = true;
      existingPlayer.name = playerName;
      console.log(`[Room] Player ${playerName} (${playerId}) reconnected to room ${roomId}`);
      return room;
    }

    // Check if player is trying to rejoin by name (reconnection with new socket)
    const playerByName = room.players.find(p => p.name.trim().toLowerCase() === playerName.trim().toLowerCase());
    if (playerByName) {
      const oldId = playerByName.id;
      // Remove old mapping
      this.playerRoomMap.delete(oldId);
      // Update player ID and reconnect
      playerByName.id = playerId;
      playerByName.connected = true;
      this.playerRoomMap.set(playerId, roomId);

      // If this player was host, update room.hostId
      if (room.hostId === oldId) {
        room.hostId = playerId;
      }

      // If game is in progress, update player ID in game.players
      if (room.game) {
        const gamePlayer = room.game.players.find(p => p.id === oldId);
        if (gamePlayer) {
          gamePlayer.id = playerId;
          gamePlayer.connected = true;
        }
      }

      console.log(`[Room] Player ${playerName} reconnected to room ${roomId} with new ID ${playerId}`);
      return room;
    }

    // Check available seats; if full, join as spectator
    const seatIndex = room.getNextAvailableSeat();
    const isSpectator = seatIndex === -1;

    const newPlayer = {
      id: playerId,
      name: playerName,
      chips: isSpectator ? 0 : room.settings.startingChips,
      seatIndex: isSpectator ? -1 : seatIndex,
      connected: true,
      totalBuyIn: isSpectator ? 0 : room.settings.startingChips,
      rebuys: 0,
      isBot: false,
      isSpectator
    };
    room.players.push(newPlayer);
    this.playerRoomMap.set(playerId, roomId);

    // If game is in progress and not spectator, add them to game.players so they participate in next hand
    if (room.game && !isSpectator) {
      room.game.players.push({
        id: playerId,
        name: playerName,
        chips: room.settings.startingChips,
        cards: [],
        bet: 0,
        totalBet: 0,
        folded: true, // will join on the next round
        allIn: false,
        hasActed: true,
        connected: true,
        isBot: false
      });
    }

    console.log(`[Room] Player ${playerName} (${playerId}) joined room ${roomId}${isSpectator ? ' as spectator' : (room.status === 'playing' ? ' (waiting for next hand)' : '')}`);
    return room;
  }


  /**
   * Removes a player from a room.
   * @param {string} roomId
   * @param {string} playerId
   * @returns {Room|null}
   */
  leaveRoom(roomId, playerId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    const playerIndex = room.players.findIndex(p => p.id === playerId);
    if (playerIndex === -1) return room;

    const player = room.players[playerIndex];

    if (room.status === 'playing') {
      // Mark as disconnected during a game
      player.connected = false;
      console.log(`[Room] Player ${player.name} (${playerId}) disconnected from room ${roomId} (game in progress)`);
    } else {
      // Remove from room if not in a game
      room.players.splice(playerIndex, 1);
      this.playerRoomMap.delete(playerId);
      console.log(`[Room] Player ${player.name} (${playerId}) left room ${roomId}`);

      // If host left, assign new host
      if (room.hostId === playerId && room.players.length > 0) {
        room.hostId = room.players[0].id;
        console.log(`[Room] New host: ${room.players[0].name} (${room.hostId})`);
      }
    }

    // If room is empty, remove it
    if (room.players.length === 0 || room.players.every(p => !p.connected)) {
      // Schedule cleanup
      console.log(`[Room] Room ${roomId} marked for cleanup (no connected players)`);
    }

    return room;
  }

  /**
   * Gets a room by ID.
   * @param {string} roomId
   * @returns {Room|undefined}
   */
  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  /**
   * Starts the game in a room. Only the host can start.
   * @param {string} roomId
   * @param {string} playerId
   * @returns {PokerGame}
   */
  startGame(roomId, playerId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error('Room not found');
    }

    if (room.hostId !== playerId) {
      throw new Error('Only the host can start the game');
    }

    const connectedPlayers = room.players.filter(p => p.connected && !p.isSpectator);
    if (connectedPlayers.length < 2) {
      throw new Error('Need at least 2 connected players to start');
    }

    // Create game with connected players
    const gamePlayers = connectedPlayers.map(p => ({
      id: p.id,
      name: p.name,
      chips: p.chips,
      connected: p.connected,
      isBot: !!p.isBot
    }));

    room.game = new PokerGame(gamePlayers, room.settings.smallBlind, room.settings.bigBlind);
    room.status = 'playing';

    console.log(`[Room] Game started in room ${roomId} with ${gamePlayers.length} players`);
    return room.game;
  }

  /**
   * Handles a player action in a game.
   * @param {string} roomId
   * @param {string} playerId
   * @param {string} action
   * @param {number} amount
   * @returns {object}
   */
  handleAction(roomId, playerId, action, amount) {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error('Room not found');
    }

    if (!room.game) {
      throw new Error('No game in progress');
    }

    return room.game.handleAction(playerId, action, amount);
  }

  /**
   * Finds which room a player is in.
   * @param {string} playerId
   * @returns {Room|undefined}
   */
  getRoomForPlayer(playerId) {
    const roomId = this.playerRoomMap.get(playerId);
    if (!roomId) return undefined;
    return this.rooms.get(roomId);
  }

  /**
   * Adds chips to a player (rebuy or host chip grant).
   */
  addChipsToPlayer(roomId, playerId, amount, isRebuy = false) {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('Room not found');

    const player = room.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not in room');

    player.chips += amount;
    if (isRebuy) {
      player.totalBuyIn = (player.totalBuyIn || 0) + amount;
      player.rebuys = (player.rebuys || 0) + 1;
    }

    if (room.game) {
      let gamePlayer = room.game.players.find(p => p.id === playerId);
      if (gamePlayer) {
        gamePlayer.chips += amount;
        // If round not in progress and had 0 chips, allow them back in
        if (!room.game.roundInProgress && gamePlayer.chips > 0) {
          gamePlayer.folded = false;
        }
      } else {
        // Player wasn't in game yet, add them
        room.game.players.push({
          id: player.id,
          name: player.name,
          chips: player.chips,
          cards: [],
          bet: 0,
          totalBet: 0,
          folded: room.game.roundInProgress ? true : false,
          allIn: false,
          hasActed: room.game.roundInProgress ? true : false,
          connected: true
        });
      }
    }

    return { player, newChips: player.chips };
  }

  /**
   * Kicks a player from the room (host only).
   */
  kickPlayer(roomId, hostId, targetPlayerId) {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('Room not found');
    if (room.hostId !== hostId) throw new Error('Only the host can kick players');
    if (hostId === targetPlayerId) throw new Error('Host cannot kick themselves');

    const playerIndex = room.players.findIndex(p => p.id === targetPlayerId);
    if (playerIndex === -1) throw new Error('Player not found in room');

    const player = room.players[playerIndex];
    room.players.splice(playerIndex, 1);
    this.playerRoomMap.delete(targetPlayerId);

    if (room.game) {
      const gamePlayer = room.game.players.find(p => p.id === targetPlayerId);
      if (gamePlayer) {
        gamePlayer.connected = false;
        gamePlayer.folded = true;
        // If it was currently their turn, fold them
        if (room.game.roundInProgress && room.game.currentPlayerIndex >= 0) {
          if (room.game.players[room.game.currentPlayerIndex].id === targetPlayerId) {
            try {
              room.game.handleAction(targetPlayerId, 'fold');
            } catch (e) {
              console.error('Error auto-folding kicked player:', e.message);
            }
          }
        }
      }
    }

    return player;
  }

  /**
   * Updates game settings like blinds (host only).
   */
  updateSettings(roomId, hostId, newSettings) {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('Room not found');
    if (room.hostId !== hostId) throw new Error('Only the host can change settings');

    if (newSettings.smallBlind) {
      room.settings.smallBlind = parseInt(newSettings.smallBlind);
      if (room.game) room.game.smallBlind = room.settings.smallBlind;
    }
    if (newSettings.bigBlind) {
      room.settings.bigBlind = parseInt(newSettings.bigBlind);
      if (room.game) {
        room.game.bigBlind = room.settings.bigBlind;
        room.game.minRaise = room.settings.bigBlind;
      }
    }

    return room.settings;
  }

  /**
   * Transfers host powers to another player (host only).
   */
  transferHost(roomId, hostId, newHostId) {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('Room not found');
    if (room.hostId !== hostId) throw new Error('Only the host can transfer host powers');

    const targetPlayer = room.players.find(p => p.id === newHostId);
    if (!targetPlayer) throw new Error('Target player not in room');

    room.hostId = newHostId;
    return targetPlayer;
  }

  /**
   * Adds an AI Bot to the room (host only).
   */
  addBot(roomId, hostId) {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('Room not found');
    if (room.hostId !== hostId) throw new Error('Only the host can add bots');

    const seatIndex = room.getNextAvailableSeat();
    if (seatIndex === -1) throw new Error('No available seats for a bot');

    // Pick an unused bot name
    const existingNames = new Set(room.players.map(p => p.name.toLowerCase()));
    const availableNames = BOT_NAMES.filter(n => !existingNames.has(n.toLowerCase()));
    const botName = availableNames.length > 0
      ? availableNames[Math.floor(Math.random() * availableNames.length)]
      : `Bot ${room.players.filter(p => p.isBot).length + 1}`;

    const botId = `bot_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    const botPlayer = {
      id: botId,
      name: botName,
      chips: room.settings.startingChips,
      seatIndex,
      connected: true,
      totalBuyIn: room.settings.startingChips,
      rebuys: 0,
      isBot: true,
      isSpectator: false
    };

    room.players.push(botPlayer);

    // If game is in progress, also add to active game
    if (room.game) {
      room.game.players.push({
        id: botPlayer.id,
        name: botPlayer.name,
        chips: botPlayer.chips,
        cards: [],
        bet: 0,
        totalBet: 0,
        folded: true, // Will be dealt into next hand
        allIn: false,
        hasActed: true,
        connected: true,
        isBot: true
      });
    }

    console.log(`[Room] Added bot ${botName} (${botId}) to room ${roomId}`);
    return botPlayer;
  }

  /**
   * Removes an AI Bot from the room (host only).
   */
  removeBot(roomId, hostId, botId) {
    return this.kickPlayer(roomId, hostId, botId);
  }

  /**
   * Returns session ledger tracking buy-ins, current chips, and net profit/loss.
   */
  getLedger(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('Room not found');

    return room.players
      .filter(p => !p.isSpectator)
      .map(p => {
        const totalBuyIn = p.totalBuyIn || room.settings.startingChips;
        return {
          id: p.id,
          name: p.name,
          chips: p.chips,
          totalBuyIn,
          rebuys: p.rebuys || 0,
          netProfit: p.chips - totalBuyIn,
          isBot: !!p.isBot,
          connected: p.connected
        };
      })
      .sort((a, b) => b.netProfit - a.netProfit);
  }

  /**
   * Checks and advances tournament blinds if tournament mode is active.
   */
  checkTournamentBlinds(roomId) {
    const room = this.rooms.get(roomId);
    if (!room || !room.settings.tournamentMode || !room.nextBlindIncreaseTime) {
      return { increased: false };
    }

    if (Date.now() >= room.nextBlindIncreaseTime) {
      room.blindLevel = (room.blindLevel || 1) + 1;
      room.settings.smallBlind *= 2;
      room.settings.bigBlind *= 2;

      if (room.game) {
        room.game.smallBlind = room.settings.smallBlind;
        room.game.bigBlind = room.settings.bigBlind;
        room.game.minRaise = room.settings.bigBlind;
      }

      room.nextBlindIncreaseTime = Date.now() + (room.settings.blindIncreaseMinutes || 5) * 60 * 1000;

      return {
        increased: true,
        level: room.blindLevel,
        smallBlind: room.settings.smallBlind,
        bigBlind: room.settings.bigBlind,
        nextIncreaseTime: room.nextBlindIncreaseTime
      };
    }

    return { increased: false };
  }

  /**
   * Removes empty rooms (no connected players) that have been idle.
   */
  cleanupEmptyRooms() {
    for (const [roomId, room] of this.rooms) {
      if (room.players.every(p => !p.connected)) {
        console.log(`[Room] Cleaning up empty room ${roomId}`);
        for (const player of room.players) {
          this.playerRoomMap.delete(player.id);
        }
        this.rooms.delete(roomId);
      }
    }
  }
}

module.exports = RoomManager;
