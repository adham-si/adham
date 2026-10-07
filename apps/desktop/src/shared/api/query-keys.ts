export const queryKeys = {
  bootstrap: ['bootstrap'] as const,
  storageStatus: ['storage-status'] as const,
  workspace: (workspaceId: string) => ['workspace', workspaceId] as const,
  projects: (workspaceId: string) => ['projects', workspaceId] as const,
  conversation: (workspaceId: string, projectId: string, sessionId: string) =>
    ['conversation', workspaceId, projectId, sessionId] as const,
};
