import { useEffect, useRef } from "react";
import { BrandMark } from "@/components/BrandMark";
import { useT } from "@/lib/i18n";
import { api } from "@/lib/api";

const POLL_MS = 15_000;

/**
 * Full-screen takeover shown app-wide whenever a request comes back with
 * `{ maintenance: true }` (server/index.ts's platform-wide 503 gate) — see
 * src/lib/maintenance.ts for how that reaches here, and main.tsx for where
 * this replaces the normal route tree (Super Admin and /status are exempt,
 * both server-side and in that same swap).
 *
 * Polls a real tenant-scoped endpoint every 15s; the first one that succeeds
 * (i.e. maintenance has been turned off) clears the global flag via
 * api.ts's own success path, and main.tsx swaps back to the real app.
 */
export function MaintenancePage({ message }: { message: string }) {
  const t = useT();
  const reducedMotion = useRef(window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  useEffect(() => {
    const id = setInterval(() => { api.get("/auth/me").catch(() => {}); }, POLL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0E0E0D] px-6 text-center">
      {!reducedMotion.current && (
        <video
          className="absolute inset-0 h-full w-full object-cover opacity-40"
          src="/Mechanism.mp4"
          autoPlay
          loop
          muted
          playsInline
          aria-hidden="true"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-[#0E0E0D]/70 via-[#0E0E0D]/60 to-[#0E0E0D]" aria-hidden="true" />

      <div className="relative z-10 flex max-w-md flex-col items-center">
        <BrandMark className="h-14 w-14 rounded-2xl shadow-lg" />
        <p className="mt-4 text-lg font-bold tracking-tight text-white">Oriole</p>

        <h1 className="mt-8 text-2xl font-bold text-white">{t("maint.title")}</h1>
        <p className="mt-2 text-sm text-white/60">{t("maint.subtitle")}</p>

        <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-sm text-white/85">
          {message}
        </div>

        <div className="mt-8 flex items-center gap-2 text-xs text-white/40">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500" />
          {t("maint.checking")}
        </div>
      </div>
    </div>
  );
}
