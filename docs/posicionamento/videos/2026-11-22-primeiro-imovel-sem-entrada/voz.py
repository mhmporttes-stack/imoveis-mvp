#!/usr/bin/env python3
"""Locução por frase (Kokoro, pt-BR, gratuito/local) + linha do tempo que sincroniza a animação com a fala.
Entrada: locucao.json. Saídas: narracao.wav (24 kHz mono), timeline.js (window.TL), locucao-tempos.json.
Se existir voz-dono/<id>.wav (gravação do dono por frase), ela substitui a voz sintética daquela frase.
Variáveis: KOKORO_DIR (modelos; baixa sozinho na 1ª vez), VOZ (pm_alex|pm_santa|pf_dora), VEL (velocidade).
Uso: python3 voz.py [--sem-voz | --audio locucao-inteira.mp3]   (--sem-voz: só a linha do tempo; --audio: corta UM áudio inteiro por frase e sincroniza — qualquer voz)"""
import json, os, sys, subprocess, numpy as np, soundfile as sf
SEM_VOZ = "--sem-voz" in sys.argv
AUDIO = sys.argv[sys.argv.index("--audio") + 1] if "--audio" in sys.argv else None   # locução inteira num arquivo só (qualquer voz)
D = json.load(open("locucao.json", encoding="utf-8"))
VOZ = os.environ.get("VOZ", D.get("voz", "pm_alex")); VEL = float(os.environ.get("VEL", D.get("velocidade", 1.08)))
SR = 24000
# janelas de roteiro coladas (b == a da próxima) ganham uma folga de 0,12 s no tempo do roteiro, que vira a pausa real entre as falas
for _i in range(len(D["chunks"]) - 1):
    if D["chunks"][_i+1]["a"] - D["chunks"][_i]["b"] < 0.02: D["chunks"][_i]["b"] = round(D["chunks"][_i]["b"] - 0.12, 3)
def baixar(dest, url):
    if os.path.exists(dest): return
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    cmd = ["curl", "-sL", "-o", dest, url]
    if os.path.exists("/root/.ccr/ca-bundle.crt"): cmd[1:1] = ["--cacert", "/root/.ccr/ca-bundle.crt"]
    subprocess.run(cmd, check=True)
def trim(y, thr=0.01):
    idx = np.where(np.abs(y) > thr)[0]
    return y[max(0, idx[0] - int(.02*SR)): idx[-1] + int(.06*SR)] if len(idx) else y
clips = {}
if AUDIO:
    import alinhar
    clips, _t = alinhar.cortar(AUDIO, D["chunks"])
elif not SEM_VOZ:
    kd = os.environ.get("KOKORO_DIR", os.path.expanduser("~/.cache/kokoro"))
    base = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
    baixar(f"{kd}/kokoro-v1.0.onnx", base + "kokoro-v1.0.onnx"); baixar(f"{kd}/voices-v1.0.bin", base + "voices-v1.0.bin")
    from kokoro_onnx import Kokoro
    k = Kokoro(f"{kd}/kokoro-v1.0.onnx", f"{kd}/voices-v1.0.bin")
    def gerar(txt, vel):
        y, _ = k.create(txt, voice=VOZ, speed=vel, lang="pt-br"); return np.asarray(y, dtype="float32")
    def dividir_na_pausa(y):
        """corta uma fala longa na maior pausa interna (entre 0,25 s e fim-0,5 s)"""
        fr = int(.01*SR); e = np.array([np.sqrt(np.mean(y[i:i+fr]**2)) for i in range(0, len(y)-fr, fr)]); thr = .03*e.max()
        lo, hi = int(.25/.01), len(e) - int(.5/.01); best = (0, None)
        i = lo
        while i < hi:
            if e[i] < thr:
                j = i
                while j < hi and e[j] < thr: j += 1
                if j - i > best[0]: best = (j - i, (i, j))
                i = j
            else: i += 1
        assert best[1], "sem pausa interna para dividir"
        i, j = best[1]; return y[:(i+4)*fr], y[(j-3)*fr:]
    for c in D["chunks"]:
        if c["id"] in clips: continue
        own = f"voz-dono/{c['id']}.wav"
        if os.path.exists(own):
            y, sr = sf.read(own, dtype="float32");  y = y.mean(axis=1) if y.ndim > 1 else y
            if sr != SR: y = np.interp(np.linspace(0, len(y), int(len(y)*SR/sr), endpoint=False), np.arange(len(y)), y)
            clips[c["id"]] = trim(np.asarray(y, dtype="float32")); continue
        vel = c.get("vel", VEL)
        if c.get("junto_com"):      # duas frases geradas juntas (prosódia natural) e cortadas na pausa
            a, b = dividir_na_pausa(gerar(c["fala_junta"], vel)); clips[c["id"]] = trim(a); clips[c["junto_com"]] = trim(b)
        else:
            clips[c["id"]] = trim(gerar(c["fala"], vel))
# tempos reais
t = D["inicio"]; anchors = [[0.0, 0.0]]; rows = []; prev_scene = None; out_end = 0
for i, c in enumerate(D["chunks"]):
    dur = ((len(clips[c["id"]]) / SR + .04) if clips else (c["b"] - c["a"])) + c.get("reter", 0)
    if i == 0: gap = 0
    else: gap = c.get("pausa_antes", D["gap_cena"] if c["cena"] != prev_scene else D["gap_frase"])
    t = (D["inicio"] if i == 0 else t + gap)
    anchors += [[c["a"], round(t, 4)], [c["b"], round(t + dur, 4)]]
    rows.append({"id": c["id"], "script": [c["a"], c["b"]], "real": [round(t, 3), round(t + dur, 3)], "escala": round(dur / (c["b"] - c["a"]), 2), "fala": c["fala"]})
    t += dur; prev_scene = c["cena"]
real_end = t + D["cauda"]; anchors.append([D["fim_script"], round(real_end, 4)])
for i in range(1, len(anchors)):   # monotonia
    assert anchors[i][0] > anchors[i-1][0] and anchors[i][1] > anchors[i-1][1], ("âncoras fora de ordem", anchors[i-1], anchors[i])
chunks = [{"id": c["id"], "a": c["a"], "b": c["b"], "cap": c["cap"]} for c in D["chunks"]]
open("timeline.js", "w", encoding="utf-8").write("window.TL=" + json.dumps({"anchors": anchors, "chunks": chunks, "duration": round(real_end, 3)}, ensure_ascii=False) + ";\n")
json.dump(rows, open("locucao-tempos.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
if clips:
    nar = np.zeros(int((real_end + .5) * SR), dtype="float32")
    for r in rows:
        y = clips[r["id"]].copy(); f = int(.006*SR); y[:f] *= np.linspace(0, 1, f); y[-f:] *= np.linspace(1, 0, f)
        o = int(r["real"][0] * SR); nar[o:o+len(y)] += y[:len(nar)-o]
    nar *= min(1.0, .9 / (np.max(np.abs(nar)) or 1)); sf.write("narracao.wav", nar, SR)
print(f"duração total {real_end:.1f}s | voz {VOZ if clips else '(sem voz)'}")
for r in rows: print(f"  {r['id']} real {r['real'][0]:5.2f}–{r['real'][1]:5.2f}  escala {r['escala']:.2f}  {r['fala']}")
