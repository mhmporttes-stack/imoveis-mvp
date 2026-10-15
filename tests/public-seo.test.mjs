// SEO do site público e mensagens prontas da ficha (dono, 2026-10-15).
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";

// lib/*.js usa import sem extensão e "@/lib/..." (padrão do Next): o hook resolve para Node puro.
register("data:text/javascript," + encodeURIComponent(`
  import { existsSync } from "node:fs";
  import { fileURLToPath, pathToFileURL } from "node:url";
  const ROOT = ${JSON.stringify(new URL("..", import.meta.url).href)};
  export async function resolve(specifier, context, next) {
    if (specifier.startsWith("@/")) specifier = new URL(specifier.slice(2), ROOT).href;
    if ((specifier.startsWith(".") || specifier.startsWith("file:")) && !/\\.[cm]?js$/.test(specifier)) {
      const url = new URL(specifier, context.parentURL);
      if (existsSync(fileURLToPath(url) + ".js")) return next(url.href + ".js", context);
    }
    return next(specifier, context);
  }
`));

const { propertyWhatsappMessage, propertyNeighborhood, whatsappLink } = await import("../lib/format.js");
const seo = await import("../lib/public-seo.js");
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("mensagem pronta: tipo + quartos + bairro + código, sem inventar dado", () => {
  const casa = { type: "casa", bedrooms: "3", location: "Av. José da Silva, 610 - Jardim X - Marília", code: "4353", name: "Casa" };
  assert.equal(propertyWhatsappMessage(casa, "visit"), "Olá! Quero agendar uma visita na casa de 3 quartos no Jardim X (COD4353).");
  assert.equal(propertyWhatsappMessage(casa, "catalog"), "Olá! Quero receber o catálogo da casa de 3 quartos no Jardim X (COD4353).");
  assert.equal(propertyWhatsappMessage(casa, "price"), "Olá! Quero saber o valor da casa de 3 quartos no Jardim X (COD4353).");
  assert.equal(propertyWhatsappMessage({ type: "apartamento", region: "oeste", name: "Residencial Madri", bedrooms: "2" }), "Olá! Quero saber mais sobre o apartamento de 2 quartos na região Oeste (Residencial Madri).");
  assert.equal(propertyWhatsappMessage({ type: "terreno", bedrooms: "", name: "Terreno" }, "visit"), "Olá! Quero agendar uma visita no terreno.");
  assert.equal(propertyWhatsappMessage({ type: "chacara", bedrooms: "1", location: "Vila Real" }, "visit"), "Olá! Quero agendar uma visita na chácara de 1 quarto na Vila Real.");
  // número continua o oficial
  assert.match(whatsappLink({ type: "casa", name: "Casa" }), /^https:\/\/wa\.me\/5514991056706\?text=/);
});

test("bairro do campo Localização ignora rua, número, cidade e CEP", () => {
  assert.equal(propertyNeighborhood("R. Benedita Maria de Carvalho, 205 - Osvaldo Fanceli, Marília - SP, 17512-729"), "Osvaldo Fanceli");
  assert.equal(propertyNeighborhood("Cavalari · Marília/SP"), "Cavalari");
  assert.equal(propertyNeighborhood("Marilia, Centro"), "Centro");
  assert.equal(propertyNeighborhood("R. Arcídio Stroppa, 150"), "");
  assert.equal(propertyNeighborhood("Marília"), "");
});

test("metadados da ficha: título, descrição sem preço oculto, foto e canônica", () => {
  const property = { id: "abc", type: "casa", bedrooms: "3", location: "Terra verde", name: "Casa", hidePrice: true, price: "",
    salesText: "Casa linda com quintal. Valor de R$ 250.000 à vista.", photos: [{ data: "https://x.supabase.co/a.jpg" }] };
  const meta = seo.propertyMetadata(property);
  assert.equal(meta.title, "Casa de 3 quartos no Terra verde, Marília | Matheus Machado");
  assert.equal(meta.description, "Casa linda com quintal.");
  assert.equal(meta.alternates.canonical, "https://www.matheusmachadoimoveis.com.br/empreendimentos/abc");
  assert.equal(meta.openGraph.images[0].url, "https://x.supabase.co/a.jpg");
  assert.equal(seo.propertySeoTitle({ type: "apartamento", name: "California Residence", bedrooms: "2", region: "oeste" }), "California Residence · Apartamento de 2 quartos na região Oeste, Marília | Matheus Machado");
  // foto em base64 não vai para o compartilhamento
  assert.match(seo.propertyMetadata({ id: "b", type: "casa", photos: [{ data: "data:image/png;base64,AAA" }] }).openGraph.images[0].url, /og-matheus-machado-v2/);
  assert.ok(seo.propertySeoDescription({ type: "casa", salesText: "a ".repeat(200) }).length <= 160);
});

test("JSON-LD: imobiliária com CRECI/endereço/número oficial; oferta só com preço visível", () => {
  const agent = seo.realEstateAgentJsonLd();
  assert.equal(agent["@type"], "RealEstateAgent");
  assert.equal(agent.telephone, "+5514991056706");
  assert.equal(agent.identifier.value, "323106-F");
  assert.equal(agent.address.streetAddress, "Av. Ipiranga, 147");
  assert.ok(!("aggregateRating" in agent) && !("review" in agent));
  const withPrice = seo.propertyJsonLd({ id: "a", type: "apartamento", bedrooms: "2", area: "52", price: "R$ 389.000" });
  assert.equal(withPrice.offers.priceSpecification.minPrice, 389000);
  assert.equal(withPrice.about.numberOfRooms, 2);
  assert.equal(seo.propertyJsonLd({ id: "a", type: "casa", price: "R$ 389.000", hidePrice: true }).offers, undefined);
  assert.equal(seo.propertyJsonLd({ id: "a", type: "casa", price: "R$ 250 mil" }).offers, undefined);
  assert.ok(!seo.jsonLdHtml({ a: "</script>" }).includes("</script>"));
});

test("robots e sitemap: painel/APIs fora; só páginas públicas de venda", async () => {
  const { default: robots } = await import("../app/robots.js");
  const rules = robots();
  assert.deepEqual(rules.rules[0].disallow, ["/admin", "/api"]);
  assert.equal(rules.sitemap, "https://www.matheusmachadoimoveis.com.br/sitemap.xml");
  // Sem banco (teste): listPublicProperties devolve os 3 imóveis de exemplo, que NÃO entram no sitemap.
  const { default: sitemap } = await import("../app/sitemap.js");
  const urls = (await sitemap()).map((item) => item.url.replace("https://www.matheusmachadoimoveis.com.br", ""));
  assert.deepEqual(urls, ["", "/simulacao", "/venda-seu-imovel"]);
  assert.match(read("app/sitemap.js"), /listPublicProperties/);
  assert.match(read("app/venda-seu-imovel/page.jsx"), /canonical: "\/venda-seu-imovel"/);
  assert.match(read("app/empreendimentos/[id]/page.jsx"), /export async function generateMetadata/);
});
