# ACCESSIBILITY — parte do projeto, não revisão final

Transversal: carregar junto de qualquer interface, PDF digital ou imagem com texto. Meta: **WCAG 2.2 nível AA** (W3C), com HTML nativo.

## Princípios

1. **Nativo primeiro.** `<button>`, `<a>`, `<label>`, `<input>`, `<select>`, `<dialog>`, `<details>` antes de ARIA. `div onClick`, `role="button"` de remendo e `outline: none` sem substituto são proibidos.
2. **ARIA mínimo e justificado.** Só onde o nativo não cobre (`aria-expanded` em disclosure customizado, `aria-live` em resultado assíncrono, `aria-describedby` em ajuda/erro). `aria-label` onde já há texto visível duplica leitura.
3. **Operável = comunicável.** Estado, nome e propósito chegam à tecnologia assistiva, não só à tela.
4. **Teclado é a linha de base.** Toda ação por teclado; ordem do DOM = ordem lógica; sem `tabindex` positivo.

## Checklist de projeto (decida na especificação)

- **Semântica:** hierarquia de títulos sem pular nível; landmarks (`header/nav/main/aside/footer`); listas e tabelas reais (`th`, `scope`).
- **Nome acessível:** botão/link/campo com texto visível; só-ícone com `aria-label`; imagem informativa com `alt`, decorativa com `alt=""`.
- **Formulários:** rótulo ligado ao campo; obrigatório/opcional claros; erro diz o que houve, por quê e como corrigir, ligado ao campo (`aria-describedby`, `aria-invalid`); anunciar erro de envio com foco no primeiro erro.
- **Foco:** `:focus-visible` sempre aparente (contraste ≥ 3:1 com o fundo) e nunca coberto por sticky/barra; modal/gaveta: foco entra, fica preso, `Esc` fecha, foco volta ao disparador (`<dialog>` já faz).
- **Contraste:** texto 4,5:1 (3:1 grande); componentes/ícones/bordas de controle 3:1; estado não depende só de cor; placeholder também precisa de 4,5:1.
- **Alvo de toque:** ≥ 44×44px no projeto (mínimo WCAG 2.2 AA = 24×24 com espaçamento; usamos 44 por ser celular).
- **Texto:** redimensiona a 200% sem perder função; `rem`; sem texto em imagem (ou com alternativa); linhas ≤ ~75ch; justificar texto não.
- **Movimento:** `prefers-reduced-motion` respeitado; nada que pisque > 3×/s; pausar conteúdo que se move > 5 s (`MOTION.md`).
- **Tempo e mudança de contexto:** sem expirar sem aviso; sem mudar de tela ao focar; feedback `aria-live` polido para "salvo/erro", assertivo só para falha crítica.
- **Idioma e leitura:** `lang="pt-BR"`; linguagem simples; siglas explicadas na primeira vez.
- **Mobile:** orientação livre; gesto complexo sempre com alternativa de toque simples; zoom do usuário não bloqueado.
- **PDF digital (quando enviado ao cliente):** texto selecionável, ordem de leitura lógica, títulos reais, contraste, tamanho de fonte ≥ 10pt no impresso (≥ 9pt em nota), imagens com função clara; não depender só de cor em tabelas.

## Como verificar (além do olho)

Teclado (Tab/Shift+Tab/Enter/Space/Esc) · zoom 200% · 360px de largura · calcular contraste dos pares reais (razão = (L1+0,05)/(L2+0,05)) · ler com `read_page` (árvore de acessibilidade) no navegador do projeto · desligar CSS/animações. Registre achados com severidade (bloqueador = impede usar; corrigir; nota).
