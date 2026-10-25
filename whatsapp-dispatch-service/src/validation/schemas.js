import { z } from "zod";
import { VERTICALS, PROFILE_LIMITS } from "../whatsapp/profile.js";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const sendWindowSchema = z.object({
  days: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  start: hhmm,
  end: hhmm
}).refine((w) => w.start < w.end, { message: "start deve ser antes de end" });

// Lead: só o necessário (id do CRM, telefone, campanha, referência verificável de consentimento).
export const leadSchema = z.object({
  crm_lead_id: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(8).max(25),
  campaign_code: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/),
  consent_reference: z.string().trim().min(1).max(200),
  idempotency_key: z.string().trim().min(1).max(200).optional()
}).strict();

const httpsUrl = z.string().url().max(256).refine((u) => /^https?:\/\//i.test(u), "precisa começar com http:// ou https://");
export const profileConfigSchema = z.object({
  display_name: z.string().trim().min(1).max(100).optional(),
  about: z.string().trim().min(1).max(PROFILE_LIMITS.about).optional(),
  description: z.string().trim().max(PROFILE_LIMITS.description).optional(),
  address: z.string().trim().max(PROFILE_LIMITS.address).optional(),
  email: z.string().trim().email().max(PROFILE_LIMITS.email).optional(),
  vertical: z.enum(VERTICALS).optional(),
  instagram_url: httpsUrl.refine((u) => /instagram\.com\//i.test(u), "precisa ser um link do Instagram").optional(),
  websites: z.array(httpsUrl).max(2).optional(),
  photo_url: z.string().url().refine((u) => /^https:\/\//i.test(u), "precisa ser https").optional(),
  required: z.array(z.enum(["display_name", "about", "description", "address", "email", "vertical", "websites", "photo_url"])).optional()
}).strict().refine((p) => [p.instagram_url, ...(p.websites || [])].filter(Boolean).length <= 2, {
  message: "A Cloud API aceita no máximo 2 sites (Instagram conta como um)."
});

export const instanceCreateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(8).max(25),
  provider: z.enum(["meta_cloud_api", "crm_individual"]),
  provider_config: z.object({
    phone_number_id: z.string().regex(/^\d{5,30}$/).optional(),
    waba_id: z.string().regex(/^\d{5,30}$/).optional(),
    crm_user_id: z.string().uuid().optional()
  }).strict(),
  credential_ref: z.string().regex(/^[A-Z][A-Z0-9_]{2,80}$/).optional(),
  daily_limit: z.number().int().min(0).max(100000).default(50),
  min_interval_seconds: z.number().int().min(0).max(86400).default(60),
  send_window: sendWindowSchema.default({ days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" }),
  timezone: z.string().default("America/Sao_Paulo"),
  rotation_order: z.number().int().min(0).max(10000).default(0),
  profile_config: profileConfigSchema.default({})
}).strict();

export const instanceUpdateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  provider_config: instanceCreateSchema.shape.provider_config.optional(),
  credential_ref: z.string().regex(/^[A-Z][A-Z0-9_]{2,80}$/).nullable().optional(),
  daily_limit: z.number().int().min(0).max(100000).optional(),
  min_interval_seconds: z.number().int().min(0).max(86400).optional(),
  send_window: sendWindowSchema.optional(),
  timezone: z.string().optional(),
  rotation_order: z.number().int().min(0).max(10000).optional(),
  profile_config: profileConfigSchema.optional()
}).strict();

export const instanceActionSchema = z.object({
  reason: z.string().trim().min(3).max(300).optional(),
  allow_incomplete_profile: z.boolean().optional()
}).strict();

export const campaignCreateSchema = z.object({
  code: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/),
  name: z.string().trim().min(2).max(120),
  purpose: z.string().regex(/^[a-z0-9_]{2,64}$/),
  message_type: z.enum(["template", "text"]).default("template"),
  template_name: z.string().regex(/^[a-z0-9_]{1,512}$/).optional(),
  template_language: z.string().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/).optional(),
  template_components: z.array(z.record(z.any())).max(10).default([]),
  text_body: z.string().min(1).max(4096).optional(),
  enabled: z.boolean().default(false),
  starts_at: z.string().datetime({ offset: true }).optional(),
  ends_at: z.string().datetime({ offset: true }).optional()
}).strict().refine((c) => c.message_type !== "template" || (c.template_name && c.template_language), {
  message: "template exige template_name e template_language"
}).refine((c) => c.message_type !== "text" || c.text_body, { message: "text exige text_body" });

export const campaignUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  enabled: z.boolean().optional(),
  template_name: z.string().regex(/^[a-z0-9_]{1,512}$/).optional(),
  template_language: z.string().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/).optional(),
  template_components: z.array(z.record(z.any())).max(10).optional(),
  text_body: z.string().min(1).max(4096).optional(),
  starts_at: z.string().datetime({ offset: true }).nullable().optional(),
  ends_at: z.string().datetime({ offset: true }).nullable().optional()
}).strict();

export const suppressionSchema = z.object({
  phone: z.string().trim().min(8).max(25),
  reason: z.string().trim().min(3).max(200),
  source: z.enum(["crm", "cliente", "admin"]).default("crm")
}).strict();

export const suppressionDeactivateSchema = z.object({
  reason: z.string().trim().min(10).max(300),
  confirm: z.string().max(60)
}).strict();

export const revocationSchema = z.object({
  phone: z.string().trim().min(8).max(25),
  crm_lead_id: z.string().trim().max(100).optional(),
  purpose: z.string().regex(/^[a-z0-9_]{2,64}$/).optional(),
  reason: z.string().trim().min(3).max(200),
  add_to_suppression: z.boolean().default(false)
}).strict();

export const resolveUnknownSchema = z.object({
  resolution: z.enum(["sent", "not_sent_retry", "failed"]),
  note: z.string().trim().min(5).max(300)
}).strict();
