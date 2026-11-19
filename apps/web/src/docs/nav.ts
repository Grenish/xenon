export type NavPage = { title: string; slug: string[] };
export type NavSection = { title: string; pages: NavPage[] };

export function href(slug: string[]): string {
  return ["/docs", ...slug].join("/");
}

export const nav: NavSection[] = [
  {
    title: "Getting started",
    pages: [
      { title: "Introduction", slug: [] },
      { title: "New project", slug: ["start", "new-project"] },
      { title: "Existing project", slug: ["start", "existing-project"] },
      { title: "Installation", slug: ["start", "installation"] },
      { title: "Quickstart", slug: ["start", "quickstart"] },
      { title: "Project structure", slug: ["start", "project-structure"] },
    ],
  },
  {
    title: "Concepts",
    pages: [
      { title: "Collections", slug: ["concepts", "collections"] },
      { title: "Fields", slug: ["concepts", "fields"] },
      { title: "Drafts and publishing", slug: ["concepts", "drafts"] },
      { title: "Access control", slug: ["concepts", "access"] },
      { title: "Type inference", slug: ["concepts", "types"] },
    ],
  },
  {
    title: "Admin",
    pages: [
      { title: "Mounting the admin", slug: ["admin", "setup"] },
      { title: "Users and roles", slug: ["admin", "editors"] },
      { title: "Presence and soft locks", slug: ["admin", "presence"] },
    ],
  },
  {
    title: "Guides",
    pages: [
      { title: "Querying content", slug: ["guides", "querying"] },
      { title: "Caching and revalidation", slug: ["guides", "caching"] },
      { title: "Uploads and media", slug: ["guides", "uploads"] },
      { title: "Postgres", slug: ["guides", "postgres"] },
      { title: "S3-compatible storage", slug: ["guides", "storage-s3"] },
      { title: "Using the REST API", slug: ["guides", "rest-api"] },
      { title: "Deploying", slug: ["guides", "deploying"] },
    ],
  },
  {
    title: "Reference",
    pages: [
      { title: "Field helpers", slug: ["reference", "fields"] },
      { title: "defineCollection", slug: ["reference", "define-collection"] },
      { title: "defineConfig", slug: ["reference", "define-config"] },
      { title: "Local API", slug: ["reference", "local-api"] },
      { title: "xenon-cms/next", slug: ["reference", "next"] },
      { title: "REST endpoints", slug: ["reference", "rest"] },
      { title: "Database and storage adapters", slug: ["reference", "adapters"] },
      { title: "Errors", slug: ["reference", "errors"] },
    ],
  },
];
