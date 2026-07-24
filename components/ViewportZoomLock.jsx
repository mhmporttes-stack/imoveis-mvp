"use client";

import { useEffect } from "react";

export default function ViewportZoomLock() {
  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    function preventGesture(event) {
      event.preventDefault();
    }

    function preventMultiTouch(event) {
      if (event.touches?.length > 1) {
        event.preventDefault();
      }
    }

    function preventKeyboardZoom(event) {
      if (!event.ctrlKey && !event.metaKey) return;
      if (["+", "-", "=", "0"].includes(event.key)) {
        event.preventDefault();
      }
    }

    document.addEventListener("gesturestart", preventGesture);
    document.addEventListener("gesturechange", preventGesture);
    document.addEventListener("gestureend", preventGesture);
    document.addEventListener("touchmove", preventMultiTouch, { passive: false });
    window.addEventListener("keydown", preventKeyboardZoom);

    return () => {
      document.removeEventListener("gesturestart", preventGesture);
      document.removeEventListener("gesturechange", preventGesture);
      document.removeEventListener("gestureend", preventGesture);
      document.removeEventListener("touchmove", preventMultiTouch);
      window.removeEventListener("keydown", preventKeyboardZoom);
    };
  }, []);

  return null;
}
