/* Focus sounds, synthesised.
 *
 * Built to be ignorable. Three findings shape every recipe here:
 *
 * 1. Changing state, not loudness, is what breaks concentration. Sound made of
 *    distinguishable tokens — syllables, chirps, clinks — disrupts working
 *    memory; continuous broadband noise barely does at all. So there are no
 *    events in these. What used to be a cup being put down or a cricket is
 *    either gone or buried so deep in the texture that it is no longer a
 *    thing you could count.
 *
 * 2. Sharpness — the proportion of energy up at 2–4 kHz — is the main driver
 *    of how unpleasant a noise is. That band is exactly where filtered hiss
 *    lives, which is why the first versions of these sounded like static.
 *    Everything now runs through a shelf that pulls that band down and rolls
 *    off above 6.5 kHz.
 *
 * 3. Fluctuation strength peaks around 4 Hz, and roughness lives between 15
 *    and 300 Hz. Anything that wobbles in either band draws attention to
 *    itself. Every modulation here has a period of twelve seconds or longer,
 *    which is 0.08 Hz — two decades below the band that grates.
 *
 * Where a sound has a physical mechanism worth imitating, it is imitated
 * rather than approximated with a filter. Rain is thousands of small decaying
 * resonances a second — the bubble each drop entrains, ringing as it shrinks —
 * not a band of hiss. Fire is a low combustion rumble under a soft hiss. Wind
 * is broadband air with two slowly wandering resonances, which is what an
 * edge does to moving air.
 *
 * A café is the interesting case. Babble with syllable structure is the worst
 * thing you could possibly play to someone trying to write, so this is not
 * that: it is the wash that many overlapping voices converge to at distance,
 * speech-shaped in the spectrum and steady in time.
 */

export const AMBIENCES = [
  { id: 'rain',  name: 'Rain',        hint: 'Steady rain, close and soft' },
  { id: 'storm', name: 'Thunder',     hint: 'Rain with a storm a long way off' },
  { id: 'fire',  name: 'Fireplace',   hint: 'A log fire settling' },
  { id: 'wind',  name: 'Wind',        hint: 'Air moving around the building' },
  { id: 'night', name: 'Night',       hint: 'Summer night, far from a road' },
  { id: 'cafe',  name: 'Coffee shop', hint: 'The wash of a room full of people' },
  { id: 'waves', name: 'Waves',       hint: 'Slow surf' },
  { id: 'white', name: 'White noise', hint: 'Flat, with the top taken off' },
  { id: 'pink',  name: 'Pink noise',  hint: 'Softer than white' },
  { id: 'brown', name: 'Brown noise', hint: 'Deep, low and dull' }
];

export const ambienceById = (id) => AMBIENCES.find((a) => a.id === id) || null;

const SECONDS = 6;

/* ------------------------------------------------------------- primitives */

function fillNoise(d, kind) {
  const len = d.length;
  if (kind === 'pink') {
    // Paul Kellet's filter: within a fraction of a dB of -3 dB per octave.
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
}

/* Two channels, filled independently. Noise that is identical in both ears
   images as a point between them and is tiring to sit under for hours;
   decorrelated noise has no location at all, which is what real weather
   sounds like and what makes it easy to stop hearing. */
function noiseBuffer(ctx, kind) {
  const buf = ctx.createBuffer(2, Math.floor(ctx.sampleRate * SECONDS), ctx.sampleRate);
  fillNoise(buf.getChannelData(0), kind);
  fillNoise(buf.getChannelData(1), kind);
  return buf;
}

function normalise(d, target) {
  let sum = 0;
  for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
  const rms = Math.sqrt(sum / d.length) || 1;
  const g = target / rms;
  for (let i = 0; i < d.length; i++) d[i] *= g;
}

/**
 * A buffer packed with small decaying resonances — the grain that rain and
 * fire are actually made of. Each one rings and dies inside a few
 * milliseconds; thousands a second stop being events and become a texture,
 * which is the whole point.
 *
 * `chirp` rises the pitch across the grain's life. A raindrop's sound is the
 * air bubble it traps ringing as it shrinks, and a shrinking bubble rings
 * higher, so the rise is what makes it read as water rather than as clicks.
 */
function grainBuffer(ctx, {
  rate = 1200, fLo = 350, fHi = 2000, decay = 0.011, chirp = 1.3,
  click = 0.3, seconds = SECONDS, target = 0.2
} = {}) {
  const rateHz = ctx.sampleRate;
  const len = Math.floor(rateHz * seconds);
  const buf = ctx.createBuffer(2, len, rateHz);

  const count = Math.floor(rate * seconds);
  const logLo = Math.log(fLo);
  const span = Math.log(fHi) - logLo;

  // Each ear gets its own rain. Drops are independent events in the world,
  // so they should be independent in the two channels too.
  for (let ch = 0; ch < 2; ch++) {
  const d = buf.getChannelData(ch);
  for (let g = 0; g < count; g++) {
    const start = Math.floor(Math.random() * len);
    const f0 = Math.exp(logLo + Math.random() * span);
    const life = decay * (0.5 + Math.random());
    const n = Math.min(Math.floor(life * 4 * rateHz), len - start);
    if (n <= 2) continue;

    const amp = 0.4 + Math.random() * 0.6;
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / rateHz;
      const env = Math.exp(-t / life);
      // Frequency climbs as the bubble shrinks.
      phase += (2 * Math.PI * (f0 * (1 + chirp * (1 - env)))) / rateHz;
      let s = Math.sin(phase) * env;
      if (i < 6) s += (Math.random() * 2 - 1) * click * env;   // the impact itself
      d[start + i] += s * amp;
    }
  }
  normalise(d, target);
  }

  return buf;
}

function source(ctx, buffer, rate = 1) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.playbackRate.value = rate;
  src.start();
  return src;
}

/* Two copies at different rates never line up again, so a six-second buffer
   stops sounding like a six-second buffer. `level` can be a plain number, or
   a gain node handed in by the caller when it wants to drift that level
   later (see rain's and fire's slow macro swells). */
function pair(ctx, buffer, out, level, rateA = 1, rateB = 0.83) {
  const g = typeof level === 'number' ? gain(ctx, level) : level;
  const a = source(ctx, buffer, rateA);
  const b = source(ctx, buffer, rateB);
  a.connect(g); b.connect(g); g.connect(out);
  return [a, b, g];
}

const gain = (ctx, v) => { const g = ctx.createGain(); g.gain.value = v; return g; };

function filter(ctx, type, freq, q, gainDb) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  if (q != null) f.Q.value = q;
  if (gainDb != null) f.gain.value = gainDb;
  return f;
}

/**
 * The shared voicing. Pulls down the 2–5 kHz band that drives sharpness, rolls
 * the top off above 6.5 kHz, and takes out the sub-30 Hz rumble that eats
 * headroom without being heard. Every recipe ends here.
 */
function calm(ctx, out, { top = 6500, cut = -8, floor = 30 } = {}) {
  const hp = filter(ctx, 'highpass', floor, 0.7);
  /* A shelf rather than a bell: a bell pulls a hole out of the middle of the
     band and leaves a bump on either side of it, which is its own kind of
     colour. A shelf takes the whole region down evenly. */
  const sharp = filter(ctx, 'highshelf', 2200, null, cut);
  const lp = filter(ctx, 'lowpass', top, 0.6);
  hp.connect(sharp).connect(lp).connect(out);
  return hp;
}

/** A wander so slow it is texture rather than movement: 0.08 Hz and below. */
function drift(ctx, param, centre, depth, period) {
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 1 / Math.max(12, period);
  const amt = gain(ctx, depth);
  param.value = centre;
  lfo.connect(amt).connect(param);
  lfo.start();
  return lfo;
}

/* --------------------------------------------------------------- recipes */

const RECIPES = {
  rain: (ctx, out) => {
    const head = calm(ctx, out);
    // Jittered per play so two sessions of rain are never quite the same grain.
    const jit = (v, pct) => v * (1 + (Math.random() * 2 - 1) * pct);
    const drops = grainBuffer(ctx, {
      rate: jit(1500, 0.05), fLo: 300, fHi: 1900, decay: jit(0.010, 0.10), target: 0.22
    });
    const fine = grainBuffer(ctx, {
      rate: jit(3000, 0.05), fLo: 900, fHi: 2600, decay: jit(0.005, 0.10), click: 0.5, target: 0.12
    });

    // Real rain surges and eases over tens of seconds rather than sitting at
    // one intensity, so the two layers get their own slow, independent drift.
    const bodyG = gain(ctx, 0.60);
    const body = pair(ctx, drops, head, bodyG);
    const mistG = gain(ctx, 0.17);
    const mist = pair(ctx, fine, head, mistG, 1, 0.77);

    // A little air underneath so it sits in a room rather than in a vacuum.
    const bed = source(ctx, noiseBuffer(ctx, 'brown'), 0.9);
    const bedG = gain(ctx, 0.15);
    bed.connect(filter(ctx, 'lowpass', 500, 0.7)).connect(bedG).connect(head);

    return [...body, ...mist, bed,
      drift(ctx, bedG.gain, 0.15, 0.04, 31),
      drift(ctx, bodyG.gain, 0.60, 0.11, 47),
      drift(ctx, mistG.gain, 0.17, 0.04, 53)];
  },

  storm: (ctx, out) => {
    const parts = RECIPES.rain(ctx, out);
    /* Thunder is the one event kept, because without it this is just rain.
       It is held to a slow swell well under 150 Hz rather than a crack: no
       sharp onset, nothing to flinch at, and far enough down the spectrum
       that it reads as weather rather than as a noise in the room. */
    const head = calm(ctx, out, { top: 320, cut: 0 });
    const rumble = source(ctx, noiseBuffer(ctx, 'brown'), 0.6);
    const shape = filter(ctx, 'lowpass', 120, 0.9);
    const g = gain(ctx, 0.0001);
    rumble.connect(shape).connect(g).connect(head);

    /* A soft, distant crack ahead of the rumble — held tightly under 200 Hz
       and given a slow enough attack that it reads as weather a long way off,
       not a clap in the room. Quieter and shorter than the rumble it leads
       into, so it stays a lead-in rather than a second event to notice. */
    const crackSrc = source(ctx, noiseBuffer(ctx, 'brown'), 1);
    const crackShape = filter(ctx, 'lowpass', 180, 1.1);
    const crackG = gain(ctx, 0.0001);
    crackSrc.connect(crackShape).connect(crackG).connect(head);

    const roll = () => {
      const now = ctx.currentTime;
      const rise = 2.5 + Math.random() * 2.5;
      const fall = 6 + Math.random() * 6;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), now);
      g.gain.linearRampToValueAtTime(0.5 + Math.random() * 0.35, now + rise);
      g.gain.exponentialRampToValueAtTime(0.0001, now + rise + fall);

      const attack = 0.7 + Math.random() * 0.3;
      const decay = 2.5 + Math.random() * 1.5;
      crackG.gain.cancelScheduledValues(now);
      crackG.gain.setValueAtTime(Math.max(0.0001, crackG.gain.value), now);
      crackG.gain.linearRampToValueAtTime(0.16 + Math.random() * 0.08, now + attack);
      crackG.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
    };
    let timer = setTimeout(function again() {
      roll();
      timer = setTimeout(again, (22 + Math.random() * 38) * 1000);
    }, 6000);

    return [...parts, rumble, crackSrc, { stop: () => clearTimeout(timer) }];
  },

  fire: (ctx, out) => {
    const head = calm(ctx, out, { top: 5200 });

    // The burn: low, steady, and the bulk of what you hear.
    const burn = source(ctx, noiseBuffer(ctx, 'brown'), 1);
    const burnG = gain(ctx, 0.70);
    burn.connect(filter(ctx, 'lowpass', 260, 0.8)).connect(burnG).connect(head);

    // Combustion hiss, kept below the band that grates.
    const hiss = source(ctx, noiseBuffer(ctx, 'pink'), 0.88);
    const hissG = gain(ctx, 0.10);
    hiss.connect(filter(ctx, 'bandpass', 900, 0.5)).connect(hissG).connect(head);

    /* Crackle as texture: many small resonances a second rather than pops you
       could count. Sparse enough to read as a fire, dense enough not to be a
       sequence of events. */
    /* Crackle dense enough to stop being a sequence. At fifty a second the
       level still stepped about at a rate the ear follows; at a hundred and
       sixty it is a surface. */
    const ticks = grainBuffer(ctx, { rate: 160, fLo: 180, fHi: 1100, decay: 0.016, click: 0.4, target: 0.24 });
    const crackleG = gain(ctx, 0.26);
    const crackle = pair(ctx, ticks, head, crackleG, 1, 0.71);

    /* A rare, lower, longer-ringing grain — a log settling — blended straight
       into the same crackle stream at low level rather than surfaced as its
       own layer, so it thickens the texture instead of becoming a thing you
       could count. */
    const pops = grainBuffer(ctx, { rate: 3, fLo: 120, fHi: 380, decay: 0.30, click: 0.2, target: 0.30 });
    const popMix = pair(ctx, pops, head, 0.045, 1, 0.83);

    return [burn, hiss, ...crackle, ...popMix,
      drift(ctx, burnG.gain, 0.70, 0.10, 23),
      drift(ctx, hissG.gain, 0.10, 0.03, 37),
      // Crackle flares and settles like a log catching, well under the
      // 0.08 Hz ceiling every other drift here respects.
      drift(ctx, crackleG.gain, 0.26, 0.09, 17)];
  },

  wind: (ctx, out) => {
    const head = calm(ctx, out, { top: 4200 });

    const air = source(ctx, noiseBuffer(ctx, 'brown'), 1);
    const airG = gain(ctx, 0.82);
    air.connect(filter(ctx, 'lowpass', 700, 0.7)).connect(airG).connect(head);

    /* Air past an edge sheds vortices and the edge rings — two resonances,
       wandering slowly, is enough to say "wind" without whistling. */
    const voice = (freq, q, level, period) => {
      const n = source(ctx, noiseBuffer(ctx, 'pink'), 0.93);
      const f = filter(ctx, 'bandpass', freq, q);
      const g = gain(ctx, level);
      n.connect(f).connect(g).connect(head);
      return [n, drift(ctx, f.frequency, freq, freq * 0.35, period)];
    };

    return [air, airG,
      drift(ctx, airG.gain, 0.82, 0.20, 19),
      ...voice(320, 2.2, 0.09, 27),
      ...voice(560, 3.0, 0.05, 41)];
  },

  night: (ctx, out) => {
    const head = calm(ctx, out, { top: 5600 });

    // Barely anything: a still night is mostly the absence of sound.
    const air = source(ctx, noiseBuffer(ctx, 'brown'), 0.7);
    air.connect(filter(ctx, 'lowpass', 260, 0.7)).connect(gain(ctx, 0.72)).connect(head);

    /* A cricket you can pick out is an event, and events are what break
       concentration. A field of them is a texture. This is the field: grains
       dense enough that no single chirp is a thing you could follow. */
    const chorus = grainBuffer(ctx, { rate: 240, fLo: 3200, fHi: 4600, decay: 0.006, click: 0.15, target: 0.16 });
    const chorusG = gain(ctx, 0.11);
    const a = source(ctx, chorus, 1);
    const b = source(ctx, chorus, 0.79);
    a.connect(chorusG); b.connect(chorusG);
    chorusG.connect(filter(ctx, 'bandpass', 3400, 1.2)).connect(head);

    return [air, a, b, drift(ctx, chorusG.gain, 0.11, 0.03, 29)];
  },

  cafe: (ctx, out) => {
    const head = calm(ctx, out, { top: 4000, cut: -10 });

    /* Not babble. Speech broken into syllables is the single most disruptive
       thing you can put behind someone writing, so this is the other end of
       it: the steady wash that a roomful of voices becomes once there are too
       many to follow. Speech-shaped in the spectrum, flat in time. */
    const room = source(ctx, noiseBuffer(ctx, 'brown'), 1);
    const shape = filter(ctx, 'bandpass', 480, 0.42);
    const roomG = gain(ctx, 1.18);
    room.connect(shape).connect(roomG).connect(head);

    const upper = source(ctx, noiseBuffer(ctx, 'pink'), 0.86);
    const upperG = gain(ctx, 0.10);
    upper.connect(filter(ctx, 'bandpass', 1150, 0.6)).connect(upperG).connect(head);

    // The room itself: air handling, the low hum of a full space.
    const hum = source(ctx, noiseBuffer(ctx, 'brown'), 0.71);
    hum.connect(filter(ctx, 'lowpass', 180, 0.7)).connect(gain(ctx, 0.35)).connect(head);

    return [room, upper, hum,
      drift(ctx, roomG.gain, 1.18, 0.16, 26),
      drift(ctx, upperG.gain, 0.10, 0.03, 43)];
  },

  waves: (ctx, out) => {
    const head = calm(ctx, out, { top: 5200 });

    const body = source(ctx, noiseBuffer(ctx, 'brown'), 1);
    const bodyG = gain(ctx, 0.88);
    body.connect(filter(ctx, 'lowpass', 420, 0.7)).connect(bodyG).connect(head);

    /* The swell is the one movement worth keeping: a set every ten seconds or
       so is 0.1 Hz, far below the rate at which movement starts to nag. The
       break is a slow rise in the upper band, not a transient. */
    const surf = source(ctx, noiseBuffer(ctx, 'pink'), 0.94);
    const surfF = filter(ctx, 'bandpass', 900, 0.5);
    const surfG = gain(ctx, 0.02);
    surf.connect(surfF).connect(surfG).connect(head);

    const roll = () => {
      const now = ctx.currentTime;
      const rise = 3.4 + Math.random() * 1.8;
      const fall = 5.5 + Math.random() * 3;
      surfG.gain.cancelScheduledValues(now);
      surfG.gain.setValueAtTime(Math.max(0.001, surfG.gain.value), now);
      surfG.gain.linearRampToValueAtTime(0.30 + Math.random() * 0.10, now + rise);
      surfG.gain.exponentialRampToValueAtTime(0.02, now + rise + fall);
    };
    roll();
    let timer = setInterval(roll, 11000);

    return [body, surf,
      drift(ctx, bodyG.gain, 0.88, 0.14, 21),
      { stop: () => clearInterval(timer) }];
  },

  /* The three noises are definitions rather than imitations, so they keep
     their shape. Only the very top is taken off, which is comfort rather than
     colour: nothing above 9 kHz survives a laptop speaker anyway, and it is
     the part that makes long listening tiring. */
  white: (ctx, out) => {
    const head = calm(ctx, out, { top: 9000, cut: -3 });
    const n = source(ctx, noiseBuffer(ctx, 'white'), 1);
    n.connect(gain(ctx, 0.42)).connect(head);
    return [n];
  },

  pink: (ctx, out) => {
    const head = calm(ctx, out, { top: 9000, cut: -3 });
    const n = source(ctx, noiseBuffer(ctx, 'pink'), 1);
    n.connect(gain(ctx, 0.98)).connect(head);
    return [n];
  },

  brown: (ctx, out) => {
    const head = calm(ctx, out, { top: 9000, cut: 0 });
    const n = source(ctx, noiseBuffer(ctx, 'brown'), 1);
    n.connect(gain(ctx, 0.80)).connect(head);
    return [n];
  }
};

/* ----------------------------------------------------------------- tests */

/* A small radix-2 FFT, enough to measure what the recipes are actually
   putting out. In-place, real input, magnitudes returned. */
function spectrum(samples) {
  const n = 1 << Math.floor(Math.log2(samples.length));
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // Hann window, so the bins mean something.
    re[i] = samples[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
  const mag = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) mag[i] = Math.hypot(re[i], im[i]);
  return mag;
}

/**
 * Renders a recipe offline and measures the things the design is trying to
 * control: how much of it sits in the band that grates, how brittle the top
 * end is, and how much the level moves at the rate that draws the ear.
 *
 * Not a substitute for listening, but it does catch the two mistakes that
 * made the first versions sound like static — energy piled into 2–5 kHz, and
 * movement in the seconds-and-under range.
 */
export async function measureAmbience(id, seconds = 4) {
  const recipe = RECIPES[id];
  if (!recipe) return null;
  const OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OC) return null;

  const rate = 44100;
  const ctx = new OC(2, Math.floor(rate * seconds), rate);
  const master = gain(ctx, 1);
  master.connect(ctx.destination);
  recipe(ctx, master);

  const rendered = await ctx.startRendering();
  const L = rendered.getChannelData(0);
  const R = rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : L;

  /* How alike the two ears are. One means the sound is a point between them,
     which is the tiring way to hear noise for an hour; near zero means it has
     no location, which is how weather actually arrives. */
  let ll = 0, rr = 0, lr = 0;
  for (let i = 0; i < L.length; i++) { ll += L[i] * L[i]; rr += R[i] * R[i]; lr += L[i] * R[i]; }
  const correlation = ll && rr ? +(lr / Math.sqrt(ll * rr)).toFixed(4) : 1;

  // Everything below measures the mono sum, which is what a laptop plays.
  const d = new Float32Array(L.length);
  for (let i = 0; i < L.length; i++) d[i] = (L[i] + R[i]) * 0.5;

  let peak = 0, sum = 0, bad = 0;
  for (let i = 0; i < d.length; i++) {
    const v = d[i];
    if (!Number.isFinite(v)) { bad++; continue; }
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / d.length);

  // Spectrum, averaged over the second half so start-up ramps are excluded.
  const from = Math.floor(d.length / 2);
  const win = 1 << 14;
  const bands = { low: 0, mid: 0, sharp: 0, bright: 0, total: 0 };
  let frames = 0;
  for (let off = from; off + win < d.length; off += win) {
    const mag = spectrum(d.subarray(off, off + win));
    const hz = rate / win;
    for (let i = 1; i < mag.length; i++) {
      const f = i * hz;
      const e = mag[i] * mag[i];
      bands.total += e;
      if (f < 300) bands.low += e;
      else if (f < 2000) bands.mid += e;
      else if (f < 5000) bands.sharp += e;      // the band that drives annoyance
      else bands.bright += e;
    }
    frames++;
  }
  const share = (x) => (bands.total ? +(x / bands.total).toFixed(4) : 0);

  /* How much the level moves between 0.5 and 8 Hz — the rate at which
     fluctuation is most noticeable, and the rate a focus sound should not
     have. Envelope sampled at 100 Hz, then its own spectrum. */
  const frameLen = Math.floor(rate / 100);
  const envN = 1 << Math.floor(Math.log2(Math.floor(d.length / frameLen)));
  const env = new Float64Array(envN);
  for (let i = 0; i < envN; i++) {
    let s = 0;
    for (let k = 0; k < frameLen; k++) s += d[i * frameLen + k] ** 2;
    env[i] = Math.sqrt(s / frameLen);
  }
  let mean = 0;
  for (let i = 0; i < envN; i++) mean += env[i];
  mean /= envN || 1;
  for (let i = 0; i < envN; i++) env[i] -= mean;

  const envMag = spectrum(env);
  const envHz = 100 / envN;
  let fluct = 0, envTotal = 0;
  for (let i = 1; i < envMag.length; i++) {
    const f = i * envHz;
    const e = envMag[i] * envMag[i];
    envTotal += e;
    if (f >= 0.5 && f <= 8) fluct += e;
  }

  return {
    rms: +rms.toFixed(4),
    peak: +peak.toFixed(4),
    nonFinite: bad,
    frames,
    low: share(bands.low),
    mid: share(bands.mid),
    sharp: share(bands.sharp),
    bright: share(bands.bright),
    // Movement at the rate that nags, relative to the mean level.
    fluctuation: mean > 0 ? +(Math.sqrt(fluct / (envN || 1)) / mean).toFixed(4) : 0,
    fluctShare: envTotal ? +(fluct / envTotal).toFixed(4) : 0,
    correlation
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

  const teardown = (list) => {
    for (const n of list) {
      try { if (typeof n.stop === 'function') n.stop(); } catch {}
      try { if (typeof n.disconnect === 'function') n.disconnect(); } catch {}
    }
  };

  return {
    get playing() { return current; },
    get volume() { return level; },

    setVolume(v) {
      level = Math.max(0, Math.min(1, v));
      if (master && ctx) master.gain.setTargetAtTime(level, ctx.currentTime, 0.05);
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
      setTimeout(() => teardown(dying), 500);
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

      master = gain(ctx, 0.0001);
      master.connect(ctx.destination);
      nodes = recipe(ctx, master).filter(Boolean);
      // Longer than a fade needs to be, so arriving is not itself an event.
      master.gain.linearRampToValueAtTime(level, ctx.currentTime + 1.6);
      current = id;
      return true;
    },

    dispose() {
      this.stop();
      teardown(nodes);
      nodes = [];
      if (ctx) { try { ctx.close(); } catch {} ctx = null; }
    }
  };
}
