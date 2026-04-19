/* ============================================================
 * mathml.js — single source of truth for every mathematical
 * symbol rendered in an HTML context anywhere in the app.
 *
 * Rendering engine
 * ----------------
 * We use native browser MathML — the math display engine built
 * into Chrome, Safari, Firefox and Edge. MathML is the W3C
 * standard for rendering mathematics in HTML: the browser
 * selects a real math font (STIX Two Math / Latin Modern Math
 * / Cambria Math) and uses the same sub/sup layout rules as a
 * typeset paper would. Picking native MathML instead of KaTeX
 * or MathJax keeps the project's no-dependency / no-build-step
 * promise intact while still solving the cross-surface
 * rendering inconsistency that plain <sub> + UI-font fallback
 * was causing on the agent cards.
 *
 * Source of truth
 * ---------------
 * Every symbol used anywhere in the UI is defined exactly
 * once in the Sym map below. Dynamic renderers (renderAgents,
 * renderMetrics) embed `Sym.<key>` directly in their template
 * literals; static HTML uses `<span data-sym="key"></span>`
 * placeholders that hydrateSymbols() fills in on
 * DOMContentLoaded. This means the same symbol renders through
 * the same MathML fragment on the card, in the notes, in the
 * figure equation, and in the table — no more visual drift.
 *
 * Plain-text exceptions
 * ---------------------
 * Two contexts cannot render HTML/MathML at all:
 *   - CSS `content: attr(data-tip)` pseudo-element tooltips
 *   - Canvas fillText on chart legends
 * Those continue to use Unicode subscript characters (Uₜ, αₗ,
 * V̂ᵢ,ₜ, …). They are the only places in the codebase where
 * math is not routed through Sym.
 * ============================================================ */

'use strict';

/* ---- Element builders -------------------------------------- */

const _mi  = s => `<mi>${s}</mi>`;
const _mn  = s => `<mn>${s}</mn>`;
const _mo  = s => `<mo>${s}</mo>`;
const _row = (...kids) => `<mrow>${kids.join('')}</mrow>`;
const _sub = (base, sub) => `<msub>${base}${sub}</msub>`;
const _sup = (base, sup) => `<msup>${base}${sup}</msup>`;
const _subsup = (base, sub, sup) => `<msubsup>${base}${sub}${sup}</msubsup>`;
const _hat   = base => `<mover accent="true">${base}<mo>^</mo></mover>`;
const _tilde = base => `<mover accent="true">${base}<mo>~</mo></mover>`;
const _bar   = base => `<mover accent="true">${base}<mo>‾</mo></mover>`;
const _sqrt  = body => `<msqrt>${body}</msqrt>`;
const _frac  = (num, den) => `<mfrac>${num}${den}</mfrac>`;
const _abs   = body => `<mrow><mo>|</mo>${body}<mo>|</mo></mrow>`;
const _wrap  = body => `<math display="inline" xmlns="http://www.w3.org/1998/Math/MathML">${body}</math>`;

/* ---- Reusable sub-expressions ------------------------------ */

// Subscript "{i, t}" — appears on almost every per-agent quantity.
const _it = _row(_mi('i'), _mo(','), _mi('t'));
// Subscript "{r → s}" — for pairwise trust.
const _rarrs = _row(_mi('r'), _mo('→'), _mi('s'));
// Subscript "{i → *, t}" — for broadcast messages.
const _imsgT = _row(_mi('i'), _mo('→'), _mo('*'), _mo(','), _mi('t'));

/* ---- Canonical symbol map ---------------------------------- *
 * Keys are referenced from both ui.js (template strings) and
 * index.html (`data-sym="..."`). Keep the key set small and
 * stable.
 * ------------------------------------------------------------ */

const Sym = {
  /* Agent-level, time-indexed */
  cash:      _wrap(_sub(_mi('c'), _it)),                                     // c_{i,t}
  cash0:     _wrap(_sub(_mi('c'), _row(_mi('i'), _mo(','), _mn('0')))),      // c_{i,0}
  shares:    _wrap(_sub(_mi('q'), _it)),                                     // q_{i,t}
  shares0:   _wrap(_sub(_mi('q'), _row(_mi('i'), _mo(','), _mn('0')))),      // q_{i,0}
  wealth:    _wrap(_sub(_mi('w'), _it)),                                     // w_{i,t}
  wealth0:   _wrap(_sub(_mi('w'), _row(_mi('i'), _mo(','), _mn('0')))),      // w_{i,0}
  pnl:       _wrap(_sub(_row(_mo('Δ'), _mi('w')), _it)),                     // Δw_{i,t}
  subjV:     _wrap(_sub(_hat(_mi('V')), _it)),                               // V̂_{i,t}
  reportV:   _wrap(_sub(_tilde(_mi('V')), _it)),                             // Ṽ_{i,t}
  action:    _wrap(_sub(_mi('a'), _it)),                                     // a_{i,t}
  utilityI:  _wrap(_sub(_mi('u'), _it)),                                     // u_{i,t}
  agentI:    _wrap(_mi('i')),                                                 // i
  periodT:   _wrap(_mi('t')),                                                 // t

  /* Market-level */
  price:     _wrap(_sub(_mi('P'), _mi('t'))),                                 // P_t
  meanP:     _wrap(_sub(_bar(_mi('P')), _mi('t'))),                           // P̄_t
  fv:        _wrap(_sub(_row(_mi('F'), _mi('V')), _mi('t'))),                 // FV_t
  fvT:       _wrap(_sub(_row(_mi('F'), _mi('V')), _mi('T'))),                 // FV_T
  fvDef:     _wrap(_row(                                                      // FV_t = (T − t + 1)·μ_d
    _sub(_row(_mi('F'), _mi('V')), _mi('t')), _mo('='),
    _mo('('), _mi('T'), _mo('−'), _mi('t'), _mo('+'), _mn('1'), _mo(')'),
    _mo('·'), _sub(_mi('μ'), _mi('d')),
  )),
  rhoT:      _wrap(_sub(_mi('ρ'), _mi('t'))),                                 // ρ_t
  rhoDef:    _wrap(_row(                                                      // ρ_t = P_t / FV_t
    _sub(_mi('ρ'), _mi('t')), _mo('='),
    _frac(_sub(_mi('P'), _mi('t')), _sub(_row(_mi('F'), _mi('V')), _mi('t'))),
  )),
  bubbleRatio: _wrap(_row(                                                    // |P_t/FV_t − 1| ≥ θ
    _abs(_row(
      _frac(_sub(_mi('P'), _mi('t')), _sub(_row(_mi('F'), _mi('V')), _mi('t'))),
      _mo('−'),
      _mn('1'),
    )),
    _mo('≥'),
    _mi('θ'),
  )),
  theta:     _wrap(_mi('θ')),                                                 // θ

  /* Advanced-settings building blocks — rendered in the rich hover
     tooltips so the math in the tile popups uses the same MathML path
     as the Architecture tab and the agent cards. */
  deltaI:    _wrap(_sub(_mi('δ'), _mi('i'))),                                 // δ_i
  gI:        _wrap(_sub(_mi('g'), _mi('i'))),                                 // g_i
  cI:        _wrap(_sub(_mi('c'), _mi('i'))),                                 // c_i
  uI:        _wrap(_sub(_mi('u'), _mi('i'))),                                 // u_i
  hI:        _wrap(_sub(_mi('h'), _mi('i'))),                                 // h_i
  kExp:      _wrap(_sub(_mi('k'), _mi('i'))),                                 // k_i (experience level, chip)
  beta:      _wrap(_mi('β')),                                                 // β
  biasI:     _wrap(_sub(_mi('b'), _mi('i'))),                                 // b_i
  epsilon:   _wrap(_mi('ε')),                                                 // ε
  xi:        _wrap(_mi('ξ')),                                                 // ξ
  nSamples:  _wrap(_sub(_mi('n'), _mi('i'))),                                 // n_i
  sigmaN:    _wrap(_sub(_mi('σ'), _mi('n'))),                                 // σ_n
  xBarN:     _wrap(_sub(_bar(_mi('x')), _row(_mi('n'), _mi('i')))),           // x̄_{n_i}
  muHatI:    _wrap(_sub(_hat(_mi('μ')), _mi('i'))),                           // μ̂_i
  fvHatIt:   _wrap(_sub(_hat(_row(_mi('F'), _mi('V'))), _it)),                // FV̂_{i,t}
  fvTildeIt: _wrap(_sub(_tilde(_row(_mi('F'), _mi('V'))), _it)),              // FṼ_{i,t}
  priorBias: _wrap(_row(                                                      // FV_t · (1 + δ_i · β)
    _sub(_row(_mi('F'), _mi('V')), _mi('t')), _mo('·'),
    _mo('('), _mn('1'), _mo('+'),
    _sub(_mi('δ'), _mi('i')), _mo('·'), _mi('β'),
    _mo(')'),
  )),
  priorNoise: _wrap(_row(                                                     // FV_t · (1 + ε)
    _sub(_row(_mi('F'), _mi('V')), _mi('t')), _mo('·'),
    _mo('('), _mn('1'), _mo('+'), _mi('ε'), _mo(')'),
  )),
  noiseRange: _wrap(_row(                                                     // ε ~ U[−n, +n]
    _mi('ε'), _mo('∼'), _mi('U'),
    _mo('['), _mo('−'), _mi('n'), _mo(','), _mo('+'), _mi('n'), _mo(']'),
  )),
  sigmaNDef: _wrap(_row(                                                      // σ_n = 0.35/√(n+1)
    _sub(_mi('σ'), _mi('n')), _mo('='),
    _frac(_mn('0.35'), _sqrt(_row(_mi('n'), _mo('+'), _mn('1')))),
  )),
  muHatDef:  _wrap(_row(                                                      // μ̂_i = x̄_{n_i} · (1 + ξ)
    _sub(_hat(_mi('μ')), _mi('i')), _mo('='),
    _sub(_bar(_mi('x')), _row(_mi('n'), _mi('i'))),
    _mo('·'), _mo('('), _mn('1'), _mo('+'), _mi('ξ'), _mo(')'),
  )),
  fvHatDef:  _wrap(_row(                                                      // FV̂_t = μ̂_i · (T − t + 1)
    _sub(_hat(_row(_mi('F'), _mi('V'))), _mi('t')), _mo('='),
    _sub(_hat(_mi('μ')), _mi('i')), _mo('·'),
    _mo('('), _mi('T'), _mo('−'), _mi('t'), _mo('+'), _mn('1'), _mo(')'),
  )),
  divSupportC: _wrap(_row(                                                    // d ∈ {0, 4, 10, 20, 40}¢
    _mi('d'), _mo('∈'), _mo('{'),
    _mn('0'), _mo(','), _mn('4'), _mo(','), _mn('10'), _mo(','),
    _mn('20'), _mo(','), _mn('40'),
    _mo('}'), _mi('¢'),
  )),
  divProbsC: _wrap(_row(                                                      // p = {0.30, 0.25, 0.20, 0.15, 0.10}
    _mi('p'), _mo('='), _mo('{'),
    _mn('0.30'), _mo(','), _mn('0.25'), _mo(','), _mn('0.20'), _mo(','),
    _mn('0.15'), _mo(','), _mn('0.10'),
    _mo('}'),
  )),
  bubbleRatioRaw: _wrap(_frac(                                                // |P_t − FV_t| / FV_t
    _abs(_row(_sub(_mi('P'), _mi('t')), _mo('−'), _sub(_row(_mi('F'), _mi('V')), _mi('t')))),
    _sub(_row(_mi('F'), _mi('V')), _mi('t')),
  )),
  muD:       _wrap(_sub(_mi('μ'), _mi('d'))),                                 // μ_d
  bigT:      _wrap(_mi('T')),                                                 // T
  bigQ:      _wrap(_mi('Q')),                                                 // Q
  nAgents:   _wrap(_mi('N')),                                                 // N
  bigR:      _wrap(_mi('R')),                                                 // R
  smallR:    _wrap(_mi('r')),                                                 // r
  volT:      _wrap(_sub(_mi('V'), _mi('t'))),                                 // V_t

  /* Per-asset FV-formula vocabulary (Figure 1 footer note). The
     formula displayed in Figure 1 swaps per active asset; these
     symbols appear in one or more of the six per-asset FV formulas
     defined in js/assets.js (ASSET_FV_FORMULAS). */
  periodS:   _wrap(_mi('s')),                                                 // s
  fvNext:    _wrap(_sub(_row(_mi('F'), _mi('V')), _row(_mi('t'), _mo('+'), _mn('1')))),  // FV_{t+1}
  edT:       _wrap(_row(_mi('E'), _mo('['), _sub(_mi('d'), _mi('t')), _mo(']'))),        // E[d_t]
  edS:       _wrap(_row(_mi('E'), _mo('['), _sub(_mi('d'), _mi('s')), _mo(']'))),        // E[d_s]
  kT:        _wrap(_sub(_mi('k'), _mi('t'))),                                  // k_t
  aCoef:     _wrap(_mi('a')),                                                  // a
  bCoef:     _wrap(_mi('b')),                                                  // b
  etaT:      _wrap(_sub(_mi('η'), _mi('t'))),                                  // η_t
  sigma:     _wrap(_mi('σ')),                                                  // σ
  muJ:       _wrap(_sub(_mi('μ'), _mi('j'))),                                  // μ_j
  normalDist: _wrap(_row(
    _mi('N'), _mo('('), _mn('0'), _mo(','),
    _sup(_mi('σ'), _mn('2')), _mo(')'),
  )),                                                                          // N(0, σ²)
  maxOp:     _wrap(_mi('max')),                                                // max(·,·)
  minOp:     _wrap(_mi('min')),                                                // min(·,·)

  /* Experience mechanism (v3 §3) — per-agent α_i, σ_i, ω_i indexed by
     the integer experience level k_i ≡ agent.roundsPlayed. The anchors
     α_0, σ_0, ω_0 are the novice values (k_i = 0) and also appear as
     standalone entries in the Parameters → Hidden Constants panel. */
  kI:         _wrap(_sub(_mi('k'), _mi('i'))),                                  // k_i
  alphaI:     _wrap(_sub(_mi('α'), _mi('i'))),                                  // α_i
  sigmaI:     _wrap(_sub(_mi('σ'), _mi('i'))),                                  // σ_i
  omegaI:     _wrap(_sub(_mi('ω'), _mi('i'))),                                  // ω_i
  alphaZero:  _wrap(_sub(_mi('α'), _mn('0'))),                                  // α_0
  sigmaZero:  _wrap(_sub(_mi('σ'), _mn('0'))),                                  // σ_0
  omegaZero:  _wrap(_sub(_mi('ω'), _mn('0'))),                                  // ω_0
  gammaAlpha: _wrap(_sub(_mi('γ'), _mi('α'))),                                  // γ_α
  gammaSigma: _wrap(_sub(_mi('γ'), _mi('σ'))),                                  // γ_σ
  /* Heuristic mix weights (v3 §4) — per-term weights in the four-term
     decomposition H_{i,t} = β₁·Anchor + β₂·Trend + β₃·DividendSignal
     + β₄·Narrative. Surfaced in Advanced Settings so the anchor-vs-
     trend balance is tunable per session. */
  betaOne:    _wrap(_sub(_mi('β'), _mn('1'))),                                  // β_1
  betaTwo:    _wrap(_sub(_mi('β'), _mn('2'))),                                  // β_2
  betaThree:  _wrap(_sub(_mi('β'), _mn('3'))),                                  // β_3
  betaFour:   _wrap(_sub(_mi('β'), _mn('4'))),                                  // β_4
  hIt:        _wrap(_sub(_mi('H'), _it)),                                       // H_{i,t}
  alphaIDef:  _wrap(_row(                                                       // α_i = min{1, α_0 + γ_α · k_i}
    _sub(_mi('α'), _mi('i')), _mo('='),
    _mi('min'), _mo('{'), _mn('1'), _mo(','),
    _sub(_mi('α'), _mn('0')), _mo('+'),
    _sub(_mi('γ'), _mi('α')), _mo('·'), _sub(_mi('k'), _mi('i')),
    _mo('}'),
  )),
  sigmaIDef:  _wrap(_row(                                                       // σ_i = σ_0 · e^(−γ_σ · k_i)
    _sub(_mi('σ'), _mi('i')), _mo('='),
    _sub(_mi('σ'), _mn('0')), _mo('·'),
    _sup(_mi('e'), _row(
      _mo('−'), _sub(_mi('γ'), _mi('σ')), _mo('·'), _sub(_mi('k'), _mi('i')),
    )),
  )),
  omegaIDef:  _wrap(_row(                                                       // ω_i = 0.6 + 0.1 · min(3, k_i)
    _sub(_mi('ω'), _mi('i')), _mo('='),
    _mn('0.6'), _mo('+'),
    _mn('0.1'), _mo('·'),
    _mi('min'), _mo('('), _mn('3'), _mo(','), _sub(_mi('k'), _mi('i')), _mo(')'),
  )),

  /* Utility functionals — compact form used by slider labels and the
     agent-card subtitle where horizontal space is tight. */
  uLoving:   _wrap(_row(
    _mi('U'), _mo('('), _mi('w'), _mo(')'), _mo('='),
    _sup(_mi('w'), _mn('2')),
  )),
  uNeutral:  _wrap(_row(
    _mi('U'), _mo('('), _mi('w'), _mo(')'), _mo('='), _mi('w'),
  )),
  uAverse:   _wrap(_row(
    _mi('U'), _mo('('), _mi('w'), _mo(')'), _mo('='),
    _sqrt(_mi('w')),
  )),
  /* Exact normalized utility right-hand sides — match computeUtility()
     in js/utility.js, which evaluates U on r = w / w₀ so every agent
     starts at U(w₀) = 1 regardless of initial wealth. Rendered on the
     utility agent cards in the value column, with `U_i(w)` as the
     label subscript, so the row reads as "Utility U_i(w) | (w/w₀)²"
     and lines up with every other "label | value" metric row. */
  uLovingNorm:  _wrap(
    _sup(_row(_mo('('), _frac(_mi('w'), _sub(_mi('w'), _mn('0'))), _mo(')')), _mn('2')),
  ),
  uNeutralNorm: _wrap(
    _frac(_mi('w'), _sub(_mi('w'), _mn('0'))),
  ),
  uAverseNorm:  _wrap(
    _sqrt(_frac(_mi('w'), _sub(_mi('w'), _mn('0')))),
  ),
  /* Universal CRRA — the single functional form every agent shares. ρ
     is per-agent (sampled uniformly within the agent's risk-preference
     category). uCRRA renders the general family; uCRRANormI renders the
     normalized form with the agent's subscript; rhoI is the per-agent
     coefficient and rhoSym is the bare symbol used in slider labels. */
  rhoSym:    _wrap(_mi('ρ')),                                                   // ρ
  rhoI:      _wrap(_sub(_mi('ρ'), _mi('i'))),                                   // ρ_i
  uCRRA:     _wrap(_row(                                                        // U(w; ρ) = w^(1−ρ) / (1−ρ)
    _mi('U'), _mo('('), _mi('w'), _mo(';'), _mi('ρ'), _mo(')'), _mo('='),
    _frac(
      _sup(_mi('w'), _row(_mn('1'), _mo('−'), _mi('ρ'))),
      _row(_mn('1'), _mo('−'), _mi('ρ')),
    ),
  )),
  uCRRANorm: _wrap(                                                             // (w / w₀)^(1 − ρ)
    _sup(
      _row(_mo('('), _frac(_mi('w'), _sub(_mi('w'), _mn('0'))), _mo(')')),
      _row(_mn('1'), _mo('−'), _mi('ρ')),
    ),
  ),
  uCRRANormI: _wrap(                                                            // (w / w₀)^(1 − ρ_i)
    _sup(
      _row(_mo('('), _frac(_mi('w'), _sub(_mi('w'), _mn('0'))), _mo(')')),
      _row(_mn('1'), _mo('−'), _sub(_mi('ρ'), _mi('i'))),
    ),
  ),
  uOfW:      _wrap(_row(_sub(_mi('U'), _mi('i')), _mo('('), _mi('w'), _mo(')'))),   // U_i(w)
  uDef:      _wrap(_row(                                                            // u_{i,t} = U_i(w_{i,t}) / U_i(w_{i,0})
    _sub(_mi('u'), _it), _mo('='),
    _frac(
      _row(_sub(_mi('U'), _mi('i')), _mo('('), _sub(_mi('w'), _it), _mo(')')),
      _row(_sub(_mi('U'), _mi('i')), _mo('('), _sub(_mi('w'), _row(_mi('i'), _mo(','), _mn('0'))), _mo(')')),
    ),
  )),

  /* Risk-mix shares and population counts */
  alphaL:    _wrap(_sub(_mi('α'), _mi('L'))),                                 // α_L
  alphaN:    _wrap(_sub(_mi('α'), _mi('N'))),                                 // α_N
  alphaA:    _wrap(_sub(_mi('α'), _mi('A'))),                                 // α_A
  nF:        _wrap(_sub(_mi('N'), _mi('F'))),                                 // N_F
  nT:        _wrap(_sub(_mi('N'), _mi('T'))),                                 // N_T
  nR:        _wrap(_sub(_mi('N'), _mi('R'))),                                 // N_R
  nE:        _wrap(_sub(_mi('N'), _mi('E'))),                                 // N_E
  nU:        _wrap(_sub(_mi('N'), _mi('U'))),                                 // N_U

  /* Classic agent class membership labels */
  inF:       _wrap(_row(_mi('i'), _mo('∈'), _mi('F'))),                       // i ∈ F
  inT:       _wrap(_row(_mi('i'), _mo('∈'), _mi('T'))),                       // i ∈ T
  inR:       _wrap(_row(_mi('i'), _mo('∈'), _mi('R'))),                       // i ∈ R
  inE:       _wrap(_row(_mi('i'), _mo('∈'), _mi('E'))),                       // i ∈ E
  inU:       _wrap(_row(_mi('i'), _mo('∈'), _mi('U'))),                       // i ∈ U

  /* Messaging + trust */
  msgIt:     _wrap(_sub(_mi('m'), _imsgT)),                                   // m_{i→*,t}
  trustRS:   _wrap(_sub(_mi('T'), _rarrs)),                                   // T_{r→s}
  lieGap:    _wrap(_abs(_row(_sub(_tilde(_mi('V')), _it), _mo('−'), _sub(_hat(_mi('V')), _it)))),  // |Ṽ−V̂|

  /* Compound equations used in figure eq strips */
  mispricing:    _wrap(_row(_sub(_mi('P'), _mi('t')), _mo('−'), _sub(_row(_mi('F'), _mi('V')), _mi('t')))),        // P_t − FV_t  (signed)
  absMispricing: _wrap(_abs(_row(_sub(_mi('P'), _mi('t')), _mo('−'), _sub(_row(_mi('F'), _mi('V')), _mi('t'))))),  // |P_t − FV_t|  (kept for ND metric)
  volDef:    _wrap(_row(                                                      // V_t = Σ_{trades ∈ t} q
    _sub(_mi('V'), _mi('t')), _mo('='),
    _sub(_mo('Σ'), _row(_mi('trades'), _mo('∈'), _mi('t'))),
    _mi('q'),
  )),
  actionSet: _wrap(_row(                                                      // α ∈ { hold, buy@A_t, sell@B_t, bid, ask }
    _mi('α'), _mo('∈'),
    _mo('{'),
    _mi('hold'), _mo(','),
    _row(_mi('buy'), _mo('@'), _sub(_mi('A'), _mi('t'))), _mo(','),
    _row(_mi('sell'), _mo('@'), _sub(_mi('B'), _mi('t'))), _mo(','),
    _mi('bid'), _mo(','),
    _mi('ask'),
    _mo('}'),
  )),
  valCompare: _wrap(_row(                                                     // V̂_{i,t} vs Ṽ_{i,t}
    _sub(_hat(_mi('V')), _it), _mi('vs'), _sub(_tilde(_mi('V')), _it),
  )),
  ownershipEq: _wrap(_row(                                                    // q_{i,t} · Σ_i q_{i,t} = Q
    _sub(_mi('q'), _it), _mo('·'),
    _sub(_mo('Σ'), _mi('i')), _sub(_mi('q'), _it),
    _mo('='), _mi('Q'),
  )),
  msgDef:    _wrap(_row(                                                      // m_{i→*,t} = (signal, Ṽ_{i,t})
    _sub(_mi('m'), _imsgT), _mo('='),
    _mo('('), _mi('signal'), _mo(','), _sub(_tilde(_mi('V')), _it), _mo(')'),
  )),
  trustEq:   _wrap(_row(                                                      // T_{r→s} ← (1−λ)·T_{r→s} + λ·closeness_{r,s}
    _sub(_mi('T'), _rarrs), _mo('←'),
    _mo('('), _mn('1'), _mo('−'), _mi('λ'), _mo(')'), _mo('·'),
    _sub(_mi('T'), _rarrs), _mo('+'),
    _mi('λ'), _mo('·'),
    _sub(_mi('closeness'), _row(_mi('r'), _mo(','), _mi('s'))),
  )),

  /* Figure-specific symbols that previously lived as raw text */
  qOrder:      _wrap(_mi('q')),                                               // q
  lambdaRate:  _wrap(_mi('λ')),                                               // λ
  closenessRS: _wrap(_sub(_mi('closeness'), _row(_mi('r'), _mo(','), _mi('s')))), // closeness_{r,s}
  heatBin:     _wrap(_row(                                                    // H(P, t)
    _mi('H'), _mo('('), _mi('P'), _mo(','), _mi('t'), _mo(')'),
  )),
  heatBinDef:  _wrap(_row(                                                    // H(P, t) = Σ q over (P, t) bins
    _mi('H'), _mo('('), _mi('P'), _mo(','), _mi('t'), _mo(')'), _mo('='),
    _sub(_mo('Σ'), _row(_mo('('), _mi('P'), _mo(','), _mi('t'), _mo(')'))),
    _mi('q'),
  )),

  /* Metrics table compound expressions */
  normAvgDev: _wrap(_frac(                                                    // Σ|P̄_t − FV_t| / Q
    _row(_mo('Σ'), _abs(_row(_sub(_bar(_mi('P')), _mi('t')), _mo('−'), _sub(_row(_mi('F'), _mi('V')), _mi('t'))))),
    _mi('Q'),
  )),
  avgVbar:   _wrap(_row(_mo('⟨'), _sub(_hat(_mi('V')), _mi('i')), _mo('⟩'))), // ⟨V̂_i⟩
  efficiencyEq: _wrap(_frac(                                                  // Σ V̂_i · q_i / (V̂* · Q)
    _row(_mo('Σ'), _sub(_hat(_mi('V')), _mi('i')), _mo('·'), _sub(_mi('q'), _mi('i'))),
    _row(_mo('('), _sup(_hat(_mi('V')), _mo('*')), _mo('·'), _mi('Q'), _mo(')')),
  )),
  totalWelfareEq: _wrap(_row(                                                 // Σ u_i(w_{i,t})
    _mo('Σ'), _sub(_mi('u'), _mi('i')), _mo('('), _sub(_mi('w'), _it), _mo(')'),
  )),
};

/* ---- Hydration --------------------------------------------- *
 * Scan the DOM (or a subtree) for `<span data-sym="key">` place-
 * holders and replace their contents with the matching MathML.
 * Safe to call repeatedly; an already-hydrated placeholder is
 * re-assigned the same HTML so the DOM stays idempotent.
 * ------------------------------------------------------------ */

function hydrateSymbols(root) {
  const scope = root || document;
  const nodes = scope.querySelectorAll('[data-sym]');
  nodes.forEach(el => {
    const key = el.getAttribute('data-sym');
    if (key && Sym[key]) el.innerHTML = Sym[key];
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => hydrateSymbols(document));
  } else {
    hydrateSymbols(document);
  }
}

window.Sym = Sym;
window.hydrateSymbols = hydrateSymbols;

/* Expose the element builders so other modules (ui.js) can assemble
 * asset-specific MathML on the fly without re-implementing the
 * <mi>/<mn>/<mo>/<mrow>/<msub>/<msup>/<msubsup>/<mover>/<mfrac>/<msqrt>
 * grammar. Keeps the native-MathML, no-dependency promise: every new
 * formula still routes through the same primitives as Sym above. */
window.Mml = {
  mi: _mi, mn: _mn, mo: _mo,
  row: _row,
  sub: _sub, sup: _sup, subsup: _subsup,
  hat: _hat, tilde: _tilde, bar: _bar,
  sqrt: _sqrt, frac: _frac, abs: _abs,
  wrap: _wrap,
};
