// Pure exam-calculator core — no React, no I/O. Mirrors shared/geo.ts's role:
// the component only renders buttons and dispatches actions here; every
// number shown is computed locally, nothing ever leaves the browser.

export type CalcOp =
  | "digit" | "decimal" | "exp"
  | "add" | "sub" | "mul" | "div" | "pow" | "pct" | "eq"
  | "clear" | "clearEntry" | "backspace" | "negate"
  | "sin" | "cos" | "tan" | "asin" | "acos" | "atan"
  | "log" | "ln" | "pi" | "e"
  | "square" | "cube" | "sqrt" | "cbrt" | "factorial"
  | "toggleDegRad";

export interface CalcHistoryEntry { expr: string; result: string; }

export interface CalcState {
  display: string;
  accumulator: number | null;
  pendingOp: CalcOp | null;
  overwrite: boolean;
  degrees: boolean;
  history: CalcHistoryEntry[];
}

export const INITIAL_CALC_STATE: CalcState = {
  display: "0", accumulator: null, pendingOp: null, overwrite: false, degrees: true, history: [],
};

const DISPLAY_MAX_LEN = 15;
const HISTORY_MAX = 50;

const OP_SYMBOL: Partial<Record<CalcOp, string>> = { add: "+", sub: "-", mul: "×", div: "÷", pow: "^" };

/** Rounds away floating-point noise and reports non-finite results as "Error"
 *  rather than raw "Infinity"/"NaN" strings. */
function fmt(n: number): string {
  if (!Number.isFinite(n)) return "Error";
  const rounded = Math.round(n * 1e10) / 1e10;
  return String(rounded);
}

function fmtNum(n: number | null): string {
  return n === null ? "" : fmt(n);
}

function currentValue(state: CalcState): number {
  return Number(state.display);
}

function pushHistory(state: CalcState, expr: string, result: string): CalcHistoryEntry[] {
  return [...state.history, { expr, result }].slice(-HISTORY_MAX);
}

function applyBinary(op: CalcOp, a: number, b: number): number {
  switch (op) {
    case "add": return a + b;
    case "sub": return a - b;
    case "mul": return a * b;
    case "div": return b === 0 ? NaN : a / b;
    case "pow": return Math.pow(a, b);
    default: return b;
  }
}

function toRad(v: number, degrees: boolean): number { return degrees ? (v * Math.PI) / 180 : v; }
function fromRad(v: number, degrees: boolean): number { return degrees ? (v * 180) / Math.PI : v; }

function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0) return NaN;
  if (n > 170) return Infinity; // fmt() maps non-finite to "Error"
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

function unary(state: CalcState, fn: (v: number) => number, label: string): CalcState {
  const val = currentValue(state);
  const result = fn(val);
  const resultStr = fmt(result);
  return { ...state, display: resultStr, overwrite: true, history: pushHistory(state, `${label}(${fmtNum(val)})`, resultStr) };
}

export function calculatorReduce(state: CalcState, action: { op: CalcOp; digit?: string }): CalcState {
  const { op, digit } = action;
  switch (op) {
    case "digit": {
      const d = digit ?? "0";
      if (state.overwrite || state.display === "Error") return { ...state, display: d === "0" ? "0" : d, overwrite: false };
      if (state.display === "0") return { ...state, display: d };
      if (state.display.replace(/[-.]/g, "").length >= DISPLAY_MAX_LEN) return state;
      return { ...state, display: state.display + d };
    }
    case "decimal": {
      if (state.overwrite || state.display === "Error") return { ...state, display: "0.", overwrite: false };
      if (state.display.includes(".")) return state;
      return { ...state, display: state.display + "." };
    }
    case "exp": {
      if (state.display.includes("e") || state.display === "Error") return state;
      return { ...state, display: state.display + "e", overwrite: false };
    }
    case "backspace": {
      if (state.overwrite) return state;
      const next = state.display.length > 1 ? state.display.slice(0, -1) : "0";
      return { ...state, display: next === "-" ? "0" : next };
    }
    case "clearEntry":
      return { ...state, display: "0", overwrite: false };
    case "clear":
      return { ...INITIAL_CALC_STATE, degrees: state.degrees, history: state.history };
    case "negate": {
      if (state.display === "0" || state.display === "Error") return state;
      return { ...state, display: state.display.startsWith("-") ? state.display.slice(1) : "-" + state.display };
    }
    case "toggleDegRad":
      return { ...state, degrees: !state.degrees };
    case "pi":
      return { ...state, display: fmt(Math.PI), overwrite: true };
    case "e":
      return { ...state, display: fmt(Math.E), overwrite: true };
    case "add": case "sub": case "mul": case "div": case "pow": {
      const val = currentValue(state);
      if (state.accumulator !== null && state.pendingOp && !state.overwrite) {
        const result = applyBinary(state.pendingOp, state.accumulator, val);
        const resultStr = fmt(result);
        return {
          ...state, display: resultStr, accumulator: Number.isFinite(result) ? result : null,
          pendingOp: op, overwrite: true,
          history: pushHistory(state, `${fmtNum(state.accumulator)} ${OP_SYMBOL[state.pendingOp]} ${fmtNum(val)}`, resultStr),
        };
      }
      return { ...state, accumulator: val, pendingOp: op, overwrite: true };
    }
    case "eq": {
      if (state.pendingOp === null || state.accumulator === null) return state;
      const val = currentValue(state);
      const result = applyBinary(state.pendingOp, state.accumulator, val);
      const resultStr = fmt(result);
      return {
        ...state, display: resultStr, accumulator: null, pendingOp: null, overwrite: true,
        history: pushHistory(state, `${fmtNum(state.accumulator)} ${OP_SYMBOL[state.pendingOp]} ${fmtNum(val)} =`, resultStr),
      };
    }
    case "pct": {
      const val = currentValue(state);
      if (state.accumulator !== null && state.pendingOp) {
        return { ...state, display: fmt(state.accumulator * (val / 100)), overwrite: true };
      }
      return { ...state, display: fmt(val / 100), overwrite: true };
    }
    case "sqrt": return unary(state, (v) => (v < 0 ? NaN : Math.sqrt(v)), "√");
    case "square": return unary(state, (v) => v * v, "sqr");
    case "cube": return unary(state, (v) => v * v * v, "cube");
    case "cbrt": return unary(state, Math.cbrt, "cbrt");
    case "factorial": return unary(state, factorial, "!");
    case "log": return unary(state, (v) => (v <= 0 ? NaN : Math.log10(v)), "log");
    case "ln": return unary(state, (v) => (v <= 0 ? NaN : Math.log(v)), "ln");
    case "sin": return unary(state, (v) => Math.sin(toRad(v, state.degrees)), "sin");
    case "cos": return unary(state, (v) => Math.cos(toRad(v, state.degrees)), "cos");
    case "tan": return unary(state, (v) => Math.tan(toRad(v, state.degrees)), "tan");
    case "asin": return unary(state, (v) => fromRad(Math.asin(v), state.degrees), "asin");
    case "acos": return unary(state, (v) => fromRad(Math.acos(v), state.degrees), "acos");
    case "atan": return unary(state, (v) => fromRad(Math.atan(v), state.degrees), "atan");
    default: return state;
  }
}
