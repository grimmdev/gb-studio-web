import React, { useState, useEffect } from "react";
import styled from "styled-components";
import { Button } from "ui/buttons/Button";
import { CloseIcon } from "ui/icons/Icons";
import { eventBus } from "../api";

const ModalOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.75);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  backdrop-filter: blur(2px);
`;

const ModalContainer = styled.div`
  background: ${(props) => props.theme.colors.card.background};
  border: 1px solid ${(props) => props.theme.colors.toolbar.border};
  border-radius: ${(props) => props.theme.borderRadius || 4}px;
  box-shadow:
    0 12px 36px rgba(0, 0, 0, 0.8),
    0 0 0 1px rgba(0, 0, 0, 0.4);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  width: 560px;
  height: 540px;
`;

const ModalHeader = styled.div`
  height: 38px;
  padding: 0 12px;
  background: ${(props) => props.theme.colors.toolbar.background};
  border-bottom: 1px solid ${(props) => props.theme.colors.toolbar.border};
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
`;

const Title = styled.h3`
  margin: 0;
  font-size: ${(props) => props.theme.typography.toolbarFontSize || "13px"};
  font-weight: bold;
  color: ${(props) => props.theme.colors.text};
  display: flex;
  align-items: center;
  gap: 8px;
`;

const StatusDot = styled.span`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #4ade80;
  display: inline-block;
  box-shadow: 0 0 6px #4ade80;
`;

const HeaderControls = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`;

const HeaderCloseButton = styled.button`
  background: transparent;
  border: 0;
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: ${(props) => props.theme.borderRadius || 4}px;

  svg {
    fill: ${(props) => props.theme.colors.text};
    width: 12px;
    height: 12px;
  }

  &:hover {
    background: ${(props) => props.theme.colors.button.activeBackground};
    svg {
      fill: ${(props) => props.theme.colors.highlight};
    }
  }
`;

const FrameContainer = styled.div`
  flex: 1;
  background: #000;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const StyledIframe = styled.iframe`
  width: 100%;
  height: 100%;
  border: none;
`;

export const WebPlayModal: React.FC = () => {
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  const [isDebug, setIsDebug] = useState(false);
  const [key, setKey] = useState(0);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unsub = eventBus.on("web:play", (_event: unknown, data: any) => {
      setPlayUrl(data?.url || "/api/preview/index.html");
      setIsDebug(Boolean(data?.debug));
      setKey((k) => k + 1);
    });
    return unsub;
  }, []);

  const handleClose = () => {
    setPlayUrl(null);
    eventBus.emit("debugger:disconnected");
  };

  if (!playUrl) {
    return null;
  }

  const iframeSrc = `${playUrl}?audio=true&debug=${
    isDebug ? "true" : "false"
  }&t=${key}`;

  return (
    <ModalOverlay onClick={handleClose}>
      <ModalContainer onClick={(e) => e.stopPropagation()}>
        <ModalHeader>
          <Title>
            <StatusDot /> Game Boy Player
          </Title>
          <HeaderControls>
            <Button size="small" onClick={() => setKey((k) => k + 1)}>
              Restart
            </Button>
            <Button
              size="small"
              onClick={() => window.open(iframeSrc, "_blank")}
            >
              Open in Tab
            </Button>
            <HeaderCloseButton onClick={handleClose} title="Close">
              <CloseIcon />
            </HeaderCloseButton>
          </HeaderControls>
        </ModalHeader>
        <FrameContainer>
          <StyledIframe key={key} src={iframeSrc} allow="autoplay" />
        </FrameContainer>
      </ModalContainer>
    </ModalOverlay>
  );
};
