import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/lib/auth";

// Auto sign-out after a moderate period of inactivity, with a short warning first.
const IDLE_MS = 10 * 60 * 1000; // 10 minutes — moderate
const WARN_MS = 60 * 1000;      // warn 60s before signing out
const KEY = "orcalis-last-activity";

// Don't auto-logout while a candidate is actively sitting an exam or checking in.
function isExempt(pathname: string) {
  return /\/attempts\/[^/]+\/session$/.test(pathname) || /\/checkin$/.test(pathname);
}

export function IdleLogout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const loc = useLocation();
  const [remaining, setRemaining] = useState<number | null>(null); // seconds left during the warning
  const loggingOut = useRef(false);

  const bump = useCallback(() => {
    try { localStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ }
  }, []);

  // Track activity across tabs (throttled to at most once per second).
  useEffect(() => {
    if (!user) return;
    bump();
    let last = 0;
    const onActivity = () => {
      const now = Date.now();
      if (now - last < 1000) return;
      last = now;
      bump();
    };
    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click", "wheel"];
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, onActivity));
  }, [user, bump]);

  const signOut = useCallback(async () => {
    if (loggingOut.current) return;
    loggingOut.current = true;
    setRemaining(null);
    try { await logout(); } catch { /* ignore */ }
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    navigate("/login", { replace: true });
    loggingOut.current = false;
  }, [logout, navigate]);

  // Evaluate idle time once per second.
  useEffect(() => {
    if (!user) { setRemaining(null); return; }
    const tick = () => {
      if (loggingOut.current) return;
      if (isExempt(loc.pathname)) { bump(); setRemaining(null); return; } // keep alive during exams
      let lastAt = Number(localStorage.getItem(KEY) || 0);
      if (!lastAt) { lastAt = Date.now(); bump(); }
      const idle = Date.now() - lastAt;
      if (idle >= IDLE_MS) void signOut();
      else if (idle >= IDLE_MS - WARN_MS) setRemaining(Math.max(1, Math.ceil((IDLE_MS - idle) / 1000)));
      else setRemaining(null);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [user, loc.pathname, bump, signOut]);

  const stay = () => { bump(); setRemaining(null); };

  if (!user || remaining == null) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-[var(--card)] p-6 shadow-xl">
        <div className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-full" style={{ background: "rgba(198,255,52,0.16)", color: "#c6ff34" }}><ShieldAlert className="h-5 w-5" /></span>
          <h2 className="text-lg font-bold">Still there?</h2>
        </div>
        <p className="mt-3 text-sm text-[var(--muted)]">
          You've been inactive for a while. For your security you'll be signed out in{" "}
          <span className="font-bold text-[var(--fg)]">{remaining}s</span>.
        </p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button onClick={signOut} className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--fg)]">Log out now</button>
          <button onClick={stay} className="btn btn-primary h-10 px-5">Stay signed in</button>
        </div>
      </div>
    </div>
  );
}
