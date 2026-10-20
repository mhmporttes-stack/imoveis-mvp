"use client";

import { useEffect } from "react";

// Última tela de erro do site inteiro (erro no layout raiz, onde nenhuma outra tela de erro alcança). Substitui o
// layout raiz, então traz o próprio <html>/<body> e estilos embutidos (o CSS global pode não estar carregado).
// Mensagem simples, sem detalhe técnico para o usuário; o erro completo vai para o console do navegador.
const NAVY = "#0D3B66";

const buttonBase = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 44,
  padding: "0 18px",
  borderRadius: 12,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  textDecoration: "none",
  fontFamily: "inherit"
};

export default function GlobalError({ error, reset }) {
  useEffect(() => {
    console.error("Erro geral do site:", error);
  }, [error]);

  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "#F5F7FA", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", color: NAVY }}>
        <main style={{ width: "100%", maxWidth: 420, background: "#FFFFFF", border: "1px solid #E3E8EF", borderRadius: 24, padding: 32, textAlign: "center", boxShadow: "0 10px 30px rgba(13,59,102,0.08)" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/matheus-machado-symbol.png" alt="Matheus Machado Corretor de Imóveis" width={56} height={56} style={{ display: "block", margin: "0 auto", objectFit: "contain" }} />
          <h1 style={{ margin: "20px 0 0", fontSize: 24, fontWeight: 900 }}>Algo deu errado</h1>
          <p style={{ margin: "12px 0 0", fontSize: 14, fontWeight: 600, color: "#5B6B7F", lineHeight: 1.5 }}>
            Não foi possível carregar a página agora. Tente de novo; se continuar, volte ao início.
          </p>
          <div style={{ marginTop: 28, display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center" }}>
            <button type="button" onClick={() => reset()} style={{ ...buttonBase, border: "none", background: NAVY, color: "#FFFFFF" }}>
              Tentar de novo
            </button>
            {/* Link comum (não next/link): o roteador pode estar quebrado justamente por causa do erro. */}
            <a href="/" style={{ ...buttonBase, border: "1px solid rgba(13,59,102,0.15)", background: "#FFFFFF", color: NAVY }}>
              Voltar ao início
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
