import { create } from "zustand";
import { persist } from "zustand/middleware";
import { idePersistStorage } from "./persist-storage";
import {
  applyReviewReport,
  resolveReviewPrompt,
  validateReviewRequest,
  type ReviewContext,
  type ReviewReport,
  type ReviewRequest,
} from "./task-review.ts";

const HISTORY_COUNT = 24;
const PROJECT_HISTORY_COUNT = 8;
const HISTORY_BYTES = 12 * 1024 * 1024;

function boundedHistory(requests: ReviewRequest[]): ReviewRequest[] {
  const counts = new Map<string, number>();
  const ids = new Set<string>();
  let used = 0;
  return [...requests]
    .sort((a, b) => b.createdAt - a.createdAt)
    .filter((request) => {
      if (ids.has(request.id) || (counts.get(request.project) ?? 0) >= PROJECT_HISTORY_COUNT)
        return false;
      const size = new TextEncoder().encode(JSON.stringify(request)).length;
      if (used + size > HISTORY_BYTES || ids.size >= HISTORY_COUNT) return false;
      used += size;
      ids.add(request.id);
      counts.set(request.project, (counts.get(request.project) ?? 0) + 1);
      return true;
    });
}
function basis(request: ReviewRequest): string {
  return JSON.stringify([
    request.id,
    request.project,
    request.createdAt,
    request.basisLabel,
    request.baselineAvailable,
    request.files.map((file) => [
      file.path,
      file.change,
      file.baseline?.stamp ?? null,
      file.current?.stamp ?? null,
    ]),
  ]);
}

type TaskReviewState = {
  requests: ReviewRequest[];
  add: (request: ReviewRequest) => void;
  update: (request: ReviewRequest) => void;
};

/** Metadata and bounded comparison text use Anvil's existing IDB/recovery storage, scoped by project. */
export const useTaskReviews = create<TaskReviewState>()(
  persist(
    (set, get) => ({
      requests: [],
      add: (request) => {
        if (!validateReviewRequest(request)) throw Error("Ungültiger Review-Auftrag.");
        if (get().requests.some((item) => item.id === request.id))
          throw Error("Review-ID ist bereits vorhanden.");
        set({ requests: boundedHistory([request, ...get().requests]) });
      },
      update: (request) => {
        const existing = get().requests.find((item) => item.id === request.id);
        if (
          !existing ||
          basis(existing) !== basis(request) ||
          request.revision < existing.revision ||
          !validateReviewRequest(request)
        )
          throw Error(
            "Review passt nicht zum gespeicherten Projekt und Vergleichsstand oder ist überholt.",
          );
        set({ requests: get().requests.map((item) => (item.id === request.id ? request : item)) });
      },
    }),
    {
      name: "anvil-task-reviews",
      version: 1,
      storage: idePersistStorage(),
      partialize: (state) => ({ requests: boundedHistory(state.requests) }),
      merge: (persisted, current) => {
        const raw = persisted as { requests?: unknown[] } | undefined;
        const restored = Array.isArray(raw?.requests)
          ? raw.requests.filter(validateReviewRequest)
          : [];
        return { ...current, requests: boundedHistory([...current.requests, ...restored]) };
      },
    },
  ),
);

export function reviewForPrompt(text: string, project: string): ReviewRequest | undefined {
  return resolveReviewPrompt(text, project, useTaskReviews.getState().requests);
}
export function beginTaskReview(request: ReviewRequest): void {
  useTaskReviews.getState().add(request);
}
export function saveTaskReview(request: ReviewRequest): void {
  useTaskReviews.getState().update(request);
}

// Serialize partial reports for one review. Two completions must not erase each other's coverage.
const pending = new Map<string, Promise<ReviewRequest>>();
export function storeReviewReport(
  request: ReviewRequest,
  report: ReviewReport,
  context: ReviewContext,
): Promise<ReviewRequest> {
  const previous = pending.get(request.id);
  const next = (previous?.catch(() => undefined) ?? Promise.resolve()).then(async () => {
    const known = useTaskReviews.getState().requests.find((item) => item.id === request.id);
    if (!known || basis(known) !== basis(request))
      throw Error(
        "Review-Auftrag gehört nicht zum gespeicherten Projekt oder ist nicht mehr vorhanden.",
      );
    const updated = await applyReviewReport(known, report, context);
    saveTaskReview(updated);
    return updated;
  });
  pending.set(request.id, next);
  void next
    .finally(() => {
      if (pending.get(request.id) === next) pending.delete(request.id);
    })
    .catch(() => undefined);
  return next;
}
