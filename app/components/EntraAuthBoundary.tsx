"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, Building2, LogIn, RotateCw } from "lucide-react";
import { entraAuth, type EntraAuthSnapshot } from "../lib/entra-auth";

export default function EntraAuthBoundary({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<EntraAuthSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active=true;
    void entraAuth.initialize().then(value=>{if(active)setSnapshot(value);}).catch((reason) => {
      if(active)setError(reason instanceof Error ? reason.message : "Přihlášení se nepodařilo inicializovat");
    });
    return()=>{active=false;};
  }, []);

  if (snapshot?.mode === "browser" || snapshot?.authenticated) return children;
  const login = async () => {
    setBusy(true);
    setError(null);
    try {
      await entraAuth.login();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Přihlášení se nepodařilo");
      setBusy(false);
    }
  };
  const retry = () => {
    entraAuth.resetForRetry();
    setSnapshot(null);
    setError(null);
    void entraAuth.initialize().then(setSnapshot).catch((reason) => {
      setError(reason instanceof Error ? reason.message : "Přihlášení se nepodařilo inicializovat");
    });
  };

  return (
    <main className="auth-gate">
      <section className="auth-card" aria-live="polite">
        <span className="auth-brand"><Building2 size={22} /> DeveloCRM</span>
        {error ? (
          <>
            <AlertTriangle size={28} className="auth-error-icon" />
            <h1>Přihlášení není dostupné</h1>
            <p>{error}</p>
            <button className="secondary-button" onClick={retry}><RotateCw size={16} /> Zkusit znovu</button>
          </>
        ) : snapshot ? (
          <>
            <h1>Přihlášení do DeveloCRM</h1>
            <p>Pokračujte pracovním účtem Microsoft vaší organizace.</p>
            <button className="primary-button" onClick={login} disabled={busy}>
              <LogIn size={17} /> {busy ? "Přesměrovávám…" : "Přihlásit přes Microsoft"}
            </button>
          </>
        ) : (
          <>
            <span className="auth-spinner" />
            <h1>Ověřuji přihlášení…</h1>
          </>
        )}
      </section>
    </main>
  );
}
