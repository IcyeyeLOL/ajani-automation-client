import { expect, test, type Page } from "@playwright/test";
import { mockAutomationBrief } from "./helpers/mock-automation-brief";

test.beforeEach(async ({ page }) => mockAutomationBrief(page));

async function finishClarifications(page: Page) {
  const nextQuestion = page.getByRole("button", { name: "Next question" });
  while (await nextQuestion.isVisible()) {
    if (await page.getByRole("radio", { checked: true }).count() === 0) {
      await page.getByRole("radio").first().check();
    }
    await page.waitForTimeout(450);
    await nextQuestion.click();
  }
  if (await page.getByRole("radio", { checked: true }).count() === 0) {
    await page.getByRole("radio").first().check();
  }
  await page.getByRole("button", { name: "Build the first route" }).click();
}

async function confirmRequestProcessing(page: Page, intent: "voice" | "continue") {
  const confirmation = page.getByRole("dialog", {
    name: intent === "voice" ? "Before you record." : "Before Ajani continues.",
    exact: true,
  });
  await expect(confirmation).toBeVisible();
  const acknowledgment = confirmation.getByRole("checkbox", { name: /I confirm I am 18 or older/ });
  await expect(acknowledgment).not.toBeChecked();
  await acknowledgment.check();
  await confirmation.getByRole("button", {
    name: intent === "voice" ? "Confirm & start recording" : "Confirm & continue",
    exact: true,
  }).click();
  await expect(confirmation).not.toBeVisible();
}

test("withdrawing a pending processing confirmation blocks AI-assisted stages", async ({ page }) => {
  const processingRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/automation-brief") processingRequests.push(request.method());
  });
  await page.goto("/record");
  await page.getByRole("button", { name: "Type", exact: true }).click();
  await page.getByRole("textbox", { name: "Tell us where the work gets stuck" }).fill(
    "After-hours website leads wait until morning, and the sales team needs a clear follow-up route.",
  );
  await page.getByRole("button", { name: "Continue to clarify" }).click();
  const confirmation = page.getByRole("dialog", { name: "Before Ajani continues.", exact: true });
  await expect(confirmation).toBeVisible();
  const acknowledgment = confirmation.getByRole("checkbox", { name: /I confirm I am 18 or older/ });
  await acknowledgment.check();
  await expect(confirmation.getByRole("button", { name: "Confirm & continue", exact: true })).toBeEnabled();
  await acknowledgment.uncheck();
  await expect(confirmation.getByRole("button", { name: "Confirm & continue", exact: true })).toBeDisabled();
  await confirmation.getByRole("button", { name: "Not now", exact: true }).click();
  await expect(confirmation).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "Tell us where the work gets stuck." })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Build request progress" }).getByRole("button", { name: /Clarify/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Continue to clarify" })).toBeEnabled();
  await page.getByRole("button", { name: "Continue to clarify" }).click();
  await expect(confirmation).toBeVisible();
  await expect(acknowledgment).not.toBeChecked();
  expect(processingRequests).toEqual([]);
});

test("a new record flow starts empty and only advances with user data", async ({ page }) => {
  await page.goto("/record");

  await expect(page.getByText(/Preview mode|After-hours website leads/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue to clarify" })).toBeDisabled();
  await expect(page.getByRole("group", { name: "Choose how to share your note" })).toHaveCSS("animation-name", /stage-control-in/);
  await expect(page.getByRole("region", { name: "Voice note recorder" })).toHaveCSS("animation-name", /recorder-panel-in/);
  await expect(page.getByRole("heading", { name: "Tell us where the work gets stuck." }).locator("../../..")).toHaveAttribute("data-direction", "forward");
  await page.getByRole("button", { name: "Type", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Tell us where the work gets stuck" }).locator("../..")).toHaveCSS("animation-name", /input-surface-in/);
  await page.getByRole("textbox", { name: "Tell us where the work gets stuck" }).fill(
    "After-hours website leads wait until morning, and the sales team needs a clear follow-up route.",
  );
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Continue to clarify" }).click();
  await confirmRequestProcessing(page, "continue");
  await expect(page.getByRole("heading", { name: "Clarify the details that change the route." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Clarify the details that change the route." }).locator("../../..")).toHaveAttribute("data-direction", "forward");
  const clarificationNote = page.getByRole("textbox", { name: "Add or confirm the written version" });
  await expect(clarificationNote).toHaveValue(/After-hours website leads wait until morning/);
  await expect(clarificationNote.locator("..")).toHaveCSS("animation-name", /clarify-note-in/);
  const clarificationGroup = page.getByRole("group", { name: "When should the follow-up leave automation and reach a person?" });
  await expect(clarificationGroup.locator("..")).toHaveCSS("animation-name", /clarify-question-in/);
  await expect(page.getByRole("radio", { name: /When the lead asks about price or availability/ }).locator("..")).toHaveCSS("animation-name", /clarify-option-in/);
  await expect(page.getByText("What Ajani heard", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel(/Clarification question 1 of/)).toBeVisible();
  await expect(page.getByRole("radio", { checked: true })).toHaveCount(0);

  await finishClarifications(page);
  const systemCanvas = page.getByRole("list", { name: "Editable system route" });
  const systemBlocks = systemCanvas.getByRole("listitem");
  await expect(systemBlocks).toHaveCount(4);
  await expect(systemCanvas).toHaveCSS("animation-name", /stage-surface-in/);
  await expect(systemBlocks.first()).toHaveCSS("animation-name", /stage-card-in/);
  await expect(systemCanvas.getByRole("button", { name: /^Drag .+ to reorder$/ })).toHaveCount(0);
  await systemCanvas.getByRole("button", { name: "Move A new enquiry arrives right" }).click();
  await systemCanvas.getByRole("button", { name: "Move A new enquiry arrives right" }).click();
  await expect(systemCanvas.getByRole("textbox", { name: "Step name" }).first()).toHaveValue("Acknowledge it promptly");
  expect(await systemBlocks.first().evaluate((node) => Math.round(node.getBoundingClientRect().height))).toBeLessThan(330);
  await page.getByRole("button", { name: "Check this route" }).click();
  await expect(page.locator("article").filter({ hasText: "Development brief editable" }).first()).toHaveCSS("animation-name", /stage-card-in/);
  await expect(page.getByRole("tabpanel", { name: /Source note/ })).toHaveCSS("animation-name", /review-file-in/);
  await page.getByRole("button", { name: "Approve this route" }).click();
  await expect(page.getByRole("heading", { name: "Your build brief is ready." })).toBeVisible();
  await expect(page.locator("article").filter({ hasText: "Approved build brief" }).first()).toHaveCSS("animation-name", /stage-card-in/);
  await expect(page.getByRole("complementary").filter({ hasText: "Handoff summary" })).toHaveCSS("animation-name", /stage-card-in/);
  await expect(page.getByText("You are sending exactly this.", { exact: true })).toBeVisible();
});

test("every development brief file can be edited without leaving check", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/record");
  await page.getByRole("button", { name: "Type", exact: true }).click();
  await page.getByRole("textbox", { name: "Tell us where the work gets stuck" }).fill(
    "After-hours website leads wait until morning, and the sales team needs a clear follow-up route.",
  );
  await page.getByRole("button", { name: "Continue to clarify" }).click();
  await confirmRequestProcessing(page, "continue");
  await finishClarifications(page);
  await page.getByRole("button", { name: "Check this route" }).click();

  const checkHeading = page.getByRole("heading", { name: "Confirm the system you want built." });
  const briefFiles = page.getByRole("navigation", { name: "Development brief files" });
  const edit = () => page.getByRole("button", { name: "Edit this file" });
  const save = () => page.getByRole("button", { name: "Save changes" });

  const maximumSourceNote = `${"A detailed source-note sentence with the workflow context and expected handoff. ".repeat(300).slice(0, 19_999)}Z`;
  await edit().click();
  await page.getByRole("textbox", { name: "Source note" }).fill(maximumSourceNote);
  await save().click();
  const transcriptReader = page.getByLabel("Full source note. Scroll to read all.");
  await expect(page.getByText("20,000 characters", { exact: false })).toBeVisible();
  expect(await transcriptReader.evaluate((node) => ({ clientHeight: node.clientHeight, scrollHeight: node.scrollHeight }))).toMatchObject({ clientHeight: 280 });
  expect(await transcriptReader.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);

  await edit().click();
  await page.getByRole("textbox", { name: "Source note" }).fill("Appointment changes arrive after hours and need a confirmed calendar response by morning.");
  await save().click();
  await expect(checkHeading).toBeVisible();
  await expect(page.getByRole("heading", { name: "Give every enquiry a timely response and a clear human handoff." })).toBeVisible();

  await briefFiles.getByRole("tab", { name: /Problem/ }).click();
  await edit().click();
  await page.getByRole("textbox", { name: "Work that slips" }).fill("Qualified evening enquiries wait too long for ownership.");
  await page.getByRole("textbox", { name: "When it happens" }).fill("Between the first message and the morning sales queue review.");
  await page.getByRole("textbox", { name: "Success looks like" }).fill("Every qualified evening enquiry reaches an owner with context intact.");
  await save().click();
  await expect(page.getByRole("tabpanel", { name: /Problem/ }).getByText("Every qualified evening enquiry reaches an owner with context intact.", { exact: true })).toBeVisible();

  await briefFiles.getByRole("tab", { name: /Decisions/ }).click();
  await edit().click();
  await page.getByRole("textbox", { name: "Confirmed answer" }).first().fill("Escalate once timing and service fit are confirmed.");
  await save().click();
  await expect(page.getByText("Escalate once timing and service fit are confirmed.", { exact: true })).toBeVisible();

  await briefFiles.getByRole("tab", { name: /Route/ }).click();
  await edit().click();
  await page.getByRole("textbox", { name: "Card 01 title" }).fill("Capture the evening enquiry");
  await save().click();
  await expect(page.getByText("Capture the evening enquiry", { exact: true })).toBeVisible();

  await briefFiles.getByRole("tab", { name: /Protection/ }).click();
  await edit().click();
  await page.getByRole("textbox", { name: "Protection statement" }).fill("Protect response speed without hiding judgment calls from the team.");
  await save().click();
  await expect(page.getByText("Protect response speed without hiding judgment calls from the team.", { exact: true })).toBeVisible();

  await page.waitForTimeout(450);
  await page.reload();
  await expect(checkHeading).toBeVisible();
  await expect(page.getByRole("tabpanel", { name: /Source note/ })).toContainText("Appointment changes arrive after hours");
  await briefFiles.getByRole("tab", { name: /Route/ }).click();
  await expect(page.getByText("Capture the evening enquiry", { exact: true })).toBeVisible();
  await briefFiles.getByRole("tab", { name: /Protection/ }).click();
  await expect(page.getByText("Protect response speed without hiding judgment calls from the team.", { exact: true })).toBeVisible();
});

test("the voice recorder captures, pauses, resumes, and finishes a note", async ({ page }) => {
  await page.goto("/record");
  await page.context().grantPermissions(["microphone"], { origin: new URL(page.url()).origin });

  await expect(page.getByText("Ready to record", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start recording your voice note" })).toBeEnabled();
  await page.getByRole("button", { name: "Start recording your voice note" }).click();
  await expect(page.getByRole("dialog", { name: "Before you record.", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Voice note recorder", includeHidden: true })).toHaveAttribute("data-phase", "idle");
  await confirmRequestProcessing(page, "voice");
  await expect(page.getByText("Recording", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pause & edit", exact: true }).click();
  await expect(page.getByRole("region", { name: "Voice note recorder" }).getByRole("status")).toHaveText("Recording paused");
  await expect(page.getByText("Edit the note before you continue", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue to clarify" })).toBeDisabled();
  const editableTranscript = page.getByRole("textbox", { name: "Edit your voice note transcript" });
  await editableTranscript.fill("After-hours leads wait until the next morning.");
  await page.getByRole("button", { name: "Continue recording", exact: true }).click();
  await expect(page.getByText("Recording", { exact: true })).toBeVisible();
  await page.waitForTimeout(1_100);
  await page.getByRole("button", { name: "Pause & edit", exact: true }).click();
  await expect(editableTranscript).toHaveValue("After-hours leads wait until the next morning.");
  await editableTranscript.fill("After-hours leads wait until the next morning. The sales queue should receive qualified replies.");
  await page.getByRole("button", { name: "Use this note" }).click();

  await expect(page.getByRole("region", { name: "Voice note recorder" }).getByRole("status")).toHaveText("Voice note ready");
  await expect(page.getByText("Voice note saved", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue to clarify" })).toBeEnabled();
  await page.getByRole("button", { name: "Continue to clarify" }).click();
  await expect(page.getByRole("textbox", { name: "Add or confirm the written version" })).toHaveValue(/sales queue should receive qualified replies/);
});

test("privacy policy stays aligned with the implementation", async ({ page }) => {
  await page.goto("/privacy");

  await expect(page.getByRole("heading", { name: "Who this policy covers and Ajani's role" })).toBeVisible();
  await expect(page.locator("#state").getByText(/does not sell personal information/i)).toBeVisible();
  await expect(page.getByText(/before a request is saved.+suggest clarification questions/i)).toBeVisible();
  await expect(page.getByText(/Deepgram.+editable transcript/i)).toBeVisible();
  await expect(page.getByText(/original audio is uploaded to private Ajani storage/i)).toBeVisible();
  await expect(page.getByText(/unclaimed saved drafts and voice uploads:.+30 days/i)).toBeVisible();
  await expect(page.getByRole("link", { name: "Privacy policy" }).last()).toHaveAttribute("href", "/privacy");

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.locator("main").evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
});

test("the public footer exposes verified contact, social, navigation, and legal destinations", async ({ page }) => {
  for (const path of ["/", "/demos", "/record", "/terms"]) {
    await page.goto(path);
    const footer = page.getByRole("contentinfo");

    await expect(footer).toHaveCount(1);
    await expect(footer.getByRole("link", { name: "Ajani Automation home" })).toHaveAttribute("href", "/");
    await expect(footer.getByRole("link", { name: "olakunleajani@ajaniautomation.com" })).toHaveAttribute("href", "mailto:olakunleajani@ajaniautomation.com");
    await expect(footer.getByRole("link", { name: "YouTube" })).toHaveAttribute("href", "https://youtu.be/upEkMB8pYRA");
    await expect(footer.getByRole("link", { name: "LinkedIn" })).toHaveAttribute("href", "https://www.linkedin.com/in/olakunleajani/");
    await expect(footer.getByRole("img", { name: /coming soon/i })).toHaveCount(0);
    for (const [name, href] of [
      ["Process", "/#process"],
      ["Client work", "/#client-work"],
      ["Demos", "/demos"],
      ["FAQ", "/#faq"],
    ] as const) {
      await expect(footer.getByRole("link", { name, exact: true })).toHaveAttribute("href", href);
    }
    const legalLinks = footer.locator('[data-footer-legal="true"]').getByRole("link");
    await expect(legalLinks).toHaveCount(3);
    await expect(legalLinks.nth(0)).toHaveAttribute("href", "/legal");
    await expect(legalLinks.nth(1)).toHaveAttribute("href", "/terms");
    await expect(legalLinks.nth(2)).toHaveAttribute("href", "/privacy");
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const mobileFooter = page.getByRole("contentinfo");
  expect(await mobileFooter.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
});

test("a visitor can complete the public funnel and open account access without losing progress", async ({ page }) => {
  let draftRequests = 0;
  let acknowledgmentRequests = 0;
  let submittedBrief: unknown;
  let submittedAcknowledgment: unknown;
  let submittedVersions: unknown;
  await page.route("**/api/request-drafts", async (route) => {
    draftRequests += 1;
    const submittedDraft = (await route.request().postDataJSON()).draft;
    submittedBrief = submittedDraft.developmentBrief;
    submittedAcknowledgment = submittedDraft.legalAcceptanceAcknowledged;
    submittedVersions = submittedDraft.legalAcceptanceVersions;
    await route.fulfill({
      contentType: "application/json",
      status: 201,
      body: JSON.stringify({
        draft: { id: "bfa16669-b62c-49e5-a356-9ac634a969bb", status: "ready_to_submit", updated_at: new Date().toISOString() },
        draftToken: "deterministic-browser-test-capability-token",
      }),
    });
  });
  await page.route("**/api/request-drafts/acknowledge", async (route) => {
    acknowledgmentRequests += 1;
    await route.fulfill({
      contentType: "application/json",
      status: 200,
      body: JSON.stringify({ status: "acknowledged" }),
    });
  });
  await page.goto("/record");

  await page.getByRole("button", { name: "Type", exact: true }).click();
  const writtenBrief = page.getByRole("textbox", { name: "Tell us where the work gets stuck" });
  await writtenBrief.fill(
    "Website enquiries arrive after hours and our team misses the follow-up.",
  );
  await page.getByRole("button", { name: "Continue to clarify" }).click();
  await confirmRequestProcessing(page, "continue");

  const clarifyHeading = page.getByRole("heading", { name: "Clarify the details that change the route." });
  await expect(clarifyHeading).toBeFocused();
  await expect(clarifyHeading).toBeInViewport();
  await expect(page.getByRole("group", {
    name: "When should the follow-up leave automation and reach a person?",
  })).toBeVisible();

  const suggestedAnswer = page.getByRole("radio", {
    name: /When the lead shares a real date, budget, or project detail/,
  });
  await expect(suggestedAnswer).toHaveAttribute("type", "radio");
  await expect(suggestedAnswer).not.toBeChecked();
  await expect(suggestedAnswer.locator("..")).toContainText("Suggested");
  await finishClarifications(page);

  const shapeHeading = page.getByRole("heading", { name: "Shape the route before we build it." });
  await expect(shapeHeading).toBeFocused();
  await expect(shapeHeading).toBeInViewport();
  const routeEditor = page.getByRole("list", { name: "Editable system route" });
  await expect(routeEditor.getByRole("listitem")).toHaveCount(4);
  await expect(routeEditor.getByRole("textbox", { name: "Step name" }).first()).toHaveValue("A new enquiry arrives");
  const replyName = routeEditor.getByRole("textbox", { name: "Step name" }).nth(1);
  await replyName.click();
  await expect(replyName).toHaveCSS("outline-style", "none");
  await expect(replyName).toHaveCSS("box-shadow", /0px 0px 0px 1px/);
  await expect(routeEditor.getByRole("button", { name: /^Drag .+ to reorder$/ })).toHaveCount(0);
  await routeEditor.getByRole("button", { name: "Move Acknowledge it promptly right" }).click();
  await routeEditor.getByRole("button", { name: "Move Acknowledge it promptly right" }).click();
  await expect(routeEditor.getByRole("listitem").last()).toHaveAttribute("aria-label", "System block 4: Acknowledge it promptly");
  await page.getByRole("button", { name: "Reset suggestion" }).click();
  await expect.poll(() => routeEditor.getByRole("listitem").first().evaluate((node) =>
    node.getAnimations().every((animation) => animation.playState === "finished"),
  )).toBe(true);
  await expect(routeEditor.locator('[data-kind="trigger"]')).toHaveCSS("border-top-color", "rgb(189, 150, 112)");
  await expect(routeEditor.locator('[data-kind="reply"]')).toHaveCSS("border-top-color", "rgb(121, 0, 24)");
  await expect(routeEditor.locator('[data-kind="qualify"]')).toHaveCSS("border-top-color", "rgb(122, 92, 67)");
  await expect(routeEditor.locator('[data-kind="handoff"]')).toHaveCSS("border-top-color", "rgb(37, 92, 81)");
  const dragCard = routeEditor.getByRole("listitem").first();
  const destination = routeEditor.getByRole("listitem").last();
  const reconsideredDestination = routeEditor.getByRole("listitem").nth(2);
  const dragSurface = await dragCard.boundingBox();
  const destinationCard = await destination.boundingBox();
  const reconsideredCard = await reconsideredDestination.boundingBox();
  expect(dragSurface).not.toBeNull();
  expect(destinationCard).not.toBeNull();
  expect(reconsideredCard).not.toBeNull();
  await dragCard.hover({ position: { x: 30, y: 12 } });
  await page.mouse.down();
  await expect(routeEditor).toHaveAttribute("data-reordering", "true");
  await page.mouse.move(destinationCard!.x + destinationCard!.width * .75, destinationCard!.y + destinationCard!.height / 2, { steps: 10 });
  await expect(routeEditor.getByRole("listitem").last()).toHaveAttribute("aria-label", "System block 4: A new enquiry arrives");
  await page.mouse.move(
    reconsideredCard!.x + reconsideredCard!.width / 2 - dragSurface!.width / 2 + 30,
    reconsideredCard!.y + reconsideredCard!.height / 2,
    { steps: 8 },
  );
  await expect(routeEditor.getByRole("listitem").nth(2)).toHaveAttribute("aria-label", "System block 3: A new enquiry arrives");
  await page.mouse.up();
  await expect(routeEditor).toHaveAttribute("data-reordering", "false");
  await expect(routeEditor.locator('[data-dragging="true"]')).toHaveCount(0);
  await expect(routeEditor.getByRole("listitem").nth(2)).toHaveAttribute("aria-label", "System block 3: A new enquiry arrives");
  expect(await routeEditor.getByRole("listitem").nth(2).evaluate((node) => ({
    x: node.style.getPropertyValue("--drag-x"),
    y: node.style.getPropertyValue("--drag-y"),
  }))).toEqual({ x: "", y: "" });
  await page.getByRole("button", { name: "Reset suggestion" }).click();
  const interruptedCard = routeEditor.getByRole("listitem").first();
  const interruptedSurface = await interruptedCard.boundingBox();
  expect(interruptedSurface).not.toBeNull();
  await interruptedCard.hover({ position: { x: 30, y: 12 } });
  await page.mouse.down();
  await page.mouse.move(interruptedSurface!.x + 30, interruptedSurface!.y + interruptedSurface!.height / 2, { steps: 4 });
  await expect(routeEditor).toHaveAttribute("data-reordering", "true");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(routeEditor).toHaveAttribute("data-reordering", "false");
  await expect(routeEditor.locator('[data-dragging="true"]')).toHaveCount(0);
  await page.mouse.up();
  await page.getByRole("button", { name: "Check this route" }).click();

  const checkHeading = page.getByRole("heading", { name: "Confirm the system you want built." });
  await expect(checkHeading).toBeFocused();
  await expect(checkHeading).toBeInViewport();
  await expect(page.getByText("Based on your budget", { exact: true })).toBeVisible();
  await expect(page.getByText("7–10 days", { exact: true })).toBeVisible();
  await expect(page.getByText("After you approve", { exact: true })).toBeVisible();
  await expect(page.locator("article").filter({ hasText: "Development brief editable" }).first()).toHaveCSS("background-color", "rgb(251, 250, 247)");
  await expect(page.getByRole("heading", { name: /Give every enquiry a timely response/ })).toHaveCSS("font-weight", "600");
  expect(Number(await page.locator("blockquote").first().evaluate((node) => getComputedStyle(node).fontWeight))).toBeGreaterThanOrEqual(450);
  await expect(page.getByRole("complementary").getByRole("listitem").filter({ hasText: "Intake from the channels you already use" }).locator("i")).toHaveCSS("color", "rgb(45, 120, 103)");
  const briefFiles = page.getByRole("navigation", { name: "Development brief files" });
  await expect(briefFiles.getByRole("tab")).toHaveCount(5);
  await expect(briefFiles.getByRole("tab", { name: /Source note/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: /Source note/ })).toContainText(/Website enquiries arrive after hours/);
  await page.getByRole("button", { name: "Next file" }).click();
  await expect(briefFiles.getByRole("tab", { name: /Problem/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("The workflow we are solving", { exact: true })).toBeVisible();
  await briefFiles.getByRole("tab", { name: /Decisions/ }).click();
  await expect(page.getByRole("list", { name: "Confirmed build decisions" }).getByRole("listitem")).toHaveCount(2);
  await briefFiles.getByRole("tab", { name: /Route/ }).click();
  const approvedRouteCards = page.getByRole("list", { name: "Approved route cards" });
  await expect(approvedRouteCards.getByRole("listitem")).toHaveCount(4);
  await expect(approvedRouteCards.getByText("Capture the enquiry from the channel where it was received.", { exact: true })).toBeVisible();
  await briefFiles.getByRole("tab", { name: /Protection/ }).click();
  await expect(page.getByText("What this protects", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Approve this route" }).click();

  const sendHeading = page.getByRole("heading", { name: "Your build brief is ready." });
  await expect(sendHeading).toBeFocused();
  await expect(sendHeading).toBeInViewport();
  await expect(page.getByText("You are sending exactly this.", { exact: true })).toBeVisible();
  await expect(page.getByText("Handoff preview", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "4 steps in build order" })).toBeVisible();
  await expect(page.getByText("1 day", { exact: true })).toHaveCount(0);
  await expect(page.getByText("3 days", { exact: true })).toHaveCount(0);
  const legalAcceptance = page.getByRole("checkbox", { name: /I agree to Ajani's Terms of Service/ });
  const sendButton = page.getByRole("button", { name: "Send to Ajani" });
  await expect(legalAcceptance).not.toBeChecked();
  await expect(sendButton).toBeDisabled();
  const legalAcceptanceGroup = legalAcceptance.locator("..");
  await expect(legalAcceptanceGroup.getByRole("link", { name: "Terms of Service" })).toHaveAttribute("href", "/terms");
  await expect(legalAcceptanceGroup.getByRole("link", { name: "Acceptable Use Policy" })).toHaveAttribute("href", "/acceptable-use");
  await expect(legalAcceptanceGroup.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
  await legalAcceptance.check();
  await expect(sendButton).toBeEnabled();
  await sendButton.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/Add the Clerk publishable and secret keys to activate account access here|Create (?:your workspace|an Ajani Automation account)/);
  await expect.poll(() => draftRequests).toBe(1);
  expect(submittedBrief).toMatchObject({
    workThatSlips: expect.any(String),
    momentItHappens: expect.any(String),
    desiredOutcome: expect.any(String),
    protection: expect.any(String),
  });
  expect(submittedAcknowledgment).toBe(true);
  expect(submittedVersions).toEqual({
    noticeVersion: "handoff-notice-2026-09-02",
    acceptableUseVersion: "2026-09-02",
    privacyVersion: "2026-09-02",
    termsVersion: "2026-09-02",
  });

  await page.getByRole("button", { name: "Close account access" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Continue to account" }).click();
  await expect(dialog).toBeVisible();
  await expect.poll(() => draftRequests).toBe(1);
  await expect.poll(() => acknowledgmentRequests).toBe(1);
});

test("the recorder keeps compact progress, focus, and motion safe at narrow widths", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/record");
  await page.locator("html").evaluate((element) => element.setAttribute("data-motion", "system"));
  await expect(page.locator("html")).not.toHaveAttribute("data-motion", "full");

  await expect(page.getByText("Step 1 of 5", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Build request progress" }).getByRole("list")).toBeHidden();
  await expect(page.getByRole("group", { name: "Choose how to share your note" })).toHaveCSS("animation-name", "none");
  await expect(page.getByRole("region", { name: "Voice note recorder" })).toHaveCSS("animation-name", "none");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

  const firstStage = page.getByRole("heading", { name: "Tell us where the work gets stuck." });
  const firstStageSection = firstStage.locator("../..");
  await expect(firstStageSection).toHaveCSS("animation-name", "none");

  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Type", exact: true }).click();
  const mobileStressNote = "After-hours leads arrive from several channels, but the follow-up waits until the next morning and nobody can see whether a colleague already replied. ".repeat(12);
  await page.getByRole("textbox", { name: "Tell us where the work gets stuck" }).fill(mobileStressNote);
  await page.getByRole("button", { name: "Continue to clarify" }).click();
  await confirmRequestProcessing(page, "continue");

  const clarifyHeading = page.getByRole("heading", {
    name: "Clarify the details that change the route.",
  });
  await expect(clarifyHeading).toBeFocused();
  await expect(clarifyHeading).toBeInViewport();
  await expect(page.getByText("Step 2 of 5", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Add or confirm the written version" }).locator("..")).toHaveCSS("animation-name", "none");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

  await page.getByRole("radio", {
    name: /When the lead shares a real date, budget, or project detail/,
  }).check();
  await finishClarifications(page);
  await expect(page.getByRole("heading", { name: "Shape the route before we build it." })).toBeFocused();
  await expect(page.getByText("Step 3 of 5", { exact: true })).toBeVisible();

  const routeEditor = page.getByRole("region", { name: "Mobile system editor" });
  const routeMap = routeEditor.getByRole("navigation", { name: "Choose a route step" });
  await expect(routeMap.getByRole("button")).toHaveCount(4);
  const stepTitle = routeEditor.getByRole("textbox", { name: "Step name" });
  const stepDetail = routeEditor.getByRole("textbox", { name: "What happens" });
  await stepDetail.scrollIntoViewIfNeeded();
  const [routeEditorBounds, checkRouteBounds, backToClarifyBounds] = await Promise.all([
    routeEditor.boundingBox(),
    page.getByRole("button", { name: "Check this route" }).boundingBox(),
    page.getByRole("button", { name: "Back to clarify" }).boundingBox(),
  ]);
  expect(routeEditorBounds).not.toBeNull();
  expect(checkRouteBounds).not.toBeNull();
  expect(backToClarifyBounds).not.toBeNull();
  for (const actionBounds of [checkRouteBounds!, backToClarifyBounds!]) {
    expect(
      actionBounds.y,
      "mobile route actions must stay below the complete editor while its fields are scrolled into view",
    ).toBeGreaterThanOrEqual(routeEditorBounds!.y + routeEditorBounds!.height - 1);
  }
  await stepTitle.fill("Capture the new enquiry from every active customer channel");
  await expect(stepTitle).toHaveAttribute("maxlength", "120");
  expect(await stepTitle.evaluate((node) => ({
    clientWidth: node.clientWidth,
    height: node.getBoundingClientRect().height,
    scrollWidth: node.scrollWidth,
    tag: node.tagName,
  }))).toMatchObject({ height: expect.any(Number), tag: "TEXTAREA" });
  expect(await stepTitle.evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(70);
  expect(await stepTitle.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);

  const touchControls = [
    routeEditor.getByRole("button", { name: "Reorder" }),
    page.getByRole("button", { name: "+ Add step" }),
    page.getByRole("button", { name: "Reset suggestion" }),
    routeMap.getByRole("button").first(),
  ];
  for (const control of touchControls) {
    const size = await control.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { height: rect.height, width: rect.width };
    });
    expect(size.height).toBeGreaterThanOrEqual(44);
    expect(size.width).toBeGreaterThanOrEqual(44);
  }

  await routeEditor.getByRole("button", { name: "Reorder" }).click();
  const reorderList = routeEditor.getByRole("list", { name: "Reorder system route" });
  const firstReorderRow = reorderList.getByRole("listitem").first();
  await expect(firstReorderRow).toHaveCSS("touch-action", "pan-y");
  await expect(firstReorderRow.locator("span[aria-hidden='true']").first()).toHaveCSS("touch-action", "none");
  const reorderArrow = firstReorderRow.getByRole("button", { name: /down/ });
  expect(await reorderArrow.evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await routeEditor.getByRole("button", { name: "Done" }).click();

  await page.getByRole("button", { name: "+ Add step" }).click();
  await expect(routeMap.getByRole("button")).toHaveCount(5);
  await expect(routeEditor.getByRole("textbox", { name: "Step name" })).toHaveValue("New step");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "Check this route" }).click();
  await expect(page.getByText("Step 4 of 5", { exact: true })).toBeVisible();
  await expect(page.getByText("Development brief editable", { exact: true })).toBeVisible();
  const fileNav = page.getByRole("navigation", { name: "Development brief files" });
  for (let fileIndex = 0; fileIndex < 3; fileIndex += 1) {
    await page.getByRole("button", { name: "Next file →" }).click();
  }
  await expect.poll(() => fileNav.evaluate((nav) => {
    const active = nav.querySelector<HTMLElement>("[aria-selected='true']");
    if (!active) return false;
    const navBounds = nav.getBoundingClientRect();
    const activeBounds = active.getBoundingClientRect();
    return activeBounds.left >= navBounds.left - 1 && activeBounds.right <= navBounds.right + 1;
  })).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "Approve this route" }).click();
  await expect(
    page
      .getByRole("navigation", { name: "Build request progress" })
      .getByText("Step 5 of 5", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your build brief is ready." })).toBeVisible();
  const mobileReceipt = page.getByRole("article", { name: "Mobile handoff receipt" });
  await expect(mobileReceipt.getByText("Handoff preview", { exact: true })).toBeVisible();
  await expect(mobileReceipt.locator("summary").filter({ hasText: "Approved route" })).toBeVisible();
  await mobileReceipt.locator("details").last().locator("summary").click();
  const receiptSource = mobileReceipt.getByLabel("Full source note. Scroll to read all.");
  await expect(receiptSource).toHaveCSS("max-height", "300px");
  await expect(receiptSource).toHaveCSS("overflow-y", "auto");
  expect(await receiptSource.evaluate((node) => node.scrollHeight)).toBeGreaterThan(
    await receiptSource.evaluate((node) => node.clientHeight),
  );
  expect(await page.getByRole("button", { name: "Back to check" }).evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("the recorder remains usable at 320 by 800", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/record");

  await expect(page.getByText("Step 1 of 5", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Build request progress" }).getByRole("list")).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Type", exact: true }).click();
  await page.getByRole("textbox", { name: "Tell us where the work gets stuck" }).fill(
    "After-hours leads arrive, but the follow-up waits until the next morning.",
  );
  await page.getByRole("button", { name: "Continue to clarify" }).click();
  await confirmRequestProcessing(page, "continue");

  const clarifyHeading = page.getByRole("heading", {
    name: "Clarify the details that change the route.",
  });
  await expect(clarifyHeading).toBeFocused();
  await expect(clarifyHeading).toBeInViewport();
  await expect(page.getByText("Step 2 of 5", { exact: true })).toBeVisible();
  const overflowingElements = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    return Array.from(document.body.querySelectorAll<HTMLElement>("*"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          className: element.className,
          right: Math.round(rect.right),
          tag: element.tagName,
          text: element.textContent?.trim().slice(0, 80),
          width: Math.round(rect.width),
        };
      })
      .filter((element) => element.width > 0 && element.right > viewportWidth + 1);
  });
  expect(overflowingElements).toEqual([]);
});

test("a failed recorder save is announced and can be retried", async ({ page }) => {
  let draftRequests = 0;
  await page.route("**/api/request-drafts", async (route) => {
    draftRequests += 1;
    if (draftRequests === 1) {
      await route.fulfill({
        contentType: "application/json",
        status: 503,
        body: JSON.stringify({ error: "The request service is temporarily unavailable. Please retry." }),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      status: 201,
      body: JSON.stringify({
        draft: { id: "d353cff7-9863-40e5-8b57-8ac3d6c9a5cb", status: "ready_to_submit", updated_at: new Date().toISOString() },
        draftToken: "deterministic-browser-test-capability-token",
      }),
    });
  });
  await page.goto("/record");

  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Type", exact: true }).click();
  await page.getByRole("textbox", { name: "Tell us where the work gets stuck" }).fill(
    "After-hours leads arrive, but the follow-up waits until the next morning.",
  );
  await page.getByRole("button", { name: "Continue to clarify" }).click();
  await confirmRequestProcessing(page, "continue");
  await page.getByRole("radio", {
    name: /When the lead shares a real date, budget, or project detail/,
  }).check();
  await finishClarifications(page);
  await page.getByRole("button", { name: "Check this route" }).click();
  await page.getByRole("button", { name: "Approve this route" }).click();
  const acceptance = page.getByRole("checkbox", { name: /I agree to Ajani's Terms of Service/ });
  await acceptance.check();
  await page.getByRole("button", { name: "Send to Ajani" }).click();

  const saveAlert = page.getByRole("alert").filter({ hasText: "temporarily unavailable" });
  await expect(saveAlert).toContainText("temporarily unavailable");
  await expect(acceptance).toBeChecked();
  await saveAlert.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect.poll(() => draftRequests).toBe(2);
});

test("the homepage offers direct workflow contact while record access stays account-gated", async ({ page }) => {
  await page.goto("/");

  const header = page.locator("header").first();
  await expect(header.getByRole("link", { name: "Sign in" })).toHaveCount(0);
  for (const [name, href] of [
    ["Client work", "/#client-work"],
    ["Process", "/#process"],
    ["Demos", "/demos"],
    ["FAQ", "/#faq"],
  ] as const) {
    await expect(header.getByRole("link", { name, exact: true })).toHaveAttribute("href", href);
  }
  await expect(header.getByRole("link", { name: "Discuss a workflow" })).toHaveAttribute(
    "href",
    "mailto:olakunleajani@ajaniautomation.com?subject=Workflow%20audit",
  );
  await expect(header.getByRole("link", { name: "Record a note" })).toHaveCount(0);

  const main = page.locator("main");
  await expect(main.getByRole("link", { name: "Discuss a workflow" }).first()).toHaveAttribute(
    "href",
    "mailto:olakunleajani@ajaniautomation.com?subject=Workflow%20audit",
  );
  const record = main.getByRole("link", { name: /^Record a note/ }).first();
  await expect(record).toHaveAttribute("href", "/sign-in?redirect_url=%2Frecord");
  await record.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText(/Continue to Ajani Automation|Sign in to Ajani|Clerk connection needed/i);
  await expect(page).toHaveURL(/\/$/);
});

test("the homepage explains the Ajani workflow in an accessible process section", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", {
    level: 1,
    name: "AI workflow systems for service businesses.",
  })).toBeVisible();

  await expect(page.locator("#solutions")).toHaveCount(0);

  const process = page.locator("#process");
  await expect(process.getByRole("heading", {
    name: "You know the route before the build begins.",
  })).toBeVisible();
  await expect(process.getByTestId("how-it-works-timeline").getByRole("listitem")).toHaveCount(4);
  await expect(process.getByRole("heading", { name: "Approve scope and price" })).toBeVisible();
});

test("automation theatre runs play by play with accessible controls", async ({ page }) => {
  await page.goto("/demos");

  await expect(page.getByRole("heading", { name: /Watch the system work/i })).toBeVisible();
  await expect(page.getByRole("link", { name: "Demos" }).first()).toHaveAttribute("aria-current", "page");
  const theatre = page.getByRole("region", { name: "Automation theatre" });
  await theatre.getByRole("button", { name: "Restart automation demo", exact: true }).click();
  await expect(theatre.getByRole("tab", { name: /After-hours leads/i })).toHaveAttribute("aria-selected", "true");
  const runAutomation = theatre.getByRole("button", { name: "Run After-hours leads automation" });
  const pauseAutomation = theatre.getByRole("button", { name: "Pause After-hours leads automation" });
  await expect(async () => {
    await runAutomation.press("Enter");
    await expect(pauseAutomation).toBeVisible();
  }).toPass();
  await expect(theatre.getByRole("status")).toContainText("Playing automation: Lead signal");
  await pauseAutomation.press("Enter");
  await theatre.getByRole("button", { name: "Advance one automation step" }).press("Enter");
  await expect(theatre.getByRole("status")).toContainText("Paused at Intent scan");
  await expect(theatre.getByRole("list", { name: "Automation event ledger" }).getByText("Intent mapped")).toBeVisible();
  await theatre.getByRole("tab", { name: /Client intake/i }).press("Enter");
  await expect(theatre.getByRole("status")).toContainText("Ready to trace the system");
  expect(await theatre.getByRole("button", { name: "Run from step 1: Context arrives" }).evaluate((node) => getComputedStyle(node).animationName)).toContain("graph-node-enter");
});

test("automation boxes start and pause the selected route", async ({ page }) => {
  await page.goto("/demos");

  const theatre = page.getByRole("region", { name: "Automation theatre" });
  await theatre.getByRole("button", { name: "Restart automation demo", exact: true }).click();
  const status = theatre.getByRole("status");

  await theatre.getByRole("button", { name: "Run from step 2: Intent scan" }).click();
  await expect(status).toContainText("Playing automation: Intent scan");

  await theatre.getByRole("button", { name: "Pause at step 2: Intent scan" }).click();
  await expect(status).toContainText("Paused at Intent scan");

  await theatre.getByRole("button", { name: "Run from step 3: Personal reply" }).click();
  await expect(status).toContainText("Playing automation: Personal reply");
});

test("each automation route has its own step icon set", async ({ page }) => {
  await page.goto("/demos");

  const theatre = page.getByRole("region", { name: "Automation theatre" });
  const icons = () => theatre.locator("span[data-icon]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-icon")));

  await expect.poll(icons).toEqual(["sun", "intent", "reply", "handoff"]);
  await expect(async () => {
    await theatre.getByRole("tab", { name: /Client intake/i }).click();
    await expect.poll(icons).toEqual(["inbox", "magnify", "brief", "alignment"]);
  }).toPass();
  await expect(async () => {
    await theatre.getByRole("tab", { name: /Returning clients/i }).click();
    await expect.poll(icons).toEqual(["spark", "relationship", "nudge", "owner"]);
  }).toPass();
});

test("automation theatre fallback stays manual when the full-motion override is absent", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/demos");
  await page.locator("html").evaluate((element) => element.setAttribute("data-motion", "system"));
  await expect(page.locator("html")).not.toHaveAttribute("data-motion", "full");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.emulateMedia({ reducedMotion: "reduce" });

  const theatre = page.getByRole("region", { name: "Automation theatre" });
  await theatre.getByRole("button", { name: "Restart automation demo", exact: true }).click();
  const status = theatre.getByRole("status");
  await expect(status).toContainText("Motion is simplified for this device");
  await theatre.getByRole("button", { name: "Run After-hours leads automation" }).click();
  await expect(status).toContainText("Paused at Lead signal");
  await page.waitForTimeout(3_100);
  await expect(status).toContainText("Paused at Lead signal");
});

test("the homepage keeps its final route readable when the full-motion override is absent", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.locator("html").evaluate((element) => element.setAttribute("data-motion", "system"));
  await expect(page.locator("html")).not.toHaveAttribute("data-motion", "full");

  await expect(page.getByRole("button", { name: /motion/i })).toHaveCount(0);
  const carousel = page.locator('[data-hero-carousel="true"]');
  const sceneViewport = carousel.locator('[data-scene-viewport="true"]');
  const fallback = carousel.locator('[data-static-fallback="true"]');

  await expect(sceneViewport).toBeHidden();
  await expect(fallback).toBeVisible();
  await expect(fallback.locator('[data-route-path="true"]').first()).toHaveCSS("animation-name", "none");
  await expect(fallback.locator('[data-waveform="true"]').first()).toHaveCSS("animation-name", "none");
  await expect(fallback.locator('[data-node-surface="true"]').first()).toHaveCSS("opacity", "1");
  await expect(fallback.locator("p")).toContainText("a route your team can review");
  expect(await fallback.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);
});

test("internal navigation does not show a floating opening notice", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText(/Opening demos/i)).toHaveCount(0);
});

test("homepage distinguishes same-session review from the target build timeline", async ({ page }) => {
  await page.goto("/");

  const timeline = page.locator("#process");
  await expect(timeline.getByText("Same session", { exact: true })).toHaveCount(1);
  await expect(timeline.getByText("1 day", { exact: true })).toHaveCount(0);
  await expect(timeline.getByText("3 days", { exact: true })).toHaveCount(0);
  await expect(timeline.getByText("Before build", { exact: true })).toBeVisible();
  await expect(timeline.getByText("Target: 7–10 days", { exact: true })).toBeVisible();
  await expect(page.getByText("Ready when you are", { exact: true })).toHaveCount(0);
  await expect(page.getByText("The working agreement", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Based on your budget", { exact: true })).toHaveCount(0);
  await expect(page.getByText("After you approve", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Start here", { exact: true })).toHaveCount(0);
});

test("mobile navigation fits the viewport and keeps every primary destination available", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const header = page.locator("header").first();
  const headerOverflows = await header.evaluate((node) => node.scrollWidth > node.clientWidth);
  expect(headerOverflows).toBe(false);
  const menuTrigger = header.getByRole("button", { name: "Open navigation menu" });
  await expect(menuTrigger).toBeVisible();
  expect(await menuTrigger.evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await menuTrigger.click();

  const menuDialog = page.getByRole("dialog");
  const mobileNavigation = menuDialog.getByRole("navigation", { name: "Mobile navigation" });
  await expect(header.locator('a[href="/"]').first()).toBeVisible();
  for (const [name, href] of [
    ["Client work", "/#client-work"],
    ["Process", "/#process"],
    ["Demos", "/demos"],
    ["FAQ", "/#faq"],
  ] as const) {
    await expect(mobileNavigation.getByRole("link", { name, exact: true })).toHaveAttribute("href", href);
  }
  await expect(menuDialog.getByRole("navigation", { name: "Legal" })).toHaveCount(0);
  await expect(mobileNavigation.getByRole("link", { name: "Discuss a workflow", exact: true })).toHaveAttribute(
    "href",
    "mailto:olakunleajani@ajaniautomation.com?subject=Workflow%20audit",
  );
  await expect(mobileNavigation.getByRole("link", { name: /^Record a note/ })).toHaveAttribute(
    "href",
    "/sign-in?redirect_url=%2Frecord",
  );

  await page.goto("/demos");
  const theatreOverflows = await page.getByRole("region", { name: "Automation theatre" }).evaluate((theatre) => theatre.scrollWidth > theatre.clientWidth);
  expect(theatreOverflows).toBe(false);
});
