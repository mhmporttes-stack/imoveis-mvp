import { CLIENT_STATUS_META } from "./client-status.js";

// Título e descrição de cada evento da linha do tempo do cliente — FONTE ÚNICA, usada pela ficha
// (components/ClientJourneyActions.jsx) e pelo Henry (últimas movimentações, lib/henry-reports.js).
// Puro (sem React, sem banco). Evento novo: acrescente aqui, nunca uma cópia em outro arquivo.

// Sem segundos (no celular a data com segundos era cortada na borda da tela — pedido do dono, 2026-10-11).
export const formatJourneyDate = (value) => (value ? new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const date = formatJourneyDate;

export const JOURNEY_MODALITY_LABEL = { simulation: "Simulação Completa", quick_service: "Atendimento Rápido" };
const FIELD_LABEL = {
  phone: "Telefone",
  primaryMonthlyIncome: "Renda",
  secondaryMonthlyIncome: "Renda (2ª pessoa)",
  primaryMaritalStatus: "Estado civil",
  hasOverThreeYearsRegisteredWork: "Regime de trabalho",
  contactPreference: "Preferência de contato"
};

export function journeyEventTitleAndDescription(event, context = {}) {
  const d = event.details || {};
  switch (event.type) {
    case "created":
      // O trigger de banco que grava este evento não preenche `details` —
      // a origem/modalidade já foram carregadas à parte (origin/registration,
      // mesma fonte usada no cabeçalho do modal), reaproveitadas aqui.
      // Cadastro ANTERIOR (reentrada por anúncio): origem/modalidade/destino vêm no próprio evento (details).
      if (event.previousRecord) {
        return { title: "PRIMEIRO CADASTRO", description: [
          d.originLabel ? `Origem: ${d.originLabel}` : "",
          JOURNEY_MODALITY_LABEL[d.journeyType] ? `Modalidade: ${JOURNEY_MODALITY_LABEL[d.journeyType]}` : "",
          d.initialDestination ? `Destino: ${d.initialDestination === "roulette" ? "Roleta" : "Corretor"}` : "",
          d.initialResponsibleName ? `Corretor: ${d.initialResponsibleName}` : ""
        ].filter(Boolean) };
      }
      return { title: "CLIENTE CADASTRADO", description: [
        context.origin?.source_label ? `Origem: ${context.origin.source_label}` : "",
        JOURNEY_MODALITY_LABEL[context.registration?.journeyType] ? `Modalidade: ${JOURNEY_MODALITY_LABEL[context.registration.journeyType]}` : "",
        context.origin?.initial_destination ? `Destino: ${context.origin.initial_destination === "roulette" ? "Roleta" : "Corretor"}` : "",
        context.origin?.initial_responsible_name ? `Corretor: ${context.origin.initial_responsible_name}` : ""
      ].filter(Boolean) };
    case "status":
    case "legacy_status":
      return { title: "STATUS ALTERADO", description: [`${CLIENT_STATUS_META[event.previousStatus]?.label || event.previousStatus || "—"} → ${CLIENT_STATUS_META[event.newStatus]?.label || event.newStatus}`] };
    case "status_reason":
      return { title: d.newStatus === "do_not_contact" ? "MOTIVO DO NÃO CONTACTAR" : "MOTIVO DO ARQUIVAMENTO", description: [d.reason ? `Motivo: ${d.reason}` : ""].filter(Boolean) };
    case "notify":
      return { title: "PROGRESSO AVISADO AO CLIENTE", description: ["Acionado via WhatsApp"] };
    case "regenerate":
      return { title: "LINK DA JORNADA REGENERADO", description: [] };
    case "responsible_transferred":
      return { title: "TRANSFERÊNCIA DE RESPONSÁVEL", description: [`${d.fromName || "—"} → ${d.toName || "—"}`, "Tipo: Transferência manual"] };
    case "distribution:assigned":
      // Cliente que esperava um corretor on-line e a roleta entregou depois (não é a 1ª atribuição).
      if (d.fromWaitingQueue) return { title: "DISTRIBUÍDO PELA ROLETA", description: [`Distribuído para: ${d.toName || "—"}`, "Motivo: primeiro corretor on-line depois da espera"] };
      if (d.heldByOwner) return { title: "ATRIBUIÇÃO INICIAL", description: [`Distribuído para: ${d.toName || "—"}`, "Motivo: nenhum corretor liberado na roleta — fica com o dono até a roleta entregar ao primeiro corretor liberado"] };
      if (!d.toName) return { title: "ATRIBUIÇÃO INICIAL", description: ["Distribuído para: ninguém (nenhum corretor liberado)", "Motivo: aguardando a roleta entregar ao primeiro corretor liberado"] };
      return { title: "ATRIBUIÇÃO INICIAL", description: [`Distribuído para: ${d.toName}`, "Motivo: Distribuição automática"] };
    case "distribution:auto_transferred":
      return { title: "TRANSFERÊNCIA AUTOMÁTICA", description: [`${d.fromName || "—"} → ${d.toName || "—"}`, d.reason ? `Motivo: ${d.reason}` : "Motivo: Prazo de atendimento excedido"] };
    case "responsible_assigned":
      return { title: "RESPONSÁVEL DEFINIDO", description: [d.waitingQueue ? "Aguardando um corretor on-line" : "Definido pela roleta"] };
    case "tag_added":
      return { title: "TAG ADICIONADA", description: [d.tagName ? `"${d.tagName}"` : ""] };
    case "tag_removed":
      return { title: "TAG REMOVIDA", description: [d.tagName ? `"${d.tagName}"` : ""] };
    case "data_updated":
      return { title: "DADOS ATUALIZADOS", description: (d.fields || []).map((f) => f.field === "phone" && f.fromLast4 ? `Telefone: final ${f.fromLast4} → final ${f.toLast4}` : f.field === "phone" && f.toLast4 ? `WhatsApp adicionado: final ${f.toLast4}` : `${FIELD_LABEL[f.field] || f.field} atualizado(a)`) };
    case "ad_reentry":
      return d.side === "new"
        ? { title: "REENTRADA POR ANÚNCIO", description: [d.campaignName ? `Campanha: ${d.campaignName}` : "", "Cliente já existia e voltou por um anúncio"].filter(Boolean) }
        : { title: "CLIENTE VOLTOU POR ANÚNCIO", description: [d.campaignName ? `Campanha: ${d.campaignName}` : "", "Gerou um novo cadastro na roleta"].filter(Boolean) };
    case "form_resubmitted":
      return { title: "FORMULÁRIO PREENCHIDO NOVAMENTE", description: [d.journeyType === "quick_service" ? "Atendimento rápido" : "Simulação"] };
    case "activity_scheduled":
      return { title: "ATIVIDADE AGENDADA", description: [d.title || "", d.scheduledAt ? `Data: ${date(d.scheduledAt)}` : ""].filter(Boolean) };
    case "activity_completed":
      return { title: "ATIVIDADE CONCLUÍDA", description: [d.title || ""] };
    case "activity_rescheduled":
      return { title: "ATIVIDADE REAGENDADA", description: [d.title || "", d.toAt ? `Nova data: ${date(d.toAt)}` : ""].filter(Boolean) };
    case "activity_deleted":
      return { title: "ATIVIDADE EXCLUÍDA", description: [d.title || ""] };
    case "document_forecast_set":
      return { title: "PREVISÃO DE DOCUMENTOS", description: [d.text || "Cliente previu enviar documentos"] };
    case "appointment_scheduled":
      return { title: "ATENDIMENTO AGENDADO PELO CLIENTE", description: [d.text || "Cliente agendou um atendimento pela apresentação"] };
    case "appointment_requested":
      return { title: "CLIENTE PEDIU OUTRO HORÁRIO", description: [d.text || "Cliente pediu outro horário de atendimento"] };
    case "documents_list_sent":
      return { title: "LISTA DE DOCUMENTOS ENVIADA", description: ["Lista de documentos enviada"] };
    case "presentation_sent":
      return { title: "APRESENTAÇÃO DA SIMULAÇÃO ENVIADA", description: ["Apresentação da simulação enviada"] };
    // Envio automático da simulação (SIM-AUTO-ENVIO, dono 2026-10-23): o texto vem gravado no evento (canal/motivo).
    case "simulation_auto_sent":
      return { title: "SIMULAÇÃO ENVIADA AUTOMATICAMENTE", description: [d.text || "Simulação enviada automaticamente"] };
    case "simulation_auto_send_scheduled":
      return { title: "ENVIO AUTOMÁTICO DA SIMULAÇÃO PROGRAMADO", description: [d.text || "Envio automático da simulação programado"] };
    case "simulation_auto_send_pending":
      return { title: "ENVIO AUTOMÁTICO DA SIMULAÇÃO PENDENTE", description: [d.text || "Envio automático da simulação pendente"] };
    case "simulation_auto_send_failed":
      return { title: "ENVIO AUTOMÁTICO DA SIMULAÇÃO FALHOU", description: [d.text || "Envio automático da simulação falhou"] };
    case "simulation_auto_send_skipped":
      return { title: "SIMULAÇÃO NÃO ENVIADA AUTOMATICAMENTE", description: [d.text || "Simulação não enviada automaticamente"] };
    // Lembrete "ficou alguma dúvida?" 20 min depois do envio automático (dono 2026-10-23): automação, não atendimento.
    case "simulation_auto_followup_scheduled":
      return { title: "LEMBRETE DA SIMULAÇÃO PROGRAMADO", description: [d.text || "Lembrete da simulação programado"] };
    case "simulation_auto_followup_sent":
      return { title: "LEMBRETE DA SIMULAÇÃO ENVIADO", description: [d.text || "Lembrete da simulação enviado automaticamente"] };
    case "simulation_auto_followup_cancelled":
      return { title: "LEMBRETE DA SIMULAÇÃO CANCELADO", description: [d.text || "Lembrete da simulação cancelado"] };
    case "simulation_auto_followup_skipped":
      return { title: "LEMBRETE DA SIMULAÇÃO NÃO ENVIADO", description: [d.text || "Lembrete da simulação não enviado"] };
    // Áudio com a voz do dono (VOZ-1, dono 2026-10-23): automação, não atendimento humano. Texto gravado no evento.
    case "client_voice_audio_sent":
      return { title: "ÁUDIO ENVIADO AUTOMATICAMENTE", description: [d.text || "Áudio enviado automaticamente"] };
    case "client_voice_audio_failed":
      return { title: "ÁUDIO AUTOMÁTICO FALHOU", description: [d.text || "Áudio automático não enviado"] };
    case "client_voice_audio_skipped":
      return { title: "ÁUDIO AUTOMÁTICO NÃO ENVIADO", description: [d.text || "Áudio automático não enviado"] };
    case "document_received_offline":
      return { title: "1º DOCUMENTO RECEBIDO POR FORA", description: [d.text || "1º documento recebido fora do CRM"] };
    case "document_received_offline_undone":
      return { title: "MARCA DE DOCUMENTO POR FORA DESFEITA", description: [d.text || "Marca desfeita"] };
    case "presentation_link_copied":
      return { title: "LINK DA APRESENTAÇÃO COPIADO", description: [d.text || "Link da apresentação copiado (envio não confirmado)"] };
    case "presentation_approval_on":
      return { title: "APRESENTAÇÃO DE APROVAÇÃO ATIVADA", description: ["O link da apresentação passou a mostrar o crédito aprovado"] };
    case "presentation_approval_off":
      return { title: "APRESENTAÇÃO DE APROVAÇÃO DESATIVADA", description: ["O link da apresentação voltou a mostrar a simulação"] };
    case "sale_registered":
      return { title: "VENDA REALIZADA", description: [] };
    case "prospecting:claimed":
      return { title: "CONTATO DISPONIBILIZADO", description: ["Origem: Prospecção"] };
    case "prospecting:prospecting_started":
      return { title: "PROSPECÇÃO INICIADA", description: [] };
    case "prospecting:in_service":
      return { title: "CLIENTE EM ATENDIMENTO", description: [] };
    case "prospecting:returned":
    case "prospecting:returned_to_queue":
      return { title: "CONTATO DEVOLVIDO À FILA", description: [] };
    case "prospecting:do_not_contact":
      return { title: "CONTATO BLOQUEADO", description: ["Status: Não contactar novamente", d.reasonText ? `Motivo: ${d.reasonText}` : ""].filter(Boolean) };
    case "prospecting:daily_goal_attempt":
      return { title: `${d.attempt ? `${d.attempt}ª TENTATIVA` : "TENTATIVA"} REALIZADA`, description: [d.channel === "whatsapp" ? "Canal: WhatsApp" : d.channel || "", "✓ Contabilizada na meta"].filter(Boolean) };
    case "prospecting:daily_goal_converted":
      return { title: "CONVERTIDO PELA META DIÁRIA", description: [] };
    case "prospecting:daily_goal_round_ended":
      return { title: "CICLO DE PROSPECÇÃO ENCERRADO", description: [] };
    case "prospecting:daily_goal_round_hibernated":
      return { title: "CLIENTE EM HIBERNAÇÃO", description: ["Sem resposta 24h após a última tentativa — saiu do corretor", "Volta para a base de prospecção em 30 dias"] };
    case "prospecting:bulk_assigned":
      return { title: "ATRIBUÍDO EM LOTE", description: [] };
    case "prospecting:edited":
      return { title: "CONTATO EDITADO", description: [] };
    case "prospecting:unblocked":
      return { title: "CONTATO DESBLOQUEADO", description: [] };
    case "document_batch_uploaded":
      return { title: "LOTE DE DOCUMENTOS ENVIADO", description: [d.fileCount ? `Arquivos: ${d.fileCount}` : ""].filter(Boolean) };
    case "document_batch_analyzed":
      return { title: "ANÁLISE DOCUMENTAL CONCLUÍDA", description: [
        d.newFiles ? `Arquivos classificados: ${d.newFiles}` : "",
        d.divergenceCount ? `Divergências: ${d.divergenceCount}` : "",
        d.absent ? `Documentos faltando: ${d.absent}` : "",
        d.pending ? `Pendências de quantidade: ${d.pending}` : ""
      ].filter(Boolean) };
    case "document_batch_analysis_failed":
      return { title: "FALHA NA ANÁLISE DOCUMENTAL", description: [d.error ? String(d.error).slice(0, 160) : ""].filter(Boolean) };
    case "document_checklist_recomputed":
      return { title: "CHECKLIST RECALCULADO", description: ["Cadastro do cliente foi alterado — requisitos recalculados sem nova leitura de IA."] };
    case "document_checklist_corrected":
      return { title: "CLASSIFICAÇÃO CORRIGIDA MANUALMENTE", description: [] };
    case "document_deleted":
      return { title: "DOCUMENTO EXCLUÍDO", description: [] };
    case "document_sent_to_cca":
      return { title: d.withoutAnalysis ? "DOCUMENTAÇÃO ENVIADA PARA CCA (SEM ANÁLISE)" : "DOCUMENTAÇÃO ENVIADA PARA CCA", description: [d.ccaName ? `CCA: ${d.ccaName}` : "", d.documentCount ? `Arquivos: ${d.documentCount}` : "", d.withoutAnalysis ? "Enviada direto, sem análise da IA." : ""].filter(Boolean) };
    case "cca_reassigned":
      return { title: "CCA ALTERADA", description: [`${d.fromCcaName || "—"} → ${d.toCcaName || "—"}`] };
    case "cooled_decision":
      // Cliente que esfriou — "Segunda chance" (FUN-15m): continua com o mesmo corretor. Demais decisões: título padrão.
      if (d.decision === "second_chance") return { title: "SEGUNDA CHANCE", description: [`Cliente continua com ${d.brokerName || "o mesmo corretor"}.`] };
      return { title: "COOLED DECISION", description: [] };
    default:
      return { title: event.type.replace(/^prospecting:|^distribution:/, "").replace(/_/g, " ").toUpperCase(), description: [] };
  }
}
