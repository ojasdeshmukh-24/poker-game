const Deck = require('./deck');
const { evaluateBestHand, determineWinners } = require('./hand-evaluator');
const EventEmitter = require('events');

const PHASES = ['preflop', 'flop', 'turn', 'river', 'showdown'];

class PokerGame extends EventEmitter {
  /**
   * @param {Array} players - Array of { id, name, chips }
   * @param {number} smallBlind
   * @param {number} bigBlind
   */
  constructor(players, smallBlind = 10, bigBlind = 20) {
    super();

    if (players.length < 2) {
      throw new Error('Need at least 2 players to start a game');
    }

    this.players = players.map(p => ({
      id: p.id,
      name: p.name,
      chips: p.chips,
      cards: [],
      bet: 0,
      totalBet: 0, // total bet across all phases in this round
      folded: false,
      allIn: false,
      hasActed: false,
      connected: p.connected !== undefined ? p.connected : true
    }));

    this.smallBlind = smallBlind;
    this.bigBlind = bigBlind;
    this.communityCards = [];
    this.pot = 0;
    this.sidePots = [];
    this.currentBet = 0;
    this.deck = new Deck();
    this.dealerIndex = -1; // Will be set to 0 on first round
    this.currentPlayerIndex = -1;
    this.phase = null;
    this.roundInProgress = false;
    this.minRaise = bigBlind;
    this.lastRaiseAmount = bigBlind;
  }

  /**
   * Starts a new round of poker.
   */
  startRound() {
    // Reset round state
    this.deck.reset();
    this.communityCards = [];
    this.pot = 0;
    this.sidePots = [];
    this.currentBet = 0;
    this.roundInProgress = true;
    this.minRaise = this.bigBlind;
    this.lastRaiseAmount = this.bigBlind;

    // Reset player state for new round
    for (const player of this.players) {
      player.cards = [];
      player.bet = 0;
      player.totalBet = 0;
      player.folded = false;
      player.allIn = false;
      player.hasActed = false;
    }

    // Remove players with no chips
    // (keep them in the array but mark as folded so seats are preserved)
    for (const player of this.players) {
      if (player.chips <= 0) {
        player.folded = true;
      }
    }

    // Check if enough active players
    const activePlayers = this.players.filter(p => !p.folded);
    if (activePlayers.length < 2) {
      this.roundInProgress = false;
      this.emit('gameEnd', { winner: activePlayers[0] });
      return;
    }

    // Advance dealer button
    this.dealerIndex = this._getNextActivePlayerIndex(this.dealerIndex);

    // Post blinds
    const sbIndex = activePlayers.length === 2
      ? this.dealerIndex // In heads-up, dealer is small blind
      : this._getNextActivePlayerIndex(this.dealerIndex);
    const bbIndex = this._getNextActivePlayerIndex(sbIndex);

    this._postBlind(sbIndex, this.smallBlind);
    this._postBlind(bbIndex, this.bigBlind);

    this.currentBet = this.bigBlind;

    // Deal hole cards
    for (const player of this.players) {
      if (!player.folded) {
        player.cards = this.deck.deal(2);
      }
    }

    // Set phase to preflop
    this.phase = 'preflop';

    // First to act is player after big blind
    this.currentPlayerIndex = this._getNextActiveNonAllInPlayerIndex(bbIndex);
    if (this.currentPlayerIndex === -1) {
      this.currentPlayerIndex = this._getNextActivePlayerIndex(bbIndex);
    }

    // Mark big blind and small blind as not having acted yet
    // (they still need a chance to act even though they posted blinds)
    for (const player of this.players) {
      player.hasActed = false;
    }

    this.emit('stateUpdate', this._getFullState());
  }

  /**
   * Posts a blind for a player.
   */
  _postBlind(playerIndex, amount) {
    const player = this.players[playerIndex];
    const blindAmount = Math.min(amount, player.chips);
    player.chips -= blindAmount;
    player.bet = blindAmount;
    player.totalBet = blindAmount;
    if (player.chips === 0) {
      player.allIn = true;
    }
  }

  /**
   * Handles a player action: fold, check, call, raise.
   * @param {string} playerId
   * @param {string} action - 'fold' | 'check' | 'call' | 'raise'
   * @param {number} amount - Required for 'raise'
   * @returns {object} Updated state
   */
  handleAction(playerId, action, amount) {
    if (!this.roundInProgress) {
      throw new Error('No round in progress');
    }

    if (this.phase === 'showdown') {
      throw new Error('Round is in showdown phase');
    }

    const playerIndex = this.players.findIndex(p => p.id === playerId);
    if (playerIndex === -1) {
      throw new Error('Player not found');
    }

    if (playerIndex !== this.currentPlayerIndex) {
      throw new Error('Not your turn');
    }

    const player = this.players[playerIndex];

    if (player.folded) {
      throw new Error('Player has folded');
    }

    if (player.allIn) {
      throw new Error('Player is all-in');
    }

    const availableActions = this.getAvailableActions(playerId);
    const actionNames = availableActions.map(a => a.action);

    if (!actionNames.includes(action)) {
      throw new Error(`Action '${action}' is not available. Available: ${actionNames.join(', ')}`);
    }

    switch (action) {
      case 'fold':
        player.folded = true;
        player.hasActed = true;
        break;

      case 'check':
        if (player.bet < this.currentBet) {
          throw new Error('Cannot check, must call or raise');
        }
        player.hasActed = true;
        break;

      case 'call': {
        const callAmount = Math.min(this.currentBet - player.bet, player.chips);
        player.chips -= callAmount;
        player.bet += callAmount;
        player.totalBet += callAmount;
        if (player.chips === 0) {
          player.allIn = true;
        }
        player.hasActed = true;
        break;
      }

      case 'raise': {
        const raiseAction = availableActions.find(a => a.action === 'raise');
        if (!raiseAction) {
          throw new Error('Raise not available');
        }

        // amount is the total bet amount the player wants to have
        let totalRaise = amount;
        if (totalRaise === undefined || totalRaise === null) {
          totalRaise = raiseAction.minAmount;
        }

        // Clamp to min/max
        if (totalRaise > raiseAction.maxAmount) {
          totalRaise = raiseAction.maxAmount;
        }
        if (totalRaise < raiseAction.minAmount) {
          // Allow all-in even if less than minimum raise
          if (totalRaise >= player.chips + player.bet) {
            totalRaise = player.chips + player.bet;
          } else {
            throw new Error(`Minimum raise is ${raiseAction.minAmount}`);
          }
        }

        const raiseBy = totalRaise - this.currentBet;
        if (raiseBy > 0) {
          this.lastRaiseAmount = raiseBy;
        }

        const chipsNeeded = totalRaise - player.bet;
        const actualChips = Math.min(chipsNeeded, player.chips);
        player.chips -= actualChips;
        player.bet += actualChips;
        player.totalBet += actualChips;
        this.currentBet = player.bet;
        this.minRaise = this.currentBet + Math.max(this.lastRaiseAmount, this.bigBlind);

        if (player.chips === 0) {
          player.allIn = true;
        }

        player.hasActed = true;

        // Reset hasActed for other non-folded, non-all-in players
        for (const p of this.players) {
          if (p.id !== playerId && !p.folded && !p.allIn) {
            p.hasActed = false;
          }
        }
        break;
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    // Check if only one player left (everyone else folded)
    const activePlayers = this._getActivePlayers();
    if (activePlayers.length === 1) {
      // Collect bets and award pot to last player
      this._collectBets();
      const winner = activePlayers[0];
      winner.chips += this.pot;

      const result = {
        winners: [{
          id: winner.id,
          name: winner.name,
          amount: this.pot,
          hand: null
        }],
        showCards: {}
      };

      this.pot = 0;
      this.roundInProgress = false;
      this.phase = null;

      this.emit('roundEnd', result);
      this.emit('stateUpdate', this._getFullState());

      // Check if game is over
      const playersWithChips = this.players.filter(p => p.chips > 0);
      if (playersWithChips.length <= 1) {
        this.emit('gameEnd', { winner: playersWithChips[0] || null });
      }

      return result;
    }

    // Advance to next player or next phase
    if (this._isRoundComplete()) {
      this._collectBets();
      this._advancePhase();
    } else {
      this._advanceToNextPlayer();
    }

    this.emit('stateUpdate', this._getFullState());
    return this._getFullState();
  }

  /**
   * Gets available actions for a player.
   * @param {string} playerId
   * @returns {Array} Array of { action, minAmount?, maxAmount? }
   */
  getAvailableActions(playerId) {
    const playerIndex = this.players.findIndex(p => p.id === playerId);
    if (playerIndex === -1) return [];

    const player = this.players[playerIndex];

    if (playerIndex !== this.currentPlayerIndex || player.folded || player.allIn || !this.roundInProgress) {
      return [];
    }

    const actions = [];

    // Can always fold
    actions.push({ action: 'fold' });

    const toCall = this.currentBet - player.bet;

    if (toCall <= 0) {
      // No bet to match
      actions.push({ action: 'check' });
    } else {
      // Must call or fold
      actions.push({ action: 'call', amount: Math.min(toCall, player.chips) });
    }

    // Can raise if player has enough chips
    const minRaiseTotal = Math.max(this.currentBet + Math.max(this.lastRaiseAmount, this.bigBlind), this.currentBet + this.bigBlind);
    const maxRaiseTotal = player.chips + player.bet; // all-in

    if (maxRaiseTotal > this.currentBet) {
      actions.push({
        action: 'raise',
        minAmount: Math.min(minRaiseTotal, maxRaiseTotal), // if can't meet min raise, can still go all-in
        maxAmount: maxRaiseTotal
      });
    }

    return actions;
  }

  /**
   * Returns game state visible to a specific player (hides other players' cards).
   * @param {string} playerId
   * @returns {object}
   */
  getStateForPlayer(playerId) {
    const state = this._getFullState();
    const myPlayer = this.players.find(p => p.id === playerId);
    
    // Live hand strength calculation
    if (myPlayer && myPlayer.cards && myPlayer.cards.length === 2) {
      if (this.communityCards.length >= 3) {
        try {
          const { evaluateBestHand } = require('./hand-evaluator');
          const evalResult = evaluateBestHand([...myPlayer.cards, ...this.communityCards]);
          state.handStrength = {
            name: evalResult.name,
            rank: evalResult.rank
          };
        } catch (e) {
          state.handStrength = null;
        }
      } else {
        const [c1, c2] = myPlayer.cards;
        if (c1.value === c2.value) {
          const names = { 14: 'Aces', 13: 'Kings', 12: 'Queens', 11: 'Jacks', 10: 'Tens' };
          state.handStrength = { name: `Pocket ${names[c1.value] || c1.value + 's'}`, rank: 2 };
        } else {
          const isSuited = c1.suit === c2.suit;
          const highVal = Math.max(c1.value, c2.value);
          const lowVal = Math.min(c1.value, c2.value);
          const isConnected = highVal - lowVal === 1;
          let label = isSuited ? 'Suited' : 'Offsuit';
          if (isConnected) label += ' Connector';
          state.handStrength = { name: label, rank: 1 };
        }
      }
    }

    state.players = state.players.map(p => {
      if (p.id === playerId) {
        return p; // Show own cards
      }
      return { ...p, cards: p.cards.map(() => null) }; // Hide other cards
    });
    return state;
  }

  /**
   * Returns public game state (all cards hidden).
   * @returns {object}
   */
  getPublicState() {
    const state = this._getFullState();
    state.players = state.players.map(p => ({
      ...p,
      cards: p.cards.map(() => null)
    }));
    return state;
  }

  /**
   * Advances to the next active player who hasn't folded and isn't all-in.
   */
  _advanceToNextPlayer() {
    let nextIndex = this.currentPlayerIndex;
    const totalPlayers = this.players.length;

    for (let i = 0; i < totalPlayers; i++) {
      nextIndex = (nextIndex + 1) % totalPlayers;
      const player = this.players[nextIndex];
      if (!player.folded && !player.allIn) {
        this.currentPlayerIndex = nextIndex;
        return;
      }
    }

    // If we get here, all remaining players are all-in (or folded)
    // Force advance through remaining phases
    this.currentPlayerIndex = -1;
  }

  /**
   * Advances to the next game phase.
   */
  _advancePhase() {
    const currentPhaseIndex = PHASES.indexOf(this.phase);

    // Check if all but one (or zero) non-all-in players remain
    const activePlayers = this._getActivePlayers();
    const nonAllInActive = activePlayers.filter(p => !p.allIn);

    if (nonAllInActive.length <= 1 && currentPhaseIndex < 4) {
      // Deal remaining community cards and go to showdown
      while (this.communityCards.length < 5) {
        const needed = this.communityCards.length === 0 ? 3 : 1;
        this._dealCommunityCards(needed);
      }
      this.phase = 'showdown';
      this._handleShowdown();
      return;
    }

    const nextPhase = PHASES[currentPhaseIndex + 1];
    this.phase = nextPhase;

    switch (nextPhase) {
      case 'flop':
        this._dealCommunityCards(3);
        break;
      case 'turn':
        this._dealCommunityCards(1);
        break;
      case 'river':
        this._dealCommunityCards(1);
        break;
      case 'showdown':
        this._handleShowdown();
        return;
    }

    // Reset betting for new phase
    this.currentBet = 0;
    this.lastRaiseAmount = this.bigBlind;
    this.minRaise = this.bigBlind;
    for (const player of this.players) {
      player.bet = 0;
      player.hasActed = false;
    }

    // First to act: first active player after dealer
    this.currentPlayerIndex = this._getNextActiveNonAllInPlayerIndex(this.dealerIndex);

    // If no non-all-in active players, advance to next phase
    if (this.currentPlayerIndex === -1) {
      this._advancePhase();
    }
  }

  /**
   * Deals community cards.
   * @param {number} count
   */
  _dealCommunityCards(count) {
    // Burn a card before dealing community cards
    this.deck.deal(1);
    const cards = this.deck.deal(count);
    this.communityCards.push(...cards);
  }

  /**
   * Handles showdown: evaluates hands, determines winners, distributes pot.
   */
  _handleShowdown() {
    this.roundInProgress = false;

    const activePlayers = this._getActivePlayers();
    const showCards = {};

    // Build player hand data for display
    for (const player of activePlayers) {
      showCards[player.id] = player.cards;
    }

    // Calculate side pots
    const pots = this._calculateSidePots();

    const allWinners = [];

    for (const pot of pots) {
      // Only eligible players for this pot
      const eligiblePlayers = pot.eligible
        .filter(id => {
          const p = this.players.find(pl => pl.id === id);
          return p && !p.folded;
        })
        .map(id => {
          const p = this.players.find(pl => pl.id === id);
          return { id: p.id, cards: p.cards };
        });

      if (eligiblePlayers.length === 0) continue;

      if (eligiblePlayers.length === 1) {
        const winner = this.players.find(p => p.id === eligiblePlayers[0].id);
        winner.chips += pot.amount;
        allWinners.push({
          id: winner.id,
          name: winner.name,
          amount: pot.amount,
          hand: null
        });
      } else {
        const winners = determineWinners(eligiblePlayers, this.communityCards);
        const share = Math.floor(pot.amount / winners.length);
        const remainder = pot.amount - (share * winners.length);

        winners.forEach((w, i) => {
          const winner = this.players.find(p => p.id === w.id);
          const amount = share + (i === 0 ? remainder : 0); // First winner gets remainder
          winner.chips += amount;
          allWinners.push({
            id: winner.id,
            name: winner.name,
            amount,
            hand: w.hand
          });
        });
      }
    }

    // Merge duplicate winner entries (same player winning from multiple pots)
    const mergedWinners = [];
    for (const w of allWinners) {
      const existing = mergedWinners.find(mw => mw.id === w.id);
      if (existing) {
        existing.amount += w.amount;
        if (w.hand && !existing.hand) existing.hand = w.hand;
      } else {
        mergedWinners.push({ ...w });
      }
    }

    this.pot = 0;
    this.phase = null;

    const result = {
      winners: mergedWinners,
      showCards,
      communityCards: this.communityCards
    };

    this.emit('roundEnd', result);
    this.emit('stateUpdate', this._getFullState());

    // Check if game is over
    const playersWithChips = this.players.filter(p => p.chips > 0);
    if (playersWithChips.length <= 1) {
      this.emit('gameEnd', { winner: playersWithChips[0] || null });
    }
  }

  /**
   * Calculates side pots based on player total bets.
   * @returns {Array} Array of { amount, eligible: [playerIds] }
   */
  _calculateSidePots() {
    // Get all players who contributed to the pot (not just active ones for side pot calculation)
    const contributors = this.players
      .filter(p => p.totalBet > 0)
      .map(p => ({ id: p.id, totalBet: p.totalBet, folded: p.folded }))
      .sort((a, b) => a.totalBet - b.totalBet);

    if (contributors.length === 0) {
      return [{ amount: this.pot, eligible: this._getActivePlayers().map(p => p.id) }];
    }

    const pots = [];
    let processedBet = 0;

    // Get unique bet levels
    const betLevels = [...new Set(contributors.map(c => c.totalBet))].sort((a, b) => a - b);

    for (const level of betLevels) {
      const increment = level - processedBet;
      if (increment <= 0) continue;

      // All contributors at or above this level contribute to this pot
      const eligibleContributors = contributors.filter(c => c.totalBet >= level);
      const potAmount = increment * eligibleContributors.length;

      // Only non-folded players are eligible to win
      const eligibleWinners = eligibleContributors
        .filter(c => !c.folded)
        .map(c => c.id);

      if (potAmount > 0) {
        pots.push({ amount: potAmount, eligible: eligibleWinners });
      }

      processedBet = level;
    }

    // If no pots were created, make a simple main pot
    if (pots.length === 0) {
      return [{ amount: this.pot, eligible: this._getActivePlayers().map(p => p.id) }];
    }

    return pots;
  }

  /**
   * Collects all current bets into the pot and resets player bets.
   */
  _collectBets() {
    for (const player of this.players) {
      this.pot += player.bet;
      player.bet = 0;
    }
  }

  /**
   * Returns active players (not folded).
   * @returns {Array}
   */
  _getActivePlayers() {
    return this.players.filter(p => !p.folded);
  }

  /**
   * Checks if the current betting round is complete.
   * All active, non-all-in players must have acted and matched the current bet.
   * @returns {boolean}
   */
  _isRoundComplete() {
    const activePlayers = this._getActivePlayers();
    const nonAllInActive = activePlayers.filter(p => !p.allIn);

    // If no non-all-in active players, round is complete
    if (nonAllInActive.length === 0) return true;

    // All non-all-in active players must have acted and matched the current bet
    return nonAllInActive.every(p => p.hasActed && p.bet === this.currentBet);
  }

  /**
   * Gets the next active (non-folded) player index after the given index.
   */
  _getNextActivePlayerIndex(fromIndex) {
    const totalPlayers = this.players.length;
    for (let i = 1; i <= totalPlayers; i++) {
      const index = (fromIndex + i) % totalPlayers;
      if (!this.players[index].folded) {
        return index;
      }
    }
    return -1;
  }

  /**
   * Gets the next active, non-all-in player index after the given index.
   */
  _getNextActiveNonAllInPlayerIndex(fromIndex) {
    const totalPlayers = this.players.length;
    for (let i = 1; i <= totalPlayers; i++) {
      const index = (fromIndex + i) % totalPlayers;
      if (!this.players[index].folded && !this.players[index].allIn) {
        return index;
      }
    }
    return -1;
  }

  /**
   * Returns full internal game state.
   */
  _getFullState() {
    return {
      phase: this.phase,
      communityCards: this.communityCards,
      pot: this.pot,
      currentBet: this.currentBet,
      dealerIndex: this.dealerIndex,
      currentPlayerIndex: this.currentPlayerIndex,
      currentPlayerId: this.currentPlayerIndex >= 0 ? this.players[this.currentPlayerIndex].id : null,
      roundInProgress: this.roundInProgress,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        chips: p.chips,
        cards: p.cards,
        bet: p.bet,
        totalBet: p.totalBet,
        folded: p.folded,
        allIn: p.allIn,
        hasActed: p.hasActed,
        isBot: !!p.isBot
      }))
    };
  }
}

module.exports = PokerGame;
