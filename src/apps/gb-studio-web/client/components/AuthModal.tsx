import React, { useState, useEffect } from "react";
import styled from "styled-components";
import { Button } from "ui/buttons/Button";
import { Input } from "ui/form/Input";
import {
  PersonIcon,
  LockIcon,
  ShieldIcon,
  CheckIcon,
} from "ui/icons/Icons";
import { eventBus } from "../api";
import { setupAdministrator, login, checkAuthStatus } from "../auth";

const ModalOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20000;
  backdrop-filter: blur(3px);
`;

const ModalContainer = styled.div`
  background: ${(props) => props.theme.colors.card.background};
  border: 1px solid ${(props) => props.theme.colors.toolbar.border};
  border-radius: ${(props) => props.theme.borderRadius || 4}px;
  box-shadow:
    0 16px 48px rgba(0, 0, 0, 0.9),
    0 0 0 1px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  width: 440px;
  box-sizing: border-box;
`;

const ModalHeader = styled.div`
  height: 42px;
  padding: 0 14px;
  background: ${(props) => props.theme.colors.toolbar.background};
  border-bottom: 1px solid ${(props) => props.theme.colors.toolbar.border};
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;

  svg {
    width: 16px;
    height: 16px;
    fill: ${(props) => props.theme.colors.highlight};
  }
`;

const Title = styled.h3`
  margin: 0;
  font-size: ${(props) => props.theme.typography.toolbarFontSize || "13px"};
  font-weight: bold;
  color: ${(props) => props.theme.colors.text};
  letter-spacing: 0.3px;
`;

const Body = styled.div`
  padding: 20px;
  background: ${(props) => props.theme.colors.sidebar.background};
  display: flex;
  flex-direction: column;
  gap: 16px;
  color: ${(props) => props.theme.colors.text};
  font-size: ${(props) => props.theme.typography.fontSize || "12px"};
`;

const Description = styled.p`
  margin: 0;
  color: ${(props) => props.theme.colors.secondaryText};
  line-height: 1.5;
`;

const FormGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const Label = styled.label`
  font-size: 11px;
  font-weight: 600;
  color: ${(props) => props.theme.colors.text};
  display: flex;
  align-items: center;
  gap: 6px;

  svg {
    width: 12px;
    height: 12px;
    fill: ${(props) => props.theme.colors.secondaryText};
  }
`;

const ErrorBanner = styled.div`
  padding: 8px 12px;
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid rgba(239, 68, 68, 0.4);
  border-radius: ${(props) => props.theme.borderRadius || 4}px;
  color: #f87171;
  font-size: 11px;
`;

const ButtonRow = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
`;

export const AuthModal: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<"setup" | "login">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    // Verify system authentication and onboarding state on initial load.
    checkAuthStatus().then((status) => {
      if (status.setupRequired) {
        setMode("setup");
        setIsOpen(true);
      } else if (!status.authenticated) {
        setMode("login");
        setIsOpen(true);
      }
    });

    // Listen for explicit auth modal triggers.
    const unsub = eventBus.on("web:auth:show", (targetMode?: "setup" | "login") => {
      setMode(targetMode || "login");
      setErrorMsg(null);
      setIsOpen(true);
    });

    return () => {
      unsub();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!username.trim()) {
      setErrorMsg("Please enter a username.");
      return;
    }

    if (!password) {
      setErrorMsg("Please enter a password.");
      return;
    }

    if (mode === "setup") {
      if (password.length < 6) {
        setErrorMsg("Administrator password must be at least 6 characters.");
        return;
      }
      if (password !== confirmPassword) {
        setErrorMsg("Passwords do not match.");
        return;
      }

      setIsSubmitting(true);
      const res = await setupAdministrator(username, password);
      setIsSubmitting(false);

      if (res.success) {
        setIsOpen(false);
        eventBus.emit("web:auth:success", res.user);
        window.location.reload();
      } else {
        setErrorMsg(res.error || "Failed to initialize administrator account.");
      }
    } else {
      setIsSubmitting(true);
      const res = await login(username, password);
      setIsSubmitting(false);

      if (res.success) {
        setIsOpen(false);
        eventBus.emit("web:auth:success", res.user);
        window.location.reload();
      } else {
        setErrorMsg(res.error || "Invalid username or password.");
      }
    }
  };

  if (!isOpen) return null;

  return (
    <ModalOverlay>
      <ModalContainer>
        <ModalHeader>
          {mode === "setup" ? <ShieldIcon /> : <PersonIcon />}
          <Title>
            {mode === "setup"
              ? "Setup Administrator Account"
              : "Sign in to GB Studio"}
          </Title>
        </ModalHeader>
        <form onSubmit={handleSubmit}>
          <Body>
            <Description>
              {mode === "setup"
                ? "Welcome to GB Studio Web. Please create the primary administrator account to secure your self-hosted instance."
                : "Enter your credentials to access your isolated workspace and projects."}
            </Description>

            {errorMsg && <ErrorBanner>{errorMsg}</ErrorBanner>}

            <FormGroup>
              <Label>
                <PersonIcon /> Username
              </Label>
              <Input
                value={username}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setUsername(e.target.value)
                }
                placeholder="e.g. admin"
                autoFocus
                disabled={isSubmitting}
              />
            </FormGroup>

            <FormGroup>
              <Label>
                <LockIcon /> Password
              </Label>
              <Input
                type="password"
                value={password}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setPassword(e.target.value)
                }
                placeholder="••••••••"
                disabled={isSubmitting}
              />
            </FormGroup>

            {mode === "setup" && (
              <FormGroup>
                <Label>
                  <CheckIcon /> Confirm Password
                </Label>
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setConfirmPassword(e.target.value)
                  }
                  placeholder="••••••••"
                  disabled={isSubmitting}
                />
              </FormGroup>
            )}

            <ButtonRow>
              <Button type="submit" primary disabled={isSubmitting}>
                {mode === "setup" ? "Initialize Administrator" : "Sign In"}
              </Button>
            </ButtonRow>
          </Body>
        </form>
      </ModalContainer>
    </ModalOverlay>
  );
};
