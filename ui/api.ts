const fromHash = location.hash.slice(1);
if (fromHash) {
  sessionStorage.setItem("soull-token", fromHash);
  history.replaceState(null, "", location.pathname);
}
export const token = sessionStorage.getItem("soull-token") || "";
export async function api<T = any>(
  url: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch("/api" + url, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Request failed");
  return result;
}
export interface Manager {
  id: string;
  name: string;
  repo: string;
  provider: "codex" | "claude";
}
export interface Feature {
  id: string;
  managerId: string;
  title: string;
  branch: string;
  workspace: string;
  base: string;
}
export interface Finding {
  id: string;
  featureId: string;
  title: string;
  body: string;
  kind: string;
  isRead: number;
  resolved: number;
  created: string;
}
export interface Session {
  id: string;
  featureId: string;
  provider: string;
  state: string;
  exit?: number;
}
export interface State {
  questionCounts?: {
    managerId: string;
    open: number;
    waiting: number;
    answered: number;
  }[];
  managers: Manager[];
  features: Feature[];
  findings: Finding[];
  sessions: Session[];
}
export interface ChangedFile {
  path: string;
  category: string;
  untracked: boolean;
}
export interface Changes {
  head: string;
  base: string;
  files: ChangedFile[];
  diff: string;
}
