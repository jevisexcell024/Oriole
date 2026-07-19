/** Up to 2 uppercase initials from a full name, e.g. "Ama Mensah" -> "AM". */
export function initials(name: string): string {
  return name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}

/** Coarse relative-time string ("3m ago", "Yesterday", "5d ago"). Plain English,
 *  not i18n-keyed — matches the two admin-only call sites this was extracted from. */
export function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24); if (d === 1) return "Yesterday";
  return `${d}d ago`;
}
