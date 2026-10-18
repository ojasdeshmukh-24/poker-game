// Hand Ranks:
// 0 = High Card, 1 = One Pair, 2 = Two Pair, 3 = Three of a Kind,
// 4 = Straight, 5 = Flush, 6 = Full House, 7 = Four of a Kind,
// 8 = Straight Flush, 9 = Royal Flush

const HAND_NAMES = [
  'High Card', 'One Pair', 'Two Pair', 'Three of a Kind',
  'Straight', 'Flush', 'Full House', 'Four of a Kind',
  'Straight Flush', 'Royal Flush'
];

const BASE = 15; // Values go up to 14 (Ace), so base 15 avoids collisions

/**
 * Returns all k-element combinations of arr.
 * @param {Array} arr
 * @param {number} k
 * @returns {Array<Array>}
 */
function getCombinations(arr, k) {
  const results = [];

  function helper(start, combo) {
    if (combo.length === k) {
      results.push([...combo]);
      return;
    }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      helper(i + 1, combo);
      combo.pop();
    }
  }

  helper(0, []);
  return results;
}

/**
 * Evaluates a single 5-card poker hand.
 * @param {Array} fiveCards - Exactly 5 card objects.
 * @returns {{ rank: number, name: string, score: number, bestCards: Array }}
 */
function evaluate5Cards(fiveCards) {
  // 1. Sort cards by value descending
  const cards = [...fiveCards].sort((a, b) => b.value - a.value);

  // 2. Check flush (all same suit)
  const isFlush = cards.every(c => c.suit === cards[0].suit);

  // 3. Check straight (5 consecutive values)
  let isStraight = false;
  let straightHighCard = 0;

  // Normal straight check
  const values = cards.map(c => c.value);
  if (values[0] - values[4] === 4 && new Set(values).size === 5) {
    isStraight = true;
    straightHighCard = values[0];
  }

  // Wheel straight: A-2-3-4-5 (Ace counts as 1)
  if (!isStraight) {
    const wheelValues = [14, 5, 4, 3, 2];
    if (values.length === 5 && new Set(values).size === 5) {
      const sorted = [...values].sort((a, b) => a - b);
      if (sorted[0] === 2 && sorted[1] === 3 && sorted[2] === 4 && sorted[3] === 5 && sorted[4] === 14) {
        isStraight = true;
        straightHighCard = 5; // In a wheel, the 5 is the high card (Ace is low)
      }
    }
  }

  // 4. Count value frequencies
  const freqMap = {};
  for (const card of cards) {
    freqMap[card.value] = (freqMap[card.value] || 0) + 1;
  }

  // Sort frequencies: by count descending, then by value descending
  const freqEntries = Object.entries(freqMap)
    .map(([val, count]) => ({ value: parseInt(val), count }))
    .sort((a, b) => b.count - a.count || b.value - a.value);

  const counts = freqEntries.map(e => e.count);
  const freqValues = freqEntries.map(e => e.value);

  // 5. Determine hand rank and calculate score
  let rank;
  let scoreParts; // Array of values used for score calculation

  if (isStraight && isFlush) {
    if (straightHighCard === 14) {
      rank = 9; // Royal Flush
    } else {
      rank = 8; // Straight Flush
    }
    scoreParts = [straightHighCard];
  } else if (counts[0] === 4) {
    rank = 7; // Four of a Kind
    scoreParts = freqValues; // quad value, then kicker
  } else if (counts[0] === 3 && counts[1] === 2) {
    rank = 6; // Full House
    scoreParts = freqValues; // trips value, then pair value
  } else if (isFlush) {
    rank = 5; // Flush
    scoreParts = values; // all 5 values in descending order
  } else if (isStraight) {
    rank = 4; // Straight
    scoreParts = [straightHighCard];
  } else if (counts[0] === 3) {
    rank = 3; // Three of a Kind
    scoreParts = freqValues; // trips, then kickers descending
  } else if (counts[0] === 2 && counts[1] === 2) {
    rank = 2; // Two Pair
    scoreParts = freqValues; // higher pair, lower pair, kicker
  } else if (counts[0] === 2) {
    rank = 1; // One Pair
    scoreParts = freqValues; // pair value, then kickers descending
  } else {
    rank = 0; // High Card
    scoreParts = values; // all 5 values in descending order
  }

  // Calculate numeric score: rank * 15^5 + scoreParts[0] * 15^4 + scoreParts[1] * 15^3 + ...
  let score = rank * Math.pow(BASE, 5);
  for (let i = 0; i < scoreParts.length; i++) {
    score += scoreParts[i] * Math.pow(BASE, 4 - i);
  }

  // Arrange bestCards for display: for straights with wheel, reorder so Ace is last
  let bestCards = cards;
  if (isStraight && straightHighCard === 5) {
    // Wheel: put Ace at the end (it's playing as 1)
    const ace = cards.find(c => c.value === 14);
    const rest = cards.filter(c => c.value !== 14).sort((a, b) => b.value - a.value);
    bestCards = [...rest, ace];
  }

  return {
    rank,
    name: HAND_NAMES[rank],
    score,
    bestCards
  };
}

/**
 * Finds the best 5-card hand from 7 cards by checking all C(7,5)=21 combinations.
 * @param {Array} sevenCards - Exactly 7 card objects.
 * @returns {{ rank: number, name: string, score: number, bestCards: Array }}
 */
function evaluateBestHand(sevenCards) {
  if (sevenCards.length < 5) {
    throw new Error(`Need at least 5 cards, got ${sevenCards.length}`);
  }

  const combinations = getCombinations(sevenCards, 5);
  let bestHand = null;

  for (const combo of combinations) {
    const hand = evaluate5Cards(combo);
    if (!bestHand || hand.score > bestHand.score) {
      bestHand = hand;
    }
  }

  return bestHand;
}

/**
 * Determines the winner(s) among players given community cards.
 * @param {Array} players - Array of { id, cards } (each cards is 2-card array).
 * @param {Array} communityCards - Array of 5 community cards.
 * @returns {Array} Array of winner objects [{ id, hand }]. Multiple if tie.
 */
function determineWinners(players, communityCards) {
  const evaluated = players.map(player => {
    const allCards = [...player.cards, ...communityCards];
    const hand = evaluateBestHand(allCards);
    return { id: player.id, hand };
  });

  // Find the maximum score
  const maxScore = Math.max(...evaluated.map(e => e.hand.score));

  // Return all players with the max score (handles ties)
  return evaluated.filter(e => e.hand.score === maxScore);
}

module.exports = { getCombinations, evaluate5Cards, evaluateBestHand, determineWinners };
