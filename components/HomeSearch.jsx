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
    <form onSubmit={handleSubmit} className="mt-10 flex w-full max-w-[calc(100vw-40px)] flex-col gap-3 rounded-[28px] border border-white/20 bg-white/95 p-3 shadow-[0_24px_80px_rgba(0,0,0,0.22)] backdrop-blur-xl transition duration-300 focus-within:-translate-y-0.5 focus-within:border-blue-200 focus-within:shadow-[0_30px_95px_rgba(23,105,209,0.28)] sm:max-w-3xl sm:flex-row">
      <label className="flex min-h-16 flex-1 items-center gap-3 rounded-2xl bg-[#F4F8FC] px-5 ring-1 ring-transparent transition duration-300 focus-within:bg-white focus-within:ring-brand/20">
        <Search className="h-5 w-5 text-brand" />
        <input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          className="w-full bg-transparent font-semibold text-ink outline-none placeholder:text-muted"
          placeholder="Busque por região ou empreendimento"
        />
      </label>
      <button className="inline-flex min-h-16 items-center justify-center rounded-2xl bg-gradient-to-r from-[#0D3B66] via-[#1769D1] to-[#3B8CFF] px-8 text-base font-black text-white shadow-[0_18px_45px_rgba(23,105,209,0.34)] transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_24px_70px_rgba(23,105,209,0.46)]" type="submit">
        Ver imóveis
      </button>
    </form>
  );
}
