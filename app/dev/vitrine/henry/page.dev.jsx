import HenryDemo from "../_components/HenryDemo";
import HenryCursorDemo from "../_components/HenryCursorDemo";

// Vitrine DEV do assistente de voz Henry (HENRY-1). Só no `next dev`; sinal de áudio simulado e conversa fictícia.
//   ?modo=idle|listening|thinking|speaking  ·  ?tela=icone (ícone do canto sobre fundo do painel)
//   ?cena=buscando&assunto=funil|ranking|clientes|relatorio|meta (dados transparentes) · ?cena=procurando (scanner do corretor)
//   ?cena=corretor&n=1|2|3 (cards premium em arco ligados ao anel) · ?cena=relatorio (detalhe do relatório em lista)
//   ?cena=achou&assunto=… (ciclo busca → achou → resposta) · assunto=internet (páginas da web folheando)
//   ?resposta=numeros|comparativo|cliente|web|memoria|conversa|corretor (cena da RESPOSTA, HenryAnswerScenes)
//   ?cena=cursor (navegação guiada: o cursor do Henry vai ao menu, clica e abre o card do cliente)
//   Celular: abrir com a janela em 390×844 (mesma apresentação do app: tocar para falar, ícone acima da barra inferior).
export const dynamic = "force-dynamic";

export default async function HenryVitrine({ searchParams }) {
  const params = await searchParams;
  if (params?.cena === "cursor") return <HenryCursorDemo />;
  const scene = ["buscando", "procurando", "corretor", "relatorio", "achou"].includes(params?.cena) ? params.cena : "";
  const sceneMode = scene === "buscando" || scene === "procurando" ? "thinking" : scene ? "speaking" : "";
  const mode = ["idle", "listening", "thinking", "speaking"].includes(params?.modo) ? params.modo : sceneMode || "speaking";
  const topic = ["geral", "relatorio", "funil", "ranking", "clientes", "corretor", "meta", "whatsapp", "internet"].includes(params?.assunto) ? params.assunto : scene === "procurando" ? "corretor" : "relatorio";
  const icon = params?.tela === "icone";
  const answer = ["numeros", "comparativo", "cliente", "web", "memoria", "conversa", "corretor"].includes(params?.resposta) ? params.resposta : "";
  return (
    // No celular (< 768 px) o ícone fica acima da barra inferior do app: aqui uma barra de mentira mostra que ele não a cobre.
    <main className={icon ? "min-h-screen bg-mist p-10" : "min-h-screen"} style={icon ? { "--admin-bottom-nav-space": "56px" } : undefined}>
      <HenryDemo mode={mode} expanded={!icon} capturing={params?.camera === "1"} scene={scene} topic={topic} brokerCount={Number(params?.n) || 2} answer={answer} />
      {icon ? (
        <div className="fixed inset-x-0 bottom-0 z-30 flex h-14 items-center justify-around border-t border-line bg-white text-[10px] font-semibold text-muted md:hidden">
          <span>Início</span>
          <span>Clientes</span>
          <span>Chat</span>
          <span>Meta</span>
          <span>Mais</span>
        </div>
      ) : null}
    </main>
  );
}
