# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Browser-based replication of the Dufwenberg, Lindqvist & Moore (2005) continuous
double auction experimental market, extended with a "Utility" agent type that
supports inter-agent messaging, trust, and optional deception. Pure HTML + CSS +
vanilla JavaScript, no frameworks, no build step, no dependencies. Open
`index.html` directly in a browser to run.

## Architecture

The runtime is organized as a pipeline from simulation core → logging → view
construction → rendering. Each layer only talks to the one below it.

```
main.js       App state, control wiring, render scheduling (rAF-coalesced)
  │
engine.js     Simulation loop + seeded mulberry32 PRNG, dividend draws
  │
market.js    ─ Order, Trade, OrderBook (price-time priority), Market
assets.js    ─ Registry of six tradeable asset environments
                (linear-declining, perpetual, cyclical, random-walk,
                jump/crash, linear growth). Each spec exports
                `init(config)`, `fundamentalValue(period, state)`, and
                `drawDividend(period, state, rng, config, tunables)`.
                `Market.setAsset()` installs the selected spec at each
                round boundary; `state` is round-local and discarded on
                reset. Five of six anchor `FV_1 = 100`; Linear Growth
                uses a discounted tail-sum that gives `FV_1 ≈ 58.3`.
                Per-session scheduling lives in `main.js`, driven by
                Advanced → Session Replacement Rate and Pre/Post Asset
                & FV Correlation.
agents.js    ─ Agent base + Fundamentalist/Trend/Random/DLMTrader/Utility +
                sampling helpers. At runtime every slot is a
                `UtilityAgent` (N defaults to 10, adjustable up to 100);
                the F/T/R/DLMTrader classes remain in
                the file as historical reference for the Strict-DLM /
                AIPE conceptual decomposition but are not instantiated
                at runtime. Decisions return order objects with a
                reasoning trace attached. `DLMTrader` has a single class
                with a two-branch `decide()` gated on an endogenous
                `roundsPlayed` counter — it starts at 0 and is incremented
                by the engine at every round boundary, flipping the agent
                from the bubble-prone novice branch to the FV-anchored
                veteran branch. No agent is ever instantiated with
                `roundsPlayed > 0`; experience is purely procedural.
messaging.js ─ Message bus + trust tracker (only used by UtilityAgent)
utility.js   ─ UtilityAgent belief/valuation model + UTILITY_DEFAULTS
ai.js        ─ OpenAI/Anthropic/Gemini chat wrapper used by (a) the AIPE
                (Wang) paradigm for psych-anchor elicitation and (b)
                Plan II/III utility traders for per-tick action
                selection. `AI.getPlanBeliefs(...)` reads
                `market.assetType.agentTemplate` for the current round
                (populated in `js/assets.js` from companion-paper v3
                §5.3/§5.9/§5.15/§5.21/§5.27/§5.33 — section numbers
                resolve against `latex/`, which has its own README)
                and splices an 【Asset Environment】 block — dividend
                rule, horizon, model-based FV formula, common heuristic
                mistake — into the user prompt. The system prompt
                carries the full v3 behavioral framework: the §2
                decomposition `V = λ·FṼ + (1−λ)·H`, the subjective
                valuation `V^subj = α·FṼ + (1−α)·H + ε`, the
                peer-weighted posterior `V^post = w·V^subj + (1−w)·m̄`,
                the reported value `v̂ = max(0, V·φ)` with communication
                style `σ ∈ {H, B, D}`, and the market signal
                `m̄ = mean of reported values`, followed by empty-book
                initiation rules (HOLD disallowed on an empty book,
                price formation `bid = V·(1−ε)` / `ask = V·(1+ε)` with
                `ε ∈ [0.01, 0.05]`). The user-prompt action list
                already falls back to an FV-anchored BID/ASK_1 when
                `best_bid`/`best_ask` is missing, matching the FV
                anchor in `agents._translateLLMAction` so the executed
                price agrees with the prompt. Historical FV paths in the prompt
                read through `market.fundamentalValue(p)` so they track
                the active asset instead of the DLM staircase. When the
                engine swaps asset at the replacement-round boundary
                (driven by Advanced → Session Replacement Rate,
                Pre/Post Asset & FV Correlation) the prompt swaps with
                it; Figure 5 in the Architecture tab shows the six
                variants side-by-side. Keys are never persisted.
logger.js    ─ Append-only trace, snapshot, and event stores
  │
replay.js     Build "view" objects from Market + Logger state, either live
              (buildLiveView) or at a historical tick (buildViewAt)
  │
viz.js        HiDPI canvas drawing primitives
mathml.js     Single source of truth for every math symbol in the UI.
              Native browser MathML (no KaTeX / MathJax — preserves the
              no-dependency promise). Dynamic renderers embed `Sym.<key>`
              in template literals; static HTML uses
              `<span data-sym="key">` placeholders that `hydrateSymbols()`
              fills on `DOMContentLoaded`. New symbols go in the `Sym` map
              here, never inline in ui.js.
ziputil.js    Dependency-free PKZIP writer (uses the browser's
              `CompressionStream('deflate-raw')` for DEFLATE; falls back
              to STORED when unavailable). Used by `main.js` to bundle
              export downloads. Preserves the no-deps promise — do not
              swap in a library.
ui.js         DOM + canvas rendering; consumes views only, never touches
              Market/Engine/Agent directly — so live and replay rendering
              go through identical code paths
```

Invariants that the replay system relies on:

- History arrays on `Market` (`priceHistory`, `trades`, `volumeByPeriod`,
  `dividendHistory`) and on `Logger` are **append-only**. Never mutate or
  remove entries — `Replay.buildViewAt(tick)` reconstructs a past state by
  slicing to a recorded length.
- All randomness flows through the seeded RNG passed into `Engine`. Do not
  call `Math.random()` from agent or market code, or reproducibility by
  `(population, seed)` pair breaks.
- `ui.js` must never reach into `Market`/`Engine`/`Agent` state directly;
  always go through a view object from `replay.js`.

## Session structure: rounds, periods, and the 10-session batch

A single press of Start runs a **10-session batch** — 5 sessions with the
first selected DLM treatment (T20 or T40) followed by 5 with the other.
Each *session* is `roundsPerSession` consecutive *rounds* (fixed at
`R = 4`, the DLM 2005 design). Each round is a complete `T = 20` period
market that lasts `T × ticksPerPeriod = 360` ticks, so a session is
`R × T × K = 1 440` ticks and a full batch is 14 400 ticks.

`App.currentSession` tracks which session is active (1–10); it is set to
0 between batches and on manual Reset. The per-round data collector in
`start()`'s `onEnd` callback labels every round with `R{r}_S{s}` (e.g.
`R3_S7` = round 3 of session 7) and stores it in `App.batchResults`.

At the end of period `T` of a non-final round the `Engine`:

1. snapshots every surviving agent's cash into
   `Logger.roundFinalCash[r-1]` for payoff accounting,
2. logs a `round_end` event,
3. **increments every surviving agent's `roundsPlayed` by one**, so any
   `DLMTrader` that just finished a round flips from the inexperienced
   branch to the experienced branch for the next round,
4. if the round that just ended was round 3 and `ctx.treatmentSize > 0`,
   runs `_round4Replacement()` — Fisher-Yates selects `treatmentSize`
   experienced agents (T20 = 20 replacements, T40 = 40), clones their
   specs with a fresh name drawn from `AGENT_NAMES`, and re-instantiates
   them via `buildAgentsFromSpecs` at the vacated numeric ids with
   `roundsPlayed = 0` and `replacementFresh = true`,
5. rewinds every surviving agent's `cash` and `inventory` to its
   `agentSpecs` entry (the fresh splice-ins take their own replacement
   endowment on the same call),
6. clears the order book and sets `lastPrice = null`,
7. increments `Market.round`, resets `Market.period = 1`,
8. logs a `round_start` event,
9. calls `agent.onRoundStart()` so subclasses can null out per-round
   transient state (`TrendFollower` clears slope history; `UtilityAgent`
   rebases `initialWealth` and clears subjective/reported valuations and
   received messages).

What is **deliberately preserved** across the boundary: `roundsPlayed`
(the endogenous experience counter), trust matrices, belief modes, risk
preferences, and the agent's identity. That cross-round learning channel
is the whole point of DLM 2005's session structure (experience kills the
bubble), and the simulator reproduces it by leaving those fields
untouched in `_resetRound()` — only cash, inventory, and per-round
transient state rewind.

The per-round volume series lives in a single `Market.volumeByPeriod` array
of size `R × T + 2`, indexed by a global period
`g = (round − 1) × T + period`. Use `Market.sessionPeriod()` whenever you
need that index. Trades and `priceHistory` entries carry a `round` tag so
multi-round views can bucket them correctly.

The `replay.js` views and the `ui.js` charts both compute the full session
extent from `roundsPerSession` and draw round dividers at every round
boundary; legacy single-round runs still work because all of the multi-round
logic falls through cleanly when `roundsPerSession = 1`.

## Parameters panel and tunables

Every numeric constant that shapes the sim is exposed in the Parameters panel
in `index.html` and mirrored into `App.tunables` in `main.js`. Market-level
knobs mirror `App.config`; the rest mirror `UTILITY_DEFAULTS` in `js/agents.js`.
The engine and agents read from `ctx.tunables` when present and fall back to
`UTILITY_DEFAULTS` via the `tunable()` helper when a key is missing — so
tunables that aren't exposed as sliders still have a safe default.

The Advanced settings panel exposes two boolean toggles — **Prior
Bias** and **Prior Noise** — wired to `App.tunables.applyBias` and
`App.tunables.applyNoise`, plus a single **Regulator** slider (0–100%)
gated by the `.plan-llm-only` CSS class so it only renders when the
body carries `plan-ii` or `plan-iii`. The slider value drives both
`App.tunables.regulatorThreshold` (= value/100) and
`App.tunables.applyRegulator` (= value > 0); zero is the canonical
disabled state and is also the default, so a fresh load posts no
regulator interventions until the user moves the slider. Prior Bias
and Prior Noise act on the prior: it becomes `FV̂ × (1 + bias + noise)`
where `bias` is the agent's persistent `biasMode × biasAmount` tilt
and `noise` is an i.i.d. per-tick draw from
`U[-valuationNoise, +valuationNoise]`. When both are off the prior
collapses to the exact FV (pure Plan I baseline). Toggle state is
captured in every engine snapshot and surfaces in the reasoning trace
(`biasActive`, `noiseActive`), the replay view (`v.tunables`), and
the Plan II/III LLM prompt (under "YOUR PRIVATE STATE").

**Regulator** is a Plan II/III feature: when the slider value > 0 the
engine computes the bubble ratio `|P_t − FV_t| / FV_t` at every period
boundary and, the first time it crosses `regulatorThreshold` within a
round, sets a sticky
`ctx.regulatorWarning = { ratio, threshold, period, round, firedTick,
lastPrice, fv }` and logs a `regulator_warning` event. `_resetRound()`
clears the warning at the next round boundary so each round starts
clean. `ai.js` reads the warning as the 8th argument to
`getPlanBeliefs` and prepends a top-of-prompt `⚠️ REGULATOR WARNING ⚠️`
block to every Utility agent's LLM prompt for the rest of that round,
naming the bubble ratio and reminding the agent the asset's intrinsic
payoff has not changed. Plan I has no LLM channel, so under Plan I the
toggle is recorded in the snapshot but does not change agent behavior;
the warning event still fires so a replay shows where the regulator
*would* have intervened.

The **Risk preferences** subsection uses three linked sliders
(α<sub>L</sub>/α<sub>N</sub>/α<sub>A</sub>) that always sum to 100 and drive
a composition bar (`#comp-bar`) above them. `App.riskMix` holds the current
split and is read by the sampling stage; `distributeRiskPrefs` in
`agents.js` turns those percentages into a per-slot `riskPref` override
(loving/neutral/averse), so the sliders directly control how many utility
agents of each risk type are instantiated without disturbing the
bias/deception/belief variety in the strategy cube.

## Sampling stage (names + endowments)

Before the simulation starts, `sampleAgents(mix, rng, options)` in
`agents.js` draws a flat list of per-agent specs from the current `mix`.
Each spec carries:

- `id`, `slot`, `type`, `typeLabel` (U1, U3, …)
- `name` — a random personal name drawn without replacement from
  `AGENT_NAMES`
- `cash`, `inventory` — drawn from `ENDOWMENT_DEFAULT` (uniform
  [800, 1200] cash, uniform {2,3,4} inventory)
- strategy fields for utility agents (`riskPref`, `biasMode`, …)

`App.agentSpecs` caches the current draw. The **Agents** panel shows the
spec list as editable cards before `tick === 0`; editing cash/inventory
commits through `App.updateEndowment(id, field, value)` which mutates the
spec in place and calls `App.rebuild()` — no reseed, no re-sample, the
edits survive. Structural changes (risk shares) and the header's
**Reset** button call `App.reset()` instead, which
rolls a new engine seed via `Math.random()`, nulls the spec cache, and
delegates to `rebuild()` so a fresh population is drawn against the new
seed. There is no seed input in the UI and no separate Resample button
— "start over with different agents" is the default behavior of Reset.

The sample RNG is derived from `seed ^ 0xA5A5A5A5` and is intentionally
independent of the engine RNG (`makeRNG(seed)`), so endowment edits +
rebuild produce the same per-tick trading sequence as a matched run
without an edit.

When adding a new tunable:
1. Add the slider row in `index.html` with a `data-tip` explanation.
2. Add the default to `App.tunables` in `main.js`.
3. Wire read/write in the parameter-panel setup in `main.js`.
4. Read it from `ctx.tunables` in the consuming agent/engine code with a
   fallback to the hard-coded default so legacy callers still work.

Total population defaults to **N = 10** (set by `App.TOTAL_N` and
`mix.U` in `js/main.js`) and is adjustable up to 100 via the Agents
slider in Advanced settings. DLM 2005 §I pins the original design at
6 subjects; the simulator's default N = 10 sits between the paper's
six-subject design and the N = 100 scaled regime, and round-4
treatment labels interpolate accordingly (T2/T4 at N = 10, T20/T40
at N = 100 — see the dynamic `const-n-note` handler in `main.js`).
DLM uses homogeneous human subjects with no algorithmic agent types
(Fundamentalist/Trend/Random are not part of the DLM design). Every
slot at runtime is a `UtilityAgent`; the only composition knob is the
risk-preference split (αL/αN/αA).

## Paradigms

The navbar switches between three paradigms; each pins a different
sampling pipeline and a different set of visible controls. The table
below is the **conceptual decomposition only** — none of these
compositions are actually instantiated. At runtime the simulator
always calls `sampleAgents(mix, rng, options)` with N `UtilityAgent`
slots regardless of paradigm (N defaults to 10, adjustable via the
Agents slider). The paradigm selection changes prompts, visible
controls, and elicitation hooks, not the agent class mix.

| Paradigm    | Conceptual composition (not instantiated)           | Purpose                                                         |
|-------------|-----------------------------------------------------|-----------------------------------------------------------------|
| Strict-DLM  | 100 `DLMTrader`, 50 × type A + 50 × type B          | Scaled replication of Dufwenberg–Lindqvist–Moore (2005)         |
| Lopez-Lira  | 100 `UtilityAgent` (strategy cube over bias/belief/risk) | Expected-utility messaging market from Lopez-Lira (2025)   |
| AIPE        | Utility block + fixed F/T/R background              | AI-Agent Prior Elicitation on top of the Lopez-Lira model       |

The T20/T40 treatment selector in Trade Settings controls the round-4
replacement size.

### Plan I / Plan II / Plan III

Orthogonal to the paradigm axis, the UI exposes three *plans* that
control the cognition channel for utility agents:

- **Plan I** — no LLM. Deterministic priors anchored on the model FV;
  agent behavior is driven purely by `UtilityAgent` code in
  `utility.js`. This is the baseline and the fastest configuration.
- **Plan II / Plan III** — LLM-driven. Each utility agent's per-tick
  action is selected by `AI.getPlanBeliefs(...)` in `ai.js`
  (OpenAI/Anthropic/Gemini). Plan II/III also unlock the Regulator
  slider, the LLM-only sliders, and the per-agent reasoning trace
  fields sourced from the LLM response.

The current plan is reflected on `<body>` as the CSS classes `plan-i`,
`plan-ii`, or `plan-iii`, and Plan II/III-only controls are gated by
the `.plan-llm-only` selector.

**10-session batch.** One press of Start runs 10 sessions animated
at the Speed slider rate (5 × first selected treatment + 5 × the
other). Each session calls `reset()` for a fresh seed, then
`engine.start()` with an `onEnd` callback that collects per-round
metrics labeled `R{r}_S{s}` into `App.batchResults` (40 rows total:
4 rounds × 10 sessions). The batch results panel (Table 2 in the
Experiment tab) renders these rows with per-treatment aggregates.
Pause stops the chain via `_batchRunning = false`.

The shorthand T*k* preserves DLM's R4-⅔ / R4-⅓ labelling by pinning
*k* to the number of fresh replacements at the current N: at N = 10
that's **T2 / T4** (2 or 4 replacements), at N = 100 it's
**T20 / T40** (20 or 40 replacements), with linear interpolation in
between. The DLM ⅔ / ⅓ fractions refer to the original 6-subject
design; at scaled N the remaining-veteran fractions drift (e.g.
80/100 for T20 at N = 100) but the ⅔ / ⅓ labels are kept as names.

Session payoff for agent `i` is
`π_i = Σ_r roundFinalCash[r-1][i] + 500¢` (the show-up fee), captured
by `Logger.logRoundFinalCash` at the end of period `T` of every round.

Fundamental value at the start of period *t* of any round is
`FV_t = dividendMean × (T − t + 1)` — a staircase from `FV_1 = 100` to
`FV_T = 5` that resets at every round boundary.

## Companion directories

- `latex/` — LaTeX source for the accompanying paper (has its own `README.md`).
- `pdf/` — compiled paper artifacts.
- `arch-*.drawio` (four files in the repo root: `pipeline`, `microstructure`,
  `elicitation`, `revision`) — architecture diagrams. Open these in drawio
  when the big picture is in question rather than inferring it from code.

## Working in this repo

- No build, no tests, no package manager. Verify changes by opening
  `index.html` in a browser (`open index.html` on macOS) and exercising
  the sliders and Start/Pause/Reset. There is no logging infrastructure
  — the browser DevTools console is the only error surface, so check it
  whenever the UI silently breaks.
- Live site <https://assets.m0nius.com> is served via GitHub Pages
  (`CNAME` in repo root). Pushes to `master` auto-deploy, so keep commits
  scoped tightly and do the browser check before pushing.
- Prefer editing existing modules over adding new ones — the module boundaries
  above are load-bearing for the replay system.
- Keep the code framework-free and dependency-free. No npm, no bundler, no
  transpilation. All JS files use `'use strict'` and are loaded as plain
  `<script>` tags from `index.html`.
- Match the existing commenting style: module header block explaining the
  role of the file, short inline comments only where the *why* is non-obvious.
- Canvas colors are driven by CSS custom properties in `styles.css` (the
  light/dark/auto theme, with domain aliases like `--fv`, `--bubble`,
  `--volume`, `--bid`, `--ask`). When adding theme-dependent drawing,
  register the variable there and read it via `getComputedStyle` from
  `viz.js` so theme toggles flow through without a dedicated re-render path.
- The root `README.md` is user-facing marketing copy and has drifted from
  runtime behavior. Specifically: its "Reference configurations" table
  (6-agent presets like "2 Trend · 2 Random · 1 F · 1 E") and the `(ext.)`
  chart-panel markers predate the all-UtilityAgent regime. At runtime
  every slot is a `UtilityAgent` (N defaults to 10, slider up to 100),
  so those presets aren't reachable and the
  "extended" panels always render. Trust this file and the current code
  over the README for runtime behavior.
