/* ============================================================
   TEXAS HOLD'EM POKER - CLIENT APPLICATION
   ============================================================ */

// ==================== STATE ====================
let socket = null;
let myId = null;
let currentRoom = null;
let gameState = null;
let isHost = false;
let chatOpen = false;
let roundResultData = null;
let showingResult = false;
let nextRoundTimer = null;
let currentRoomData = null;

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', () => {
  socket = io();
  setupSocketListeners();

  // Focus on name input
  const nameInput = document.getElementById('player-name');
  if (nameInput) nameInput.focus();

  // Pre-fill room code from URL query param (?room=ABCDEF)
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room');
  if (roomParam) {
    const input = document.getElementById('room-code-input');
    if (input) {
      input.value = roomParam.trim().toUpperCase();
      showToast(`Invited to room ${roomParam.toUpperCase()}! Enter your name and click Join.`, 'info');
    }
  }

  // Restore Theme
  const savedTheme = localStorage.getItem('poker_theme') || 'theme-emerald';
  applyTheme(savedTheme);

  // Restore 4-Color deck
  if (localStorage.getItem('poker_4color') === 'true') {
    toggleFourColorDeck();
  }

  // Restore sound toggle icon
  const soundBtn = document.getElementById('btn-sound-toggle');
  if (soundBtn && window.pokerAudio) {
    soundBtn.textContent = window.pokerAudio.enabled ? '🔊' : '🔇';
  }
});

function setupSocketListeners() {
  socket.on('connect', () => {
    myId = socket.id;
    console.log('Connected with ID:', myId);
  });

  socket.on('disconnect', () => {
    console.log('Disconnected from server');
    showToast('Disconnected from server', 'error');
  });

  socket.on('reconnect', () => {
    console.log('Reconnected to server');
    showToast('Reconnected!', 'success');
  });

  socket.on('room-update', (data) => {
    handleRoomUpdate(data.room);
  });

  socket.on('game-state', (data) => {
    handleGameState(data.state);
  });

  socket.on('round-result', (data) => {
    handleRoundResult(data);
  });

  socket.on('game-end', (data) => {
    handleGameEnd(data);
  });

  socket.on('turn-timer', (data) => {
    handleTurnTimer(data);
  });

  socket.on('table-reaction', (data) => {
    handleTableReaction(data);
  });

  socket.on('kicked', (data) => {
    showToast(data.message || 'You were kicked from the room by the host', 'error');
    leaveRoom();
  });

  socket.on('chat-message', (data) => {
    addChatMessage(data.playerName, data.message, data.timestamp);
  });

  socket.on('error', (data) => {
    showToast(data.message, 'error');
  });
}

// ==================== VIEW MANAGEMENT ====================
function showView(viewName) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const view = document.getElementById(viewName + '-view');
  if (view) view.classList.add('active');
}

// ==================== LOBBY FUNCTIONS ====================
function getPlayerName() {
  const name = document.getElementById('player-name').value.trim();
  if (!name) {
    showToast('Please enter your name', 'error');
    document.getElementById('player-name').focus();
    return null;
  }
  return name;
}

function createRoom() {
  const playerName = getPlayerName();
  if (!playerName) return;

  const settings = {
    startingChips: parseInt(document.getElementById('setting-chips').value) || 1000,
    smallBlind: parseInt(document.getElementById('setting-small-blind').value) || 5,
    bigBlind: parseInt(document.getElementById('setting-big-blind').value) || 10,
  };

  const btn = document.getElementById('btn-create-room');
  btn.disabled = true;
  btn.textContent = 'Creating...';

  socket.emit('create-room', { playerName, settings }, (response) => {
    btn.disabled = false;
    btn.innerHTML = '<span class="btn-icon">🃏</span> Create Room';

    if (response.success) {
      currentRoom = response.roomId;
      isHost = true;
      showView('room');
      document.getElementById('room-code-value').textContent = response.roomId;
      showToast('Room created!', 'success');
    } else {
      showToast(response.error || 'Failed to create room', 'error');
    }
  });
}

function joinRoom() {
  const playerName = getPlayerName();
  if (!playerName) return;

  const roomId = document.getElementById('room-code-input').value.trim().toUpperCase();
  if (!roomId) {
    showToast('Please enter a room code', 'error');
    document.getElementById('room-code-input').focus();
    return;
  }

  const btn = document.getElementById('btn-join-room');
  btn.disabled = true;
  btn.textContent = 'Joining...';

  socket.emit('join-room', { roomId, playerName }, (response) => {
    btn.disabled = false;
    btn.innerHTML = '<span class="btn-icon">🚪</span> Join Room';

    if (response.success) {
      currentRoom = roomId;
      isHost = false;
      showView('room');
      document.getElementById('room-code-value').textContent = roomId;
      showToast('Joined room!', 'success');
    } else {
      showToast(response.error || 'Failed to join room', 'error');
    }
  });
}

// ==================== ROOM FUNCTIONS ====================
function handleRoomUpdate(room) {
  if (!room) return;
  currentRoom = room.id;
  currentRoomData = room;
  isHost = (room.hostId === myId);

  // Update Host Controls visibility
  const hostBtn = document.getElementById('btn-host-controls');
  if (hostBtn) hostBtn.style.display = isHost ? 'inline-flex' : 'none';

  // If host controls modal is open, re-render players
  const hostModal = document.getElementById('host-controls-modal');
  if (hostModal && hostModal.style.display === 'flex') {
    renderHostPlayersList();
  }

  // Update room code display
  document.getElementById('room-code-value').textContent = room.id;
  document.getElementById('game-room-id').textContent = room.id;

  // Update player list
  const list = document.getElementById('room-player-list');
  list.innerHTML = '';
  document.getElementById('player-count').textContent = `(${room.players.length}/8)`;

  room.players.forEach(player => {
    const li = document.createElement('li');
    const avatarColors = ['#3498db', '#e74c3c', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#34495e'];
    const colorIdx = player.seatIndex % avatarColors.length;

    li.innerHTML = `
      <div class="player-avatar" style="background:${avatarColors[colorIdx]}">${player.name.charAt(0).toUpperCase()}</div>
      <span>${escapeHtml(player.name)}</span>
      ${player.id === room.hostId ? '<span class="host-badge">HOST</span>' : ''}
      ${!player.connected ? '<span style="color:var(--text-muted);margin-left:auto;font-size:11px;">disconnected</span>' : ''}
    `;
    list.appendChild(li);
  });

  // Show/hide start button
  const startBtn = document.getElementById('btn-start-game');
  const waitingMsg = document.getElementById('waiting-message');
  if (isHost) {
    startBtn.style.display = 'block';
    startBtn.disabled = room.players.length < 2;
    waitingMsg.style.display = 'none';
  } else {
    startBtn.style.display = 'none';
    waitingMsg.style.display = 'block';
  }

  // If status is playing, switch to game view
  if (room.status === 'playing') {
    showView('game');
  }
}

function startGame() {
  const btn = document.getElementById('btn-start-game');
  btn.disabled = true;

  socket.emit('start-game', (response) => {
    btn.disabled = false;
    if (response.success) {
      showView('game');
    } else {
      showToast(response.error || 'Failed to start game', 'error');
    }
  });
}

function leaveRoom() {
  socket.emit('leave-room');
  currentRoom = null;
  isHost = false;
  gameState = null;
  roundResultData = null;
  showingResult = false;
  showView('lobby');
  showToast('Left the room');
}

// ==================== GAME FUNCTIONS ====================
function handleGameState(state) {
  gameState = state;
  myId = state.myId || myId;
  if (state.isHost !== undefined) {
    isHost = state.isHost;
  }

  // If we're not on game view, switch to it
  showView('game');

  // Hide round result UI and overlays when new game state arrives that isn't showdown
  if (state.phase !== 'showdown') {
    showingResult = false;
    roundResultData = null;
    clearTimeout(nextRoundTimer);
    const overlay = document.getElementById('winner-overlay');
    if (overlay) overlay.style.display = 'none';
    const gameOverOverlay = document.getElementById('game-over-overlay');
    if (gameOverOverlay) gameOverOverlay.style.display = 'none';
    const roundActions = document.getElementById('round-actions');
    if (roundActions) roundActions.style.display = 'none';
  }

  // Update Host Controls visibility
  const hostBtn = document.getElementById('btn-host-controls');
  if (hostBtn) hostBtn.style.display = isHost ? 'inline-flex' : 'none';

  // Check if I am out of chips (prompt to rebuy)
  const myPlayer = state.players ? state.players.find(p => p.id === (state.myId || myId)) : null;
  const rebuyBtn = document.getElementById('btn-rebuy');
  if (myPlayer) {
    if (myPlayer.chips <= 0) {
      if (rebuyBtn) rebuyBtn.classList.add('btn-pulse');
      if (!state.roundInProgress && !showingResult) {
        const bustedModal = document.getElementById('busted-modal');
        if (bustedModal) bustedModal.style.display = 'flex';
      }
    } else {
      if (rebuyBtn) rebuyBtn.classList.remove('btn-pulse');
      const bustedModal = document.getElementById('busted-modal');
      if (bustedModal) bustedModal.style.display = 'none';
    }
  }

  updateGameUI(state);
}

function updateGameUI(state) {
  renderTable(state);
  renderCommunityCards(state.communityCards);
  renderMyCards(state.myCards);
  renderActionPanel(state);

  // Update pot
  document.getElementById('pot-amount').textContent = formatChips(state.pot);

  // Render 3D pot chips
  const potChipsContainer = document.getElementById('pot-chips-container');
  if (potChipsContainer) {
    if (state.pot > 0 && window.render3DChipStack) {
      potChipsContainer.innerHTML = window.render3DChipStack(state.pot, 'normal');
      potChipsContainer.style.display = 'flex';
    } else {
      potChipsContainer.innerHTML = '';
      potChipsContainer.style.display = 'none';
    }
  }

  // Live hand strength badge
  const strengthBadge = document.getElementById('hand-strength-badge');
  if (strengthBadge) {
    if (state.handStrength && state.handStrength.name && state.myCards && state.myCards.length > 0) {
      strengthBadge.innerHTML = `🃏 <span>${escapeHtml(state.handStrength.name)}</span>`;
      strengthBadge.style.display = 'inline-flex';
    } else {
      strengthBadge.style.display = 'none';
    }
  }

  // Tournament pill & banner
  const tournamentPill = document.getElementById('tournament-pill');
  const tournamentBanner = document.getElementById('tournament-banner');
  if (currentRoomData && currentRoomData.tournament && currentRoomData.tournament.enabled) {
    const t = currentRoomData.tournament;
    if (tournamentPill) {
      tournamentPill.textContent = `🏆 LVL ${t.level || 1}`;
      tournamentPill.style.display = 'inline-block';
    }
    if (tournamentBanner) {
      tournamentBanner.textContent = `🏆 Level ${t.level || 1} • Blinds: ${currentRoomData.settings.smallBlind}/${currentRoomData.settings.bigBlind}`;
      tournamentBanner.style.display = 'block';
    }
  } else {
    if (tournamentPill) tournamentPill.style.display = 'none';
    if (tournamentBanner) tournamentBanner.style.display = 'none';
  }
}

function renderTable(state) {
  const container = document.getElementById('seats-container');
  container.innerHTML = '';

  if (!state.players || state.players.length === 0) return;

  // Compute rotation: we want "myIndex" to appear at visual seat 0 (bottom center)
  const myIdx = state.myIndex != null ? state.myIndex : 0;
  const totalSeats = state.players.length;

  state.players.forEach((player, idx) => {
    renderPlayerSeat(player, idx, state, container, myIdx, totalSeats);
  });
}

function renderPlayerSeat(player, index, state, container, myIdx, totalSeats) {
  // Compute visual seat: rotate so that myIdx maps to seat 0
  let visualSeat;
  if (totalSeats <= 8) {
    const offset = (index - myIdx + totalSeats) % totalSeats;
    // Map players into 8-seat positions, distributing evenly
    const seatMapping = getSeatMapping(totalSeats);
    visualSeat = seatMapping[offset];
  } else {
    visualSeat = (index - myIdx + 8) % 8;
  }

  const seat = document.createElement('div');
  seat.className = 'player-seat';
  seat.id = `seat-${player.id}`;
  seat.setAttribute('data-visual-seat', visualSeat);

  const isMe = (player.id === (state.myId || myId));
  const isTurn = (index === state.currentPlayerIndex && state.phase !== 'showdown');
  const isDealer = (index === state.dealerIndex);

  // Seat info box
  const seatInfo = document.createElement('div');
  seatInfo.className = 'seat-info';
  if (isTurn) seatInfo.classList.add('is-turn');
  if (player.folded) seatInfo.classList.add('is-folded');
  if (player.allIn) seatInfo.classList.add('is-allin');
  if (isMe) seatInfo.classList.add('is-me');
  if (player.connected === false) seatInfo.classList.add('is-disconnected');

  // All-in badge
  if (player.allIn && !player.folded) {
    const allinBadge = document.createElement('div');
    allinBadge.className = 'allin-badge';
    allinBadge.textContent = 'ALL IN';
    seatInfo.appendChild(allinBadge);
  }

  // Player name
  const nameEl = document.createElement('div');
  nameEl.className = 'seat-name';
  nameEl.innerHTML = escapeHtml(player.name) + (player.isBot ? ' <span class="bot-badge">BOT</span>' : '');
  seatInfo.appendChild(nameEl);

  // Chips
  const chipsEl = document.createElement('div');
  chipsEl.className = 'seat-chips';
  chipsEl.textContent = '💰 ' + formatChips(player.chips);
  seatInfo.appendChild(chipsEl);

  // Turn Timer Track
  const timerTrack = document.createElement('div');
  timerTrack.className = 'turn-timer-track';
  timerTrack.id = `timer-track-${player.id}`;
  const timerFill = document.createElement('div');
  timerFill.className = 'turn-timer-fill';
  timerFill.id = `timer-fill-${player.id}`;
  timerFill.style.width = '0%';
  timerTrack.appendChild(timerFill);
  seatInfo.appendChild(timerTrack);

  // Cards on seat
  const cardsEl = document.createElement('div');
  cardsEl.className = 'seat-cards';

  if (isMe) {
    // Don't show cards on the seat for myself, they show in the bottom panel
  } else if (showingResult && roundResultData && roundResultData.playerHands && roundResultData.playerHands[player.id]) {
    // Show revealed cards at showdown
    const handData = roundResultData.playerHands[player.id];
    if (handData.cards) {
      handData.cards.forEach(card => {
        cardsEl.innerHTML += getCardHTML(card, false, 'mini');
      });
    }
  } else if (player.hasCards && !player.folded) {
    // Show face-down cards
    cardsEl.innerHTML += getCardHTML(null, true, 'mini');
    cardsEl.innerHTML += getCardHTML(null, true, 'mini');
  }

  seatInfo.appendChild(cardsEl);

  // Dealer chip
  if (isDealer) {
    const dealerChip = document.createElement('div');
    dealerChip.className = 'dealer-chip';
    dealerChip.textContent = 'D';
    seatInfo.appendChild(dealerChip);
  }

  seat.appendChild(seatInfo);

  // Bet display with 3D stacked chips
  if (player.bet > 0) {
    const betEl = document.createElement('div');
    betEl.className = 'seat-bet';
    const chipsStack = window.render3DChipStack ? window.render3DChipStack(player.bet, 'small') : '';
    betEl.innerHTML = `
      ${chipsStack ? `<div class="seat-bet-chips">${chipsStack}</div>` : ''}
      <span class="seat-bet-amount">${formatChips(player.bet)}</span>
    `;
    seat.appendChild(betEl);
  }

  container.appendChild(seat);
}

function getSeatMapping(count) {
  // Distribute `count` players evenly across 8 visual seats
  const mappings = {
    1: [0],
    2: [0, 4],
    3: [0, 3, 5],
    4: [0, 2, 4, 6],
    5: [0, 2, 3, 5, 6],
    6: [0, 1, 2, 4, 5, 6],
    7: [0, 1, 2, 3, 5, 6, 7],
    8: [0, 1, 2, 3, 4, 5, 6, 7],
  };
  return mappings[count] || mappings[8];
}

function renderCommunityCards(cards) {
  const container = document.getElementById('community-cards');
  container.innerHTML = '';
  if (!cards || cards.length === 0) return;

  cards.forEach((card, i) => {
    const cardEl = document.createElement('div');
    cardEl.style.animationDelay = (i * 0.1) + 's';
    cardEl.innerHTML = getCardHTML(card, false, 'community');
    container.appendChild(cardEl.firstElementChild);
  });
}

function renderMyCards(cards) {
  const container = document.getElementById('my-cards');
  container.innerHTML = '';
  if (!cards || cards.length === 0) return;

  cards.forEach(card => {
    container.innerHTML += getCardHTML(card, false, 'large');
  });
}

function renderActionPanel(state) {
  const panel = document.getElementById('action-panel');
  const roundActions = document.getElementById('round-actions');

  if (showingResult) {
    panel.style.display = 'none';
    roundActions.style.display = 'flex';
    const nextBtn = document.getElementById('btn-next-round');
    if (nextBtn) nextBtn.style.display = 'block';
    return;
  }

  if (!state.isMyTurn || !state.availableActions || state.availableActions.length === 0) {
    panel.style.display = 'none';
    panel.classList.remove('my-turn');
    roundActions.style.display = 'none';
    return;
  }

  panel.style.display = 'flex';
  panel.classList.add('my-turn');
  roundActions.style.display = 'none';

  hideRaisePanel();

  const actions = state.availableActions;
  const foldBtn = document.getElementById('btn-fold');
  const checkCallBtn = document.getElementById('btn-check-call');
  const raiseBtn = document.getElementById('btn-raise');

  // Fold
  const canFold = actions.some(a => a.action === 'fold');
  foldBtn.style.display = canFold ? 'inline-flex' : 'none';

  // Check or Call
  const checkAction = actions.find(a => a.action === 'check');
  const callAction = actions.find(a => a.action === 'call');
  if (checkAction) {
    checkCallBtn.style.display = 'inline-flex';
    checkCallBtn.textContent = 'Check';
    checkCallBtn.className = 'btn btn-action btn-check';
    checkCallBtn.dataset.action = 'check';
    checkCallBtn.dataset.amount = '';
  } else if (callAction) {
    checkCallBtn.style.display = 'inline-flex';
    checkCallBtn.textContent = 'Call ' + formatChips(callAction.callAmount || 0);
    checkCallBtn.className = 'btn btn-action btn-call';
    checkCallBtn.dataset.action = 'call';
    checkCallBtn.dataset.amount = callAction.callAmount || '';
  } else {
    checkCallBtn.style.display = 'none';
  }

  // Raise
  const raiseAction = actions.find(a => a.action === 'raise');
  if (raiseAction) {
    raiseBtn.style.display = 'inline-flex';
    raiseBtn.dataset.minAmount = raiseAction.minAmount || 0;
    raiseBtn.dataset.maxAmount = raiseAction.maxAmount || 0;

    // Setup slider
    const slider = document.getElementById('raise-slider');
    const amountInput = document.getElementById('raise-amount');
    slider.min = raiseAction.minAmount || 0;
    slider.max = raiseAction.maxAmount || 0;
    slider.value = raiseAction.minAmount || 0;
    amountInput.min = raiseAction.minAmount || 0;
    amountInput.max = raiseAction.maxAmount || 0;
    amountInput.value = raiseAction.minAmount || 0;
    document.getElementById('raise-confirm-amount').textContent = formatChips(raiseAction.minAmount || 0);
  } else {
    raiseBtn.style.display = 'none';
  }
}

// ==================== ACTIONS ====================
function performAction(action, amount) {
  if (!action) return;

  if (window.pokerAudio) {
    if (action === 'fold') window.pokerAudio.playFoldSound();
    else if (action === 'check') window.pokerAudio.playCheckKnock();
    else if (action === 'call' || action === 'raise') window.pokerAudio.playChipSound();
  }

  const payload = { action };
  if (amount !== undefined && amount !== '' && amount !== null) {
    payload.amount = parseInt(amount);
  }

  // Disable buttons immediately
  document.querySelectorAll('.btn-action').forEach(b => b.disabled = true);

  socket.emit('player-action', payload, (response) => {
    document.querySelectorAll('.btn-action').forEach(b => b.disabled = false);
    if (!response.success) {
      showToast(response.error || 'Action failed', 'error');
    }
  });

  // Hide action panel
  document.getElementById('action-panel').style.display = 'none';
}

function showRaisePanel() {
  document.getElementById('raise-panel').style.display = 'flex';
}

function hideRaisePanel() {
  document.getElementById('raise-panel').style.display = 'none';
}

function updateRaiseValue(value) {
  document.getElementById('raise-amount').value = value;
  document.getElementById('raise-confirm-amount').textContent = formatChips(parseInt(value));
}

function updateRaiseSlider(value) {
  const slider = document.getElementById('raise-slider');
  const clamped = Math.max(parseInt(slider.min), Math.min(parseInt(slider.max), parseInt(value) || 0));
  slider.value = clamped;
  document.getElementById('raise-confirm-amount').textContent = formatChips(clamped);
}

function setRaiseQuick(type) {
  const slider = document.getElementById('raise-slider');
  const min = parseInt(slider.min);
  const max = parseInt(slider.max);
  const pot = gameState ? gameState.pot : 0;
  let value = min;

  switch (type) {
    case 'min':
      value = min;
      break;
    case 'half':
      value = Math.max(min, Math.min(max, Math.floor(pot / 2)));
      break;
    case 'pot':
      value = Math.max(min, Math.min(max, pot));
      break;
    case 'allin':
      value = max;
      break;
  }

  slider.value = value;
  document.getElementById('raise-amount').value = value;
  document.getElementById('raise-confirm-amount').textContent = formatChips(value);
}

function confirmRaise() {
  const amount = parseInt(document.getElementById('raise-amount').value);
  const slider = document.getElementById('raise-slider');
  const isAllIn = slider && amount >= parseInt(slider.max);

  if (window.pokerAudio) {
    if (isAllIn) window.pokerAudio.playAllInSound();
    else window.pokerAudio.playChipSound();
  }

  performAction('raise', amount);
  hideRaisePanel();
}

// ==================== ROUND RESULT ====================
function handleRoundResult(data) {
  roundResultData = data;
  showingResult = true;

  showRoundResult(data);

  // Re-render action panel to show next round buttons
  if (gameState) {
    renderActionPanel(gameState);
  }

  // Auto advance countdown (6 seconds)
  startAutoAdvance(6);
}

function startAutoAdvance(seconds) {
  clearInterval(nextRoundTimer);
  let remaining = seconds;
  const updateTimer = () => {
    const timerSpan = document.getElementById('auto-advance-timer');
    if (timerSpan) timerSpan.textContent = `(${remaining}s)`;
  };
  updateTimer();

  nextRoundTimer = setInterval(() => {
    remaining--;
    if (!showingResult) {
      clearInterval(nextRoundTimer);
      const timerSpan = document.getElementById('auto-advance-timer');
      if (timerSpan) timerSpan.textContent = '';
      return;
    }
    updateTimer();
    if (remaining <= 0) {
      clearInterval(nextRoundTimer);
      const timerSpan = document.getElementById('auto-advance-timer');
      if (timerSpan) timerSpan.textContent = '';
      if (showingResult) {
        requestNewRound();
      }
    }
  }, 1000);
}

function showRoundResult(result) {
  const overlay = document.getElementById('winner-overlay');
  const details = document.getElementById('winner-details');
  details.innerHTML = '';

  // Winner info
  if (result.winners && result.winners.length > 0) {
    result.winners.forEach(winner => {
      const div = document.createElement('div');
      div.className = 'winner-info';
      div.innerHTML = `
        <div class="winner-name">${escapeHtml(winner.name)}</div>
        <div class="winner-amount">+${formatChips(winner.amount)}</div>
        ${winner.handName ? `<div class="winner-hand">${escapeHtml(winner.handName)}</div>` : ''}
      `;
      details.appendChild(div);
    });
  }

  // All hands reveal
  if (result.playerHands && Object.keys(result.playerHands).length > 0) {
    const allHands = document.createElement('div');
    allHands.className = 'winner-all-hands';
    allHands.innerHTML = '<h4>Player Hands</h4>';

    const winnerIds = (result.winners || []).map(w => w.id);

    for (const [playerId, handData] of Object.entries(result.playerHands)) {
      const isWinner = winnerIds.includes(playerId);
      const playerInfo = gameState ? gameState.players.find(p => p.id === playerId) : null;
      const playerName = playerInfo ? playerInfo.name : 'Unknown';

      const handDiv = document.createElement('div');
      handDiv.className = 'hand-reveal' + (isWinner ? ' is-winner' : '');
      handDiv.innerHTML = `
        <span class="hand-reveal-name">${escapeHtml(playerName)}</span>
        <span class="hand-reveal-cards">
          ${handData.cards ? handData.cards.map(c => getCardHTML(c, false, 'mini')).join('') : ''}
        </span>
        <span class="hand-reveal-hand">${handData.handName ? escapeHtml(handData.handName) : ''}</span>
      `;
      allHands.appendChild(handDiv);
    }

    details.appendChild(allHands);
  }

  // If player is out of chips, show rebuy option in round results
  const myPlayer = gameState && gameState.players ? gameState.players.find(p => p.id === (gameState.myId || myId)) : null;
  if (myPlayer && myPlayer.chips <= 0) {
    const rebuyDiv = document.createElement('div');
    rebuyDiv.style.marginTop = '14px';
    rebuyDiv.innerHTML = `
      <div style="color:var(--accent-red);font-weight:700;font-size:14px;margin-bottom:8px;">⚠️ You are out of chips!</div>
      <button class="btn btn-large btn-success" onclick="playerRebuy()" style="width:100%;">
        🔄 Rebuy 1,000 Chips & Play Next Hand
      </button>
    `;
    details.appendChild(rebuyDiv);
  }

  overlay.style.display = 'flex';

  // Re-render table to reveal cards
  if (gameState) {
    renderTable(gameState);
  }
}

function dismissWinnerOverlay() {
  document.getElementById('winner-overlay').style.display = 'none';
}

function requestNewRound() {
  clearInterval(nextRoundTimer);
  const btnTable = document.getElementById('btn-next-round');
  const btnModal = document.getElementById('btn-modal-next-round');

  if (btnTable) { btnTable.disabled = true; btnTable.textContent = 'Starting...'; }
  if (btnModal) { btnModal.disabled = true; btnModal.textContent = 'Starting...'; }

  socket.emit('new-round', (response) => {
    if (btnTable) { btnTable.disabled = false; btnTable.textContent = '▶ Next Round'; }
    if (btnModal) { btnModal.disabled = false; btnModal.innerHTML = '▶ Next Round <span id="auto-advance-timer"></span>'; }

    if (!response.success) {
      showToast(response.error || 'Failed to start new round', 'error');
    } else {
      showingResult = false;
      roundResultData = null;
      document.getElementById('winner-overlay').style.display = 'none';
      document.getElementById('round-actions').style.display = 'none';
    }
  });
}

function handleGameEnd(data) {
  clearInterval(nextRoundTimer);
  showingResult = false;
  document.getElementById('winner-overlay').style.display = 'none';
  document.getElementById('round-actions').style.display = 'none';

  const overlay = document.getElementById('game-over-overlay');
  const details = document.getElementById('game-over-details');
  if (details) {
    const winnerName = data && data.winner ? escapeHtml(data.winner.name) : 'A player';
    details.innerHTML = `
      <div class="winner-name">${winnerName} won the match!</div>
      <p style="color:var(--text-secondary);margin-top:10px;font-size:14px;">All other players have been eliminated.</p>
    `;
  }
  if (overlay) overlay.style.display = 'flex';
}

function resetGame() {
  document.getElementById('game-over-overlay').style.display = 'none';
  socket.emit('reset-game', (response) => {
    if (!response.success) {
      showToast(response.error || 'Failed to restart game', 'error');
    } else {
      showToast('Game restarted with fresh chips!', 'success');
    }
  });
}

// ==================== REBUY & HOST POWERS ====================
function playerRebuy(amount) {
  const rebuyAmount = amount || 1000;
  socket.emit('player-rebuy', { amount: rebuyAmount }, (response) => {
    if (!response.success) {
      showToast(response.error || 'Rebuy failed', 'error');
    } else {
      const bustedModal = document.getElementById('busted-modal');
      if (bustedModal) bustedModal.style.display = 'none';
      const rebuyBtn = document.getElementById('btn-rebuy');
      if (rebuyBtn) rebuyBtn.classList.remove('btn-pulse');
      showToast(`Rebought ${formatChips(rebuyAmount)} chips! Ready for next hand.`, 'success');
    }
  });
}

function dismissBustedModal() {
  const bustedModal = document.getElementById('busted-modal');
  if (bustedModal) bustedModal.style.display = 'none';
}

function openHostControls() {
  if (!isHost) {
    showToast('Only the host can open host controls', 'error');
    return;
  }
  const modal = document.getElementById('host-controls-modal');
  if (modal) {
    modal.style.display = 'flex';
    renderHostPlayersList();

    // Populate current blinds
    const sbInput = document.getElementById('host-setting-sb');
    const bbInput = document.getElementById('host-setting-bb');
    if (currentRoomData && currentRoomData.settings) {
      if (sbInput) sbInput.value = currentRoomData.settings.smallBlind || 10;
      if (bbInput) bbInput.value = currentRoomData.settings.bigBlind || 20;
    }

    // Populate tournament settings
    const tournamentCheckbox = document.getElementById('host-setting-tournament');
    const intervalInput = document.getElementById('host-setting-interval');
    if (currentRoomData && currentRoomData.settings) {
      if (tournamentCheckbox) tournamentCheckbox.checked = !!currentRoomData.settings.tournamentMode;
      if (intervalInput) intervalInput.value = currentRoomData.settings.blindIncreaseMinutes || 5;
    }
  }
}

function closeHostControls() {
  const modal = document.getElementById('host-controls-modal');
  if (modal) modal.style.display = 'none';
}

function renderHostPlayersList() {
  const container = document.getElementById('host-players-list');
  const botsContainer = document.getElementById('host-bots-list');
  if (container) container.innerHTML = '';
  if (botsContainer) botsContainer.innerHTML = '';

  const players = (currentRoomData && currentRoomData.players) ? currentRoomData.players : (gameState ? gameState.players : []);
  if (!players || players.length === 0) {
    if (container) container.innerHTML = '<p style="color:var(--text-muted);font-size:12px;">No players in room</p>';
    return;
  }

  const humanPlayers = players.filter(p => !p.isBot);
  const botPlayers = players.filter(p => p.isBot);

  // Render Humans
  if (container) {
    if (humanPlayers.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);font-size:12px;">No human players</p>';
    } else {
      humanPlayers.forEach(player => {
        const isMe = (player.id === myId);
        const row = document.createElement('div');
        row.className = 'host-player-row';
        row.innerHTML = `
          <div class="host-player-info">
            <span>${escapeHtml(player.name)} ${isMe ? '(You)' : ''}</span>
            <span class="chips-tag">💰 ${formatChips(player.chips)}</span>
            ${!player.connected ? '<span style="color:var(--text-muted);font-size:11px;">(offline)</span>' : ''}
          </div>
          <div class="host-player-actions">
            <button class="btn btn-small btn-success" onclick="hostAddChips('${player.id}', 500)" title="Give +500 chips">+500</button>
            <button class="btn btn-small btn-primary" onclick="hostAddChips('${player.id}', 1000)" title="Give +1,000 chips">+1k</button>
            ${!isMe ? `
              <button class="btn btn-small btn-secondary" onclick="hostTransfer('${player.id}')" title="Make Host">👑 Host</button>
              <button class="btn btn-small btn-danger" onclick="hostKick('${player.id}')" title="Kick Player">🚫 Kick</button>
            ` : ''}
          </div>
        `;
        container.appendChild(row);
      });
    }
  }

  // Render Bots
  if (botsContainer) {
    if (botPlayers.length === 0) {
      botsContainer.innerHTML = '<p style="color:var(--text-muted);font-size:12px;">No bots added yet. Click "+ Add AI Bot" to seat an automated player.</p>';
    } else {
      botPlayers.forEach(bot => {
        const row = document.createElement('div');
        row.className = 'host-player-row';
        row.innerHTML = `
          <div class="host-player-info">
            <span>🤖 ${escapeHtml(bot.name)}</span>
            <span class="chips-tag">💰 ${formatChips(bot.chips)}</span>
          </div>
          <div class="host-player-actions">
            <button class="btn btn-small btn-success" onclick="hostAddChips('${bot.id}', 500)">+500</button>
            <button class="btn btn-small btn-primary" onclick="hostAddChips('${bot.id}', 1000)">+1k</button>
            <button class="btn btn-small btn-danger" onclick="hostRemoveBot('${bot.id}')">✕ Remove</button>
          </div>
        `;
        botsContainer.appendChild(row);
      });
    }
  }
}

function hostAddBot() {
  socket.emit('host-add-bot', (res) => {
    if (!res.success) {
      showToast(res.error || 'Failed to add bot', 'error');
    } else {
      showToast(`Added ${res.bot.name} to the table!`, 'success');
      renderHostPlayersList();
    }
  });
}

function hostRemoveBot(botId) {
  socket.emit('host-remove-bot', { botId }, (res) => {
    if (!res.success) {
      showToast(res.error || 'Failed to remove bot', 'error');
    } else {
      showToast('Bot removed', 'success');
      renderHostPlayersList();
    }
  });
}

function applyTournamentSettings() {
  const checkbox = document.getElementById('host-setting-tournament');
  const intervalInput = document.getElementById('host-setting-interval');
  const enabled = checkbox ? checkbox.checked : false;
  const increaseMinutes = intervalInput ? parseInt(intervalInput.value) || 5 : 5;

  socket.emit('host-set-tournament', { enabled, increaseMinutes }, (res) => {
    if (!res.success) {
      showToast(res.error || 'Failed to update tournament settings', 'error');
    } else {
      showToast(enabled ? `Tournament mode enabled (doubles every ${increaseMinutes}m)` : 'Tournament mode disabled', 'success');
    }
  });
}

function hostAddChips(targetPlayerId, amount) {
  socket.emit('host-add-chips', { targetPlayerId, amount }, (response) => {
    if (!response.success) {
      showToast(response.error || 'Failed to grant chips', 'error');
    } else {
      showToast(`Granted ${formatChips(amount)} chips!`, 'success');
      renderHostPlayersList();
    }
  });
}

function hostKick(targetPlayerId) {
  const targetPlayer = (currentRoomData && currentRoomData.players) ? currentRoomData.players.find(p => p.id === targetPlayerId) : null;
  const name = targetPlayer ? targetPlayer.name : 'this player';
  if (!confirm(`Are you sure you want to kick ${name} from the room?`)) return;

  socket.emit('host-kick-player', { targetPlayerId }, (response) => {
    if (!response.success) {
      showToast(response.error || 'Failed to kick player', 'error');
    } else {
      showToast(`Kicked ${name}`, 'success');
      renderHostPlayersList();
    }
  });
}

function hostTransfer(targetPlayerId) {
  const targetPlayer = (currentRoomData && currentRoomData.players) ? currentRoomData.players.find(p => p.id === targetPlayerId) : null;
  const name = targetPlayer ? targetPlayer.name : 'this player';
  if (!confirm(`Pass host powers to ${name}? You will lose host privileges.`)) return;

  socket.emit('host-transfer', { targetPlayerId }, (response) => {
    if (!response.success) {
      showToast(response.error || 'Failed to transfer host', 'error');
    } else {
      showToast(`Host powers transferred to ${name}`, 'success');
      closeHostControls();
    }
  });
}

function applyHostBlinds() {
  const sb = parseInt(document.getElementById('host-setting-sb').value) || 10;
  const bb = parseInt(document.getElementById('host-setting-bb').value) || 20;

  socket.emit('host-change-blinds', { smallBlind: sb, bigBlind: bb }, (response) => {
    if (!response.success) {
      showToast(response.error || 'Failed to update blinds', 'error');
    } else {
      showToast(`Blinds updated to ${sb} / ${bb}`, 'success');
    }
  });
}

function forceNextRoundFromHost() {
  closeHostControls();
  requestNewRound();
}

function resetAllChipsFromHost() {
  if (!confirm('Reset all players to 1,000 chips and start a fresh hand?')) return;
  closeHostControls();
  resetGame();
}

// ==================== CHAT ====================
function sendChatMessage() {
  let input;
  const gameView = document.getElementById('game-view');
  if (gameView.classList.contains('active')) {
    input = document.getElementById('game-chat-input');
  } else {
    input = document.getElementById('room-chat-input');
  }

  const message = input.value.trim();
  if (!message) return;

  socket.emit('chat-message', { message });
  input.value = '';
  input.focus();
}

function addChatMessage(playerName, message, timestamp) {
  const time = timestamp ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  const msgHTML = `
    <div class="chat-message">
      <span class="chat-name">${escapeHtml(playerName)}</span><span class="chat-time">${time}</span>
      <div class="chat-text">${escapeHtml(message)}</div>
    </div>
  `;

  // Add to both chat containers
  const roomChat = document.getElementById('room-chat-messages');
  const gameChat = document.getElementById('game-chat-messages');

  if (roomChat) {
    roomChat.innerHTML += msgHTML;
    roomChat.scrollTop = roomChat.scrollHeight;
  }

  if (gameChat) {
    gameChat.innerHTML += msgHTML;
    gameChat.scrollTop = gameChat.scrollHeight;
  }
}

function toggleChat() {
  const sidebar = document.getElementById('game-chat-sidebar');
  chatOpen = !chatOpen;
  sidebar.classList.toggle('open', chatOpen);
}

// ==================== CARD RENDERING ====================
function getCardHTML(card, faceDown, sizeClass) {
  sizeClass = sizeClass || '';
  const sizeStr = sizeClass ? ' card-' + sizeClass : '';

  if (faceDown || !card) {
    return `<div class="card card-back${sizeStr}"></div>`;
  }

  const suitSymbol = getSuitSymbol(card.suit);
  const suitColor = getSuitColor(card.suit);
  const suitLetter = card.suit ? card.suit.charAt(0).toLowerCase() : '';
  const display = card.display || card.value;

  return `<div class="card card-face suit-${suitColor} suit-${suitLetter}${sizeStr}" data-suit="${card.suit}">
    <span class="card-value">${escapeHtml(display)}</span>
    <span class="card-suit">${suitSymbol}</span>
  </div>`;
}

function getSuitSymbol(suit) {
  const symbols = {
    hearts: '♥',
    diamonds: '♦',
    clubs: '♣',
    spades: '♠',
  };
  return symbols[suit] || '?';
}

function getSuitColor(suit) {
  return (suit === 'hearts' || suit === 'diamonds') ? 'red' : 'black';
}

// ==================== UTILITY ====================
function formatChips(amount) {
  if (amount == null) return '0';
  return Number(amount).toLocaleString();
}

function copyRoomCode() {
  const code = document.getElementById('room-code-value').textContent;
  if (!code || code === '----') return;

  if (navigator.clipboard) {
    navigator.clipboard.writeText(code).then(() => {
      showToast('Room code copied!', 'success');
    }).catch(() => {
      fallbackCopy(code);
    });
  } else {
    fallbackCopy(code);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    showToast('Room code copied!', 'success');
  } catch (e) {
    showToast('Could not copy', 'error');
  }
  document.body.removeChild(ta);
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ==================== TOAST NOTIFICATIONS ====================
function showToast(message, type) {
  type = type || '';
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast' + (type ? ' toast-' + type : '');
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, 3000);
}

// ==================== SHARE LINK ====================
function copyShareLink() {
  const roomId = currentRoom || (currentRoomData && currentRoomData.id);
  if (!roomId) {
    showToast('No room code available', 'error');
    return;
  }
  const inviteUrl = `${window.location.origin}/?room=${encodeURIComponent(roomId)}`;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(inviteUrl).then(() => {
      showToast('🔗 Invite link copied to clipboard!', 'success');
    }).catch(() => {
      fallbackCopy(inviteUrl);
    });
  } else {
    fallbackCopy(inviteUrl);
  }
}

// ==================== THEMES & 4-COLOR DECK ====================
const THEMES = ['theme-emerald', 'theme-midnight', 'theme-crimson', 'theme-carbon'];
let currentThemeIndex = 0;

function cycleTheme() {
  currentThemeIndex = (currentThemeIndex + 1) % THEMES.length;
  applyTheme(THEMES[currentThemeIndex]);
}

function applyTheme(themeClass) {
  const felt = document.getElementById('table-felt');
  if (felt) {
    THEMES.forEach(t => felt.classList.remove(t));
    felt.classList.add(themeClass);
  }
  localStorage.setItem('poker_theme', themeClass);
  const themeBtn = document.getElementById('btn-theme-toggle');
  if (themeBtn) {
    const names = {
      'theme-emerald': 'Emerald',
      'theme-midnight': 'Midnight',
      'theme-crimson': 'Crimson',
      'theme-carbon': 'Carbon'
    };
    themeBtn.textContent = `🎨 ${names[themeClass] || 'Felt'}`;
  }
}

let fourColorEnabled = false;

function toggleFourColorDeck() {
  fourColorEnabled = !fourColorEnabled;
  const gameView = document.getElementById('game-view');
  if (gameView) {
    gameView.classList.toggle('deck-4color', fourColorEnabled);
  }
  localStorage.setItem('poker_4color', fourColorEnabled ? 'true' : 'false');
  const btn = document.getElementById('btn-deck-toggle');
  if (btn) btn.classList.toggle('btn-active', fourColorEnabled);
  if (gameState) renderTable(gameState);
}

function toggleSound() {
  if (window.pokerAudio) {
    const isEnabled = window.pokerAudio.toggleSound();
    const btn = document.getElementById('btn-sound-toggle');
    if (btn) btn.textContent = isEnabled ? '🔊' : '🔇';
    showToast(isEnabled ? 'Sound effects enabled' : 'Sound effects muted', 'info');
  }
}

// ==================== TABLE REACTIONS ====================
function sendReaction(reaction) {
  socket.emit('send-reaction', { reaction });
  if (window.pokerAudio) window.pokerAudio.playReactionSound(reaction);
}

function handleTableReaction(data) {
  const { playerId, reaction } = data;
  if (window.pokerAudio) window.pokerAudio.playReactionSound(reaction);

  const layer = document.getElementById('table-reactions-layer');
  if (!layer) return;

  const seatEl = document.getElementById(`seat-${playerId}`);
  const feltEl = document.getElementById('table-felt');
  let x = 50, y = 50;

  if (seatEl && feltEl) {
    const seatRect = seatEl.getBoundingClientRect();
    const feltRect = feltEl.getBoundingClientRect();
    x = ((seatRect.left + seatRect.width / 2 - feltRect.left) / feltRect.width) * 100;
    y = ((seatRect.top + seatRect.height / 2 - feltRect.top) / feltRect.height) * 100;
  }

  const emojiEl = document.createElement('div');
  emojiEl.className = 'floating-reaction';
  emojiEl.textContent = reaction;
  emojiEl.style.left = `${Math.max(10, Math.min(90, x))}%`;
  emojiEl.style.top = `${Math.max(10, Math.min(90, y))}%`;

  layer.appendChild(emojiEl);
  setTimeout(() => emojiEl.remove(), 2300);
}

// ==================== TURN TIMER (SHOT CLOCK) ====================
let activeTurnInterval = null;
let activeTurnData = null;

function handleTurnTimer(timerData) {
  if (activeTurnInterval) {
    clearInterval(activeTurnInterval);
    activeTurnInterval = null;
  }

  // Reset all visual indicators
  document.querySelectorAll('.turn-timer-fill').forEach(el => {
    el.style.width = '0%';
    el.classList.remove('timer-warning', 'timer-critical');
  });
  document.querySelectorAll('.seat-avatar').forEach(el => {
    el.classList.remove('seat-active-turn');
  });

  if (!timerData) {
    activeTurnData = null;
    return;
  }

  activeTurnData = timerData;
  const { playerId, duration, startedAt } = timerData;

  const seatEl = document.getElementById(`seat-${playerId}`);
  if (seatEl) {
    const avatar = seatEl.querySelector('.player-avatar') || seatEl.querySelector('.seat-avatar');
    if (avatar) avatar.classList.add('seat-active-turn');
  }

  let hasBeeped = false;

  activeTurnInterval = setInterval(() => {
    const elapsed = (Date.now() - startedAt) / 1000;
    const remaining = Math.max(0, duration - elapsed);
    const percent = Math.max(0, Math.min(100, (remaining / duration) * 100));

    const fill = document.getElementById(`timer-fill-${playerId}`);
    if (fill) {
      fill.style.width = `${percent}%`;
      if (remaining <= 5) {
        fill.classList.remove('timer-warning');
        fill.classList.add('timer-critical');
        if (Math.floor(remaining) !== hasBeeped && playerId === myId) {
          hasBeeped = Math.floor(remaining);
          if (window.pokerAudio) window.pokerAudio.playTimerTick();
        }
      } else if (remaining <= 10) {
        fill.classList.add('timer-warning');
      }
    }

    if (remaining <= 0) {
      clearInterval(activeTurnInterval);
      activeTurnInterval = null;
    }
  }, 100);
}

// ==================== SESSION LEDGER ====================
function openLedgerModal() {
  socket.emit('get-ledger', (response) => {
    if (!response.success) {
      showToast(response.error || 'Failed to fetch ledger', 'error');
      return;
    }
    renderLedgerTable(response.ledger);
    const modal = document.getElementById('ledger-modal');
    if (modal) modal.style.display = 'flex';
  });
}

function closeLedgerModal() {
  const modal = document.getElementById('ledger-modal');
  if (modal) modal.style.display = 'none';
}

function renderLedgerTable(ledger) {
  const container = document.getElementById('ledger-table-container');
  if (!container) return;

  if (!ledger || ledger.length === 0) {
    container.innerHTML = '<p style="color:var(--text-secondary);text-align:center;">No player data available yet.</p>';
    return;
  }

  let html = `
    <table class="ledger-table">
      <thead>
        <tr>
          <th>Player</th>
          <th>Buy-In</th>
          <th>Rebuys</th>
          <th>Current Stack</th>
          <th>Net P/L</th>
        </tr>
      </thead>
      <tbody>
  `;

  ledger.forEach(p => {
    const pClass = p.netProfit > 0 ? 'profit-positive' : (p.netProfit < 0 ? 'profit-negative' : 'profit-zero');
    const prefix = p.netProfit > 0 ? '+' : '';
    html += `
      <tr>
        <td>
          <strong>${escapeHtml(p.name)}</strong>
          ${p.isBot ? '<span class="bot-badge">BOT</span>' : ''}
          ${!p.connected ? '<span style="color:var(--text-muted);font-size:11px;"> (away)</span>' : ''}
        </td>
        <td>${formatChips(p.totalBuyIn)}</td>
        <td>${p.rebuys || 0}</td>
        <td>${formatChips(p.chips)}</td>
        <td class="${pClass}">${prefix}${formatChips(p.netProfit)}</td>
      </tr>
    `;
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

