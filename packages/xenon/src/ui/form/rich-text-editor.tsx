"use client";

import { type ComponentType, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { Placeholder } from "@tiptap/extensions";
import {
  RiArrowDownSLine, RiArrowGoBackLine, RiArrowGoForwardLine, RiBold, RiCodeBoxLine, RiCodeLine, RiCornerDownLeftLine,
  RiDoubleQuotesL, RiH1, RiH2, RiH3, RiImageAddLine, RiItalic, RiLink, RiLinkUnlink, RiListOrdered, RiListUnordered,
  RiSeparator, RiStrikethrough, RiText, RiUnderline,
} from "@remixicon/react";
import { Button } from "../components/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "../components/dropdown-menu";
import { Input } from "../components/input";
import { Label } from "../components/label";
import { Popover, PopoverContent, PopoverTrigger } from "../components/popover";
import { Separator } from "../components/separator";
import { Skeleton } from "../components/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/tooltip";
import { cn } from "../lib/utils";
import { usePortalContainer } from "../lib/portal-container";
import { useAdmin } from "../shared/admin-context";
import { toPlainJson } from "../shared/plain";
import type { FieldInputProps } from "./field-types";
import { MediaPicker } from "./media-picker";
import { EMPTY_RICH_TEXT, normalizeRichText, richTextExtensions } from "./rich-text-schema";
import { SlashCommand, SlashMenuStore, type SlashItem } from "./slash-command";

type Icon = ComponentType<{ className?: string }>;

/* ------------------------------------------------------------------ commands */

interface BlockType { id: string; label: string; icon: Icon; isActive(editor: Editor): boolean; run(editor: Editor): void }

const BLOCK_TYPES: BlockType[] = [
  { id: "paragraph", label: "Text", icon: RiText, isActive: (e) => e.isActive("paragraph"), run: (e) => e.chain().focus().setParagraph().run() },
  ...([1, 2, 3] as const).map((level): BlockType => ({
    id: `h${level}`, label: `Heading ${level}`, icon: [RiH1, RiH2, RiH3][level - 1]!,
    isActive: (e) => e.isActive("heading", { level }), run: (e) => e.chain().focus().setHeading({ level }).run(),
  })),
  { id: "bulletList", label: "Bulleted list", icon: RiListUnordered, isActive: (e) => e.isActive("bulletList"), run: (e) => e.chain().focus().toggleBulletList().run() },
  { id: "orderedList", label: "Numbered list", icon: RiListOrdered, isActive: (e) => e.isActive("orderedList"), run: (e) => e.chain().focus().toggleOrderedList().run() },
  { id: "blockquote", label: "Quote", icon: RiDoubleQuotesL, isActive: (e) => e.isActive("blockquote"), run: (e) => e.chain().focus().toggleBlockquote().run() },
  { id: "codeBlock", label: "Code block", icon: RiCodeBoxLine, isActive: (e) => e.isActive("codeBlock"), run: (e) => e.chain().focus().toggleCodeBlock().run() },
];

/** The block shown in the toolbar: wrappers (lists, quote) win over the paragraph inside them. */
function currentBlock(editor: Editor): BlockType {
  const order = ["codeBlock", "bulletList", "orderedList", "blockquote", "h1", "h2", "h3"];
  return order.map((id) => BLOCK_TYPES.find((b) => b.id === id)!).find((b) => b.isActive(editor)) ?? BLOCK_TYPES[0]!;
}

const MARKS: { name: string; label: string; shortcut?: string; icon: Icon; run(editor: Editor): void }[] = [
  { name: "bold", label: "Bold", shortcut: "⌘B", icon: RiBold, run: (e) => e.chain().focus().toggleBold().run() },
  { name: "italic", label: "Italic", shortcut: "⌘I", icon: RiItalic, run: (e) => e.chain().focus().toggleItalic().run() },
  { name: "underline", label: "Underline", shortcut: "⌘U", icon: RiUnderline, run: (e) => e.chain().focus().toggleUnderline().run() },
  { name: "strike", label: "Strikethrough", shortcut: "⌘⇧S", icon: RiStrikethrough, run: (e) => e.chain().focus().toggleStrike().run() },
  { name: "code", label: "Inline code", shortcut: "⌘E", icon: RiCodeLine, run: (e) => e.chain().focus().toggleCode().run() },
];

function slashItems(openImages: (() => void) | null): SlashItem[] {
  const items: SlashItem[] = [
    { id: "text", title: "Text", description: "Plain paragraph", group: "Basic blocks", keywords: ["paragraph", "p"], icon: RiText, run: (e) => e.chain().focus().setParagraph().run() },
    { id: "h1", title: "Heading 1", description: "Large section title", group: "Basic blocks", keywords: ["h1", "title"], icon: RiH1, run: (e) => e.chain().focus().setHeading({ level: 1 }).run() },
    { id: "h2", title: "Heading 2", description: "Medium section title", group: "Basic blocks", keywords: ["h2", "subtitle"], icon: RiH2, run: (e) => e.chain().focus().setHeading({ level: 2 }).run() },
    { id: "h3", title: "Heading 3", description: "Small section title", group: "Basic blocks", keywords: ["h3"], icon: RiH3, run: (e) => e.chain().focus().setHeading({ level: 3 }).run() },
    { id: "quote", title: "Quote", description: "Highlight a quotation", group: "Basic blocks", keywords: ["blockquote", "citation"], icon: RiDoubleQuotesL, run: (e) => e.chain().focus().setBlockquote().run() },
    { id: "code", title: "Code block", description: "Monospaced code snippet", group: "Basic blocks", keywords: ["pre", "snippet"], icon: RiCodeBoxLine, run: (e) => e.chain().focus().setCodeBlock().run() },
    { id: "bullet", title: "Bulleted list", description: "A simple list", group: "Lists", keywords: ["ul", "unordered", "bullet"], icon: RiListUnordered, run: (e) => e.chain().focus().toggleBulletList().run() },
    { id: "numbered", title: "Numbered list", description: "A list with numbers", group: "Lists", keywords: ["ol", "ordered", "number"], icon: RiListOrdered, run: (e) => e.chain().focus().toggleOrderedList().run() },
    { id: "divider", title: "Divider", description: "Separate sections", group: "Media", keywords: ["hr", "rule", "line", "separator"], icon: RiSeparator, run: (e) => e.chain().focus().setHorizontalRule().run() },
  ];
  if (openImages) items.push({ id: "image", title: "Image", description: "From your media library", group: "Media", keywords: ["picture", "photo", "media", "img"], icon: RiImageAddLine, run: () => openImages() });
  return items;
}

/* ------------------------------------------------------------------ toolbar */

function ToolButton({ label, shortcut, icon: IconComponent, active, disabled, onClick, buttonRef }: {
  label: string; shortcut?: string; icon: Icon; active?: boolean; disabled?: boolean; onClick(): void; buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  return <Tooltip><TooltipTrigger render={<Button ref={buttonRef} type="button" variant="ghost" size="icon-sm" aria-label={label} aria-pressed={active}
    disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={onClick}
    className={cn("xe:text-muted-foreground xe:hover:text-foreground", active && "xe:bg-accent xe:text-foreground")} />}>
    <IconComponent className="xe:size-4" /></TooltipTrigger>
    <TooltipContent>{label}{shortcut ? <span className="xe:ml-2 xe:text-muted-foreground">{shortcut}</span> : null}</TooltipContent></Tooltip>;
}

export function normalizeUrl(input: string): string | null {
  const value = input.trim();
  if (!value) return "";
  if (/[\u0000-\u001f\u007f]/.test(value) || /^([/\\]{2}|\\)/.test(value)) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("/") || value.startsWith("#") ? value : `https://${value}`;
  if (candidate.startsWith("/") || candidate.startsWith("#")) return candidate;
  try {
    const url = new URL(candidate);
    if ((url.protocol === "http:" || url.protocol === "https:") && !/^https?:\/\//i.test(candidate)) return null;
    return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol) ? candidate : null;
  } catch { return null; }
}

/** Applies (or removes, when empty) a link on the selection. Returns an error message, if any. */
function applyLink(editor: Editor, input: string): string | null {
  const href = normalizeUrl(input);
  if (href === null) return "Enter a web address, such as example.com or https://example.com.";
  if (href === "") editor.chain().focus().extendMarkRange("link").unsetLink().run();
  else editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
  return null;
}

function LinkForm({ editor, onDone, autoFocus = true, compact = false }: { editor: Editor; onDone(): void; autoFocus?: boolean; compact?: boolean }) {
  const id = useId();
  const existing = (editor.getAttributes("link").href as string | undefined) ?? "";
  const [value, setValue] = useState(existing);
  const [error, setError] = useState("");
  function submit() {
    const message = applyLink(editor, value);
    if (message) setError(message); else onDone();
  }
  return <div className={cn("xe:flex xe:flex-col xe:gap-2", compact && "xe:w-72")}>
    {!compact ? <Label htmlFor={id}>Link</Label> : null}
    <div className="xe:flex xe:items-center xe:gap-1.5">
      <Input id={id} value={value} autoFocus={autoFocus} placeholder="Paste or type a link" aria-label="Link address" aria-invalid={!!error}
        className={cn(compact && "xe:h-8")} onChange={(event) => { setValue(event.target.value); setError(""); }}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submit(); } else if (event.key === "Escape") { event.preventDefault(); onDone(); editor.commands.focus(); } }} />
      <Button type="button" size="icon-sm" variant="ghost" aria-label="Apply link" onClick={submit}><RiCornerDownLeftLine /></Button>
      {existing ? <Button type="button" size="icon-sm" variant="ghost" aria-label="Remove link" onClick={() => { editor.chain().focus().extendMarkRange("link").unsetLink().run(); onDone(); }}><RiLinkUnlink /></Button> : null}
    </div>
    {error ? <p role="alert" className="xe:text-xs xe:text-destructive">{error}</p> : null}
  </div>;
}

function Toolbar({ editor, disabled, onImage, imageButton, canvas }: { editor: Editor; disabled?: boolean; onImage: (() => void) | null; imageButton: React.RefObject<HTMLButtonElement | null>; canvas?: boolean }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const state = useEditorState({ editor, selector: ({ editor: e }) => ({
    block: currentBlock(e).id,
    marks: MARKS.filter((mark) => e.isActive(mark.name)).map((mark) => mark.name),
    link: e.isActive("link"),
    undo: e.can().undo(), redo: e.can().redo(),
  }) });
  const block = BLOCK_TYPES.find((b) => b.id === state.block) ?? BLOCK_TYPES[0]!;
  return <div role="toolbar" aria-label="Formatting" aria-orientation="horizontal"
    className={cn("xe:sticky xe:top-12 xe:z-10 xe:flex xe:items-center xe:gap-0.5 xe:overflow-x-auto xe:[scrollbar-width:none] xe:lg:top-0",
      canvas ? "xe:-mx-2 xe:border-y xe:border-rule xe:bg-background xe:px-1 xe:py-1.5 xe:font-sans" : "xe:rounded-t-md xe:border-b xe:border-border xe:bg-card xe:px-1.5 xe:py-1")}>
    <DropdownMenu>
      <DropdownMenuTrigger disabled={disabled} render={<Button type="button" variant="ghost" size="sm" className="xe:w-36 xe:shrink-0 xe:justify-between xe:font-normal" aria-label={`Block type: ${block.label}`} onMouseDown={(event) => event.preventDefault()} />}>
        <span className="xe:flex xe:items-center xe:gap-1.5"><block.icon className="xe:size-4 xe:text-muted-foreground" />{block.label}</span><RiArrowDownSLine className="xe:size-4 xe:text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="xe:w-48" finalFocus={false}>
        <DropdownMenuGroup>{BLOCK_TYPES.map((item) => <DropdownMenuItem key={item.id} onClick={() => item.run(editor)} className={cn(item.id === block.id && "xe:bg-accent")}>
          <item.icon />{item.label}</DropdownMenuItem>)}</DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
    <Separator orientation="vertical" className="xe:mx-1 xe:h-5" />
    {MARKS.map((mark) => <ToolButton key={mark.name} label={mark.label} shortcut={mark.shortcut} icon={mark.icon} active={state.marks.includes(mark.name)} disabled={disabled} onClick={() => mark.run(editor)} />)}
    <Separator orientation="vertical" className="xe:mx-1 xe:h-5" />
    <Popover open={linkOpen} onOpenChange={setLinkOpen}>
      <Tooltip><TooltipTrigger render={<PopoverTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label="Link" aria-pressed={state.link} disabled={disabled}
        onMouseDown={(event) => event.preventDefault()} className={cn("xe:text-muted-foreground xe:hover:text-foreground", state.link && "xe:bg-accent xe:text-foreground")} />} />}><RiLink className="xe:size-4" /></TooltipTrigger>
        <TooltipContent>Link<span className="xe:ml-2 xe:text-muted-foreground">⌘K</span></TooltipContent></Tooltip>
      <PopoverContent className="xe:w-80">{linkOpen ? <LinkForm editor={editor} onDone={() => setLinkOpen(false)} /> : null}</PopoverContent>
    </Popover>
    {onImage ? <ToolButton label="Image" icon={RiImageAddLine} disabled={disabled} onClick={onImage} buttonRef={imageButton} /> : null}
    <ToolButton label="Divider" icon={RiSeparator} disabled={disabled} onClick={() => editor.chain().focus().setHorizontalRule().run()} />
    <div className="xe:ml-auto xe:flex xe:shrink-0 xe:items-center xe:gap-0.5 xe:pl-2">
      <ToolButton label="Undo" shortcut="⌘Z" icon={RiArrowGoBackLine} disabled={disabled || !state.undo} onClick={() => editor.chain().focus().undo().run()} />
      <ToolButton label="Redo" shortcut="⌘⇧Z" icon={RiArrowGoForwardLine} disabled={disabled || !state.redo} onClick={() => editor.chain().focus().redo().run()} />
    </div>
  </div>;
}

/* ------------------------------------------------------------------ bubble menu (selection) */

/** Where the selection bubble goes: above the selection start, or null when it should be hidden. */
function bubbleAnchor(editor: Editor, linking: boolean): { top: number; left: number; bottom: number } | null {
  const { state, view } = editor;
  const { selection } = state;
  const focused = view.hasFocus() || linking;
  if (!editor.isEditable || !focused || selection.empty || !(selection instanceof TextSelection) || editor.isActive("codeBlock")) return null;
  try {
    const start = view.coordsAtPos(selection.from);
    const end = view.coordsAtPos(selection.to, -1);
    return { top: Math.min(start.top, end.top), bottom: Math.max(start.bottom, end.bottom), left: start.left };
  } catch {
    return null;
  }
}

/*
 * Selection bubble (marks + link). Positioned from ProseMirror's own coordinates instead of
 * @tiptap/extension-bubble-menu, which pulls in prosemirror-tables; under Turbopack that module was
 * evaluated twice during SSR ("Duplicate use of selection JSON ID cell").
 */
function SelectionMenu({ editor, container, linking, setLinking }: { editor: Editor; container: HTMLElement; linking: boolean; setLinking(value: boolean): void }) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<{ top: number; left: number; bottom: number } | null>(null);
  const linkingRef = useRef(linking);
  linkingRef.current = linking;
  const state = useEditorState({ editor, selector: ({ editor: e }) => ({
    marks: MARKS.filter((mark) => e.isActive(mark.name)).map((mark) => mark.name), link: e.isActive("link"),
  }) });

  useEffect(() => {
    let frame = 0;
    const update = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => setAnchor(bubbleAnchor(editor, linkingRef.current))); };
    const onSelection = () => { if (editor.state.selection.empty) setLinking(false); update(); };
    const onBlur = ({ event }: { event: FocusEvent }) => {
      // Keep the bubble while focus moves into it (the link field).
      if (event.relatedTarget instanceof Node && menuRef.current?.contains(event.relatedTarget)) return;
      setLinking(false); update();
    };
    editor.on("selectionUpdate", onSelection);
    editor.on("transaction", update);
    editor.on("focus", update);
    editor.on("blur", onBlur);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      editor.off("selectionUpdate", onSelection);
      editor.off("transaction", update);
      editor.off("focus", update);
      editor.off("blur", onBlur);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [editor, setLinking]);
  useEffect(() => { setAnchor(bubbleAnchor(editor, linking)); }, [editor, linking]);

  // Keep the bubble inside the viewport; flip below the selection when there's no room above.
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (el && (el.offsetWidth !== size.width || el.offsetHeight !== size.height)) setSize({ width: el.offsetWidth, height: el.offsetHeight });
  });
  if (!anchor) return null;
  const above = anchor.top - size.height - 8 >= 64; // stay clear of the sticky top bar
  const top = above ? anchor.top - size.height - 8 : anchor.bottom + 8;
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - size.width - 8));

  return createPortal(<div ref={menuRef} role="toolbar" aria-label="Selection formatting" style={{ top, left, visibility: size.width ? "visible" : "hidden" }}
    onMouseDown={(event) => { if (!(event.target instanceof HTMLInputElement)) event.preventDefault(); }}
    className="xe:fixed xe:z-50 xe:flex xe:items-center xe:gap-0.5 xe:rounded-lg xe:border xe:border-border xe:bg-popover xe:p-1 xe:text-popover-foreground xe:shadow-lg xe:animate-in xe:fade-in-0 xe:zoom-in-95 xe:duration-100">
    {linking ? <div className="xe:p-1"><LinkForm compact editor={editor} onDone={() => setLinking(false)} /></div> : <>
      {MARKS.map((mark) => <ToolButton key={mark.name} label={mark.label} shortcut={mark.shortcut} icon={mark.icon} active={state.marks.includes(mark.name)} onClick={() => mark.run(editor)} />)}
      <Separator orientation="vertical" className="xe:mx-0.5 xe:h-5" />
      <ToolButton label={state.link ? "Edit link" : "Link"} icon={RiLink} active={state.link} onClick={() => setLinking(true)} />
    </>}
  </div>, container);
}

/* ------------------------------------------------------------------ slash menu */

function SlashMenu({ store, container }: { store: SlashMenuStore; container: HTMLElement }) {
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  const listRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    listRef.current?.querySelector(`[data-index="${state.active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [state.active]);
  if (!state.open || !state.rect) return null;

  const height = 320;
  const below = state.rect.bottom + 6 + height <= window.innerHeight || state.rect.top < height;
  const style = below
    ? { top: state.rect.bottom + 6, left: Math.min(state.rect.left, window.innerWidth - 296) }
    : { bottom: window.innerHeight - state.rect.top + 6, left: Math.min(state.rect.left, window.innerWidth - 296) };

  let lastGroup = "";
  return createPortal(<div role="listbox" aria-label="Insert block" ref={listRef} style={{ ...style, maxHeight: height }}
    onMouseDown={(event) => event.preventDefault()}
    className="xe:fixed xe:z-50 xe:w-72 xe:overflow-y-auto xe:overscroll-contain xe:[scrollbar-width:thin] xe:rounded-lg xe:border xe:border-border xe:bg-popover xe:p-1 xe:text-popover-foreground xe:shadow-lg xe:animate-in xe:fade-in-0 xe:zoom-in-95 xe:duration-100">
    {state.items.length === 0 ? <p className="xe:px-2 xe:py-6 xe:text-center xe:text-sm xe:text-muted-foreground">No matching blocks</p> :
      state.items.map((item, index) => {
        const heading = item.group !== lastGroup ? item.group : null;
        lastGroup = item.group;
        return <div key={item.id}>
          {heading ? <p className="xe:px-2 xe:pt-2 xe:pb-1 xe:text-[11px] xe:font-medium xe:text-muted-foreground">{heading}</p> : null}
          <div role="option" aria-selected={index === state.active} data-index={index}
            onMouseMove={() => store.setActive(index)} onClick={() => store.choose(index)}
            className={cn("xe:flex xe:cursor-pointer xe:items-center xe:gap-3 xe:rounded-md xe:px-2 xe:py-1.5", index === state.active && "xe:bg-accent")}>
            <span className="xe:grid xe:size-8 xe:shrink-0 xe:place-items-center xe:rounded-md xe:border xe:border-border xe:bg-background"><item.icon className="xe:size-4" /></span>
            <span className="xe:min-w-0"><span className="xe:block xe:text-sm xe:font-medium">{item.title}</span><span className="xe:block xe:truncate xe:text-xs xe:text-muted-foreground">{item.description}</span></span>
          </div>
        </div>;
      })}
  </div>, container);
}

/* ------------------------------------------------------------------ editor */

export function RichTextEditor(props: FieldInputProps) {
  const { collections } = useAdmin();
  const container = usePortalContainer();
  const disabled = props.disabled || props.field.admin.readOnly;
  const media = collections.find((collection) => collection.upload);
  const [imagesOpen, setImagesOpen] = useState(false);
  const imageButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const openImagesRef = useRef<(() => void) | null>(null);
  const store = useMemo(() => new SlashMenuStore(() => slashItems(openImagesRef.current ? () => openImagesRef.current?.() : null)), []);
  const placeholder = props.field.admin.placeholder ?? "Start writing, or press / for blocks…";
  const canvas = props.variant === "canvas";
  const contentClass = canvas ? "xe-prose xe-prose-lg xe:min-h-[50vh] xe:pt-6 xe:pb-24 xe:outline-none" : "xe-prose xe:min-h-72 xe:px-5 xe:py-4 xe:outline-none";

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      ...richTextExtensions,
      Placeholder.configure({
        placeholder: ({ editor: e, node }) => e.isEmpty ? placeholder : node.type.name === "heading" ? `Heading ${node.attrs.level}` : "Press / for blocks",
      }),
      SlashCommand.configure({ store }),
    ],
    content: props.value && typeof props.value === "object" ? props.value : EMPTY_RICH_TEXT,
    editable: !disabled,
    editorProps: { attributes: { id: props.id, class: contentClass, role: "textbox", "aria-multiline": "true", "aria-labelledby": `${props.id}-label` } },
    // ProseMirror attrs are null-prototype objects; the form state must hold plain JSON (see toPlainJson).
    onUpdate: ({ editor: instance }) => props.onChange(toPlainJson(instance.getJSON())),
  });
  // `setEditable` emits an update by default, which would report an edit on mount and after every save.
  useEffect(() => { editor?.setEditable(!disabled, false); }, [editor, disabled]);
  useEffect(() => {
    if (!editor) return;
    const content = props.value && typeof props.value === "object" ? props.value : EMPTY_RICH_TEXT;
    // Compare in normalized form so stored key order / missing default attrs don't reset the editor (and cursor).
    if (JSON.stringify(editor.getJSON()) !== JSON.stringify(normalizeRichText(content))) editor.commands.setContent(content, { emitUpdate: false });
  }, [editor, props.value]);
  useEffect(() => { if (editor) editor.setOptions({ editorProps: { attributes: { id: props.id, class: contentClass, role: "textbox", "aria-multiline": "true", "aria-labelledby": `${props.id}-label`, "aria-invalid": String(props["aria-invalid"] ?? false), "aria-describedby": props["aria-describedby"] ?? "" } } }); }, [editor, props.id, props["aria-invalid"], props["aria-describedby"], contentClass]);
  // ⌘K with text selected opens the link field instead of the command palette.
  const [linking, setLinking] = useState(false);

  if (!editor) return <Skeleton className={canvas ? "xe:h-[50vh] xe:w-full" : "xe:h-80 xe:w-full"} />;
  const openImages = media ? () => { returnFocus.current = imageButton.current; setImagesOpen(true); } : null;
  openImagesRef.current = media ? () => { returnFocus.current = editor.view.dom; setImagesOpen(true); } : null;

  return <div data-invalid={props["aria-invalid"] || undefined}
    onKeyDownCapture={(event) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "k" && editor.isFocused && !editor.state.selection.empty) {
        event.preventDefault(); event.stopPropagation(); setLinking(true);
      }
    }}
    className={canvas ? "" : "xe:rounded-md xe:border xe:border-input xe:bg-card xe:transition-[border-color,box-shadow] xe:focus-within:border-foreground/25 xe:focus-within:ring-[3px] xe:focus-within:ring-ring/60 xe:data-invalid:border-destructive"}>
    <Toolbar editor={editor} disabled={disabled} onImage={openImages} imageButton={imageButton} canvas={canvas} />
    <EditorContent editor={editor} />
    {container && !disabled ? <SelectionMenu editor={editor} container={container} linking={linking} setLinking={setLinking} /> : null}
    {container ? <SlashMenu store={store} container={container} /> : null}
    {media ? <MediaPicker returnFocus={returnFocus} open={imagesOpen} onOpenChange={setImagesOpen} collection={media.slug} imagesOnly onChoose={(docs) => {
      const doc = docs[0]; if (doc?.url) editor.chain().focus().setImage({ src: doc.url, alt: doc.title }).run();
    }} /> : null}
  </div>;
}
