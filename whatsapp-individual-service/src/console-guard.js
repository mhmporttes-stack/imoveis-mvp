// Instala o filtro do console (log-sanitizer.js) assim que é importado. DEVE ser o PRIMEIRO import de server.js: os módulos
// de ESM avaliam na ordem dos imports, então o filtro já vale antes de o Baileys/libsignal e de qualquer sessão existirem.
import { installConsoleSanitizer } from "./log-sanitizer.js";

installConsoleSanitizer();
