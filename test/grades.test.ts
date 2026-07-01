import { describe, it, expect } from "vitest";
import { applyCurve, letterFor, cleanBands, DEFAULT_GRADE_BANDS } from "../shared/grades.ts";

describe("applyCurve", () => {
  it("no curve returns the rounded raw score", () => {
    expect(applyCurve(72.4)).toBe(72);
    expect(applyCurve(72, { mode: "none", value: 5 })).toBe(72);
  });
  it("adds points, capped at 100 and floored at 0", () => {
    expect(applyCurve(70, { mode: "add", value: 10 })).toBe(80);
    expect(applyCurve(95, { mode: "add", value: 10 })).toBe(100); // cap
    expect(applyCurve(5, { mode: "add", value: -20 })).toBe(0);    // floor
  });
  it("multiplies, capped at 100", () => {
    expect(applyCurve(40, { mode: "multiply", value: 1.5 })).toBe(60);
    expect(applyCurve(80, { mode: "multiply", value: 1.5 })).toBe(100); // cap
  });
});

describe("letterFor", () => {
  it("returns null with no bands", () => {
    expect(letterFor(85, [])).toBeNull();
    expect(letterFor(85, null)).toBeNull();
  });
  it("maps to the highest band whose min is met", () => {
    expect(letterFor(85, DEFAULT_GRADE_BANDS)).toBe("A");
    expect(letterFor(80, DEFAULT_GRADE_BANDS)).toBe("A"); // inclusive
    expect(letterFor(79, DEFAULT_GRADE_BANDS)).toBe("B");
    expect(letterFor(55, DEFAULT_GRADE_BANDS)).toBe("D");
    expect(letterFor(0, DEFAULT_GRADE_BANDS)).toBe("F");
  });
  it("is order-independent (sorts by min)", () => {
    const bands = [{ label: "C", min: 60 }, { label: "A", min: 80 }, { label: "B", min: 70 }];
    expect(letterFor(75, bands)).toBe("B");
  });
});

describe("cleanBands", () => {
  it("clamps mins, trims labels and drops blanks", () => {
    expect(cleanBands([{ label: " A ", min: 150 }, { label: "", min: 50 }, { label: "B", min: -5 }]))
      .toEqual([{ label: "A", min: 100 }, { label: "B", min: 0 }]);
    expect(cleanBands("nope")).toEqual([]);
  });
});
