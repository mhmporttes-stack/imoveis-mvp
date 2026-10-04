#!/usr/bin/env node
// Lint local de HTML de e-mail (sem dependências, sem rede, não envia nada).
// Uso: node .claude/skills/criar-email/tools/lint-email.mjs <arquivo.html>
import fs from "node:fs";

export function lintEmail(html) {
  const errors = [];
  const warns = [];
  const bytes = Buffer.byteLength(html, "utf8");
  if (bytes > 102 * 1024) errors.push(`HTML com ${(bytes / 1024).toFixed(0)} KB (> 102 KB: Gmail corta a mensagem)`);
  else if (bytes > 85 * 1024) warns.push(`HTML com ${(bytes / 1024).toFixed(0)} KB (perto do corte de 102 KB do Gmail)`);
  if (!/<!doctype html/i.test(html)) errors.push("falta <!DOCTYPE html>");
  if (!/<html[^>]*\blang=/i.test(html)) errors.push('falta lang no <html> (use lang="pt-BR")');
  if (!/<meta[^>]+name=["']viewport["']/i.test(html)) errors.push("falta meta viewport");
  if (!/<title>[^<]+<\/title>/i.test(html)) warns.push("falta <title>");
  for (const tag of ["script", "form", "iframe", "video", "audio", "object", "embed"]) {
    if (new RegExp(`<${tag}[\\s>]`, "i").test(html)) errors.push(`tag <${tag}> não é suportada/segura em e-mail`);
  }
  if (/display\s*:\s*(flex|grid)|position\s*:\s*(absolute|fixed)/i.test(html)) errors.push("CSS flex/grid/position (quebra no Outlook desktop)");
  if (/<img\b(?![^>]*\balt=)[^>]*>/i.test(html)) errors.push("<img> sem atributo alt");
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    if (!/\bwidth=/i.test(m[0])) warns.push("<img> sem width declarado");
    const src = (m[0].match(/\bsrc=["']([^"']+)["']/i) || [])[1] || "";
    if (src && !/^https:\/\//i.test(src) && !src.startsWith("{{")) errors.push(`imagem sem URL https absoluta: ${src.slice(0, 60)}`);
  }
  if (!/role=["']presentation["']/i.test(html) && /<table/i.test(html)) warns.push('tabelas de layout sem role="presentation"');
  const hrefs = [...html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["']/gi)].map((m) => m[1]);
  if (!hrefs.some((h) => /unsubscribe_url|descadastr|unsubscribe/i.test(h))) errors.push("sem link de descadastro ({{unsubscribe_url}})");
  if (!/CRECI/i.test(html)) errors.push("rodapé sem identificação CRECI");
  for (const h of hrefs) {
    if (h.startsWith("{{") || h.startsWith("mailto:") || h.startsWith("#")) continue;
    if (!/^https:\/\//i.test(h)) errors.push(`link não-https: ${h.slice(0, 60)}`);
    if (/\b(bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly)\//i.test(h)) errors.push(`encurtador de terceiros: ${h.slice(0, 60)}`);
    if (/matheusmachadoimoveis\.com\.br/i.test(h) && !/utm_source=email/.test(h)) warns.push(`link do site sem utm_source=email: ${h.slice(0, 70)}`);
    if (/utm_medium=(paid|anuncio|cpc|ppc)/i.test(h)) errors.push("utm_medium de mídia paga em e-mail (classifica o lead como pago)");
  }
  if (hrefs.length === 0) errors.push("nenhum link/CTA");
  if (!/display\s*:\s*none[^"']*max-height\s*:\s*0|max-height\s*:\s*0[^"']*display\s*:\s*none/i.test(html)) warns.push("sem preheader oculto no início do body");
  if (/\b(aprovação garantida|100% aprovado|sem consulta|nome sujo|últimas unidades|grátis!!)/i.test(html)) errors.push("termo proibido pela conformidade (aprovação garantida/urgência falsa)");
  if (/\{\{[^}|]+\}\}/.test(html.replace(/\{\{(unsubscribe_url|view_in_browser_url|utm)\}\}/g, ""))) warns.push("merge tag sem fallback (use {{campo|fallback}})");
  return { bytes, errors, warns };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  if (!file) { console.error("uso: lint-email.mjs <arquivo.html>"); process.exit(2); }
  const r = lintEmail(fs.readFileSync(file, "utf8"));
  console.log(`${file}: ${(r.bytes / 1024).toFixed(1)} KB`);
  r.errors.forEach((e) => console.log(`ERRO  ${e}`));
  r.warns.forEach((w) => console.log(`AVISO ${w}`));
  if (!r.errors.length) console.log(r.warns.length ? "OK com avisos" : "OK");
  process.exit(r.errors.length ? 1 : 0);
}
