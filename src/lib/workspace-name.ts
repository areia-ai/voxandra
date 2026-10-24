const MALFORMED_WORKSPACE_NAMES = new Set(["'s Workspace", "’s Workspace"]);

function normalizeText(value?: string | null) {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

function prettifyEmailLocalPart(email?: string | null) {
  const localPart = normalizeText(email).split("@")[0];
  if (!localPart) return "";

  return localPart
    .replace(/[._-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function deriveWorkspaceName({
  workspaceName,
  displayName,
  email,
}: {
  workspaceName?: string | null;
  displayName?: string | null;
  email?: string | null;
}) {
  const savedName = normalizeText(workspaceName);
  if (savedName && !MALFORMED_WORKSPACE_NAMES.has(savedName)) {
    return savedName;
  }

  const profileName = normalizeText(displayName);
  if (profileName) {
    return `${profileName}'s Workspace`;
  }

  const emailName = prettifyEmailLocalPart(email);
  if (emailName) {
    return `${emailName}'s Workspace`;
  }

  return "My Workspace";
}

export function validateWorkspaceName(name: string) {
  const trimmed = normalizeText(name);

  if (!trimmed) {
    return { ok: false as const, error: "Workspace name cannot be empty." };
  }

  if (trimmed.length > 80) {
    return { ok: false as const, error: "Workspace name must be 80 characters or fewer." };
  }

  return { ok: true as const, value: trimmed };
}
