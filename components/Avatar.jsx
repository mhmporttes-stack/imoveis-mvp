// Avatar circular reutilizável: foto (object-fit: cover) quando existir, ou
// iniciais do nome como fallback — usado no cadastro de corretores e no
// painel gerencial da Meta Diária, e disponível para qualquer outra tela.
export default function Avatar({ name = "", photoUrl = "", size = 48, className = "" }) {
  const initials = getInitials(name);
  const style = { width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.36)) };

  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={name || "Foto de perfil"}
        style={style}
        className={`shrink-0 rounded-full border border-line object-cover ${className}`}
      />
    );
  }

  return (
    <div
      style={style}
      className={`grid shrink-0 place-items-center rounded-full border border-line bg-mist font-black text-navy ${className}`}
      aria-hidden="true"
    >
      {initials}
    </div>
  );
}

function getInitials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = parts[0][0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] || "" : "";
  return (first + last).toUpperCase();
}
