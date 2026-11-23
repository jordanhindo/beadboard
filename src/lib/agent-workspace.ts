import { listProjects } from './registry';
import { resolveProjectScope } from './project-scope';
import { getCurrentProjectRoot } from './current-project-root';

export interface ResolveAgentWorkspaceOptions {
  currentProjectRoot?: string;
  requestedProjectKey?: string | null;
  requestedProjectRoot?: string | null;
}

export interface ResolvedAgentWorkspace {
  root: string;
  key: string;
  source: 'explicit-root' | 'scope-selection';
}

export async function resolveAgentWorkspace(options: ResolveAgentWorkspaceOptions = {}): Promise<ResolvedAgentWorkspace> {
  const currentProjectRoot = options.currentProjectRoot ?? getCurrentProjectRoot();

  if (options.requestedProjectRoot && options.requestedProjectRoot.trim()) {
    const root = options.requestedProjectRoot.trim();
    return {
      root,
      key: root.toLowerCase(),
      source: 'explicit-root',
    };
  }

  const registryProjects = await listProjects();
  const scope = resolveProjectScope({
    currentProjectRoot,
    registryProjects,
    requestedProjectKey: options.requestedProjectKey ?? null,
    requestedMode: 'single',
  });

  return {
    root: process.platform === 'win32' ? scope.selected.root : scope.selected.displayPath,
    key: scope.selected.key,
    source: 'scope-selection',
  };
}
