#!/usr/bin/env python3
"""Corta UM áudio de locução inteira (gerado por qualquer voz: CapCut, ElevenLabs, a voz do dono...) em uma fala por frase de locucao.json,
alinhando o texto do roteiro ao que foi dito (transcrição com tempo por palavra: faster-whisper). Uso interno de voz.py (--audio).
Requer: faster-whisper, num2words, numpy, soundfile."""
import re, subprocess, difflib, numpy as np, soundfile as sf
from num2words import num2words
SR = 24000
def norm(t): return re.sub(r"[^a-zà-ú0-9]", "", t.lower())
def _extenso(w):
    # "86" -> ["oitenta","e","seis"]; "1.800" -> ["mil","e","oitocentos"]; "30%" -> ["trinta","por","cento"]
    m = re.fullmatch(r"r?\$?\s*([\d\.\,]+)\s*(%?)", w.strip().lower())
    if not m: return None
    n = m.group(1); n = n.replace(".", "").replace(",", ".")
    try: v = float(n)
    except ValueError: return None
    v = int(v) if v == int(v) else v
    txt = num2words(v, lang="pt_BR") + (" por cento" if m.group(2) else "")
    return [norm(x) for x in txt.split() if norm(x)]
def _script_tokens(fala):
    t = re.sub(r"i pê tê u", "iptu", fala.lower())
    return [norm(x) for x in t.split() if norm(x)]
def cortar(path, chunks, whisper_model="small"):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", path, "-ar", "16000", "-ac", "1", "/tmp/_loc16.wav"], check=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", path, "-ar", str(SR), "-ac", "1", "/tmp/_loc24.wav"], check=True)
    from faster_whisper import WhisperModel
    y16, _ = sf.read("/tmp/_loc16.wav", dtype="float32"); y, _ = sf.read("/tmp/_loc24.wav", dtype="float32")
    seg, _ = WhisperModel(whisper_model, device="cpu", compute_type="int8").transcribe(y16, language="pt", beam_size=5, word_timestamps=True)
    heard = []   # (token, start, end)
    for s in seg:
        for w in s.words:
            ex = _extenso(w.word)
            toks = ex if ex else ([norm(w.word)] if norm(w.word) else [])
            for k, tk in enumerate(toks):
                dur = (w.end - w.start) / len(toks); heard.append((tk, w.start + k*dur, w.start + (k+1)*dur))
    S, owner = [], []
    for ci, c in enumerate(chunks):
        for tk in _script_tokens(c["fala"]): S.append(tk); owner.append(ci)
    sm = difflib.SequenceMatcher(None, S, [h[0] for h in heard], autojunk=False)
    found = {}
    for a, b, n in sm.get_matching_blocks():
        for k in range(n):
            ci = owner[a+k]; st, en = heard[b+k][1], heard[b+k][2]
            lo, hi = found.get(ci, (st, en)); found[ci] = (min(lo, st), max(hi, en))
    # frases sem correspondência: interpola entre as vizinhas
    times = [found.get(i) for i in range(len(chunks))]
    for i, t in enumerate(times):
        if t is None:
            prev = next((times[j] for j in range(i-1, -1, -1) if times[j]), (0.0, 0.0)); nxt = next((times[j] for j in range(i+1, len(times)) if times[j]), (len(y)/SR, len(y)/SR))
            times[i] = (prev[1] + 0.02, max(prev[1] + 0.3, nxt[0] - 0.02)); print("  (aviso) frase %s sem correspondência exata; tempo interpolado" % chunks[i]["id"])
    clips = {}
    for i, c in enumerate(chunks):
        lo_cut = (times[i-1][1] + times[i][0]) / 2 if i > 0 else 0.0
        hi_cut = (times[i][1] + times[i+1][0]) / 2 if i < len(chunks)-1 else len(y)/SR
        a = max(times[i][0] - 0.08, lo_cut); b = min(times[i][1] + 0.18, hi_cut)
        clips[c["id"]] = np.asarray(y[int(a*SR):int(b*SR)], dtype="float32")
    return clips, times
