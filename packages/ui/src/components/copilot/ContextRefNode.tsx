/**
 * Tiptap inline atom node for a task/plan context reference.
 *
 * Used in the copilot prompt editor so that `<task id="..." />` markers
 * render as rich chips inside the input (similar to @file mentions in
 * Cursor / Claude Code / Continue) instead of raw XML. The node carries
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

/** React component rendered in place of the node. */
function ContextRefChipNodeView({ node, selected }: NodeViewProps) {
  const { kind, id, title } = node.attrs as ContextRefAttrs;
  const Icon = kind === "task" ? FileTextIcon : ListChecksIcon;
  const displayTitle = (title ?? "").trim() || "(untitled)";

  return (
    <NodeViewWrapper
      as="span"
      className="inline-block align-middle"
      data-testid="copilot-input-context-ref"
      data-kind={kind}
      data-id={id}
    >
      <span
        contentEditable={false}
        className={cn(
          "mx-0.5 inline-flex max-w-[22ch] items-baseline gap-1 rounded-md border px-1.5 py-0 align-baseline text-xs font-normal transition-colors",
          selected
            ? "border-primary bg-primary/20 text-foreground ring-1 ring-primary/40"
            : "border-primary/30 bg-primary/10 text-foreground hover:bg-primary/15",
        )}
      >
        <Icon className="size-3 shrink-0 self-center" aria-hidden />
        <span className="font-mono text-[10px] text-muted-foreground">
          {id}
        </span>
        <span className="truncate">{displayTitle}</span>
      </span>
    </NodeViewWrapper>
  );
}
