"use client";

import { useEffect, useState } from "react";

const MODELO_OPTIONS = [
  { value: "ato_mais_parcelas", label: "ATO + parcelas" },
  { value: "periodo_obra_pos_obra_balao", label: "Obra + pós-obra" },
  { value: "tabela_condicoes", label: "Tabela de condições" }
];

function emptyLimites() {
  return {
    numeroMaximoParcelas: "",
    parcelaMinima: "",
    parcelaMaximaTipo: "valor_fixo",
    parcelaMaximaValor: "",
    parcelaMaximaPercentual: "",
    jurosAtivo: false,
    taxaJurosMensal: ""
  };
}

function emptyRegraState() {
  return {
    tipo: "ato_mais_parcelas",
    limiteParcelavel: "",
    numeroParcelasQuandoExcedeLimite: "",
    limites: emptyLimites(),
    mesesPeriodoObra: "",
    dataEntrega: "",
    posObraAtivo: false,
    mesesPosObra: "",
    limitesObra: emptyLimites(),
    limitesPosObra: emptyLimites(),
    balaoAtivo: false,
    balaoQuantidade: "",
    balaoPeriodicidadeMeses: "6",
    balaoValorMaximoPorBalao: "",
    balaoLimiteTipo: "valor_fixo",
    balaoPercentualRenda: "",
    valorUnidadeReferencia: "",
    condicoes: []
  };
}

function emptyFormState() {
  return {
    ativo: true,
    valorImovel: "",
    limiteMaximoEntradaParcelavel: "",
    atoAtivo: false,
    atoObrigatorio: false,
    atoTipo: "valor_fixo",
    atoValor: "",
    atoPercentual: "",
    atoMinimo: "",
    atoMaximo: "",
    aceitaCasaPaulista: false,
    documentacaoGratuita: false,
    descontos: [],
    observacoes: "",
    regra: emptyRegraState()
  };
}

export default function EmpreendimentoRegrasEntradaForm({ propertyId }) {
  const [form, setForm] = useState(emptyFormState);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/empreendimentos/${propertyId}`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Nao foi possivel carregar as regras.");
        if (!cancelled && data.empreendimento) {
          setForm(rowToFormState(data.empreendimento));
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError.message || "Nao foi possivel carregar as regras.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [propertyId]);

  function update(patch) {
    setForm((current) => ({ ...current, ...patch }));
  }

  function updateRegra(patch) {
    setForm((current) => ({ ...current, regra: { ...current.regra, ...patch } }));
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSavedAt("");

    try {
      const payload = {
        ativo: form.ativo,
        regras: formStateToEmpreendimento(form)
      };

      const response = await fetch(`/api/empreendimentos/${propertyId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) throw new Error(data.error || "Nao foi possivel salvar as regras.");

      setSavedAt(new Date().toLocaleTimeString("pt-BR"));
    } catch (submitError) {
      setError(submitError.message || "Nao foi possivel salvar as regras.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="container-page rounded-2xl border border-line bg-white p-6 font-bold text-muted">Carregando regras de entrada...</p>;
  }

  return (
    <form onSubmit={submit} className="container-page grid min-w-0 gap-6 rounded-[24px] border border-line bg-white p-4 shadow-soft sm:gap-8 sm:rounded-[28px] sm:p-8">
      <section className="grid gap-5 rounded-3xl border border-amber-200 bg-amber-50 p-5">
        <p className="text-sm font-bold text-amber-900">
          Essas regras alimentam a simulação de entrada mostrada ao cliente (Gerador de Simulações). São dados sensíveis de
          negociação — visíveis só para a equipe administrativa, nunca no site público.
        </p>
      </section>

      <section className="grid gap-5 lg:grid-cols-3">
        <label className="flex items-center gap-3 rounded-2xl border border-line px-4 py-3 font-extrabold text-ink">
          <input type="checkbox" checked={form.ativo} onChange={(event) => update({ ativo: event.target.checked })} />
          Empreendimento ativo nas simulações
        </label>
        <MoneyField label="Valor do imóvel (R$)" value={form.valorImovel} onChange={(value) => update({ valorImovel: value })} />
        <label className="flex items-center gap-3 rounded-2xl border border-line px-4 py-3 font-extrabold text-ink">
          <input
            type="checkbox"
            checked={form.aceitaCasaPaulista}
            onChange={(event) => update({ aceitaCasaPaulista: event.target.checked })}
          />
          Aceita Casa Paulista
        </label>
      </section>

      <DescontosEditor value={form.descontos} onChange={(descontos) => update({ descontos })} />

      <label className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 font-extrabold text-emerald-900">
        <input type="checkbox" checked={form.documentacaoGratuita} onChange={(event) => update({ documentacaoGratuita: event.target.checked })} />
        Documentação gratuita (economia calculada em 5% do valor cheio do imóvel)
      </label>

      <section className="grid gap-5 rounded-3xl border border-line bg-[#F8FBFF] p-6">
        <p className="text-sm font-black uppercase tracking-[0.1em] text-brand">Limites gerais e ato</p>
        <div className="grid gap-4 md:grid-cols-3">
          <MoneyField label="Máximo de entrada parcelável (R$)" value={form.limiteMaximoEntradaParcelavel} onChange={(value) => update({ limiteMaximoEntradaParcelavel: value })} />
          <label className="flex items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3 font-extrabold text-ink"><input type="checkbox" checked={form.atoAtivo} onChange={(event) => update({ atoAtivo: event.target.checked })} />Permite ato</label>
          <label className="flex items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3 font-extrabold text-ink"><input type="checkbox" checked={form.atoObrigatorio} disabled={!form.atoAtivo} onChange={(event) => update({ atoObrigatorio: event.target.checked })} />Ato obrigatório</label>
        </div>
        {form.atoAtivo ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="grid gap-2 font-extrabold text-ink">Regra do ato<select className="rounded-2xl border border-line px-4 py-3" value={form.atoTipo} onChange={(event) => update({ atoTipo: event.target.value })}><option value="valor_fixo">Valor fixo</option><option value="percentual_entrada">% da entrada</option></select></label>
          {form.atoTipo === "valor_fixo" ? <MoneyField label="Valor do ato (R$)" value={form.atoValor} onChange={(value) => update({ atoValor: value })} /> : <NumberField label="Percentual do ato (%)" value={form.atoPercentual} step="0.1" onChange={(value) => update({ atoPercentual: value })} />}
          <MoneyField label="Ato mínimo (R$)" value={form.atoMinimo} onChange={(value) => update({ atoMinimo: value })} />
          <MoneyField label="Ato máximo (R$)" value={form.atoMaximo} onChange={(value) => update({ atoMaximo: value })} />
        </div> : null}
      </section>

      <section className="grid gap-5 rounded-3xl border border-line bg-[#F8FBFF] p-6">
        <label className="grid gap-2 font-extrabold text-ink">
          Modelo de parcelamento
          <select
            className="rounded-2xl border border-line px-4 py-3 outline-none focus:border-brand focus:ring-4 focus:ring-brand/10"
            value={form.regra.tipo}
            onChange={(event) => updateRegra({ tipo: event.target.value })}
          >
            {MODELO_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        {form.regra.tipo === "ato_mais_parcelas" ? (
          <AtoMaisParcelasFields regra={form.regra} onChange={updateRegra} />
        ) : null}

        {form.regra.tipo === "periodo_obra_pos_obra_balao" ? (
          <ObraPosObraFields regra={form.regra} onChange={updateRegra} />
        ) : null}

        {form.regra.tipo === "tabela_condicoes" ? (
          <TabelaCondicoesFields regra={form.regra} onChange={updateRegra} />
        ) : null}
      </section>

      <Textarea label="Observações" value={form.observacoes} onChange={(value) => update({ observacoes: value })} />

      <div className="flex flex-col gap-3 border-t border-line pt-6 sm:flex-row sm:items-center">
        <button disabled={saving} className="premium-button-primary disabled:cursor-not-allowed disabled:opacity-60" type="submit">
          {saving ? "Salvando..." : "Salvar regras de entrada"}
        </button>
        {savedAt ? <p className="font-bold text-emerald-700">Salvo às {savedAt}.</p> : null}
      </div>

      {error ? (
        <p className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 font-bold text-red-700">{error}</p>
      ) : null}
    </form>
  );
}

function AtoMaisParcelasFields({ regra, onChange }) {
  return (
    <div className="grid gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <MoneyField
          label="Limite parcelável (R$) — acima disso vira ATO"
          value={regra.limiteParcelavel}
          onChange={(value) => onChange({ limiteParcelavel: value })}
        />
        <NumberField
          label="Nº de parcelas quando excede o limite"
          value={regra.numeroParcelasQuandoExcedeLimite}
          onChange={(value) => onChange({ numeroParcelasQuandoExcedeLimite: value })}
        />
      </div>
      <LimitesParcelaFields
        title="Limites da parcela (dentro do limite parcelável)"
        value={regra.limites}
        onChange={(limites) => onChange({ limites })}
      />
    </div>
  );
}

function ObraPosObraFields({ regra, onChange }) {
  return (
    <div className="grid gap-6">
      <div className="grid gap-5 sm:grid-cols-2">
        <NumberField
          label="Duração da obra (meses)"
          value={regra.mesesPeriodoObra}
          onChange={(value) => onChange({ mesesPeriodoObra: value })}
        />
        <NumberField
          label="Duração do pós-obra (meses)"
          value={regra.mesesPosObra}
          disabled={!regra.posObraAtivo}
          onChange={(value) => onChange({ mesesPosObra: value })}
        />
        <Field label="Previsão de entrega" type="date" value={regra.dataEntrega} onChange={(value) => onChange({ dataEntrega: value })} />
        <label className="flex items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3 font-extrabold text-ink"><input type="checkbox" checked={regra.posObraAtivo} onChange={(event) => onChange({ posObraAtivo: event.target.checked })} />Existem parcelas pós-obra</label>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {regra.posObraAtivo ? <div className="rounded-2xl border border-line bg-white p-4">
          <LimitesParcelaFields
            title="Durante a obra"
            value={regra.limitesObra}
            onChange={(limitesObra) => onChange({ limitesObra })}
          />
        </div> : null}
        <div className="rounded-2xl border border-line bg-white p-4">
          <LimitesParcelaFields
            title="Pós-obra"
            value={regra.limitesPosObra}
            onChange={(limitesPosObra) => onChange({ limitesPosObra })}
          />
        </div>
      </div>

      <div className="grid gap-4 rounded-2xl border border-line bg-white p-4">
        <label className="flex items-center gap-3 font-extrabold text-ink">
          <input type="checkbox" checked={regra.balaoAtivo} onChange={(event) => onChange({ balaoAtivo: event.target.checked })} />
          Este empreendimento tem pagamento em balão
        </label>
        {regra.balaoAtivo ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <NumberField
              label="Quantidade de balões"
              value={regra.balaoQuantidade}
              onChange={(value) => onChange({ balaoQuantidade: value })}
            />
            <label className="grid gap-2 font-extrabold text-ink">
              Periodicidade
              <select
                className="rounded-2xl border border-line px-4 py-3 outline-none focus:border-brand focus:ring-4 focus:ring-brand/10"
                value={regra.balaoPeriodicidadeMeses}
                onChange={(event) => onChange({ balaoPeriodicidadeMeses: event.target.value })}
              >
                <option value="6">Semestral</option>
                <option value="3">Trimestral</option>
                <option value="12">Anual</option>
              </select>
            </label>
            <label className="grid gap-2 font-extrabold text-ink">Limite do balão<select className="rounded-2xl border border-line px-4 py-3" value={regra.balaoLimiteTipo} onChange={(event) => onChange({ balaoLimiteTipo: event.target.value })}><option value="valor_fixo">Valor fixo</option><option value="percentual_renda">% da renda</option></select></label>
            {regra.balaoLimiteTipo === "valor_fixo" ? <MoneyField label="Máximo por balão (R$)" value={regra.balaoValorMaximoPorBalao} onChange={(value) => onChange({ balaoValorMaximoPorBalao: value })} /> : <NumberField label="Máximo por balão (% da renda)" step="0.1" value={regra.balaoPercentualRenda} onChange={(value) => onChange({ balaoPercentualRenda: value })} />}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TabelaCondicoesFields({ regra, onChange }) {
  function updateCondicao(index, patch) {
    const next = regra.condicoes.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item));
    onChange({ condicoes: next });
  }

  function addCondicao() {
    onChange({
      condicoes: [
        ...regra.condicoes,
        { temDependente: false, fgtsMaisDe3Anos: false, tipoRenda: "", entrada: "", ato: "", parcelas: "", valorParcela: "" }
      ]
    });
  }

  function removeCondicao(index) {
    onChange({ condicoes: regra.condicoes.filter((_, itemIndex) => itemIndex !== index) });
  }

  return (
    <div className="grid gap-5">
      <MoneyField
        label="Valor da unidade de referência (R$)"
        value={regra.valorUnidadeReferencia}
        onChange={(value) => onChange({ valorUnidadeReferencia: value })}
      />

      <p className="text-sm text-muted">
        Cada linha é um cenário pronto da tabela que a incorporadora/Caixa te passou. O sistema busca a linha que bate com o
        perfil do cliente (dependente, FGTS 3+ anos, tipo de renda).
      </p>

      <div className="grid gap-4">
        {regra.condicoes.map((condicao, index) => (
          <div key={index} className="grid gap-3 rounded-2xl border border-line bg-white p-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="flex items-center gap-2 font-bold text-ink">
                <input
                  type="checkbox"
                  checked={condicao.temDependente}
                  onChange={(event) => updateCondicao(index, { temDependente: event.target.checked })}
                />
                Tem dependente
              </label>
              <label className="flex items-center gap-2 font-bold text-ink">
                <input
                  type="checkbox"
                  checked={condicao.fgtsMaisDe3Anos}
                  onChange={(event) => updateCondicao(index, { fgtsMaisDe3Anos: event.target.checked })}
                />
                FGTS 3+ anos
              </label>
              <Field
                label="Tipo de renda"
                value={condicao.tipoRenda}
                onChange={(value) => updateCondicao(index, { tipoRenda: value })}
                placeholder="informal, formal, 1800..."
              />
              <NumberField label="Nº parcelas" value={condicao.parcelas} onChange={(value) => updateCondicao(index, { parcelas: value })} />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <MoneyField label="Entrada total (R$)" value={condicao.entrada} onChange={(value) => updateCondicao(index, { entrada: value })} />
              <MoneyField label="ATO (R$, opcional)" value={condicao.ato} onChange={(value) => updateCondicao(index, { ato: value })} />
              <MoneyField
                label="Valor da parcela (R$)"
                value={condicao.valorParcela}
                onChange={(value) => updateCondicao(index, { valorParcela: value })}
              />
            </div>
            <button type="button" onClick={() => removeCondicao(index)} className="justify-self-start text-sm font-bold text-red-700 hover:underline">
              Remover cenário
            </button>
          </div>
        ))}
      </div>

      <button type="button" onClick={addCondicao} className="premium-button-secondary justify-self-start">
        Adicionar cenário
      </button>
    </div>
  );
}

function LimitesParcelaFields({ title, value, onChange }) {
  return (
    <div className="grid gap-4">
      {title ? <p className="text-sm font-black uppercase tracking-[0.1em] text-brand">{title}</p> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField
          label="Número máximo de parcelas"
          value={value.numeroMaximoParcelas}
          onChange={(numeroMaximoParcelas) => onChange({ ...value, numeroMaximoParcelas })}
        />
        <MoneyField
          label="Parcela mínima (R$)"
          value={value.parcelaMinima}
          onChange={(parcelaMinima) => onChange({ ...value, parcelaMinima })}
        />
        <label className="grid gap-2 font-extrabold text-ink">
          Parcela máxima
          <select
            className="rounded-2xl border border-line px-4 py-3 outline-none focus:border-brand focus:ring-4 focus:ring-brand/10"
            value={value.parcelaMaximaTipo}
            onChange={(event) => onChange({ ...value, parcelaMaximaTipo: event.target.value })}
          >
            <option value="valor_fixo">Valor fixo (R$)</option>
            <option value="percentual_renda">Percentual da renda (%)</option>
          </select>
        </label>
        {value.parcelaMaximaTipo === "valor_fixo" ? (
          <MoneyField
            label="Valor máximo da parcela (R$)"
            value={value.parcelaMaximaValor}
            onChange={(parcelaMaximaValor) => onChange({ ...value, parcelaMaximaValor })}
          />
        ) : (
          <NumberField
            label="Percentual máximo da renda (%)"
            value={value.parcelaMaximaPercentual}
            onChange={(parcelaMaximaPercentual) => onChange({ ...value, parcelaMaximaPercentual })}
            step="0.1"
          />
        )}
        <label className="flex items-center gap-3 rounded-2xl border border-line px-4 py-3 font-extrabold text-ink"><input type="checkbox" checked={value.jurosAtivo} onChange={(event) => onChange({ ...value, jurosAtivo: event.target.checked })} />Aplica juros/correção</label>
        {value.jurosAtivo ? <NumberField label="Taxa mensal (%)" value={value.taxaJurosMensal} onChange={(taxaJurosMensal) => onChange({ ...value, taxaJurosMensal })} step="0.01" /> : null}
      </div>
    </div>
  );
}

function DescontosEditor({ value, onChange }) {
  function updateDesconto(index, patch) {
    onChange(value.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  function addDesconto() {
    onChange([...value, { tipo: "incorporadora", label: "", valor: "" }]);
  }

  function removeDesconto(index) {
    onChange(value.filter((_, itemIndex) => itemIndex !== index));
  }

  return (
    <section className="grid gap-4 rounded-3xl border border-line bg-[#F8FBFF] p-6">
      <p className="text-sm font-black uppercase tracking-[0.1em] text-brand">Descontos que abatem o valor do imóvel</p>
      {value.map((desconto, index) => (
        <div key={index} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <Field label="Rótulo" value={desconto.label} onChange={(label) => updateDesconto(index, { label })} placeholder="Desconto Incorporadora" />
          <MoneyField label="Valor (R$)" value={desconto.valor} onChange={(valor) => updateDesconto(index, { valor })} />
          <button type="button" onClick={() => removeDesconto(index)} className="self-end rounded-2xl border border-line px-4 py-3 font-bold text-red-700 hover:border-red-200">
            Remover
          </button>
        </div>
      ))}
      <button type="button" onClick={addDesconto} className="premium-button-secondary justify-self-start">
        Adicionar desconto
      </button>
    </section>
  );
}

function Field({ label, value, onChange, ...props }) {
  return (
    <label className="grid gap-2 font-extrabold text-ink">
      {label}
      <input {...props} className="rounded-2xl border border-line px-4 py-3 outline-none focus:border-brand focus:ring-4 focus:ring-brand/10" value={value ?? ""} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function NumberField({ label, value, onChange, step = "1", ...props }) {
  return (
    <label className="grid gap-2 font-extrabold text-ink">
      {label}
      <input
        type="number"
        {...props}
        step={step}
        className="rounded-2xl border border-line px-4 py-3 outline-none focus:border-brand focus:ring-4 focus:ring-brand/10"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function MoneyField({ label, value, onChange }) {
  return (
    <label className="grid gap-2 font-extrabold text-ink">
      {label}
      <input
        type="number"
        step="0.01"
        min="0"
        className="rounded-2xl border border-line px-4 py-3 outline-none focus:border-brand focus:ring-4 focus:ring-brand/10"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function Textarea({ label, value, onChange }) {
  return (
    <label className="grid gap-2 font-extrabold text-ink">
      {label}
      <textarea className="min-h-24 rounded-2xl border border-line px-4 py-3 outline-none focus:border-brand focus:ring-4 focus:ring-brand/10" value={value || ""} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function numOrUndefined(value) {
  if (value === "" || value === null || value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function limitesFromState(state) {
  const limites = {};
  const numeroMaximoParcelas = numOrUndefined(state.numeroMaximoParcelas);
  const parcelaMinima = numOrUndefined(state.parcelaMinima);
  const taxaJurosMensal = numOrUndefined(state.taxaJurosMensal);
  if (numeroMaximoParcelas !== undefined) limites.numeroMaximoParcelas = numeroMaximoParcelas;
  if (parcelaMinima !== undefined) limites.parcelaMinima = parcelaMinima;
  if (state.jurosAtivo && taxaJurosMensal !== undefined) limites.taxaJurosMensal = taxaJurosMensal / 100;

  if (state.parcelaMaximaTipo === "valor_fixo") {
    const valor = numOrUndefined(state.parcelaMaximaValor);
    if (valor !== undefined) limites.parcelaMaxima = { tipo: "valor_fixo", valor };
  } else {
    const percentual = numOrUndefined(state.parcelaMaximaPercentual);
    if (percentual !== undefined) limites.parcelaMaxima = { tipo: "percentual_renda", percentual: percentual / 100 };
  }

  return limites;
}

function limitesToState(limites = {}) {
  const state = emptyLimites();
  if (limites.numeroMaximoParcelas !== undefined) state.numeroMaximoParcelas = String(limites.numeroMaximoParcelas);
  if (limites.parcelaMinima !== undefined) state.parcelaMinima = String(limites.parcelaMinima);
  if (limites.taxaJurosMensal !== undefined) {
    state.jurosAtivo = true;
    state.taxaJurosMensal = String(limites.taxaJurosMensal * 100);
  }
  if (limites.parcelaMaxima?.tipo === "valor_fixo") {
    state.parcelaMaximaTipo = "valor_fixo";
    state.parcelaMaximaValor = String(limites.parcelaMaxima.valor);
  } else if (limites.parcelaMaxima?.tipo === "percentual_renda") {
    state.parcelaMaximaTipo = "percentual_renda";
    state.parcelaMaximaPercentual = String(limites.parcelaMaxima.percentual * 100);
  }
  return state;
}

function formStateToEmpreendimento(form) {
  const descontos = form.descontos
    .filter((item) => item.label && item.valor !== "")
    .map((item) => ({ tipo: item.tipo || "outro", label: item.label, valor: num(item.valor) }));

  const regra = form.regra;
  let regraEntrada;

  if (regra.tipo === "ato_mais_parcelas") {
    regraEntrada = {
      tipo: "ato_mais_parcelas",
      limiteParcelavel: num(regra.limiteParcelavel),
      limites: limitesFromState(regra.limites),
      numeroParcelasQuandoExcedeLimite: num(regra.numeroParcelasQuandoExcedeLimite)
    };
  } else if (regra.tipo === "periodo_obra_pos_obra_balao") {
    regraEntrada = {
      tipo: "periodo_obra_pos_obra_balao",
      mesesPeriodoObra: num(regra.mesesPeriodoObra),
      ...(regra.dataEntrega ? { dataEntrega: regra.dataEntrega } : {}),
      limitesObra: limitesFromState(regra.limitesObra),
      mesesPosObra: regra.posObraAtivo ? num(regra.mesesPosObra) : 0,
      limitesPosObra: limitesFromState(regra.limitesPosObra)
    };
    if (regra.balaoAtivo) {
      regraEntrada.balao = {
        quantidade: num(regra.balaoQuantidade),
        periodicidadeMeses: num(regra.balaoPeriodicidadeMeses, 6),
        limite: regra.balaoLimiteTipo === "percentual_renda"
          ? { tipo: "percentual_renda", percentual: num(regra.balaoPercentualRenda) / 100 }
          : { tipo: "valor_fixo", valor: num(regra.balaoValorMaximoPorBalao) }
      };
    }
  } else {
    regraEntrada = {
      tipo: "tabela_condicoes",
      valorUnidadeReferencia: num(regra.valorUnidadeReferencia),
      condicoes: regra.condicoes.map((item) => ({
        temDependente: Boolean(item.temDependente),
        fgtsMaisDe3Anos: Boolean(item.fgtsMaisDe3Anos),
        tipoRenda: item.tipoRenda || "",
        entrada: num(item.entrada),
        ...(item.ato !== "" ? { ato: num(item.ato) } : {}),
        parcelas: num(item.parcelas),
        valorParcela: num(item.valorParcela)
      }))
    };
  }

  return {
    valorImovel: num(form.valorImovel),
    ...(form.limiteMaximoEntradaParcelavel !== "" ? { limiteMaximoEntradaParcelavel: num(form.limiteMaximoEntradaParcelavel) } : {}),
    ato: {
      ativo: Boolean(form.atoAtivo),
      obrigatorio: Boolean(form.atoObrigatorio),
      tipo: form.atoTipo,
      ...(form.atoTipo === "valor_fixo" ? { valor: num(form.atoValor) } : { percentual: num(form.atoPercentual) / 100 }),
      ...(form.atoMinimo !== "" ? { minimo: num(form.atoMinimo) } : {}),
      ...(form.atoMaximo !== "" ? { maximo: num(form.atoMaximo) } : {})
    },
    descontos,
    beneficiosInformativos: form.documentacaoGratuita ? [{
      tipo: "documentacao_gratuita",
      label: "Documentação gratuita",
      valor: num(form.valorImovel) * 0.05
    }] : [],
    aceitaCasaPaulista: Boolean(form.aceitaCasaPaulista),
    regraEntrada,
    observacoes: form.observacoes || "",
    atualizadoEm: new Date().toISOString().slice(0, 10)
  };
}

function rowToFormState(row) {
  const regras = row?.regras || {};
  const regraEntrada = regras.regraEntrada || { tipo: "ato_mais_parcelas" };
  const regra = emptyRegraState();
  regra.tipo = regraEntrada.tipo || "ato_mais_parcelas";

  if (regraEntrada.tipo === "ato_mais_parcelas") {
    regra.limiteParcelavel = String(regraEntrada.limiteParcelavel ?? "");
    regra.numeroParcelasQuandoExcedeLimite = String(regraEntrada.numeroParcelasQuandoExcedeLimite ?? "");
    regra.limites = limitesToState(regraEntrada.limites);
  } else if (regraEntrada.tipo === "periodo_obra_pos_obra_balao") {
    regra.mesesPeriodoObra = String(regraEntrada.mesesPeriodoObra ?? "");
    regra.dataEntrega = regraEntrada.dataEntrega || "";
    regra.mesesPosObra = String(regraEntrada.mesesPosObra ?? "");
    regra.posObraAtivo = Number(regraEntrada.mesesPosObra || 0) > 0;
    regra.limitesObra = limitesToState(regraEntrada.limitesObra);
    regra.limitesPosObra = limitesToState(regraEntrada.limitesPosObra);
    if (regraEntrada.balao) {
      regra.balaoAtivo = true;
      regra.balaoQuantidade = String(regraEntrada.balao.quantidade ?? "");
      regra.balaoPeriodicidadeMeses = String(regraEntrada.balao.periodicidadeMeses ?? "6");
      const limite = regraEntrada.balao.limite;
      if (limite?.tipo === "percentual_renda") {
        regra.balaoLimiteTipo = "percentual_renda";
        regra.balaoPercentualRenda = String((limite.percentual || 0) * 100);
      } else {
        regra.balaoLimiteTipo = "valor_fixo";
        regra.balaoValorMaximoPorBalao = String(limite?.valor ?? regraEntrada.balao.valorMaximoPorBalao ?? "");
      }
    }
  } else if (regraEntrada.tipo === "tabela_condicoes") {
    regra.valorUnidadeReferencia = String(regraEntrada.valorUnidadeReferencia ?? "");
    regra.condicoes = (regraEntrada.condicoes || []).map((item) => ({
      temDependente: Boolean(item.temDependente),
      fgtsMaisDe3Anos: Boolean(item.fgtsMaisDe3Anos),
      tipoRenda: item.tipoRenda || "",
      entrada: String(item.entrada ?? ""),
      ato: item.ato !== undefined ? String(item.ato) : "",
      parcelas: String(item.parcelas ?? ""),
      valorParcela: String(item.valorParcela ?? "")
    }));
  }

  return {
    ativo: row.ativo !== false,
    valorImovel: String(regras.valorImovel ?? ""),
    limiteMaximoEntradaParcelavel: String(regras.limiteMaximoEntradaParcelavel ?? ""),
    atoAtivo: Boolean(regras.ato?.ativo),
    atoObrigatorio: Boolean(regras.ato?.obrigatorio),
    atoTipo: regras.ato?.tipo || "valor_fixo",
    atoValor: String(regras.ato?.valor ?? ""),
    atoPercentual: regras.ato?.percentual ? String(regras.ato.percentual * 100) : "",
    atoMinimo: String(regras.ato?.minimo ?? ""),
    atoMaximo: String(regras.ato?.maximo ?? ""),
    aceitaCasaPaulista: Boolean(regras.aceitaCasaPaulista),
    documentacaoGratuita: (regras.beneficiosInformativos || []).some((item) => item.tipo === "documentacao_gratuita"),
    descontos: (regras.descontos || []).map((item) => ({ tipo: item.tipo || "outro", label: item.label || "", valor: String(item.valor ?? "") })),
    observacoes: regras.observacoes || "",
    regra
  };
}
