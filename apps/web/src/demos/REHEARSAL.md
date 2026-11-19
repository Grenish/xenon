# Rehearsal — landing-page demos

## HeroDemo (`hero-demo.tsx`)
- Gold copied: `examples/hero-demo` (overlapping windows: the config file in front, its right edge on the admin's sidebar line).
- Story (~12s loop, dark, page tokens): `featured: boolean(),` typed into `xenon.config.ts` → ⌘S → the admin grows a Featured switch → the editor turns it on (pill: Changed) → Publish → the live site satellite (`yoursite.com/blog`) marks the post Featured → ⌘Z removes the line, and the switch and the mark follow it out (the reset has a cause). The toast was dropped: the site mark is the one confirmation.
- Compact (358×334, below 760px): the admin is the hero at the top and runs off the bottom, with the config window rising from the bottom edge over filler. The site satellite is dropped there; the status pill confirms the publish.
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

## HeroDemo on the page (2026-11-19)
- No band of its own: it sits on the page's void, inside the page gutters, grown with `fill` (capped at 1500px wide), and fades out at its foot (mask) into the next section.
- Square language: 4px windows, 3px fields, grey lights; shadows only fall downward (a wide one was cut by the stage's top edge).
- Gate: `rehearsal passed` at 1440, 1100 and 390 on the dev server.

## TypesDemo and TryCollection on the page (2026-11-19)
- TypesDemo: no coal plate; `fill` in its column, page surfaces, grey lights, square radii, glow caret, downward-only shadow. Stage 660×500 (was 440) so the bottom fade (mask from 88%) only covers empty editor. Compact 358×350 with the editor running off the bottom and no fade (the suggestions reach the foot). Gate: `rehearsal passed` at 1440 and 390. The caret's per-character step is reported as a `jump:` candidate; it is the typing itself.
- TryCollection's admin preview now uses the hero's dark admin surfaces and square radii instead of the light framed sheet, so the page shows one admin, not two.
