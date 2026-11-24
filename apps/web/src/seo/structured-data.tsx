import { absolute, cardPath, origin, repository, summary } from "./site";

export function StructuredData({ data }: { data: object }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}

const website = { "@id": absolute("/#website") };
const software = { "@id": absolute("/#software") };

export const siteSchema = {
  "@context": "https://schema.org",
  "@graph": [
    {
      ...website, "@type": "WebSite", url: origin, name: "Xenon", alternateName: "XenonCMS",
      inLanguage: "en", about: software,
      hasPart: [
        { "@type": "DigitalDocument", name: "Documentation index", url: absolute("/llms.txt"), encodingFormat: "text/plain" },
        { "@type": "DigitalDocument", name: "Full Xenon documentation", url: absolute("/llms-full.txt"), encodingFormat: "text/plain" },
      ],
    },
    {
      ...software, "@type": ["SoftwareApplication", "SoftwareSourceCode"], name: "Xenon",
      alternateName: ["XenonCMS", "xenon-cms"], description: summary, url: absolute("/"),
      codeRepository: repository, license: "https://opensource.org/license/mit",
      programmingLanguage: "TypeScript", applicationCategory: "DeveloperApplication",
      image: absolute(cardPath("/")), softwareHelp: absolute("/docs"),
    },
  ],
};

export function articleSchema(path: string, title: string, description: string) {
  const url = absolute(path);
  const trail = [{ name: "Xenon", item: absolute("/") }];
  if (path !== "/docs") trail.push({ name: "Documentation", item: absolute("/docs") });
  trail.push({ name: title, item: url });

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "TechArticle", headline: title, description, url, mainEntityOfPage: url,
        inLanguage: "en", about: software, isPartOf: website, image: absolute(cardPath(path)),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: trail.map((item, index) => ({ "@type": "ListItem", position: index + 1, ...item })),
      },
    ],
  };
}
