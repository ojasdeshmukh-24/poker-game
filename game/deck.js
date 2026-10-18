// Card format: { suit: 'hearts'|'diamonds'|'clubs'|'spades', value: 2-14 (11=J,12=Q,13=K,14=A), display: '2'-'A' }
// Suit symbols: { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' }

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const SUIT_SYMBOLS = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
const VALUE_DISPLAY = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
  10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A'
};

class Deck {
  constructor() {
    this.cards = [];
    this._createDeck();
    this.shuffle();
  }

  /**
   * Creates a standard 52-card deck.
   */
  _createDeck() {
    this.cards = [];
    for (const suit of SUITS) {
      for (let value = 2; value <= 14; value++) {
        this.cards.push({
          suit,
          value,
          display: VALUE_DISPLAY[value],
          symbol: SUIT_SYMBOLS[suit]
        });
      }
    }
  }

  /**
   * Fisher-Yates (Knuth) shuffle algorithm.
   */
  shuffle() {
    const cards = this.cards;
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    return this;
  }

  /**
   * Deals `count` cards from the top of the deck.
   * @param {number} count - Number of cards to deal.
   * @returns {Array} Array of dealt cards.
   */
  deal(count) {
    if (count > this.cards.length) {
      throw new Error(`Cannot deal ${count} cards, only ${this.cards.length} remaining`);
    }
    return this.cards.splice(0, count);
  }

  /**
   * Recreates and shuffles the deck.
   */
  reset() {
    this._createDeck();
    this.shuffle();
    return this;
  }
}

module.exports = Deck;
