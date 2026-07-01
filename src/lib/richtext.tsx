import { Fragment, type ReactNode } from "react";
import katex from "katex";

/**
 * Renders question prompts and option text: LaTeX math via KaTeX plus the
 * lightweight markdown the Exam Builder toolbar emits (**bold**, *italic*,
 * `code`, <u>underline</u>, ![](image), "- " bullet lines).
 *
 * Math is written as $…$ (inline) or $$…$$ (block). Input is authored by staff,
 * so KaTeX's own HTML output is rendered directly with throwOnError disabled —
 * a malformed expression shows in red rather than crashing the page.
 */
export function MathText({ children, className }: { children?: string | null; className?: string }) {
  const text = children ?? "";
  if (!text) return null;
  const segments = splitMath(text);
  return (
    <span className={className}>
      {segments.map((seg, i) =>
        seg.kind === "math" ? (
          <span key={i} dangerouslySetInnerHTML={{ __html: renderMath(seg.value, seg.display) }} />
        ) : (
          <Fragment key={i}>{renderMarkdown(seg.value)}</Fragment>
        ),
      )}
    </span>
  );
}

function renderMath(tex: string, display: boolean): string {
  try {
    return katex.renderToString(tex, { throwOnError: false, displayMode: display, output: "html" });
  } catch {
    return `<span style="color:#f43f5e">${escapeHtml(tex)}</span>`;
  }
}

interface Seg { kind: "math" | "text"; value: string; display: boolean }

/** Split text into math ($…$ / $$…$$) and plain-text runs. */
function splitMath(text: string): Seg[] {
  const out: Seg[] = [];
  const re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ kind: "text", value: text.slice(last, m.index), display: false });
    if (m[1] !== undefined) out.push({ kind: "math", value: m[1], display: true });
    else out.push({ kind: "math", value: m[2] ?? "", display: false });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ kind: "text", value: text.slice(last), display: false });
  return out;
}

/** Inline markdown → React nodes; newlines become <br/>, "- " lines become bullets. */
function renderMarkdown(text: string): ReactNode {
  const lines = text.split("\n");
  return lines.map((line, li) => {
    const isBullet = /^\s*-\s+/.test(line);
    const content = renderInline(isBullet ? line.replace(/^\s*-\s+/, "") : line);
    return (
      <Fragment key={li}>
        {isBullet ? <span className="ml-3">• {content}</span> : content}
        {li < lines.length - 1 && <br />}
      </Fragment>
    );
  });
}

const INLINE = /(!\[[^\]]*\]\([^)]+\))|(\*\*[^*]+\*\*)|(<u>[\s\S]*?<\/u>)|(`[^`]+`)|(\*[^*]+\*|_[^_]+_)/;

function renderInline(text: string): ReactNode {
  const parts: ReactNode[] = [];
  let rest = text;
  let key = 0;
  while (rest.length) {
    const m = INLINE.exec(rest);
    if (!m) { parts.push(rest); break; }
    if (m.index > 0) parts.push(rest.slice(0, m.index));
    const tok = m[0];
    if (tok.startsWith("![")) {
      const im = /!\[([^\]]*)\]\(([^)]+)\)/.exec(tok);
      if (im) {
        // Only allow safe image sources (https or data:image) — never javascript:,
        // data:text/html, http: (mixed content), etc. Otherwise show the alt text.
        const url = im[2].trim();
        const safe = /^https:\/\//i.test(url) || /^data:image\//i.test(url);
        parts.push(safe
          ? <img key={key++} src={url} alt={im[1]} className="my-1 max-h-60 rounded-md" />
          : <span key={key++} className="text-[var(--muted)]">{im[1] || "[image]"}</span>);
      }
    } else if (tok.startsWith("**")) {
      parts.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("<u>")) {
      parts.push(<u key={key++}>{tok.slice(3, -4)}</u>);
    } else if (tok.startsWith("`")) {
      parts.push(<code key={key++} className="rounded bg-[var(--card-2)] px-1 py-0.5 font-mono text-[0.9em]">{tok.slice(1, -1)}</code>);
    } else {
      parts.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    }
    rest = rest.slice(m.index + tok.length);
  }
  return parts;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] || c));
}
