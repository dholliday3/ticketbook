import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Link from "@tiptap/extension-link";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import { common, createLowlight } from "lowlight";
import { useEffect, useRef, useState, useMemo } from "react";
import { createSlashCommandExtension, SlashMenu } from "./SlashCommand";
import type { SlashMenuState } from "./SlashCommand";
import type { SuggestionKeyDownProps } from "@tiptap/suggestion";

const lowlight = createLowlight(common);

interface TiptapEditorProps {
  content: string;
  onUpdate: (markdown: string) => void;
  ticketId: string;
}

export function TiptapEditor({ content, onUpdate, ticketId }: TiptapEditorProps) {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const suppressUpdateRef = useRef(false);

  const [slashMenuState, setSlashMenuState] = useState<SlashMenuState | null>(null);
  const keyDownRef = useRef<((props: SuggestionKeyDownProps) => boolean) | null>(null);

  const slashExtension = useMemo(
    () => createSlashCommandExtension(setSlashMenuState, keyDownRef),
    [],
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false, // replaced by CodeBlockLowlight
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      Link.configure({
        openOnClick: true,
        autolink: true,
      }),
      CodeBlockLowlight.configure({
        lowlight,
      }),
      Placeholder.configure({
        placeholder: "Type / for commands...",
      }),
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
      slashExtension,
    ],
    content,
    onUpdate: ({ editor }) => {
      if (suppressUpdateRef.current) return;
      const md = (editor.storage as Record<string, any>).markdown.getMarkdown() as string;
      onUpdateRef.current(md);
    },
  });

  // Reset content when ticket changes (suppress onUpdate to avoid spurious saves)
  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      suppressUpdateRef.current = true;
      editor.commands.setContent(content);
      suppressUpdateRef.current = false;
    }
  }, [ticketId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close slash menu when ticket changes
  useEffect(() => {
    setSlashMenuState(null);
  }, [ticketId]);

  return (
    <>
      <EditorContent className="tiptap-editor" editor={editor} />
      {slashMenuState && (
        <SlashMenu state={slashMenuState} onKeyDownRef={keyDownRef} />
      )}
    </>
  );
}
