import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  configImportSpecifier,
  hasDependency,
  renderEnvExample,
  renderXenonConfig,
  routeSegments,
} from "./shared";
import type { FrameworkTemplate, GeneratedFile, ProjectContext, TemplateGenerateOptions, TemplateResult } from "./types";

const NEXT_CONFIG_CANDIDATES = ["next.config.ts", "next.config.mts", "next.config.mjs", "next.config.js", "next.config.cjs"];

function findNextConfig(cwd: string): string | null {
  for (const name of NEXT_CONFIG_CANDIDATES) {
    if (existsSync(join(cwd, name))) return name;
  }
  return null;
}

function resolveAppDir(ctx: ProjectContext): string {
  if (existsSync(join(ctx.cwd, "src", "app"))) return "src/app";
  if (existsSync(join(ctx.cwd, "app"))) return "app";
  return ctx.hasSrcDir ? "src/app" : "app";
}

function renderNextConfig(db: TemplateGenerateOptions["db"]): string {
  if (db === "pglite") {
    return `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WASM/data assets loaded from node_modules at runtime.
  serverExternalPackages: ["@electric-sql/pglite"],
  // PGlite is single-process: keep prerender workers at 1 when reading PGlite during build.
  experimental: { cpus: 1 },
};

export default nextConfig;
`;
  }
  return `import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;
`;
}

export const nextjsTemplate: FrameworkTemplate = {
  id: "next",
  label: "Next.js (App Router)",
  description: "RSC AdminPage, Server Actions, Route Handler & cacheTag revalidation",

  detect(ctx) {
    if (hasDependency(ctx.pkg, "next")) return 100;
    if (findNextConfig(ctx.cwd) !== null) return 90;
    return 0;
  },

  generate(ctx, options): TemplateResult {
    const appDir = resolveAppDir(ctx);
    const configPath = ctx.hasSrcDir ? "src/xenon.config.ts" : "xenon.config.ts";
    const apiSegs = routeSegments(options.apiPath);
    const adminSegs = routeSegments(options.adminPath);

    const apiRoutePath = `${appDir}/${apiSegs.join("/")}/[...slug]/route.ts`;
    const adminPagePath = `${appDir}/${adminSegs.join("/")}/[[...segments]]/page.tsx`;

    const apiConfigImport = configImportSpecifier(apiRoutePath, configPath, ctx.atAliasDir);
    const adminConfigImport = configImportSpecifier(adminPagePath, configPath, ctx.atAliasDir);

    const files: GeneratedFile[] = [
      { path: configPath, content: renderXenonConfig(options) },
      {
        path: apiRoutePath,
        content: `import config from ${JSON.stringify(apiConfigImport)};
import { createApiHandler } from "xenon-cms/next";

export const { GET, POST, PATCH, DELETE } = createApiHandler(config);
`,
      },
      {
        path: adminPagePath,
        content: `import "xenon-cms/styles.css";
import config from ${JSON.stringify(adminConfigImport)};
import { AdminPage, type AdminActionInput, type AdminPageProps, runAdminAction } from "xenon-cms/next";

export const metadata = { title: "Xenon Admin" };

async function action(input: AdminActionInput) {
  "use server";
  return runAdminAction(config, input);
}

export default function Page(props: Pick<AdminPageProps, "params" | "searchParams">) {
  return <AdminPage config={config} action={action} {...props} />;
}
`,
      },
      { path: ".env.example", content: renderEnvExample(options.db), mode: "append-lines" },
      { path: ".gitignore", content: ".xenon/\n", mode: "append-lines" },
    ];

    const notes: string[] = [];
    const existingNextConfig = findNextConfig(ctx.cwd);
    if (!existingNextConfig) {
      files.push({ path: "next.config.ts", content: renderNextConfig(options.db) });
    } else if (options.db === "pglite") {
      const content = readFileSync(join(ctx.cwd, existingNextConfig), "utf8");
      if (!content.includes("@electric-sql/pglite")) {
        notes.push(
          `Add \`serverExternalPackages: ["@electric-sql/pglite"]\` to \`${existingNextConfig}\` (also \`experimental: { cpus: 1 }\` if pages read PGlite at build time)`,
        );
      }
    }

    if (options.db === "postgres") {
      notes.push("Set `DATABASE_URL` in `.env`");
    }
    notes.push(`Start your dev server and open http://localhost:3000${options.adminPath} to create the first admin`);

    return {
      files,
      dependencies: ["xenon-cms", options.db === "postgres" ? "postgres" : "@electric-sql/pglite"],
      notes,
    };
  },
};
