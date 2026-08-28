import { z } from "zod";

export const adminLoginSchema = z.object({ accessKey: z.string().min(1).max(256) });

export const outreachMessageStepSchema = z.enum([
  "connection_request",
  "initial_dm",
  "follow_up_1",
  "follow_up_2",
  "custom",
]);

export const outreachExperimentSchema = z.object({
  title: z.string().trim().min(2).max(120),
  audience: z.string().trim().min(2).max(120),
  campaign: z.string().trim().max(120).default(""),
  channel: z.string().trim().min(2).max(40),
  method: z.string().trim().min(2).max(40),
  messageStep: outreachMessageStepSchema,
  primaryMetric: z.enum(["acceptance_rate", "reply_rate", "positive_reply_rate", "booking_rate"]),
  variants: z.string().trim().min(1).max(500),
}).refine(
  (value) => value.primaryMetric !== "acceptance_rate" || value.messageStep === "connection_request",
  { message: "Connection acceptance experiments must test the connection-request step", path: ["messageStep"] },
);

export const outreachMetricSchema = z.object({
  variantId: z.string().uuid().nullable(),
  variantLabel: z.string().trim().min(1).max(120),
  connectionRequests: z.number().int().min(0).max(1_000_000),
  connectionsAccepted: z.number().int().min(0).max(1_000_000),
  initialDms: z.number().int().min(0).max(1_000_000),
  f1Sent: z.number().int().min(0).max(1_000_000),
  f2Sent: z.number().int().min(0).max(1_000_000),
  customSent: z.number().int().min(0).max(1_000_000),
  replies: z.number().int().min(0).max(1_000_000),
  attributedReplies: z.number().int().min(0).max(1_000_000),
  positiveReplies: z.number().int().min(0).max(1_000_000),
  callsBooked: z.number().int().min(0).max(1_000_000),
}).refine((value) => value.connectionsAccepted <= value.connectionRequests, { message: "Accepted connections cannot exceed connection requests" })
  .refine((value) => value.replies <= value.initialDms, { message: "Replies cannot exceed unique initial DMs" })
  .refine((value) => value.attributedReplies <= value.replies, { message: "Attributed replies cannot exceed total replies" })
  .refine((value) => value.f2Sent <= value.f1Sent, { message: "Second follow-ups cannot exceed first follow-ups" })
  .refine((value) => value.positiveReplies <= value.replies, { message: "Positive replies cannot exceed replies" })
  .refine((value) => value.callsBooked <= value.replies, { message: "Calls booked cannot exceed replies" });

export const outreachBatchSchema = z.object({
  activityDate: z.iso.date(),
  teamMember: z.string().trim().min(2).max(100),
  channel: z.string().trim().min(2).max(40),
  method: z.string().trim().min(2).max(40),
  audience: z.string().trim().min(2).max(120),
  campaign: z.string().trim().max(120).default(""),
  experimentId: z.string().uuid().nullable(),
  notes: z.string().trim().max(1000).default(""),
  metrics: z.array(outreachMetricSchema).min(1).max(12),
});

export const experimentMetricSchema = z.object({
  variantId: z.string().uuid(),
  variantLabel: z.string().trim().min(1).max(120),
  sent: z.number().int().min(0).max(1_000_000),
  replies: z.number().int().min(0).max(1_000_000),
  positiveReplies: z.number().int().min(0).max(1_000_000),
  callsBooked: z.number().int().min(0).max(1_000_000),
  connectionRequests: z.number().int().min(0).max(1_000_000),
  connectionsAccepted: z.number().int().min(0).max(1_000_000),
}).refine((value) => value.replies <= value.sent, { message: "Replies cannot exceed messages sent" })
  .refine((value) => value.positiveReplies <= value.replies, { message: "Positive replies cannot exceed replies" })
  .refine((value) => value.callsBooked <= value.replies, { message: "Calls booked cannot exceed replies" });

export const experimentMetricEntrySchema = z.object({
  experimentId: z.string().uuid(),
  messageStep: outreachMessageStepSchema,
  activityDate: z.iso.date(),
  teamMember: z.string().trim().min(2).max(100),
  notes: z.string().trim().max(1000).default(""),
  metrics: z.array(experimentMetricSchema).min(1).max(12),
}).superRefine((value, context) => {
  value.metrics.forEach((metric, index) => {
    const requests = value.messageStep === "connection_request" ? metric.sent : metric.connectionRequests;
    if (metric.connectionsAccepted > requests) {
      context.addIssue({
        code: "custom",
        message: "Accepted connections cannot exceed connection requests",
        path: ["metrics", index, "connectionsAccepted"],
      });
    }
  });
});

export type OutreachMetricInput = z.infer<typeof outreachMetricSchema>;
export type ExperimentMetricInput = z.infer<typeof experimentMetricSchema>;
