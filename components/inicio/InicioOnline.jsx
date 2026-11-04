import OnlinePresenceBoard from "@/components/OnlinePresenceBoard";
import Card from "@/components/ui/Card";
import Skeleton from "@/components/ui/Skeleton";
import { newRenderId } from "@/lib/render-id.mjs";

// Online dentro do Início (dono, 2026-11-04): a presença da equipe que era a aba "Online" fica logo abaixo do Lote de SMS. É o mesmo
// OnlinePresenceBoard de antes (atualiza sozinho em segundo plano); só mudou o lugar. Admin geral e gestor (a página confere).
export function InicioOnline({ presence, error = "" }) {
  return (
    <section id="online" aria-label="Online" className="scroll-mt-20 [&>div]:!max-w-none [&>div]:!px-0">
      <OnlinePresenceBoard initialPresence={presence} initialError={error} renderId={newRenderId()} />
    </section>
  );
}

export function InicioOnlineCarregando() {
  return (
    <Card title="Online" note="carregando…" padding="sm">
      <div role="status" aria-live="polite" className="space-y-2">
        <span className="sr-only">Carregando…</span>
        {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-4 w-full" />)}
      </div>
    </Card>
  );
}
