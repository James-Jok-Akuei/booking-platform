import { useEffect, useRef, type ReactNode } from 'react';
import { Extension, markInputRule } from '@tiptap/core';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { ListItem, ListKeymap } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extensions';
import { docToRich, richToHtml, type DocNode } from '../lib/richEditor';
import './richtext.css';
import { t } from '@lingui/core/macro';

/**
 * A box for a shop's formatted words (§271) — a service's description, its
 * "before you come", the shop's own description.
 *
 * Tiptap (on ProseMirror), the editor much of the web's writing tools are
 * built on, limited to what a phone shows well: bold, italic, bullet and
 * numbered lists, paragraphs. What is stored is the plain-text form in
 * `lib/richText.ts` — WhatsApp's marks — never HTML.
 *
 * Typed the way sellers already type: "- " or "1. " starts a list, *stars*
 * make bold and _underscores_ italic, ⌘B / ⌘I too. Pasted text keeps its
 * lists and marks; pasted pages keep only those.
 */

/** WhatsApp's marks as they are typed: *bold* and _italic_. */
const ShopMarks = Extension.create({
  name: 'shopMarks',
  addInputRules() {
    const { bold, italic } = this.editor.schema.marks;
    return [
      markInputRule({ find: /(?:^|\s)(\*\*(?!\s+\*\*)((?:[^*]+))\*\*(?!\s+\*\*))$/, type: bold }),
      markInputRule({ find: /(?:^|\s)(\*(?!\s+\*)((?:[^*]+))\*(?!\s+\*))$/, type: bold }),
      markInputRule({ find: /(?:^|\s)(_(?!\s+_)((?:[^_]+))_(?!\s+_))$/, type: italic }),
    ];
  },
});

/**
 * One level of list: Tab and Shift-Tab are left to the page (they move to
 * the next field), not used to nest lists the apps do not draw.
 */
const FlatListItem = ListItem.extend({
  addKeyboardShortcuts() {
    return { Enter: () => this.editor.commands.splitListItem(this.name) };
  },
});
const FlatListKeymap = ListKeymap.extend({
  addKeyboardShortcuts() {
    const { Tab: _tab, ...rest } = this.parent?.() ?? {};
    return rest;
  },
});

const EXTENSIONS = [
  StarterKit.configure({
    blockquote: false,
    code: false,
    codeBlock: false,
    heading: false,
    horizontalRule: false,
    strike: false,
    underline: false,
    link: false,
    trailingNode: false,
    listItem: false,
    listKeymap: false,
  }),
  FlatListItem,
  FlatListKeymap,
  ShopMarks,
];

export function RichTextField({
  id,
  value,
  onChange,
  placeholder,
  maxLength,
  rows = 4,
  labelledBy,
  disabled = false,
}: {
  id?: string;
  /** The stored text. */
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
  /** Counted on the stored text, as the server counts it. */
  maxLength: number;
  /** How tall it starts, in lines. */
  rows?: number;
  labelledBy?: string;
  disabled?: boolean;
}) {
  // What this field last handed out, so a value coming back in is not
  // re-loaded under the cursor — only one set from outside is.
  const emitted = useRef(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions: [...EXTENSIONS, Placeholder.configure({ placeholder: placeholder ?? '' })],
    content: richToHtml(value),
    editable: !disabled,
    // Only the lists' and the marks' typing shortcuts; Tiptap's own "*x*"
    // would make italic where WhatsApp makes bold.
    enableInputRules: ['bulletList', 'orderedList', 'shopMarks'],
    enablePasteRules: false,
    editorProps: {
      attributes: {
        class: 'rtf-input',
        ...(id ? { id } : {}),
        role: 'textbox',
        'aria-multiline': 'true',
        ...(labelledBy ? { 'aria-labelledby': labelledBy } : {}),
        style: `min-height: ${rows * 1.55 + 1.3}em`,
      },
      // Plain text — a WhatsApp message, a note — is read as the shop's own
      // format, so its lists and marks arrive as lists and marks.
      handlePaste: (_view, event) => {
        const text = event.clipboardData?.getData('text/plain');
        if (!text || event.clipboardData?.getData('text/html')) return false;
        if (!/(^|\n)\s*([-*•]|\d{1,3}[.)])\s|[*_]/.test(text)) return false;
        editorRef.current?.commands.insertContent(richToHtml(text));
        return true;
      },
    },
    onUpdate: ({ editor: e }) => {
      const text = docToRich(e.getJSON() as DocNode);
      emitted.current = text;
      onChangeRef.current(text);
    },
  });
  const editorRef = useRef(editor);
  editorRef.current = editor;

  useEffect(() => {
    if (!editor || value === emitted.current) return;
    emitted.current = value;
    editor.commands.setContent(richToHtml(value), { emitUpdate: false });
  }, [editor, value]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  const state = useEditorState({
    editor,
    // What is on where the cursor is — said only while the box is in use, or
    // a box nobody is typing in shows a button pressed for no reason.
    selector: ({ editor: e }) => {
      const focused = e?.isFocused ?? false;
      return {
        bold: focused && (e?.isActive('bold') ?? false),
        italic: focused && (e?.isActive('italic') ?? false),
        bullets: focused && (e?.isActive('bulletList') ?? false),
        numbers: focused && (e?.isActive('orderedList') ?? false),
        focused,
      };
    },
  });

  const over = value.length > maxLength;
  const tools: Array<{ key: string; label: string; keys: string; on: boolean; run: () => void; glyph: ReactNode }> = [
    { key: 'b', label: t`Bold`, keys: '⌘B · *word*', on: state?.bold ?? false, run: () => editor?.chain().focus().toggleBold().run(), glyph: GLYPH.bold },
    { key: 'i', label: t`Italic`, keys: '⌘I · _word_', on: state?.italic ?? false, run: () => editor?.chain().focus().toggleItalic().run(), glyph: GLYPH.italic },
    { key: 'ul', label: t`Bulleted list`, keys: t`Start a line with “- ”`, on: state?.bullets ?? false, run: () => editor?.chain().focus().toggleBulletList().run(), glyph: GLYPH.bullets },
    { key: 'ol', label: t`Numbered list`, keys: t`Start a line with “1. ”`, on: state?.numbers ?? false, run: () => editor?.chain().focus().toggleOrderedList().run(), glyph: GLYPH.numbers },
  ];

  return (
    <div className={`rtf${state?.focused ? ' is-focused' : ''}${over ? ' is-over' : ''}${disabled ? ' is-disabled' : ''}`}>
      <div className="rtf-bar" role="toolbar" aria-label={t`Formatting`}>
        {tools.map((t, i) => (
          <span key={t.key} className="rtf-tool-wrap">
            {i === 2 && <i className="rtf-sep" aria-hidden="true" />}
            <button
              type="button"
              className={`rtf-tool${t.on ? ' is-on' : ''}`}
              aria-pressed={t.on}
              aria-label={t.label}
              title={`${t.label} — ${t.keys}`}
              disabled={disabled}
              // Keep the selection: a mousedown on the button would take it.
              onMouseDown={(event) => event.preventDefault()}
              onClick={t.run}
            >
              {t.glyph}
            </button>
          </span>
        ))}
        <span className={`rtf-count${over ? ' is-over' : ''}`} aria-live="polite">
          {value.length}/{maxLength}
        </span>
      </div>
      <EditorContent editor={editor} className="rtf-body" />
    </div>
  );
}

const svg = (paths: string[]) => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {paths.map((d) => (
      <path key={d} d={d} />
    ))}
  </svg>
);

const GLYPH = {
  bold: svg(['M6 12h8a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h6a4 4 0 0 1 0 8']),
  italic: svg(['M19 4h-9', 'M14 20H5', 'M15 4 9 20']),
  bullets: svg(['M3.5 6h.01', 'M3.5 12h.01', 'M3.5 18h.01', 'M8 6h13', 'M8 12h13', 'M8 18h13']),
  numbers: svg(['M10 6h11', 'M10 12h11', 'M10 18h11', 'M4 10V4L3 5', 'M6 20H3.5c0-1.2 2.5-1.8 2.5-3a1.2 1.2 0 0 0-2.3-.5']),
};
