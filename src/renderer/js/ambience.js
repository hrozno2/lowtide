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
  { id: 'rain',  name: 'Rain',        hint: 'Drops on a window, not a shower head' },
  { id: 'storm', name: 'Thunder',     hint: 'Heavier rain with a storm rolling through' },
  { id: 'fire',  name: 'Fireplace',   hint: 'A log fire, popping and settling' },
  { id: 'wind',  name: 'Wind',        hint: 'Gusts around the building' },
  { id: 'night', name: 'Night',       hint: 'Crickets, and a road a long way off' },
  { id: 'cafe',  name: 'Coffee shop', hint: 'Voices, cups, a machine behind it' },
  { id: 'waves', name: 'Waves',       hint: 'Sets rolling in and breaking' },
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

/**
 * A buffer full of little decaying impulses.
 *
 * This is what separates rain from a hiss and a fire from a rumble: the sound
 * of both is thousands of separate small events, and no amount of filtering
 * turns a continuous noise into them. Density is events per second, and the
 * lengths are in milliseconds. `sharp` biases the sizes — above 1 most events
 * are small and a few are large, which is what fire does and rain does not.
 */
function grainBuffer(ctx, seconds, { density, minMs, maxMs, sharp = 1 }) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const count = Math.max(1, Math.round(density * seconds));

  for (let n = 0; n < count; n++) {
    const at = Math.floor(Math.random() * len);
    const ms = minMs + Math.random() * (maxMs - minMs);
    const dur = Math.max(2, Math.floor((sr * ms) / 1000));
    const amp = Math.pow(Math.random(), sharp);
    const end = Math.min(len, at + dur);
    for (let i = at; i < end; i++) {
      d[i] += (Math.random() * 2 - 1) * Math.exp((-5 * (i - at)) / dur) * amp;
    }
  }

  let peak = 0;
  for (let i = 0; i < len; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
  if (peak > 0) { const k = 0.9 / peak; for (let i = 0; i < len; i++) d[i] *= k; }
  return buf;
}

/** A looping source over one of those grain buffers. */
function grains(ctx, seconds, opts, rate = 1) {
  const src = ctx.createBufferSource();
  src.buffer = grainBuffer(ctx, seconds, opts);
  src.loop = true;
  src.playbackRate.value = rate;
  src.start();
  return src;
}

/**
 * Speech, heard from too far away to make out: three formants moving about
 * over a noise source, gated into syllables with pauses between them. The
 * envelope is scheduled a few seconds ahead and topped up as it runs, because
 * an LFO gives a regular pulse and people do not talk in one.
 */
function babble(ctx, out, { level = 1, rate = 1 } = {}) {
  const src = noise(ctx, 'pink', rate);
  const voiced = gain(ctx, 0);
  const formants = [
    { f: 500, q: 6, g: 1.0 },
    { f: 1200, q: 8, g: 0.55 },
    { f: 2600, q: 9, g: 0.25 }
  ].map(({ f, q, g }) => {
    const bp = filter(ctx, 'bandpass', f, q);
    const amt = gain(ctx, g * level);
    src.connect(bp).connect(amt).connect(voiced);
    // The vowel wanders, so it never sits on one note.
    drift(ctx, bp.frequency, f, f * 0.16, 5 + Math.random() * 6);
    return bp;
  });
  voiced.connect(out);

  let filled = 0;
  const schedule = () => {
    const now = ctx.currentTime;
    let t = Math.max(filled, now + 0.05);
    const until = now + 4;
    while (t < until) {
      // A run of syllables, then a gap where somebody else is talking.
      const syllables = 2 + Math.floor(Math.random() * 6);
      for (let i = 0; i < syllables; i++) {
        const dur = 0.09 + Math.random() * 0.13;
        const peak = 0.25 + Math.random() * 0.75;
        voiced.gain.linearRampToValueAtTime(peak, t + dur * 0.35);
        voiced.gain.linearRampToValueAtTime(0.08 + Math.random() * 0.1, t + dur);
        t += dur;
      }
      voiced.gain.linearRampToValueAtTime(0.04, t + 0.12);
      t += 0.25 + Math.random() * 0.9;
    }
    filled = t;
  };
  schedule();
  const timer = setInterval(schedule, 2500);
  return { src, formants, stop: () => clearInterval(timer) };
}

/* --------------------------------------------------------------- recipes */

const RECIPES = {
  rain: (ctx, out) => {
    // Thousands of separate drops, not a hiss: the grains are the rain, and
    // the bed underneath is only the room it is falling into.
    const drops = grains(ctx, 5, { density: 900, minMs: 1.5, maxMs: 9, sharp: 1.7 }, 1);
    const dropF = filter(ctx, 'bandpass', 1900, 0.55);
    const dropG = gain(ctx, 1.5);
    drops.connect(dropF).connect(dropG).connect(out);

    // A second, slower layer of heavier drops off the eaves.
    const heavy = grains(ctx, 7, { density: 40, minMs: 6, maxMs: 26, sharp: 2.4 }, 0.9);
    heavy.connect(filter(ctx, 'bandpass', 700, 1.2)).connect(gain(ctx, 0.72)).connect(out);

    const bed = noise(ctx, 'brown', 0.8);
    bed.connect(filter(ctx, 'lowpass', 500)).connect(gain(ctx, 0.3)).connect(out);

    const l1 = drift(ctx, dropF.frequency, 1900, 500, 29);
    const l2 = drift(ctx, dropG.gain, 1.5, 0.3, 41);
    return [drops, heavy, bed, l1, l2];
  },

  storm: (ctx, out) => {
    // Heavier than plain rain to begin with, so the two are not the same
    // sound with an event bolted on.
    const drops = grains(ctx, 5, { density: 1500, minMs: 1.5, maxMs: 12, sharp: 1.5 }, 1);
    const dropF = filter(ctx, 'bandpass', 1500, 0.5);
    drops.connect(dropF).connect(gain(ctx, 1.0)).connect(out);

    const heavy = grains(ctx, 7, { density: 90, minMs: 8, maxMs: 34, sharp: 2.2 }, 0.85);
    heavy.connect(filter(ctx, 'bandpass', 550, 1.0)).connect(gain(ctx, 0.6)).connect(out);

    const bed = noise(ctx, 'brown', 0.75);
    bed.connect(filter(ctx, 'lowpass', 320)).connect(gain(ctx, 0.4)).connect(out);
    const l1 = drift(ctx, dropF.frequency, 1500, 420, 23);

    /* Thunder proper: a sub-bass swell that sweeps downward with a long tail,
       plus a rumbling body. Loud and slow enough that it cannot be mistaken
       for the rain it sits on. */
    const strike = () => {
      const near = Math.random() < 0.35;
      const t0 = ctx.currentTime;
      const dur = near ? 4.5 : 7.5;

      const rumble = ctx.createBufferSource();
      rumble.buffer = noiseBuffer(ctx, 'brown');
      rumble.loop = true;
      const lp = filter(ctx, 'lowpass', near ? 320 : 150);
      lp.frequency.setValueAtTime(near ? 420 : 200, t0);
      lp.frequency.exponentialRampToValueAtTime(near ? 90 : 55, t0 + dur);
      const g = gain(ctx, 0);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(near ? 1.5 : 0.75, t0 + (near ? 0.05 : 0.7));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      rumble.connect(lp).connect(g).connect(out);
      rumble.start(t0);
      rumble.stop(t0 + dur + 0.1);

      if (near) {
        // The crack at the front of a close strike.
        burst(ctx, out, { kind: 'white', type: 'lowpass', freq: 2200,
                          attack: 0.004, decay: 0.5, level: 0.5 });
      }
    };
    const stop = every(16, 52, strike);
    return [drops, heavy, bed, l1, { stop }];
  },

  fire: (ctx, out) => {
    // The bed is the draw of the chimney; the fire itself is all crackle.
    const draw = noise(ctx, 'brown', 0.7);
    const drawF = filter(ctx, 'lowpass', 420);
    const drawG = gain(ctx, 0.40);
    draw.connect(drawF).connect(drawG).connect(out);

    const hiss = noise(ctx, 'pink', 1);
    const hissG = gain(ctx, 0.1);
    hiss.connect(filter(ctx, 'bandpass', 2600, 0.6)).connect(hissG).connect(out);

    // Small ticks constantly, larger pops now and then.
    const ticks = grains(ctx, 6, { density: 26, minMs: 1, maxMs: 7, sharp: 2.2 }, 1);
    ticks.connect(filter(ctx, 'bandpass', 3200, 1.4)).connect(gain(ctx, 0.62)).connect(out);

    const l1 = drift(ctx, drawG.gain, 0.40, 0.13, 13);
    const l2 = drift(ctx, hissG.gain, 0.1, 0.05, 8);

    const pops = every(0.6, 3.4, () => {
      const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        setTimeout(() => {
          burst(ctx, out, { kind: 'white', type: 'bandpass',
                            freq: 900 + Math.random() * 2600, q: 3 + Math.random() * 6,
                            attack: 0.001, decay: 0.02 + Math.random() * 0.12,
                            level: 0.18 + Math.random() * 0.4 });
        }, i * (20 + Math.random() * 90));
      }
    });
    // The occasional shift as a log settles.
    const settle = every(20, 70, () => {
      burst(ctx, out, { kind: 'brown', type: 'lowpass', freq: 500,
                        attack: 0.02, decay: 0.8 + Math.random() * 0.8, level: 0.35 });
    });
    return [draw, hiss, ticks, l1, l2, { stop: pops }, { stop: settle }];
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
    // Almost no hiss: night is quiet, and the crickets should be the sound
    // rather than something laid over a wash of noise.
    const far = noise(ctx, 'brown', 0.7);
    far.connect(filter(ctx, 'lowpass', 240)).connect(gain(ctx, 0.5)).connect(out);

    const air = noise(ctx, 'pink');
    air.connect(filter(ctx, 'bandpass', 900, 0.7)).connect(gain(ctx, 0.02)).connect(out);

    const cricket = (freq, chirps) => every(1.6, 5.5, () => {
      const t0 = ctx.currentTime;
      for (let i = 0; i < chirps; i++) {
        const at = t0 + i * 0.055;
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = freq * (0.99 + Math.random() * 0.02);
        const g = gain(ctx, 0);
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(0.075, at + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.032);
        osc.connect(g).connect(out);
        osc.start(at);
        osc.stop(at + 0.04);
      }
    });
    const stops = [cricket(4600, 4), cricket(5200, 3), cricket(3900, 5), cricket(4900, 4)];
    return [far, air, { stop: () => stops.forEach((s) => s()) }];
  },

  cafe: (ctx, out) => {
    // Voices first — that is what a café is. Two conversations at different
    // distances, neither of them close enough to follow.
    const near = babble(ctx, out, { level: 5.4, rate: 1 });
    const farther = babble(ctx, out, { level: 3.0, rate: 0.82 });

    const room = noise(ctx, 'pink', 0.88);
    room.connect(filter(ctx, 'lowpass', 1400)).connect(gain(ctx, 0.16)).connect(out);

    const clinks = every(3.5, 13, () => {
      burst(ctx, out, { kind: 'white', type: 'bandpass',
                        freq: 2400 + Math.random() * 2600, q: 9,
                        attack: 0.002, decay: 0.10 + Math.random() * 0.18,
                        level: 0.10 + Math.random() * 0.10 });
    });
    const machine = every(22, 70, () => {
      burst(ctx, out, { kind: 'white', type: 'bandpass', freq: 1500, q: 1.2,
                        attack: 0.25, decay: 1.6 + Math.random(), level: 0.16 });
    });
    return [near.src, farther.src, room,
            { stop: near.stop }, { stop: farther.stop },
            { stop: clinks }, { stop: machine }];
  },

  waves: (ctx, out) => {
    /* A set has a shape: a low swell building, a bright break at the top, then
       a long drain back out. Modulating one filter does not give that, so the
       break is its own layer with its own envelope. */
    const deep = noise(ctx, 'brown', 0.85);
    const deepG = gain(ctx, 0.3);
    deep.connect(filter(ctx, 'lowpass', 260)).connect(deepG).connect(out);

    const swell = noise(ctx, 'brown', 1);
    const swellF = filter(ctx, 'lowpass', 500);
    const swellG = gain(ctx, 0.05);
    swell.connect(swellF).connect(swellG).connect(out);

    const breakUp = grains(ctx, 5, { density: 1200, minMs: 1, maxMs: 7, sharp: 1.6 }, 1);
    const breakF = filter(ctx, 'bandpass', 1800, 0.5);
    const breakG = gain(ctx, 0);
    breakUp.connect(breakF).connect(breakG).connect(out);

    const roll = () => {
      const t = ctx.currentTime;
      const rise = 3.0 + Math.random() * 2.0;
      const hold = 0.4 + Math.random() * 0.6;
      const fall = 4.0 + Math.random() * 2.5;
      const size = 0.7 + Math.random() * 0.6;

      swellG.gain.cancelScheduledValues(t);
      swellG.gain.setValueAtTime(Math.max(0.0001, swellG.gain.value), t);
      swellG.gain.linearRampToValueAtTime(0.5 * size, t + rise);
      swellG.gain.exponentialRampToValueAtTime(0.03, t + rise + hold + fall);

      swellF.frequency.cancelScheduledValues(t);
      swellF.frequency.setValueAtTime(320, t);
      swellF.frequency.linearRampToValueAtTime(900, t + rise);
      swellF.frequency.linearRampToValueAtTime(300, t + rise + hold + fall);

      // The break comes in at the crest and hisses away down the beach.
      breakG.gain.cancelScheduledValues(t);
      breakG.gain.setValueAtTime(Math.max(0.0001, breakG.gain.value), t);
      breakG.gain.linearRampToValueAtTime(0.0001, t + rise * 0.8);
      breakG.gain.linearRampToValueAtTime(0.42 * size, t + rise + hold * 0.5);
      breakG.gain.exponentialRampToValueAtTime(0.002, t + rise + hold + fall * 0.9);

      breakF.frequency.cancelScheduledValues(t);
      breakF.frequency.setValueAtTime(2400, t + rise);
      breakF.frequency.exponentialRampToValueAtTime(700, t + rise + hold + fall);
    };
    roll();
    const stop = every(9, 15, roll);
    const l1 = drift(ctx, deepG.gain, 0.3, 0.08, 19);
    return [deep, swell, breakUp, l1, { stop }];
  },

  white: (ctx, out) => {
    const n = noise(ctx, 'white');
    n.connect(filter(ctx, 'lowpass', 11000)).connect(gain(ctx, 0.25)).connect(out);
    return [n];
  },

  pink: (ctx, out) => {
    const n = noise(ctx, 'pink');
    n.connect(filter(ctx, 'lowpass', 9000)).connect(gain(ctx, 0.58)).connect(out);
    return [n];
  },

  brown: (ctx, out) => {
    const n = noise(ctx, 'brown');
    n.connect(filter(ctx, 'lowpass', 1400)).connect(gain(ctx, 0.52)).connect(out);
    return [n];
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
  /* A rough three-band balance, so two sounds can be compared as numbers
     rather than by ear alone: one-pole filters are plenty for this. */
  let lo = 0, hi = 0, lp = 0, prev = 0, hp = 0;
  const aLo = Math.exp(-2 * Math.PI * 300 / rate);
  const aHi = Math.exp(-2 * Math.PI * 2000 / rate);
  for (let i = 0; i < d.length; i++) {
    const v = Number.isFinite(d[i]) ? d[i] : 0;
    lp = aLo * lp + (1 - aLo) * v;
    lo += lp * lp;
    hp = aHi * (hp + v - prev);
    prev = v;
    hi += hp * hp;
  }
  const rms = Math.sqrt(sum / d.length);
  const loR = Math.sqrt(lo / d.length);
  const hiR = Math.sqrt(hi / d.length);
  const total = loR + hiR || 1;

  return {
    peak: +peak.toFixed(4),
    rms: +rms.toFixed(4),
    crest: +(rms > 0 ? peak / rms : 0).toFixed(2),
    bands: `${Math.round((loR / total) * 100)}% low / ${Math.round((hiR / total) * 100)}% high`,
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
