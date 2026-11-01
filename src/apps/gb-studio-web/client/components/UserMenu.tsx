import React, { useState, useEffect } from "react";
import styled from "styled-components";
import { Button } from "ui/buttons/Button";
import {
  PersonIcon,
  ShieldIcon,
  SettingsIcon,
  FolderIcon,
  EjectIcon,
} from "ui/icons/Icons";
import { eventBus } from "../api";
import { getCurrentUser, logout, CurrentUser } from "../auth";

const Container = styled.div`
  position: fixed;
  top: 6px;
  right: 12px;
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 6px;
  background: ${(props) => props.theme.colors.card.background};
  border: 1px solid ${(props) => props.theme.colors.toolbar.border};
  border-radius: ${(props) => props.theme.borderRadius || 4}px;
  padding: 3px 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  font-size: 11px;
  color: ${(props) => props.theme.colors.text};
`;

const UserInfo = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  padding-right: 6px;
  border-right: 1px solid ${(props) => props.theme.colors.toolbar.border};

  svg {
    width: 12px;
    height: 12px;
    fill: ${(props) => props.theme.colors.highlight};
  }
`;

const Username = styled.span`
  font-weight: 600;
`;

const RoleBadge = styled.span<{ role: string }>`
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 2px;
  background: ${(props) =>
    props.role === "admin"
      ? props.theme.colors.highlight
      : props.theme.colors.input.border};
  color: ${(props) =>
    props.role === "admin"
      ? props.theme.colors.highlightText
      : props.theme.colors.secondaryText};
  display: flex;
  align-items: center;
  gap: 3px;

  svg {
    width: 8px;
    height: 8px;
    fill: currentColor;
  }
`;

const Actions = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;

  button {
    height: 22px;
    padding: 0 6px;
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;

    svg {
      width: 11px;
      height: 11px;
    }
  }
`;

export const UserMenu: React.FC = () => {
  const [user, setUser] = useState<CurrentUser | null>(getCurrentUser());

  useEffect(() => {
    // Listen for session changes to update header state.
    const unsub = eventBus.on(
      "web:auth:changed",
      (updatedUser: CurrentUser | null) => {
        setUser(updatedUser);
      },
    );

    return () => {
      unsub();
    };
  }, []);

  if (!user) return null;

  return (
    <Container>
      <UserInfo>
        <PersonIcon />
        <Username>{user.username}</Username>
        <RoleBadge role={user.role}>
          {user.role === "admin" && <ShieldIcon />}
          {user.role}
        </RoleBadge>
      </UserInfo>

      <Actions>
        <Button
          small
          onClick={() => eventBus.emit("web:project-picker")}
          title="Switch Project"
        >
          <FolderIcon />
          <span>Projects</span>
        </Button>

        {user.role === "admin" && (
          <Button
            small
            onClick={() => eventBus.emit("web:admin-panel")}
            title="Administrator Settings"
          >
            <SettingsIcon />
            <span>Admin</span>
          </Button>
        )}

        <Button small onClick={() => logout()} title="Sign Out">
          <EjectIcon />
        </Button>
      </Actions>
    </Container>
  );
};
