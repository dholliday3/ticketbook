import { useEffect, useState } from "react";

interface CopilotPanelProps {
  onClose: () => void;
}

interface CopilotHealth {
  providerId: string;
  status: "ready" | "not_installed" | "not_authenticated" | "error";
  cliVersion: string | null;
  error: string | null;
}

/**
 * Placeholder copilot panel — wired to the backend health endpoint so we can
 * verify the right-rail plumbing end-to-end before the real ai-elements UI
 * lands in Phase 4. Once Phase 3 (Tailwind + ai-elements) is in place this
 * file gets replaced with the real Conversation/Message/Reasoning rendering.
 */
export function CopilotPanel({ onClose }: CopilotPanelProps) {
  const [health, setHealth] = useState<CopilotHealth | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/copilot/health")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: CopilotHealth) => {
        if (!cancelled) setHealth(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="copilot-pane">
      <div className="copilot-pane-header">
        <span className="copilot-pane-title">Assistant</span>
        <button
          className="copilot-pane-close"
          onClick={onClose}
          aria-label="Close assistant"
          title="Close"
        >
          &times;
        </button>
      </div>
      <div className="copilot-pane-body">
        {error && <div className="copilot-pane-error">Error: {error}</div>}
        {!error && !health && <div className="copilot-pane-empty">Checking provider…</div>}
        {health && (
          <div className="copilot-pane-empty">
            <p>
              <strong>Provider:</strong> {health.providerId}
            </p>
            <p>
              <strong>Status:</strong> {health.status}
            </p>
            {health.cliVersion && (
              <p>
                <strong>CLI:</strong> {health.cliVersion}
              </p>
            )}
            {health.error && (
              <p>
                <strong>Error:</strong> {health.error}
              </p>
            )}
            <p style={{ marginTop: 16, opacity: 0.6 }}>
              The full assistant UI lands in Phase 4 once ai-elements is wired up.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
