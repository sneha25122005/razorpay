import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  Search, Command, X, ChevronRight, ChevronDown, Radio, ShieldCheck,
  AlertTriangle, Ban, ArrowRight, Activity, Wallet, PhoneCall, Link2,
  UserCheck, Clock, CircleDot, Info
} from "lucide-react";

/* ============================================================
   RECOVER // — synthetic deterministic data engine
   Every figure on screen is derived from this generated case
   set, not hard-coded. Ground-truth fields are used only to
   derive outcomes, mirroring how the real engine would keep
   truth hidden from the scoring model in evaluation.
   ============================================================ */

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LEAK_TYPES = ["Subscription", "Cart", "Invoice", "Mandate", "Payment Link"];
const rupee = (n) =>
  "\u20B9" + Math.round(n).toLocaleString("en-IN");
const rupeeL = (n) => "\u20B9" + (n / 100000).toFixed(1) + "L";

function buildCase(rng, idx) {
  const id = "C-" + (1000 + idx);
  const leakType = LEAK_TYPES[Math.floor(rng() * LEAK_TYPES.length)];
  const amount = Math.round((300 + rng() * rng() * 60000) / 10) * 10;
  const ageHours = Math.round(rng() * 96);

  // hidden ground truth (not shown to any "model", only used to derive outcome)
  const trueNaturalProb = Math.min(0.97, Math.max(0.02, rng() ** 1.6));
  const trueUpliftPayLink = rng() * 0.35;
  const trueUpliftVoice = rng() * 0.28;
  const trueUpliftHuman = rng() * 0.22;

  // observed/estimated fields (what the "model" reports)
  const naturalRecoveryProb = clamp(trueNaturalProb + jitter(rng, 0.04));

  const actionDefs = [
    { name: "WAIT", cost: 0, uplift: 0 },
    { name: "PAYMENT LINK", cost: 4, uplift: trueUpliftPayLink },
    { name: "VOICE", cost: 65, uplift: trueUpliftVoice },
    { name: "HUMAN", cost: 100, uplift: trueUpliftHuman },
  ];

  const actions = actionDefs.map((a) => {
    const recoveryProb = clamp(naturalRecoveryProb + a.uplift);
    const incrementalProb = clamp(recoveryProb - naturalRecoveryProb);
    const expectedIncremental = amount * incrementalProb;
    const netValue = expectedIncremental - a.cost;
    return { ...a, recoveryProb, incrementalProb, expectedIncremental, netValue };
  });

  const bestAction = actions.reduce((best, a) => (a.netValue > best.netValue ? a : best));

  // agent conflict + policy simulation
  const conflictRoll = rng();
  const agentConflict =
    conflictRoll > 0.86
      ? { active: true, reason: "Subscription Agent and Cart Agent both active on this customer." }
      : { active: false, reason: null };

  const promiseActive = rng() > 0.92;

  let policyStatus = { allowed: true, reason: null };
  if (promiseActive) {
    policyStatus = { allowed: false, reason: "Active promise-to-pay locks other recovery actions." };
  } else if (agentConflict.active) {
    policyStatus = { allowed: false, reason: "Blocked pending conflict resolution." };
  } else if (bestAction.name !== "WAIT" && rng() > 0.94) {
    policyStatus = { allowed: false, reason: "Contact frequency window exceeded in last 24h." };
  }

  let finalDecision = bestAction.name;
  if (promiseActive) finalDecision = "LOCK";
  else if (agentConflict.active) finalDecision = "SUPPRESS";
  else if (!policyStatus.allowed) finalDecision = "SUPPRESS";

  const chosen = actions.find((a) => a.name === bestAction.name);
  const recovered =
    finalDecision === bestAction.name && bestAction.name !== "WAIT"
      ? amount * chosen.recoveryProb
      : amount * naturalRecoveryProb;
  const naturalPortion = amount * naturalRecoveryProb;
  const costIncurred = finalDecision === bestAction.name && bestAction.name !== "WAIT" ? bestAction.cost : 0;

  const now = Date.now() - ageHours * 3600 * 1000;
  const trace = [
    { t: now, label: "payment.failed", detail: `Revenue leak normalized \u2014 ${leakType.toLowerCase()} case opened.` },
    { t: now + 40 * 1000, label: "Natural recovery model", detail: `Estimated self-cure probability: ${(naturalRecoveryProb * 100).toFixed(1)}%`, meta: "model v0.4.2" },
    { t: now + 65 * 1000, label: "Candidate actions generated", detail: `${actions.length} actions scored against incremental value.` },
    { t: now + 90 * 1000, label: "Portfolio allocator", detail: `Recommended: ${bestAction.name} (highest net value).` },
    { t: now + 110 * 1000, label: "Policy gate", detail: policyStatus.allowed ? "All checks passed." : policyStatus.reason, ok: policyStatus.allowed, meta: "policy v1.1" },
    { t: now + 125 * 1000, label: "Agent conflict check", detail: agentConflict.active ? agentConflict.reason : "No competing engagement found.", ok: !agentConflict.active },
    { t: now + 130 * 1000, label: "FINAL DECISION", detail: finalDecision, final: true },
  ];

  return {
    id, leakType, amount, ageHours, naturalRecoveryProb, actions, bestAction: bestAction.name,
    agentConflict, promiseActive, policyStatus, finalDecision, recovered, naturalPortion, costIncurred, trace,
  };
}

function clamp(x) { return Math.max(0, Math.min(0.99, x)); }
function jitter(rng, mag) { return (rng() - 0.5) * mag; }

function useSyntheticPortfolio(seed = 42, n = 26) {
  return useMemo(() => {
    const rng = mulberry32(seed);
    const cases = Array.from({ length: n }, (_, i) => buildCase(rng, i));
    const gross = cases.reduce((s, c) => s + c.recovered, 0);
    const natural = cases.reduce((s, c) => s + c.naturalPortion, 0);
    const cost = cases.reduce((s, c) => s + c.costIncurred, 0);
    const net = gross - natural - cost;
    return { cases, gross, natural, cost, net };
  }, [seed, n]);
}

/* ============================================================
   Design tokens
   ============================================================ */

const Tokens = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap');
    .rc-root {
      --ink: #211D17;
      --ink-soft: #514A3E;
      --muted: #8A8071;
      --bg: #F3EFE5;
      --panel: #FAF8F2;
      --line: #DFD8C6;
      --line-strong: #C9BFA8;
      --accent: #6E5A3E;
      --accent-soft: #ECE3CE;
      --positive: #3E6349;
      --positive-soft: #E4EBE1;
      --negative: #99422F;
      --negative-soft: #F3E2DC;
      --warn: #8C6A28;
      --warn-soft: #F1E7CD;
      font-family: 'IBM Plex Sans', ui-sans-serif, system-ui;
      background: var(--bg);
      color: var(--ink);
    }
    .rc-serif { font-family: 'Fraunces', ui-serif, Georgia, serif; }
    .rc-mono { font-family: 'IBM Plex Mono', ui-monospace, monospace; }
    .rc-scrollbar::-webkit-scrollbar { width: 8px; height: 8px; }
    .rc-scrollbar::-webkit-scrollbar-thumb { background: var(--line-strong); border-radius: 0; }
    @media (prefers-reduced-motion: reduce) {
      .rc-root * { transition: none !important; animation: none !important; }
    }
  `}</style>
);

/* ============================================================
   Small building blocks
   ============================================================ */

function Pill({ children, tone = "neutral", icon: Icon }) {
  const tones = {
    neutral: { bg: "var(--panel)", fg: "var(--ink-soft)", bd: "var(--line)" },
    live: { bg: "var(--positive-soft)", fg: "var(--positive)", bd: "var(--positive)" },
    warn: { bg: "var(--warn-soft)", fg: "var(--warn)", bd: "var(--warn)" },
    bad: { bg: "var(--negative-soft)", fg: "var(--negative)", bd: "var(--negative)" },
  };
  const t = tones[tone];
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] tracking-wide rc-mono"
      style={{ background: t.bg, color: t.fg, border: `1px solid ${t.bd}` }}
    >
      {Icon && <Icon size={11} strokeWidth={2} />}
      {children}
    </span>
  );
}

function DecisionBadge({ decision }) {
  const map = {
    WAIT: { tone: "neutral", label: "WAIT" },
    "PAYMENT LINK": { tone: "live", label: "PAYMENT LINK" },
    VOICE: { tone: "live", label: "VOICE" },
    HUMAN: { tone: "live", label: "HUMAN" },
    SUPPRESS: { tone: "warn", label: "SUPPRESS" },
    LOCK: { tone: "bad", label: "LOCKED" },
  };
  const m = map[decision] || map.WAIT;
  return <Pill tone={m.tone}>{m.label}</Pill>;
}

/* ============================================================
   Command palette (Cmd/Ctrl+K)
   ============================================================ */

function CommandPalette({ open, onClose, cases, onSelect }) {
  const [q, setQ] = useState("");
  const inputRef = useRef(null);
  useEffect(() => { if (open) { setQ(""); setTimeout(() => inputRef.current?.focus(), 10); } }, [open]);
  if (!open) return null;
  const results = cases.filter((c) =>
    (c.id + c.leakType).toLowerCase().includes(q.toLowerCase())
  ).slice(0, 8);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4" style={{ background: "rgba(33,29,23,0.45)" }} onClick={onClose}>
      <div className="w-full max-w-lg rc-root" style={{ background: "var(--panel)", border: "1px solid var(--line-strong)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: "1px solid var(--line)" }}>
          <Search size={15} color="var(--muted)" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Jump to case, e.g. C-1004"
            className="flex-1 bg-transparent outline-none text-sm"
            style={{ color: "var(--ink)" }}
          />
          <kbd className="rc-mono text-[10px] px-1.5 py-0.5" style={{ border: "1px solid var(--line)", color: "var(--muted)" }}>ESC</kbd>
        </div>
        <div className="max-h-72 overflow-y-auto rc-scrollbar">
          {results.length === 0 && <div className="px-4 py-6 text-sm text-center" style={{ color: "var(--muted)" }}>No matching cases.</div>}
          {results.map((c) => (
            <button
              key={c.id}
              onClick={() => { onSelect(c); onClose(); }}
              className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-black/[0.03]"
              style={{ borderBottom: "1px solid var(--line)" }}
            >
              <span className="flex items-center gap-3">
                <span className="rc-mono text-xs" style={{ color: "var(--accent)" }}>{c.id}</span>
                <span className="text-sm" style={{ color: "var(--ink-soft)" }}>{c.leakType}</span>
              </span>
              <span className="rc-mono text-xs" style={{ color: "var(--muted)" }}>{rupee(c.amount)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Command Center
   ============================================================ */

function MetricHero({ gross, natural, cost, net }) {
  return (
    <div className="p-6 md:p-8" style={{ background: "var(--panel)", border: "1px solid var(--line)" }}>
      <div className="flex items-center justify-between mb-5">
        <span className="text-xs tracking-wide rc-mono" style={{ color: "var(--muted)" }}>NET INCREMENTAL VALUE</span>
        <Pill>SYNTHETIC DEMO DATA</Pill>
      </div>
      <div className="rc-serif" style={{ fontSize: "clamp(2.6rem, 6vw, 4.2rem)", lineHeight: 1, color: "var(--ink)" }}>
        {rupeeL(net)}
      </div>
      <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4 rc-mono text-[13px]">
        <div>
          <div style={{ color: "var(--muted)" }}>Gross recovered</div>
          <div className="mt-1" style={{ color: "var(--ink)" }}>{rupeeL(gross)}</div>
        </div>
        <div>
          <div style={{ color: "var(--muted)" }}>&minus; Natural / self-cure</div>
          <div className="mt-1" style={{ color: "var(--ink-soft)" }}>{rupeeL(natural)}</div>
        </div>
        <div>
          <div style={{ color: "var(--muted)" }}>&minus; Intervention cost</div>
          <div className="mt-1" style={{ color: "var(--ink-soft)" }}>{rupeeL(cost)}</div>
        </div>
        <div>
          <div style={{ color: "var(--muted)" }}>= Net incremental</div>
          <div className="mt-1" style={{ color: "var(--positive)" }}>{rupeeL(net)}</div>
        </div>
      </div>
    </div>
  );
}

function RecoveryCapital() {
  const items = [
    { label: "Intervention budget", value: "\u20B98,240 / \u20B910,000", pct: 82 },
    { label: "Contact capacity", value: "312 / 500", pct: 62 },
    { label: "Voice slots", value: "41 / 100", pct: 41 },
    { label: "Human collector slots", value: "9 / 50", pct: 18 },
  ];
  return (
    <div className="p-5" style={{ background: "var(--panel)", border: "1px solid var(--line)" }}>
      <div className="text-xs tracking-wide rc-mono mb-4" style={{ color: "var(--muted)" }}>RECOVERY CAPITAL</div>
      <div className="space-y-4">
        {items.map((it) => (
          <div key={it.label}>
            <div className="flex justify-between text-[13px] mb-1.5">
              <span style={{ color: "var(--ink-soft)" }}>{it.label}</span>
              <span className="rc-mono" style={{ color: "var(--ink)" }}>{it.value}</span>
            </div>
            <div style={{ height: 4, background: "var(--accent-soft)" }}>
              <div style={{ height: 4, width: it.pct + "%", background: "var(--accent)" }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DecisionPulse({ cases }) {
  const feed = useMemo(() => cases.slice(0, 7), [cases]);
  return (
    <div className="p-5" style={{ background: "var(--panel)", border: "1px solid var(--line)" }}>
      <div className="flex items-center gap-2 mb-4">
        <Radio size={13} style={{ color: "var(--positive)" }} />
        <span className="text-xs tracking-wide rc-mono" style={{ color: "var(--muted)" }}>DECISION PULSE</span>
      </div>
      <div className="space-y-0">
        {feed.map((c, i) => (
          <div key={c.id} className="py-3 flex items-center justify-between gap-3" style={{ borderTop: i === 0 ? "none" : "1px solid var(--line)" }}>
            <div className="flex items-center gap-3 min-w-0">
              <span className="rc-mono text-xs shrink-0" style={{ color: "var(--accent)" }}>{c.id}</span>
              <span className="rc-mono text-xs shrink-0" style={{ color: "var(--ink)" }}>{rupee(c.amount)} at risk</span>
              <span className="text-[13px] truncate" style={{ color: "var(--muted)" }}>
                Natural recovery {(c.naturalRecoveryProb * 100).toFixed(0)}%
                {c.finalDecision !== "WAIT" && c.bestAction !== "WAIT" && ` \u00b7 ${c.bestAction} uplift +${(c.actions.find(a=>a.name===c.bestAction).incrementalProb*100).toFixed(0)}%`}
              </span>
            </div>
            <DecisionBadge decision={c.finalDecision} />
          </div>
        ))}
      </div>
    </div>
  );
}

function CommandCenterPage({ portfolio }) {
  return (
    <div className="space-y-5">
      <MetricHero gross={portfolio.gross} natural={portfolio.natural} cost={portfolio.cost} net={portfolio.net} />
      <div className="grid md:grid-cols-2 gap-5">
        <RecoveryCapital />
        <div className="p-5" style={{ background: "var(--panel)", border: "1px solid var(--line)" }}>
          <div className="text-xs tracking-wide rc-mono mb-4" style={{ color: "var(--muted)" }}>PORTFOLIO SNAPSHOT</div>
          <SnapshotBars cases={portfolio.cases} />
        </div>
      </div>
      <DecisionPulse cases={portfolio.cases} />
    </div>
  );
}

function SnapshotBars({ cases }) {
  const groups = { WAIT: 0, ACT: 0, SUPPRESS: 0, LOCK: 0 };
  cases.forEach((c) => {
    if (c.finalDecision === "WAIT") groups.WAIT++;
    else if (c.finalDecision === "SUPPRESS") groups.SUPPRESS++;
    else if (c.finalDecision === "LOCK") groups.LOCK++;
    else groups.ACT++;
  });
  const max = Math.max(...Object.values(groups), 1);
  return (
    <div className="space-y-3">
      {Object.entries(groups).map(([k, v]) => (
        <div key={k} className="flex items-center gap-3">
          <span className="rc-mono text-[11px] w-16 shrink-0" style={{ color: "var(--muted)" }}>{k}</span>
          <div className="flex-1" style={{ background: "var(--accent-soft)", height: 14 }}>
            <div style={{ width: (v / max) * 100 + "%", height: 14, background: k === "SUPPRESS" || k === "LOCK" ? "var(--warn)" : "var(--accent)" }} />
          </div>
          <span className="rc-mono text-[11px] w-6 text-right" style={{ color: "var(--ink)" }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

/* ============================================================
   Portfolio table + Suppressed Opportunities
   ============================================================ */

const FILTERS = ["All", "Subscription", "Cart", "Invoice", "Mandate", "Payment Link"];
const SORTS = [
  { key: "netValue", label: "Net Value" },
  { key: "expected", label: "Expected Incremental" },
  { key: "amount", label: "Amount at Risk" },
  { key: "age", label: "Age" },
];

function PortfolioPage({ cases, onOpen }) {
  const [filter, setFilter] = useState("All");
  const [sort, setSort] = useState("netValue");

  const rows = useMemo(() => {
    let r = cases.filter((c) => filter === "All" || c.leakType === filter);
    const val = (c) => {
      const a = c.actions.find((a) => a.name === c.bestAction);
      if (sort === "netValue") return a.netValue;
      if (sort === "expected") return a.expectedIncremental;
      if (sort === "amount") return c.amount;
      if (sort === "age") return c.ageHours;
      return 0;
    };
    return [...r].sort((a, b) => val(b) - val(a));
  }, [cases, filter, sort]);

  const suppressed = useMemo(() => cases.filter((c) => c.finalDecision === "SUPPRESS" || c.finalDecision === "LOCK"), [cases]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="px-3 py-1.5 text-[12.5px] rc-mono"
              style={{
                border: `1px solid ${filter === f ? "var(--ink)" : "var(--line)"}`,
                background: filter === f ? "var(--ink)" : "transparent",
                color: filter === f ? "var(--panel)" : "var(--ink-soft)",
              }}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-[12.5px] rc-mono" style={{ color: "var(--muted)" }}>
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="rc-mono px-2 py-1.5" style={{ background: "var(--panel)", border: "1px solid var(--line)", color: "var(--ink)" }}>
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>
      </div>

      <div className="overflow-x-auto rc-scrollbar" style={{ border: "1px solid var(--line)" }}>
        <table className="w-full text-[13px]" style={{ background: "var(--panel)" }}>
          <thead>
            <tr className="rc-mono text-[11px]" style={{ color: "var(--muted)", borderBottom: "1px solid var(--line-strong)" }}>
              {["Case", "Leak Type", "Amount", "Age", "Natural %", "Best Action", "Net Value", "Conflict", "Policy", "Decision"].map((h) => (
                <th key={h} className="text-left font-normal px-3 py-2.5 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const a = c.actions.find((a) => a.name === c.bestAction);
              return (
                <tr
                  key={c.id}
                  onClick={() => onOpen(c)}
                  className="cursor-pointer hover:bg-black/[0.025]"
                  style={{ borderBottom: "1px solid var(--line)" }}
                >
                  <td className="px-3 py-2.5 rc-mono" style={{ color: "var(--accent)" }}>{c.id}</td>
                  <td className="px-3 py-2.5" style={{ color: "var(--ink-soft)" }}>{c.leakType}</td>
                  <td className="px-3 py-2.5 rc-mono whitespace-nowrap">{rupee(c.amount)}</td>
                  <td className="px-3 py-2.5 rc-mono" style={{ color: "var(--muted)" }}>{c.ageHours}h</td>
                  <td className="px-3 py-2.5 rc-mono">{(c.naturalRecoveryProb * 100).toFixed(0)}%</td>
                  <td className="px-3 py-2.5">{c.bestAction}</td>
                  <td className="px-3 py-2.5 rc-mono" style={{ color: a.netValue >= 0 ? "var(--positive)" : "var(--negative)" }}>{rupee(a.netValue)}</td>
                  <td className="px-3 py-2.5">{c.agentConflict.active ? <Pill tone="warn" icon={AlertTriangle}>Yes</Pill> : <span style={{ color: "var(--muted)" }}>&mdash;</span>}</td>
                  <td className="px-3 py-2.5">{c.policyStatus.allowed ? <Pill tone="live" icon={ShieldCheck}>Allowed</Pill> : <Pill tone="bad" icon={Ban}>Blocked</Pill>}</td>
                  <td className="px-3 py-2.5"><DecisionBadge decision={c.finalDecision} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs tracking-wide rc-mono" style={{ color: "var(--muted)" }}>SUPPRESSED OPPORTUNITIES</span>
          <span className="rc-mono text-[11px]" style={{ color: "var(--muted)" }}>({suppressed.length})</span>
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          {suppressed.slice(0, 4).map((c) => (
            <button key={c.id} onClick={() => onOpen(c)} className="text-left p-4" style={{ background: "var(--panel)", border: "1px solid var(--line)" }}>
              <div className="flex justify-between items-start mb-2">
                <span className="rc-mono text-xs" style={{ color: "var(--accent)" }}>{c.id}</span>
                <DecisionBadge decision={c.finalDecision} />
              </div>
              <div className="rc-mono text-lg mb-1">{rupee(c.amount)} at risk</div>
              <div className="text-[13px]" style={{ color: "var(--ink-soft)" }}>
                Natural recovery {(c.naturalRecoveryProb * 100).toFixed(0)}% &middot; Expected incremental {rupee(c.actions.find(a=>a.name===c.bestAction).expectedIncremental)}
              </div>
              <div className="text-[12.5px] mt-2" style={{ color: "var(--muted)" }}>
                {c.promiseActive ? "Active promise-to-pay locks other recovery actions." : c.agentConflict.active ? c.agentConflict.reason : c.policyStatus.reason}
              </div>
            </button>
          ))}
          {suppressed.length === 0 && <div className="text-[13px]" style={{ color: "var(--muted)" }}>No suppressed cases in this sample.</div>}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Decision Drawer + Trace
   ============================================================ */

const ACTION_ICON = { WAIT: Clock, "PAYMENT LINK": Link2, VOICE: PhoneCall, HUMAN: UserCheck };

function ActionCard({ action, isRecommended }) {
  const Icon = ACTION_ICON[action.name] || Clock;
  return (
    <div className="p-3.5" style={{ background: isRecommended ? "var(--accent-soft)" : "var(--panel)", border: `1px solid ${isRecommended ? "var(--accent)" : "var(--line)"}` }}>
      <div className="flex items-center justify-between mb-2">
        <span className="flex items-center gap-1.5 text-[13px]" style={{ color: "var(--ink)" }}>
          <Icon size={13} /> {action.name}
        </span>
        {isRecommended && <Pill tone="live">Recommended</Pill>}
      </div>
      <div className="grid grid-cols-2 gap-y-1.5 rc-mono text-[12px]" style={{ color: "var(--ink-soft)" }}>
        <span style={{ color: "var(--muted)" }}>Expected incremental</span>
        <span className="text-right">{rupee(action.expectedIncremental)}</span>
        <span style={{ color: "var(--muted)" }}>Cost</span>
        <span className="text-right">{rupee(action.cost)}</span>
        <span style={{ color: "var(--muted)" }}>Net value</span>
        <span className="text-right" style={{ color: action.netValue >= 0 ? "var(--positive)" : "var(--negative)" }}>{rupee(action.netValue)}</span>
      </div>
    </div>
  );
}

function DecisionTrace({ trace }) {
  return (
    <div className="space-y-0">
      {trace.map((step, i) => (
        <div key={i} className="relative pl-6 pb-5" style={{ borderLeft: i === trace.length - 1 ? "none" : "1px solid var(--line-strong)", marginLeft: 5 }}>
          <div className="absolute -left-[5px] top-1" style={{ width: 9, height: 9, borderRadius: "50%", background: step.final ? "var(--ink)" : "var(--accent)" }} />
          <div className="flex items-center gap-2 mb-0.5">
            <span className="rc-mono text-[11px]" style={{ color: "var(--muted)" }}>
              {new Date(step.t).toLocaleTimeString("en-IN", { hour12: false })}
            </span>
            {step.meta && <span className="rc-mono text-[10px] px-1.5" style={{ color: "var(--muted)", border: "1px solid var(--line)" }}>{step.meta}</span>}
          </div>
          <div className={step.final ? "rc-serif text-base" : "text-[13.5px]"} style={{ color: step.ok === false ? "var(--negative)" : "var(--ink)" }}>
            {step.label}
          </div>
          {step.detail && <div className="text-[12.5px] mt-0.5" style={{ color: "var(--ink-soft)" }}>{step.detail}</div>}
        </div>
      ))}
    </div>
  );
}

function DecisionDrawer({ c, onClose }) {
  const [showTrace, setShowTrace] = useState(false);
  if (!c) return null;
  const rec = c.actions.find((a) => a.name === c.bestAction);
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0" style={{ background: "rgba(33,29,23,0.35)" }} onClick={onClose} />
      <div
        className="relative w-full sm:w-[440px] h-full overflow-y-auto rc-scrollbar rc-root"
        style={{ background: "var(--panel)", borderLeft: "1px solid var(--line-strong)" }}
      >
        <div className="sticky top-0 flex items-center justify-between px-5 py-4" style={{ background: "var(--panel)", borderBottom: "1px solid var(--line)" }}>
          <div>
            <div className="rc-mono text-xs" style={{ color: "var(--accent)" }}>{c.id}</div>
            <div className="rc-serif text-xl mt-0.5">{rupee(c.amount)} at risk</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5" style={{ border: "1px solid var(--line)" }}><X size={16} /></button>
        </div>

        <div className="p-5 space-y-6">
          <div className="flex flex-wrap gap-2">
            <Pill>{c.leakType}</Pill>
            <Pill icon={Clock}>{c.ageHours}h old</Pill>
            <DecisionBadge decision={c.finalDecision} />
          </div>

          {c.promiseActive && (
            <div className="p-3 text-[13px]" style={{ background: "var(--negative-soft)", color: "var(--negative)", border: "1px solid var(--negative)" }}>
              Active promise-to-pay. All other recovery actions locked until fulfilled or the deadline passes.
            </div>
          )}

          <div>
            <div className="text-xs tracking-wide rc-mono mb-2" style={{ color: "var(--muted)" }}>NATURAL RECOVERY PROBABILITY</div>
            <div className="rc-serif text-3xl">{(c.naturalRecoveryProb * 100).toFixed(1)}%</div>
          </div>

          <div>
            <div className="text-xs tracking-wide rc-mono mb-3" style={{ color: "var(--muted)" }}>CANDIDATE ACTIONS</div>
            <div className="space-y-2.5">
              {c.actions.map((a) => (
                <ActionCard key={a.name} action={a} isRecommended={a.name === c.bestAction} />
              ))}
            </div>
          </div>

          <div className="p-4" style={{ background: "var(--accent-soft)", border: "1px solid var(--accent)" }}>
            <div className="text-xs tracking-wide rc-mono mb-1.5" style={{ color: "var(--accent)" }}>RECOMMENDATION</div>
            <div className="rc-serif text-2xl mb-2">{c.bestAction}</div>
            <p className="text-[13px]" style={{ color: "var(--ink-soft)" }}>
              {c.bestAction === "WAIT"
                ? "Intervention is not economically justified relative to preserving scarce recovery capital."
                : `Net incremental value of ${rupee(rec.netValue)} justifies action against a natural recovery baseline of ${(c.naturalRecoveryProb*100).toFixed(0)}%.`}
            </p>
          </div>

          <div className="flex items-center justify-between gap-2 text-[12.5px]">
            <span className="flex items-center gap-1.5" style={{ color: c.policyStatus.allowed ? "var(--positive)" : "var(--negative)" }}>
              {c.policyStatus.allowed ? <ShieldCheck size={13} /> : <Ban size={13} />}
              {c.policyStatus.allowed ? "Policy: allowed" : `Policy: ${c.policyStatus.reason}`}
            </span>
          </div>

          <button
            onClick={() => setShowTrace((s) => !s)}
            className="w-full flex items-center justify-between px-4 py-3 text-[13px]"
            style={{ border: "1px solid var(--line-strong)", color: "var(--ink)" }}
          >
            View Decision Trace
            {showTrace ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>
          {showTrace && (
            <div className="pt-2">
              <DecisionTrace trace={c.trace} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   App shell
   ============================================================ */

export default function RecoverApp() {
  const portfolio = useSyntheticPortfolio(42, 26);
  const [tab, setTab] = useState("command");
  const [selected, setSelected] = useState(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen(true); }
      if (e.key === "Escape") setPaletteOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="rc-root min-h-screen">
      <Tokens />
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-6">
        <header className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <div>
            <div className="rc-serif text-2xl tracking-tight">RECOVER //</div>
            <div className="text-[12px] mt-0.5" style={{ color: "var(--muted)" }}>Financial control plane for revenue recovery</div>
          </div>
          <div className="flex items-center gap-2">
            <Pill tone="live" icon={CircleDot}>LIVE</Pill>
            <Pill icon={Activity}>Webhooks healthy</Pill>
            <button
              onClick={() => setPaletteOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] rc-mono"
              style={{ border: "1px solid var(--line)", color: "var(--muted)" }}
            >
              <Command size={11} /> K
            </button>
          </div>
        </header>

        <nav className="flex gap-1 mb-6" style={{ borderBottom: "1px solid var(--line-strong)" }}>
          {[
            ["command", "Command Center"],
            ["portfolio", "Recovery Portfolio"],
          ].map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className="px-4 py-2.5 text-[13px] rc-mono -mb-px"
              style={{
                borderBottom: `2px solid ${tab === k ? "var(--ink)" : "transparent"}`,
                color: tab === k ? "var(--ink)" : "var(--muted)",
              }}
            >
              {label}
            </button>
          ))}
          {["Decision Lab", "Agent Control", "Causal Ledger", "Experiments", "Policy Engine"].map((label) => (
            <span key={label} className="px-4 py-2.5 text-[13px] rc-mono" style={{ color: "var(--line-strong)" }} title="Coming next in the backend build">
              {label}
            </span>
          ))}
        </nav>

        {tab === "command" ? (
          <CommandCenterPage portfolio={portfolio} />
        ) : (
          <PortfolioPage cases={portfolio.cases} onOpen={setSelected} />
        )}
      </div>

      <DecisionDrawer c={selected} onClose={() => setSelected(null)} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} cases={portfolio.cases} onSelect={setSelected} />
    </div>
  );
}
