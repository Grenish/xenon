import { cardSize, socialCard } from "@/seo/social-card";
import { homeTitle } from "@/seo/site";

export const alt = homeTitle;
export const size = cardSize;
export const contentType = "image/png";

export default function OpenGraphImage() {
  return socialCard();
}
