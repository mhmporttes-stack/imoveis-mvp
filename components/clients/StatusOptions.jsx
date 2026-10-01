import { CLIENT_FUNNEL_SALE_STATUS_VALUES, CLIENT_STATUS, CLIENT_STATUS_META } from "@/lib/client-status";

// Etapas que o usuário pode escolher, na mesma ordem do funil. O grupo
// "Venda" lista TODAS as subetapas de pós-venda (Formulários...Pagamento,
// mesma ordem de CLIENT_FUNNEL_SALE_STATUS_VALUES/da barra de abas) — antes
// só "Venda realizada" aparecia aqui; as demais existiam no funil (com
// contagem própria) mas só eram atingidas por edição direta no banco, nunca
// pela tela (achado real, 2026-10-01, liberado a pedido do dono). Usado pelo
// card e pela ficha — uma lista só.
export const SELECTABLE_STATUS_VALUES = [
  CLIENT_STATUS.AUTOMATED_SERVICE, CLIENT_STATUS.PENDING, CLIENT_STATUS.COMPLETED, CLIENT_STATUS.SIMULATION_SENT,
  CLIENT_STATUS.AWAITING_RETURN, CLIENT_STATUS.IN_SERVICE, CLIENT_STATUS.DOCUMENTATION, CLIENT_STATUS.DOCUMENTS_PENDING,
  CLIENT_STATUS.APPROVAL_PENDING, CLIENT_STATUS.INCOME_COMMITMENT, CLIENT_STATUS.CANCELLATION_LETTER, CLIENT_STATUS.RESEARCH_MO,
  CLIENT_STATUS.RESTRICTION, CLIENT_STATUS.SHIELDING, CLIENT_STATUS.APPROVED, CLIENT_STATUS.REJECTED,
  CLIENT_STATUS.MEETING_PENDING, CLIENT_STATUS.MEETING_DONE, CLIENT_STATUS.ARCHIVED, CLIENT_STATUS.DO_NOT_CONTACT
];

export default function StatusOptions() {
  return (
    <>
      {SELECTABLE_STATUS_VALUES.map((value) => <option key={value} value={value}>{CLIENT_STATUS_META[value].label}</option>)}
      <optgroup label="Venda">
        {CLIENT_FUNNEL_SALE_STATUS_VALUES.map((value) => <option key={value} value={value}>{CLIENT_STATUS_META[value].label}</option>)}
      </optgroup>
    </>
  );
}
