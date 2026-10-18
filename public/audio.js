/**
 * Web Audio API Sound Synthesizer for Texas Hold'em Poker
 * Synthesizes all sound effects natively in the browser without external audio files.
 */
class PokerAudio {
  constructor() {
    this.ctx = null;
    this.enabled = localStorage.getItem('poker_sound_enabled') !== 'false';
  }

  _getAudioContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  toggleSound() {
    this.enabled = !this.enabled;
    localStorage.setItem('poker_sound_enabled', this.enabled ? 'true' : 'false');
    if (this.enabled) {
      this.playChipSound();
    }
    return this.enabled;
  }

  /**
   * Sound: Card dealing (crisp filtered noise burst)
   */
  playCardDeal() {
    if (!this.enabled) return;
    try {
      const ctx = this._getAudioContext();
      if (!ctx) return;

      const bufferSize = ctx.sampleRate * 0.05; // 50ms
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1800, ctx.currentTime);
      filter.Q.setValueAtTime(3, ctx.currentTime);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      noise.start();
    } catch (e) {}
  }

  /**
   * Sound: Chips clinking / betting (metallic ceramic click)
   */
  playChipSound() {
    if (!this.enabled) return;
    try {
      const ctx = this._getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      [2400, 3200, 4100].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.02);

        gain.gain.setValueAtTime(0.08, now + idx * 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.02 + 0.06);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + idx * 0.02);
        osc.stop(now + idx * 0.02 + 0.07);
      });
    } catch (e) {}
  }

  /**
   * Sound: Check (wooden double knock)
   */
  playCheckKnock() {
    if (!this.enabled) return;
    try {
      const ctx = this._getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      [0, 0.08].forEach(offset => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(140, now + offset);
        osc.frequency.exponentialRampToValueAtTime(40, now + offset + 0.05);

        gain.gain.setValueAtTime(0.25, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.06);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + offset);
        osc.stop(now + offset + 0.07);
      });
    } catch (e) {}
  }

  /**
   * Sound: Fold (soft swoosh)
   */
  playFoldSound() {
    if (!this.enabled) return;
    try {
      const ctx = this._getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.12);

      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.13);
    } catch (e) {}
  }

  /**
   * Sound: All-In (dramatic ascending chime)
   */
  playAllInSound() {
    if (!this.enabled) return;
    try {
      const ctx = this._getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      const notes = [440, 554.37, 659.25, 880]; // A major arpeggio
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + i * 0.07);

        gain.gain.setValueAtTime(0.15, now + i * 0.07);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.07 + 0.25);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + i * 0.07);
        osc.stop(now + i * 0.07 + 0.26);
      });
    } catch (e) {}
  }

  /**
   * Sound: Victory fanfare (triumphant chord)
   */
  playWinFanfare() {
    if (!this.enabled) return;
    try {
      const ctx = this._getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      const chords = [
        { notes: [523.25, 659.25, 783.99], time: 0, dur: 0.18 },      // C major
        { notes: [587.33, 739.99, 880.00], time: 0.18, dur: 0.18 },   // D major
        { notes: [659.25, 783.99, 987.77, 1318.51], time: 0.36, dur: 0.6 } // E minor/C high
      ];

      chords.forEach(c => {
        c.notes.forEach(note => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();

          osc.type = 'triangle';
          osc.frequency.setValueAtTime(note, now + c.time);

          gain.gain.setValueAtTime(0.1, now + c.time);
          gain.gain.exponentialRampToValueAtTime(0.001, now + c.time + c.dur);

          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.start(now + c.time);
          osc.stop(now + c.time + c.dur + 0.02);
        });
      });
    } catch (e) {}
  }

  /**
   * Sound: Shot Clock Warning Beep (subtle alert for <= 5s)
   */
  playTimerTick() {
    if (!this.enabled) return;
    try {
      const ctx = this._getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);

      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.09);
    } catch (e) {}
  }

  /**
   * Sound: Reactions / Emotes
   */
  playReactionSound(reaction) {
    if (!this.enabled) return;
    try {
      const ctx = this._getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      if (reaction === '🔥' || reaction === '🚀') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.exponentialRampToValueAtTime(600, now + 0.2);
      } else if (reaction === '🍅' || reaction === '💀') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(250, now);
        osc.frequency.exponentialRampToValueAtTime(90, now + 0.15);
      } else {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.exponentialRampToValueAtTime(780, now + 0.15);
      }

      gain.gain.setValueAtTime(0.09, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.21);
    } catch (e) {}
  }
}

// Global audio singleton
window.pokerAudio = new PokerAudio();
