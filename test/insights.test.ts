import { describe, it, expect } from "vitest";
import { buildInsights, type Resp, type Item, type AttemptRow } from "../src/pages/AdminItemAnalysis.tsx";
import type { TFn } from "../src/lib/i18n.tsx";

// A deliberately dumb "translator" — this test is pinning buildInsights'
// selection logic (which sentence fires, with which numbers), not the actual
// English/French/etc. copy, so it just echoes the key and its variables.
const t: TFn = (key, vars) => `${key}${vars ? `(${JSON.stringify(vars)})` : ""}`;

function item(overrides: Partial<Item>): Item {
  return {
    id: "q_" + Math.random().toString(36).slice(2), prompt: "Q", type: "mcq", points: 1, sectionId: null,
    answered: 0, correct: 0, correctRate: null, avgPoints: null, difficulty: null, discrimination: null,
    distractors: null, tags: [], ...overrides,
  };
}
function resp(overrides: Partial<Resp>): Resp {
  return { exam: { id: "ex1", title: "Exam", code: "EX1" }, attempts: 0, items: [], alpha: null, topics: [], ...overrides };
}
function attempt(passed: boolean): AttemptRow {
  return { id: "a_" + Math.random().toString(36).slice(2), candidateName: "S", candidateEmail: "s@x.com", examId: "ex1", score: passed ? 80 : 20, passed, submittedAt: null, flagCount: 0, integrity: 100, gradingStatus: "auto_graded" };
}

describe("buildInsights (AdminItemAnalysis) — deterministic executive insights", () => {
  it("produces nothing when there's no data at all — never fabricates a sentence", () => {
    expect(buildInsights(resp({}), null, t)).toEqual([]);
    expect(buildInsights(resp({}), [], t)).toEqual([]);
  });

  it("reports the real pass rate from attempts, rounded", () => {
    const attempts = [attempt(true), attempt(true), attempt(true), attempt(false)];
    const insights = buildInsights(resp({}), attempts, t);
    expect(insights[0]).toBe('aitem.insightPassRate({"pct":75})');
  });

  it("identifies the question with the lowest correct rate by its 1-based position, not its id", () => {
    const items = [item({ correctRate: 90 }), item({ correctRate: 30 }), item({ correctRate: 60 })];
    const insights = buildInsights(resp({ items }), null, t);
    expect(insights).toContain('aitem.insightWeakestQuestion({"n":2,"pct":30})');
  });

  it("skips the weakest-question insight entirely when no question has been answered", () => {
    const items = [item({}), item({})]; // correctRate stays null for both
    const insights = buildInsights(resp({ items }), null, t);
    expect(insights.some((i) => i.startsWith("aitem.insightWeakestQuestion"))).toBe(false);
  });

  it("identifies the weakest topic only when 2+ topics have real data (one topic alone isn't a comparison)", () => {
    const oneTopicInsights = buildInsights(resp({ topics: [{ topic: "SQL", items: 1, answered: 5, correctRate: 40 }] }), null, t);
    expect(oneTopicInsights.some((i) => i.startsWith("aitem.insightWeakestTopic"))).toBe(false);

    const twoTopics = buildInsights(resp({ topics: [
      { topic: "HTML", items: 1, answered: 5, correctRate: 92 },
      { topic: "JavaScript", items: 1, answered: 5, correctRate: 57 },
    ] }), null, t);
    expect(twoTopics).toContain('aitem.insightWeakestTopic({"topic":"JavaScript","pct":57})');
  });

  it("reports reliability only when alpha has actually been computed", () => {
    expect(buildInsights(resp({ alpha: null }), null, t).some((i) => i.startsWith("aitem.insightReliability"))).toBe(false);
    const insights = buildInsights(resp({ alpha: 0.85 }), null, t);
    expect(insights.some((i) => i.startsWith("aitem.insightReliability"))).toBe(true);
  });

  it("combines every applicable insight in a stable order: pass rate, weakest question, weakest topic, reliability", () => {
    const items = [item({ correctRate: 90 }), item({ correctRate: 20 })];
    const topics = [{ topic: "A", items: 1, answered: 4, correctRate: 90 }, { topic: "B", items: 1, answered: 4, correctRate: 30 }];
    const insights = buildInsights(resp({ items, topics, alpha: 0.72 }), [attempt(true), attempt(false)], t);
    expect(insights).toHaveLength(4);
    expect(insights[0]).toContain("insightPassRate");
    expect(insights[1]).toContain("insightWeakestQuestion");
    expect(insights[2]).toContain("insightWeakestTopic");
    expect(insights[3]).toContain("insightReliability");
  });
});
