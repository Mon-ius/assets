'use strict';

/* =====================================================================
   utility.js — Universal CRRA utility over wealth.

   Every agent shares the same constant-relative-risk-aversion (CRRA)
   family, differing only in the per-agent coefficient ρ:

       U(w; ρ) = w^(1 − ρ) / (1 − ρ)

   The decision engine compares utilities across candidate trades for a
   single agent, so we can drop the ρ-dependent 1/(1−ρ) scalar and an
   additive constant without changing the argmax. We render in the
   normalized form

       U(w; ρ) = (w / w₀)^(1 − ρ)

   which (a) gives U(w₀) = 1 at the agent's initial wealth — so welfare
   is directly comparable across heterogeneous endowments — and
   (b) collapses cleanly to the three legacy shapes at canonical ρ:

       ρ = −1   U_L(w) = (w / w₀)²          strictly convex  (risk loving)
       ρ =  0   U_N(w) = w / w₀             linear           (risk neutral)
       ρ = +½   U_A(w) = √(w / w₀)          strictly concave (risk averse)

   The Risk preferences slider still thinks in three categories, but
   inside each category the sampler draws ρ uniformly from the
   category's sub-range — so 100 risk-averse agents each have their own
   curvature rather than sharing the exact √ curve. This yields the
   intra-category heterogeneity the paper's welfare plots reveal as
   noise around the category centroid.

   ρ ranges (sampled per agent in agents.js via the engine RNG):

       loving  ρ ∈ (−1,  0)      strictly convex     (open at both ends)
       neutral ρ  = 0            linear              (single-point)
       averse  ρ ∈ ( 0,  1)      strictly concave    (open at both ends)

   Wealth is mark-to-market (w = cash + inventory × lastPrice, with FV
   as the pre-first-trade fallback) and clamped at 0 so a briefly
   negative settlement cannot produce NaN through the concave branch.
   ===================================================================== */

const CRRA_RHO_RANGES = {
  loving:  { lo: -0.999, hi: -0.001, mid: -0.5 },
  neutral: { lo:  0.0,   hi:  0.0,   mid:  0.0 },
  averse:  { lo:  0.001, hi:  0.999, mid:  0.5 },
};

const Utility = {
  loving:  { label: 'Risk-loving',  symbol: '²', color: '#ff5e78', name: 'U_L' },
  neutral: { label: 'Risk-neutral', symbol: '=', color: '#b0b8c9', name: 'U_N' },
  averse:  { label: 'Risk-averse',  symbol: '√', color: '#4fa3ff', name: 'U_A' },
};

/**
 * sampleRho — draw a ρ for a given risk category from its sub-range
 * using the provided seeded RNG. Pass any RNG function returning values
 * in [0, 1); falls back to Math.random if none is supplied.
 */
function sampleRho(riskPref, rng) {
  const r = CRRA_RHO_RANGES[riskPref] || CRRA_RHO_RANGES.neutral;
  if (r.hi <= r.lo) return r.lo;
  const u = typeof rng === 'function' ? rng() : Math.random();
  return r.lo + u * (r.hi - r.lo);
}

/**
 * categoryOfRho — map a ρ back to its category bucket. Used by UI code
 * paths that only receive ρ (colour selection, label lookup) and by
 * the legacy fall-through in computeUtility when ρ is missing.
 */
function categoryOfRho(rho) {
  if (!Number.isFinite(rho)) return 'neutral';
  if (rho < 0)      return 'loving';
  if (rho > 0.0005) return 'averse';
  return 'neutral';
}

/**
 * computeCRRA — the single functional form used by every agent.
 * Clamps wealth at 0 and w₀ at 1 to avoid NaNs from pathological
 * states, and falls back to log utility at ρ = 1 where the power
 * form would degenerate to a constant.
 */
function computeCRRA(w, w0, rho) {
  const r = Math.max(0, w) / Math.max(1, w0);
  if (Math.abs(1 - rho) < 1e-9) return Math.log(Math.max(1e-12, r));
  return Math.pow(Math.max(0, r), 1 - rho);
}

/**
 * computeUtility — thin dispatcher kept for backwards compatibility
 * with callers that still pass a riskPref label. New call sites should
 * pass ρ directly. When both are supplied ρ wins; when only the label
 * is supplied we fall back to the category midpoint so legacy specs
 * without a sampled ρ still produce a sensible utility.
 */
function computeUtility(riskPref, wealth, initialWealth, rho) {
  let effectiveRho = rho;
  if (effectiveRho == null || !Number.isFinite(effectiveRho)) {
    const range = CRRA_RHO_RANGES[riskPref] || CRRA_RHO_RANGES.neutral;
    effectiveRho = range.mid;
  }
  return computeCRRA(wealth, initialWealth, effectiveRho);
}

function wealthOf(agent, price) {
  return agent.cash + agent.inventory * price;
}

function markPrice(market) {
  if (market && market.lastPrice != null) return market.lastPrice;
  return market ? market.fundamentalValue() : 0;
}

/* =====================================================================
   Experience mechanism — follows `different_asset_simulation_v3.html` §3.

   Each trader i carries an integer experience level k_i ∈ {0, 1, 2, …}
   (the number of prior rounds of a similar market the agent has played;
   in this simulator k_i ≡ agent.roundsPlayed). Three per-agent modelling
   parameters depend on k_i and shape how confidently that agent anchors
   to its own model vs. the crowd:

       α_i = min{1, α_0 + γ_α · k_i}          (fundamental weight —
                                               v3 §2; weight placed on
                                               the model-based valuation
                                               FṼ in the prior)
       σ_i = σ_0 · e^{−γ_σ · k_i}             (valuation noise)
       ω_i = 0.6 + 0.1 · min(3, k_i)          (self-vs-crowd blend)

   The anchors α_0, σ_0, ω_0 are the values for a completely
   inexperienced agent (k_i = 0) and also appear verbatim in the
   Parameters → Hidden Constants panel. γ_α, γ_σ are growth rates
   specified by v3; ω_i saturates at 0.9 once k_i ≥ 3. See
   experienceFactors() below for the single call site used by the UI
   and (eventually) by the belief-revision code. */

/* Experience anchors + growth rates as a mutable config object so the
 * Advanced Settings sliders (α_0, γ_α, σ_0, γ_σ) can live-edit what
 * `experienceFactors()` reads without threading a ctx argument through
 * the six call sites (agents.js, ui.js × 3, utility.js × 2). ω_0 and
 * the saturation horizon stay fixed — the UI exposes the four terms
 * that materially drive the v3 §3 experience curve. Main.js keeps this
 * object in lock-step with App.tunables on every rebuild. */
const ExperienceConfig = {
  alpha0:     0.40,  // novice fundamental weight on model-based valuation (v3 §2)
  gammaAlpha: 0.15,  // per-round growth of α_i
  sigma0:     15,    // anchor for valuation noise
  gammaSigma: 0.30,  // per-round decay rate of σ_i
  omega0:     0.60,  // novice self (non-peer) weight ω_i (v3 §3)
  omegaStep:  0.10,  // per-round increment of ω_i
  omegaKmax:  3,     // saturation horizon for ω_i
};

/**
 * experienceFactors — return the per-agent (α_i, σ_i, ω_i) triple
 * implied by an integer experience level k. Safe for any finite k ≥ 0;
 * non-finite or negative inputs are clamped to 0 so a fresh replacement
 * agent always reports the novice triple (α_0, σ_0, ω_0) from the
 * current ExperienceConfig.
 */
function experienceFactors(k) {
  const ki = Math.max(0, Number.isFinite(k) ? Math.floor(k) : 0);
  const c  = ExperienceConfig;
  return {
    k:     ki,
    alpha: Math.min(1, c.alpha0 + c.gammaAlpha * ki),
    sigma: c.sigma0 * Math.exp(-c.gammaSigma * ki),
    omega: c.omega0 + c.omegaStep * Math.min(c.omegaKmax, ki),
  };
}

/**
 * experienceEffective — apply the post-replacement experience-transfer
 * blend on top of experienceFactors(k). Shared by UI (`UI._blendExperience`)
 * and the agent belief pipeline (`UtilityAgent.updateBelief`) so the
 * displayed α_i/σ_i/ω_i on the card match the values that actually drove
 * the trade decision.
 *
 *   α_new = |corr|·α_trained + (1 − |corr|)·α_0
 *   σ_new = |corr|·σ_trained + (1 − |corr|)·σ_0
 *   ω_new = |corr|·ω_trained + (1 − |corr|)·ω_0
 *
 * `applyBlend` is the phase gate: pass true only when the engine has
 * passed the replacement-round boundary and the post-asset is live.
 * Before that, the agent is still trading on the pre-asset and its
 * trained experience applies at full strength.
 */
function experienceEffective(k, corrAbs, applyBlend) {
  const trained = experienceFactors(k);
  if (!applyBlend || !(trained.k > 0)) return trained;
  const raw = Number.isFinite(corrAbs) ? corrAbs : 0;
  const w   = Math.min(1, Math.max(0, raw));
  const novice = experienceFactors(0);
  return {
    k:      trained.k,
    alpha:  w * trained.alpha + (1 - w) * novice.alpha,
    sigma:  w * trained.sigma + (1 - w) * novice.sigma,
    omega:  w * trained.omega + (1 - w) * novice.omega,
    corr:   w,
    blended: true,
  };
}

/* =====================================================================
   Heuristic H_{i,t} — v3 §4 four-term decomposition:

       H_{i,t} = β_1·Anchor_{i,t} + β_2·Trend_{i,t}
               + β_3·DividendSignal_{i,t} + β_4·Narrative_{i,t}

   Default weights from §6.2 (tuned uniformly; asset-specific tweaks left
   to the registry). Per §6.3, Trend is omitted at t = 1 because there
   is no previous period to difference against.
   ===================================================================== */

const HEURISTIC_BETAS = {
  anchor:    0.50,
  trend:     0.20,
  dividend:  0.20,
  narrative: 0.10,
};

/** Standard-normal draw via Box–Muller over the seeded RNG. Returns
 *  σ · z so callers can scale by a per-agent σ_i in one step. */
function gaussianDraw(rng, sigma) {
  const s = Number.isFinite(sigma) ? Math.max(0, sigma) : 0;
  if (s === 0) return 0;
  let u = typeof rng === 'function' ? rng() : Math.random();
  if (u < 1e-12) u = 1e-12;
  const v = typeof rng === 'function' ? rng() : Math.random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return s * z;
}

/**
 * heuristicValue — evaluate H_{i,t} for one utility agent at the start
 * of the current period. All four terms are recomputed from the Market
 * state (priceHistory, dividendHistory, asset state) and the agent's
 * own empirical dividend window (same slice `updateBelief` uses for the
 * bounded-rationality FṼ estimate), so the function is pure and safe
 * to call every tick.
 *
 * Returns `{ H, anchor, trend, dividend, narrative }` — the per-term
 * breakdown is stashed on the agent's reasoning trace so a replay can
 * show why a given decision moved.
 */
function heuristicValue(agent, market, ctx) {
  const betas   = (ctx && ctx.heuristicBetas) || HEURISTIC_BETAS;
  const period  = market.period | 0;
  const T       = market.config.periods | 0;
  const kt      = Math.max(0, T - period + 1);            // remaining periods
  const r       = (market.config && market.config.discountRate) || 0.05;

  // Anchor — v3 §4.1 / v4 §5.*. The anchor is the agent's model-based
  // reference level at each period, which for stochastic assets is
  // NOT the live FV_t (oracle) but the public-rule-derived FṼ (v4
  // §5.28 first-version: constant 100 for random walk; §5.34: 100 −
  // 1.2·k_t for jump/crash; §5.22: discounted sinusoidal tail sum).
  const readModel = (p) => {
    if (market.assetType && typeof market.assetType.modelBasedFV === 'function') {
      return market.assetType.modelBasedFV(p, market.assetState, market.config, market);
    }
    if (market.assetType && typeof market.assetType.fundamentalValue === 'function') {
      return market.assetType.fundamentalValue(p, market.assetState);
    }
    return market.fundamentalValue(p);
  };
  const anchorInit = readModel(1);
  const anchor     = (period <= 1) ? anchorInit : readModel(period);

  // Trend — v3 §4.2. Use the last *trade* price of each of the previous
  // two periods. Missing trades fall through to 0 so a sparse book
  // doesn't spike the heuristic.
  let trend = 0;
  if (period >= 2) {
    const pPrev  = lastTradePriceForPeriod(market, period - 1);
    const pPrev2 = (period >= 3) ? lastTradePriceForPeriod(market, period - 2)
                                 : anchorInit;
    if (pPrev != null && pPrev2 != null) trend = pPrev - pPrev2;
  }

  // DividendSignal — v3 §4.3.
  //   t = 1: μ_public (asset's published expected dividend per period)
  //          scaled by the PV factor A_t = Σ_{j=1..kt} (1+r)^(−j).
  //   t ≥ 2: d̄_obs · A_t using the agent's empirical mean across the
  //          rounds it has actually observed (roundsPlayed window).
  const muPublic = (market.assetState && market.assetState.expectedDividend != null)
    ? market.assetState.expectedDividend
    : (market.config && market.config.dividendMean) || 0;
  let At = 0;
  for (let j = 1; j <= kt; j++) At += Math.pow(1 + r, -j);
  let dMean = muPublic;
  if (period >= 2) {
    const divHist   = market.dividendHistory || [];
    const firstSeen = market.round - (agent.roundsPlayed | 0);
    let sum = 0, n = 0;
    for (let i = 0; i < divHist.length; i++) {
      if (divHist[i].round >= firstSeen) { sum += divHist[i].value; n++; }
    }
    dMean = n > 0 ? sum / n : muPublic;
  }
  const dividendSignal = dMean * At;

  // Narrative — v3 §4.4. Asset-specific "story premium/discount". The
  // registry exposes this through `asset.narrativeShift(period, state)`
  // when an asset wants to inject one; otherwise we default to 0 so β_4
  // simply remains a reserved slot for future per-asset calibration.
  let narrative = 0;
  if (market.assetType && typeof market.assetType.narrativeShift === 'function') {
    narrative = market.assetType.narrativeShift(period, market.assetState) || 0;
  }

  // Assemble H. At t = 1 §6.3 drops the Trend term entirely — the
  // other three weights carry the full prior.
  const useTrend = period >= 2 ? betas.trend : 0;
  const H = betas.anchor * anchor
          + useTrend      * trend
          + betas.dividend * dividendSignal
          + betas.narrative * narrative;

  return {
    H,
    anchor,
    trend,
    dividend: dividendSignal,
    narrative,
    betas,
    At,
    dMean,
    muPublic,
  };
}

/** Last transaction price recorded inside a given round/period window,
 *  or null if no trade printed in that window. Cheap enough at current
 *  history sizes to scan linearly every tick. */
function lastTradePriceForPeriod(market, period) {
  const hist = market.priceHistory || [];
  for (let i = hist.length - 1; i >= 0; i--) {
    const h = hist[i];
    if (h.round === market.round && h.period === period && h.price != null) {
      return h.price;
    }
  }
  return null;
}
