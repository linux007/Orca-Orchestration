import { useEffect, useState } from "react";
import { fetchModels, fetchTask } from "../api";
import {
  effectiveHarness,
  getDefaultHarness,
  getNodeHarness,
  getNodeModel,
  setNodeHarness,
  setNodeModel,
  useConfig,
} from "../harness";
import { HARNESSES, MODEL_PICKER, STATUS_META, type DagNode, type TaskDetail } from "../types";
import { DoodleSelect } from "./DoodleSelect";

const INHERIT = "__inherit__";
const CUSTOM = "__custom__";
const KNOWN = HARNESSES as readonly string[];

/**
 * Node detail + per-node harness. The description/deps are read-only (Orca can't
 * rewrite a stored spec — to change the plan, ask your agent to redraw the DAG).
 * The harness is this node's choice of agent when the coordinator fires it.
 */
export function NodePanel({
  node,
  runId,
  onClose,
}: {
  node: DagNode;
  runId: string;
  onClose: () => void;
}) {
  const meta = STATUS_META[node.status];
  // Spec/result are not in the DAG payload (a result can be a whole worker
  // report); fetch the full record when this panel opens and again when the
  // node's status changes, so a finished node shows its report.
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  useEffect(() => {
    let alive = true;
    setDetail(null);
    fetchTask(runId, node.id)
      .then((d) => {
        if (alive) setDetail(d);
      })
      .catch(() => {
        /* the panel still shows harness controls; spec stays blank */
      });
    return () => {
      alive = false;
    };
  }, [runId, node.id, node.status]);
  useConfig(); // re-render when the default harness (or this node's) changes
  const stored = getNodeHarness(node.id);
  const [sel, setSel] = useState(stored === null ? INHERIT : KNOWN.includes(stored) ? stored : CUSTOM);
  const [custom, setCustom] = useState(stored && !KNOWN.includes(stored) ? stored : "");

  useEffect(() => {
    const s = getNodeHarness(node.id);
    setSel(s === null ? INHERIT : KNOWN.includes(s) ? s : CUSTOM);
    setCustom(s && !KNOWN.includes(s) ? s : "");
  }, [node.id]);

  function pick(v: string) {
    setSel(v);
    if (v === INHERIT) setNodeHarness(node.id, null);
    else if (v !== CUSTOM) setNodeHarness(node.id, v);
  }
  function pickCustom(v: string) {
    setCustom(v);
    setNodeHarness(node.id, v.trim() || null);
  }

  // --- per-node model ------------------------------------------------
  // The model picker depends on the node's EFFECTIVE harness (its own override,
  // else the inherited default), not the {sel,custom} transient state — so it
  // reacts correctly even when the node just inherits. opencode → dropdown from
  // `opencode models`; claude/codex/cursor → free-text (no enumerable list);
  // anything else → no model control.
  const effHarness = effectiveHarness(node.id);
  const picker = MODEL_PICKER[effHarness] ?? "none";
  const model = getNodeModel(node.id);
  const [openCodeModels, setOpenCodeModels] = useState<string[] | null>(null);
  useEffect(() => {
    if (effHarness !== "opencode") return;
    let alive = true;
    fetchModels("opencode")
      .then((m) => {
        if (alive) setOpenCodeModels(m);
      })
      .catch(() => {
        if (alive) setOpenCodeModels([]);
      });
    return () => {
      alive = false;
    };
  }, [effHarness]);

  return (
    <aside className="node-panel">
      <button className="node-panel__close" onClick={onClose} aria-label="Close">
        ✕
      </button>

      <div className="node-panel__status" style={{ color: meta.ink }}>
        <span className="dot" style={{ background: meta.color }} />
        {meta.label}
      </div>
      <h3 className="node-panel__title">{node.label}</h3>
      <div className="node-panel__id">
        <code>{node.id}</code>
      </div>

      <div className="node-panel__field">
        <span className="node-panel__key">Harness (which agent runs this node)</span>
        <DoodleSelect
          value={sel}
          onChange={pick}
          options={[
            { value: INHERIT, label: `Default (${getDefaultHarness()})` },
            ...HARNESSES.map((h) => ({ value: h, label: h })),
            { value: CUSTOM, label: "Custom…" },
          ]}
        />
        {sel === CUSTOM && (
          <input
            className="node-panel__custom"
            value={custom}
            placeholder="command, e.g. aider"
            onChange={(e) => pickCustom(e.target.value)}
          />
        )}
      </div>

      {picker !== "none" && (
        <div className="node-panel__field">
          <span className="node-panel__key">
            Model ({effHarness}){model ? null : " · default"}
          </span>
          {picker === "select" ? (
            <DoodleSelect
              value={model ?? ""}
              onChange={(v) => setNodeModel(node.id, v || null)}
              loading={openCodeModels === null}
              options={[
                { value: "", label: "(default model)" },
                ...(openCodeModels ?? []).map((m) => ({ value: m, label: m })),
              ]}
            />
          ) : (
            <input
              className="node-panel__custom"
              value={model ?? ""}
              placeholder={`model name, e.g. ${effHarness === "claude" ? "opus" : effHarness === "codex" ? "o3" : "<model>"}`}
              onChange={(e) => setNodeModel(node.id, e.target.value.trim() || null)}
            />
          )}
        </div>
      )}

      {/* Orca tracks the running attempt as a Dispatch; task-list only carries
          these while the task is dispatched. */}
      {node.dispatchId && (
        <div className="node-panel__field">
          <span className="node-panel__key">Current Dispatch (this attempt)</span>
          <div className="node-panel__id">
            <code>{node.dispatchId}</code>
          </div>
          {node.assigneeHandle && (
            <span className="node-panel__hint">
              Worker terminal <code>{node.assigneeHandle}</code> · inspect output with{" "}
              <code>orca orchestration worker-read --dispatch {node.dispatchId}</code>
              <br />
              A worker stuck on its own interactive prompt never reaches the mail panel — answer
              it in that terminal, then stop and retry the node if it does not resume.
            </span>
          )}
        </div>
      )}

      <div className="node-panel__field">
        <span className="node-panel__key">Spec</span>
        <p className="node-panel__spec-ro">
          {detail ? detail.spec || "(empty spec)" : "Loading…"}
        </p>
        <span className="node-panel__hint">
          To change the spec or deps, have your agent redraw the DAG in a fresh Run.
        </span>
      </div>

      {detail?.result && (
        <div className="node-panel__field">
          <span className="node-panel__key">Result</span>
          <pre className="node-panel__result">{detail.result}</pre>
        </div>
      )}
    </aside>
  );
}
