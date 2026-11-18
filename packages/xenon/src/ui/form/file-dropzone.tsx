"use client";

import { useEffect, useRef, useState } from "react";
import { RiFileLine, RiUploadCloud2Line, RiCloseLine } from "@remixicon/react";
import { Button } from "../components/button";
import { cn } from "../lib/utils";

export function FileDropzone({ file, onChange, disabled, accept, url, filename, mimeType }: {
  file: File | null; onChange(file: File | null): void; disabled?: boolean; accept?: string;
  url?: string | null; filename?: string | null; mimeType?: string | null;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  const image = (file?.type ?? mimeType)?.startsWith("image/");
  const source = preview ?? url;
  return <div className={cn("xe:flex xe:min-h-40 xe:flex-col xe:items-center xe:justify-center xe:gap-3 xe:rounded-lg xe:border xe:border-dashed xe:border-input xe:bg-muted/25 xe:p-6 xe:text-center xe:transition-colors", dragging && "xe:border-primary xe:bg-accent")}
    onDragOver={(event) => { event.preventDefault(); if (!disabled) setDragging(true); }} onDragLeave={() => setDragging(false)}
    onDrop={(event) => { event.preventDefault(); setDragging(false); if (!disabled && event.dataTransfer.files[0]) onChange(event.dataTransfer.files[0]); }}>
    <input ref={input} type="file" className="xe:sr-only" aria-label="Choose file" disabled={disabled} accept={accept}
      onChange={(event) => { onChange(event.target.files?.[0] ?? null); event.target.value = ""; }} />
    {source && image ? <img src={source} alt="Selected upload preview" className="xe:max-h-52 xe:max-w-full xe:rounded-md xe:object-contain" /> :
      file || url ? <RiFileLine className="xe:size-9 xe:text-muted-foreground" /> : <RiUploadCloud2Line className="xe:size-9 xe:text-muted-foreground" />}
    <div className="xe:flex xe:max-w-full xe:flex-col xe:gap-1">
      <p className="xe:truncate xe:font-medium">{file?.name ?? filename ?? "Drop a file here"}</p>
      <p className="xe:text-xs xe:text-muted-foreground">{file ? `${new Intl.NumberFormat().format(file.size)} bytes · ready to upload` : url ? "Choose a replacement to update this file." : "Or choose a file from your device."}</p>
    </div>
    <div className="xe:flex xe:gap-2"><Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => input.current?.click()}>
      {file || url ? "Replace file" : "Choose file"}
    </Button>{file ? <Button type="button" variant="ghost" size="icon-sm" aria-label="Clear selected file" disabled={disabled} onClick={() => onChange(null)}><RiCloseLine /></Button> : null}</div>
  </div>;
}
