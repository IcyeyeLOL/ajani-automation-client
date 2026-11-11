import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { renderBuildMessageEmail } from "@/lib/notifications/build-message";

describe("conversation emails", () => {
  it("escapes everything a person typed and keeps their line breaks", () => {
    const html = renderBuildMessageEmail({
      eyebrow: "Client message",
      heading: "<script>alert(1)</script>",
      intro: "Dana & co sent a message.",
      body: "First line\nsecond line\n\n<img src=x onerror=alert(1)>",
      link: { url: "https://example.com/?a=1&b=\"2\"", label: "<b>Open</b>" },
      ctaUrl: "https://ajaniflow.com/admin/builds/1",
      ctaLabel: "Reply in the control desk",
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>Open</b>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("First line<br>second line");
    expect(html).toContain('href="https://example.com/?a=1&amp;b=&quot;2&quot;"');
    expect(html).toContain("Dana &amp; co sent a message.");
  });
});
