import { llmsText } from "@/seo/llms";

export const dynamic = "force-static";

export function GET() {
  return llmsText(false);
}
