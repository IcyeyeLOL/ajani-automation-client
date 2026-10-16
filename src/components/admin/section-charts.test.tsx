import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VariantChart } from "@/components/admin/section-charts";
import type { VariantPerformance } from "@/lib/admin/types";

const dmTest = { messageStep: "initial_dm", primaryMetric: "reply_rate" } as const;
const connectionTest = { messageStep: "connection_request", primaryMetric: "acceptance_rate" } as const;

const variant = (label: string, sent: number, counts: Partial<VariantPerformance> = {}): VariantPerformance => ({
  id: `v-${label}`, label, title: `Variant ${label}`, sent, replies: 0, positiveReplies: 0, callsBooked: 0, connectionRequests: 0, connectionsAccepted: 0,
  acceptanceRate: null, replyRate: sent ? 0 : null, positiveRate: sent ? 0 : null, bookingRate: sent ? 0 : null,
  primaryRate: sent ? 0 : null, primaryNumerator: 0, primaryDenominator: sent, primaryMetricLabel: "reply rate", relativeLift: null, status: "not enough data", ...counts,
});

describe("VariantChart", () => {
  it("draws a real 0% when variants were sent but nothing came back", () => {
    const html = renderToStaticMarkup(<VariantChart experiment={dmTest} performance={[variant("A", 40), variant("B", 38)]} />);
    expect(html).toContain('role="img"');
    expect(html.match(/<small>0\.0%<\/small>/g)).toHaveLength(6);
    expect(html).toContain("height:0%");
    expect(html).not.toContain("No results logged");
    expect(html).not.toContain("Accepted");
  });

  it("scales bars against the largest rate and shows one decimal", () => {
    const html = renderToStaticMarkup(<VariantChart experiment={dmTest} performance={[variant("A", 20, { replies: 5, replyRate: 25 }), variant("B", 20, { replies: 1, replyRate: 5 })]} />);
    expect(html).toContain("height:84%");
    expect(html).toContain("<small>25.0%</small>");
    expect(html).toContain("1 reply from 20 sent");
  });

  it("leads connection-request tests with an Accepted bar measured against requests", () => {
    const html = renderToStaticMarkup(<VariantChart experiment={connectionTest} performance={[variant("A", 260, { connectionRequests: 260, connectionsAccepted: 88, acceptanceRate: (88 / 260) * 100 })]} />);
    expect(html.indexOf("Accepted")).toBeLessThan(html.indexOf("Replied"));
    expect(html).toContain("<small>33.8%</small>");
    expect(html).toContain("88 accepted from 260 connection requests");
  });

  it("keeps the empty message for when nothing was sent", () => {
    const html = renderToStaticMarkup(<VariantChart experiment={dmTest} performance={[variant("A", 0), variant("B", 0)]} />);
    expect(html).toContain("No results logged for these variants yet");
    expect(html).not.toContain('role="img"');
  });
});
