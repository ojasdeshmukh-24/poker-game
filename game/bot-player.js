/**
 * Advanced Bot Player AI for Texas Hold'em
 * Features:
 * - Dynamic heads-up & table size adaptation (loose heads-up, balanced full-ring)
 * - True pot odds & draw detection (flush draws, straight draws, overcards)
 * - Board texture analysis (top pair, sets, monster hands)
 * - Bot personality profiles (Phil Ivey, Daniel Negreanu, Doyle Brunson, Phil Hellmuth)
 * - Semi-bluffing, float calls, and river stabs
 */
const { evaluateBestHand } = require('./hand-evaluator');

const BOT_NAMES = [
  'Bot Doyle', 'Bot Phil', 'Bot Daniel', 'Bot Ivey',
  'Bot Negreanu', 'Bot Helmuth', 'Bot Brunson', 'Bot Johnny'
];

/**
 * Calculates preflop hand score (0 - 100).
 */
function calculatePreflopScore(cards) {
  if (!cards || cards.length < 2) return 10;
  const v1 = cards[0].value;
  const v2 = cards[1].value;
  const isPair = v1 === v2;
  const isSuited = cards[0].suit === cards[1].suit;
  const highVal = Math.max(v1, v2);
  const lowVal = Math.min(v1, v2);
  const gap = highVal - lowVal;

  if (isPair) {
    if (highVal === 14) return 100; // AA
    if (highVal === 13) return 96;  // KK
    if (highVal === 12) return 92;  // QQ
    if (highVal === 11) return 88;  // JJ
    if (highVal === 10) return 84;  // TT
    if (highVal >= 7) return 72 + (highVal - 7) * 3; // 99, 88, 77
    return 60 + (highVal - 2) * 2; // 66-22
  }

  let score = 0;
  // High card points
  if (highVal === 14) score += 34;      // Ace
  else if (highVal === 13) score += 26; // King
  else if (highVal === 12) score += 20; // Queen
  else if (highVal === 11) score += 15; // Jack
  else if (highVal === 10) score += 11; // 10
  else score += (highVal - 2) * 1.2;

  // Kicker points
  if (lowVal === 14) score += 25;
  else if (lowVal === 13) score += 20;
  else if (lowVal === 12) score += 15;
  else if (lowVal === 11) score += 11;
  else if (lowVal === 10) score += 8;
  else score += (lowVal - 2) * 0.8;

  // Suited bonus
  if (isSuited) score += 10;

  // Connected bonus
  if (gap === 1) score += 7;
  else if (gap === 2) score += 4;
  else if (gap === 3) score += 2;

  return Math.min(100, Math.round(score));
}

/**
 * Detects draws (flush draw, straight draw, overcards, top pair).
 */
function analyzeBoardAndDraws(holeCards, communityCards) {
  if (!communityCards || communityCards.length < 3) {
    return { hasFlushDraw: false, hasOpenStraightDraw: false, hasGutshot: false, isTopPair: false, overcardCount: 0 };
  }
  const allCards = [...holeCards, ...communityCards];

  // 1. Flush draw (4 cards of same suit)
  const suitCounts = {};
  allCards.forEach(c => { suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1; });
  const hasFlushDraw = Object.values(suitCounts).some(cnt => cnt === 4);

  // 2. Straight draws
  const uniqueVals = [...new Set(allCards.map(c => c.value))].sort((a, b) => a - b);
  if (uniqueVals.includes(14)) uniqueVals.unshift(1); // Ace-low

  let hasOpenStraightDraw = false;
  let hasGutshot = false;

  for (let i = 0; i <= uniqueVals.length - 4; i++) {
    const span = uniqueVals[i + 3] - uniqueVals[i];
    if (span === 3) {
      hasOpenStraightDraw = true;
    } else if (span === 4) {
      hasGutshot = true;
    }
  }

  // 3. Top Pair check
  const commValues = communityCards.map(c => c.value);
  const maxComm = Math.max(...commValues);
  const isTopPair = holeCards.some(c => c.value === maxComm && commValues.includes(c.value));

  // 4. Overcards
  const overcardCount = holeCards.filter(c => c.value > maxComm).length;

  return { hasFlushDraw, hasOpenStraightDraw, hasGutshot, isTopPair, overcardCount };
}

/**
 * Retrieves bot personality traits.
 */
function getPersonality(botName) {
  const name = (botName || '').toLowerCase();
  if (name.includes('phil') || name.includes('ivey')) {
    // Aggressive, floats, raises frequently
    return { looseness: 1.3, aggression: 1.35, bluffChance: 0.22 };
  }
  if (name.includes('doyle') || name.includes('brunson')) {
    // Texas Legend: power poker, bets hard with top pair
    return { looseness: 1.25, aggression: 1.3, bluffChance: 0.18 };
  }
  if (name.includes('daniel') || name.includes('negreanu')) {
    // Small-ball: loves to see flops, calls with draws and pairs
    return { looseness: 1.35, aggression: 1.1, bluffChance: 0.15 };
  }
  if (name.includes('helmuth')) {
    // Traps big hands, careful against aggression
    return { looseness: 1.1, aggression: 1.2, bluffChance: 0.12 };
  }
  // Default balanced ABC bot
  return { looseness: 1.2, aggression: 1.15, bluffChance: 0.15 };
}

/**
 * Main action decision function.
 * @param {object} game PokerGame instance
 * @param {object} botPlayer Player object for the bot
 * @returns {{ action: string, amount: number }}
 */
function decideBotAction(game, botPlayer) {
  const currentBet = game.currentBet;
  const callAmount = Math.max(0, currentBet - botPlayer.bet);
  const pot = Math.max(1, game.pot);
  const availableActions = game.getAvailableActions(botPlayer.id);

  const canCheck = availableActions.some(a => a.action === 'check');
  const canCall = availableActions.some(a => a.action === 'call');
  const raiseAction = availableActions.find(a => a.action === 'raise');

  const activePlayers = game.players ? game.players.filter(p => !p.folded).length : 2;
  const isHeadsUp = activePlayers <= 2;
  const personality = getPersonality(botPlayer.name);

  // ------------------------------------------------------------------
  // 1. PREFLOP
  // ------------------------------------------------------------------
  if (game.phase === 'preflop') {
    return decidePreflopAction(
      botPlayer.cards,
      callAmount,
      pot,
      game.bigBlind,
      canCheck,
      canCall,
      raiseAction,
      botPlayer.chips,
      isHeadsUp,
      activePlayers,
      personality
    );
  }

  // ------------------------------------------------------------------
  // 2. POSTFLOP (Flop, Turn, River)
  // ------------------------------------------------------------------
  const allCards = [...botPlayer.cards, ...game.communityCards];
  let handEvaluation;
  try {
    handEvaluation = evaluateBestHand(allCards);
  } catch (e) {
    handEvaluation = { rank: 1, name: 'High Card' };
  }

  const analysis = analyzeBoardAndDraws(botPlayer.cards, game.communityCards);

  return decidePostflopAction(
    handEvaluation,
    analysis,
    game.phase,
    callAmount,
    pot,
    game.bigBlind,
    canCheck,
    canCall,
    raiseAction,
    botPlayer.chips,
    isHeadsUp,
    activePlayers,
    personality
  );
}

/**
 * Preflop decision logic.
 */
function decidePreflopAction(
  cards,
  callAmount,
  pot,
  bigBlind,
  canCheck,
  canCall,
  raiseAction,
  botChips,
  isHeadsUp,
  activePlayers,
  personality
) {
  // If check is free, NEVER fold preflop!
  if (canCheck && callAmount === 0) {
    // 25% chance to raise with decent hands from Big Blind
    const score = calculatePreflopScore(cards);
    if (raiseAction && score >= 55 && Math.random() < 0.35) {
      const raiseAmt = Math.min(raiseAction.maxAmount, Math.max(raiseAction.minAmount, bigBlind * 2.5));
      return { action: 'raise', amount: raiseAmt };
    }
    return { action: 'check', amount: 0 };
  }

  const rawScore = calculatePreflopScore(cards);
  // Apply personality looseness
  const score = rawScore * personality.looseness;

  // ------------------------------------------------------------------
  // HEADS-UP PREFLOP (2 Players: Wide defending range, 80%+ playable)
  // ------------------------------------------------------------------
  if (isHeadsUp) {
    // Facing small completion (e.g. Small Blind calling or min-bet)
    if (callAmount <= bigBlind) {
      // Monster hands (AA, KK, QQ, JJ, AK): Raise 85% of time
      if (score >= 70 && raiseAction && Math.random() < 0.85) {
        const raiseAmt = Math.min(raiseAction.maxAmount, Math.max(raiseAction.minAmount, bigBlind * 3));
        return { action: 'raise', amount: raiseAmt };
      }
      // Steal / aggressive raise with good hands: 30% of time
      if (score >= 45 && raiseAction && Math.random() < 0.35 * personality.aggression) {
        const raiseAmt = Math.min(raiseAction.maxAmount, Math.max(raiseAction.minAmount, bigBlind * 2.5));
        return { action: 'raise', amount: raiseAmt };
      }
      // In heads-up, calling 1 BB is profitable with 80%+ of hands
      if (canCall && (score >= 16 || Math.random() < 0.4)) {
        return { action: 'call', amount: callAmount };
      }
    }

    // Facing standard raise (callAmount <= 3x BB)
    if (callAmount <= bigBlind * 3.5) {
      if (score >= 75 && raiseAction && Math.random() < 0.5) {
        // 3-bet re-raise
        const reRaise = Math.min(raiseAction.maxAmount, Math.max(raiseAction.minAmount, callAmount * 2.5));
        return { action: 'raise', amount: reRaise };
      }
      if (canCall && score >= 32) {
        return { action: 'call', amount: callAmount };
      }
      // Occasional defending float
      if (canCall && Math.random() < 0.25 * personality.looseness) {
        return { action: 'call', amount: callAmount };
      }
    }

    // Facing big raise (> 3.5x BB)
    if (score >= 65 && canCall) {
      return { action: 'call', amount: callAmount };
    }
    return canCheck ? { action: 'check', amount: 0 } : { action: 'fold', amount: 0 };
  }

  // ------------------------------------------------------------------
  // MULTIWAY PREFLOP (3 - 8 Players)
  // ------------------------------------------------------------------
  // Facing small bet or limp (callAmount <= bigBlind)
  if (callAmount <= bigBlind) {
    // Premium raises
    if (score >= 70 && raiseAction && Math.random() < 0.75) {
      const raiseAmt = Math.min(raiseAction.maxAmount, Math.max(raiseAction.minAmount, bigBlind * 3));
      return { action: 'raise', amount: raiseAmt };
    }
    if (canCall && (score >= 26 || Math.random() < 0.3 * personality.looseness)) {
      return { action: 'call', amount: callAmount };
    }
  }

  // Facing normal raise
  if (callAmount <= bigBlind * 3.5) {
    if (score >= 75 && raiseAction && Math.random() < 0.4) {
      const reRaise = Math.min(raiseAction.maxAmount, Math.max(raiseAction.minAmount, callAmount * 2.5));
      return { action: 'raise', amount: reRaise };
    }
    if (canCall && score >= 42) {
      return { action: 'call', amount: callAmount };
    }
  }

  // Facing large bet
  if (score >= 75 && canCall) {
    return { action: 'call', amount: callAmount };
  }

  return canCheck ? { action: 'check', amount: 0 } : { action: 'fold', amount: 0 };
}

/**
 * Postflop decision logic.
 */
function decidePostflopAction(
  hand,
  analysis,
  phase,
  callAmount,
  pot,
  bigBlind,
  canCheck,
  canCall,
  raiseAction,
  botChips,
  isHeadsUp,
  activePlayers,
  personality
) {
  const rank = hand.rank;
  const potOdds = callAmount / (pot + callAmount);

  // RULE #1: NEVER fold when checking is 100% free!
  if (canCheck && callAmount === 0) {
    // ----------------------------------------------------------------
    // Checked to Bot: Should Bot Bet / Semi-Bluff?
    // ----------------------------------------------------------------
    if (raiseAction) {
      // Monster (Full House, Quads, Straight Flush) -> Value bet
      if (rank >= 6 && Math.random() < 0.8 * personality.aggression) {
        const bet = Math.min(raiseAction.maxAmount, Math.max(raiseAction.minAmount, Math.floor(pot * 0.7)));
        return { action: 'raise', amount: bet };
      }
      // Very Strong (Trips, Straight, Flush) -> Value bet
      if (rank >= 3 && Math.random() < 0.65 * personality.aggression) {
        const bet = Math.min(raiseAction.maxAmount, Math.max(raiseAction.minAmount, Math.floor(pot * 0.55)));
        return { action: 'raise', amount: bet };
      }
      // Two Pair or Top Pair -> Continuation bet
      if ((rank === 2 || analysis.isTopPair) && Math.random() < 0.55 * personality.aggression) {
        const bet = Math.min(raiseAction.maxAmount, Math.max(raiseAction.minAmount, Math.floor(pot * 0.45)));
        return { action: 'raise', amount: bet };
      }
      // Semi-bluff with Flush Draw or Open Straight Draw
      if ((analysis.hasFlushDraw || analysis.hasOpenStraightDraw) && Math.random() < 0.35 * personality.aggression) {
        const bet = Math.min(raiseAction.maxAmount, Math.max(raiseAction.minAmount, Math.floor(pot * 0.4)));
        return { action: 'raise', amount: bet };
      }
      // River Bluff stab if checked to
      if (phase === 'river' && rank === 0 && Math.random() < personality.bluffChance) {
        const bet = Math.min(raiseAction.maxAmount, Math.max(raiseAction.minAmount, Math.floor(pot * 0.4)));
        return { action: 'raise', amount: bet };
      }
    }
    return { action: 'check', amount: 0 };
  }

  // ------------------------------------------------------------------
  // FACING A BET (callAmount > 0)
  // ------------------------------------------------------------------

  // 1. MONSTER HANDS (Full House or better: Rank >= 6)
  if (rank >= 6) {
    if (raiseAction && Math.random() < 0.75 * personality.aggression) {
      const reRaise = Math.min(raiseAction.maxAmount, Math.max(raiseAction.minAmount, callAmount * 2.5));
      return { action: 'raise', amount: reRaise };
    }
    if (canCall) return { action: 'call', amount: callAmount };
    return { action: 'check', amount: 0 };
  }

  // 2. VERY STRONG (Trips, Straight, Flush: Rank 3, 4, 5)
  if (rank >= 3) {
    if (raiseAction && Math.random() < 0.5 * personality.aggression) {
      const reRaise = Math.min(raiseAction.maxAmount, Math.max(raiseAction.minAmount, callAmount * 2.2));
      return { action: 'raise', amount: reRaise };
    }
    // Never fold very strong hands to normal bets
    if (canCall) return { action: 'call', amount: callAmount };
  }

  // 3. TWO PAIR (Rank 2)
  if (rank === 2) {
    if (callAmount <= pot * 1.1 || isHeadsUp) {
      if (raiseAction && Math.random() < 0.4 * personality.aggression) {
        const reRaise = Math.min(raiseAction.maxAmount, Math.max(raiseAction.minAmount, callAmount * 2));
        return { action: 'raise', amount: reRaise };
      }
      if (canCall) return { action: 'call', amount: callAmount };
    }
    // High overbet facing Two Pair
    if (canCall && Math.random() < 0.75 * personality.looseness) {
      return { action: 'call', amount: callAmount };
    }
    return canCheck ? { action: 'check', amount: 0 } : { action: 'fold', amount: 0 };
  }

  // 4. ONE PAIR (Rank 1)
  if (rank === 1) {
    // Top Pair is very strong, especially heads-up
    if (analysis.isTopPair) {
      if (callAmount <= pot * 0.95 || isHeadsUp) {
        if (raiseAction && Math.random() < 0.3 * personality.aggression) {
          const reRaise = Math.min(raiseAction.maxAmount, Math.max(raiseAction.minAmount, callAmount * 2));
          return { action: 'raise', amount: reRaise };
        }
        if (canCall) return { action: 'call', amount: callAmount };
      }
      // Call even decent bets with top pair
      if (canCall && Math.random() < 0.8 * personality.looseness) {
        return { action: 'call', amount: callAmount };
      }
    }

    // Pair + Flush Draw or Straight Draw = Combo Draw!
    if (analysis.hasFlushDraw || analysis.hasOpenStraightDraw) {
      if (canCall && (callAmount <= pot * 0.85 || Math.random() < 0.85)) {
        return { action: 'call', amount: callAmount };
      }
    }

    // Second Pair or Pocket Pair
    if (callAmount <= Math.max(bigBlind * 2.5, pot * 0.6)) {
      if (canCall) return { action: 'call', amount: callAmount };
    }

    // In heads-up, call modest bets with any pair
    if (isHeadsUp && callAmount <= pot * 0.55 && canCall) {
      return { action: 'call', amount: callAmount };
    }

    if (canCall && Math.random() < 0.45 * personality.looseness) {
      return { action: 'call', amount: callAmount };
    }

    return canCheck ? { action: 'check', amount: 0 } : { action: 'fold', amount: 0 };
  }

  // 5. HIGH CARD (Rank 0) WITH DRAWS
  // Flush draw (36% to hit) or Open-ended straight draw (32% to hit)
  if (analysis.hasFlushDraw || analysis.hasOpenStraightDraw) {
    // Semi-bluff raise occasionally on flop/turn
    if (phase !== 'river' && raiseAction && Math.random() < 0.25 * personality.aggression) {
      const raiseAmt = Math.min(raiseAction.maxAmount, Math.max(raiseAction.minAmount, callAmount * 2));
      return { action: 'raise', amount: raiseAmt };
    }
    // Call if pot odds are reasonable (up to 55% pot bet)
    if (canCall && (callAmount <= pot * 0.55 || potOdds <= 0.38)) {
      return { action: 'call', amount: callAmount };
    }
  }

  // Gutshot Draw or Two Overcards in heads-up
  if ((analysis.hasGutshot || analysis.overcardCount >= 2) && phase !== 'river') {
    if (canCall && (callAmount <= Math.max(bigBlind * 2, pot * 0.3) || (isHeadsUp && callAmount <= pot * 0.38))) {
      return { action: 'call', amount: callAmount };
    }
  }

  // Floating small bets heads-up (floats the flop with Ace or King high)
  if (isHeadsUp && phase === 'flop' && callAmount <= Math.max(bigBlind * 1.5, pot * 0.3) && analysis.overcardCount >= 1) {
    if (canCall && Math.random() < 0.5 * personality.looseness) {
      return { action: 'call', amount: callAmount };
    }
  }

  // Small cheap bet defense
  if (canCall && callAmount <= bigBlind && Math.random() < 0.4) {
    return { action: 'call', amount: callAmount };
  }

  return canCheck ? { action: 'check', amount: 0 } : { action: 'fold', amount: 0 };
}

module.exports = {
  BOT_NAMES,
  decideBotAction
};
