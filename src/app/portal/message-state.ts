export type PortalMessageState = {
  status: "idle" | "error" | "success";
  message: string;
  /** Changes on every send, so the form clears only after one was saved. */
  sentId?: string;
};

export const initialPortalMessageState: PortalMessageState = {
  status: "idle",
  message: "",
};
