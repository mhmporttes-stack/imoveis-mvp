// Concordância de gênero e tratamento das mensagens automáticas do WhatsApp
// com quem atende. Duas informações do cadastro (admin_users):
//   gender    "male" | "female" | vazio — sem gênero cai em "(a)", nunca assume masculino
//   has_creci  true  => tratado como corretor(a)
//              false => SEMPRE "associado(a) do corretor Matheus Machado"
export const GENDER_OPTIONS = [
  { value: "male", label: "Masculino" },
  { value: "female", label: "Feminino" }
];

export const OWNER_BROKER_NAME = "Matheus Machado";

export function normalizeGender(value) {
  const gender = String(value || "").trim().toLowerCase();
  return gender === "male" || gender === "female" ? gender : "";
}

function titleFor(hasCreci, gender) {
  const suffix = hasCreci ? "" : ` do corretor ${OWNER_BROKER_NAME}`;
  const [male, female, neutral] = hasCreci ? ["corretor", "corretora", "corretor(a)"] : ["associado", "associada", "associado(a)"];
  if (gender === "female") return `${female}${suffix}`;
  if (gender === "male") return `${male}${suffix}`;
  return `${neutral}${suffix}`;
}

export function buildBrokerGenderVars(profile) {
  const gender = normalizeGender(profile?.gender);
  const cargo = titleFor(profile?.hasCreci === true, gender);

  if (gender === "female") return { cargo_corretor: cargo, nosso_cargo: `nossa ${cargo}`, o_a: "a", ele_ela: "ela" };
  if (gender === "male") return { cargo_corretor: cargo, nosso_cargo: `nosso ${cargo}`, o_a: "o", ele_ela: "ele" };
  return { cargo_corretor: cargo, nosso_cargo: `nosso(a) ${cargo}`, o_a: "o(a)", ele_ela: "ele(a)" };
}
