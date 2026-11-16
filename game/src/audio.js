// Synthesized sound: every effect is built from oscillators and filtered noise
// at runtime, so the game ships no audio assets and makes no network request.
// The context is created lazily on the first user gesture.
export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;
  let lastStep = 0;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext ?? window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      return true;
    } catch {
      return false;
    }
  }

  function noiseBuffer(seconds) {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function burst({ freq = 1800, q = 0.8, dur = 0.12, gain = 0.5, type = 'bandpass' }) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(dur + 0.05);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(amp).connect(master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  function tone({ freq = 440, to = null, dur = 0.1, gain = 0.3, type = 'sine' }) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to !== null) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(amp).connect(master);
    osc.start(t);
    osc.stop(t + dur);
  }

  return {
    unlock() {
      ensure();
      if (ctx && ctx.state === 'suspended') ctx.resume();
    },
    toggleMute() {
      muted = !muted;
      return muted;
    },
    shot(weaponId) {
      burst({ freq: weaponId === 'rifle' ? 1400 : weaponId === 'smg' ? 2200 : 2600, dur: 0.09, gain: 0.5 });
      tone({ freq: 180, to: 60, dur: 0.1, gain: 0.4, type: 'triangle' });
    },
    enemyShot(distance) {
      burst({ freq: 1200, dur: 0.08, gain: Math.max(0.05, 0.35 - distance / 150) });
    },
    dryFire() {
      tone({ freq: 1200, dur: 0.03, gain: 0.15, type: 'square' });
    },
    reload() {
      tone({ freq: 900, dur: 0.04, gain: 0.2, type: 'square' });
      setTimeout(() => tone({ freq: 600, dur: 0.04, gain: 0.2, type: 'square' }), 250);
    },
    hit(head) {
      tone({ freq: head ? 1400 : 1000, dur: 0.05, gain: 0.25, type: 'sine' });
    },
    kill() {
      tone({ freq: 880, dur: 0.07, gain: 0.25 });
      setTimeout(() => tone({ freq: 1320, dur: 0.09, gain: 0.25 }), 70);
    },
    hurt() {
      tone({ freq: 220, to: 110, dur: 0.15, gain: 0.3, type: 'sawtooth' });
    },
    explosion() {
      burst({ freq: 300, q: 0.4, dur: 0.9, gain: 0.9, type: 'lowpass' });
      tone({ freq: 120, to: 30, dur: 0.9, gain: 0.7, type: 'sine' });
    },
    beep() {
      tone({ freq: 1250, dur: 0.06, gain: 0.2, type: 'square' });
    },
    plantTick() {
      tone({ freq: 1000, dur: 0.05, gain: 0.18, type: 'square' });
    },
    buy() {
      tone({ freq: 660, dur: 0.06, gain: 0.2 });
      setTimeout(() => tone({ freq: 990, dur: 0.08, gain: 0.2 }), 60);
    },
    denied() {
      tone({ freq: 220, dur: 0.12, gain: 0.2, type: 'square' });
    },
    win() {
      [523, 659, 784].forEach((f, i) => setTimeout(() => tone({ freq: f, dur: 0.16, gain: 0.25 }), i * 110));
    },
    lose() {
      [392, 330, 262].forEach((f, i) => setTimeout(() => tone({ freq: f, dur: 0.18, gain: 0.22 }), i * 120));
    },
    footstep() {
      if (!ensure() || muted) return;
      const now = performance.now();
      if (now - lastStep < 320) return;
      lastStep = now;
      burst({ freq: 300, q: 0.6, dur: 0.06, gain: 0.12, type: 'lowpass' });
    },
  };
}
