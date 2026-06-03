import { useEffect, useRef, useState } from 'react';

import {
  clearToken,
  deletePlan,
  getAuthConfig,
  getMe,
  getPlan,
  getProgress,
  getToken,
  listPlans,
  onUnauthorized,
  sendMessage,
  setDayDone,
  startConversation,
} from './api/client';
import { Login } from './components/Login';
import { PlanView } from './components/PlanView';
import type { AuthConfig, ChatMessage, PlanSummary, StudyPlan, User } from './types';

export default function App() {
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null);
  const [configError, setConfigError] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  const [conversationId, setConversationId] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [plan, setPlan] = useState<StudyPlan | null>(null);
  const [completedDays, setCompletedDays] = useState<number[]>([]);
  const [savedPlans, setSavedPlans] = useState<PlanSummary[]>([]);
  const [busyDay, setBusyDay] = useState<number | null>(null);
  const [notice, setNotice] = useState('');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [mobileTab, setMobileTab] = useState<'chat' | 'plan'>('chat');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    // Retry while the (serverless) API cold-starts, instead of failing instantly.
    async function loadConfig(attempt = 0): Promise<void> {
      try {
        const cfg = await getAuthConfig();
        if (!cancelled) {
          setAuthConfig(cfg);
          setConfigError(false);
        }
      } catch {
        if (cancelled) return;
        if (attempt < 6) {
          window.setTimeout(() => loadConfig(attempt + 1), 2500);
        } else {
          setConfigError(true);
        }
      }
    }
    loadConfig();

    if (getToken()) {
      getMe()
        .then((u) => !cancelled && setUser(u))
        .catch(() => clearToken())
        .finally(() => !cancelled && setAuthChecked(true));
    } else {
      setAuthChecked(true);
    }

    const drop = () => resetToLoggedOut();
    onUnauthorized.addEventListener('unauthorized', drop);
    return () => {
      cancelled = true;
      onUnauthorized.removeEventListener('unauthorized', drop);
    };
  }, []);

  // Let the "can't reach server" Retry button restart the config loader.
  function retryConfig() {
    setConfigError(false);
    getAuthConfig()
      .then(setAuthConfig)
      .catch(() => setConfigError(true));
  }

  useEffect(() => {
    if (!user) return;
    startConversation()
      .then((r) => {
        setConversationId(r.conversationId);
        setMessages([{ role: 'assistant', text: r.reply }]);
      })
      .catch(() =>
        setMessages([
          { role: 'assistant', text: 'Could not reach the server — is it running on port 4000?' },
        ]),
      );
    refreshPlans();
  }, [user]);

  useEffect(() => {
    listRef.current?.scrollTo(0, listRef.current.scrollHeight);
  }, [messages]);

  function refreshPlans() {
    listPlans()
      .then(setSavedPlans)
      .catch(() => {});
  }

  function resetToLoggedOut() {
    setUser(null);
    setConversationId('');
    setMessages([]);
    setPlan(null);
    setCompletedDays([]);
    setSavedPlans([]);
    setNotice('');
  }

  function logout() {
    clearToken();
    resetToLoggedOut();
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setInput('');
    setSuggestions([]);
    setMessages((m) => [...m, { role: 'user', text: trimmed }]);
    setBusy(true);
    try {
      const r = await sendMessage(conversationId, trimmed);
      if (r.conversationId) setConversationId(r.conversationId);
      setMessages((m) => [...m, { role: 'assistant', text: r.reply }]);
      setSuggestions(r.suggestions ?? []);
      if (r.plan) {
        setPlan(r.plan);
        setCompletedDays([]);
        setNotice('');
        setMobileTab('plan');
        refreshPlans();
      }
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', text: `⚠ ${(err as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  }

  async function openPlan(id: string) {
    try {
      const [p, prog] = await Promise.all([getPlan(id), getProgress(id)]);
      setPlan(p);
      setCompletedDays(prog.completedDays);
      setNotice('');
      setMobileTab('plan');
    } catch (err) {
      setNotice((err as Error).message);
    }
  }

  async function removePlan(id: string) {
    try {
      await deletePlan(id);
      if (plan?.id === id) {
        setPlan(null);
        setCompletedDays([]);
      }
      refreshPlans();
    } catch (err) {
      setNotice((err as Error).message);
    }
  }

  async function toggleDay(day: number, done: boolean) {
    if (!plan) return;
    setBusyDay(day);
    setNotice('');
    try {
      const prog = await setDayDone(plan.id, day, done);
      setCompletedDays(prog.completedDays);
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      setBusyDay(null);
    }
  }

  if (!authChecked) return <div className="booting">Loading…</div>;
  if (!user)
    return (
      <Login authConfig={authConfig} configError={configError} onRetry={retryConfig} onLogin={setUser} />
    );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">◆</span> AI Study Platform
        </div>
        <div className="topbar-right">
          <span className="who">
            <span className="avatar">{(user.name ?? user.email ?? '?').charAt(0).toUpperCase()}</span>
            {user.name ?? user.email}
          </span>
          <button className="logout" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

      <div className="mobile-tabs">
        <button className={mobileTab === 'chat' ? 'active' : ''} onClick={() => setMobileTab('chat')}>
          Chat
        </button>
        <button className={mobileTab === 'plan' ? 'active' : ''} onClick={() => setMobileTab('plan')}>
          Plan{plan ? '' : ' (none yet)'}
        </button>
      </div>

      <div className="panes" data-active={mobileTab}>
        <section className="chat">
          <div className="messages" ref={listRef}>
            {messages.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                {m.text}
              </div>
            ))}
            {busy && (
              <div className="msg assistant typing">
                <span />
                <span />
                <span />
              </div>
            )}
          </div>

          {!busy && suggestions.length > 0 && (
            <div className="suggestions">
              {suggestions.map((s) => (
                <button key={s} className="suggestion" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}

          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Paste a YouTube link or answer…"
              autoFocus
            />
            <button disabled={busy}>Send</button>
          </form>
        </section>

        <section className="plan-pane">
          {savedPlans.length > 0 && (
            <div className="saved">
              <div className="saved-title">Saved plans</div>
              <div className="saved-list">
                {savedPlans.map((p) => (
                  <div
                    key={p.id}
                    className={`chip${plan?.id === p.id ? ' active' : ''}`}
                    onClick={() => openPlan(p.id)}
                  >
                    <span className="chip-text">{p.courseTitle}</span>
                    <button
                      className="chip-x"
                      title="Delete plan"
                      onClick={(e) => {
                        e.stopPropagation();
                        removePlan(p.id);
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {notice && <div className="notice">{notice}</div>}

          {plan ? (
            <PlanView plan={plan} completedDays={completedDays} onToggleDay={toggleDay} busyDay={busyDay} />
          ) : (
            <div className="empty">
              <span className="empty-icon">📚</span>
              Your generated study plan will appear here.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
