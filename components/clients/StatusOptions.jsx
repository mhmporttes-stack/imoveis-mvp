import { CLIENT_FUNNEL_SALE_STATUS_VALUES, CLIENT_STATUS, CLIENT_STATUS_META } from "@/lib/client-status";

// Etapas que o usuário pode escolher, na mesma ordem e com os mesmos rótulos
// do seletor antigo. "Venda" tem uma única opção (Venda realizada); status
// legados de venda aparecem como a opção atual, sem poderem ser escolhidos.
// Usado pelo card e pela ficha — uma lista só.
export const SELECTABLE_STATUS_VALUES = [
  CLIENT_STATUS.AUTOMATED_SERVICE, CLIENT_STATUS.PENDING, CLIENT_STATUS.COMPLETED, CLIENT_STATUS.SIMULATION_SENT,
  CLIENT_STATUS.AWAITING_RETURN, CLIENT_STATUS.IN_SERVICE, CLIENT_STATUS.DOCUMENTATION, CLIENT_STATUS.DOCUMENTS_PENDING,
  CLIENT_STATUS.APPROVAL_PENDING, CLIENT_STATUS.INCOME_COMMITMENT, CLIENT_STATUS.CANCELLATION_LETTER, CLIENT_STATUS.RESEARCH_MO,
  CLIENT_STATUS.RESTRICTION, CLIENT_STATUS.SHIELDING, CLIENT_STATUS.APPROVED, CLIENT_STATUS.REJECTED,
  CLIENT_STATUS.MEETING_PENDING, CLIENT_STATUS.MEETING_DONE, CLIENT_STATUS.ARCHIVED, CLIENT_STATUS.DO_NOT_CONTACT
];
const SALE_STATUS_VALUES = new Set(CLIENT_FUNNEL_SALE_STATUS_VALUES);

export default function StatusOptions({ current }) {
  const legacySale = SALE_STATUS_VALUES.has(current) && current !== CLIENT_STATUS.SALE_COMPLETED;
  return (
    <>
      {SELECTABLE_STATUS_VALUES.map((value) => <option key={value} value={value}>{CLIENT_STATUS_META[value].label}</option>)}
      <optgroup label="Venda">
        <option value={CLIENT_STATUS.SALE_COMPLETED}>Venda realizada</option>
        {legacySale ? <option value={current} disabled>{CLIENT_STATUS_META[current]?.label || "Venda"} (atual)</option> : null}
      </optgroup>
    </>
  );
}
