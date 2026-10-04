"use client";

// Vitrine DEV da Academia (só existe no `next dev`; arquivos *.dev.jsx não entram no build).
// Renderiza o MESMO AcademiaApp, sem login e sem a chave ACADEMIA_ENABLED.
// QA: ?ate=N conclui N aulas antes de montar (ex.: ate=17 leva ao último andar); ?rm=1 liga movimento reduzido.
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import AcademiaApp from "@/components/academia/AcademiaApp";
import { createAcademyDemoStore } from "@/lib/academy-sample-store.mjs";

function Demo() {
  const q = useSearchParams();
  const [store] = useState(() => {
    const st = createAcademyDemoStore();
    const ate = Number(q.get("ate"));
    if (ate > 9) {
      const lessons = st.getSnapshot().trail.modules.flatMap((m) => m.lessons);
      for (let i = 9; i < Math.min(ate, lessons.length); i++) st.completeLesson(lessons[i].id);
    }
    if (q.get("rm") === "1") st.setReducedMotion(true);
    return st;
  });
  return <AcademiaApp store={store} backHref="/dev/vitrine" />;
}

export default function AcademiaVitrine() {
  return <Suspense fallback={null}><Demo /></Suspense>;
}
