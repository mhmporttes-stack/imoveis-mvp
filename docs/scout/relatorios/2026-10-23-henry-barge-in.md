# Henry: interromper a fala (barge-in) — 2026-10-23
PEDIDO: Henry parar de falar quando o dono interrompe, sem confundir a própria voz (eco) com fala dele. · ALVO: `components/henry/HenryVoiceAssistant.jsx`, `lib/henry-voice-core.mjs` (eco), `lib/henry-voice-providers.mjs`
COMPETÊNCIAS: cancelamento de eco (AEC) do navegador · detecção de voz local (VAD) · turn-taking · privacidade de áudio · teste em Chrome/iPhone/Electron
LACUNA ATUAL (evidência): no computador a voz toca num `<audio>` mas é ligada ao WebAudio (`createMediaElementSource` → analyser → `context.destination`, HenryVoiceAssistant.jsx:575-579); no celular toca por `createBufferSource` (:605-606). Fonte de terceiro (atmoky, "Known Issues") diz que o Chromium só aplica AEC ao áudio de elemento de mídia, não ao que sai pelo WebAudio (bug antigo, ainda aberto segundo ela; número do bug não confirmado). **Provável causa do eco no PC: o Henry desliga o próprio AEC ao passar a voz pelo medidor do anel.** Além disso a escuta do Chrome é a Web Speech API, que não recebe `echoCancellation` nem permite VAD sobre o stream.
FONTES: 1 (doc ElevenLabs/OpenAI/Chrome via WebFetch), 4 (npm `@ricky0123/vad-web`), 6 (GitHub elevenlabs/skills, pipecat-ai/skills), 10 (busca). Não consegui: API do GitHub (403), página atmoky (503), MCP Registry (500).

CANDIDATOS
| Nome | Tipo | Proveniência | Nota | Classe | Contexto | Riscos |
|---|---|---|---|---|---|---|
| AEC do Chrome + `<audio>` puro (medidor via `audio.captureStream()`) | técnica nativa | developer.chrome.com/blog/more-native-echo-cancellation (AEC usa o áudio que o próprio Chrome toca como referência) | 2 | ADOTAR | 0 | a confirmar em teste: Electron (mesmo Chromium, deve valer) e iPhone (WebKit bug 326286: chiado com AEC no iOS 26.2+) |
| `@ricky0123/vad-web` (Silero) | lib npm | v0.0.31 · 2026-09-12 · ISC · dep. `onnxruntime-web` · sem postinstall · 6,8 MB descompactado; modelo ~2 MB; inferência <1 ms por quadro de 32 ms (blog micdrop) | 2 | ADOTAR (pelo crm-editor) | 0 | baixa WASM/modelo no 1º uso (servir do próprio domínio); latência total depende do mínimo de quadros de fala (ajustável, ~0,2-0,3 s típico, não medido) |
| Correlação mic × sinal do TTS | técnica própria | sem lib; usa o analyser que já existe | 1 | COMBINAR (só como trava extra) | 0 | subtração/NLMS própria = esforço alto e frágil; não recomendo como base |
| ElevenLabs Agents Platform | serviço | elevenlabs.io/pricing/api: US$ 0,08/min + LLM; interrupção nativa (liga/desliga), `turn_eagerness`, client tools no navegador (JS SDK) | 2 | PLANO B | 0 | microfone vai contínuo à ElevenLabs; refazer barreiras do Henry (persona, travas de número, ferramentas) dentro do agente; LLM próprio (Claude) não confirmado |
| OpenAI Realtime (`server_vad`/`semantic_vad`) | serviço | pricing oficial: gpt-realtime-2.1 US$ 32/64 por 1M tokens de áudio (mini 10/20); por minuto ~US$ 0,06-0,11 só em estimativa de terceiro | 1 | DESCARTAR | 0 | troca Claude por GPT e perde a voz ElevenLabs |
| LiveKit Agents / Pipecat | framework | LiveKit Cloud US$ 0,01/min de sessão + modelos; Pipecat BSD-2 (Silero + interrupção por padrão) | 1 | REFERÊNCIA | 0 | exige servidor de agente fora da Vercel (tipo Railway) e WebRTC: reescrita grande |
| elevenlabs/skills (`agents`) | skill Claude Code | github.com/elevenlabs/skills · MIT · SKILL.md ~25 mil chars (~7 mil tokens ao invocar) | 1 | REFERÊNCIA | 0 fixo | manda rodar `npx @elevenlabs/cli@latest onboard` e guardar chave: não instalar |
| pipecat-ai/skills | skill Claude Code | BSD-2 · roda `pc init` e deploy no Pipecat Cloud | 0 | DESCARTAR | — | executa e publica |
Nenhuma skill/MCP de WebRTC/AEC confiável encontrada. Sem injeção detectada nas páginas lidas.

RECOMENDAÇÃO (plano A, local, sem serviço novo)
1. Tocar a voz do Henry por `<audio>` que sai direto (sem `createMediaElementSource`); o anel passa a medir por `audio.captureStream()` → analyser NÃO ligado ao destino. No celular, testar `<audio>` também (hoje é WebAudio por causa do iOS).
2. Durante a fala, abrir `getUserMedia({echoCancellation, noiseSuppression, autoGainControl: true})` e rodar o VAD Silero local sobre esse stream.
3. Duas etapas: VAD detectou fala → baixar o volume do Henry na hora (pausa suave); confirmação pela transcrição (ElevenLabs STT só desse trecho, ou a heurística atual "Henry"/3+ palavras) → parar de vez; sem confirmação em ~1,5 s → volta o volume. Trava extra: ignorar se a energia do mic acompanha a do TTS (correlação simples, regra pura em `lib/henry-voice-core.mjs` com teste `node --test`).
4. iPhone: manter half-duplex como padrão até passar no teste real; se o AEC do iOS falhar, oferecer "toque para interromper".
Prós: custo zero por minuto; áudio só sai do aparelho quando há fala de verdade; mantém Claude, ferramentas e barreiras. Contras: precisa ajuste fino por aparelho; iPhone incerto.
PLANO B: ElevenLabs Agents (interrupção pronta). Ex.: 30 min/dia × 22 dias ≈ 660 min ≈ US$ 53/mês + LLM. Prós: turn-taking maduro. Contras: áudio contínuo ao provedor, reescrever o Henry dentro da plataforma, dependência maior.
ESFORÇO: plano A ~1-2 dias do crm-editor + teste com o dono em PC, Electron e iPhone; plano B ~1-2 semanas.
CUSTO FIXO DE CONTEXTO ADICIONADO: 0 → 0 (nada em `.claude/`).
DECISÃO NECESSÁRIA (só se for o plano B): mandar o áudio do microfone de forma contínua para a ElevenLabs durante a conversa.
PRÓXIMO PASSO (crm-editor, com aprovação do dono): passo 1 sozinho primeiro (pode resolver boa parte do eco no PC) → medir → passos 2-3. Nada foi instalado.
NÃO CONFIRMADO: número/estado atual do bug do Chromium (WebAudio sem AEC); se a Web Speech API usa AEC; se `captureStream` preserva o AEC; latência real do VAD; preço LLM no plano B; se ElevenLabs Agents aceita Claude como LLM próprio.
