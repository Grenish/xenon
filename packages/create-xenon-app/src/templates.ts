import pkg from "../package.json" with { type: "json" };
import { DOCS_URL, contentTs, globalsCss, layoutTsx, pageTsx, postPageTsx, siteTsx } from "./next-starter-files";

export type DatabaseChoice = "pglite" | "postgres";
export type PackageManager = "bun" | "pnpm" | "yarn" | "npm";

export const XENON_VERSION_RANGE = `^${pkg.version}`;

export interface StarterFile {
  path: string;
  content: string;
}

export interface StarterTemplateOptions {
  projectName: string;
  packageName: string;
  db: DatabaseChoice;
  pm: PackageManager;
  /** Put the app code under `src/` (`src/app`, `src/xenon.config.ts`) instead of the project root. */
  srcDir: boolean;
}

export interface StarterTemplateResult {
  files: StarterFile[];
  nextSteps: string[];
}

export interface StarterTemplate {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  generate(options: StarterTemplateOptions): StarterTemplateResult;
}

function renderXenonConfig(db: DatabaseChoice): string {
  const dbImport =
    db === "postgres"
      ? `import { postgresAdapter } from "xenon-cms/postgres";`
      : `import { pgliteAdapter } from "xenon-cms/pglite";`;
  const dbLine =
    db === "postgres"
      ? `  db: postgresAdapter({ connectionString: process.env.DATABASE_URL! }),`
      : `  db: pgliteAdapter({ dataDir: ".xenon/pgdata" }),`;

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
  auth: {
    apiKeys: process.env.XENON_API_KEY
      ? [{ key: process.env.XENON_API_KEY, role: "editor", name: "api" }]
      : [],
  },
});
`;
}

function renderEnvExample(db: DatabaseChoice): string {
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

function runCmd(pm: PackageManager, script: string): string {
  return pm === "npm" ? `npm run ${script}` : `${pm} ${script}`;
}

const nextStarter: StarterTemplate = {
  id: "next",
  label: "Next.js (App Router)",
  description: "Full-stack Next.js 16 app with Admin UI, REST API & typed Local API",

  generate({ projectName, packageName, db, pm, srcDir }): StarterTemplateResult {
    const base = srcDir ? "src/" : "";
    const dbDep: Record<string, string> =
      db === "postgres" ? { postgres: "^4.1.1" } : { "@electric-sql/pglite": "^0.5.16" };

    const appPkg = {
      name: packageName,
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: {
        dev: "next dev",
        build: "next build",
        start: "next start",
        typecheck: "tsc --noEmit",
      },
      dependencies: {
        next: "^16.0.0",
        react: "^19.0.0",
        "react-dom": "^19.0.0",
        "xenon-cms": XENON_VERSION_RANGE,
        ...dbDep,
      },
      devDependencies: {
        "@types/node": "^22.0.0",
        "@types/react": "^19.0.0",
        "@types/react-dom": "^19.0.0",
        typescript: "^5.9.0",
      },
    };

    const nextConfig =
      db === "pglite"
        ? `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite"],
  experimental: { cpus: 1 },
};

export default nextConfig;
`
        : `import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;
`;

    const files: StarterFile[] = [
      { path: "package.json", content: `${JSON.stringify(appPkg, null, 2)}\n` },
      {
        path: "tsconfig.json",
        content: `${JSON.stringify(
          {
            compilerOptions: {
              target: "ES2022",
              lib: ["dom", "dom.iterable", "esnext"],
              allowJs: true,
              skipLibCheck: true,
              strict: true,
              noEmit: true,
              esModuleInterop: true,
              module: "esnext",
              moduleResolution: "bundler",
              resolveJsonModule: true,
              isolatedModules: true,
              jsx: "react-jsx",
              incremental: true,
              plugins: [{ name: "next" }],
              paths: { "@/*": [srcDir ? "./src/*" : "./*"] },
            },
            include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
            exclude: ["node_modules"],
          },
          null,
          2,
        )}\n`,
      },
      { path: "next.config.ts", content: nextConfig },
      { path: `${base}xenon.config.ts`, content: renderXenonConfig(db) },
      { path: `${base}app/layout.tsx`, content: layoutTsx(projectName) },
      { path: `${base}app/globals.css`, content: globalsCss },
      { path: `${base}app/page.tsx`, content: pageTsx.replaceAll("app/page.tsx", `${base}app/page.tsx`) },
      { path: `${base}app/posts/[slug]/page.tsx`, content: postPageTsx },
      { path: `${base}lib/site.tsx`, content: siteTsx(projectName) },
      { path: `${base}lib/content.ts`, content: contentTs },
      {
        path: `${base}app/api/xenon/[...slug]/route.ts`,
        content: `import config from "@/xenon.config";
import { createApiHandler } from "xenon-cms/next";

export const { GET, POST, PATCH, DELETE } = createApiHandler(config);
`,
      },
      {
        path: `${base}app/admin/[[...segments]]/page.tsx`,
        content: `import "xenon-cms/styles.css";
import config from "@/xenon.config";
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
      { path: ".env.example", content: renderEnvExample(db) },
      { path: ".gitignore", content: "node_modules/\n.next/\n.env\n.env.local\n.xenon/\n" },
      {
        path: "README.md",
        content: `# ${projectName}

Built with [XenonCMS](https://github.com/Grenish/xenon) and Next.js.

## Getting started

\`\`\`bash
${runCmd(pm, "dev")}
\`\`\`

Open <http://localhost:3000> and follow the steps on the page, or go straight to
<http://localhost:3000/admin> to create the first admin user.

- \`${base}app/page.tsx\`: the home page (latest posts, plus setup steps until the first post is published)
- \`${base}app/posts/[slug]/page.tsx\`: a post
- \`${base}xenon.config.ts\`: your collections and fields

Documentation: <${DOCS_URL}>
`,
      },
    ];

    const nextSteps: string[] = [];
    if (db === "postgres") nextSteps.push("Copy `.env.example` to `.env` and set `DATABASE_URL`");
    nextSteps.push(runCmd(pm, "dev"));
    nextSteps.push("Open http://localhost:3000/admin to create the first admin");

    return { files, nextSteps };
  },
};

/**
 * Pluggable starter registry. Non-Next starters (Web Fetch / Hono, Astro, TanStack Start) register
 * here once `xenon-cms/http` (#8) lands so generated apps never import `next/*` unnecessarily.
 */
export const STARTER_TEMPLATES: readonly StarterTemplate[] = [nextStarter];

export function getStarterTemplate(
  id: string,
  templates: readonly StarterTemplate[] = STARTER_TEMPLATES,
): StarterTemplate | undefined {
  const normalized = id.trim().toLowerCase();
  if (normalized === "nextjs" || normalized === "next.js") {
    return templates.find((t) => t.id === "next");
  }
  return templates.find((t) => t.id === normalized);
}

export function listStarterTemplateIds(templates: readonly StarterTemplate[] = STARTER_TEMPLATES): string[] {
  return templates.map((t) => t.id);
}
