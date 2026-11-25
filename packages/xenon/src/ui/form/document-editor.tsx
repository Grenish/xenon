"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { RiMoreLine, RiDeleteBinLine, RiEditLine, RiEyeOffLine, RiLockLine, RiSave3Line } from "@remixicon/react";
import { StatusBadge, timeAgo, formatDate } from "../admin/format";
import { registerDirtyBlocker } from "../admin/dirty-guard";
import { useShellBar } from "../admin/shell-bar";
import { AvatarStack, displayName, type DocPresence, PersonAvatar, useDocPresence } from "../admin/presence";
import { Alert, AlertDescription, AlertTitle } from "../components/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/alert-dialog";
import { Button } from "../components/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../components/dropdown-menu";
import { Spinner } from "../components/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/tooltip";
import { useAdmin } from "../shared/admin-context";
import type { ClientCollection } from "../shared/client-config";
import { useAdminRouter } from "../shared/router";
import { adminRoutes, type ActionResult, type AdminDoc } from "../shared/services";
import { FileDropzone } from "./file-dropzone";
import { FormRenderer } from "./form-renderer";
import { RichTextEditor } from "./rich-text-editor";
import { Kbd } from "../components/kbd";
import { richTextToPlainText } from "../../react/rich-text";
import type { RichTextDocument } from "../../core/types";
import { documentTitle, initialData, normalizeFormData, validateFields } from "./model";

export function DocumentEditor({ collection, doc }: { collection: ClientCollection; doc: AdminDoc | null }) {
  const { basePath, services } = useAdmin();
  const router = useAdminRouter();
  const [current, setCurrent] = useState(doc);
  const [data, setData] = useState<Record<string, unknown>>(() => initialData(collection, doc));
  const [baseline, setBaseline] = useState(() => JSON.stringify(initialData(collection, doc)));
  const [file, setFile] = useState<File | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [pending, setPending] = useState<"save" | "publish" | "unpublish" | "remove" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingLeave, setPendingLeave] = useState<{ proceed: () => void } | null>(null);
  /** A save was refused because someone saved a newer version: theirs, and which save we attempted. */
  const [conflict, setConflict] = useState<{ latest: AdminDoc; draft: boolean } | null>(null);
  const busy = useRef(false);
  const leaving = useRef(false);
  const alertRef = useRef<HTMLDivElement>(null);
  const actionsButton = useRef<HTMLButtonElement>(null);
  const isDraftsEnabled = collection.drafts && !collection.upload;
  const dirty = JSON.stringify(data) !== baseline || file !== null;
  const title = documentTitle(collection, data);
  const canvasId = useId();
  // Document canvas: the title field and the first rich-text field form the writing surface.
  const titleField = collection.fields.find((field) => field.name === collection.admin.useAsTitle && (field.type === "text" || field.type === "textarea") && !field.admin.hidden);
  const bodyField = collection.fields.find((field) => field.type === "richText" && !field.admin.hidden && field.admin.position !== "sidebar");
  const canvasMode = !collection.upload && !!(titleField || bodyField);
  const presence = useDocPresence({ collection: collection.slug, id: current?.id ?? null, title, version: current?.updatedAt ?? null, edit: true });
  // Soft lock: while someone else holds it this tab is read-only (until it takes over).
  const readOnly = presence.mode !== "editing";
  const locked = !!pending || readOnly;

  useEffect(() => {
    if (!dirty) return;
    leaving.current = false;
    const currentHref = location.pathname + location.search + location.hash;
    const priorState = window.history.state;
    const hadGuard = Boolean(priorState && typeof priorState === "object" && (priorState as { __xeDirtyGuard?: boolean }).__xeDirtyGuard);
    const guardedState =
      priorState && typeof priorState === "object"
        ? { ...(priorState as Record<string, unknown>), __xeDirtyGuard: true }
        : { __xeDirtyGuard: true };
    if (!hadGuard) window.history.pushState(guardedState, "", currentHref);

    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!target || target.target === "_blank" || target.hasAttribute("download")) return;
      const destination = new URL(target.href, location.href);
      if (destination.origin === location.origin && destination.pathname === location.pathname && destination.search === location.search) return;
      // In-app links: ask with our own dialog instead of the browser's confirm().
      event.preventDefault(); event.stopPropagation();
      const href = destination.origin === location.origin ? destination.pathname + destination.search + destination.hash : destination.href;
      setPendingLeave({
        proceed: () => {
          if (/^https?:/i.test(href)) location.assign(href);
          else if (!hadGuard) router.replace(href);
          else router.push(href);
        },
      });
    };
    const popState = () => {
      if (leaving.current) return;
      window.history.pushState(guardedState, "", currentHref);
      setPendingLeave({
        proceed: () => {
          window.history.go(-2);
        },
      });
    };
    const unregister = registerDirtyBlocker({
      confirm: (proceed) => setPendingLeave({ proceed: () => proceed(!hadGuard) }),
    });
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("popstate", popState);
    document.addEventListener("click", click, true);
    return () => {
      unregister();
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("popstate", popState);
      document.removeEventListener("click", click, true);
      const onSamePage = location.pathname + location.search + location.hash === currentHref;
      const onGuard = Boolean(window.history.state && typeof window.history.state === "object" && (window.history.state as { __xeDirtyGuard?: boolean }).__xeDirtyGuard);
      if (!leaving.current && !hadGuard && onSamePage && onGuard) {
        window.history.back();
      }
    };
  }, [dirty, router]);

  function showError(result: Extract<ActionResult<unknown>, { ok: false }>) {
    const fields: Record<string, string> = {};
    const messages: string[] = [];
    for (const issue of result.error.issues ?? []) {
      const key = issue.path[0];
      if (typeof key === "string" && collection.fields.some((field) => field.name === key)) fields[key] = issue.message;
      else messages.push(issue.message);
    }
    setFieldErrors(fields);
    setFormError(messages.length ? [...new Set(messages)].join(" ") : Object.keys(fields).length ? "Please check the highlighted fields." : result.error.message);
    toast.error(result.error.message);
    requestAnimationFrame(() => alertRef.current?.focus());
  }

  function accept(saved: AdminDoc) {
    const next = initialData(collection, saved);
    setCurrent(saved); setData(next); setBaseline(JSON.stringify(next)); setFile(null);
    setFieldErrors({}); setFormError("");
  }

  async function save(draft: boolean, expectedUpdatedAt = current?.updatedAt) {
    if (busy.current || readOnly) return;
    const errors = validateFields(collection.fields, data, draft);
    setFieldErrors(errors); setFormError("");
    if (Object.keys(errors).length) { setFormError("Please check the highlighted fields."); requestAnimationFrame(() => alertRef.current?.focus()); return; }
    if (collection.upload && !current && !file) { setFormError("Choose a file before saving."); return; }
    busy.current = true;
    setPending(draft ? "save" : "publish");
    try {
      const payload = normalizeFormData(collection.fields, data);
      const result = collection.upload && file ? await services.upload({ collection: collection.slug, id: current?.id, file, data: payload, expectedUpdatedAt }) :
        await services.save({ collection: collection.slug, id: current?.id, data: payload, draft, expectedUpdatedAt });
      if (!result.ok) {
        if (current && isStale(result)) {
          // Someone saved after we loaded: fetch their version (one read) and let the user decide.
          const latest = await services.get({ collection: collection.slug, id: current.id });
          if (latest.ok) { setConflict({ latest: latest.data, draft }); return; }
        }
        showError(result);
        return;
      }
      if (!current) leaving.current = true;
      accept(result.data);
      toast.success(draft ? "Draft saved" : isDraftsEnabled ? "Published" : "Changes saved");
      if (!current) router.replace(adminRoutes.edit(basePath, collection.slug, result.data.id));
    } catch { setFormError("Your changes could not be saved. Check your connection and try again."); toast.error("Could not save changes"); }
    finally { busy.current = false; setPending(null); }
  }

  async function unpublish() {
    if (!current || busy.current) return;
    busy.current = true; setPending("unpublish");
    try {
      const result = await services.unpublish({ collection: collection.slug, id: current.id });
      if (!result.ok) { showError(result); return; }
      setCurrent(result.data);
      // Preserve unsaved editor input while changing the publication state.
      if (!dirty) accept(result.data);
      toast.success("Unpublished");
    } catch { toast.error("Could not unpublish. Try again."); }
    finally { busy.current = false; setPending(null); }
  }

  async function remove() {
    if (!current || busy.current) return;
    busy.current = true; setPending("remove");
    try {
      const result = await services.remove({ collection: collection.slug, id: current.id });
      if (!result.ok) { showError(result); return; }
      leaving.current = true;
      setConfirmDelete(false); setBaseline(JSON.stringify(data)); setFile(null);
      toast.success(`${collection.labels.singular} deleted`);
      router.replace(adminRoutes.list(basePath, collection.slug));
    } catch { toast.error("Could not delete this item. Try again."); }
    finally { busy.current = false; setPending(null); }
  }

  // Someone else saved a newer version while this tab only watches (or hasn't touched anything):
  // load it so viewers always see the latest content. Costs one read per save, not per heartbeat.
  const newest = presence.peers.reduce<string | null>((max, p) => (p.version && (!max || p.version > max) ? p.version : max), null);
  const fetched = useRef<string | null>(null);
  useEffect(() => {
    if (!current || !newest || dirty || pending || newest <= current.updatedAt || fetched.current === newest) return;
    fetched.current = newest;
    const by = presence.peers.find((p) => p.version === newest);
    void services.get({ collection: collection.slug, id: current.id }).then((result) => {
      if (!result.ok || result.data.updatedAt <= (current?.updatedAt ?? "")) return;
      accept(result.data);
      toast(`${by ? displayName(by.user) : "Someone"} saved changes`, { description: "You're seeing the latest version." });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newest, dirty, pending, current?.updatedAt]);

  const shortcut = useRef(save);
  shortcut.current = save;
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !(event.metaKey || event.ctrlKey) || event.altKey || event.repeat) return;
      if (event.target instanceof Element && event.target.closest('[role="dialog"], [role="alertdialog"]')) return;
      if (event.key.toLowerCase() === "s") { event.preventDefault(); event.stopPropagation(); void shortcut.current(isDraftsEnabled); }
      else if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); void shortcut.current(false); }
    };
    // Capture phase: the rich-text editor binds Mod-Enter (hard break) and would swallow the publish shortcut.
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, [isDraftsEnabled]);

  const change = (name: string, value: unknown) => {
    setData((previous) => ({ ...previous, [name]: value }));
    setFieldErrors((previous) => { if (!(name in previous)) return previous; const next = { ...previous }; delete next[name]; return next; });
  };
  const conflictAuthor = conflict ? (() => { const p = presence.peers.find((peer) => peer.version === conflict.latest.updatedAt); return p ? displayName(p.user) : null; })() : null;
  const saveState = readOnly ? "Read-only" : pending === "remove" ? "Deleting…" : pending === "unpublish" ? "Unpublishing…" : pending ? "Saving…" : dirty ? "Unsaved changes" : current ? `Saved ${timeAgo(current.updatedAt)}` : "Not saved yet";
  const words = bodyField ? richTextToPlainText(data[bodyField.name] as RichTextDocument | null).trim().split(/\s+/).filter(Boolean).length : 0;
  const propertyFields = canvasMode ? collection.fields.filter((field) => field !== titleField && field !== bodyField) : collection.fields.filter((field) => field.admin.position === "sidebar");

  const docLabel = current || dirty ? title : `New ${collection.labels.singular.toLowerCase()}`;
  useShellBar({
    crumbs: [{ label: collection.labels.plural, href: adminRoutes.list(basePath, collection.slug) }, { label: docLabel }],
    status: <>
      {presence.peers.length ? <AvatarStack peers={presence.peers} max={3} ringClass="xe:ring-frame" /> : null}
      {isDraftsEnabled ? <StatusBadge status={current?.status ?? "draft"} changed={current?.hasUnpublishedChanges || dirty && current?.status === "published"} className="xe:hidden xe:sm:inline-flex" /> : null}
      <p className="xe:hidden xe:text-[13px] xe:text-muted-foreground xe:md:block" aria-live="polite" suppressHydrationWarning>{saveState}</p>
    </>,
    actions: readOnly ? <div className="xe:flex xe:items-center xe:gap-1.5">
      <Button type="button" onClick={presence.takeover}><RiEditLine data-icon="inline-start" />{presence.mode === "taken" && !presence.holder ? "Continue editing" : "Take over"}</Button>
    </div> : <div className="xe:flex xe:items-center xe:gap-1.5">
      {isDraftsEnabled ? <Button type="button" variant="outline" className="xe:hidden xe:sm:inline-flex" disabled={!!pending} onClick={() => void save(true)}>{pending === "save" ? <Spinner /> : null}Save draft</Button> : null}
      <Button type="button" disabled={!!pending} onClick={() => void save(false)}>{pending === "publish" ? <Spinner /> : null}{isDraftsEnabled ? "Publish" : "Save"}</Button>
      {current ? <DropdownMenu><DropdownMenuTrigger ref={actionsButton} render={<Button type="button" variant="ghost" size="icon" aria-label="More document actions" disabled={!!pending} />}><RiMoreLine /></DropdownMenuTrigger>
        <DropdownMenuContent align="end"><DropdownMenuGroup>
          {isDraftsEnabled ? <DropdownMenuItem className="xe:sm:hidden" onClick={() => void save(true)}><RiSave3Line />Save draft</DropdownMenuItem> : null}
          {isDraftsEnabled && current.status === "published" ? <><DropdownMenuItem onClick={() => void unpublish()}><RiEyeOffLine />Unpublish</DropdownMenuItem><DropdownMenuSeparator /></> : null}
          <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete(true)}><RiDeleteBinLine />Delete</DropdownMenuItem>
        </DropdownMenuGroup></DropdownMenuContent>
      </DropdownMenu> : null}
    </div>,
  });

  const hasPublishing = isDraftsEnabled || collection.slugFrom || current?.slug;
  const visibleProperties = propertyFields.some((field) => !field.admin.hidden);

  // Full-bleed on the sheet: the canvas on the left, the inspector as a ruled column on the right.
  return <div data-xe-full className="xe:flex xe:flex-col xe:lg:grid xe:lg:min-h-[calc(100dvh-3.5rem-2px)] xe:lg:grid-cols-[minmax(0,1fr)_21rem]">
    <div className="xe:flex xe:min-w-0 xe:flex-col xe:gap-6 xe:px-4 xe:pt-6 xe:pb-10 xe:sm:px-8 xe:lg:pt-10">
      {readOnly ? <LockBanner presence={presence} singular={collection.labels.singular.toLowerCase()} dirty={dirty} /> : null}
      {formError ? <Alert ref={alertRef} tabIndex={-1} variant="destructive" className="xe:mx-auto xe:w-full xe:max-w-[46rem]"><AlertTitle>We couldn’t save your changes</AlertTitle><AlertDescription>{formError}</AlertDescription></Alert> : null}

      {collection.upload ? <section className="xe:mx-auto xe:flex xe:w-full xe:max-w-[46rem] xe:flex-col xe:gap-3">
        <div className="xe:flex xe:flex-col xe:gap-1">
          <h1 className="xe:text-[22px] xe:font-semibold xe:leading-tight xe:tracking-[-0.01em]">{current ? title : `Upload to ${collection.labels.plural.toLowerCase()}`}</h1>
          <p className="xe:text-sm xe:text-muted-foreground">{current ? "Keep this file or drop in a replacement." : "Choose the file you want to add to your library."}</p>
        </div>
        <FileDropzone file={file} onChange={setFile} disabled={locked} accept={collection.upload.mimeTypes?.join(",")}
          url={typeof current?.data.url === "string" ? current.data.url : null} filename={typeof current?.data.filename === "string" ? current.data.filename : null} mimeType={typeof current?.data.mimeType === "string" ? current.data.mimeType : null} />
        <div className="xe:mt-4 xe:flex xe:flex-col xe:gap-4">
          <h2 className="xe:text-[15px] xe:font-semibold">Details</h2>
          <FormRenderer fields={collection.fields.filter((field) => field.admin.position !== "sidebar")} data={data} disabled={locked} errors={fieldErrors} onChange={change} />
        </div>
      </section> : null}

      {canvasMode ? <article className="xe:mx-auto xe:flex xe:w-full xe:max-w-[46rem] xe:flex-col">
        <h1 className="xe:sr-only">{docLabel}</h1>
        {titleField ? <div className="xe:flex xe:flex-col xe:gap-1.5">
          <TitleInput id={`${canvasId}-title`} label={titleField.label} value={typeof data[titleField.name] === "string" ? data[titleField.name] as string : ""}
            placeholder={titleField.admin.placeholder ?? `Untitled ${collection.labels.singular.toLowerCase()}`} maxLength={titleField.maxLength} disabled={locked || titleField.admin.readOnly}
            error={fieldErrors[titleField.name]} onChange={(value) => change(titleField.name, value === "" && titleField.defaultValue !== "" ? null : value)}
            onEnter={() => document.getElementById(`${canvasId}-body`)?.focus()} />
        </div> : null}
        {bodyField ? <div className="xe:mt-5 xe:flex xe:flex-col xe:gap-1.5">
          <span id={`${canvasId}-body-label`} className="xe:sr-only">{bodyField.label}</span>
          <RichTextEditor variant="canvas" field={bodyField} id={`${canvasId}-body`} value={data[bodyField.name]} disabled={locked}
            aria-invalid={!!fieldErrors[bodyField.name]} aria-describedby={fieldErrors[bodyField.name] ? `${canvasId}-body-error` : undefined}
            onChange={(value) => change(bodyField.name, value)} />
          {fieldErrors[bodyField.name] ? <p id={`${canvasId}-body-error`} role="alert" className="xe:text-sm xe:text-destructive">{fieldErrors[bodyField.name]}</p> : null}
        </div> : null}
      </article> : !collection.upload ? <section className="xe:mx-auto xe:flex xe:w-full xe:max-w-[46rem] xe:flex-col xe:gap-5">
        <div className="xe:flex xe:flex-col xe:gap-1">
          <h1 className="xe:text-[22px] xe:font-semibold xe:leading-tight xe:tracking-[-0.01em]">{docLabel}</h1>
          {collection.admin.description ? <p className="xe:text-sm xe:text-muted-foreground">{collection.admin.description}</p> : null}
        </div>
        <FormRenderer fields={collection.fields.filter((field) => field.admin.position !== "sidebar")} data={data} disabled={locked} errors={fieldErrors} onChange={change} />
      </section> : null}
    </div>

    {/* Inspector: publication state, every other field, then document facts. */}
    <aside aria-label="Properties" className="xe:flex xe:flex-col xe:border-t xe:border-border xe:bg-background xe:lg:sticky xe:lg:top-0 xe:lg:h-[calc(100dvh-3.5rem-2px)] xe:lg:overflow-y-auto xe:lg:border-t-0 xe:lg:border-l xe:lg:[scrollbar-width:thin]">
      {hasPublishing ? <section className="xe:flex xe:flex-col xe:gap-3 xe:border-b xe:border-border xe:px-5 xe:py-4">
        <h2 className="xe:text-[13px] xe:font-semibold">Publishing</h2>
        <dl className="xe:flex xe:flex-col xe:gap-2.5 xe:text-[13px]">
          {isDraftsEnabled ? <div className="xe:flex xe:items-center xe:justify-between xe:gap-2 xe:sm:hidden"><dt className="xe:text-muted-foreground">Status</dt><dd><StatusBadge status={current?.status ?? "draft"} changed={current?.hasUnpublishedChanges} /></dd></div> : null}
          {collection.slugFrom || current?.slug ? <div className="xe:flex xe:items-center xe:justify-between xe:gap-3"><dt className="xe:shrink-0 xe:text-muted-foreground">Slug</dt><dd className="xe:min-w-0 xe:truncate xe:font-mono xe:text-xs" title={current?.slug ?? undefined}>{current?.slug ?? <span className="xe:font-sans xe:text-muted-foreground">Set when you save</span>}</dd></div> : null}
          {current ? <div className="xe:flex xe:items-center xe:justify-between xe:gap-3"><dt className="xe:text-muted-foreground">Updated</dt><dd><Tooltip><TooltipTrigger render={<time dateTime={current.updatedAt} tabIndex={0} suppressHydrationWarning />}>{timeAgo(current.updatedAt)}</TooltipTrigger><TooltipContent>{formatDate(current.updatedAt)}</TooltipContent></Tooltip></dd></div> : null}
          {current ? <div className="xe:flex xe:items-center xe:justify-between xe:gap-3"><dt className="xe:text-muted-foreground">Created</dt><dd><Tooltip><TooltipTrigger render={<time dateTime={current.createdAt} tabIndex={0} suppressHydrationWarning />}>{timeAgo(current.createdAt)}</TooltipTrigger><TooltipContent>{formatDate(current.createdAt)}</TooltipContent></Tooltip></dd></div> : null}
        </dl>
      </section> : null}
      {visibleProperties ? <section className="xe:flex xe:flex-col xe:gap-4 xe:px-5 xe:py-4">
        <h2 className="xe:text-[13px] xe:font-semibold">Details</h2>
        <FormRenderer fields={propertyFields} data={data} onChange={change} errors={fieldErrors} disabled={locked} />
      </section> : null}
      <div className="xe:mt-auto xe:flex xe:flex-col xe:gap-1.5 xe:border-t xe:border-border xe:bg-muted/60 xe:px-5 xe:py-3 xe:text-xs xe:text-muted-foreground">
        {bodyField ? <p><span className="xe:tabular-nums xe:text-foreground">{words === 1 ? "1 word" : `${words.toLocaleString()} words`}</span> · {Math.max(1, Math.round(words / 220))} min read</p> : null}
        <p>{isDraftsEnabled ? <><Kbd>⌘S</Kbd> save draft · <Kbd>⌘↵</Kbd> publish</> : <><Kbd>⌘S</Kbd> save</>}</p>
      </div>
    </aside>
    <AlertDialog open={conflict !== null} onOpenChange={(open) => { if (!open) setConflict(null); }}><AlertDialogContent className="xe:data-[size=default]:max-w-[calc(100%-2rem)] xe:data-[size=default]:sm:max-w-lg"><AlertDialogHeader>
      <AlertDialogTitle>This {collection.labels.singular.toLowerCase()} changed while you were editing</AlertDialogTitle>
      <AlertDialogDescription>
        {conflictAuthor ? `${conflictAuthor} saved` : "A newer version was saved"} {conflict ? timeAgo(conflict.latest.updatedAt) : ""}. Saving now would overwrite their changes. Keep your version, or load theirs and lose your unsaved edits.
      </AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <Button type="button" variant="outline" onClick={() => { if (conflict) { accept(conflict.latest); toast("Loaded the latest version"); } setConflict(null); }}>Load their version</Button>
        <AlertDialogAction variant="destructive" onClick={() => { const c = conflict; setConflict(null); if (c) void save(c.draft, c.latest.updatedAt); }}>Overwrite with mine</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
    <AlertDialog open={pendingLeave !== null} onOpenChange={(open) => { if (!open) setPendingLeave(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle><AlertDialogDescription>You have changes to “{title}” that haven’t been saved. If you leave now, they’ll be lost.</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => {
        const next = pendingLeave; leaving.current = true; setPendingLeave(null); setBaseline(JSON.stringify(data)); setFile(null);
        next?.proceed();
      }}>Discard changes</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
    <AlertDialog open={confirmDelete} onOpenChange={(open) => { if (!pending) setConfirmDelete(open); }}><AlertDialogContent finalFocus={actionsButton}><AlertDialogHeader><AlertDialogTitle>Delete this {collection.labels.singular.toLowerCase()}?</AlertDialogTitle><AlertDialogDescription>“{title}” will be permanently deleted. This can’t be undone.</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel disabled={!!pending}>Keep it</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={!!pending} onClick={() => void remove()}>{pending === "remove" ? <Spinner /> : <RiDeleteBinLine data-icon="inline-start" />}Delete permanently</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
  </div>;
}

/** Large borderless title that grows with its content; Enter moves into the body. */
function TitleInput({ id, label, value, placeholder, maxLength, disabled, error, onChange, onEnter }: {
  id: string; label: string; value: string; placeholder: string; maxLength?: number; disabled?: boolean; error?: string; onChange(value: string): void; onEnter(): void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return <>
    <textarea ref={ref} id={id} rows={1} value={value} placeholder={placeholder} maxLength={maxLength} disabled={disabled} aria-label={label}
      aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined}
      onChange={(event) => onChange(event.target.value.replace(/\n/g, " "))}
      onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); onEnter(); } }}
      className="xe:w-full xe:resize-none xe:overflow-hidden xe:bg-transparent xe:font-serif xe:text-[2rem] xe:font-semibold xe:sm:text-[2.5rem] xe:leading-[1.15] xe:tracking-[-0.02em] xe:outline-none xe:placeholder:text-muted-foreground/45 xe:focus-visible:outline-none xe:disabled:opacity-70" />
    {error ? <p id={`${id}-error`} role="alert" className="xe:text-sm xe:text-destructive">{error}</p> : null}
  </>;
}

/** A refused save because the document has a newer version (not a slug clash). */
function isStale(result: Extract<ActionResult<unknown>, { ok: false }>): boolean {
  return result.error.code === "CONFLICT" && (result.error.issues ?? []).some((issue) => issue.path[0] === "updatedAt");
}

/** Soft-lock notice above the canvas: who holds the document, and how to get it back. */
function LockBanner({ presence, singular, dirty }: { presence: DocPresence; singular: string; dirty: boolean }) {
  const { user } = useAdmin();
  const holder = presence.holder;
  const self = !!holder && holder.user.id === user.id;
  const taker = presence.takenOverBy;
  const name = holder ? displayName(holder.user) : taker ? displayName(taker.user) : "Someone";
  const title = presence.mode === "taken"
    ? `${taker ? displayName(taker.user) : "Someone"} took over editing ${timeAgo(new Date(taker?.at ?? Date.now()).toISOString())}`
    : self ? `You're editing this ${singular} in another tab` : `${name} is editing this ${singular}`;
  const detail = presence.mode === "taken"
    ? dirty ? "Your unsaved changes are still here. Take back editing to save them; if they saved in the meantime, you'll be asked which version to keep." : "You're viewing it read-only. Their saves appear here automatically."
    : self ? "This tab is read-only so the two copies can't overwrite each other. Take over to edit here instead."
    : "You're viewing it read-only. Their saves appear here automatically. Take over if they've stepped away.";
  const person = holder?.user ?? taker?.user;
  return (
    <div role="status" className="xe:mx-auto xe:flex xe:w-full xe:max-w-[46rem] xe:items-start xe:gap-3 xe:rounded-lg xe:border xe:border-border xe:bg-muted xe:px-4 xe:py-3">
      {person ? <PersonAvatar user={person} editing={!!holder} className="xe:mt-0.5 xe:ring-muted" /> : <RiLockLine className="xe:mt-0.5 xe:size-5 xe:text-muted-foreground" aria-hidden />}
      <div className="xe:flex xe:min-w-0 xe:flex-col xe:gap-0.5">
        <p className="xe:text-sm xe:font-medium">{title}</p>
        <p className="xe:text-[13px] xe:text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}
