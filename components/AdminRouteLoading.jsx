import Skeleton from "@/components/ui/Skeleton";

// Esqueleto da troca de tela do painel (velocidade, etapa 3, dono 2026-10-22): aparece na hora do clique enquanto o
// servidor monta a tela nova (as páginas do painel são dinâmicas). Usado pelos loading.jsx de cada seção de app/admin.
// Fica FORA da Meta Diária e de /admin/simulacoes (destinos das cenas: SceneTransitionLink/SceneTransitionRoot animam
// os blocos da tela de verdade) e do Chat (moldura e cache próprios) — por isso não existe app/admin/loading.jsx.
// data-admin-route-loading: AdminScrollReveal espera o esqueleto sair antes de varrer (a entrada por rolagem continua
// acontecendo na tela de verdade); data-no-reveal: o próprio esqueleto nunca é animado.
export default function AdminRouteLoading() {
  return (
    <div data-admin-route-loading="" data-no-reveal="" role="status" aria-live="polite" className="container-page py-6">
      <span className="sr-only">Carregando…</span>
      <Skeleton className="h-7 w-56 max-w-[70%]" />
      <Skeleton className="mt-3 h-4 w-80 max-w-[85%]" />
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <div key={index} className="rounded-card border border-line bg-white p-5">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="mt-3 h-8 w-3/5" />
          </div>
        ))}
      </div>
      <div className="mt-4 space-y-3 rounded-card border border-line bg-white p-5">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="flex items-center gap-3">
            <Skeleton className="h-10 w-10" rounded="rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-2/5" />
              <Skeleton className="h-3 w-3/5" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
