// Conversão "Lead" do Google Ads (campanha de aplicativos, dono 2026-11-02). Um único ponto: `trackGoogleAdsLead`.
// - Só funciona com NEXT_PUBLIC_GOOGLE_ADS_ID (AW-XXXXXXXXX) E NEXT_PUBLIC_GOOGLE_ADS_LEAD_LABEL; sem eles nada carrega e nada quebra.
// - Chamada UMA vez, no sucesso do envio do último botão do formulário, antes do redirecionamento ao WhatsApp
//   (SimulationForm / QuickAttendanceForm). Nunca em erro, nunca sem id do cadastro, nunca duas vezes para o mesmo cadastro
//   (sessionStorage + `transaction_id` = id do cadastro, que o Google também deduplica).
// - Sem dado pessoal (nome/telefone/e-mail) e sem enhanced conversions: só id do cadastro (e valor, se houver decisão do dono).
// - Espera `event_callback` do gtag, no máximo 300 ms, para o evento sair antes de a página trocar para o WhatsApp.

export const GOOGLE_ADS_ID = normalizeAdsId(process.env.NEXT_PUBLIC_GOOGLE_ADS_ID);
export const GOOGLE_ADS_LEAD_SEND_TO = buildSendTo(GOOGLE_ADS_ID, process.env.NEXT_PUBLIC_GOOGLE_ADS_LEAD_LABEL);
export const GOOGLE_ADS_MAX_WAIT_MS = 300;

// "AW-123456789" -> igual; qualquer outra coisa -> "" (o valor entra em script inline, por isso a validação estrita).
export function normalizeAdsId(value) {
  const text = String(value ?? "").trim();
  return /^AW-\d{6,15}$/.test(text) ? text : "";
}

// Aceita só o rótulo ("AbCd_123") ou o "AW-123456789/AbCd_123" que o Google Ads mostra. Sem ID ou rótulo válido -> "".
export function buildSendTo(adsId, labelOrSendTo) {
  if (!adsId) return "";
  const raw = String(labelOrSendTo ?? "").trim();
  const label = raw.includes("/") ? raw.split("/").pop() : raw;
  return /^[\w-]{5,80}$/.test(label) ? `${adsId}/${label}` : "";
}

// DECISÃO NECESSÁRIA (dono): o site não tem banner de cookies/consentimento hoje (nem para o Meta Pixel). Enquanto não houver,
// o Google Ads dispara como o Pixel da Meta. Quando existir banner, é SÓ aqui que o consentimento passa a valer.
export function hasAdsConsent() {
  return true;
}

export function leadDedupeKey(id) {
  return `mm_gads_lead:${id}`;
}

// Fábrica com dependências injetáveis (testes e navegador usam a mesma lógica).
export function createGoogleAdsLeadTracker({
  sendTo = "",
  getGtag = () => (typeof window !== "undefined" && typeof window.gtag === "function" ? window.gtag : null),
  storage = null,
  hasConsent = hasAdsConsent,
  maxWaitMs = GOOGLE_ADS_MAX_WAIT_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (timer) => clearTimeout(timer)
} = {}) {
  return function trackGoogleAdsLead({ id, value } = {}) {
    const registrationId = String(id ?? "").trim();
    if (!sendTo) return Promise.resolve({ fired: false, reason: "not_configured" });
    if (!registrationId) return Promise.resolve({ fired: false, reason: "no_id" });
    try {
      if (!hasConsent()) return Promise.resolve({ fired: false, reason: "no_consent" });
      const gtag = getGtag();
      if (!gtag) return Promise.resolve({ fired: false, reason: "gtag_unavailable" });
      const key = leadDedupeKey(registrationId);
      if (storage?.getItem(key)) return Promise.resolve({ fired: false, reason: "duplicate" });
      // Marca ANTES de disparar: duplo clique / reenvio nunca contam duas vezes.
      storage?.setItem(key, "1");

      const params = { send_to: sendTo, transaction_id: registrationId };
      const amount = Number(value);
      if (Number.isFinite(amount) && amount > 0) {
        params.value = amount;
        params.currency = "BRL";
      }

      return new Promise((resolve) => {
        let settled = false;
        let timer = null;
        const finish = () => {
          if (settled) return;
          settled = true;
          if (timer) clearTimer(timer);
          resolve({ fired: true });
        };
        timer = setTimer(finish, maxWaitMs);
        params.event_callback = finish;
        try {
          gtag("event", "conversion", params);
        } catch {
          // gtag quebrou: segue sem esperar (o cadastro e o redirecionamento não dependem do rastreamento).
          settled = true;
          if (timer) clearTimer(timer);
          resolve({ fired: false, reason: "error" });
        }
      });
    } catch {
      // Rastreamento nunca pode quebrar o cadastro nem atrasar o redirecionamento ao WhatsApp.
      return Promise.resolve({ fired: false, reason: "error" });
    }
  };
}

function browserStorage() {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function trackGoogleAdsLead(input) {
  return createGoogleAdsLeadTracker({ sendTo: GOOGLE_ADS_LEAD_SEND_TO, storage: browserStorage() })(input);
}
