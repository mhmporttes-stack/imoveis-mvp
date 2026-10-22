import { ADMIN_FONT_CSS } from "@/components/admin-font";

// Telas de entrada do painel (velocidade, etapa 3, dono 2026-10-22): /admin/login (com a verificação em duas etapas) e
// /admin/reset-password moram aqui, fora de app/admin/layout.jsx, para não baixarem o JS do painel inteiro (menu,
// cabeçalho, barra, cenas, avisos) antes de qualquer login. O endereço continua /admin/...: o proxy.js reescreve
// /admin/login e /admin/reset-password para cá, e /painel-acesso/... digitado direto volta para /admin/....
// Com a sessão inválida o layout do painel não mostrava nada além da página — o visual dessas telas é o mesmo.
export default function PainelAcessoLayout({ children }) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: ADMIN_FONT_CSS }} />
      {children}
    </>
  );
}
