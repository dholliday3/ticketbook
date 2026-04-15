/**
 * Tiptap extension that powers the `@`-mention popover in the copilot
 * input. Detects an `@` trigger, tracks the query, and inserts a
 * `contextRef` node when the user picks an item. Follows the same
 * state-bridging pattern as `SlashCommand.tsx` (React state updated
 * via `onStateChange`, keyboard events routed through a ref).
 */

import { Extension, type Editor, type Range } from "@tiptap/react";
import {
  Suggestion,
  type SuggestionKeyDownProps,
  type SuggestionProps,
} from "@tiptap/suggestion";
import type { ContextRefKind } from "@relay/core/context-refs";
import type { Doc, Plan, Task } from "@/types";

export interface MentionItem {
  kind: ContextRefKind;
  id: string;
  title: string;
}

export interface MentionMenuState {
  items: MentionItem[];
  command: ((item: MentionItem) => void) | null;
  clientRect: (() => DOMRect | null) | null;
  query: string;
  /** Parsed category prefix — null when the user hasn't typed `@task `/`@plan `. */
  category: ContextRefKind | null;
  /** The search term after stripping any category prefix. */
  needle: string;
}

/** Exposed so the popover can show the parsed category / needle. */
export { parseQuery };

const MAX_RESULTS = 5;

/**
 * Parse a mention query for an optional category prefix. Supports
 * both singular and plural forms:
 *
 *   "task TKT"      → { category: "task", needle: "tkt" }
 *   "tasks foo"     → { category: "task", needle: "foo" }
 *   "plan "         → { category: "plan", needle: "" }
 *   "doc editor"    → { category: "doc", needle: "editor" }
 *   "TKT-025"       → { category: null,   needle: "tkt-025" }
 *
 * The space after the category keyword is required — typing just
 * "task" matches a task whose title contains "task" (no narrowing).
 */
function parseQuery(query: string): {
  category: ContextRefKind | null;
  needle: string;
} {
  const match = /^(tasks?|plans?|docs?)\s+(.*)$/i.exec(query);
  if (!match) {
    return { category: null, needle: query.toLowerCase() };
  }
  const token = match[1].toLowerCase();
  const kind: ContextRefKind = token.startsWith("task")
    ? "task"
    : token.startsWith("plan")
      ? "plan"
      : "doc";
  return { category: kind, needle: match[2].toLowerCase() };
}

function filterItems(
  query: string,
  tasks: Task[],
  plans: Plan[],
  docs: Doc[],
): MentionItem[] {
  const { category, needle } = parseQuery(query);
  const matches: MentionItem[] = [];

  const pushIfMatches = (
    kind: ContextRefKind,
    id: string,
    title: string,
  ) => {
    if (!needle) {
      matches.push({ kind, id, title });
      return;
    }
    if (
      id.toLowerCase().includes(needle) ||
      title.toLowerCase().includes(needle)
    ) {
      matches.push({ kind, id, title });
    }
  };

  if (category === null || category === "task") {
    for (const task of tasks) pushIfMatches("task", task.id, task.title);
  }
  if (category === null || category === "plan") {
    for (const plan of plans) pushIfMatches("plan", plan.id, plan.title);
  }
  if (category === null || category === "doc") {
    for (const doc of docs) pushIfMatches("doc", doc.id, doc.title);
  }

  // Prioritise exact ID prefix hits so typing a partial ID jumps the
  // match to the top even if title matches come alphabetically first.
  if (needle) {
    matches.sort((a, b) => {
      const aHit = a.id.toLowerCase().startsWith(needle) ? 0 : 1;
      const bHit = b.id.toLowerCase().startsWith(needle) ? 0 : 1;
      return aHit - bHit;
    });
  }

  return matches.slice(0, MAX_RESULTS);
}

export interface CreateMentionExtensionOptions {
  /** Source of truth for tasks — called every render tick. */
  getTasks: () => Task[];
  /** Source of truth for plans — called every render tick. */
  getPlans: () => Plan[];
  /** Source of truth for docs — called every render tick. */
  getDocs: () => Doc[];
  /** React state setter bridging the suggestion lifecycle. */
  onStateChange: (state: MentionMenuState | null) => void;
  /** Imperative keydown handler — set by the popover component. */
  keyDownRef: React.RefObject<((props: SuggestionKeyDownProps) => boolean) | null>;
}

export function createMentionExtension({
  getTasks,
  getPlans,
  getDocs,
  onStateChange,
  keyDownRef,
}: CreateMentionExtensionOptions) {
  return Extension.create({
    name: "contextRefMention",

    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          char: "@",
          // Keep the suggestion alive across spaces so the user can
          // type a category prefix (`@task `, `@plan `) followed by a
          // search term. The suggestion still terminates on newline,
          // selection, Escape, or when the user deletes back past the
          // `@` trigger.
          allowSpaces: true,
          startOfLine: false,
          items: ({ query }: { query: string }) =>
            filterItems(query, getTasks(), getPlans(), getDocs()),
          command: ({
            editor,
            range,
            props,
          }: {
            editor: Editor;
            range: Range;
            props: MentionItem;
          }) => {
            // Insert the contextRef node plus a trailing space so the
            // user can keep typing immediately after the chip.
            editor
              .chain()
              .focus()
              .insertContentAt(range, [
                {
                  type: "contextRef",
                  attrs: {
                    kind: props.kind,
                    id: props.id,
                    title: props.title,
                  },
                },
                { type: "text", text: " " },
              ])
              .run();
          },
          render: () => ({
            onStart: (props: SuggestionProps<MentionItem, MentionItem>) => {
              const { category, needle } = parseQuery(props.query);
              onStateChange({
                items: props.items,
                command: props.command,
                clientRect: props.clientRect ?? null,
                query: props.query,
                category,
                needle,
              });
            },
            onUpdate: (props: SuggestionProps<MentionItem, MentionItem>) => {
              const { category, needle } = parseQuery(props.query);
              onStateChange({
                items: props.items,
                command: props.command,
                clientRect: props.clientRect ?? null,
                query: props.query,
                category,
                needle,
              });
            },
            onKeyDown: (props: SuggestionKeyDownProps) => {
              return keyDownRef.current?.(props) ?? false;
            },
            onExit: () => {
              onStateChange(null);
            },
          }),
        }),
      ];
    },
  });
}
