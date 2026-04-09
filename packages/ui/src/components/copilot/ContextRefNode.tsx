/**
 * Tiptap inline atom node for a task/plan context reference.
 *
 * Used in the copilot prompt editor so that `<task id="..." />` markers
 * render as compact single-line chips inside the input (similar to
 * @file mentions in Zed / Cursor / Claude Code). The node carries
 * `kind` / `id` / `title` attrs and is atomic — Backspace removes it as
 * a single unit, cursor navigation treats it as one character.
 *
 * Serialization back to a marker string (for the submit path) is
 * handled by CopilotPromptEditor, not here, because it needs to walk
 * the full doc rather than render-per-node.
 */

import {
  Node,
  mergeAttributes,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { FileTextIcon, ListChecksIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ContextRefHoverCard,
  useContextRefLookup,
} from "./ContextRefHoverCard";

export interface ContextRefAttrs {
  kind: "task" | "plan";
  id: string;
  title: string | null;
}

/**
 * The Tiptap extension. Include in the editor's `extensions` array.
 * Provides a `contextRef` node type and a React NodeView renderer.
 */
export const ContextRefNode = Node.create({
  name: "contextRef",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      kind: {
        default: "task",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-kind") ?? "task",
        renderHTML: (attrs: Record<string, unknown>) => ({
          "data-kind": attrs.kind,
        }),
      },
      id: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-id") ?? "",
        renderHTML: (attrs: Record<string, unknown>) => ({
          "data-id": attrs.id,
        }),
      },
      title: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-title"),
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.title ? { "data-title": attrs.title } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-context-ref]" }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-context-ref": "true" }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ContextRefChipNodeView);
  },
});

/**
 * React component rendered in place of the node. Compact single-line
 * chip (icon + ID + truncated title) with a HoverCard preview on
 * hover. Click doesn't navigate — the chip lives inside a
 * contenteditable, so click-to-position-cursor is the expected
 * behavior. The Open link lives in the hover card.
 */
function ContextRefChipNodeView({ node, selected }: NodeViewProps) {
  const { kind, id, title } = node.attrs as ContextRefAttrs;
  const { primitive, deleted } = useContextRefLookup(kind, id);
  const Icon = kind === "task" ? FileTextIcon : ListChecksIcon;
  const displayTitle =
    (primitive?.title ?? title ?? "").trim() || "(untitled)";

  return (
    <NodeViewWrapper
      as="span"
      className="inline-block align-baseline"
      data-testid="copilot-input-context-ref"
      data-kind={kind}
      data-id={id}
    >
      <ContextRefHoverCard kind={kind} id={id} titleFallback={title}>
        <span
          contentEditable={false}
          className={cn(
            "mx-0.5 inline-flex max-w-[28ch] items-center gap-1 rounded-md border px-1.5 py-0.5 align-baseline font-mono text-[11px] leading-none transition-colors",
            deleted
              ? "border-dashed border-border bg-muted text-muted-foreground line-through"
              : selected
                ? "border-primary bg-accent text-accent-foreground ring-1 ring-primary/30"
                : "border-border bg-secondary text-secondary-foreground hover:bg-accent",
          )}
        >
          <Icon
            className={cn(
              "size-3 shrink-0",
              deleted ? "text-muted-foreground" : "text-primary",
            )}
            aria-hidden
          />
          <span className="shrink-0 text-muted-foreground">{id}</span>
          <span className="min-w-0 truncate">{displayTitle}</span>
        </span>
      </ContextRefHoverCard>
    </NodeViewWrapper>
  );
}
