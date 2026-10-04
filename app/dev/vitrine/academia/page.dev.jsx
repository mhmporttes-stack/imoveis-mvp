"use client";

// Vitrine DEV da Academia (só existe no `next dev`; arquivos *.dev.jsx não entram no build).
// Renderiza o MESMO AcademiaApp, sem login e sem a chave ACADEMIA_ENABLED.
// QA: ?ate=N conclui N aulas antes de montar (ex.: ate=17 leva ao último andar); ?rm=1 liga movimento reduzido.
// ?real=1 monta o store REAL da F2 (lib/academy-remote-store.mjs) com um payload montado dos dados de exemplo; as chamadas
// à API ficam por conta de quem testa (ex.: Playwright com page.route). ?ro=1 = somente leitura ("Alterar conta"); ?max=3 = limite de 3 tentativas em todas as provas.
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import AcademiaApp from "@/components/academia/AcademiaApp";
import { createAcademyDemoStore } from "@/lib/academy-sample-store.mjs";
import { createAcademyRemoteStore } from "@/lib/academy-remote-store.mjs";
import { SAMPLE_QUESTIONS, buildInitialCoreState } from "@/lib/academy-sample.mjs";
import { publicQuestion } from "@/lib/academy-core.mjs";

function realInitial(readOnly, max) {
  const core = buildInitialCoreState();
  const questions = {};
  const exams = {};
  for (const l of core.lessons) {
    questions[l.id] = publicQuestion(SAMPLE_QUESTIONS[l.id]);
    const final = l.kind === "final_exam";
    exams[l.id] = { examId: `ex-${l.id}`, kind: final ? "final" : "quiz", passScore: 70, maxAttempts: final || max ? 3 : null, attemptsUsed: 0, exhausted: false, passed: false };
  }
  return { status: "ok", readOnly, holderName: "Aluno real", core, questions, exams };
}

function Demo() {
  const q = useSearchParams();
  const [store] = useState(() => {
    if (q.get("real") === "1") return createAcademyRemoteStore({ initial: realInitial(q.get("ro") === "1", q.get("max") === "3") });
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
