import { CLIENT_STATUS_OPTIONS } from "./client-status";

export const AUTOMATION_TRIGGERS = [
  { value: "client_created", label: "Cliente cadastrado" },
  { value: "status_changed", label: "Status do cliente alterado" },
  { value: "simulation_sent", label: "Simulação enviada" },
  { value: "activity_created", label: "Atividade criada" },
  { value: "activity_completed", label: "Atividade concluída" },
  { value: "no_future_activity", label: "Cliente sem atividade futura" },
  { value: "time_without_contact", label: "Tempo sem novo contato" }
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
  { value: "create_activity", label: "Criar atividade na Agenda" },
  { value: "change_status", label: "Alterar status do cliente" }
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
