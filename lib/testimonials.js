import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import { deleteTestimonialMediaPaths } from "./media-storage";
import { rowToTestimonial, toTestimonialRecord, validateTestimonial } from "./testimonial-mapper";

export function canManageTestimonials() {
  return hasSupabaseAdminConfig;
}

export async function listTestimonials() {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("testimonials")
    .select("*")
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data || []).map(rowToTestimonial);
}

export function formatTestimonialError(error) {
  const message = String(error?.message || error || "");
  if (
    message.includes("public.testimonials") ||
    message.toLowerCase().includes("schema cache") ||
    message.toLowerCase().includes("could not find the table")
  ) {
    return "A tabela public.testimonials ainda nao existe no Supabase. Execute a migration supabase/migrations/20260714_testimonials.sql no SQL Editor do Supabase e tente novamente.";
  }

  return message || "Nao foi possivel processar os depoimentos.";
}

export async function getTestimonial(id) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("testimonials")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data ? rowToTestimonial(data) : null;
}

export async function createTestimonial(testimonial) {
  const errors = validateTestimonial(testimonial);
  if (errors.length) throw new Error(errors[0]);

  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase nao configurado.");

  const { data, error } = await supabase
    .from("testimonials")
    .insert(toTestimonialRecord(testimonial))
    .select("*")
    .single();

  if (error) throw error;
  return rowToTestimonial(data);
}

export async function updateTestimonial(id, testimonial) {
  const existing = await getTestimonial(id);
  if (!existing) return null;

  const next = { ...existing, ...testimonial, id, createdAt: existing.createdAt };
  const errors = validateTestimonial(next);
  if (errors.length) throw new Error(errors[0]);

  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase nao configurado.");

  const record = toTestimonialRecord(next);
  const { data, error } = await supabase
    .from("testimonials")
    .update(record)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;

  await deleteReplacedMedia(existing, rowToTestimonial(data));
  return rowToTestimonial(data);
}

export async function updateTestimonialPublication(id, isPublished) {
  const existing = await getTestimonial(id);
  if (!existing) return null;

  return updateTestimonial(id, { ...existing, isPublished: isPublished === true });
}

export async function deleteTestimonial(id) {
  const existing = await getTestimonial(id);
  if (!existing) return false;

  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase nao configurado.");

  const { error } = await supabase.from("testimonials").delete().eq("id", id);
  if (error) throw error;

  await deleteTestimonialMediaPaths(mediaPaths(existing));
  return true;
}

async function deleteReplacedMedia(previous, next) {
  const stalePaths = mediaPaths(previous).filter((path) => !mediaPaths(next).includes(path));
  if (stalePaths.length) {
    await deleteTestimonialMediaPaths(stalePaths);
  }
}

function mediaPaths(testimonial = {}) {
  return [
    testimonial.imageStoragePath,
    testimonial.videoStoragePath,
    testimonial.videoThumbnailStoragePath
  ].filter(Boolean);
}
