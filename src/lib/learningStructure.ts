import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { LearningStructureConfig } from "@shared/types";
import { DEFAULT_LEARNING_STRUCTURE } from "@shared/types";

let cache: LearningStructureConfig | null = null;
let inflight: Promise<LearningStructureConfig> | null = null;

function fetchLearningStructure(): Promise<LearningStructureConfig> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = api.get<{ learningStructure: LearningStructureConfig }>("/learning-structure")
      .then((d) => { cache = d.learningStructure ?? DEFAULT_LEARNING_STRUCTURE; return cache; })
      .catch(() => DEFAULT_LEARNING_STRUCTURE)
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/** Call after an admin saves Learning Structure changes so the next read in
 *  this session picks up the new value instead of a stale cached one. */
export function invalidateLearningStructureCache() { cache = null; }

/** Every module that behaves differently across Academic/Cohort/Hybrid
 *  institutions should read this instead of hardcoding one structure — see
 *  the "Learning Structure abstraction" project memory for the rationale.
 *  This is the foundational config layer only: not yet consumed by any
 *  existing module, which are migrated to it incrementally. */
export function useLearningStructure(): LearningStructureConfig {
  const [config, setConfig] = useState<LearningStructureConfig>(cache ?? DEFAULT_LEARNING_STRUCTURE);
  useEffect(() => {
    let cancelled = false;
    fetchLearningStructure().then((c) => { if (!cancelled) setConfig(c); });
    return () => { cancelled = true; };
  }, []);
  return config;
}
