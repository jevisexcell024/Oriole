// AI-assisted question difficulty estimator. Supports two backends, selected by
// environment variables — no code change needed to switch providers:
//
//   1. Any OpenAI-compatible API (Groq, Google Gemini, OpenRouter, OpenAI, ...).
//      Set AI_BASE_URL + AI_API_KEY (+ optional AI_MODEL). Great for free tiers.
//   2. Anthropic / Claude via the official SDK. Set ANTHROPIC_API_KEY
//      (+ optional ORCALIS_AI_MODEL).
//
// If both are configured the OpenAI-compatible backend wins (it's the explicit
// opt-in). Everything is loaded lazily so the server boots fine with neither set.
import type { Question } from "../shared/types.ts";

const OPENAI_BASE = process.env.AI_BASE_URL?.replace(/\/+$/, "");
const OPENAI_KEY = process.env.AI_API_KEY;
const OPENAI_MODEL = process.env.AI_MODEL || "llama-3.3-70b-versatile";

const ANTHROPIC_MODEL = process.env.ORCALIS_AI_MODEL || "claude-opus-4-8";

export interface DifficultyAssessment {
  difficulty: "easy" | "medium" | "hard";
  confidence: number; // 0..1
  rationale: string;
  model: string;
}

function openaiConfigured(): boolean { return !!(OPENAI_BASE && OPENAI_KEY); }
function anthropicConfigured(): boolean { return !!process.env.ANTHROPIC_API_KEY; }

/** Whether any AI backend is configured on this server. */
export function aiEnabled(): boolean { return openaiConfigured() || anthropicConfigured(); }

/** Compact, answer-key-inclusive description of a question for the model. */
function describeQuestion(q: Question): string {
  const lines = [`Type: ${q.type}`, `Marks: ${q.points}`, `Prompt: ${q.prompt || "(empty)"}`];
  if (q.options?.length) lines.push(`Options: ${q.options.join(" | ")}`);
  if (q.correctAnswer) lines.push(`Correct answer: ${q.correctAnswer}`);
  if (q.correctAnswers?.length) lines.push(`Correct options: ${q.correctAnswers.join(", ")}`);
  if (q.type === "matching" && q.matchPairs?.length) lines.push(`Pairs: ${q.matchPairs.map((p) => `${p.left} -> ${p.right}`).join("; ")}`);
  if (q.type === "ordering" && q.sequence?.length) lines.push(`Correct order: ${q.sequence.join(" -> ")}`);
  if (q.type === "cloze" && q.blanks?.length) lines.push(`Blanks: ${q.blanks.length}`);
  if (q.tags?.length) lines.push(`Topics: ${q.tags.join(", ")}`);
  return lines.join("\n");
}

const RUBRIC = [
  "Estimate how difficult a single exam question is for a typical student in the relevant course.",
  "Weigh the cognitive demand (recall vs. application vs. analysis), how specific or obscure the required knowledge is, the number of steps to answer, and how many candidates would likely get it right.",
  "Map to: easy (most students answer correctly), medium (a typical student must think), hard (only well-prepared students answer correctly).",
].join(" ");

const USER_PREFIX = "Assess the difficulty of this exam question.\n\n";

function normalize(input: { difficulty?: unknown; confidence?: unknown; rationale?: unknown }, model: string): DifficultyAssessment {
  const d = input.difficulty;
  const difficulty = d === "easy" || d === "hard" ? d : "medium";
  return { difficulty, confidence: Math.max(0, Math.min(1, Number(input.confidence) || 0)), rationale: String(input.rationale ?? "").slice(0, 300), model };
}

/** Ask the configured AI backend to assess a question's difficulty. */
export async function assessDifficulty(q: Question): Promise<DifficultyAssessment> {
  if (openaiConfigured()) return assessViaOpenAI(q);
  if (anthropicConfigured()) return assessViaAnthropic(q);
  throw new Error("AI is not configured.");
}

const NARRATE_SYSTEM = [
  "You are an academic advisor writing for a teacher.",
  "In 2-3 warm, specific sentences, summarise this student's performance trajectory:",
  "name the strongest and weakest subjects, the overall direction, and one actionable note.",
  "Be encouraging but honest. Use only the data given — do not invent numbers, subjects, or events.",
].join(" ");

/** Generate a short natural-language narrative of a student's subject trend. */
export async function narrateTrend(summary: string): Promise<{ narrative: string; model: string }> {
  if (openaiConfigured()) return { narrative: await openaiText(NARRATE_SYSTEM, summary), model: OPENAI_MODEL };
  if (anthropicConfigured()) return { narrative: await anthropicText(NARRATE_SYSTEM, summary), model: ANTHROPIC_MODEL };
  throw new Error("AI is not configured.");
}

async function openaiText(system: string, user: string): Promise<string> {
  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model: OPENAI_MODEL, temperature: 0.4, max_tokens: 240, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
  });
  if (!res.ok) { const t = await res.text().catch(() => ""); throw new Error(`AI provider error ${res.status}: ${t.slice(0, 200)}`); }
  const data = await res.json() as { choices?: { message?: { content?: string } }[] };
  return (data?.choices?.[0]?.message?.content ?? "").trim();
}

async function anthropicText(system: string, user: string): Promise<string> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();
  const r = await client.messages.create({ model: ANTHROPIC_MODEL, max_tokens: 320, output_config: { effort: "low" }, system, messages: [{ role: "user", content: user }] });
  const block = r.content.find((b) => b.type === "text");
  return block && block.type === "text" ? block.text.trim() : "";
}

// ── OpenAI-compatible backend (Groq / Gemini / OpenRouter / OpenAI / ...) ──
async function assessViaOpenAI(q: Question): Promise<DifficultyAssessment> {
  const url = `${OPENAI_BASE}/chat/completions`;
  const system = RUBRIC + ' Respond with ONLY a JSON object, no prose and no code fences: {"difficulty":"easy|medium|hard","confidence":0.0-1.0,"rationale":"one short sentence"}.';
  const base = {
    model: OPENAI_MODEL,
    temperature: 0,
    max_tokens: 300,
    messages: [
      { role: "system", content: system },
      { role: "user", content: USER_PREFIX + describeQuestion(q) },
    ],
  };
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` };
  // Prefer JSON mode where supported; transparently retry without it if rejected.
  let res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ ...base, response_format: { type: "json_object" } }) });
  if (res.status === 400) res = await fetch(url, { method: "POST", headers, body: JSON.stringify(base) });
  if (!res.ok) { const t = await res.text().catch(() => ""); throw new Error(`AI provider error ${res.status}: ${t.slice(0, 200)}`); }
  const data = await res.json() as { choices?: { message?: { content?: string } }[] };
  const content = data?.choices?.[0]?.message?.content ?? "";
  return normalize(parseLooseJson(content), OPENAI_MODEL);
}

/** Pull a JSON object out of a model reply, tolerating code fences / surrounding prose. */
function parseLooseJson(text: string): { difficulty?: unknown; confidence?: unknown; rationale?: unknown } {
  let raw = (text ?? "").trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) raw = fence[1].trim();
  const brace = raw.match(/\{[\s\S]*\}/);
  if (brace) raw = brace[0];
  return JSON.parse(raw);
}

// ── Anthropic / Claude backend (official SDK, forced tool call) ──
const ANTHROPIC_SYSTEM = RUBRIC + " Always answer by calling the report_difficulty tool. Keep the rationale to one short sentence.";
const ANTHROPIC_TOOL = {
  name: "report_difficulty",
  description: "Report the assessed difficulty band, a confidence from 0 to 1, and a one-sentence rationale.",
  input_schema: {
    type: "object" as const,
    properties: {
      difficulty: { type: "string", enum: ["easy", "medium", "hard"], description: "The difficulty band." },
      confidence: { type: "number", description: "Confidence in the assessment, 0 to 1." },
      rationale: { type: "string", description: "One short sentence explaining the judgement." },
    },
    required: ["difficulty", "confidence", "rationale"],
    additionalProperties: false,
  },
};
async function assessViaAnthropic(q: Question): Promise<DifficultyAssessment> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();
  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 1024,
    output_config: { effort: "low" },
    tools: [ANTHROPIC_TOOL],
    tool_choice: { type: "tool", name: "report_difficulty" },
    system: ANTHROPIC_SYSTEM,
    messages: [{ role: "user", content: USER_PREFIX + describeQuestion(q) }],
  });
  const block = response.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error("No structured result returned.");
  return normalize(block.input as Record<string, unknown>, ANTHROPIC_MODEL);
}
