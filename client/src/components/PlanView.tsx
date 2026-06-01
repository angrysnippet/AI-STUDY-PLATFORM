import type { StudyPlan } from '../types';

interface Props {
  plan: StudyPlan;
  completedDays: number[];
  onToggleDay: (day: number, done: boolean) => void;
  busyDay?: number | null;
}

export function PlanView({ plan, completedDays, onToggleDay, busyDay }: Props) {
  const done = new Set(completedDays);
  const ordered = [...plan.days].sort((a, b) => a.day - b.day);
  // A day is actionable only if every earlier day is done (sequential unlock),
  // matching the server's gating rule.
  const firstIncomplete = ordered.find((d) => !done.has(d.day))?.day;
  const pct = ordered.length ? Math.round((done.size / ordered.length) * 100) : 0;

  return (
    <div className="plan">
      <h2>{plan.courseTitle}</h2>
      <div className="plan-meta">
        {plan.estimatedDays} days · {plan.minutesPerDay} min/day · {plan.level}
        {plan.includeProjects ? ' · projects' : ''}
      </div>

      <div className="progress">
        <div className="progress-bar">
          <span style={{ width: `${pct}%` }} />
        </div>
        <span className="progress-label">
          {done.size}/{ordered.length} days · {pct}%
        </span>
      </div>

      {ordered.map((d) => {
        const isDone = done.has(d.day);
        const locked = !isDone && d.day !== firstIncomplete;
        const busy = busyDay === d.day;
        return (
          <div key={d.day} className={`day${isDone ? ' done' : ''}${locked ? ' locked' : ''}`}>
            <label className="day-head">
              <input
                type="checkbox"
                checked={isDone}
                disabled={locked || busy}
                onChange={(e) => onToggleDay(d.day, e.target.checked)}
              />
              <span className="day-title">
                Day {d.day} — {d.title}
              </span>
              {locked && <span className="lock" title="Finish earlier days first">🔒</span>}
            </label>
            {d.blocks.map((b, bi) => (
              <div key={bi} className="block">
                <div className="block-title">{b.title}</div>
                <ul>
                  {b.tasks.map((t, ti) => (
                    <li key={ti}>{t.text}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
