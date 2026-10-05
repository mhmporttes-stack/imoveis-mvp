import { ACTION, isPairedCreds } from "./reconnect-policy.js";

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
//   QR sem escanear / pareamento interrompido ... 'disconnected' + last_error 'qr_expired' | 'pairing_interrupted'
//   queda recuperável ............ 'reconnecting' (com tentativa agendada)
//   515 (reinício normal) ........ 'connecting' (sem erro, sem alerta)
// 'error' com prefixo 'needs_attention:' = a reconexão automática PAROU; só volta
// por ação consciente (botão Conectar → POST /connect), que abre um ciclo novo.
// Encerramento do SERVIÇO (deploy/SIGTERM): nenhum desses estados é gravado — a sessão
// continua 'connected' no banco para o próximo dono do lease retomar.

export const NEEDS_ATTENTION_PREFIX = "needs_attention:";

export function createCloseHandler({ userId, entry, controller, notifyStatus, clearSessionCreds, retireSocket, scheduleRetry, isShuttingDown = () => false, log = console.error }) {
  const resetPairingState = () => {
    entry.qr = null;
    entry.pairingCode = null;
    entry.pairingMode = false;
    entry.pairingError = null;
  };

  return async function handleClose({ sock, statusCode, errorMessage = "", payload }) {
    entry.sock = null;
    // Serviço encerrando (SIGTERM): o fechamento do socket é nosso — não é queda, não grava estado, não agenda nada.
    if (isShuttingDown()) {
      controller.cancel("service_shutdown");
      return { action: "shutdown" };
    }
    // Sem socket (falha ao iniciar) não há como saber: não trata como "não pareada".
    const unpaired = Boolean(sock) && !isPairedCreds(sock?.authState?.creds);
    const decision = controller.onClose({ statusCode, unpaired, message: errorMessage });
    const message = String(errorMessage || "").slice(0, 300);

    if (decision.action === ACTION.LOGOUT) {
      // 401 = o WhatsApp desvinculou/encerrou o aparelho (logout, aparelho removido no celular):
      // definitivo. Credenciais não servem mais — apaga, NENHUMA reconexão, precisa de QR/código novo
      // por ação humana (status 'disconnected' + 'logged_out'; a automação só envia com 'connected').
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
      // Ninguém escaneou o QR a tempo (ou o pareamento foi interrompido): não é falha da conta e
      // NUNCA gera QR sozinho — só um humano pede QR novo.
      entry.status = "disconnected";
      resetPairingState();
      await notifyStatus(userId, { status: "disconnected", phoneNumber: null, qr: null, error: decision.reason === "qr_expired" ? "qr_expired" : "pairing_interrupted", statusCode, output: payload });
      await retireSocket(sock);
      return decision;
    }

    if (decision.action === ACTION.RESTART) {
      // 515: reinício normal que o WhatsApp pede logo depois de aceitar o QR/código. Sai do modo código
      // (senão connectSession tratava como "começar do zero" e apagava as credenciais recém-registradas),
      // não é falha (sem erro, sem 'reconnecting', sem alerta) e espera as credenciais serem gravadas.
      entry.status = "connecting";
      entry.pairingMode = false;
      entry.pairingCode = null;
      entry.pairingError = null;
      await notifyStatus(userId, { status: "connecting" });
      try {
        scheduleRetry({ delayMs: decision.delayMs, sock, trigger: "restart" });
      } catch (error) {
        log(`[${userId}] Falha ao agendar o reinício:`, error?.message || error);
      }
      return decision;
    }

    // RETRY: queda recuperável. Reconecta com os MESMOS creds já persistidos (nunca gera QR à toa).
    entry.status = "reconnecting";
    entry.pairingMode = false;
    entry.pairingCode = null;
    entry.pairingError = null;
    await notifyStatus(userId, { status: "reconnecting", error: message, statusCode, output: payload });
    try {
      scheduleRetry({ delayMs: decision.delayMs, sock, trigger: "auto" });
    } catch (error) {
      log(`[${userId}] Falha ao agendar a reconexão:`, error?.message || error);
    }
    return decision;
  };
}
