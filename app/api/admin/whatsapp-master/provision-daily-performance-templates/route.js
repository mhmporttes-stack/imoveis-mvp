import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { assertOwnerAdmin } from "@/lib/admin-access";
import { createWhatsappMessageTemplate, listWhatsappMessageTemplates } from "@/lib/whatsapp-master";

export const runtime = "nodejs";

// Provisionamento único (rodar 1x, chamado manualmente pelo dono) dos 3
// modelos usados por lib/daily-goal-performance-whatsapp.js — um por faixa
// de desempenho. Idempotente: pula qualquer nome que já exista na conta.
const TEMPLATES = [
  {
    name: "corretor_resumo_diario_espetacular",
    bodyText:
      "Olá {{1}}! 🚀 Resultado espetacular hoje: você superou a meta diária, batendo {{2}}. No funil: {{3}} contatos, {{4}} atendimentos e {{5}} simulações. Continue nesse ritmo!",
    bodyExample: ["Ana", "6/3 (200%)", "8", "5", "2"]
  },
  {
    name: "corretor_resumo_diario_meta_batida",
    bodyText:
      "Olá {{1}}! 🎯 Você bateu a meta diária hoje: {{2}}. No funil: {{3}} contatos, {{4}} atendimentos e {{5}} simulações. Muito bem, siga assim!",
    bodyExample: ["Ana", "3/3 (100%)", "5", "3", "1"]
  },
  {
    name: "corretor_resumo_diario_abaixo_meta",
    bodyText:
      "Olá {{1}}, aqui está o resumo do seu dia: meta diária de {{2}}. No funil: {{3}} contatos, {{4}} atendimentos e {{5}} simulações. Amanhã é um novo dia para buscar a meta — vamos com tudo! 💪",
    bodyExample: ["Ana", "1/3 (33%)", "2", "1", "0"]
  }
];

export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    assertOwnerAdmin(auth);

    const existing = await listWhatsappMessageTemplates();
    const existingNames = new Set(existing.map((template) => template.name));

    const results = [];
    for (const template of TEMPLATES) {
      if (existingNames.has(template.name)) {
        results.push({ name: template.name, skipped: true, reason: "Modelo já existe." });
        continue;
      }

      const outcome = await createWhatsappMessageTemplate({
        name: template.name,
        category: "UTILITY",
        languageCode: "pt_BR",
        bodyText: template.bodyText,
        bodyExample: template.bodyExample
      });
      results.push({ name: template.name, ...outcome });
    }

    return NextResponse.json({ ok: true, results });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Não foi possível criar os modelos." }, { status: error?.status || 400 });
  }
}
