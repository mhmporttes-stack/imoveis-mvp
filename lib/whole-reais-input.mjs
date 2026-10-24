// Puro (sem dependência) — máscara dos campos de valor em reais do formulário público de simulação (renda mensal, renda da
// 2ª pessoa, valor disponível). Testado em tests/whole-reais-input.test.mjs.
//
// [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-24] "Mesmo que o cliente não precise preencher o 00, deixe ali vírgula e 00 na
// frente." O cliente digita só REAIS inteiros e o campo mostra ",00" fixo depois do número: "7500" → "R$ 7.500,00".
// Antes a máscara preenchia pelos centavos ("3800" → "R$ 38,00"). O texto continua no mesmo formato de sempre
// ("R$ 7.500,00"), lido por parseCurrencyNumber → 7500 — o valor gravado não muda de forma.

function wholeReaisText(value) {
  return Number(value).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

// Recebe o texto do campo DEPOIS da edição do cliente (ex.: "R$ 7.5005,00", "R$ 7.50,00", "R$ 7.500,0") e devolve o texto
// formatado. Dígitos antes da vírgula = reais. Depois da vírgula: os "00" fixos; dígito a mais digitado ali entra nos reais;
// apagar um dos "00" (backspace no fim) apaga o último dígito dos reais.
export function formatWholeReaisInput(rawValue) {
  const text = String(rawValue ?? "");
  const commaIndex = text.lastIndexOf(",");
  let reais;

  if (commaIndex < 0) {
    reais = text.replace(/\D/g, "");
  } else {
    reais = text.slice(0, commaIndex).replace(/\D/g, "");
    const cents = text.slice(commaIndex + 1).replace(/\D/g, "");
    if (cents.length < 2) reais = reais.slice(0, -1);
    else if (cents.length > 2) reais += cents.replace("0", "").replace("0", "");
  }

  return wholeReaisText(Number(reais || "0"));
}

// Posição do cursor: logo antes da vírgula, para o próximo dígito entrar nos reais.
export function wholeReaisCaretPosition(formatted) {
  const index = String(formatted ?? "").lastIndexOf(",");
  return index < 0 ? String(formatted ?? "").length : index;
}
