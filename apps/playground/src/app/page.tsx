export default function HomePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-20 sm:py-32">
      <p className="font-mono text-xs uppercase tracking-widest text-[var(--muted)]">
        XenonCMS / Playground
      </p>
      <h1 className="mt-8 text-4xl font-semibold tracking-tight sm:text-5xl">
        Content starts with a schema.
      </h1>
      <p className="mt-6 max-w-xl text-lg leading-8 text-[var(--muted)]">
        A small workspace for building with XenonCMS. The posts and media
        collections are defined in <code className="text-sm">src/xenon.config.ts</code>.
      </p>
      <p className="mt-12 border-t border-[var(--line)] pt-6 text-sm text-[var(--muted)]">
        Published content will appear here when the Local API is connected.
      </p>
    </main>
  );
}
