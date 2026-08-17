"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, Building2, LogIn, RotateCw } from "lucide-react";
import { entraAuth, type EntraAuthSnapshot } from "../lib/entra-auth";

export default function EntraAuthBoundary({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<EntraAuthSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing,setRefreshing]=useState(false);

  useEffect(() => {
    let active=true;
    void entraAuth.initialize().then(value=>{if(active){setSnapshot(value);if(value.buildVersion)sessionStorage.setItem("develocrm.build-version",value.buildVersion);}}).catch((reason) => {
      if(active)setError(reason instanceof Error ? reason.message : "Přihlášení se nepodařilo inicializovat");
    });
    return()=>{active=false;};
  }, []);

  useEffect(()=>{
    let hiddenAt=0;
    const revalidate=async()=>{
      if(document.visibilityState!=="visible"||!snapshot?.authenticated)return;
      if(hiddenAt&&Date.now()-hiddenAt<60_000)return;
      setRefreshing(true);setError(null);
      try{
        await entraAuth.refreshAccessToken();
        const response=await fetch("/api/auth/config",{cache:"no-store"});
        const config=await response.json() as {buildVersion?:string};
        const previous=sessionStorage.getItem("develocrm.build-version");
        if(previous&&config.buildVersion&&previous!==config.buildVersion){window.location.reload();return;}
        if(config.buildVersion)sessionStorage.setItem("develocrm.build-version",config.buildVersion);
        window.dispatchEvent(new CustomEvent("develocrm:session-restored"));
      }catch(reason){
        if(reason instanceof Error&&reason.message==="AUTHENTICATION_REDIRECT")return;
        setError("Platnost přihlášení skončila. Přihlaste se prosím znovu.");
        setSnapshot(current=>current?{...current,authenticated:false}:current);
      }finally{setRefreshing(false);hiddenAt=0;}
    };
    const visibility=()=>{if(document.visibilityState==="hidden")hiddenAt=Date.now();else void revalidate();};
    const authenticationRequired=()=>{hiddenAt=1;void revalidate();};
    document.addEventListener("visibilitychange",visibility);window.addEventListener("focus",revalidate);window.addEventListener("develocrm:authentication-required",authenticationRequired);
    return()=>{document.removeEventListener("visibilitychange",visibility);window.removeEventListener("focus",revalidate);window.removeEventListener("develocrm:authentication-required",authenticationRequired);};
  },[snapshot?.authenticated]);

  if (refreshing) return <main className="auth-gate"><section className="auth-card" aria-live="polite"><span className="auth-spinner"/><h1>Obnovuji data…</h1><p>Ověřuji přihlášení a načítám aktuální pracovní prostor.</p></section></main>;
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
