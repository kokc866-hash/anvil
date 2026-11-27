import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useIde } from "@/store/ide";
import { isSecretPath } from "@/lib/ref";
import {
  buildReviewPrompt,
  createReviewRequest,
  refreshReviewRequest,
  reviewFindingPrompt,
  reviewSummary,
  type ReviewRequest,
} from "@/lib/task-review";
import { beginTaskReview, saveTaskReview, useTaskReviews } from "@/lib/task-review-store";

const STATUS = {
  open: "Offen",
  reviewed: "Geprüft",
  skipped: "Übersprungen",
  stale: "Veraltet",
} as const;
const CHANGE = {
  added: "Neu",
  modified: "Geändert",
  removed: "Entfernt · Basisprüfung",
  unknown: "Basis unbekannt",
} as const;
type Basis = { id: string; label: string; files?: Record<string, string>; paths?: string[] };
const projectOf = (state: { workspaceCwd: string; memoryWorkspace: string }) =>
  state.workspaceCwd || state.memoryWorkspace;

/** Embedded in GitPane; starting a review deliberately uses the existing read-only Ask workflow. */
export function TaskReviewPane() {
  const project = useIde((s) => s.workspaceCwd || s.memoryWorkspace);
  const files = useIde((s) => s.files);
  const editBases = useIde((s) => s.editBases);
  const checkpoints = useIde((s) => s.checkpoints);
  const dirty = useIde((s) => s.dirty);
  const activePath = useIde((s) => s.activePath);
  const requests = useTaskReviews((s) => s.requests);
  const [basisId, setBasisId] = useState("auto");
  const [scope, setScope] = useState("");
  const [selected, setSelected] = useState("");
  const [view, setView] = useState<ReviewRequest | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const bases = useMemo(() => {
    const options: Basis[] = [];
    const paths = Object.keys(editBases).filter(
      (path) =>
        !isSecretPath(path) &&
        (editBases[path] === null ? Object.hasOwn(files, path) : files[path] !== editBases[path]),
    );
    if (paths.length)
      options.push({
        id: "edits",
        label: "Ausgangsinhalte der offenen Änderungen",
        paths,
        files: Object.fromEntries(
          paths.filter((path) => editBases[path] !== null).map((path) => [path, editBases[path]!]),
        ),
      });
    const checkpoint = [...checkpoints]
      .reverse()
      .find(
        (item) =>
          item.workspace === project && !item.archiveMissing && Object.keys(item.files).length > 0,
      );
    if (checkpoint)
      options.push({
        id: checkpoint.id,
        label: `Sicherungspunkt: ${checkpoint.label}`,
        files: checkpoint.files,
      });
    options.push({ id: "none", label: "Aktueller Inhalt · Vergleichsbasis fehlt" });
    return options;
  }, [editBases, files, checkpoints, project]);
  const basis = bases.find((item) => item.id === basisId) ?? bases[0];
  const projectRequests = useMemo(
    () => requests.filter((item) => item.project === project),
    [requests, project],
  );
  const request = projectRequests.find((item) => item.id === selected) ?? projectRequests[0];

  useEffect(() => {
    let cancelled = false;
    setChecking(Boolean(request));
    setView(null);
    if (!request) return;
    void refreshReviewRequest(request, files)
      .then((updated) => {
        if (!cancelled) {
          setView(updated);
          setChecking(false);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setMessage(
            error instanceof Error ? error.message : "Dateistand konnte nicht verglichen werden.",
          );
          setChecking(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [request, files]);

  async function start() {
    const state = useIde.getState(),
      capturedProject = projectOf(state),
      epoch = state.workspaceEpoch;
    const capturedFiles = state.files;
    setBusy(true);
    setMessage("");
    try {
      if (
        scope.trim() &&
        basis.paths &&
        scope
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean)
          .some((path) => !basis.paths!.includes(path))
      )
        throw Error(
          "Für diese Datei fehlt der Ausgangsinhalt der offenen Änderungen. Einen passenden Sicherungspunkt oder „Vergleichsbasis fehlt“ wählen.",
        );
      const paths = scope.trim()
        ? scope
            .split("\n")
            .map((item) => item.trim())
            .filter(Boolean)
        : (basis.paths ??
          (basis.files
            ? undefined
            : [
                ...new Set([
                  ...Object.keys(state.dirty).filter((path) => state.dirty[path]),
                  ...(state.activePath ? [state.activePath] : []),
                ]),
              ]));
      const created = await createReviewRequest({
        project: capturedProject,
        files: capturedFiles,
        baselineFiles: basis.files,
        paths,
        basisLabel: basis.label,
      });
      if (!created.files.length) {
        setMessage("In diesem Prüfbereich liegen keine Änderungen vor.");
        return;
      }
      const prompt = buildReviewPrompt(created);
      const now = useIde.getState();
      if (
        now.workspaceEpoch !== epoch ||
        projectOf(now) !== capturedProject ||
        now.files !== capturedFiles
      )
        throw Error("Projekt oder Dateien inzwischen geändert. Review erneut starten.");
      beginTaskReview(created);
      setSelected(created.id);
      now.pushAgent(prompt, false, "ask");
      setMessage(
        "Review-Auftrag gesendet. Die Abdeckung bleibt offen, bis belegte Teilberichte vorliegen.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Review konnte nicht gestartet werden.");
    } finally {
      setBusy(false);
    }
  }

  async function followUp(path: string, findingId: string) {
    if (!request) return;
    const state = useIde.getState(),
      capturedProject = projectOf(state),
      epoch = state.workspaceEpoch;
    setBusy(true);
    setMessage("");
    try {
      if (request.project !== capturedProject)
        throw Error("Review gehört zu einem anderen Projekt.");
      const current = await refreshReviewRequest(request, state.files);
      const now = useIde.getState();
      if (
        now.workspaceEpoch !== epoch ||
        projectOf(now) !== capturedProject ||
        now.files !== state.files
      )
        throw Error("Projekt oder Dateien inzwischen geändert. Befund erneut prüfen.");
      const prompt = reviewFindingPrompt(current, path, findingId);
      saveTaskReview(current);
      now.pushAgent(prompt, false, "agent");
      setMessage("Gezielter Folgeauftrag zu diesem Befund gesendet.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Folgeauftrag konnte nicht erstellt werden.",
      );
    } finally {
      setBusy(false);
    }
  }

  const summary = view ? reviewSummary(view) : null;
  const fallbackCount =
    Object.keys(dirty).filter((path) => dirty[path]).length || (activePath ? 1 : 0);
  return (
    <details
      className="mb-4 rounded-md border border-border bg-bg p-2"
      data-testid="task-review-pane"
    >
      <summary className="cursor-pointer text-xs font-medium text-fg">
        Änderungen prüfen{summary ? ` · ${summary.reviewed}/${summary.total}` : ""}
      </summary>
      <div className="mt-2 space-y-2 text-xs">
        <p className="text-muted">
          Vergleiche die Änderungen mit einem früheren Stand. Die Prüfung liest Dateien und
          hält Befunde fest. Funktionstests bleiben separat.
        </p>
        <label className="block text-muted">
          Vergleichsbasis
          <select
            aria-label="Review-Vergleichsbasis"
            className="mt-1 h-8 w-full rounded-md border border-border bg-bg px-2 text-fg"
            value={basisId}
            onChange={(event) => setBasisId(event.target.value)}
          >
            <option value="auto">Automatisch: {bases[0].label}</option>
            {bases.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-muted">
          Prüfbereich · optional eine Datei pro Zeile
          <textarea
            aria-label="Review-Dateien"
            className="mt-1 min-h-14 w-full resize-y rounded-md border border-border bg-bg p-2 font-mono text-xs text-fg"
            value={scope}
            onChange={(event) => setScope(event.target.value)}
            placeholder={
              basis.files
                ? "Leer = alle Änderungen dieser Basis"
                : `Leer = ${fallbackCount} offene / aktive Dateien`
            }
            maxLength={64 * 1024}
          />
        </label>
        <Button
          className="h-auto min-h-8 w-full whitespace-normal py-1 text-xs"
          disabled={busy || !project}
          onClick={() => void start()}
        >
          Prüfung starten
        </Button>
        {message ? (
          <p className="break-words text-muted" role="status">
            {message}
          </p>
        ) : null}
        {projectRequests.length ? (
          <label className="block text-muted">
            Bisherige Prüfungen
            <select
              aria-label="Review-Verlauf"
              className="mt-1 h-8 w-full rounded-md border border-border bg-bg px-2 text-fg"
              value={request?.id ?? ""}
              onChange={(event) => setSelected(event.target.value)}
            >
              {projectRequests.map((item) => (
                <option key={item.id} value={item.id}>
                  {new Date(item.createdAt).toLocaleString("de")} · {item.files.length} Dateien
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="text-subtle">Noch kein Review für dieses Projekt.</p>
        )}
        {checking ? (
          <p className="text-muted" role="status">
            Aktueller Dateistand wird verglichen…
          </p>
        ) : null}
        {view && summary ? (
          <div className="space-y-2 border-t border-border pt-2">
            <p className="break-words text-fg">Basis: {view.basisLabel}</p>
            <p className="text-fg" data-testid="review-coverage">
              Abdeckung{" "}
              {summary.status === "complete"
                ? "abgeschlossen"
                : summary.status === "limited"
                  ? "begrenzt"
                  : "offen"}{" "}
              · {summary.reviewed} geprüft · {summary.skipped} übersprungen · {summary.open} offen ·{" "}
              {summary.stale} veraltet
            </p>
            <p className="text-muted">
              Anvil prüft, welche Dateistände gelesen wurden. Die inhaltliche Bewertung stammt
              vom Modell.
            </p>
            {[...view.limitations, ...view.reportWarnings].map((note, index) => (
              <p key={index} className="break-words text-warn">
                {note}
              </p>
            ))}
            <ul className="space-y-2">
              {view.files.map((file) => (
                <li
                  key={file.path}
                  className="rounded-md border border-border p-2"
                  data-review-status={file.status}
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      className="min-w-0 break-all text-left font-mono text-fg hover:underline"
                      onClick={() => {
                        if (Object.hasOwn(files, file.path)) useIde.getState().openFile(file.path);
                      }}
                    >
                      {file.path}
                    </button>
                    <span className={file.status === "stale" ? "text-warn" : "shrink-0 text-muted"}>
                      {STATUS[file.status]}
                    </span>
                  </div>
                  <p className="mt-1 text-subtle">
                    {CHANGE[file.change]} · {file.evidence.length} Lesebelege
                  </p>
                  {file.reason ? (
                    <p className="mt-1 break-words text-muted">{file.reason}</p>
                  ) : null}
                  {file.status === "reviewed" && !file.findings.length ? (
                    <p className="mt-1 text-muted">Modell meldet keine konkreten Befunde.</p>
                  ) : null}
                  {file.findings.map((finding) => (
                    <div key={finding.id} className="mt-2 border-t border-border pt-2">
                      <button
                        type="button"
                        className="break-words text-left text-fg hover:underline"
                        onClick={() => {
                          const state = useIde.getState();
                          if (Object.hasOwn(state.files, file.path)) {
                            state.openFile(file.path);
                            state.setCursor(finding.line, 1);
                          }
                        }}
                      >
                        {finding.line}: {finding.title}
                      </button>
                      <p className="mt-1 break-words whitespace-pre-wrap text-muted">
                        {finding.detail}
                      </p>
                      <Button
                        className="mt-1 h-7 px-2 text-xs"
                        disabled={busy || file.status !== "reviewed"}
                        onClick={() => void followUp(file.path, finding.id)}
                      >
                        Nur diesen Befund bearbeiten
                      </Button>
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </details>
  );
}
