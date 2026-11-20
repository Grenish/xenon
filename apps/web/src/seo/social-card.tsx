import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const cardSize = { width: 1200, height: 630 };

export async function socialCard(article?: { section: string; title: string }) {
  const title = article?.title ?? "Schema in.\nAdmin out.";
  const showCode = article?.section === "Reference" || article?.section === "Concepts";
  // Stills from the landing page's publishing and type-inference demos.
  const mockupPath = showCode ? "social/type-inference.png" : "social/publishing.png";
  const publicDir = join(process.cwd(), "public");
  const [logo, mockup] = await Promise.all([
    readFile(join(publicDir, "xe-logo.svg"), "utf8"),
    readFile(join(publicDir, mockupPath)),
  ]);
  const lightLogo = logo.replaceAll('fill="#000"', 'fill="#eceef0"');
  return new ImageResponse(
    <div style={{
      display: "flex", width: "100%", height: "100%", background: "#000", color: "#eceef0",
      padding: "50px 56px", flexDirection: "column", justifyContent: "center",
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        position: "absolute", right: 24, top: 72, width: 646, height: 486,
        backgroundImage: "radial-gradient(ellipse at center, #12313a 0%, #000 70%)",
      }}>
        <img src={`data:image/png;base64,${mockup.toString("base64")}`} width={636}
          alt={showCode ? "TypeScript editor with Xenon field suggestions" : "Xenon schema, admin, and published post"} />
      </div>
      <img alt="Xenon" width={90} height={38} style={{ position: "absolute", left: 56, top: 50 }}
        src={`data:image/svg+xml;base64,${Buffer.from(lightLogo).toString("base64")}`} />
      <div style={{
        display: "flex", width: 456, whiteSpace: "pre-wrap", fontSize: article ? 60 : 84,
        fontWeight: 700, letterSpacing: "-0.055em", lineHeight: 1.04,
      }}>{title}</div>
      {!article && (
        <div style={{ position: "absolute", left: 56, bottom: 50, fontSize: 26, color: "#b1b7bc" }}>
          The open-source headless CMS for Next.js
        </div>
      )}
    </div>,
    cardSize,
  );
}
