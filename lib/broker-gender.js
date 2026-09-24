// Concordância de gênero das mensagens automáticas do WhatsApp com quem
// atende (admin_users.gender: "male" | "female" | vazio). Sem gênero
// informado, cai em "(a)" — nunca assume masculino.
export const GENDER_OPTIONS = [
  { value: "male", label: "Masculino" },
  { value: "female", label: "Feminino" }
];

export function normalizeGender(value) {
  const gender = String(value || "").trim().toLowerCase();
  return gender === "male" || gender === "female" ? gender : "";
}

const ROLE_TITLES = {
  associate: { male: "associado", female: "associada" },
  manager: { male: "gestor", female: "gestora" },
  broker: { male: "corretor", female: "corretora" },
  admin: { male: "corretor", female: "corretora" }
};

export function buildBrokerGenderVars(profile) {
  const gender = normalizeGender(profile?.gender);
  const titles = ROLE_TITLES[profile?.role] || ROLE_TITLES.broker;

  if (gender === "female") {
    return { cargo_corretor: titles.female, nosso_cargo: `nossa ${titles.female}`, o_a: "a", ele_ela: "ela" };
  }
  if (gender === "male") {
    return { cargo_corretor: titles.male, nosso_cargo: `nosso ${titles.male}`, o_a: "o", ele_ela: "ele" };
  }
  return { cargo_corretor: `${titles.male}(a)`, nosso_cargo: `nosso(a) ${titles.male}(a)`, o_a: "o(a)", ele_ela: "ele(a)" };
}
