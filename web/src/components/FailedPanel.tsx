import { useEffect, useState } from "react";
import { fetchTask, setTaskStatus } from "../api";
import type { DagNode } from "../types";

/**
 * Failed tasks, as decision cards.
 *
 * A failed node otherwise just turns red: its dependents stay `pending`
 * forever, the loop finds nothing runnable and stops, and the worker's report
 * sits unread in `task.result`. Put the report in front of the user with the two
 * ways out — retry it, or accept the work as done so the DAG moves on.
 */
export function FailedPanel({
  nodes,
  runId,
  onSettled,
}: {
  nodes: DagNode[];
  runId: string;
  onSettled: () => void;
}) {
  const failed = nodes.filter((n) => n.status === "failed");
  const ids = failed.map((n) => n.id).join(",");
  const [reports, setReports] = useState<Record<string, { subject: string; body: string }>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  // Reports are not in the DAG payload; fetch them when the failed set changes.
  useEffect(() => {
    if (!runId || !ids) return;
    let alive = true;
    for (const id of ids.split(",")) {
      fetchTask(runId, id)
        .then((t) => {
          if (alive) setReports((prev) => ({ ...prev, [id]: readReport(t.result) }));
        })
        .catch(() => {
          /* the card still offers retry/accept without the report */
        });
    }
    return () => {
      alive = false;
    };
  }, [runId, ids]);

  if (!runId || failed.length === 0) return null;

  async function settle(id: string, status: "ready" | "completed") {
    setBusyId(id);
    try {
      await setTaskStatus(id, status, runId);
      onSettled();
    } catch (err) {
      alert(`Update failed: ${String((err as Error).message ?? err)}`);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mails">
      {failed.map((n) => {
        const r = reports[n.id];
        return (
          <div key={n.id} className="mail mail--stuck">
            <div className="mail__badge">Task failed — its dependents are waiting</div>
            <div className="mail__subject">{n.label}</div>
            {r?.subject && <div className="mail__subject">{r.subject}</div>}
            {r?.body && <pre className="mail__body">{r.body}</pre>}
            <div className="mail__actions">
              <button
                className="btn btn--gate btn--ok"
                disabled={busyId === n.id}
                onClick={() => settle(n.id, "completed")}
                title="Keep the work as it is and release the tasks that depend on it"
              >
                Accept as done
              </button>
              <button
                className="btn btn--gate"
                disabled={busyId === n.id}
                onClick={() => settle(n.id, "ready")}
                title="Run this task again with the same spec"
              >
                Retry
              </button>
            </div>
            <div className="gate__hint">
              Retry re-runs the same spec. If the Run has stopped, press Run again after either
              choice.
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** A `worker_report` result is JSON with subject/body; anything else is shown raw. */
function readReport(result: string | null): { subject: string; body: string } {
  if (!result) return { subject: "", body: "" };
  try {
    const r = JSON.parse(result) as { subject?: unknown; body?: unknown };
    return { subject: String(r.subject ?? ""), body: String(r.body ?? "") };
  } catch {
    return { subject: "", body: result };
  }
}
