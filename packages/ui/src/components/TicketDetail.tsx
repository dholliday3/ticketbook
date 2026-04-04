import { useState, useEffect, useRef, useCallback } from "react";
import { patchTicket, patchTicketBody } from "../api";
import type { Ticket, Status, Priority, Meta } from "../types";
import { TiptapEditor } from "./TiptapEditor";
import { SelectChip, ComboboxChip, MultiComboboxChip, KebabMenu } from "./MetaFields";

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "backlog", label: "Backlog" },
  { value: "open", label: "Open" },
  { value: "in-progress", label: "In Progress" },
  { value: "done", label: "Done" },
  { value: "cancelled", label: "Cancelled" },
];

const PRIORITY_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "None" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

interface TicketDetailProps {
  ticket: Ticket;
  meta: Meta;
  onUpdated: () => void;
  onDelete?: (id: string) => void;
}

export function TicketDetail({ ticket, meta, onUpdated, onDelete }: TicketDetailProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(ticket.title);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const titleInputRef = useRef<HTMLInputElement>(null);
  const bodyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync drafts when ticket changes externally
  useEffect(() => {
    setTitleDraft(ticket.title);
    setEditingTitle(false);
  }, [ticket.id, ticket.title]);

  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingTitle]);

  // Reset save status when switching tickets
  useEffect(() => {
    setSaveStatus("idle");
  }, [ticket.id]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (bodyTimerRef.current) clearTimeout(bodyTimerRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  const saveField = useCallback(
    async (patch: Parameters<typeof patchTicket>[1]) => {
      try {
        await patchTicket(ticket.id, patch);
        onUpdated();
      } catch (err) {
        console.error("Failed to save:", err);
      }
    },
    [ticket.id, onUpdated],
  );

  const handleTitleSave = () => {
    setEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== ticket.title) {
      saveField({ title: trimmed });
    } else {
      setTitleDraft(ticket.title);
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleTitleSave();
    } else if (e.key === "Escape") {
      setTitleDraft(ticket.title);
      setEditingTitle(false);
    }
  };

  const handleBodyChange = useCallback(
    (markdown: string) => {
      if (bodyTimerRef.current) clearTimeout(bodyTimerRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      setSaveStatus("saving");
      bodyTimerRef.current = setTimeout(async () => {
        try {
          await patchTicketBody(ticket.id, markdown);
          onUpdated();
          setSaveStatus("saved");
          savedTimerRef.current = setTimeout(() => setSaveStatus("idle"), 2000);
        } catch (err) {
          console.error("Failed to save body:", err);
          setSaveStatus("idle");
        }
      }, 500);
    },
    [ticket.id, onUpdated],
  );

  return (
    <div className="ticket-detail">
      {/* Ticket ID + save indicator + delete button */}
      <div className="detail-header-row">
        <span className="detail-ticket-id">{ticket.id}</span>
        {saveStatus !== "idle" && (
          <span className={`save-indicator ${saveStatus}`}>
            {saveStatus === "saving" ? "Saving..." : "Saved"}
          </span>
        )}
        {onDelete && (
          <button
            className="delete-btn"
            onClick={() => onDelete(ticket.id)}
            title="Delete ticket"
            aria-label="Delete ticket"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
          </button>
        )}
      </div>

      {/* Inline editable title */}
      {editingTitle ? (
        <input
          ref={titleInputRef}
          className="detail-title-input"
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={handleTitleSave}
          onKeyDown={handleTitleKeyDown}
        />
      ) : (
        <h1
          className="detail-title"
          onClick={() => setEditingTitle(true)}
          title="Click to edit"
        >
          {ticket.title}
        </h1>
      )}

      {/* Body editor */}
      <TiptapEditor
        content={splitAgentNotes(ticket.body).userContent}
        onUpdate={(md) => {
          const { agentNotes } = splitAgentNotes(ticket.body);
          handleBodyChange(mergeAgentNotes(md, agentNotes));
        }}
        ticketId={ticket.id}
      />

      {/* Metadata row */}
      <div className="detail-meta-row">
        <SelectChip
          value={ticket.status}
          options={STATUS_OPTIONS}
          onChange={(v) => saveField({ status: v as Status })}
        />
        <SelectChip
          value={ticket.priority ?? ""}
          options={PRIORITY_OPTIONS}
          placeholder="Priority"
          onChange={(v) => saveField({ priority: v ? (v as Priority) : null })}
        />
        <MultiComboboxChip
          values={ticket.tags ?? []}
          options={meta.tags}
          placeholder="Tags"
          onChange={(tags) => saveField({ tags })}
        />
        <KebabMenu
          items={[
            {
              label: "Project",
              content: (
                <ComboboxChip
                  value={ticket.project ?? ""}
                  options={meta.projects}
                  placeholder="None"
                  onChange={(v) => saveField({ project: v || null })}
                />
              ),
            },
            {
              label: "Epic",
              content: (
                <ComboboxChip
                  value={ticket.epic ?? ""}
                  options={meta.epics}
                  placeholder="None"
                  onChange={(v) => saveField({ epic: v || null })}
                />
              ),
            },
            {
              label: "Sprint",
              content: (
                <ComboboxChip
                  value={ticket.sprint ?? ""}
                  options={meta.sprints}
                  placeholder="None"
                  onChange={(v) => saveField({ sprint: v || null })}
                />
              ),
            },
            {
              label: "Assignee",
              content: (
                <input
                  className="meta-assignee-input"
                  value={ticket.assignee ?? ""}
                  onChange={(e) => saveField({ assignee: e.target.value || null })}
                  placeholder="Unassigned"
                />
              ),
            },
            {
              label: "Blocked by",
              content: (
                <TicketLinkChips
                  links={ticket.blockedBy ?? []}
                  onChange={(ids) => saveField({ blockedBy: ids })}
                />
              ),
            },
            {
              label: "Related to",
              content: (
                <TicketLinkChips
                  links={ticket.relatedTo ?? []}
                  onChange={(ids) => saveField({ relatedTo: ids })}
                />
              ),
            },
          ]}
        />
      </div>

      {/* Refs (commits/PRs) */}
      {ticket.refs && ticket.refs.length > 0 && (
        <div className="ticket-refs">
          <span className="ticket-refs-label">Refs</span>
          {ticket.refs.map((ref) => (
            <span key={ref} className="ticket-ref-chip">
              {ref.startsWith("http") ? (
                <a href={ref} target="_blank" rel="noopener noreferrer">{ref.replace(/.*\//, "")}</a>
              ) : (
                <code>{ref.slice(0, 8)}</code>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Agent notes (collapsible) */}
      <AgentNotesSection
        notes={splitAgentNotes(ticket.body).agentNotes}
        onUpdate={(notes) => {
          const { userContent } = splitAgentNotes(ticket.body);
          handleBodyChange(mergeAgentNotes(userContent, notes));
        }}
      />
    </div>
  );
}

const AGENT_NOTES_MARKER = "<!-- agent-notes -->";

function splitAgentNotes(body: string): { userContent: string; agentNotes: string } {
  const idx = body.indexOf(AGENT_NOTES_MARKER);
  if (idx === -1) return { userContent: body, agentNotes: "" };
  return {
    userContent: body.slice(0, idx).trimEnd(),
    agentNotes: body.slice(idx + AGENT_NOTES_MARKER.length).trimStart(),
  };
}

function mergeAgentNotes(userContent: string, agentNotes: string): string {
  if (!agentNotes.trim()) return userContent;
  return `${userContent}\n\n${AGENT_NOTES_MARKER}\n\n${agentNotes}`;
}

function AgentNotesSection({
  notes,
  onUpdate,
}: {
  notes: string;
  onUpdate: (notes: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="agent-notes-section">
      <button
        className="agent-notes-toggle"
        onClick={() => setOpen(!open)}
      >
        <span className={`chevron ${!open ? "collapsed" : ""}`}>&#9662;</span>
        Agent Notes
        {notes && <span className="agent-notes-badge">Has notes</span>}
      </button>
      {open && (
        <textarea
          className="agent-notes-editor"
          value={notes}
          onChange={(e) => onUpdate(e.target.value)}
          placeholder="Agent research, debrief, and notes..."
          rows={6}
        />
      )}
    </div>
  );
}


function TicketLinkChips({
  links,
  onChange,
}: {
  links: string[];
  onChange: (ids: string[]) => void;
}) {
  const [input, setInput] = useState("");

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const id = input.trim().toUpperCase();
      if (id && !links.includes(id)) {
        onChange([...links, id]);
      }
      setInput("");
    } else if (e.key === "Backspace" && !input && links.length > 0) {
      onChange(links.slice(0, -1));
    }
  };

  return (
    <div className="tag-input-container">
      {links.map((id) => (
        <span key={id} className="detail-tag-chip link-chip">
          {id}
          <button
            className="tag-remove"
            onClick={() => onChange(links.filter((l) => l !== id))}
            aria-label={`Remove link ${id}`}
          >
            &times;
          </button>
        </span>
      ))}
      <input
        className="tag-text-input"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={links.length === 0 ? "Add ticket ID..." : ""}
      />
    </div>
  );
}
