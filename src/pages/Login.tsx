import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck, Loader2, Mail, Lock, ArrowRight, Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { landingFor } from "@/lib/roles";
import { BrandMark } from "@/components/BrandMark";
import { useT } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/lib/theme";

const PURPLE = "var(--color-brand-500)";

export function Login() {
  const { user, login, verify2fa } = useAuth();
  const t = useT();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [forgot, setForgot] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [twoFA, setTwoFA] = useState(false);
  const [code, setCode] = useState("");

  // Staff (admin/facilitator/proctor) land on the admin dashboard; students on theirs —
  // unless a first-time password setup is still outstanding, which takes priority
  // over everything else (and avoids a flash of the real dashboard before Protected
  // would otherwise bounce them there).
  useEffect(() => {
    if (!user) return;
    navigate(user.mustChangePassword ? "/force-password-change" : landingFor(user.role), { replace: true });
  }, [user, navigate]);

  // Surface any SSO callback error (the Microsoft sign-in button has been removed,
  // but a direct callback hit can still redirect back here with ?sso=…).
  useEffect(() => {
    const sso = new URLSearchParams(window.location.search).get("sso");
    if (sso === "nouser") setError(t("auth.ssoNoUser"));
    else if (sso === "error") setError(t("auth.ssoError"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await login(email.trim(), password);
      if (r.twoFactorRequired) setTwoFA(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed.");
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await verify2fa(code.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid code.");
    } finally {
      setBusy(false);
    }
  };

  // Shared glass-input styling — translucent surface + its own subtle blur,
  // so text fields read as frosted panes floating on the glass card itself.
  const glassInput = "liquid-spring w-full rounded-full border border-[var(--glass-input-border)] bg-[var(--glass-input)] text-[var(--fg)] placeholder:text-[var(--muted)] outline-none backdrop-blur-sm transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30";

  const hero = useHeroSlide();

  // Liquid-glass spotlight follows the pointer — see .liquid-glass in index.css.
  const cardRef = useRef<HTMLDivElement>(null);
  const onCardPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${((e.clientX - r.left) / r.width) * 100}%`);
    e.currentTarget.style.setProperty("--my", `${((e.clientY - r.top) / r.height) * 100}%`);
  }, []);

  return (
    <div className="relative flex h-screen items-center justify-center overflow-hidden px-4 py-6 lg:p-10" style={{ background: "var(--bg)" }}>
      {/* Full-bleed hero backdrop — the glass card blurs whatever's behind it,
         so the carousel spans the whole page instead of a boxed-off half. */}
      <LoginHeroBackdrop {...hero} />

      <div className="relative z-10 grid w-full max-w-6xl grid-cols-1 gap-6 lg:grid-cols-[440px_1fr] lg:items-center">
        {/* Glass card, with a soft brand-colored halo glowing around its edges
           (heaviest bottom-right) — the "lit from within" rim light that
           reads as thick glass rather than a flat translucent panel. */}
        <div className="relative">
          <div className="liquid-glass-halo" aria-hidden="true" />
          <div
            ref={cardRef}
            onPointerMove={onCardPointerMove}
            className="liquid-glass relative z-10 flex flex-col rounded-[32px] border-2 px-8 py-8 shadow-2xl backdrop-blur-2xl backdrop-saturate-[200%] sm:px-10"
            style={{
              background: "var(--glass-surface)",
              borderColor: "var(--glass-border)",
              boxShadow: "inset 0 1px 0 0 var(--glass-highlight), inset 0 0 40px 0 color-mix(in oklch, var(--color-brand-500) 8%, transparent), 0 25px 60px -12px rgba(0,0,0,0.5)",
            }}
          >
          {/* Brand lockup + language/theme */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl p-1.5" style={{ background: "var(--glass-input)", border: "1px solid var(--glass-input-border)" }}>
                <BrandMark className="h-full w-full object-contain" />
              </span>
              <span className="leading-tight">
                <span className="block text-[17px] font-extrabold tracking-tight text-[var(--fg)]">Oriole</span>
                <span className="block text-[10px] font-semibold uppercase tracking-[0.22em] text-brand-400">{t("auth.examPlatform")}</span>
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <ThemeToggle className="!border-[var(--glass-input-border)] !bg-[var(--glass-input)] backdrop-blur-sm" />
              <LanguageSwitcher themed />
            </div>
          </div>

          {/* Sign-in form (vertically centered) */}
          <div className="flex flex-1 flex-col justify-center py-10">
            <div className="mx-auto w-full max-w-sm">
              {twoFA ? (
                <>
                  <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-[var(--fg)]">{t("auth.2faTitle")}</h1>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{t("auth.2faSubtitle")}</p>
                  <form onSubmit={verifyCode} className="mt-8 space-y-4">
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{t("auth.authCode")}</label>
                      <input
                        className={`${glassInput} px-5 py-3 text-center text-lg tracking-[0.4em]`}
                        value={code} onChange={(e) => setCode(e.target.value)}
                        placeholder="123456" inputMode="numeric" autoComplete="one-time-code" autoFocus
                      />
                    </div>
                    {error && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-500">{error}</div>}
                    <button type="submit" disabled={busy} className="liquid-spring flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-bold text-[var(--brand-ink)] shadow-sm transition hover:brightness-95 disabled:opacity-70" style={{ background: PURPLE }}>
                      {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("auth.verifying")}</> : <>{t("auth.verify")} <ArrowRight className="h-4 w-4" /></>}
                    </button>
                    <div className="text-center">
                      <button type="button" onClick={() => { setTwoFA(false); setCode(""); setError(null); }} className="text-sm text-[var(--muted)] underline-offset-2 transition hover:text-[var(--fg)] hover:underline">{t("auth.backToSignIn")}</button>
                    </div>
                  </form>
                </>
              ) : (
                <>
                  <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-[var(--fg)]">{t("auth.welcome")}</h1>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{t("auth.subtitle")}</p>

                  <form onSubmit={submit} className="mt-8 space-y-4">
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{t("auth.email")}</label>
                      <div className="relative">
                        <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
                        <input
                          className={`${glassInput} py-3 pl-11 pr-4 text-sm`}
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="you@institution.edu"
                          autoComplete="username"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{t("auth.password")}</label>
                      <div className="relative">
                        <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
                        <input
                          className={`${glassInput} py-3 pl-11 pr-11 text-sm`}
                          type={showPw ? "text" : "password"}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="••••••••"
                          autoComplete="current-password"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPw((v) => !v)}
                          aria-label={showPw ? "Hide password" : "Show password"}
                          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-[var(--muted)] transition hover:text-[var(--fg)]"
                        >
                          {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>

                    {error && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-500">{error}</div>}
                    {forgot && <div className="rounded-lg border border-[var(--glass-input-border)] bg-[var(--glass-input)] px-3 py-2 text-xs text-[var(--muted)]">Contact your administrator to reset your password.</div>}

                    <button
                      type="submit"
                      disabled={busy}
                      className="liquid-spring flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-bold text-[var(--brand-ink)] shadow-sm transition hover:brightness-95 disabled:opacity-70"
                      style={{ background: PURPLE }}
                    >
                      {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("auth.signingIn")}</> : <>{t("auth.signIn")} <ArrowRight className="h-4 w-4" /></>}
                    </button>
                    <div className="text-center">
                      <button type="button" onClick={() => setForgot(true)} className="text-sm text-[var(--muted)] underline-offset-2 transition hover:text-[var(--fg)] hover:underline">
                        {t("auth.forgot")}
                      </button>
                    </div>
                  </form>
                </>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-center gap-1.5 text-[11px] text-[var(--muted)]">
            <ShieldCheck className="h-3.5 w-3.5 text-brand-400" /> Secured by <span className="font-semibold text-[var(--fg)]">JevisLab</span> · Oriole
          </div>
          </div>
        </div>

        {/* Right — headline overlaid on the shared backdrop (no separate box;
           the hero fills the whole page now, this just anchors the copy). */}
        <div className="relative hidden h-full lg:block" aria-hidden="true">
          <LoginHeroCopy slide={hero.slide} setSlide={hero.setSlide} />
        </div>
      </div>
    </div>
  );
}

type HeroSlide =
  | { type: "image"; src: string; scale?: boolean }
  | { type: "video"; src: string };

// book.png has a thin white card-frame baked into the pixels; the hero panel's
// aspect ratio is taller than the source image, so object-cover only crops the
// sides and leaves that frame visible top/bottom — `scale` zooms past it.
const HERO_SLIDES: HeroSlide[] = [
  { type: "image", src: "/book.png", scale: true },
  { type: "image", src: "/pattern.png" },
  { type: "video", src: "/water.mp4" },
];
const HERO_SLIDE_MS = 5000;

// Carousel state lives here, in Login, and is passed down to both the
// full-bleed backdrop (which the glass card blurs) and the crisp copy
// overlay (dots + headline) — they need to stay in lockstep, and lifting a
// once-every-5-seconds index update costs nothing worth avoiding.
function useHeroSlide() {
  const [slide, setSlide] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const reducedMotion = useMemo(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  const next = () => setSlide((s) => (s + 1) % HERO_SLIDES.length);

  useEffect(() => {
    if (reducedMotion || HERO_SLIDES[slide].type === "video") return;
    const id = setTimeout(next, HERO_SLIDE_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slide, reducedMotion]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (HERO_SLIDES[slide].type === "video") {
      v.currentTime = 0;
      if (!reducedMotion) void v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, [slide, reducedMotion]);

  return { slide, setSlide, videoRef, next };
}

function LoginHeroBackdrop({ slide, videoRef, next }: ReturnType<typeof useHeroSlide>) {
  return (
    <div className="absolute inset-0" aria-hidden="true">
      {HERO_SLIDES.map((s, i) => (
        <div key={s.src} className="absolute inset-0 transition-opacity duration-700" style={{ opacity: i === slide ? 1 : 0 }}>
          {s.type === "image" ? (
            <img className={`h-full w-full object-cover ${s.scale ? "scale-125" : ""}`} src={s.src} alt="" />
          ) : (
            <video ref={videoRef} className="h-full w-full object-cover" src={s.src} muted playsInline onEnded={next} />
          )}
        </div>
      ))}
      <div className="absolute inset-0" style={{ background: "var(--glass-scrim)" }} />
    </div>
  );
}

/** Dots + headline, kept crisp (no blur) over the shared backdrop. */
function LoginHeroCopy({ slide, setSlide }: { slide: number; setSlide: (i: number) => void }) {
  const t = useT();

  return (
    <div className="absolute inset-x-0 bottom-8 px-4">
      <div className="mb-4 flex items-center gap-1.5">
        {HERO_SLIDES.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setSlide(i)}
            aria-label={`Go to slide ${i + 1}`}
            aria-current={i === slide}
            className={`h-1.5 rounded-full transition-all ${i === slide ? "w-6 bg-brand-500" : "w-1.5 bg-white/40 hover:bg-white/60"}`}
          />
        ))}
      </div>
      <p className="max-w-sm text-2xl font-extrabold leading-snug tracking-tight text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.5)]">{t("auth.heroHeadline")}</p>
    </div>
  );
}
