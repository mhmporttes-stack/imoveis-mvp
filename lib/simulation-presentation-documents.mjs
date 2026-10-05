// Lista BASE de documentos mostrada na última cena da apresentação (e na imagem "lista de documentos").
//
// NÃO INVENTA EXIGÊNCIA: cada item é a redação para o cliente de uma exigência que o próprio CRM já cobra na análise
// documental. `source` aponta o arquivo e o trecho EXATO da regra de onde o item veio (um teste confere que o trecho
// ainda existe no arquivo — se a regra mudar, o teste avisa que a lista precisa ser revista pelo dono).
//   - requisito fixo do motor: lib/document-requirements-engine.js (função evaluatePerson);
//   - política editável (Base Mestra document_ai_rules): supabase/migrations/20260928094000_document_master_rules.sql.
// Decisão conservadora (documentada em docs/BUSINESS_RULES.md PRES-13): a página pública é só a lista BASE comum a
// todos. Ela NÃO é personalizada por dado do cliente (tipo de renda, estado civil, dependentes) — isso seria dado
// sensível numa página sem login. Variações por perfil aparecem como "conforme o seu tipo de renda / estado civil".

const ENGINE = "lib/document-requirements-engine.js";
const MASTER_RULES = "supabase/migrations/20260928094000_document_master_rules.sql";

export const DOCUMENTS_SCENE_TEXT = "Para validarmos esses valores junto à Caixa, vamos precisar montar a sua pasta. Para isso, preciso de alguns documentos.";
export const DOCUMENTS_EXTRA_NOTE = "Podem ser pedidos documentos adicionais conforme o seu perfil.";

export const PRESENTATION_DOCUMENT_GROUPS = [
  {
    id: "identificacao",
    title: "Identificação",
    items: [
      {
        id: "rg-cnh",
        text: "RG (com CPF) ou CNH. Um dos dois já é suficiente.",
        sources: [{ file: ENGINE, anchor: "Envie o RG (com CPF) ou a CNH" }, { file: ENGINE, anchor: "qualquer um dos dois já é suficiente" }]
      }
    ]
  },
  {
    id: "residencia",
    title: "Comprovante de residência",
    items: [
      {
        id: "comprovante-residencia",
        text: "Conta de água, energia elétrica, internet ou telefone, com nome e endereço legíveis.",
        sources: [
          { file: ENGINE, anchor: "(água, energia elétrica, internet ou telefone)" },
          { file: MASTER_RULES, anchor: "conta de água, energia elétrica, internet ou telefone com nome e endereço legíveis" }
        ]
      }
    ]
  },
  {
    id: "estado-civil",
    title: "Estado civil",
    items: [
      { id: "estado-civil-solteiro", text: "Solteiro(a): certidão de nascimento.", sources: [{ file: ENGINE, anchor: "envie a certidão de nascimento" }] },
      { id: "estado-civil-casado", text: "Casado(a) ou união estável: certidão de casamento.", sources: [{ file: ENGINE, anchor: "envie a certidão de casamento" }] },
      {
        id: "estado-civil-divorciado",
        text: "Divorciado(a): certidão de casamento com a averbação do divórcio.",
        sources: [{ file: ENGINE, anchor: "certidão de casamento com a averbação do divórcio" }]
      }
    ]
  },
  {
    id: "renda",
    title: "Comprovante de renda (conforme o seu tipo de renda)",
    items: [
      {
        id: "renda-clt-holerites",
        text: "Carteira assinada (CLT): os 2 últimos holerites (sem férias).",
        sources: [{ file: ENGINE, anchor: "envie os 2 últimos holerites (sem férias)" }]
      },
      {
        id: "renda-clt-ctps",
        text: "Carteira assinada (CLT): carteira de trabalho (CTPS), física ou digital.",
        sources: [{ file: ENGINE, anchor: "Carteira de trabalho (CTPS, física ou digital)" }]
      },
      {
        id: "renda-clt-fgts",
        text: "Carteira assinada (CLT): extrato do FGTS atualizado.",
        sources: [{ file: ENGINE, anchor: "Extrato do FGTS atualizado" }, { file: MASTER_RULES, anchor: "Exija extrato do FGTS atualizado" }]
      },
      {
        id: "renda-informal",
        text: "Autônomo ou renda informal: os 3 últimos extratos bancários ou as 3 últimas faturas de cartão de crédito.",
        sources: [{ file: ENGINE, anchor: "envie os 3 últimos extratos bancários OU as 3 últimas faturas de cartão de crédito" }]
      },
      {
        id: "renda-ir",
        text: "Imposto de Renda: declaração completa do ano vigente e recibo de entrega.",
        sources: [{ file: ENGINE, anchor: "envie a declaração completa do ano vigente e o recibo de entrega" }]
      }
    ]
  },
  {
    id: "pis",
    title: "PIS",
    items: [
      {
        id: "pis-numero",
        text: "Número do PIS. Pode constar em qualquer documento (CTPS, FGTS, Meu INSS, Caixa Tem etc.); não precisa ser um arquivo específico.",
        sources: [{ file: ENGINE, anchor: "pode vir de qualquer documento (CTPS, FGTS, Meu INSS, Caixa Tem etc.)" }]
      }
    ]
  }
];

/** Todos os itens, na ordem de exibição. */
export const PRESENTATION_DOCUMENT_ITEMS = PRESENTATION_DOCUMENT_GROUPS.flatMap((group) => group.items);

/** Textos que NÃO entram na lista por falta de regra confirmada (para o dono validar). Só documentação/relatório. */
export const PRESENTATION_DOCUMENTS_PENDING_OWNER_VALIDATION = [
  "Validade do comprovante de residência (mês atual ou anterior): hoje não é regra determinística (REGRAS-DOCUMENTAIS L-1).",
  "Comprovante de residência em nome de terceiro: depende do tipo de renda (Base Mestra residence_income_ownership).",
  "Aposentado, pensionista e outros tipos de renda: o motor de requisitos não define documentos para eles.",
  "Documentos do cônjuge, do segundo proponente e certidão de nascimento dos filhos menores: dependem do cadastro do cliente (cobertos só pela observação geral).",
  "Viúvo(a): o motor não define documento de estado civil.",
  "FGTS para quem não é CLT (REGRAS-DOCUMENTAIS L-7)."
];
