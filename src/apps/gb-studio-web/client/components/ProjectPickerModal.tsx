import React, { useState, useEffect } from "react";
import styled from "styled-components";
import { Button } from "ui/buttons/Button";
import { Input } from "ui/form/Input";
import { CloseIcon, PersonIcon } from "ui/icons/Icons";
import { getCurrentUser } from "../auth";
import { eventBus } from "../api";
import { useAppSelector } from "store/hooks";

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
  width: 580px;
  max-height: 82vh;
  box-sizing: border-box;
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
  letter-spacing: 0.3px;
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
  padding: 16px;
  background: ${(props) => props.theme.colors.sidebar.background};
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
  color: ${(props) => props.theme.colors.text};
  font-size: ${(props) => props.theme.typography.fontSize || "11px"};
`;

const SectionHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 6px;
  margin-bottom: 8px;
  border-bottom: 1px solid ${(props) => props.theme.colors.input.border};
`;

const SectionTitle = styled.h4`
  margin: 0;
  font-size: 11px;
  font-weight: bold;
  color: ${(props) => props.theme.colors.secondaryText};
  text-transform: uppercase;
  letter-spacing: 0.5px;
`;

const ProjectList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const ProjectCard = styled.div<{ active?: boolean }>`
  background: ${(props) =>
    props.active
      ? props.theme.colors.sidebar.well.background
      : props.theme.colors.input.background};
  border: 1px solid
    ${(props) =>
    props.active
      ? props.theme.colors.highlight
      : props.theme.colors.input.border};
  padding: 8px 12px;
  border-radius: ${(props) => props.theme.borderRadius || 4}px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  transition: all 0.15s ease-in-out;

  &:hover {
    background: ${(props) => props.theme.colors.input.hoverBackground};
    border-color: ${(props) =>
    props.active
      ? props.theme.colors.highlight
      : props.theme.colors.secondaryText};
  }
`;

const ProjectInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const ProjectName = styled.span<{ active?: boolean }>`
  color: ${(props) =>
    props.active ? props.theme.colors.highlightText : props.theme.colors.text};
  font-weight: 600;
  font-size: 12px;
`;

const ProjectPath = styled.span`
  font-size: 10px;
  color: ${(props) => props.theme.colors.secondaryText};
  word-break: break-all;
`;

const ActiveBadge = styled.span`
  font-size: 9px;
  background: ${(props) => props.theme.colors.highlight};
  color: ${(props) => props.theme.colors.highlightText};
  padding: 2px 6px;
  border-radius: 2px;
  font-weight: bold;
  text-transform: uppercase;
  letter-spacing: 0.5px;
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

export const ProjectPickerModal: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [data, setData] = useState<{
    currentProjectId?: string;
    templates: { id: string; name: string }[];
    userProjects?: { id: string; name: string }[];
  }>({ templates: [] });
  const [newProjectName, setNewProjectName] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("blank");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const currentUser = getCurrentUser();
  const isProjectLoaded = useAppSelector((state) => state.document.loaded);
  // Only allow closing the modal if a project is already loaded in the editor.
  const hasOpenProject = Boolean(isProjectLoaded || (data.currentProjectId && data.currentProjectId.length > 0));

  useEffect(() => {
    const show = () => {
      setErrorMsg(null);
      fetch("/api/projects")
        .then((r) => r.json())
        .then((d) => setData(d))
        .catch(console.error);
      setIsOpen(true);
    };

    const unsub = eventBus.on("web:project-picker", show);
    return () => {
      unsub();
    };
  }, []);

  const openProject = async (id: string) => {
    setErrorMsg(null);
    const res = await fetch("/api/projects/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: id }),
    });
    if (res.ok) {
      window.location.search = `?project=${encodeURIComponent(id)}`;
    } else {
      const err = await res
        .json()
        .catch(() => ({ error: "Failed to open project" }));
      setErrorMsg(err.error || "Failed to open project");
    }
  };

  const createNewProject = async () => {
    if (!newProjectName.trim()) {
      setErrorMsg("Please enter a project name");
      return;
    }
    setErrorMsg(null);
    try {
      const res = await fetch("/api/projects/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newProjectName.trim(),
          template: selectedTemplate,
        }),
      });
      if (res.ok) {
        const result = await res.json();
        window.location.search = `?project=${encodeURIComponent(result.projectId)}`;
      } else {
        const err = await res
          .json()
          .catch(() => ({ error: "Failed to create project" }));
        setErrorMsg(err.error || "Failed to create project");
      }
    } catch (e: any) {
      setErrorMsg(e.message || "Failed to create project");
    }
  };

  if (!isOpen) return null;

  return (
    <ModalOverlay
      onClick={() => {
        if (hasOpenProject) setIsOpen(false);
      }}
    >
      <ModalContainer onClick={(e) => e.stopPropagation()}>
        <ModalHeader>
          <Title>GB Studio Projects</Title>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {currentUser?.role === "admin" && (
              <Button
                small
                onClick={() => {
                  eventBus.emit("web:admin-panel");
                  window.dispatchEvent(new CustomEvent("web:admin-panel"));
                }}
                title="Manage Users"
                style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
              >
                <PersonIcon />
                <span>Manage Users</span>
              </Button>
            )}
            {hasOpenProject && (
              <HeaderCloseButton
                onClick={() => setIsOpen(false)}
                title="Close"
              >
                <CloseIcon />
              </HeaderCloseButton>
            )}
          </div>
        </ModalHeader>
        <Body>
          <div>
            <SectionHeader>
              <SectionTitle>Templates & Samples</SectionTitle>
            </SectionHeader>
            <ProjectList>
              {data.templates.map((tpl) => {
                const isActive = tpl.id === data.currentProjectId;
                return (
                  <ProjectCard
                    key={tpl.id}
                    active={isActive}
                    onClick={() => openProject(tpl.id)}
                  >
                    <ProjectInfo>
                      <ProjectName active={isActive}>{tpl.name}</ProjectName>
                    </ProjectInfo>
                    {isActive && <ActiveBadge>Active</ActiveBadge>}
                  </ProjectCard>
                );
              })}
            </ProjectList>
          </div>

          {data.userProjects && data.userProjects.length > 0 && (
            <div>
              <SectionHeader>
                <SectionTitle>My Projects</SectionTitle>
              </SectionHeader>
              <ProjectList>
                {data.userProjects.map((p) => {
                  const isActive = p.id === data.currentProjectId;
                  return (
                    <ProjectCard
                      key={p.id}
                      active={isActive}
                      onClick={() => openProject(p.id)}
                    >
                      <ProjectInfo>
                        <ProjectName active={isActive}>{p.name}</ProjectName>
                      </ProjectInfo>
                      {isActive && <ActiveBadge>Active</ActiveBadge>}
                    </ProjectCard>
                  );
                })}
              </ProjectList>
            </div>
          )}

          {errorMsg && (
            <div
              style={{
                background: "rgba(239, 68, 68, 0.15)",
                border: "1px solid #ef4444",
                color: "#ff6b6b",
                padding: "8px 12px",
                borderRadius: "4px",
                fontSize: "11px",
              }}
            >
              {errorMsg}
            </div>
          )}

          <div>
            <SectionHeader>
              <SectionTitle>Create New Project</SectionTitle>
            </SectionHeader>
            <FormRow>
              <Input
                placeholder="Project Name (e.g. MyGame)"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
              />
              <StyledSelect
                value={selectedTemplate}
                onChange={(e) => setSelectedTemplate(e.target.value)}
              >
                <option value="blank">Blank Template</option>
                <option value="gbhtml">GB HTML Sample</option>
                <option value="gbs2">GBS2 Sample</option>
              </StyledSelect>
              <Button variant="primary" onClick={createNewProject}>
                Create
              </Button>
            </FormRow>
          </div>
        </Body>
      </ModalContainer>
    </ModalOverlay>
  );
};
