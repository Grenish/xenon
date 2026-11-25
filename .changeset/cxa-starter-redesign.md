---
"create-xenon-app": patch
---

New starter for generated Next.js apps: a minimal dark blog with built-in onboarding. Until the first post is published, the home page shows the setup steps (create the admin account, publish a post, make the page yours) with real progress, plus the query the page runs. After that it lists posts with cover images, and each post gets a page (`/posts/[slug]`) rendered with `<RichText>` and an "Edit this post" link. Links to the documentation in the header, onboarding and footer. Plain CSS, no new dependencies. Pages now render on every request, so newly published posts appear without a rebuild.
