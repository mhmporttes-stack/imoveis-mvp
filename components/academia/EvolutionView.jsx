"use client";

// Evolução: rolagem = tempo. A obra cresce de baixo para cima conforme a semana; módulos concluídos
// ganham rótulo preso ao andar; trilho vertical à esquerda com os nós de semana; "Hoje" e a coroa
// "Certificação". Em movimento reduzido abre já no presente. Alternativa em texto (lista) para leitor de tela.
import s from "./academia.module.css";

export default function EvolutionView({ engine, evolution, mods, active, total, weeks }) {
  const nodes = Array.from(new Set([0, ...evolution.milestones.filter((m) => m.week).map((m) => m.week), weeks])).sort((a, b) => a - b);
  return (
    <>
      <div className={s.sc + (active ? " " + s.on : "")} data-evo-scroller="1" ref={engine.refSc("evo")} inert={!active} tabIndex={active ? 0 : -1} role="region" aria-label="Linha do tempo da evolução: role ou use as setas para avançar e voltar no tempo">
        <div className={s.spEvo} />
      </div>
      <div className={s.oEvo} style={{ visibility: active ? "visible" : "hidden" }} aria-hidden="true">
        <div className={`${s.rail} ${active ? s.on : ""}`} ref={engine.ref("rail")}>
          <i className={s.railL} /><i className={s.railF} ref={engine.ref("railF")} /><i className={s.railM} ref={engine.ref("railM")} />
          {nodes.map((w) => (
            <span key={w}>
              <i className={s.railD} style={{ top: `${((w / weeks) * 100).toFixed(1)}%` }} />
              {w ? <em className={s.wl} style={{ top: `${((w / weeks) * 100).toFixed(1)}%`, fontStyle: "normal" }}>S{w}</em> : null}
            </span>
          ))}
        </div>
        {mods.map((m, k) => (
          <div key={k} className={`${s.anc} ${s.evl}`} ref={engine.refAt("evm", k)}><div className={s.evIn}><b>Módulo {evolution.milestones[k].moduleN}</b><span /></div></div>
        ))}
        <div className={`${s.anc} ${s.evl}`} ref={engine.ref("evnow")}><div className={s.evIn}><b>Hoje</b><span>{evolution.today.done} de {total} aulas</span></div></div>
        <div className={`${s.anc} ${s.evl} ${s.on}`} ref={engine.ref("evcert")}><div className={s.evIn}><b>Certificação</b><span>ao concluir 100%</span></div></div>
      </div>
      {active ? (
        <div className={s.sr}>
          <h1 tabIndex={-1}>Evolução</h1>
          <p>Hoje: {evolution.today.done} de {total} aulas, {evolution.today.percent}%. Semana {weeks} de estudo.</p>
          <ul>
            {evolution.milestones.map((m) => (
              <li key={m.moduleN}>Módulo {m.moduleN}, {m.title}: {m.state === "done" ? `concluído${m.week ? ` na semana ${m.week}` : ""}` : m.state === "inProgress" ? "em andamento" : "ainda não iniciado"}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
