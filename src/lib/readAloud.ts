import { useCallback, useEffect, useState } from "react";
import type { PublicQuestion } from "@shared/types";

/** Read-aloud for the exam page, using the browser's built-in text-to-speech (the Web
 *  Speech API) — nothing is sent to a server, and it works offline if the device has a voice.
 *  `supported` is false on browsers/devices without it, so the button simply isn't shown. */
export function useReadAloud() {
  const supported = typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
  const [speaking, setSpeaking] = useState(false);

  const stop = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [supported]);

  const speak = useCallback((text: string) => {
    if (!supported || !text.trim()) return;
    window.speechSynthesis.cancel();
    // Browsers cut off long utterances (Chrome after ~15s), so queue it a sentence or two at a time.
    const chunks = text.match(/[^.!?\n]+[.!?]*\s*/g)?.map((c) => c.trim()).filter(Boolean) ?? [text];
    const lang = document.documentElement.lang || "en";
    chunks.forEach((chunk, i) => {
      const u = new SpeechSynthesisUtterance(chunk);
      u.lang = lang;
      u.rate = 0.95;
      if (i === chunks.length - 1) { u.onend = () => setSpeaking(false); }
      u.onerror = (e) => { if (e.error !== "canceled" && e.error !== "interrupted") setSpeaking(false); };
      window.speechSynthesis.speak(u);
    });
    setSpeaking(true);
  }, [supported]);

  // Never keep talking after the exam page goes away.
  useEffect(() => () => { if (supported) window.speechSynthesis.cancel(); }, [supported]);

  return { supported, speaking, speak, stop };
}

/** What gets spoken for a question: the prompt, then each answer choice as "A. …", "B. …". */
export function speechTextFor(q: PublicQuestion): string {
  const clean = (s: string) => s
    .replace(/\$\$?/g, " ")            // LaTeX delimiters
    .replace(/\\[a-zA-Z]+/g, " ")      // LaTeX commands
    .replace(/[{}^_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const effType = q.type === "media_comprehension" ? q.answerFormat : q.type;
  const choiceTypes = ["mcq", "multi_select", "true_false"];
  let out = clean(q.prompt);
  if (q.options?.length && effType && choiceTypes.includes(effType)) {
    // One line per choice: the speaker pauses naturally between lines, and reads "Option A: …"
    // as a phrase instead of stopping after a bare "A." (see the sentence-splitting in speak()).
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    out += `\n${q.options.map((o, i) => `Option ${letters[i] ?? i + 1}: ${clean(String(o))}`).join("\n")}`;
    if (effType === "multi_select") out += "\nSelect all that apply.";
  }
  return out;
}
