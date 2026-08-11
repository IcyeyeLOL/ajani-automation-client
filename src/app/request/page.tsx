import { BuildRequestFlow } from "@/components/build-request-flow";
import { SiteHeader } from "@/components/site-header";

export default function RequestPage() {
  return <main className="app-shell"><SiteHeader /><BuildRequestFlow /></main>;
}
