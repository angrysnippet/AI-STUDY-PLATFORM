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

  // Load Google Identity Services and render its button — only when the server
  // reports Google is configured (real client id). Stays dormant in stub mode.
  useEffect(() => {
    if (!authConfig?.google || !authConfig.googleClientId) return;
    const clientId = authConfig.googleClientId;
    const SRC = 'https://accounts.google.com/gsi/client';

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
      g.accounts.id.renderButton(googleBtn.current, { theme: 'filled_black', size: 'large' });
    }

    if ((window as unknown as { google?: any }).google) {
      init();
      return;
    }
    const script = document.createElement('script');
    script.src = SRC;
    script.async = true;
    script.onload = init;
    document.body.appendChild(script);
  }, [authConfig, onLogin]);

  return (
    <div className="login">
      <div className="login-card">
        <div className="logo">AI Study Platform</div>
        <p className="login-sub">Turn any YouTube course into a personalized, trackable study plan.</p>

        {authConfig?.google && <div ref={googleBtn} className="google-btn" />}

        <form className="dev-login" onSubmit={handleDevLogin}>
          <label>Continue without an account (dev login)</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name (optional)"
            disabled={busy}
          />
          <button disabled={busy}>{busy ? 'Signing in…' : 'Continue'}</button>
        </form>

        {!authConfig?.google && (
          <p className="hint">Google sign-in appears here once it's configured on the server.</p>
        )}
        {error && <div className="notice">{error}</div>}
      </div>
    </div>
  );
}
