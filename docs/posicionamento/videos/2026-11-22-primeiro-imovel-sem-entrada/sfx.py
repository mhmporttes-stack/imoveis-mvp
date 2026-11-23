#!/usr/bin/env python3
"""Efeitos sonoros sintetizados (sem áudio de terceiros) + mixagem pela lista de eventos da cena.
Uso: python3 sfx.py <events.json> <saida.wav>        (events.json = {"duration":s,"events":[{"t":seg,"s":"pop"},...]})
Sons: tick, click, pop, boing (pulo), thud / thud_s (pouso), whoosh, swipe, ding, buzz (erro), sparkle, coin, tear, womp."""
import sys, json, wave
import numpy as np
SR = 44100
rng = np.random.default_rng(7)
T = lambda d: np.arange(int(SR * d)) / SR
def lowpass(x, fc):
    a = 1 - np.exp(-2 * np.pi * np.asarray(fc) / SR); a = np.broadcast_to(a, x.shape); y = np.empty_like(x); acc = 0.0
    for i in range(len(x)): acc += a[i] * (x[i] - acc); y[i] = acc
    return y
def sweep(f): return np.sin(2 * np.pi * np.cumsum(f) / SR)
def atk(t, a): return np.minimum(t / a, 1.0)

def tick():  t = T(.05); return (np.sin(2*np.pi*1900*t)*np.exp(-t*150)*.5 + .25*rng.standard_normal(len(t))*np.exp(-t*450))
def click(): t = T(.09); return (np.sin(2*np.pi*1500*t)*np.exp(-t*95)*.55 + np.sin(2*np.pi*700*t)*np.exp(-t*60)*.3 + .35*rng.standard_normal(len(t))*np.exp(-t*650))
def pop():   t = T(.15); return sweep(240+950*np.exp(-t*32))*np.exp(-t*27)*atk(t,.001)*.95 + .12*rng.standard_normal(len(t))*np.exp(-t*220)
def boing(): t = T(.6);  f = 190+400*np.exp(-t*7)+70*np.sin(2*np.pi*10*t)*np.exp(-t*5.5); return (sweep(f)+.3*sweep(2*f))*np.exp(-t*5.2)*atk(t,.004)*.75
def thud(g=1.0, d=.26):
    t = T(d); y = sweep(115*np.exp(-t*9)+44)*np.exp(-t*13)*1.0 + lowpass(rng.standard_normal(len(t)), 650)*np.exp(-t*38)*.55; return y*g
def whoosh(d=.42, f0=300, f1=4500):
    t = T(d); x = rng.standard_normal(len(t)); fc = f0 * (f1 / f0) ** (t / d); y = lowpass(x, fc); y = y - lowpass(y, 160)
    return y * np.sin(np.pi * t / d) ** 2 * 2.0
def ding():  t = T(1.0); return (np.sin(2*np.pi*1175*t) + .5*np.sin(2*np.pi*1760*t) + .22*np.sin(2*np.pi*2349*t)) * np.exp(-t*5.2) * atk(t,.003) * .45
def buzz():
    t = T(.32); saw = 2*((140*t) % 1) - 1; saw2 = 2*((143.5*t) % 1) - 1; y = lowpass((saw+saw2)*.5, 1100)
    return y * atk(t,.012) * np.exp(-t*5.5) * (.75+.25*np.sin(2*np.pi*26*t)) * .9
def coin():
    out = np.zeros(int(SR*.30))
    for i, f in enumerate((1568, 2349)):
        t = T(.22); y = (np.sin(2*np.pi*f*t) + .3*np.sin(2*np.pi*2*f*t))*np.exp(-t*16)*atk(t,.001)*.45; o = int(i*.055*SR); out[o:o+len(y)] += y[:len(out)-o]
    return out
def tear():
    t = T(.38); n = rng.standard_normal(len(t)); y = n - lowpass(n, 1800); am = (.55+.45*np.sin(2*np.pi*70*t+np.cumsum(rng.standard_normal(len(t)))*.05)); return y*am*np.exp(-((t-.12)/.14)**2)*.9
def womp():
    t = T(.95); f = np.where(t < .30, 340-90*t/.30, np.where(t < .34, 250, 250-85*(t-.34)/.61)); f = f*(1+.03*np.sin(2*np.pi*5.5*t))
    saw = 2*((np.cumsum(f)/SR) % 1) - 1; y = lowpass(saw, 850); env = atk(t,.02)*np.where(t < .32, 1, .9)*np.exp(-np.maximum(t-.55, 0)*7); return y*env*.9
def sparkle():
    out = np.zeros(int(SR*.6))
    for i, f in enumerate((1046, 1318, 1568, 2093)):
        t = T(.28); s = np.sin(2*np.pi*f*t)*np.exp(-t*11)*atk(t,.002)*.35; o = int(i*.07*SR); out[o:o+len(s)] += s[:len(out)-o]
    return out

BANK = {"tick": (tick, .32), "click": (click, .7), "pop": (pop, .7), "boing": (boing, .8), "thud": (lambda: thud(1.0), .9),
        "thud_s": (lambda: thud(.6, .2), .6), "whoosh": (whoosh, .42), "swipe": (lambda: whoosh(.22, 700, 6500), .38),
        "ding": (ding, .55), "buzz": (buzz, .3), "sparkle": (sparkle, .5), "coin": (coin, .55), "tear": (tear, .5), "womp": (womp, .6)}
def mix(ev):
    n = int(SR * (ev["duration"] + .4)); out = np.zeros(n); cache = {}
    for e in ev["events"]:
        fn, g = BANK[e["s"]]; y = cache.setdefault(e["s"], fn()); o = int(e["t"] * SR); g = e.get("g", 1.0) * g
        m = min(len(y), n - o); out[o:o+m] += y[:m] * g
    pk = np.max(np.abs(out)) or 1; out *= min(1.0, .78 / pk)
    f = int(.05 * SR); out[-f:] *= np.linspace(1, 0, f)
    return out
if __name__ == "__main__":
    ev = json.load(open(sys.argv[1])); y = mix(ev)
    st = np.stack([y, y], 1); pcm = (np.clip(st, -1, 1) * 32767).astype("<i2")
    with wave.open(sys.argv[2], "wb") as w: w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
    print("ok", sys.argv[2], "eventos:", len(ev["events"]), "pico:", float(np.max(np.abs(y))))
