import { useSyncExternalStore } from "react";

// Global, module-level (not React state) because the signal originates in
// src/lib/api.ts's fetch wrapper, which runs far outside any component tree.
// Every tenant/candidate request 503s with `{ maintenance: true }` while
// Super Admin has maintenance mode on (server/index.ts) — this is how that
// reaches the UI. A later successful request (e.g. MaintenancePage's own
// poll) clears it again via reportMaintenance(null).
let message: string | null = null;
const listeners = new Set<() => void>();

export function reportMaintenance(next: string | null): void {
  if (message === next) return;
  message = next;
  for (const l of listeners) l();
}

export function useMaintenanceMessage(): string | null {
  return useSyncExternalStore(
    (onChange) => { listeners.add(onChange); return () => listeners.delete(onChange); },
    () => message,
  );
}
