import { formatPhone } from "@/lib/simulation-registration-format";
import styles from "@/components/simulation-form/SimulationForm.module.css";

// Controles da ficha pública /simulacao no visual escuro aprovado pelo dono (2026-10-24). Mesmo comportamento dos
// controles claros (ChoiceStep/TextInputStep/PhoneInputStep), que continuam servindo o Atendimento rápido e as
// preferências de imóvel: aqui só muda a apresentação.

export const FichaIcon = {
  back: (
    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" /></svg>
  ),
  next: (
    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
  ),
  alert: (
    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5h.01" strokeLinecap="round" /></svg>
  ),
  info: (
    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.5h.01" strokeLinecap="round" /></svg>
  ),
  lock: (
    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect height="10" rx="2" width="16" x="4" y="11" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
  ),
  check: (
    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
  ),
  x: (
    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="3" viewBox="0 0 24 24"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" /></svg>
  ),
  shield: (
    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z" /><path d="M8.5 12l2.5 2.5 4.5-5" strokeLinecap="round" /></svg>
  ),
  calendar: (
    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" viewBox="0 0 24 24"><rect height="16" rx="3" width="18" x="3" y="5" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
  ),
  chevLeft: (
    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.4" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" /></svg>
  ),
  chevRight: (
    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.4" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>
  )
};

export function FichaError({ id, message }) {
  if (!message) return null;
  return (
    <p className={styles.err} id={id} role="alert">
      {FichaIcon.alert}
      <span>{message}</span>
    </p>
  );
}

// Opções em linha (escolha) ou Sim/Não em dois blocos com ✓ e ✕. Toque escolhe e avança (lógica no formulário).
export function FichaChoice({ error, errorId, labelledBy, onChange, options = [], value, yesNo = false }) {
  return (
    <div className={error ? styles.invalid : undefined}>
      <div
        aria-describedby={error ? errorId : undefined}
        aria-labelledby={labelledBy}
        className={`${styles.opts} ${yesNo ? styles.yn : ""}`}
        role="radiogroup"
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              aria-checked={selected}
              className={styles.opt}
              data-no={yesNo && option.value === false ? "true" : undefined}
              key={String(option.value)}
              onClick={() => onChange(option.value)}
              role="radio"
              type="button"
            >
              {yesNo ? <span aria-hidden="true" className={styles.ico}>{option.value ? FichaIcon.check : FichaIcon.x}</span> : null}
              <span className={styles.optTxt}>
                <b>{option.label}</b>
                {option.description ? <small>{option.description}</small> : null}
              </span>
              {yesNo ? null : <span aria-hidden="true" className={styles.radio}>{FichaIcon.check}</span>}
            </button>
          );
        })}
      </div>
      <FichaError id={errorId} message={error} />
    </div>
  );
}

function describedBy(...ids) {
  const list = ids.filter(Boolean).join(" ");
  return list || undefined;
}

export function FichaText({ error, errorId, hint, label, onBlur, onChange, onEnter, step, value }) {
  const inputId = `simulation-${step.id}`;
  const hintId = hint ? `${inputId}-hint` : "";
  return (
    <div className={error ? styles.invalid : undefined}>
      <label className={styles.label} htmlFor={inputId}>{label}</label>
      <div className={styles.field}>
        <input
          aria-describedby={describedBy(hintId, error ? errorId : "")}
          aria-invalid={error ? "true" : undefined}
          autoCapitalize="words"
          autoComplete={step.autoComplete}
          enterKeyHint="next"
          id={inputId}
          inputMode={step.inputMode || "text"}
          onBlur={onBlur}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onEnter?.(); } }}
          placeholder={step.placeholder}
          spellCheck={false}
          type="text"
          value={value || ""}
        />
      </div>
      {hint && !error ? <p className={styles.hint} id={hintId}>{hint}</p> : null}
      <FichaError id={errorId} message={error} />
    </div>
  );
}

export function FichaPhone({ error, errorId, hint, label, onChange, onEnter, step, value }) {
  const inputId = `simulation-${step.id}`;
  const hintId = hint ? `${inputId}-hint` : "";
  return (
    <div className={error ? styles.invalid : undefined}>
      <label className={styles.label} htmlFor={inputId}>{label}</label>
      <div className={styles.field}>
        <span aria-hidden="true" className={styles.affix}>+55</span>
        <input
          aria-describedby={describedBy(hintId, error ? errorId : "")}
          aria-invalid={error ? "true" : undefined}
          autoComplete={step.autoComplete}
          enterKeyHint="next"
          id={inputId}
          inputMode="numeric"
          name="phone"
          onChange={(event) => onChange(formatPhone(event.target.value))}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onEnter?.(); } }}
          placeholder={step.placeholder}
          type="tel"
          value={value || ""}
        />
      </div>
      {hint && !error ? <p className={styles.hint} id={hintId}>{hint}</p> : null}
      <FichaError id={errorId} message={error} />
    </div>
  );
}
