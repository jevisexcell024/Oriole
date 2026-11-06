import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ExamListItem } from "@shared/types";

const POLL_MS = 45_000;

/** True while the current student has an in-progress exam attempt anywhere —
 *  used to lock Chat/Library, since a proctored exam runs in its own tab
 *  with no nav, so this is the only way to catch a student flipping to a
 *  second tab mid-exam. Polls the same /api/exams data every page already
 *  fetches; no new endpoint needed. */
export function useExamLock(): boolean {
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = () => {
      if (document.hidden) return; // nobody is looking at this tab — no need to ask
      api.get<{ items: ExamListItem[] }>("/exams")
        .then((d) => { if (!cancelled) setLocked(d.items.some((it) => it.attempt?.status === "in_progress")); })
        .catch(() => {});
    };
    check();
    // Slightly randomised so many open tabs don't all ask at the same instant, and
    // re-check the moment the tab is brought back to the front (the case that matters).
    const id = setInterval(check, POLL_MS * (0.85 + Math.random() * 0.3));
    document.addEventListener("visibilitychange", check);
    return () => { cancelled = true; clearInterval(id); document.removeEventListener("visibilitychange", check); };
  }, []);

  return locked;
}
