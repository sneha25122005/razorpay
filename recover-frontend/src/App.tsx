import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Ban,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock,
  Command,
  Link2,
  PhoneCall,
  Radio,
  Search,
  ShieldCheck,
  UserCheck,
  X,
  type LucideIcon,
} from 'lucide-react';

type ActionName = 'WAIT' | 'PAYMENT LINK' | 'VOICE' | 'HUMAN';
type DecisionName = ActionName | 'SUPPRESS' | 'LOCK';
type LeakType = 'Subscription' | 'Cart' | 'Invoice' | 'Mandate' | 'Payment Link';

type ActionStat = {
  name: ActionName;
  cost: number;
  uplift: number;
  recoveryProb: number;
  incrementalProb: number;
  expectedIncremental: number;
  netValue: number;
};

type TraceStep = {
  t: number;
  label: string;
  detail?: string;
  meta?: string;
  ok?: boolean;
  final?: boolean;
};

type CaseRecord = {
  id: string;
  leakType: LeakType;
  amount: number;
  ageHours: number;
  naturalRecoveryProb: number;
  actions: ActionStat[];
  bestAction: ActionName;
  agentConflict: { active: boolean; reason: string | null };
  promiseActive: boolean;
  policyStatus: { allowed: boolean; reason: string | null };
  finalDecision: DecisionName;
  recovered: number;
  naturalPortion: number;
  costIncurred: number;
  trace: TraceStep[];
};

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LEAK_TYPES: LeakType[] = ['Subscription', 'Cart', 'Invoice', 'Mandate', 'Payment Link'];

const rupee = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
const rupeeL = (n: number) => '₹' + (n / 100000).toFixed(1) + 'L';

function clamp(x: number) {
  return Math.max(0, Math.min(0.99, x));
}

function jitter(rng: () => number, mag: number) {
  return (rng() - 0.5) * mag;
}

function buildCase(rng: () => number, idx: number): CaseRecord {
  const id = 'C-' + (1000 + idx);
  const leakType = LEAK_TYPES[Math.floor(rng() * LEAK_TYPES.length)];
  const amount = Math.round((300 + rng() * rng() * 60000) / 10) * 10;
  const ageHours = Math.round(rng() * 96);

  const trueNaturalProb = Math.min(0.97, Math.max(0.02, rng() ** 1.6));
  const trueUpliftPayLink = rng() * 0.35;
  const trueUpliftVoice = rng() * 0.28;
  const trueUpliftHuman = rng() * 0.22;

  const naturalRecoveryProb = clamp(trueNaturalProb + jitter(rng, 0.04));

  const actionDefs = [
    { name: 'WAIT', cost: 0, uplift: 0 },
    { name: 'PAYMENT LINK', cost: 4, uplift: trueUpliftPayLink },
    { name: 'VOICE', cost: 65, uplift: trueUpliftVoice },
    { name: 'HUMAN', cost: 100, uplift: trueUpliftHuman },
  ] as const;

  const actions: ActionStat[] = actionDefs.map((a) => {
    const recoveryProb = clamp(naturalRecoveryProb + a.uplift);
    const incrementalProb = clamp(recoveryProb - naturalRecoveryProb);
    const expectedIncremental = amount * incrementalProb;
    const netValue = expectedIncremental - a.cost;
    return { ...a, recoveryProb, incrementalProb, expectedIncremental, netValue };
  });

  const bestAction = actions.reduce((best, a) => (a.netValue > best.netValue ? a : best));

  const conflictRoll = rng();
  const agentConflict =
    conflictRoll > 0.86
      ? { active: true, reason: 'Subscription Agent and Cart Agent both active on this customer.' }
      : { active: false, reason: null };

  const promiseActive = rng() > 0.92;

  let policyStatus: { allowed: boolean; reason: string | null } = { allowed: true, reason: null };
  if (promiseActive) {
    policyStatus = { allowed: false, reason: 'Active promise-to-pay locks other recovery actions.' };
  } else if (agentConflict.active) {
    policyStatus = { allowed: false, reason: 'Blocked pending conflict resolution.' };
  } else if (bestAction.name !== 'WAIT' && rng() > 0.94) {
    policyStatus = { allowed: false, reason: 'Contact frequency window exceeded in last 24h.' };
  }

  let finalDecision: DecisionName = bestAction.name;
  if (promiseActive) finalDecision = 'LOCK';
  else if (agentConflict.active) finalDecision = 'SUPPRESS';
  else if (!policyStatus.allowed) finalDecision = 'SUPPRESS';

  const chosen = actions.find((a) => a.name === bestAction.name) ?? actions[0];
  const recovered =
    finalDecision === bestAction.name && bestAction.name !== 'WAIT'
      ? amount * chosen.recoveryProb
      : amount * naturalRecoveryProb;
  const naturalPortion = amount * naturalRecoveryProb;
  const costIncurred = finalDecision === bestAction.name && bestAction.name !== 'WAIT' ? bestAction.cost : 0;

  const now = Date.now() - ageHours * 3600 * 1000;
  const trace: TraceStep[] = [
    { t: now, label: 'payment.failed', detail: `Revenue leak normalized — ${leakType.toLowerCase()} case opened.` },
    {
      t: now + 40 * 1000,
      label: 'Natural recovery model',
      detail: `Estimated self-cure probability: ${(naturalRecoveryProb * 100).toFixed(1)}%`,
      meta: 'model v0.4.2',
    },
    { t: now + 65 * 1000, label: 'Candidate actions generated', detail: `${actions.length} actions scored against incremental value.` },
    { t: now + 90 * 1000, label: 'Portfolio allocator', detail: `Recommended: ${bestAction.name} (highest net value).` },
    {
      t: now + 110 * 1000,
      label: 'Policy gate',
      detail: policyStatus.allowed ? 'All checks passed.' : policyStatus.reason ?? 'Policy rule triggered.',
      ok: policyStatus.allowed,
      meta: 'policy v1.1',
    },
    { t: now + 125 * 1000, label: 'Agent conflict check', detail: agentConflict.active ? agentConflict.reason ?? 'Conflict detected.' : 'No competing engagement found.', ok: !agentConflict.active },
    { t: now + 130 * 1000, label: 'FINAL DECISION', detail: finalDecision, final: true },
  ];

  return {
    id,
    leakType,
    amount,
    ageHours,
    naturalRecoveryProb,
    actions,
    bestAction: bestAction.name,
    agentConflict,
    promiseActive,
    policyStatus,
    finalDecision,
    recovered,
    naturalPortion,
    costIncurred,
    trace,
  };
}

export function useSyntheticPortfolio(seed = 42, n = 26) {
  return useMemo(() => {
    const rng = mulberry32(seed);
    const cases = Array.from({ length: n }, (_, i) => buildCase(rng, i));
    const gross = cases.reduce((sum, c) => sum + c.recovered, 0);
    const natural = cases.reduce((sum, c) => sum + c.naturalPortion, 0);
    const cost = cases.reduce((sum, c) => sum + c.costIncurred, 0);
    const net = gross - natural - cost;
    return { cases, gross, natural, cost, net };
  }, [seed, n]);
}

const API_BASE_URL = (import.meta.env.VITE_API_URL || 'https://razorpay-2-l5nh.onrender.com').replace(/\/$/, '');

type ApiAction = {
  action: string;
  cost: number;
  recovery_prob: number;
  incremental_prob: number;
  expected_incremental_value: number;
  net_value: number;
};

type ApiCase = {
  case_ref: string;
  leak_type: LeakType;
  amount_at_risk: number;
  age_hours: number;
  natural_recovery_prob: number;
  best_action: string;
  final_decision: string;
  agent_conflict: boolean;
  conflict_reason: string | null;
  policy_allowed: boolean;
  policy_reason: string | null;
  promise_active: boolean;
  actions: ApiAction[];
};

type ApiLedger = {
  gross_recovered: number;
  natural_self_cure: number;
  intervention_cost: number;
  net_incremental_value: number;
};

function mapApiCase(item: ApiCase): CaseRecord {
  const actions = item.actions.map((action) => ({
    name: action.action as ActionName,
    cost: action.cost,
    uplift: action.incremental_prob,
    recoveryProb: action.recovery_prob,
    incrementalProb: action.incremental_prob,
    expectedIncremental: action.expected_incremental_value,
    netValue: action.net_value,
  }));

  return {
    id: item.case_ref,
    leakType: item.leak_type,
    amount: item.amount_at_risk,
    ageHours: item.age_hours,
    naturalRecoveryProb: item.natural_recovery_prob,
    actions,
    bestAction: item.best_action as ActionName,
    agentConflict: { active: item.agent_conflict, reason: item.conflict_reason },
    promiseActive: item.promise_active,
    policyStatus: { allowed: item.policy_allowed, reason: item.policy_reason },
    finalDecision: item.final_decision as DecisionName,
    recovered: 0,
    naturalPortion: 0,
    costIncurred: 0,
    trace: [],
  };
}

function useBackendPortfolio() {
  const [portfolio, setPortfolio] = useState<{ gross: number; natural: number; cost: number; net: number; cases: CaseRecord[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadPortfolio = async () => {
      try {
        const [portfolioResponse, ledgerResponse] = await Promise.all([
          fetch(`${API_BASE_URL}/api/portfolio`),
          fetch(`${API_BASE_URL}/api/ledger`),
        ]);
        if (!portfolioResponse.ok || !ledgerResponse.ok) throw new Error('Backend request failed');
        const [cases, ledger] = await Promise.all([
          portfolioResponse.json() as Promise<ApiCase[]>,
          ledgerResponse.json() as Promise<ApiLedger>,
        ]);
        setPortfolio({
          gross: ledger.gross_recovered,
          natural: ledger.natural_self_cure,
          cost: ledger.intervention_cost,
          net: ledger.net_incremental_value,
          cases: cases.map(mapApiCase),
        });
      } catch {
        setError('Unable to load the recovery backend. Please try again shortly.');
      }
    };

    void loadPortfolio();
  }, []);

  return { portfolio, error };
}

function Pill({ children, tone = 'neutral', icon: Icon }: { children?: React.ReactNode; tone?: 'neutral' | 'live' | 'warn' | 'bad'; icon?: LucideIcon }) {
  const tones = {
    neutral: { bg: 'var(--panel)', fg: 'var(--ink-soft)', bd: 'var(--line)' },
    live: { bg: 'var(--positive-soft)', fg: 'var(--positive)', bd: 'var(--positive)' },
    warn: { bg: 'var(--warn-soft)', fg: 'var(--warn)', bd: 'var(--warn)' },
    bad: { bg: 'var(--negative-soft)', fg: 'var(--negative)', bd: 'var(--negative)' },
  } as const;

  const t = tones[tone];

  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] tracking-[0.1em] rc-mono"
      style={{ background: t.bg, color: t.fg, border: `1px solid ${t.bd}` }}
    >
      {Icon && <Icon size={11} strokeWidth={2} />}
      {children}
    </span>
  );
}

function DecisionBadge({ decision }: { decision: string }) {
  const map: Record<string, { tone: 'neutral' | 'live' | 'warn' | 'bad'; label: string }> = {
    WAIT: { tone: 'neutral', label: 'WAIT' },
    'PAYMENT LINK': { tone: 'live', label: 'PAYMENT LINK' },
    VOICE: { tone: 'live', label: 'VOICE' },
    HUMAN: { tone: 'live', label: 'HUMAN' },
    SUPPRESS: { tone: 'warn', label: 'SUPPRESS' },
    LOCK: { tone: 'bad', label: 'LOCKED' },
  };

  const item = map[decision] ?? map.WAIT;
  return <Pill tone={item.tone}>{item.label}</Pill>;
}

function CommandPalette({
  open,
  onClose,
  cases,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  cases: CaseRecord[];
  onSelect: (c: CaseRecord) => void;
}) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      window.setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  if (!open) return null;

  const results = cases
    .filter((c) => `${c.id} ${c.leakType}`.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 8);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-24" style={{ background: 'rgba(33,29,23,0.45)' }} onClick={onClose}>
      <div className="w-full max-w-lg rc-root rounded-[18px] border border-[rgba(0,0,0,0.08)] shadow-[0_8px_28px_rgba(0,0,0,0.08)]" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-[var(--line)] px-4 py-3">
          <Search size={15} color="var(--muted)" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Jump to case, e.g. C-1004"
            className="flex-1 bg-transparent text-sm text-[var(--ink)] outline-none"
          />
          <kbd className="rc-mono rounded border border-[var(--line)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">ESC</kbd>
        </div>
        <div className="max-h-72 overflow-y-auto rc-scrollbar">
          {results.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-[var(--muted)]">No matching cases.</div>
          )}
          {results.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                onSelect(c);
                onClose();
              }}
              className="flex w-full items-center justify-between border-b border-[var(--line)] px-4 py-2.5 text-left hover:bg-black/[0.03]"
            >
              <span className="flex items-center gap-3">
                <span className="rc-mono text-xs text-[var(--accent)]">{c.id}</span>
                <span className="text-sm text-[var(--ink-soft)]">{c.leakType}</span>
              </span>
              <span className="rc-mono text-xs text-[var(--muted)]">{rupee(c.amount)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function MetricHero({ gross, natural, cost, net }: { gross: number; natural: number; cost: number; net: number }) {
  return (
    <div className="rounded-[18px] border border-[var(--line)] bg-[var(--panel)] p-6 md:p-8">
      <div className="mb-5 flex items-center justify-between">
        <span className="rc-mono text-xs tracking-[0.16em] text-[var(--muted)]">NET INCREMENTAL VALUE</span>
        <Pill tone="live">LIVE BACKEND DATA</Pill>
      </div>
      <div className="rc-serif text-[clamp(2.6rem,6vw,4.2rem)] leading-none text-[var(--ink)]">{rupeeL(net)}</div>
      <div className="mt-6 grid grid-cols-2 gap-4 text-[13px] md:grid-cols-4 rc-mono">
        <div>
          <div className="text-[var(--muted)]">Gross recovered</div>
          <div className="mt-1 text-[var(--ink)]">{rupeeL(gross)}</div>
        </div>
        <div>
          <div className="text-[var(--muted)]">&minus; Natural / self-cure</div>
          <div className="mt-1 text-[var(--ink-soft)]">{rupeeL(natural)}</div>
        </div>
        <div>
          <div className="text-[var(--muted)]">&minus; Intervention cost</div>
          <div className="mt-1 text-[var(--ink-soft)]">{rupeeL(cost)}</div>
        </div>
        <div>
          <div className="text-[var(--muted)]">= Net incremental</div>
          <div className="mt-1 text-[var(--positive)]">{rupeeL(net)}</div>
        </div>
      </div>
    </div>
  );
}

function RecoveryCapital() {
  const items = [
    { label: 'Intervention budget', value: '₹8,240 / ₹10,000', pct: 82 },
    { label: 'Contact capacity', value: '312 / 500', pct: 62 },
    { label: 'Voice slots', value: '41 / 100', pct: 41 },
    { label: 'Human collector slots', value: '9 / 50', pct: 18 },
  ];

  return (
    <div className="rounded-[18px] border border-[var(--line)] bg-[var(--panel)] p-5">
      <div className="mb-4 rc-mono text-xs tracking-[0.16em] text-[var(--muted)]">RECOVERY CAPITAL</div>
      <div className="space-y-4">
        {items.map((item) => (
          <div key={item.label}>
            <div className="mb-1.5 flex justify-between text-[13px]">
              <span className="text-[var(--ink-soft)]">{item.label}</span>
              <span className="rc-mono text-[var(--ink)]">{item.value}</span>
            </div>
            <div className="h-1.5 bg-[var(--accent-soft)]">
              <div className="h-1.5 bg-[var(--accent)]" style={{ width: `${item.pct}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DecisionPulse({ cases }: { cases: CaseRecord[] }) {
  const feed = useMemo(() => cases.slice(0, 7), [cases]);

  return (
    <div className="rounded-[18px] border border-[var(--line)] bg-[var(--panel)] p-5">
      <div className="mb-4 flex items-center gap-2">
        <Radio size={13} className="text-[var(--positive)]" />
        <span className="rc-mono text-xs tracking-[0.16em] text-[var(--muted)]">DECISION PULSE</span>
      </div>
      <div className="space-y-0">
        {feed.map((c, index) => (
          <div key={c.id} className="flex items-center justify-between gap-3 py-3" style={{ borderTop: index === 0 ? 'none' : '1px solid var(--line)' }}>
            <div className="flex min-w-0 items-center gap-3">
              <span className="rc-mono shrink-0 text-xs text-[var(--accent)]">{c.id}</span>
              <span className="rc-mono shrink-0 text-xs text-[var(--ink)]">{rupee(c.amount)} at risk</span>
              <span className="truncate text-[13px] text-[var(--muted)]">
                Natural recovery {(c.naturalRecoveryProb * 100).toFixed(0)}%
                {c.finalDecision !== 'WAIT' && c.bestAction !== 'WAIT' && ` · ${c.bestAction} uplift +${(c.actions.find((a) => a.name === c.bestAction)?.incrementalProb ?? 0 * 100).toFixed(0)}%`}
              </span>
            </div>
            <DecisionBadge decision={c.finalDecision} />
          </div>
        ))}
      </div>
    </div>
  );
}

function SnapshotBars({ cases }: { cases: CaseRecord[] }) {
  const groups: Record<string, number> = { WAIT: 0, ACT: 0, SUPPRESS: 0, LOCK: 0 };

  cases.forEach((c) => {
    if (c.finalDecision === 'WAIT') groups.WAIT += 1;
    else if (c.finalDecision === 'SUPPRESS') groups.SUPPRESS += 1;
    else if (c.finalDecision === 'LOCK') groups.LOCK += 1;
    else groups.ACT += 1;
  });

  const max = Math.max(...Object.values(groups), 1);

  return (
    <div className="space-y-3">
      {Object.entries(groups).map(([key, value]) => (
        <div key={key} className="flex items-center gap-3">
          <span className="rc-mono w-16 shrink-0 text-[11px] text-[var(--muted)]">{key}</span>
          <div className="h-[14px] flex-1 bg-[var(--accent-soft)]">
            <div
              className="h-[14px]"
              style={{
                width: `${(value / max) * 100}%`,
                background: key === 'SUPPRESS' || key === 'LOCK' ? 'var(--warn)' : 'var(--accent)',
              }}
            />
          </div>
          <span className="rc-mono w-6 text-right text-[11px] text-[var(--ink)]">{value}</span>
        </div>
      ))}
    </div>
  );
}

function CommandCenterPage({ portfolio }: { portfolio: { gross: number; natural: number; cost: number; net: number; cases: CaseRecord[] } }) {
  return (
    <div className="space-y-5">
      <MetricHero gross={portfolio.gross} natural={portfolio.natural} cost={portfolio.cost} net={portfolio.net} />
      <div className="grid gap-5 md:grid-cols-2">
        <RecoveryCapital />
        <div className="rounded-[18px] border border-[var(--line)] bg-[var(--panel)] p-5">
          <div className="mb-4 rc-mono text-xs tracking-[0.16em] text-[var(--muted)]">PORTFOLIO SNAPSHOT</div>
          <SnapshotBars cases={portfolio.cases} />
        </div>
      </div>
      <DecisionPulse cases={portfolio.cases} />
    </div>
  );
}

const FILTERS = ['All', 'Subscription', 'Cart', 'Invoice', 'Mandate', 'Payment Link'];
const SORTS = [
  { key: 'netValue', label: 'Net Value' },
  { key: 'expected', label: 'Expected Incremental' },
  { key: 'amount', label: 'Amount at Risk' },
  { key: 'age', label: 'Age' },
] as const;

function PortfolioPage({ cases, onOpen }: { cases: CaseRecord[]; onOpen: (c: CaseRecord) => void }) {
  const [filter, setFilter] = useState('All');
  const [sort, setSort] = useState<(typeof SORTS)[number]['key']>('netValue');

  const rows = useMemo(() => {
    let filtered = cases.filter((c) => filter === 'All' || c.leakType === filter);

    const score = (c: CaseRecord) => {
      const recommended = c.actions.find((a) => a.name === c.bestAction) ?? c.actions[0];
      if (sort === 'netValue') return recommended.netValue;
      if (sort === 'expected') return recommended.expectedIncremental;
      if (sort === 'amount') return c.amount;
      if (sort === 'age') return c.ageHours;
      return 0;
    };

    return [...filtered].sort((a, b) => score(b) - score(a));
  }, [cases, filter, sort]);

  const suppressed = useMemo(() => cases.filter((c) => c.finalDecision === 'SUPPRESS' || c.finalDecision === 'LOCK'), [cases]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((item) => (
            <button
              key={item}
              onClick={() => setFilter(item)}
              className="rc-mono px-3 py-1.5 text-[12.5px] transition-colors duration-200"
              style={{
                border: `1px solid ${filter === item ? 'var(--ink)' : 'var(--line)'}`,
                background: filter === item ? 'var(--ink)' : 'transparent',
                color: filter === item ? 'var(--panel)' : 'var(--ink-soft)',
              }}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 rc-mono text-[12.5px] text-[var(--muted)]">
          Sort
          <select value={sort} onChange={(event) => setSort(event.target.value as (typeof SORTS)[number]['key'])} className="rc-mono border border-[var(--line)] bg-[var(--panel)] px-2 py-1.5 text-[var(--ink)]">
            {SORTS.map((option) => (
              <option key={option.key} value={option.key}>{option.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="overflow-x-auto rc-scrollbar rounded-[14px] border border-[var(--line)] bg-[var(--panel)]">
        <table className="w-full min-w-[820px] text-[13px]">
          <thead>
            <tr className="rc-mono border-b border-[var(--line-strong)] text-[11px] text-[var(--muted)]">
              {['Case', 'Leak Type', 'Amount', 'Age', 'Natural %', 'Best Action', 'Net Value', 'Conflict', 'Policy', 'Decision'].map((header) => (
                <th key={header} className="px-3 py-2.5 text-left font-normal whitespace-nowrap">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const recommended = c.actions.find((a) => a.name === c.bestAction) ?? c.actions[0];
              return (
                <tr key={c.id} onClick={() => onOpen(c)} className="cursor-pointer border-b border-[var(--line)] transition-colors duration-200 hover:bg-black/[0.025]" >
                  <td className="px-3 py-2.5 rc-mono text-[var(--accent)]">{c.id}</td>
                  <td className="px-3 py-2.5 text-[var(--ink-soft)]">{c.leakType}</td>
                  <td className="px-3 py-2.5 rc-mono whitespace-nowrap">{rupee(c.amount)}</td>
                  <td className="px-3 py-2.5 rc-mono text-[var(--muted)]">{c.ageHours}h</td>
                  <td className="px-3 py-2.5 rc-mono">{(c.naturalRecoveryProb * 100).toFixed(0)}%</td>
                  <td className="px-3 py-2.5">{c.bestAction}</td>
                  <td className="px-3 py-2.5 rc-mono" style={{ color: recommended.netValue >= 0 ? 'var(--positive)' : 'var(--negative)' }}>{rupee(recommended.netValue)}</td>
                  <td className="px-3 py-2.5">
                    {c.agentConflict.active ? <Pill tone="warn" icon={AlertTriangle}>Yes</Pill> : <span className="text-[var(--muted)]">&mdash;</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    {c.policyStatus.allowed ? <Pill tone="live" icon={ShieldCheck}>Allowed</Pill> : <Pill tone="bad" icon={Ban}>Blocked</Pill>}
                  </td>
                  <td className="px-3 py-2.5"><DecisionBadge decision={c.finalDecision} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div>
        <div className="mb-3 flex items-center gap-2">
          <span className="rc-mono text-xs tracking-[0.16em] text-[var(--muted)]">SUPPRESSED OPPORTUNITIES</span>
          <span className="rc-mono text-[11px] text-[var(--muted)]">({suppressed.length})</span>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {suppressed.slice(0, 4).map((c) => (
            <button key={c.id} onClick={() => onOpen(c)} className="rounded-[16px] border border-[var(--line)] bg-[var(--panel)] p-4 text-left transition-colors duration-200 hover:border-[var(--line-strong)] hover:bg-[#f7f4ee]">
              <div className="mb-2 flex items-start justify-between">
                <span className="rc-mono text-xs text-[var(--accent)]">{c.id}</span>
                <DecisionBadge decision={c.finalDecision} />
              </div>
              <div className="rc-mono mb-1 text-lg">{rupee(c.amount)} at risk</div>
              <div className="text-[13px] text-[var(--ink-soft)]">
                Natural recovery {(c.naturalRecoveryProb * 100).toFixed(0)}% · Expected incremental {rupee(c.actions.find((a) => a.name === c.bestAction)?.expectedIncremental ?? 0)}
              </div>
              <div className="mt-2 text-[12.5px] text-[var(--muted)]">
                {c.promiseActive ? 'Active promise-to-pay locks other recovery actions.' : c.agentConflict.active ? c.agentConflict.reason : c.policyStatus.reason}
              </div>
            </button>
          ))}
          {suppressed.length === 0 && <div className="text-[13px] text-[var(--muted)]">No suppressed cases in this sample.</div>}
        </div>
      </div>
    </div>
  );
}

const ACTION_ICON: Record<string, LucideIcon> = {
  WAIT: Clock,
  'PAYMENT LINK': Link2,
  VOICE: PhoneCall,
  HUMAN: UserCheck,
};

function ActionCard({ action, isRecommended }: { action: ActionStat; isRecommended: boolean }) {
  const Icon = ACTION_ICON[action.name] || Clock;

  return (
    <div className="rounded-[14px] border p-3.5" style={{ background: isRecommended ? 'var(--accent-soft)' : 'var(--panel)', borderColor: isRecommended ? 'var(--accent)' : 'var(--line)' }}>
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[13px] text-[var(--ink)]">
          <Icon size={13} /> {action.name}
        </span>
        {isRecommended && <Pill tone="live">Recommended</Pill>}
      </div>
      <div className="grid grid-cols-2 gap-y-1.5 rc-mono text-[12px] text-[var(--ink-soft)]">
        <span className="text-[var(--muted)]">Expected incremental</span>
        <span className="text-right">{rupee(action.expectedIncremental)}</span>
        <span className="text-[var(--muted)]">Cost</span>
        <span className="text-right">{rupee(action.cost)}</span>
        <span className="text-[var(--muted)]">Net value</span>
        <span className="text-right" style={{ color: action.netValue >= 0 ? 'var(--positive)' : 'var(--negative)' }}>{rupee(action.netValue)}</span>
      </div>
    </div>
  );
}

function DecisionTrace({ trace }: { trace: TraceStep[] }) {
  return (
    <div className="space-y-0">
      {trace.map((step, index) => (
        <div key={`${step.label}-${index}`} className="relative pl-6 pb-5" style={{ borderLeft: index === trace.length - 1 ? 'none' : '1px solid var(--line-strong)', marginLeft: 5 }}>
          <div className="absolute -left-[5px] top-1 h-[9px] w-[9px] rounded-full" style={{ background: step.final ? 'var(--ink)' : 'var(--accent)' }} />
          <div className="mb-0.5 flex items-center gap-2">
            <span className="rc-mono text-[11px] text-[var(--muted)]">
              {new Date(step.t).toLocaleTimeString('en-IN', { hour12: false })}
            </span>
            {step.meta && <span className="rc-mono rounded border border-[var(--line)] px-1.5 text-[10px] text-[var(--muted)]">{step.meta}</span>}
          </div>
          <div className={step.final ? 'rc-serif text-base' : 'text-[13.5px]'} style={{ color: step.ok === false ? 'var(--negative)' : 'var(--ink)' }}>
            {step.label}
          </div>
          {step.detail && <div className="mt-0.5 text-[12.5px] text-[var(--ink-soft)]">{step.detail}</div>}
        </div>
      ))}
    </div>
  );
}

function DecisionDrawer({ c, onClose }: { c: CaseRecord | null; onClose: () => void }) {
  const [showTrace, setShowTrace] = useState(false);

  if (!c) return null;

  const rec = c.actions.find((a) => a.name === c.bestAction) ?? c.actions[0];

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-[rgba(33,29,23,0.35)]" onClick={onClose} />
      <div className="relative h-full w-full overflow-y-auto rc-scrollbar rc-root border-l border-[var(--line-strong)] bg-[var(--panel)] shadow-[0_0_0_1px_rgba(0,0,0,0.02),0_18px_50px_rgba(0,0,0,0.12)] sm:w-[440px] max-sm:bottom-0 max-sm:top-auto max-sm:h-[82vh] max-sm:rounded-t-[28px] max-sm:border-l-0 max-sm:border-t">
        <div className="sticky top-0 flex items-center justify-between border-b border-[var(--line)] bg-[var(--panel)] px-5 py-4">
          <div>
            <div className="rc-mono text-xs text-[var(--accent)]">{c.id}</div>
            <div className="rc-serif mt-0.5 text-xl">{rupee(c.amount)} at risk</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded border border-[var(--line)] p-1.5 text-[var(--ink)]">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-6 p-5">
          <div className="flex flex-wrap gap-2">
            <Pill>{c.leakType}</Pill>
            <Pill icon={Clock}>{c.ageHours}h old</Pill>
            <DecisionBadge decision={c.finalDecision} />
          </div>

          {c.promiseActive && (
            <div className="rounded border border-[var(--negative)] bg-[var(--negative-soft)] p-3 text-[13px] text-[var(--negative)]">
              Active promise-to-pay. All other recovery actions locked until fulfilled or the deadline passes.
            </div>
          )}

          <div>
            <div className="mb-2 rc-mono text-xs tracking-[0.16em] text-[var(--muted)]">NATURAL RECOVERY PROBABILITY</div>
            <div className="rc-serif text-3xl">{(c.naturalRecoveryProb * 100).toFixed(1)}%</div>
          </div>

          <div>
            <div className="mb-3 rc-mono text-xs tracking-[0.16em] text-[var(--muted)]">CANDIDATE ACTIONS</div>
            <div className="space-y-2.5">
              {c.actions.map((action) => (
                <ActionCard key={action.name} action={action} isRecommended={action.name === c.bestAction} />
              ))}
            </div>
          </div>

          <div className="rounded border border-[var(--accent)] bg-[var(--accent-soft)] p-4">
            <div className="mb-1.5 rc-mono text-xs tracking-[0.16em] text-[var(--accent)]">RECOMMENDATION</div>
            <div className="rc-serif mb-2 text-2xl">{c.bestAction}</div>
            <p className="text-[13px] text-[var(--ink-soft)]">
              {c.bestAction === 'WAIT'
                ? 'Intervention is not economically justified relative to preserving scarce recovery capital.'
                : `Net incremental value of ${rupee(rec.netValue)} justifies action against a natural recovery baseline of ${(c.naturalRecoveryProb * 100).toFixed(0)}%.`}
            </p>
          </div>

          <div className="flex items-center justify-between gap-2 text-[12.5px]">
            <span className="flex items-center gap-1.5" style={{ color: c.policyStatus.allowed ? 'var(--positive)' : 'var(--negative)' }}>
              {c.policyStatus.allowed ? <ShieldCheck size={13} /> : <Ban size={13} />}
              {c.policyStatus.allowed ? 'Policy: allowed' : `Policy: ${c.policyStatus.reason}`}
            </span>
          </div>

          <button onClick={() => setShowTrace((state) => !state)} className="flex w-full items-center justify-between border border-[var(--line-strong)] px-4 py-3 text-[13px] text-[var(--ink)]">
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

export default function App() {
  const { portfolio, error } = useBackendPortfolio();
  const [tab, setTab] = useState<'command' | 'portfolio'>('command');
  const [selected, setSelected] = useState<CaseRecord | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
      }
      if (event.key === 'Escape') {
        setPaletteOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (!portfolio) {
    return (
      <div className="rc-root flex min-h-screen items-center justify-center px-6">
        <div className="max-w-md text-center">
          <div className="rc-serif text-2xl">RECOVER //</div>
          <p className="mt-3 text-sm text-[var(--muted)]">{error ?? 'Connecting to the recovery backend...'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rc-root min-h-screen">
      <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="rc-serif text-2xl tracking-tight">RECOVER //</div>
            <div className="mt-0.5 text-[12px] text-[var(--muted)]">Financial control plane for revenue recovery</div>
          </div>
          <div className="flex items-center gap-2">
            <Pill tone="live" icon={CircleDot}>LIVE</Pill>
            <Pill icon={Activity}>Webhooks healthy</Pill>
            <button onClick={() => setPaletteOpen(true)} className="flex items-center gap-1.5 border border-[var(--line)] px-2.5 py-1 rc-mono text-[11px] text-[var(--muted)]">
              <Command size={11} /> K
            </button>
          </div>
        </header>

        <nav className="mb-6 flex gap-1 border-b border-[var(--line-strong)]">
          {[
            ['command', 'Command Center'],
            ['portfolio', 'Recovery Portfolio'],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key as 'command' | 'portfolio')}
              className="-mb-px px-4 py-2.5 rc-mono text-[13px] transition-colors duration-200"
              style={{
                borderBottom: `2px solid ${tab === key ? 'var(--ink)' : 'transparent'}`,
                color: tab === key ? 'var(--ink)' : 'var(--muted)',
              }}
            >
              {label}
            </button>
          ))}
          {['Decision Lab', 'Agent Control', 'Causal Ledger', 'Experiments', 'Policy Engine'].map((label) => (
            <span key={label} className="px-4 py-2.5 rc-mono text-[13px] text-[var(--line-strong)]" title="Coming next in the backend build">
              {label}
            </span>
          ))}
        </nav>

        {tab === 'command' ? <CommandCenterPage portfolio={portfolio} /> : <PortfolioPage cases={portfolio.cases} onOpen={setSelected} />}
      </div>

      <DecisionDrawer c={selected} onClose={() => setSelected(null)} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} cases={portfolio.cases} onSelect={setSelected} />
    </div>
  );
}
