import { ACTION } from "./reconnect-policy.js";

// O que fazer quando o socket de uma sessão FECHA, dado o veredito da política
// de reconexão (reconnect-policy.js). Separado de sessions.js (que importa o
// Baileys) para ser testável com dependências falsas: nada aqui abre socket,
// fala com o WhatsApp ou envia mensagem.
//
// Estados persistidos (whatsapp_individual_sessions.status — todos já existem
// no CHECK, nenhuma migration de status):
//   logout recebido (401) ........ 'disconnected' + credenciais apagadas + last_error 'logged_out'
//   intervenção (403/440/...) .... 'error' + last_error 'needs_attention:<motivo>: <texto>'
//   limite de tentativas ......... 'error' + last_error 'needs_attention:retry_limit: <texto>'
//   QR sem escanear (limite) ..... 'disconnected' + last_error 'qr_expired'
//   queda recuperável ............ 'reconnecting' (com tentativa agendada)
// 'error' com prefixo 'needs_attention:' = a reconexão automática PAROU; só volta
// por ação consciente (botão Conectar → POST /connect), que abre um ciclo novo.

export const NEEDS_ATTENTION_PREFIX = "needs_attention:";

export function createCloseHandler({ userId, entry, controller, notifyStatus, clearSessionCreds, retireSocket, scheduleRetry, log = console.error }) {
  const resetPairingState = () => {
    entry.qr = null;
    entry.pairingCode = null;
    entry.pairingMode = false;
    entry.pairingError = null;
  };

  return async function handleClose({ sock, statusCode, errorMessage = "", payload }) {
    entry.sock = null;
    const unpaired = sock?.authState?.creds?.registered === false;
    const decision = controller.onClose({ statusCode, unpaired });
    const message = String(errorMessage || "").slice(0, 300);

    if (decision.action === ACTION.LOGOUT) {
      // Corretor desconectou pelo próprio celular (WhatsApp > Aparelhos
      // conectados): credenciais não servem mais — precisa de QR/código novo.
      entry.status = "disconnected";
      resetPairingState();
      entry.qr = null;
      await clearSessionCreds(userId);
      await notifyStatus(userId, { status: "disconnected", phoneNumber: null, qr: null, error: "logged_out", statusCode, output: payload });
      await retireSocket(sock);
      return decision;
    }

    if (decision.action === ACTION.INTERVENE || decision.action === ACTION.GIVE_UP) {
      const limit = decision.action === ACTION.GIVE_UP;
      const reason = limit ? "retry_limit" : decision.reason;
      const text = limit
        ? `Limite de ${decision.maxRetries} reconexões automáticas atingido (último código: ${decision.code ?? "sem código"}). A reconexão automática foi interrompida; reconecte manualmente quando for seguro.`
        : decision.message;
      entry.status = "error";
      resetPairingState();
      await notifyStatus(userId, { status: "error", error: `${NEEDS_ATTENTION_PREFIX}${reason}: ${text}`.slice(0, 300), statusCode, output: payload });
      await retireSocket(sock);
      return decision;
    }

    if (decision.action === ACTION.GIVE_UP_PAIRING) {
      // Ninguém escaneou o QR a tempo: não é falha da conta, só para de gerar QR novo.
      entry.status = "disconnected";
      resetPairingState();
      await notifyStatus(userId, { status: "disconnected", phoneNumber: null, qr: null, error: "qr_expired", statusCode, output: payload });
      await retireSocket(sock);
      return decision;
    }

    // RETRY: queda recuperável. Reconecta com os MESMOS creds já persistidos
    // (nunca gera QR à toa). O 515 que o WhatsApp manda logo depois de o celular
    // aceitar o QR/código precisa sair do modo código (senão connectSession
    // tratava como "começar do zero" e apagava as credenciais recém-registradas)
    // e esperar as credenciais terminarem de ser gravadas.
    entry.status = "reconnecting";
    entry.pairingMode = false;
    entry.pairingCode = null;
    entry.pairingError = null;
    await notifyStatus(userId, { status: "reconnecting", error: message, statusCode, output: payload });
    try {
      scheduleRetry({ delayMs: decision.delayMs, sock });
    } catch (error) {
      log(`[${userId}] Falha ao agendar a reconexão:`, error?.message || error);
    }
    return decision;
  };
}
