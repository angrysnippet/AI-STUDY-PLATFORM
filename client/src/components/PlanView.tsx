import { useEffect, useMemo, useRef, useState } from 'react';

import { askDoubt, getDoubts } from '../api/client';
import type { DoubtMessage, PlanDay, StudyPlan } from '../types';

interface Props {
  plan: StudyPlan;
  completedDays: number[];
  onToggleDay: (day: number, done: boolean) => void;
  busyDay?: number | null;
}

const DAYS_PER_WEEK = 7;

export function PlanView({ plan, completedDays, onToggleDay, busyDay }: Props) {
  const done = useMemo(() => new Set(completedDays), [completedDays]);
  const ordered = useMemo(() => [...plan.days].sort((a, b) => a.day - b.day), [plan.days]);
  const firstIncomplete = ordered.find((d) => !done.has(d.day))?.day;
  const pct = ordered.length ? Math.round((done.size / ordered.length) * 100) : 0;

  // Group days into weeks for navigable structure on long plans.
  const weeks = useMemo(() => {
    const out: PlanDay[][] = [];
    for (let i = 0; i < ordered.length; i += DAYS_PER_WEEK) {
      out.push(ordered.slice(i, i + DAYS_PER_WEEK));
    }
    return out;
  }, [ordered]);

  // Expand the week that holds the "next up" day; collapse the rest. Reset per plan.
  const nextWeekIdx = firstIncomplete
    ? Math.floor((ordered.findIndex((d) => d.day === firstIncomplete)) / DAYS_PER_WEEK)
    : 0;
  const [open, setOpen] = useState<Set<number>>(new Set([nextWeekIdx]));
  useEffect(() => {
    setOpen(new Set([nextWeekIdx]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.id]);

  function toggleWeek(i: number) {
    setOpen((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  return (
    <div className="plan">
      <div className="plan-header">
        <h2>{plan.courseTitle}</h2>
        <div className="plan-meta">
          <span>{plan.estimatedDays} days</span>
          <span className="dot">·</span>
          <span>{plan.minutesPerDay} min/day</span>
          <span className="dot">·</span>
          <span>{plan.level}</span>
          {plan.includeProjects && (
            <>
              <span className="dot">·</span>
              <span>projects</span>
            </>
          )}
        </div>

        {plan.feasibility && (
          <div className={`feasibility ${plan.feasibility.grade.toLowerCase()}`}>
            <strong>
              {plan.feasibility.grade === 'FEASIBLE'
                ? '✅ Feasible'
                : plan.feasibility.grade === 'TIGHT'
                  ? '⚠️ Tight'
                  : '🛑 Too long'}
            </strong>{' '}
            {plan.feasibility.note}
          </div>
        )}

        <div className="progress">
          <div className="progress-bar">
            <span style={{ width: `${pct}%` }} />
          </div>
          <span className="progress-label">
            {done.size}/{ordered.length} · {pct}%
          </span>
        </div>
      </div>

      {weeks.map((wkDays, wi) => {
        const isOpen = open.has(wi);
        const wkDone = wkDays.filter((d) => done.has(d.day)).length;
        const first = wkDays[0].day;
        const last = wkDays[wkDays.length - 1].day;
        return (
          <section className="week" key={wi}>
            <button className={`week-head${isOpen ? ' open' : ''}`} onClick={() => toggleWeek(wi)}>
              <span className="chev">▶</span>
              Week {wi + 1}
              <span className="wk-prog">
                <span className={wkDone === wkDays.length ? 'wk-done' : ''}>
                  {wkDone}/{wkDays.length}
                </span>{' '}
                · days {first}–{last}
              </span>
            </button>
            {isOpen && (
              <div className="week-body">
                {wkDays.map((d) => (
                  <DayCard
                    key={d.day}
                    planId={plan.id}
                    day={d}
                    isDone={done.has(d.day)}
                    locked={!done.has(d.day) && d.day !== firstIncomplete}
                    isNext={d.day === firstIncomplete}
                    busy={busyDay === d.day}
                    onToggle={onToggleDay}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function DayCard({
  planId,
  day,
  isDone,
  locked,
  isNext,
  busy,
  onToggle,
}: {
  planId: string;
  day: PlanDay;
  isDone: boolean;
  locked: boolean;
  isNext: boolean;
  busy: boolean;
  onToggle: (day: number, done: boolean) => void;
}) {
  const [showDoubts, setShowDoubts] = useState(false);
  const cls = [
    'day',
    isDone ? 'done' : '',
    locked ? 'locked' : '',
    isNext ? 'next' : '',
    day.kind === 'project' ? 'project' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cls}>
      <label className="day-head">
        <input
          type="checkbox"
          className="day-check"
          checked={isDone}
          disabled={locked || busy}
          onChange={(e) => onToggle(day.day, e.target.checked)}
        />
        <span className="day-title">
          {day.kind === 'project' && <span className="badge">PROJECT</span>}
          <span className="day-num">Day {day.day}</span> — {day.title}
        </span>
        {isNext && <span className="next-tag">NEXT UP</span>}
        {locked && !isNext && (
          <span className="lock" title="Finish earlier days first">
            🔒
          </span>
        )}
      </label>
      {day.blocks.map((b, bi) => (
        <div key={bi} className="block">
          <div className="block-title">{b.title}</div>
          <ul>
            {b.tasks.map((t, ti) => (
              <li key={ti}>
                {t.url ? (
                  <a href={t.url} target="_blank" rel="noreferrer" className="watch-link">
                    {t.text}
                  </a>
                ) : (
                  t.text
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}

      <button className="doubt-toggle" onClick={() => setShowDoubts((v) => !v)}>
        {showDoubts ? '× Close doubts' : '💬 Ask a doubt about this topic'}
      </button>
      {showDoubts && <DoubtPanel planId={planId} day={day.day} topic={day.title} />}
    </div>
  );
}

function DoubtPanel({ planId, day, topic }: { planId: string; day: number; topic: string }) {
  const [messages, setMessages] = useState<DoubtMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  // Load any existing thread for this topic when the panel opens.
  useEffect(() => {
    getDoubts(planId, day)
      .then((t) => setMessages(t.messages))
      .catch(() => {});
  }, [planId, day]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages, busy]);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q || busy) return;
    setInput('');
    setError('');
    setMessages((m) => [...m, { role: 'user', text: q, at: new Date().toISOString() }]);
    setBusy(true);
    try {
      const t = await askDoubt(planId, day, q);
      setMessages(t.messages);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="doubt-panel">
      <div className="doubt-hint">Ask anything about “{topic}”.</div>
      <div className="doubt-messages">
        {messages.map((m, i) => (
          <div key={i} className={`doubt-msg ${m.role}`}>
            {m.text}
          </div>
        ))}
        {busy && <div className="doubt-msg assistant thinking">Thinking…</div>}
        <div ref={endRef} />
      </div>
      {error && <div className="notice">{error}</div>}
      <form className="doubt-composer" onSubmit={ask}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your question…"
          disabled={busy}
        />
        <button disabled={busy}>Ask</button>
      </form>
    </div>
  );
}
