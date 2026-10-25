import HenryDemo from "../_components/HenryDemo";
import HenryCursorDemo from "../_components/HenryCursorDemo";
import HenryLockDemo from "../_components/HenryLockDemo";

// Vitrine DEV do assistente de voz Henry (HENRY-1). Só no `next dev`; sinal de áudio simulado e conversa fictícia.
//   ?modo=idle|listening|thinking|speaking  ·  ?tela=icone (ícone do canto sobre fundo do painel)
//   ?cena=buscando&assunto=funil|ranking|clientes|relatorio|meta (dados transparentes) · ?cena=procurando (scanner do corretor)
//   ?cena=corretor&n=1|2|3 (cards premium em arco ligados ao anel) · ?cena=relatorio (detalhe do relatório em lista)
//   ?cena=achou&assunto=… (ciclo busca → achou → resposta) · assunto=internet (páginas da web folheando)
//   ?resposta=numeros|comparativo|cliente|web|memoria|conversa|corretor (cena da RESPOSTA, HenryAnswerScenes)
//   ?cena=abertura (cena de abertura do bom dia; ▶ repete; &numeros=1 com telemetria fictícia)
//   ?cena=cursor (navegação guiada: o cursor do Henry vai ao menu, clica e abre o card do cliente)
//   ?cena=musica&etapa=connect|search|found|opening|playing|error|ciclo (cena do Spotify) · ?ondas=1|ciclo (Tocando agora)
//   ?estado=parado|esperando|ouvindo|pensando|buscando|falando|ciclo (estados do anel; pensando = Cérebro realista no centro (buscando = o mesmo, 2026-10-25); ciclo = passa por todos para ver as transições) · combina com ?tela=icone
//   ?avisos=1 (lista dos avisos lidos pelo Henry, FICTÍCIOS) · ?cena=abertura (bom dia novo, v22)
//   ?pulso=1 (Pulso do CRM com eventos de EXEMPLO; sem ?modo= fica ocioso — ?modo=thinking|speaking mostra o apagado)
//   Celular: abrir com a janela em 390×844 (mesma apresentação do app: tocar para falar, ícone acima da barra inferior).
export const dynamic = "force-dynamic";

export default async function HenryVitrine({ searchParams }) {
  const params = await searchParams;
  if (params?.cena === "cursor") return <HenryCursorDemo />;
  // Tela de bloqueio (HENRY-LOCK): ?bloqueio=1|digitando|erro|teclado|aberto|aviso|ambiente (senha fictícia 123456 só aqui).
  if (params?.bloqueio) return <HenryLockDemo variant={String(params.bloqueio)} />;
  const scene = ["buscando", "procurando", "corretor", "relatorio", "achou", "musica"].includes(params?.cena) ? params.cena : "";
  const sceneMode = scene === "buscando" || scene === "procurando" ? "thinking" : scene ? "speaking" : "";
  const pulse = params?.pulso === "1";
  const ESTADOS = { parado: ["idle", ""], esperando: ["waiting", ""], ouvindo: ["listening", ""], pensando: ["thinking", "papo"], buscando: ["thinking", "busca"], falando: ["speaking", ""] };
  const estado = ESTADOS[params?.estado] || null;
  const mode = estado ? estado[0] : ["idle", "waiting", "listening", "thinking", "speaking"].includes(params?.modo) ? params.modo : sceneMode || (pulse ? "idle" : "speaking");
  const topic = ["geral", "relatorio", "funil", "ranking", "clientes", "corretor", "meta", "whatsapp", "internet"].includes(params?.assunto) ? params.assunto : scene === "procurando" ? "corretor" : "relatorio";
  const icon = params?.tela === "icone";
  const answer = ["numeros", "comparativo", "cliente", "web", "memoria", "conversa", "corretor"].includes(params?.resposta) ? params.resposta : "";
  return (
    // No celular (< 768 px) o ícone fica acima da barra inferior do app: aqui uma barra de mentira mostra que ele não a cobre.
    <main className={icon ? "min-h-screen bg-mist p-10" : "min-h-screen"} style={icon ? { "--admin-bottom-nav-space": "56px" } : undefined}>
      <HenryDemo mode={mode} thinkingKind={estado ? estado[1] : ""} stateCycle={params?.estado === "ciclo"} expanded={!icon} capturing={params?.camera === "1"} scene={scene} topic={topic} brokerCount={Number(params?.n) || 2} answer={answer} musicStage={typeof params?.etapa === "string" ? params.etapa : ""} waves={params?.ondas === "1" || params?.ondas === "ciclo" ? params.ondas : ""} opening={params?.cena === "abertura"} telemetry={params?.numeros === "1"} pulse={pulse} alerts={params?.avisos === "1"} />
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
