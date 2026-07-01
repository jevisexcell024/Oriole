import { useState } from "react";

/**
 * The official Oriole logo mark — a lime square with a black "o" ring, served
 * from /oriole-icon.svg. Falls back to an inline copy of the same mark if the
 * file can't load, so the brand shows everywhere with no broken image.
 */
export function BrandMark({ className }: { className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <OrioleMark className={className} />;
  return (
    <img
      src="/oriole-icon.svg"
      alt="Oriole"
      className={className}
      onError={() => setFailed(true)}
    />
  );
}

/** Inline copy of the official Oriole mark — lime square with a black "o" ring. */
export function OrioleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} xmlns="http://www.w3.org/2000/svg" aria-label="Oriole">
      <rect width="64" height="64" fill="#c6ff34" />
      <circle cx="32" cy="33" r="15" fill="none" stroke="#111110" strokeWidth="9" />
    </svg>
  );
}
