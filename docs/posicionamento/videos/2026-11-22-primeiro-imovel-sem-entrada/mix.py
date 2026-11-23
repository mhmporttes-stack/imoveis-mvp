#!/usr/bin/env python3
"""Mixagem final: narração (narracao.wav) + efeitos sonoros (events.json) -> audio.wav (44,1 kHz estéreo).
Os efeitos abaixam sozinhos quando a voz fala (ducking). Uso: python3 mix.py frames/events.json narracao.wav audio.wav"""
import sys, json, wave, numpy as np
import sfx
SR = 44100
ev = json.load(open(sys.argv[1])); sfx_y = sfx.mix(ev)                         # pico 0,78
with wave.open(sys.argv[2]) as _w:
    sr = _w.getframerate(); voz = np.frombuffer(_w.readframes(_w.getnframes()), dtype="<i2").astype("float32") / 32768
    if _w.getnchannels() > 1: voz = voz.reshape(-1, _w.getnchannels()).mean(axis=1)
voz = np.interp(np.linspace(0, len(voz), int(len(voz)*SR/sr), endpoint=False), np.arange(len(voz)), voz)
n = max(len(sfx_y), len(voz)); S = np.zeros(n); V = np.zeros(n); S[:len(sfx_y)] = sfx_y; V[:len(voz)] = voz
env = np.convolve(np.abs(V), np.ones(int(.08*SR))/int(.08*SR), mode="same"); env = np.convolve(env, np.ones(int(.15*SR))/int(.15*SR), mode="same")
duck = 1 - .55*np.clip(env / (.35*env.max() + 1e-9), 0, 1)                      # efeito cai até 45% sob a voz
out = V * 1.0 + S * .5 * duck
out *= min(1.0, .89 / (np.max(np.abs(out)) or 1))
st = (np.clip(np.stack([out, out], 1), -1, 1) * 32767).astype("<i2")
with wave.open(sys.argv[3], "wb") as w: w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(st.tobytes())
print("ok", sys.argv[3], "dur %.1fs" % (n/SR))
