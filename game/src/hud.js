// The HUD: DOM over the canvas — crosshair, health, money, ammo, team counts,
// the round timer, the kill feed, hit markers and the buy menu. The game calls
// render(state) once per frame; only changed text is written to the DOM.
//
// render() is split into one helper per HUD region (vitals, scoreboard,
// crosshair, hit feedback, plant bar, buy menu) so a region can be read
// without the rest of the frame's updates in the way.
export function createHud(document, callbacks) {
  const root = document.createElement('div');
  root.id = 'hud';
  root.innerHTML = `
    <div id="crosshair"><span class="dot"></span><span class="line top"></span><span class="line bottom"></span><span class="line left"></span><span class="line right"></span></div>
    <div id="hitmarker"></div>
    <div id="damage-vignette"></div>
    <div id="topbar">
      <div class="team aegis"><span id="score-aegis">0</span><span class="alive" id="alive-aegis"></span></div>
      <div id="timer">1:40</div>
      <div class="team ember"><span class="alive" id="alive-ember"></span><span id="score-ember">0</span></div>
    </div>
    <div id="objective"></div>
    <div id="killfeed"></div>
    <div id="announce"></div>
    <div id="bottom-left">
      <div id="health"><span id="hp">100</span><span class="label">HP</span></div>
      <div id="armor"><span id="ap">0</span><span class="label">ARMOR</span></div>
    </div>
    <div id="bottom-right">
      <div id="money">$800</div>
      <div id="ammo"><span id="mag">12</span><span class="reserve">/ 48</span></div>
      <div id="weapon-name">P-9 Sidearm</div>
    </div>
    <div id="plant-bar"><div id="plant-fill"></div><span id="plant-label"></span></div>
    <div id="buy-menu" class="hidden">
      <h2>BUY — press B to close</h2>
      <div class="buy-grid" id="buy-grid"></div>
      <p class="buy-hint">Keys 1–5 buy · B closes the menu</p>
    </div>
    <div id="overlay" class="hidden"></div>
  `;
  document.body.appendChild(root);

  const el = (id) => root.querySelector(`#${id}`);
  const crosshair = el('crosshair');
  const hitmarker = el('hitmarker');
  const vignette = el('damage-vignette');
  let hitAt = 0;
  let hurtAt = 0;
  let lastRendered = {};

  // Write text only when it changed, so the DOM is not touched every frame.
  function setText(id, value) {
    if (lastRendered[id] !== value) {
      lastRendered[id] = value;
      el(id).textContent = value;
    }
  }

  const buyItems = [
    { key: '1', name: 'Wasp-9 SMG', price: 900, id: 'smg' },
    { key: '2', name: 'Longbow AR', price: 2700, id: 'rifle' },
    { key: '3', name: 'Sparker frag', price: 300, id: 'frag' },
    { key: '4', name: 'Veil smoke', price: 200, id: 'smoke' },
    { key: '5', name: 'Armor', price: 650, id: 'armor' },
  ];
  const grid = el('buy-grid');
  buildBuyGrid();

  function buildBuyGrid() {
    for (const item of buyItems) {
      const button = document.createElement('button');
      button.className = 'buy-item';
      button.dataset.id = item.id;
      button.innerHTML = `<span class="buy-key">${item.key}</span><span class="buy-name">${item.name}</span><span class="buy-price">$${item.price}</span>`;
      button.addEventListener('click', () => callbacks.buy(item.id));
      grid.appendChild(button);
    }
  }

  // ---- Per-frame region updates. ----

  function updateVitals(state) {
    setText('hp', String(state.health));
    setText('ap', String(state.armor));
    setText('money', `$${state.money}`);
    setText('mag', String(state.ammo.mag));
    const reserve = el('ammo').querySelector('.reserve');
    const reserveText = `/ ${state.ammo.reserve}`;
    if (lastRendered.reserve !== reserveText) {
      lastRendered.reserve = reserveText;
      reserve.textContent = reserveText;
    }
    setText('weapon-name', state.weaponName);
  }

  function updateScoreboard(state) {
    setText('score-aegis', String(state.score.aegis));
    setText('score-ember', String(state.score.ember));
    setText('timer', state.timerText);
    setText('objective', state.objectiveText);
    // Alive pips: filled dots for the living, hollow for the fallen.
    const aliveA = '●'.repeat(state.alive.aegis) + '○'.repeat(5 - state.alive.aegis);
    const aliveE = '●'.repeat(state.alive.ember) + '○'.repeat(5 - state.alive.ember);
    setText('alive-aegis', aliveA);
    setText('alive-ember', aliveE);
  }

  function updateCrosshair(state) {
    // The gap opens with spread: at least 4 px, wider while moving.
    const gap = Math.max(4, 7 + state.spread * 900);
    crosshair.style.setProperty('--gap', `${gap}px`);
    crosshair.classList.toggle('hidden', state.pointerLocked === false || state.phase !== 'play');
  }

  function updateHitFeedback(state) {
    if (state.hitAt && state.hitAt !== hitAt) {
      hitAt = state.hitAt;
      hitmarker.classList.add('show', state.hitHead ? 'head' : '');
      setTimeout(() => hitmarker.classList.remove('show', 'head'), 120);
    }
    if (state.hurtAt && state.hurtAt !== hurtAt) {
      hurtAt = state.hurtAt;
      vignette.classList.add('show');
      setTimeout(() => vignette.classList.remove('show'), 300);
    }
  }

  function updateChannelBar(state) {
    const plantBar = el('plant-bar');
    if (state.channel) {
      plantBar.classList.add('show');
      el('plant-fill').style.width = `${Math.round(state.channel.progress * 100)}%`;
      setText('plant-label', state.channel.label);
    } else {
      plantBar.classList.remove('show');
    }
  }

  return {
    render(state) {
      updateVitals(state);
      updateScoreboard(state);
      updateCrosshair(state);
      updateHitFeedback(state);
      updateChannelBar(state);
      el('buy-menu').classList.toggle('hidden', !state.buyOpen);
    },
    announce(text, sub = '') {
      const box = el('announce');
      box.innerHTML = `<div class="announce-title">${text}</div>${sub ? `<div class="announce-sub">${sub}</div>` : ''}`;
      box.classList.add('show');
      clearTimeout(this._announceTimer);
      this._announceTimer = setTimeout(() => box.classList.remove('show'), 2600);
    },
    feed(html) {
      const feed = el('killfeed');
      const row = document.createElement('div');
      row.className = 'feed-row';
      row.innerHTML = html;
      feed.prepend(row);
      while (feed.children.length > 5) feed.lastChild.remove();
      setTimeout(() => row.remove(), 6000);
    },
    showOverlay(html) {
      const overlay = el('overlay');
      overlay.innerHTML = html;
      overlay.classList.remove('hidden');
    },
    hideOverlay() {
      el('overlay').classList.add('hidden');
    },
    updateBuy(money, owned) {
      for (const button of grid.querySelectorAll('.buy-item')) {
        const item = buyItems.find((i) => i.id === button.dataset.id);
        const afford = money >= item.price;
        const isOwned = owned.includes(item.id);
        button.classList.toggle('cant', !afford && !isOwned);
        button.classList.toggle('owned', isOwned);
      }
    },
  };
}
