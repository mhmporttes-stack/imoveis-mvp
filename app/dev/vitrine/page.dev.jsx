import { notFound } from "next/navigation";
import VitrineClient from "./_components/VitrineClient";

// Vitrine de componentes — SOMENTE DESENVOLVIMENTO. O sufixo `.dev.jsx` só
// vira rota no `next dev` (ver next.config.mjs); o notFound() abaixo é a
// segunda trava caso o arquivo seja servido por engano em produção.
// Uso e procedimento de screenshot: .claude/skills/design-crm/references/revisao-visual.md
export const metadata = {
  title: "Vitrine (dev)",
  robots: { index: false, follow: false }
};

export default async function VitrinePage({ searchParams }) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = (await searchParams) || {};

  return (
    <VitrineClient
      tela={typeof params.tela === "string" ? params.tela : ""}
      perfil={typeof params.perfil === "string" ? params.perfil : "admin"}
      estado={typeof params.estado === "string" ? params.estado : "normal"}
      limpo={params.limpo === "1"}
      fonte={typeof params.fonte === "string" ? params.fonte : "atual"}
    />
  );
}
