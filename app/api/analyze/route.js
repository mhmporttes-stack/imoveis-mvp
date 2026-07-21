import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const payload = await request.json();
    const text = payload.sourceType === "url" ? await loadWebsiteText(payload.url) : String(payload.text || "");
    const draft = process.env.OPENAI_API_KEY
      ? await interpretWithOpenAI({ ...payload, text })
      : inferFieldsFromText(text, payload);
    return NextResponse.json(draft);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Não foi possível analisar a fonte informada." }, { status: 400 });
  }
}

async function loadWebsiteText(url) {
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error("URL inválida.");
  }
  const response = await fetch(url, { headers: { "User-Agent": "MatheusMachadoImoveis/2.0" } });
  if (!response.ok) throw new Error(`Site retornou ${response.status}`);
  const html = await response.text();
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60000);
}

async function interpretWithOpenAI(source) {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      name: { type: "string" },
      builder: { type: "string" },
      location: { type: "string" },
      type: { type: "string", enum: ["casa", "apartamento", "loteamento", "condominio"] },
      price: { type: "string" },
      terms: { type: "string" },
      discounts: { type: "string" },
      installmentEntry: { type: "string" },
      delivery: { type: "string" },
      area: { type: "string" },
      bedrooms: { type: "string" },
      builderUrl: { type: "string" },
      internalNotes: { type: "string" },
      salesText: { type: "string" }
    },
    required: ["name", "builder", "location", "type", "price", "terms", "discounts", "installmentEntry", "delivery", "area", "bedrooms", "builderUrl", "internalNotes", "salesText"]
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: "Interprete materiais de empreendimentos imobiliários no Brasil. Extraia apenas dados sustentados pelo conteúdo. Quando não houver dado, retorne string vazia."
        },
        {
          role: "user",
          content: `Fonte: ${source.sourceType || ""}\nURL: ${source.url || ""}\nArquivo: ${source.fileName || ""}\n\nConteúdo:\n${source.text.slice(0, 55000)}`
        }
      ],
      text: { format: { type: "json_schema", name: "empreendimento", schema } }
    })
  });

  if (!response.ok) throw new Error(await response.text());
  const result = await response.json();
  return normalizeDraft(JSON.parse(result.output_text || "{}"), source);
}

function inferFieldsFromText(text, source = {}) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  const lower = clean.toLowerCase();
  return normalizeDraft({
    name: pickAfter(clean, ["empreendimento", "residencial", "condominio"]) || clean.slice(0, 70),
    builder: pickAfter(clean, ["construtora", "incorporadora"]),
    location: pickAfter(clean, ["localizacao", "bairro", "cidade", "endereco"]),
    type: ["apartamento", "casa", "loteamento", "condominio"].find((item) => lower.includes(item)) || "apartamento",
    price: clean.match(/R\$\s?[\d.,]+/i)?.[0] || "",
    delivery: pickAfter(clean, ["entrega", "prazo de entrega"]),
    area: clean.match(/(\d{2,3}\s?(a|-)\s?\d{2,3}\s?m²|\d{2,3}\s?m²|\d{2,3}\s?m2)/i)?.[0] || "",
    bedrooms: clean.match(/(\d\s?(e|ou|-)\s?\d\s?quartos|\d\s?quartos?)/i)?.[0] || "",
    installmentEntry: pickAfter(clean, ["entrada", "ato"]),
    terms: sentenceWith(clean, ["financiamento", "fgts", "parcelas", "condições"]),
    discounts: sentenceWith(clean, ["subsídio", "subsidio", "desconto", "minha casa minha vida"]),
    builderUrl: source.url || "",
    internalNotes: "Rascunho gerado automaticamente. Revisar antes de publicar.",
    salesText: clean.slice(0, 420)
  }, source);
}

function normalizeDraft(draft, source = {}) {
  const fields = ["name", "builder", "location", "type", "price", "terms", "discounts", "installmentEntry", "delivery", "area", "bedrooms", "builderUrl", "internalNotes", "salesText"];
  const result = Object.fromEntries(fields.map((field) => [field, typeof draft?.[field] === "string" ? draft[field].trim() : ""]));
  if (!["casa", "apartamento", "loteamento", "condominio"].includes(result.type)) result.type = "apartamento";
  if (!result.builderUrl && source.url) result.builderUrl = source.url;
  return result;
}

function pickAfter(text, labels) {
  for (const label of labels) {
    const found = text.match(new RegExp(`${label}\\s*:?\\s*([^\\.\\n\\|]{3,90})`, "i"))?.[1]?.trim();
    if (found) return found;
  }
  return "";
}

function sentenceWith(text, words) {
  return text.split(/(?<=[.!?])\s+/).find((sentence) => words.some((word) => sentence.toLowerCase().includes(word))) || "";
}
