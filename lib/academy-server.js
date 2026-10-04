import "server-only";
import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { isAcademyEnabled } from "@/lib/academy-flags";
import { createAcademyRepo } from "@/lib/academy-repo.mjs";
import { createAcademyService } from "@/lib/academy-service.mjs";
import { AcademyError } from "@/lib/academy-access-core.mjs";

// Camada servidor da Academia: liga o serviço (regras) ao Supabase (service role, só aqui). Toda rota/página da
// Academia passa por estas funções; nenhum componente client toca o banco.
export function getAcademyService() {
  const db = getSupabaseAdminClient();
  return db ? createAcademyService(createAcademyRepo(db)) : null;
}

const MESSAGES = {
  read_only_account_switch: "Modo de visualização: nada é gravado.",
  read_only: "Modo de visualização: nada é gravado.",
  no_profile: "Seu perfil não permite gravar progresso.",
  attempts_exhausted: "Você usou todas as tentativas desta prova.",
  lesson_locked: "Esta aula ainda está bloqueada.",
  module_locked: "Este módulo ainda está bloqueado.",
  lessons_pending: "Conclua as aulas do módulo antes da prova.",
  lesson_already_done: "Esta aula já foi concluída.",
  exam_required: "Esta aula é concluída pela prova.",
  invalid_answers: "Resposta inválida.",
  exam_not_found: "Prova não encontrada.",
  lesson_not_found: "Aula não encontrada.",
  enrollment_not_found: "Matrícula não encontrada.",
  enrollment_not_active: "Esta matrícula não está ativa."
};

// Chave desligada: as APIs da Academia respondem 404 (como se não existissem), antes de qualquer outra coisa.
export function academyDisabledResponse() {
  return isAcademyEnabled() ? null : NextResponse.json({ error: "Not found" }, { status: 404 });
}

export function academyErrorResponse(error) {
  if (error instanceof AcademyError) {
    return NextResponse.json({ error: MESSAGES[error.code] || "Não foi possível concluir.", code: error.code, extra: error.extra }, { status: error.status });
  }
  console.error("academia: erro inesperado", error?.cause?.message || error?.message || error);
  return NextResponse.json({ error: "Não foi possível concluir agora.", code: "error" }, { status: 500 });
}
