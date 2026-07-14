import { rowToTestimonial } from "./testimonial-mapper";
import { getSupabasePublicClient } from "./supabase";

export async function listPublicTestimonials() {
  const supabase = getSupabasePublicClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("testimonials")
    .select("*")
    .eq("is_published", true)
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    return [];
  }

  return (data || []).map(rowToTestimonial);
}
