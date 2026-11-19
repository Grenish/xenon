"use client";

import { CopyButton } from "./copy";
import { TabList, useTabIds } from "./tab-list";
import { useSyncedChoice } from "./synced";

const MANAGERS = ["bun", "npm", "pnpm", "yarn"];
const VERB: Record<string, string> = { bun: "bun add", npm: "npm install", pnpm: "pnpm add", yarn: "yarn add" };

/** The install command for each package manager. The reader's choice follows them to every page. */
export function Install({ pkg, dev = false }: { pkg: string; dev?: boolean }) {
  const [pm, setPm] = useSyncedChoice("pm", MANAGERS);
  const ids = useTabIds();
  const cmd = `${VERB[pm]}${dev ? (pm === "npm" ? " --save-dev" : " -D") : ""} ${pkg}`;
  return (
    <figure className="docs-code docs-tabs" data-shell>
      <TabList items={MANAGERS} value={pm} onChange={setPm} label="Package manager" idBase={ids} end={<CopyButton text={() => cmd} />} />
      <pre role="tabpanel" id={`${ids}-panel-${pm}`} aria-labelledby={`${ids}-tab-${pm}`} data-language="bash">
        <code>
          <span className="line">{cmd}</span>
        </code>
      </pre>
    </figure>
  );
}
