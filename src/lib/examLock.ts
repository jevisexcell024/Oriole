import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ExamListItem } from "@shared/types";

const POLL_MS = 20_000;

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
      api.get<{ items: ExamListItem[] }>("/exams")
        .then((d) => { if (!cancelled) setLocked(d.items.some((it) => it.attempt?.status === "in_progress")); })
        .catch(() => {});
    };
    check();
    const id = setInterval(check, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return locked;
}
