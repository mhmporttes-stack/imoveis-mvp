"use client";

// Academia (F1, DADOS DE EXEMPLO em memória): uma câmera única; Início, Trilha e Evolução são três
// enquadramentos do mesmo mundo, e Aula, Questão, Conquista e Certificação são momentos dela.
// Sem rede: o store de exemplo (lib/academy-sample-store.mjs) vive na memória da página; a F2 troca a fonte.
// O motor de cena (camadas) entra por next/dynamic sem SSR; o servidor entrega shell, textos e fundo estático.
import dynamic from "next/dynamic";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createAcademyDemoStore } from "@/lib/academy-sample-store.mjs";
import { createAcademyRemoteStore } from "@/lib/academy-remote-store.mjs";
import { usePrefersReducedMotion } from "@/components/motion/usePrefersReducedMotion";
import s from "./academia.module.css";
import { createEngine } from "./scene/engine";
import AcademiaShell from "./AcademiaShell";
import AcademiaHeader from "./AcademiaHeader";
import FloatingNav from "./FloatingNav";
import HomeView from "./HomeView";
import TrailView from "./TrailView";
import EvolutionView from "./EvolutionView";
import LessonScreen from "./LessonScreen";
import QuestionScreen from "./QuestionScreen";
import ExamScreen from "./ExamScreen";
import AchievementMoment from "./AchievementMoment";
import CertificationMoment from "./CertificationMoment";
import MenuSheet from "./MenuSheet";
import AcademiaToast from "./AcademiaToast";

const SceneStage = dynamic(() => import("./scene/SceneStage"), { ssr: false, loading: () => null });

const NAMES = { home: "Início", trilha: "Trilha", evo: "Evolução", aula: "Aula", quiz: "Questão", prova: "Prova", conq: "Conquista", cert: "Certificação" };
const HOLD = new Set(["aula", "quiz", "prova", "conq"]); // a cena mostra o "antes" até a Conquista animar
const LS_KEY = "mm-academia-reduzir-movimento";

// `initial` = dados reais do servidor (F2); sem `initial` nem `store`, roda com os dados de exemplo (vitrine/testes).
export default function AcademiaApp({ store: injected, initial, backHref = "/admin/simulacoes", manageHref = null, tracks = [] }) {
  const [store] = useState(() => injected || (initial ? createAcademyRemoteStore({ initial }) : createAcademyDemoStore()));
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [engine] = useState(() => createEngine(s));
  const sysReduced = usePrefersReducedMotion();
  const reduced = snap.reducedMotion || sysReduced;

  const [view, setView] = useState("home");
  const [sceneReady, setSceneReady] = useState(false);
  const [shown, setShown] = useState(() => ({ n: snap.home.done, percent: snap.home.percent }));
  const [cq, setCq] = useState(0);
  const [cqShow, setCqShow] = useState(false);
  const [certShow, setCertShow] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  const [sel, setSel] = useState(null);
  const [retriedAt, setRetriedAt] = useState(-1);
  const [menu, setMenu] = useState(false);
  const [toast, setToast] = useState("");
  const [hint, setHint] = useState(false);
  const [live, setLive] = useState("");

  const timers = useRef([]);
  const toastId = useRef(0);
  const fromRef = useRef("trilha");
  const keepHome = useRef(false);
  const prevView = useRef("home");
  const heads = { aula: useRef(null), quiz: useRef(null), prova: useRef(null), conq: useRef(null), cert: useRef(null) };
  const pcRef = useRef(null);

  /* ---------- dados derivados (nada de regra: só reorganiza o snapshot) ---------- */
  const flat = useMemo(() => {
    let idx = 0;
    return snap.trail.modules.flatMap((m) => m.lessons.map((l) => ({ ...l, m: m.n, idx: idx++ })));
  }, [snap.trail]);
  const total = flat.length;
  const mrKey = snap.trail.modules.map((m) => m.lessonsTotal).join(",");
  const mr = useMemo(() => {
    let a = 0;
    return mrKey.split(",").map(Number).map((c) => { const r = { a, b: a + c - 1 }; a += c; return r; });
  }, [mrKey]);
  const weeks = Math.max(1, snap.evolution.weeks.length);
  const evHist = useMemo(() => {
    const pts = [[0, 0], ...snap.evolution.weeks.map((w) => [w.week, w.done])];
    return (wk) => {
      for (let i = 1; i < pts.length; i++) if (wk <= pts[i][0]) { const a = pts[i - 1], b = pts[i]; return a[1] + (b[1] - a[1]) * ((wk - a[0]) / (b[0] - a[0] || 1)); }
      return pts[pts.length - 1][1];
    };
  }, [snap.evolution.weeks]);
  const mods = useMemo(() => snap.evolution.milestones.slice(0, Math.max(0, mr.length - 1)).map((m, k) => ({
    a: mr[k].a, b: mr[k].b, weekText: m.week ? `semana ${m.week}${snap.isSample ? " · exemplo" : ""}` : "concluído"
  })), [snap.evolution.milestones, mr, snap.isSample]);

  const openId = snap.openLessonId || snap.home.lesson?.id || null;
  const openIdxRaw = flat.findIndex((l) => l.id === openId);
  const openIdx = openIdxRaw >= 0 ? openIdxRaw : Math.min(shown.n, Math.max(0, total - 1));
  const a = snap.achievement;
  const quiz = snap.quiz;
  const lesson = snap.lesson;
  const answered = Boolean(quiz) && quiz.status !== "unanswered" && quiz.attempts !== retriedAt;
  const pending = Boolean(quiz) && quiz.status === "correct" && a.available;
  const pinText = snap.home.lesson ? `${snap.home.lesson.title} · ${snap.home.lesson.minutes} min` : snap.home.partial ? "Novos módulos em breve" : "Formação concluída";

  /* ---------- motor: entradas, montagem, troca de tela ---------- */
  useLayoutEffect(() => {
    engine.setCtx({
      view, n: shown.n, open: openIdx, cq, total, percent: shown.percent, mr, reduced, evHist, evWeeks: weeks, mods, pinText,
      cqLbl: a.available ? `de ${a.before}% para ${a.after}%` : ""
    });
  });
  // UMA região viva (polite) para tudo: nome da tela, avisos, feedback da questão e texto da Conquista.
  // Os elementos visuais (toast, feedback, dica) não são vivos, para o leitor de tela não repetir.
  const say = useCallback((msg) => {
    setLive("");
    requestAnimationFrame(() => setLive(msg));
  }, []);
  const showToast = useCallback((msg) => {
    setToast(msg);
    say(msg);
    clearTimeout(toastId.current);
    toastId.current = setTimeout(() => setToast(""), 2600);
  }, [say]);
  useEffect(() => {
    engine.cb.toast = showToast;
    engine.cb.hint = () => setHint(true);
    engine.mount();
    return () => { engine.unmount(); clearTimeout(toastId.current); timers.current.forEach(clearTimeout); };
  }, [engine, showToast]);
  useEffect(() => { if (view === "home" || view === "trilha" || view === "evo") say(NAMES[view]); }, [view, say]);
  // avisos do store real (sem conexão, modo de visualização, tentativas esgotadas)
  useEffect(() => { if (snap.notice?.text) showToast(snap.notice.text); }, [snap.notice, showToast]);
  useEffect(() => { if (cqShow && a.available) say(`${a.moduleCompleted ? `Módulo ${a.moduleCompleted.n} concluído` : "Aula concluída"}. ${a.text}`); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cqShow]);
  useEffect(() => { if (answered && quiz) say(quiz.status === "correct" ? (quiz.feedback || "Correto.") : "Não foi dessa vez. Tente de novo."); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answered, quiz?.attempts, quiz?.status]);
  useLayoutEffect(() => {
    if (prevView.current !== view) {
      engine.onViewChange(view, prevView.current, { keepHome: keepHome.current });
      if (pcRef.current) pcRef.current.scrollTop = 0;
      prevView.current = view;
    }
  }, [view, engine]);
  // a cena só "enxerga" o progresso novo depois da Conquista (antes disso fica no "antes")
  useLayoutEffect(() => {
    if (HOLD.has(view)) return;
    setShown((p) => (p.n === snap.home.done && p.percent === snap.home.percent ? p : { n: snap.home.done, percent: snap.home.percent }));
  }, [snap.home.done, snap.home.percent, view]);

  // movimento reduzido salvo (chave própria); o aparelho (prefers-reduced-motion) vale por cima
  useEffect(() => {
    try { if (window.localStorage.getItem(LS_KEY) === "1") store.setReducedMotion(true); } catch { /* sem armazenamento: segue */ }
  }, [store]);

  /* ---------- navegação ---------- */
  const later = useCallback((fn, ms) => { const id = setTimeout(fn, ms); timers.current.push(id); return id; }, []);
  const clearLater = useCallback(() => { timers.current.forEach(clearTimeout); timers.current = []; }, []);
  const goTo = useCallback((v, opts = {}) => {
    clearLater();
    keepHome.current = Boolean(opts.keepHome);
    setCqShow(false); setCertShow(false);
    setView(v);
  }, [clearLater]);
  const focusSoon = (key, ms) => later(() => heads[key].current?.focus({ preventScroll: true }), ms);

  const openLesson = (id, from) => {
    store.openLesson(id);
    fromRef.current = from;
    setSel(null); setRetriedAt(-1);
    goTo("aula");
    focusSoon("aula", reduced ? 50 : 700);
  };
  const startConq = () => {
    const ev = store.getSnapshot().achievement;
    if (!ev.available) return;
    const modDone = ev.moduleCompleted;
    clearLater();
    setCq(0); setCqShow(false); setCertShow(false);
    setShown({ n: ev.floorsBefore, percent: ev.before });
    setView("conq");
    keepHome.current = false;
    if (reduced) {
      setShown({ n: ev.floorsAfter, percent: ev.after }); setCq(2); setCqShow(true); focusSoon("conq", 50);
      return;
    }
    later(() => { setShown({ n: ev.floorsAfter, percent: ev.after }); setCq(1); }, 650);
    later(() => { if (modDone) { const r = mr[modDone.n - 1]; if (r) engine.flashModule(r.a, r.b); } setCqShow(true); }, 1500);
    later(() => { setCq(2); heads.conq.current?.focus({ preventScroll: true }); }, 2900);
  };
  const closeLesson = () => {
    if (pending) { startConq(); return; }
    goTo(fromRef.current === "home" ? "home" : "trilha", { keepHome: true });
  };
  // Aula do aluno: com questão vai à tela da questão; sem questão (F3) conclui por botão (o servidor valida a ordem).
  const onLessonAction = async () => {
    if (!lesson) return;
    if (lesson.multiExam) { store.openExam(lesson.id); goTo("prova"); focusSoon("prova", 50); return; }
    if (lesson.hasQuiz !== false) { goTo("quiz"); focusSoon("quiz", 50); return; }
    if (lesson.state === "done") { closeLesson(); return; }
    const r = await store.completeLesson(lesson.id);
    if (r?.changed) startConq();
  };
  const examState = snap.exam || null;
  const examBack = () => { store.closeExam(); goTo("aula"); };
  const examFinish = () => { const ev = store.getSnapshot().achievement; store.closeExam(); if (ev.available) startConq(); else closeLesson(); };
  const exhausted = Boolean(quiz?.exhausted);
  const onQuizAction = () => {
    if (!quiz) return;
    if (exhausted) { closeLesson(); return; }
    if (!answered) {
      if (sel === null) { showToast("Escolha uma alternativa"); return; }
      store.answerQuiz(quiz.lessonId, sel);
      return;
    }
    if (quiz.status === "incorrect") { setRetriedAt(quiz.attempts); setSel(null); return; }
    if (pending) startConq(); else closeLesson();
  };
  const quizLabel = exhausted ? "Voltar à trilha" : !answered ? "Responder" : quiz?.status === "incorrect" ? "Tentar de novo" : pending ? "Concluir aula" : "Voltar à trilha";

  // dica da Evolução: some em 6 s ou no primeiro toque/rolagem (nada de animação nova em movimento reduzido)
  useEffect(() => {
    if (!hint) return undefined;
    if (view !== "evo") { setHint(false); return undefined; }
    const el = document.querySelector("[data-evo-scroller]");
    const off = () => setHint(false);
    const evs = ["wheel", "touchstart", "pointerdown", "keydown", "scroll"];
    evs.forEach((e) => el?.addEventListener(e, off, { passive: true }));
    const id = setTimeout(off, 6000);
    return () => { clearTimeout(id); evs.forEach((e) => el?.removeEventListener(e, off)); };
  }, [hint, view]);
  useEffect(() => { if (view !== "evo") setHint(false); }, [view]);

  useEffect(() => {
    if (view === "cert") {
      if (reduced) { setCertShow(true); later(() => heads.cert.current?.focus({ preventScroll: true }), 50); }
      else later(() => setCertShow(true), 2300);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const toggleReduce = () => {
    const next = !reduced;
    if (!next && sysReduced) { showToast("Seu aparelho pede menos movimento: ajuste nas configurações dele"); return; }
    store.setReducedMotion(next);
    try { window.localStorage.setItem(LS_KEY, next ? "1" : "0"); } catch { /* sem armazenamento */ }
    showToast(next ? "Movimento reduzido: a cena troca de estado sem animar" : "Movimento completo");
  };
  const reset = () => {
    clearLater();
    store.resetExample();
    setExpanded(new Set()); setSel(null); setRetriedAt(-1); setCq(0);
    setMenu(false);
    goTo("home");
    const h = store.getSnapshot().home;
    showToast(`Exemplo reiniciado: ${h.done} de ${h.total} aulas, ${h.percent}%`);
  };
  const onLocked = (kind) => showToast(
    kind === "cert" ? "A certificação libera ao concluir 100%"
      : kind === "lesson" ? "Libera ao concluir a aula atual"
        : kind === "nextModule" ? "Libera ao concluir o módulo atual" : "Bloqueado até concluir o módulo anterior"
  );
  const toggleModule = (n) => setExpanded((p) => { const x = new Set(p); if (x.has(n)) x.delete(n); else x.add(n); return x; });
  const onNav = (k) => { if (k !== view) goTo(k); };
  const onHomeAction = () => {
    const act = snap.home.nextAction;
    if (act.kind === "continue_lesson") openLesson(act.lessonId, "home");
    else if (act.kind === "get_certificate") goTo("cert");
  };

  const onPlane = view === "aula" || view === "quiz" || view === "prova";
  return (
    <AcademiaShell engine={engine} view={view} reduced={reduced} sceneReady={sceneReady}>
      <SceneStage engine={engine} total={total} mr={mr} onReady={() => setSceneReady(true)} />

      <main className={s.main} aria-label="Academia">
      <HomeView engine={engine} home={snap.home} active={view === "home"} onAction={onHomeAction} />
      <TrailView engine={engine} trail={snap.trail} flat={flat} expanded={expanded} active={view === "trilha"} reduced={reduced}
        onToggle={toggleModule} onOpen={(id) => openLesson(id, "trilha")} onLocked={onLocked} onCert={() => goTo("cert")} />
      <EvolutionView engine={engine} evolution={snap.evolution} mods={mods} active={view === "evo"} total={total} weeks={weeks} />

      <div className={s.veilT} ref={engine.ref("vt")} aria-hidden="true" />

      <AchievementMoment a={a.available ? a : { text: "", moduleCompleted: null, nextModule: null }} on={view === "conq"} show={cqShow}
        canCertificate={snap.certificate.eligible} headingRef={heads.conq}
        onNext={() => { clearLater(); goTo(snap.certificate.eligible ? "cert" : "trilha"); }} onEvo={() => { clearLater(); goTo("evo"); }} />
      <CertificationMoment cert={snap.certificate} total={total} on={view === "cert"} show={certShow} headingRef={heads.cert}
        onDownload={() => showToast("O download do certificado entra na próxima etapa (dados de exemplo)")}
        onBack={() => goTo("evo")} />

      <div className={s.plane} ref={engine.ref("plane")} role="region" aria-label="Aula e questão" inert={!onPlane}>
        <div className={s.planePc} ref={(el) => { pcRef.current = el; engine.ref("pc")(el); }}>
          {lesson ? (
            <LessonScreen lesson={lesson} on={view === "aula"} review={lesson.state === "done"} isSample={snap.isSample} headingRef={heads.aula}
              onBack={closeLesson} onNext={onLessonAction} />
          ) : null}
          {examState ? (
            <ExamScreen exam={examState} title={lesson?.title || "Prova"} on={view === "prova"} headingRef={heads.prova}
              onAnswer={(qid, oid, multiple) => store.answerExam(qid, oid, multiple)} onSubmit={() => store.submitExam()}
              onRetry={() => store.openExam(lesson.id)} onFinish={examFinish} onBack={examBack} />
          ) : null}
          {quiz ? (
            <QuestionScreen quiz={quiz} on={view === "quiz"} sel={sel} answered={answered} actionLabel={quizLabel} headingRef={heads.quiz}
              onSelect={setSel} onAction={onQuizAction} onBack={() => goTo("aula")} />
          ) : null}
        </div>
      </div>

      </main>

      <AcademiaHeader engine={engine} backHref={backHref} reduced={reduced} isSample={snap.isSample} onToggleReduce={toggleReduce} onOpenMenu={() => setMenu(true)} />
      <FloatingNav engine={engine} view={view} onGo={onNav} />

      <MenuSheet open={menu} onClose={() => setMenu(false)} reduced={reduced} onToggleReduce={toggleReduce} onReset={reset} backHref={backHref} manageHref={manageHref} tracks={tracks} isSample={snap.isSample} />
      <AcademiaToast message={toast} />
      {hint ? <p className={s.hint}>Role para voltar no tempo</p> : null}
      <p className={s.sr} role="status" aria-live="polite" aria-atomic="true">{live}</p>
    </AcademiaShell>
  );
}
