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

   Formulas follow `different_asset_simulation_v4.html`. Under v4 five of
   the six assets have FV_1 = 100 at T = 20 (linear-declining, perpetual,
   cyclical, random-walk, jump/crash); Linear Growth is the exception —
   its §5.13 discounted tail-sum gives FV_1 ≈ 58.3 and the "rise" shows
   up in E[d_s], not in FV_t itself.
   ===================================================================== */

/* Default first-period anchor used by assets whose §5 formula hits 100 at
 * t = 1 (and as a safety fallback for path-dependent assets that seed
 * fv[1] = 100 directly). Linear Growth does NOT anchor at 100 — its
 * discounted tail-sum is computed from the dividend schedule instead. */
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
  // v4 §5.4 — agent infers μ̂_{i,t+j}=5 and takes the simplified
  // (undiscounted) tail sum FṼ_{i,t} = 5·k_t, k_t = T−t+1. Matches the
  // staircase so a rational agent is exactly right.
  modelBasedFV(period, state, config) {
    const T = (config && config.periods) || state.fv.length - 2;
    const kt = Math.max(0, T - period + 1);
    return 5 * kt;
  },
  // v5 §5.5 — Anchor = 5T (initial total value — "没有完全 internalize
  // declining path"). DividendSignal = d̄_obs·A_t. Narrative = 0.
  heuristicParts(period, state, config, env) {
    const T = (config && config.periods) || state.fv.length - 2;
    return {
      anchor: 5 * T,
      dividendSignal: env.dBarObs * env.At,
      narrative: 0,
    };
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
  // v4 §5.10 — FṼ_{i,t} = E[d]/r = 5/0.05 = 100 at every t.
  modelBasedFV(/* period, state, config */) {
    return ASSET_ANCHOR_FV;
  },
  // v5 §5.11 — Anchor = 100. DividendSignal = d̄_obs / r (Gordon).
  // Narrative = 0 (easy-to-value asset, weak heuristic).
  heuristicParts(period, state, config, env) {
    const r = ASSET_DISCOUNT_RATE;
    return {
      anchor: ASSET_ANCHOR_FV,
      dividendSignal: env.dBarObs / r,
      narrative: 0,
    };
  },
  drawDividend(period, state, rng, config, tunables) {
    return rng() < 0.5 ? 4 : 6;
  },
};

/**
 * Asset 3 — Linear Growth (v4 §5.13–§5.16). Expected dividend rises
 * linearly in s: E[d_s] = a + b·s with (a, b) = (2, 0.3). The true FV
 * is the finite discounted tail-sum of expected dividends,
 *     FV_t = Σ_{s=t..T} (a + b·s) / (1+r)^{s-t+1},
 * matching the agent's model-based Ṽ_{FV} in §5.16 so a rational
 * (α = 1) trader is exactly right. With (a, b, r, T) = (2, 0.3, 0.05, 20)
 * the path runs from FV_1 ≈ 58.3 down to FV_20 ≈ 7.62 — the "growth"
 * shows up in the rising dividend mean, not in the FV itself (finite-
 * horizon remaining value still declines as terms fall out of the sum).
 */
const ASSET_LINEAR_GROWTH = {
  id:          'linearGrowth',
  label:       'Linear Growth',
  shortLabel:  'LG',
  description: 'Rising-dividend perpetuity — FV = (2 + 0.3t)/r.',
  init(config) {
    const T = config.periods;
    const a = 2;
    const b = 0.3;
    const r = ASSET_DISCOUNT_RATE;
    const fv = new Array(T + 2).fill(0);
    // v5 §5.13 — perpetual growth asset with rising μ̂ and FV_t = E[d_t]/r.
    // Produces a monotonically rising environment instead of the v4
    // finite-horizon tail sum, matching the agent's model-based §5.16.
    for (let t = 1; t <= T + 1; t++) fv[t] = (a + b * t) / r;
    return { fv, a, b, r, expectedDividend: a + b * Math.ceil(T / 2), terminalValue: fv[T] };
  },
  fundamentalValue(period, state) {
    return state.fv[period] != null ? Math.max(0, state.fv[period]) : 0;
  },
  // v5 §5.16 — agent infers μ̂_{i,t} = 2 + 0.3·t and Gordon-discounts:
  //   FṼ_{i,t} = (2 + 0.3·t) / r.
  // Same closed form as `fundamentalValue` above (perpetuity), so we
  // just delegate — a rational (α=1) trader is then exactly right.
  modelBasedFV(period, state /*, config */) {
    return state.fv[period] != null ? Math.max(0, state.fv[period]) : 0;
  },
  // v5 §5.17 — Anchor = FṼ_{i,t} (model value). DividendSignal =
  //   d̄_obs·A_t. Narrative = g_i + max(Trend, 0), growth optimism
  //   plus a one-sided momentum bonus.
  heuristicParts(period, state, config, env) {
    const r = ASSET_DISCOUNT_RATE;
    const anchor = Math.max(0, ((state.a || 2) + (state.b || 0.3) * period) / r);
    const trend  = Number.isFinite(env && env.trend) ? env.trend : 0;
    const g      = (env && env.agent && env.agent.narrativeTraits)
      ? env.agent.narrativeTraits.g : 5;
    return {
      anchor,
      dividendSignal: env.dBarObs * env.At,
      narrative: g + Math.max(trend, 0),
    };
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
    const r = ASSET_DISCOUNT_RATE;
    const fv = new Array(T + 2).fill(0);
    for (let t = 1; t <= T; t++) {
      fv[t] = ASSET_ANCHOR_FV + 20 * Math.sin((2 * Math.PI / 10) * (t - 1));
    }
    fv[T + 1] = fv[T];
    // v4 §5.22 — agent's discounted tail sum over the sinusoidal μ̂.
    // Pre-computed once here so modelBasedFV is O(1) at runtime.
    //   FṼ_{i,t} = Σ_{s=t..T} [5 + 2·sin(2π(s−1)/10)] / (1+r)^{s−t+1}
    const modelFV = new Array(T + 2).fill(0);
    for (let t = 1; t <= T; t++) {
      let v = 0;
      for (let s = t; s <= T; s++) {
        const mu = 5 + 2 * Math.sin((2 * Math.PI / 10) * (s - 1));
        v += mu / Math.pow(1 + r, s - t + 1);
      }
      modelFV[t] = v;
    }
    return { fv, modelFV, expectedDividend: 5, terminalValue: fv[T] };
  },
  fundamentalValue(period, state) {
    return state.fv[period] != null ? state.fv[period] : ASSET_ANCHOR_FV;
  },
  // v4 §5.22 — distinct from the 100+20·sin path above, which is the
  // simulator's heuristic FV for Figure 1. The agent's model-based
  // value is the discounted tail sum of expected dividends.
  modelBasedFV(period, state /*, config */) {
    if (state && state.modelFV && state.modelFV[period] != null) {
      return Math.max(0, state.modelFV[period]);
    }
    return ASSET_ANCHOR_FV;
  },
  // v5 §5.23 — Anchor = 100. DividendSignal = d̄_obs·A_t. Narrative =
  //   c_i + λ_c·sign(Trend), with λ_c = 4 (mistake a short trend for
  //   the whole cycle).
  heuristicParts(period, state, config, env) {
    const trend = Number.isFinite(env && env.trend) ? env.trend : 0;
    const c     = (env && env.agent && env.agent.narrativeTraits)
      ? env.agent.narrativeTraits.c : 0;
    return {
      anchor: ASSET_ANCHOR_FV,
      dividendSignal: env.dBarObs * env.At,
      narrative: c + 4 * Math.sign(trend),
    };
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
  // v4/v5 §5.28 — with no explicit structure the agent can only take
  // the "current central level". First-version recommendation (the
  // simplest choice listed in the spec): FṼ_{i,t} = 100 (constant).
  // The agent does NOT observe the live FV path.
  modelBasedFV(/* period, state, config */) {
    return ASSET_ANCHOR_FV;
  },
  // v5 §5.29 — Anchor = 100. DividendSignal = 100 at t=1 else 0
  //   (no dividend structure to latch onto once trading starts).
  //   Narrative = u_i (random drift narrative, no trend reaction).
  heuristicParts(period, state, config, env) {
    const u = (env && env.agent && env.agent.narrativeTraits)
      ? env.agent.narrativeTraits.u : 0;
    return {
      anchor: ASSET_ANCHOR_FV,
      dividendSignal: period <= 1 ? ASSET_ANCHOR_FV : 0,
      narrative: u,
    };
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
  // v4 §5.34 — if agent uses the stated probabilities,
  //   Ẽ_i[ΔFV] = 0.9·(+2) + 0.1·(−30) = −1.2
  //   FṼ_{i,t} = FV^{anchor} − 1.2·k_t,  k_t = T − t + 1,
  //   FV^{anchor} = 100 (constant, public starting level).
  // Not the live post-shock FV_t.
  modelBasedFV(period, state, config) {
    const T = (config && config.periods) || state.fv.length - 2;
    const kt = Math.max(0, T - period + 1);
    return Math.max(0, ASSET_ANCHOR_FV - 1.2 * kt);
  },
  // v5 §5.35 — Anchor = 100. DividendSignal = 100 + k_t·Ẽ_i[ΔFV]
  //   with Ẽ_i[ΔFV] = (1 − p̃_c,i)·2 + p̃_c,i·(−30) and subjective
  //   crash prob p̃_c,i = max(0, 0.1 − δ_i). Narrative = h_i +
  //   max(Trend, 0) — everyday-normal optimism plus momentum.
  heuristicParts(period, state, config, env) {
    const T  = (config && config.periods) || state.fv.length - 2;
    const kt = Math.max(0, T - period + 1);
    const traits = (env && env.agent && env.agent.narrativeTraits)
      ? env.agent.narrativeTraits
      : { h: 4, delta: 0 };
    const pc   = Math.max(0, 0.1 - (traits.delta || 0));
    const edFv = (1 - pc) * 2 + pc * (-30);
    const trend = Number.isFinite(env && env.trend) ? env.trend : 0;
    return {
      anchor: ASSET_ANCHOR_FV,
      dividendSignal: ASSET_ANCHOR_FV + kt * edFv,
      narrative: (traits.h || 0) + Math.max(trend, 0),
    };
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

/* ---------------------------------------------------------------------
 * Per-asset "agent input templates" (v3 §5.3 / §5.9 / §5.15 / §5.21 /
 * §5.27 / §5.33). These drive the Plan II / Plan III LLM prompt: the
 * current round's active asset (as selected in Advanced → Session
 * Replacement Rate, Pre/Post Asset & FV Correlation) picks one of
 * these templates, and `ai.getPlanBeliefs` splices the block into the
 * user prompt in place of the generic DLM coin-flip rules. Fields:
 *
 *   typeLabel    — one-line "资产类型" in English
 *   horizon      — boilerplate describing how many periods remain
 *   dividendRule — bullet lines describing the per-period dividend
 *                  process (what d_t is, with probabilities/means)
 *   extras       — additional environmental notes (residual value,
 *                  discount rate, cycle length, starting level, etc.)
 *   fvFormula    — plain-text "model-based valuation" the agent is
 *                  expected to derive from the public rule (v3 §5.4 /
 *                  §5.10 / §5.16 / §5.22 / §5.28 / §5.34)
 *   heuristic    — short sentence describing the canonical heuristic
 *                  mistake a naive agent tends to make (v3 §5.5 etc.),
 *                  so the LLM can reason about bias instead of merely
 *                  reciting the textbook answer.
 *
 * Template text is kept here (not inlined in ai.js) so the asset
 * registry stays the single source of truth for asset-specific copy,
 * matching the pattern already used by `fvFormula` for Figure 1. */
const ASSET_AGENT_TEMPLATES = {
  linearDeclining: {
    typeLabel:    'Gradually depleting asset',
    horizon:      'Total remaining periods: T. After period T the asset expires — no further payoffs and no residual value.',
    dividendRule: [
      '- 50% probability the dividend is 10',
      '- 50% probability the dividend is 0',
      'Expected per-period dividend E[d_t] = 5.',
    ],
    extras: [
      'No terminal value — K_t = 0.',
    ],
    fvFormula: 'v5 §5.4 — agent infers μ̂_{i,t+j} = 5 from the public rule, then  FṼ_{i,t} = Σ_{j=1..k_t} 5 / (1+r)^j  where k_t = T − t + 1. Simplified (undiscounted first-version):  FṼ_{i,t} = 5·k_t.',
    heuristicFormula: 'v5 §5.5 — H_{i,t} = β₁·(5T) + β₂·(p_{t−1}^{last} − p_{t−2}^{last}) + β₃·(d̄_obs · A_t);  A_t = Σ_{j=1..k_t} (1+r)^{−j};  narrative = 0.',
    heuristic: 'Naive agents anchor to the initial total value 5T and fail to internalise the declining path; they also over-weight the last observed price as a trend signal.',
  },
  constantPerpetual: {
    typeLabel:    'Long-lived stable-yield asset',
    horizon:      'The yield environment is long-run stable — the asset does not deplete and has no terminal period.',
    dividendRule: [
      '- 50% probability the dividend is 6',
      '- 50% probability the dividend is 4',
      'Expected per-period dividend E[d_t] = 5.',
    ],
    extras: [
      'Capital opportunity cost / discount rate r = 5% per period.',
    ],
    fvFormula: 'v5 §5.10 — agent infers μ̂_{i,t+j} = 5, then  FṼ_{i,t} = 5 / 0.05 = 100  (constant across t; Gordon perpetuity on the flat expected dividend).',
    heuristicFormula: 'v5 §5.11 — H_{i,t} = β₁·100 + β₂·(p_{t−1}^{last} − p_{t−2}^{last}) + β₃·(d̄_obs / 0.05);  narrative = 0 (easy-to-value, weak heuristic).',
    heuristic: 'Naive agents treat the perpetual as if it were finite-horizon and drift toward a declining mental model; peer messages about "price going up" can push them away from the flat 100 anchor.',
  },
  linearGrowth: {
    typeLabel:    'Growth-type asset',
    horizon:      'The project\u2019s earning power improves over time for the full T-period horizon. No residual value after period T.',
    dividendRule: [
      'Expected dividend at period s: E[d_s] = 2 + 0.3·s',
      'Each realisation fluctuates around this mean (Gaussian, σ = 1).',
    ],
    extras: [
      'Capital opportunity cost / discount rate r = 5% per period.',
    ],
    fvFormula: 'v5 §5.16 — agent infers μ̂_{i,t} = 2 + 0.3·t, Gordon perpetuity:  FṼ_{i,t} = (2 + 0.3·t) / r  with r = 0.05. Rising environment (perpetual growth asset, no terminal date).',
    heuristicFormula: 'v5 §5.17 — H_{i,t} = β₁·FṼ_{i,t} + β₂·(p_{t−1}^{last} − p_{t−2}^{last}) + β₃·(d̄_obs · A_t) + β₄·(g_i + max(Trend, 0));  A_t = Σ_{j=1..k_t} (1+r)^{−j};  g_i ~ N(5, 5²), g_i ≥ 0 (growth-optimism trait).',
    heuristic: 'Naive agents mistake the rising dividend stream for a rising price path and ignore that finite-horizon remaining FV actually declines — over-paying early and late as terms fall out of the tail sum.',
  },
  cyclicalSine: {
    typeLabel:    'Cyclical asset',
    horizon:      'The asset is driven by a business-cycle pattern. Cycle length ≈ 10 periods. T periods total.',
    dividendRule: [
      'Expected dividend cycles with period 10: E[d_t] = 5 + 2·sin(2π · (t−1) / 10).',
      'Each realisation fluctuates around this mean (Gaussian, σ = 1).',
    ],
    extras: [
      'You know a cycle exists, but may not know exactly which phase you are in.',
    ],
    fvFormula: 'v5 §5.22 — if agent understands the cycle rule, μ̂_{i,s} = 5 + 2·sin(2π·(s−1)/10), then  FṼ_{i,t} = Σ_{s=t..T} [5 + 2·sin(2π·(s−1)/10)] / (1+r)^{s−t+1}  — discounted tail-sum of the sinusoidal expected dividend at r = 0.05.',
    heuristicFormula: 'v5 §5.23 — H_{i,t} = β₁·100 + β₂·(p_{t−1}^{last} − p_{t−2}^{last}) + β₃·(d̄_obs · A_t) + β₄·(c_i + λ_c·sign(Trend));  c_i ~ N(0, 5²) is the per-agent cycle bias;  λ_c = 4 (mistake a short trend for the whole cycle).',
    heuristic: 'Naive agents mistake the rising half of the cycle for a durable trend and the falling half for a crash; phase confusion is the dominant error.',
  },
  randomWalk: {
    typeLabel:    'Stochastically drifting asset',
    horizon:      'No fixed upward trend, downward trend, or cycle. The value environment is subject to persistent random shocks for T periods.',
    dividendRule: [
      'FV_{t+1} = max(20, FV_t + η_t), with η_t ~ Normal(0, σ=5).',
      'Dividend at period t is backed out from the FV path: d_t = FV_t − FV_{t+1}/(1+r), floored at 0.',
    ],
    extras: [
      'Current environment starts at FV_1 = 100. Future FV may rise or fall symmetrically.',
    ],
    fvFormula: 'v5 §5.28 — with no explicit structure the agent can only take the "current central level". First-version default:  FṼ_{i,1} = 100  and  FṼ_{i,t} = 100  (constant anchor, simplest). Alternatives mentioned in the spec for t ≥ 2:  FṼ_{i,t} = p_{t−1}^{last}  (last trade price of the previous period) or  FṼ_{i,t} = p̄_{t−1}^{(L)}  (rolling L-period mean).',
    heuristicFormula: 'v5 §5.29 — t = 1: H_{i,1} = β₁·100 + β₄·u_i.  t ≥ 2: H_{i,t} = β₁·100 + β₂·(p_{t−1}^{last} − p_{t−2}^{last}) + β₄·u_i  (DividendSignal = 0 — no structured dividend to latch onto); u_i ~ N(0, 5²) is a random-walk narrative idiosyncrasy.',
    heuristic: 'Naive agents over-extrapolate recent moves — they treat a short up-run as a trend and a short down-run as a crash, instead of treating FV as memoryless.',
  },
  jumpCrash: {
    typeLabel:    'Asset with rare-disaster (crash) risk',
    horizon:      'T periods. Calm phases are briefly positive; a small chance each period wipes out many calm periods at once.',
    dividendRule: [
      'FV moves each period by one of two jumps:',
      '- 90% probability: +2 (calm drift up)',
      '- 10% probability: −30 (rare crash)',
      'Dividend at period t is backed out from the FV path: d_t = FV_t − FV_{t+1}/(1+r), floored at 0.',
    ],
    extras: [
      'Current environment starts at FV_1 = 100. Floor at 5 (FV cannot fall below 5).',
      'Expected per-period drift E[ΔFV] = 0.9·(+2) + 0.1·(−30) = −1.2 — slightly negative on average.',
    ],
    fvFormula: 'v5 §5.34 — if agent uses the stated probabilities,  Ẽ_i[ΔFV] = 0.9·(+2) + 0.1·(−30) = −1.2.  Therefore  FṼ_{i,t} = FV_t^{anchor} − 1.2·k_t  with the first-version anchor  FV_t^{anchor} = 100  (constant, public starting level), so  FṼ_{i,1} = 100 − 1.2·T.  k_t = T − t + 1.',
    heuristicFormula: 'v5 §5.35 — H_{i,t} = β₁·100 + β₂·(p_{t−1}^{last} − p_{t−2}^{last}) + β₃·(100 + k_t·Ẽ_i[ΔFV]) + β₄·(h_i + max(Trend, 0));  subjective crash prob p̃_{c,i} = max(0, 0.1 − δ_i), Ẽ_i[ΔFV] = (1 − p̃_{c,i})·2 + p̃_{c,i}·(−30);  h_i ~ N(4, 4²), h_i ≥ 0 (everyday-normal optimism); δ_i is the agent\u2019s crash underweight.',
    heuristic: 'Naive agents under-weight the 10% crash branch after a long calm run, treating +2 as the norm and getting caught when the crash hits.',
  },
};

for (const a of ASSET_TYPES) a.agentTemplate = ASSET_AGENT_TEMPLATES[a.id] || null;

/* Return the canonical FV points plotted on Figure 1 — the
 * "determined" fundamental-value path FV_1..FV_T implied by the
 * asset's spec, with no stochastic draws. Used by the per-session
 * asset-pair selector to compute a Pearson correlation between the
 * pre- and post-replacement assets directly from the curve that
 * Figure 1 would display (rather than from any single realised
 * trajectory).
 *
 * Deterministic assets (linear declining, perpetual, linear growth,
 * cyclical) already encode the full path in `state.fv[1..T]` after
 * `asset.init(config)`, so nothing else is needed. Path-dependent
 * assets (random walk, jump/crash) only seed `state.fv[1] = 100` in
 * their init; their Figure 1 curve is the expected path:
 *   - randomWalk is a reflected martingale, so E[FV_t] = FV_1 for all t
 *     (floored at `state.floor`).
 *   - jumpCrash drifts by E[step] = (1 − p)·drift + p·crash per period,
 *     floored at `state.floor`.
 * Both cases are constructed in closed form here with no RNG, so the
 * correlation chip is stable across renders and reflects the curves
 * the user actually sees on Figure 1. */
function expectedAssetFvPath(asset, config) {
  if (!asset || !config || !(config.periods > 0)) return [];
  const T = config.periods;
  const state = asset.init(config);
  if (asset.id === 'randomWalk') {
    const floor = Number.isFinite(state.floor) ? state.floor : 0;
    for (let t = 2; t <= T; t++) {
      state.fv[t] = Math.max(floor, state.fv[t - 1]);
    }
  } else if (asset.id === 'jumpCrash') {
    const floor = Number.isFinite(state.floor) ? state.floor : 0;
    const p     = Number.isFinite(state.crashProb) ? state.crashProb : 0;
    const drift = Number.isFinite(state.drift) ? state.drift : 0;
    const crash = Number.isFinite(state.crash) ? state.crash : 0;
    const eStep = (1 - p) * drift + p * crash;
    for (let t = 2; t <= T; t++) {
      state.fv[t] = Math.max(floor, state.fv[t - 1] + eStep);
    }
  }
  const out = new Array(T);
  for (let t = 1; t <= T; t++) {
    const v = state.fv[t];
    out[t - 1] = Number.isFinite(v) ? v : ASSET_ANCHOR_FV;
  }
  return out;
}

/* Mulberry32 identical to engine.js — duplicated here to keep assets.js
 * free of engine dependencies; the sampled FV paths are a view-side
 * artefact and shouldn't couple the asset registry to the engine. */
function _assetSampleRng(seed) {
  let s = (seed >>> 0) || 1;
  return function rng() {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Deterministic (assetId, session, round) → 32-bit seed. Both the
 * engine and `_fvByRoundPeriod` derive their per-round seeds through
 * this helper so a path-dependent asset's simulated FV trajectory and
 * the chart overlay trace the same curve. Keep the mixing stable — any
 * change here silently breaks that equivalence. */
function assetFvPathSeed(assetId, session, round) {
  const id = assetId || 'x';
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  }
  const s = ((session | 0) + 1) >>> 0;
  const r = (round | 0) >>> 0;
  return ((h ^ Math.imul(s, 0x9E3779B1) ^ Math.imul(r, 0x85EBCA6B)) >>> 0) || 1;
}

/* Mutate an already-init'd assetState so state.fv[1..T] carries a
 * full sample realisation (rather than only fv[1] = 100 with the rest
 * zero). Only touches randomWalk and jumpCrash; deterministic assets
 * keep the closed-form fv[] that `init()` already populated. Called by
 * Market.setAsset / resetAssetForRound at every round boundary with a
 * deterministic per-round seed so drawDividend reads from the same
 * path that Figure 1 plots. No-op if `state` is null or `asset` is
 * missing. */
function preSampleAssetPath(asset, state, config, seed) {
  if (!asset || !state || !state.fv || !config) return;
  if (asset.id !== 'randomWalk' && asset.id !== 'jumpCrash') return;
  const path = sampleAssetFvPath(asset, config, seed);
  if (!path) return;
  const T = config.periods;
  for (let p = 1; p <= T + 1; p++) {
    if (Number.isFinite(path[p])) state.fv[p] = path[p];
  }
}

/* Return a length-(T+2) FV path starting at FV_1 = 100. Deterministic
 * assets are read from `asset.init(config)` directly. Path-dependent
 * assets (random walk, jump/crash) are sampled via a seeded RNG so
 * Figure 1 shows a believable wandering trajectory instead of the
 * degenerate (FV_1 = 100, FV_2..FV_T = 0) that you get from a raw init.
 * The seed is caller-provided so the chart can make each round's curve
 * distinct (round index salted in) while staying stable across renders. */
function sampleAssetFvPath(asset, config, seed) {
  if (!asset || !config || !(config.periods > 0)) return null;
  const T = config.periods;
  let state;
  try { state = asset.init(config); } catch (_) { return null; }
  if (asset.id === 'randomWalk') {
    const sigma = Number.isFinite(state.sigma) ? state.sigma : 5;
    const floor = Number.isFinite(state.floor) ? state.floor : 0;
    const rng   = _assetSampleRng(seed >>> 0);
    // Extend through fv[T+1] so drawDividend at period T reads a real
    // η-draw terminal (its formula is d_T = FV_T − FV_{T+1}/(1+r),
    // floored at 0); collapsing fv[T+1] to fv[T] would quietly make
    // the last period's dividend deterministic and break the signed
    // mispricing on Figure 2 relative to Figure 1.
    for (let t = 2; t <= T + 1; t++) {
      const eta = normalDraw(rng, 0, sigma);
      state.fv[t] = Math.max(floor, state.fv[t - 1] + eta);
    }
  } else if (asset.id === 'jumpCrash') {
    const drift = Number.isFinite(state.drift) ? state.drift : 0;
    const crash = Number.isFinite(state.crash) ? state.crash : 0;
    const p     = Number.isFinite(state.crashProb) ? state.crashProb : 0;
    const floor = Number.isFinite(state.floor) ? state.floor : 0;
    const rng   = _assetSampleRng(seed >>> 0);
    for (let t = 2; t <= T + 1; t++) {
      const step = rng() < p ? crash : drift;
      state.fv[t] = Math.max(floor, state.fv[t - 1] + step);
    }
  }
  const out = new Array(T + 2).fill(0);
  for (let p = 1; p <= T + 1; p++) {
    const v = state.fv[p];
    out[p] = Number.isFinite(v) ? v : 0;
  }
  return out;
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
  // FV_t = (2 + 0.3·t) / r   (v5 §5.13 — Gordon perpetuity on rising μ̂)
  linearGrowth: _assetMath(
    '<mrow>'
    + _mFv + '<mo>=</mo>'
    + '<mfrac>'
    + '<mrow><mo>(</mo><mn>2</mn><mo>+</mo><mn>0.3</mn><mi>t</mi><mo>)</mo></mrow>'
    + '<mi>r</mi>'
    + '</mfrac>'
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
