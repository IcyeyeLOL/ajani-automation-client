export type AdminActionState = {
  status: "idle" | "error" | "success";
  message: string;
  entityId?: string;
  /** "existing": nothing was saved because the day already has these numbers; the form asks to add to them or replace them. */
  code?: "existing";
};

export const initialAdminActionState: AdminActionState = {
  status: "idle",
  message: "",
};
