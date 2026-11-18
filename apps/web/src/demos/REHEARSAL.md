# Rehearsal — landing-page demos

## HeroDemo (`hero-demo.tsx`)
- Gold copied: `examples/hero-demo` (overlapping windows: the config file in front, its right edge on the admin's sidebar line).
- Story (~18s loop): `featured: boolean(),` typed into `xenon.config.ts` → ⌘S → the post's admin grows a Featured switch → the editor turns it on (pill becomes Changed) → Publish → toast "Published · /blog updated" → the toast closes, the field folds away, the file resets.
- Compact (358×334, below 760px): the admin is the hero at the top and runs off the bottom, with the config window rising from the bottom edge over filler. The toast is dropped there; the status pill confirms the publish.
- Gate: stock `film.mjs --gate` prints `rehearsal passed` at 1440 and 390, on dev and on the production build (`/capture?demo=hero`).

## TypesDemo (`types-demo.tsx`, built and rehearsed by Codex)
- `post.` opens autocomplete over the posts fields with their inferred types; Enter inserts `post.title`; two Undo keystrokes reset the loop.
- Gate: stock film prints `rehearsal passed` at 1280/1440 and 390 on the production build. The caret and the menu's left edge measured 0px apart.

## Kit changes made for Next.js (vendored kit, "Xenon edition" comments)
- `parts/Icon.tsx`: Remix Icon instead of lucide.
- `code.tsx`/`code.css`: each line is wrapped in `<code>`, with an unlayered `display: contents` so the stage's element reset can't block it.
- `parts/Toast.tsx`: Toast.css is served from `/stageshow/kit/parts/Toast.css`, so film's kit-override check can attribute it. The check only recognises kit CSS by a `/kit/` URL, and Next's bundled chunk names don't have one.
- Demos import kit parts per file (`stageshow/kit-lite.ts`), so phone, row and avatar CSS never loads.

## Not checked
- Continuous motion coverage: film exits 2 for frame-sampling gaps on this machine, so its motion verdict is "inconclusive".
- Dark mode (the page has none).
- Reduced motion was checked for the TypesDemo poster only.
