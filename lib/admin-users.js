const ADMIN_DISPLAY_NAMES = {
  "mhmporttes@gmail.com": "Matheus",
  "forbencke@gmail.com": "Benck"
};

export function getAdminDisplayName(email = "") {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return "";
  return ADMIN_DISPLAY_NAMES[normalizedEmail] || normalizedEmail.split("@")[0] || "";
}
