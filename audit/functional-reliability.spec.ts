import { expect, test, type Page } from "@playwright/test";
import { automationShapeResponseSchema, fallbackAutomationIntake, fallbackAutomationShape } from "../src/lib/record/automation-brief";

const transcript = "Customer appointment requests arrive after office hours and our owner needs a complete qualified brief to follow up in the morning.";

async function enterClarification(page: Page) {
  await page.goto("/record");
  await page.getByRole("button", { name: "Type", exact: true }).click();
  await page.getByRole("textbox", { name: "Tell us where the work gets stuck" }).fill(transcript);
  await page.getByRole("button", { name: "Continue to clarify", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Before Ajani continues.", exact: true });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("checkbox", { name: /I confirm I am 18 or older/ }).check();
  await confirmation.getByRole("button", { name: "Confirm & continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Clarify the details that change the route." })).toBeVisible();
  await page.getByRole("radio", { name: /Something else/ }).check();
  await page.getByRole("textbox", { name: "Clarification in your own words" }).fill("Route to the morning owner.");
}

test("desktop demo should autoplay all four steps without additional clicks", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/demos");
  const theatre = page.getByRole("region", { name: "Automation theatre" });
  await page.locator("#automation-stage").scrollIntoViewIfNeeded();
  await expect(theatre).toHaveAttribute("data-showcase", "true");
  await expect(theatre).toHaveAttribute("data-mode", "playing");
  await expect(theatre.getByRole("status")).toContainText("Playing automation: Lead signal", { timeout: 8_000 });
  await expect(theatre).toHaveAttribute("data-mode", "complete", { timeout: 15_000 });
});

test("record controls should remain usable when optional tab storage is denied", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const original = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (key: string) {
      if (key === "ajani_record_flow_v1") throw new DOMException("audit_storage_denied", "SecurityError");
      return original.call(this, key);
    };
  });
  await page.goto("/record");
  const control = page.getByRole("button", { name: "Type", exact: true });
  await expect(control).toBeAttached();
  await expect.poll(() => control.evaluate((node) => node.closest("[inert]") === null)).toBe(true);
  await control.click();
  await expect(page.getByRole("textbox", { name: "Tell us where the work gets stuck" })).toBeEditable();
  expect(errors.filter((message) => message.includes("audit_storage_denied"))).toEqual([]);
});

test("editing a clarification during generation should invalidate the older response", async ({ page }) => {
  let releaseShape!: () => void;
  const shapeGate = new Promise<void>((resolve) => { releaseShape = resolve; });
  let requestedAnswer = "";
  await page.route("**/api/automation-brief", async (route) => {
    const body = route.request().postDataJSON();
    if (body.action === "shape") {
      requestedAnswer = body.clarificationAnswers[0].answer;
      const result = fallbackAutomationShape(body.transcript, body.clarificationAnswers);
      await shapeGate;
      await route.fulfill({ json: result });
    } else {
      const result = fallbackAutomationIntake(body.transcript);
      await route.fulfill({ json: { ...result, clarifications: result.clarifications.slice(0, 1) } });
    }
  });
  await enterClarification(page);
  await page.getByRole("button", { name: "Build the first route" }).click();
  await expect.poll(() => requestedAnswer).toBe("Route to the morning owner.");
  const answer = page.getByRole("textbox", { name: "Clarification in your own words" });
  await expect(answer).toBeEditable();
  await answer.fill("Route to the evening owner instead.");
  releaseShape();
  await expect(page.getByRole("heading", { name: "Clarify the details that change the route." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Build the first route" })).toBeEnabled();
  await page.getByRole("button", { name: "Build the first route" }).click();
  await expect(page.getByRole("heading", { name: "Shape the route before we build it." })).toBeVisible();
  const details = page.getByRole("list", { name: "Editable system route" }).getByRole("textbox", { name: "What happens" });
  const renderedDetails = await details.evaluateAll((nodes) => nodes.map((node) => (node as HTMLTextAreaElement).value).join("\n"));
  expect(requestedAnswer).toBe("Route to the evening owner instead.");
  expect(renderedDetails).not.toContain("morning owner");
  expect(renderedDetails).toContain("evening owner instead");
});

test("schema-valid generated routes must provide a usable human handoff", async ({ page }) => {
  const result = fallbackAutomationShape(transcript, [{ question: "Who owns the follow-up?", answer: "The morning owner." }]);
  const noHandoff = { ...result, systemBlocks: result.systemBlocks.map((block) => ({ ...block, kind: block.kind === "handoff" ? "custom" as const : block.kind })) };
  expect(automationShapeResponseSchema.safeParse(noHandoff).success).toBe(false);
  await page.route("**/api/automation-brief", async (route) => {
    const body = route.request().postDataJSON();
    const intake = fallbackAutomationIntake(body.transcript);
    await route.fulfill({ json: body.action === "shape" ? noHandoff : { ...intake, clarifications: intake.clarifications.slice(0, 1) } });
  });
  await enterClarification(page);
  await page.getByRole("button", { name: "Build the first route" }).click();
  await expect(page.getByRole("heading", { name: "Shape the route before we build it." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Check this route", exact: true })).toBeEnabled();
});
