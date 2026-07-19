import { describe, it, expect } from "vitest";
import { calculatorReduce, INITIAL_CALC_STATE, type CalcState } from "../shared/calculator.ts";

function press(state: CalcState, ...ops: { op: Parameters<typeof calculatorReduce>[1]["op"]; digit?: string }[]): CalcState {
  return ops.reduce((s, a) => calculatorReduce(s, a), state);
}
function digits(state: CalcState, s: string): CalcState {
  return [...s].reduce((st, ch) => calculatorReduce(st, ch === "." ? { op: "decimal" } : { op: "digit", digit: ch }), state);
}

describe("digit entry", () => {
  it("builds a multi-digit number", () => {
    const s = digits(INITIAL_CALC_STATE, "50");
    expect(s.display).toBe("50");
  });

  it("handles a decimal point", () => {
    const s = digits(INITIAL_CALC_STATE, "1.5");
    expect(s.display).toBe("1.5");
  });

  it("ignores a second decimal point", () => {
    const s = digits(INITIAL_CALC_STATE, "1.5.2");
    expect(s.display).toBe("1.52");
  });

  it("backspace removes the last digit, then bottoms out at 0", () => {
    let s = digits(INITIAL_CALC_STATE, "123");
    s = press(s, { op: "backspace" });
    expect(s.display).toBe("12");
    s = press(s, { op: "backspace" }, { op: "backspace" });
    expect(s.display).toBe("0");
  });

  it("negate toggles the sign", () => {
    let s = digits(INITIAL_CALC_STATE, "5");
    s = press(s, { op: "negate" });
    expect(s.display).toBe("-5");
    s = press(s, { op: "negate" });
    expect(s.display).toBe("5");
  });
});

describe("basic arithmetic", () => {
  it("adds two numbers", () => {
    const s = press(digits(INITIAL_CALC_STATE, "2"), { op: "add" });
    const s2 = digits(s, "3");
    const s3 = press(s2, { op: "eq" });
    expect(s3.display).toBe("5");
  });

  it("chains operations left-to-right without pressing eq in between", () => {
    let s = digits(INITIAL_CALC_STATE, "2");
    s = press(s, { op: "add" });
    s = digits(s, "3");
    s = press(s, { op: "add" }); // applies the pending 2+3=5, then queues +
    expect(s.display).toBe("5");
    s = digits(s, "4");
    s = press(s, { op: "eq" });
    expect(s.display).toBe("9");
  });

  it("divides", () => {
    let s = digits(INITIAL_CALC_STATE, "10");
    s = press(s, { op: "div" });
    s = digits(s, "4");
    s = press(s, { op: "eq" });
    expect(s.display).toBe("2.5");
  });

  it("division by zero reports Error, not Infinity/NaN", () => {
    let s = digits(INITIAL_CALC_STATE, "5");
    s = press(s, { op: "div" });
    s = digits(s, "0");
    s = press(s, { op: "eq" });
    expect(s.display).toBe("Error");
  });

  it("typing a digit after an Error starts a fresh number", () => {
    let s = digits(INITIAL_CALC_STATE, "5");
    s = press(s, { op: "div" });
    s = digits(s, "0");
    s = press(s, { op: "eq" });
    expect(s.display).toBe("Error");
    s = digits(s, "7");
    expect(s.display).toBe("7");
  });

  it("percent applies against the pending accumulator (200 + 10% = 220)", () => {
    let s = digits(INITIAL_CALC_STATE, "200");
    s = press(s, { op: "add" });
    s = digits(s, "10");
    s = press(s, { op: "pct" });
    expect(s.display).toBe("20");
    s = press(s, { op: "eq" });
    expect(s.display).toBe("220");
  });

  it("percent with no pending op just divides by 100", () => {
    const s = press(digits(INITIAL_CALC_STATE, "50"), { op: "pct" });
    expect(s.display).toBe("0.5");
  });
});

describe("clear / clear-entry", () => {
  it("clearEntry resets only the display, keeping the pending operation", () => {
    let s = digits(INITIAL_CALC_STATE, "2");
    s = press(s, { op: "add" });
    s = digits(s, "99");
    s = press(s, { op: "clearEntry" });
    expect(s.display).toBe("0");
    s = digits(s, "3");
    s = press(s, { op: "eq" });
    expect(s.display).toBe("5");
  });

  it("clear (AC) resets the whole calculation but keeps history", () => {
    let s = digits(INITIAL_CALC_STATE, "2");
    s = press(s, { op: "add" });
    s = digits(s, "3");
    s = press(s, { op: "eq" });
    expect(s.history.length).toBe(1);
    s = press(s, { op: "clear" });
    expect(s.display).toBe("0");
    expect(s.accumulator).toBeNull();
    expect(s.pendingOp).toBeNull();
    expect(s.history.length).toBe(1);
  });
});

describe("scientific operations", () => {
  it("square roots a positive number", () => {
    const s = press(digits(INITIAL_CALC_STATE, "9"), { op: "sqrt" });
    expect(s.display).toBe("3");
  });

  it("square root of a negative number is an Error", () => {
    let s = digits(INITIAL_CALC_STATE, "4");
    s = press(s, { op: "negate" }, { op: "sqrt" });
    expect(s.display).toBe("Error");
  });

  it("squares and cubes", () => {
    expect(press(digits(INITIAL_CALC_STATE, "5"), { op: "square" }).display).toBe("25");
    expect(press(digits(INITIAL_CALC_STATE, "3"), { op: "cube" }).display).toBe("27");
  });

  it("factorial of a non-negative integer", () => {
    const s = press(digits(INITIAL_CALC_STATE, "5"), { op: "factorial" });
    expect(s.display).toBe("120");
  });

  it("factorial of a non-integer is an Error", () => {
    const s = press(digits(INITIAL_CALC_STATE, "3.5"), { op: "factorial" });
    expect(s.display).toBe("Error");
  });

  it("sin(90°) is 1 in degree mode (the default)", () => {
    const s = press(digits(INITIAL_CALC_STATE, "90"), { op: "sin" });
    expect(s.display).toBe("1");
  });

  it("toggleDegRad flips the mode, changing trig results", () => {
    const degState = press(digits(INITIAL_CALC_STATE, "90"), { op: "sin" });
    expect(degState.display).toBe("1");
    const radMode = press(INITIAL_CALC_STATE, { op: "toggleDegRad" });
    expect(radMode.degrees).toBe(false);
    const radResult = press(digits(radMode, "90"), { op: "sin" });
    expect(radResult.display).not.toBe("1"); // 90 radians, not 90 degrees
  });

  it("log and ln reject non-positive input", () => {
    expect(press(digits(INITIAL_CALC_STATE, "100"), { op: "log" }).display).toBe("2");
    expect(press(digits(INITIAL_CALC_STATE, "0"), { op: "ln" }).display).toBe("Error");
  });

  it("pi and e insert constants", () => {
    expect(press(INITIAL_CALC_STATE, { op: "pi" }).display).toBe("3.1415926536");
    expect(press(INITIAL_CALC_STATE, { op: "e" }).display).toBe("2.7182818285");
  });
});

describe("history", () => {
  it("records an entry per completed operation", () => {
    let s = digits(INITIAL_CALC_STATE, "2");
    s = press(s, { op: "add" });
    s = digits(s, "3");
    s = press(s, { op: "eq" });
    expect(s.history).toHaveLength(1);
    expect(s.history[0]).toEqual({ expr: "2 + 3 =", result: "5" });
  });

  it("caps history length so it can't grow unbounded across a long session", () => {
    let s = INITIAL_CALC_STATE;
    for (let i = 0; i < 60; i++) {
      s = digits(s, String(i));
      s = press(s, { op: "sqrt" });
      s = press(s, { op: "clearEntry" });
    }
    expect(s.history.length).toBeLessThanOrEqual(50);
  });
});
