// Qualidade adaptativa: mede o dt do rAF numa janela de 1,5 s. Mediana > 24 ms OU
// > 10% dos quadros > 33 ms sobe um nível; estável por 6 s, desce.
//   N1: sem nuvens e skyline distante · N2: + sem primeiro plano e brilho das janelas
//   N3: + sem skyline do meio.
// A câmera, os andares acendendo e as transições NUNCA caem de nível.
export function createQuality(onChange) {
  const QS = { q: 0, base: 0, win: [], lastEval: 0, lastChange: -1e9, okSince: 0, noRecover: false, lastRecover: -1e9, log: [] };
  const set = (n, t) => { QS.q = n; QS.log.push([Math.round(t || 0), n]); onChange(n); };
  return {
    get level() { return QS.q; },
    get log() { return QS.log; },
    setBase(n) { QS.base = n; set(n, 0); },
    reset() { QS.win.length = 0; QS.okSince = 0; },
    sample(raw, t, reduced) {
      if (document.hidden || reduced || raw > 250) return;
      const w = QS.win;
      w.push([t, raw]);
      while (w.length && t - w[0][0] > 1500) w.shift();
      if (t - QS.lastEval < 350 || w.length < 18) return;
      QS.lastEval = t;
      const a = w.map((x) => x[1]).sort((x, y) => x - y), med = a[a.length >> 1], f = a.filter((x) => x > 33.4).length / a.length;
      if ((med > 24 || f > 0.1) && QS.q < 3 && t - QS.lastChange > 900) {
        if (t - QS.lastRecover < 9000) QS.noRecover = true;
        set(QS.q + 1, t); QS.lastChange = t; QS.okSince = 0; w.length = 0;
      } else if (QS.q > QS.base && !QS.noRecover && med < 19 && f < 0.03) {
        if (!QS.okSince) QS.okSince = t;
        else if (t - QS.okSince > 6000 && t - QS.lastChange > 6000) { set(QS.q - 1, t); QS.lastChange = t; QS.lastRecover = t; QS.okSince = 0; w.length = 0; }
      } else QS.okSince = 0;
    }
  };
}
