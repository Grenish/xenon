import { Suspense } from "react";
import { getPosts, getSetup } from "./data";
import { readPreview, simulate } from "./preview";
import { variants } from "./variants";

export default function StarterHome() {
  return (
    <Suspense fallback={null}>
      <Home />
    </Suspense>
  );
}

async function Home() {
  const { variant, state } = await readPreview();
  const live = await getPosts();
  const { posts, setup } = simulate(state, live, await getSetup(live.length));
  const V = variants[variant];
  return <V.Home posts={posts} setup={setup} />;
}
