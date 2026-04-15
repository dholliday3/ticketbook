/**
 * Tiptap-based rich input for the copilot panel.
 *
 * Replaces the plain-textarea PromptInputTextarea so that primitive
 * context-ref markers render as inline chips inside the
 * input (same primitive shape as the message bubble chips). Syncs its
 * serialized value back to the PromptInputProvider controller on every
 * update so the existing form submission path still works unchanged.
 *
 * Serialization / deserialization use the pure helpers from
 * `@relay/core/context-refs` so the marker shape is identical
 * everywhere (stored message, expansion, chip rendering, this input).
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ForwardedRef,
  type KeyboardEventHandler,
} from "react";
import { createPortal } from "react-dom";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import type { SuggestionKeyDownProps } from "@tiptap/suggestion";
import {
  renderContextRefMarker,
  splitByContextRefs,
  type ContextRef,
} from "@relay/core/context-refs";
import { usePromptInputController } from "@/components/ai-elements/prompt-input";
import { useAppContext } from "@/context/AppContext";
import { cn } from "@/lib/utils";
import { ContextRefNode } from "./ContextRefNode";
import {
  createMentionExtension,
  type MentionItem,
  type MentionMenuState,
} from "./MentionExtension";
import { MentionPopover } from "./MentionPopover";

export interface CopilotPromptEditorRef {
  /** Clear the editor content (called after a successful submit). */
  clear: () => void;
  focus: () => void;
  /** Whether the editor currently has any content. */
  isEmpty: () => boolean;
  /**
   * Apply a pending insertion. `mode="append"` adds to the end of the
   * current content (with a leading space if needed); `mode="replace"`
   * swaps the entire doc. Text is parsed for markers and primitive
   * refs become inline chips.
   */
  insertFromMarkerString: (text: string, mode: "append" | "replace") => void;
}

interface CopilotPromptEditorProps {
  placeholder?: string;
  disabled?: boolean;
  /** Called when the user presses Enter without Shift — triggers submit. */
  onSubmit: () => void;
}

export const CopilotPromptEditor = forwardRef<
  CopilotPromptEditorRef,
  CopilotPromptEditorProps
>(function CopilotPromptEditor(
  { placeholder, disabled, onSubmit }: CopilotPromptEditorProps,
  ref: ForwardedRef<CopilotPromptEditorRef>,
) {
  const controller = usePromptInputController();
  const {
    tasks,
    plans,
    docs,
    pendingCopilotInsertion,
    consumePendingCopilotInsertion,
  } = useAppContext();

  // Mention menu state bridge — React state updated from the
  // ProseMirror plugin inside MentionExtension.
  const [mentionState, setMentionState] = useState<MentionMenuState | null>(
    null,
  );
  const mentionKeyDownRef = useRef<
    ((props: SuggestionKeyDownProps) => boolean) | null
  >(null);

  // Keep the latest primitives available to the extension without
  // recreating it — the extension closes over these getters once.
  const tasksRef = useRef(tasks);
  const plansRef = useRef(plans);
  const docsRef = useRef(docs);
  useEffect(() => {
    tasksRef.current = tasks;
    plansRef.current = plans;
    docsRef.current = docs;
  }, [tasks, plans, docs]);

  const mentionExtension = useMemo(
    () =>
      createMentionExtension({
        getTasks: () => tasksRef.current,
        getPlans: () => plansRef.current,
        getDocs: () => docsRef.current,
        onStateChange: setMentionState,
        keyDownRef: mentionKeyDownRef,
      }),
    [],
  );

  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Keep only plain text + paragraphs + history. No rich
        // formatting inside the chat input.
        bold: false,
        italic: false,
        strike: false,
        code: false,
        heading: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        dropcursor: false,
        gapcursor: false,
        link: false,
        underline: false,
      }),
      Placeholder.configure({
        placeholder: placeholder ?? "Ask the assistant…",
      }),
      ContextRefNode,
      mentionExtension,
    ],
    editorProps: {
      attributes: {
        class:
          "min-h-16 max-h-48 w-full overflow-y-auto whitespace-pre-wrap break-words px-2 py-2 text-sm leading-relaxed outline-none",
        "aria-label": "Copilot message input",
        "data-testid": "copilot-prompt-editor",
      },
      handleKeyDown: (_view, event) => {
        // Let the mention suggestion handle its own keys first.
        if (mentionState) return false;
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
          event.preventDefault();
          onSubmitRef.current();
          return true;
        }
        return false;
      },
    },
    content: "",
    onUpdate: ({ editor }) => {
      const serialized = serializeEditor(editor);
      // Only push to the controller if it actually changed — avoids a
      // feedback loop when the external effect below syncs the editor
      // in response to a controller-driven change.
      if (controller.textInput.value !== serialized) {
        controller.textInput.setInput(serialized);
      }
    },
  });

  // External writers (e.g. PromptInput.handleSubmit calling
  // controller.textInput.clear() after a successful send) update the
  // controller but not the editor. Watch for that divergence and clear
  // the editor to match — only when controller goes empty, to avoid
  // trying to round-trip rich content back through the serializer.
  useEffect(() => {
    if (!editor) return;
    if (controller.textInput.value === "" && !editor.isEmpty) {
      editor.commands.clearContent();
    }
  }, [controller.textInput.value, editor]);

  // Drain any pending insertion queued by AppContext (quick-add and
  // preset hand-off buttons). We live inside CopilotPromptEditor so
  // the effect can depend on the editor instance directly and wait
  // until it's ready. Actual command dispatch is deferred via a double
  // `requestAnimationFrame` so Tiptap's own view-attach effect has a
  // chance to run first — `useEditor` returns the editor instance
  // synchronously during render, but the ProseMirror view isn't
  // actually mounted to the DOM until Tiptap's internal useEffect
  // fires on the next tick. Commands dispatched before that point
  // silently no-op.
  useEffect(() => {
    if (!editor || !pendingCopilotInsertion) return;
    const { text, kind } = pendingCopilotInsertion;
    const segments = splitByContextRefs(text);
    const inlineContent = segmentsToTiptapContent(segments);

    const apply = () => {
      if (editor.isDestroyed) return;
      // For an empty editor or an explicit replace, use setContent so
      // we drop in a well-formed doc regardless of cursor position.
      // For append into existing content, use insertContent at the end
      // with a leading space if the tail isn't already whitespace.
      if (kind === "replace" || editor.isEmpty) {
        editor
          .chain()
          .setContent({
            type: "doc",
            content: [{ type: "paragraph", content: inlineContent }],
          })
          .focus("end")
          .run();
      } else {
        const size = editor.state.doc.content.size;
        const tail = editor.state.doc.textBetween(
          Math.max(0, size - 2),
          size,
          "\n",
          "\0",
        );
        const endsWithWhitespace = /\s$/.test(tail ?? "");
        const leading = endsWithWhitespace
          ? []
          : [{ type: "text", text: " " }];
        editor
          .chain()
          .focus("end")
          .insertContent([...leading, ...inlineContent])
          .run();
      }
    };

    // Defer until Tiptap's view is mounted. A double RAF guarantees
    // we're past any same-tick effects React + Tiptap queue.
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => {
        apply();
        consumePendingCopilotInsertion();
      });
      cleanupRef.current = () => cancelAnimationFrame(raf2);
    });
    const cleanupRef = { current: () => cancelAnimationFrame(raf1) };
    return () => cleanupRef.current();
  }, [editor, pendingCopilotInsertion, consumePendingCopilotInsertion]);

  useImperativeHandle(
    ref,
    () => ({
      clear: () => editor?.commands.clearContent(),
      focus: () => editor?.commands.focus(),
      isEmpty: () => editor?.isEmpty ?? true,
      insertFromMarkerString: (text, mode) => {
        if (!editor) return;
        const segments = splitByContextRefs(text);
        const inlineContent = segmentsToTiptapContent(segments);
        if (mode === "replace") {
          editor
            .chain()
            .focus()
            .setContent({
              type: "doc",
              content: [{ type: "paragraph", content: inlineContent }],
            })
            .run();
          return;
        }
        // Append: move cursor to the end, add a leading space if the
        // existing content doesn't already end with whitespace.
        const size = editor.state.doc.content.size;
        const tailChar = editor.state.doc.textBetween(
          Math.max(0, size - 2),
          size,
          "\n",
          "\0",
        );
        const endsWithWhitespace =
          editor.isEmpty || /\s$/.test(tailChar ?? "");
        const leading = endsWithWhitespace ? [] : [{ type: "text", text: " " }];
        editor
          .chain()
          .focus("end")
          .insertContent([...leading, ...inlineContent])
          .run();
      },
    }),
    [editor],
  );

  const handleMentionSelect = useCallback(
    (item: MentionItem) => {
      mentionState?.command?.(item);
    },
    [mentionState],
  );

  const [activeMentionIndex, setActiveMentionIndex] = useState(0);

  // Reset highlight when results change.
  useEffect(() => {
    setActiveMentionIndex(0);
  }, [mentionState?.items]);

  // Wire mention keyboard handling — the extension calls this via the
  // keyDownRef during a suggestion session so arrow keys / Enter work
  // while the popover is open.
  useEffect(() => {
    mentionKeyDownRef.current = (props: SuggestionKeyDownProps) => {
      if (!mentionState) return false;
      const { event } = props;
      const { items } = mentionState;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveMentionIndex((i) =>
          items.length === 0 ? 0 : (i + 1) % items.length,
        );
        return true;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveMentionIndex((i) =>
          items.length === 0 ? 0 : (i - 1 + items.length) % items.length,
        );
        return true;
      }
      if (event.key === "Enter") {
        if (items.length === 0) return false;
        event.preventDefault();
        mentionState.command?.(items[activeMentionIndex]);
        return true;
      }
      if (event.key === "Escape") {
        return false; // let suggestion exit naturally
      }
      return false;
    };
  }, [mentionState, activeMentionIndex]);

  const mentionRect = useMemo(() => {
    if (!mentionState) return null;
    return mentionState.clientRect?.() ?? null;
  }, [mentionState]);

  return (
    <div
      className={cn(
        "w-full",
        disabled && "pointer-events-none opacity-60",
      )}
    >
      <EditorContent editor={editor} />
      {mentionState &&
        mentionRect &&
        createPortal(
          <div
            className="fixed z-[1000] w-72 max-w-[min(22rem,calc(100vw-2rem))]"
            style={{
              left: `${mentionRect.left}px`,
              // Float directly above the caret position reported by
              // @tiptap/suggestion — (innerHeight - rectTop + gap)
              // places the popover's bottom edge `gap` px above.
              bottom: `${window.innerHeight - mentionRect.top + 8}px`,
            }}
          >
            <MentionPopover
              items={mentionState.items}
              activeIndex={activeMentionIndex}
              category={mentionState.category}
              query={mentionState.needle}
              onSelect={handleMentionSelect}
              onHover={setActiveMentionIndex}
            />
          </div>,
          document.body,
        )}
    </div>
  );
});

// ─── Serialization helpers ─────────────────────────────────────────

/**
 * Walk the editor document and produce the same marker-flavored string
 * the rest of the system deals with: paragraphs join with `\n`, text
 * nodes concat, contextRef nodes expand back to primitive markers.
 */
function serializeEditor(editor: Editor): string {
  const paragraphs: string[] = [];
  editor.state.doc.forEach((block) => {
    if (block.type.name !== "paragraph") return;
    let para = "";
    block.forEach((node) => {
      if (node.type.name === "text") {
        para += node.text ?? "";
      } else if (node.type.name === "contextRef") {
        para += renderContextRefMarker({
          kind: node.attrs.kind,
          id: node.attrs.id,
          title: node.attrs.title ?? null,
        });
      }
    });
    paragraphs.push(para);
  });
  return paragraphs.join("\n");
}

/**
 * Turn a parsed segment list into Tiptap inline content suitable for
 * `insertContent` / `setContent`.
 */
function segmentsToTiptapContent(
  segments: ReturnType<typeof splitByContextRefs>,
) {
  const out: Array<
    | { type: "text"; text: string }
    | {
        type: "contextRef";
        attrs: { kind: ContextRef["kind"]; id: string; title: string | null };
      }
  > = [];
  for (const seg of segments) {
    if (seg.type === "text") {
      if (seg.content.length > 0) {
        // Strip any leftover newlines — multi-paragraph insertion isn't
        // supported from the append path; the preset templates don't
        // contain newlines, and quick-add is always a single marker.
        out.push({ type: "text", text: seg.content.replace(/\n+/g, " ") });
      }
    } else {
      out.push({
        type: "contextRef",
        attrs: {
          kind: seg.ref.kind,
          id: seg.ref.id,
          title: seg.ref.title,
        },
      });
    }
  }
  return out;
}

// Re-export KeyboardEventHandler only so downstream files can share the type.
export type { KeyboardEventHandler };
