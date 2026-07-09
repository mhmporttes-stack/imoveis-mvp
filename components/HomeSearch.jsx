"use client";

import { useState } from "react";
import { Search } from "lucide-react";

export default function HomeSearch() {
  const [term, setTerm] = useState("");

  function handleSubmit(event) {
    event.preventDefault();
    const target = document.getElementById("todos");
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.dispatchEvent(new CustomEvent("home-search", { detail: term }));
  }

  return (
    <form onSubmit={handleSubmit} className="mt-10 flex w-full max-w-2xl flex-col gap-3 rounded-2xl bg-white p-3 shadow-premium sm:flex-row">
      <label className="flex min-h-14 flex-1 items-center gap-3 rounded-full bg-mist px-5">
        <Search className="h-5 w-5 text-brand" />
        <input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          className="w-full bg-transparent font-semibold text-ink outline-none placeholder:text-muted"
          placeholder="Busque por bairro, cidade ou empreendimento"
        />
      </label>
      <button className="premium-button-primary" type="submit">
        Ver empreendimentos
      </button>
    </form>
  );
}
