/**
 * Bot Player AI for Texas Hold'em
 */
const { evaluateBestHand } = require('./hand-evaluator');

const BOT_NAMES = [
  'Bot Doyle', 'Bot Phil', 'Bot Daniel', 'Bot Ivey',
  'Bot Negreanu', 'Bot Helmuth', 'Bot Brunson', 'Bot Johnny'
];

/**
 * Calculates the best action for a bot given the current poker game state.
 * @param {object} game PokerGame instance
 * @param {object} botPlayer Player object for the bot
 * @returns {{ action: string, amount: number }}
 */
function decideBotAction(game, botPlayer) {
  const currentBet = game.currentBet;
  const callAmount = currentBet - botPlayer.bet;
  const pot = game.pot;
  const availableActions = game.getAvailableActions(botPlayer.id);

  const canCheck = availableActions.some(a => a.action === 'check');
  const canCall = availableActions.some(a => a.action === 'call');
  const raiseAction = availableActions.find(a => a.action === 'raise');

  // Preflop decision
  if (game.phase === 'preflop') {
    return decidePreflopAction(botPlayer.cards, callAmount, pot, game.bigBlind, canCheck, canCall, raiseAction, botPlayer.chips);
  }

  // Postflop decision (flop, turn, river)
  const allCards = [...botPlayer.cards, ...game.communityCards];
  let handEvaluation;
  try {
    handEvaluation = evaluateBestHand(allCards);
  } catch (e) {
    handEvaluation = { rank: 1, name: 'High Card' };
  }

  return decidePostflopAction(
    handEvaluation,
    game.phase,
    callAmount,
    pot,
    game.bigBlind,
    canCheck,
    canCall,
    raiseAction,
    botPlayer.chips
  );
}

/**
 * Decision making for preflop
 */
function decidePreflopAction(cards, callAmount, pot, bigBlind, canCheck, canCall, raiseAction, botChips) {
  if (!cards || cards.length < 2) {
    return canCheck ? { action: 'check', amount: 0 } : { action: 'fold', amount: 0 };
  }

  const v1 = cards[0].value;
  const v2 = cards[1].value;
  const isPair = v1 === v2;
  const isSuited = cards[0].suit === cards[1].suit;
  const highVal = Math.max(v1, v2);
  const lowVal = Math.min(v1, v2);

  // Premium pairs (AA, KK, QQ, JJ, 10-10) or AK
  const isPremium = (isPair && highVal >= 10) || (highVal === 14 && lowVal >= 13);
  // Strong hands (99-77, AQ, AJ, KQ, QJ suited)
  const isStrong = (isPair && highVal >= 7) || (highVal >= 13 && lowVal >= 11) || (isSuited && highVal >= 11 && lowVal >= 10);
  // Playable (any pair, any Ace, suited connectors)
  const isPlayable = isPair || highVal === 14 || (isSuited && (highVal - lowVal <= 2));

  if (isPremium) {
    if (raiseAction && Math.random() < 0.85) {
      const raiseAmt = Math.min(raiseAction.maxAmount, Math.max(raiseAction.minAmount, bigBlind * 3 + Math.floor(Math.random() * bigBlind * 2)));
      return { action: 'raise', amount: raiseAmt };
    }
    if (canCall) return { action: 'call', amount: callAmount };
    return { action: 'check', amount: 0 };
  }

  if (isStrong) {
    if (callAmount <= bigBlind * 4) {
      if (raiseAction && Math.random() < 0.45) {
        const raiseAmt = Math.min(raiseAction.maxAmount, Math.max(raiseAction.minAmount, bigBlind * 2.5));
        return { action: 'raise', amount: raiseAmt };
      }
      if (canCall) return { action: 'call', amount: callAmount };
      return { action: 'check', amount: 0 };
    }
  }

  if (isPlayable) {
    if (callAmount <= bigBlind * 2) {
      if (canCall) return { action: 'call', amount: callAmount };
      return { action: 'check', amount: 0 };
    }
    if (canCheck) return { action: 'check', amount: 0 };
    return { action: 'fold', amount: 0 };
  }

  // Trash preflop
  if (canCheck) return { action: 'check', amount: 0 };
  // Small 8% bluff call chance for small amounts
  if (canCall && callAmount <= bigBlind && Math.random() < 0.08) {
    return { action: 'call', amount: callAmount };
  }
  return { action: 'fold', amount: 0 };
}

/**
 * Decision making for postflop (flop, turn, river)
 */
function decidePostflopAction(hand, phase, callAmount, pot, bigBlind, canCheck, canCall, raiseAction, botChips) {
  const rank = hand.rank; // 1: High Card, 2: Pair, 3: Two Pair, 4: Three of a Kind, 5: Straight, 6: Flush, 7: Full House, 8: Four of a Kind, 9: Straight Flush, 10: Royal Flush

  // Monster hands: Full House or better (Rank >= 7)
  if (rank >= 7) {
    if (raiseAction) {
      const betSize = Math.max(raiseAction.minAmount, Math.min(raiseAction.maxAmount, Math.floor(pot * 0.75)));
      return { action: 'raise', amount: betSize };
    }
    if (canCall) return { action: 'call', amount: callAmount };
    return { action: 'check', amount: 0 };
  }

  // Very Strong: Straight, Flush, Three of a Kind (Rank 4, 5, 6)
  if (rank >= 4) {
    if (callAmount === 0 && raiseAction && Math.random() < 0.7) {
      const betSize = Math.max(raiseAction.minAmount, Math.min(raiseAction.maxAmount, Math.floor(pot * 0.5)));
      return { action: 'raise', amount: betSize };
    }
    if (callAmount > 0) {
      if (callAmount <= pot * 0.8 || Math.random() < 0.85) {
        if (raiseAction && Math.random() < 0.3) {
          const reRaise = Math.max(raiseAction.minAmount, Math.min(raiseAction.maxAmount, callAmount * 2));
          return { action: 'raise', amount: reRaise };
        }
        if (canCall) return { action: 'call', amount: callAmount };
      }
    }
    if (canCall) return { action: 'call', amount: callAmount };
    return { action: 'check', amount: 0 };
  }

  // Decent: Two Pair (Rank 3)
  if (rank === 3) {
    if (callAmount === 0) {
      if (raiseAction && Math.random() < 0.5) {
        const betSize = Math.max(raiseAction.minAmount, Math.min(raiseAction.maxAmount, Math.floor(pot * 0.4)));
        return { action: 'raise', amount: betSize };
      }
      return { action: 'check', amount: 0 };
    }
    if (callAmount <= pot * 0.5) {
      return canCall ? { action: 'call', amount: callAmount } : { action: 'fold', amount: 0 };
    }
    // High bet against two pair
    if (Math.random() < 0.4 && canCall) {
      return { action: 'call', amount: callAmount };
    }
    return canCheck ? { action: 'check', amount: 0 } : { action: 'fold', amount: 0 };
  }

  // Marginal: One Pair (Rank 2)
  if (rank === 2) {
    if (callAmount === 0) {
      if (raiseAction && Math.random() < 0.25) {
        const minBet = raiseAction.minAmount;
        return { action: 'raise', amount: minBet };
      }
      return { action: 'check', amount: 0 };
    }
    // Call modest bets
    if (callAmount <= Math.max(bigBlind * 2, pot * 0.25)) {
      return canCall ? { action: 'call', amount: callAmount } : { action: 'fold', amount: 0 };
    }
    return canCheck ? { action: 'check', amount: 0 } : { action: 'fold', amount: 0 };
  }

  // High Card (Rank 1)
  if (canCheck) {
    // 10% bluff bet if checked to on the river
    if (phase === 'river' && raiseAction && Math.random() < 0.1) {
      return { action: 'raise', amount: raiseAction.minAmount };
    }
    return { action: 'check', amount: 0 };
  }

  // Facing a bet with High Card
  if (callAmount <= bigBlind && Math.random() < 0.05) {
    return canCall ? { action: 'call', amount: callAmount } : { action: 'fold', amount: 0 };
  }

  return { action: 'fold', amount: 0 };
}

module.exports = {
  BOT_NAMES,
  decideBotAction
};
