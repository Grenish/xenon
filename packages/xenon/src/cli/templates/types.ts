export type DatabaseChoice = "pglite" | "postgres";

export type PackageManager = "bun" | "pnpm" | "yarn" | "npm";

export interface ProjectContext {
  cwd: string;
  pkg: Record<string, unknown> | null;
  hasSrcDir: boolean;
  /** TypeScript `@/*` alias target directory relative to `cwd` (e.g. `"src"` or `"."`), or `null`. */
  atAliasDir: string | null;
  pm: PackageManager;
}

export interface GeneratedFile {
  /** Path relative to the project root (`cwd`), POSIX slashes. */
  path: string;
  content: string;
  /**
   * - `"create"` (default): create file if missing; skip unless `--force`.
   * - `"append-lines"`: create if missing, or append any non-empty lines not already present.
   */
  mode?: "create" | "append-lines";
}

export interface TemplateGenerateOptions {
  db: DatabaseChoice;
  adminPath: string;
  apiPath: string;
}

export interface TemplateResult {
  files: GeneratedFile[];
  dependencies: string[];
  devDependencies?: string[];
  notes: string[];
}

/**
 * Pluggable framework template contract for `xenon init`.
 * New host frameworks (Astro, TanStack Start, SvelteKit, Nuxt, React Router) implement this
 * interface and register once in `templates/index.ts`.
 */
export interface FrameworkTemplate {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  /** Higher score wins auto-detection; `0` means not detected. */
  detect(ctx: ProjectContext): number;
  generate(ctx: ProjectContext, options: TemplateGenerateOptions): TemplateResult;
}
