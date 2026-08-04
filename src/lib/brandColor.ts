// Applies a tenant's chosen accent color to the Admin console at runtime by
// overriding the same CSS custom properties index.css's @theme block already
// defines (--color-brand-50/100/400/500/600/700) — every existing `brand-*`
// Tailwind class picks this up automatically, no per-component change needed.
// Converts hex -> OKLCH (Björn Ottosson's OKLab, the same color space the
// app's own tokens are already authored in) so the generated ramp keeps the
// chosen hue/chroma and only varies lightness per step, matching how the
// default lime ramp itself was built.

const RAMP_LIGHTNESS: Record<string, number> = { "50": 0.45, "100": 0.55, "400": 0.89, "500": 0.86, "600": 0.80, "700": 0.89 };

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function hexToOklch(hex: string): { l: number; c: number; h: number } {
  const r = srgbToLinear(parseInt(hex.slice(1, 3), 16) / 255);
  const g = srgbToLinear(parseInt(hex.slice(3, 5), 16) / 255);
  const b = srgbToLinear(parseInt(hex.slice(5, 7), 16) / 255);
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
  const bLab = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;
  const c = Math.sqrt(a * a + bLab * bLab);
  let h = (Math.atan2(bLab, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h };
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Call once per effective brand color (e.g. when AuthProvider resolves the
 *  current tenant's color). Applying `null`/an invalid hex restores the
 *  built-in lime default by simply removing the overrides. */
export function applyBrandColor(hex: string | null | undefined): void {
  const root = document.documentElement.style;
  if (!hex || !HEX_RE.test(hex)) {
    for (const step of Object.keys(RAMP_LIGHTNESS)) root.removeProperty(`--color-brand-${step}`);
    root.removeProperty("--brand-ink");
    return;
  }
  const { c, h } = hexToOklch(hex);
  for (const [step, l] of Object.entries(RAMP_LIGHTNESS)) {
    root.setProperty(`--color-brand-${step}`, `oklch(${l} ${c} ${h})`);
  }
  // Text/icons sitting ON a brand-500-filled button need to flip to white if
  // the chosen color is dark — a fixed "always near-black ink" assumption
  // (fine for the default lime) would go unreadable on a dark brand color.
  const baseL = hexToOklch(hex).l;
  root.setProperty("--brand-ink", baseL > 0.6 ? "#111110" : "#ffffff");
}
