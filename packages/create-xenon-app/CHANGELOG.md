# create-xenon-app

## 0.4.0

No changes in this release.

## 0.3.0

No changes in this release.

## 0.2.1

### Patch Changes

- 62e848a: New starter for generated Next.js apps: a minimal dark blog with built-in onboarding. Until the first post is published, the home page shows the setup steps (create the admin account, publish a post, make the page yours) with real progress, plus the query the page runs. After that it lists posts with cover images, and each post gets a page (`/posts/[slug]`) rendered with `<RichText>` and an "Edit this post" link. Links to the documentation in the header, onboarding and footer. Plain CSS, no new dependencies. Pages now render on every request, so newly published posts appear without a rebuild.

## 0.2.0

No changes in this release.

## 0.1.1

### Patch Changes

- b54ec2c: Ask whether the app code goes in a `src/` directory or a root `app/` directory, with `--src-dir` / `--no-src-dir` to choose without the prompt. `src/` stays the default.

## 0.1.0

### Minor Changes

- d1a7478: First release: `npm create xenon-app` scaffolds a Next.js project with XenonCMS wired in.
