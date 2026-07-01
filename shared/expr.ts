/**
 * Safe arithmetic expression evaluator for parameterized questions — NO eval().
 * Tokenizes → shunting-yard to RPN → evaluates. Supports + - * / % ^, parentheses,
 * unary minus, variables, common functions (sqrt, abs, round, floor, ceil, ln, log,
 * exp, sin, cos, tan, min, max, pow) and constants (pi, e). Admin-authored formulas
 * are evaluated server-side at grading and client-side for the builder preview.
 */

const FUNCS: Record<string, (...a: number[]) => number> = {
  sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
  ln: Math.log, log: (x) => Math.log10(x), log10: Math.log10, exp: Math.exp,
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  min: Math.min, max: Math.max, pow: Math.pow,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };
const PREC: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2, "^": 3 };
const RIGHT = new Set(["^"]);

type Tok = { k: "num"; v: number } | { k: "name"; v: string } | { k: "op"; v: string } | { k: "("; } | { k: ")" } | { k: "," };

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const s = src.replace(/\s+/g, "");
  while (i < s.length) {
    const c = s[i];
    if (/[0-9.]/.test(c)) {
      let j = i + 1;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      toks.push({ k: "num", v: Number(s.slice(i, j)) });
      i = j;
    } else if (/[a-zA-Z_]/.test(c)) {
      let j = i + 1;
      while (j < s.length && /[a-zA-Z0-9_]/.test(s[j])) j++;
      toks.push({ k: "name", v: s.slice(i, j) });
      i = j;
    } else if ("+-*/%^".includes(c)) {
      toks.push({ k: "op", v: c });
      i++;
    } else if (c === "(") { toks.push({ k: "(" }); i++; }
    else if (c === ")") { toks.push({ k: ")" }); i++; }
    else if (c === ",") { toks.push({ k: "," }); i++; }
    else throw new Error(`Unexpected character "${c}"`);
  }
  return toks;
}

/** Evaluate `formula` with the given variable bindings. Throws on a malformed formula. */
export function evalExpr(formula: string, vars: Record<string, number> = {}): number {
  const toks = tokenize(formula);
  // Shunting-yard → RPN, tracking unary minus as "u-".
  const out: Tok[] = [];
  const ops: (Tok & { unary?: boolean })[] = [];
  let prevType: "start" | "num" | "op" | "(" | "," | ")" = "start";
  for (let idx = 0; idx < toks.length; idx++) {
    const t = toks[idx];
    if (t.k === "num") { out.push(t); prevType = "num"; }
    else if (t.k === "name") {
      const next = toks[idx + 1];
      if (next && next.k === "(") ops.push(t); // function call
      else out.push(t); // variable/const
      prevType = "num";
    } else if (t.k === ",") {
      while (ops.length && ops[ops.length - 1].k !== "(") out.push(ops.pop()!);
      prevType = ",";
    } else if (t.k === "op") {
      const unary = (prevType === "start" || prevType === "op" || prevType === "(" || prevType === ",") && (t.v === "-" || t.v === "+");
      if (unary) {
        ops.push({ k: "op", v: t.v === "-" ? "u-" : "u+", unary: true });
      } else {
        while (ops.length) {
          const top = ops[ops.length - 1];
          if (top.k === "op" && (top.unary || (PREC[top.v] > PREC[t.v] || (PREC[top.v] === PREC[t.v] && !RIGHT.has(t.v))))) out.push(ops.pop()!);
          else break;
        }
        ops.push({ k: "op", v: t.v });
      }
      prevType = "op";
    } else if (t.k === "(") { ops.push(t); prevType = "("; }
    else if (t.k === ")") {
      while (ops.length && ops[ops.length - 1].k !== "(") out.push(ops.pop()!);
      if (!ops.length) throw new Error("Mismatched parentheses");
      ops.pop(); // discard "("
      if (ops.length && ops[ops.length - 1].k === "name") out.push(ops.pop()!); // function
      prevType = ")";
    }
  }
  while (ops.length) {
    const top = ops.pop()!;
    if (top.k === "(" || top.k === ")") throw new Error("Mismatched parentheses");
    out.push(top);
  }

  // Evaluate RPN.
  const st: number[] = [];
  for (const t of out) {
    if (t.k === "num") st.push(t.v);
    else if (t.k === "name") {
      if (t.v in vars) st.push(vars[t.v]);
      else if (t.v.toLowerCase() in CONSTS) st.push(CONSTS[t.v.toLowerCase()]);
      else if (t.v.toLowerCase() in FUNCS) {
        // A function with a single argument (multi-arg handled by commas pushing values).
        const fn = FUNCS[t.v.toLowerCase()];
        const arity = fn.length || 1;
        const args: number[] = [];
        for (let a = 0; a < arity; a++) args.unshift(st.pop() ?? 0);
        st.push(fn(...args));
      } else throw new Error(`Unknown name "${t.v}"`);
    } else if (t.k === "op") {
      if (t.v === "u-") { st.push(-(st.pop() ?? 0)); continue; }
      if (t.v === "u+") { continue; }
      const b = st.pop() ?? 0, a = st.pop() ?? 0;
      switch (t.v) {
        case "+": st.push(a + b); break;
        case "-": st.push(a - b); break;
        case "*": st.push(a * b); break;
        case "/": st.push(a / b); break;
        case "%": st.push(a % b); break;
        case "^": st.push(Math.pow(a, b)); break;
        default: throw new Error(`Unknown operator "${t.v}"`);
      }
    }
  }
  if (st.length !== 1 || !Number.isFinite(st[0])) throw new Error("Invalid expression");
  return st[0];
}

/** Like evalExpr but returns null instead of throwing — handy for previews. */
export function tryEvalExpr(formula: string, vars: Record<string, number> = {}): number | null {
  try { return evalExpr(formula, vars); } catch { return null; }
}
