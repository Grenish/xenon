import { existsSync, readFileSync } from "node:fs";
import { join, posix, relative } from "node:path";
import type { DatabaseChoice, PackageManager, ProjectContext } from "./types";

export function normalizeRoutePath(input: string, fallback: string): string {
  const trimmed = input.trim();
  if (!trimmed) return fallback;
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const cleaned = withSlash.length > 1 ? withSlash.replace(/\/+$/, "") : withSlash;
  return cleaned || fallback;
}

export function routeSegments(routePath: string): string[] {
  return routePath.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
}

export function readJsonFile(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf8");
    // Strip // and /* */ comments and trailing commas so tsconfig.json parses cleanly.
    const stripped = raw
      .replace(/^\uFEFF/, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:\\])\/\/.*$/gm, "$1")
      .replace(/,\s*([}\]])/g, "$1");
    const parsed: unknown = JSON.parse(stripped);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function hasDependency(pkg: Record<string, unknown> | null, name: string): boolean {
  if (!pkg) return false;
  for (const section of ["dependencies", "devDependencies", "peerDependencies"] as const) {
    const map = pkg[section];
    if (map && typeof map === "object" && Object.hasOwn(map, name)) return true;
  }
  return false;
}

export function detectPackageManager(cwd: string): PackageManager {
  if (existsSync(join(cwd, "bun.lock")) || existsSync(join(cwd, "bun.lockb"))) return "bun";
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(cwd, "yarn.lock"))) return "yarn";
  if (existsSync(join(cwd, "package-lock.json"))) return "npm";
  const ua = process.env.npm_config_user_agent ?? "";
  if (ua.startsWith("bun/")) return "bun";
  if (ua.startsWith("pnpm/")) return "pnpm";
  if (ua.startsWith("yarn/")) return "yarn";
  return "npm";
}

export function detectAtAliasDir(cwd: string): string | null {
  const tsconfig = readJsonFile(join(cwd, "tsconfig.json"));
  const compilerOptions = tsconfig?.compilerOptions as Record<string, unknown> | undefined;
  const paths = compilerOptions?.paths as Record<string, unknown> | undefined;
  const atEntries = paths?.["@/*"];
  if (!Array.isArray(atEntries) || typeof atEntries[0] !== "string") return null;
  const target = atEntries[0].replace(/^\.\//, "").replace(/\/?\*$/, "");
  return target || ".";
}

export function detectProjectContext(cwd: string): ProjectContext {
  const pkg = readJsonFile(join(cwd, "package.json"));
  const hasSrcDir = existsSync(join(cwd, "src"));
  const atAliasDir = detectAtAliasDir(cwd);
  const pm = detectPackageManager(cwd);
  return { cwd, pkg, hasSrcDir, atAliasDir, pm };
}

/**
 * Computes an import specifier from `fromFile` to `configFile` (both POSIX relative to `cwd`),
 * preferring `@/...` when `tsconfig.json` defines a matching `@/*` alias.
 */
export function configImportSpecifier(fromFile: string, configFile: string, atAliasDir: string | null): string {
  const withoutExt = configFile.replace(/\.[cm]?tsx?$/, "");
  if (atAliasDir !== null) {
    if (atAliasDir === ".") return `@/${withoutExt}`;
    const prefix = `${atAliasDir.replace(/\/+$/, "")}/`;
    if (withoutExt.startsWith(prefix)) return `@/${withoutExt.slice(prefix.length)}`;
  }
  const rel = posix.relative(posix.dirname(fromFile), withoutExt);
  return rel.startsWith(".") ? rel : `./${rel}`;
}

export function renderXenonConfig(options: { db: DatabaseChoice; adminPath: string; apiPath: string }): string {
  const dbImport =
    options.db === "postgres"
      ? `import { postgresAdapter } from "xenon-cms/postgres";`
      : `import { pgliteAdapter } from "xenon-cms/pglite";`;
  const dbLine =
    options.db === "postgres"
      ? `  db: postgresAdapter({ connectionString: process.env.DATABASE_URL! }),`
      : `  db: pgliteAdapter({ dataDir: ".xenon/pgdata" }),`;

  const extraConfig: string[] = [];
  if (options.adminPath !== "/admin") {
    extraConfig.push(`  admin: { path: ${JSON.stringify(options.adminPath)} },`);
  }
  if (options.apiPath !== "/api/xenon") {
    extraConfig.push(`  api: { path: ${JSON.stringify(options.apiPath)} },`);
  }

  return `import {
  boolean,
  defineCollection,
  defineConfig,
  media,
  richText,
  select,
  text,
  textarea,
} from "xenon-cms";
import type { InferCollectionType } from "xenon-cms";
${dbImport}
import { LocalStorageAdapter } from "xenon-cms/storage/local";

export const mediaCollection = defineCollection({
  slug: "media",
  upload: true,
  fields: {
    alt: text({ required: true }),
  },
});

export const posts = defineCollection({
  slug: "posts",
  slugFrom: "title",
  admin: { useAsTitle: "title" },
  fields: {
    title: text({ required: true, maxLength: 200 }),
    excerpt: textarea(),
    category: select({ options: ["news", "guide", "release"], defaultValue: "news" }),
    featured: boolean({ defaultValue: false }),
    cover: media({ relationTo: "media" }),
    body: richText(),
  },
});

export type Post = InferCollectionType<typeof posts>;
export type Media = InferCollectionType<typeof mediaCollection>;

export default defineConfig({
  collections: [posts, mediaCollection],
${dbLine}
  storage: new LocalStorageAdapter({ directory: ".xenon/uploads" }),
${extraConfig.length ? `${extraConfig.join("\n")}\n` : ""}  auth: {
    apiKeys: process.env.XENON_API_KEY
      ? [{ key: process.env.XENON_API_KEY, role: "editor", name: "api" }]
      : [],
  },
});
`;
}

export function renderEnvExample(db: DatabaseChoice): string {
  const lines = [
    "# Generate a strong random secret for production (e.g. `openssl rand -hex 32`)",
    "XENON_SECRET=",
    "XENON_URL=http://localhost:3000",
    "# Optional: Bearer API key for programmatic REST access",
    "# XENON_API_KEY=",
  ];
  if (db === "postgres") {
    lines.push("DATABASE_URL=postgres://postgres:postgres@localhost:5432/xenon");
  } else {
    lines.push("# Optional: switch from embedded PGlite to PostgreSQL");
    lines.push("# DATABASE_URL=postgres://postgres:postgres@localhost:5432/xenon");
  }
  return `${lines.join("\n")}\n`;
}

export function formatInstallCommand(pm: PackageManager, packages: readonly string[]): string {
  const list = packages.join(" ");
  switch (pm) {
    case "bun": return `bun add ${list}`;
    case "pnpm": return `pnpm add ${list}`;
    case "yarn": return `yarn add ${list}`;
    case "npm": return `npm install ${list}`;
  }
}

export function installArgs(pm: PackageManager, packages: readonly string[]): [string, string[]] {
  switch (pm) {
    case "bun": return ["bun", ["add", ...packages]];
    case "pnpm": return ["pnpm", ["add", ...packages]];
    case "yarn": return ["yarn", ["add", ...packages]];
    case "npm": return ["npm", ["install", ...packages]];
  }
}

export function safeRelativeDisplay(cwd: string, fullPath: string): string {
  return relative(cwd, fullPath) || ".";
}
