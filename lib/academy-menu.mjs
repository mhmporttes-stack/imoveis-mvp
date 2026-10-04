// Item "Academia" do menu do CRM (puro, testável). Só entra com a chave ligada;
// desligada devolve os MESMOS grupos recebidos (nada muda no menu).
// `fullPage`: a Academia fica fora de /admin, então o link é navegação completa.
export const ACADEMY_MENU_GROUP = {
  key: "academia",
  label: "ACADEMIA",
  href: "/academia",
  items: [{ href: "/academia", label: "Academia", key: "academy", fullPage: true }]
};

export function withAcademyMenuGroup(groups, enabled = false) {
  if (!enabled) return groups;
  return [...groups, ACADEMY_MENU_GROUP];
}
