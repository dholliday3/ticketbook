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
import type { ContextRefKind } from "@ticketbook/core/context-refs";
import type { Plan, Task } from "@/types";

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
}

const MAX_RESULTS = 5;

function filterItems(
  query: string,
  tasks: Task[],
  plans: Plan[],
): MentionItem[] {
  const needle = query.toLowerCase();
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

  for (const task of tasks) pushIfMatches("task", task.id, task.title);
  for (const plan of plans) pushIfMatches("plan", plan.id, plan.title);

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
  /** React state setter bridging the suggestion lifecycle. */
  onStateChange: (state: MentionMenuState | null) => void;
  /** Imperative keydown handler — set by the popover component. */
  keyDownRef: React.RefObject<((props: SuggestionKeyDownProps) => boolean) | null>;
}

export function createMentionExtension({
  getTasks,
  getPlans,
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
          allowSpaces: false,
          startOfLine: false,
          items: ({ query }: { query: string }) =>
            filterItems(query, getTasks(), getPlans()),
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
              onStateChange({
                items: props.items,
                command: props.command,
                clientRect: props.clientRect ?? null,
                query: props.query,
              });
            },
            onUpdate: (props: SuggestionProps<MentionItem, MentionItem>) => {
              onStateChange({
                items: props.items,
                command: props.command,
                clientRect: props.clientRect ?? null,
                query: props.query,
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
