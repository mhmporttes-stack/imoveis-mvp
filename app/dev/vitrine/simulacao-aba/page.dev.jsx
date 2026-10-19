import Client from "./Client.dev-client";
// TEMPORÁRIO (análise de design 2026-10-19, apagar ao terminar). Só `next dev`; dados FICTÍCIOS.
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }) {
  const p = await searchParams;
  return <Client auto={p?.auto !== "nao"} />;
}
