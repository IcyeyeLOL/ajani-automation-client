export type AdminActionState = {
  status: "idle" | "error" | "success";
  message: string;
  entityId?: string;
};

export const initialAdminActionState: AdminActionState = {
  status: "idle",
  message: "",
};
