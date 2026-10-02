import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { buildInternalPhoneIndex, findInternalPhone } from "./internal-phones-core.mjs";

// Lê os telefones da equipe: cadastro de usuário ATIVO do painel (admin,
// gestor, corretor, associado) + WhatsApp conectado agora e números que já
// estiveram conectados por ele (whatsapp_individual_sessions.known_phone_numbers).
// Só ativos (decisão já existente em routeOrganicLead): quem saiu da equipe e
// volta a escrever é um contato normal. Cache curto por instância: o webhook
// recebe rajadas de mensagens.
const CACHE_MS = 60 * 1000;
let cache = { at: 0, index: null };

async function loadInternalPhoneIndex() {
  if (cache.index && Date.now() - cache.at < CACHE_MS) return cache.index;
  const db = getSupabaseAdminClient();
  if (!db) throw new Error("Supabase administrativo não configurado.");
  const [users, sessions] = await Promise.all([
    db.from("admin_users").select("id, name, phone").eq("status", "active"),
    db.from("whatsapp_individual_sessions").select("user_id, phone_number, known_phone_numbers")
  ]);
  if (users.error) throw users.error;
  // Antes da migration de known_phone_numbers a coluna não existe: segue só
  // com o número atual (nunca quebra o webhook).
  let sessionRows = sessions.data || [];
  if (sessions.error) {
    const fallback = await db.from("whatsapp_individual_sessions").select("user_id, phone_number");
    if (fallback.error) throw fallback.error;
    sessionRows = fallback.data || [];
  }
  const names = new Map((users.data || []).map((user) => [user.id, user.name || ""]));
  const entries = (users.data || []).map((user) => ({ userId: user.id, name: user.name, phone: user.phone }));
  for (const session of sessionRows) {
    if (!names.has(session.user_id)) continue; // sessão de usuário inativo
    for (const phone of [session.phone_number, ...(session.known_phone_numbers || [])]) {
      if (phone) entries.push({ userId: session.user_id, name: names.get(session.user_id) || "", phone });
    }
  }
  cache = { at: Date.now(), index: buildInternalPhoneIndex(entries) };
  return cache.index;
}

// Telefone pertence a alguém da equipe? -> { userId, name } ou null.
// Usado SÓ nos caminhos AUTOMÁTICOS do WhatsApp (cadastro automático,
// resposta da Prospecção, status por resposta). Formulário, link, captação
// e cadastro manual NÃO consultam isto: integrante da equipe pode testar a
// jornada como cliente (regra do dono, 2026-10-02).
//
// Falha na leitura = trata como NÃO interno (aviso no log): perder o cadastro
// de um cliente real é pior que um card de teste, que o dono arquiva.
export async function findInternalTeamPhone(phone) {
  try {
    return findInternalPhone(await loadInternalPhoneIndex(), phone);
  } catch (error) {
    console.warn("Falha ao conferir se o telefone é da equipe:", error?.message || error);
    return null;
  }
}
