import { Suspense } from 'react';
import { UnifiedShell } from '../components/shared/unified-shell';
import { OnboardingWizard } from '../components/onboarding/onboarding-wizard';
import { readIssuesForScope } from '../lib/aggregate-read';
import { resolveProjectScope } from '../lib/project-scope';
import { listProjects } from '../lib/registry';
import { bbDaemon } from '../lib/bb-daemon';
import { detectPiRuntimeStrategy } from '../lib/pi-runtime-detection';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { getCurrentProjectRoot } from '../lib/current-project-root';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

async function checkOnboardingStatus(): Promise<{
  hasProjects: boolean;
  piInstalled: boolean;
  hasAuth: boolean;
}> {
  // Check if any projects exist
  const registryProjects = await listProjects();
  const hasProjects = registryProjects.length > 0;

  // Check if Pi is installed
  const piResolution = await detectPiRuntimeStrategy();
  const piInstalled = piResolution.installState === 'ready';

  // Check if auth exists
  const authPath = path.join(os.homedir(), '.beadboard', 'runtime', 'pi', 'agent', 'auth.json');
  let hasAuth = false;
  try {
    const authContent = await fs.readFile(authPath, 'utf8');
    const auth = JSON.parse(authContent);
    hasAuth = Object.keys(auth.providers || {}).length > 0;
  } catch {
    hasAuth = false;
  }

  return { hasProjects, piInstalled, hasAuth };
}

export default async function Page({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const requestedProjectKey = typeof params.project === 'string' ? params.project : null;
  const requestedMode = typeof params.mode === 'string' ? params.mode : null;
  
  // Check if we should skip onboarding (user has seen it or explicitly skipped)
  const skipOnboarding = params.onboarded === 'true' || params.skip === 'true';
  
  // Check onboarding status
  const onboardingStatus = await checkOnboardingStatus();
  const needsOnboarding = !skipOnboarding && (!onboardingStatus.hasProjects || !onboardingStatus.piInstalled);

  const registryProjects = await listProjects();
  const scope = resolveProjectScope({
    currentProjectRoot: getCurrentProjectRoot(),
    registryProjects,
    requestedProjectKey,
    requestedMode,
  });

  const issues = await readIssuesForScope({
    mode: scope.mode,
    selected: scope.selected,
    scopeOptions: scope.options,
    preferBd: true,
    skipAgentFilter: true,
  });
  
  // Start daemon in background
  void bbDaemon.ensureRunning();

  // Show onboarding wizard if needed
  if (needsOnboarding) {
    return (
      <Suspense>
        <OnboardingWizard
          hasProjects={onboardingStatus.hasProjects}
          piInstalled={onboardingStatus.piInstalled}
          hasAuth={onboardingStatus.hasAuth}
        />
      </Suspense>
    );
  }
  
  return (
    <Suspense>
      <UnifiedShell
        issues={issues}
        projectRoot={scope.selected.root}
        projectScopeKey={scope.selected.key}
        projectScopeOptions={scope.options}
        projectScopeMode={scope.mode}
      />
    </Suspense>
  );
}
