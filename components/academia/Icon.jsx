// Ícones da Academia (traço 2, cantos redondos). Decorativos: aria-hidden; o nome vem do texto/aria-label do botão.
import s from "./academia.module.css";

const P = {
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></>,
  back: <path d="M15 5l-7 7 7 7" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  up: <path d="M6 14l6-6 6 6" />,
  down: <path d="M6 9l6 6 6-6" />,
  home: <><path d="M4 11l8-7 8 7v9H4z" /><path d="M10 20v-6h4v6" /></>,
  route: <><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="6" r="2.5" /><path d="M8.5 18H15a3 3 0 000-6H9a3 3 0 010-6h6.5" /></>,
  grow: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  motion: <><path d="M4 8h9M17 8h3M4 16h3M11 16h9" /><circle cx="15" cy="8" r="2" /><circle cx="9" cy="16" r="2" /></>,
  play: <path d="M8 5l11 7-11 7z" fill="currentColor" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  award: <><circle cx="12" cy="9" r="5" /><path d="M8.5 13.5L7 21l5-3 5 3-1.5-7.5" /></>,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  crm: <><path d="M10 6H6a2 2 0 00-2 2v8a2 2 0 002 2h4" /><path d="M20 12H10M14 8l-4 4 4 4" /></>
};

export default function Icon({ name, size, className = "", style }) {
  return (
    <svg className={`${s.ico} ${className}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false" style={size ? { width: size, height: size, ...style } : style}>
      {P[name]}
    </svg>
  );
}
