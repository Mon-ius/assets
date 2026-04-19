'use strict';

/* =====================================================================
   assets.js — Registry of tradeable asset types (spec v2).

   Replaces the single hardcoded DLM dividend asset with a menu of six
   asset "environments". The per-session scheduler in main.js picks an
   id from this registry before each session; the Market installs the
   selected asset via setAsset() and re-initialises its state at every
   round boundary. Every asset contract:

     id                — stable string key used by the UI + scheduler
     label             — human-readable name shown in the dropdown
     shortLabel        — ≤3-char chip used in compact summaries
     description       — one-line hover tooltip
     init(config)      — returns a fresh state object for a new round,
                         seeded so `state.fv[1] === 100` for every asset
     fundamentalValue  — (period, state) → FV at the start of that period
     drawDividend      — (period, state, rng, config, tunables) → dividend
                         paid to each share holder at the END of `period`

   State is transient and round-local — the engine discards it at the
   round boundary (a session is R rounds, each a fresh market). Path-
   dependent assets (random walk, jump/crash) keep their trajectory in
   `state.fv[]`; memoryless ones (linear declining, constant,
   cyclical, linear growth) can still lean on `state.fv[]` so replay
   views don't need per-asset code paths.

   All six assets are scaled so FV_1 = 100 at T = 20, matching the
   simulator's default horizon. Formulas follow
   `different_asset_simulation_v2.html`.
   ===================================================================== */

/* Anchor for the first period of every session/round. The spec pins
 * this at 100 for every asset so that the order-book bootstrap and the
 * agent priors always begin from the same scale. */
const ASSET_ANCHOR_FV = 100;

/* Risk-free discount rate used by the spec's constant/perpetual and
 * path-based assets. Kept at module scope so every asset reads the
 * same number. */
const ASSET_DISCOUNT_RATE = 0.05;

/** Shared: Box–Muller normal draw on top of the seeded RNG. */
function normalDraw(rng, mean = 0, sigma = 1) {
  let u = rng();
  if (u < 1e-12) u = 1e-12;
  const v = rng();
  return mean + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/* Complex-dividend distribution — five-point mean-preserving spread of
 * the Asset 1 coin flip, E[d] = 5. Only Asset 1 honours the Advanced
 * → Complex Dividends toggle; every other asset ignores it. */
const COMPLEX_LINEAR_DIVIDENDS = [
  { value:  0, prob: 0.30 },
  { value:  2, prob: 0.25 },
  { value:  5, prob: 0.20 },
  { value: 10, prob: 0.15 },
  { value: 20, prob: 0.10 },
];

function drawFromDistribution(rng, buckets) {
  const r = rng();
  let acc = 0;
  for (const b of buckets) {
    acc += b.prob;
    if (r < acc) return b.value;
  }
  return buckets[buckets.length - 1].value;
}

/**
 * Asset 1 — Linear Declining (the DLM baseline, scaled to T=20).
 * FV_t = 5 · (T − t + 1), so FV_1 = 100, FV_20 = 5.
 * d_t ∈ {10 @ 0.5, 0 @ 0.5}, E[d_t] = 5. No terminal value.
 */
const ASSET_LINEAR_DECLINING = {
  id:          'linearDeclining',
  label:       'Linear Declining (DLM)',
  shortLabel:  'LD',
  description: 'DLM 2005 staircase — dividend {0,10}¢, FV = 5·(T−t+1).',
  init(config) {
    const T = config.periods;
    const mu = 5;
    const fv = new Array(T + 2).fill(0);
    for (let t = 1; t <= T; t++) fv[t] = mu * (T - t + 1);
    fv[T + 1] = 0;
    return { fv, expectedDividend: mu, terminalValue: 0 };
  },
  fundamentalValue(period, state) {
    return state.fv[period] != null ? state.fv[period] : 0;
  },
  drawDividend(period, state, rng, config, tunables) {
    if (tunables && tunables.applyComplexDividends) {
      return drawFromDistribution(rng, COMPLEX_LINEAR_DIVIDENDS);
    }
    return rng() < 0.5 ? 10 : 0;
  },
};

/**
 * Asset 2 — Perpetual. FV_t = E[d] / r = 5 / 0.05 = 100 for
 * every period. d_t ∈ {6 @ 0.5, 4 @ 0.5}, E[d_t] = 5.
 */
const ASSET_CONSTANT_PERPETUAL = {
  id:          'constantPerpetual',
  label:       'Perpetual',
  shortLabel:  'CP',
  description: 'Perpetual claim — FV constant at 100, dividend {4,6}¢.',
  init(config) {
    const T = config.periods;
    const fv = new Array(T + 2).fill(ASSET_ANCHOR_FV);
    fv[0] = 0;
    return { fv, expectedDividend: 5, terminalValue: ASSET_ANCHOR_FV };
  },
  fundamentalValue(period, state) {
    return state.fv[period] != null ? state.fv[period] : ASSET_ANCHOR_FV;
  },
  drawDividend(period, state, rng, config, tunables) {
    return rng() < 0.5 ? 4 : 6;
  },
};

/**
 * Asset 3 — Linear Growth. Expected dividend rises linearly in t:
 * E[d_s] = a + b·s with (a, b) solved so FV_1 = 100 at T = 20.
 * Sum_{s=1}^{T}(a + b·s) = a·T + b·T(T+1)/2 = 100 ⇒ choose b = 0.3
 * (per spec) and a = (100 − b·T(T+1)/2) / T. With T = 20, a ≈ 1.85.
 * Simulator uses the no-discount closed form from the spec so each
 * agent's "true FV" is the running tail sum.
 */
const ASSET_LINEAR_GROWTH = {
  id:          'linearGrowth',
  label:       'Linear Growth',
  shortLabel:  'LG',
  description: 'Rising-dividend regime — E[d] grows linearly in t.',
  init(config) {
    const T = config.periods;
    const b = 0.3;
    // Solve a so that Σ_{s=1..T}(a + b·s) = ASSET_ANCHOR_FV.
    const sumS = (T * (T + 1)) / 2;
    const a = (ASSET_ANCHOR_FV - b * sumS) / T;
    const fv = new Array(T + 2).fill(0);
    let tail = 0;
    for (let s = T; s >= 1; s--) tail += a + b * s;
    fv[1] = tail;
    for (let t = 2; t <= T; t++) {
      fv[t] = fv[t - 1] - (a + b * (t - 1));
    }
    fv[T + 1] = 0;
    // E[d_T] is the last rung — used as a coarse expectedDividend hint.
    return { fv, a, b, expectedDividend: a + b * Math.ceil(T / 2), terminalValue: 0 };
  },
  fundamentalValue(period, state) {
    return state.fv[period] != null ? Math.max(0, state.fv[period]) : 0;
  },
  drawDividend(period, state, rng, config, tunables) {
    const mean  = state.a + state.b * period;
    const sigma = 1.0;
    return Math.max(0, normalDraw(rng, mean, sigma));
  },
};

/**
 * Asset 4 — Cyclical. FV_t = 100 + 20·sin(2π/10·(t−1)),
 * period 10, amplitude 20, mean 100. Dividend tracks the same cycle
 * with smaller amplitude.
 */
const ASSET_CYCLICAL_SINE = {
  id:          'cyclicalSine',
  label:       'Cyclical',
  shortLabel:  'CY',
  description: 'Sinusoidal FV — 100 + 20·sin(2π(t−1)/10).',
  init(config) {
    const T = config.periods;
    const fv = new Array(T + 2).fill(0);
    for (let t = 1; t <= T; t++) {
      fv[t] = ASSET_ANCHOR_FV + 20 * Math.sin((2 * Math.PI / 10) * (t - 1));
    }
    fv[T + 1] = fv[T];
    return { fv, expectedDividend: 5, terminalValue: fv[T] };
  },
  fundamentalValue(period, state) {
    return state.fv[period] != null ? state.fv[period] : ASSET_ANCHOR_FV;
  },
  drawDividend(period, state, rng, config, tunables) {
    const mean  = 5 + 2 * Math.sin((2 * Math.PI / 10) * (period - 1));
    const sigma = 1.0;
    return Math.max(0, normalDraw(rng, mean, sigma));
  },
};

/**
 * Asset 5 — Random Walk Fundamental. FV_{t+1} = max(20, FV_t + η_t)
 * with η_t ~ N(0, 25) (σ = 5). FV_1 = 100; state is pre-generated for
 * the full round so replay is deterministic. Dividend is backed out
 * from the path: d_t = FV_t − FV_{t+1}/(1+r).
 */
const ASSET_RANDOM_WALK = {
  id:          'randomWalk',
  label:       'Random Walk Fundamental',
  shortLabel:  'RW',
  description: 'FV_t follows a reflected random walk with floor 20.',
  init(config) {
    const T = config.periods;
    const fv = new Array(T + 2).fill(0);
    fv[1] = ASSET_ANCHOR_FV;
    return { fv, sigma: 5, floor: 20, expectedDividend: 5, terminalValue: ASSET_ANCHOR_FV };
  },
  fundamentalValue(period, state) {
    return state.fv[period] != null ? state.fv[period] : ASSET_ANCHOR_FV;
  },
  drawDividend(period, state, rng, config, tunables) {
    // Extend the path one period at a time, so the dividend is a
    // function of the just-drawn FV_{t+1}. The extension is cached
    // on state so a second call for the same period would read the
    // same value.
    if (state.fv[period + 1] === 0 || state.fv[period + 1] == null) {
      const eta  = normalDraw(rng, 0, state.sigma);
      const next = Math.max(state.floor, state.fv[period] + eta);
      state.fv[period + 1] = next;
    }
    const r = ASSET_DISCOUNT_RATE;
    const d = state.fv[period] - state.fv[period + 1] / (1 + r);
    return Math.max(0, d);
  },
};

/**
 * Asset 6 — Jump / Crash. FV_{t+1} = FV_t + 2 w.p. 0.9,
 * FV_t − 30 w.p. 0.1. Expected drift −1.2. FV_1 = 100, floor at 5.
 */
const ASSET_JUMP_CRASH = {
  id:          'jumpCrash',
  label:       'Jump / Crash',
  shortLabel:  'JC',
  description: 'Small positive drift interrupted by 10% chance of crash.',
  init(config) {
    const T = config.periods;
    const fv = new Array(T + 2).fill(0);
    fv[1] = ASSET_ANCHOR_FV;
    return { fv, drift: 2, crash: -30, crashProb: 0.1, floor: 5, expectedDividend: 0, terminalValue: ASSET_ANCHOR_FV };
  },
  fundamentalValue(period, state) {
    return state.fv[period] != null ? state.fv[period] : ASSET_ANCHOR_FV;
  },
  drawDividend(period, state, rng, config, tunables) {
    if (state.fv[period + 1] === 0 || state.fv[period + 1] == null) {
      const step = rng() < state.crashProb ? state.crash : state.drift;
      state.fv[period + 1] = Math.max(state.floor, state.fv[period] + step);
    }
    const r = ASSET_DISCOUNT_RATE;
    const d = state.fv[period] - state.fv[period + 1] / (1 + r);
    return Math.max(0, d);
  },
};

/** Canonical registry. Order defines the dropdown order. */
const ASSET_TYPES = [
  ASSET_LINEAR_DECLINING,
  ASSET_CONSTANT_PERPETUAL,
  ASSET_LINEAR_GROWTH,
  ASSET_CYCLICAL_SINE,
  ASSET_RANDOM_WALK,
  ASSET_JUMP_CRASH,
];

const ASSET_TYPES_BY_ID = Object.fromEntries(ASSET_TYPES.map(a => [a.id, a]));

/* Expected FV path FV_1..FV_T for each asset — used by the per-session
 * asset pair selector to compute a Pearson correlation between the
 * "pre-replacement" and "post-replacement" assets the user picks. For
 * the four deterministic assets this is the same path `init()` fills;
 * for the two stochastic ones (random walk, jump/crash) it is the
 * analytical expected path so the correlation readout is deterministic
 * across runs and doesn't depend on RNG state. */
function assetExpectedFvPath(asset, T) {
  if (!asset || !(T > 0)) return [];
  switch (asset.id) {
    case 'linearDeclining':
      return Array.from({ length: T }, (_, i) => 5 * (T - (i + 1) + 1));
    case 'constantPerpetual':
      return Array.from({ length: T }, () => ASSET_ANCHOR_FV);
    case 'linearGrowth': {
      const b = 0.3;
      const sumS = (T * (T + 1)) / 2;
      const a = (ASSET_ANCHOR_FV - b * sumS) / T;
      // FV_t = Σ_{s=t..T} (a + b·s)
      const out = new Array(T);
      let tail = 0;
      for (let s = T; s >= 1; s--) {
        tail += a + b * s;
        out[s - 1] = tail;
      }
      return out;
    }
    case 'cyclicalSine':
      return Array.from({ length: T }, (_, i) =>
        ASSET_ANCHOR_FV + 20 * Math.sin((2 * Math.PI / 10) * i));
    case 'randomWalk':
      // Martingale: E[FV_t] = FV_1 = 100 for every t.
      return Array.from({ length: T }, () => ASSET_ANCHOR_FV);
    case 'jumpCrash': {
      // Expected per-step drift = 0.9·(+2) + 0.1·(−30) = −1.2.
      const drift = 0.9 * 2 + 0.1 * -30;
      return Array.from({ length: T }, (_, i) => ASSET_ANCHOR_FV + drift * i);
    }
    default:
      return Array.from({ length: T }, () => ASSET_ANCHOR_FV);
  }
}

/* Per-asset FV formula as native-MathML source. Rendered verbatim into
 * Figure 1's fig-eq on every UI render so the caption tracks the active
 * asset. The strings live here (rather than mathml.js Sym) because they
 * are asset-specific and only surface through the asset registry. */
const _ASSET_MATH_NS = ' xmlns="http://www.w3.org/1998/Math/MathML"';
const _assetMath = body => `<math display="inline"${_ASSET_MATH_NS}>${body}</math>`;

/* Reusable MathML sub-expressions so each full derivation stays
 * readable. MathML is verbose — `_fv`, `_ed`, `_kt` keep the
 * per-asset strings focused on structure, not tag noise. */
const _mFv      = '<msub><mrow><mi>F</mi><mi>V</mi></mrow><mi>t</mi></msub>';
const _mFvNext  = '<msub><mrow><mi>F</mi><mi>V</mi></mrow><mrow><mi>t</mi><mo>+</mo><mn>1</mn></mrow></msub>';
const _mEdt     = '<mrow><mi>E</mi><mo>[</mo><msub><mi>d</mi><mi>t</mi></msub><mo>]</mo></mrow>';
const _mEds     = '<mrow><mi>E</mi><mo>[</mo><msub><mi>d</mi><mi>s</mi></msub><mo>]</mo></mrow>';
const _mSinArg  = '<mfrac>'
  + '<mrow><mn>2</mn><mi>π</mi><mo>(</mo><mi>t</mi><mo>−</mo><mn>1</mn><mo>)</mo></mrow>'
  + '<mn>10</mn>'
  + '</mfrac>';

const ASSET_FV_FORMULAS = {
  // FV_t = E[d_t] · (T − t + 1)      (symbolic form per v3 §5.1)
  linearDeclining: _assetMath(
    '<mrow>'
    + _mFv + '<mo>=</mo>' + _mEdt
    + '<mo>·</mo><mo>(</mo><mi>T</mi><mo>−</mo><mi>t</mi><mo>+</mo><mn>1</mn><mo>)</mo>'
    + '</mrow>',
  ),
  // FV_t = E[d_t] / r                (v3 §5.7)
  constantPerpetual: _assetMath(
    '<mrow>'
    + _mFv + '<mo>=</mo>'
    + '<mfrac>' + _mEdt + '<mi>r</mi></mfrac>'
    + '</mrow>',
  ),
  // FV_t = Σ_{s=t}^{T} E[d_s]        (v3 §5.13, undiscounted tail sum)
  linearGrowth: _assetMath(
    '<mrow>'
    + _mFv + '<mo>=</mo>'
    + '<munderover><mo>Σ</mo><mrow><mi>s</mi><mo>=</mo><mi>t</mi></mrow><mi>T</mi></munderover>'
    + _mEds
    + '</mrow>',
  ),
  // FV_t = 100 + 20·sin(2π(t−1)/10)  (v3 §5.19 specifies the path directly)
  cyclicalSine: _assetMath(
    '<mrow>'
    + _mFv + '<mo>=</mo><mn>100</mn><mo>+</mo><mn>20</mn><mo>·</mo><mi>sin</mi>'
    + '<mo>(</mo>' + _mSinArg + '<mo>)</mo>'
    + '</mrow>',
  ),
  // FV_{t+1} = max(20, FV_t + η_t)   (v3 §5.25)
  randomWalk: _assetMath(
    '<mrow>'
    + _mFvNext + '<mo>=</mo><mi>max</mi>'
    + '<mo>(</mo><mn>20</mn><mo>,</mo>'
    + _mFv
    + '<mo>+</mo><msub><mi>η</mi><mi>t</mi></msub>'
    + '<mo>)</mo>'
    + '</mrow>',
  ),
  // FV_{t+1} = max(5, FV_t + μ_j)    (v3 §5.31)
  jumpCrash: _assetMath(
    '<mrow>'
    + _mFvNext + '<mo>=</mo><mi>max</mi>'
    + '<mo>(</mo><mn>5</mn><mo>,</mo>'
    + _mFv
    + '<mo>+</mo><msub><mi>μ</mi><mi>j</mi></msub>'
    + '<mo>)</mo>'
    + '</mrow>',
  ),
};

for (const a of ASSET_TYPES) a.fvFormula = ASSET_FV_FORMULAS[a.id] || '';

/** Resolve an id → asset, falling back to Linear Declining (DLM baseline). */
function getAssetType(id) {
  return ASSET_TYPES_BY_ID[id] || ASSET_LINEAR_DECLINING;
}

const DEFAULT_ASSET_ID = ASSET_LINEAR_DECLINING.id;
