import { CaptureDemo } from "./capture-demo";

// Filming route for the stageshow rehearsal: one demo alone on its real ground,
// e.g. /capture?demo=hero or /capture?demo=types. Not linked from the site.
export const metadata = { title: "Capture", robots: { index: false } };

export default async function Capture({ searchParams }: { searchParams: Promise<{ demo?: string }> }) {
  const { demo } = await searchParams;
  return (
    <div id="capture" className={demo === "types" ? "capture capture--types" : "capture capture--hero"}>
      <CaptureDemo demo={demo === "types" ? "types" : "hero"} />
    </div>
  );
}
