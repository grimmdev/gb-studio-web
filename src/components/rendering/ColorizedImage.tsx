import React, { useCallback, useEffect, useRef } from "react";
import type { ColorizedImageResult } from "./ColorizedImage.worker";
import { getSettings } from "store/features/settings/settingsState";
import { useAppSelector } from "store/hooks";
import { MonoBGPPalette, Palette } from "shared/lib/resources/types";
import { useCanvasRestoration } from "./useCanvasRestoration";

const workerPool: Worker[] = [];
const poolSize = Math.max(1, navigator?.hardwareConcurrency || 4);
for (let i = 0; i < poolSize; i++) {
  workerPool.push(
    new Worker(new URL("./ColorizedImage.worker.ts", import.meta.url)),
  );
}

interface ColorizedImageProps {
  width: number;
  height: number;
  src: string;
  tiles: number[];
  palettes: Palette[];
  previewAsMono?: boolean;
  monoBGP?: MonoBGPPalette;
}

const ColorizedImage = ({
  width,
  height,
  src,
  tiles,
  palettes,
  previewAsMono,
  monoBGP,
}: ColorizedImageProps) => {
  const colorCorrection = useAppSelector(
    (state) => getSettings(state).colorCorrection,
  );

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderEpoch = useCanvasRestoration(canvasRef);
  const workerId = useRef(Math.random());
  const worker = useRef(
    workerPool[Math.floor(workerPool.length * Math.random())],
  );

  const onWorkerComplete = useCallback(
    (e: MessageEvent<ColorizedImageResult>) => {
      if (e.data.id === workerId.current) {
        const ctx = canvasRef.current?.getContext("2d");
        if (!ctx) return;
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(e.data.canvasImage, 0, 0);
        e.data.canvasImage.close?.();
      }
    },
    [height, width],
  );

  useEffect(() => {
    const theWorker = worker.current;
    theWorker.addEventListener("message", onWorkerComplete);
    return () => {
      theWorker.removeEventListener("message", onWorkerComplete);
    };
  }, [width, height, onWorkerComplete]);

  useEffect(() => {
    if (canvasRef.current && worker.current) {
      worker.current.postMessage({
        src,
        palettes: palettes.map((p) => p.colors),
        tiles,
        width,
        height,
        previewAsMono,
        monoBGP,
        colorCorrection,
        id: workerId.current,
      });
    }
  }, [
    height,
    palettes,
    previewAsMono,
    monoBGP,
    colorCorrection,
    src,
    tiles,
    width,
    renderEpoch,
  ]);

  return <canvas ref={canvasRef} width={width} height={height} />;
};

export default ColorizedImage;
