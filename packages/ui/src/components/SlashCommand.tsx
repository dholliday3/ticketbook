import { Extension } from "@tiptap/react";
import { Suggestion } from "@tiptap/suggestion";
import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import type { Editor, Range } from "@tiptap/react";
import type { SuggestionKeyDownProps } from "@tiptap/suggestion";

export interface SlashCommandItem {
  title: string;
  description: string;
  command: (props: { editor: Editor; range: Range }) => void;
}

const SLASH_ITEMS: SlashCommandItem[] = [
  {
    title: "Heading 1",
    description: "Large section heading",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run();
    },
  },
  {
    title: "Heading 2",
    description: "Medium section heading",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run();
    },
  },
  {
    title: "Heading 3",
    description: "Small section heading",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run();
    },
  },
  {
    title: "Bullet List",
    description: "Unordered bullet list",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run();
    },
  },
  {
    title: "Numbered List",
    description: "Ordered numbered list",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run();
    },
  },
  {
    title: "Checklist",
    description: "Task list with checkboxes",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleTaskList().run();
    },
  },
  {
    title: "Code Block",
    description: "Fenced code block",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run();
    },
  },
  {
    title: "Quote",
    description: "Block quote",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBlockquote().run();
    },
  },
  {
    title: "Divider",
    description: "Horizontal rule",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHorizontalRule().run();
    },
  },
];

function filterItems(query: string): SlashCommandItem[] {
  return SLASH_ITEMS.filter((item) =>
    item.title.toLowerCase().includes(query.toLowerCase()),
  );
}

export interface SlashMenuState {
  items: SlashCommandItem[];
  command: ((item: SlashCommandItem) => void) | null;
  clientRect: (() => DOMRect | null) | null;
}

// Creates the tiptap extension. The onStateChange callback bridges into React state.
export function createSlashCommandExtension(
  onStateChange: (state: SlashMenuState | null) => void,
  keyDownRef: React.RefObject<((props: SuggestionKeyDownProps) => boolean) | null>,
) {
  return Extension.create({
    name: "slashCommand",

    addOptions() {
      return {
        suggestion: {
          char: "/",
          startOfLine: false,
          items: ({ query }: { query: string }) => filterItems(query),
          command: ({ editor, range, props: item }: { editor: Editor; range: Range; props: SlashCommandItem }) => {
            item.command({ editor, range });
          },
          render: () => ({
            onStart: (props: any) => {
              onStateChange({
                items: props.items,
                command: props.command,
                clientRect: props.clientRect,
              });
            },
            onUpdate: (props: any) => {
              onStateChange({
                items: props.items,
                command: props.command,
                clientRect: props.clientRect,
              });
            },
            onKeyDown: (props: SuggestionKeyDownProps) => {
              return keyDownRef.current?.(props) ?? false;
            },
            onExit: () => {
              onStateChange(null);
            },
          }),
        },
      };
    },

    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          ...this.options.suggestion,
        }),
      ];
    },
  });
}

// Floating slash command menu
export function SlashMenu({
  state,
  onKeyDownRef,
}: {
  state: SlashMenuState;
  onKeyDownRef: React.MutableRefObject<((props: SuggestionKeyDownProps) => boolean) | null>;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { items, command, clientRect } = state;

  useEffect(() => {
    setSelectedIndex(0);
  }, [items]);

  const handleKeyDown = useCallback(
    (props: SuggestionKeyDownProps) => {
      const { event } = props;
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((i) => (i + items.length - 1) % items.length);
        return true;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((i) => (i + 1) % items.length);
        return true;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (items[selectedIndex] && command) {
          command(items[selectedIndex]);
        }
        return true;
      }
      if (event.key === "Escape") {
        return true;
      }
      return false;
    },
    [items, selectedIndex, command],
  );

  // Keep the ref in sync so the extension can call onKeyDown synchronously
  useEffect(() => {
    onKeyDownRef.current = handleKeyDown;
  }, [handleKeyDown, onKeyDownRef]);

  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!clientRect) return;
    const rect = clientRect();
    if (!rect) return;
    setPos({ top: rect.bottom + 4, left: rect.left });
  }, [clientRect]);

  if (!pos || items.length === 0) return null;

  return createPortal(
    <div className="slash-menu" style={{ top: pos.top, left: pos.left }}>
      {items.map((item, index) => (
        <button
          key={item.title}
          className={`slash-menu-item ${index === selectedIndex ? "selected" : ""}`}
          onMouseDown={(e) => {
            e.preventDefault();
            command?.(item);
          }}
          onMouseEnter={() => setSelectedIndex(index)}
          type="button"
        >
          <span className="slash-menu-title">{item.title}</span>
          <span className="slash-menu-desc">{item.description}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}
