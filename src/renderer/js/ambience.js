/* Focus sounds.
 *
 * These are synthesised rather than recorded. A bundled recording has to be
 * small enough to ship and long enough not to repeat, and it cannot be both —
 * ten minutes of stereo audio is a hundred megabytes raw, and any loop short
 * enough to bundle starts announcing itself within the hour.
 *
 * So the texture is built live out of noise and filters, and the detail that
 * makes it feel alive — gusts, thunder, crickets, the clatter of a cup — is
 * scheduled at random intervals as it plays. Nothing repeats, it runs for as
 * long as you leave it, and it adds nothing to the download. It also means
 * every sound here is ours: there is no licence to honour and nothing is
 * fetched from anywhere.
 */

export const AMBIENCES = [
  { id: 'rain',  name: 'Rain',        hint: 'Steady rain, with the odd heavier fall' },
  { id: 'storm', name: 'Thunder',     hint: 'Rain with a storm somewhere off in it' },
  { id: 'wind',  name: 'Wind',        hint: 'Gusts around the building' },
  { id: 'night', name: 'Night',       hint: 'Crickets and a road a long way off' },
  { id: 'cafe',  name: 'Coffee shop', hint: 'Murmur, cups, a machine behind it' },
  { id: 'waves', name: 'Waves',       hint: 'Slow surf, about ten seconds a set' },
  { id: 'white', name: 'White noise', hint: 'Flat hiss' },
  { id: 'pink',  name: 'Pink noise',  hint: 'Softer than white' },
  { id: 'brown', name: 'Brown noise', hint: 'Deep, low and dull' }
];

export const ambienceById = (id) => AMBIENCES.find((a) => a.id === id) || null;

const SECONDS = 6;

/* One buffer of noise, filled by the recipe the name asks for. */
function noiseBuffer(ctx, kind) {
  const len = Math.floor(ctx.sampleRate * SECONDS);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);

  if (kind === 'pink') {
    // Paul Kellet's filter: cheap, and within a fraction of a dB of -3/octave.
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  } else if (kind === 'brown') {
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
  } else {
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  return buf;
}

/* A looping noise source. Two of these at different rates never line up
   again, which is what keeps the loop from being audible as one. */
function noise(ctx, kind, rate = 1) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, kind);
  src.loop = true;
  src.playbackRate.value = rate;
  src.start();
  return src;
}

const gain = (ctx, v) => { const g = ctx.createGain(); g.gain.value = v; return g; };

function filter(ctx, type, freq, q) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  if (q != null) f.Q.value = q;
  return f;
}

/* A slow sine that wanders a parameter about, for swells and gusts. */
function drift(ctx, param, centre, depth, period) {
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 1 / period;
  const amt = gain(ctx, depth);
  param.value = centre;
  lfo.connect(amt).connect(param);
  lfo.start();
  return lfo;
}

/* Calls `fn` again and again at a random interval inside [min, max]. */
function every(min, max, fn) {
  let timer = null;
  const tick = () => {
    fn();
    timer = setTimeout(tick, (min + Math.random() * (max - min)) * 1000);
  };
  timer = setTimeout(tick, (min + Math.random() * (max - min)) * 1000);
  return () => clearTimeout(timer);
}

/* A one-shot burst of filtered noise with an envelope: thunder, a cup, a
   cricket, depending on what is asked for. */
function burst(ctx, out, { kind = 'white', type = 'bandpass', freq, q = 1,
                           attack = 0.005, decay = 0.3, level = 0.4 }) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, kind);
  src.loop = true;
  const f = filter(ctx, type, freq, q);
  const g = gain(ctx, 0);
  const now = ctx.currentTime;
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(level, now + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
  src.connect(f).connect(g).connect(out);
  src.start(now);
  src.stop(now + attack + decay + 0.05);
}

/* --------------------------------------------------------------- recipes */

const RECIPES = {
  white: (ctx, out) => {
    const n = noise(ctx, 'white');
    n.connect(filter(ctx, 'lowpass', 11000)).connect(gain(ctx, 0.36)).connect(out);
    return [n];
  },

  pink: (ctx, out) => {
    const n = noise(ctx, 'pink');
    n.connect(filter(ctx, 'lowpass', 9000)).connect(gain(ctx, 0.72)).connect(out);
    return [n];
  },

  brown: (ctx, out) => {
    const n = noise(ctx, 'brown');
    n.connect(filter(ctx, 'lowpass', 1400)).connect(gain(ctx, 0.75)).connect(out);
    return [n];
  },

  rain: (ctx, out) => {
    // A hiss for the fall and a body underneath it, with the brightness
    // wandering so the shower keeps easing and picking up again.
    const hiss = noise(ctx, 'white', 1);
    const hissF = filter(ctx, 'bandpass', 2800, 0.7);
    const hissG = gain(ctx, 0.5);
    hiss.connect(hissF).connect(hissG).connect(out);

    const body = noise(ctx, 'brown', 0.83);
    const bodyF = filter(ctx, 'lowpass', 900);
    body.connect(bodyF).connect(gain(ctx, 0.5)).connect(out);

    const l1 = drift(ctx, hissF.frequency, 2800, 900, 23);
    const l2 = drift(ctx, hissG.gain, 0.5, 0.16, 37);
    return [hiss, body, l1, l2];
  },

  storm: (ctx, out) => {
    const parts = RECIPES.rain(ctx, out);
    // Far-off thunder, once in a while, never on a beat.
    const stop = every(14, 55, () => {
      const near = Math.random() < 0.3;
      burst(ctx, out, {
        kind: 'brown', type: 'lowpass',
        freq: near ? 220 : 110,
        attack: near ? 0.02 : 0.35,
        decay: near ? 3.2 : 5.5,
        level: near ? 0.85 : 0.4
      });
    });
    return [...parts, { stop }];
  },

  wind: (ctx, out) => {
    const n = noise(ctx, 'brown', 1);
    const f = filter(ctx, 'bandpass', 420, 1.1);
    const g = gain(ctx, 0.92);
    n.connect(f).connect(g).connect(out);

    const air = noise(ctx, 'pink', 0.91);
    const airF = filter(ctx, 'highpass', 1800);
    const airG = gain(ctx, 0.1);
    air.connect(airF).connect(airG).connect(out);

    const l1 = drift(ctx, f.frequency, 420, 260, 17);
    const l2 = drift(ctx, g.gain, 0.92, 0.34, 11);
    const l3 = drift(ctx, airG.gain, 0.12, 0.09, 7);
    // Occasional stronger gusts on top of the wandering.
    const stop = every(9, 26, () => {
      const now = ctx.currentTime;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime(1.45, now + 1.6 + Math.random());
      g.gain.linearRampToValueAtTime(0.92, now + 5 + Math.random() * 3);
    });
    return [n, air, l1, l2, l3, { stop }];
  },

  night: (ctx, out) => {
    // A road somewhere below the horizon.
    const far = noise(ctx, 'brown', 0.7);
    far.connect(filter(ctx, 'lowpass', 380)).connect(gain(ctx, 0.52)).connect(out);

    const airG = gain(ctx, 0.075);
    const air = noise(ctx, 'pink');
    air.connect(filter(ctx, 'highpass', 5000)).connect(airG).connect(out);

    // Crickets: a handful of quick chirps, then a pause, at their own rates.
    const cricket = (freq, chirps) => every(1.6, 5.5, () => {
      const t0 = ctx.currentTime;
      for (let i = 0; i < chirps; i++) {
        const at = t0 + i * 0.055;
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = freq * (0.99 + Math.random() * 0.02);
        const g = gain(ctx, 0);
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(0.05, at + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.032);
        osc.connect(g).connect(out);
        osc.start(at);
        osc.stop(at + 0.04);
      }
    });
    const stops = [cricket(4600, 4), cricket(5200, 3), cricket(3900, 5)];
    return [far, air, { stop: () => stops.forEach((s) => s()) }];
  },

  cafe: (ctx, out) => {
    // Voices, blurred past the point of words.
    const murmur = noise(ctx, 'brown', 1);
    const mf = filter(ctx, 'bandpass', 520, 0.55);
    const mg = gain(ctx, 0.9);
    murmur.connect(mf).connect(mg).connect(out);

    const room = noise(ctx, 'pink', 0.88);
    room.connect(filter(ctx, 'lowpass', 2600)).connect(gain(ctx, 0.12)).connect(out);

    const l1 = drift(ctx, mf.frequency, 520, 190, 13);
    const l2 = drift(ctx, mg.gain, 0.9, 0.28, 9);

    // Cups, saucers, the machine going somewhere behind the counter.
    const clinks = every(3.5, 13, () => {
      burst(ctx, out, { kind: 'white', type: 'bandpass',
                        freq: 2400 + Math.random() * 2600, q: 9,
                        attack: 0.002, decay: 0.10 + Math.random() * 0.18,
                        level: 0.10 + Math.random() * 0.10 });
    });
    const machine = every(22, 70, () => {
      burst(ctx, out, { kind: 'white', type: 'bandpass', freq: 1500, q: 1.2,
                        attack: 0.25, decay: 1.6 + Math.random(), level: 0.14 });
    });
    return [murmur, room, l1, l2, { stop: clinks }, { stop: machine }];
  },

  waves: (ctx, out) => {
    const body = noise(ctx, 'brown', 1);
    const bodyG = gain(ctx, 0.44);
    body.connect(filter(ctx, 'lowpass', 700)).connect(bodyG).connect(out);

    const surf = noise(ctx, 'white', 0.93);
    const surfF = filter(ctx, 'bandpass', 1600, 0.6);
    const surfG = gain(ctx, 0);
    surf.connect(surfF).connect(surfG).connect(out);

    // Sets roll in every eight to fourteen seconds, each one a little
    // different, so the rhythm never settles into a pattern.
    const roll = () => {
      const now = ctx.currentTime;
      const rise = 2.2 + Math.random() * 1.8;
      const fall = 3.4 + Math.random() * 2.6;
      const peak = 0.34 + Math.random() * 0.22;
      surfG.gain.cancelScheduledValues(now);
      surfG.gain.setValueAtTime(Math.max(0.0001, surfG.gain.value), now);
      surfG.gain.linearRampToValueAtTime(peak, now + rise);
      surfG.gain.exponentialRampToValueAtTime(0.02, now + rise + fall);
      surfF.frequency.cancelScheduledValues(now);
      surfF.frequency.setValueAtTime(1100, now);
      surfF.frequency.linearRampToValueAtTime(2200, now + rise);
      surfF.frequency.linearRampToValueAtTime(900, now + rise + fall);
    };
    roll();
    const stop = every(8, 14, roll);
    const l1 = drift(ctx, bodyG.gain, 0.44, 0.09, 19);
    return [body, surf, l1, { stop }];
  }
};

/* ----------------------------------------------------------------- tests */

/**
 * Renders one recipe offline and reports what came out. Used by the test
 * suite: it needs no sound hardware and runs faster than real time, so the
 * steady bed of each sound can be checked for being present, finite and not
 * clipped. The random events are on timers and do not fire in an offline
 * render, which is why this measures the bed rather than the detail.
 */
export async function measureAmbience(id, seconds = 2) {
  const recipe = RECIPES[id];
  if (!recipe) return null;
  const OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OC) return null;

  const rate = 44100;
  const ctx = new OC(1, Math.floor(rate * seconds), rate);
  const master = gain(ctx, 1);
  master.connect(ctx.destination);
  recipe(ctx, master);

  const rendered = await ctx.startRendering();
  const d = rendered.getChannelData(0);
  let peak = 0, sum = 0, bad = 0;
  for (let i = 0; i < d.length; i++) {
    const v = d[i];
    if (!Number.isFinite(v)) { bad++; continue; }
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sum += v * v;
  }
  return {
    peak: +peak.toFixed(4),
    rms: +Math.sqrt(sum / d.length).toFixed(4),
    nonFinite: bad,
    samples: d.length
  };
}

/* ---------------------------------------------------------------- player */

/**
 * One sound at a time, faded in and out so starting and stopping is not a
 * click. The context is created on first use, because browsers will not let
 * one start before the person has asked for sound.
 */
export function createAmbiencePlayer() {
  let ctx = null;
  let master = null;
  let nodes = [];
  let current = null;
  let level = 0.6;

  const teardown = () => {
    for (const n of nodes) {
      try { if (typeof n.stop === 'function') n.stop(); } catch {}
      try { if (typeof n.disconnect === 'function') n.disconnect(); } catch {}
    }
    nodes = [];
  };

  return {
    get playing() { return current; },
    get volume() { return level; },

    setVolume(v) {
      level = Math.max(0, Math.min(1, v));
      if (master) master.gain.setTargetAtTime(level, ctx.currentTime, 0.05);
    },

    stop() {
      if (!current) return;
      current = null;
      if (master && ctx) {
        const now = ctx.currentTime;
        master.gain.cancelScheduledValues(now);
        master.gain.setValueAtTime(master.gain.value, now);
        master.gain.linearRampToValueAtTime(0.0001, now + 0.4);
      }
      const dying = nodes;
      nodes = [];
      setTimeout(() => {
        for (const n of dying) {
          try { if (typeof n.stop === 'function') n.stop(); } catch {}
          try { if (typeof n.disconnect === 'function') n.disconnect(); } catch {}
        }
      }, 500);
    },

    play(id) {
      const recipe = RECIPES[id];
      if (!recipe) return false;
      if (current === id) { this.stop(); return false; }

      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        ctx = new AC();
      }
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});

      this.stop();
      teardown();

      master = gain(ctx, 0.0001);
      master.connect(ctx.destination);
      nodes = recipe(ctx, master).filter(Boolean);
      master.gain.linearRampToValueAtTime(level, ctx.currentTime + 0.8);
      current = id;
      return true;
    },

    dispose() {
      this.stop();
      teardown();
      if (ctx) { try { ctx.close(); } catch {} ctx = null; }
    }
  };
}
