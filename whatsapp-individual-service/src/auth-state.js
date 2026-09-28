import { initAuthCreds, BufferJSON, proto } from "@whiskeysockets/baileys";
import { encrypt, decrypt } from "./crypto.js";
import { readEncryptedCreds, writeEncryptedCreds } from "./db.js";

// Auth-state adapter do Baileys que persiste no Supabase em vez de disco
// (useMultiFileAuthState não serve: Railway/Fly têm disco EFÊMERO — o
// container reinicia sem os arquivos e o corretor teria que escanear o QR de
// novo toda hora). Guarda TUDO (creds + chaves de sessão do Signal) num
// único blob JSON, cifrado (AES-256-GCM) antes de gravar em
// whatsapp_individual_sessions.session_creds_encrypted.
export async function useSupabaseAuthState(userId) {
  let creds;
  let keys = {};

  const stored = await readEncryptedCreds(userId);
  if (stored) {
    try {
      const parsed = JSON.parse(decrypt(stored), BufferJSON.reviver);
      creds = parsed.creds || initAuthCreds();
      keys = parsed.keys || {};
    } catch (error) {
      console.error(`[${userId}] Falha ao decifrar as credenciais salvas — iniciando sessão nova (será necessário escanear o QR):`, error.message);
      creds = initAuthCreds();
      keys = {};
    }
  } else {
    creds = initAuthCreds();
  }

  const persist = async () => {
    const payload = JSON.stringify({ creds, keys }, BufferJSON.replacer);
    await writeEncryptedCreds(userId, encrypt(payload));
  };

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const result = {};
          for (const id of ids) {
            let value = keys[type]?.[id];
            if (value && type === "app-state-sync-key") {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            if (value !== undefined && value !== null) result[id] = value;
          }
          return result;
        },
        set: async (data) => {
          for (const type of Object.keys(data)) {
            keys[type] = keys[type] || {};
            for (const id of Object.keys(data[type])) {
              const value = data[type][id];
              if (value) keys[type][id] = value;
              else delete keys[type][id];
            }
          }
          await persist();
        }
      }
    },
    saveCreds: persist
  };
}
