// Alvos de cada estado do anel do Henry (HenryOrb.jsx) e cores — puro, testável. Todos os números são interpolados a cada
// quadro (orbEase ≈ 95% em 300 ms), então trocar de estado nunca corta a animação.
//   amp/levelAmp     = ondulação dos fios (base + quanto o volume soma)
//   swell/levelSwell = inchaço do raio
//   speed/levelSpeed = velocidade do ruído
//   spin/counterSpin = rotação geral / camadas em sentidos opostos
//   breath/breathRate= respiração (contrai/expande) e ritmo (ciclos por segundo)
//   travel           = onda que percorre o anel (ouvindo)
//   fan              = fios abrindo em leque (falando)
//   sphere           = vira quase esfera nos picos da voz (falando)
//   warm             = 0 frio (ciano/azul) → 1 quente (dourado e branco no topo)
//   glowBase/glowLevel = brilho de fundo; beamOn = feixe dourado no contorno (pensando)
//   dim              = brilho geral dos fios (parado fica escurecido)
//   rim              = brilho pulsante no contorno (conversa aberta esperando o dono — ainda escuta sem o nome)
//   neural           = rede neural no centro (pensando/buscando; some em ~300 ms quando ele começa a falar)
// Estados (dono, 2026-10-23: "preciso identificar quando o Henry está pensando… ou quando ele simplesmente parou"):
//   idle = conversa encerrada · waiting = janela de conversa aberta · listening · thinking · speaking.
export const HENRY_ORB_STATES = Object.freeze({
  idle: { amp: 0.4, levelAmp: 0, swell: 0, levelSwell: 0, speed: 0.3, levelSpeed: 0, spin: 0.05, counterSpin: 0, breath: 0.022, breathRate: 0.12, travel: 0, fan: 0, sphere: 0, warm: 0.15, glowBase: 0, glowLevel: 0, beamOn: 0, dim: 0.35, rim: 0, neural: 0, voice: 0 },
  waiting: { amp: 0.5, levelAmp: 0, swell: 0.01, levelSwell: 0, speed: 0.45, levelSpeed: 0, spin: 0.07, counterSpin: 0, breath: 0.018, breathRate: 0.2, travel: 0, fan: 0, sphere: 0, warm: 0.05, glowBase: 0.04, glowLevel: 0, beamOn: 0, dim: 0.9, rim: 1, neural: 0, voice: 0 },
  listening: { amp: 0.75, levelAmp: 1.9, swell: 0.03, levelSwell: 0.16, speed: 1.3, levelSpeed: 2.6, spin: 0.12, counterSpin: 0, breath: 0.01, breathRate: 0.5, travel: 1, fan: 0.1, sphere: 0, warm: 0, glowBase: 0.08, glowLevel: 0.75, beamOn: 0, dim: 1, rim: 0, neural: 0, voice: 0 },
  thinking: { amp: 0.55, levelAmp: 0, swell: -0.02, levelSwell: 0, speed: 0.7, levelSpeed: 0, spin: 0.1, counterSpin: 1.1, breath: 0.07, breathRate: 0.75, travel: 0.2, fan: 0.15, sphere: 0, warm: 0.45, glowBase: 0.12, glowLevel: 0, beamOn: 1, dim: 0.9, rim: 0, neural: 1, voice: 0 },
  speaking: { amp: 0.9, levelAmp: 1.6, swell: 0.06, levelSwell: 0.42, speed: 1.1, levelSpeed: 1.8, spin: 0.18, counterSpin: 0.15, breath: 0.01, breathRate: 0.4, travel: 0.3, fan: 1, sphere: 1, warm: 1, glowBase: 0.15, glowLevel: 0.6, beamOn: 0, dim: 1, rim: 0, neural: 0, voice: 1 }
});

export const HENRY_ORB_MODES = Object.freeze(Object.keys(HENRY_ORB_STATES));

// FONTE ÚNICA do estado visual do anel (getSignal do HenryVoiceAssistant). "Pensando" vale do fim da fala do dono até a
// 1ª fala da resposta (transcrição, IA, ferramentas; a confirmação de escuta e as frases de espera tocam sem sair dele).
// "Esperando" = microfone ligado e janela de conversa aberta (ou pergunta dele pendente), ninguém falando agora.
export function henryOrbMode({ phase = "idle", recording = false, hearing = false, micOn = false, conversationOpen = false, awaitingReply = false } = {}) {
  if (phase === "speaking") return "speaking";
  if (recording) return "listening";
  if (phase === "thinking") return "thinking";
  if (micOn && (phase === "armed" || hearing)) return "listening";
  if (micOn && (conversationOpen || awaitingReply)) return "waiting";
  return "idle";
}

// Intensidade da rede neural (0..1): papo mais calmo, busca de dados/web/relatório/ferramenta mais intensa; cada evento de
// progresso do stream soma um pouco.
const CALM_TOPICS = new Set(["geral"]);
export function thinkingActivity({ topic = "geral", progress = 0 } = {}) {
  const base = CALM_TOPICS.has(topic) ? 0.3 : topic === "music" ? 0.55 : 0.85;
  return Math.min(1, base + 0.05 * Math.max(0, Number(progress) || 0));
}

// Rede neural do centro: nós espalhados num disco (girassol com desvio determinístico, sem aleatório → mesmo desenho a
// cada abertura), ligações com os vizinhos mais próximos e "tentáculos" dos nós de fora até os anéis de dentro.
// Coordenadas em unidades do raio do anel (|x,y| ≤ 0,7).
export function buildNeuralNet(count = 22) {
  const total = Math.max(4, Math.min(40, Math.round(Number(count) || 0)));
  const nodes = Array.from({ length: total }, (_, index) => {
    const jitter = Math.sin(index * 78.233) * 0.5 + 0.5;
    const r = 0.7 * Math.sqrt((index + 0.5) / total) * (0.86 + 0.14 * jitter);
    const angle = index * 2.399963 + jitter * 0.6;
    return { x: r * Math.cos(angle), y: r * Math.sin(angle), r, angle, phase: index * 1.731, gold: index % 5 === 2 };
  });
  const edges = [];
  const seen = new Set();
  const neighbours = total <= 8 ? 2 : 3;
  nodes.forEach((node, a) => {
    const nearest = nodes
      .map((other, b) => ({ b, d: Math.hypot(other.x - node.x, other.y - node.y) }))
      .filter((item) => item.b !== a)
      .sort((p, q) => p.d - q.d)
      .slice(0, neighbours);
    for (const { b } of nearest) {
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const index = edges.length;
      edges.push({ a: Math.min(a, b), b: Math.max(a, b), seed: index * 2.17 + 0.4, rate: 0.35 + ((index * 37) % 10) / 22, bend: index % 2 ? 1 : -1, gold: index % 7 === 3 });
    }
  });
  const outer = nodes.map((node, index) => ({ node, index })).filter((item) => item.node.r > 0.5);
  const tendrils = outer.map(({ node, index }, order) => ({ node: index, angle: node.angle + (order % 2 ? 0.18 : -0.18), seed: order * 3.1 + 1.3, rate: 0.3 + (order % 4) * 0.12 }));
  return { nodes, edges, tendrils };
}

export const ORB_TRANSITION_MS = 300;
// Vibração dos fios (dono, 2026-10-23, protótipo v14: "ficou muito embaraçado"): ondulação × 0,4 em todos os estados.
export const HENRY_ORB_VIB = 0.4;
// Pulso de chegada do Pulso do CRM no anel (protótipo v16): duração total.
export const HENRY_ORB_HIT_MS = 1100;

// Fator de aproximação por quadro: depois de ORB_TRANSITION_MS o valor percorreu ~95% do caminho, qualquer que seja o fps.
export function orbEase(deltaSeconds) {
  const tau = ORB_TRANSITION_MS / 1000 / 3;
  return 1 - Math.exp(-Math.max(0, Number(deltaSeconds) || 0) / tau);
}

const COOL = [
  [0, "#F3DCA6"],
  [0.16, "#BFF1FF"],
  [0.42, "#4FC3E0"],
  [0.72, "#1E9BFF"],
  [1, "#0B3D91"]
];
const WARM = [
  [0, "#FFFFFF"],
  [0.16, "#FFF1CF"],
  [0.42, "#F3DCA6"],
  [0.72, "#4FC3E0"],
  [1, "#1E9BFF"]
];

export function mixHexColor(from, to, t) {
  const amount = Math.max(0, Math.min(1, Number(t) || 0));
  const parse = (hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  const a = parse(from);
  const b = parse(to);
  return `#${a.map((value, index) => Math.round(value + (b[index] - value) * amount).toString(16).padStart(2, "0")).join("")}`;
}

export function orbStops(warm) {
  return COOL.map(([offset, color], index) => [offset, mixHexColor(color, WARM[index][1], warm)]);
}

// Cor viva para o pulso de chegada no anel (protótipo v15): mesma matiz do card (pastel), saturação 100%, luminosidade 60%.
export function vividColor(hex) {
  const [r, g, b] = [1, 3, 5].map((index) => parseInt(String(hex || "#5cd6ff").slice(index, index + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  let hue = 0;
  if (delta) hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return `hsl(${Math.round(hue * 60 + 360) % 360}, 100%, 60%)`;
}
