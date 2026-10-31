import React, { useCallback, useEffect, useRef } from "react";
import type { AutoColorizedImageResult } from "./AutoColorizedImage.worker";
import { getSettings } from "store/features/settings/settingsState";
import { useAppSelector } from "store/hooks";
import { MonoBGPPalette, Palette } from "shared/lib/resources/types";
import { useCanvasRestoration } from "./useCanvasRestoration";

const workerPool: Worker[] = [];
const poolSize = Math.max(1, navigator?.hardwareConcurrency || 4);
for (let i = 0; i < poolSize; i++) {
  workerPool.push(
    new Worker(new URL("./AutoColorizedImage.worker.ts", import.meta.url)),
  );
}

interface AutoColorizedImageProps {
  width: number;
  height: number;
  src: string;
  tilesSrc?: string;
  uiPalette?: Palette;
  previewAsMono?: boolean;
  monoBGP?: MonoBGPPalette;
}

const AutoColorizedImage = ({
  width,
  height,
  src,
  tilesSrc,
  uiPalette,
  previewAsMono,
  monoBGP,
}: AutoColorizedImageProps) => {
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
    (e: MessageEvent<AutoColorizedImageResult>) => {
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
        tilesSrc,
        width,
        height,
        previewAsMono,
        colorCorrection,
        uiPalette: uiPalette ? uiPalette.colors : undefined,
        monoBGP,
        id: workerId.current,
      });
    }
  }, [
    height,
    src,
    tilesSrc,
    width,
    previewAsMono,
    monoBGP,
    colorCorrection,
    uiPalette,
    renderEpoch,
  ]);

  return <canvas ref={canvasRef} width={width} height={height} />;
};

export default AutoColorizedImage;
