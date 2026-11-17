import { useState } from "react";
import { answerMail } from "../api";
import type { RunMail } from "../types";

/**
 * Questions and escalations, which the dispatch loop cannot resolve on its own.
 *
 * The loop only watches task status. A worker on a different harness may stop
 * mid-task and ask something (`question`), or end its turn without reporting
 * (`escalation`); either way it is blocked on mail, the task stays
 * `dispatched`, and the DAG silently stalls. Orca routes that mail to the Run's
 * inbox, so the viewer reads it (server/src/orca.ts `listMail`) and lets you
 * answer here: `question` → `reply` on the thread, `escalation` → `send` to the
 * sender's Dispatch with guidance.
 */
export function MailPanel({
  mail,
  runId,
  onAnswered,
}: {
  mail: RunMail[];
  runId: string;
  onAnswered: () => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  // Orca's `reply` does not mark the row handled, so hide what we just answered
  // until the next Run refresh catches up.
  const [answered, setAnswered] = useState<Set<string>>(new Set());

  const open = mail.filter(
    (m) =>
      !m.handled &&
      !answered.has(m.id) &&
      (m.type === "question" || m.type === "escalation"),
  );
  if (!runId || open.length === 0) return null;

  async function answer(m: RunMail, picked?: string) {
    const body = (picked ?? drafts[m.id] ?? "").trim();
    if (!body) return;
    const via = m.type === "escalation" ? "send" : "reply";
    if (via === "send" && !m.dispatchId) {
      alert("This escalation carries no dispatch id, so it can't be steered from here.");
      return;
    }
    setBusyId(m.id);
    try {
      await answerMail(m.id, body, runId, via, m.dispatchId);
      setAnswered((prev) => new Set(prev).add(m.id));
      onAnswered();
    } catch (err) {
      alert(`Answer failed: ${String((err as Error).message ?? err)}`);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mails">
      {open.map((m) => {
        const escalation = m.type === "escalation";
        return (
          <div key={m.id} className={`mail${escalation ? " mail--stuck" : ""}`}>
            <div className="mail__badge">
              {escalation ? "Worker stopped without reporting" : "Worker is asking"}
            </div>
            {m.subject && <div className="mail__subject">{m.subject}</div>}
            {m.body && <pre className="mail__body">{m.body}</pre>}
            {m.options.length > 0 && (
              <div className="mail__actions">
                {m.options.map((opt) => (
                  <button
                    key={opt}
                    className="btn btn--gate btn--ok"
                    disabled={busyId === m.id}
                    onClick={() => answer(m, opt)}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}
            <textarea
              className="mail__input"
              rows={2}
              placeholder={
                escalation
                  ? "Guidance to send back to this worker…"
                  : "Your answer — it wakes the worker waiting on this question…"
              }
              value={drafts[m.id] ?? ""}
              onChange={(e) => setDrafts((prev) => ({ ...prev, [m.id]: e.target.value }))}
            />
            <div className="mail__actions">
              <button
                className="btn btn--gate btn--ok"
                disabled={busyId === m.id || !(drafts[m.id] ?? "").trim()}
                onClick={() => answer(m)}
              >
                {escalation ? "Send guidance" : "Send answer"}
              </button>
              {m.fromHandle && <span className="mail__from">{m.fromHandle}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}