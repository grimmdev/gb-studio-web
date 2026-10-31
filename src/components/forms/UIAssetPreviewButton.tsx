import React, { useState } from "react";
import styled from "styled-components";
import { useAppSelector } from "store/hooks";

interface UIAssetPreviewProps {
  path: string;
  onClick?: () => void;
}

const UIAssetPreviewButton = styled.button`
  position: relative;
  width: 128px;
  height: 112px;
  background-size: cover;
  background-color: #ccc;
  border-radius: 4px;
  border: 0px;
  display: block;
  padding: 0;

  &:hover:after {
    content: "";
    display: block;
    width: 128px;
    height: 112px;
    position: absolute;
    top: 0;
    left: 0;
    background: rgba(0, 0, 0, 0.4);
    border-radius: 4px;
  }

  img {
    display: block;
    width: 128px;
    height: 112px;
    border-radius: 4px;
    image-rendering: pixelated;
  }
`;

const UIAssetError = styled.div`
  font-size: 12px;
`;

export const UIAssetPreview = ({ path, onClick }: UIAssetPreviewProps) => {
  const [error, setError] = useState(false);
  const uiVersion = useAppSelector((state) => state.editor.uiVersion);

  if (error) {
    return <UIAssetError>Image will be created after next build.</UIAssetError>;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isWeb =
    typeof window !== "undefined" &&
    ((window as any).API?.env === "web" ||
      (Boolean(window.location?.protocol?.startsWith("http")) &&
        !navigator?.userAgent?.includes("Electron")));
  const base = isWeb ? "/api/assets/project" : "gbs://project";

  return (
    <UIAssetPreviewButton onError={() => setError(true)} onClick={onClick}>
      <img
        onError={() => console.log("IMG ERROR")}
        src={`${base}/assets/${path}?_v=${uiVersion}`}
        alt=""
      />
    </UIAssetPreviewButton>
  );
};
