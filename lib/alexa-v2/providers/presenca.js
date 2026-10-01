import "server-only";
import { getTeamPresence, PRESENCE_STATUS } from "../../admin-presence";
import { getOwnerAuth } from "../../crm-metrics/owner-auth";
import { firstNameOf } from "../text.mjs";

// Online agora = o mesmo status "online" da tela de Presença (atividade nos
// últimos 5 minutos). Visão do dono (todos os corretores ativos, sem o dono).
export async function presencaProvider() {
  const presence = await getTeamPresence(await getOwnerAuth());
  const online = (presence.members || []).filter((member) => member.status === PRESENCE_STATUS.ONLINE);
  return { count: online.length, items: online.map((member) => ({ name: firstNameOf(member.name) })).filter((item) => item.name) };
}
