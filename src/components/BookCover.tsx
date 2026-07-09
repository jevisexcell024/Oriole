import { useState } from "react";
import { Play } from "lucide-react";
import { clsx } from "clsx";

const LIME = "oklch(0.86 0.18 112)";
const LIME_TINT = "oklch(0.86 0.18 112 / 0.45)";

// Atmospheric jewel-tone gradients — hash-picked per book so an untitled
// library still reads as visually distinct shelves, same technique as the
// dashboard's hashCard palette.
const PALETTES = [
  { from: "#2a1a3d", to: "#0c0710", spine: "#8b6fd6" },
  { from: "#1a2e2a", to: "#070f0d", spine: "#4fd6a8" },
  { from: "#3d2418", to: "#100905", spine: "#e8935a" },
  { from: "#1a2438", to: "#070a10", spine: "#5b8fd6" },
  { from: "#3d1a28", to: "#10070b", spine: "#d65b8f" },
  { from: "#2e2a1a", to: "#0d0b06", spine: "#c9b34f" },
];
function hashPalette(seed: string) {
  let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTES[h % PALETTES.length];
}
const STOPWORDS = new Set(["a", "an", "the", "of", "and"]);
function monogram(title: string) {
  const words = title.trim().split(/\s+/).filter((w) => w && !STOPWORDS.has(w.toLowerCase()));
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  const single = words[0] ?? title.trim();
  return single.slice(0, 2).toUpperCase() || "?";
}

export function BookCover({
  title, coverImage, progressPercent, variant = "grid", onRead,
}: {
  title: string;
  coverImage?: string | null;
  progressPercent?: number | null;
  variant?: "grid" | "mini";
  onRead?: () => void;
}) {
  const [hover, setHover] = useState(false);
  const pal = hashPalette(title);
  const isGrid = variant === "grid";
  const showProgress = typeof progressPercent === "number" && progressPercent > 0;

  return (
    <div
      onMouseEnter={() => isGrid && setHover(true)}
      onMouseLeave={() => isGrid && setHover(false)}
      className={clsx(
        "relative overflow-hidden transition-transform duration-200",
        isGrid ? "aspect-[3/4] w-full rounded-xl" : "h-16 w-12 shrink-0 rounded-lg",
        isGrid && hover && "scale-[1.03]",
      )}
      style={{
        background: coverImage ? undefined : `radial-gradient(120% 100% at 30% 0%, ${pal.from}, ${pal.to})`,
      }}
    >
      {coverImage ? (
        <img src={coverImage} alt="" className="h-full w-full object-cover" />
      ) : (
        <>
          {/* Left spine highlight */}
          <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: pal.spine, opacity: 0.7 }} />
          {/* Monogram */}
          <div className="flex h-full w-full items-center justify-center">
            <span
              className={clsx("font-semibold text-white/90", isGrid ? "text-3xl" : "text-sm")}
              style={{ fontFamily: "'Playfair Display', serif" }}
            >
              {monogram(title)}
            </span>
          </div>
        </>
      )}

      {isGrid && showProgress && (
        <div className="absolute inset-x-0 bottom-0 h-[2px] bg-white/10">
          <div className="h-full" style={{ width: `${progressPercent}%`, background: LIME }} />
        </div>
      )}

      {isGrid && hover && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/55 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); onRead?.(); }}
            className="flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold text-[#08090a]"
            style={{ background: LIME }}
          >
            <Play className="h-3 w-3 fill-current" /> Read
          </button>
        </div>
      )}
    </div>
  );
}

export { LIME as LIBRARY_LIME, LIME_TINT as LIBRARY_LIME_TINT };
