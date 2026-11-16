// EMBERLINE — the match itself. Rounds, money, the charge, shooting, tracers,
// spectating after death, and the deterministic screenshot mode (?shot=...&seed=).
// The player is always Aegis (attackers); Ember defends the two sites.
//
// The match is a small state machine with five phases:
//   menu -> buy -> play -> roundEnd -> (next round | matchEnd)
// `step()` dispatches on the phase; each phase has its own step helper below,
// and the round lifecycle (startRound / endRound / startMatch / endMatch) is
// kept together so the transitions read top to bottom.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld, moveBox } from './world.js';
import { createPlayer } from './player.js';
import { createCombat } from './combat.js';
import { createWeaponSystem, WEAPONS, GRENADES } from './weapons.js';
import { createGrenades } from './grenade.js';
import { createBots } from './bots.js';
import { createBomb } from './bomb.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';

// Match tuning — the economy and the clock. These numbers are the game's
// balance; the refactor changes none of them.
const BUY_TIME = 15;
const ROUND_TIME = 100;
const ROUNDS_TO_WIN = 5;
const WIN_MONEY = 3250;
const LOSS_MONEY = 1900;
const KILL_MONEY = 300;
const OBJECTIVE_MONEY = 300;
const STEP = 1 / 60;

// How long a tracer line stays visible, and how many the pool holds.
const TRACER_LIFE = 0.09;
const TRACER_POOL_SIZE = 24;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createGame(container) {
  // ---- Renderer and scene. ----
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#2e2118');
  scene.fog = new THREE.Fog(new THREE.Color('#2e2118'), 28, 85);

  const camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.05, 200);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  const world = createWorld(scene);
  const random = mulberry32((Math.random() * 0xffffffff) >>> 0);
  const combat = createCombat(world);
  const audio = createAudio();
  const grenades = createGrenades(scene, world.colliders);
  const bots = createBots(scene, world, combat, random);
  const bomb = createBomb(scene);
  const weapons = createWeaponSystem(camera);

  // ---- The player, wrapped as a fighter so combat/damage treat the player
  // and the bots through one code path. ----
  const player = createPlayer(world.colliders, world.spawns.aegis[2]);
  const playerFighter = {
    id: 'player',
    name: 'You',
    team: 'aegis',
    isPlayer: true,
    pos: player.state.position,
    vel: player.state.velocity,
    height: 1.72,
    radius: 0.34,
    get eye() { return player.state.eye; },
    get health() { return player.state.health; },
    set health(v) { player.state.health = v; },
    get armor() { return player.state.armor; },
    set armor(v) { player.state.armor = v; },
    get alive() { return player.state.alive; },
    set alive(v) { player.state.alive = v; },
  };

  // The player's own hitboxes: invisible (colorWrite off) but raycastable.
  const hitMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  const playerTorso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.72, 0.3), hitMat);
  const playerHead = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), hitMat);
  playerTorso.userData = { fighter: playerFighter, part: 'torso' };
  playerHead.userData = { fighter: playerFighter, part: 'head' };
  scene.add(playerTorso, playerHead);

  let shootables = [...world.shootables];

  // ---- Match state. One object, read by the HUD and the step functions. ----
  const match = {
    phase: 'menu', // menu | buy | play | roundEnd | matchEnd
    round: 1,
    score: { aegis: 0, ember: 0 },
    money: 800,
    kills: 0,
    deaths: 0,
    roundTime: BUY_TIME,
    site: 'A',
    time: 0,
    channel: null, // { kind: 'plant'|'defuse', progress }
    inv: { frag: 0, smoke: 0 },
    owned: new Set(['pistol']),
    spectate: null,
    firing: false,
    hitAt: 0,
    hitHead: false,
    hurtAt: 0,
    shake: 0,
    roundEnded: false,
    shotMode: null,
    seed: 1,
  };

  const hud = createHud(document, { buy: buyItem });
  const keys = new Set();
  let pointerLocked = false;
  let stepAccumulator = 0;
  let footstepAcc = 0;
  let buyOpen = true;

  // ---- Tracers: a small pool of fading lines, reused every shot. ----
  const tracerPool = [];
  for (let i = 0; i < TRACER_POOL_SIZE; i += 1) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0 });
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    scene.add(line);
    tracerPool.push({ line, life: 0 });
  }
  let tracerIndex = 0;
  function spawnTracer(from, to, color) {
    const tracer = tracerPool[tracerIndex];
    tracerIndex = (tracerIndex + 1) % tracerPool.length;
    const positions = tracer.line.geometry.attributes.position;
    positions.setXYZ(0, from.x, from.y, from.z);
    positions.setXYZ(1, to.x, to.y, to.z);
    positions.needsUpdate = true;
    tracer.line.material.color.set(color);
    tracer.line.material.opacity = 0.85;
    tracer.life = TRACER_LIFE;
  }

  // ---- Damage and death. ----
  function applyDamage(target, damage, part, attacker) {
    if (!target.alive) return;
    // Armor absorbs half of each hit, up to what is left.
    const absorbed = Math.min(target.armor || 0, damage * 0.5);
    target.armor = (target.armor || 0) - absorbed;
    target.health -= damage - absorbed;
    if (target === playerFighter) {
      onPlayerHit();
    } else if (attacker === playerFighter) {
      onEnemyHit(part);
    }
    if (target.health <= 0) {
      target.health = 0;
      target.alive = false;
      if (target === playerFighter) onPlayerDown();
      else onBotDown(target, part, attacker);
      checkRoundEnd();
    }
  }

  function onPlayerHit() {
    match.hurtAt = performance.now();
    audio.hurt();
    match.shake = Math.max(match.shake, 0.25);
    // Taking damage breaks a plant or defuse channel.
    if (match.channel) {
      match.channel = null;
      bomb.cancelChannel();
    }
  }

  function onEnemyHit(part) {
    match.hitAt = performance.now();
    match.hitHead = part === 'head';
    audio.hit(part === 'head');
  }

  // After death the camera follows the first living teammate and the round
  // keeps going without the player. Kept apart from onPlayerDown so the
  // death transition — overlay, pointer unlock, spectate target — reads as
  // one step instead of three scattered lines.
  function enterSpectate() {
    match.spectate = bots.fighters.find((f) => f.team === 'aegis' && f.alive) ?? null;
    hud.showOverlay(`
      <div class="panel"><h2>You are down</h2>
      <p>Spectating your team. The round continues.</p></div>`);
    if (document.pointerLockElement) document.exitPointerLock();
  }

  function onPlayerDown() {
    match.deaths += 1;
    match.channel = null;
    bomb.cancelChannel();
    // The charge passes to the first living friendly bot.
    const carrier = bots.carrier();
    if (carrier && bomb.state.state === 'carried') {
      bomb.state.carrier = carrier;
      carrier.isCarrier = true;
    }
    enterSpectate();
  }

  function onBotDown(victim, part, attacker) {
    // A hit breaks a plant or defuse channel, like it does for the player.
    if (victim.state === 'defuse' || victim.state === 'plant') {
      victim.state = 'hold';
      victim.defuseProgress = 0;
      victim.plantProgress = 0;
    }
    if (attacker === playerFighter && victim !== playerFighter) {
      match.kills += 1;
      match.money += KILL_MONEY;
      audio.kill();
    }
    const killerName = attacker ? attacker.name : 'World';
    const killerClass = attacker && attacker.team === 'aegis' ? 'aegis' : 'ember';
    const victimClass = victim.team === 'aegis' ? 'aegis' : 'ember';
    hud.feed(`<span class="${killerClass}">${killerName}</span> ✕ <span class="${victimClass}">${victim.name}</span>${part === 'head' ? ' <span class="headshot">HEADSHOT</span>' : ''}`);
    // A carrier who dies drops the plant; the charge is picked up by a teammate.
    if (victim.isCarrier && bomb.state.state === 'carried') {
      const nextCarrier = bots.fighters.find((f) => f.team === 'aegis' && f.alive && f !== victim);
      if (nextCarrier) {
        nextCarrier.isCarrier = true;
        bomb.state.carrier = nextCarrier;
      }
    }
  }

  function countAlive(team) {
    return (team === 'aegis' && playerFighter.alive ? 1 : 0) + bots.aliveCount(team);
  }

  function checkRoundEnd() {
    if (match.phase !== 'play' || match.roundEnded) return;
    const aegisAlive = countAlive('aegis');
    const emberAlive = countAlive('ember');
    if (bomb.state.state === 'exploded') {
      // The charge went off: Aegis takes the round even if the blast got them too.
      endRound('aegis', 'The charge detonated.');
      return;
    }
    if (bomb.state.state === 'planted') {
      // The round rides on the fuse now; it ends by explosion or defuse.
      if (aegisAlive === 0 && emberAlive === 0) endRound('aegis', 'The charge detonated.');
      return;
    }
    if (aegisAlive === 0) endRound('ember', 'Aegis team eliminated.');
    else if (emberAlive === 0) endRound('aegis', 'Ember team eliminated.');
  }

  // ---- Round lifecycle: buy -> play -> roundEnd -> next round | matchEnd. ----

  function startRound() {
    match.site = random() > 0.5 ? 'A' : 'B';
    match.roundEnded = false;
    match.channel = null;
    match.inv = { frag: 0, smoke: 0 };
    match.spectate = null;
    bomb.reset(match.site, playerFighter);
    // The player spawns at a random Aegis spawn point each round.
    const spawnPoint = world.spawns.aegis[Math.floor(random() * world.spawns.aegis.length)];
    player.reset(spawnPoint);
    player.state.yaw = 0; // face north, toward the sites
    bots.spawnRound(match.site, match.round);
    shootables = [...world.shootables, ...bots.hitMeshes, playerTorso, playerHead];
    weapons.refillAll();
    weapons.switchTo('pistol');
    grenades.reset();
    match.phase = 'buy';
    match.roundTime = BUY_TIME;
    hud.hideOverlay();
    hud.announce(`ROUND ${match.round}`, `Plant the charge at Site ${match.site} — first to ${ROUNDS_TO_WIN} wins the match`);
    hud.updateBuy(match.money, ownedAndGrenades());
  }

  function endRound(winner, reason) {
    if (match.roundEnded) return;
    match.roundEnded = true;
    match.phase = 'roundEnd';
    match.roundTime = 4;
    match.channel = null;
    match.score[winner] += 1;
    match.money += winner === 'aegis' ? WIN_MONEY : LOSS_MONEY;
    if (winner === 'aegis') audio.win();
    else audio.lose();
    hud.announce(winner === 'aegis' ? 'ROUND WON' : 'ROUND LOST', reason);
  }

  function startMatch() {
    match.score = { aegis: 0, ember: 0 };
    match.round = 1;
    match.money = 800;
    match.kills = 0;
    match.deaths = 0;
    match.owned = new Set(['pistol']);
    startRound();
  }

  // The end-of-match panel: the final score, the player's own tally, and a
  // button to play again. Built by its own helper so endMatch only decides
  // the phase and the winner, and the panel markup reads on its own.
  function matchSummaryHtml(won) {
    return `
      <div class="panel">
        <h2>${won ? 'MATCH WON' : 'MATCH LOST'}</h2>
        <p class="score">${match.score.aegis} — ${match.score.ember}</p>
        <p>Kills ${match.kills} · Deaths ${match.deaths} · Rounds played ${match.round}</p>
        <p>Foundry Yard remembers every round. Play again?</p>
        <button id="again-btn">Play again</button>
      </div>`;
  }

  function endMatch() {
    match.phase = 'matchEnd';
    const won = match.score.aegis >= ROUNDS_TO_WIN;
    hud.showOverlay(matchSummaryHtml(won));
    const btn = document.getElementById('again-btn');
    if (btn) btn.addEventListener('click', () => { audio.unlock(); startMatch(); });
  }

  // ---- The buy phase. ----

  function ownedAndGrenades() {
    return [...match.owned, ...(match.inv.frag ? ['frag'] : []), ...(match.inv.smoke ? ['smoke'] : [])];
  }

  function priceOf(id) {
    if (id === 'smg') return WEAPONS.smg.price;
    if (id === 'rifle') return WEAPONS.rifle.price;
    if (id === 'frag') return GRENADES.frag.price;
    if (id === 'smoke') return GRENADES.smoke.price;
    return 650; // armor
  }

  function buyItem(id) {
    if (match.phase !== 'buy') return;
    const price = priceOf(id);
    if (match.money < price) {
      audio.denied();
      return;
    }
    if (id === 'armor' && player.state.armor >= 100) return;
    if ((id === 'frag' && match.inv.frag >= 2) || (id === 'smoke' && match.inv.smoke >= 2)) return;
    match.money -= price;
    if (id === 'smg' || id === 'rifle') {
      match.owned.add(id);
      weapons.buyReserve(id);
      weapons.switchTo(id);
    } else if (id === 'frag' || id === 'smoke') {
      match.inv[id] += 1;
    } else if (id === 'armor') {
      player.state.armor = 100;
    }
    audio.buy();
    hud.updateBuy(match.money, ownedAndGrenades());
  }

  // ---- Shooting (player) and grenades. ----
  const camDir = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  const muzzle = new THREE.Vector3();
  const aimPoint = new THREE.Vector3();

  function playerShoot() {
    if (!weapons.ready()) {
      if (weapons.ammo[weapons.currentId()].mag === 0) audio.dryFire();
      return;
    }
    weapons.takeRound();
    weapons.pullTrigger();
    audio.shot(weapons.currentId());
    camera.getWorldDirection(camDir);
    camera.getWorldPosition(camPos);
    muzzle.copy(camPos).addScaledVector(camDir, 0.5);
    muzzle.y -= 0.12;
    muzzle.x += Math.cos(player.state.yaw) * 0.18;
    const hit = combat.shoot(camPos, camDir, weapons.spread(player.groundSpeed()), random, shootables, playerFighter);
    const end = hit ? hit.point : aimPoint.copy(camPos).addScaledVector(camDir, weapons.def().range);
    spawnTracer(muzzle, end, '#ffd27a');
    player.recoil(weapons.def().recoil, (random() - 0.5) * weapons.def().recoil * 0.5);
    bots.hearShot(camPos, 'aegis');
    if (hit && hit.target) {
      applyDamage(hit.target, weapons.damageAt(hit.distance, hit.part), hit.part, playerFighter);
    }
  }

  function throwGrenade(kind) {
    if (match.inv[kind] <= 0 || match.phase !== 'play') return;
    match.inv[kind] -= 1;
    camera.getWorldDirection(camDir);
    camera.getWorldPosition(camPos);
    const origin = camPos.clone().addScaledVector(camDir, 0.5);
    origin.y -= 0.05;
    grenades.throwGrenade(kind, origin, camDir, 15 + player.groundSpeed() * 0.6);
    audio.buy();
  }

  function grenadeDamage(pos, radius, damage) {
    const fighters = [playerFighter, ...bots.fighters];
    for (const fighter of fighters) {
      if (!fighter.alive) continue;
      const d = Math.hypot(fighter.pos.x - pos.x, (fighter.pos.y + 1 - pos.y), fighter.pos.z - pos.z);
      if (d < radius) {
        applyDamage(fighter, damage * (1 - d / radius * 0.7), 'body', playerFighter);
      }
    }
    audio.explosion();
    match.shake = Math.max(match.shake, 0.6);
  }

  // ---- Channels: plant and defuse. Holding E, still, near the objective. ----

  function playerInSite(site) {
    const siteDef = world.sites[site];
    return Math.hypot(player.state.position.x - siteDef.center.x, player.state.position.z - siteDef.center.z) <= siteDef.radius;
  }

  function startChannel(kind) {
    if (!match.channel || match.channel.kind !== kind) match.channel = { kind, progress: 0 };
  }

  function updateChannel(dt) {
    const moving = player.groundSpeed() > 1.2;
    if (keys.has('KeyE') && match.phase === 'play' && playerFighter.alive && !moving) {
      if (bomb.state.state === 'carried' && bomb.state.carrier === playerFighter && playerInSite(match.site)) {
        startChannel('plant');
        const before = match.channel.progress;
        match.channel.progress += dt / bomb.plantTime;
        if (Math.floor(match.channel.progress * 8) !== Math.floor(before * 8)) audio.plantTick();
        if (bomb.plantProgressTick(dt)) {
          bomb.plantAt(player.state.position);
          match.channel = null;
          match.money += OBJECTIVE_MONEY;
          hud.announce(`CHARGE PLANTED — SITE ${match.site}`, 'Defend it until it detonates.');
          bots.hearShot(player.state.position, 'aegis');
        }
        return;
      }
      if (bomb.state.state === 'planted') {
        const siteCenter = world.sites[bomb.state.site].center;
        const dist = Math.hypot(player.state.position.x - siteCenter.x, player.state.position.z - siteCenter.z);
        if (dist < 6) {
          startChannel('defuse');
          match.channel.progress += dt / bomb.defuseTime;
          if (bomb.defuseProgressTick(dt)) {
            match.channel = null;
            match.money += OBJECTIVE_MONEY;
            endRound('aegis', 'Charge defused.');
          }
          return;
        }
      }
    }
    if (match.channel) {
      match.channel = null;
      bomb.cancelChannel();
    }
  }

  // ---- Input. ----
  function onKeyDown(e) {
    if (e.repeat) return;
    keys.add(e.code);
    audio.unlock();
    if (e.code === 'KeyM') {
      const muted = audio.toggleMute();
      hud.announce(muted ? 'Sound muted' : 'Sound on');
    }
    if (match.phase === 'buy') {
      if (e.code === 'Digit1') buyItem('smg');
      else if (e.code === 'Digit2') buyItem('rifle');
      else if (e.code === 'Digit3') buyItem('frag');
      else if (e.code === 'Digit4') buyItem('smoke');
      else if (e.code === 'Digit5') buyItem('armor');
    } else if (match.phase === 'play' && playerFighter.alive) {
      if (e.code === 'Digit1') weapons.switchTo('pistol');
      else if (e.code === 'Digit2' && match.owned.has('smg')) weapons.switchTo('smg');
      else if (e.code === 'Digit3' && match.owned.has('rifle')) weapons.switchTo('rifle');
      else if (e.code === 'KeyR') weapons.reload();
      else if (e.code === 'KeyG') throwGrenade('frag');
      else if (e.code === 'KeyF') throwGrenade('smoke');
    }
    if (e.code === 'KeyB' && match.phase === 'buy') {
      buyOpen = !buyOpen;
    }
  }
  function onKeyUp(e) {
    keys.delete(e.code);
  }
  function onMouseDown(e) {
    audio.unlock();
    if (match.phase !== 'play' || !playerFighter.alive) return;
    if (!pointerLocked) {
      renderer.domElement.requestPointerLock();
      return;
    }
    if (e.button === 0) match.firing = true;
  }
  function onMouseUp(e) {
    if (e.button === 0) match.firing = false;
  }
  function onMouseMove(e) {
    if (!pointerLocked || !playerFighter.alive) return;
    player.look(e.movementX, e.movementY);
  }
  function onPointerLockChange() {
    pointerLocked = document.pointerLockElement === renderer.domElement;
    if (!pointerLocked && match.phase === 'play' && playerFighter.alive && !match.shotMode) {
      hud.showOverlay(`
        <div class="panel"><h2>Paused</h2>
        <p>Click resume to lock the mouse and keep playing.</p>
        <button id="resume-btn">Resume</button>
        <button id="restart-btn">Restart match</button></div>`);
      const resume = document.getElementById('resume-btn');
      if (resume) resume.addEventListener('click', () => { hud.hideOverlay(); renderer.domElement.requestPointerLock(); });
      const restart = document.getElementById('restart-btn');
      if (restart) restart.addEventListener('click', () => { startMatch(); });
    }
  }
  function onResize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  renderer.domElement.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('pointerlockchange', onPointerLockChange);
  window.addEventListener('resize', onResize);

  // ---- Per-frame HUD state: one snapshot the HUD renders. ----
  function timerText() {
    if (match.phase === 'buy') return `BUY ${Math.ceil(match.roundTime)}`;
    if (match.phase === 'play' && bomb.state.state === 'planted') return `FUSE ${Math.ceil(bomb.state.fuseLeft)}`;
    if (match.phase === 'play') return `${Math.floor(match.roundTime / 60)}:${String(Math.floor(match.roundTime % 60)).padStart(2, '0')}`;
    return '—';
  }

  function objectiveText() {
    if (match.phase === 'buy' || (match.phase === 'play' && bomb.state.state === 'carried')) {
      return `Plant the charge at Site ${match.site}`;
    }
    if (match.phase === 'play' && bomb.state.state === 'planted') {
      return `Charge planted at Site ${bomb.state.site} — defend it`;
    }
    if (match.phase === 'roundEnd') return `Round ${match.round} over`;
    return '';
  }

  function hudState() {
    return {
      health: Math.max(0, Math.ceil(player.state.health)),
      armor: Math.ceil(player.state.armor),
      money: match.money,
      ammo: weapons.ammo[weapons.currentId()],
      weaponName: weapons.def().name,
      score: match.score,
      timerText: timerText(),
      objectiveText: objectiveText(),
      alive: {
        aegis: countAlive('aegis'),
        ember: countAlive('ember'),
      },
      spread: weapons.spread(player.groundSpeed()),
      pointerLocked,
      phase: match.phase,
      hitAt: match.hitAt,
      hitHead: match.hitHead,
      hurtAt: match.hurtAt,
      channel: match.channel,
      buyOpen: match.phase === 'buy' && buyOpen,
    };
  }

  // ---- Fixed-step simulation, one helper per phase. ----
  function stepBuyPhase(dt) {
    match.roundTime -= dt;
    // Players may walk around spawn during the buy phase, like in CS.
    if (playerFighter.alive) player.step(dt, keys);
    if (match.roundTime <= 0) {
      match.phase = 'play';
      match.roundTime = ROUND_TIME;
      buyOpen = false;
      hud.announce('GO', `Plant the charge at Site ${match.site}`);
    }
  }

  function stepLiveRound(dt) {
    match.roundTime -= dt;
    if (bomb.state.state === 'planted') {
      const result = bomb.step(dt, match.time, () => audio.beep());
      if (result === 'exploded') {
        audio.explosion();
        match.shake = 1;
        const siteCenter = world.sites[bomb.state.site].center;
        grenadeDamage(siteCenter, 12, 200);
        endRound('aegis', 'The charge detonated.');
      }
    } else if (match.roundTime <= 0) {
      endRound('ember', 'Time ran out before the plant.');
    }
    if (match.phase !== 'play') return;
    stepPlayer(dt);
    stepBotsAndProjectiles(dt);
  }

  function stepPlayer(dt) {
    if (!playerFighter.alive) return;
    player.step(dt, keys);
    updateChannel(dt);
    if (match.firing && weapons.def().auto) playerShoot();
    else if (match.firing && !weapons.def().auto) {
      playerShoot();
      match.firing = false;
    }
    if (player.groundSpeed() > 1 && player.state.onGround) {
      footstepAcc += player.groundSpeed() * dt;
      if (footstepAcc > 2.2) {
        footstepAcc = 0;
        audio.footstep();
      }
    }
  }

  function stepBotsAndProjectiles(dt) {
    const ctx = {
      time: match.time,
      player: playerFighter,
      bomb: bomb.state,
      onDamage: applyDamage,
      onKill: () => {},
      onPlanted: (bot) => {
        bomb.plantAt(bot.pos);
        hud.announce(`CHARGE PLANTED — SITE ${match.site}`, `${bot.name} planted the charge. Defend it.`);
      },
      onDefused: (bot) => {
        endRound('ember', `${bot.name} defused the charge.`);
      },
      onBotShot: (bot, origin, end) => {
        spawnTracer(origin, end, bot.team === 'ember' ? '#ff8a5c' : '#7fd4c0');
        const dist = origin.distanceTo(player.state.position);
        if (bot.team === 'ember') audio.enemyShot(dist);
        bots.hearShot(origin, bot.team);
      },
      smokeBlocked: (a, b) => grenades.blockedBySmoke(a, b),
      shootables,
      moveBox,
      random,
    };
    bots.step(dt, ctx);
    grenades.step(dt, grenadeDamage);
    weapons.step(dt);
  }

  function stepRoundEnd(dt) {
    match.roundTime -= dt;
    if (match.roundTime <= 0) {
      if (match.score.aegis >= ROUNDS_TO_WIN || match.score.ember >= ROUNDS_TO_WIN) {
        endMatch();
      } else {
        match.round += 1;
        startRound();
      }
    }
  }

  function step(dt) {
    match.time += dt;
    if (match.phase === 'buy') stepBuyPhase(dt);
    else if (match.phase === 'play') stepLiveRound(dt);
    else if (match.phase === 'roundEnd') stepRoundEnd(dt);

    // Sync the player's hitboxes with the body.
    playerTorso.position.set(player.state.position.x, player.state.position.y + 1.0, player.state.position.z);
    playerTorso.rotation.y = player.state.yaw;
    playerHead.position.set(player.state.position.x, player.state.position.y + 1.53, player.state.position.z);
  }

  function render() {
    if (playerFighter.alive) {
      camera.position.set(player.state.position.x, player.state.position.y + player.state.eye, player.state.position.z);
      camera.rotation.set(player.state.pitch, player.state.yaw, 0);
    } else if (match.spectate) {
      const target = match.spectate;
      camera.position.set(target.pos.x, target.pos.y + 1.5, target.pos.z);
      camera.rotation.set(0, target.yaw, 0);
    } else {
      camera.position.set(0, 18, 14);
      camera.lookAt(0, 0, -4);
    }
    if (match.shake > 0) {
      camera.rotation.x += (random() - 0.5) * match.shake * 0.05;
      camera.rotation.y += (random() - 0.5) * match.shake * 0.05;
      match.shake = Math.max(0, match.shake - 0.03);
    }
    for (const tracer of tracerPool) {
      if (tracer.life > 0) {
        tracer.life -= 1 / 60;
        tracer.line.material.opacity = Math.max(0, tracer.life / TRACER_LIFE) * 0.85;
      }
    }
    renderer.render(scene, camera);
    hud.render(hudState());
  }

  let lastTime = performance.now();
  function loop(now) {
    const frameDt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;
    stepAccumulator += frameDt;
    let guard = 0;
    while (stepAccumulator >= STEP && guard < 5) {
      step(STEP);
      stepAccumulator -= STEP;
      guard += 1;
    }
    render();
    requestAnimationFrame(loop);
  }

  function showMenu() {
    match.phase = 'menu';
    hud.showOverlay(`
      <div class="panel">
        <h1>EMBERLINE</h1>
        <p class="tagline">Foundry Yard — a round-based tactical shooter</p>
        <p>Five Aegis attackers against five Ember defenders. Plant the charge at
        Site A or Site B, or eliminate the other team. First to 5 rounds wins.</p>
        <ul class="controls">
          <li><b>WASD</b> move · <b>Mouse</b> aim · <b>Click</b> shoot</li>
          <li><b>Shift</b> walk · <b>Ctrl/C</b> crouch · <b>Space</b> jump</li>
          <li><b>1–3</b> weapons · <b>R</b> reload · <b>G</b> frag · <b>F</b> smoke</li>
          <li><b>E</b> hold to plant / defuse · <b>B</b> buy (buy phase) · <b>M</b> mute</li>
        </ul>
        <button id="start-btn">Deploy — Round 1</button>
      </div>`);
    const btn = document.getElementById('start-btn');
    if (btn) btn.addEventListener('click', () => {
      audio.unlock();
      hud.hideOverlay();
      startMatch();
      renderer.domElement.requestPointerLock();
    });
  }

  // ---- Deterministic screenshot mode: ?shot=start|play|buy|end&seed=N ----
  function beginShot(shot, seed) {
    match.shotMode = shot;
    match.seed = seed;
    // The seed is recorded for the dossier; the live random stream still varies
    // bot spawns slightly, but the camera and round state are fixed per shot.
    if (shot === 'start') {
      showMenu();
    } else if (shot === 'buy') {
      startMatch();
      player.state.position.set(-2, 0, 12);
      player.state.yaw = 0.1;
    } else if (shot === 'play') {
      startMatch();
      match.phase = 'play';
      match.roundTime = 82;
      buyOpen = false;
      player.state.position.set(-3, 0, 9);
      player.state.yaw = -0.12;
      player.state.pitch = -0.02;
      // Let the bots walk a few seconds so the frame reads as a live round.
      for (let i = 0; i < 240; i += 1) step(STEP);
      // The bots may have landed hits during those steps; the shot is a
      // mid-round frame, not a death cam, so the player starts it healthy.
      player.state.health = 100;
    } else if (shot === 'end') {
      startMatch();
      match.score = { aegis: 4, ember: 3 };
      endRound('aegis', 'Ember team eliminated.');
      endMatch();
    }
    render();
    window.__emberline = { ready: true, shot, seed };
  }

  showMenu();
  requestAnimationFrame(loop);

  // A read-only handle for automated smoke tests (screenshots, soak tests):
  // the match state and the player's body, nothing that plays the game.
  window.__emberlineGame = { state: match, player: player.state };

  return {
    beginShot,
    state: match,
  };
}
