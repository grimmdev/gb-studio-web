import React, { useState, useEffect, useCallback } from "react";
import styled from "styled-components";
import { Button } from "ui/buttons/Button";
import { Input } from "ui/form/Input";
import {
  SettingsIcon,
  PersonIcon,
  PlusIcon,
  TrashIcon,
  ShieldIcon,
  CloseIcon,
  LockIcon,
} from "ui/icons/Icons";
import { eventBus } from "../api";
import { getCurrentUser, getStoredToken } from "../auth";

const getAdminHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const token = getStoredToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
};

interface AdminUserItem {
  id: string;
  username: string;
  role: "admin" | "user";
  created_at: number;
  projectCount: number;
}

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
  z-index: 25000;
  backdrop-filter: blur(2px);
`;

const ModalContainer = styled.div`
  background: ${(props) => props.theme.colors.card.background};
  border: 1px solid ${(props) => props.theme.colors.toolbar.border};
  border-radius: ${(props) => props.theme.borderRadius || 4}px;
  box-shadow:
    0 16px 48px rgba(0, 0, 0, 0.8),
    0 0 0 1px rgba(0, 0, 0, 0.4);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  width: 640px;
  max-height: 85vh;
  box-sizing: border-box;
`;

const ModalHeader = styled.div`
  height: 40px;
  padding: 0 14px;
  background: ${(props) => props.theme.colors.toolbar.background};
  border-bottom: 1px solid ${(props) => props.theme.colors.toolbar.border};
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
`;

const HeaderTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: ${(props) => props.theme.typography.toolbarFontSize || "13px"};
  font-weight: bold;
  color: ${(props) => props.theme.colors.text};

  svg {
    width: 14px;
    height: 14px;
    fill: ${(props) => props.theme.colors.highlight};
  }
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

const Body = styled.div`
  padding: 18px;
  background: ${(props) => props.theme.colors.sidebar.background};
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
  color: ${(props) => props.theme.colors.text};
  font-size: ${(props) => props.theme.typography.fontSize || "11px"};
`;

const SectionHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 6px;
  border-bottom: 1px solid ${(props) => props.theme.colors.input.border};
`;

const SectionTitle = styled.h4`
  margin: 0;
  font-size: 11px;
  font-weight: bold;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: ${(props) => props.theme.colors.secondaryText};
  display: flex;
  align-items: center;
  gap: 6px;

  svg {
    width: 12px;
    height: 12px;
    fill: ${(props) => props.theme.colors.secondaryText};
  }
`;

const UserList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const UserItem = styled.div`
  background: ${(props) => props.theme.colors.card.background};
  border: 1px solid ${(props) => props.theme.colors.input.border};
  padding: 10px 12px;
  border-radius: ${(props) => props.theme.borderRadius || 4}px;
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const UserMeta = styled.div`
  display: flex;
  flex-direction: column;
  gap: 3px;
`;

const UserNameRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const UserName = styled.span`
  font-weight: 600;
  font-size: 12px;
  color: ${(props) => props.theme.colors.text};
`;

const RoleBadge = styled.span<{ role: string }>`
  font-size: 9px;
  padding: 1px 6px;
  border-radius: 2px;
  font-weight: bold;
  text-transform: uppercase;
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
  gap: 4px;

  svg {
    width: 9px;
    height: 9px;
    fill: currentColor;
  }
`;

const UserSub = styled.span`
  font-size: 10px;
  color: ${(props) => props.theme.colors.secondaryText};
`;

const ActionRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;

  button {
    height: 24px;
    padding: 0 8px;
    font-size: 10px;
  }

  svg {
    width: 11px;
    height: 11px;
  }
`;

const CreateUserCard = styled.div`
  background: ${(props) => props.theme.colors.card.background};
  border: 1px solid ${(props) => props.theme.colors.input.border};
  padding: 14px;
  border-radius: ${(props) => props.theme.borderRadius || 4}px;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const FormRow = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
`;

const StyledSelect = styled.select`
  background: ${(props) => props.theme.colors.input.background};
  color: ${(props) => props.theme.colors.input.text};
  border: 1px solid ${(props) => props.theme.colors.input.border};
  border-radius: ${(props) => props.theme.borderRadius || 4}px;
  padding: 0 10px;
  height: 28px;
  font-size: ${(props) => props.theme.typography.fontSize || "11px"};
  outline: none;

  &:focus {
    border-color: ${(props) => props.theme.colors.highlight};
  }
`;

export const AdminModal: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"user" | "admin">("user");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/users", {
        headers: getAdminHeaders(),
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      }
    } catch (err) {
      console.error("Failed fetching admin users:", err);
    }
  }, []);

  useEffect(() => {
    const onOpen = () => {
      setErrorMsg(null);
      setShowCreate(false);
      fetchUsers();
      setIsOpen(true);
    };

    const unsub = eventBus.on("web:admin-panel", onOpen);
    window.addEventListener("web:admin-panel", onOpen);

    return () => {
      unsub();
      window.removeEventListener("web:admin-panel", onOpen);
    };
  }, [fetchUsers]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!newUsername.trim() || newPassword.length < 6) {
      setErrorMsg("Username must be valid and password at least 6 characters.");
      return;
    }

    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: getAdminHeaders(),
        credentials: "include",
        body: JSON.stringify({
          username: newUsername.trim(),
          password: newPassword,
          role: newRole,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || "Failed to create user.");
        return;
      }
      setNewUsername("");
      setNewPassword("");
      setShowCreate(false);
      fetchUsers();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteUser = async (userId: string, username: string) => {
    if (
      !window.confirm(`Delete account "${username}" and revoke project access?`)
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "DELETE",
        headers: getAdminHeaders(),
        credentials: "include",
      });
      if (res.ok) {
        fetchUsers();
      }
    } catch (err) {
      console.error("Failed deleting user:", err);
    }
  };

  const handleResetPassword = async (userId: string, username: string) => {
    const newPass = window.prompt(`Enter new password for "${username}":`);
    if (!newPass || newPass.length < 6) {
      if (newPass) window.alert("Password must be at least 6 characters.");
      return;
    }
    try {
      const res = await fetch(`/api/admin/users/${userId}/password`, {
        method: "PATCH",
        headers: getAdminHeaders(),
        credentials: "include",
        body: JSON.stringify({ password: newPass }),
      });
      if (res.ok) {
        window.alert(`Password updated for "${username}".`);
      }
    } catch (err) {
      console.error("Failed resetting password:", err);
    }
  };

  if (!isOpen) return null;

  const currentUser = getCurrentUser();

  return (
    <ModalOverlay>
      <ModalContainer>
        <ModalHeader>
          <HeaderTitle>
            <SettingsIcon />
            <span>Administrator Workspace Management</span>
          </HeaderTitle>
          <HeaderCloseButton onClick={() => setIsOpen(false)}>
            <CloseIcon />
          </HeaderCloseButton>
        </ModalHeader>

        <Body>
          <SectionHeader>
            <SectionTitle>
              <PersonIcon /> Registered Users ({users.length})
            </SectionTitle>
            <Button
              small
              onClick={() => setShowCreate(!showCreate)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <PlusIcon />
              <span>{showCreate ? "Cancel" : "Add User"}</span>
            </Button>
          </SectionHeader>

          {errorMsg && (
            <div style={{ color: "#f87171", fontSize: "11px" }}>{errorMsg}</div>
          )}

          {showCreate && (
            <CreateUserCard>
              <form onSubmit={handleCreateUser}>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                  }}
                >
                  <FormRow>
                    <Input
                      placeholder="Username"
                      value={newUsername}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setNewUsername(e.target.value)
                      }
                      autoFocus
                    />
                    <Input
                      type="password"
                      placeholder="Password (min 6 chars)"
                      value={newPassword}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setNewPassword(e.target.value)
                      }
                    />
                    <StyledSelect
                      value={newRole}
                      onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                        setNewRole(e.target.value as "user" | "admin")
                      }
                    >
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                    </StyledSelect>
                  </FormRow>
                  <ButtonRow>
                    <Button small primary type="submit">
                      Create Account
                    </Button>
                  </ButtonRow>
                </div>
              </form>
            </CreateUserCard>
          )}

          <UserList>
            {users.map((u) => (
              <UserItem key={u.id}>
                <UserMeta>
                  <UserNameRow>
                    <UserName>{u.username}</UserName>
                    <RoleBadge role={u.role}>
                      {u.role === "admin" && <ShieldIcon />}
                      {u.role}
                    </RoleBadge>
                  </UserNameRow>
                  <UserSub>
                    {u.projectCount}{" "}
                    {u.projectCount === 1 ? "project" : "projects"} · Created{" "}
                    {new Date(u.created_at).toLocaleDateString()}
                  </UserSub>
                </UserMeta>

                <ActionRow>
                  <Button
                    small
                    onClick={() => handleResetPassword(u.id, u.username)}
                    title="Reset Password"
                  >
                    <LockIcon />
                  </Button>
                  {currentUser?.id !== u.id && (
                    <Button
                      small
                      onClick={() => handleDeleteUser(u.id, u.username)}
                      title="Delete User"
                    >
                      <TrashIcon />
                    </Button>
                  )}
                </ActionRow>
              </UserItem>
            ))}
          </UserList>
        </Body>
      </ModalContainer>
    </ModalOverlay>
  );
};
