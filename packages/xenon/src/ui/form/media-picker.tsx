"use client";

import { useState, type RefObject } from "react";
import { toast } from "sonner";
import { RiCheckLine, RiFileLine, RiImageLine } from "@remixicon/react";
import { Button } from "../components/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/dialog";
import { Input } from "../components/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/tabs";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../components/empty";
import { Spinner } from "../components/spinner";
import { useAdmin } from "../shared/admin-context";
import type { DocSummary } from "../shared/services";
import { cn } from "../lib/utils";
import { FileDropzone } from "./file-dropzone";
import { FormRenderer } from "./form-renderer";
import { initialData, validateFields } from "./model";
import { useDocumentSearch } from "./use-document-search";

export interface MediaPickerProps {
  collection: string; open: boolean; onOpenChange(open: boolean): void; onChoose(docs: DocSummary[]): void;
  multiple?: boolean; selected?: DocSummary[]; imagesOnly?: boolean;
  returnFocus?: RefObject<HTMLElement | null>;
}

export function MediaPicker(props: MediaPickerProps) {
  // Remount on each open so cancelled choices never leak into the next session.
  return <Dialog open={props.open} onOpenChange={props.onOpenChange}>{props.open ? <MediaPickerContent {...props} /> : null}</Dialog>;
}

function MediaPickerContent({ collection, onOpenChange, onChoose, multiple, selected = [], imagesOnly, returnFocus }: MediaPickerProps) {
  const { collections, services } = useAdmin();
  const definition = collections.find((item) => item.slug === collection);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [chosen, setChosen] = useState<DocSummary[]>(selected);
  const [file, setFile] = useState<File | null>(null);
  const [data, setData] = useState<Record<string, unknown>>(() => definition ? initialData(definition, null) : {});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const search = useDocumentSearch({ collection, query, page, limit: 18 });
  const docs = search.result.docs.filter((item) => !imagesOnly || item.mimeType?.startsWith("image/"));
  function choose(doc: DocSummary) {
    if (!multiple) { onChoose([doc]); onOpenChange(false); return; }
    setChosen((previous) => previous.some((item) => item.id === doc.id) ? previous.filter((item) => item.id !== doc.id) : [...previous, doc]);
  }
  async function upload() {
    if (!file || !definition || pending) return;
    const invalid = validateFields(definition.fields, data, false);
    setErrors(invalid);
    if (Object.keys(invalid).length) return;
    setPending(true);
    try {
      const result = await services.upload({ collection, file, data });
      if (!result.ok) {
        setErrors(Object.fromEntries((result.error.issues ?? []).filter((issue) => typeof issue.path[0] === "string").map((issue) => [String(issue.path[0]), issue.message])));
        toast.error(result.error.message); return;
      }
      const doc = result.data;
      const summary: DocSummary = { id: doc.id, title: String(doc.data.alt || doc.data.filename || file.name), status: doc.status, updatedAt: doc.updatedAt,
        url: typeof doc.data.url === "string" ? doc.data.url : null, mimeType: typeof doc.data.mimeType === "string" ? doc.data.mimeType : null,
        filename: typeof doc.data.filename === "string" ? doc.data.filename : null };
      toast.success("File uploaded");
      if (multiple) { setChosen((previous) => [...previous, summary]); setFile(null); search.reload(); }
      else { onChoose([summary]); onOpenChange(false); }
    } catch { toast.error("Could not upload the file. Try again."); }
    finally { setPending(false); }
  }
  return <DialogContent finalFocus={returnFocus} className="xe:flex xe:max-h-[85dvh] xe:flex-col xe:overflow-y-auto xe:sm:max-w-2xl">
    <DialogHeader><DialogTitle>Choose media</DialogTitle><DialogDescription>Select from your library or upload a new file.</DialogDescription></DialogHeader>
    <Tabs defaultValue="library"><TabsList><TabsTrigger value="library">Media library</TabsTrigger><TabsTrigger value="upload">Upload</TabsTrigger></TabsList>
      <TabsContent value="library" className="xe:mt-4 xe:flex xe:flex-col xe:gap-4">
        <Input aria-label="Search media" placeholder="Search your media…" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
        {search.loading ? <p role="status" className="xe:flex xe:items-center xe:gap-2 xe:py-8 xe:text-muted-foreground"><Spinner />Loading your media…</p> : docs.length ?
          <div className="xe:grid xe:grid-cols-2 xe:gap-3 xe:sm:grid-cols-3">{docs.map((doc) => <button key={doc.id} type="button" aria-pressed={chosen.some((item) => item.id === doc.id)} onClick={() => choose(doc)}
            className={cn("xe:relative xe:overflow-hidden xe:rounded-lg xe:border xe:border-border xe:bg-card xe:text-left xe:transition-colors xe:hover:border-primary xe:focus-visible:ring-[3px] xe:focus-visible:ring-ring", chosen.some((item) => item.id === doc.id) && "xe:border-primary xe:ring-1 xe:ring-primary")}>
            <div className="xe:flex xe:aspect-[4/3] xe:items-center xe:justify-center xe:overflow-hidden xe:bg-muted">{doc.url && doc.mimeType?.startsWith("image/") ? <img src={doc.url} alt={doc.title} loading="lazy" className="xe:size-full xe:object-cover" /> : <RiFileLine className="xe:size-8 xe:text-muted-foreground" />}</div>
            <p className="xe:truncate xe:p-2 xe:text-xs xe:font-medium">{doc.title}</p>{chosen.some((item) => item.id === doc.id) ? <span className="xe:absolute xe:right-2 xe:top-2 xe:rounded-full xe:bg-primary xe:p-1 xe:text-primary-foreground"><RiCheckLine className="xe:size-3" /></span> : null}
          </button>)}</div> : <Empty><EmptyHeader><EmptyMedia variant="icon"><RiImageLine /></EmptyMedia><EmptyTitle>{search.error ? "Media could not be loaded" : "No media found"}</EmptyTitle><EmptyDescription>{search.error || "Try another search, or upload your first file."}</EmptyDescription></EmptyHeader></Empty>}
        <div className="xe:flex xe:items-center xe:justify-between"><Button type="button" variant="outline" size="sm" disabled={page === 1 || search.loading} onClick={() => setPage((value) => value - 1)}>Previous</Button><p className="xe:text-xs xe:text-muted-foreground">Page {page}</p><Button type="button" variant="outline" size="sm" disabled={!search.result.hasNextPage || search.loading} onClick={() => setPage((value) => value + 1)}>Next</Button></div>
      </TabsContent>
      <TabsContent value="upload" className="xe:mt-4 xe:flex xe:flex-col xe:gap-5">
        <FileDropzone file={file} onChange={setFile} disabled={pending} accept={imagesOnly ? "image/*" : definition?.upload ? definition.upload.mimeTypes?.join(",") : undefined} />
        {definition ? <FormRenderer fields={definition.fields.filter((field) => !field.admin.hidden)} data={data} onChange={(name, value) => setData((previous) => ({ ...previous, [name]: value }))} errors={errors} disabled={pending} /> : null}
        <Button type="button" disabled={!file || pending || imagesOnly && !file.type.startsWith("image/")} onClick={() => void upload()}>{pending ? <Spinner /> : null}Upload file</Button>
      </TabsContent>
    </Tabs>
    {multiple ? <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="button" onClick={() => { onChoose(chosen); onOpenChange(false); }}>Use {chosen.length ? `${chosen.length} selected` : "selection"}</Button></DialogFooter> : null}
  </DialogContent>;
}
