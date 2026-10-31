import { useState, useEffect, RefObject } from "react";

// Manage canvas context recovery and tab visibility invalidation.
export const useCanvasRestoration = (
  canvasRef?: RefObject<HTMLCanvasElement | null>,
): number => {
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    const handleVisible = () => {
      if (document.visibilityState === "visible") {
        setEpoch((prev) => prev + 1);
      }
    };

    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("focus", handleVisible);

    const canvas = canvasRef?.current;
    const onContextLost = (e: Event) => {
      e.preventDefault();
    };
    const onContextRestored = () => {
      setEpoch((prev) => prev + 1);
    };

    if (canvas) {
      canvas.addEventListener("contextlost", onContextLost);
      canvas.addEventListener("contextrestored", onContextRestored);
    }

    return () => {
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("focus", handleVisible);
      if (canvas) {
        canvas.removeEventListener("contextlost", onContextLost);
        canvas.removeEventListener("contextrestored", onContextRestored);
      }
    };
  }, [canvasRef]);

  return epoch;
};

