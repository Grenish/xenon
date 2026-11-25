import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getPost } from "../../data";
import { readPreview } from "../../preview";
import { variants } from "../../variants";

export default function StarterPost({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense fallback={null}>
      <Article params={params} />
    </Suspense>
  );
}

async function Article({ params }: { params: Promise<{ slug: string }> }) {
  const [{ slug }, { variant }] = await Promise.all([params, readPreview()]);
  const card = await getPost(decodeURIComponent(slug));
  if (!card) notFound();
  const V = variants[variant];
  return <V.Article card={card} />;
}
