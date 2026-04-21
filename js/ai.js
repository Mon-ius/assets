'use strict';

/* ======================================================================
   ai.js — AIPE (AI-Agent Prior Elicitation) endpoint + Plan II/III
   LLM-trader prompt builder.

   Thin, dependency-free wrapper around the OpenAI /v1/chat/completions
   API, used by the AIPE paradigm (data-paradigm="wang" retained as the
   internal code key for stability) and by the Plan II/III utility
   traders. Reuses the `{endpoint, apiKey, model}` shape from the lying
   project's agent roster and its plain-text response contract (no
   structured JSON, no function calls).

   Plan II/III per-asset prompting: `getPlanBeliefs` reads
   `market.assetType.agentTemplate` (populated from v3 §5.3/§5.9/§5.15/
   §5.21/§5.27/§5.33 in js/assets.js) and splices the round's active
   asset-input template into the user prompt — the asset selected in
   Advanced → "Session Replacement Rate, Pre/Post Asset & FV Correlation"
   for the current round drives the Asset Environment block, so when the
   engine swaps asset at the replacement-round boundary the LLM's FV
   formula and dividend rule swap with it.

   Flow:

     1. main.js reads the three fields (#ai-key, #ai-endpoint, #ai-model)
        into App.aiConfig on every run start — nothing is persisted to
        localStorage, matching the lying project's deliberately forgetful
        design.

     2. When the paradigm is 'wang' AND the key is non-empty AND the
        current population has at least one Utility agent, App.start()
        fires AI.getPsychAnchors(agents, config, aiCfg) and awaits the
        result before launching the engine loop.

     3. Each Utility agent in the resulting map receives its psychological
        anchor — a single number in [0.25·FV₀, 1.75·FV₀] — which the
        agent writes into `psychAnchor`. On the first decision tick the
        agent seeds `subjectiveValue` from that anchor instead of the
        default `FV · (1 + bias + noise)` prior, so the model's psychology
        shows up in the very first order posted.

     4. Errors, missing keys, or invalid responses fall back to the
        deterministic Lopez-Lira belief model without disturbing the run.
        AIPE must still produce a simulation when the network is
        unavailable, because the paper's research question ("does the
        asset end up with the highest-V̂ agent") is answerable from the
        deterministic path alone — the AI agent only adds a stronger,
        more heterogeneous psychological signal.
   ====================================================================== */

const AI = {
  /**
   * Provider definitions — endpoint, agent-capable models, and default
   * for each supported LLM provider. The UI builds the provider
   * dropdown from PROVIDERS and swaps the model list on change.
   */
  /**
   * `tpm` on each model is an *approximate* average tokens-per-minute
   * ceiling at the provider's default paid tier — it is not authoritative
   * and will be wrong on free/org-adjusted tiers. Units are literal tokens
   * per minute; `_fmtTPM` below renders them as "30k" / "2M" in the UI.
   * The per-tick utility-agent prompt is ~2–4k tokens, so 100 agents at
   * speed 1 (5 s/tick ⇒ 12 ticks/min) needs ~2.4M–4.8M TPM; only the
   * nano/Flash tiers comfortably sustain that. Mini/Sonnet handle Plan II
   * at reduced agent counts. Opus/Pro/gpt-5.4 are fine for single-round
   * inspection runs only.
   */
  PROVIDERS: {
    openai: {
      label: 'OpenAI ChatGPT',
      endpoint: 'https://openai-20250719-f7491cbb.rootdirectorylab.com/v1/chat/completions',
      keyPlaceholder: 'sk-...',
      models: [
        { id: 'gpt-4o',       label: 'GPT-4o',       tpm:    30000 },
        { id: 'gpt-5.4',      label: 'GPT-5.4',      tpm:    30000 },
        { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini', tpm:   200000 },
        { id: 'gpt-5.4-nano', label: 'GPT-5.4 nano', tpm:  2000000 },
      ],
      default: 'gpt-4o',
    },
    gemini: {
      label: 'Google Gemini',
      endpoint: 'https://gemini-20250719-bdb3d11b.rootdirectorylab.com/v1beta',
      keyPlaceholder: 'AIza...',
      models: [
        { id: 'gemini-3-flash-preview',        label: 'Gemini 3 Flash Preview',       tpm: 1000000 },
        { id: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash-Lite Preview', tpm: 4000000 },
        { id: 'gemini-3.1-pro-preview',        label: 'Gemini 3.1 Pro Preview',       tpm:   32000 },
      ],
      default: 'gemini-3-flash-preview',
    },
    claude: {
      label: 'Anthropic Claude',
      endpoint: 'https://anthropic-20250719-b6006324.rootdirectorylab.com/v1/messages',
      keyPlaceholder: 'sk-ant-...',
      models: [
        { id: 'claude-opus-4-7',      label: 'Claude Opus 4.7',   tpm:   30000 },
        { id: 'claude-sonnet-4-7',    label: 'Claude Sonnet 4.7', tpm:   80000 },
        { id: 'claude-haiku-4-5',     label: 'Claude Haiku 4.5',  tpm:  400000 },
      ],
      default: 'claude-sonnet-4-7',
    },
  },

  /** Render a TPM integer as "30K" / "2M" for dropdown labels. */
  _fmtTPM(tpm) {
    if (!tpm && tpm !== 0) return '';
    if (tpm >= 1000000) return (tpm / 1000000).toFixed(tpm % 1000000 ? 1 : 0) + 'M';
    if (tpm >= 1000)    return Math.round(tpm / 1000) + 'K';
    return String(tpm);
  },

  DEFAULT_PROVIDER: 'openai',

  /** Convenience accessors — resolve via the active provider. */
  getProvider(key) {
    return this.PROVIDERS[key] || this.PROVIDERS[this.DEFAULT_PROVIDER];
  },
  getModels(providerKey) { return this.getProvider(providerKey).models; },
  getDefaultModel(providerKey) { return this.getProvider(providerKey).default; },
  getDefaultEndpoint(providerKey) { return this.getProvider(providerKey).endpoint; },
  getKeyPlaceholder(providerKey) { return this.getProvider(providerKey).keyPlaceholder; },

  /**
   * gpt-5 / o3+ / o1+ families require `max_completion_tokens` in
   * place of the legacy `max_tokens` field.
   */
  _usesCompletionTokens(model) {
    return /^(gpt-5|o[3-9]|o[1-9]\d)/.test(model || '');
  },

  /* ---- Provider-specific call implementations ---- */

  async _callOpenAI(cfg, system, prompt) {
    const endpoint  = cfg.endpoint || this.getDefaultEndpoint('openai');
    const model     = cfg.model    || this.getDefaultModel('openai');
    const maxTokens = cfg.maxTokens || 1024;
    const body = {
      model,
      temperature: cfg.temperature ?? 0.4,
      ...(this._usesCompletionTokens(model)
        ? { max_completion_tokens: maxTokens }
        : { max_tokens: maxTokens }),
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: prompt },
      ],
    };
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw this._httpError('openai', res, text);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('ai.openai: no content');
    return content.trim();
  },

  async _callGemini(cfg, system, prompt) {
    const model     = cfg.model || this.getDefaultModel('gemini');
    const base      = cfg.endpoint || this.getDefaultEndpoint('gemini');
    const endpoint  = `${base.replace(/\/+$/, '')}/models/${model}:generateContent?key=${cfg.apiKey}`;
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: cfg.temperature ?? 0.4,
        maxOutputTokens: cfg.maxTokens || 1024,
      },
    };
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw this._httpError('gemini', res, text);
    }
    const data = await res.json();
    const content = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof content !== 'string') throw new Error('ai.gemini: no content');
    return content.trim();
  },

  async _callClaude(cfg, system, prompt) {
    const endpoint  = cfg.endpoint || this.getDefaultEndpoint('claude');
    const model     = cfg.model    || this.getDefaultModel('claude');
    const body = {
      model,
      max_tokens: cfg.maxTokens || 1024,
      system,
      messages: [{ role: 'user', content: prompt }],
    };
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw this._httpError('claude', res, text);
    }
    const data = await res.json();
    const block = (data?.content || []).find(b => b.type === 'text');
    if (!block || typeof block.text !== 'string') throw new Error('ai.claude: no content');
    return block.text.trim();
  },

  /* ---- Retry machinery (shared by all providers) ----
     Rate limits are the dominant real-world failure when running Plan
     II / III at N = 100 utility agents — a single period fires up to
     a hundred concurrent completions, and every provider's per-minute
     token budget will bite at least once per session. Retrying at the
     `call()` seam (rather than inside each provider) means the AIPE
     anchor path and the per-period belief update both benefit without
     duplicating logic. */

  /** Build a typed HTTP error carrying `status`, the raw response body,
   *  and a parsed wait hint. The body is preserved verbatim so the
   *  failure-warning UI can show the user what the endpoint actually
   *  returned instead of a truncated one-liner. */
  _httpError(providerKey, res, body) {
    const err = new Error(`ai.${providerKey}: HTTP ${res.status} ${body || ''}`);
    err.status     = res.status;
    err.provider   = providerKey;
    err.body       = body || '';
    err.retryAfter = this._parseRetryAfter(
      res.headers && typeof res.headers.get === 'function' ? res.headers.get('Retry-After') : null,
      body,
    );
    return err;
  },

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); },

  /** Retriable: rate-limit (429), request-timeout (408), too-early (425),
   *  any 5xx, or a network-level failure (no status attached). */
  _isRetriable(err) {
    const s = err && err.status;
    if (s === 429 || s === 408 || s === 425) return true;
    if (typeof s === 'number' && s >= 500 && s <= 599) return true;
    if (s == null) return true;
    return false;
  },

  /** Pick a wait duration. Prefer the provider's own hint when present;
   *  otherwise full-jitter exponential backoff (base 1 s, cap 30 s). */
  _computeWaitMs(err, attempt) {
    const hinted = err && err.retryAfter;
    if (Number.isFinite(hinted) && hinted > 0) {
      return Math.min(60_000, Math.ceil(hinted * 1000) + 250 + Math.floor(Math.random() * 500));
    }
    const base = Math.min(30_000, 1000 * Math.pow(2, attempt));
    return Math.max(500, Math.floor(base * (0.5 + Math.random() * 0.5)));
  },

  /** Extract a wait-in-seconds hint from a Retry-After header or the
   *  provider-specific error body. Supports:
   *    • Retry-After: "<seconds>" or HTTP-date
   *    • OpenAI:  "Please try again in 3.59s" / "in 1m20s" / "in 500ms"
   *    • Gemini:  "retryDelay": "25s"
   *    • Claude:  "retry_after": 30                                   */
  _parseRetryAfter(headerVal, bodyText) {
    if (headerVal) {
      const asNum = Number(headerVal);
      if (Number.isFinite(asNum) && asNum > 0) return asNum;
      const asDate = Date.parse(headerVal);
      if (!Number.isNaN(asDate)) {
        const diff = (asDate - Date.now()) / 1000;
        if (diff > 0) return diff;
      }
    }
    if (typeof bodyText !== 'string' || !bodyText) return null;

    // OpenAI "... try again in 3.59s" / "in 1m20s" / "in 500ms".
    const m = bodyText.match(/try again in\s+([0-9]+(?:\.[0-9]+)?)\s*(ms|s|m)\b/i);
    if (m) {
      const v = parseFloat(m[1]);
      const u = (m[2] || 's').toLowerCase();
      if (u === 'ms') return v / 1000;
      if (u === 'm')  return v * 60;
      return v;
    }
    // OpenAI sometimes emits a compound form "in 1m20s".
    const m2 = bodyText.match(/try again in\s+(?:([0-9]+)m)?\s*([0-9]+(?:\.[0-9]+)?)?\s*s?\b/i);
    if (m2 && (m2[1] || m2[2])) {
      const mins = m2[1] ? parseInt(m2[1], 10) : 0;
      const secs = m2[2] ? parseFloat(m2[2])   : 0;
      if (mins || secs) return mins * 60 + secs;
    }
    // Gemini: retryDelay: "25s".
    const g = bodyText.match(/retryDelay[^0-9]*([0-9]+(?:\.[0-9]+)?)\s*s/i);
    if (g) return parseFloat(g[1]);
    // Claude: retry_after: 30 (seconds).
    const c = bodyText.match(/retry[_-]after[^0-9]*([0-9]+(?:\.[0-9]+)?)/i);
    if (c) return parseFloat(c[1]);
    return null;
  },

  _errLabel(err) {
    if (err && err.status) return 'HTTP ' + err.status;
    const msg = err && err.message ? String(err.message) : 'unknown';
    return msg.length > 80 ? msg.slice(0, 80) + '…' : msg;
  },

  /** Provider dispatch without retries — used as the inner call of
   *  the retry loop in `call()`. */
  async _callOnce(cfg, system, prompt) {
    const provider = cfg.provider || this.DEFAULT_PROVIDER;
    if (provider === 'gemini') return this._callGemini(cfg, system, prompt);
    if (provider === 'claude') return this._callClaude(cfg, system, prompt);
    return this._callOpenAI(cfg, system, prompt);
  },

  /**
   * Unified call dispatcher with automatic retries for rate-limit /
   * transient failures. Each provider's `_call*` builds a typed error
   * with `{status, retryAfter}` on HTTP failure; this wrapper catches
   * those, waits for the hinted duration (or exponential-backoff
   * fallback), and retries up to `cfg.maxRetries` times (default 5).
   *
   * Permanent failures (4xx other than 429/408/425, no-content parse
   * errors) propagate immediately so a bad API key doesn't burn five
   * wait cycles before falling back to the deterministic path.
   */
  async call(cfg, system, prompt) {
    if (!cfg || !cfg.apiKey) throw new Error('ai.call: missing apiKey');
    const maxRetries = Number.isFinite(cfg.maxRetries) ? cfg.maxRetries : 5;
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        return await this._callOnce(cfg, system, prompt);
      } catch (err) {
        if (attempt >= maxRetries || !this._isRetriable(err)) {
          // Annotate the error with the attempt count so the failure
          // warning UI can tell the user e.g. "6 attempts exhausted".
          err.attempts = attempt + 1;
          throw err;
        }
        const waitMs = this._computeWaitMs(err, attempt);
        if (typeof console !== 'undefined' && console.warn) {
          const prov = cfg.provider || this.DEFAULT_PROVIDER;
          console.warn(
            `[ai.call] ${prov} attempt ${attempt + 1}/${maxRetries + 1} failed ` +
            `(${this._errLabel(err)}); retrying in ${(waitMs / 1000).toFixed(1)}s`,
          );
        }
        await this._sleep(waitMs);
        attempt++;
      }
    }
  },

  /** Redact the API key from an endpoint URL (Gemini passes it as a
   *  query param) so we never leak it into the failure-warning UI. */
  _redactEndpoint(url) {
    if (!url) return '';
    return String(url).replace(/([?&]key=)[^&]*/i, '$1[REDACTED]');
  },

  /**
   * Parse a psychological valuation out of a free-form AI-agent response.
   * The prompt asks for a single number; in practice models sometimes
   * prefix it with "My valuation is". The regex grabs the first
   * signed decimal and clamps it into [lo, hi] so an out-of-range
   * reply can never destabilize the engine.
   */
  parseValuation(raw, lo, hi) {
    if (typeof raw !== 'string') return null;
    const m = raw.match(/-?\d+(?:\.\d+)?/);
    if (!m) return null;
    const v = parseFloat(m[0]);
    if (!Number.isFinite(v)) return null;
    return Math.max(lo, Math.min(hi, v));
  },

  /**
   * Parse an action from the structured LLM response.
   * Expected format: "Reason: ... Action: BUY_NOW"
   */
  _VALID_ACTIONS: ['BUY_NOW', 'SELL_NOW', 'BID_1', 'BID_3', 'ASK_1', 'ASK_3', 'HOLD'],

  parseAction(raw) {
    if (typeof raw !== 'string') return null;
    const m = raw.match(/Action\s*:\s*(BUY_NOW|SELL_NOW|BID_1|BID_3|ASK_1|ASK_3|HOLD)/i);
    if (!m) return null;
    const action = m[1].toUpperCase();
    if (!this._VALID_ACTIONS.includes(action)) return null;
    const rm = raw.match(/Reason\s*:\s*(.+?)(?=\nAction|\n*$)/is);
    return { action, reason: rm ? rm[1].trim() : '' };
  },

  /**
   * Period-boundary LLM action request for Plans II and III.
   *
   * Fires one chat completion per utility agent in parallel and
   * returns a { [agentId]: {action, reason} } map, which the engine
   * writes into `ctx.llmActions` for the next tick's `decide()` to
   * consume. Under Plans II/III the LLM is the sole information AND
   * decision channel — agents.js skips updateBelief() entirely on
   * those plans, so no algorithmic prior, peer blend, or
   * subjectiveValuation is computed.
   *
   * The prompt is structured into two clearly labelled blocks:
   *
   *   PUBLIC MARKET STATE  — observable by all participants: market
   *     rules, current round/period, FV, order book, recent trades,
   *     cumulative volume, and peer messages from last period.
   *
   *   YOUR PRIVATE STATE   — known only to this agent: cash,
   *     inventory, rounds of experience, risk preference, belief
   *     mode, bias/noise configuration, and the resulting prior
   *     valuation. Plan II additionally reveals the explicit utility
   *     formula; Plan III reveals only the risk-preference label.
   *
   * Every call is independent; failures are logged and the agent
   * is simply skipped in the returned map — the engine treats a
   * missing key as "fall back to Plan I's algorithm next period"
   * so the run never stalls waiting for the network.
   *
   * @param {{[id:string]: object}} agents
   * @param {Market} market
   * @param {{periods:number, dividendMean:number}} config
   * @param {{apiKey:string, endpoint?:string, model?:string}} aiCfg
   * @param {'II'|'III'} plan
   * @param {object} [tunables]
   * @param {object} [logger] — optional; when provided the prompt includes
   *   per-round P&L from `logger.roundFinalCash`, so the LLM can reason
   *   about its own past performance instead of a rule-based experience
   *   label.
   * @param {?{ratio:number,threshold:number,period:number,round:number}} [regulator]
   *   Optional one-shot regulator warning (Advanced → "Regulator"). When
   *   provided AND ctx.tunables.applyRegulator is true, the prompt
   *   gains a top-of-message REGULATOR WARNING block describing the
   *   bubble ratio that tripped the regulator.
   * @returns {Promise<{[id:number]: number}>}
   */
  async getPlanBeliefs(agents, market, config, aiCfg, plan, tunables, logger, regulator) {
    if (!aiCfg || !aiCfg.apiKey) return {};
    if (plan !== 'II' && plan !== 'III') return {};
    const utilityAgents = Object.values(agents).filter(
      a => a && (a.type === 'utility' || a.constructor?.name === 'UtilityAgent'),
    );
    if (!utilityAgents.length) return {};

    const periods      = config.periods;
    const periodNow    = market.period;
    const kRemaining   = periods - periodNow + 1;
    const dividendAvg  = config.dividendMean;
    const fvNow        = market.fundamentalValue();

    // Bounded Rationality — Plan II/III toggle. When ON the system
    // prompt gains a Cognitive Constraints block (K reasoning steps,
    // N attention slots, T periods of price memory, ε-noisy perceived
    // FV, execution noise p, one heuristic from a short list) and the
    // price-history blocks in the user prompt are truncated to the
    // last T periods so the LLM literally cannot look further back
    // than a human subject's working memory. Defaults are fixed here
    // rather than exposed as sliders to keep the Advanced panel sane.
    const brOn = !!(tunables && tunables.applyBoundedRationality);
    const BR   = { K: 3, N: 5, T: 3, sigma: 10, p: 0.10 };

    // Active asset + its agent-input template (v3 §5.3 / §5.9 / §5.15 /
    // §5.21 / §5.27 / §5.33). Drives the "Asset Environment" block and
    // the per-period FV math in history lookbacks — so when the
    // engine swaps asset at the replacement-round boundary the LLM
    // prompt swaps with it, not the generic DLM staircase.
    const activeAsset  = market.assetType || null;
    const assetLabel   = activeAsset && activeAsset.label
      ? activeAsset.label : 'Linear Declining (DLM)';
    const assetTpl     = (activeAsset && activeAsset.agentTemplate)
      || null;
    // FV lookup for *past* periods of the current round: we can trust
    // market.fundamentalValue(p) while the market's asset state is the
    // one that ran those periods (same round). For prior rounds within
    // a session the asset may have swapped at the replacement boundary;
    // we still fall back to market.fundamentalValue(p) which at worst
    // returns the post-swap FV curve, then the DLM staircase when no
    // asset is installed.
    const fvAtPeriod   = (p) => {
      if (activeAsset && typeof market.fundamentalValue === 'function') {
        const v = market.fundamentalValue(p);
        if (Number.isFinite(v)) return v;
      }
      return dividendAvg * (periods - p + 1);
    };
    const lastPrice    = market.lastPrice != null ? market.lastPrice : fvNow;
    const bestBid      = market.book.bestBid();
    const bestAsk      = market.book.bestAsk();
    const bidPrice     = bestBid ? bestBid.price : null;
    const askPrice     = bestAsk ? bestAsk.price : null;

    // Previous reference price — last trade from prior period.
    const round        = market.round;
    const prevTrades   = market.trades.filter(
      t => t.round === round && t.period < periodNow,
    );
    const prevPrice    = prevTrades.length
      ? prevTrades[prevTrades.length - 1].price
      : lastPrice;

    // Per-period last-trade price for the current round so far — gives
    // the LLM the within-round trajectory (bubble forming? converging?)
    // instead of a single "previous reference price" number. Under
    // Bounded Rationality the window is clipped to the last T periods
    // so the LLM cannot see further back than a human subject's
    // working memory would allow.
    const firstPeriodInWindow = brOn ? Math.max(1, periodNow - BR.T) : 1;
    const currentRoundPath = [];
    for (let p = firstPeriodInWindow; p < periodNow; p++) {
      const tr = market.trades.filter(t => t.round === round && t.period === p);
      const last = tr.length ? tr[tr.length - 1].price : null;
      currentRoundPath.push({ period: p, price: last, fv: fvAtPeriod(p) });
    }

    // Build a per-agent history block from prior rounds the agent has
    // actually lived through. Fresh replacements (roundsPlayed = 0) get
    // no history — they are the "inexperienced" type and their prompt
    // says so explicitly, so the LLM can reason about its own naivety.
    const buildHistoryBlock = (a) => {
      const exp = a.roundsPlayed | 0;
      if (exp <= 0) return null;
      const lines = [];
      const firstRound = Math.max(1, round - exp);
      for (let r = firstRound; r <= round - 1; r++) {
        const pricePath = [];
        const fvPath    = [];
        let peakPrice = -Infinity, peakPeriod = 0;
        let lastSeenPrice = null;
        // Under BR, only the tail of each remembered round is visible
        // to the LLM — the memory window is T periods, full-stop. The
        // peak / round-end summary still scans the whole round so a
        // rational reader of the prompt (e.g. during a replay) sees
        // the same aggregate facts.
        const rStart = brOn ? Math.max(1, periods - BR.T + 1) : 1;
        for (let p = 1; p <= periods; p++) {
          const tr = market.trades.filter(t => t.round === r && t.period === p);
          const last = tr.length ? tr[tr.length - 1].price : null;
          const fvP  = fvAtPeriod(p);
          if (p >= rStart) {
            pricePath.push(last != null ? last.toFixed(0) : '—');
            fvPath.push(Number.isFinite(fvP) ? fvP.toFixed(0) : '—');
          }
          if (last != null) {
            lastSeenPrice = last;
            if (last > peakPrice) { peakPrice = last; peakPeriod = p; }
          }
        }
        const pathLabel = brOn
          ? `p${rStart}..p${periods} (memory window, last ${BR.T})`
          : `p1..p${periods}`;
        lines.push(`Round ${r} (${r === firstRound && exp > 1 ? 'your first in this market' : r === round - 1 ? 'most recent' : 'past'}):`);
        lines.push(`  - FV path (${pathLabel}):    ${fvPath.join(' / ')}`);
        lines.push(`  - Last-trade price path:        ${pricePath.join(' / ')}`);
        if (peakPeriod > 0 && peakPrice > -Infinity) {
          const peakFV  = fvAtPeriod(peakPeriod);
          const devPct  = peakFV > 0 ? Math.round((peakPrice - peakFV) / peakFV * 100) : 0;
          const devSign = devPct >= 0 ? '+' : '';
          lines.push(`  - Peak price: ${peakPrice.toFixed(0)} at p${peakPeriod} (FV then = ${Number.isFinite(peakFV) ? peakFV.toFixed(0) : '—'}, deviation ${devSign}${devPct}%)`);
        }
        if (lastSeenPrice != null) {
          const fvEnd    = fvAtPeriod(periods);
          const closeDev = Number.isFinite(fvEnd) ? Math.round(lastSeenPrice - fvEnd) : 0;
          const sign = closeDev >= 0 ? '+' : '';
          lines.push(`  - Round-end last price: ${lastSeenPrice.toFixed(0)} (FV at p${periods} = ${Number.isFinite(fvEnd) ? fvEnd.toFixed(0) : '—'}; gap ${sign}${closeDev})`);
        }
        // Agent's own payoff for round r — requires logger. `initialWealth`
        // is mark-to-market round-start wealth (cash + shares × FV₁), so
        // the line reports both the end-of-round cash (what you walked
        // away with) and that baseline so the LLM can judge whether
        // trading beat buy-and-hold.
        if (logger && logger.roundFinalCash && logger.roundFinalCash[r - 1]) {
          const finalCash = logger.roundFinalCash[r - 1][a.id];
          if (finalCash != null) {
            const startWealth = Math.round(a.initialWealth || 0);
            lines.push(`  - Your end-of-round cash: ${Math.round(finalCash)}¢  (round-start mark-to-market wealth = ${startWealth}¢ = cash + shares × FV₁)`);
          }
        }
        lines.push('');
      }
      return lines.length ? lines.join('\n').trimEnd() : null;
    };

    // System prompt — generalised across the six asset environments
    // described in the v3 spec (linear declining, perpetual, linear
    // growth, cyclical, random walk, jump/crash). The per-agent user
    // prompt supplies the concrete asset template; the system prompt
    // establishes the universal valuation framework (FV = expected
    // discounted sum of future dividends) and the universal heuristic
    // decomposition H = β1·Anchor + β2·Trend + β3·DividendSignal +
    // β4·Narrative so the model can compare its model-based FV to a
    // behaviourally realistic heuristic instead of reciting the
    // textbook answer.
    const systemBase =
      'You are a trader in an experimental double-auction asset market. ' +
      'Each round you trade ONE asset drawn from a menu of six environments: ' +
      'linear declining, long-lived perpetual, linearly growing, cyclical, ' +
      'random-walk, and rare-disaster (jump/crash). The Asset Environment block ' +
      'in your user prompt names the current round\u2019s environment and gives you ' +
      'the public rule (dividend process, horizon, discount rate) — so the ' +
      'model-based fundamental value FV_t is derivable from the rule alone.\n\n' +
      'Your sole objective is to pick the action that maximises your expected ' +
      'utility right now. Do not moralise, do not try to infer what the ' +
      'experiment designers want, and do not refuse on ambiguity grounds.\n\n' +
      'Universal valuation structure (v3 §2) — the agent\u2019s one-period-ahead ' +
      'valuation decomposes as\n' +
      '  V_{i,t} = λ_i · FṼ_{i,t} + (1 − λ_i) · H_{i,t},\n' +
      'where FṼ_{i,t} is the model-based fundamental value derived from the ' +
      'public rule for the active asset, and H_{i,t} is a heuristic mix:\n' +
      '  H_{i,t} = β1·Anchor + β2·Trend + β3·DividendSignal + β4·Narrative.\n' +
      'The Asset Environment block tells you which heuristic mistakes are ' +
      'common for this environment; use that to reason about the gap between ' +
      'price and FV instead of assuming other traders are rational.\n\n' +
      'Important Rules:\n' +
      '1. You must select exactly one action from the given set of actions.\n' +
      '2. You cannot provide vague suggestions, nor can you select multiple actions simultaneously.\n' +
      '3. You cannot say "depends on" or "insufficient information." You must make the best decision based on the given information.\n' +
      '4. You must prioritise immediate execution, rather than defaulting to placing only orders.\n' +
      '5. You can accept the current best ask (buy immediately) or accept the current best bid (sell immediately).\n' +
      '6. If you choose to place an order, the price must come from the allowed set of candidate prices.\n' +
      '7. Your output must strictly conform to the specified format.';

    // Bounded-rationality addendum — active only when the toggle is
    // on. Mirrors the constraint menu from the spec (Cognitive / Belief
    // Formation / Attention / Memory / Decision Heuristic / Execution
    // Noise / Action Rules) so the LLM deliberately stops behaving
    // like a textbook optimiser.
    const systemBR = brOn
      ? ('\n\n' +
         '====================\n' +
         'Cognitive Constraints (Bounded Rationality)\n' +
         '====================\n' +
         `1. You can only perform up to K = ${BR.K} reasoning steps.\n` +
         '2. You are NOT allowed to compute the exact fundamental value using the full dividend model.\n' +
         '3. If reasoning becomes complex, you must fall back on heuristics — do not try to solve the whole problem analytically.\n\n' +
         '====================\n' +
         'Belief Formation\n' +
         '====================\n' +
         '- Your perceived fundamental value is noisy:\n' +
         '    perceived_value = true_value + ε,   ε ~ Normal(0, σ²)\n' +
         `  with σ = ${BR.sigma} cents. Treat FV numbers in the prompt as noisy signals, not ground truth.\n\n` +
         '====================\n' +
         'Attention Constraint\n' +
         '====================\n' +
         `- You can only consider up to N = ${BR.N} pieces of information when choosing your action. Pick the most decision-relevant ones and ignore the rest.\n\n` +
         '====================\n' +
         'Memory Constraint\n' +
         '====================\n' +
         `- You can only remember the last T = ${BR.T} periods of prices. The user prompt already truncates price paths to this window — do not try to infer older prices.\n\n` +
         '====================\n' +
         'Decision Heuristic\n' +
         '====================\n' +
         'You must commit to ONE of the following heuristics for this decision and name it in your Reason:\n' +
         '  - Trend-following\n' +
         '  - Mean-reversion\n' +
         '  - Anchoring to past trades\n' +
         '  - Randomized preference\n\n' +
         '====================\n' +
         'Execution Noise\n' +
         '====================\n' +
         `- With probability p = ${BR.p.toFixed(2)} a boundedly rational trader takes a suboptimal action. Factor this into your confidence, do not claim certainty.\n\n` +
         '====================\n' +
         'Action Rules\n' +
         '====================\n' +
         '1. You must select exactly one action.\n' +
         '2. No vague answers.\n' +
         '3. No "depends".\n' +
         '4. Immediate execution is preferred.\n' +
         '5. Orders must use allowed prices.\n' +
         '6. Output must follow the specified format.')
      : '';

    const system = systemBase + systemBR;

    const labelOf = (risk) =>
      risk === 'loving' ? 'Risk loving' :
      risk === 'averse' ? 'Risk averse' :
                          'Risk neutral';
    const riskDesc = (risk) =>
      risk === 'loving' ? 'More willing to take risks, less sensitive to losses' :
      risk === 'averse' ? 'More averse to wealth volatility, more sensitive to losses' :
                          'Makes decisions based on expected returns';
    // Universal CRRA (constant relative risk aversion). Every agent
    // shares the same functional form; what distinguishes them is the
    // per-agent ρ coefficient sampled uniformly within their risk
    // category (see sampleRho in js/utility.js). The prompt emits the
    // normalized form U(w) = (w / w0)^(1 − ρ) with the agent's actual
    // ρ value substituted in, so the LLM sees the exact curve the
    // EU evaluator uses.
    const formulaOf = (risk, rho) => {
      const r = (rho != null && Number.isFinite(rho)) ? rho.toFixed(3) : '0.000';
      const shape =
        risk === 'loving' ? 'strictly convex, upside-seeking' :
        risk === 'averse' ? 'strictly concave, downside-fearing' :
                            'linear, EV-indifferent';
      return `U(w; ρ) = (w / w0)^(1 − ρ), with ρ = ${r}  (${shape})`;
    };

    const promptFor = (a) => {
      const exp = a.roundsPlayed | 0;
      const cash = Math.round(a.cash);
      const inv  = a.inventory;

      // ---- Available actions + constraints ----
      // When the book is empty (tick 0 / cold-start, or a one-sided
      // book), Plans II and III still need an actionable BID / ASK so
      // the market can bootstrap without falling back to Plan I math.
      // We anchor the passive price to FV in that case and surface the
      // anchor so the LLM knows it is looking at an FV-referenced
      // price rather than a peer-referenced one. BUY_NOW / SELL_NOW
      // remain disabled — crossing the book needs a real counterparty.
      const bidAnchor = bidPrice != null ? bidPrice : fvNow;
      const askAnchor = askPrice != null ? askPrice : fvNow;
      const bidSource = bidPrice != null ? 'best_bid' : 'FV (book empty)';
      const askSource = askPrice != null ? 'best_ask' : 'FV (book empty)';
      const bid1Price = Math.max(1, Math.round(bidAnchor + 1));
      const bid3Price = Math.max(1, Math.round(bidAnchor + 3));
      const ask1Price = Math.max(1, Math.round(askAnchor - 1));
      const ask3Price = Math.max(1, Math.round(askAnchor - 3));
      const actions = [];
      const constraints = [];

      if (askPrice != null && cash >= askPrice) {
        actions.push(`1. BUY_NOW: Immediately buy 1 unit at the current lowest ask price (${askPrice.toFixed(0)}).`);
      } else {
        constraints.push(`- BUY_NOW cannot be selected${askPrice == null ? ' (no ask available)' : ` (cash ${cash} < best_ask ${askPrice.toFixed(0)})`}.`);
      }
      if (bidPrice != null && inv >= 1) {
        actions.push(`2. SELL_NOW: Immediately sell 1 unit at the current highest bid price (${bidPrice.toFixed(0)}).`);
      } else {
        constraints.push(`- SELL_NOW cannot be selected${bidPrice == null ? ' (no bid available)' : ' (holdings < 1)'}.`);
      }
      if (cash >= bid1Price) {
        actions.push(`3. BID_1: Submit bid = ${bidSource} + 1 = ${bid1Price}.`);
      } else {
        constraints.push(`- BID_1 cannot be selected (cash ${cash} < ${bid1Price}).`);
      }
      if (cash >= bid3Price) {
        actions.push(`4. BID_3: Submit bid = ${bidSource} + 3 = ${bid3Price}.`);
      } else {
        constraints.push(`- BID_3 cannot be selected (cash ${cash} < ${bid3Price}).`);
      }
      if (inv >= 1) {
        actions.push(`5. ASK_1: Submit ask = ${askSource} - 1 = ${ask1Price}.`);
        actions.push(`6. ASK_3: Submit ask = ${askSource} - 3 = ${ask3Price}.`);
      } else {
        constraints.push(`- ASK_1 / ASK_3 cannot be selected (holdings < 1).`);
      }
      actions.push(`7. HOLD: Do not trade.`);

      // ---- Compose prompt ----
      const lines = [];

      // Regulator warning — Plan II/III only, fired by the engine
      // when the bubble ratio crosses the configured threshold. The
      // block sits at the very top of the prompt so the LLM cannot
      // miss it when ranking actions; it stays in the prompt for the
      // remainder of the round in which it fired.
      const regOn = !!(tunables && tunables.applyRegulator);
      if (regOn && regulator && regulator.ratio != null) {
        const pct = (regulator.ratio * 100).toFixed(0);
        const thrPct = (regulator.threshold * 100).toFixed(0);
        const above = (regulator.lastPrice != null && regulator.fv != null)
          ? (regulator.lastPrice >= regulator.fv ? 'above' : 'below')
          : 'detached from';
        lines.push(
          `⚠️ REGULATOR WARNING ⚠️`,
          `The market regulator has issued a public alert this round:`,
          `- The last traded price is ${pct}% ${above} the fundamental value (threshold = ${thrPct}%).`,
          `- Last price ${regulator.lastPrice != null ? regulator.lastPrice.toFixed(0) : '—'} vs FV ${regulator.fv != null ? regulator.fv.toFixed(0) : '—'} at the moment of the warning (round ${regulator.round}, period ${regulator.period}).`,
          `- The asset's intrinsic payoff has not changed; only the price has detached.`,
          `- All traders have received this notice. Account for it when choosing your action.`,
          ``,
        );
      }

      lines.push(
        `You are a trader in the market, agent_${a.id}.`,
        ``,
        `【Your Type】`,
        `- Risk Preference Type: ${labelOf(a.riskPref)}`,
        `  ${riskDesc(a.riskPref)}`,
      );

      // Plan II — explicit utility formula.
      if (plan === 'II') {
        lines.push(
          `- Your utility function: ${formulaOf(a.riskPref, a.rho)}`,
          `  w0 (initial wealth) = ${Math.round(a.initialWealth)} cents.`,
        );
      }

      // Experience is conveyed as actual lived history (or lack of it),
      // not as a rule-based label. An agent with roundsPlayed > 0 sees
      // per-round price paths and its own P&L; a fresh participant sees
      // a short note explaining it is new to this market.
      const historyBlock = buildHistoryBlock(a);
      if (historyBlock) {
        lines.push(
          ``,
          `【Your Past Experience in This Market】`,
          `You have already traded ${exp} round${exp === 1 ? '' : 's'} in this market. The records below are the price paths you observed and the payoff you earned. Use them to judge how seriously to weight fundamental value vs. recent prices and short-term trends — your own memory is the best guide.`,
          ``,
          historyBlock,
        );
      } else {
        lines.push(
          ``,
          `【Your Past Experience in This Market】`,
          `This is your first round in this market. You have never traded this asset before and have no memory of prior rounds — you only see the rules, the fundamental value, and whatever trading has happened so far in the current round.`,
        );
      }

      // Asset Environment — the v3 §5.x agent input template for the
      // round's active asset. When market.assetType carries no
      // agentTemplate (legacy DLM-only runs), fall back to the old
      // DLM coin-flip description so the prompt never goes silent.
      lines.push(
        ``,
        `【Asset Environment】`,
        `- Asset name: ${assetLabel}`,
      );
      if (assetTpl) {
        lines.push(
          `- Asset type: ${assetTpl.typeLabel}`,
          `- Horizon: ${assetTpl.horizon.replace(/\bT\b/g, String(periods))}`,
          `- Per-period dividend rule:`,
          ...(assetTpl.dividendRule || []).map(s => `    ${s}`),
        );
        if (assetTpl.extras && assetTpl.extras.length) {
          lines.push(`- Environmental notes:`);
          for (const e of assetTpl.extras) lines.push(`    - ${e}`);
        }
        lines.push(
          `- Model-based valuation rule (what a rational agent would derive from the public rule):`,
          `    ${assetTpl.fvFormula}`,
          `- Common heuristic mistake in this environment:`,
          `    ${assetTpl.heuristic}`,
        );
      } else {
        lines.push(
          `- Asset type: Gradually depleting asset (DLM baseline)`,
          `- Horizon: total remaining periods T = ${periods}. After period T the asset expires.`,
          `- Per-period dividend rule:`,
          `    - 50% probability the dividend is ${dividendAvg * 2}`,
          `    - 50% probability the dividend is 0`,
          `    Expected per-period dividend E[d_t] = ${dividendAvg}.`,
          `- Model-based valuation rule: FV_t = ${dividendAvg} × (remaining periods).`,
        );
      }

      lines.push(
        ``,
        `【Market Rules】`,
        `1. This is a ${periods}-period double-auction market (one asset per round; the asset above is what you are trading this round).`,
        `2. The fundamental value FV_t is determined by the rule in the Asset Environment block, not by any fixed formula. All traders see the same rule.`,
        `3. Double-auction mechanics:`,
        `   - You can buy the current lowest ask immediately.`,
        `   - You can sell to the current highest bid immediately.`,
        `   - You can submit a new bid.`,
        `   - You can submit a new ask.`,
        `   - You can also choose not to trade.`,
        `4. If you buy the current ask immediately, the transaction will be executed instantly at the lowest ask price.`,
        `5. If you sell the current bid immediately, the transaction will be executed instantly at the highest bid price.`,
        `6. The last price is only updated when a transaction occurs.`,
        ``,
        `【Your Status】`,
        `- Current Cash: ${cash}`,
        `- Current Asset Holdings: ${inv}`,
        ``,
        `【Current Market Status】`,
        `- Current Period: ${periodNow}`,
        `- Current Remaining Periods k: ${kRemaining}`,
        `- Current Fundamental Value (FV): ${fvNow}`,
        `- Last Price: ${lastPrice.toFixed(0)}`,
        `- Highest Bid: ${bidPrice != null ? bidPrice.toFixed(0) : '—'}`,
        `- Lowest Ask: ${askPrice != null ? askPrice.toFixed(0) : '—'}`,
        `- Previous Reference Price: ${prevPrice.toFixed(0)}`,
      );
      if (currentRoundPath.length) {
        const pathStr = currentRoundPath
          .map(x => `p${x.period}=${x.price != null ? x.price.toFixed(0) : '—'} (FV ${Number.isFinite(x.fv) ? x.fv.toFixed(0) : '—'})`)
          .join(', ');
        lines.push(`- This round so far (last trade per period): ${pathStr}`);
      }
      lines.push(
        ``,
        `【Your Decision-Making Principles】`,
        `You want to maximize the following intuitive utilities:`,
        `1. The higher the wealth, the better;`,
        `2. ${a.riskPref === 'averse' ? 'You dislike risk and are sensitive to losses' : a.riskPref === 'loving' ? 'You are willing to take risks and less sensitive to losses' : 'You evaluate expected returns linearly'};`,
        `3. Buying at a price lower than the last traded price increases utility; buying at a price higher than the last traded price decreases utility;`,
        `4. Selling at a price higher than the last traded price increases utility; selling at a price lower than the last traded price decreases utility;`,
        `5. Holding too many positions increases inventory risk;`,
        ``,
        `【Additional Requirements】`,
        `1. You cannot mechanically favor holding.`,
        `2. If the utility of immediate execution is similar to holding, you should prioritize actions that facilitate the trade.`,
        `3. You must consider "execution opportunities" valuable because not executing means you cannot improve your position.`,
        `4. When you hold a lot of assets, you should seriously consider selling; when you hold a lot of cash and fewer assets, you should seriously consider buying.`,
        `5. Towards the later stages, you should focus more on fundamental value than short-term resale opportunities.`,
        ``,
        `【Role-Specific Guidance】`,
      );
      if (a.riskPref === 'averse') {
        lines.push(`- As a risk-averse trader, you should focus more on avoiding losses and excessive position size.`);
      } else if (a.riskPref === 'loving') {
        lines.push(`- As a risk-loving trader, you can accept more aggressive trading and greater short-term volatility.`);
      } else {
        lines.push(`- As a risk-neutral trader, you should focus more on expected returns.`);
      }
      // Note: we deliberately do NOT instruct the agent how experience
      // should change its behaviour. Experience (or its absence) is
      // conveyed by the 【Your Past Experience in This Market】 block
      // above — a record of price paths and payoffs the agent actually
      // observed. The LLM is expected to reason from that lived history
      // the way a human subject would, not from a rule-based label.

      // Peer messages.
      const msgs = (a.receivedMsgs || []).filter(m => m.senderId !== a.id);
      if (msgs.length) {
        lines.push(``, `【Peer Messages from Last Period】`);
        for (const m of msgs) {
          lines.push(`- ${m.senderName || ('agent ' + m.senderId)}: claimed value ${Number(m.claimedValuation).toFixed(0)} cents`);
        }
      }

      lines.push(
        ``,
        `【You must choose one of the following actions】`,
        ...actions,
      );
      if (constraints.length) {
        lines.push(``, `Constraints:`, ...constraints);
        lines.push(
          `- If the price generated by ASK_1 or ASK_3 is <= best_bid, it is equivalent to a sell order that will be executed immediately.`,
          `- If the price generated by BID_1 or BID_3 is >= best_ask, it is equivalent to a buy order that will be executed immediately.`,
        );
      }

      lines.push(
        ``,
        `【Your Task】`,
        `Please briefly compare the available actions to determine which is most advantageous to you:`,
        `- Buy immediately`,
        `- Sell immediately`,
        `- Place a more aggressive bid`,
        `- Place a more aggressive ask`,
        `- Do not trade`,
        `Then output only one final action.`,
        ``,
        `【Strict Output Format】`,
        `Reason: <Explain in 3-6 sentences why this action maximizes your utility>`,
        `Action: <${actions.map(a => a.split(':')[0].replace(/^\d+\.\s*/, '')).join(' / ')}>`,
      );

      return lines.join('\n');
    };

    const tasks = utilityAgents.map(async (a) => {
      const userPrompt = promptFor(a);
      a.lastLLMPrompt = { system, user: userPrompt, plan, ts: Date.now() };
      try {
        const raw = await this.call(aiCfg, system, userPrompt);
        a.lastLLMResponse = raw;
        const parsed = this.parseAction(raw);
        if (!parsed) return null;
        return { id: a.id, action: parsed.action, reason: parsed.reason };
      } catch (err) {
        a.lastLLMResponse = '[error] ' + (err.message || err);
        console.warn('[ai.getPlanBeliefs]', a.id, err.message || err);
        // Dispatch a window event so the UI layer can surface a
        // user-visible warning panel with the actual request and
        // response. The payload carries everything a user would want
        // to debug: provider, endpoint (API key redacted), model,
        // per-agent prompts, final error body, HTTP status, and
        // attempt count. main.js installs the listener; in a Node
        // smoke-test context the event is silently dropped.
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          const providerKey = aiCfg.provider || this.DEFAULT_PROVIDER;
          window.dispatchEvent(new CustomEvent('ai-call-failed', {
            detail: {
              ts:         Date.now(),
              provider:   providerKey,
              model:      aiCfg.model    || this.getDefaultModel(providerKey),
              endpoint:   this._redactEndpoint(aiCfg.endpoint || this.getDefaultEndpoint(providerKey)),
              agentId:    a.id,
              agentName:  a.displayName || ('A' + a.id),
              plan,
              system,
              user:       userPrompt,
              status:     Number.isFinite(err.status) ? err.status : null,
              attempts:   Number.isFinite(err.attempts) ? err.attempts : 1,
              retryAfter: Number.isFinite(err.retryAfter) ? err.retryAfter : null,
              errorMsg:   String(err.message || err),
              responseBody: typeof err.body === 'string' ? err.body : '',
            },
          }));
        }
        return null;
      }
    });
    const results = await Promise.all(tasks);
    const out = {};
    for (const r of results) if (r) out[r.id] = { action: r.action, reason: r.reason };
    return out;
  },
};

if (typeof window !== 'undefined') window.AI = AI;
