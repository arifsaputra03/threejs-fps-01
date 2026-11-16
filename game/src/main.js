// Boot: mount the game, then hand it the screenshot mode when the URL asks for one.
//   ?shot=start|play|buy|end&seed=1   renders one deterministic frame per shot
//   (the screenshot driver waits for window.__emberline.ready).
import { createGame } from './game.js';

const container = document.getElementById('game');
const game = createGame(container);

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
if (shot) {
  const seed = Number(params.get('seed') ?? '1') || 1;
  game.beginShot(shot, seed);
}
