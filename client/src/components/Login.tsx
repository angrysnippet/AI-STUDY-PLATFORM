import { useEffect, useRef, useState } from 'react';

import { devLogin, googleLogin } from '../api/client';
import type { AuthConfig, User } from '../types';

interface Props {
  authConfig: AuthConfig | null;
  onLogin: (user: User) => void;
}

export function Login({ authConfig, onLogin }: Props) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const googleBtn = useRef<HTMLDivElement>(null);

  async function handleDevLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onLogin(await devLogin(name.trim() || undefined));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  // Load Google Identity Services + render its button only when the server
  // reports Google is configured. Dormant in stub mode.
  useEffect(() => {
    if (!authConfig?.google || !authConfig.googleClientId) return;
    const clientId = authConfig.googleClientId;

    function init() {
      const g = (window as unknown as { google?: any }).google;
      if (!g || !googleBtn.current) return;
      g.accounts.id.initialize({
        client_id: clientId,
        callback: async (resp: { credential: string }) => {
          try {
            onLogin(await googleLogin(resp.credential));
          } catch (err) {
            setError((err as Error).message);
          }
        },
      });
      g.accounts.id.renderButton(googleBtn.current, {
        theme: 'filled_black',
        size: 'large',
        width: 300,
      });
    }

    if ((window as unknown as { google?: any }).google) {
      init();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = init;
    document.body.appendChild(script);
  }, [authConfig, onLogin]);

  return (
    <div className="login">
      <div className="login-hero">
        <div className="brand-mark">◆</div>
        <h1>Learn any YouTube course, on a real schedule.</h1>
        <p className="tagline">
          Paste a course playlist, tell us your goals, and get a paced, day-by-day plan you can
          actually finish — with progress tracking and project checkpoints.
        </p>
        <ul className="hero-points">
          <li>
            <span className="tick">✓</span> Honest timelines from real video lengths — not guesses.
          </li>
          <li>
            <span className="tick">✓</span> Daily tasks, review prompts, and hands-on projects.
          </li>
          <li>
            <span className="tick">✓</span> Check off days, unlock the next, watch your progress.
          </li>
        </ul>
      </div>

      <div className="login-form-wrap">
        <div className="login-card">
          <h2>Get started</h2>
          <p className="sub">Sign in to create and save your study plans.</p>

          {authConfig?.google && <div ref={googleBtn} className="google-btn" />}
          {authConfig?.google && authConfig?.devLogin && <div className="divider">or</div>}

          {authConfig?.devLogin && (
            <form className="dev-login" onSubmit={handleDevLogin}>
              <label>Continue without an account</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name (optional)"
                disabled={busy}
              />
              <button disabled={busy}>{busy ? 'Signing in…' : 'Continue as guest'}</button>
            </form>
          )}

          {!authConfig?.google && (
            <p className="hint">Google sign-in turns on automatically once it's configured on the server.</p>
          )}
          {error && <div className="notice">{error}</div>}
        </div>
      </div>
    </div>
  );
}
