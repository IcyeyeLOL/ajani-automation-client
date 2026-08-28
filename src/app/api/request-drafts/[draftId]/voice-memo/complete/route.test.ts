import { describe, expect, it, vi } from "vitest";
import { matchesAudioContainer } from "@/app/api/request-drafts/[draftId]/voice-memo/complete/route";

vi.mock("server-only", () => ({}));

describe("voice memo container validation", () => {
  it.each([
    ["audio/webm", [0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]],
    ["audio/mp4", [0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]],
    ["audio/ogg", [0x4f, 0x67, 0x67, 0x53, 0, 0, 0, 0, 0, 0, 0, 0]],
    ["audio/wav", [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]],
    ["audio/mpeg", [0x49, 0x44, 0x33, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ])("accepts a matching %s signature", async (mimeType, header) => {
    await expect(matchesAudioContainer(new Blob([new Uint8Array(header as number[])]), mimeType as string)).resolves.toBe(true);
  });

  it("rejects a media label that does not match the uploaded bytes", async () => {
    const fakeWebm = new Blob([new TextEncoder().encode("this is not webm audio")]);
    await expect(matchesAudioContainer(fakeWebm, "audio/webm")).resolves.toBe(false);
  });

  it("rejects files that are too small to be audio containers", async () => {
    await expect(matchesAudioContainer(new Blob([new Uint8Array([0x49, 0x44, 0x33])]), "audio/mpeg")).resolves.toBe(false);
  });
});
