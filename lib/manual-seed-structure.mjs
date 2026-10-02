// Manual do CRM — ESTRUTURA inicial (tópicos/subtópicos), derivada do conteúdo
// em manual-seed-content.mjs (fonte única de slugs, títulos, textos e audiências).
// Tudo entra como "pending" (o dono aprova). Slugs são âncoras estáveis: nunca
// renomeie depois de publicar.
import { MANUAL_SEED_TOPICS, MANUAL_SEED_CONTENT } from "./manual-seed-content.mjs";

export const MANUAL_SEED_STRUCTURE = Object.freeze(
  MANUAL_SEED_TOPICS.map((topic) => Object.freeze({
    ...topic,
    audiences: ["all"],
    sections: MANUAL_SEED_CONTENT.filter((item) => item.topic === topic.slug).map(({ section, title, audiences, body }) => ({
      slug: section, title, audiences, body
    }))
  }))
);
