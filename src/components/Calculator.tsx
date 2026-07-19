import { useEffect, useRef, useState } from "react";
import { Calculator as CalcIcon, X, Minus, GripHorizontal } from "lucide-react";
import { calculatorReduce, type CalcState, type CalcOp } from "@shared/calculator";
import { sendBeaconJson } from "@/lib/api";
import { clsx } from "clsx";

interface Props {
  attemptId: string;
  type: "basic" | "scientific";
  allowKeyboard: boolean;
  saveHistory: boolean;
  state: CalcState;
  onStateChange: (s: CalcState) => void;
}

const WINDOW_W = 300;
const WINDOW_H_BASIC = 400;
const WINDOW_H_SCI = 560;

/** Floating, draggable in-app exam calculator. Everything is computed locally
 *  via shared/calculator.ts — no external calls, no OS calculator, no
 *  clipboard/context-menu access on the display (never allow copy/paste or notes). */
export function Calculator({ attemptId, type, allowKeyboard, saveHistory, state, onStateChange }: Props) {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const winH = type === "scientific" ? WINDOW_H_SCI : WINDOW_H_BASIC;
  const [pos, setPos] = useState(() => ({
    x: Math.max(8, (typeof window !== "undefined" ? window.innerWidth : 800) - WINDOW_W - 24),
    y: Math.max(8, (typeof window !== "undefined" ? window.innerHeight : 600) - winH - 90),
  }));
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wasOpenRef = useRef(false);
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  const log = (t: "calculator_open" | "calculator_close" | "calculator_minimize", message: string) => {
    sendBeaconJson(`/attempts/${attemptId}/proctor-event`, { type: t, severity: "info", message });
  };

  const openCalc = () => {
    setOpen(true);
    setMinimized(false);
    if (!wasOpenRef.current) { log("calculator_open", "Calculator opened."); wasOpenRef.current = true; }
  };
  const closeCalc = () => {
    setOpen(false);
    if (wasOpenRef.current) { log("calculator_close", "Calculator closed."); wasOpenRef.current = false; }
  };
  const minimizeCalc = () => { setMinimized(true); log("calculator_minimize", "Calculator minimized."); };

  const dispatch = (action: { op: CalcOp; digit?: string }) => onStateChange(calculatorReduce(state, action));

  // ── Drag ──
  const onHeaderPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return; // don't drag when clicking window controls
    dragState.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onHeaderPointerMove = (e: React.PointerEvent) => {
    if (!dragState.current) return;
    const { startX, startY, origX, origY } = dragState.current;
    const maxX = window.innerWidth - WINDOW_W - 4;
    const maxY = window.innerHeight - 40 - 4;
    setPos({
      x: Math.min(Math.max(4, origX + (e.clientX - startX)), Math.max(4, maxX)),
      y: Math.min(Math.max(4, origY + (e.clientY - startY)), Math.max(4, maxY)),
    });
  };
  const onHeaderPointerUp = () => { dragState.current = null; };

  // ── Keyboard input — scoped to the calculator window itself (focused container),
  // never a global document listener, so it can never intercept exam typing. ──
  useEffect(() => {
    if (open && !minimized) containerRef.current?.focus();
  }, [open, minimized]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!allowKeyboard) return;
    e.stopPropagation();
    if (/^[0-9]$/.test(e.key)) { dispatch({ op: "digit", digit: e.key }); return; }
    const map: Record<string, CalcOp> = {
      ".": "decimal", "+": "add", "-": "sub", "*": "mul", "/": "div", "%": "pct",
      "Enter": "eq", "=": "eq", "Backspace": "backspace", "Escape": "clear",
    };
    if (map[e.key]) { e.preventDefault(); dispatch({ op: map[e.key] }); }
  };

  const blockClipboard = (e: React.ClipboardEvent | React.MouseEvent) => e.preventDefault();

  if (!open) {
    return (
      <button
        onClick={openCalc}
        aria-label="Open calculator"
        className="fixed bottom-5 right-5 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-[#c6ff34] text-[#111110] shadow-lg transition-transform hover:scale-105"
      >
        <CalcIcon className="h-5 w-5" />
      </button>
    );
  }

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      style={{ left: pos.x, top: pos.y, width: WINDOW_W, height: minimized ? "auto" : winH }}
      className="fixed z-30 flex flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl outline-none"
    >
      <div
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        className="flex cursor-move items-center justify-between gap-2 bg-[#111110] px-3 py-2 text-white"
      >
        <span className="flex items-center gap-1.5 text-xs font-semibold"><GripHorizontal className="h-3.5 w-3.5 opacity-60" /> Calculator</span>
        <div className="flex items-center gap-1">
          <button onClick={minimizeCalc} aria-label="Minimize calculator" className="rounded p-1 hover:bg-white/10"><Minus className="h-3.5 w-3.5" /></button>
          <button onClick={closeCalc} aria-label="Close calculator" className="rounded p-1 hover:bg-white/10"><X className="h-3.5 w-3.5" /></button>
        </div>
      </div>

      {!minimized && (
        <div className="flex flex-1 flex-col gap-2 p-3">
          <div
            onCopy={blockClipboard} onCut={blockClipboard} onPaste={blockClipboard} onContextMenu={blockClipboard}
            className="select-none rounded-xl bg-[var(--card-2)] px-3 py-3 text-right"
          >
            {state.accumulator !== null && (
              <p className="truncate text-[11px] text-[var(--muted)]">
                {state.accumulator} {state.pendingOp === "add" ? "+" : state.pendingOp === "sub" ? "−" : state.pendingOp === "mul" ? "×" : state.pendingOp === "div" ? "÷" : state.pendingOp === "pow" ? "^" : ""}
              </p>
            )}
            <p className={clsx("truncate font-display text-2xl font-semibold tabular-nums", state.display === "Error" && "text-rose-400")}>{state.display}</p>
          </div>

          {type === "scientific" && (
            <div className="grid grid-cols-4 gap-1.5">
              <Btn label="sin" onClick={() => dispatch({ op: "sin" })} />
              <Btn label="cos" onClick={() => dispatch({ op: "cos" })} />
              <Btn label="tan" onClick={() => dispatch({ op: "tan" })} />
              <Btn label="x²" onClick={() => dispatch({ op: "square" })} />
              <Btn label="asin" onClick={() => dispatch({ op: "asin" })} />
              <Btn label="acos" onClick={() => dispatch({ op: "acos" })} />
              <Btn label="atan" onClick={() => dispatch({ op: "atan" })} />
              <Btn label="x³" onClick={() => dispatch({ op: "cube" })} />
              <Btn label="log" onClick={() => dispatch({ op: "log" })} />
              <Btn label="ln" onClick={() => dispatch({ op: "ln" })} />
              <Btn label="xʸ" onClick={() => dispatch({ op: "pow" })} />
              <Btn label="³√" onClick={() => dispatch({ op: "cbrt" })} />
              <Btn label="π" onClick={() => dispatch({ op: "pi" })} />
              <Btn label="e" onClick={() => dispatch({ op: "e" })} />
              <Btn label="EXP" onClick={() => dispatch({ op: "exp" })} />
              <Btn label="n!" onClick={() => dispatch({ op: "factorial" })} />
              <Btn label={state.degrees ? "DEG" : "RAD"} onClick={() => dispatch({ op: "toggleDegRad" })} className="col-span-4 !bg-[var(--card-2)] text-[11px]" />
            </div>
          )}

          <div className="grid grid-cols-4 gap-1.5">
            <Btn label="C" onClick={() => dispatch({ op: "clear" })} variant="fn" />
            <Btn label="CE" onClick={() => dispatch({ op: "clearEntry" })} variant="fn" />
            <Btn label="⌫" onClick={() => dispatch({ op: "backspace" })} variant="fn" />
            <Btn label="÷" onClick={() => dispatch({ op: "div" })} variant="op" />
            <Btn label="7" onClick={() => dispatch({ op: "digit", digit: "7" })} />
            <Btn label="8" onClick={() => dispatch({ op: "digit", digit: "8" })} />
            <Btn label="9" onClick={() => dispatch({ op: "digit", digit: "9" })} />
            <Btn label="×" onClick={() => dispatch({ op: "mul" })} variant="op" />
            <Btn label="4" onClick={() => dispatch({ op: "digit", digit: "4" })} />
            <Btn label="5" onClick={() => dispatch({ op: "digit", digit: "5" })} />
            <Btn label="6" onClick={() => dispatch({ op: "digit", digit: "6" })} />
            <Btn label="−" onClick={() => dispatch({ op: "sub" })} variant="op" />
            <Btn label="1" onClick={() => dispatch({ op: "digit", digit: "1" })} />
            <Btn label="2" onClick={() => dispatch({ op: "digit", digit: "2" })} />
            <Btn label="3" onClick={() => dispatch({ op: "digit", digit: "3" })} />
            <Btn label="+" onClick={() => dispatch({ op: "add" })} variant="op" />
            <Btn label="√" onClick={() => dispatch({ op: "sqrt" })} variant="fn" />
            <Btn label="%" onClick={() => dispatch({ op: "pct" })} variant="fn" />
            <Btn label="±" onClick={() => dispatch({ op: "negate" })} variant="fn" />
            <Btn label="." onClick={() => dispatch({ op: "decimal" })} />
            <Btn label="0" onClick={() => dispatch({ op: "digit", digit: "0" })} className="col-span-3" />
            <Btn label="=" onClick={() => dispatch({ op: "eq" })} variant="eq" />
          </div>

          {saveHistory && state.history.length > 0 && (
            <div className="max-h-20 overflow-y-auto rounded-lg border border-[var(--border)] p-1.5 text-[11px] text-[var(--muted)]">
              {state.history.slice(-8).reverse().map((h, i) => (
                <p key={i} className="truncate">{h.expr} <span className="text-[var(--fg)]">{h.result}</span></p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Btn({ label, onClick, variant, className }: { label: string; onClick: () => void; variant?: "op" | "fn" | "eq"; className?: string }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "h-10 rounded-lg text-sm font-medium transition-colors",
        variant === "eq" ? "bg-[#c6ff34] text-[#111110] hover:brightness-95"
          : variant === "op" ? "bg-[var(--card-2)] text-[#c6ff34] hover:bg-[var(--border)]"
          : variant === "fn" ? "bg-[var(--card-2)] text-[var(--muted)] hover:bg-[var(--border)]"
          : "bg-transparent border border-[var(--border)] hover:bg-[var(--card-2)]",
        className,
      )}
    >
      {label}
    </button>
  );
}

