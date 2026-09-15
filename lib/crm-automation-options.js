import { CLIENT_STATUS_OPTIONS } from "./client-status";

export const AUTOMATION_TRIGGERS = [
  { value: "client_form_submitted", label: "Cliente se cadastrou pelo formulário" },
  { value: "client_added_by_broker", label: "Corretor adicionou cliente" },
  { value: "client_transferred", label: "Cliente transferido para outro corretor" },
  { value: "no_first_contact", label: "Cliente sem primeiro atendimento" },
  { value: "time_without_contact", label: "Cliente sem contato" },
  { value: "no_future_activity", label: "Cliente sem atividade futura" },
  { value: "activity_created", label: "Atividade agendada" },
  { value: "activity_upcoming", label: "Atividade próxima" },
  { value: "activity_overdue", label: "Atividade vencida" },
  { value: "status_changed", label: "Status do cliente alterado" },
  { value: "stage_changed", label: "Etapa do cliente alterada" },
  { value: "simulation_sent", label: "Simulação enviada" },
  { value: "activity_completed", label: "Atividade concluída" }
];

export const AUTOMATION_CONDITIONS = [
  { value: "status_equals", label: "Status atual" },
  { value: "responsible_equals", label: "Responsável" },
  { value: "has_future_activity", label: "Possui atividade futura" },
  { value: "last_contact_older_than", label: "Último contato há mais de" },
  { value: "not_archived", label: "Cliente não arquivado" }
];

export const AUTOMATION_ACTIONS = [
  { value: "create_notification", label: "Criar notificação interna" },
  { value: "send_trigger_email", label: "Enviar e-mail de gatilho" },
  { value: "create_activity", label: "Criar atividade na Agenda" },
  { value: "change_status", label: "Alterar status do cliente" },
  { value: "return_to_round_robin", label: "Devolver para distribuição automática" },
  { value: "send_push", label: "Enviar notificação push" },
  { value: "send_whatsapp_template", label: "Enviar WhatsApp (modelo aprovado)" }
];

// Mesmas variáveis de {corretor_nome}/{cliente_nome}/etc. já usadas no
// e-mail de gatilho (buildEmailVariables, lib/crm-automations.js) — só que
// aqui viram parâmetros POSICIONAIS {{1}}, {{2}}... do modelo do WhatsApp,
// já que a Meta não aceita texto livre dentro do modelo aprovado.
export const AUTOMATION_WHATSAPP_VARIABLES = [
  { value: "corretor_nome", label: "Nome do corretor" },
  { value: "cliente_nome", label: "Nome do cliente" },
  { value: "cliente_telefone", label: "Telefone do cliente" },
  { value: "corretor_codigo", label: "Código do corretor" },
  { value: "corretor_anterior", label: "Corretor anterior" },
  { value: "atividade", label: "Atividade" },
  { value: "atividade_data", label: "Data da atividade" },
  { value: "atividade_hora", label: "Hora da atividade" },
  { value: "status_cliente", label: "Status do cliente" }
];

export const AUTOMATION_DELAY_UNITS = [
  { value: "minutes", label: "minutos" },
  { value: "hours", label: "horas" },
  { value: "days", label: "dias" }
];

export const AUTOMATION_TARGETS = [
  { value: "client_broker", label: "Corretor responsável pelo cliente" },
  { value: "admin", label: "Administrador" },
  { value: "specific_user", label: "Usuário específico" }
];

export const AUTOMATION_STATUS_OPTIONS = CLIENT_STATUS_OPTIONS.filter((option) => option.value !== "all");

export function optionLabel(options, value, fallback = value) {
  return options.find((option) => option.value === value)?.label || fallback || "";
}
