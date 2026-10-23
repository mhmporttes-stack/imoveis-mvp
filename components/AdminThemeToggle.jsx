"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { cx } from "@/components/ui/cx";
import { ADMIN_THEME_EVENT, readStoredAdminTheme, setAdminTheme } from "@/components/admin-theme";

// Alterna entre o modo claro (padrão, o painel de sempre) e o modo escuro — pedido do dono, 2026-10-16.
// O rótulo diz para onde o toque leva: no claro mostra a Lua e "Modo escuro"; no escuro, o Sol e "Modo claro".
// Preferência por aparelho (components/admin-theme.js).
export function useAdminTheme() {
  const [theme, setTheme] = useState("light");
  useEffect(() => {
    setTheme(readStoredAdminTheme());
    const onChange = (event) => setTheme(event.detail === "dark" ? "dark" : "light");
    window.addEventListener(ADMIN_THEME_EVENT, onChange);
    return () => window.removeEventListener(ADMIN_THEME_EVENT, onChange);
  }, []);
  return [theme, () => setAdminTheme(theme === "dark" ? "light" : "dark")];
}

// variant "row": linha inteira no menu "Mais" do celular. variant "pill": botão do menu do computador
// (só o ícone até xl, ícone + rótulo a partir dele).
export default function AdminThemeToggle({ variant = "row", className = "" }) {
  const [theme, toggle] = useAdminTheme();
  const dark = theme === "dark";
  const Icon = dark ? Sun : Moon;
  const label = dark ? "Modo claro" : "Modo escuro";
  const hint = dark ? "Voltar às telas com fundo branco" : "Telas com fundo escuro";

  // Visual novo (dono, 2026-10-22): "icon" = só o sol/lua no cabeçalho; "button" = botão "Aparência" da folha "Mais".
  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label={dark ? "Ativar modo claro" : "Ativar modo escuro"}
        title={label}
        className={cx(
          "inline-flex h-touch w-touch shrink-0 items-center justify-center rounded-control border border-line bg-white text-ink transition-colors hover:border-accent-line hover:bg-accent-soft",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          className
        )}
      >
        <Icon className="h-5 w-5" strokeWidth={1.9} aria-hidden="true" />
      </button>
    );
  }

  if (variant === "button") {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label={dark ? "Aparência: ativar modo claro" : "Aparência: ativar modo escuro"}
        className={cx(
          "inline-flex min-h-touch items-center justify-center gap-2 rounded-control border border-line bg-white px-4 text-sm font-bold text-ink transition-colors hover:border-accent-line hover:bg-accent-soft",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          className
        )}
      >
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.9} aria-hidden="true" />
        Aparência · {label}
      </button>
    );
  }

  if (variant === "pill") {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label={dark ? "Ativar modo claro" : "Ativar modo escuro"}
        title={label}
        className={cx(
          "inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-full border border-navy/15 bg-white px-3 text-sm font-extrabold text-navy transition duration-300 hover:-translate-y-0.5 hover:border-brand hover:shadow-soft",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
          className
        )}
      >
        <Icon className="h-[18px] w-[18px] text-brand" strokeWidth={2} aria-hidden="true" />
        <span className="hidden xl:inline">{label}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Ativar modo claro" : "Ativar modo escuro"}
      className={cx(
        "flex min-h-touch w-full items-center gap-2.5 rounded-control border border-navy/[0.06] bg-mist/70 px-2.5 py-2 text-left transition-[background-color,transform] duration-150 ease-out-ui active:scale-[0.98] hover:bg-info-soft/60 motion-reduce:transition-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
        className
      )}
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-white text-brand ring-1 ring-navy/[0.06]">
        <Icon className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold leading-tight text-ink">{label}</span>
        <span className="block text-2xs font-medium tracking-normal text-muted">{hint}</span>
      </span>
    </button>
  );
}
