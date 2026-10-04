import "server-only";
import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { isAcademyEnabled } from "@/lib/academy-flags";
import { createAcademyRepo } from "@/lib/academy-repo.mjs";
import { createAcademyService } from "@/lib/academy-service.mjs";
import { createAcademyContentRepo } from "@/lib/academy-content-repo.mjs";
import { createAcademyContent } from "@/lib/academy-content.mjs";
import { createAcademyGrants } from "@/lib/academy-grants.mjs";
import { createAcademyCertificates } from "@/lib/academy-certificates.mjs";
import { createAcademyManagement } from "@/lib/academy-management.mjs";
import { createAcademyRecommendations, createAcademyRules } from "@/lib/academy-rules.mjs";
import { resolveTeamVisibilityScope } from "@/lib/admin-profiles";
import { AcademyError } from "@/lib/academy-access-core.mjs";

// Camada servidor da Academia: liga o serviço (regras) ao Supabase (service role, só aqui). Toda rota/página da
// Academia passa por estas funções; nenhum componente client toca o banco.
export function getAcademyService() {
  const db = getSupabaseAdminClient();
  return db ? createAcademyService(createAcademyRepo(db)) : null;
}

// Gestão de conteúdo (Admin/Gerente): o repo de gestão reaproveita as leituras do repo do aluno (estrutura da versão, questões).
function managementRepo() {
  const db = getSupabaseAdminClient();
  return db ? { ...createAcademyRepo(db), ...createAcademyContentRepo(db) } : null;
}
export function getAcademyContent() {
  const repo = managementRepo();
  return repo ? createAcademyContent(repo) : null;
}
export function getAcademyGrants() {
  const repo = managementRepo();
  return repo ? createAcademyGrants(repo) : null;
}
export function getAcademyRules() {
  const repo = managementRepo();
  return repo ? createAcademyRules(repo) : null;
}
export function getAcademyRecommendations() {
  const repo = managementRepo();
  return repo ? createAcademyRecommendations(repo) : null;
}
export function getAcademyManagement() {
  const repo = managementRepo();
  return repo ? createAcademyManagement(repo) : null;
}
export function getAcademyCertificates() {
  const repo = managementRepo();
  return repo ? createAcademyCertificates(repo) : null;
}
// Escopo de equipe do gestor para liberações (admin geral: todos; gestor: managedUserIds).
export function academyManagementScope(auth) {
  return resolveTeamVisibilityScope(auth);
}

const MESSAGES = {
  invalid_pass_score: "A nota mínima deve ser um número inteiro entre 70 e 100.",
  invalid_selection: "Quantidade sorteada inválida.",
  invalid_exam: "Prova inválida: escolha questões diferentes do banco.",
  invalid_topic: "Tema inválido.",
  question_not_found: "Questão não encontrada.",
  question_retired: "Esta questão está aposentada.",
  exam_without_questions: "A prova ainda não tem questões.",
  invalid_rule: "Regra inválida.",
  invalid_recommendation: "Recomendação inválida (informe o motivo).",
  recommendation_exists: "Já existe uma recomendação aberta para esta pessoa e trilha.",
  recommendation_not_found: "Recomendação não encontrada.",
  recommendation_closed: "Esta recomendação já foi decidida.",
  student_not_found: "Aluno não encontrado.",
  invalid_assignment: "Escolha ao menos uma pessoa.",
  invalid_due_date: "Prazo inválido.",
  track_not_published: "Esta trilha ainda não tem versão publicada.",
  already_enrolled: "A pessoa já está matriculada nesta trilha.",
  invalid_track: "Trilha inválida.",
  certificate_not_found: "Certificado não encontrado.",
  already_revoked: "Este certificado já foi revogado.",
  reason_required: "Informe o motivo.",
  invalid_code: "Código inválido.",
  enrollment_not_completed: "A formação ainda não foi concluída.",
  version_not_editable: "Esta versão já foi publicada e não pode ser editada. Crie um rascunho.",
  publish_blocked: "A versão não pode ser publicada: há pendências.",
  draft_exists: "Já existe um rascunho para esta trilha.",
  not_a_draft: "Esta versão não é um rascunho.",
  version_not_found: "Versão não encontrada.",
  track_not_found: "Trilha não encontrada.",
  module_not_found: "Módulo não encontrado.",
  activity_not_found: "Atividade não encontrada.",
  invalid_title: "Informe um título (até 160 caracteres).",
  invalid_content: "Conteúdo inválido.",
  invalid_question: "Questão inválida: use 2 a 6 alternativas diferentes e marque a(s) correta(s).",
  invalid_activity: "Atividade inválida.",
  invalid_order: "Ordem inválida.",
  invalid_action: "Ação inválida.",
  invalid_lesson: "Aula inválida.",
  invalid_minutes: "Minutos inválidos.",
  out_of_scope: "Este aluno não é da sua equipe.",
  attempts_not_exhausted: "O aluno ainda tem tentativas disponíveis.",
  grant_already_given: "A tentativa extra já foi liberada para este aluno nesta prova.",
  exam_without_limit: "Esta prova não tem limite de tentativas.",
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
