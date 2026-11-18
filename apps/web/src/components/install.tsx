"use client";

import { useState } from "react";
import { RiCheckLine, RiFileCopyLine } from "@remixicon/react";

const MANAGERS = ["bun", "npm", "pnpm"] as const;
const DATABASES = [
  { id: "pglite", label: "PGlite", note: "Embedded Postgres, no setup", pkg: "@electric-sql/pglite" },
  { id: "postgres", label: "Postgres server", note: "Any PostgreSQL, via postgres-js", pkg: "postgres" },
] as const;

function command(pm: (typeof MANAGERS)[number], pkg: string) {
  const verb = pm === "npm" ? "install" : "add";
  return `${pm} ${verb} xenon-cms ${pkg}`;
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** The small copy chip in the hero. */
export function CopyCommand({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="copy-chip"
      onClick={async () => {
        if (await copy(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        }
      }}
      aria-label={`Copy command: ${text}`}
    >
      <code>{text}</code>
      <span className="copy-chip-icon" aria-hidden>
        {done ? <RiCheckLine size={16} /> : <RiFileCopyLine size={16} />}
      </span>
      <span className="sr-only" aria-live="polite">
        {done ? "Copied" : ""}
      </span>
    </button>
  );
}

/** The closing section's install dialog: the product's first step, already open. */
export function InstallDialog() {
  const [pm, setPm] = useState<(typeof MANAGERS)[number]>("bun");
  const [db, setDb] = useState(0);
  const [done, setDone] = useState(false);
  const database = DATABASES[db]!;
  const cmd = command(pm, database.pkg);

  return (
    <div className="dialog" data-ui role="group" aria-labelledby="install-title">
      <div className="dialog-head">
        <div id="install-title" className="dialog-title">
          Install Xenon
        </div>
        <div className="dialog-sub">Next.js 16 and React 19 or newer</div>
      </div>

      <div className="dialog-row">
        <div className="dialog-label" id="pm-label">
          Package manager
        </div>
        <div className="ui-seg" role="radiogroup" aria-labelledby="pm-label">
          {MANAGERS.map((m) => (
            <button key={m} type="button" role="radio" aria-checked={pm === m} onClick={() => setPm(m)}>
              {m}
            </button>
          ))}
        </div>
      </div>

      <div className="dialog-row">
        <div className="dialog-label" id="db-label">
          Database
        </div>
        <div className="dialog-dbs" role="radiogroup" aria-labelledby="db-label">
          {DATABASES.map((d, i) => (
            <button key={d.id} type="button" role="radio" aria-checked={db === i} className="dialog-db" onClick={() => setDb(i)}>
              <span className="dialog-db-name">{d.label}</span>
              <span className="dialog-db-note">{d.note}</span>
            </button>
          ))}
        </div>
      </div>

      <pre className="dialog-cmd">
        <code>{cmd}</code>
      </pre>

      <button
        type="button"
        className="btn btn--primary dialog-go"
        onClick={async () => {
          if (await copy(cmd)) {
            setDone(true);
            setTimeout(() => setDone(false), 1800);
          }
        }}
      >
        {done ? <RiCheckLine size={18} aria-hidden /> : <RiFileCopyLine size={18} aria-hidden />}
        {done ? "Copied to clipboard" : "Copy install command"}
      </button>
    </div>
  );
}
