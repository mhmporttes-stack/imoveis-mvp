// Checklist configurável de tipos de documento — SEM "server-only" de
// propósito: importado tanto pelo backend (lib/document-analysis.js, prompt
// da IA) quanto por componentes client (dropdown de correção manual), então
// não pode depender de nada exclusivo do servidor.
export const DOCUMENT_TYPE_OPTIONS = [
  { key: "rg", label: "RG" },
  { key: "cnh", label: "CNH" },
  { key: "cpf", label: "CPF" },
  { key: "comprovante_residencia", label: "Comprovante de residência" },
  { key: "holerite", label: "Holerite" },
  { key: "extrato_bancario", label: "Extrato bancário" },
  { key: "fatura_cartao", label: "Fatura de cartão de crédito" },
  { key: "ctps", label: "Carteira de trabalho (CTPS)" },
  { key: "pis", label: "PIS/PASEP" },
  { key: "fgts", label: "Extrato FGTS" },
  { key: "certidao_nascimento", label: "Certidão de nascimento" },
  { key: "certidao_casamento", label: "Certidão de casamento" },
  { key: "declaracao_ir", label: "Declaração de Imposto de Renda" },
  { key: "recibo_entrega_ir", label: "Recibo de entrega do Imposto de Renda" },
  { key: "outro", label: "Outro documento" },
  { key: "nao_identificado", label: "Não identificado" }
];

export const CHECKLIST_STATUS_OPTIONS = [
  { key: "conforme", label: "Conforme" },
  { key: "pendencia", label: "Pendência" },
  { key: "ilegivel", label: "Ilegível" },
  { key: "ausente", label: "Ausente" },
  { key: "divergencia", label: "Divergência" },
  { key: "precisa_confirmacao", label: "Necessita confirmação" }
];
