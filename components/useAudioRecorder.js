"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { webmOpusToOgg } from "@/lib/webm-opus-to-ogg.mjs";

const MAX_SECONDS = 180;

// O WhatsApp só aceita áudio OGG/Opus, MP3, M4A/AAC ou AMR. O Chrome/Edge
// gravam WebM/Opus (convertido aqui para OGG/Opus sem recodificar), o Firefox
// grava OGG/Opus direto e o Safari grava M4A (AAC) — os três funcionam.
function pickRecorderMime() {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = ["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/mp4"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

export function audioRecordingSupported() {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && Boolean(pickRecorderMime());
}

export function useAudioRecorder() {
  const [state, setState] = useState("idle"); // idle | recording | processing
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const mimeRef = useRef("");

  const cleanup = useCallback(() => {
    clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const start = useCallback(async () => {
    setError("");
    const mime = pickRecorderMime();
    if (!mime || !navigator.mediaDevices?.getUserMedia) {
      setError("Este navegador não permite gravar áudio.");
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;
      mimeRef.current = mime;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      recorder.ondataavailable = (event) => {
        if (event.data?.size) chunksRef.current.push(event.data);
      };
      recorder.start(250);
      recorderRef.current = recorder;
      setSeconds(0);
      setState("recording");
      timerRef.current = setInterval(() => setSeconds((value) => value + 1), 1000);
      return true;
    } catch (startError) {
      cleanup();
      setState("idle");
      setError(startError?.name === "NotAllowedError" ? "Permita o uso do microfone no navegador para gravar." : "Não foi possível acessar o microfone.");
      return false;
    }
  }, [cleanup]);

  const cancel = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    cleanup();
    setState("idle");
    setSeconds(0);
  }, [cleanup]);

  // Para a gravação e devolve { blob, fileName } pronto para o WhatsApp.
  const finish = useCallback(() => new Promise((resolve) => {
    const recorder = recorderRef.current;
    if (!recorder) {
      resolve(null);
      return;
    }
    setState("processing");
    recorder.onstop = async () => {
      try {
        const type = mimeRef.current;
        const raw = new Blob(chunksRef.current, { type });
        cleanup();
        if (!raw.size) throw new Error("A gravação ficou vazia.");
        if (type.includes("webm")) {
          const ogg = webmOpusToOgg(await raw.arrayBuffer());
          resolve({ blob: new Blob([ogg], { type: "audio/ogg" }), fileName: "audio.ogg" });
        } else if (type.includes("mp4")) {
          resolve({ blob: new Blob([raw], { type: "audio/mp4" }), fileName: "audio.m4a" });
        } else {
          resolve({ blob: new Blob([raw], { type: "audio/ogg" }), fileName: "audio.ogg" });
        }
      } catch (finishError) {
        setError(finishError?.message || "Não foi possível preparar o áudio.");
        resolve(null);
      } finally {
        setState("idle");
        setSeconds(0);
      }
    };
    if (recorder.state !== "inactive") recorder.stop();
    else recorder.onstop();
  }), [cleanup]);

  useEffect(() => {
    if (state === "recording" && seconds >= MAX_SECONDS) cancel();
  }, [seconds, state, cancel]);

  return { state, seconds, error, setError, start, cancel, finish };
}
