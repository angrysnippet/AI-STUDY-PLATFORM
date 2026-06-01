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
  const listRef = useRef<HTMLDivElement>(null);

  // Boot: load auth config + restore any existing session.
  useEffect(() => {
    getAuthConfig()
      .then(setAuthConfig)
      .catch(() => setAuthConfig({ devLogin: true, google: false, googleClientId: null }));

    if (getToken()) {
      getMe()
        .then(setUser)
        .catch(() => clearToken())
        .finally(() => setAuthChecked(true));
    } else {
      setAuthChecked(true);
    }

    const drop = () => resetToLoggedOut();
    onUnauthorized.addEventListener('unauthorized', drop);
    return () => onUnauthorized.removeEventListener('unauthorized', drop);
  }, []);

  // Once logged in, start a conversation and load saved plans.
  useEffect(() => {
    if (!user) return;
    startConversation()
      .then((r) => {
        setConversationId(r.conversationId);
        setMessages([{ role: 'assistant', text: r.reply }]);
      })
      .catch(() => {
        setMessages([
          { role: 'assistant', text: 'Could not reach the server — is it running on port 4000?' },
        ]);
      });
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', text }]);
    setBusy(true);
    try {
      const r = await sendMessage(conversationId, text);
      if (r.conversationId) setConversationId(r.conversationId);
      setMessages((m) => [...m, { role: 'assistant', text: r.reply }]);
      if (r.plan) {
        setPlan(r.plan);
        setCompletedDays([]);
        setNotice('');
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

  if (!authChecked) {
    return <div className="booting">Loading…</div>;
  }
  if (!user) {
    return <Login authConfig={authConfig} onLogin={setUser} />;
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="logo">AI Study Platform</span>
        <span className="sub">Milestone 3 · multi-user</span>
        <div className="topbar-right">
          <span className="who">{user.name ?? user.email}</span>
          <button className="logout" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>
      <div className="panes">
        <section className="chat">
          <div className="messages" ref={listRef}>
            {messages.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                {m.text}
              </div>
            ))}
            {busy && <div className="msg assistant typing">…</div>}
          </div>
          <form className="composer" onSubmit={submit}>
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
            <PlanView
              plan={plan}
              completedDays={completedDays}
              onToggleDay={toggleDay}
              busyDay={busyDay}
            />
          ) : (
            <div className="empty">Your generated study plan will appear here.</div>
          )}
        </section>
      </div>
    </div>
  );
}
