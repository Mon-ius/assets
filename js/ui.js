'use strict';

const UI = {
  els:     {},
  charts:  {},
  canvases: {},

  _riskLabel: {
    loving:  'Risk-loving',
    neutral: 'Risk-neutral',
    averse:  'Risk-averse',
  },
  _typeLabel: {
    fundamentalist: 'Fundamentalist',
    trend:          'Trend follower',
    random:         'Random (ZI)',
    dlm:            'DLM trader',
    utility:        'Utility',
  },
  // Classic agent-type symbols. Utility agents no longer use a per-
  // category symbol map: the universal CRRA form means every utility
  // agent renders the same formula, distinguished only by its
  // per-agent ρᵢ coefficient (rendered directly on the card).
  _typeSym: {
    fundamentalist: 'inF',
    trend:          'inT',
    random:         'inR',
    dlm:            'inE',
    utility:        'inU',
  },

  // Minimal HTML escaper for injecting plain-text strings into
  // template literals rendered via innerHTML (LLM prompt display).
  _escHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  },

  /* ------------------------------------------------------------------
   * v5 Agent-model MathML builders
   *
   * Build the Step-1 FṼ, Step-2 H, Step-3 prior/posterior formulas for
   * the "Agent model" panel on the View Stats back face, using the
   * primitives exposed by mathml.js so every symbol stays consistent
   * with the rest of the UI. Each _*MathML() returns a single inline
   * <math>…</math> fragment ready to drop into innerHTML.
   * ------------------------------------------------------------------ */

  // Shared MathML fragments — rebuilt lazily so a missing window.Mml
  // (e.g. mathml.js not yet loaded) degrades to an empty string.
  _mmlFvTilde()  { const M = window.Mml; return M.sub(M.tilde(M.row(M.mi('F'), M.mi('V'))), M.row(M.mi('i'), M.mo(','), M.mi('t'))); },
  _mmlH()        { const M = window.Mml; return M.sub(M.mi('H'), M.row(M.mi('i'), M.mo(','), M.mi('t'))); },
  _mmlPrior()    { const M = window.Mml; return M.sub(M.mi('prior'), M.row(M.mi('i'), M.mo(','), M.mi('t'))); },
  _mmlVHat()     { const M = window.Mml; return M.sub(M.hat(M.mi('V')), M.row(M.mi('i'), M.mo(','), M.mi('t'))); },
  _mmlAlpha()    { const M = window.Mml; return M.sub(M.mi('α'), M.mi('i')); },
  _mmlOmega()    { const M = window.Mml; return M.sub(M.mi('ω'), M.mi('i')); },
  _mmlKt()       { const M = window.Mml; return M.sub(M.mi('k'), M.mi('t')); },
  _mmlTrend()    {
    const M = window.Mml;
    return M.row(
      M.subsup(M.mi('p'), M.row(M.mi('t'), M.mo('−'), M.mn('1')), M.row(M.mi('l'), M.mi('a'), M.mi('s'), M.mi('t'))),
      M.mo('−'),
      M.subsup(M.mi('p'), M.row(M.mi('t'), M.mo('−'), M.mn('2')), M.row(M.mi('l'), M.mi('a'), M.mi('s'), M.mi('t'))),
    );
  },
  _mmlDObs()     { const M = window.Mml; return M.subsup(M.bar(M.mi('d')), M.mi('t'), M.row(M.mi('o'), M.mi('b'), M.mi('s'))); },  // d̄_t^{obs}
  _mmlAt()       { const M = window.Mml; return M.sub(M.mi('A'), M.mi('t')); },
  _mmlMBar()     { const M = window.Mml; return M.sub(M.bar(M.mi('m')), M.mi('t')); },
  _mmlEdFv()     {
    const M = window.Mml;
    return M.row(
      M.sub(M.tilde(M.mi('E')), M.mi('i')),
      M.mo('['), M.mo('Δ'), M.mi('F'), M.mi('V'), M.mo(']'),
    );
  },

  // Step 1 — model-based fundamental value FṼ_{i,t}, per v5 §5.{4,10,16,22,28,34}.
  _fvMathML(assetId) {
    const M = window.Mml;
    if (!M) return '';
    const FV = UI._mmlFvTilde();
    const T  = M.mi('T'); const t = M.mi('t'); const r = M.mi('r');

    const kt = UI._mmlKt();
    switch (assetId) {
      case 'linearDeclining':
        // FṼ_{i,t} = 5·k_t  (undiscounted first-version)
        return M.wrap(M.row(FV, M.mo('='), M.mn('5'), M.mo('·'), kt));
      case 'constantPerpetual':
        // FṼ_{i,t} = 5 / 0.05 = 100
        return M.wrap(M.row(FV, M.mo('='), M.frac(M.mn('5'), M.mn('0.05')), M.mo('='), M.mn('100')));
      case 'linearGrowth':
        // FṼ_{i,t} = (2 + 0.3·t) / r
        return M.wrap(M.row(
          FV, M.mo('='),
          M.frac(M.row(M.mn('2'), M.mo('+'), M.mn('0.3'), M.mo('·'), t), r),
        ));
      case 'cyclicalSine': {
        // FṼ_{i,t} = (5 + 2·sin(2π(t−1)/10)) / r   (v6 §5.22 Gordon perpetuity)
        const num = M.row(
          M.mn('5'), M.mo('+'), M.mn('2'), M.mo('·'),
          M.mi('sin'), M.mo('('),
          M.frac(M.row(M.mn('2'), M.mi('π'), M.mo('('), t, M.mo('−'), M.mn('1'), M.mo(')')), M.mn('10')),
          M.mo(')'),
        );
        return M.wrap(M.row(
          FV, M.mo('='),
          M.frac(M.row(M.mo('('), num, M.mo(')')), r),
        ));
      }
      case 'randomWalk':
        // FṼ_{i,t} = 100
        return M.wrap(M.row(FV, M.mo('='), M.mn('100')));
      case 'jumpCrash':
        // FṼ_{i,t} = 100 − 1.2·k_t
        return M.wrap(M.row(FV, M.mo('='), M.mn('100'), M.mo('−'), M.mn('1.2'), M.mo('·'), kt));
      default:
        return M.wrap(FV);
    }
  },

  // Step 2 — heuristic H_{i,t} per v5 §5.{5,11,17,23,29,35}.
  _heuristicMathML(assetId) {
    const M = window.Mml;
    if (!M) return '';
    const b1 = M.sub(M.mi('β'), M.row(M.mn('1'), M.mi('i')));
    const b2 = M.sub(M.mi('β'), M.row(M.mn('2'), M.mi('i')));
    const b3 = M.sub(M.mi('β'), M.row(M.mn('3'), M.mi('i')));
    const b4 = M.sub(M.mi('β'), M.row(M.mn('4'), M.mi('i')));
    const H  = UI._mmlH();
    const T  = M.mi('T');
    const kt = UI._mmlKt();
    const trend = M.row(M.mo('('), UI._mmlTrend(), M.mo(')'));
    const dObs  = UI._mmlDObs();
    const At    = UI._mmlAt();
    const dObsAt = M.row(M.mo('('), dObs, M.mo('·'), At, M.mo(')'));

    const gI = M.sub(M.mi('g'), M.mi('i'));
    const cI = M.sub(M.mi('c'), M.mi('i'));
    const uI = M.sub(M.mi('u'), M.mi('i'));
    const hI = M.sub(M.mi('h'), M.mi('i'));
    const lambdaC = M.sub(M.mi('λ'), M.mi('c'));
    const maxTrendPos = M.row(M.mi('max'), M.mo('('), UI._mmlTrend(), M.mo(','), M.mn('0'), M.mo(')'));
    const signTrend   = M.row(M.mi('sign'), M.mo('('), UI._mmlTrend(), M.mo(')'));

    switch (assetId) {
      case 'linearDeclining':
        // H = β1·(5T) + β2·Δp + β3·(d̄·A_t)
        return M.wrap(M.row(
          H, M.mo('='),
          b1, M.mo('·'), M.mo('('), M.mn('5'), T, M.mo(')'),
          M.mo('+'), b2, M.mo('·'), trend,
          M.mo('+'), b3, M.mo('·'), dObsAt,
        ));
      case 'constantPerpetual':
        // H = β1·100 + β2·Δp + β3·(d̄/0.05)
        return M.wrap(M.row(
          H, M.mo('='),
          b1, M.mo('·'), M.mn('100'),
          M.mo('+'), b2, M.mo('·'), trend,
          M.mo('+'), b3, M.mo('·'), M.frac(dObs, M.mn('0.05')),
        ));
      case 'linearGrowth':
        // H = β1·FṼ + β2·Δp + β3·(d̄·A_t) + β4·(g_i + max(Δp, 0))
        return M.wrap(M.row(
          H, M.mo('='),
          b1, M.mo('·'), UI._mmlFvTilde(),
          M.mo('+'), b2, M.mo('·'), trend,
          M.mo('+'), b3, M.mo('·'), dObsAt,
          M.mo('+'), b4, M.mo('·'), M.mo('('), gI, M.mo('+'), maxTrendPos, M.mo(')'),
        ));
      case 'cyclicalSine':
        // H = β1·100 + β2·Δp + β3·(d̄·A_t) + β4·(c_i + λ_c·sign(Δp))
        return M.wrap(M.row(
          H, M.mo('='),
          b1, M.mo('·'), M.mn('100'),
          M.mo('+'), b2, M.mo('·'), trend,
          M.mo('+'), b3, M.mo('·'), dObsAt,
          M.mo('+'), b4, M.mo('·'), M.mo('('), cI, M.mo('+'), lambdaC, M.mo('·'), signTrend, M.mo(')'),
        ));
      case 'randomWalk':
        // H = β1·100 + β2·Δp + β4·u_i  (no DividendSignal term)
        return M.wrap(M.row(
          H, M.mo('='),
          b1, M.mo('·'), M.mn('100'),
          M.mo('+'), b2, M.mo('·'), trend,
          M.mo('+'), b4, M.mo('·'), uI,
        ));
      case 'jumpCrash': {
        // H = β1·100 + β2·Δp + β3·(100 + k_t·Ẽ_i[ΔFV]) + β4·(h_i + max(Δp, 0))
        const dsig = M.row(
          M.mo('('), M.mn('100'), M.mo('+'),
          kt, M.mo('·'), UI._mmlEdFv(),
          M.mo(')'),
        );
        return M.wrap(M.row(
          H, M.mo('='),
          b1, M.mo('·'), M.mn('100'),
          M.mo('+'), b2, M.mo('·'), trend,
          M.mo('+'), b3, M.mo('·'), dsig,
          M.mo('+'), b4, M.mo('·'), M.mo('('), hI, M.mo('+'), maxTrendPos, M.mo(')'),
        ));
      }
      default:
        return M.wrap(H);
    }
  },

  // Step 3 — prior = [ α_i·FṼ + (1 − α_i)·H ]  · (1 + bias_i)?  + ε_i?
  _priorMathML(tun) {
    const M = window.Mml;
    if (!M) return '';
    const alpha = UI._mmlAlpha();
    const bracket = M.row(
      M.mo('['),
      alpha, M.mo('·'), UI._mmlFvTilde(),
      M.mo('+'), M.mo('('), M.mn('1'), M.mo('−'), alpha, M.mo(')'), M.mo('·'), UI._mmlH(),
      M.mo(']'),
    );
    const parts = [UI._mmlPrior(), M.mo('='), bracket];
    if (tun && tun.applyBias) {
      parts.push(M.mo('·'), M.mo('('), M.mn('1'), M.mo('+'), M.sub(M.mi('bias'), M.mi('i')), M.mo(')'));
    }
    if (tun && tun.applyNoise) {
      parts.push(M.mo('+'), M.sub(M.mi('ε'), M.mi('i')));
    }
    return M.wrap(M.row(...parts));
  },

  // Step 3 — posterior = ω_i · prior + (1 − ω_i) · m̄_t
  _posteriorMathML() {
    const M = window.Mml;
    if (!M) return '';
    const omega = UI._mmlOmega();
    return M.wrap(M.row(
      UI._mmlVHat(), M.mo('='),
      omega, M.mo('·'), UI._mmlPrior(),
      M.mo('+'), M.mo('('), M.mn('1'), M.mo('−'), omega, M.mo(')'), M.mo('·'), UI._mmlMBar(),
    ));
  },

  /**
   * _blendExperience — apply the post-replacement experience-transfer
   * blend from the Hidden Constants spec:
   *
   *   α_new = |corr| · α_trained + (1 − |corr|) · α_0
   *   σ_new = |corr| · σ_trained + (1 − |corr|) · σ_0
   *   ω_new = |corr| · ω_trained + (1 − |corr|) · ω_0
   *
   * Returns the trained triple unchanged when the blend should not
   * apply — pre-run state, pre-replacement rounds, no asset swap, or
   * novice agents (k_i = 0, where trained already equals the anchors).
   * |corr| is read from App._sessionAssetCorr for the current session
   * and coerced into [0, 1] so a flat-path NaN (already fixed to 0 in
   * main.js) still yields a defined blend.
   */
  _blendExperience(trained, agent, v) {
    if (!trained) return trained;
    const App = window.App;
    const session = (v && v.session) || (App && App.currentSession) || 0;
    if (!App || !session) return trained;
    const round  = (v && v.round) || 1;
    const replR  = (App.replacementRound | 0) || 4;
    const applyBlend = round >= replR
                    && agent && (agent.roundsPlayed | 0) > 0;
    if (!applyBlend) return trained;
    const idx = Math.max(0, Math.min(9, session - 1));
    const preId  = App.sessionAssets && App.sessionAssets[idx];
    const postId = App.sessionAssetsPost && App.sessionAssetsPost[idx];
    if (!preId || !postId || preId === postId) return trained;
    const corr = (typeof App._sessionAssetCorr === 'function')
      ? App._sessionAssetCorr(session)
      : NaN;
    const corrAbs = Math.abs(Number.isFinite(corr) ? corr : 0);
    // Delegate to the shared helper so the card and the belief
    // pipeline (agents.js updateBelief) always agree on α/σ/ω.
    if (typeof experienceEffective === 'function') {
      return experienceEffective(trained.k | 0, corrAbs, true);
    }
    const clamped = Math.min(1, Math.max(0, corrAbs));
    const novice = (typeof experienceFactors === 'function')
      ? experienceFactors(0)
      : { alpha: 0.4, sigma: 15, omega: 0.6 };
    return {
      k:      trained.k,
      alpha:  clamped * trained.alpha + (1 - clamped) * novice.alpha,
      sigma:  clamped * trained.sigma + (1 - clamped) * novice.sigma,
      omega:  clamped * trained.omega + (1 - clamped) * novice.omega,
      corr:   clamped,
      blended: true,
    };
  },

  // Canvas-time theme cache. Populated by refreshTheme() which reads
  // CSS custom properties off :root via getComputedStyle. Every chart
  // renderer pulls colors from here so a theme switch flows through
  // the canvas layer identically to the DOM layer.
  theme: {
    fg0: '#1a1d23', fg2: '#6b7080', fg3: '#9aa0ad',
    bg1: '#ffffff', bg2: '#f4f5f7',
    accent: '#2563eb', amber: '#d97706', red: '#dc2626',
    green:  '#16a34a', purple: '#7c3aed', teal:   '#0d9488',
    frame:  '#c6cad1', grid:   'rgba(0,0,0,0.06)',
    stripe: 'rgba(0,0,0,0.025)', band: 'rgba(0,0,0,0.022)',
    palette: [],
  },

  refreshTheme() {
    const cs = getComputedStyle(document.documentElement);
    const read = k => (cs.getPropertyValue(k) || '').trim();
    const t = this.theme;
    t.fg0    = read('--fg-0')     || t.fg0;
    t.fg2    = read('--fg-2')     || t.fg2;
    t.fg3    = read('--fg-3')     || t.fg3;
    t.bg1    = read('--bg-1')     || t.bg1;
    t.bg2    = read('--bg-2')     || t.bg2;
    t.accent = read('--accent')   || t.accent;
    t.amber  = read('--amber')    || t.amber;
    t.red    = read('--red')      || t.red;
    t.green  = read('--green')    || t.green;
    t.purple = read('--purple')   || t.purple;
    t.teal   = read('--teal')     || t.teal;
    t.frame  = read('--chart-frame')  || t.frame;
    t.grid   = read('--chart-grid')   || t.grid;
    t.stripe = read('--chart-stripe') || t.stripe;
    t.band   = read('--chart-band')   || t.band;
    // Six-slot palette for multi-series charts, drawn from semantic
    // tokens so it shifts with the theme without breaking its meaning.
    t.palette = [t.accent, t.amber, t.green, t.red, t.purple, t.teal];
    if (typeof Viz !== 'undefined' && typeof Viz.setTheme === 'function') {
      Viz.setTheme({ frame: t.frame, grid: t.grid, label: t.fg3 });
    }
  },

  // Agent ids whose card is currently flipped to the back face.
  _flipped: new Set(),

  // Population threshold above which per-agent chart modes switch to
  // aggregated variants (fan chart, risk-group stacks, sparse axis
  // labels). 12 is the point at which per-line palettes and name-per-
  // row labels start overlapping on typical chart widths.
  FAN_THRESHOLD: 12,

  /**
   * Parse a CSS color token (rgb / rgba / #rrggbb) into {r,g,b,a}.
   * Returns null for formats we don't handle (unlikely — theme tokens
   * are always in one of the three). Used only by _fanColor to build
   * alpha variants of the theme's accent for fan bands.
   */
  _parseColor(s) {
    if (typeof s !== 'string') return null;
    const m = s.match(/^rgba?\(([^)]+)\)$/i);
    if (m) {
      const parts = m[1].split(',').map(v => v.trim());
      return {
        r: +parts[0], g: +parts[1], b: +parts[2],
        a: parts[3] != null ? +parts[3] : 1,
      };
    }
    if (/^#[0-9a-f]{6}$/i.test(s)) {
      return {
        r: parseInt(s.slice(1, 3), 16),
        g: parseInt(s.slice(3, 5), 16),
        b: parseInt(s.slice(5, 7), 16),
        a: 1,
      };
    }
    if (/^#[0-9a-f]{3}$/i.test(s)) {
      return {
        r: parseInt(s[1] + s[1], 16),
        g: parseInt(s[2] + s[2], 16),
        b: parseInt(s[3] + s[3], 16),
        a: 1,
      };
    }
    return null;
  },

  /** Lighten a theme color to the given alpha for use as a fan band fill. */
  _fanColor(base, alpha) {
    const c = this._parseColor(base);
    if (!c) return `rgba(120,140,180,${alpha})`;
    return `rgba(${c.r},${c.g},${c.b},${alpha})`;
  },

  /** Semantic color for a risk preference (drives aggregated ownership bands). */
  _riskColor(riskPref) {
    if (riskPref === 'loving')  return this.theme.red;
    if (riskPref === 'averse')  return this.theme.green;
    if (riskPref === 'neutral') return this.theme.teal;
    return this.theme.fg2;
  },

  /**
   * Action-class color for the timeline chart. Collapses the EU
   * candidate list back to the five presentation classes:
   *   cross-bid (aggressive buy) · passive bid
   *   cross-ask (aggressive sell) · passive ask · hold
   * Passive orders render at 45% alpha so they read as "softer" than
   * the book-crossing aggressive orders without needing extra hues.
   */
  _actionColor(decision) {
    const t = decision && decision.type;
    const p = !!(decision && decision.passive);
    if (t === 'bid') return p ? this._fanColor(this.theme.green, 0.45) : this.theme.green;
    if (t === 'ask') return p ? this._fanColor(this.theme.red,   0.45) : this.theme.red;
    return this.theme.fg3;
  },
  _actionClass(decision) {
    const t = decision && decision.type;
    const p = !!(decision && decision.passive);
    if (t === 'bid') return p ? 'bid-passive' : 'bid';
    if (t === 'ask') return p ? 'ask-passive' : 'ask';
    return 'hold';
  },
  // Canonical tokens from the EU action set
  //   α ∈ { hold, buy@A_t, sell@B_t, bid, ask }
  // where buy@A_t / sell@B_t are the book-crossing actions and bid /
  // ask are the passive resting quotes (agents.js → evaluate()).
  _actionLabel(decision) {
    const t = decision && decision.type;
    const p = !!(decision && decision.passive);
    if (t === 'bid') return p ? 'bid' : 'buy@A\u209c';
    if (t === 'ask') return p ? 'ask' : 'sell@B\u209c';
    return 'hold';
  },

  init() {
    this.refreshTheme();
    // Stat cells
    this.els.session = document.getElementById('stat-session');
    this.els.round   = document.getElementById('stat-round');
    this.els.period  = document.getElementById('stat-period');
    this.els.tick    = document.getElementById('stat-tick');
    this.els.price   = document.getElementById('stat-price');
    this.els.fv      = document.getElementById('stat-fv');
    this.els.bubble  = document.getElementById('stat-bubble');
    this.els.volume  = document.getElementById('stat-volume');

    this.els.bidsList   = document.getElementById('bids-list');
    this.els.asksList   = document.getElementById('asks-list');
    this.els.tradeFeed  = document.getElementById('trade-feed');
    this.els.agentsGrid = document.getElementById('agents-grid');

    this.els.traceBody    = document.getElementById('trace-body');
    this.els.replayPos    = document.getElementById('replay-position');
    this.els.replaySlider = document.getElementById('replay-slider');

    // Extended-mode elements (may be absent in legacy builds).
    this.els.metricsBody = document.getElementById('metrics-body');

    this.canvases = {
      price:     document.getElementById('chart-price'),
      bubble:    document.getElementById('chart-bubble'),
      volume:    document.getElementById('chart-volume'),
      timeline:  document.getElementById('chart-timeline'),
      heatmap:   document.getElementById('chart-heatmap'),
      valuation: document.getElementById('chart-valuation'),
      utility:   document.getElementById('chart-utility'),
      messages:  document.getElementById('chart-messages'),
      trust:     document.getElementById('chart-trust'),
      ownership: document.getElementById('chart-ownership'),
      pnl:       document.getElementById('chart-pnl'),
      subjv:     document.getElementById('chart-subjv'),
    };

    this.resizeCanvases();
    window.addEventListener('resize', () => {
      this.resizeCanvases();
      if (window.App) window.App.requestRender();
    });
  },

  resizeCanvases() {
    this.charts = {};
    for (const [k, c] of Object.entries(this.canvases)) {
      if (!c) continue;
      // Skip canvases that are currently hidden (display:none makes
      // getBoundingClientRect return 0×0). They'll be re-setup next
      // time extended mode toggles on.
      const rect = c.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      this.charts[k] = Viz.setupHiDPI(c);
    }
  },

  /** Deterministic color per utility agent id for multi-series charts. */
  agentColor(id) {
    const palette = this.theme.palette;
    return palette[(Number(id) - 1) % palette.length];
  },

  /**
   * Look up the fundamental value at local period `p` using the active
   * asset's FV path from the latest view. Falls back to the DLM linear
   * staircase for any period the view doesn't have a value for — so
   * chart FV overlays keep working even if the view predates the asset
   * system.
   */
  _fvAt(p, config) {
    const v = this._lastView;
    if (v && Array.isArray(v.fvByPeriod) && Number.isFinite(v.fvByPeriod[p])) {
      return v.fvByPeriod[p];
    }
    return config.dividendMean * (config.periods - p + 1);
  },

  /**
   * Per-round FV lookup — draws from the view's `fvByRoundPeriod`
   * matrix so rounds before the replacement boundary show the
   * pre-asset's FV curve and rounds after show the post-asset's,
   * even once the engine has swapped assets on the live market.
   * Falls back to `_fvAt(p, config)` when the matrix is missing.
   */
  _fvAtRound(round, p, config) {
    const v = this._lastView;
    const m = v && v.fvByRoundPeriod;
    const row = Array.isArray(m) ? m[round] : null;
    if (row && Number.isFinite(row[p])) return row[p];
    return this._fvAt(p, config);
  },

  /**
   * Peak fundamental value of the active asset — Math.max over
   * fvByPeriod, falling back to the legacy DLM peak (dividendMean × T)
   * when a view lacks the array. Used as an anchor for chart y-scales
   * so path-dependent assets don't get clipped.
   */
  _fvPeak(v, config) {
    let peak = -Infinity;
    if (v && Array.isArray(v.fvByRoundPeriod)) {
      for (const row of v.fvByRoundPeriod) {
        if (!Array.isArray(row)) continue;
        for (const x of row) if (Number.isFinite(x) && x > peak) peak = x;
      }
    }
    if (!Number.isFinite(peak) && v && Array.isArray(v.fvByPeriod)) {
      for (const x of v.fvByPeriod) {
        if (Number.isFinite(x) && x > peak) peak = x;
      }
    }
    if (Number.isFinite(peak) && peak > 0) return peak;
    return config.dividendMean * config.periods;
  },

  /* ============================================================
     Chart hover tooltip — shared infrastructure.
     Each chart registers its render frame (plot rect + axes +
     series) at the end of its draw; a single DOM tooltip reads
     from the registry on mousemove and finds the nearest point.
     ============================================================ */
  _chartHover: {},
  _hoverBound:  {},
  _hoverRects:  {},          // cached bounding rects per canvas (invalidated on scroll/resize)
  _hoverRectsBound: false,
  _tooltip:     null,

  _ensureTooltip() {
    if (this._tooltip) return this._tooltip;
    const tip = document.createElement('div');
    tip.id = 'chart-tooltip';
    tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);
    this._tooltip = tip;
    return tip;
  },

  _hideTooltip() {
    if (this._tooltip) this._tooltip.classList.remove('is-visible');
    this._lastTooltipKey = null;
    this._lastHoverKey   = null;
  },

  /** Cached canvas rect — `getBoundingClientRect()` forces layout, so we
      read it once per canvas and invalidate on scroll/resize rather than
      on every mousemove. Registration also clears the cache because a
      new render can shift the chart frame. */
  _canvasRect(canvasKey, canvas) {
    let r = this._hoverRects[canvasKey];
    if (!r) {
      r = canvas.getBoundingClientRect();
      this._hoverRects[canvasKey] = r;
    }
    return r;
  },

  _bindHoverRectInvalidators() {
    if (this._hoverRectsBound) return;
    this._hoverRectsBound = true;
    const clear = () => { this._hoverRects = {}; };
    window.addEventListener('scroll',  clear, { passive: true, capture: true });
    window.addEventListener('resize',  clear, { passive: true });
  },

  /** Nearest-x search on points sorted ascending by `.x`. Falls back to a
      linear scan if a gap turns up a non-monotonic entry, so this is safe
      to use on arrays produced by bucketByX / priceHistory (both sorted). */
  _nearestByX(points, xVal) {
    const n = points.length;
    if (!n) return -1;
    let lo = 0, hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (points[mid].x < xVal) lo = mid + 1;
      else                      hi = mid;
    }
    // `lo` is the first index with x >= xVal. Check neighbour on the left.
    const a = points[lo];
    const b = lo > 0 ? points[lo - 1] : null;
    if (!b) return lo;
    return (Math.abs(a.x - xVal) < Math.abs(b.x - xVal)) ? lo : lo - 1;
  },

  /**
   * Save a chart's per-frame hover info and wire mousemove /
   * mouseleave listeners on first registration. Subsequent frames
   * just overwrite the info; listeners stay attached.
   *
   * info = {
   *   mode:    'series' | 'cell' | 'row',
   *   rect:    plotRect (CSS pixels),
   *   xMin, xMax, yMin, yMax,
   *   xLabel,  xFmt,
   *   // series mode:
   *   series:  [{ name, color, points: [{x, y}], yFmt, symbol }],
   *   // cell mode:
   *   cells:   { cols, rows, cellW, cellH, lookup(col, row) => { label, color, value } },
   *   // row mode:
   *   rows:    { ids, rowH, lookup(rowIdx, xVal) => { label, items[] } | null },
   * }
   */
  _registerHover(canvasKey, info) {
    this._chartHover[canvasKey] = info;
    if (this._hoverBound[canvasKey]) return;
    // First registration — seed the rect cache lazily; scroll/resize will
    // invalidate, and a re-render leaves the canvas position unchanged.
    this._hoverRects[canvasKey] = null;
    const canvas = this.canvases[canvasKey];
    if (!canvas) return;
    this._bindHoverRectInvalidators();
    canvas.addEventListener('mousemove', e => this._onChartHover(canvasKey, e), { passive: true });
    canvas.addEventListener('mouseleave', () => {
      this._pendingHover = null;
      this._hideTooltip();
    }, { passive: true });
    this._hoverBound[canvasKey] = true;
  },

  /**
   * Public entry point — rAF-coalesces mousemove events so high-rate
   * pointer streams don't rebuild the tooltip 120× per second. The
   * latest pointer position wins; intermediate positions are dropped.
   */
  _onChartHover(canvasKey, e) {
    this._pendingHover = { canvasKey, clientX: e.clientX, clientY: e.clientY };
    if (this._hoverRaf) return;
    this._hoverRaf = requestAnimationFrame(() => {
      this._hoverRaf = null;
      const p = this._pendingHover;
      if (p) this._processHover(p.canvasKey, p.clientX, p.clientY);
    });
  },

  _processHover(canvasKey, clientX, clientY) {
    const info = this._chartHover[canvasKey];
    const canvas = this.canvases[canvasKey];
    if (!info || !canvas) return this._hideTooltip();
    const cr   = this._canvasRect(canvasKey, canvas);
    const xPx  = clientX - cr.left;
    const yPx  = clientY - cr.top;
    const rect = info.rect;
    if (xPx < rect.x || xPx > rect.x + rect.w ||
        yPx < rect.y || yPx > rect.y + rect.h) return this._hideTooltip();

    // Identity short-circuit: if this pointer lands in the same logical
    // bucket as the last hover on this canvas, skip the whole content
    // rebuild (including row allocation) and just reposition the tooltip.
    // The key is a tiny string keyed on canvas + mode-specific integer
    // indices — cheap to build, cheap to compare.
    let hoverKey = canvasKey + '|' + info.mode + '|';
    const xRange = info.xMax - info.xMin;
    const xVal   = info.xMin + ((xPx - rect.x) / rect.w) * xRange;

    if (info.mode === 'cell' && info.cells) {
      const { cols, rows: nRows, cellW, cellH } = info.cells;
      const col = Math.min(cols - 1,  Math.max(0, Math.floor((xPx - rect.x) / cellW)));
      const row = Math.min(nRows - 1, Math.floor((yPx - rect.y) / cellH));
      hoverKey += col + ',' + row;
    } else if (info.mode === 'row' && info.rows) {
      const rowIdx = Math.floor((yPx - rect.y) / info.rows.rowH);
      // Bucket xVal by 1/2-pixel so adjacent fractional pointer positions
      // collapse to the same key on dense x ranges.
      const pxBucket = Math.floor(((xPx - rect.x) / rect.w) * (rect.w * 2));
      hoverKey += rowIdx + ',' + pxBucket;
    } else if (info.mode === 'multi') {
      const buckets = info.buckets || [];
      const idx = this._nearestByX(buckets, xVal);
      hoverKey += 'b' + idx;
    } else {
      // series mode — key on the nearest-point index of every series.
      const series = info.series || [];
      for (let i = 0; i < series.length; i++) {
        const pts = series[i].points;
        if (!pts || !pts.length) { hoverKey += '-1,'; continue; }
        hoverKey += this._nearestByX(pts, xVal) + ',';
      }
    }

    const tip = this._ensureTooltip();
    if (this._lastHoverKey === hoverKey && this._lastTooltipKey) {
      // Same nearest point(s) — tooltip content is unchanged, just move it.
      tip.classList.add('is-visible');
      this._positionTooltip(tip, clientX, clientY);
      return;
    }
    this._lastHoverKey = hoverKey;

    let header = '';
    let rows   = [];
    if (info.mode === 'cell' && info.cells) {
      const { cols, rows: nRows, cellW, cellH, lookup } = info.cells;
      const col = Math.min(cols - 1,  Math.max(0, Math.floor((xPx - rect.x) / cellW)));
      const row = Math.min(nRows - 1, Math.floor((yPx - rect.y) / cellH));
      const hit = lookup(col, row);
      if (!hit) return this._hideTooltip();
      header = hit.header || '';
      rows   = hit.rows   || [];
    } else if (info.mode === 'row' && info.rows) {
      const { rowH, lookup } = info.rows;
      const rowIdx = Math.floor((yPx - rect.y) / rowH);
      const hit = lookup(rowIdx, xVal);
      if (!hit) return this._hideTooltip();
      header = hit.header || '';
      rows   = hit.rows   || [];
    } else if (info.mode === 'multi') {
      const buckets = info.buckets || [];
      const idx = this._nearestByX(buckets, xVal);
      const best = idx >= 0 ? buckets[idx] : null;
      if (!best || !best.ys || !best.ys.length) return this._hideTooltip();
      // Lazy-sort the bucket once and stash the sorted copy on the bucket
      // itself — buckets are freshly built each render, so the memo lasts
      // exactly as long as it should.
      let ys = best._ysSorted;
      if (!ys) {
        ys = best.ys.slice().sort((a, z) => a - z);
        best._ysSorted = ys;
      }
      const q = k => {
        const pos = (ys.length - 1) * k;
        const lo  = Math.floor(pos), hi = Math.ceil(pos);
        if (lo === hi) return ys[lo];
        return ys[lo] + (ys[hi] - ys[lo]) * (pos - lo);
      };
      const yFmt = info.ysFmt || (y => y.toFixed(2));
      const col  = info.color || this.theme.accent;
      for (const s of info.baseSeries || []) {
        if (!s.points || !s.points.length) continue;
        const j = this._nearestByX(s.points, xVal);
        const b2 = j >= 0 ? s.points[j] : null;
        if (b2 && b2.y != null && !Number.isNaN(b2.y)) {
          const v2 = s.yFmt ? s.yFmt(b2.y) : b2.y.toFixed(2);
          rows.push({ name: s.name, color: s.color, value: v2 });
        }
      }
      rows.push({ name: 'P90',    color: col, value: yFmt(q(0.90)) });
      rows.push({ name: 'P75',    color: col, value: yFmt(q(0.75)) });
      rows.push({ name: 'median', color: col, value: yFmt(q(0.50)) });
      rows.push({ name: 'P25',    color: col, value: yFmt(q(0.25)) });
      rows.push({ name: 'P10',    color: col, value: yFmt(q(0.10)) });
      rows.push({ name: 'N',      color: col, value: String(ys.length) });
      const xTxt = info.xFmt ? info.xFmt(best.x) : String(best.x);
      header = (info.xLabel ? info.xLabel + ': ' : '') + xTxt;
    } else {
      // series mode — nearest x across all series via binary search.
      let headerX = null;
      for (const s of info.series || []) {
        if (!s.points || !s.points.length) continue;
        const j = this._nearestByX(s.points, xVal);
        const best = j >= 0 ? s.points[j] : null;
        if (!best || best.y == null || Number.isNaN(best.y)) continue;
        if (headerX == null) headerX = best.x;
        const yTxt = s.yFmt ? s.yFmt(best.y)
                   : (typeof best.y === 'number' ? best.y.toFixed(2) : String(best.y));
        rows.push({ name: s.name, color: s.color, value: yTxt, symbol: s.symbol || '●' });
      }
      if (!rows.length) return this._hideTooltip();
      const xTxt = info.xFmt ? info.xFmt(headerX) : String(headerX);
      header = (info.xLabel ? info.xLabel + ': ' : '') + xTxt;
    }

    // Content cache key — collapses distinct nearest-point indices that
    // nevertheless render to the same text (rare, but free to check).
    const cacheKey = canvasKey + '|' + header + '|' +
      rows.map(r => r.color + ':' + r.name + ':' + r.value).join(';');
    if (this._lastTooltipKey !== cacheKey) {
      this._lastTooltipKey = cacheKey;
      const hdr = header ? `<div class="ch-tt-hdr">${header}</div>` : '';
      const body = rows.map(r => {
        const dot = `<span class="ch-tt-dot" style="background:${r.color}"></span>`;
        return `<div class="ch-tt-row">${dot}<span class="ch-tt-lbl">${r.name}</span><span class="ch-tt-val">${r.value}</span></div>`;
      }).join('');
      tip.innerHTML = hdr + body;
      // Only invalidate the cached width/height when the tooltip *shape*
      // changes (row count + header presence). Text edits inside a fixed
      // shape leave the box roughly the same size, so re-measuring on
      // every cell-hop was forcing a synchronous layout at 60 Hz while
      // scrubbing dense matrices (Figure 10's 100×100 trust grid has
      // ~3 px cells, so every pixel of cursor travel triggered a
      // reflow). CSS clamps width to [120, 280] px anyway.
      const shapeKey = canvasKey + '|' + rows.length + '|' + (header ? 1 : 0);
      if (this._lastTooltipShape !== shapeKey) {
        this._lastTooltipShape = shapeKey;
        this._lastTooltipDims  = null;
      }
    }
    tip.classList.add('is-visible');

    this._positionTooltip(tip, clientX, clientY);
  },

  /** Position the tooltip near the cursor, flipping sides when clipped by
      the viewport. Cached dims avoid offsetWidth/offsetHeight reads (each
      one forces a synchronous layout). */
  _positionTooltip(tip, clientX, clientY) {
    if (!this._lastTooltipDims) {
      this._lastTooltipDims = { w: tip.offsetWidth || 160, h: tip.offsetHeight || 40 };
    }
    const tw = this._lastTooltipDims.w;
    const th = this._lastTooltipDims.h;
    let left = clientX + 14;
    let top  = clientY + 14;
    if (left + tw > window.innerWidth  - 4) left = clientX - 14 - tw;
    if (top  + th > window.innerHeight - 4) top  = clientY - 14 - th;
    tip.style.left = Math.max(4, left) + 'px';
    tip.style.top  = Math.max(4, top)  + 'px';
  },

  /**
   * Swap Figure 1's FV formula to match the active asset. The markup in
   * index.html carries `data-sym="fvDef"` as a build-time default so the
   * DLM staircase renders before the first tick; once the engine picks
   * an asset, this override replaces it with per-asset MathML from the
   * asset registry. Short-circuits when the asset hasn't changed so we
   * don't churn the DOM on every frame.
   */
  _renderFvFormula(v) {
    const target = document.getElementById('fig1-fv-formula');
    if (!target) return;
    const id = v && v.assetId;
    if (!id || typeof getAssetType !== 'function') return;
    if (this._lastAssetFormulaId === id) return;
    const asset = getAssetType(id);
    const mathml = asset && asset.fvFormula;
    if (!mathml) return;
    target.innerHTML = mathml;
    this._lastAssetFormulaId = id;
  },

  /* -------- Top-level render dispatcher -------- */

  render(view, config) {
    // Cache for ad-hoc consumers (stats view re-renders on demand
    // outside the per-frame loop).
    this._lastView   = view;
    this._lastConfig = config;
    this._renderFvFormula(view);
    this.renderStats(view, config);
    this.renderBook(view);
    this.renderAgents(view, config);
    if (this._statsViewAgentId != null) this._renderAgentStatsView();
    this.renderFeed(view);
    this.renderPriceChart(view, config);
    this.renderBubbleChart(view, config);
    this.renderVolumeChart(view, config);
    this.renderHeatmapChart(view, config);
    this.renderTimelineChart(view, config);
    // Extended panels — no-ops when their canvases are absent/hidden.
    this.renderValuationChart(view, config);
    this.renderUtilityChart(view, config);
    this.renderMessagesChart(view, config);
    this.renderTrustChart(view, config);
    this.renderOwnershipChart(view, config);
    this.renderPnlChart(view, config);
    this.renderSubjvChart(view, config);
    this.renderMetrics(view, config);
    this.renderTraces(view);
    // 10-session batch results table. Per-round data labeled
    // R{r}_S{s} across all sessions. No-op when there are no
    // results yet.
    this.renderBatchResults();
  },

  /**
   * Render the 10-session batch results into #batch-results. Reads
   * per-round data from App.batchResults (populated by start()'s
   * onEnd callback). Each row is labeled R{r}_S{s} to identify the
   * round and session. After the table, shows per-treatment aggregates.
   */
  renderBatchResults() {
    const host = document.getElementById('batch-results');
    if (!host) return;
    const results = window.App && window.App.batchResults;
    if (!results || !results.length) {
      host.innerHTML = `
        <div class="batch-agg"><div class="batch-agg-row"><span class="treat">—</span>
          <strong>&mu;&nbsp;dev</strong> — &middot;
          <strong>&mu;&nbsp;turn</strong> — &middot;
          <strong>trades</strong> — &middot;
          <strong>&mu;&nbsp;payoff</strong> —
        </div></div>
        <table class="batch-table">
          <thead>
            <tr><th>Label</th><th>Tx</th><th>S</th><th>R</th><th>dev ¢</th><th>turn</th><th>trades</th><th>vol</th><th>payoff</th></tr>
          </thead>
          <tbody>
            <tr><td class="batch-label">—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>
          </tbody>
        </table>`;
      return;
    }

    // Build per-row HTML — one row per round per session.
    const rowsHtml = results.map(r => `<tr>
      <td class="batch-label">${r.label}</td>
      <td>${r.treatment}</td>
      <td>${r.session}</td>
      <td>${r.round}</td>
      <td>${r.meanDev.toFixed(1)}</td>
      <td>${r.turnover.toFixed(2)}</td>
      <td>${r.trades}</td>
      <td>${r.volume}</td>
      <td>${r.payoff}¢</td>
    </tr>`).join('');

    // Compute per-treatment aggregates across all rounds.
    const byTreatment = {};
    for (const r of results) {
      if (!byTreatment[r.treatment]) byTreatment[r.treatment] = [];
      byTreatment[r.treatment].push(r);
    }
    const aggHtml = Object.entries(byTreatment).map(([tx, rows]) => {
      const n       = rows.length;
      const avgDev  = rows.reduce((s, r) => s + r.meanDev, 0) / n;
      const avgTurn = rows.reduce((s, r) => s + r.turnover, 0) / n;
      const avgPay  = rows.reduce((s, r) => s + r.payoff, 0) / n;
      const totTr   = rows.reduce((s, r) => s + r.trades, 0);
      return `<div class="batch-agg-row"><span class="treat">${tx}</span>
        <strong>&mu;&nbsp;dev</strong> ${avgDev.toFixed(1)}¢ &middot;
        <strong>&mu;&nbsp;turn</strong> ${avgTurn.toFixed(2)} &middot;
        <strong>trades</strong> ${totTr} &middot;
        <strong>&mu;&nbsp;payoff</strong> ${avgPay.toFixed(0)}¢
      </div>`;
    }).join('');

    host.innerHTML = `
      <div class="batch-agg">${aggHtml}</div>
      <table class="batch-table">
        <thead>
          <tr><th>Label</th><th>Tx</th><th>S</th><th>R</th><th>dev ¢</th><th>turn</th><th>trades</th><th>vol</th><th>payoff</th></tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>`;
  },

  /* -------- Stats row -------- */

  renderStats(v, config) {
    const rounds = config.roundsPerSession || 1;
    const round  = v.round || 1;
    if (this.els.session) {
      const s = v.session || 0;
      this.els.session.textContent = s > 0 ? `${s} / 10` : '— / 10';
    }
    if (this.els.round) this.els.round.textContent = `${round} / ${rounds}`;
    this.els.period.textContent = `${v.period} / ${config.periods}`;
    this.els.tick.textContent   = v.tick;
    this.els.price.textContent  = v.lastPrice == null ? '—' : v.lastPrice.toFixed(2);
    this.els.fv.textContent     = v.fv.toFixed(2);
    this.els.bubble.textContent = v.lastPrice == null
      ? '—'
      : Math.abs(v.lastPrice - v.fv).toFixed(2);
    // Volume readout tracks the current round's period, indexed into
    // the session-wide array via the global period index.
    const g = (round - 1) * config.periods + v.period;
    this.els.volume.textContent = v.volumeByPeriod[g] || 0;
  },

  /* -------- Order book -------- */

  /**
   * Order book renders as two side-by-side <ul> lists rather than
   * tables so the panel can stretch vertically to match the sibling
   * .chart-price figure. Each list's row count is derived from its
   * own measured clientHeight divided by the row height (22px grid
   * cell + border), with a 6-row floor and a 14-row fallback on the
   * very first paint before layout has happened. This mirrors the
   * dynamic-slice approach used in renderFeed.
   */
  renderBook(v) {
    const rowH = 22;
    const drawSide = (list, orders) => {
      const avail = list.clientHeight || (rowH * 14);
      const rows  = Math.max(6, Math.floor(avail / rowH));
      const slice = orders.slice(0, rows);
      if (!slice.length) { list.innerHTML = '<li class="empty">empty</li>'; return; }
      list.innerHTML = slice.map(o => {
        const name = v.agents[o.agentId]?.name || ('A' + o.agentId);
        return `<li>`
          + `<span class="price">${o.price.toFixed(2)}</span>`
          + `<span class="qty">${o.remaining}</span>`
          + `<span class="agent">${name}</span>`
          + `</li>`;
      }).join('');
    };
    drawSide(this.els.bidsList, v.bids);
    drawSide(this.els.asksList, v.asks);
  },

  /* -------- Agent cards -------- */

  renderAgents(v, config) {
    const initialFV = this._fvAt(1, config);
    // Pre-run: live view, tick still at 0. Only then do we render the
    // editable endowment inputs — once the engine has ticked past 0,
    // the numbers reflect live trading state and must not be edited.
    const editable = !v.isReplay && v.tick === 0;
    const panel = document.querySelector('.panel-agents');
    if (panel) panel.classList.toggle('preview', editable);
    this._toggleAgentStageLabel(editable);

    const html = Object.values(v.agents).map(a => {
      const lastDecision = { type: a.lastAction || 'hold', passive: !!a.lastPassive };
      const actionClass  = this._actionClass(lastDecision);
      const actionLabel  = this._actionLabel(lastDecision);
      const isUtil = a.riskPref != null;
      const wealth = a.cash + a.inventory * (v.lastPrice != null ? v.lastPrice : v.fv);
      const init   = a.initialWealth != null ? a.initialWealth : (1000 + 3 * initialFV);
      const pnl    = wealth - init;
      const pnlStr = (pnl >= 0 ? '+' : '') + pnl.toFixed(0);
      const pnlColor = pnl >= 0 ? 'var(--volume)' : 'var(--ask)';
      const borderStyle = isUtil ? ` style="border-left-color:${this.agentColor(a.id)}"` : '';
      // Subtitle is one of the three risk preferences for utility
      // agents, or a human-readable role for classic agents. The
      // strategy-cube code (U3, F1, …) is intentionally dropped here
      // because the #N prefix on displayName already carries the slot
      // number, and the full risk-mode label is easier to scan than
      // the cube notation.
      const subtitle = isUtil
        ? (UI._riskLabel[a.riskPref] || a.riskPref)
        : (UI._typeLabel[a.type] || a.type);
      // Non-utility agents keep their class-membership symbol (i ∈ F, …).
      // Utility agents now display the agent's CRRA coefficient ρ_i
      // directly in the subtitle so the per-agent variety inside each
      // category is visible at a glance. The MathML symbol is rhoI and
      // the numeric suffix is the sampled ρ clamped to 2 decimals.
      let subtitleSym = '';
      if (isUtil) {
        const sym = window.Sym || {};
        const rhoVal = (a.rho != null && Number.isFinite(a.rho))
          ? a.rho.toFixed(2)
          : '—';
        subtitleSym = `<span class="sym">${sym.rhoI || ''}</span>\u00a0=\u00a0${rhoVal}`;
      } else {
        const key = UI._typeSym[a.type];
        subtitleSym = (key && window.Sym && window.Sym[key])
          ? `<span class="sym">${window.Sym[key]}</span>`
          : '';
      }
      const sym = window.Sym || {};
      const displayName = a.name || ('A' + a.id);
      // Experience and replacement badges — shown for every agent type
      // since all agents participate in the 4-round session and the
      // round-4 replacement step.
      const rp = a.roundsPlayed | 0;
      const expBadge = rp === 0
        ? '<span class="dlm-badge dlm-badge-novice">inexperienced</span>'
        : `<span class="dlm-badge dlm-badge-vet">experienced · ${rp}R</span>`;
      const endowBadge = a.endowmentType
        ? `<span class="dlm-badge dlm-badge-endow">type&nbsp;${a.endowmentType}</span>`
        : '';
      const freshBadge = a.replacementFresh
        ? '<span class="dlm-badge dlm-badge-fresh">R4 replacement</span>'
        : '';
      // Bounded-Rationality status chip — shown on utility agents whenever
      // Plan II/III is active, so the user can see at a glance whether the
      // LLM is trading with the Cognitive Constraints addendum (red, ON)
      // or the unconstrained prompt (grey, OFF). The flag flows from
      // App.tunables → engine snapshot → view; plan routes the same way.
      const isLLMPlan = isUtil && (v.plan === 'II' || v.plan === 'III');
      const brOn      = !!(v.tunables && v.tunables.applyBoundedRationality);
      const brBadge   = isLLMPlan
        ? `<span class="dlm-badge dlm-badge-br dlm-badge-br-${brOn ? 'on' : 'off'}" title="Bounded Rationality toggle in AI endpoint panel">Bounded Rationality · ${brOn ? 'ON' : 'OFF'}</span>`
        : '';
      const brRow     = brBadge ? `<div class="dlm-badges dlm-badges-br">${brBadge}</div>` : '';
      const badgeRow  = `<div class="dlm-badges">${endowBadge}${expBadge}${freshBadge}</div>${brRow}`;
      // Live-updating numeric values plus the agent's exact welfare
      // functional. Every utility agent now evaluates the same
      // universal CRRA form; what differs is the per-agent ρ drawn
      // from its risk category (js/utility.js sampleRho). The card
      // renders the normalized RHS (w/w₀)^(1−ρ_i) so the subscript
      // matches the rho badge in the subtitle.
      const formulaSym = (window.Sym && window.Sym.uCRRANormI) ? window.Sym.uCRRANormI : '';
      // Experience-dependent modelling parameters from v3 §3 — computed
      // from k_i ≡ agent.roundsPlayed every render so the card keeps up
      // when the engine increments the counter at a round boundary. The
      // inexperienced anchors (α_0, σ_0, ω_0) are documented in the
      // Parameters → Hidden Constants panel.
      //
      // Experience-transfer blend (post-replacement phase only): when
      // the pre and post assets differ and the session has advanced
      // past the replacement round, experienced traders only retain a
      // |corr| fraction of their trained α/σ/ω and are pulled back
      // toward the novice anchors by (1 − |corr|). At |corr| = 1 the
      // asset essentially didn't change so training transfers fully;
      // at |corr| = 0 the post-asset dynamics are uncorrelated with
      // what the trader learned, so they effectively re-enter at k = 0.
      const trained = (typeof experienceFactors === 'function')
        ? experienceFactors(rp)
        : { k: rp, alpha: 0.4, sigma: 15, omega: 0.6 };
      const exp = UI._blendExperience(trained, a, v);
      // Experience-derived modelling parameters (α_i, σ_i, ω_i) drive
      // only Plan I's updateBelief() pipeline. The LLM never sees these
      // numbers — under Plan II/III experience is conveyed to the
      // model as the agent's lived per-round price+payoff history
      // (ai.js buildHistoryBlock), not as a formula. Drop the row.
      const expRows = isLLMPlan ? '' : `
          <span class="metric">Fundamental weight <span class="sym">${sym.alphaI || ''}</span></span> <span class="metric-val">${exp.alpha.toFixed(2)}</span>
          <span class="metric">Valuation noise <span class="sym">${sym.sigmaI || ''}</span></span> <span class="metric-val">${exp.sigma.toFixed(1)}</span>
          <span class="metric">Self (non-peer) weight <span class="sym">${sym.omegaI || ''}</span></span> <span class="metric-val">${exp.omega.toFixed(2)}</span>`;
      // Subj V / Report V are Plan I artefacts (algorithmic prior +
      // peer-message broadcast). Under Plans II and III the LLM is the
      // sole decision channel, agents.js nulls both fields, and the
      // numbers would only mislead — so the rows drop out entirely.
      const subjReportRows = (isUtil && !isLLMPlan) ? `
          <span class="metric">Subj V <span class="sym">${sym.subjV || ''}</span></span> <span class="metric-val">${a.subjectiveValuation != null ? a.subjectiveValuation.toFixed(1) : '—'}</span>
          <span class="metric">Report <span class="sym">${sym.reportV || ''}</span></span> <span class="metric-val">${a.reportedValuation != null ? a.reportedValuation.toFixed(1) : '—'}</span>` : '';
      const extraRows = isUtil ? `${subjReportRows}
          <span class="metric metric-util">Utility <span class="sym">${sym.uOfW || ''}</span></span> <span class="metric-val metric-util-val"><span class="sym">${formulaSym}</span></span>${expRows}` : expRows;

      // Back-face content — LLM prompt for utility agents, rule
      // explanation for algorithmic agents.
      // isLLMPlan is defined above (Plan II/III + utility agent).
      const hasLLM = isUtil && a.lastLLMPrompt;
      const ruleDesc = {
        fundamentalist: 'Fundamentalist agents make decisions through coded rules — FV-anchored spreads that cross the book when mispricing exceeds ±2%, otherwise post passive quotes around the fundamental value.',
        trend:          'Trend Follower agents make decisions through coded rules — momentum chasing that bids aggressively on positive slopes and flees on negative slopes, with no horizon model.',
        random:         'Random (Zero-Intelligence) agents draw uniform prices bounded by the fundamental value. They provide a price-discovery floor/ceiling pinned to fundamentals.',
        dlm:            'DLM Trader agents follow the Dufwenberg–Lindqvist–Moore (2005) protocol — inexperienced traders chase trends while experienced traders anchor to the fundamental value.',
      };
      let cardBack;
      if (hasLLM) {
        cardBack = `
          <div class="card-back">
            <div class="card-back-head">
              <span class="card-back-title">LLM · Plan ${a.lastLLMPrompt.plan || '?'}</span>
              <span class="card-back-hint">click to flip back</span>
            </div>
            <div class="llm-prompt-body">
              <div class="llm-section">
                <div class="llm-label">System <span class="copy-hint">click to copy</span></div>
                <pre class="llm-text llm-copyable">${UI._escHtml(a.lastLLMPrompt.system || '')}</pre>
              </div>
              <div class="llm-section">
                <div class="llm-label">User <span class="copy-hint">click to copy</span></div>
                <pre class="llm-text llm-copyable">${UI._escHtml(a.lastLLMPrompt.user || '')}</pre>
              </div>
              <div class="llm-section">
                <div class="llm-label">Response</div>
                <pre class="llm-text llm-response">${UI._escHtml(String(a.lastLLMResponse || '—'))}</pre>
              </div>
            </div>
          </div>`;
      } else if (isLLMPlan) {
        // Plan II/III is strictly LLM-driven — no algorithmic
        // fallback. This branch fires only in the tiny window between
        // engine.start() kicking off _schedulePlanLLM() and the first
        // prompt string being attached to each agent (microtask delay)
        // or while the very first network call is still in flight. The
        // "awaiting LLM" copy here matches the agent's own decide()
        // reasoning ("awaiting_llm") so the card and the replay trace
        // read the same story.
        cardBack = `
          <div class="card-back">
            <div class="card-back-head">
              <span class="card-back-title">LLM · Plan ${v.plan}</span>
              <span class="card-back-hint">click to flip back</span>
            </div>
            <p class="card-back-note">Waiting for the first LLM response for this agent. Plan ${v.plan} does not fall back to algorithmic decision rules — this agent will hold until its period-boundary prompt returns.</p>
          </div>`;
      } else {
        const desc = ruleDesc[a.type] || 'This agent uses algorithmic decision rules. No LLM prompt is generated.';
        cardBack = `
          <div class="card-back">
            <div class="card-back-head">
              <span class="card-back-title">Decision rule</span>
              <span class="card-back-hint">click to flip back</span>
            </div>
            <p class="card-back-note">${desc}</p>
          </div>`;
      }

      const cashCell = editable
        ? `<input class="endow-input" type="number" min="0" step="10"
                  data-agent-id="${a.id}" data-field="cash"
                  value="${a.cash.toFixed(0)}">`
        : a.cash.toFixed(0);
      const invCell = editable
        ? `<input class="endow-input" type="number" min="0" step="1"
                  data-agent-id="${a.id}" data-field="inventory"
                  value="${a.inventory}">`
        : a.inventory;

      const isFlipped = UI._flipped.has(a.id);
      return `
        <div class="agent-card-wrap flippable${isFlipped ? ' flipped' : ''}" data-agent-id="${a.id}">
          <div class="agent-card-inner">
            <div class="agent-card card-front ${a.type}"${borderStyle}>
              <div class="agent-header">
                <div class="agent-head-left">
                  <div class="agent-name">${displayName}</div>
                  <div class="agent-type">${subtitle}${subtitleSym ? ` ${subtitleSym}` : ''}</div>
                </div>
                <div class="agent-head-right">
                  <span class="last-action ${actionClass}">${actionLabel}</span>
                  <span class="sym action-sym">${sym.action || ''}</span>
                </div>
              </div>
              ${badgeRow}
              <div class="metrics">
                <span class="metric">Cash <span class="sym">${sym.cash || ''}</span></span>    <span class="metric-val">${cashCell}</span>
                <span class="metric">Shares <span class="sym">${sym.shares || ''}</span></span>  <span class="metric-val">${invCell}</span>
                <span class="metric">Wealth <span class="sym">${sym.wealth || ''}</span></span>  <span class="metric-val">${wealth.toFixed(0)}</span>
                <span class="metric">P&amp;L <span class="sym">${sym.pnl || ''}</span></span> <span class="metric-val" style="color:${pnlColor}">${pnlStr}</span>${extraRows}
              </div>
              <div class="card-actions">
                <button type="button" class="card-btn card-btn-stats" data-action="stats">View Stats</button>
                <button type="button" class="card-btn card-btn-prompt" data-action="prompt">View Prompt</button>
              </div>
            </div>
            ${cardBack}
          </div>
        </div>`;
    }).join('');

    // Detach flipped card DOM nodes before innerHTML so their
    // interactions (text selection, etc.) survive the per-frame rebuild.
    // The back face is static between period boundaries, so keeping the
    // old node is correct.  Scroll positions are snapshotted explicitly
    // because some browsers reset scrollTop on absolutely-positioned
    // overflow elements when the node is removed from / reinserted into
    // the DOM tree.
    const preserved = {};
    const scrollSnap = {};
    this.els.agentsGrid.querySelectorAll('.agent-card-wrap.flipped').forEach(wrap => {
      const aid = wrap.dataset.agentId;
      preserved[aid] = wrap;
      const back = wrap.querySelector('.card-back');
      scrollSnap[aid] = {
        back: back ? back.scrollTop : 0,
        texts: [...wrap.querySelectorAll('.llm-text')].map(el => el.scrollTop),
      };
      wrap.remove();
    });

    this.els.agentsGrid.innerHTML = html;

    // Re-insert preserved flipped cards and restore scroll positions.
    for (const [id, oldWrap] of Object.entries(preserved)) {
      const fresh = this.els.agentsGrid.querySelector(
        `.agent-card-wrap[data-agent-id="${id}"]`,
      );
      if (fresh) {
        fresh.replaceWith(oldWrap);
        const ss = scrollSnap[id];
        if (ss) {
          const back = oldWrap.querySelector('.card-back');
          if (back) back.scrollTop = ss.back;
          const texts = oldWrap.querySelectorAll('.llm-text');
          ss.texts.forEach((top, i) => {
            if (texts[i]) texts[i].scrollTop = top;
          });
        }
      }
    }

    // Wire event delegation once — avoids per-card handler accumulation.
    if (!this._agentGridWired) {
      this._agentGridWired = true;
      this.els.agentsGrid.addEventListener('click', (e) => {
        // Click-to-copy on prompt text blocks.
        const copyable = e.target.closest('.llm-copyable');
        if (copyable) {
          e.stopPropagation();
          navigator.clipboard.writeText(copyable.textContent).then(() => {
            const label = copyable.previousElementSibling;
            const hint = label && label.querySelector('.copy-hint');
            if (hint) {
              hint.textContent = 'copied!';
              setTimeout(() => { hint.textContent = 'click to copy'; }, 1200);
            }
          });
          return;
        }
        // Card-action buttons on the front face. "View Stats" opens
        // the per-agent statistics modal; "View Prompt" flips the
        // card to reveal the LLM prompt / decision-rule blurb.
        const actionBtn = e.target.closest('.card-btn');
        if (actionBtn) {
          const wrap = actionBtn.closest('.agent-card-wrap');
          if (!wrap) return;
          e.stopPropagation();
          const id = Number(wrap.dataset.agentId);
          if (actionBtn.dataset.action === 'stats') {
            this.openAgentStatsView(id);
          } else {
            if (UI._flipped.has(id)) UI._flipped.delete(id);
            else                     UI._flipped.add(id);
            wrap.classList.toggle('flipped');
          }
          return;
        }
        // Flip card toggle on card background click (legacy behavior).
        const wrap = e.target.closest('.agent-card-wrap.flippable');
        if (!wrap) return;
        if (e.target.closest('.endow-input')) return;
        if (e.target.closest('.card-back') && !e.target.closest('.card-back-head')) return;
        const id = Number(wrap.dataset.agentId);
        if (UI._flipped.has(id)) UI._flipped.delete(id);
        else                     UI._flipped.add(id);
        wrap.classList.toggle('flipped');
      });
    }

    if (editable) this._wireEndowmentInputs();
  },

  /**
   * Bind change handlers to the inline endowment inputs so edits are
   * committed through App.updateEndowment. Called every render while
   * in the pre-run preview stage since the grid HTML is replaced.
   */
  _wireEndowmentInputs() {
    const inputs = this.els.agentsGrid.querySelectorAll('.endow-input');
    inputs.forEach(inp => {
      inp.addEventListener('change', e => {
        const id    = Number(e.target.dataset.agentId);
        const field = e.target.dataset.field;
        const val   = Number(e.target.value);
        if (window.App && typeof window.App.updateEndowment === 'function') {
          window.App.updateEndowment(id, field, val);
        }
      });
      // Prevent Enter from bubbling up to any global keybindings;
      // commit the change on Enter instead of waiting for blur.
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
      });
    });
  },

  /**
   * Flip the whole agents area over to reveal the per-agent statistics
   * view on the back face — a 2×3 grid of sparkline-style mini charts
   * (cash, shares, wealth+P&L, subj V with FV reference, reported V
   * with lie-gap markers, normalized utility) for the selected agent.
   * Per-card "View Prompt" still flips individual cards; "View Stats"
   * rotates the entire .agents-flip container. The header gains a
   * "← Back to agents" button that unflips the container. Live
   * re-rendering keeps the chosen agent's series in sync as new ticks
   * arrive — the next render() call is routed to _renderAgentStatsView
   * when this view is active.
   */
  openAgentStatsView(agentId) {
    const flip    = document.getElementById('agents-flip');
    const view    = document.getElementById('agent-stats-view');
    const backBtn = document.getElementById('agent-stats-back');
    if (!flip || !view || !backBtn) return;

    this._statsViewAgentId = agentId;

    if (!this._statsViewWired) {
      this._statsViewWired = true;
      backBtn.addEventListener('click', () => this.closeAgentStatsView());
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this._statsViewAgentId != null) this.closeAgentStatsView();
      });
    }

    flip.classList.add('flipped');
    backBtn.hidden = false;
    document.body.classList.add('agent-stats-active');

    // Render once immediately so content is in place as the flip starts,
    // and again after the transform settles so the canvases size against
    // their final rect rather than a mid-flip (foreshortened) one. rAF
    // alone isn't enough because the main render loop only re-ticks
    // while the engine runs.
    requestAnimationFrame(() => this._renderAgentStatsView());
    const inner = flip.querySelector('.agents-flip-inner');
    if (inner) {
      const onDone = (e) => {
        if (e.target !== inner || e.propertyName !== 'transform') return;
        inner.removeEventListener('transitionend', onDone);
        this._renderAgentStatsView();
      };
      inner.addEventListener('transitionend', onDone);
    }
  },

  closeAgentStatsView() {
    const flip    = document.getElementById('agents-flip');
    const backBtn = document.getElementById('agent-stats-back');
    if (flip)    flip.classList.remove('flipped');
    if (backBtn) backBtn.hidden = true;
    document.body.classList.remove('agent-stats-active');
    this._statsViewAgentId = null;
  },

  _renderAgentStatsView() {
    const view = document.getElementById('agent-stats-view');
    if (!view) return;
    const agentId = this._statsViewAgentId;
    if (agentId == null) return;

    const appView = this._lastView;
    const config  = this._lastConfig;
    if (!appView || !config) return;

    const agent = (appView.agents || {})[agentId];
    const nameEl = view.querySelector('.stats-view-name');
    const metaEl = view.querySelector('.stats-view-meta');
    if (nameEl) {
      // Mirror the exported composite's identity line so the live
      // header reads the same thing as the PNG does.
      const namePieces = [
        agent ? `Agent ${agent.id}` : `Agent ${agentId}`,
        agent && agent.name || null,
      ].filter(Boolean);
      nameEl.textContent = namePieces.join(' · ');
    }
    if (metaEl) {
      // Two-line meta block: risk / reporting context on line 1,
      // experience triple {kᵢ, αᵢ, σᵢ, ωᵢ} plus the narrative trait
      // the active asset's heuristic consumes on line 2 — same
      // shape as the per-agent composite's title area, so the live
      // Stats view and the exported PNG agree field-for-field.
      const line1 = [];
      if (agent) {
        if (agent.riskPref) {
          const rp = UI._riskLabel[agent.riskPref] || agent.riskPref;
          const rho = Number.isFinite(agent.rho) ? ` · ρᵢ = ${agent.rho.toFixed(2)}` : '';
          line1.push(rp + rho);
        } else if (agent.type) {
          line1.push(UI._typeLabel[agent.type] || agent.type);
        }
      }
      if (appView.round != null && appView.period != null) {
        line1.push(`round ${appView.round} · period ${appView.period}`);
      }

      const k   = agent ? (agent.roundsPlayed | 0) : 0;
      const exp = (typeof experienceFactors === 'function')
        ? experienceFactors(k)
        : { k, alpha: 0, sigma: 0, omega: 0 };
      const line2 = [
        `kᵢ = ${k}`,
        `αᵢ = ${exp.alpha.toFixed(2)}`,
        `σᵢ = ${exp.sigma.toFixed(1)}`,
        `ωᵢ = ${exp.omega.toFixed(2)}`,
      ];
      const traits = (agent && agent.narrativeTraits) || null;
      if (traits) {
        if (appView.assetId === 'linearGrowth' && Number.isFinite(traits.g)) {
          line2.push(`gᵢ = ${traits.g.toFixed(2)}`);
        } else if (appView.assetId === 'cyclicalSine' && Number.isFinite(traits.c)) {
          line2.push(`cᵢ = ${traits.c.toFixed(2)}`);
        } else if (appView.assetId === 'randomWalk' && Number.isFinite(traits.u)) {
          line2.push(`uᵢ = ${traits.u.toFixed(2)}`);
        } else if (appView.assetId === 'jumpCrash') {
          if (Number.isFinite(traits.h))     line2.push(`hᵢ = ${traits.h.toFixed(2)}`);
          if (Number.isFinite(traits.delta)) line2.push(`δᵢ = ${traits.delta.toFixed(3)}`);
        }
      }

      metaEl.innerHTML = '';
      const line1El = document.createElement('span');
      line1El.className = 'stats-view-meta-line';
      line1El.textContent = line1.join(' · ') || '—';
      metaEl.appendChild(line1El);
      const line2El = document.createElement('span');
      line2El.className = 'stats-view-meta-exp';
      line2El.textContent = line2.join('   ');
      metaEl.appendChild(line2El);
    }

    const uHist = (appView.utilityHistory   || []).filter(r => r.agentId === agentId);
    const vHist = (appView.valuationHistory || []).filter(r => r.agentId === agentId);
    const msgs  = (appView.messages         || []).filter(m => m.senderId === agentId);

    const totalTicks = (config.roundsPerSession || 1) * config.periods * config.ticksPerPeriod;
    const initW      = (agent && agent.initialWealth != null) ? agent.initialWealth : null;

    const cashPts   = uHist.filter(r => r.cash      != null).map(r => ({ x: r.tick, y: r.cash }));
    const sharesPts = uHist.filter(r => r.inventory != null).map(r => ({ x: r.tick, y: r.inventory }));
    const wealthPts = uHist.filter(r => r.wealth    != null).map(r => ({ x: r.tick, y: r.wealth }));
    const pnlPts    = (initW != null)
      ? uHist.filter(r => r.wealth != null).map(r => ({ x: r.tick, y: r.wealth - initW }))
      : [];
    const subjVPts   = vHist.filter(r => r.subjV    != null).map(r => ({ x: r.tick, y: r.subjV }));
    const reportVPts = vHist.filter(r => r.reportedV != null).map(r => ({ x: r.tick, y: r.reportedV }));
    const utilPts    = uHist.filter(r => r.utility  != null).map(r => ({ x: r.tick, y: r.utility }));

    const fvPoints = [];
    const sessionPeriods = (config.roundsPerSession || 1) * config.periods;
    for (let g = 1; g <= sessionPeriods; g++) {
      const localP = ((g - 1) % config.periods) + 1;
      const localR = Math.floor((g - 1) / config.periods) + 1;
      const fv     = UI._fvAtRound(localR, localP, config);
      fvPoints.push({ x: (g - 1) * config.ticksPerPeriod, y: fv });
      fvPoints.push({ x:  g      * config.ticksPerPeriod, y: fv });
    }

    const color = this.agentColor(agentId);
    const render = (selector, opts) => this._renderStatsSparkline(
      view.querySelector(selector),
      Object.assign({ xMin: 0, xMax: totalTicks, color, agentView: appView, config, agentId }, opts),
    );

    render('[data-stat="cash"] canvas',   { series: [{ points: cashPts,   color, width: 1.6 }],
                                            yLabel: y => y.toFixed(0) });
    render('[data-stat="shares"] canvas', { series: [{ points: sharesPts, color, width: 1.6, step: true }],
                                            yMinFloor: 0, yLabel: y => y.toFixed(0) });
    render('[data-stat="wealth"] canvas', {
      series: [
        { points: wealthPts, color, width: 1.6, label: 'Wealth' },
        { points: pnlPts,    color: this.theme.accent, width: 1.2, dashed: true, label: 'P&L' },
      ],
      yLabel: y => y.toFixed(0),
      baseline: 0,
    });
    render('[data-stat="subjv"] canvas', {
      series: [
        { points: fvPoints, color: this.theme.amber, width: 1.4, dashed: true, label: 'FV' },
        { points: subjVPts, color, width: 1.6, label: 'Subj V' },
      ],
      yMinFloor: 0, yLabel: y => y.toFixed(0),
    });
    render('[data-stat="reportv"] canvas', {
      series: [
        { points: subjVPts,   color: this.theme.fg3, width: 1.2, dashed: true, label: 'Subj V' },
        { points: reportVPts, color, width: 1.6, label: 'Report V' },
      ],
      yMinFloor: 0, yLabel: y => y.toFixed(0),
      lieMarkers: msgs.filter(m => m.deceptive).map(m => ({
        x: m.tick,
        y: m.claimedValuation,
        yTrue: m.trueValuation,
      })),
    });
    render('[data-stat="utility"] canvas', {
      series: [{ points: utilPts, color, width: 1.6 }],
      baseline: 1,
      yLabel: y => y.toFixed(2),
    });

    this._renderAgentModelBlock(view, appView, agent);
  },

  /**
   * Render the 6-panel stats composite for `agentId` against the
   * currently-loaded view (UI._lastView) and return a single composite
   * canvas. Layout: title row on top (two text lines — identity + the
   * experience triple {kᵢ, αᵢ, σᵢ, ωᵢ} + any narrative trait that the
   * active asset's heuristic consumes), then a 2×3 grid of mini-charts.
   * Used by the Export flow to emit one PNG per agent per phase without
   * having to visually flip the agents card to each agent in turn.
   *
   * Reuses `_renderAgentStatsView` by pointing `_statsViewAgentId` at
   * the target agent and letting the existing per-panel renderer paint
   * into the stats-panel canvases (which already live in the DOM on
   * the flip-back — `backface-visibility: hidden` hides them visually
   * but layout + getBoundingClientRect remain valid). The previous
   * selection is restored at the end.
   *
   * `context` (optional): { round } — overrides the captured round
   * number printed in the identity line. Useful when the caller
   * wants to pin a specific round label, otherwise the current
   * `_lastView.round` is used.
   */
  captureAgentComposite(agentId, context) {
    const view = document.getElementById('agent-stats-view');
    if (!view) return null;
    const prev = this._statsViewAgentId;
    this._statsViewAgentId = agentId;
    this._renderAgentStatsView();

    const panels = Array.from(view.querySelectorAll('.stats-panel'));
    const items  = panels.map(p => ({
      canvas: p.querySelector('canvas'),
      title:  (p.querySelector('figcaption') || {}).textContent || '',
    })).filter(x => x.canvas && x.canvas.width > 0 && x.canvas.height > 0);
    if (!items.length) {
      this._statsViewAgentId = prev;
      if (prev != null) this._renderAgentStatsView();
      return null;
    }

    const agent = (this._lastView && this._lastView.agents || {})[agentId];
    const dpr   = window.devicePixelRatio || 1;
    const w0    = items[0].canvas.width  / dpr;
    const h0    = items[0].canvas.height / dpr;
    const cols  = 2;
    const rows  = Math.ceil(items.length / cols);
    const pad   = 10;
    const titleH = 46;
    const capH   = 16;
    const totalW = cols * w0 + (cols + 1) * pad;
    const totalH = titleH + rows * (h0 + capH) + (rows + 1) * pad;

    const comp = document.createElement('canvas');
    comp.width  = Math.round(totalW * dpr);
    comp.height = Math.round(totalH * dpr);
    const cctx  = comp.getContext('2d');
    cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cctx.fillStyle = this.theme.bg || '#fff';
    cctx.fillRect(0, 0, totalW, totalH);

    // Identity line: agent ID, name, risk label, captured round.
    cctx.textBaseline = 'top';
    cctx.fillStyle = this.theme.fg1 || this.theme.fg || '#000';
    cctx.font = '13px system-ui, -apple-system, sans-serif';
    const rp = agent && agent.riskPref
      ? (UI._riskLabel[agent.riskPref] || agent.riskPref) : '';
    const capturedRound = (context && context.round != null)
      ? context.round
      : (this._lastView && this._lastView.round);
    const identParts = [
      agent ? `Agent ${agent.id}` : `Agent ${agentId}`,
      agent && agent.name || null,
      rp || null,
      capturedRound != null ? `captured @ round ${capturedRound}` : null,
    ].filter(Boolean);
    cctx.fillText(identParts.join(' · '), pad, pad + 2);

    // Experience triple + narrative trait if the active asset uses one.
    // Computed from the agent's endogenous roundsPlayed counter — so
    // a round-3 "before" capture and a round-4 "after" capture for the
    // same surviving veteran show two different triples and the reader
    // can see the experience curve moving.
    const k = agent ? (agent.roundsPlayed | 0) : 0;
    const exp = (typeof experienceFactors === 'function')
      ? experienceFactors(k)
      : { k, alpha: 0, sigma: 0, omega: 0 };
    const expParts = [
      `kᵢ = ${k}`,
      `αᵢ = ${exp.alpha.toFixed(2)}`,
      `σᵢ = ${exp.sigma.toFixed(1)}`,
      `ωᵢ = ${exp.omega.toFixed(2)}`,
    ];
    const traits = (agent && agent.narrativeTraits) || null;
    const assetId = this._lastView && this._lastView.assetId;
    if (traits) {
      if (assetId === 'linearGrowth' && Number.isFinite(traits.g)) {
        expParts.push(`gᵢ = ${traits.g.toFixed(2)}`);
      } else if (assetId === 'cyclicalSine' && Number.isFinite(traits.c)) {
        expParts.push(`cᵢ = ${traits.c.toFixed(2)}`);
      } else if (assetId === 'randomWalk' && Number.isFinite(traits.u)) {
        expParts.push(`uᵢ = ${traits.u.toFixed(2)}`);
      } else if (assetId === 'jumpCrash') {
        if (Number.isFinite(traits.h))     expParts.push(`hᵢ = ${traits.h.toFixed(2)}`);
        if (Number.isFinite(traits.delta)) expParts.push(`δᵢ = ${traits.delta.toFixed(3)}`);
      }
    }
    cctx.fillStyle = this.theme.fg2 || this.theme.label || '#666';
    cctx.font = '12px "SF Mono", ui-monospace, Menlo, Consolas, monospace';
    cctx.fillText(expParts.join('   '), pad, pad + 22);

    items.forEach((it, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = pad + col * (w0 + pad);
      const y = titleH + pad + row * (h0 + capH + pad);
      cctx.fillStyle = this.theme.fg2 || this.theme.label || '#666';
      cctx.font = '11px system-ui, -apple-system, sans-serif';
      const cap = it.title.replace(/\s+/g, ' ').trim();
      cctx.fillText(cap, x, y);
      cctx.drawImage(it.canvas, x, y + capH, w0, h0);
    });

    this._statsViewAgentId = prev;
    if (prev != null) this._renderAgentStatsView();
    return comp;
  },

  /**
   * Fill the back-face "Agent model" panel with the model-based
   * formulation the agent is actually running for the round's active
   * asset. Text comes from `ASSET_AGENT_TEMPLATES` (assets.js) plus the
   * generic v3 §7 prior/posterior blend; live chips show (α_i, σ_i,
   * ω_i) so the reader can read off the current experience weighting.
   */
  _renderAgentModelBlock(view, appView, agent) {
    const box = view.querySelector('#stats-model');
    if (!box) return;

    const assetId = appView && appView.assetId;
    const asset   = (typeof ASSET_TYPES_BY_ID !== 'undefined' && assetId)
      ? ASSET_TYPES_BY_ID[assetId]
      : null;
    const tpl = asset && asset.agentTemplate;
    if (!tpl) { box.innerHTML = ''; return; }

    const tun = (appView && appView.tunables) || {};
    const rp  = agent ? (agent.roundsPlayed | 0) : 0;
    const exp = (typeof experienceFactors === 'function')
      ? experienceFactors(rp)
      : { k: rp, alpha: 0.4, sigma: 15, omega: 0.6 };

    const fvMml   = UI._fvMathML(assetId);
    const heurMml = UI._heuristicMathML(assetId);
    const priorMml = UI._priorMathML(tun);
    const postMml  = UI._posteriorMathML();

    // MathML-backed chips so α_i / σ_i / ω_i / narrative traits render
     // through the same Sym map as the formulas below — avoids the
     // plain-text "α_i" drifting into a Latin "a_i" in the body font.
    const chipHtml = (symHtml, valueText) =>
      `<span class="stats-model-chip">${symHtml}<span class="stats-model-chip-eq"> = ${UI._escHtml(valueText)}</span></span>`;
    const chipParts = [
      chipHtml(Sym.alphaI, exp.alpha.toFixed(2)),
      chipHtml(Sym.sigmaI, exp.sigma.toFixed(1)),
      chipHtml(Sym.omegaI, exp.omega.toFixed(2)),
      chipHtml(Sym.kExp,   String(rp)),
    ];
    // v5 — surface the per-agent narrative trait used by the active asset's
    // heuristic (g_i for Linear Growth, c_i for Cyclical, u_i for Random
    // Walk, h_i + δ_i for Jump/Crash). Only the trait(s) the current asset
    // consumes are shown, so the chip row stays scannable.
    const traits = (agent && agent.narrativeTraits) || null;
    if (traits) {
      if (assetId === 'linearGrowth' && Number.isFinite(traits.g)) {
        chipParts.push(chipHtml(Sym.gI, traits.g.toFixed(2)));
      } else if (assetId === 'cyclicalSine' && Number.isFinite(traits.c)) {
        chipParts.push(chipHtml(Sym.cI, traits.c.toFixed(2)));
      } else if (assetId === 'randomWalk' && Number.isFinite(traits.u)) {
        chipParts.push(chipHtml(Sym.uI, traits.u.toFixed(2)));
      } else if (assetId === 'jumpCrash') {
        if (Number.isFinite(traits.h))     chipParts.push(chipHtml(Sym.hI,     traits.h.toFixed(2)));
        if (Number.isFinite(traits.delta)) chipParts.push(chipHtml(Sym.deltaI, traits.delta.toFixed(3)));
      }
    }
    const chips = chipParts.join('');

    const subtitleBits = [];
    if (tpl.typeLabel) subtitleBits.push(tpl.typeLabel);
    if (tpl.horizon)   subtitleBits.push(tpl.horizon);

    box.innerHTML = `
      <div class="stats-model-head">
        <span class="stats-model-title">Agent model · ${UI._escHtml(appView.assetLabel || asset.label || '—')}</span>
        <span class="stats-model-sub">${UI._escHtml(subtitleBits.join(' · '))}</span>
        <span class="stats-model-chips">${chips}</span>
      </div>
      <div class="stats-model-steps">
        <span class="stats-model-label">Step 1 · model FṼ</span>
        <span class="stats-model-value">${fvMml}</span>
        <span class="stats-model-label">Step 2 · heuristic H</span>
        <span class="stats-model-value">${heurMml}</span>
        <span class="stats-model-label">Step 3 · prior</span>
        <span class="stats-model-value">${priorMml}</span>
        <span class="stats-model-label">Step 3 · posterior</span>
        <span class="stats-model-value">${postMml}</span>
      </div>
    `;
  },

  /** Draw one sparkline-style mini chart inside the stats modal. */
  _renderStatsSparkline(canvas, opts) {
    if (!canvas) return;
    const dpr  = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    canvas.width  = rect.width  * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    Viz.clear(ctx, rect.width, rect.height);
    const plot = Viz.plotRect(rect.width, rect.height, 40, 10, 10, 22);

    const { xMin, xMax, series, yLabel, baseline, lieMarkers, yMinFloor } = opts;
    let yMin = Infinity, yMax = -Infinity;
    for (const s of series) {
      for (const p of s.points) {
        if (p.y == null) continue;
        if (p.y < yMin) yMin = p.y;
        if (p.y > yMax) yMax = p.y;
      }
    }
    if (baseline != null) {
      if (baseline < yMin) yMin = baseline;
      if (baseline > yMax) yMax = baseline;
    }
    if (lieMarkers) {
      for (const m of lieMarkers) {
        if (m.y    != null && m.y    < yMin) yMin = m.y;
        if (m.y    != null && m.y    > yMax) yMax = m.y;
        if (m.yTrue != null && m.yTrue < yMin) yMin = m.yTrue;
        if (m.yTrue != null && m.yTrue > yMax) yMax = m.yTrue;
      }
    }
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) { yMin = 0; yMax = 1; }
    if (yMinFloor != null && yMin > yMinFloor) yMin = yMinFloor;
    const span = Math.max(1e-6, yMax - yMin);
    yMin = yMin - span * 0.08;
    yMax = yMax + span * 0.08;

    Viz.axes(ctx, plot, {
      xMin, xMax, yMin, yMax,
      xTicks: opts.config.roundsPerSession || 1, yTicks: 3,
      xFmt: x => this._roundLabel(opts.agentView, opts.config, x),
      yFmt: yLabel || (y => y.toFixed(0)),
    });

    this._drawRoundDividers(ctx, plot, opts.config, xMin, xMax, opts.agentView);

    if (baseline != null) {
      const by = Viz.mapY(plot, baseline, yMin, yMax);
      ctx.save();
      ctx.strokeStyle = this.theme.fg3;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(plot.x, by); ctx.lineTo(plot.x + plot.w, by); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // If *this* agent's slot was swapped at the R4 replacement, split
    // its data series at the swap tick so the post-replacement segment
    // renders in a visually distinct "mixed regime" style — same slot
    // id, but a fresh inexperienced trader produced those samples.
    // Veterans who played every round keep a uniform line.
    const replEvt = (opts.agentView && opts.agentView.events || [])
      .find(e => e && e.type === 'round_4_replacement');
    const wasReplaced = !!(replEvt && Array.isArray(replEvt.replaced)
      && replEvt.replaced.some(r => r && r.id === opts.agentId));
    const splitTick = wasReplaced ? (replEvt.tick | 0) : null;

    for (const s of series) {
      if (!s.points.length) continue;
      const pts = s.step ? this._stepify(s.points) : s.points;
      const baseStyle = {
        xMin, xMax, yMin, yMax,
        color:  s.color,
        width:  s.width || 1.4,
        dashed: !!s.dashed,
      };

      if (splitTick == null) {
        Viz.line(ctx, plot, pts, baseStyle);
        continue;
      }

      // A sample exactly at the split tick is included in both halves
      // so the two segments meet without a visible gap.
      const pre  = [];
      const post = [];
      for (const p of pts) {
        if (p.x <  splitTick) pre.push(p);
        else if (p.x >  splitTick) post.push(p);
        else { pre.push(p); post.push(p); }
      }
      if (pre.length)  Viz.line(ctx, plot, pre, baseStyle);
      if (post.length) Viz.line(ctx, plot, post, {
        ...baseStyle,
        // Thinner, dashed, and heavily faded so the post-swap segment
        // reads as an unmistakable "ghosted regime" — same metric, but
        // produced by a roster that now includes fresh inexperienced
        // traders. A subtle alpha fade isn't enough on dark-mode
        // backgrounds, so we lean on three cues at once.
        dashed: true,
        width:  Math.max(0.8, (s.width || 1.4) * 0.75),
        color:  this._fanColor(s.color, 0.30),
      });
    }

    if (lieMarkers && lieMarkers.length) {
      ctx.save();
      ctx.strokeStyle = this.theme.red;
      ctx.lineWidth = 1;
      for (const m of lieMarkers) {
        const x = Viz.mapX(plot, m.x, xMin, xMax);
        const y = Viz.mapY(plot, m.y, yMin, yMax);
        ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.stroke();
        if (m.yTrue != null) {
          const yT = Viz.mapY(plot, m.yTrue, yMin, yMax);
          ctx.setLineDash([2, 2]);
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, yT); ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      ctx.restore();
    }
  },

  /** Convert a sparse series to a step-shaped one (hold previous y
      across each segment). Used for integer-valued shares where the
      visual intent is "changes abruptly at trades", not smooth. */
  _stepify(points) {
    if (points.length < 2) return points.slice();
    const out = [];
    for (let i = 0; i < points.length; i++) {
      out.push(points[i]);
      if (i < points.length - 1) {
        out.push({ x: points[i + 1].x, y: points[i].y });
      }
    }
    return out;
  },

  /**
   * Toggle a small pre-run status label on the agents panel header.
   * Separated out so renderAgents stays readable.
   */
  _toggleAgentStageLabel(on) {
    const h = document.querySelector('.panel-agents .agents-header .stage-label');
    if (!h) return;
    h.textContent = on
      ? 'Pre-run draft · editable before the simulation starts'
      : 'Running · live state';
    h.classList.toggle('live', !on);
  },

  /* -------- Trade feed (trades + dividend events) -------- */

  renderFeed(v) {
    const currentTick = v.tick | 0;
    if (currentTick <= 0) {
      this.els.tradeFeed.innerHTML = '<li class="muted">no activity yet</li>';
      return;
    }

    // Index trades and dividend events by their tick so the per-tick
    // walk below can probe in O(1). Multiple trades can land on the
    // same tick (all crosses execute inside one match pass), so each
    // bucket is a list.
    const byTick = new Map();
    const push = (tick, entry) => {
      const arr = byTick.get(tick);
      if (arr) arr.push(entry); else byTick.set(tick, [entry]);
    };
    for (const t of v.trades) push(t.timestamp, { kind: 'trade', t });
    for (const e of v.events) {
      if (e.type === 'dividend') push(e.tick, { kind: 'dividend', e });
    }

    // Walk ticks newest → oldest and emit a `silent` placeholder for
    // any tick with no trade and no dividend so the feed reads as an
    // exhaustive per-tick record. The 500-item cap keeps DOM cost
    // bounded; anything beyond the cap is still reachable through the
    // UL's own overflow-y scroll for recent-tick browsing, and the
    // older history is recoverable via the replay slider.
    const items = [];
    for (let tick = currentTick; tick >= 1 && items.length < 500; tick--) {
      const entries = byTick.get(tick);
      if (entries && entries.length) {
        for (const entry of entries) items.push({ ...entry, tick });
      } else {
        items.push({ kind: 'silent', tick });
      }
    }

    this.els.tradeFeed.innerHTML = items.map(r => {
      if (r.kind === 'trade') {
        const t = r.t;
        const buyer  = v.agents[t.buyerId]?.name  || t.buyerId;
        const seller = v.agents[t.sellerId]?.name || t.sellerId;
        return `<li>
          <span class="t-tick">t${t.timestamp}</span>
          <span class="t-price">$${t.price.toFixed(2)}</span>
          <span class="t-agents">${buyer} ← ${seller}</span>
        </li>`;
      }
      if (r.kind === 'dividend') {
        const where = r.e.round != null
          ? `R${r.e.round}·P${r.e.period}`
          : `Period ${r.e.period}`;
        return `<li class="feed-dividend">
          <span class="t-tick">t${r.e.tick}</span>
          <span class="t-price"><span class="t-kind">Dividend</span> $${r.e.value.toFixed(0)}</span>
          <span class="t-agents">${where} · all holders</span>
        </li>`;
      }
      // kind === 'silent' — no trade and no dividend fired at this
      // tick. Rendered as a muted row so the reader can see the gap
      // without mistaking it for activity.
      return `<li class="feed-silent">
        <span class="t-tick">t${r.tick}</span>
        <span class="t-price">—</span>
        <span class="t-agents">no trade</span>
      </li>`;
    }).join('');
  },

  /**
   * Format an x-axis tick label for round-based charts. When a batch
   * session is active (v.session > 0), labels read "R{r}_S{s}" so the
   * round is identifiable across sessions; otherwise just "R{r}".
   */
  _roundLabel(v, config, x) {
    const rounds = config.roundsPerSession || 1;
    const r = Math.min(rounds, Math.floor(x / (config.periods * config.ticksPerPeriod)) + 1);
    if (v.session > 0) return 'R' + r + '_S' + v.session;
    return 'R' + r;
  },

  /** Format a raw tick as "R{r} P{p} · t={tick}" for hover tooltips. */
  _tickHoverFmt(v, config, x) {
    const rounds  = config.roundsPerSession || 1;
    const T       = config.periods;
    const K       = config.ticksPerPeriod;
    const g       = Math.min(rounds * T, Math.max(1, Math.floor(x / K) + 1));
    const r       = Math.min(rounds, Math.floor((g - 1) / T) + 1);
    const p       = ((g - 1) % T) + 1;
    const stamp   = v.session > 0 ? `R${r}_S${v.session}` : `R${r}`;
    return `${stamp} · P${p} · t=${Math.round(x)}`;
  },

  /**
   * Draw round dividers and highlight the R3→R4 replacement boundary.
   * Used by every chart that spans the full session tick range.
   *
   * Normal round boundaries get a thin solid line in `frame` colour.
   * The R3→R4 boundary (round === 3) gets a thicker dashed red line
   * with a small "R4 swap" label so the replacement step is visible
   * in every chart at a glance.
   *
   * @param {CanvasRenderingContext2D} cx  — chart canvas context
   * @param {object} rect   — plot rectangle {x, y, w, h}
   * @param {object} config — App.config
   * @param {number} xMin
   * @param {number} xMax
   * @param {object} v      — view (v.events carries round_4_replacement)
   */
  /**
   * Per-round mispricing summary.
   *   signedPct : mean over round r of (P − FV) / FV  — the blue/orange
   *               gap on Figure 1 (sign preserved, unit-free).
   *   absMean   : mean over round r of |P − FV|       — the area under
   *               Figure 2 (unit = ¢).
   *   absPct    : mean over round r of |P − FV| / FV  — Figure 2
   *               expressed as a percentage of FV.
   * Returns `[null, {round:1, ...}, {round:2, ...}, ...]` (1-indexed
   * so callers can read out[r] directly without offsets).
   */
  _mispricingByRound(v, config) {
    const rounds = config.roundsPerSession || 1;
    const T      = config.periods;
    const out    = new Array(rounds + 1).fill(null);
    const sums   = new Array(rounds + 1).fill(null).map(() => ({ s: 0, a: 0, r: 0, n: 0 }));
    for (const p of v.priceHistory || []) {
      if (p == null || p.price == null || p.fv == null || !Number.isFinite(p.fv) || p.fv === 0) continue;
      const r = p.round || Math.min(rounds, Math.floor((p.tick - 1) / (T * config.ticksPerPeriod)) + 1);
      if (r < 1 || r > rounds) continue;
      const diff = p.price - p.fv;
      const bucket = sums[r];
      bucket.s += diff / p.fv;
      bucket.a += Math.abs(diff);
      bucket.r += Math.abs(diff) / p.fv;
      bucket.n += 1;
    }
    for (let r = 1; r <= rounds; r++) {
      const b = sums[r];
      if (!b || !b.n) continue;
      out[r] = { round: r, signedPct: b.s / b.n, absMean: b.a / b.n, absPct: b.r / b.n };
    }
    return out;
  },

  /**
   * Append per-round mispricing chips to a Viz.legendRow entries array.
   * Only rounds that have actually completed (v.tick ≥ r·T·K) contribute
   * — the readout is a retrospective summary, so we don't show a
   * partial-round value mid-stream that would jitter as more ticks land.
   *
   *   mode = 'signed'   → "R1 +2.4%"   (Figure 1: blue price vs orange FV)
   *   mode = 'absolute' → "R1 12.4¢ · 8.2%"   (Figure 2: |P − FV|)
   */
  _appendMispricingLegend(entries, v, config, mode) {
    const rounds      = config.roundsPerSession || 1;
    const ticksPerRnd = config.periods * config.ticksPerPeriod;
    const mp          = this._mispricingByRound(v, config);
    const tickNow     = (v && v.tick | 0) || 0;
    for (let r = 1; r <= rounds; r++) {
      if (tickNow < r * ticksPerRnd) continue;  // round not finished yet
      const row = mp[r];
      if (!row) continue;
      let label, color;
      if (mode === 'signed') {
        const sign = row.signedPct >= 0 ? '+' : '−';
        label = `R${r} ${sign}${(Math.abs(row.signedPct) * 100).toFixed(1)}%`;
        color = row.signedPct >= 0 ? this.theme.accent : this.theme.red;
      } else {
        label = `R${r} ${row.absMean.toFixed(1)}¢ · ${(row.absPct * 100).toFixed(1)}%`;
        color = this.theme.red;
      }
      entries.push({ color, label });
    }
  },

  _drawRoundDividers(cx, rect, config, xMin, xMax, v) {
    const rounds = config.roundsPerSession || 1;
    if (rounds <= 1) return;
    const ticksPerRnd = config.periods * config.ticksPerPeriod;

    // Resolve the replacement event (if any): its treatmentSize tells
    // us how many inexperienced traders were spliced in, which we
    // inline into the divider annotation so a single-figure export
    // conveys the swap magnitude at a glance.
    const replEvt = (v.events || []).find(e => e.type === 'round_4_replacement');
    const hasReplacement = !!replEvt;
    const replCount      = replEvt ? (replEvt.treatmentSize | 0) : 0;

    cx.save();
    for (let r = 1; r < rounds; r++) {
      const x = Viz.mapX(rect, r * ticksPerRnd, xMin, xMax);
      if (r === 3 && hasReplacement) {
        // R3→R4 replacement boundary: a bold dashed red line with a
        // soft halo and a label naming the count of fresh traders
        // spliced in. The halo uses a translucent red fill so the line
        // reads as "an event" even when the chart is busy behind it.
        cx.strokeStyle = this._fanColor(this.theme.red, 0.18);
        cx.lineWidth   = 6;
        cx.setLineDash([]);
        cx.beginPath();
        cx.moveTo(x + 0.5, rect.y);
        cx.lineTo(x + 0.5, rect.y + rect.h);
        cx.stroke();

        cx.strokeStyle = this.theme.red;
        cx.lineWidth   = 2.5;
        cx.setLineDash([7, 4]);
        cx.beginPath();
        cx.moveTo(x + 0.5, rect.y);
        cx.lineTo(x + 0.5, rect.y + rect.h);
        cx.stroke();
        cx.setLineDash([]);
        // Annotation: how many traders were replaced at this boundary.
        // Large charts have room to paint the label *above* the plot
        // rectangle; stats-panel sparklines (padT ≈ 10 px, used on the
        // agent flip-back) don't, so we tuck the label inside the plot
        // with a translucent backing strip so it stays legible without
        // clipping against the canvas top edge.
        const label = replCount > 0
          ? `R4 swap · −${replCount} traders`
          : 'R4 swap';
        cx.font      = '10px "Helvetica Neue", Helvetica, Arial, sans-serif';
        cx.textAlign = 'center';
        if (rect.y >= 14) {
          cx.textBaseline = 'bottom';
          cx.fillStyle    = this.theme.red;
          cx.fillText(label, x, rect.y - 2);
        } else {
          cx.textBaseline = 'top';
          const metrics = cx.measureText(label);
          const bgW = Math.ceil(metrics.width) + 8;
          const bgX = x - bgW / 2;
          cx.fillStyle = this._fanColor(this.theme.bg || '#ffffff', 0.9);
          cx.fillRect(bgX, rect.y + 1, bgW, 12);
          cx.fillStyle = this.theme.red;
          cx.fillText(label, x, rect.y + 2);
        }
      } else {
        // Normal round boundary.
        cx.strokeStyle = this.theme.frame;
        cx.lineWidth   = 1;
        cx.beginPath();
        cx.moveTo(x + 0.5, rect.y);
        cx.lineTo(x + 0.5, rect.y + rect.h);
        cx.stroke();
      }
    }
    cx.restore();
  },

  /* -------- Price vs FV chart -------- */

  renderPriceChart(v, config) {
    if (!this.charts.price) return;
    const { ctx, width, height } = this.charts.price;
    Viz.clear(ctx, width, height);
    // padL 44: y-tick numerics only. padB 38: tick row + "Period t" label.
    const rect = Viz.plotRect(width, height, 44, 14, 16, 38);

    const rounds         = config.roundsPerSession || 1;
    const sessionPeriods = rounds * config.periods;
    const totalTicks     = sessionPeriods * config.ticksPerPeriod;
    const maxFV          = this._fvPeak(v, config);
    const priceMax       = Math.max(
      maxFV * 1.3,
      ...v.priceHistory.map(p => p.price || 0),
    );
    const xMin = 0, xMax = totalTicks;
    const yMin = 0, yMax = Math.max(10, priceMax * 1.05);

    // Alternating period bands for visual separation, iterated across
    // every period of every round in the session.
    for (let p = 1; p <= sessionPeriods; p++) {
      if (p % 2 === 0) {
        const x1 = Viz.mapX(rect, (p - 1) * config.ticksPerPeriod, xMin, xMax);
        const x2 = Viz.mapX(rect,  p      * config.ticksPerPeriod, xMin, xMax);
        Viz.verticalBand(ctx, rect, x1, x2, this.theme.band);
      }
    }

    Viz.axes(ctx, rect, {
      xMin, xMax, yMin, yMax,
      xTicks: rounds, yTicks: 5,
      xFmt: x => this._roundLabel(v, config, x),
      yFmt: y => y.toFixed(0),
    });

    this._drawRoundDividers(ctx, rect, config, xMin, xMax, v);

    // Deterministic FV saw-tooth — FV_t = (T − t + 1)·μ_d resets at
    // each round start, so the line climbs back to maxFV at every
    // round boundary and declines to μ_d at every round end.
    const fvPoints = [];
    for (let g = 1; g <= sessionPeriods; g++) {
      const localP = ((g - 1) % config.periods) + 1;
      const localR = Math.floor((g - 1) / config.periods) + 1;
      const fv     = UI._fvAtRound(localR, localP, config);
      fvPoints.push({ x: (g - 1) * config.ticksPerPeriod, y: fv });
      fvPoints.push({ x:  g      * config.ticksPerPeriod, y: fv });
    }
    Viz.line(ctx, rect, fvPoints, { xMin, xMax, yMin, yMax, color: this.theme.amber, width: 2, dashed: true });

    // Observed price line P_t. The priceHistory entries at the very
    // start of each round (and any other tick with no trade yet) carry
    // `price = null`, so a straight Viz.line draw would leave visible
    // gaps wherever the book has not yet produced a first trade — most
    // noticeably at the round-end → round-start boundary. We underlay
    // a faint dashed connector through only the non-null points so the
    // gap is visually bridged without claiming a trade occurred there,
    // then overlay the real series with null-aware breaks on top. The
    // bridge is 1px and 33% alpha so it disappears under the 2px solid
    // line wherever trades exist and only shows through in the gap.
    const pricePoints  = v.priceHistory.map(p => ({ x: p.tick, y: p.price }));
    const bridgePoints = pricePoints.filter(p => p.y != null);
    Viz.line(ctx, rect, bridgePoints, { xMin, xMax, yMin, yMax, color: this.theme.accent + '55', width: 1, dashed: true });
    Viz.line(ctx, rect, pricePoints,  { xMin, xMax, yMin, yMax, color: this.theme.accent,        width: 2 });

    // Individual trade prints — one dot per executed trade.
    ctx.save();
    ctx.fillStyle = this.theme.accent;
    for (const t of v.trades) {
      const x = Viz.mapX(rect, t.timestamp, xMin, xMax);
      const y = Viz.mapY(rect, t.price,     yMin, yMax);
      ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    Viz.axisLabel(ctx, rect, v.session > 0 ? 'Round R · Session ' + v.session : 'Round R', 'bottom');

    const priceLegend = [
      { color: this.theme.accent, label: '● observed price' },
      { color: this.theme.amber,  label: '▬ fundamental value' },
    ];
    this._appendMispricingLegend(priceLegend, v, config, 'signed');
    Viz.legendRow(ctx, rect, priceLegend);

    const fvSeries = [];
    for (let g = 1; g <= sessionPeriods; g++) {
      const lp = ((g - 1) % config.periods) + 1;
      const lr = Math.floor((g - 1) / config.periods) + 1;
      fvSeries.push({ x: (g - 0.5) * config.ticksPerPeriod, y: this._fvAtRound(lr, lp, config) });
    }
    this._registerHover('price', {
      mode: 'series', rect, xMin, xMax, yMin, yMax,
      xLabel: '',
      xFmt: x => this._tickHoverFmt(v, config, x),
      series: [
        { name: 'Price', color: this.theme.accent, points: bridgePoints, yFmt: y => y.toFixed(2) + '¢' },
        { name: 'FV',    color: this.theme.amber,  points: fvSeries,     yFmt: y => y.toFixed(2) + '¢' },
      ],
    });
  },

  /* -------- Bubble magnitude chart -------- */

  renderBubbleChart(v, config) {
    if (!this.charts.bubble) return;
    const { ctx, width, height } = this.charts.bubble;
    Viz.clear(ctx, width, height);
    // padT 28: matches Figure 3's volume chart so the legend row (and
    // the per-round mispricing chips) sit above the plot frame, freeing
    // vertical space inside the plot for the ρ_t overlay.
    const rect = Viz.plotRect(width, height, 44, 14, 28, 38);

    const rounds         = config.roundsPerSession || 1;
    const sessionPeriods = rounds * config.periods;
    const totalTicks     = sessionPeriods * config.ticksPerPeriod;
    const pts = v.priceHistory.map(p => ({
      x: p.tick,
      y: p.price != null ? (p.price - p.fv) : null,
    }));
    const ys    = pts.filter(p => p.y != null).map(p => p.y);
    const peakY = Math.max(10, ...(ys.length ? ys.map(Math.abs) : [10])) * 1.1;
    const yMin  = -peakY, yMax = peakY;

    Viz.axes(ctx, rect, {
      xMin: 0, xMax: totalTicks, yMin, yMax,
      xTicks: rounds, yTicks: 4,
      xFmt: x => this._roundLabel(v, config, x),
      yFmt: y => (y >= 0 ? '+' : '') + y.toFixed(0),
    });

    // Signed mispricing P_t − FV_t on a symmetric ±peak axis, with the
    // area filled between the curve and the zero baseline so positive
    // regions read as a blue premium mound and negative regions as a
    // red discount trough. Null-aware breaks inherit from Figure 1.
    const bridgePts = pts.filter(p => p.y != null);
    const posPts    = pts.map(p => ({ x: p.x, y: p.y == null ? null : Math.max(0, p.y) }));
    const negPts    = pts.map(p => ({ x: p.x, y: p.y == null ? null : Math.min(0, p.y) }));
    Viz.area(ctx, rect, posPts,    { xMin: 0, xMax: totalTicks, yMin, yMax, color: this.theme.accent + '30' });
    Viz.area(ctx, rect, negPts,    { xMin: 0, xMax: totalTicks, yMin, yMax, color: this.theme.red    + '30' });
    Viz.line(ctx, rect, bridgePts, { xMin: 0, xMax: totalTicks, yMin, yMax, color: this.theme.red    + '55', width: 1, dashed: true });
    Viz.line(ctx, rect, pts,       { xMin: 0, xMax: totalTicks, yMin, yMax, color: this.theme.red,           width: 2 });

    // Zero baseline so the eye can read premium vs. discount directly.
    const baseY = Viz.mapY(rect, 0, yMin, yMax);
    ctx.save();
    ctx.strokeStyle = this.theme.fg3;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(rect.x, baseY); ctx.lineTo(rect.x + rect.w, baseY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    this._drawRoundDividers(ctx, rect, config, 0, totalTicks, v);

    Viz.axisLabel(ctx, rect, v.session > 0 ? 'Round R · Session ' + v.session : 'Round R', 'bottom');
    const bubbleLegend = [
      { color: this.theme.red, label: '▬ mispricing' },
    ];
    this._appendMispricingLegend(bubbleLegend, v, config, 'signed');
    Viz.legendRow(ctx, rect, bubbleLegend, { padY: -10 });

    this._registerHover('bubble', {
      mode: 'series', rect, xMin: 0, xMax: totalTicks, yMin, yMax,
      xFmt: x => this._tickHoverFmt(v, config, x),
      series: [
        { name: 'P − FV', color: this.theme.red, points: bridgePts, yFmt: y => (y >= 0 ? '+' : '') + y.toFixed(2) + '¢' },
      ],
    });
  },

  /* -------- Volume-per-period chart -------- */

  renderVolumeChart(v, config) {
    if (!this.charts.volume) return;
    const { ctx, width, height } = this.charts.volume;
    Viz.clear(ctx, width, height);
    // padT 28: extra headroom so the legend can sit above the plot frame
    // instead of inside it. The canvas is only 160px tall, so an in-plot
    // legend would overlap the tallest bars (which are usually green on
    // green and unreadable).
    const rect = Viz.plotRect(width, height, 44, 14, 28, 38);

    // Share the totalTicks coordinate frame with the price and bubble
    // charts so all three row-1 figures anchor periods to the same
    // horizontal positions — across every round in the session.
    const rounds         = config.roundsPerSession || 1;
    const sessionPeriods = rounds * config.periods;
    const totalTicks     = sessionPeriods * config.ticksPerPeriod;
    const xMin = 0, xMax = totalTicks;

    const pts = [];
    for (let g = 1; g <= sessionPeriods; g++) {
      pts.push({
        x: (g - 0.5) * config.ticksPerPeriod,
        y: v.volumeByPeriod[g] || 0,
      });
    }
    const yMax = Math.max(4, ...pts.map(p => p.y)) * 1.1;

    // Alternating period bands — same pattern used by renderPriceChart.
    for (let g = 1; g <= sessionPeriods; g++) {
      if (g % 2 === 0) {
        const x1 = Viz.mapX(rect, (g - 1) * config.ticksPerPeriod, xMin, xMax);
        const x2 = Viz.mapX(rect,  g      * config.ticksPerPeriod, xMin, xMax);
        Viz.verticalBand(ctx, rect, x1, x2, this.theme.band);
      }
    }

    Viz.axes(ctx, rect, {
      xMin, xMax, yMin: 0, yMax,
      xTicks: rounds, yTicks: 4,
      xFmt: x => this._roundLabel(v, config, x),
      yFmt: y => y.toFixed(0),
    });

    const barW = (rect.w / sessionPeriods) * 0.55;
    Viz.bars(ctx, rect, pts, {
      xMin, xMax, yMin: 0, yMax,
      color: this.theme.green,
      barWidth: barW,
    });

    this._drawRoundDividers(ctx, rect, config, xMin, xMax, v);

    Viz.axisLabel(ctx, rect, v.session > 0 ? 'Round R · Session ' + v.session : 'Round R', 'bottom');
    Viz.legendRow(ctx, rect, [
      { color: this.theme.green, label: '▮ shares traded' },
    ], { padY: -10 });

    this._registerHover('volume', {
      mode: 'series', rect, xMin, xMax, yMin: 0, yMax,
      xFmt: x => this._tickHoverFmt(v, config, x),
      series: [
        { name: 'Volume', color: this.theme.green, points: pts, yFmt: y => y.toFixed(0) + ' shares' },
      ],
    });
  },

  /* -------- Price × period trade-density heatmap -------- */

  renderHeatmapChart(v, config) {
    if (!this.charts.heatmap) return;
    const { ctx, width, height } = this.charts.heatmap;
    Viz.clear(ctx, width, height);
    const rect = Viz.plotRect(width, height, 44, 14, 16, 38);

    const rounds         = config.roundsPerSession || 1;
    const sessionPeriods = rounds * config.periods;
    const maxFV    = this._fvPeak(v, config);
    const maxPrice = Math.max(maxFV * 1.4, ...v.trades.map(t => t.price || 0));
    const nCols    = sessionPeriods;
    const nRows    = 10;
    const grid     = Array.from({ length: nRows }, () => new Array(nCols).fill(0));
    let maxCount   = 0;
    for (const t of v.trades) {
      const tRound = t.round || 1;
      const g      = (tRound - 1) * config.periods + t.period;
      const col    = Math.min(nCols - 1, Math.max(0, g - 1));
      const row    = Math.min(nRows - 1, Math.floor((t.price / maxPrice) * nRows));
      grid[row][col] += t.quantity;
      if (grid[row][col] > maxCount) maxCount = grid[row][col];
    }

    const cellW = rect.w / nCols;
    const cellH = rect.h / nRows;

    if (maxCount > 0) {
      for (let r = 0; r < nRows; r++) {
        for (let c = 0; c < nCols; c++) {
          const count = grid[r][c];
          if (count <= 0) continue;
          ctx.fillStyle = Viz.heatColor(count / maxCount);
          const x = rect.x + c * cellW;
          const y = rect.y + (nRows - 1 - r) * cellH;
          ctx.fillRect(x + 1, y + 1, cellW - 2, cellH - 2);
        }
      }
    }
    ctx.strokeStyle = this.theme.frame;
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w, rect.h);

    // Round dividers within the period-indexed grid. The R3→R4
    // boundary gets the same replacement marker as tick-based charts.
    const hasReplacement = (v.events || []).some(e => e.type === 'round_4_replacement');
    if (rounds > 1) {
      ctx.save();
      for (let r = 1; r < rounds; r++) {
        const x = rect.x + r * config.periods * cellW;
        if (r === 3 && hasReplacement) {
          ctx.strokeStyle = this.theme.red;
          ctx.lineWidth   = 1.5;
          ctx.setLineDash([5, 3]);
          ctx.beginPath(); ctx.moveTo(x + 0.5, rect.y); ctx.lineTo(x + 0.5, rect.y + rect.h); ctx.stroke();
          ctx.setLineDash([]);
          ctx.font      = '9px "Helvetica Neue", Helvetica, Arial, sans-serif';
          ctx.fillStyle = this.theme.red;
          ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
          ctx.fillText('R4 swap', x, rect.y - 2);
        } else {
          ctx.strokeStyle = this.theme.frame;
          ctx.lineWidth   = 1;
          ctx.beginPath(); ctx.moveTo(x + 0.5, rect.y); ctx.lineTo(x + 0.5, rect.y + rect.h); ctx.stroke();
        }
      }
      ctx.restore();
    }

    // Price axis labels (left)
    ctx.save();
    ctx.font = '10px "Helvetica Neue", Helvetica, Arial, sans-serif';
    ctx.fillStyle = this.theme.fg3;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let r = 0; r <= nRows; r += 2) {
      const val = (r / nRows) * maxPrice;
      const y   = rect.y + (nRows - r) * cellH;
      ctx.fillText(val.toFixed(0), rect.x - 5, y);
    }
    // Round labels (bottom) — one label per round, centred above that
    // round's block of period columns.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let r = 1; r <= rounds; r++) {
      const mid = (r - 0.5) * config.periods;
      const x   = rect.x + mid * cellW;
      ctx.fillText(this._roundLabel(v, config, (r - 0.5) * config.periods * config.ticksPerPeriod), x, rect.y + rect.h + 6);
    }
    ctx.restore();

    Viz.axisLabel(ctx, rect, v.session > 0 ? 'Round R · Session ' + v.session : 'Round R', 'bottom');

    this._registerHover('heatmap', {
      mode: 'cell', rect,
      cells: {
        cols: nCols, rows: nRows, cellW, cellH,
        lookup: (col, rowDrawn) => {
          const rIdx = nRows - 1 - rowDrawn;
          const g    = col + 1;
          const rn   = Math.floor(col / config.periods) + 1;
          const p    = (col % config.periods) + 1;
          const pLo  = (rIdx      / nRows) * maxPrice;
          const pHi  = ((rIdx + 1) / nRows) * maxPrice;
          const stamp = v.session > 0 ? `R${rn}_S${v.session}` : `R${rn}`;
          return {
            header: `${stamp} · P${p}`,
            rows: [
              { name: 'Price bin', color: this.theme.fg2,   value: `${pLo.toFixed(0)}–${pHi.toFixed(0)}¢` },
              { name: 'Volume',    color: this.theme.green, value: `${grid[rIdx][col] || 0} shares` },
            ],
          };
        },
      },
    });
  },

  /* -------- Agent action timeline -------- */

  renderTimelineChart(v, config) {
    if (!this.charts.timeline) return;
    const { ctx, width, height } = this.charts.timeline;
    Viz.clear(ctx, width, height);
    const ids     = Object.keys(v.agents).map(Number).sort((a, b) => a - b);
    const nA      = Math.max(1, ids.length);
    const compact = nA > UI.FAN_THRESHOLD;
    // Large populations drop the per-row name gutter (unreadable at
    // rowH ≈ 2–3 px) and a few sparse tick labels take its place.
    const padL    = compact ? 30 : 66;
    const rect    = Viz.plotRect(width, height, padL, 14, 16, 38);

    const rounds         = config.roundsPerSession || 1;
    const sessionPeriods = rounds * config.periods;
    const totalTicks     = sessionPeriods * config.ticksPerPeriod;
    const rowH           = rect.h / nA;

    // Row backgrounds + (optional) agent name labels.
    ctx.save();
    ctx.font = '10px "Helvetica Neue", Helvetica, Arial, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign    = 'right';
    for (let i = 0; i < nA; i++) {
      const y = rect.y + i * rowH;
      if (i % 2 === 0) {
        ctx.fillStyle = this.theme.stripe;
        ctx.fillRect(rect.x, y, rect.w, rowH);
      }
      if (!compact) {
        ctx.fillStyle = this.agentColor(ids[i]);
        ctx.fillText(v.agents[ids[i]]?.name || ('A' + ids[i]), rect.x - 6, y + rowH / 2);
      }
    }
    if (compact) {
      // Sparse y-axis ticks: first, last, and every ~10% of the roster.
      ctx.fillStyle = this.theme.fg3;
      const stride = Math.max(1, Math.floor(nA / 10));
      for (let i = 0; i < nA; i += stride) {
        ctx.fillText('#' + ids[i], rect.x - 6, rect.y + (i + 0.5) * rowH);
      }
      ctx.fillText('#' + ids[nA - 1], rect.x - 6, rect.y + (nA - 0.5) * rowH);
    }
    ctx.strokeStyle = this.theme.frame;
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w, rect.h);
    ctx.restore();

    // Period separators across every round in the session, then heavier
    // round dividers on top so the eye can pick out round boundaries.
    ctx.save();
    ctx.strokeStyle = this.theme.grid;
    for (let g = 1; g < sessionPeriods; g++) {
      const x = Viz.mapX(rect, g * config.ticksPerPeriod, 0, totalTicks);
      ctx.beginPath();
      ctx.moveTo(x, rect.y);
      ctx.lineTo(x, rect.y + rect.h);
      ctx.stroke();
    }
    ctx.restore();
    this._drawRoundDividers(ctx, rect, config, 0, totalTicks, v);

    // One rect per agent decision, colored by action class. The five
    // classes match the EU candidate set in UtilityAgent.evaluate():
    // hold, cross-bid (aggressive buy), cross-ask (aggressive sell),
    // passive bid (resting limit buy), passive ask (resting limit sell).
    const actionColor = this._actionColor.bind(this);
    const mW          = Math.max(1.6, (rect.w / totalTicks) * 0.85);

    for (const tr of v.traces) {
      const rowIdx = ids.indexOf(tr.agentId);
      if (rowIdx < 0) continue;
      const x = Viz.mapX(rect, tr.timestamp, 0, totalTicks);
      const y = rect.y + rowIdx * rowH + rowH * 0.28;
      const h = rowH * 0.44;
      ctx.fillStyle = actionColor(tr.decision);
      ctx.fillRect(x - mW / 2, y, mW, h);
      if (tr.filled > 0) {
        ctx.fillStyle = this.theme.accent;
        ctx.beginPath();
        ctx.arc(x, y + h + 3, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // X labels — one R label per round, centred under that round's
    // block of ticks. Period-level labels would crowd a 4-round
    // session so we elide them.
    ctx.save();
    ctx.font = '10px "Helvetica Neue", Helvetica, Arial, sans-serif';
    ctx.fillStyle = this.theme.fg3;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let r = 1; r <= rounds; r++) {
      const mid = (r - 0.5) * config.periods * config.ticksPerPeriod;
      const x   = Viz.mapX(rect, mid, 0, totalTicks);
      ctx.fillText(this._roundLabel(v, config, mid), x, rect.y + rect.h + 6);
    }
    ctx.restore();

    Viz.axisLabel(ctx, rect, v.session > 0 ? 'Round R · Session ' + v.session : 'Round R', 'bottom');

    this._registerHover('timeline', {
      mode: 'row', rect, xMin: 0, xMax: totalTicks,
      rows: {
        ids, rowH,
        lookup: (rowIdx, xVal) => {
          if (rowIdx < 0 || rowIdx >= ids.length) return null;
          const id = ids[rowIdx];
          const tol = Math.max(1, config.ticksPerPeriod * 0.4);
          let best = null, bestD = Infinity;
          for (const tr of v.traces) {
            if (tr.agentId !== id) continue;
            const d = Math.abs(tr.timestamp - xVal);
            if (d < bestD && d <= tol) { bestD = d; best = tr; }
          }
          const a    = v.agents[id];
          const name = (a && a.name) || ('U' + id);
          if (!best) {
            return { header: `${name} · ${this._tickHoverFmt(v, config, xVal)}`, rows: [
              { name: 'decision', color: this.theme.fg3, value: '—' },
            ]};
          }
          const price = best.decision && best.decision.price;
          const qty   = best.decision && best.decision.quantity;
          return {
            header: `${name} · ${this._tickHoverFmt(v, config, best.timestamp)}`,
            rows: [
              { name: 'decision', color: this._actionColor(best.decision), value: this._actionLabel(best.decision) },
              ...(price != null ? [{ name: 'price', color: this.theme.fg2, value: price.toFixed(2) + '¢' }] : []),
              ...(qty   != null ? [{ name: 'qty',   color: this.theme.fg2, value: String(qty) }] : []),
              ...(best.filled ? [{ name: 'filled', color: this.theme.accent, value: best.filled + '' }] : []),
            ],
          };
        },
      },
    });
  },

  /* ============================================================
     Extended panels (utility experiment mode).
     Each panel is a no-op when its canvas is missing/hidden or
     when the required data array is empty — legacy populations
     render nothing from these methods.
     ============================================================ */

  /* -------- Valuation chart: true vs reported over time -------- */
  renderValuationChart(v, config) {
    const chart = this.charts.valuation;
    if (!chart) return;
    const { ctx, width, height } = chart;
    Viz.clear(ctx, width, height);
    const rect = Viz.plotRect(width, height, 44, 14, 16, 38);

    const totalTicks = (config.roundsPerSession || 1) * config.periods * config.ticksPerPeriod;
    const hist       = v.valuationHistory || [];
    const byAgent    = {};
    for (const row of hist) {
      if (!byAgent[row.agentId]) byAgent[row.agentId] = [];
      byAgent[row.agentId].push({ x: row.tick, y: row.subjV });
    }

    let yMax = this._fvPeak(v, config) * 1.4;
    for (const row of hist) {
      if (row.subjV != null && row.subjV > yMax) yMax = row.subjV;
    }
    if (v.messages && v.messages.length) {
      for (const m of v.messages) {
        if (m.claimedValuation > yMax) yMax = m.claimedValuation;
      }
    }
    yMax = Math.max(10, yMax * 1.08);

    Viz.axes(ctx, rect, {
      xMin: 0, xMax: totalTicks, yMin: 0, yMax,
      xTicks: config.roundsPerSession || 1, yTicks: 4,
      xFmt: x => this._roundLabel(v, config, x),
      yFmt: y => y.toFixed(0),
    });

    // Dashed FV reference saw-tooth — resets to maxFV at every round
    // boundary so the line mirrors the price chart's saw-tooth across
    // the full session.
    const sessionPeriodsVal = (config.roundsPerSession || 1) * config.periods;
    const fvPoints = [];
    for (let g = 1; g <= sessionPeriodsVal; g++) {
      const localP = ((g - 1) % config.periods) + 1;
      const localR = Math.floor((g - 1) / config.periods) + 1;
      const fv     = UI._fvAtRound(localR, localP, config);
      fvPoints.push({ x: (g - 1) * config.ticksPerPeriod, y: fv });
      fvPoints.push({ x:  g      * config.ticksPerPeriod, y: fv });
    }
    Viz.line(ctx, rect, fvPoints, { xMin: 0, xMax: totalTicks, yMin: 0, yMax, color: this.theme.amber, width: 2, dashed: true });

    this._drawRoundDividers(ctx, rect, config, 0, totalTicks, v);

    // Small populations (≤ 12) render one line per agent with a per-
    // agent legend. For larger populations the per-agent traces
    // degenerate to visual noise, so collapse the population into a
    // fan chart (P10/P90 envelope + P25/P75 IQR + median).
    const ids     = Object.keys(byAgent).map(Number).sort((a, b) => a - b);
    const nAgents = Object.keys(v.agents || {}).length || ids.length;
    const useFan  = nAgents > UI.FAN_THRESHOLD;

    if (useFan) {
      const buckets = Viz.bucketByX(hist, 'tick', 'subjV');
      Viz.fanChart(ctx, rect, buckets, {
        xMin: 0, xMax: totalTicks, yMin: 0, yMax,
        colorEnv:    this._fanColor(this.theme.accent, 0.14),
        colorIQR:    this._fanColor(this.theme.accent, 0.30),
        colorMedian: this.theme.accent,
        widthMedian: 2,
      });
    } else {
      for (const id of ids) {
        Viz.line(ctx, rect, byAgent[id], { xMin: 0, xMax: totalTicks, yMin: 0, yMax, color: this.agentColor(id), width: 1.6 });
      }
    }

    // Reported-valuation markers. Deceptive messages are ringed red
    // and connected to the sender's true valuation by a dotted line,
    // so you can see the "lie gap" directly. Skipped in fan mode where
    // thousands of dots would swamp the IQR signal.
    const msgs = v.messages || [];
    if (!useFan && msgs.length) {
      ctx.save();
      for (const m of msgs) {
        const x     = Viz.mapX(rect, m.tick, 0, totalTicks);
        const yRep  = Viz.mapY(rect, m.claimedValuation, 0, yMax);
        ctx.fillStyle = this.agentColor(m.senderId);
        ctx.beginPath(); ctx.arc(x, yRep, 3, 0, Math.PI * 2); ctx.fill();
        if (m.deceptive) {
          const yTrue = Viz.mapY(rect, m.trueValuation, 0, yMax);
          ctx.strokeStyle = this.theme.red;
          ctx.setLineDash([2, 2]);
          ctx.beginPath(); ctx.moveTo(x, yRep); ctx.lineTo(x, yTrue); ctx.stroke();
          ctx.setLineDash([]);
          ctx.strokeStyle = this.theme.red;
          ctx.beginPath(); ctx.arc(x, yRep, 5, 0, Math.PI * 2); ctx.stroke();
        }
      }
      ctx.restore();
    }

    // Legend row. Each entry's horizontal advance is measured from the
    // rendered text so longer agent names can't overlap the next label.
    ctx.save();
    ctx.font = '10px "Helvetica Neue", Helvetica, Arial, sans-serif';
    ctx.textBaseline = 'middle';
    const gap = 12;
    const y   = rect.y + 12;
    let legendX = rect.x + 10;
    const drawEntry = (label, color) => {
      ctx.fillStyle = color;
      ctx.fillText(label, legendX, y);
      legendX += ctx.measureText(label).width + gap;
    };
    drawEntry('▬ FVₜ', this.theme.amber);
    if (useFan) {
      drawEntry('▬ median V̂ᵢ,ₜ', this.theme.accent);
      drawEntry('▮ IQR · envelope', this._fanColor(this.theme.accent, 0.50));
    } else {
      drawEntry('▬ V̂ᵢ,ₜ', this.theme.fg2);
      for (const id of ids) {
        const name = v.agents[id] ? v.agents[id].name : 'U' + id;
        drawEntry('● ' + name, this.agentColor(id));
      }
      drawEntry('○ Ṽ ≠ V̂  (lie gap)', this.theme.red);
    }
    ctx.restore();

    Viz.axisLabel(ctx, rect, v.session > 0 ? 'Round R · Session ' + v.session : 'Round R', 'bottom');

    this._registerHover('valuation', {
      mode: 'multi', rect, xMin: 0, xMax: totalTicks, yMin: 0, yMax,
      xFmt: x => this._tickHoverFmt(v, config, x),
      buckets: Viz.bucketByX(hist, 'tick', 'subjV'),
      color:   this.theme.accent,
      ysFmt:   y => y.toFixed(2) + '¢',
      baseSeries: [
        { name: 'FV', color: this.theme.amber, points: fvPoints, yFmt: y => y.toFixed(2) + '¢' },
      ],
    });
  },

  /* -------- Utility-over-time chart -------- */
  renderUtilityChart(v, config) {
    const chart = this.charts.utility;
    if (!chart) return;
    const { ctx, width, height } = chart;
    Viz.clear(ctx, width, height);
    const rect = Viz.plotRect(width, height, 44, 14, 16, 38);

    const totalTicks = (config.roundsPerSession || 1) * config.periods * config.ticksPerPeriod;
    const hist       = v.utilityHistory || [];
    const byAgent    = {};
    for (const row of hist) {
      if (!byAgent[row.agentId]) byAgent[row.agentId] = [];
      byAgent[row.agentId].push({ x: row.tick, y: row.utility });
    }

    let yMin = 0.7, yMax = 1.3;
    for (const row of hist) {
      if (row.utility != null) {
        if (row.utility < yMin) yMin = row.utility;
        if (row.utility > yMax) yMax = row.utility;
      }
    }
    const span = Math.max(0.2, yMax - yMin);
    yMin = Math.max(0, yMin - span * 0.1);
    yMax = yMax + span * 0.1;

    Viz.axes(ctx, rect, {
      xMin: 0, xMax: totalTicks, yMin, yMax,
      xTicks: config.roundsPerSession || 1, yTicks: 4,
      xFmt: x => this._roundLabel(v, config, x),
      yFmt: y => y.toFixed(2),
    });

    // Baseline at U = 1.0 (each agent's initial utility).
    const baseY = Viz.mapY(rect, 1, yMin, yMax);
    ctx.save();
    ctx.strokeStyle = this.theme.fg3;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(rect.x, baseY); ctx.lineTo(rect.x + rect.w, baseY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    this._drawRoundDividers(ctx, rect, config, 0, totalTicks, v);

    // Large populations collapse into a fan chart (same shape as the
    // valuation chart); small populations keep per-agent lines.
    const ids     = Object.keys(byAgent).map(Number).sort((a, b) => a - b);
    const nAgents = Object.keys(v.agents || {}).length || ids.length;
    if (nAgents > UI.FAN_THRESHOLD) {
      const buckets = Viz.bucketByX(hist, 'tick', 'utility');
      Viz.fanChart(ctx, rect, buckets, {
        xMin: 0, xMax: totalTicks, yMin, yMax,
        colorEnv:    this._fanColor(this.theme.accent, 0.14),
        colorIQR:    this._fanColor(this.theme.accent, 0.30),
        colorMedian: this.theme.accent,
        widthMedian: 2,
      });
      ctx.save();
      ctx.font = '10px "Helvetica Neue", Helvetica, Arial, sans-serif';
      ctx.textBaseline = 'middle';
      const y = rect.y + 12;
      let legendX = rect.x + 10;
      const drawEntry = (label, color) => {
        ctx.fillStyle = color;
        ctx.fillText(label, legendX, y);
        legendX += ctx.measureText(label).width + 12;
      };
      drawEntry('▬ median Uᵢ(w)', this.theme.accent);
      drawEntry('▮ IQR · envelope', this._fanColor(this.theme.accent, 0.50));
      drawEntry('⋯ U = 1 (initial)', this.theme.fg3);
      ctx.restore();
    } else {
      for (const id of ids) {
        Viz.line(ctx, rect, byAgent[id], { xMin: 0, xMax: totalTicks, yMin, yMax, color: this.agentColor(id), width: 1.6 });
      }
    }

    Viz.axisLabel(ctx, rect, v.session > 0 ? 'Round R · Session ' + v.session : 'Round R', 'bottom');

    this._registerHover('utility', {
      mode: 'multi', rect, xMin: 0, xMax: totalTicks, yMin, yMax,
      xFmt: x => this._tickHoverFmt(v, config, x),
      buckets: Viz.bucketByX(hist, 'tick', 'utility'),
      color:   this.theme.accent,
      ysFmt:   y => y.toFixed(3),
    });
  },

  /* -------- P&L-over-time chart (Figure 11) --------
     One line per agent of running mark-to-market P&L in cents.
     Source: utilityHistory rows {tick, agentId, wealth} minus each
     agent's snapshotted initialWealth. Symmetrical y-axis around the
     zero baseline so gains and losses are visually comparable. */
  renderPnlChart(v, config) {
    const chart = this.charts.pnl;
    if (!chart) return;
    const { ctx, width, height } = chart;
    Viz.clear(ctx, width, height);
    const rect = Viz.plotRect(width, height, 52, 14, 16, 38);

    const totalTicks = (config.roundsPerSession || 1) * config.periods * config.ticksPerPeriod;
    const hist       = v.utilityHistory || [];
    const initialOf  = {};
    for (const [id, a] of Object.entries(v.agents || {})) {
      if (a && a.initialWealth != null) initialOf[id] = a.initialWealth;
    }

    const byAgent  = {};
    const flatPnls = [];
    for (const row of hist) {
      const w0 = initialOf[row.agentId];
      if (w0 == null || row.wealth == null) continue;
      const pnl = row.wealth - w0;
      if (!byAgent[row.agentId]) byAgent[row.agentId] = [];
      byAgent[row.agentId].push({ x: row.tick, y: pnl });
      flatPnls.push(pnl);
    }

    let absMax = 100;
    for (const p of flatPnls) {
      const a = Math.abs(p);
      if (a > absMax) absMax = a;
    }
    absMax = absMax * 1.1;
    const yMin = -absMax, yMax = absMax;

    Viz.axes(ctx, rect, {
      xMin: 0, xMax: totalTicks, yMin, yMax,
      xTicks: config.roundsPerSession || 1, yTicks: 4,
      xFmt: x => this._roundLabel(v, config, x),
      yFmt: y => (y >= 0 ? '+' : '') + y.toFixed(0),
    });

    // Zero baseline.
    const baseY = Viz.mapY(rect, 0, yMin, yMax);
    ctx.save();
    ctx.strokeStyle = this.theme.fg3;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(rect.x, baseY); ctx.lineTo(rect.x + rect.w, baseY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    this._drawRoundDividers(ctx, rect, config, 0, totalTicks, v);

    const ids     = Object.keys(byAgent).map(Number).sort((a, b) => a - b);
    const nAgents = Object.keys(v.agents || {}).length || ids.length;
    if (nAgents > UI.FAN_THRESHOLD) {
      // Re-bucket the derived P&L series for the fan view, keyed on
      // tick. The shared `bucketByX` helper expects the field name
      // present on each row, so synthesize a flat array first.
      const flat = [];
      for (const id of ids) for (const p of byAgent[id]) flat.push({ tick: p.x, pnl: p.y });
      const buckets = Viz.bucketByX(flat, 'tick', 'pnl');
      Viz.fanChart(ctx, rect, buckets, {
        xMin: 0, xMax: totalTicks, yMin, yMax,
        colorEnv:    this._fanColor(this.theme.accent, 0.14),
        colorIQR:    this._fanColor(this.theme.accent, 0.30),
        colorMedian: this.theme.accent,
        widthMedian: 2,
      });
      ctx.save();
      ctx.font = '10px "Helvetica Neue", Helvetica, Arial, sans-serif';
      ctx.textBaseline = 'middle';
      const y = rect.y + 12;
      let legendX = rect.x + 10;
      const drawEntry = (label, color) => {
        ctx.fillStyle = color;
        ctx.fillText(label, legendX, y);
        legendX += ctx.measureText(label).width + 12;
      };
      drawEntry('▬ median Δw', this.theme.accent);
      drawEntry('▮ IQR · envelope', this._fanColor(this.theme.accent, 0.50));
      drawEntry('⋯ Δw = 0 (break-even)', this.theme.fg3);
      ctx.restore();
    } else {
      for (const id of ids) {
        Viz.line(ctx, rect, byAgent[id], { xMin: 0, xMax: totalTicks, yMin, yMax, color: this.agentColor(id), width: 1.6 });
      }
    }

    Viz.axisLabel(ctx, rect, v.session > 0 ? 'Round R · Session ' + v.session : 'Round R', 'bottom');

    const pnlFlat = [];
    for (const id of ids) for (const p of byAgent[id]) pnlFlat.push({ tick: p.x, pnl: p.y });
    this._registerHover('pnl', {
      mode: 'multi', rect, xMin: 0, xMax: totalTicks, yMin, yMax,
      xFmt: x => this._tickHoverFmt(v, config, x),
      buckets: Viz.bucketByX(pnlFlat, 'tick', 'pnl'),
      color:   this.theme.accent,
      ysFmt:   y => (y >= 0 ? '+' : '') + y.toFixed(1) + '¢',
    });
  },

  /* -------- Subjective-valuation per-agent chart (Figure 12) --------
     Cleaner cousin of Figure 6: per-agent V̂ trajectories without the
     reported-message dots and lie-gap overlays. Reads the same
     valuationHistory stream and overlays the dashed FV saw-tooth as
     a fundamental-value reference. */
  renderSubjvChart(v, config) {
    const chart = this.charts.subjv;
    if (!chart) return;
    const { ctx, width, height } = chart;
    Viz.clear(ctx, width, height);
    const rect = Viz.plotRect(width, height, 44, 14, 16, 38);

    const totalTicks = (config.roundsPerSession || 1) * config.periods * config.ticksPerPeriod;
    const hist       = v.valuationHistory || [];
    const byAgent    = {};
    for (const row of hist) {
      if (row.subjV == null) continue;
      if (!byAgent[row.agentId]) byAgent[row.agentId] = [];
      byAgent[row.agentId].push({ x: row.tick, y: row.subjV });
    }

    let yMax = this._fvPeak(v, config) * 1.4;
    for (const row of hist) {
      if (row.subjV != null && row.subjV > yMax) yMax = row.subjV;
    }
    yMax = Math.max(10, yMax * 1.08);

    Viz.axes(ctx, rect, {
      xMin: 0, xMax: totalTicks, yMin: 0, yMax,
      xTicks: config.roundsPerSession || 1, yTicks: 4,
      xFmt: x => this._roundLabel(v, config, x),
      yFmt: y => y.toFixed(0),
    });

    // Dashed FV saw-tooth — same reference series as Figure 6.
    const sessionPeriods = (config.roundsPerSession || 1) * config.periods;
    const fvPoints = [];
    for (let g = 1; g <= sessionPeriods; g++) {
      const localP = ((g - 1) % config.periods) + 1;
      const localR = Math.floor((g - 1) / config.periods) + 1;
      const fv     = UI._fvAtRound(localR, localP, config);
      fvPoints.push({ x: (g - 1) * config.ticksPerPeriod, y: fv });
      fvPoints.push({ x:  g      * config.ticksPerPeriod, y: fv });
    }
    Viz.line(ctx, rect, fvPoints, { xMin: 0, xMax: totalTicks, yMin: 0, yMax, color: this.theme.amber, width: 2, dashed: true });

    this._drawRoundDividers(ctx, rect, config, 0, totalTicks, v);

    const ids     = Object.keys(byAgent).map(Number).sort((a, b) => a - b);
    const nAgents = Object.keys(v.agents || {}).length || ids.length;
    if (nAgents > UI.FAN_THRESHOLD) {
      const buckets = Viz.bucketByX(hist, 'tick', 'subjV');
      Viz.fanChart(ctx, rect, buckets, {
        xMin: 0, xMax: totalTicks, yMin: 0, yMax,
        colorEnv:    this._fanColor(this.theme.accent, 0.14),
        colorIQR:    this._fanColor(this.theme.accent, 0.30),
        colorMedian: this.theme.accent,
        widthMedian: 2,
      });
      ctx.save();
      ctx.font = '10px "Helvetica Neue", Helvetica, Arial, sans-serif';
      ctx.textBaseline = 'middle';
      const y = rect.y + 12;
      let legendX = rect.x + 10;
      const drawEntry = (label, color) => {
        ctx.fillStyle = color;
        ctx.fillText(label, legendX, y);
        legendX += ctx.measureText(label).width + 12;
      };
      drawEntry('▬ FVₜ', this.theme.amber);
      drawEntry('▬ median V̂ᵢ,ₜ', this.theme.accent);
      drawEntry('▮ IQR · envelope', this._fanColor(this.theme.accent, 0.50));
      ctx.restore();
    } else {
      for (const id of ids) {
        Viz.line(ctx, rect, byAgent[id], { xMin: 0, xMax: totalTicks, yMin: 0, yMax, color: this.agentColor(id), width: 1.6 });
      }
    }

    Viz.axisLabel(ctx, rect, v.session > 0 ? 'Round R · Session ' + v.session : 'Round R', 'bottom');

    this._registerHover('subjv', {
      mode: 'multi', rect, xMin: 0, xMax: totalTicks, yMin: 0, yMax,
      xFmt: x => this._tickHoverFmt(v, config, x),
      buckets: Viz.bucketByX(hist, 'tick', 'subjV'),
      color:   this.theme.accent,
      ysFmt:   y => y.toFixed(2) + '¢',
      baseSeries: [
        { name: 'FV', color: this.theme.amber, points: fvPoints, yFmt: y => y.toFixed(2) + '¢' },
      ],
    });
  },

  /* -------- Messages timeline -------- */
  renderMessagesChart(v, config) {
    const chart = this.charts.messages;
    if (!chart) return;
    const { ctx, width, height } = chart;
    Viz.clear(ctx, width, height);

    const ids     = Object.keys(v.agents).map(Number).sort((a, b) => a - b);
    const nA      = Math.max(1, ids.length);
    // At the shared 420 px height, N = 100 gives ~4 px rows — too tight
    // for per-agent names. Fall back to strided numeric ticks like
    // Figure 10 (Trust) once we pass the fan threshold so the two
    // figures read as a pair.
    const compact = nA > UI.FAN_THRESHOLD;
    const padL    = compact ? 30 : 66;
    const rect    = Viz.plotRect(width, height, padL, 14, 16, 38);

    const rounds         = config.roundsPerSession || 1;
    const sessionPeriods = rounds * config.periods;
    const totalTicks     = sessionPeriods * config.ticksPerPeriod;
    const rowH           = rect.h / nA;

    ctx.save();
    ctx.font = '10px "Helvetica Neue", Helvetica, Arial, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign    = 'right';
    for (let i = 0; i < nA; i++) {
      const y = rect.y + i * rowH;
      if (i % 2 === 0) {
        ctx.fillStyle = this.theme.stripe;
        ctx.fillRect(rect.x, y, rect.w, rowH);
      }
      if (!compact) {
        ctx.fillStyle = this.agentColor(ids[i]);
        const name = v.agents[ids[i]] ? v.agents[ids[i]].name : 'U' + ids[i];
        ctx.fillText(name, rect.x - 6, y + rowH / 2);
      }
    }
    if (compact) {
      ctx.fillStyle = this.theme.fg3;
      const stride = Math.max(1, Math.floor(nA / 10));
      for (let i = 0; i < nA; i += stride) {
        ctx.fillText('#' + ids[i], rect.x - 6, rect.y + (i + 0.5) * rowH);
      }
      ctx.fillText('#' + ids[nA - 1], rect.x - 6, rect.y + (nA - 0.5) * rowH);
    }
    ctx.strokeStyle = this.theme.frame;
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w, rect.h);
    ctx.restore();

    // Period separators across the whole session, with heavier round
    // dividers laid on top.
    ctx.save();
    ctx.strokeStyle = this.theme.grid;
    for (let g = 1; g < sessionPeriods; g++) {
      const x = Viz.mapX(rect, g * config.ticksPerPeriod, 0, totalTicks);
      ctx.beginPath(); ctx.moveTo(x, rect.y); ctx.lineTo(x, rect.y + rect.h); ctx.stroke();
    }
    ctx.restore();
    this._drawRoundDividers(ctx, rect, config, 0, totalTicks, v);

    // Messages: one dot per broadcast, colored by signal, ringed red if deceptive.
    const msgs = v.messages || [];
    for (const m of msgs) {
      const rowIdx = ids.indexOf(m.senderId);
      if (rowIdx < 0) continue;
      const x = Viz.mapX(rect, m.tick, 0, totalTicks);
      const y = rect.y + rowIdx * rowH + rowH / 2;
      const sigColor = m.signal === 'buy' ? this.theme.green
                     : m.signal === 'sell' ? this.theme.red
                     : this.theme.fg2;
      ctx.fillStyle = sigColor;
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
      if (m.deceptive) {
        ctx.strokeStyle = this.theme.red;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.stroke();
        ctx.lineWidth = 1;
      }
    }

    // X labels — one R label per round.
    ctx.save();
    ctx.font = '10px "Helvetica Neue", Helvetica, Arial, sans-serif';
    ctx.fillStyle = this.theme.fg3;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let r = 1; r <= rounds; r++) {
      const mid = (r - 0.5) * config.periods * config.ticksPerPeriod;
      const x   = Viz.mapX(rect, mid, 0, totalTicks);
      ctx.fillText(this._roundLabel(v, config, mid), x, rect.y + rect.h + 6);
    }
    ctx.restore();

    Viz.axisLabel(ctx, rect, v.session > 0 ? 'Round R · Session ' + v.session : 'Round R', 'bottom');

    this._registerHover('messages', {
      mode: 'row', rect, xMin: 0, xMax: totalTicks,
      rows: {
        ids, rowH,
        lookup: (rowIdx, xVal) => {
          if (rowIdx < 0 || rowIdx >= ids.length) return null;
          const id = ids[rowIdx];
          const tol = Math.max(1, config.ticksPerPeriod * 0.5);
          let best = null, bestD = Infinity;
          for (const m of msgs) {
            if (m.senderId !== id) continue;
            const d = Math.abs(m.tick - xVal);
            if (d < bestD && d <= tol) { bestD = d; best = m; }
          }
          const a    = v.agents[id];
          const name = (a && a.name) || ('U' + id);
          if (!best) {
            return { header: `${name} · ${this._tickHoverFmt(v, config, xVal)}`, rows: [
              { name: 'message', color: this.theme.fg3, value: '—' },
            ]};
          }
          const sigColor = best.signal === 'buy' ? this.theme.green
                         : best.signal === 'sell' ? this.theme.red
                         : this.theme.fg2;
          return {
            header: `${name} · ${this._tickHoverFmt(v, config, best.tick)}`,
            rows: [
              { name: 'signal', color: sigColor, value: best.signal || '—' },
              ...(best.claimedValuation != null ? [{ name: 'reported V', color: this.theme.amber, value: best.claimedValuation.toFixed(2) + '¢' }] : []),
              ...(best.trueValuation    != null ? [{ name: 'true V',     color: this.theme.accent, value: best.trueValuation.toFixed(2) + '¢' }] : []),
              ...(best.deceptive ? [{ name: 'deceptive', color: this.theme.red, value: '✓' }] : []),
            ],
          };
        },
      },
    });
  },

  /* -------- Trust matrix heatmap -------- */
  renderTrustChart(v, config) {
    const chart = this.charts.trust;
    if (!chart) return;
    const { ctx, width, height } = chart;
    Viz.clear(ctx, width, height);

    const agentIds = Object.keys(v.agents).map(Number).sort((a, b) => a - b);
    const n = agentIds.length;
    if (!n) return;
    // Large rosters show numeric id ticks every ~10th agent instead of
    // a solid name wall down each axis (which would be illegible at
    // cellH ≈ 3 px).
    const compact = n > UI.FAN_THRESHOLD;
    const padL    = compact ? 30 : 66;
    // padB must clear the tick row (y = rect.y + rect.h + 6) AND the
    // axisLabel('sender', 'bottom') glyph which Viz draws 34 px below
    // the plot. A 30 px pad clipped the label; 44 px leaves headroom.
    const padB    = compact ? 44 : 44;
    const rect    = Viz.plotRect(width, height, padL, 12, 14, padB);

    const cellW = rect.w / n;
    const cellH = rect.h / n;
    const trust = v.trust || null;
    // With sub-pixel cells (N = 100 → ~2-3 px) the 1-px grid inset
    // would produce negative-sized fillRects that draw backwards and
    // leave half the matrix blank. Only apply the inset once cells are
    // thick enough to show a gap.
    const inset = (cellW >= 4 && cellH >= 4) ? 1 : 0;
    const cw    = Math.max(0.5, cellW - inset * 2);
    const ch    = Math.max(0.5, cellH - inset * 2);

    for (let i = 0; i < n; i++) {          // i = receiver (row)
      for (let j = 0; j < n; j++) {        // j = sender   (col)
        const r = agentIds[i];
        const s = agentIds[j];
        const val = trust && trust[r] && trust[r][s] != null ? trust[r][s] : 0.5;
        const x = rect.x + j * cellW;
        const y = rect.y + i * cellH;
        if (r === s) {
          ctx.fillStyle = this.theme.stripe;
          ctx.fillRect(x + inset, y + inset, cw, ch);
        } else {
          ctx.fillStyle = Viz.heatColor(val);
          ctx.fillRect(x + inset, y + inset, cw, ch);
          if (cellW > 24 && cellH > 18) {
            ctx.fillStyle = this.theme.fg0;
            ctx.font = '10px "Helvetica Neue", Helvetica, Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(val.toFixed(2), x + cellW / 2, y + cellH / 2);
          }
        }
      }
    }
    ctx.strokeStyle = this.theme.frame;
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w, rect.h);

    // Axis labels.
    ctx.save();
    ctx.font = '10px "Helvetica Neue", Helvetica, Arial, sans-serif';
    ctx.fillStyle = this.theme.fg3;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    // Build the set of tick indices once: regularly spaced at ~n/10
    // plus the final row/column so the chart doesn't look truncated
    // at #91 when the last id is #100.
    const tickIdx = (() => {
      if (!compact) return null;
      const stride = Math.max(1, Math.floor(n / 10));
      const set = new Set();
      for (let k = 0; k < n; k += stride) set.add(k);
      set.add(n - 1);
      // Drop a penultimate tick if it would collide visually with the
      // forced last tick (closer than half a stride).
      if (set.has(n - 1) && set.has(n - 1 - (stride - 1)) && stride > 1) {
        const second = [...set].sort((a, b) => b - a)[1];
        if (n - 1 - second < Math.ceil(stride / 2)) set.delete(second);
      }
      return [...set].sort((a, b) => a - b);
    })();

    if (compact) {
      for (const i of tickIdx) {
        ctx.fillText('#' + agentIds[i], rect.x - 4, rect.y + (i + 0.5) * cellH);
      }
    } else {
      for (let i = 0; i < n; i++) {
        const name = v.agents[agentIds[i]] ? v.agents[agentIds[i]].name : 'U' + agentIds[i];
        ctx.fillText(name, rect.x - 4, rect.y + i * cellH + cellH / 2);
      }
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    if (compact) {
      for (const j of tickIdx) {
        ctx.fillText('#' + agentIds[j], rect.x + (j + 0.5) * cellW, rect.y + rect.h + 6);
      }
    } else {
      for (let j = 0; j < n; j++) {
        const name = v.agents[agentIds[j]] ? v.agents[agentIds[j]].name : 'U' + agentIds[j];
        ctx.fillText(name, rect.x + j * cellW + cellW / 2, rect.y + rect.h + 6);
      }
    }
    ctx.restore();

    Viz.axisLabel(ctx, rect, 'sender', 'bottom');

    const agents = v.agents || {};
    const nameOf = id => (agents[id] && agents[id].name) || ('U' + id);
    this._registerHover('trust', {
      mode: 'cell', rect,
      cells: {
        cols: n, rows: n, cellW, cellH,
        lookup: (col, row) => {
          const rId = agentIds[row];
          const sId = agentIds[col];
          if (rId === sId) {
            return { header: `${nameOf(rId)} → self`, rows: [
              { name: '(diagonal)', color: this.theme.fg3, value: '—' },
            ]};
          }
          const val = trust && trust[rId] && trust[rId][sId] != null ? trust[rId][sId] : 0.5;
          return {
            header: `${nameOf(sId)} → ${nameOf(rId)}`,
            rows: [
              { name: 'trust',    color: Viz.heatColor(val), value: val.toFixed(3) },
              { name: 'sender',   color: this.agentColor(sId), value: nameOf(sId) },
              { name: 'receiver', color: this.agentColor(rId), value: nameOf(rId) },
            ],
          };
        },
      },
    });
  },

  /* -------- Ownership over time (stacked) -------- */
  renderOwnershipChart(v, config) {
    const chart = this.charts.ownership;
    if (!chart) return;
    const { ctx, width, height } = chart;
    Viz.clear(ctx, width, height);
    // padT 28 leaves room for the in-plot legend row above the chart.
    const rect = Viz.plotRect(width, height, 44, 14, 28, 38);

    const rounds      = config.roundsPerSession || 1;
    const ticksPerRnd = config.periods * config.ticksPerPeriod;
    const totalTicks  = rounds * ticksPerRnd;
    const ids         = Object.keys(v.agents).map(Number).sort((a, b) => a - b);
    const n           = ids.length;
    if (!n) return;

    // Per-agent initial inventory comes from the spec captured at draw
    // time (sampleAgents pulls from {2,3,4}); fall back to 3 only if
    // the view doesn't carry the field for legacy snapshots.
    const initialInv = {};
    let totalShares  = 0;
    for (const id of ids) {
      const inv = v.agents[id] && v.agents[id].initialInventory != null
        ? v.agents[id].initialInventory
        : 3;
      initialInv[id] = inv;
      totalShares   += inv;
    }
    const yMax = Math.max(totalShares, totalShares + 2);

    Viz.axes(ctx, rect, {
      xMin: 0, xMax: totalTicks, yMin: 0, yMax,
      xTicks: rounds, yTicks: 4,
      xFmt: x => this._roundLabel(v, config, x),
      yFmt: y => y.toFixed(0),
    });

    // Build inv[tick][id] by walking through trades in order. At every
    // round boundary the engine rewinds each agent's inventory back to
    // the spec value, so the replay walk has to mirror that — without
    // this reset, rounds 2-4 would inherit drifted balances and the
    // stacked area would no longer sum to totalShares.
    const invByTick = new Array(totalTicks + 1);
    const start     = {};
    for (const id of ids) start[id] = initialInv[id];
    invByTick[0] = start;
    let tIdx = 0;
    const sortedTrades = v.trades;
    for (let tick = 1; tick <= totalTicks; tick++) {
      const cur  = {};
      const prev = invByTick[tick - 1];
      // Round-boundary reset: ticks at the end of period T of a non-final
      // round restart every agent's inventory before the next tick's
      // trades land.
      const isRoundBoundary =
        rounds > 1 &&
        tick % ticksPerRnd === 1 &&
        tick > 1;
      if (isRoundBoundary) {
        for (const id of ids) cur[id] = initialInv[id];
      } else {
        for (const id of ids) cur[id] = prev[id];
      }
      while (tIdx < sortedTrades.length && sortedTrades[tIdx].timestamp <= tick) {
        const t = sortedTrades[tIdx];
        if (cur[t.buyerId]  != null) cur[t.buyerId]  += t.quantity;
        if (cur[t.sellerId] != null) cur[t.sellerId] -= t.quantity;
        tIdx++;
      }
      invByTick[tick] = cur;
    }

    // At small N keep one band per agent (colored distinctly). At
    // large N group agents by risk preference so the stack reduces to
    // 3 semantically-meaningful bands (loving / neutral / averse) plus
    // an "other" fallback for any non-Utility types. The legend is
    // the only way a stacked area communicates composition and 100
    // per-agent legend entries are unreadable.
    const compact = n > UI.FAN_THRESHOLD;
    let series;
    if (compact) {
      const groups = [
        { key: 'loving',  color: this._riskColor('loving'),  label: 'risk-loving' },
        { key: 'neutral', color: this._riskColor('neutral'), label: 'risk-neutral' },
        { key: 'averse',  color: this._riskColor('averse'),  label: 'risk-averse' },
        { key: 'other',   color: this.theme.fg3,             label: 'other' },
      ];
      const groupOf = id => {
        const a = v.agents[id];
        if (a && a.riskPref && ['loving','neutral','averse'].includes(a.riskPref)) return a.riskPref;
        return 'other';
      };
      const idGroup = {};
      const groupHas = { loving: false, neutral: false, averse: false, other: false };
      for (const id of ids) {
        const g = groupOf(id);
        idGroup[id] = g;
        groupHas[g] = true;
      }
      series = groups
        .filter(g => groupHas[g.key])
        .map(g => ({
          color:  g.color,
          name:   g.label,
          points: invByTick.map((m, tick) => {
            let y = 0;
            for (const id of ids) if (idGroup[id] === g.key) y += Math.max(0, m[id] || 0);
            return { x: tick, y };
          }),
        }));
    } else {
      series = ids.map(id => ({
        color: this.agentColor(id),
        name:  v.agents[id] ? v.agents[id].name : 'U' + id,
        points: invByTick.map((m, tick) => ({ x: tick, y: Math.max(0, m[id] || 0) })),
      }));
    }
    Viz.stackedArea(ctx, rect, series, { xMin: 0, xMax: totalTicks, yMin: 0, yMax });
    this._drawRoundDividers(ctx, rect, config, 0, totalTicks, v);

    // Inline legend above the plot. Per-entry advance is measured
    // from the rendered name so long names can't overlap.
    ctx.save();
    ctx.font = '10px "Helvetica Neue", Helvetica, Arial, sans-serif';
    ctx.textBaseline = 'middle';
    const swatch = 10;
    const gap    = 14;
    let legendX = rect.x + 4;
    for (const s of series) {
      ctx.fillStyle = s.color;
      ctx.fillRect(legendX, rect.y - 16, swatch, swatch);
      ctx.fillStyle = this.theme.fg0;
      ctx.fillText(s.name, legendX + swatch + 3, rect.y - 10);
      legendX += swatch + 3 + ctx.measureText(s.name).width + gap;
    }
    ctx.restore();

    Viz.axisLabel(ctx, rect, v.session > 0 ? 'Round R · Session ' + v.session : 'Round R', 'bottom');

    this._registerHover('ownership', {
      mode: 'series', rect, xMin: 0, xMax: totalTicks, yMin: 0, yMax,
      xFmt: x => this._tickHoverFmt(v, config, x),
      series: series.map(s => ({
        name: s.name, color: s.color, points: s.points,
        yFmt: y => y.toFixed(0) + ' shares',
      })),
    });
  },

  /* -------- Extended metrics panel -------- */
  renderMetrics(v, config) {
    const el = this.els.metricsBody;
    if (!el) return;

    const hasExtended = (v.valuationHistory && v.valuationHistory.length) ||
                        (v.utilityHistory && v.utilityHistory.length);
    // Plans II/III run the LLM as the sole information channel and do
    // not log subjectiveValuation / utility / messages — every metric
    // below the "Market quality" group depends on those Plan I streams,
    // so those groups would render as solid em-dashes. Skip the empty
    // bail-out for Plan II/III and instead emit only the market-quality
    // table (which is plan-agnostic, derived from prices + FV).
    const isLLMPlan = (v.plan === 'II' || v.plan === 'III');
    if (!hasExtended && !isLLMPlan) {
      el.innerHTML = '<div class="muted">Select the Utility population to see extended metrics.</div>';
      return;
    }

    // ---- Dufwenberg, Lindqvist & Moore (2005) market-quality statistics.
    // All of these operate on the per-period mean trade price P̄_t and the
    // deterministic fundamental value FV_t = (T − t + 1)·μ_d. With the
    // multi-round session wrapper a "period" key needs to be (round,
    // period) so a round-2 period-5 trade isn't lumped with a round-1
    // period-5 trade. We index every aggregator by the global period
    // g = (round−1)·T + period and compute FV from the local period.
    const rounds = config.roundsPerSession || 1;
    const sumByG = {}, cntByG = {};
    for (const t of v.trades) {
      const tRound = t.round || 1;
      const g      = (tRound - 1) * config.periods + t.period;
      sumByG[g] = (sumByG[g] || 0) + t.price;
      cntByG[g] = (cntByG[g] || 0) + 1;
    }
    const sessionPeriodsM = rounds * config.periods;
    const meanP = new Array(sessionPeriodsM + 1).fill(null);
    for (let g = 1; g <= sessionPeriodsM; g++) {
      if (cntByG[g]) meanP[g] = sumByG[g] / cntByG[g];
    }
    const localPeriodOf = g => ((g - 1) % config.periods) + 1;
    const localRoundOf  = g => Math.floor((g - 1) / config.periods) + 1;
    const fvOfG = g => this._fvAtRound(localRoundOf(g), localPeriodOf(g), config);
    // Per-trade FV uses the trade's own round + period so pre/post-asset
    // sessions route to the right FV curve at the round-4 boundary.
    const fvOfTrade = t => this._fvAtRound(t.round || 1, t.period, config);

    // Total shares outstanding (conserved under double-auction trades).
    let totalShares = 0;
    for (const a of Object.values(v.agents)) totalShares += (a.inventory || 0);

    // Haessel (1978) R²: 1 − Σ(P̄_g − FV_g)² / Σ(P̄_g − mean P̄)². Uses only
    // periods that had trades. Can be negative if the fit is worse than
    // predicting the sample mean of P̄.
    let haessel = null;
    {
      const obs = [];
      for (let g = 1; g <= sessionPeriodsM; g++) {
        if (meanP[g] != null) obs.push({ y: meanP[g], x: fvOfG(g) });
      }
      if (obs.length >= 2) {
        const ybar = obs.reduce((s, c) => s + c.y, 0) / obs.length;
        let ssRes = 0, ssTot = 0;
        for (const o of obs) {
          ssRes += (o.y - o.x) ** 2;
          ssTot += (o.y - ybar) ** 2;
        }
        if (ssTot > 0) haessel = 1 - ssRes / ssTot;
      }
    }

    // Normalized absolute price deviation:
    // Σ_trades |P_trade − FV_period| · q / total shares outstanding.
    let normAbsDev = null;
    if (totalShares > 0 && v.trades.length) {
      let s = 0;
      for (const t of v.trades) s += Math.abs(t.price - fvOfTrade(t)) * t.quantity;
      normAbsDev = s / totalShares;
    }

    // Normalized average price deviation:
    // Σ_periods |P̄_t − FV_t| / total shares outstanding, summed over
    // every period of every round in the session.
    let normAvgDev = null;
    if (totalShares > 0) {
      let s = 0;
      for (let g = 1; g <= sessionPeriodsM; g++) {
        if (meanP[g] != null) s += Math.abs(meanP[g] - fvOfG(g));
      }
      normAvgDev = s / totalShares;
    }

    // Price amplitude: (max (P̄_g − FV_g) − min (P̄_g − FV_g)) / FV_1.
    // Pooled across all rounds — DLM 2005 reports per-round amplitudes
    // as well, but the dashboard surface is one number per session.
    let amplitude = null;
    {
      const diffs = [];
      for (let g = 1; g <= sessionPeriodsM; g++) {
        if (meanP[g] != null) diffs.push(meanP[g] - fvOfG(g));
      }
      const fv1 = this._fvAt(1, config);
      if (diffs.length && fv1 > 0) amplitude = (Math.max(...diffs) - Math.min(...diffs)) / fv1;
    }

    // Turnover: Σ q_traded / total shares outstanding. Standard SSW
    // measure of churn — 1.0 means every share changed hands once.
    let turnover = null;
    if (totalShares > 0) {
      let sharesTraded = 0;
      for (const t of v.trades) sharesTraded += t.quantity;
      turnover = sharesTraded / totalShares;
    }

    // Lopez-Lira (2025) price-to-fundamental ratio ρ = P / FV.
    let rho = null;
    if (v.lastPrice != null && v.priceHistory.length) {
      const lastFV = v.priceHistory[v.priceHistory.length - 1].fv;
      if (lastFV > 0) rho = v.lastPrice / lastFV;
    }

    // ---- Extended (Utility-mode) aggregates.
    const latestV = {};
    for (const row of v.valuationHistory) latestV[row.agentId] = row.subjV;
    const Vlist = Object.entries(latestV).map(([id, vv]) => ({ id: Number(id), vv }));
    const avgV  = Vlist.length ? Vlist.reduce((s, c) => s + c.vv, 0) / Vlist.length : null;

    let efficiency = null;
    if (Vlist.length) {
      let maxVV = -Infinity;
      for (const c of Vlist) if (c.vv > maxVV) maxVV = c.vv;
      let actual = 0;
      for (const c of Vlist) {
        const agent = v.agents[c.id];
        if (agent) actual += c.vv * (agent.inventory || 0);
      }
      const optimal = maxVV * totalShares;
      efficiency = optimal > 0 ? actual / optimal : 0;
    }

    let totalWelfare = null;
    const latestU = {};
    for (const row of v.utilityHistory) latestU[row.agentId] = row.utility;
    const uvals = Object.values(latestU);
    if (uvals.length) totalWelfare = uvals.reduce((s, x) => s + x, 0);

    const pDev = (v.lastPrice != null && avgV != null) ? Math.abs(v.lastPrice - avgV) : null;

    // ---- AIPE psychological allocation outcome.
    // Research question: does the asset ultimately end up in the hands
    // of the agent with the highest psychological valuation? Identifies
    // the top-holder (agent with the most shares) and the agent with
    // the maximum subjective V̂, compares their ids, and reports a
    // normalized gap = (max V̂ − top-holder V̂) / max V̂ so a zero means
    // the asset is already with the right hands.
    let psychTopHolderId = null;
    let psychTopHolderV  = null;
    let psychMaxVid      = null;
    let psychMaxV        = null;
    let psychGap         = null;
    let psychMatch       = null;
    if (Vlist.length) {
      let maxInv = -Infinity;
      for (const c of Vlist) {
        const agent = v.agents[c.id];
        if (!agent) continue;
        if ((agent.inventory || 0) > maxInv) {
          maxInv = agent.inventory || 0;
          psychTopHolderId = c.id;
          psychTopHolderV  = c.vv;
        }
      }
      let maxV = -Infinity;
      for (const c of Vlist) {
        if (c.vv > maxV) { maxV = c.vv; psychMaxVid = c.id; psychMaxV = c.vv; }
      }
      if (psychTopHolderV != null && psychMaxV != null && psychMaxV > 0) {
        psychGap   = (psychMaxV - psychTopHolderV) / psychMaxV;
        psychMatch = psychTopHolderId === psychMaxVid;
      }
    }

    let deceptionMag = null;
    let nDeceptive = 0;
    const msgs = v.messages || [];
    if (msgs.length) {
      let total = 0;
      for (const m of msgs) {
        total += Math.abs(m.claimedValuation - m.trueValuation);
        if (m.deceptive) nDeceptive++;
      }
      deceptionMag = total / msgs.length;
    }

    const fmt = (x, d = 2) => x == null ? '—' : x.toFixed(d);
    const sym = window.Sym || {};
    const row = (name, formula, val) =>
      `<tr><td class="batch-metric-name">${name}${formula ? '<em>' + formula + '</em>' : ''}</td><td>${val}</td></tr>`;
    const grp = label =>
      `<tr class="batch-group-label"><td colspan="2">${label}</td></tr>`;

    // Welfare + deception + AIPE blocks all derive from Plan I streams
    // (subjectiveValuation via valuationHistory, message bus, utility
    // history). Under Plans II/III those streams are empty by design,
    // so the rows would all render as em-dashes. Suppress them and
    // surface a single line explaining why.
    const planIBlocks = isLLMPlan ? `
      ${grp('Utility-agent welfare &middot; AIPE allocation')}
      <tr><td colspan="2" class="muted">Plan I only — Plan ${v.plan} routes belief and messaging through the LLM, so subjective V, peer messages, and the AIPE allocation gap are not computed.</td></tr>` : `
      ${grp('Utility-agent welfare &amp; deception')}
      ${row('Avg subjective V&#770;', sym.avgVbar || '', fmt(avgV))}
      ${row('Allocative efficiency', sym.efficiencyEq || '', fmt(efficiency, 3))}
      ${row('Total welfare', sym.totalWelfareEq || '', fmt(totalWelfare, 3))}
      ${row('|P &minus; &langle;V&#770;&rangle;|', '', fmt(pDev))}
      ${row('Mean lie magnitude', '&langle;' + (sym.lieGap || '') + '&rangle;', fmt(deceptionMag))}
      ${row('Deceptive / total msgs', '', nDeceptive + ' / ' + msgs.length)}

      ${grp('Psychological allocation &middot; AIPE')}
      ${row('Top holder vs highest V&#770;', '', '<span class="' + (psychMatch === true ? 'ok' : psychMatch === false ? 'bad' : '') + '">' + (psychMatch == null ? '—' : psychMatch ? 'match' : 'miss') + '</span>')}
      ${row('Top-holder id &middot; V&#770;', '', psychTopHolderId == null ? '—' : 'A' + psychTopHolderId + ' &middot; ' + fmt(psychTopHolderV))}
      ${row('Max-V&#770; id &middot; V&#770;*', '', psychMaxVid == null ? '—' : 'A' + psychMaxVid + ' &middot; ' + fmt(psychMaxV))}
      ${row('Valuation gap', '(V&#770;* &minus; V&#770;&#8341;) / V&#770;*', fmt(psychGap, 3))}`;

    el.innerHTML = `<table class="batch-table"><tbody>
      ${grp('Market quality &middot; Dufwenberg, Lindqvist &amp; Moore (2005)')}
      ${row('Haessel R&sup2;', '1 &minus; &Sigma;(P&#772;&minus;FV)&sup2; / &Sigma;(P&#772;&minus;P&#772;&#772;)&sup2;', fmt(haessel, 3))}
      ${row('Norm. absolute price deviation', '&Sigma;|P&minus;FV|&middot;q / Q', fmt(normAbsDev, 2))}
      ${row('Norm. average price deviation', sym.normAvgDev || '', fmt(normAvgDev, 2))}
      ${row('Price amplitude', '(max&minus;min)(P&#772;&minus;FV) / FV&#8321;', fmt(amplitude, 3))}
      ${row('Turnover', '&Sigma; q / Q', fmt(turnover, 3))}
      ${row('P / FV ratio', (sym.rhoT || '') + ' (Lopez-Lira 2025)', fmt(rho, 3))}
      ${planIBlocks}
    </tbody></table>`;
  },

  /* -------- Trace inspector -------- */

  renderTraces(v) {
    const tick   = v.tick;
    const traces = v.traces.filter(t => t.timestamp === tick);
    if (!traces.length) {
      this.els.traceBody.innerHTML =
        `<div class="muted">No decisions recorded at tick ${tick}.</div>`;
      return;
    }
    this.els.traceBody.innerHTML = traces.map(t => {
      const d         = t.decision;
      const r         = t.reasoning;
      const kind      = d.type;
      const valStr    = r.estimatedValue != null ? r.estimatedValue.toFixed(2) : '—';
      const profitStr = r.expectedProfit != null ? r.expectedProfit.toFixed(2) : '—';
      const priceStr  = d.price          != null ? d.price.toFixed(2)          : '—';
      const qtyStr    = d.quantity       != null ? d.quantity                  : '—';
      const agentName = t.agentName || ('A' + t.agentId);
      const kindLabel = kind === 'hold'
        ? 'hold'
        : `${kind} ${qtyStr} @ ${priceStr}${t.filled ? ' ✓' : ''}`;

      // Extended: expected-utility candidate table.
      const u = r.utility;
      const uBlock = u ? `
          <div class="trace-row">subj V <strong>${u.subjectiveValue != null ? u.subjectiveValue.toFixed(2) : '—'}</strong> <span class="muted">(true ${u.trueValuation != null ? u.trueValuation.toFixed(2) : '—'})</span></div>
          <div class="trace-row">w₀ <strong>${u.wealth0 != null ? u.wealth0.toFixed(0) : '—'}</strong> · U₀ <strong>${u.U0 != null ? u.U0.toFixed(3) : '—'}</strong> <span class="muted">(${u.riskPref})</span></div>
          <div class="trace-eu">
            ${(u.candidates || []).map(c => `
              <div class="eu-row${c.label === u.chosen ? ' chosen' : ''}">
                <span class="eu-lbl">${c.label}</span>
                <span class="eu-val">${c.eu.toFixed(4)}</span>
              </div>`).join('')}
          </div>` : '';

      // Prior adjustment flags. The `bias` and `noise` knobs only feed
      // Plan I's updateBelief(), so when the trace comes from a Plan
      // II/III decision (no `r.utility` block) we suppress the line —
      // otherwise the user reads "prior adj: bias+noise" next to an
      // LLM action that those flags did not influence.
      const priorFlags = [];
      if (r.utility && r.biasActive)  priorFlags.push(`bias:${r.biasMode || '—'}(${r.biasAmount != null ? r.biasAmount.toFixed(2) : '—'})`);
      if (r.utility && r.noiseActive) priorFlags.push('noise');
      const priorBlock = priorFlags.length
        ? `<div class="trace-row muted">prior adj: ${priorFlags.join(' + ')}</div>`
        : '';

      // LLM reasoning (Plan II/III direct action).
      const llmBlock = r.llmReason
        ? `<div class="trace-row muted llm-reason">LLM: ${UI._escHtml(r.llmReason)}</div>`
        : '';

      return `
        <div class="trace-card">
          <div class="trace-head">
            <span>${agentName} <span class="muted">· ${t.agentType}</span></span>
            <span class="trace-kind ${kind}">${kindLabel}</span>
          </div>
          <div class="trace-row">rule <strong>${r.ruleUsed}</strong></div>
          <div class="trace-row">trigger <strong>${r.triggerCondition || '—'}</strong></div>
          <div class="trace-row">est value <strong>${valStr}</strong> · E[π] <strong>${profitStr}</strong></div>
          <div class="trace-row">cash <strong>${t.state.cash.toFixed(0)}</strong> · shares <strong>${t.state.inventory}</strong></div>
          ${uBlock}
          ${llmBlock}
          ${priorBlock}
        </div>`;
    }).join('');
  },

  /* -------- Replay slider sync -------- */

  setReplayPosition(tick, total, isLive) {
    this.els.replayPos.textContent = isLive
      ? `Live — tick ${tick}`
      : `Replay — tick ${tick} / ${total}`;
    this.els.replaySlider.max = Math.max(1, total);
    if (isLive) this.els.replaySlider.value = tick;
  },
};
